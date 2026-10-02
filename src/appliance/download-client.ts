/**
 * requestDownload -- the client half of POST /v1/licenses/download.
 *
 * The licence envelope (AITHER1.<payload>.<sig>) is the only credential; no
 * session, no cookie. Every non-200 maps to an EXPLICIT state -- never an empty
 * success -- so the panel can say exactly why a download was refused:
 *
 *   200                -> ok (signed ~5 min part URLs + size + sha256)
 *   400                -> invalid (malformed envelope/body)
 *   403 {code}         -> invalid | expired | revoked | not-entitled
 *                         (unknown-license is shown as invalid: never issued here)
 *   404                -> error (no such asset / release)
 *   429 + Retry-After  -> throttled (retryAfter seconds)
 *   503                -> unavailable (upstream or credential missing; try later)
 *   network / other    -> error
 *
 * Vite-safe: no next/* imports, fetch is injectable for tests.
 */

export interface LicenseDownloadRequest {
  license: string
  asset: string
  version?: string
}

export interface LicenseDownloadPart {
  name: string
  size: number
  sha256?: string | null
  url: string
  expires_at: number
}

export interface LicenseDownloadExtra {
  name: string
  url: string
  expires_at?: number
}

export interface LicenseDownloadResponse {
  ok: true
  asset: string
  release_tag: string
  filename: string
  size: number
  sha256: string
  parts: LicenseDownloadPart[]
  extras: LicenseDownloadExtra[]
  expires_at: number
  lic_id: string
}

export type DownloadState =
  | 'ok'
  | 'invalid'
  | 'expired'
  | 'revoked'
  | 'not-entitled'
  | 'throttled'
  | 'unavailable'
  | 'error'

export interface DownloadResult {
  state: DownloadState
  status: number
  /** Present only when state === 'ok'. */
  data?: LicenseDownloadResponse
  /** Server refusal code, e.g. 'unknown-license', 'unknown-asset'. */
  code?: string
  detail?: string
  /** Seconds, when state === 'throttled'. */
  retryAfter?: number
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const FORBIDDEN_STATE: Record<string, DownloadState> = {
  invalid: 'invalid',
  expired: 'expired',
  revoked: 'revoked',
  'not-entitled': 'not-entitled',
  'unknown-license': 'invalid',
}

/** Trim and strip whitespace a copy/paste out of a .lic file tends to add. */
export function normalizeLicense(text: string): string {
  return (text || '').replace(/\s+/g, '')
}

export function looksLikeEnvelope(text: string): boolean {
  const t = normalizeLicense(text)
  return /^AITHER1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t) && t.length <= 16384
}

function isOkBody(b: unknown): b is LicenseDownloadResponse {
  if (!b || typeof b !== 'object') return false
  const o = b as Record<string, unknown>
  return (
    o.ok === true &&
    typeof o.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(o.sha256) &&
    Array.isArray(o.parts) &&
    o.parts.length > 0 &&
    (o.parts as unknown[]).every(
      (p) => !!p && typeof (p as LicenseDownloadPart).url === 'string' &&
        (p as LicenseDownloadPart).url.startsWith('https://'),
    )
  )
}

export async function requestDownload(
  apiBase: string,
  req: LicenseDownloadRequest,
  fetchImpl?: FetchLike,
): Promise<DownloadResult> {
  const f: FetchLike | undefined =
    fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined)
  if (!f) return { state: 'error', status: 0, detail: 'fetch is not available' }
  const base = (apiBase || '').replace(/\/+$/, '')
  const body: LicenseDownloadRequest = {
    license: normalizeLicense(req.license),
    asset: req.asset,
  }
  if (req.version) body.version = req.version
  let res: Response
  try {
    res = await f(`${base}/v1/licenses/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
    })
  } catch (e) {
    return { state: 'error', status: 0, detail: e instanceof Error ? e.message : 'network error' }
  }
  let json: Record<string, unknown> = {}
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    json = {}
  }
  const code = typeof json.code === 'string' ? json.code : undefined
  const detail = typeof json.detail === 'string' ? json.detail : undefined

  if (res.status === 200) {
    if (isOkBody(json)) return { state: 'ok', status: 200, data: json }
    // A 200 that is not a real answer is an error, never an empty success.
    return { state: 'error', status: 200, detail: 'server answered without download links' }
  }
  if (res.status === 400) return { state: 'invalid', status: 400, code, detail }
  if (res.status === 403) {
    return { state: FORBIDDEN_STATE[code ?? ''] ?? 'invalid', status: 403, code, detail }
  }
  if (res.status === 429) {
    const hdr = Number(res.headers?.get?.('Retry-After') ?? NaN)
    const bodyRa = typeof json.retry_after === 'number' ? json.retry_after : NaN
    const retryAfter = Number.isFinite(hdr) && hdr > 0 ? hdr : Number.isFinite(bodyRa) ? bodyRa : 3600
    return { state: 'throttled', status: 429, code, detail, retryAfter }
  }
  if (res.status === 503) return { state: 'unavailable', status: 503, code, detail }
  return { state: 'error', status: res.status, code, detail }
}

/** "1.8 GB" style size for the panel. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '?'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** The shell lines a customer runs after downloading every part. */
export function assembleInstructions(data: LicenseDownloadResponse): string[] {
  return [
    `# put every ${data.filename}.NN.part, SHA256SUMS and assemble-awnix-iso.sh in one folder`,
    'bash assemble-awnix-iso.sh          # joins in numeric order, verifies; Windows: .\\assemble-awnix-iso.ps1',
    'sha256sum -c SHA256SUMS             # re-check any time; must print: OK',
    `# expected sha256 ${data.sha256}`,
    '# then copy license.lic to the AWNIX_SEED volume before first boot',
  ]
}
