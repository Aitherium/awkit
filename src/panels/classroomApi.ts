/**
 * Aither Classroom client: typed fetch helpers + an EventSource helper over the
 * host app's classroom proxy (Veil: `/api/classroom/*` -> Genesis
 * `/api/v1/classroom/*`, routers/classroom*.py).
 *
 * Shaped after academyApi.ts. A failed call surfaces as a ClassroomHttpError
 * carrying the router's `detail` and status, so a panel can tell 404 (not yours /
 * not set up) from a failure and render "offline" instead of an empty list.
 *
 * The server derives every scope (teacher of record, linked parent, student self)
 * from the verified caller; this client never sends a tenant, user or student id
 * as authority, only path ids the server re-checks.
 */
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { C, EASE, FONT_MONO, FONT_UI, learnVars, useLearnMode, type LearnMode, type LearnModePref } from './learnTheme'

export const CLASSROOM_API = '/api/classroom'

export class ClassroomHttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Path segment encoder: an id can never walk the URL. */
export const cseg = (value: string): string => encodeURIComponent(value)

function detailOf(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const d = (body as { detail: unknown }).detail
    return typeof d === 'string' ? d : JSON.stringify(d)
  }
  return fallback
}

export async function classroomFetch<T>(
  apiBase: string,
  path: string,
  init?: RequestInit & { extraHeaders?: Record<string, string>; timeoutMs?: number },
): Promise<T> {
  // Every panel's skeleton is honest only if a request can SETTLE. Measured
  // 2026-10-06: during a multi-GB local image pull the edge left classroom
  // requests pending for minutes; the panels (correctly) render "offline" on
  // failure but a request that never settles is not a failure yet, so the
  // skeleton sat forever. The timeout turns "never answered" into a verdict.
  const { extraHeaders, timeoutMs = 25000, signal, ...rest } = init || {}
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${apiBase}${path}`, {
      credentials: 'same-origin',
      ...rest,
      signal: signal ?? ctl.signal,
      headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}), ...((rest.headers as Record<string, string>) || {}) },
    })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      throw new ClassroomHttpError(0, `no answer in ${Math.round(timeoutMs / 1000)}s — the fleet did not reach back. Retry.`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 204) return undefined as T
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  if (!res.ok) throw new ClassroomHttpError(res.status, detailOf(body, res.statusText || `HTTP ${res.status}`))
  return body as T
}

/** JSON body helper: `send(base, path, 'POST', {...})`. */
export function send<T>(apiBase: string, path: string, method: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  return classroomFetch<T>(apiBase, path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    extraHeaders,
  })
}

// ---------------------------------------------------------------------------
// Shapes (the routers' own field names)
// ---------------------------------------------------------------------------

export interface ConsentView {
  consent_recorded: boolean
  school_as_agent: boolean
  notice_sent_at?: string | null
  attested_by?: string | null
  attested_at?: string | null
  policy_version?: string | null
  checklist?: string[]
  banner?: string | null
}

export interface ClassroomClass {
  class_id: string
  name: string | null
  grade_level?: string | null
  subject?: string | null
  status?: string | null
  student_count?: number
  consent?: ConsentView
  /** A seeded demo class of fictional students (routers/classroom_demo.py). Never a real class.
   *  GET /classes and GET /classes/{id} carry it on every class, so each view can wear the mark. */
  demo?: boolean
}

export interface ParentLink { student_user_id: string; parent_user_id: string; verified_at?: string | null }

export interface RosterStudent {
  member_id: string
  student_user_id: string
  alias: string
  lid?: string | null
  joined_at?: string | null
  parents?: ParentLink[]
}

export interface Roster {
  class_id: string
  teachers: Array<{ user_id: string; role: string }>
  students: RosterStudent[]
}

export interface SheetStatus {
  has_sheet: boolean
  armed: boolean
  armed_until?: string | null
  printable: boolean
  class_name?: string | null
  students: Array<{ member_id: string; alias: string; url?: string; qr_svg_data_uri?: string }>
}

export interface Assignment {
  id: string
  class_id: string
  lesson_id?: string | null
  title?: string | null
  artifact_ids: string[]
  skill_ids: string[]
  student_member_id?: string | null
  due_at?: string | null
  created_at?: string
}

export interface HardNowRow {
  skill_id: string
  title: string
  area?: string | null
  status: 'ok' | 'too_few'
  attempts?: number
  error_rate?: number | null
  hints_per_attempt?: number | null
  latency_ratio?: number | null
  hard_share?: number | null
  students?: number
  students_affected?: number
  cites?: string[]
}

export interface HardNow { window_days: number; min_students: number; rows: HardNowRow[]; label?: string }

export interface ReviewItem {
  response_id: string
  student_id: string
  alias?: string | null
  challenge_title?: string | null
  standard?: string | null
  /** The machine score (0..1), provisional until the teacher confirms it. Null when no machine could score it. */
  auto_score?: number | null
  review_score?: number | null
  review_status: string
  flag: 'provisional' | 'needs_score'
  answer_text?: string | null
  /** question id -> the student's answer (academy `_response_out`). */
  answers?: Record<string, unknown> | null
}

/** DELETE /classes/{id}: `deleted` is 'partial' when a part could not be erased (lib/classroom/consent.py). */
export interface DeleteResult {
  deleted?: true | 'partial'
  identity_children_retained?: string[]
  errors?: Array<{ part: string; error?: string }>
}

export interface Lesson { id: string; topic: string; status: string; grade_level?: string | null; generation?: string }

// The demo class (routers/classroom_demo.py, lib/classroom/demo.py): one per teacher, fictional students only.
export interface DemoMark { label: string; statement: string }

export interface DemoView {
  demo: true
  class_id: string
  name: string
  seeded_at: string
  /** The practice is drifting out of the 14-day window; the next seed call rebuilds it. */
  stale: boolean
  mark: DemoMark
  /** What the demo holds, per view; null when the server could not count. */
  counts?: Record<string, number> | null
  /** The fictional student the caller is linked to as a demo parent, so the parent views show this class. */
  parent_view?: { student_user_id: string; member_id: string; alias: string; note?: string } | null
  identity_accounts_created?: number
}

/** GET /demo: `demo` is null when the caller has no demo class. */
export interface DemoStatus { demo: DemoView | null; class_ids: string[]; mark: DemoMark }

/** POST /demo/seed: 201 when built or rebuilt, 200 when the existing class came back untouched. */
export interface DemoSeedResult extends DemoView { created: boolean; refreshed: boolean; class: ClassroomClass }

/** DELETE /demo: `retained` names every record that stays (append-only) and why. */
export interface DemoRemoveResult extends DeleteResult {
  class_id: string
  retained: Array<{ what: string; rows: number; why: string }>
  identity_accounts_created?: number
}

export interface Observation { text: string; cites: string[]; label?: string }
export interface Insight { observations: Observation[]; source?: 'ai' | 'template' | string; label?: string }

export interface StudioPlan {
  title: string
  objective?: string
  warm_up?: string
  steps?: string[]
  check_for_understanding?: string[]
  materials?: string[]
}

export interface StudioTier { label: string; focus: string; activities: string[]; check: string }

export interface ClassEvent {
  type: string
  student_member_id?: string
  alias?: string
  skill_id?: string
  area?: string | null
  attempts?: number
  correct?: number
  hints?: number
  rating?: string | null
  text?: string | null
  held?: boolean
  at?: string
  cites?: string[]
}

export interface AreaMastery { mastery: number | null; skills: Array<{ skill_id: string; title: string; mastery: number | null }>; standards: number }
export interface TimelineDay { day: string; areas: Record<string, { attempts: number; correct: number; accuracy: number | null }> }
export interface ParentProgress {
  child: { member_id: string; alias: string }
  class_id: string
  areas: Record<string, AreaMastery>
  timeline: TimelineDay[]
}

export interface ParentChild { student_user_id: string; alias: string; class_id: string; class_name?: string | null; subject?: string | null }

export interface RoomMessage { id?: string; nick?: string; content?: string; timestamp?: string }
export interface RoomThread { member_id: string; alias: string; parents?: number; messages?: RoomMessage[]; status?: string }
export interface Announcement { id?: string; text: string; created_at?: string }
export interface MaterialItem { id: string; lesson_id?: string; kind?: string; tier?: string | null; title?: string; topic?: string; download_url?: string }
/** The link the HOST serves for a material. Never the server's `download_url`: that is the Genesis path, which a
 *  browser cannot reach and which would skip the proxy's attachment / nosniff / sandbox headers. */
export function materialDownloadHref(apiBase: string, classId: string, materialId: string): string {
  return `${apiBase}/classes/${cseg(classId)}/room/materials/${cseg(materialId)}/download`
}

export interface RoomState {
  role: 'teacher' | 'parent'
  class: { class_id: string; name?: string | null }
  room: { workspace: string; status: string; nick?: string | null }
  announcements: Announcement[]
  materials?: { status: string; items: MaterialItem[] }
  threads?: RoomThread[]
  presence?: { status: string; people: Array<{ nick: string; online: boolean; is_agent: boolean }> }
  agents?: string[]
}

export interface KidAssignment {
  assignment_id: string
  class_id: string
  title: string
  topic?: string | null
  due_at?: string | null
  has_skills?: boolean
  opened_at?: string | null
  done_at?: string | null
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined || Number.isNaN(v) ? '—' : `${Math.round(v * 100)}%`
}

/** att:12 -> "practice attempt 12"; the three signal kinds the insight engine cites. */
export function describeCite(cite: string): string {
  const [kind, id] = cite.split(':')
  const word = kind === 'att' ? 'practice try' : kind === 'fb' ? 'kid rating' : kind === 'tx' ? 'quest step' : 'signal'
  return `${word} ${id ?? ''}`.trim()
}

/** One line, plain words, for a stream event (never a score judgement). */
export function describeEvent(ev: ClassEvent): string {
  const who = ev.alias ? `${ev.alias}: ` : ''
  switch (ev.type) {
    case 'practice':
      return `${who}${ev.attempts ?? 0} tries on ${ev.skill_id ?? 'a skill'}, ${ev.correct ?? 0} right, ${ev.hints ?? 0} hints`
    case 'break':
      return `${who}took a break`
    case 'quest_done':
      return `${who}finished a quest`
    case 'self_rating':
      return `${who}said it felt ${ev.rating ?? '—'}`
    case 'hard_flag':
      return `${who}flagged ${ev.skill_id ?? 'something'} as hard`
    case 'parent_note':
    case 'teacher_note':
      return ev.held ? `${who}note held for review` : `${who}${ev.text ?? ''}`
    default:
      return `${who}${ev.type}`
  }
}

export function isNotFound(e: unknown): boolean {
  return e instanceof ClassroomHttpError && e.status === 404
}

// ---------------------------------------------------------------------------
// The classroom stream (Server-Sent Events: routers/classroom_learning.py)
// ---------------------------------------------------------------------------

export const STREAM_EVENTS = [
  'practice', 'break', 'quest_done', 'self_rating', 'hard_flag', 'parent_note', 'teacher_note',
] as const

export type StreamStatus = 'connecting' | 'live' | 'offline' | 'ended'

export interface StreamHandle { close: () => void }

/**
 * Open `${apiBase}${path}` as an EventSource. Typed events go to `onEvent`; the
 * server's `cursor`/`done` frames advance a cursor so a reconnect resumes where
 * it left off; `end` (scope lost: a revoked link, a removed teacher) closes for
 * good. Without EventSource (old browser, jsdom) the status is 'offline' and
 * nothing is faked.
 */
export function openClassroomStream(
  apiBase: string,
  path: string,
  onEvent: (ev: ClassEvent) => void,
  onStatus: (s: StreamStatus) => void,
  opts: { retries?: number; retryMs?: number } = {},
): StreamHandle {
  const ES = typeof window !== 'undefined' ? (window as unknown as { EventSource?: typeof EventSource }).EventSource : undefined
  if (!ES) {
    onStatus('offline')
    return { close: () => undefined }
  }
  const retries = opts.retries ?? 5
  const retryMs = opts.retryMs ?? 3000
  let cursor = ''
  let src: EventSource | null = null
  let closed = false
  let failures = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const parse = (raw: string): Record<string, unknown> | null => {
    try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : null } catch { return null }
  }

  const open = () => {
    if (closed) return
    onStatus('connecting')
    const url = `${apiBase}${path}${cursor ? `${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}` : ''}`
    const es = new ES(url, { withCredentials: true })
    src = es
    es.onopen = () => { failures = 0; onStatus('live') }
    for (const name of STREAM_EVENTS) {
      es.addEventListener(name, (m: MessageEvent) => {
        const d = parse(String(m.data))
        if (!d) return
        if (typeof d.cursor === 'string') cursor = d.cursor
        onEvent({ ...(d as unknown as ClassEvent), type: name })
      })
    }
    es.addEventListener('cursor', (m: MessageEvent) => {
      const d = parse(String(m.data))
      if (d && typeof d.cursor === 'string') cursor = d.cursor
    })
    es.addEventListener('done', (m: MessageEvent) => {
      const d = parse(String(m.data))
      if (d && typeof d.cursor === 'string') cursor = d.cursor
      es.close()
      timer = setTimeout(open, 250)
    })
    es.addEventListener('end', () => {
      closed = true
      es.close()
      onStatus('ended')
    })
    es.onerror = () => {
      es.close()
      if (closed) return
      failures += 1
      if (failures > retries) { onStatus('offline'); return }
      onStatus('connecting')
      timer = setTimeout(open, retryMs)
    }
  }
  open()
  return {
    close: () => {
      closed = true
      if (timer) clearTimeout(timer)
      src?.close()
    },
  }
}

// ---------------------------------------------------------------------------
// The themed root every Classroom surface shares
// ---------------------------------------------------------------------------

export interface ClassroomSurface {
  mode: LearnMode
  pref: LearnModePref
  setPref: (p: LearnModePref) => void
  rootRef: RefObject<HTMLDivElement>
  /** The OS frame root (sheets portal there), or null outside the frame. */
  sheetHost: Element | null
  rootStyle: CSSProperties
}

/** Learn mode + the token variables + the sheet host, for a surface root. */
export function useClassroomSurface(base: CSSProperties = {}): ClassroomSurface {
  const { mode, pref, setPref } = useLearnMode()
  const rootRef = useRef<HTMLDivElement>(null)
  const [sheetHost, setSheetHost] = useState<Element | null>(null)
  useEffect(() => {
    setSheetHost(rootRef.current?.closest('[data-os-frame]') ?? null)
  }, [])
  return { mode, pref, setPref, rootRef, sheetHost, rootStyle: { ...learnVars(mode), ...base } }
}

/** Load state for one fetch: 'loading' | 'ready' | 'offline' | 'missing' (404). */
export type LoadState = 'loading' | 'ready' | 'offline' | 'missing'

export function loadStateOf(e: unknown): LoadState {
  return isNotFound(e) ? 'missing' : 'offline'
}

// ---------------------------------------------------------------------------
// Shared surface styles (tokens only: every colour is a `C.<key>` variable)
// ---------------------------------------------------------------------------

/** Responsive layout rules the inline styles cannot express (390px phone .. 1440px desk). */
export const CLASSROOM_CSS = `
.cr-col{width:100%;max-width:1120px;margin:0 auto;display:flex;flex-direction:column;gap:28px;box-sizing:border-box;padding:28px 16px 64px}
.cr-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px}
.cr-grid{display:grid;grid-template-columns:1fr;gap:16px}
.cr-split{display:grid;grid-template-columns:1fr;gap:16px}
.cr-tiers{display:grid;grid-template-columns:1fr;gap:12px}
.cr-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.cr-tabs::-webkit-scrollbar{display:none}
.cr-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
@media (min-width:760px){
  .cr-col{padding:40px 32px 80px}
  .cr-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .cr-split{grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)}
  .cr-tiers{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@media (min-width:1200px){ .cr-grid[data-three]{grid-template-columns:repeat(3,minmax(0,1fr))} }
@media print{
  .cr-noprint{display:none!important}
  .cr-print{display:grid!important;grid-template-columns:repeat(3,1fr);gap:12px}
  .cr-print-card{break-inside:avoid;page-break-inside:avoid}
}
`

export const cs: Record<string, CSSProperties> = {
  root: { minHeight: '100%', background: C.ground, color: C.ink, fontFamily: FONT_UI, boxSizing: 'border-box' },
  h1: { margin: 0, font: `300 clamp(30px, 5.5vw, 44px)/1.05 ${FONT_UI}`, letterSpacing: '-0.02em', color: C.ink },
  h2: { margin: 0, font: `400 20px/1.25 ${FONT_UI}`, letterSpacing: '-0.01em', color: C.ink },
  sub: { font: `400 15px/1.5 ${FONT_UI}`, color: C.dim, margin: 0 },
  tile: {
    display: 'flex', flexDirection: 'column', gap: 14, padding: '20px 20px', borderRadius: 16, minWidth: 0,
    background: C.surface, border: `1px solid ${C.hairline}`, boxSizing: 'border-box',
  },
  row: {
    display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, padding: '6px 0',
    borderTop: `1px solid ${C.hairline}`, minWidth: 0,
  },
  chip: {
    display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 32, padding: '0 12px', borderRadius: 999,
    border: `1px solid ${C.hairlineStrong}`, background: 'transparent', color: C.dim, cursor: 'pointer',
    font: `500 12px/1 ${FONT_MONO}`, letterSpacing: '.06em',
  },
  // `border`, not `borderColor`: React clears a removed longhand, which would blank the shorthand's colour on deselect.
  chipOn: { border: `1px solid ${C.accent}`, color: C.ink, background: C.accentWash },
  tab: {
    minHeight: 40, padding: '0 16px', borderRadius: 999, border: `1px solid ${C.hairline}`, cursor: 'pointer',
    background: 'transparent', color: C.dim, font: `500 14px/1 ${FONT_UI}`, whiteSpace: 'nowrap', flexShrink: 0,
    transition: `color .18s ${EASE}, border-color .18s ${EASE}`,
  },
  tabOn: { color: C.ink, border: `1px solid ${C.hairlineStrong}`, background: C.raise },
  offline: {
    display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start', padding: '20px 0',
    color: C.faint, font: `400 15px/1.5 ${FONT_UI}`,
  },
  bar: { position: 'relative', height: 8, borderRadius: 999, background: C.raise, overflow: 'hidden', border: `1px solid ${C.hairline}` },
  amberNote: { padding: '12px 14px', borderRadius: 12, background: C.amberWash, color: C.ink, font: `400 14px/1.5 ${FONT_UI}` },
  // The mark a demo class wears on every view: it must never read as a real class.
  demoMark: {
    display: 'inline-flex', alignItems: 'center', minHeight: 20, padding: '0 8px', borderRadius: 999, flexShrink: 0,
    border: `1px solid ${C.amber}`, color: C.amber, font: `500 10px/1 ${FONT_MONO}`, letterSpacing: '.18em',
    textTransform: 'lowercase', whiteSpace: 'nowrap',
  },
  demoStrip: {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 18px', padding: '12px 14px', borderRadius: 12,
    background: C.amberWash, color: C.ink, font: `400 14px/1.5 ${FONT_UI}`, minWidth: 0,
  },
  textarea: {
    width: '100%', boxSizing: 'border-box', minHeight: 110, padding: '12px 14px', borderRadius: 12, resize: 'vertical',
    border: `1px solid ${C.hairlineStrong}`, background: C.surface, color: C.ink, font: `400 15px/1.45 ${FONT_UI}`,
  },
}

/** Heat (0..1) as the opacity of an accent layer under a cell: the heatmap never
 *  needs a colour outside the tokens, and the cell text stays at full contrast. */
export function heatLayer(v: number | null | undefined): CSSProperties {
  const a = v === null || v === undefined ? 0 : Math.max(0.06, Math.min(1, v))
  return { position: 'absolute', inset: 0, background: C.accentGlow, opacity: a, borderRadius: 8, pointerEvents: 'none' }
}
