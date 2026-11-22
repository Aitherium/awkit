/**
 * NeuralNet pure mapping: stack map -> bodies, event -> pulse/packet/ring, coalescing,
 * and the view projections (same bodies in every view, so no relayout on a switch).
 */
import {
  Coalescer,
  effectKey,
  effectsFor,
  fromServicesYaml,
  fromStackGraph,
  healthMap,
  layerAnchors,
  NeuralActivity,
  parseNeuralEvent,
  projectView,
  resolveBody,
  ringLayout,
  bodyRadius,
  FxQueue,
  toBeadNodes,
  trafficKind,
  TRAFFIC_WINDOW_MS,
  type StackGraphRecord,
} from '../neuralnet/model'

const GRAPH: StackGraphRecord = {
  layers: [
    { id: 'L0', rank: 0, name: 'Substrate' },
    { id: 'L1', rank: 1, name: 'Kernel' },
    { id: 'L3', rank: 3, name: 'Telemetry' },
  ],
  nodes: [
    { key: 'postgres', layer: 'L0', rank: 0, registry: ['Postgres'], container: 'aitheros-postgres', criticality: 'core' },
    { key: 'genesis', layer: 'L1', rank: 1, registry: ['Genesis'], container: 'aitheros-genesis', criticality: 'core', port: '8001' },
    { key: 'microscheduler', layer: 'L1', rank: 1, registry: ['MicroScheduler'], unit: 'aither-microscheduler.service' },
    { key: 'pulse', layer: 'L3', rank: 3, registry: ['Pulse'] },
    { key: 'chronicle', layer: 'L3', rank: 3, registry: ['Chronicle'] },
  ],
  edges: [
    { from: 'genesis', to: 'postgres' },
    { from: 'genesis', to: 'pulse' },
    { from: 'genesis', to: 'chronicle' },
    { from: 'microscheduler', to: 'genesis' },
    { from: 'microscheduler', to: 'pulse' },
    { from: 'microscheduler', to: 'ghost' }, // unknown target is dropped, never invented
  ],
}

describe('stack map -> bodies', () => {
  const topo = fromStackGraph(GRAPH)

  it('ids bodies by their services.yaml key, as the universe stream does', () => {
    expect([...topo.bodies.keys()].sort()).toEqual(['svc:Chronicle', 'svc:Genesis', 'svc:MicroScheduler', 'svc:Postgres', 'svc:Pulse'])
    expect(topo.source).toBe('registry')
    expect(topo.bodies.get('svc:Genesis')!.layerName).toBe('Kernel')
  })

  it('counts dependents and drops edges to services not on the map', () => {
    expect(topo.edges).toHaveLength(5)
    expect(topo.bodies.get('svc:Genesis')!.dependents).toEqual(['svc:MicroScheduler'])
    expect(topo.bodies.get('svc:Pulse')!.dependents.sort()).toEqual(['svc:Genesis', 'svc:MicroScheduler'])
    expect(topo.bodies.get('svc:MicroScheduler')!.deps).toEqual(['svc:Genesis', 'svc:Pulse'])
  })

  it('resolves every spelling an event uses', () => {
    for (const raw of ['svc:Genesis', 'Genesis', 'AitherGenesis', 'aitheros-genesis', 'genesis', 'svc:genesis']) {
      expect(resolveBody(topo, raw)).toBe('svc:Genesis')
    }
    expect(resolveBody(topo, 'aither-microscheduler.service')).toBe('svc:MicroScheduler')
    expect(resolveBody(topo, 'model:deepseek')).toBeNull()
    expect(resolveBody(topo, 'svc:Nope')).toBeNull()
  })

  it('orders layers by rank and anchors L0 at twelve o\'clock', () => {
    expect(topo.layers.map((l) => l.id)).toEqual(['L0', 'L1', 'L3'])
    const a = layerAnchors(topo.layers)
    expect(a.L0[0]).toBeCloseTo(0.5)
    expect(a.L0[1]).toBeLessThan(0.5)
  })

  it('maps health rows and paints status from them; unknown is never healthy', () => {
    const h = healthMap(topo, [
      { name: 'Genesis', status: 'online' },
      { name: 'AitherPulse', status: 'offline' },
      { name: 'NotOnMap', status: 'online' },
    ])
    expect(h.get('svc:Genesis')).toBe('ok')
    expect(h.get('svc:Pulse')).toBe('down')
    expect(h.size).toBe(2)
    const nodes = toBeadNodes(topo, h)
    const by = new Map(nodes.map((n) => [n.id, n]))
    expect(by.get('svc:Pulse')!.status).toBe('blocked')
    expect(by.get('svc:Postgres')!.status).toBe('deferred')
    expect(by.get('svc:Genesis')!.cluster).toBe('L1')
    // No body is ever `in_progress`: that would spawn an animated station per service.
    expect(nodes.some((n) => n.status === 'in_progress')).toBe(false)
  })

  it('falls back to services.yaml layers and deps', () => {
    const y = fromServicesYaml([
      { name: 'Genesis', layer: 1, depends_on: ['Postgres'] },
      { name: 'Postgres', layer: 0 },
      { name: 'Off', layer: 2, enabled: false },
    ])
    expect(y.source).toBe('services.yaml')
    expect([...y.bodies.keys()].sort()).toEqual(['svc:Genesis', 'svc:Postgres'])
    expect(y.edges).toEqual([{ from: 'svc:Genesis', to: 'svc:Postgres' }])
  })
})

describe('event -> effect', () => {
  const topo = fromStackGraph(GRAPH)
  const ev = (raw: Record<string, unknown>) => parseNeuralEvent({ ts: '2026-11-07T10:00:00Z', summary: 's', ...raw })!

  it('parses the wire shape and drops junk', () => {
    expect(parseNeuralEvent(null)).toBeNull()
    expect(parseNeuralEvent({ source: 'pulse' })).toBeNull()
    const e = ev({ source: 'MicroScheduler', object_id: 'svc:MicroScheduler', from_object: 'svc:Genesis', to_object: 'model:x', ts: 1_792_730_000 })
    expect(e.source).toBe('microscheduler')
    expect(e.ts).toBe(1_792_730_000_000)
    expect(e.from).toBe('svc:Genesis')
  })

  it('Pulse = heartbeat; a failing Pulse = red', () => {
    expect(effectsFor(ev({ source: 'pulse', object_id: 'svc:Genesis', severity: 'info' }), topo)).toEqual([
      expect.objectContaining({ type: 'heartbeat', body: 'svc:Genesis' }),
    ])
    expect(effectsFor(ev({ source: 'pulse', object_id: 'svc:Genesis', severity: 'error' }), topo)[0].type).toBe('error')
  })

  it('a from/to event is a packet along each resolved hop', () => {
    const fx = effectsFor(ev({ source: 'microscheduler', object_id: 'svc:MicroScheduler', from_object: 'svc:Genesis', to_object: 'model:deepseek' }), topo)
    expect(fx).toEqual([expect.objectContaining({ type: 'packet', from: 'svc:Genesis', to: 'svc:MicroScheduler' })])
  })

  it('Chronicle error = red flash; Chronicle info = faint activity', () => {
    expect(effectsFor(ev({ source: 'chronicle', object_id: 'svc:Genesis', severity: 'error' }), topo)[0]).toMatchObject({ type: 'error', body: 'svc:Genesis' })
    expect(effectsFor(ev({ source: 'chronicle', object_id: 'svc:Genesis', severity: 'info' }), topo)[0]).toMatchObject({ type: 'activity' })
  })

  it('Watch alert = ring on, watch.svc.up = ring off', () => {
    expect(effectsFor(ev({ source: 'watch', kind: 'watch.alert', object_id: 'svc:Pulse', severity: 'warning' }), topo)[0]).toMatchObject({ type: 'alert', on: true, body: 'svc:Pulse' })
    expect(effectsFor(ev({ source: 'watch', kind: 'watch.svc.down', object_id: 'svc:Pulse' }), topo)[0]).toMatchObject({ type: 'alert', on: true })
    expect(effectsFor(ev({ source: 'watch', kind: 'watch.svc.up', object_id: 'svc:Pulse' }), topo)[0]).toMatchObject({ type: 'alert', on: false })
  })

  it('an event about something not on the map does nothing', () => {
    expect(effectsFor(ev({ source: 'github', object_id: 'pr:123' }), topo)).toEqual([])
  })
})

describe('coalescing', () => {
  it('one visual per key per 500 ms', () => {
    const c = new Coalescer(500, 100)
    expect(c.admit('a', 0)).toBe(true)
    expect(c.admit('a', 100)).toBe(false)
    expect(c.admit('b', 100)).toBe(true)
    expect(c.admit('a', 499)).toBe(false)
    expect(c.admit('a', 500)).toBe(true)
    expect(c.dropped).toBe(2)
  })

  it('a burst across many bodies is capped per window', () => {
    const c = new Coalescer(500, 24)
    let admitted = 0
    for (let i = 0; i < 500; i++) if (c.admit(`k${i}`, 10)) admitted++
    expect(admitted).toBe(24)
    expect(c.admit('fresh', 520)).toBe(true)
  })

  it('packets key on the edge, flashes on the body', () => {
    expect(effectKey({ type: 'packet', from: 'a', to: 'b', color: '' })).toBe('p:a>b')
    expect(effectKey({ type: 'error', body: 'a', color: '' })).toBe('error:a')
  })
})

describe('views over the same bodies', () => {
  const topo = fromStackGraph(GRAPH)
  const health = healthMap(topo, [{ name: 'Pulse', status: 'offline' }])

  it('every view keeps the same bodies; only links and classes change', () => {
    const act = new NeuralActivity()
    const nodes = toBeadNodes(topo, health)
    for (const v of ['brain', 'traffic', 'scope', 'health'] as const) {
      const p = projectView(v, topo, health, act, 0)
      expect(p.links.every((l) => topo.bodies.has(l.source) && topo.bodies.has(l.target))).toBe(true)
    }
    expect(toBeadNodes(topo, health)).toEqual(nodes)
  })

  it('Brain = dependency edges; Scope dims leaves', () => {
    const act = new NeuralActivity()
    expect(projectView('brain', topo, health, act, 0).links).toHaveLength(5)
    const scope = projectView('scope', topo, health, act, 0)
    expect(scope.classes.get('svc:MicroScheduler')).toContain('nn-dim') // nothing depends on it
    expect(scope.classes.get('svc:Pulse') ?? '').not.toContain('nn-dim')
  })

  it('Traffic = only edges that carried packets in the last minute, tiered by rate', () => {
    const act = new NeuralActivity()
    const pkt = parseNeuralEvent({ source: 'microscheduler', object_id: 'svc:MicroScheduler', from_object: 'svc:Genesis', ts: 0 })!
    for (let i = 0; i < 12; i++) act.apply(pkt, effectsFor(pkt, topo), 1000 + i)
    const p = projectView('traffic', topo, health, act, 2000)
    expect(p.links).toEqual([{ source: 'svc:Genesis', target: 'svc:MicroScheduler', kind: 'blocks' }])
    expect(p.classes.get('svc:Postgres')).toContain('nn-dim')
    expect(projectView('traffic', topo, health, act, 1000 + TRAFFIC_WINDOW_MS + 50).links).toEqual([])
    expect(trafficKind(1)).toBe('parent-child')
    expect(trafficKind(3)).toBe('related')
  })

  it('Health = sick bodies and who depends on them; the Watch ring shows in every view', () => {
    const act = new NeuralActivity()
    const alert = parseNeuralEvent({ source: 'watch', kind: 'watch.alert', object_id: 'svc:Chronicle', ts: 0 })!
    act.apply(alert, effectsFor(alert, topo), 0)
    const h = projectView('health', topo, health, act, 10)
    const targets = new Set(h.links.map((l) => l.target))
    expect(targets).toEqual(new Set(['svc:Pulse', 'svc:Chronicle'])) // Pulse is down, Chronicle has an alert
    expect(h.classes.get('svc:Postgres')).toContain('nn-dim')
    expect(projectView('brain', topo, health, act, 10).classes.get('svc:Chronicle')).toContain('nn-alert')
    const up = parseNeuralEvent({ source: 'watch', kind: 'watch.svc.up', object_id: 'svc:Chronicle', ts: 0 })!
    act.apply(up, effectsFor(up, topo), 20)
    expect(projectView('brain', topo, health, act, 30).classes.get('svc:Chronicle')).toBeUndefined()
  })

  it('remembers recent events per body, bounded', () => {
    const act = new NeuralActivity()
    const e = parseNeuralEvent({ source: 'pulse', object_id: 'svc:Genesis', ts: 0 })!
    for (let i = 0; i < 40; i++) act.apply(e, effectsFor(e, topo), i)
    expect(act.recent.get('svc:Genesis')).toHaveLength(12)
    expect(act.total).toBe(40)
  })
})

describe('Brain ring layout', () => {
  // A wider stack: 3 layers, 40 bodies, some wiring.
  const nodes = Array.from({ length: 40 }, (_, i) => ({ key: `s${i}`, layer: `L${i % 3}`, rank: i % 3, registry: [`S${i}`] }))
  const edges = nodes.slice(3).map((n, i) => ({ from: n.key, to: nodes[i % 3].key }))
  const topo = fromStackGraph({ layers: [{ id: 'L0' }, { id: 'L1' }, { id: 'L2' }], nodes, edges })
  const pos = ringLayout(topo)

  it('pins every body, one ring per layer, L0 innermost', () => {
    expect(pos.size).toBe(40)
    const radiusOf = (layer: string) => {
      const rs = [...topo.bodies.values()].filter((b) => b.layer === layer).map((b) => Math.hypot(...pos.get(b.id)!))
      expect(Math.max(...rs) - Math.min(...rs)).toBeLessThan(2) // a ring, not a spiral
      return rs[0]
    }
    expect(radiusOf('L0')).toBeLessThan(radiusOf('L1'))
    expect(radiusOf('L1')).toBeLessThan(radiusOf('L2'))
  })

  it('spreads each ring around the whole turn without overlapping bodies', () => {
    for (const layer of ['L0', 'L1', 'L2']) {
      const ring = [...topo.bodies.values()].filter((b) => b.layer === layer)
      const angles = ring.map((b) => Math.atan2(pos.get(b.id)![1], pos.get(b.id)![0])).sort((a, b) => a - b)
      const gaps = angles.map((a, i) => (i ? a - angles[i - 1] : a + 2 * Math.PI - angles[angles.length - 1]))
      expect(Math.max(...gaps)).toBeLessThan(Math.PI / 2)
      for (let i = 0; i < ring.length; i++) {
        for (let j = i + 1; j < ring.length; j++) {
          const [a, b] = [pos.get(ring[i].id)!, pos.get(ring[j].id)!]
          expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThanOrEqual(bodyRadius(ring[i]) + bodyRadius(ring[j]) - 1)
        }
      }
    }
  })

  it('is deterministic', () => {
    expect(ringLayout(topo)).toEqual(pos)
  })
})

describe('phone firing waves', () => {
  it('holds effects until the interval, dedupes, caps, and lets errors in', () => {
    const q = new FxQueue(3000, 3)
    q.push({ type: 'heartbeat', body: 'a', color: '' })
    q.push({ type: 'heartbeat', body: 'a', color: '' })
    q.push({ type: 'heartbeat', body: 'b', color: '' })
    q.push({ type: 'heartbeat', body: 'c', color: '' })
    q.push({ type: 'heartbeat', body: 'd', color: '' }) // over cap: dropped
    q.push({ type: 'error', body: 'e', color: '' }) // an error evicts a heartbeat
    expect(q.size).toBe(3)
    const wave = q.take(5000)
    expect(wave.map((e) => e.type)).toContain('error')
    expect(wave).toHaveLength(3)
    q.push({ type: 'heartbeat', body: 'a', color: '' })
    expect(q.take(6000)).toEqual([]) // within the interval
    expect(q.take(8000)).toHaveLength(1)
  })
})
