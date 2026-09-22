/**
 * One fetch seam for the three creative panels, and one vocabulary for failure.
 *
 * Why this exists rather than a bare `fetch` per panel: a creative panel that
 * cannot reach its backend must say WHICH failure it hit, in the user's words.
 * The three that matter here are not interchangeable —
 *
 *   401  you are not signed in            -> "Sign in to play"
 *   403/404 on a world you do not hold    -> "That world is not yours"
 *   503  the backend is down              -> name the backend, never draw a stub
 *
 * The play plane returns 404 (not 403) for a world outside the caller's reach —
 * that is deliberate in the Saga registry design, so a stranger cannot probe which
 * world ids exist. The panel therefore has to carry the copy for BOTH readings of a
 * 404 and pick by context, which is exactly what `PanelError.kind` is for.
 */

export type PanelErrorKind =
  | 'unauthenticated'   // 401 — no session
  | 'forbidden'         // 403 — signed in, not entitled
  | 'not-found'         // 404 — no such world / op / route
  | 'unavailable'       // 503 / network — the backend did not answer
  | 'refused'           // 200 with ok:false — the service ran and said no
  | 'bad-response'      // 200 with a body we cannot read
  | 'server'            // any other non-2xx

export class PanelError extends Error {
  readonly kind: PanelErrorKind
  readonly status: number
  readonly detail: string

  constructor(kind: PanelErrorKind, message: string, status = 0, detail = '') {
    super(message)
    this.name = 'PanelError'
    this.kind = kind
    this.status = status
    this.detail = detail
  }
}

/** HTTP status -> failure kind. Everything unmapped is `server`, never silent. */
export function kindForStatus(status: number): PanelErrorKind {
  if (status === 401) return 'unauthenticated'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  if (status === 502 || status === 503 || status === 504) return 'unavailable'
  return 'server'
}

async function readDetail(res: Response): Promise<string> {
  try {
    const text = await res.text()
    if (!text) return ''
    try {
      const parsed = JSON.parse(text) as { error?: unknown; detail?: unknown }
      const d = parsed.detail ?? parsed.error
      if (typeof d === 'string') return d
      if (d != null) return JSON.stringify(d)
    } catch {
      /* not JSON — the text IS the detail */
    }
    return text.slice(0, 400)
  } catch {
    return ''
  }
}

export interface JsonRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
  /** Milliseconds. A heavy media-forge op legitimately runs for minutes. */
  timeoutMs?: number
  signal?: AbortSignal
}

/**
 * JSON fetch that throws a typed PanelError instead of returning `any`.
 *
 * AbortSignal.timeout is used when present and simply skipped when it is not —
 * awkit panels are mounted in Electron, Next and plain-browser hosts, and a hard
 * dependency on a newish static would take the whole Living Desktop down on the
 * oldest one rather than lose a timeout.
 */
export async function fetchJson<T>(url: string, req: JsonRequest = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, timeoutMs, signal } = req

  let effectiveSignal = signal
  if (!effectiveSignal && typeof timeoutMs === 'number') {
    const AS = (globalThis as { AbortSignal?: { timeout?: (ms: number) => AbortSignal } }).AbortSignal
    if (AS && typeof AS.timeout === 'function') effectiveSignal = AS.timeout(timeoutMs)
  }

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined
        ? { Accept: 'application/json', ...headers }
        : { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(effectiveSignal ? { signal: effectiveSignal } : {}),
    })
  } catch (e) {
    throw new PanelError('unavailable', 'The service did not answer.', 0, String(e))
  }

  if (!res.ok) {
    const detail = await readDetail(res)
    throw new PanelError(kindForStatus(res.status), `HTTP ${res.status}`, res.status, detail)
  }

  try {
    return (await res.json()) as T
  } catch (e) {
    throw new PanelError('bad-response', 'The service answered with something that is not JSON.', res.status, String(e))
  }
}

/** Human copy for a failure, given the surface it happened on. */
export function describeError(err: unknown, surface: string): string {
  if (err instanceof PanelError) {
    switch (err.kind) {
      case 'unauthenticated':
        return 'Sign in to play — this world is yours, and the server will not hand it to an anonymous request.'
      case 'forbidden':
        return `Your plan does not include ${surface}.${err.detail ? ` (${err.detail})` : ''}`
      case 'not-found':
        return err.detail || `${surface} answered 404.`
      case 'unavailable':
        return `${surface} is not reachable right now, so nothing was generated.${err.detail ? ` (${err.detail})` : ''}`
      case 'refused':
        return err.detail || `${surface} refused this request.`
      case 'bad-response':
        return `${surface} answered with a body this panel could not read.`
      default:
        return `${surface} failed with HTTP ${err.status}.${err.detail ? ` ${err.detail}` : ''}`
    }
  }
  return `${surface} failed: ${String(err)}`
}
