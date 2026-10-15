/**
 * Automatic error reports from a tenant workspace to its own backend's support intake.
 *
 * `installTelemetry()` traps uncaught errors and promise rejections into an in-memory
 * buffer that only travels when a person files a bug report. On a customer's workspace
 * that means the owner learns about a broken page only if the customer complains. This
 * module sends each DISTINCT uncaught error / unhandled rejection to
 * `POST {apiBase}/api/support/reports` (kind `error`, source `web`) with the recent
 * console lines, so the backend can dedupe it by stack and page the owner once.
 *
 * Constraints:
 * - Opt-in per host app (call `installErrorReporter()` where the backend serves the
 *   intake) and opt-out per browser: `localStorage['aither.support.autoReports'] = 'off'`.
 * - At most MAX_PER_PAGE reports per page load, each distinct (message + top frame) once.
 * - URLs are query/hash-stripped; obvious secrets (tokens, keys, e-mail) are scrubbed
 *   before sending — the backend scrubs again. Identity comes from the session cookie,
 *   never from this payload.
 * - A 401/403/404/405 from the intake disables the reporter for the page (the host has
 *   no intake or the person is signed out). Never throws into the host app.
 */

import { installTelemetry } from './telemetry'

export interface ErrorReporterOptions {
  /** API base ('' = same origin). */
  apiBase?: string
  /** Host app name, carried in `extra.app` for triage. */
  appName?: string
  /** App version string, if the host knows one. */
  appVersion?: string
  /** Override the intake path (default `/api/support/reports`). */
  endpoint?: string
  /** Test seam: the fetch to use (default window.fetch). */
  fetchImpl?: typeof fetch
}

export const AUTO_REPORTS_KEY = 'aither.support.autoReports'
const MAX_PER_PAGE = 5
const MAX_LOG_LINES = 30

interface ReporterGlobals {
  __aither_error_reporter?: { uninstall: () => void; report: (title: string, stack: string) => void }
  __aither_error_buffer?: string[]
}

const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]+/g,
  /sk-[A-Za-z0-9_-]{4,}/g,
  /gh[pousr]_[A-Za-z0-9_]+/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{4,}/g,
  /xox[abprs]-[A-Za-z0-9-]+/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
]

/** Remove obvious credentials, URL query secrets and e-mail addresses from a string. */
export function scrubClientText(value: string): string {
  let out = String(value ?? '')
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]')
  out = out.replace(/((?:password|secret|token|api[_-]?key|authorization)['"]?\s*[:=]\s*['"]?)[^\s'",}&]+/gi, '$1[REDACTED]')
  out = out.replace(/([?&](?:token|key|code|secret|sig|access_token|password)=)[^&\s#]+/gi, '$1[REDACTED]')
  out = out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL]')
  return out
}

function stripUrl(raw: string): string {
  return String(raw || '').split('?')[0].split('#')[0]
}

function autoReportsOff(): boolean {
  try {
    return window.localStorage?.getItem(AUTO_REPORTS_KEY) === 'off'
  } catch {
    return false
  }
}

/** Turn automatic error reports on/off for this browser (a settings toggle can call this). */
export function setAutoErrorReports(on: boolean): void {
  try {
    if (on) window.localStorage?.removeItem(AUTO_REPORTS_KEY)
    else window.localStorage?.setItem(AUTO_REPORTS_KEY, 'off')
  } catch { /* storage blocked: nothing to persist */ }
}

/**
 * Install the reporter. Idempotent and SSR-safe; returns an uninstall function.
 */
export function installErrorReporter(opts: ErrorReporterOptions = {}): () => void {
  if (typeof window === 'undefined') return () => {}
  const g = window as unknown as Window & ReporterGlobals
  if (g.__aither_error_reporter) return g.__aither_error_reporter.uninstall
  installTelemetry()

  const endpoint = `${(opts.apiBase || '').replace(/\/+$/, '')}${opts.endpoint || '/api/support/reports'}`
  const seen = new Set<string>()
  let sent = 0
  let disabled = false

  const send = (title: string, stack: string) => {
    if (disabled || autoReportsOff() || sent >= MAX_PER_PAGE) return
    const firstFrame = (stack.split('\n').find((l) => /^\s*at\s|@/.test(l)) || '').trim()
    const key = `${title}|${firstFrame}`
    if (seen.has(key)) return
    seen.add(key)
    sent += 1
    const logs = (g.__aither_error_buffer || []).slice(-MAX_LOG_LINES).map(scrubClientText)
    const body = {
      kind: 'error',
      source: 'web',
      title: scrubClientText(title).slice(0, 200),
      stack: scrubClientText(stack).slice(0, 16000),
      logs,
      page: stripUrl(window.location?.href || ''),
      app_version: opts.appVersion || '',
      runtime: (navigator?.userAgent || '').slice(0, 64),
      extra: { app: opts.appName || '' },
    }
    const f = opts.fetchImpl || window.fetch?.bind(window)
    if (!f) return
    const payload = JSON.stringify(body)
    try {
      Promise.resolve(f(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        // keepalive lets a report outlive a closing tab, but the browser refuses a
        // keepalive body over 64 KiB outright -- so only small reports use it.
        keepalive: payload.length < 60000,
      })).then((res) => {
        if (res && [401, 403, 404, 405].includes(res.status)) disabled = true
      }).catch(() => { /* offline: drop, the next distinct error tries again */ })
    } catch { /* never break the page */ }
  }

  const onError = (e: ErrorEvent) => {
    const err = e.error as Error | undefined
    const title = err ? `${err.name}: ${err.message}` : String(e.message || 'Script error')
    const stack = err?.stack || (e.filename ? `at ${stripUrl(e.filename)}:${e.lineno}:${e.colno}` : '')
    send(title, stack)
  }
  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason as { name?: string; message?: string; stack?: string } | string | undefined
    const title = typeof r === 'object' && r
      ? `Unhandled rejection: ${r.name || 'Error'}: ${r.message || ''}`
      : `Unhandled rejection: ${String(r)}`
    send(title, typeof r === 'object' && r?.stack ? r.stack : '')
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  const uninstall = () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    delete g.__aither_error_reporter
  }
  g.__aither_error_reporter = { uninstall, report: send }
  return uninstall
}

/**
 * Report an error a React error boundary caught (those never reach window.onerror in a
 * production build). No-op unless installErrorReporter() ran on this page.
 */
export function reportCaughtError(error: unknown, componentStack = ''): void {
  if (typeof window === 'undefined') return
  const r = (window as unknown as ReporterGlobals).__aither_error_reporter
  if (!r) return
  const e = error as { name?: string; message?: string; stack?: string } | undefined
  const title = e && typeof e === 'object' ? `Render error: ${e.name || 'Error'}: ${e.message || ''}` : `Render error: ${String(error)}`
  try {
    const stack = (e && typeof e === 'object' && e.stack) || ''
    r.report(title, componentStack ? `${stack}\n${componentStack}` : stack)
  } catch { /* never break the boundary */ }
}
