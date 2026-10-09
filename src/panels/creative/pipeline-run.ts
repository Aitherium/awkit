/**
 * Iris pipeline runs that always END — and end honestly.
 *
 * Why this file exists (2026-10-08, a paying prospect on a tenant subdomain): the
 * customer asked Iris for "a video of a location". The Design Studio drew its 8-step
 * video template, POSTed `/api/iris/pipeline`, got a non-2xx (Iris is a parked
 * service: no image, unit masked), and then ran a `simulatePipeline()` that ticked
 * every step to 100% on a timer and `return`ed BEFORE `setIsRunning(false)`. The UI
 * read "8/8 steps, 100%" and spun forever with no artifact and no error. A sales demo
 * that lies and then hangs is worse than one that says "not here".
 *
 * Three rules, each a function below, each pinned by a test:
 *
 *   1. Check what this deployment CAN do before planning anything
 *      (`probeCreativeCapabilities` + `capabilityGap`). A video needs a GPU media
 *      backend; a browser running only an on-device model has none, and the answer is
 *      to say so and offer what it can do, not to draw a pipeline.
 *   2. A run is terminal on a `done`/`error` event, on the stream closing, on an HTTP
 *      failure, or on a watchdog — never "whenever the server feels like it"
 *      (`runPipelineStream`).
 *   3. Finishing every step with nothing produced is `empty`, not success, and carries
 *      the reason (`assessPipelineResult`, `finishOutcome`).
 *
 * Pure TypeScript, no React: the awkit IrisPanel and Veil's Iris Design Studio share it.
 * MIRRORED byte-for-byte at packages/iris-core/src/pipeline-run.ts (iris-core cannot
 * depend on awkit); __tests__/pipeline-run.test.ts fails the moment the two drift.
 */

export type CreativeKind = 'video' | 'image' | 'page' | 'copy' | 'deck'

/**
 * What the customer asked for, read from the words they typed (and the output type,
 * when a template or select set one). Order matters: "a web page with a video embed"
 * is a page, so page words win over media words.
 */
export function inferCreativeKind(text: string, outputType?: string): CreativeKind {
  const ot = (outputType || '').toLowerCase()
  if (ot === 'video') return 'video'
  if (ot === 'landing-page' || ot === 'app-mockup' || ot === 'blog-post') return 'page'
  if (ot === 'presentation') return 'deck'
  if (ot === 'illustration' || ot === 'brand-asset' || ot === 'photo-edit' || ot === 'social-post') return 'image'

  const t = (text || '').toLowerCase()
  if (/\b(web ?page|website|web ?site|landing ?page|home ?page|site for|html|blog ?post|app mockup)\b/.test(t)) return 'page'
  if (/\b(slide|slides|deck|presentation)\b/.test(t)) return 'deck'
  if (/\b(video|film|movie|clip|animation|animate|explainer|trailer|reel|footage|flythrough|fly-through)\b/.test(t)) return 'video'
  if (/\b(image|picture|photo|illustration|drawing|art|logo|poster|icon|render|portrait|banner|thumbnail)\b/.test(t)) return 'image'
  return 'copy'
}

/** The Design Studio template id that matches a kind (creative-core WORKFLOW_TEMPLATES). */
export function templateIdForKind(kind: CreativeKind): string | null {
  switch (kind) {
    case 'video': return 'video-production'
    case 'page': return 'landing-page'
    case 'deck': return null
    case 'image': return null
    default: return null
  }
}

export interface BackendState {
  up: boolean
  /** Why it is down, in the customer's words. Absent when up. */
  reason?: string
}

export interface CreativeCapabilities {
  /** The Iris planner/pipeline (`/api/iris/*`). */
  iris: BackendState
  /** A GPU media backend (media-forge via `/api/studio/*`). */
  media: BackendState
}

export interface ProbeOptions {
  apiBase?: string
  fetchFn?: typeof fetch
  /** Per probe. Probes run in parallel, so this is roughly the whole wait. */
  timeoutMs?: number
}

async function probe(
  fetchFn: typeof fetch,
  url: string,
  timeoutMs: number,
  what: string,
  readOk: (body: unknown) => boolean,
): Promise<BackendState> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      ...(ctl ? { signal: ctl.signal } : {}),
    })
    if (!res.ok) {
      if (res.status === 404 || res.status === 405) {
        return { up: false, reason: `${what} is not part of this deployment.` }
      }
      if (res.status === 401) return { up: false, reason: `Sign in to use ${what}.` }
      if (res.status === 403) return { up: false, reason: `Your plan does not include ${what}.` }
      return { up: false, reason: `${what} is not running here right now (HTTP ${res.status}).` }
    }
    let body: unknown = null
    try { body = await res.json() } catch { body = null }
    if (!readOk(body)) return { up: false, reason: `${what} answered but reports it is not ready.` }
    return { up: true }
  } catch {
    return { up: false, reason: `${what} did not answer.` }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Ask the host what creative backends actually answer. Never throws: an unreachable
 * backend is a `down` state with a reason, which is the whole point.
 *
 *   GET /api/iris/pipeline   Veil's status probe for Iris (503 `up:false` when parked)
 *   GET /api/studio/health   media-forge through the host proxy (`{ok}`)
 *
 * A static tenant portal (GitHub Pages + a product backend with no Iris routes) answers
 * 404/405 for both, which reads as "not part of this deployment" — the true answer.
 */
export async function probeCreativeCapabilities(o: ProbeOptions = {}): Promise<CreativeCapabilities> {
  const f = o.fetchFn || (globalThis.fetch as typeof fetch | undefined)
  if (!f) {
    const down = { up: false, reason: 'This browser cannot reach any backend.' }
    return { iris: down, media: down }
  }
  const base = o.apiBase ?? ''
  const t = o.timeoutMs ?? 8000
  const [iris, media] = await Promise.all([
    probe(f, `${base}/api/iris/pipeline`, t, 'Iris', (b) => {
      const r = (b || {}) as Record<string, unknown>
      if (r.up === false || r.success === false) return false
      if (typeof r.status === 'string' && /unavailable|down|offline/i.test(r.status)) return false
      return true
    }),
    probe(f, `${base}/api/studio/health`, t, 'The GPU media backend', (b) => {
      const r = (b || {}) as Record<string, unknown>
      return r.ok !== false
    }),
  ])
  return { iris, media }
}

export interface CapabilityGap {
  /** One sentence: what cannot happen here, and why. */
  reason: string
  /** What this device CAN do instead, most useful first. */
  alternatives: string[]
}

/**
 * The honest answer for a request this deployment cannot fulfil, or `null` when it can.
 *
 * Kinds map to backends: a video or an image needs Iris AND a GPU media backend
 * (Iris plans, media-forge renders); a page, deck or copy needs Iris to plan and write.
 */
export function capabilityGap(kind: CreativeKind, caps: CreativeCapabilities): CapabilityGap | null {
  const needsMedia = kind === 'video' || kind === 'image'
  if (caps.iris.up && (!needsMedia || caps.media.up)) return null

  const writeOnDevice = 'Ask the on-device assistant to write it as text (a script, outline or copy) — that runs in your browser.'
  if (kind === 'video') {
    const why = !caps.media.up ? caps.media.reason : caps.iris.reason
    return {
      reason: `Video generation needs a GPU media backend, and none is available on this deployment. ${why || ''}`.trim()
        + ' Nothing was started.',
      alternatives: [
        'A storyboard and shot list for the video, written as text.',
        writeOnDevice,
        caps.iris.up ? 'A web page about the subject (Iris can plan and write it).' : 'Connect a GPU media backend (My Hardware) and ask again.',
      ],
    }
  }
  if (kind === 'image') {
    const why = !caps.media.up ? caps.media.reason : caps.iris.reason
    return {
      reason: `Image generation needs a GPU media backend, and none is available on this deployment. ${why || ''}`.trim()
        + ' Nothing was started.',
      alternatives: [
        'A written art brief and prompt you can render later.',
        writeOnDevice,
        'Connect a GPU media backend (My Hardware) and ask again.',
      ],
    }
  }
  const what = kind === 'page' ? 'build a web page' : kind === 'deck' ? 'build a deck' : 'run a design pipeline'
  return {
    reason: `Iris cannot ${what} here: ${caps.iris.reason || 'Iris is not available on this deployment.'} Nothing was started.`,
    alternatives: kind === 'page'
      ? [
        'Ask the on-device assistant to write the page (headline, sections and copy) as text or HTML — that runs in your browser.',
        'Connect a backend that runs Iris and ask again.',
      ]
      : [writeOnDevice, 'Connect a backend that runs Iris and ask again.'],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Outcomes
// ─────────────────────────────────────────────────────────────────────────────

export type PipelineState = 'completed' | 'empty' | 'failed' | 'timeout'

export interface PipelineArtifactLite {
  type: string
  label: string
  content: string
  url?: string
}

export interface PipelineOutcome {
  state: PipelineState
  /** Present for every state except a clean `completed`. */
  reason?: string
  artifacts: PipelineArtifactLite[]
  /** Steps the server reported as failed, with its own words. */
  failures: string[]
}

/** The customer-facing sentence for an HTTP failure on POST /api/iris/pipeline. */
export function describePipelineHttpError(status: number, detail = ''): string {
  const d = detail ? ` (${detail.slice(0, 200)})` : ''
  if (status === 401) return 'Sign in to run Iris.'
  if (status === 402) return `You are out of credits for this design.${d}`
  if (status === 403) return `Your plan does not include the Iris pipeline.${d}`
  if (status === 404 || status === 405) return 'Iris is not part of this deployment, so nothing was generated.'
  if (status === 502 || status === 503 || status === 504) return `Iris is not running here right now, so nothing was generated.${d}`
  return `The Iris pipeline failed with HTTP ${status}.${d}`
}

const NOTHING_PRODUCED: Record<CreativeKind, string> = {
  video: 'Iris finished but produced no video. Video generation needs a GPU media backend that can render it, and none delivered output.',
  image: 'Iris finished but produced no image. No media backend delivered output.',
  page: 'Iris finished but produced no page.',
  deck: 'Iris finished but produced no deck.',
  copy: 'Iris finished but produced nothing.',
}

/** Close out a run: no artifact means `empty` with the reason, never a silent success. */
export function finishOutcome(
  artifacts: PipelineArtifactLite[],
  failures: string[],
  kind: CreativeKind = 'copy',
): PipelineOutcome {
  if (artifacts.length > 0) {
    return failures.length
      ? { state: 'completed', reason: `${failures.length} step(s) failed: ${failures[0]}`, artifacts, failures }
      : { state: 'completed', artifacts, failures }
  }
  const why = failures.length ? ` First failure: ${failures[0]}` : ''
  return { state: 'empty', reason: NOTHING_PRODUCED[kind] + why, artifacts, failures }
}

function artifactFrom(raw: unknown): PipelineArtifactLite | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  const url = typeof a.url === 'string' ? a.url : typeof a.file_path === 'string' ? a.file_path : ''
  const content = typeof a.content === 'string' ? a.content : url
  if (!content && !url) return null
  return {
    type: typeof a.type === 'string' ? a.type : typeof a.asset_type === 'string' ? a.asset_type : 'image',
    label: typeof a.label === 'string' ? a.label : typeof a.prompt === 'string' ? a.prompt.slice(0, 60) : 'Asset',
    content,
    url: url || undefined,
  }
}

/**
 * Judge a NON-streaming `/pipeline` response. Iris returns `results` (one per planned
 * asset); older shapes said `rounds` or `assets`. An entry with an `error` or
 * `success:false` is a failure; one with a file/image is an artifact.
 */
export function assessPipelineResult(
  result: Record<string, unknown> | null | undefined,
  kind: CreativeKind = 'copy',
): PipelineOutcome {
  if (!result) return { state: 'failed', reason: 'Iris answered with an empty body.', artifacts: [], failures: [] }
  if (result.success === false || result.ok === false) {
    const err = typeof result.error === 'string' && result.error ? result.error : 'Iris reported the run failed.'
    return { state: 'failed', reason: err, artifacts: [], failures: [err] }
  }
  const list = ['results', 'rounds', 'assets']
    .map((k) => result[k])
    .find((v): v is unknown[] => Array.isArray(v)) || []
  const artifacts: PipelineArtifactLite[] = []
  const failures: string[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    if (e.error || e.success === false || e.status === 'failed') {
      failures.push(typeof e.error === 'string' && e.error ? e.error : 'a step failed')
      continue
    }
    const img = typeof e.image === 'string' ? e.image
      : Array.isArray(e.images) && typeof e.images[0] === 'string' ? (e.images[0] as string)
      : undefined
    const art = artifactFrom(img ? { ...e, url: img } : e)
    if (art) artifacts.push(art)
  }
  if (typeof result.error === 'string' && result.error && artifacts.length === 0) {
    return { state: 'failed', reason: result.error, artifacts, failures: [result.error, ...failures] }
  }
  return finishOutcome(artifacts, failures, kind)
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming
// ─────────────────────────────────────────────────────────────────────────────

/** One SSE event from Iris `_stream_design_pipeline` (service.py). */
export interface PipelineStreamEvent {
  type: string
  step_index?: number
  step?: { name?: string; status?: string; error?: string; [k: string]: unknown }
  artifact?: unknown
  error?: string
  [k: string]: unknown
}

/** A step event's real status: the server's word, never an assumed "completed". */
export function stepStatus(event: PipelineStreamEvent): 'running' | 'completed' | 'failed' {
  if (event.type === 'step_start') return 'running'
  const s = String(event.step?.status || '').toLowerCase()
  if (s === 'failed' || s === 'error' || event.step?.error) return 'failed'
  return 'completed'
}

export interface StreamRunOptions {
  url: string
  body: unknown
  fetchFn?: typeof fetch
  onEvent?: (event: PipelineStreamEvent) => void
  kind?: CreativeKind
  /** Abort if no bytes arrive for this long. Iris pings every 15 s, so 90 s is generous. */
  idleMs?: number
  /** Hard ceiling for the whole run. */
  totalMs?: number
  signal?: AbortSignal
  headers?: Record<string, string>
}

/**
 * POST a streaming pipeline and resolve with a TERMINAL outcome — always.
 *
 * Terminal on: HTTP failure, an `error` event, a `done` event, the body closing, the
 * idle watchdog, the total deadline, or the caller's signal. Every branch resolves; the
 * only way to keep a spinner spinning is to not await this.
 */
export async function runPipelineStream(o: StreamRunOptions): Promise<PipelineOutcome> {
  const f = o.fetchFn || (globalThis.fetch as typeof fetch)
  const kind = o.kind || 'copy'
  const idleMs = o.idleMs ?? 90_000
  const totalMs = o.totalMs ?? 900_000
  const artifacts: PipelineArtifactLite[] = []
  const failures: string[] = []

  const ctl = new AbortController()
  // Every await below races this. Aborting the fetch signal is NOT enough on its own: a
  // body reader whose server went silent can sit in read() regardless (measured in the
  // test double, and host-dependent in real browsers), and then the watchdog fires into
  // nothing and the spinner outlives the run — the exact failure this module exists for.
  const abortedP = new Promise<never>((_, reject) => {
    const fire = () => reject(new Error('aborted'))
    if (ctl.signal.aborted) fire()
    else ctl.signal.addEventListener('abort', fire, { once: true })
  })
  abortedP.catch(() => undefined)
  const onOuterAbort = () => ctl.abort()
  if (o.signal) {
    if (o.signal.aborted) ctl.abort()
    else o.signal.addEventListener('abort', onOuterAbort)
  }
  let why: 'idle' | 'total' | null = null
  const totalTimer = setTimeout(() => { why = 'total'; ctl.abort() }, totalMs)
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const kick = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => { why = 'idle'; ctl.abort() }, idleMs)
  }
  const cleanup = () => {
    clearTimeout(totalTimer)
    if (idleTimer) clearTimeout(idleTimer)
    o.signal?.removeEventListener('abort', onOuterAbort)
  }
  const timedOut = (): PipelineOutcome => ({
    state: 'timeout',
    reason: why === 'idle'
      ? `Iris stopped sending progress for ${Math.round(idleMs / 1000)} s, so the run was stopped. Nothing more will arrive from it.`
      : why === 'total'
        ? `The run passed its ${Math.round(totalMs / 60000)}-minute limit and was stopped.`
        : 'The run was cancelled.',
    artifacts,
    failures,
  })

  kick()
  let res: Response
  try {
    res = await Promise.race([f(o.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(o.headers || {}) },
      body: JSON.stringify(o.body),
      signal: ctl.signal,
    }), abortedP])
  } catch (e) {
    cleanup()
    if (ctl.signal.aborted) return timedOut()
    return { state: 'failed', reason: `Iris did not answer, so nothing was generated. (${String(e).slice(0, 160)})`, artifacts, failures }
  }

  if (!res.ok) {
    let detail = ''
    try {
      const text = await Promise.race([res.text(), abortedP])
      try {
        const j = JSON.parse(text) as { detail?: unknown; error?: unknown }
        const d = j.detail ?? j.error
        detail = typeof d === 'string' ? d : d ? JSON.stringify(d) : ''
      } catch { detail = text.slice(0, 200) }
    } catch { /* no body */ }
    cleanup()
    return { state: 'failed', reason: describePipelineHttpError(res.status, detail), artifacts, failures }
  }

  // A JSON answer to a stream request (an older Iris, or a proxy that buffered it).
  const ctype = res.headers?.get?.('content-type') || ''
  if (ctype.includes('application/json')) {
    try {
      const parsed = await Promise.race([res.json(), abortedP])
      const outcome = assessPipelineResult(parsed as Record<string, unknown>, kind)
      cleanup()
      return outcome
    } catch {
      cleanup()
      if (ctl.signal.aborted) return timedOut()
      return { state: 'failed', reason: 'Iris answered with a body this page could not read.', artifacts, failures }
    }
  }

  const reader = res.body?.getReader()
  if (!reader) {
    cleanup()
    return { state: 'failed', reason: 'Iris answered with no progress stream.', artifacts, failures }
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let terminal: PipelineOutcome | null = null

  const handle = (raw: string) => {
    let event: PipelineStreamEvent
    try { event = JSON.parse(raw) as PipelineStreamEvent } catch { return }
    if (!event || typeof event.type !== 'string') return
    o.onEvent?.(event)
    if (event.type === 'step_complete' && stepStatus(event) === 'failed') {
      failures.push(String(event.step?.error || `${event.step?.name || 'a step'} failed`))
    } else if (event.type === 'artifact') {
      const art = artifactFrom(event.artifact)
      if (art) artifacts.push(art)
    } else if (event.type === 'error') {
      const err = typeof event.error === 'string' && event.error ? event.error : 'Iris reported an error.'
      terminal = { state: 'failed', reason: err, artifacts, failures: [...failures, err] }
    } else if (event.type === 'done' || event.type === 'complete' || event.type === 'pipeline_complete') {
      if (event.ok === false && typeof event.error === 'string') failures.push(event.error)
      terminal = finishOutcome(artifacts, failures, kind)
    }
  }

  try {
    while (!terminal) {
      const { done, value } = await Promise.race([reader.read(), abortedP])
      if (done) break
      kick()
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const l = line.replace(/\r$/, '')
        if (!l.startsWith('data:')) continue
        handle(l.slice(5).trim())
        if (terminal) break
      }
    }
    if (!terminal && buffer.trim().startsWith('data:')) handle(buffer.trim().slice(5).trim())
  } catch {
    if (ctl.signal.aborted) {
      cleanup()
      return timedOut()
    }
    terminal = terminal || { state: 'failed', reason: 'The connection to Iris dropped mid-run.', artifacts, failures }
  }
  try { await reader.cancel() } catch { /* already closed */ }
  cleanup()

  if (terminal) return terminal
  // Closed without `done`: whatever arrived is what there is, and it is not a success.
  if (artifacts.length > 0) {
    return { state: 'completed', reason: 'The connection closed before Iris confirmed the run finished.', artifacts, failures }
  }
  return {
    state: 'failed',
    reason: 'The connection to Iris closed before it finished, and nothing was produced.',
    artifacts,
    failures,
  }
}
