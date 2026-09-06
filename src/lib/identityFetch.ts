/**
 * Identity-aware fetch wrapper for portal-kit apps.
 *
 * Solves gap D2: even when a portal user is logged in via cookie/SSO, the
 * frontend was not forwarding ``X-Tenant-ID`` / ``X-Workspace-ID`` /
 * ``X-User-ID`` to the backend, so the backend always fell through to
 * ``_default_tenant(app_id)`` and the panels never showed a real workspace's
 * data.
 *
 * Call :func:`installIdentityHeaders` once from ``main.tsx`` to monkey-patch
 * ``window.fetch``. Same-origin requests to ``/api/...`` get the identity
 * headers injected from a cached ``/api/auth/me`` payload plus an explicit
 * workspace selection persisted in ``localStorage``.
 *
 * Cross-origin requests and non-``/api/`` paths are left untouched.
 *
 * To set the active workspace (e.g. after a workspace switcher), call
 * :func:`setActiveWorkspace`. To force a refresh of the cached identity
 * payload (e.g. after login/logout), call :func:`refreshIdentity`.
 */

import { getApiBase, rewriteApiUrl } from './apiBase';

const LS_WORKSPACE_KEY = 'portal-kit:active-workspace-id';

type Identity = {
  tenant_id?: string;
  workspace_id?: string;
  user_id?: string;
  role?: string;
};

let _cached: Identity | null = null;
let _inflight: Promise<Identity | null> | null = null;
let _installed = false;

async function _fetchIdentity(originalFetch: typeof fetch): Promise<Identity | null> {
  try {
    // Static-hosted build: the identity probe must ALSO honour the configured
    // absolute API base, and go credentialed so the cookie/SSO session survives
    // the cross-origin hop. (The public wrapper can't be used here — recursion.)
    const base = getApiBase();
    const url = rewriteApiUrl('/api/auth/me', base);
    const r = await originalFetch(url, { credentials: base ? 'include' : 'same-origin' });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data || data.authenticated === false) return null;
    return {
      tenant_id: data.tenant_id,
      workspace_id: data.workspace_id,
      user_id: data.user_id || data.id || data.sub,
      role: data.role,
    };
  } catch {
    return null;
  }
}

async function _getIdentity(originalFetch: typeof fetch): Promise<Identity | null> {
  if (_cached) return _cached;
  if (_inflight) return _inflight;
  _inflight = _fetchIdentity(originalFetch).then((id) => {
    _cached = id;
    _inflight = null;
    return id;
  });
  return _inflight;
}

function _isApiRequest(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('/api/')) return true;
  try {
    const u = new URL(url, window.location.origin);
    if (!u.pathname.startsWith('/api/')) return false;
    if (u.origin === window.location.origin) return true;
    // A static build may already address the configured absolute backend.
    const base = getApiBase();
    if (base) {
      try {
        return u.origin === new URL(base).origin;
      } catch {
        return false;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function _mergeHeaders(init: RequestInit | undefined, extras: Record<string, string>): Headers {
  const h = new Headers(init?.headers || {});
  for (const [k, v] of Object.entries(extras)) {
    if (!h.has(k)) h.set(k, v);
  }
  return h;
}

/**
 * Install the identity-aware fetch wrapper on the global ``window.fetch``.
 *
 * Idempotent — calling more than once is a no-op.
 */
export function installIdentityHeaders(): void {
  if (_installed || typeof window === 'undefined') return;
  _installed = true;

  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    if (!_isApiRequest(url)) {
      return original(input, init);
    }

    const base = getApiBase();
    const crossOrigin = base !== '';

    const ident = await _getIdentity(original);
    const ws = localStorage.getItem(LS_WORKSPACE_KEY) || ident?.workspace_id;

    const extras: Record<string, string> = {};
    if (ident?.tenant_id) extras['X-Tenant-ID'] = ident.tenant_id;
    if (ws) extras['X-Workspace-ID'] = ws;
    // X-User-ID / X-User-Role are identity CLAIMS, and a claim the caller writes
    // is not identity -- it is a request. They are therefore SAME-ORIGIN ONLY.
    //
    // Cross-origin the request already carries `credentials: 'include'`, so the
    // session cookie travels and the server derives the user from a token it
    // verified. Sending the claims as well adds nothing and costs two things:
    //
    //  1. SECURITY. Several platform routes read `x-user-id` as the answer --
    //     lockbox/me, secrets/me, admin/lockbox, files/list, settings/filesystem
    //     (measured 2026-09-02). Those are personal secrets and files. The only
    //     thing keeping a browser away from them cross-origin is that
    //     `X-User-ID` is absent from proxy.ts's Access-Control-Allow-Headers --
    //     so "just allow the header so the panels work" is the one-line fix that
    //     turns a source-level defect into a reachable one. Not sending it means
    //     that list never has to grow, and the block is structural rather than
    //     a denylist someone widens later under deadline.
    //  2. THE PANELS. A preflight naming ANY header the target does not allow
    //     fails WHOLESALE, so one un-allowed name blocked every platform API
    //     call from every tenant origin. Measured on dgg.aitherium.com the same
    //     day: 10/10 workspace routes crashed, 24 calls CORS-blocked, and the
    //     visible symptom was a react-418 hydration mismatch -- which reads as a
    //     frontend rendering bug, naming nothing about CORS or auth.
    //
    // X-Workspace-ID and X-User-TZ stay: neither asserts WHO the caller is. The
    // workspace is a SCOPE the server must still authorize against the session
    // (proxy.ts gates nothing on it), and the timezone is inert display data.
    if (!crossOrigin) {
      if (ident?.user_id) extras['X-User-ID'] = ident.user_id;
      if (ident?.role) extras['X-User-Role'] = ident.role;
    }
    // Browser-detected IANA timezone so the backend can resolve "today" /
    // "tomorrow" in the user's local time instead of UTC.
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) extras['X-User-TZ'] = tz;
    } catch { /* old browsers */ }

    // Static-hosted build → rewrite relative /api/* onto the absolute backend
    // and send credentials so cookie/SSO auth survives the cross-origin hop.
    // No base configured → no rewrite, same-origin behaviour preserved exactly.
    let finalInput: RequestInfo | URL = input;
    if (crossOrigin) {
      const rewritten = rewriteApiUrl(url, base);
      if (rewritten !== url) {
        finalInput = (typeof input === 'string' || input instanceof URL)
          ? rewritten
          : new Request(rewritten, input);
      }
    }

    const rewrote = finalInput !== input;
    if (Object.keys(extras).length === 0 && !rewrote && !crossOrigin) {
      return original(input, init);
    }

    const headers = _mergeHeaders(init, extras);
    const credentials: RequestCredentials = init?.credentials || (crossOrigin ? 'include' : 'same-origin');
    return original(finalInput, { ...(init || {}), headers, credentials });
  };
}

/** Override the active workspace for subsequent /api/ requests. */
export function setActiveWorkspace(workspaceId: string | null): void {
  if (typeof window === 'undefined') return;
  if (workspaceId) localStorage.setItem(LS_WORKSPACE_KEY, workspaceId);
  else localStorage.removeItem(LS_WORKSPACE_KEY);
}

/** Get the workspace ID currently used for header injection. */
export function getActiveWorkspace(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(LS_WORKSPACE_KEY) || _cached?.workspace_id || null;
}

/** Force a refresh of the cached identity payload (call after login/logout). */
export function refreshIdentity(): void {
  _cached = null;
  _inflight = null;
}

/** Get the cached identity (without triggering a fetch). */
export function getCachedIdentity(): Identity | null {
  return _cached;
}
