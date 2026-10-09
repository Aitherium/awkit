/**
 * Iris pipeline runs always END, and end honestly (2026-10-08, a browser-only tenant deployment).
 *
 * Pins: a video brief on a deployment with no GPU media backend is refused UP FRONT with
 * the reason and alternatives; a stream that finishes every step with no artifact is
 * `empty`, never success; an `error` event, a non-2xx, a closed body and a silent server
 * all resolve to a terminal state (the idle watchdog), so no spinner can outlive the run;
 * a failed step is `failed`, not "completed"; the iris-core mirror cannot drift.
 */
import * as fs from 'fs'
import * as path from 'path'

import { describe, expect, it } from 'vitest'

import {
  assessPipelineResult, capabilityGap, inferCreativeKind, probeCreativeCapabilities,
  runPipelineStream, stepStatus, templateIdForKind,
  type CreativeCapabilities,
} from '../pipeline-run'

const UP = { up: true }
const DOWN = (reason: string) => ({ up: false, reason })

/** A Response-like object whose body yields the given SSE chunks, then closes (or hangs). */
function sseResponse(chunks: string[], opts: { hang?: boolean; status?: number; json?: unknown } = {}) {
  const enc = new TextEncoder()
  let i = 0
  const status = opts.status ?? 200
  return {
    ok: status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? (opts.json ? 'application/json' : 'text/event-stream') : null) },
    json: async () => opts.json,
    text: async () => JSON.stringify({ detail: 'Bad Gateway' }),
    body: {
      getReader: () => ({
        read: () => {
          if (i < chunks.length) return Promise.resolve({ done: false, value: enc.encode(chunks[i++]) })
          if (opts.hang) return new Promise(() => { /* the server went silent */ })
          return Promise.resolve({ done: true, value: undefined })
        },
        cancel: async () => undefined,
      }),
    },
  } as unknown as Response
}

const data = (o: unknown) => `data: ${JSON.stringify(o)}\r\n\r\n`

/**
 * fetch that rejects with AbortError when its signal fires — what a real fetch does.
 * The hanging-body case is covered by the reader: `read()` never settles, so the
 * watchdog must abort and the run must still resolve.
 */
function fetchReturning(res: Response): typeof fetch {
  return (async () => res) as unknown as typeof fetch
}

describe('inferCreativeKind', () => {
  it('reads the prospect\'s two asks correctly', () => {
    expect(inferCreativeKind('make a video of 12 Main St, Springfield')).toBe('video')
    expect(inferCreativeKind('make a web page for my bakery')).toBe('page')
    expect(inferCreativeKind('a website with a video embed')).toBe('page')
    expect(inferCreativeKind('a logo for my shop')).toBe('image')
    expect(inferCreativeKind('anything', 'video')).toBe('video')
  })

  it('maps kinds to real template ids', () => {
    expect(templateIdForKind('video')).toBe('video-production')
    expect(templateIdForKind('page')).toBe('landing-page')
  })
})

describe('capabilityGap', () => {
  const browserOnly: CreativeCapabilities = {
    iris: DOWN('Iris is not part of this deployment.'),
    media: DOWN('The GPU media backend is not part of this deployment.'),
  }

  it('refuses a video with no GPU media backend, naming why and what works instead', () => {
    const gap = capabilityGap('video', browserOnly)
    expect(gap).not.toBeNull()
    expect(gap!.reason).toMatch(/Video generation needs a GPU media backend/)
    expect(gap!.reason).toMatch(/Nothing was started/)
    expect(gap!.alternatives.join(' ')).toMatch(/storyboard/i)
  })

  it('refuses a video when Iris is up but media is not', () => {
    expect(capabilityGap('video', { iris: UP, media: DOWN('down') })).not.toBeNull()
  })

  it('refuses a page when Iris is absent, and allows it when Iris is up', () => {
    expect(capabilityGap('page', browserOnly)!.reason).toMatch(/cannot build a web page/)
    expect(capabilityGap('page', { iris: UP, media: DOWN('x') })).toBeNull()
    expect(capabilityGap('video', { iris: UP, media: UP })).toBeNull()
  })
})

describe('probeCreativeCapabilities', () => {
  it('reads a static portal (404 everywhere) as "not part of this deployment"', async () => {
    const f = (async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch
    const caps = await probeCreativeCapabilities({ fetchFn: f })
    expect(caps.iris.up).toBe(false)
    expect(caps.iris.reason).toMatch(/not part of this deployment/)
    expect(caps.media.up).toBe(false)
  })

  it('reads Veil\'s parked-Iris 503 and a healthy media-forge', async () => {
    const f = (async (url: string) => url.includes('/api/iris/')
      ? { ok: false, status: 503, json: async () => ({ up: false }) }
      : { ok: true, status: 200, json: async () => ({ ok: true }) }) as unknown as typeof fetch
    const caps = await probeCreativeCapabilities({ fetchFn: f })
    expect(caps.iris.up).toBe(false)
    expect(caps.media.up).toBe(true)
  })

  it('never throws on a network failure', async () => {
    const f = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
    const caps = await probeCreativeCapabilities({ fetchFn: f })
    expect(caps.iris.up).toBe(false)
    expect(caps.iris.reason).toMatch(/did not answer/)
  })
})

describe('runPipelineStream', () => {
  it('8 steps done with NO artifact is empty with the reason, not success', async () => {
    const chunks = [
      ...Array.from({ length: 8 }, (_, i) => data({ type: 'step_complete', step_index: i, step: { status: 'completed' } })),
      data({ type: 'done', credits_charged: 0 }),
    ]
    const events: string[] = []
    const out = await runPipelineStream({
      url: '/api/iris/pipeline', body: {}, kind: 'video',
      fetchFn: fetchReturning(sseResponse(chunks)), onEvent: (e) => events.push(e.type),
    })
    expect(events.filter(t => t === 'step_complete')).toHaveLength(8)
    expect(out.state).toBe('empty')
    expect(out.reason).toMatch(/no video/i)
    expect(out.reason).toMatch(/GPU media backend/)
  })

  it('a failed step surfaces the server\'s words', async () => {
    const out = await runPipelineStream({
      url: '/x', body: {}, kind: 'video',
      fetchFn: fetchReturning(sseResponse([
        data({ type: 'step_complete', step_index: 1, step: { status: 'failed', error: 'no video backend available' } }),
        data({ type: 'done', ok: false, produced: 0 }),
      ])),
    })
    expect(out.state).toBe('empty')
    expect(out.failures).toEqual(['no video backend available'])
    expect(out.reason).toMatch(/no video backend available/)
  })

  it('an artifact makes it completed', async () => {
    const out = await runPipelineStream({
      url: '/x', body: {},
      fetchFn: fetchReturning(sseResponse([
        data({ type: 'artifact', artifact: { type: 'image', label: 'hero', url: '/media/h.png' } }),
        data({ type: 'done', ok: true, produced: 1 }),
      ])),
    })
    expect(out.state).toBe('completed')
    expect(out.artifacts[0].url).toBe('/media/h.png')
  })

  it('an error event is terminal and failed', async () => {
    const out = await runPipelineStream({
      url: '/x', body: {},
      fetchFn: fetchReturning(sseResponse([data({ type: 'error', error: 'billing is unavailable right now' })], { hang: true })),
    })
    expect(out.state).toBe('failed')
    expect(out.reason).toBe('billing is unavailable right now')
  })

  it('a parked Iris (502) fails with a sentence, no simulated steps', async () => {
    const events: string[] = []
    const out = await runPipelineStream({
      url: '/x', body: {}, onEvent: (e) => events.push(e.type),
      fetchFn: fetchReturning(sseResponse([], { status: 502 })),
    })
    expect(out.state).toBe('failed')
    expect(out.reason).toMatch(/not running here/)
    expect(events).toEqual([])
  })

  it('a body that closes without done is failed, not success', async () => {
    const out = await runPipelineStream({
      url: '/x', body: {},
      fetchFn: fetchReturning(sseResponse([data({ type: 'step_start', step_index: 0 })])),
    })
    expect(out.state).toBe('failed')
    expect(out.reason).toMatch(/closed before it finished/)
  })

  it('a server that goes silent is stopped by the idle watchdog', async () => {
    const started = Date.now()
    const out = await runPipelineStream({
      url: '/x', body: {}, idleMs: 50,
      fetchFn: fetchReturning(sseResponse([data({ type: 'step_start', step_index: 0 })], { hang: true })),
    })
    expect(out.state).toBe('timeout')
    expect(out.reason).toMatch(/stopped sending progress/)
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('a fetch that never answers is stopped by the watchdog too', async () => {
    const f = ((_u: string, init?: RequestInit) => new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
    })) as unknown as typeof fetch
    const out = await runPipelineStream({ url: '/x', body: {}, idleMs: 30, fetchFn: f })
    expect(out.state).toBe('timeout')
  })
})

describe('assessPipelineResult (stream:false)', () => {
  it('reads Iris\'s real `results` key, and all-errors is not success', () => {
    const out = assessPipelineResult({ success: true, results: [{ error: 'no video backend' }] }, 'video')
    expect(out.state).toBe('empty')
    expect(out.reason).toMatch(/no video backend/)
  })

  it('success:false is failed with the server error', () => {
    const out = assessPipelineResult({ success: false, error: 'No asset was produced' })
    expect(out.state).toBe('failed')
    expect(out.reason).toBe('No asset was produced')
  })

  it('a produced file is completed', () => {
    const out = assessPipelineResult({ success: true, results: [{ file_path: '/out/a.png' }] })
    expect(out.state).toBe('completed')
  })
})

describe('stepStatus', () => {
  it('never turns a failed step into completed', () => {
    expect(stepStatus({ type: 'step_complete', step: { status: 'failed' } })).toBe('failed')
    expect(stepStatus({ type: 'step_complete', step: { error: 'x' } })).toBe('failed')
    expect(stepStatus({ type: 'step_complete', step: { status: 'completed' } })).toBe('completed')
    expect(stepStatus({ type: 'step_start' })).toBe('running')
  })
})

describe('the iris-core mirror', () => {
  it('is byte-identical to this module (iris-core cannot import awkit)', () => {
    const here = fs.readFileSync(path.join(__dirname, '..', 'pipeline-run.ts'), 'utf8')
    const mirror = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', '..', '..', 'iris-core', 'src', 'pipeline-run.ts'), 'utf8')
    expect(mirror).toBe(here)
  })
})

describe('no simulated pipeline survives in either Design Studio', () => {
  it('neither copy fakes step completion', () => {
    const root = path.join(__dirname, '..', '..', '..', '..', '..', '..')
    for (const rel of [
      path.join('packages', 'iris-core', 'src', 'iris-design-studio.tsx'),
      path.join('AitherVeil', 'src', 'components', 'iris', 'iris-design-studio.tsx'),
    ]) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8')
      expect(src).not.toMatch(/simulatePipeline/)
      expect(src).toMatch(/runPipelineStream/)
      expect(src).toMatch(/finally \{\s*setIsRunning\(false\)/)
    }
  })
})
