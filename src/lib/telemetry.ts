/**
 * Client telemetry + debug-bundle capture for portal-kit tenant apps.
 *
 * Portal-kit's SupportWidget has always promised "logs captured automatically",
 * but nothing ever populated `window.__aither_error_buffer` — so every bug
 * report shipped with an empty diagnostics block. This module is the missing
 * producer: it traps console errors, uncaught errors, and network calls into
 * rolling buffers, and assembles them (plus page/performance/state context)
 * into a single debug bundle that developers and customers can attach to
 * feedback or capture on demand while testing a preview deployment.
 *
 * Design constraints:
 * - SSR-safe: every entry point no-ops when `window` is undefined.
 * - Zero external dependencies.
 * - Idempotent install (safe to call from app root AND from a widget mount).
 * - Never throws into the host app — instrumentation must not break the page.
 * - Network URLs are query-stripped before storage so tokens in query strings
 *   are never captured.
 *
 * Usage (recommended at app root, e.g. in PortalShell / _app):
 *   import { installTelemetry } from '@aitherium/awkit'
 *   installTelemetry()
 *
 * On demand:
 *   import { captureDebugBundle, submitDebugBundle } from '@aitherium/awkit'
 *   const bundle = captureDebugBundle({ note: 'chat returned wrong answer' })
 *   await submitDebugBundle('', { note: 'chat returned wrong answer' })
 */

const MAX_ERRORS = 50
const MAX_NETWORK = 50

/** A single captured network request (bodies + headers are intentionally NOT captured). */
export interface NetworkLogEntry {
  method: string
  url: string
  status: number | null
  ok: boolean
  durationMs: number
  ts: string
  error?: string
}

/** Navigation-Timing derived metrics. Keys match what portal-kit-backend/routers/support.py formats. */
export interface PerformanceSnapshot {
  ttfb_ms: number | null
  dom_load_ms: number | null
  load_ms: number | null
  heap_mb: number | null
}

/** The full diagnostic snapshot posted to /api/debug/bundle and attached to feedback. */
export interface DebugBundle {
  capturedAt: string
  pageUrl: string
  referrer: string
  userAgent: string
  language: string
  viewport: string
  screen: string
  timezone: string
  consoleErrors: string[]
  network: NetworkLogEntry[]
  performance: PerformanceSnapshot | null
  state: {
    localStorageKeys: string[]
    sessionStorageKeys: string[]
  }
  /** Optional caller-supplied context (app name, note, feature flags, current route, …). */
  [extra: string]: unknown
}

interface TelemetryGlobals {
  __aither_error_buffer?: string[]
  __aither_network_buffer?: NetworkLogEntry[]
  __aither_telemetry_installed?: boolean
}

function w(): (Window & typeof globalThis & TelemetryGlobals) | null {
  return typeof window === 'undefined' ? null : (window as unknown as Window & typeof globalThis & TelemetryGlobals)
}

function errorBuffer(): string[] {
  const win = w()
  if (!win) return []
  if (!Array.isArray(win.__aither_error_buffer)) win.__aither_error_buffer = []
  return win.__aither_error_buffer
}

function networkBuffer(): NetworkLogEntry[] {
  const win = w()
  if (!win) return []
  if (!Array.isArray(win.__aither_network_buffer)) win.__aither_network_buffer = []
  return win.__aither_network_buffer
}

function pushCapped<T>(buf: T[], item: T, max: number): void {
  buf.push(item)
  if (buf.length > max) buf.splice(0, buf.length - max)
}

function stringifyArg(a: unknown): string {
  if (a instanceof Error) return `${a.name}: ${a.message}`
  if (typeof a === 'string') return a
  try {
    return JSON.stringify(a)
  } catch {
    return String(a)
  }
}

/** Strip query string + hash so credentials in URLs are never stored. */
function stripUrl(raw: string): string {
  try {
    const u = new URL(raw, w()?.location?.href || 'http://local/')
    return u.origin + u.pathname
  } catch {
    return raw.split('?')[0].split('#')[0]
  }
}

/** Our own capture endpoint — don't log calls to it (avoids self-referential noise). */
function isInstrumentationUrl(url: string): boolean {
  return url.includes('/api/debug/bundle')
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Install telemetry traps. Idempotent and SSR-safe. Returns an uninstall
 * function (best-effort — the console/network wrappers stay but stop recording).
 */
export function installTelemetry(): () => void {
  const win = w()
  if (!win || win.__aither_telemetry_installed) return () => {}
  win.__aither_telemetry_installed = true

  let active = true

  // ── Console errors/warnings ──
  const origError = win.console.error.bind(win.console)
  const origWarn = win.console.warn.bind(win.console)
  win.console.error = (...args: unknown[]) => {
    if (active) {
      try {
        pushCapped(errorBuffer(), `[error] ${args.map(stringifyArg).join(' ')}`, MAX_ERRORS)
      } catch { /* never break console */ }
    }
    origError(...args)
  }
  win.console.warn = (...args: unknown[]) => {
    if (active) {
      try {
        pushCapped(errorBuffer(), `[warn] ${args.map(stringifyArg).join(' ')}`, MAX_ERRORS)
      } catch { /* never break console */ }
    }
    origWarn(...args)
  }

  // ── Uncaught errors + promise rejections ──
  const onError = (e: ErrorEvent) => {
    if (!active) return
    const where = e.filename ? ` (${stripUrl(e.filename)}:${e.lineno})` : ''
    pushCapped(errorBuffer(), `[uncaught] ${e.message}${where}`, MAX_ERRORS)
  }
  const onRejection = (e: PromiseRejectionEvent) => {
    if (!active) return
    pushCapped(errorBuffer(), `[unhandledrejection] ${stringifyArg(e.reason)}`, MAX_ERRORS)
  }
  win.addEventListener('error', onError)
  win.addEventListener('unhandledrejection', onRejection)

  // ── fetch wrapper ──
  const origFetch = win.fetch ? win.fetch.bind(win) : null
  if (origFetch) {
    win.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const method = (init?.method || (typeof input !== 'string' && !(input instanceof URL) ? input.method : '') || 'GET').toUpperCase()
      const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const url = stripUrl(rawUrl)
      const start = win.performance?.now?.() ?? 0
      if (!active || isInstrumentationUrl(url)) return origFetch(input, init)
      try {
        const res = await origFetch(input, init)
        pushCapped(networkBuffer(), {
          method, url, status: res.status, ok: res.ok,
          durationMs: Math.round(((win.performance?.now?.() ?? 0) - start)), ts: nowIso(),
        }, MAX_NETWORK)
        return res
      } catch (err) {
        pushCapped(networkBuffer(), {
          method, url, status: null, ok: false,
          durationMs: Math.round(((win.performance?.now?.() ?? 0) - start)), ts: nowIso(),
          error: stringifyArg(err),
        }, MAX_NETWORK)
        throw err
      }
    }
  }

  // ── XMLHttpRequest wrapper ──
  const XHR = win.XMLHttpRequest
  if (XHR && XHR.prototype) {
    const origOpen = XHR.prototype.open
    const origSend = XHR.prototype.send
    origOpen && (XHR.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      try {
        (this as unknown as { __aither_meta?: { method: string; url: string; start: number } }).__aither_meta = {
          method: (method || 'GET').toUpperCase(),
          url: stripUrl(typeof url === 'string' ? url : url.href),
          start: 0,
        }
      } catch { /* ignore */ }
      // @ts-expect-error — passthrough to native open with original args
      return origOpen.call(this, method, url, ...rest)
    })
    origSend && (XHR.prototype.send = function (this: XMLHttpRequest, ...args: unknown[]) {
      const meta = (this as unknown as { __aither_meta?: { method: string; url: string; start: number } }).__aither_meta
      if (active && meta && !isInstrumentationUrl(meta.url)) {
        meta.start = win.performance?.now?.() ?? 0
        this.addEventListener('loadend', () => {
          try {
            pushCapped(networkBuffer(), {
              method: meta.method, url: meta.url,
              status: this.status || null, ok: this.status >= 200 && this.status < 400,
              durationMs: Math.round(((win.performance?.now?.() ?? 0) - meta.start)), ts: nowIso(),
            }, MAX_NETWORK)
          } catch { /* ignore */ }
        })
      }
      // @ts-expect-error — passthrough to native send with original args
      return origSend.apply(this, args)
    })
  }

  return () => {
    active = false
    win.removeEventListener('error', onError)
    win.removeEventListener('unhandledrejection', onRejection)
  }
}

function perfSnapshot(): PerformanceSnapshot | null {
  const win = w()
  if (!win || !win.performance) return null
  try {
    const nav = win.performance.getEntriesByType?.('navigation')?.[0] as PerformanceNavigationTiming | undefined
    const mem = (win.performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    const heap_mb = mem ? Math.round((mem.usedJSHeapSize / 1048576) * 10) / 10 : null
    if (!nav) return { ttfb_ms: null, dom_load_ms: null, load_ms: null, heap_mb }
    const round = (n: number) => (Number.isFinite(n) && n >= 0 ? Math.round(n) : null)
    return {
      ttfb_ms: round(nav.responseStart - nav.startTime),
      dom_load_ms: round(nav.domContentLoadedEventEnd - nav.startTime),
      load_ms: round(nav.loadEventEnd - nav.startTime),
      heap_mb,
    }
  } catch {
    return null
  }
}

function storageKeys(store: Storage | undefined): string[] {
  if (!store) return []
  try {
    return Object.keys(store).slice(0, 100)
  } catch {
    return []
  }
}

/**
 * Assemble a debug bundle from the current page state + captured buffers.
 * `extra` is merged in shallowly (app name, note, current route, feature flags, …).
 */
export function captureDebugBundle(extra?: Record<string, unknown>): DebugBundle {
  const win = w()
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  const bundle: DebugBundle = {
    capturedAt: nowIso(),
    pageUrl: win?.location?.href || '',
    referrer: typeof document !== 'undefined' ? document.referrer : '',
    userAgent: nav?.userAgent || '',
    language: nav?.language || '',
    viewport: win ? `${win.innerWidth}x${win.innerHeight}` : '',
    screen: typeof screen !== 'undefined' ? `${screen.width}x${screen.height}` : '',
    timezone: (() => {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { return '' }
    })(),
    consoleErrors: errorBuffer().slice(-MAX_ERRORS),
    network: networkBuffer().slice(-MAX_NETWORK),
    performance: perfSnapshot(),
    state: {
      localStorageKeys: storageKeys(win?.localStorage),
      sessionStorageKeys: storageKeys(win?.sessionStorage),
    },
  }
  if (extra) Object.assign(bundle, extra)
  return bundle
}

export interface SubmitBundleResult {
  ok: boolean
  artifact_id?: string
  download_url?: string
  error?: string
}

/**
 * Capture a bundle and POST it to the tenant app's /api/debug/bundle store.
 * Never throws — returns `{ ok: false, error }` on failure so callers can
 * surface a message instead of crashing.
 */
export async function submitDebugBundle(
  apiBase: string = '',
  extra?: Record<string, unknown>,
): Promise<SubmitBundleResult> {
  try {
    const bundle = captureDebugBundle(extra)
    const res = await fetch(`${apiBase}/api/debug/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundle),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const data = await res.json()
    return { ok: data.ok !== false, artifact_id: data.artifact_id, download_url: data.download_url }
  } catch (err) {
    return { ok: false, error: stringifyArg(err) }
  }
}
