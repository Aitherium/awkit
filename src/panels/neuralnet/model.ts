/**
 * NeuralNet -- the platform's services as one BeadSpace field, lit by live telemetry.
 *
 * Pure (no React, no DOM), so every mapping below is jest-tested:
 *
 *   Registry stack map (GET /api/stack?view=graph, L0-L12)  ->  bodies + dependency edges
 *   services.yaml      (GET /api/services/yaml)              ->  the same, when Registry is down
 *   /api/services/health rows                                ->  per-body health
 *   one universe-stream event (aither.universe-event/1)      ->  pulse / packet / error / alert
 *
 * Body ids are `svc:<services.yaml key>` -- the same ids AitherUniverse stamps on every
 * event (lib/universe/sources.py ServiceNames), so an event lands on its body without a
 * lookup table living anywhere but here.
 */

import type { BeadData, BeadLink, BeadNode, BeadStatus } from '@aitherium/bead-space'

// ── wire shapes ────────────────────────────────────────────────────────────────

/** One row of AitherRegistry /api/stack/graph (lib/core/StackModel.py node()). */
export interface StackNodeRecord {
  key: string
  layer?: string | null
  rank?: number | null
  role?: string
  registry?: string[]
  container?: string
  unit?: string
  port?: string | number
  gpu?: boolean
  criticality?: string
  capabilities?: string[]
  status?: string
  deps?: string[]
}

export interface StackGraphRecord {
  layers?: Array<{ id: string; rank?: number | null; name?: string }>
  nodes?: StackNodeRecord[]
  edges?: Array<{ from: string; to: string; from_layer?: string | null; to_layer?: string | null }>
}

/** One row of Veil /api/services/yaml. */
export interface ServicesYamlRecord {
  name: string
  port?: number
  group?: string
  layer?: number | null
  description?: string
  depends_on?: string[]
  enabled?: boolean
}

/** One row of Veil /api/services/health. */
export interface ServiceHealthRecord {
  id?: string
  name?: string
  status?: string
  healthy?: boolean
  error?: string
}

// ── topology ───────────────────────────────────────────────────────────────────

export type HealthState = 'ok' | 'degraded' | 'down' | 'starting' | 'parked' | 'unknown'

export interface ServiceBody {
  /** `svc:<services.yaml key>` */
  id: string
  /** services.yaml key (what /api/services/restart and /api/logs take). */
  name: string
  /** Stack-map key (lowercase), or the services.yaml key on the fallback. */
  key: string
  layer: string
  layerName: string
  rank: number
  role: string
  port: string
  criticality: string
  gpu: boolean
  /** Body ids this one depends on. */
  deps: string[]
  /** Body ids that depend on this one (Scope's "dependents"). */
  dependents: string[]
}

export interface Topology {
  source: 'registry' | 'services.yaml'
  bodies: Map<string, ServiceBody>
  /** Dependency edges, `from` depends on `to`. */
  edges: Array<{ from: string; to: string }>
  /** Layer ids in rank order, for the cluster order and the anchors. */
  layers: Array<{ id: string; name: string; rank: number }>
  /** Lowercased name/alias -> body id. */
  alias: Map<string, string>
}

function rankOf(layer: string | null | undefined): number {
  const m = /^L(\d{1,2})$/i.exec(String(layer ?? ''))
  return m ? Number(m[1]) : 99
}

function aliasKeys(name: string): string[] {
  const low = name.trim().toLowerCase()
  if (!low) return []
  const out = new Set<string>([low])
  for (const prefix of ['aitheros-', 'aither-', 'aither']) {
    if (low.startsWith(prefix) && low.length > prefix.length) out.add(low.slice(prefix.length))
  }
  if (low.endsWith('.service')) out.add(low.slice(0, -'.service'.length).replace(/^aither(os)?-/, ''))
  return [...out]
}

function addAlias(alias: Map<string, string>, name: string | undefined | null, id: string): void {
  if (!name) return
  for (const k of aliasKeys(String(name))) if (!alias.has(k)) alias.set(k, id)
}

function finish(topo: Topology, rawDeps: Map<string, string[]>): Topology {
  for (const [id, deps] of rawDeps) {
    const body = topo.bodies.get(id)
    if (!body) continue
    for (const dep of deps) {
      const to = resolveBody(topo, dep)
      if (!to || to === id || body.deps.includes(to)) continue
      body.deps.push(to)
      topo.bodies.get(to)!.dependents.push(id)
      topo.edges.push({ from: id, to })
    }
  }
  return topo
}

/** The Registry stack map -> topology. Retired/unlayered rows are already excluded upstream. */
export function fromStackGraph(graph: StackGraphRecord): Topology {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  const layerNames = new Map<string, string>()
  for (const l of graph?.layers ?? []) if (l?.id) layerNames.set(l.id, l.name || l.id)
  const topo: Topology = { source: 'registry', bodies: new Map(), edges: [], layers: [], alias: new Map() }
  const keyToId = new Map<string, string>()
  for (const n of nodes) {
    if (!n || typeof n.key !== 'string' || !n.key) continue
    const name = (Array.isArray(n.registry) && n.registry[0]) || n.key
    const id = `svc:${name}`
    if (topo.bodies.has(id)) continue
    const layer = n.layer || 'unlayered'
    topo.bodies.set(id, {
      id, name, key: n.key, layer,
      layerName: layerNames.get(layer) || layer,
      rank: typeof n.rank === 'number' ? n.rank : rankOf(layer),
      role: n.role || '', port: String(n.port ?? ''), criticality: n.criticality || 'optional',
      gpu: Boolean(n.gpu), deps: [], dependents: [],
    })
    keyToId.set(n.key, id)
    addAlias(topo.alias, n.key, id)
    for (const r of n.registry ?? []) addAlias(topo.alias, r, id)
    addAlias(topo.alias, n.container, id)
    addAlias(topo.alias, n.unit, id)
  }
  // Edges: the graph's own list is authoritative; a node's `deps` fills in when absent.
  const raw = new Map<string, string[]>()
  const edges = Array.isArray(graph?.edges) ? graph.edges : []
  if (edges.length) {
    for (const e of edges) {
      const from = keyToId.get(e.from)
      if (!from) continue
      raw.set(from, [...(raw.get(from) ?? []), e.to])
    }
  } else {
    for (const n of nodes) {
      const from = n?.key ? keyToId.get(n.key) : undefined
      if (from && Array.isArray(n.deps)) raw.set(from, n.deps)
    }
  }
  topo.layers = layerList(topo, layerNames)
  return finish(topo, raw)
}

/** services.yaml -> topology (Registry unreachable). `layer` is a number there. */
export function fromServicesYaml(rows: ServicesYamlRecord[]): Topology {
  const topo: Topology = { source: 'services.yaml', bodies: new Map(), edges: [], layers: [], alias: new Map() }
  const raw = new Map<string, string[]>()
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.name !== 'string' || !r.name || r.enabled === false) continue
    const id = `svc:${r.name}`
    if (topo.bodies.has(id)) continue
    const layer = typeof r.layer === 'number' ? `L${r.layer}` : r.group ? `group:${r.group}` : 'unlayered'
    topo.bodies.set(id, {
      id, name: r.name, key: r.name, layer,
      layerName: layer.startsWith('group:') ? layer.slice(6) : layer,
      rank: typeof r.layer === 'number' ? r.layer : 50,
      role: r.description || '', port: String(r.port ?? ''), criticality: 'optional',
      gpu: false, deps: [], dependents: [],
    })
    addAlias(topo.alias, r.name, id)
    if (Array.isArray(r.depends_on)) raw.set(id, r.depends_on)
  }
  topo.layers = layerList(topo, new Map())
  return finish(topo, raw)
}

function layerList(topo: Topology, names: Map<string, string>): Topology['layers'] {
  const seen = new Map<string, { id: string; name: string; rank: number }>()
  for (const b of topo.bodies.values()) {
    if (!seen.has(b.layer)) seen.set(b.layer, { id: b.layer, name: names.get(b.layer) || b.layerName, rank: b.rank })
  }
  return [...seen.values()].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
}

/** Any service-ish name (`svc:Genesis`, `AitherGenesis`, `aitheros-genesis`, `genesis`) -> body id. */
export function resolveBody(topo: Topology, raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw)
  if (topo.bodies.has(s)) return s
  const bare = s.startsWith('svc:') ? s.slice(4) : s.includes(':') ? null : s
  if (!bare) return null
  if (topo.bodies.has(`svc:${bare}`)) return `svc:${bare}`
  for (const k of aliasKeys(bare)) {
    const hit = topo.alias.get(k)
    if (hit) return hit
  }
  return null
}

export function healthState(status: string | undefined, healthy?: boolean): HealthState {
  switch (String(status ?? '').toLowerCase()) {
    case 'online': case 'healthy': case 'live': case 'up': case 'ok': return 'ok'
    case 'degraded': return 'degraded'
    case 'offline': case 'down': case 'unhealthy': case 'error': return 'down'
    case 'checking': case 'starting': return 'starting'
    case 'inactive': case 'parked': case 'stopped': return 'parked'
    default: return healthy === true ? 'ok' : healthy === false ? 'down' : 'unknown'
  }
}

/** /api/services/health rows -> body id -> state. Rows that name no body are ignored. */
export function healthMap(topo: Topology, rows: ServiceHealthRecord[]): Map<string, HealthState> {
  const out = new Map<string, HealthState>()
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = resolveBody(topo, r?.name) ?? resolveBody(topo, r?.id)
    if (id) out.set(id, healthState(r.status, r.healthy))
  }
  return out
}

export const HEALTH_COLOR: Record<HealthState, string> = {
  ok: '#4ADE80',
  degraded: '#FBBF24',
  down: '#F87171',
  starting: '#7DD3FC',
  parked: '#94A3B8',
  unknown: '#64748B',
}

const CRITICALITY_AGE: Record<string, number> = { core: 0, critical: 1, important: 2, optional: 3 }
const EPOCH = Date.UTC(2026, 0, 1)

/** Body radius in world px: dependents drive size (Scope), sqrt so hubs don't swallow the map. */
export function bodyRadius(body: ServiceBody): number {
  return Math.max(5, Math.min(22, 5 + 2.4 * Math.sqrt(body.dependents.length)))
}

/** Topology + health -> the bead nodes. Identical across views, so a view switch never relayouts. */
export function toBeadNodes(topo: Topology, health: Map<string, HealthState>): BeadNode[] {
  const out: BeadNode[] = []
  for (const b of topo.bodies.values()) {
    const h = health.get(b.id) ?? 'unknown'
    const status: BeadStatus = h === 'down' ? 'blocked' : h === 'parked' || h === 'unknown' ? 'deferred' : 'open'
    out.push({
      id: b.id,
      title: b.name,
      cluster: b.layer,
      status,
      // Age radius: core services sit at the heart of their layer, optional ones at the rim.
      createdAt: new Date(EPOCH + (CRITICALITY_AGE[b.criticality] ?? 3) * 86_400_000).toISOString(),
      meta: { layer: b.layer, health: h, dependents: b.dependents.length, port: b.port, role: b.role },
    })
  }
  return out
}

function hashAngle(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return ((h >>> 0) % 3600) / 3600 * Math.PI * 2
}

const TAU = Math.PI * 2

/**
 * The Brain layout: the stack as concentric rings, L0 (substrate) at the core and L12 (the
 * access edge) outermost. Each body sits on its layer's ring next to what it is wired to
 * (circular mean of its already-placed neighbours' angles), so edges run mostly radially.
 * Deterministic and pinned: no force settle at all, and no view can move a body.
 * Returns world-px offsets from the view centre (BeadSpaceOptions.fixedPosition).
 */
export function ringLayout(topo: Topology, gap = 60): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>()
  const angle = new Map<string, number>()
  let outer = 0
  for (const layer of topo.layers) {
    const members = [...topo.bodies.values()].filter((b) => b.layer === layer.id)
    if (!members.length) continue
    const target = new Map<string, number>()
    for (const b of members) {
      let x = 0
      let y = 0
      let n = 0
      for (const d of [...b.deps, ...b.dependents]) {
        const a = angle.get(d)
        if (a === undefined) continue
        x += Math.cos(a)
        y += Math.sin(a)
        n++
      }
      const t = n && (x || y) ? Math.atan2(y, x) : hashAngle(b.id)
      target.set(b.id, ((t % TAU) + TAU) % TAU)
    }
    members.sort((a, b) => target.get(a.id)! - target.get(b.id)! || a.name.localeCompare(b.name))
    const sizes = members.map((b) => bodyRadius(b))
    const maxR = Math.max(...sizes)
    const need = sizes.reduce((acc, r) => acc + 2 * r + 10, 0)
    if (outer === 0 && members.length === 1) {
      out.set(members[0].id, [0, 0])
      angle.set(members[0].id, 0)
      outer = maxR
      continue
    }
    const r = Math.max(outer + gap + maxR, need / TAU)
    // Spread the WHOLE ring, each body's share of the turn proportional to its size,
    // starting where its first body wants to be.
    let acc = 0
    const start = target.get(members[0].id)!
    members.forEach((b, i) => {
      const a = start + ((acc + sizes[i] + 5) / need) * TAU
      acc += 2 * sizes[i] + 10
      angle.set(b.id, a)
      out.set(b.id, [Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))])
    })
    outer = r + maxR
  }
  return out
}

/** Layers on a ring, L0 at twelve o'clock, clockwise -- the stack reads like a clock face. */
export function layerAnchors(layers: Topology['layers']): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {}
  const n = layers.length
  layers.forEach((l, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2
    out[l.id] = [0.5 + 0.36 * Math.cos(a), 0.5 + 0.36 * Math.sin(a)]
  })
  return out
}

// ── events ─────────────────────────────────────────────────────────────────────

export interface NeuralEvent {
  id: string
  source: string
  kind: string
  object_id: string
  from?: string
  to?: string
  severity: string
  ts: number
  summary: string
  count: number
}

/** The universe-event wire shape, loosely (ts seconds/ms/ISO). Junk -> null. */
export function parseNeuralEvent(raw: unknown): NeuralEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const source = typeof r.source === 'string' ? r.source.trim().toLowerCase() : ''
  const object_id = typeof r.object_id === 'string' ? r.object_id : ''
  if (!source || !object_id) return null
  let ts = typeof r.ts === 'number' ? r.ts : typeof r.ts === 'string' ? Date.parse(r.ts) : NaN
  if (Number.isFinite(ts) && ts < 1e12) ts *= 1000
  if (!Number.isFinite(ts)) ts = Date.now()
  const ev: NeuralEvent = {
    id: typeof r.id === 'string' ? r.id : `${source}:${object_id}:${ts}`,
    source,
    kind: typeof r.kind === 'string' ? r.kind : 'event',
    object_id,
    severity: typeof r.severity === 'string' ? r.severity.toLowerCase() : 'info',
    ts,
    summary: typeof r.summary === 'string' ? r.summary.slice(0, 240) : '',
    count: typeof r.count === 'number' && r.count > 0 ? r.count : 1,
  }
  const from = r.from_object ?? r.from
  const to = r.to_object ?? r.to
  if (typeof from === 'string' && from) ev.from = from
  if (typeof to === 'string' && to) ev.to = to
  return ev
}

export type Effect =
  | { type: 'heartbeat'; body: string; color: string }
  | { type: 'packet'; from: string; to: string; color: string }
  | { type: 'error'; body: string; color: string }
  | { type: 'alert'; body: string; on: boolean; summary: string }
  | { type: 'activity'; body: string; color: string; strength: number }

export const SEVERITY_COLOR: Record<string, string> = {
  critical: '#FF5A5F',
  error: '#FF6B6B',
  warning: '#FBBF24',
  notice: '#9FE8FF',
  info: '#5EC9CC',
  debug: '#7D8BA1',
}
const RED = '#FF4D4D'

const bad = (sev: string) => sev === 'error' || sev === 'critical'

/**
 * What one event does to the field.
 *   Pulse            -> heartbeat flash on the body (red when it reports a failure)
 *   from/to edge     -> a packet along each resolved hop (Flux traffic, LLM calls)
 *   Chronicle error  -> red flash
 *   Watch alert/down -> a persistent ring (cleared by watch.svc.up)
 *   Prometheus alert -> a ring too (cleared on alert.resolved)
 *   anything else on a known body -> a faint activity flash
 */
export function effectsFor(ev: NeuralEvent, topo: Topology): Effect[] {
  const obj = resolveBody(topo, ev.object_id)
  const out: Effect[] = []
  const sevColor = SEVERITY_COLOR[ev.severity] ?? SEVERITY_COLOR.info

  // Packets: walk from -> object -> to, keep resolved hops, collapse repeats.
  const hops: string[] = []
  for (const h of [ev.from, ev.object_id, ev.to]) {
    const id = resolveBody(topo, h)
    if (id && hops[hops.length - 1] !== id) hops.push(id)
  }
  if (hops.length > 1 && (ev.from || ev.to)) {
    for (let i = 0; i + 1 < hops.length && i < 2; i++) {
      out.push({ type: 'packet', from: hops[i], to: hops[i + 1], color: bad(ev.severity) ? RED : sevColor })
    }
  }

  if (ev.source === 'watch' || ev.source === 'prometheus') {
    if (!obj) return out
    const kind = ev.kind.toLowerCase()
    if (kind === 'watch.svc.up' || kind === 'alert.resolved' || kind === 'alert.inactive') {
      out.push({ type: 'alert', body: obj, on: false, summary: ev.summary })
    } else if (kind === 'watch.alert' || kind === 'watch.svc.down' || kind.startsWith('alert.') || bad(ev.severity)) {
      out.push({ type: 'alert', body: obj, on: true, summary: ev.summary })
    } else {
      out.push({ type: 'activity', body: obj, color: sevColor, strength: 0.5 })
    }
    return out
  }
  if (!obj) return out
  if (ev.source === 'pulse') {
    out.push(bad(ev.severity) ? { type: 'error', body: obj, color: RED } : { type: 'heartbeat', body: obj, color: ev.severity === 'warning' ? SEVERITY_COLOR.warning : HEALTH_COLOR.ok })
    return out
  }
  if (bad(ev.severity)) {
    out.push({ type: 'error', body: obj, color: RED })
    return out
  }
  // A packet already lit this body; a second flash on top is noise.
  if (!out.length) out.push({ type: 'activity', body: obj, color: sevColor, strength: ev.severity === 'warning' ? 0.8 : 0.45 })
  return out
}

// ── throttling ─────────────────────────────────────────────────────────────────

/**
 * At most one visual per key per window, and at most `maxPerWindow` visuals across all
 * keys per window -- a 500-event burst costs a phone the same as 24.
 */
export class Coalescer {
  private last = new Map<string, number>()
  private windowStart = 0
  private spent = 0
  dropped = 0
  constructor(readonly windowMs = 500, public maxPerWindow = 24) {}
  admit(key: string, now: number): boolean {
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now
      this.spent = 0
    }
    const prev = this.last.get(key)
    if ((prev !== undefined && now - prev < this.windowMs) || this.spent >= this.maxPerWindow) {
      this.dropped++
      return false
    }
    this.last.set(key, now)
    this.spent++
    if (this.last.size > 2000) {
      for (const [k, t] of this.last) if (now - t >= this.windowMs) this.last.delete(k)
    }
    return true
  }
}

/**
 * The phone's firing cycle: effects wait in a small deduped queue and fire together once
 * per `intervalMs`. Any animating frame re-rasterises the whole field, so on a phone the
 * cost is the TIME something is moving, not how many things move -- one wave every 3 s
 * keeps the field still most of the time (and reads as the net "firing").
 */
export class FxQueue {
  private queue = new Map<string, Effect>()
  private lastFlush = 0
  constructor(readonly intervalMs = 2500, readonly cap = 6) {}
  push(e: Effect): void {
    const k = effectKey(e)
    // Errors outrank anything already queued for the same key; the queue never grows past cap.
    if (this.queue.has(k) && e.type !== 'error') return
    if (!this.queue.has(k) && this.queue.size >= this.cap) {
      if (e.type !== 'error') return
      const victim = [...this.queue].find(([, q]) => q.type !== 'error')
      if (!victim) return
      this.queue.delete(victim[0])
    }
    this.queue.set(k, e)
  }
  /** The effects to fire now ([] until the interval has passed). */
  take(now: number): Effect[] {
    if (!this.queue.size || now - this.lastFlush < this.intervalMs) return []
    this.lastFlush = now
    const out = [...this.queue.values()]
    this.queue.clear()
    return out
  }
  get size(): number {
    return this.queue.size
  }
}

export function effectKey(e: Effect): string {
  return e.type === 'packet' ? `p:${e.from}>${e.to}` : `${e.type}:${e.body}`
}

// ── activity memory ────────────────────────────────────────────────────────────

export const TRAFFIC_WINDOW_MS = 60_000
export const ERROR_WINDOW_MS = 10 * 60_000
export const ALERT_TTL_MS = 30 * 60_000
const RECENT_PER_BODY = 12

/** What the stream has said, per body. Bounded; prune() drops what aged out. */
export class NeuralActivity {
  readonly traffic = new Map<string, number[]>()
  readonly alerts = new Map<string, { summary: string; ts: number }>()
  readonly errors = new Map<string, number[]>()
  readonly recent = new Map<string, NeuralEvent[]>()
  total = 0
  /** Bumped when anything a view draws (alerts, errors, traffic edges) changed. */
  version = 0

  apply(ev: NeuralEvent, effects: Effect[], now: number): void {
    this.total++
    const touched = new Set<string>()
    for (const e of effects) {
      if (e.type === 'packet') {
        const k = `${e.from}>${e.to}`
        const list = this.traffic.get(k) ?? []
        if (!list.length) this.version++
        for (let i = 0; i < Math.min(ev.count, 20); i++) list.push(now)
        if (list.length > 400) list.splice(0, list.length - 400)
        this.traffic.set(k, list)
        touched.add(e.from).add(e.to)
      } else {
        touched.add(e.body)
        if (e.type === 'alert') {
          if (e.on) {
            if (!this.alerts.has(e.body)) this.version++
            this.alerts.set(e.body, { summary: e.summary, ts: now })
          } else if (this.alerts.delete(e.body)) this.version++
        } else if (e.type === 'error') {
          const list = this.errors.get(e.body) ?? []
          if (!list.length) this.version++
          list.push(now)
          if (list.length > 50) list.shift()
          this.errors.set(e.body, list)
        }
      }
    }
    for (const b of touched) {
      const list = this.recent.get(b) ?? []
      list.unshift(ev)
      if (list.length > RECENT_PER_BODY) list.length = RECENT_PER_BODY
      this.recent.set(b, list)
    }
  }

  hasError(body: string, now: number): boolean {
    const list = this.errors.get(body)
    return !!list && list.length > 0 && now - list[list.length - 1] < ERROR_WINDOW_MS
  }

  trafficEdges(now: number): Array<{ from: string; to: string; count: number }> {
    const out: Array<{ from: string; to: string; count: number }> = []
    for (const [k, list] of this.traffic) {
      const count = list.filter((t) => now - t < TRAFFIC_WINDOW_MS).length
      if (!count) continue
      const [from, to] = k.split('>')
      out.push({ from, to, count })
    }
    return out
  }

  /** Drop aged-out traffic, errors and alerts. Returns true when a view would change. */
  prune(now: number): boolean {
    let changed = false
    for (const [k, list] of this.traffic) {
      const keep = list.filter((t) => now - t < TRAFFIC_WINDOW_MS)
      if (keep.length !== list.length) changed = true
      if (keep.length) this.traffic.set(k, keep)
      else this.traffic.delete(k)
    }
    for (const [k, list] of this.errors) {
      if (!list.length || now - list[list.length - 1] >= ERROR_WINDOW_MS) {
        this.errors.delete(k)
        changed = true
      }
    }
    for (const [k, a] of this.alerts) {
      if (now - a.ts >= ALERT_TTL_MS) {
        this.alerts.delete(k)
        changed = true
      }
    }
    if (changed) this.version++
    return changed
  }
}

// ── views ──────────────────────────────────────────────────────────────────────

export type NeuralView = 'brain' | 'traffic' | 'scope' | 'health'

export const VIEWS: Array<{ id: NeuralView; label: string; hint: string }> = [
  { id: 'brain', label: 'Brain', hint: 'Every service on its L0-L12 layer, wired by what it depends on' },
  { id: 'traffic', label: 'Traffic', hint: 'Only the paths that carried packets in the last minute; brighter = busier' },
  { id: 'scope', label: 'Scope', hint: 'Size = how many services depend on it; leaves fade' },
  { id: 'health', label: 'Health', hint: 'Watch alerts and Chronicle errors only, with who depends on the sick ones' },
]

/** Traffic brightness tiers ride the engine's own link kinds (CSS scopes them per view). */
export function trafficKind(count: number): BeadLink['kind'] {
  return count >= 10 ? 'blocks' : count >= 3 ? 'related' : 'parent-child'
}

export interface ViewProjection {
  links: BeadLink[]
  /** Extra classes per body for this view (nn-dim, nn-alert, nn-error, nn-hub). */
  classes: Map<string, string>
}

/**
 * One view = a link set + body classes over the SAME bodies. Bodies never change here, so
 * the engine's links-only path keeps every body where it is.
 */
export function projectView(
  view: NeuralView,
  topo: Topology,
  health: Map<string, HealthState>,
  activity: NeuralActivity,
  now: number,
): ViewProjection {
  const classes = new Map<string, string>()
  const add = (id: string, c: string) => classes.set(id, classes.has(id) ? `${classes.get(id)} ${c}` : c)
  const sick = (id: string) => activity.alerts.has(id) || activity.hasError(id, now) || health.get(id) === 'down'
  // The Watch ring is persistent: it shows in every view, not only Health.
  for (const id of activity.alerts.keys()) if (topo.bodies.has(id)) add(id, 'nn-alert')
  for (const id of topo.bodies.keys()) if (activity.hasError(id, now)) add(id, 'nn-error')

  const deps: BeadLink[] = topo.edges.map((e) => ({ source: e.from, target: e.to, kind: 'parent-child' }))
  let links: BeadLink[] = deps
  if (view === 'traffic') {
    const lit = new Set<string>()
    links = activity
      .trafficEdges(now)
      .filter((e) => topo.bodies.has(e.from) && topo.bodies.has(e.to))
      .map((e) => {
        lit.add(e.from).add(e.to)
        return { source: e.from, target: e.to, kind: trafficKind(e.count) }
      })
    for (const id of topo.bodies.keys()) if (!lit.has(id)) add(id, 'nn-dim')
  } else if (view === 'scope') {
    for (const b of topo.bodies.values()) {
      if (b.dependents.length === 0) add(b.id, 'nn-dim')
      else if (b.dependents.length >= 8) add(b.id, 'nn-hub')
    }
  } else if (view === 'health') {
    links = deps.filter((l) => sick(l.target))
    const involved = new Set<string>()
    for (const l of links) involved.add(l.source).add(l.target)
    for (const id of topo.bodies.keys()) if (!sick(id) && !involved.has(id)) add(id, 'nn-dim')
  }
  return { links, classes }
}

/** The whole dataset for one view. */
export function buildData(proj: ViewProjection, nodes: BeadNode[]): BeadData {
  return { nodes, links: proj.links }
}

/** A short label, with the dependents count in Scope. */
export function bodyLabel(view: NeuralView, body: ServiceBody | undefined, fallback: string): string {
  if (!body) return fallback
  return view === 'scope' && body.dependents.length ? `${body.name} · ${body.dependents.length}` : body.name
}
