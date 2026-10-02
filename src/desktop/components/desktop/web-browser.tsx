'use client'

/**
 * Web Browser — the AitherBrowser REMOTE session, rendered as a live screenshot.
 * ==============================================================================
 *
 * This app does NOT embed a third-party page in an iframe (the old shape: a bare
 * <iframe> pointed at a third-party search engine, which most sites refuse to be
 * framed by and which sent every query off-platform). It drives a server-side
 * browser session and paints what that session sees:
 *
 *   POST   /api/browser-session            -> { sessionId, url, title, engine, screenshot }
 *   POST   /api/browser-session/<sid>/act  -> { ok, url, title, screenshot }
 *   GET    /api/browser-session/<sid>      -> { url, title, screenshot, engine }
 *   DELETE /api/browser-session/<sid>      -> { ok }
 *
 * `screenshot` is base64 JPEG with no `data:` prefix, and every response that carries
 * a view returns `url`, `title` and `screenshot` TOGETHER — so there is never a second
 * fetch just to learn where we are.
 *
 * THREE STATES THAT ARE NOT ERRORS, AND EACH GETS ITS OWN RENDER:
 *
 *   401  The routes REQUIRE authentication, because the upstream scopes a session to
 *        its caller — unauthenticated, every anonymous visitor would collapse into one
 *        owner key and could drive each other's sessions. So this is "sign in to
 *        browse", with its own panel and its own icon, not a blank pane.
 *   404  from `act`/`GET` means the session was reaped, expired, or is not ours. We
 *        offer Reopen. We do NOT retry silently — a silent retry on a session that is
 *        gone is indistinguishable from a hang.
 *   ''   `POST /api/browser-session` with no `url` deliberately answers with empty
 *        `url`/`title`/`screenshot`: a session that has not navigated has nothing to
 *        show. That is the new-tab state, not a failure, and rendering it as an error
 *        would be this file crying wolf at its own contract.
 *
 * Search goes to AitherSearch (`POST /api/search/query`) and the results are drawn
 * HERE, in our own list. There is no third-party search engine anywhere in this file.
 *
 * Two rules this file is deliberate about:
 *
 *  1. NOTHING FAILS SILENTLY. Every request renders its outcome — a spinner while it
 *     is in flight, a latency number when it lands, and a banner naming the failure
 *     when it does not. A 404 from `act` means the remote session was reaped, which
 *     is a normal end of life and is shown as "session closed — Reopen", never as a
 *     hang. A 200 that carries no screenshot is also reported; a blank pane is not an
 *     acceptable way to say "something went wrong".
 *
 *  2. THE ENGINE IS CREDITED, VISIBLY. The session reports which engine served it;
 *     when that is `obscura` the chip links to the upstream project and names its
 *     licence. That is an attribution surface, not decoration.
 *
 * The app is served from a static export, so every call is a RELATIVE `/api/...`
 * fetch — the same idiom the sibling desktop widgets use. No hostname is hardcoded.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react'
import {
  Globe, ArrowLeft, ArrowRight, RotateCw, Home, Star, Plus, X,
  Search, Lock, Loader2, AlertTriangle, Keyboard, Bookmark,
  ChevronUp, ChevronDown, ExternalLink, Link2, LogIn
} from 'lucide-react'
import { toast } from 'sonner'

// ============================================================================
// TYPES
// ============================================================================

type ActionName =
  | 'goto' | 'click_xy' | 'fill' | 'press' | 'scroll' | 'back' | 'forward' | 'reload'

interface ActBody {
  action: ActionName
  /** click_xy only: ABSOLUTE viewport CSS px. */
  x?: number
  y?: number
  /**
   * scroll only: a WHEEL DELTA in px. Separate keys from x/y on purpose — the
   * route accepts x/y as aliases here, but one pair of keys carrying two meanings
   * is what let a wheel delta be silently dropped upstream in the first place.
   */
  dx?: number
  dy?: number
  selector?: string
  value?: string
}

interface SearchResult {
  title: string
  url: string
  snippet: string
  source?: string
}

interface Viewport { width: number; height: number }

interface BrowserTab {
  id: string
  title: string
  url: string
  /** null until the session is opened lazily on the first navigation. */
  sessionId: string | null
  engine: string | null
  /** base64 JPEG, no data: prefix. null means "nothing to paint" — and we say why. */
  screenshot: string | null
  /** The REMOTE viewport in CSS px. Click coordinates are expressed in this space. */
  viewport: Viewport
  loading: boolean
  /** Label of the in-flight action, shown to the user. */
  busy: string | null
  /** Rendered, never swallowed. */
  error: string | null
  sessionLost: boolean
  /** 401 from the session routes. A real state with its own panel, not a blank pane. */
  authRequired: boolean
  view: 'idle' | 'page' | 'results'
  results: SearchResult[]
  query: string
  latencyMs: number | null
}

interface BookmarkItem {
  title: string
  url: string
}

// ============================================================================
// DEFAULTS
// ============================================================================

/** Home is ours. It is not a search engine. */
const HOME_PAGE = 'https://aitherium.com'

/**
 * v2 key on purpose: the v1 defaults shipped third-party search engines, and a
 * returning user's localStorage would resurrect them however this file is written.
 */
const BOOKMARKS_KEY = 'aitheros-browser-bookmarks-v2'

const DEFAULT_BOOKMARKS: BookmarkItem[] = [
  { title: 'Aitherium', url: 'https://aitherium.com' },
  { title: 'AitherOS Docs', url: 'https://aitherium.com/docs' },
  { title: 'GitHub', url: 'https://github.com' },
  { title: 'HuggingFace', url: 'https://huggingface.co' },
  { title: 'Stack Overflow', url: 'https://stackoverflow.com' },
  { title: 'MDN', url: 'https://developer.mozilla.org' },
]

const DEFAULT_VIEWPORT: Viewport = { width: 1280, height: 800 }
const VIEWPORT_MIN: Viewport = { width: 480, height: 360 }
const VIEWPORT_MAX: Viewport = { width: 1920, height: 1200 }

/** Wheel events are coalesced to this cadence so one flick is not fifty round trips. */
const SCROLL_COALESCE_MS = 180
const SCROLL_BUTTON_STEP = 480

/**
 * Engines we can credit by name. An engine we do not recognise is still SHOWN —
 * an unrecognised engine is information, not a reason to render nothing.
 */
const ENGINE_CREDITS: Record<string, { label: string; href: string; licence: string }> = {
  obscura: {
    label: 'Obscura',
    href: 'https://github.com/h4ckf0r0day/obscura',
    licence: 'Apache-2.0',
  },
}

/** Non-printable keys we forward verbatim; the names match the remote key syntax. */
const FORWARDED_KEYS = new Set([
  'Enter', 'Tab', 'Escape', 'Backspace', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown',
])

// ============================================================================
// HELPERS
// ============================================================================

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)

/**
 * URL or search? Returns the URL when the input is one, and null when it should be
 * handed to AitherSearch. Deliberately conservative: "how do i x" has spaces and is
 * a search; "example.com/foo" is a URL.
 */
function asUrl(input: string): string | null {
  const u = input.trim()
  if (!u) return null
  if (/^https?:\/\//i.test(u)) return u
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return u
  if (u.includes(' ')) return null
  if (/^[^\s/@]+\.[a-z]{2,}([/?#:]|$)/i.test(u)) return 'https://' + u
  return null
}

function hostLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') || url } catch { return url }
}

async function readJson(res: Response): Promise<any> {
  try { return await res.json() } catch { return null }
}

function detailOf(data: any, res: Response): string {
  if (data && typeof data.detail === 'string' && data.detail) return data.detail
  return `HTTP ${res.status}${res.statusText ? ' ' + res.statusText : ''}`
}

/**
 * Every response that carries a view returns `url`, `title` and `screenshot`
 * TOGETHER, so one read is enough and there is never a follow-up fetch to learn
 * where we are. An empty `screenshot` is not an error on its own: `POST
 * /api/browser-session` with no `url` deliberately answers
 * `{sessionId, url:'', title:'', screenshot:''}` — a session that has not navigated
 * yet has nothing to show, and that is the new-tab state, not a failure.
 */
function viewOf(data: any): { url: string; title: string; shot: string | null } {
  const url = typeof data?.url === 'string' ? data.url : ''
  const title = typeof data?.title === 'string' ? data.title : ''
  const raw = typeof data?.screenshot === 'string' ? data.screenshot : ''
  return { url, title, shot: raw.length ? raw : null }
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  return typeof e === 'string' ? e : 'Unknown error'
}

let tabSeq = 0
function newTabRecord(): BrowserTab {
  tabSeq += 1
  return {
    id: `tab-${Date.now()}-${tabSeq}`,
    title: 'New Tab',
    url: '',
    sessionId: null,
    engine: null,
    screenshot: null,
    viewport: { ...DEFAULT_VIEWPORT },
    loading: false,
    busy: null,
    error: null,
    sessionLost: false,
    authRequired: false,
    view: 'idle',
    results: [],
    query: '',
    latencyMs: null,
  }
}

/** Best-effort teardown. `keepalive` so it survives an unmount / window close. */
function releaseSession(sessionId: string | null) {
  if (!sessionId) return
  try {
    void fetch(`/api/browser-session/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      keepalive: true,
    }).catch(() => { /* teardown is best-effort; the server TTL is the backstop */ })
  } catch { /* same */ }
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * What a host may render beside the page, and the only two things it gets.
 *
 * The slot exists because of the merge. The old `aitherbrowser` desktop app
 * carried the AitherSpaces verify sidebar and this one did not, so retiring
 * that app without giving the sidebar a home would have DELETED a gated
 * feature (ABV001) while every test still passed.
 *
 * It is a SLOT rather than an import because desktop-core is the shared shell
 * TENANTS build against, and that sidebar reaches `@/lib/space-envelope`,
 * `@/lib/live-api` and `@/lib/spaces-url` -- platform modules that live in
 * AitherVeil. Copying them down here compiles nothing (they are not vendored,
 * which is the TP015 shape) and vendoring them pushes platform coupling onto
 * every tenant. So the platform passes the sidebar IN, and this package goes
 * on knowing nothing about Spaces.
 */
export interface BrowserSidebarContext {
    /** The URL the live session is showing right now. */
    url: string
    /**
     * Run the AitherSpaces marker probe in the live session.
     *
     * Upstream this reaches `eval`, and it is reachable here ONLY as the NAMED
     * action `detect-space`, whose script is a frozen constant chosen by
     * `browser-session.ts` -- never anything a caller supplies. That is why the
     * slot hands over a NILADIC function rather than a script parameter: a
     * sidebar cannot widen the action surface, whatever anyone passes it.
     *
     * Resolves to the probe's value, or null when there is no session, the page
     * refuses evaluation, or the request fails. A page that refuses evaluation
     * is not a Space we can detect this way, which is not an error.
     */
    detectSpace: () => Promise<unknown>
}

export function WebBrowser({ className = '', renderSidebar }: {
    className?: string
    renderSidebar?: (ctx: BrowserSidebarContext) => React.ReactNode
}) {
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [newTabRecord()])
  const [activeTab, setActiveTab] = useState<string>('')
  const [urlInput, setUrlInput] = useState('')
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(() => {
    try {
      const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(BOOKMARKS_KEY) : null
      const parsed = stored ? JSON.parse(stored) : null
      return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_BOOKMARKS
    } catch { return DEFAULT_BOOKMARKS }
  })
  const [showBookmarks, setShowBookmarks] = useState(true)
  const [showFill, setShowFill] = useState(false)
  const [fillSelector, setFillSelector] = useState('')
  const [fillValue, setFillValue] = useState('')

  const paneRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<BrowserTab[]>(tabs)
  const activeRef = useRef<string>('')
  const wheelRef = useRef<{ dx: number; dy: number; timer: ReturnType<typeof setTimeout> | null }>(
    { dx: 0, dy: 0, timer: null }
  )

  useEffect(() => { tabsRef.current = tabs }, [tabs])
  useEffect(() => { activeRef.current = activeTab }, [activeTab])

  // The first tab's id is generated in the state initializer, so adopt it once.
  useEffect(() => {
    if (!activeTab && tabs.length) setActiveTab(tabs[0].id)
  }, [activeTab, tabs])

  const tab = tabs.find(t => t.id === activeTab) || tabs[0]

  useEffect(() => {
    try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks)) } catch { /* private mode */ }
  }, [bookmarks])

  // Release every remote session when the app closes. Without this, a closed window
  // leaves a real browser process running on the server until its TTL expires.
  useEffect(() => () => {
    for (const t of tabsRef.current) releaseSession(t.sessionId)
  }, [])

  const getTab = useCallback((id: string) => tabsRef.current.find(t => t.id === id), [])

  const patch = useCallback((id: string, p: Partial<BrowserTab>) => {
    setTabs(prev => prev.map(t => (t.id === id ? { ...t, ...p } : t)))
  }, [])

  /**
   * The remote viewport is fixed at session-open time from the pane we have RIGHT
   * NOW. The act contract carries no resize action, so a later window resize changes
   * how large the screenshot is DRAWN but not the coordinate space it is drawn in —
   * which is exactly why click mapping below scales against `tab.viewport` and never
   * against the rendered size or the image's natural size.
   */
  const measureViewport = useCallback((): Viewport => {
    const el = paneRef.current
    const w = el?.clientWidth || DEFAULT_VIEWPORT.width
    const h = el?.clientHeight || DEFAULT_VIEWPORT.height
    return {
      width: Math.round(clamp(w, VIEWPORT_MIN.width, VIEWPORT_MAX.width)),
      height: Math.round(clamp(h, VIEWPORT_MIN.height, VIEWPORT_MAX.height)),
    }
  }, [])

  // ── Session lifecycle ─────────────────────────────────────────────────

  const openSession = useCallback(async (tabId: string, url: string) => {
    const viewport = measureViewport()
    patch(tabId, {
      loading: true, busy: 'opening session', error: null, sessionLost: false,
      authRequired: false, view: 'page', url, viewport, title: hostLabel(url),
      screenshot: null,
    })
    if (tabId === activeRef.current) setUrlInput(url)
    const t0 = Date.now()
    try {
      const res = await fetch('/api/browser-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
        }),
      })
      const data = await readJson(res)
      if (res.status === 401) {
        // These routes scope a session to its authenticated caller on purpose —
        // unauthenticated, every visitor would collapse into one owner key and could
        // drive each other's sessions. So 401 is a real state with its own panel.
        patch(tabId, {
          loading: false, busy: null, sessionId: null, screenshot: null,
          authRequired: true, view: 'idle', latencyMs: Date.now() - t0,
          error: `${detailOf(data, res)} — sign in to browse.`,
        })
        return
      }
      if (!res.ok) {
        // 🚨 The open may have SUCCEEDED and only the first observe failed: the
        // route answers `{ sessionId, detail }` with the OBSERVE's status. A
        // client that treats every non-2xx as "nothing happened" throws that id
        // away — and a real browser process then sits on the server until its TTL,
        // uncloseable because nobody holds its id, while still counting against
        // the caller's 40-sessions-per-hour budget. So keep the id: it is what
        // makes the retry an observe rather than a second open, and what lets
        // unmount release it.
        const orphan = typeof data?.sessionId === 'string' && data.sessionId
          ? data.sessionId
          : null
        patch(tabId, {
          sessionId: orphan, screenshot: null,
          loading: false, busy: null, latencyMs: Date.now() - t0,
          error: orphan
            ? `The session opened but its first view did not come back: ${detailOf(data, res)}`
            : `Could not open a browser session: ${detailOf(data, res)}`,
        })
        return
      }
      const v = viewOf(data)
      const landed = v.url || url
      // A session opened with no first navigation answers with empty strings. That is
      // the new-tab state, not a failure — render home, never a blank image.
      const blank = !v.url && !v.shot
      patch(tabId, {
        sessionId: (data?.sessionId as string) || null,
        url: landed,
        title: v.title || (blank ? 'New Tab' : hostLabel(landed)),
        engine: (data?.engine as string) ?? null,
        screenshot: v.shot,
        loading: false, busy: null, sessionLost: false, authRequired: false,
        view: blank ? 'idle' : 'page',
        latencyMs: Date.now() - t0,
        error: (v.shot || blank)
          ? null
          : 'The session opened but returned no screenshot — nothing to paint yet.',
      })
      if (tabId === activeRef.current) setUrlInput(landed)
    } catch (e) {
      patch(tabId, {
        loading: false, busy: null, latencyMs: Date.now() - t0,
        error: `Could not open a browser session: ${errText(e)}`,
      })
    }
  }, [measureViewport, patch])

  /**
   * The marker probe, deliberately NOT routed through `act`.
   *
   * `act` patches tab state -- it flips `loading`, sets `busy`, and writes the
   * returned screenshot. This is a READ that the user did not ask for, fired
   * whenever the sidebar wants to know whether a page is a Space, so putting it
   * through `act` would make the browser flash "working" on somebody else's
   * schedule and could overwrite a fresher frame with a staler one.
   *
   * It swallows every failure into `null` on purpose: a page with no marker, a
   * page that refuses evaluation, an expired session and a network blip are all
   * "this is not a Space I can see", and none of them is worth interrupting the
   * user over. The sidebar renders nothing and that is the correct outcome.
   */
  const detectSpace = useCallback(async (): Promise<unknown> => {
    const t = getTab(activeTab)
    if (!t?.sessionId) return null
    try {
      const res = await fetch(
        `/api/browser-session/${encodeURIComponent(t.sessionId)}/act`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'detect-space' }),
        },
      )
      if (!res.ok) return null
      const data = await readJson(res)
      return (data as { result?: unknown } | null)?.result ?? null
    } catch {
      return null
    }
  }, [activeTab, getTab])

  const act = useCallback(async (tabId: string, body: ActBody, label: string) => {
    const t = getTab(tabId)
    if (!t) return
    if (!t.sessionId) {
      // Lazy open: the first navigation is what creates the session.
      if (body.action === 'goto' && body.value) { await openSession(tabId, body.value); return }
      patch(tabId, { error: 'No browser session is open — enter a URL to start one.' })
      return
    }
    patch(tabId, { loading: true, busy: label, error: null })
    const t0 = Date.now()
    try {
      const res = await fetch(`/api/browser-session/${encodeURIComponent(t.sessionId)}/act`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await readJson(res)
      if (res.status === 401) {
        patch(tabId, {
          loading: false, busy: null, sessionId: null, screenshot: null,
          authRequired: true, view: 'idle', latencyMs: Date.now() - t0,
          error: `${detailOf(data, res)} — sign in to browse.`,
        })
        return
      }
      if (res.status === 404) {
        // Reaped / expired / not ours. A normal end of life, and it is SAID, with a
        // way forward — not a hang and not a blank pane.
        patch(tabId, {
          loading: false, busy: null, sessionId: null, screenshot: null,
          sessionLost: true, latencyMs: Date.now() - t0,
          error: `${detailOf(data, res)} — the remote browser session is gone.`,
        })
        return
      }
      if (!res.ok) {
        // The route distinguishes "the act failed" from "the act RAN and the view
        // did not come back" (`ok: true` on a non-2xx). Collapsing those back into
        // one message would send whoever debugs it at the wrong half — and would
        // tell the user nothing happened when the page has in fact moved.
        const acted = data?.ok === true
        patch(tabId, {
          loading: false, busy: null, latencyMs: Date.now() - t0,
          error: acted
            ? `${label} ran, but the view did not come back: ${detailOf(data, res)} — press Reload.`
            : `${label} failed: ${detailOf(data, res)}`,
        })
        return
      }
      const v = viewOf(data)
      const landed = v.url || t.url
      patch(tabId, {
        url: landed,
        title: v.title || hostLabel(landed),
        screenshot: v.shot,
        loading: false, busy: null, view: 'page', authRequired: false,
        latencyMs: Date.now() - t0,
        error: v.shot ? null : 'That action ran but returned no screenshot.',
      })
      if (tabId === activeRef.current) setUrlInput(landed)
    } catch (e) {
      patch(tabId, {
        loading: false, busy: null, latencyMs: Date.now() - t0,
        error: `${label} failed: ${errText(e)}`,
      })
    }
  }, [getTab, openSession, patch])

  /**
   * GET the current view of a session we already hold. This is the recovery path
   * for "the session is alive but its view did not come back" — retrying with a
   * fresh `POST /api/browser-session` would open a SECOND session, orphan the
   * first, and spend two of the caller's 40 hourly opens to answer one question.
   *
   * Note the GET carries no `engine` (upstream `observe` returns url/title/
   * screenshot only), so this must not overwrite the engine the open reported —
   * doing so would blank the licence-attribution chip on every refresh.
   */
  const refresh = useCallback(async (tabId: string) => {
    const t = getTab(tabId)
    if (!t) return
    if (!t.sessionId) { await openSession(tabId, t.url || HOME_PAGE); return }
    patch(tabId, { loading: true, busy: 'observing', error: null })
    const t0 = Date.now()
    try {
      const res = await fetch(`/api/browser-session/${encodeURIComponent(t.sessionId)}`, {
        cache: 'no-store',
      })
      const data = await readJson(res)
      if (res.status === 401) {
        patch(tabId, {
          loading: false, busy: null, sessionId: null, screenshot: null,
          authRequired: true, view: 'idle', latencyMs: Date.now() - t0,
          error: `${detailOf(data, res)} — sign in to browse.`,
        })
        return
      }
      if (res.status === 404) {
        patch(tabId, {
          loading: false, busy: null, sessionId: null, screenshot: null,
          sessionLost: true, latencyMs: Date.now() - t0,
          error: `${detailOf(data, res)} — the remote browser session is gone.`,
        })
        return
      }
      if (!res.ok) throw new Error(detailOf(data, res))
      const v = viewOf(data)
      const landed = v.url || t.url
      patch(tabId, {
        url: landed,
        title: v.title || hostLabel(landed),
        screenshot: v.shot,
        loading: false, busy: null,
        view: v.shot ? 'page' : t.view,
        latencyMs: Date.now() - t0,
        error: v.shot ? null : 'The session answered with no screenshot.',
      })
      if (tabId === activeRef.current) setUrlInput(landed)
    } catch (e) {
      patch(tabId, {
        loading: false, busy: null, latencyMs: Date.now() - t0,
        error: `observe failed: ${errText(e)}`,
      })
    }
  }, [getTab, openSession, patch])

  // ── Search (AitherSearch, drawn by us) ────────────────────────────────

  const runSearch = useCallback(async (tabId: string, query: string) => {
    patch(tabId, {
      loading: true, busy: 'searching', error: null, view: 'results',
      query, results: [], title: query || 'Search',
    })
    const t0 = Date.now()
    try {
      const res = await fetch('/api/search/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, mode: 'quick', limit: 12 }),
      })
      const data = await readJson(res)
      if (!res.ok) throw new Error(detailOf(data, res))
      const results: SearchResult[] = Array.isArray(data?.results)
        ? (data.results as any[])
            .map((r): SearchResult => ({
              title: String(r?.title || r?.url || 'Untitled'),
              url: String(r?.url || ''),
              snippet: String(r?.snippet || ''),
              source: r?.source ? String(r.source) : undefined,
            }))
            .filter(r => !!r.url)
        : []
      patch(tabId, {
        results, loading: false, busy: null, latencyMs: Date.now() - t0,
        error: results.length ? null : `AitherSearch returned no results for "${query}".`,
      })
    } catch (e) {
      patch(tabId, {
        loading: false, busy: null, latencyMs: Date.now() - t0, results: [],
        error: `Search failed: ${errText(e)}`,
      })
    }
  }, [patch])

  // ── Navigation ────────────────────────────────────────────────────────

  const navigate = useCallback((raw: string, tabId: string = activeRef.current) => {
    const url = asUrl(raw)
    if (!url) { void runSearch(tabId, raw.trim()); return }
    setUrlInput(url)
    const t = getTab(tabId)
    if (!t || !t.sessionId) { void openSession(tabId, url); return }
    void act(tabId, { action: 'goto', value: url }, `goto ${hostLabel(url)}`)
  }, [act, getTab, openSession, runSearch])

  const submitUrl = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (!urlInput.trim()) return
    navigate(urlInput)
  }, [navigate, urlInput])

  const simpleAct = useCallback((action: 'back' | 'forward' | 'reload') => {
    const t = getTab(activeRef.current)
    if (!t) return
    if (!t.sessionId) {
      patch(t.id, { error: 'No browser session is open — enter a URL to start one.' })
      return
    }
    void act(t.id, { action }, action)
  }, [act, getTab, patch])

  const reopen = useCallback(() => {
    const t = getTab(activeRef.current)
    if (!t) return
    void openSession(t.id, t.url || HOME_PAGE)
  }, [getTab, openSession])

  // ── Remote input: click, scroll, keyboard ─────────────────────────────

  /**
   * Map a click on the DISPLAYED image to CSS px in the REMOTE viewport.
   * The image is drawn `w-full h-auto`, so its rendered box keeps the screenshot's
   * aspect ratio and there is no letterboxing to correct for — the ratio of the click
   * within the box IS the ratio within the remote page. (`object-contain` would have
   * introduced letterbox bands that silently offset every click.)
   */
  const onImageClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    const t = getTab(activeRef.current)
    if (!t || !t.sessionId) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const x = clamp(
      Math.round(((e.clientX - rect.left) / rect.width) * t.viewport.width),
      0, t.viewport.width - 1
    )
    const y = clamp(
      Math.round(((e.clientY - rect.top) / rect.height) * t.viewport.height),
      0, t.viewport.height - 1
    )
    void act(t.id, { action: 'click_xy', x, y }, `click ${x},${y}`)
  }, [act, getTab])

  const sendScroll = useCallback((dx: number, dy: number) => {
    const t = getTab(activeRef.current)
    if (!t || !t.sessionId) return
    const ix = Math.round(dx)
    const iy = Math.round(dy)
    // The route 400s a zero-zero scroll (it would move nothing), so do not send one.
    if (ix === 0 && iy === 0) return
    void act(t.id, { action: 'scroll', dx: ix, dy: iy }, `scroll ${iy}`)
  }, [act, getTab])

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const t = getTab(activeRef.current)
    if (!t || !t.sessionId || t.view !== 'page') return
    const w = wheelRef.current
    w.dx += e.deltaX
    w.dy += e.deltaY
    if (w.timer) return
    w.timer = setTimeout(() => {
      const { dx, dy } = w
      w.dx = 0; w.dy = 0; w.timer = null
      if (dx || dy) sendScroll(dx, dy)
    }, SCROLL_COALESCE_MS)
  }, [getTab, sendScroll])

  useEffect(() => () => { if (wheelRef.current.timer) clearTimeout(wheelRef.current.timer) }, [])

  /**
   * Keys go through `press`. A screenshot cannot tell us which element has focus, so
   * this does not pretend to know: each key is forwarded to whatever the remote page
   * has focused (click into a field first). Entering a value into a NAMED field is
   * the separate `fill` affordance below, where the user supplies the selector.
   */
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const t = getTab(activeRef.current)
    if (!t || !t.sessionId || t.view !== 'page') return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key
    if (k.length === 1 || FORWARDED_KEYS.has(k)) {
      e.preventDefault()
      void act(t.id, { action: 'press', value: k }, `press ${k}`)
    }
  }, [act, getTab])

  const submitFill = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    const t = getTab(activeRef.current)
    if (!t) return
    if (!fillSelector.trim()) {
      patch(t.id, { error: 'Fill needs a CSS selector naming the field to type into.' })
      return
    }
    void act(t.id, { action: 'fill', selector: fillSelector.trim(), value: fillValue }, `fill ${fillSelector.trim()}`)
  }, [act, fillSelector, fillValue, getTab, patch])

  // ── Tabs ──────────────────────────────────────────────────────────────

  const newTab = useCallback(() => {
    const rec = newTabRecord()
    setTabs(prev => [...prev, rec])
    setActiveTab(rec.id)
    setUrlInput('')
  }, [])

  // Computed from the ref rather than inside a setTabs updater: an updater must be
  // pure (StrictMode double-invokes it), and the version this replaced called
  // setActiveTab/setUrlInput from inside one.
  const closeTab = useCallback((id: string) => {
    const prev = tabsRef.current
    const idx = prev.findIndex(t => t.id === id)
    if (idx < 0) return
    releaseSession(prev[idx].sessionId)
    if (prev.length <= 1) {
      const rec = newTabRecord()
      setTabs([rec])
      setActiveTab(rec.id)
      setUrlInput('')
      return
    }
    const remaining = prev.filter(t => t.id !== id)
    setTabs(remaining)
    if (activeRef.current === id) {
      const next = remaining[Math.min(idx, remaining.length - 1)]
      setActiveTab(next.id)
      setUrlInput(next.url)
    }
  }, [])

  const switchTab = useCallback((id: string) => {
    setActiveTab(id)
    const t = getTab(id)
    if (t) setUrlInput(t.url)
  }, [getTab])

  // ── Bookmarks ─────────────────────────────────────────────────────────

  const isBookmarked = !!tab && !!tab.url && bookmarks.some(b => b.url === tab.url)

  const toggleBookmark = useCallback(() => {
    if (!tab || !tab.url) return
    if (isBookmarked) {
      setBookmarks(prev => prev.filter(b => b.url !== tab.url))
      toast.info('Bookmark removed')
    } else {
      setBookmarks(prev => [...prev, { title: tab.title || hostLabel(tab.url), url: tab.url }])
      toast.success('Bookmarked')
    }
  }, [isBookmarked, tab])

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════

  if (!tab) return null

  const credit = tab.engine ? ENGINE_CREDITS[tab.engine.toLowerCase()] : undefined

  return (
    <div className={`flex flex-col h-full bg-zinc-950 ${className}`}>
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-1 pt-1 bg-zinc-900/80 border-b border-zinc-800/40 overflow-x-auto scrollbar-none">
        {tabs.map(t => (
          <div key={t.id} onClick={() => switchTab(t.id)}
            className={`group flex items-center gap-1.5 px-2.5 py-1.5 rounded-t-lg text-xs cursor-pointer min-w-0 max-w-[160px] transition-colors ${
              t.id === activeTab ? 'bg-zinc-950 text-white' : 'text-zinc-500 hover:bg-zinc-800/40'
            }`}>
            {t.loading ? (
              <Loader2 className="w-3 h-3 animate-spin shrink-0 text-[#5EC9CC]" />
            ) : t.authRequired ? (
              <LogIn className="w-3 h-3 shrink-0 text-amber-500" />
            ) : t.error ? (
              <AlertTriangle className="w-3 h-3 shrink-0 text-amber-500" />
            ) : (
              <Globe className="w-3 h-3 shrink-0" />
            )}
            <span className="truncate">{t.title}</span>
            <button onClick={(e) => { e.stopPropagation(); closeTab(t.id) }}
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-white/10 rounded transition-opacity shrink-0"
              aria-label="Close tab">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        <button onClick={newTab}
          className="p-1 text-zinc-600 hover:text-zinc-300 hover:bg-white/5 rounded transition-colors shrink-0"
          aria-label="New tab">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Navigation bar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-zinc-900/50 border-b border-zinc-800/40">
        <button onClick={() => simpleAct('back')} disabled={!tab.sessionId}
          className="p-1 text-zinc-500 hover:text-zinc-300 disabled:opacity-30 rounded transition-colors"
          aria-label="Back">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button onClick={() => simpleAct('forward')} disabled={!tab.sessionId}
          className="p-1 text-zinc-500 hover:text-zinc-300 disabled:opacity-30 rounded transition-colors"
          aria-label="Forward">
          <ArrowRight className="w-4 h-4" />
        </button>
        <button onClick={() => (tab.sessionId ? simpleAct('reload') : navigate(tab.url || HOME_PAGE))}
          className="p-1 text-zinc-500 hover:text-zinc-300 rounded transition-colors"
          aria-label="Reload">
          <RotateCw className={`w-4 h-4 ${tab.loading ? 'animate-spin text-[#5EC9CC]' : ''}`} />
        </button>
        <button onClick={() => navigate(HOME_PAGE)}
          className="p-1 text-zinc-500 hover:text-zinc-300 rounded transition-colors"
          aria-label="Home">
          <Home className="w-4 h-4" />
        </button>

        {/* Address bar — a URL navigates the session, anything else searches AitherSearch */}
        <form onSubmit={submitUrl} className="flex-1 flex items-center">
          <div className="flex-1 flex items-center gap-1.5 bg-zinc-800/80 rounded-lg px-2.5 py-1.5 border border-zinc-700/40 focus-within:border-[#5EC9CC]/50 transition-colors">
            {tab.url.startsWith('https') ? (
              <Lock className="w-3 h-3 text-green-500 shrink-0" />
            ) : (
              <Globe className="w-3 h-3 text-zinc-600 shrink-0" />
            )}
            <input
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              placeholder="Search AitherSearch, or enter a URL"
              className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
              onFocus={e => e.target.select()}
              aria-label="Address and search bar"
            />
            <button type="submit" className="p-0.5 text-zinc-500 hover:text-zinc-300" aria-label="Go">
              <Search className="w-3 h-3" />
            </button>
          </div>
        </form>

        <button onClick={() => setShowFill(v => !v)} title="Type into a named field (CSS selector)"
          className={`p-1 rounded transition-colors ${showFill ? 'text-[#5EC9CC]' : 'text-zinc-500 hover:text-zinc-300'}`}
          aria-label="Type into a field">
          <Keyboard className="w-4 h-4" />
        </button>
        <button onClick={toggleBookmark}
          className={`p-1 rounded transition-colors ${isBookmarked ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}
          aria-label="Bookmark">
          <Star className={`w-4 h-4 ${isBookmarked ? 'fill-amber-400' : ''}`} />
        </button>
        <button onClick={() => setShowBookmarks(v => !v)}
          className={`p-1 rounded transition-colors ${showBookmarks ? 'text-[#5EC9CC]' : 'text-zinc-500 hover:text-zinc-300'}`}
          aria-label="Toggle bookmarks bar">
          <Bookmark className="w-4 h-4" />
        </button>
      </div>

      {/* Bookmarks bar */}
      {showBookmarks && (
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-zinc-800/30 bg-zinc-900/30 overflow-x-auto scrollbar-none">
          {bookmarks.map((b, i) => (
            <button key={`${b.url}-${i}`} onClick={() => navigate(b.url)}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors whitespace-nowrap shrink-0">
              <Globe className="w-3 h-3 shrink-0" />
              {b.title}
            </button>
          ))}
        </div>
      )}

      {/* Fill affordance — the one place we ask the user for DOM knowledge, because a
          screenshot cannot supply it and inventing it would be a lie. */}
      {showFill && (
        <form onSubmit={submitFill} className="flex items-center gap-1.5 px-2 py-1.5 border-b border-zinc-800/40 bg-zinc-900/60">
          <input value={fillSelector} onChange={e => setFillSelector(e.target.value)}
            placeholder="CSS selector, e.g. input[name=q]"
            className="w-56 bg-zinc-800/80 rounded px-2 py-1 text-xs text-white outline-none border border-zinc-700/40 focus:border-[#5EC9CC]/50 placeholder:text-zinc-600" />
          <input value={fillValue} onChange={e => setFillValue(e.target.value)}
            placeholder="text to type"
            className="flex-1 bg-zinc-800/80 rounded px-2 py-1 text-xs text-white outline-none border border-zinc-700/40 focus:border-[#5EC9CC]/50 placeholder:text-zinc-600" />
          <button type="submit" disabled={!tab.sessionId}
            className="px-2 py-1 rounded text-xs bg-[#5EC9CC]/80 hover:bg-[#7AD6D8] disabled:opacity-30 text-white transition-colors">
            Fill
          </button>
          <button type="button" disabled={!tab.sessionId}
            onClick={() => { if (tab.sessionId) void act(tab.id, { action: 'press', value: 'Enter' }, 'press Enter') }}
            className="px-2 py-1 rounded text-xs bg-zinc-700/70 hover:bg-zinc-700 disabled:opacity-30 text-zinc-200 transition-colors">
            Enter
          </button>
        </form>
      )}

      {/* Error banner — always rendered when there is something to say. */}
      {tab.error && (
        <div className="flex items-start gap-2 px-3 py-2 bg-amber-500/10 border-b border-amber-500/25 text-[12px] text-amber-200">
          {tab.authRequired
            ? <LogIn className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
          <span className="flex-1 break-words">{tab.error}</span>
          {tab.sessionLost && (
            <button onClick={reopen}
              className="shrink-0 px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 transition-colors">
              Reopen
            </button>
          )}
        </div>
      )}

      {/* Content pane, with the host's optional sidebar beside it. The pane keeps
          its own ref and sizing: click mapping scales against `tab.viewport`,
          which is measured from THIS element, so the sidebar must sit outside
          it or every click lands offset by the sidebar's width. */}
      <div className="flex-1 flex min-h-0">
      <div
        ref={paneRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
        className="flex-1 relative overflow-auto bg-zinc-900 outline-none focus:ring-1 focus:ring-[#5EC9CC]/40"
      >
        {tab.view === 'results' ? (
          // ── AitherSearch results, drawn by us ──────────────────────────
          <div className="p-4 max-w-3xl">
            <div className="flex items-center gap-2 mb-3 text-xs text-zinc-500">
              <Search className="w-3.5 h-3.5" />
              <span>
                AitherSearch &middot; {tab.results.length} result{tab.results.length === 1 ? '' : 's'} for &ldquo;{tab.query}&rdquo;
              </span>
            </div>
            {tab.results.map((r, i) => (
              <button key={`${r.url}-${i}`} onClick={() => navigate(r.url)}
                className="block w-full text-left mb-3 p-3 rounded-lg hover:bg-white/5 transition-colors group">
                <div className="text-[15px] text-[#5EC9CC] group-hover:underline truncate">{r.title}</div>
                <div className="flex items-center gap-1 text-[11px] text-green-500/80 truncate">
                  <Link2 className="w-3 h-3 shrink-0" />{r.url}
                </div>
                {r.snippet && <div className="mt-1 text-[13px] text-zinc-400 line-clamp-3">{r.snippet}</div>}
              </button>
            ))}
            {!tab.results.length && !tab.loading && !tab.error && (
              <div className="text-sm text-zinc-500">No results.</div>
            )}
          </div>
        ) : tab.screenshot ? (
          // ── The remote page ────────────────────────────────────────────
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:image/jpeg;base64,${tab.screenshot}`}
            onClick={onImageClick}
            alt={tab.title || 'Remote page'}
            draggable={false}
            className="block w-full h-auto cursor-crosshair select-none"
          />
        ) : (
          // ── Nothing to paint. Say which state we are in — never a bare blank. ──
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="text-center max-w-sm">
              <Globe className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
              {tab.loading ? (
                <p className="text-zinc-400 text-sm flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-[#5EC9CC]" />
                  {tab.busy || 'Working'}&hellip;
                </p>
              ) : tab.authRequired ? (
                <>
                  <p className="text-zinc-200 text-sm font-medium">Sign in to browse</p>
                  <p className="text-zinc-500 text-xs mt-1">
                    A remote browser session belongs to the account that opened it, so
                    browsing needs you signed in to AitherOS. Sign in, then try again.
                  </p>
                  <button onClick={() => navigate(tab.url || HOME_PAGE)}
                    className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#5EC9CC]/80 hover:bg-[#7AD6D8] text-white text-sm transition-colors">
                    <LogIn className="w-3.5 h-3.5" /> Try again
                  </button>
                  {/* the 401 path clears sessionId, so there is nothing to re-observe */}
                </>
              ) : tab.sessionLost ? (
                <>
                  <p className="text-zinc-400 text-sm">The remote session was closed.</p>
                  <button onClick={reopen}
                    className="mt-3 px-3 py-1.5 rounded bg-[#5EC9CC]/80 hover:bg-[#7AD6D8] text-white text-sm transition-colors">
                    Reopen {hostLabel(tab.url || HOME_PAGE)}
                  </button>
                </>
              ) : tab.error ? (
                <>
                  <p className="text-zinc-400 text-sm">Nothing was rendered — see the message above.</p>
                  <button
                    onClick={() => (tab.sessionId ? void refresh(tab.id) : navigate(tab.url || HOME_PAGE))}
                    className="mt-3 px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm transition-colors">
                    {tab.sessionId ? 'Retry the view' : 'Try again'}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-zinc-400 text-sm">No page open.</p>
                  <p className="text-zinc-600 text-xs mt-1">
                    Enter a URL to start a remote browser session, or type anything else to search AitherSearch.
                  </p>
                  <button onClick={() => navigate(HOME_PAGE)}
                    className="mt-3 px-3 py-1.5 rounded bg-[#5EC9CC]/80 hover:bg-[#7AD6D8] text-white text-sm transition-colors">
                    Open {hostLabel(HOME_PAGE)}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* In-flight badge over an existing screenshot: the old frame stays visible (so
            the page does not flash empty) but the app never looks idle. */}
        {tab.loading && tab.screenshot && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-950/85 border border-zinc-700/50 text-[11px] text-zinc-300">
            <Loader2 className="w-3 h-3 animate-spin text-[#5EC9CC]" />
            {tab.busy || 'working'}&hellip;
          </div>
        )}
      </div>
      {renderSidebar ? renderSidebar({ url: tab.url, detectSpace }) : null}
      </div>

      {/* Status bar — engine credit, session, latency, scroll */}
      <div className="flex items-center gap-2 px-2 py-1 bg-zinc-900/80 border-t border-zinc-800/40 text-[11px] text-zinc-500">
        {credit ? (
          <a href={credit.href} target="_blank" rel="noopener noreferrer"
            title={`Rendered by ${credit.label} — ${credit.licence}`}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800/70 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors shrink-0">
            <Globe className="w-3 h-3" />
            {credit.label}
            <span className="text-zinc-500">{credit.licence}</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        ) : tab.engine ? (
          <span className="px-1.5 py-0.5 rounded bg-zinc-800/70 text-zinc-300 shrink-0"
            title={`Rendered by ${tab.engine}`}>
            {tab.engine}
          </span>
        ) : (
          <span className="px-1.5 py-0.5 rounded bg-zinc-800/40 text-zinc-600 shrink-0">no session</span>
        )}

        <span className="truncate flex-1">
          {tab.sessionId
            ? `session ${tab.sessionId.slice(0, 8)} · ${tab.viewport.width}×${tab.viewport.height}`
            : 'remote session not started'}
        </span>

        {tab.busy && <span className="text-[#5EC9CC] shrink-0">{tab.busy}&hellip;</span>}
        {tab.latencyMs !== null && (
          <span className="shrink-0" title="Latency of the last request">{tab.latencyMs} ms</span>
        )}

        <button onClick={() => sendScroll(0, -SCROLL_BUTTON_STEP)}
          disabled={!tab.sessionId || tab.view !== 'page'}
          className="p-0.5 hover:text-zinc-300 disabled:opacity-30 transition-colors shrink-0" aria-label="Scroll up">
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => sendScroll(0, SCROLL_BUTTON_STEP)}
          disabled={!tab.sessionId || tab.view !== 'page'}
          className="p-0.5 hover:text-zinc-300 disabled:opacity-30 transition-colors shrink-0" aria-label="Scroll down">
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
