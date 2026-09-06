/**
 * Relay WebSocket URL resolution — the ONE place this URL is built.
 *
 * A WebSocket is NOT `window.fetch`, so it never passes through the
 * `installIdentityHeaders` wrapper that rewrites relative `/api/*` onto the
 * configured absolute base. Every component that hand-built a `ws://` URL from
 * `window.location.host` therefore worked on a backend-hosted deployment and
 * dialled the wrong origin on a STATIC one (GitHub Pages), where there is no
 * same-origin backend to answer it.
 *
 * Measured 2026-08-21 on a tenant portal:
 *   wss://<portal-host>/api/platform/ws/relay -> 404
 *   wss://<api-host>/api/platform/ws/relay -> 101 Switching Protocols
 *
 * The correct origin was already published in `/config.js` and read by
 * `getApiBase()`; the socket callers were the only code not consulting it. The
 * user-visible result was "Support chat is unavailable" on every tenant while
 * the socket was healthy the whole time.
 *
 * Three components had their own copy of this construction and they had already
 * DRIFTED — SupportPanel dialled `/api/relay/ws`, which the tenant backend does
 * not serve (403), while SupportWidget and CommsPanel used the live
 * `/api/platform/ws/relay`. That is why this is one exported function and not a
 * fixed comment in three files.
 */
import { getApiBase } from './apiBase'

/** Path suffix under the API prefix that serves the relay socket. */
export const RELAY_WS_SUFFIX = '/ws/relay'

/** API prefix the relay socket lives under when nothing more specific is known. */
export const DEFAULT_API_PREFIX = '/api/platform'

function isAbsolute(v: string): boolean {
  return v.startsWith('http://') || v.startsWith('https://')
}

/**
 * Host for the socket. An explicit absolute `apiBase` wins, then the runtime
 * config (`window.__AITHER_API_BASE__`), then same-origin. Resolved separately
 * from the path prefix on purpose: a caller may pass a RELATIVE prefix
 * ('/api/platform') while the ORIGIN still has to come from the runtime config.
 * Collapsing the two is what made CommsPanel's cross-origin branch unreachable.
 */
function resolveHost(apiBase?: string): string {
  for (const candidate of [apiBase, getApiBase()]) {
    if (candidate && isAbsolute(candidate)) {
      try {
        return new URL(candidate).host
      } catch {
        /* unparseable — try the next candidate */
      }
    }
  }
  return window.location.host
}

/**
 * Path prefix for the socket.
 *
 * `new URL('https://host').pathname` is '/', NOT '' — it is TRUTHY, so a plain
 * `url.pathname || DEFAULT` never reaches its fallback and yields a doubled
 * slash with no prefix. Strip trailing slashes and test for emptiness instead.
 */
function resolvePrefix(apiBase?: string): string {
  if (apiBase) {
    if (isAbsolute(apiBase)) {
      try {
        const p = new URL(apiBase).pathname.replace(/\/+$/, '')
        if (p) return p
      } catch {
        /* unparseable — fall through to the default */
      }
    } else {
      const p = apiBase.replace(/\/+$/, '')
      if (p) return p
    }
  }
  return DEFAULT_API_PREFIX
}

/**
 * Build the relay WebSocket URL.
 *
 * @param override Explicit URL from a prop — returned untouched when provided.
 * @param apiBase  Component-level API base; may be absolute or a relative prefix.
 */
export function relayWsUrl(override?: string, apiBase?: string): string {
  if (override) return override
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${resolveHost(apiBase)}${resolvePrefix(apiBase)}${RELAY_WS_SUFFIX}`
}
