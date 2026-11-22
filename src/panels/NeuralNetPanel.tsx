'use client'

/**
 * NeuralNet -- the old Veil canvas dashboard's AitherNeuralNet, rebuilt on BeadSpace
 * (owner 2026-11-07: "BUT NOW I WANT IT TO BE BEADSPACE/AWKIT").
 *
 * Bodies = services from the AitherRegistry L0-L12 stack map (services.yaml when Registry
 * is down), sized by dependents, coloured by live health. The universe stream (Pulse,
 * Chronicle, Watch, Flux-carried traffic) lights them: Pulse = heartbeat flash, a from/to
 * event = a packet along the edge, Chronicle error = red flash, Watch alert = a ring that
 * stays. Four views (Brain / Traffic / Scope / Health) are the SAME engine instance fed a
 * different link set and body classes through update() -- the bodies never change, so a
 * view switch never relayouts.
 *
 * The only renderer is the real engine (`createBeadSpace`); the pure mapping lives in
 * ./neuralnet/model.ts and is jest-tested. Every read is relative to `apiBase` and every
 * one of them is an operator route (system:read / system:admin); the host gates the window
 * to the platform owner and the routes refuse anyone else themselves.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createBeadSpace } from '@aitherium/bead-space'
import type { BeadNode, BeadSpaceHandle } from '@aitherium/bead-space'
import '@aitherium/bead-space/bead-space.css'
import {
  bodyLabel,
  bodyRadius,
  Coalescer,
  FxQueue,
  type Effect,
  effectKey,
  effectsFor,
  fromServicesYaml,
  fromStackGraph,
  HEALTH_COLOR,
  healthMap,
  NeuralActivity,
  parseNeuralEvent,
  projectView,
  ringLayout,
  toBeadNodes,
  VIEWS,
  type HealthState,
  type NeuralEvent,
  type NeuralView,
  type ServiceBody,
  type Topology,
} from './neuralnet/model'

export interface NeuralNetPanelProps {
  apiBase?: string
  /** The host has verified the platform owner: show Restart. Reads work either way. */
  canOperate?: boolean
  initialView?: NeuralView
}

const HEALTH_POLL_MS = 15_000
const CLASS_TICK_MS = 1_000

type Load<T> = { kind: 'ok'; value: T; note?: string } | { kind: 'error'; reason: string }

async function getJson(url: string, signal: AbortSignal, timeoutMs = 12_000): Promise<Load<any>> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  const onAbort = () => ctl.abort()
  signal.addEventListener('abort', onAbort)
  try {
    const res = await fetch(url, { signal: ctl.signal, credentials: 'include', headers: { Accept: 'application/json' } })
    const body = await res.json().catch(() => null)
    if (!res.ok) {
      const why = body && typeof body === 'object' ? body.error || body.detail : ''
      return { kind: 'error', reason: `${url} → HTTP ${res.status}${why ? `: ${String(why).slice(0, 160)}` : ''}` }
    }
    if (body === null) return { kind: 'error', reason: `${url} answered something that is not JSON` }
    return { kind: 'ok', value: body }
  } catch (e) {
    if (signal.aborted) return { kind: 'error', reason: 'cancelled' }
    return { kind: 'error', reason: ctl.signal.aborted ? `${url} did not answer within ${timeoutMs / 1000} s` : `${url}: ${(e as Error)?.message ?? e}` }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

/** Registry stack map first; services.yaml only when Registry cannot answer (and say so). */
async function loadTopology(apiBase: string, signal: AbortSignal): Promise<Load<Topology>> {
  const stack = await getJson(`${apiBase}/stack?view=graph`, signal)
  if (stack.kind === 'ok') {
    const topo = fromStackGraph(stack.value)
    if (topo.bodies.size) return { kind: 'ok', value: topo }
  }
  const yaml = await getJson(`${apiBase}/services/yaml`, signal)
  const why = stack.kind === 'error' ? stack.reason : 'the Registry stack map listed no services'
  if (yaml.kind === 'ok') {
    const topo = fromServicesYaml(Array.isArray(yaml.value?.services) ? yaml.value.services : [])
    if (topo.bodies.size) return { kind: 'ok', value: topo, note: `services.yaml layers (${why})` }
  }
  return { kind: 'error', reason: `${why}; services.yaml: ${yaml.kind === 'error' ? yaml.reason : 'no services'}` }
}

/** What the engine was last fed (bodies + links); an identical push skips update(). */
function signature(view: NeuralView, nodes: BeadNode[], proj: ReturnType<typeof projectView>): string {
  return `${view}|${nodes.map((n) => `${n.status}${String(n.meta?.health ?? '')[0]}`).join('')}|${proj.links.map((l) => `${l.source}>${l.target}:${l.kind}`).join(',')}`
}

/**
 * Class-only changes (a Watch ring, a Chronicle error, a dimmed leaf) are toggled on the
 * engine's own body elements instead of a full update(): update() re-syncs all ~300 bodies
 * and re-binds their listeners, which at 1 Hz held a 4x-throttled phone at 13 fps
 * (measured 2026-11-07). The engine's nodeClass reads the same map, so its next sync agrees.
 */
function applyClasses(root: HTMLElement | null, prev: Map<string, string>, next: Map<string, string>): void {
  if (!root) return
  const changed = new Set<string>()
  for (const [id, c] of next) if (prev.get(id) !== c) changed.add(id)
  for (const id of prev.keys()) if (!next.has(id)) changed.add(id)
  if (!changed.size) return
  for (const el of root.querySelectorAll<SVGGElement>('g.bs-node')) {
    const id = (el as unknown as { __data__?: { id?: string } }).__data__?.id
    if (!id || !changed.has(id)) continue
    for (const c of (prev.get(id) ?? '').split(' ')) if (c) el.classList.remove(c)
    for (const c of (next.get(id) ?? '').split(' ')) if (c) el.classList.add(c)
  }
}

/** One effect on the engine. Phone: shorter packets, smaller rings (a ring's dirty rect is what re-rasterises). */
function fire(h: BeadSpaceHandle, e: Effect, compact: boolean): void {
  const k = compact ? 0.6 : 1
  if (e.type === 'packet') h.packet(e.from, e.to, { color: e.color, duration: compact ? 600 : 1150 })
  else if (e.type === 'activity') h.pulse(e.body, { color: e.color, strength: e.strength * k })
  else if (e.type !== 'alert') h.pulse(e.body, { color: e.color, strength: (e.type === 'error' ? 1.4 : 0.9) * k })
}

type StreamState = { state: 'connecting' | 'live' | 'down'; note: string }

/*
 * Group opacity is avoided throughout (stroke-/fill-opacity instead): `opacity` on an SVG
 * element makes it its own blend group, and 871 of them cost a phone every animating frame.
 *
 * Neurons, not planets. Every SVG filter in the field is off: with 300 bodies each wearing a
 * tint filter, ONE moving pulse made the browser re-rasterise all of them every frame --
 * measured 2026-11-07 on this panel: 7.5 fps on a desktop with the stream firing, 60 fps
 * with filters off. The body is the engine's own core circle filled with its health colour
 * (--bs-core-tint, set by the engine per body) with a cheap stroke halo instead of a blur.
 */
const STYLE = `
.nn-root .bead-space * { filter: none !important; }
.nn-field { contain: strict; will-change: transform; }
.nn-root.bs-lowfx .bead-space .bs-link { shape-rendering: optimizeSpeed; }
.nn-root.bs-lowfx .bead-space .bs-label { text-rendering: optimizeSpeed; }
.nn-root .bead-space .bs-planet-sprite { display: none; }
.nn-root .bead-space .bs-planet-core { fill: var(--bs-core-tint); fill-opacity: .9; stroke: var(--bs-core-tint); stroke-opacity: .28; stroke-width: 5px; }
.nn-root .bead-space .bs-node.status-blocked .bs-planet-core { stroke: #FF4D4D; stroke-opacity: .7; stroke-width: 4px; }
.nn-root .bead-space .bs-sheen { display: none; }
.nn-root .bead-space .bs-node.status-deferred { opacity: 1; }
.nn-root .bead-space .bs-node.status-deferred .bs-planet-core { fill-opacity: .45; }
.nn-root .bead-space .bs-node.nn-dim .bs-planet-core { fill-opacity: .18; stroke-opacity: .06; }
.nn-root .bead-space .bs-node.nn-dim .bs-label { fill-opacity: .3; stroke-opacity: .3; }
.nn-root .bead-space .bs-node.nn-alert .bs-selection-ring { opacity: 1; stroke: #FF4D4D; stroke-width: 2.6px; }
.nn-root .bead-space .bs-node.nn-error .bs-planet-core { stroke: #FF6B6B; stroke-opacity: .9; stroke-width: 2px; }
.nn-root .bead-space .bs-node.nn-hub .bs-label { font-weight: 700; }
.nn-root.nn-view-brain .bead-space .bs-link, .nn-root.nn-view-scope .bead-space .bs-link { stroke-opacity: .16; }
.nn-root.nn-view-traffic .bead-space .bs-link { stroke: #5EC9CC; stroke-opacity: .35; stroke-dasharray: none; }
.nn-root.nn-view-traffic .bead-space .bs-link.related { stroke-opacity: .7; }
.nn-root.nn-view-traffic .bead-space .bs-link.blocks { stroke-opacity: 1; stroke: #9FE8FF; stroke-width: 2px; }
.nn-root.nn-view-health .bead-space .bs-link { stroke: #F87171; stroke-opacity: .6; stroke-dasharray: none; }
.nn-chip { border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.04); color: #cbd5e1;
  border-radius: 999px; padding: 6px 12px; font-size: 13px; cursor: pointer; white-space: nowrap; min-height: 32px; }
.nn-chip[aria-pressed="true"] { border-color: #5EC9CC; background: rgba(94,201,204,.16); color: #e2fdfd; font-weight: 600; }
.nn-btn { border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.05); color: #e2e8f0;
  border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer; min-height: 30px; }
.nn-btn:disabled { opacity: .5; cursor: default; }
.nn-btn.nn-danger { border-color: rgba(248,113,113,.5); color: #fecaca; }
.nn-btn.nn-armed { background: rgba(248,113,113,.25); }
.nn-tag { display: inline-block; border: 1px solid rgba(255,255,255,.12); border-radius: 6px; padding: 2px 6px;
  margin: 0 4px 4px 0; font-size: 11px; color: #cbd5e1; cursor: pointer; background: none; }
`

function timeAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`
}

interface LogLine { timestamp: string; level: string; message: string }

/** The inspector: health, Chronicle lines, recent stream events, deps, real actions. */
function Inspector({
  body, health, topo, activity, apiBase, canOperate, tick, onPick, onClose, compact,
}: {
  body: ServiceBody
  health: HealthState
  topo: Topology
  activity: NeuralActivity
  apiBase: string
  canOperate: boolean
  tick: number
  onPick: (id: string) => void
  onClose: () => void
  compact: boolean
}) {
  const [logs, setLogs] = useState<{ lines: LogLine[]; error: string } | null>(null)
  const [armed, setArmed] = useState(false)
  const [action, setAction] = useState('')
  const loadLogs = useCallback(async (signal: AbortSignal) => {
    setLogs(null)
    const r = await getJson(`${apiBase}/logs?service=${encodeURIComponent(body.name)}&count=20`, signal)
    if (signal.aborted) return
    if (r.kind === 'error') setLogs({ lines: [], error: r.reason })
    else setLogs({ lines: Array.isArray(r.value?.logs) ? r.value.logs.slice(0, 20) : [], error: typeof r.value?.error === 'string' ? r.value.error : '' })
  }, [apiBase, body.name])
  useEffect(() => {
    const ctl = new AbortController()
    void loadLogs(ctl.signal)
    setArmed(false)
    setAction('')
    return () => ctl.abort()
  }, [loadLogs])
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 6000)
    return () => window.clearTimeout(t)
  }, [armed])

  const restart = async () => {
    if (!armed) return setArmed(true)
    setArmed(false)
    setAction('restarting…')
    try {
      const res = await fetch(`${apiBase}/services/restart`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: body.name }),
      })
      const j = await res.json().catch(() => null)
      setAction(res.ok && j?.success !== false ? `restart sent: ${j?.message ?? 'ok'}` : `restart refused: HTTP ${res.status}${j?.error ? ` — ${j.error}` : ''}`)
    } catch (e) {
      setAction(`restart failed: ${(e as Error).message}`)
    }
  }

  const now = Date.now()
  void tick
  const events = activity.recent.get(body.id) ?? []
  const alert = activity.alerts.get(body.id)
  const name = (id: string) => topo.bodies.get(id)?.name ?? id
  const section = { fontSize: 11, fontWeight: 600, letterSpacing: '.06em', color: '#7d8ba1', margin: '12px 0 4px' } as const

  return (
    <aside
      data-testid="neuralnet-inspector"
      style={{
        position: 'absolute', zIndex: 20, overflow: 'auto', background: 'rgba(8,10,16,.94)',
        border: '1px solid rgba(255,255,255,.1)', color: '#e2e8f0', fontSize: 13, padding: 14,
        ...(compact
          ? { left: 0, right: 0, bottom: 0, maxHeight: '55%', borderRadius: '14px 14px 0 0' }
          : { top: 12, right: 12, bottom: 12, width: 320, borderRadius: 12 }),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{body.name}</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            {body.layer} · {body.layerName}{body.port ? ` · :${body.port}` : ''} · {body.criticality}{body.gpu ? ' · GPU' : ''}
          </div>
        </div>
        <button className="nn-btn" onClick={onClose} aria-label="Close inspector">Close</button>
      </div>
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: 5, background: HEALTH_COLOR[health], display: 'inline-block' }} />
        <span>{health}</span>
        {alert && <span style={{ color: '#fca5a5' }}>· Watch: {alert.summary}</span>}
      </div>
      {body.role && <div style={{ marginTop: 6, color: '#cbd5e1' }}>{body.role}</div>}

      {canOperate && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          <button className={`nn-btn nn-danger${armed ? ' nn-armed' : ''}`} onClick={restart}>
            {armed ? 'Confirm restart' : 'Restart'}
          </button>
          <button className="nn-btn" onClick={() => void loadLogs(new AbortController().signal)}>Refresh logs</button>
        </div>
      )}
      {action && <div style={{ marginTop: 6, fontSize: 12, color: '#cbd5e1' }}>{action}</div>}

      <div style={section}>DEPENDS ON ({body.deps.length})</div>
      <div>{body.deps.length ? body.deps.map((d) => <button key={d} className="nn-tag" onClick={() => onPick(d)}>{name(d)}</button>) : <span style={{ color: '#64748b' }}>nothing</span>}</div>
      <div style={section}>REQUIRED BY ({body.dependents.length})</div>
      <div>{body.dependents.length ? body.dependents.map((d) => <button key={d} className="nn-tag" onClick={() => onPick(d)}>{name(d)}</button>) : <span style={{ color: '#64748b' }}>nothing</span>}</div>

      <div style={section}>LIVE EVENTS</div>
      {events.length === 0
        ? <div style={{ color: '#64748b' }}>none since this window opened</div>
        : events.map((e: NeuralEvent) => (
            <div key={e.id + e.ts} style={{ fontSize: 12, padding: '2px 0', color: e.severity === 'error' || e.severity === 'critical' ? '#fca5a5' : '#cbd5e1' }}>
              <span style={{ color: '#64748b' }}>{timeAgo(e.ts, now)} {e.source}</span> {e.summary || e.kind}
            </div>
          ))}

      <div style={section}>CHRONICLE</div>
      {logs === null
        ? <div style={{ color: '#64748b' }}>reading…</div>
        : logs.error
          ? <div style={{ color: '#fca5a5', fontSize: 12 }}>{logs.error}</div>
          : logs.lines.length === 0
            ? <div style={{ color: '#64748b' }}>Chronicle holds no lines for {body.name}</div>
            : logs.lines.map((l, i) => (
                <div key={i} style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', padding: '1px 0', color: l.level === 'error' || l.level === 'critical' ? '#fca5a5' : l.level === 'warning' ? '#fde68a' : '#cbd5e1' }}>
                  {String(l.timestamp).slice(11, 19)} {l.message}
                </div>
              ))}
    </aside>
  )
}

export default function NeuralNetPanel({ apiBase = '/api', canOperate = false, initialView = 'brain' }: NeuralNetPanelProps) {
  const [topo, setTopo] = useState<Topology | null>(null)
  const [topoNote, setTopoNote] = useState('')
  const [topoError, setTopoError] = useState('')
  const [health, setHealth] = useState<Map<string, HealthState>>(new Map())
  const [healthNote, setHealthNote] = useState('')
  const [view, setView] = useState<NeuralView>(initialView)
  const [stream, setStream] = useState<StreamState>({ state: 'connecting', note: '' })
  const [selected, setSelected] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [tick, setTick] = useState(0)
  const [size, setSize] = useState({ w: 1024, h: 768 })
  const compact = size.w < 640
  const compactRef = useRef(compact)
  useLayoutEffect(() => { compactRef.current = compact }, [compact])

  const rootRef = useRef<HTMLDivElement | null>(null)
  const fieldRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<BeadSpaceHandle | null>(null)
  const [activity] = useState(() => new NeuralActivity())
  const [coalescer] = useState(() => new Coalescer(500, 24))
  const [fxQueue] = useState(() => new FxQueue(3000, 5))
  const viewRef = useRef(view)
  const topoRef = useRef<Topology | null>(null)
  const classesRef = useRef<Map<string, string>>(new Map())
  const lastVersion = useRef(-1)
  const lastPushed = useRef('')

  // ── reads ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const ctl = new AbortController()
    void loadTopology(apiBase, ctl.signal).then((r) => {
      if (ctl.signal.aborted) return
      if (r.kind === 'ok') {
        setTopo(r.value)
        setTopoNote(r.note ?? '')
      } else setTopoError(r.reason)
    })
    return () => ctl.abort()
  }, [apiBase])

  useEffect(() => {
    if (!topo) return
    const ctl = new AbortController()
    let last = ''
    const poll = async () => {
      const r = await getJson(`${apiBase}/services/health`, ctl.signal)
      if (ctl.signal.aborted) return
      if (r.kind === 'error' || r.value?.success === false) {
        setHealthNote(`health unknown: ${r.kind === 'error' ? r.reason : r.value?.error ?? 'reported a failure'}`)
        return
      }
      const map = healthMap(topo, Array.isArray(r.value?.services) ? r.value.services : [])
      const text = JSON.stringify([...map])
      setHealthNote(map.size ? '' : 'health: no row named a service on this map')
      if (text !== last) {
        last = text
        setHealth(map)
      }
    }
    void poll()
    const t = window.setInterval(poll, HEALTH_POLL_MS)
    return () => { ctl.abort(); window.clearInterval(t) }
  }, [apiBase, topo])

  // ── the engine (ONE instance per topology) ──────────────────────────────────
  const nodes = useMemo(() => (topo ? toBeadNodes(topo, health) : []), [topo, health])
  const nodesRef = useRef(nodes)
  const healthRef = useRef(health)
  // The engine's callbacks read these; sync them before any effect below runs.
  useLayoutEffect(() => {
    viewRef.current = view
    topoRef.current = topo
    nodesRef.current = nodes
    healthRef.current = health
  }, [view, topo, nodes, health])

  /**
   * Feed the engine. `linksOk` false = activity-driven refresh inside the link cooldown:
   * classes still move (cheap), links wait for the next allowed tick.
   */
  const lastLinkPush = useRef(0)
  const lastRender = useRef(0)
  const selectedRef = useRef<string | null>(null)
  useLayoutEffect(() => { selectedRef.current = selected }, [selected])
  const linksPending = useRef(false)
  const push = useCallback((linksOk = true) => {
    const h = handleRef.current
    const t = topoRef.current
    if (!h || !t) return
    const now = Date.now()
    const proj = projectView(viewRef.current, t, healthRef.current, activity, now)
    const prevClasses = classesRef.current
    classesRef.current = proj.classes
    const sig = signature(viewRef.current, nodesRef.current, proj)
    linksPending.current = sig !== lastPushed.current && !linksOk
    if (sig !== lastPushed.current && linksOk) {
      lastPushed.current = sig
      lastLinkPush.current = now
      h.update({ nodes: nodesRef.current, links: proj.links })
      return
    }
    applyClasses(fieldRef.current, prevClasses, proj.classes)
  }, [activity])

  useEffect(() => {
    const el = fieldRef.current
    if (!el || !topo) return
    const now = Date.now()
    const proj = projectView(viewRef.current, topo, healthRef.current, activity, now)
    classesRef.current = proj.classes
    // The stack as rings, pinned: no force settle, and no view switch can move a body.
    const rings = ringLayout(topo)
    const handle = createBeadSpace(el, { nodes: nodesRef.current, links: proj.links }, {
      assetRoot: '/assets/kenney-simple-space',
      clusterOrder: topo.layers.map((l) => l.id),
      fixedPosition: (n: BeadNode) => rings.get(n.id) ?? null,
      scaleExtent: [0.12, 6],
      starfield: true,
      parallax: false,
      wheelZoom: true,
      tooltips: false,
      labelCollision: true,
      labelsAlwaysBelow: 2000,
      // A phone labels only the hubs (>= 5 dependents): text is the costliest thing in the
      // field to repaint, and at a phone's fit zoom leaf labels collide away anyway. Tap any
      // body for its name.
      nodeLabel: (n: BeadNode) => {
        const b = topoRef.current?.bodies.get(n.id)
        if (compactRef.current && b && b.dependents.length < 5) return ''
        return bodyLabel(viewRef.current, b, n.title)
      },
      nodeRadius: (n: BeadNode) => {
        const b = topoRef.current?.bodies.get(n.id)
        return b ? bodyRadius(b) : null
      },
      nodeColor: (n: BeadNode) => HEALTH_COLOR[(healthRef.current.get(n.id) ?? 'unknown') as HealthState],
      nodeClass: (n: BeadNode) => classesRef.current.get(n.id) ?? null,
      onSelect: (n: BeadNode | null) => {
        setMenu(null)
        setSelected(n ? n.id : null)
      },
      onContextMenu: (n: BeadNode, at: { clientX: number; clientY: number }) => {
        const box = rootRef.current?.getBoundingClientRect()
        setMenu({ id: n.id, x: at.clientX - (box?.left ?? 0), y: at.clientY - (box?.top ?? 0) })
      },
    })
    handleRef.current = handle
    lastPushed.current = signature(viewRef.current, nodesRef.current, proj)
    return () => {
      handle.destroy()
      handleRef.current = null
    }
  }, [topo, activity])

  // Health or view changed -> same bodies, new colours/links/classes.
  useEffect(() => { push() }, [nodes, view, push])

  // Activity -> classes/links at most once a second (a burst cannot thrash update()).
  useEffect(() => {
    const t = window.setInterval(() => {
      const now = Date.now()
      activity.prune(now)
      if (activity.version !== lastVersion.current || viewRef.current === 'traffic' || linksPending.current) {
        lastVersion.current = activity.version
        // Links move with activity only in Traffic/Health; a phone re-links at most every 5 s.
        push(now - lastLinkPush.current >= (compactRef.current ? 5_000 : 2_000))
      }
      // Re-render only what reads the clock: the open inspector every second, the event
      // counter every 5 s. A whole-panel render per second was measurable on a phone.
      if (selectedRef.current || now - lastRender.current >= 5_000) {
        lastRender.current = now
        setTick((x) => x + 1)
      }
    }, CLASS_TICK_MS)
    return () => window.clearInterval(t)
  }, [activity, push])

  // ── the stream ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!topo) return
    const url = `${apiBase}/universe/stream`
    let es: EventSource | null = null
    let alive = true
    let lastFrame = 0
    let shownLive = false
    const onFrame = (m: MessageEvent) => {
      lastFrame = Date.now()
      if (!shownLive) {
        shownLive = true
        setStream({ state: 'live', note: '' })
      }
      let raw: unknown
      try { raw = JSON.parse(m.data) } catch { return }
      const ev = parseNeuralEvent(raw)
      const t = topoRef.current
      if (!ev || !t) return
      const now = Date.now()
      const effects = effectsFor(ev, t)
      activity.apply(ev, effects, now)
      const h = handleRef.current
      if (!h) return
      for (const e of effects) {
        if (e.type === 'alert') continue // a ring is state: the 1 s class tick draws it
        // A phone fires in waves (FxQueue); a desktop fires as events land, coalesced.
        if (compactRef.current) fxQueue.push(e)
        else if (coalescer.admit(effectKey(e), now)) fire(h, e, false)
      }
    }
    const wave = window.setInterval(() => {
      const h = handleRef.current
      if (!h || document.hidden) return
      for (const e of fxQueue.take(Date.now())) fire(h, e, true)
    }, 250)
    if (typeof EventSource === 'undefined') {
      setStream({ state: 'down', note: 'this browser has no EventSource' })
      return () => window.clearInterval(wave)
    }
    es = new EventSource(url, { withCredentials: true })
    es.onopen = () => {
      if (!alive) return
      shownLive = true
      setStream({ state: 'live', note: '' })
    }
    es.addEventListener('universe', onFrame as EventListener)
    es.onmessage = onFrame
    es.onerror = () => {
      if (!alive || !es) return
      if (es.readyState !== EventSource.CLOSED) {
        // A proxy that cycles the connection is still live if frames keep arriving.
        if (Date.now() - lastFrame > 10_000) {
          shownLive = false
          setStream({ state: 'connecting', note: 'stream dropped — reconnecting' })
        }
        return
      }
      shownLive = false
      // CLOSED: ask once why (EventSource hides the status).
      void fetch(url, { credentials: 'include', headers: { Accept: 'text/event-stream' }, signal: AbortSignal.timeout?.(5000) })
        .then((r) => {
          void r.body?.cancel()
          if (alive) setStream({ state: 'down', note: r.ok ? 'stream closed by the server' : `${url} → HTTP ${r.status}` })
        })
        .catch(() => alive && setStream({ state: 'down', note: `${url} did not answer` }))
    }
    return () => { alive = false; es?.close(); window.clearInterval(wave) }
  }, [apiBase, topo, activity, coalescer, fxQueue])

  // ── layout ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }))
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [])

  const pick = (id: string) => {
    setMenu(null)
    setSelected(id)
    handleRef.current?.select(id)
    void handleRef.current?.flyTo(id, { scale: 2.2 })
  }
  const runMenu = (act: 'inspect' | 'deps' | 'health' | 'copy', id: string) => {
    if (act === 'copy') {
      void navigator.clipboard?.writeText(topoRef.current?.bodies.get(id)?.name ?? id)
      setMenu(null)
      return
    }
    if (act === 'deps') setView('brain')
    if (act === 'health') setView('health')
    pick(id)
  }
  const close = () => {
    setSelected(null)
    handleRef.current?.select(null)
  }

  const counts = useMemo(() => {
    const c: Record<HealthState, number> = { ok: 0, degraded: 0, down: 0, starting: 0, parked: 0, unknown: 0 }
    if (topo) for (const id of topo.bodies.keys()) c[health.get(id) ?? 'unknown']++
    return c
  }, [topo, health])

  const body = selected && topo ? topo.bodies.get(selected) : undefined
  const menuBody = menu && topo ? topo.bodies.get(menu.id) : undefined
  const viewHint = VIEWS.find((v) => v.id === view)?.hint ?? ''
  const trafficEmpty = view === 'traffic' && topo && activity.trafficEdges(Date.now()).length === 0
  const streamColor = stream.state === 'live' ? '#4ADE80' : stream.state === 'connecting' ? '#FBBF24' : '#F87171'

  return (
    <div
      ref={rootRef}
      data-testid="neuralnet"
      data-view={view}
      className={`nn-root nn-view-${view}${compact ? ' bs-lowfx' : ''}`}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#050507', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}
      onClick={() => menu && setMenu(null)}
    >
      <style>{STYLE}</style>
      {/* Fixed height, never wraps: the field's size must not change with a label. */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', height: 52, flexWrap: 'nowrap', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        {!compact && <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, flexShrink: 0 }}>NeuralNet</h2>}
        <div role="group" aria-label="View" style={{ display: 'flex', gap: 6, overflowX: 'auto', minWidth: 0, flex: '0 1 auto' }}>
          {VIEWS.map((v) => (
            <button key={v.id} className="nn-chip" aria-pressed={view === v.id} title={v.hint} onClick={() => setView(v.id)} data-testid={`nn-view-${v.id}`}>
              {v.label}
            </button>
          ))}
        </div>
        <div data-testid="nn-stream" title={stream.note || stream.state} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: streamColor, display: 'inline-block', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {stream.state === 'live' ? (compact ? 'live' : `live · ${activity.total} events`) : stream.state === 'connecting' ? 'connecting…' : `stream down — ${stream.note}`}
          </span>
        </div>
      </header>
      {/* ONE line, fixed height: a hint that wraps on a phone would resize the field and
          re-centre every pinned body on a view switch. */}
      <div style={{ padding: '0 12px', height: 26, lineHeight: '26px', fontSize: 12, color: '#94a3b8', display: 'flex', gap: 12, flexWrap: 'nowrap', overflow: 'hidden', whiteSpace: 'nowrap' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: '0 1 auto' }}>{viewHint}</span>
        {topo && (
          <span data-testid="nn-counts">
            {topo.bodies.size} services · <span style={{ color: HEALTH_COLOR.ok }}>{counts.ok} ok</span>
            {counts.degraded ? <> · <span style={{ color: HEALTH_COLOR.degraded }}>{counts.degraded} degraded</span></> : null}
            {counts.down ? <> · <span style={{ color: HEALTH_COLOR.down }}>{counts.down} down</span></> : null}
            {counts.unknown ? <> · {counts.unknown} unknown</> : null}
          </span>
        )}
        {topoNote && <span style={{ color: '#fde68a' }}>{topoNote}</span>}
        {healthNote && <span style={{ color: '#fde68a' }}>{healthNote}</span>}
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {!topo && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: topoError ? '#fca5a5' : '#64748b', padding: 24, textAlign: 'center', fontSize: 14 }}>
            {topoError ? `The service map could not be read: ${topoError}` : 'Reading the Registry stack map…'}
          </div>
        )}
        {/* Own compositor layer: chrome animating elsewhere on the page never repaints the field. */}
        <div ref={fieldRef} data-testid="nn-field" className="nn-field" style={{ position: 'absolute', inset: 0 }} />
        {trafficEmpty && (
          <div style={{ position: 'absolute', top: 12, left: 12, right: 12, textAlign: 'center', fontSize: 12, color: '#94a3b8', pointerEvents: 'none' }}>
            No packets in the last minute{stream.state !== 'live' ? ` (stream ${stream.state})` : ''}.
          </div>
        )}
        {menu && menuBody && (
          <div
            role="menu"
            data-testid="nn-menu"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', zIndex: 30, left: Math.max(8, Math.min(menu.x, size.w - 200)),
              top: Math.max(8, Math.min(menu.y - 60, size.h - 260)), width: 190,
              background: 'rgba(12,14,22,.97)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: 6,
            }}
          >
            <div style={{ padding: '4px 8px 6px', fontSize: 12, color: '#94a3b8' }}>
              {menuBody.name} · {menuBody.layer} · {health.get(menuBody.id) ?? 'unknown'}
            </div>
            {([
              ['inspect', 'Inspect'],
              ['deps', `Dependencies (${menuBody.deps.length}/${menuBody.dependents.length})`],
              ['health', 'Show in Health'],
              ['copy', 'Copy name'],
            ] as const).map(([act, label]) => (
              <button key={act} role="menuitem" className="nn-btn" style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 4, border: 'none' }} onClick={() => runMenu(act, menuBody.id)}>
                {label}
              </button>
            ))}
            {canOperate && (
              <button role="menuitem" className="nn-btn nn-danger" style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 4 }} onClick={() => runMenu('inspect', menuBody.id)}>
                Restart…
              </button>
            )}
          </div>
        )}
        {body && topo && (
          <Inspector
            body={body}
            health={health.get(body.id) ?? 'unknown'}
            topo={topo}
            activity={activity}
            apiBase={apiBase}
            canOperate={canOperate}
            tick={tick}
            onPick={pick}
            onClose={close}
            compact={compact}
          />
        )}
      </div>
    </div>
  )
}
