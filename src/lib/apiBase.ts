/**
 * Absolute API base resolution for portal-kit apps.
 *
 * A portal-kit SPA normally talks to a SAME-ORIGIN backend via relative
 * `/api/*` paths — the app is served behind its FastAPI backend (or behind a
 * reverse proxy that routes `/api/*` to it). That assumption breaks when the
 * SPA is hosted as STATIC files on a CDN (e.g. GitHub Pages), where there is
 * no same-origin `/api` to hit.
 *
 * This module lets a static build point all `/api/*` traffic at an absolute
 * backend origin. The base is resolved once, in priority order:
 *   1. `window.__AITHER_API_BASE__` — set by a published `/config.js`, so ops
 *      can repoint the backend with NO rebuild (the robust static pattern).
 *   2. `import.meta.env.VITE_API_BASE` — baked at build time.
 *   3. `''` (empty) — same-origin relative; the DEFAULT. When empty, the fetch
 *      wrapper does no URL rewriting, so proxied/same-origin deployments behave
 *      exactly as before (zero behaviour change).
 *
 * The actual URL rewriting lives in `installIdentityHeaders` (the single
 * `window.fetch` wrapper in identityFetch.ts) so there is exactly one fetch
 * monkeypatch and the identity-header + base-rewrite logic stay coordinated.
 */

let _base: string | null = null;

function _read(): string {
  // Runtime window-injected config wins (no rebuild to repoint the backend).
  if (typeof window !== 'undefined') {
    const w = (window as unknown as { __AITHER_API_BASE__?: unknown }).__AITHER_API_BASE__;
    if (typeof w === 'string' && w.trim()) return w.trim().replace(/\/+$/, '');
  }
  // Build-time env (Vite). Guarded — `import.meta` is absent under CJS/Jest.
  try {
    const env = (import.meta as unknown as { env?: Record<string, string> })?.env;
    const v = env?.VITE_API_BASE;
    if (typeof v === 'string' && v.trim()) return v.trim().replace(/\/+$/, '');
  } catch {
    /* import.meta unavailable in this runtime */
  }
  return '';
}

/** The configured absolute API base (no trailing slash), or '' for same-origin. Cached. */
export function getApiBase(): string {
  if (_base === null) _base = _read();
  return _base;
}

/** Override the API base at runtime (programmatic setup / tests). Pass '' or null to clear. */
export function setApiBase(base: string | null): void {
  _base = base ? base.replace(/\/+$/, '') : '';
}

/** True when an absolute (typically cross-origin) backend base is configured. */
export function hasAbsoluteApiBase(): boolean {
  return getApiBase() !== '';
}

/**
 * Rewrite a relative or same-origin `/api/*` URL onto the configured absolute
 * base. Returns the URL unchanged when no base is set or it isn't an `/api/*`
 * request. Pure — used by the fetch wrapper and unit-testable in isolation.
 */
export function rewriteApiUrl(url: string, base: string = getApiBase()): string {
  if (!base || !url) return url;
  if (url.startsWith('/api/')) return base + url;
  // Same-origin absolute URL → move pathname+search onto the base origin.
  if (typeof window !== 'undefined') {
    try {
      const u = new URL(url, window.location.origin);
      if (u.origin === window.location.origin && u.pathname.startsWith('/api/')) {
        return base + u.pathname + u.search;
      }
    } catch {
      /* not a parseable URL — leave untouched */
    }
  }
  return url;
}
