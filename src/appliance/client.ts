/**
 * createApplianceClient(apiBase) -- the typed client for awnix-console's JSON API
 * (contract appliance-web-api), used both on the box (apiBase '') and through the
 * tenant backend's admin proxy (awkit-backend/appliance.py, same paths).
 *
 * Every call resolves to an ApiResult; nothing throws for an HTTP outcome, and nothing
 * is ever an empty success:
 *   200/2xx -> 'ok'          (a read whose result is missing is 'error', not 'ok')
 *   401     -> 'refused'     + opts.onUnauthorized() so the shell shows the code screen
 *   402     -> 'not-entitled'
 *   409     -> 'refused'     (CLI exit 1; the CLI's JSON is still in `data`)
 *   423     -> 'locked'      + retryAfter
 *   501     -> 'not-an-appliance' when the proxy says so, else 'unavailable'
 *   503/504 -> 'unavailable' (CLI exit 2 / offline; data kept when present)
 *   network -> 'unavailable' with status 0
 */
import type { EndpointsResult as EndpointsView } from './EndpointsPanel'
import type {
  ActionBodies,
  ActionVerb,
  ApiResult,
  ApiState,
  ComponentsResult,
  EndpointsResult,
  LicenseStatus,
  LoginResult,
  Overview,
  Session,
  SetupApplyResult,
  SetupState,
  SetupSteps,
  Surfaces,
  UpdateStatus,
} from './types'

export interface ApplianceClientOptions {
  /** Called on any 401 so the shell can drop back to the login screen. */
  onUnauthorized?: () => void
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch
}

export interface ApplianceClient {
  readonly apiBase: string
  session(): Promise<ApiResult<Session>>
  login(code: string): Promise<ApiResult<LoginResult>>
  logout(): Promise<ApiResult<{ authenticated: boolean }>>
  overview(): Promise<ApiResult<Overview>>
  license(): Promise<ApiResult<LicenseStatus>>
  updates(): Promise<ApiResult<UpdateStatus>>
  components(): Promise<ApiResult<ComponentsResult>>
  endpoints(): Promise<ApiResult<EndpointsResult>>
  /** EndpointsPanel's structural client: GET endpoints as the panel's union. */
  getEndpoints(): Promise<EndpointsView>
  /** The `endpoints-probe` action (`awnix endpoints probe --json`) as the panel's union. */
  probeEndpoints(): Promise<EndpointsView>
  surfaces(): Promise<ApiResult<Surfaces>>
  /** Console mode: `awnix-setup --status --json`. */
  setupStatus(): Promise<ApiResult<SetupState>>
  /** Setup mode only. */
  setupSteps(): Promise<ApiResult<SetupSteps>>
  setupState(): Promise<ApiResult<SetupState>>
  applySetupStep(id: string, value: unknown): Promise<ApiResult<SetupApplyResult>>
  finishSetup(): Promise<ApiResult<SetupApplyResult>>
  action<V extends ActionVerb>(verb: V, body?: ActionBodies[V]): Promise<ApiResult<unknown>>
  /** For panels that need a JSON document outside the API (e.g. /guide.json). */
  getJson<T>(path: string): Promise<ApiResult<T>>
}

const API_STATES: ReadonlyArray<ApiState> = [
  'ok', 'refused', 'unavailable', 'not-entitled', 'locked', 'not-an-appliance', 'error',
]

export function stateForStatus(status: number, body: unknown): ApiState {
  const bodyState =
    body && typeof body === 'object' ? (body as { state?: unknown }).state : undefined
  if (status >= 200 && status < 300) return 'ok'
  switch (status) {
    case 401:
    case 409:
      return 'refused'
    case 402:
      return 'not-entitled'
    case 423:
      return 'locked'
    case 501:
      return bodyState === 'not-an-appliance' ? 'not-an-appliance' : 'unavailable'
    case 503:
    case 504:
      return 'unavailable'
    default:
      return typeof bodyState === 'string' && (API_STATES as string[]).includes(bodyState)
        && bodyState !== 'ok'
        ? (bodyState as ApiState)
        : 'error'
  }
}

/** ApiResult -> EndpointsPanel's union: 501 'no plane' and 503 'could not ask' stay
 * distinct from an empty table (the panel renders each one explicitly). */
export function toEndpointsView(r: ApiResult<unknown>): EndpointsView {
  const d = r.data as { endpoints?: unknown } | null
  if (r.state === 'ok' && d && Array.isArray(d.endpoints)) {
    return { state: 'ok', data: { endpoints: d.endpoints as never } }
  }
  if (r.state === 'not-an-appliance' || r.status === 501) {
    return { state: 'unavailable', detail: r.detail }
  }
  if (r.state === 'unavailable') return { state: 'unreachable', detail: r.detail }
  return {
    state: 'error',
    status: r.status,
    detail: r.detail ?? (r.state === 'ok' ? 'the endpoints answer carried no endpoints' : r.state),
  }
}

function isEnvelope(b: unknown): b is { result: unknown; exit?: number | null; stdout_tail?: string; detail?: string } {
  return !!b && typeof b === 'object' && 'result' in (b as object) && 'verb' in (b as object)
}

export function createApplianceClient(
  apiBase: string,
  opts: ApplianceClientOptions = {},
): ApplianceClient {
  const base = apiBase.replace(/\/+$/, '')
  const doFetch = (...args: Parameters<typeof fetch>) =>
    (opts.fetch ?? globalThis.fetch)(...args)

  async function call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    kind: 'envelope' | 'plain' | 'action' = 'plain',
  ): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    const init: RequestInit = { method, headers, credentials: 'same-origin' }
    if (method === 'POST') {
      headers['X-Awnix-Console'] = '1'
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body ?? {})
    }
    let res: Response
    try {
      res = await doFetch(`${base}${path}`, init)
    } catch (err) {
      return {
        state: 'unavailable',
        status: 0,
        data: null,
        detail: `the console did not answer (${err instanceof Error ? err.message : String(err)})`,
      }
    }
    let parsed: unknown = null
    let parseFailed = false
    try {
      const text = await res.text()
      parsed = text ? JSON.parse(text) : null
    } catch {
      parseFailed = true
    }
    if (res.status === 401) opts.onUnauthorized?.()
    let state = stateForStatus(res.status, parsed)
    const out: ApiResult<T> = { state, status: res.status, data: null }
    const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
    if (typeof obj.detail === 'string') out.detail = obj.detail
    if (res.status === 423) {
      const ra = Number(res.headers.get('Retry-After') ?? obj.retry_after)
      if (Number.isFinite(ra)) out.retryAfter = ra
    }
    if (kind !== 'plain' && isEnvelope(parsed)) {
      out.data = (parsed.result ?? null) as T | null
      out.exit = parsed.exit ?? null
      if (typeof parsed.stdout_tail === 'string') out.stdoutTail = parsed.stdout_tail
    } else if (state === 'ok') {
      out.data = parsed as T | null
    }
    if (state === 'ok') {
      if (parseFailed) {
        state = 'error'
        out.detail = 'the console answered with something that is not JSON'
      } else if (kind === 'envelope' && out.data == null) {
        state = 'error'
        out.detail = out.detail ?? 'the console reported success with no data'
      } else if (kind === 'plain' && out.data == null) {
        state = 'error'
        out.detail = 'the console reported success with no data'
      }
      out.state = state
    }
    return out
  }

  const read = <T,>(section: string) => call<T>('GET', `/api/appliance/${section}`, undefined, 'envelope')

  return {
    apiBase: base,
    session: () => call<Session>('GET', '/api/session'),
    login: (code: string) => call<LoginResult>('POST', '/api/login', { code: code.trim() }),
    logout: () => call<{ authenticated: boolean }>('POST', '/api/logout', {}),
    overview: () => read<Overview>('overview'),
    license: () => read<LicenseStatus>('license'),
    updates: () => read<UpdateStatus>('updates'),
    components: () => read<ComponentsResult>('components'),
    endpoints: () => read<EndpointsResult>('endpoints'),
    getEndpoints: async () => toEndpointsView(await read<EndpointsResult>('endpoints')),
    probeEndpoints: async () =>
      toEndpointsView(
        await call<unknown>('POST', '/api/appliance/actions/endpoints-probe', {}, 'action'),
      ),
    surfaces: () => read<Surfaces>('surfaces'),
    setupStatus: () => read<SetupState>('setup'),
    setupSteps: () => call<SetupSteps>('GET', '/api/setup/steps'),
    setupState: () => call<SetupState>('GET', '/api/setup/state'),
    applySetupStep: (id: string, value: unknown) =>
      call<SetupApplyResult>('POST', `/api/setup/steps/${encodeURIComponent(id)}`, { value }),
    finishSetup: () => call<SetupApplyResult>('POST', '/api/setup/finish', {}),
    action: <V extends ActionVerb>(verb: V, body?: ActionBodies[V]) =>
      call<unknown>('POST', `/api/appliance/actions/${encodeURIComponent(verb)}`, body ?? {}, 'action'),
    getJson: <T,>(path: string) => call<T>('GET', path),
  }
}
