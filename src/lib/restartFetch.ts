/**
 * A chat turn outlives a restart of the backend.
 *
 * A deploy restarts Genesis (measured 2026-10-01: 54 times in a day, 30-110 s each). While it
 * is away the edge answers 502/503/504, a draining instance answers 503 with
 * `X-Aither-Draining: 1`, or the connection fails. None of those reached the app: the request
 * was never accepted, so sending the SAME request again is safe. Anything else (a 200, a 4xx,
 * a 500 from the app) is returned as it is and is never retried, and a response that has
 * started is the caller's -- a stream cut half-way is not replayed here.
 */

/** How long a turn waits for the backend to come back (measured: a restart is 90-120 s). */
export const RESTART_WAIT_MS = 240_000;

const GONE = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

export interface RestartFetchOptions {
  /** Called before each retry with the attempt number (1 = first retry). */
  onRetry?: (attempt: number) => void;
  /** Total time to keep trying. */
  waitMs?: number;
  /** An attempt that has no response headers after this long counts as "away". */
  attemptTimeoutMs?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** True when the response says "nobody took this request": safe to send again. */
export function backendIsAway(resp: Response): boolean {
  if (resp.headers.get('x-aither-draining')) return true;
  return GONE.has(resp.status);
}

/**
 * `fetch`, but a request the backend never accepted is sent again until it answers or
 * `waitMs` runs out; then the last response is returned (or the last error thrown), so the
 * caller's existing error path still runs. An aborted request is never retried.
 */
export async function fetchThroughRestart(
  input: string,
  init?: RequestInit,
  opts: RestartFetchOptions = {},
): Promise<Response> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(ok => setTimeout(ok, ms)));
  const now = opts.now ?? (() => Date.now());
  const until = now() + (opts.waitMs ?? RESTART_WAIT_MS);
  let attempt = 0;
  for (;;) {
    let resp: Response | null = null;
    let failure: unknown = null;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attemptInit = init;
    if (opts.attemptTimeoutMs) {
      // Bounds the wait for HEADERS only: cleared as soon as the response starts, so a
      // long stream is never cut by it.
      const ctl = new AbortController();
      init?.signal?.addEventListener('abort', () => ctl.abort(), { once: true });
      timer = setTimeout(() => { timedOut = true; ctl.abort(); }, opts.attemptTimeoutMs);
      attemptInit = { ...init, signal: ctl.signal };
    }
    try {
      resp = await doFetch(input, attemptInit);
    } catch (e) {
      const aborted = (e as { name?: string })?.name === 'AbortError' || init?.signal?.aborted;
      if (aborted && !timedOut) throw e;
      failure = e;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (resp && !backendIsAway(resp)) return resp;
    if (now() >= until) {
      if (resp) return resp;
      throw failure;
    }
    attempt += 1;
    opts.onRetry?.(attempt);
    await sleep(Math.min(2000 + attempt * 1500, 8000));
  }
}
