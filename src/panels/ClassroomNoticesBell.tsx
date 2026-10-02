/**
 * ClassroomNoticesBell: "something happened" for a parent or a teacher.
 *
 * Genesis /api/v1/classroom/notify/* (routers/classroom_notify.py):
 *   GET  /notify/notices        the caller's OWN notices + unread count
 *   POST /notify/notices/read   mark them read (on opening the list)
 *   GET  /notify/preferences    one row per class: email | in_app | off
 *   PUT  /notify/preferences    change one
 *
 * A notice is one fixed line ("New work was assigned.") plus the caller's own
 * child's name and the class: never a score, never anything a student wrote.
 * The same is true of the email, which only says something is waiting.
 *
 * States: nothing at all while the service has no notices route (404) or the
 * first load is in flight; a dim "offline" bell when the fetch is rejected
 * (never a fake zero); the count when there is something unread.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { C, EASE, FONT_MONO, FONT_UI, type LearnMode } from './learnTheme'
import { Sheet, SheetHeading, Skel, help, mono, quiet } from './learnParts'
import { CLASSROOM_API, classroomFetch, cs, isNotFound, send } from './classroomApi'

export interface ClassroomNotice {
  id: string
  event: string
  audience: 'parent' | 'teacher'
  text: string
  class_id: string
  class_name?: string | null
  /** The caller's own child (parents only). */
  alias?: string | null
  member_id?: string | null
  created_at: string
  read: boolean
}

export type NoticeMode = 'email' | 'in_app' | 'off'

export interface NoticePreference {
  class_id: string
  class_name?: string | null
  audience: 'parent' | 'teacher'
  mode: NoticeMode
  default: NoticeMode
}

export interface ClassroomNoticesBellProps {
  apiBase?: string
  extraHeaders?: Record<string, string>
  /** The surface's Learn mode and sheet host (useClassroomSurface). */
  mode: LearnMode
  host: Element | null
  /** Re-check for new notices this often; 0 turns polling off (tests, printing). */
  pollMs?: number
}

const MODE_WORD: Record<NoticeMode, string> = { email: 'email', in_app: 'here only', off: 'off' }
const MODE_ORDER: NoticeMode[] = ['email', 'in_app', 'off']

/** "just now", "12 min ago", "3 h ago", "2 d ago", then the date. */
export function noticeAge(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const min = Math.max(0, Math.round((now - t) / 60000))
  if (min < 2) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d} d ago`
  return new Date(t).toISOString().slice(0, 10)
}

function BellGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  )
}

type Load<T> = T | 'loading' | 'offline'

export default function ClassroomNoticesBell({ apiBase = CLASSROOM_API, extraHeaders, mode, host, pollMs = 60000 }: ClassroomNoticesBellProps) {
  const [notices, setNotices] = useState<Load<ClassroomNotice[]> | 'missing'>('loading')
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const [prefs, setPrefs] = useState<Load<{ classes: NoticePreference[]; email_hint?: string | null }>>('loading')
  const [saving, setSaving] = useState<string | null>(null)
  const [prefErr, setPrefErr] = useState<string | null>(null)
  const alive = useRef(true)

  const load = useCallback(async () => {
    try {
      const r = await classroomFetch<{ notices: ClassroomNotice[]; unread: number }>(apiBase, '/notify/notices', { extraHeaders })
      if (!alive.current) return
      setNotices(r?.notices ?? [])
      setUnread(r?.unread ?? 0)
    } catch (e) {
      if (alive.current) setNotices(isNotFound(e) ? 'missing' : 'offline')
    }
  }, [apiBase, extraHeaders])

  const loadPrefs = useCallback(async () => {
    setPrefs('loading')
    try {
      const r = await classroomFetch<{ classes: NoticePreference[]; email_hint?: string | null }>(apiBase, '/notify/preferences', { extraHeaders })
      if (alive.current) setPrefs({ classes: r?.classes ?? [], email_hint: r?.email_hint ?? null })
    } catch {
      if (alive.current) setPrefs('offline')
    }
  }, [apiBase, extraHeaders])

  useEffect(() => {
    alive.current = true
    load()
    if (!pollMs) return () => { alive.current = false }
    const t = setInterval(() => {
      // A hidden tab does not poll; it catches up when it is looked at again.
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') load()
    }, pollMs)
    return () => { alive.current = false; clearInterval(t) }
  }, [load, pollMs])

  const show = async () => {
    setOpen(true)
    setPrefErr(null)
    loadPrefs()
    // Opening the list is reading WHAT IT SHOWS: only those ids are sent, and the count
    // that comes back is the server's (a notice that did not fit the list stays unread).
    // The rows keep their "new" mark until it closes.
    const ids = Array.isArray(notices) ? notices.filter((n) => !n.read).map((n) => n.id) : []
    if (ids.length > 0) {
      try {
        const r = await send<{ unread?: number }>(apiBase, '/notify/notices/read', 'POST', { ids }, extraHeaders)
        if (alive.current) setUnread(typeof r?.unread === 'number' ? r.unread : 0)
      } catch { /* still unread next time: nothing is lost */ }
    }
  }

  const close = () => {
    setOpen(false)
    setNotices((n) => (Array.isArray(n) ? n.map((x) => ({ ...x, read: true })) : n))
  }

  const choose = async (p: NoticePreference, next: NoticeMode) => {
    if (p.mode === next || saving) return
    setSaving(p.class_id)
    setPrefErr(null)
    try {
      const r = await send<{ mode: NoticeMode }>(apiBase, '/notify/preferences', 'PUT', { class_id: p.class_id, mode: next }, extraHeaders)
      if (alive.current) {
        setPrefs((cur) => (cur === 'loading' || cur === 'offline' ? cur : {
          ...cur, classes: cur.classes.map((c) => (c.class_id === p.class_id ? { ...c, mode: r?.mode ?? next } : c)),
        }))
      }
    } catch {
      if (alive.current) setPrefErr('Not saved. Your earlier choice still stands.')
    } finally {
      if (alive.current) setSaving(null)
    }
  }

  // No notices route on this service, or the first answer is not in yet: no bell.
  if (notices === 'missing' || notices === 'loading') return null

  const offline = notices === 'offline'
  const label = offline ? 'Notices, offline' : unread > 0 ? `Notices, ${unread} new` : 'Notices'

  return (
    <>
      <button type="button" className="al-focus al-quiet" data-testid="classroom-bell" aria-label={label} aria-haspopup="dialog"
        onClick={offline ? load : show}
        style={{
          minHeight: 44, minWidth: 44, padding: '0 14px', borderRadius: 999, cursor: 'pointer', background: 'transparent',
          border: `1px solid ${unread > 0 ? C.accent : C.hairline}`, color: offline ? C.faint : unread > 0 ? C.ink : C.dim,
          display: 'inline-flex', alignItems: 'center', gap: 8, transition: `border-color .18s ${EASE}`,
        }}>
        <BellGlyph />
        <span style={{ font: `500 11px/1 ${FONT_MONO}`, letterSpacing: '.12em', textTransform: 'lowercase' }} data-testid="classroom-bell-count">
          {offline ? 'offline' : unread > 0 ? `${unread} new` : 'notices'}
        </span>
      </button>
      {open && Array.isArray(notices) && (
        <Sheet mode={mode} host={host} label="Notices" onClose={close} testId="classroom-notices">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <SheetHeading label="aither classroom · notices" title="What is new" />
            {notices.length === 0 ? (
              <p style={{ ...cs.sub, margin: 0 }} data-testid="notices-empty">
                {'Nothing new. When work is assigned, an announcement is posted or a message arrives, it shows here.'}
              </p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }} data-testid="notices-list">
                {notices.map((n) => (
                  <li key={n.id} style={{ ...cs.row, alignItems: 'flex-start', padding: '12px 0' }} data-unread={n.read ? undefined : ''}>
                    <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, marginTop: 7, flexShrink: 0, background: n.read ? 'transparent' : C.accent, border: `1px solid ${n.read ? C.hairlineStrong : C.accent}` }} />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                      <span style={{ color: C.ink, font: `${n.read ? 400 : 500} 16px/1.35 ${FONT_UI}` }}>{n.text}</span>
                      <span style={{ ...mono, letterSpacing: '.08em' }}>
                        {[n.alias, n.class_name, noticeAge(n.created_at)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <section aria-label="How you hear about it" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="notice-prefs">
              <span style={mono}>how you hear about it</span>
              {prefs === 'loading' && <Skel w="70%" h={14} />}
              {prefs === 'offline' && (
                <div style={{ ...cs.offline, padding: 0 }} role="status">
                  <span style={mono}>offline</span>
                  <button type="button" className="al-quiet al-focus" style={quiet} onClick={loadPrefs}>Try again</button>
                </div>
              )}
              {prefs !== 'loading' && prefs !== 'offline' && (
                <>
                  {prefs.classes.length === 0 && <p style={help}>No class yet.</p>}
                  {prefs.classes.map((p) => (
                    <div key={p.class_id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <span style={{ color: C.ink, font: `400 15px/1.3 ${FONT_UI}`, minWidth: 0 }}>{p.class_name || 'Your class'}</span>
                      <div role="group" aria-label={`Notices for ${p.class_name || 'your class'}`} style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                        {MODE_ORDER.map((m) => (
                          <button key={m} type="button" className="al-focus" aria-pressed={p.mode === m} disabled={saving === p.class_id}
                            data-testid={`pref-${p.class_id}-${m}`} onClick={() => choose(p, m)}
                            style={{ ...cs.chip, minHeight: 44, ...(p.mode === m ? cs.chipOn : {}) }}>
                            {MODE_WORD[m]}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {prefErr && <span role="alert" style={{ ...help, color: C.amber }}>{prefErr}</span>}
                  <p style={{ ...help, margin: 0 }} data-testid="notice-mail-note">
                    {prefs.email_hint
                      ? `Email goes to ${prefs.email_hint}. It only says something is waiting: no names, no scores, nothing a student wrote. Every email has a one-click link to stop it.`
                      : 'No email address is on your account yet, so notices show here only.'}
                  </p>
                </>
              )}
            </section>
          </div>
        </Sheet>
      )}
    </>
  )
}
