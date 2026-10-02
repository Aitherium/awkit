/**
 * ClassroomParentPanel: a parent's view of their own child in a class.
 *
 * Genesis /api/v1/classroom/parent/*: children (the caller's verified links
 * only), children/{sid}/progress (per area + daily timeline), /weekly (the
 * week's observations), /notes (a note to the teacher, screened server-side),
 * /stream (SSE: refreshes progress live; it ends when the link is revoked). The
 * teacher thread is the class room's family thread
 * (/classes/{id}/room/state + /threads/{member_id}/messages).
 *
 * The bell in the header is ClassroomNoticesBell (/notify/*): what is new, and
 * whether to hear about it by email, here only, or not at all.
 *
 * Mastery shows as a bar only where there is practice: an untouched area says
 * "no practice yet", never 0%. Primary action: "Send to teacher".
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { C, FONT_UI, LEARN_CSS, LearnModeSwitch } from './learnTheme'
import { Skel, help, mono, primary, quiet } from './learnParts'
import ClassroomNoticesBell from './ClassroomNoticesBell'
import {
  CLASSROOM_API, CLASSROOM_CSS, classroomFetch, cs, cseg, describeEvent, materialDownloadHref, openClassroomStream, pct, send, useClassroomSurface,
  type ClassEvent, type Insight, type ParentChild, type ParentProgress, type RoomMessage, type RoomState, type StreamStatus,
} from './classroomApi'

export interface ClassroomParentPanelProps {
  apiBase?: string
  /** Show one child (from GET /parent/children); otherwise every linked child. */
  child?: ParentChild
  extraHeaders?: Record<string, string>
  /** Turn the live stream off (tests, printing). */
  live?: boolean
}

const AREA_WORD: Record<string, string> = { math: 'Math', reading: 'Reading', writing: 'Writing', language: 'Language' }

function Offline({ what, onRetry }: { what: string; onRetry?: () => void }) {
  return (
    <div style={cs.offline} data-testid="classroom-offline" role="status">
      <span style={mono}>offline</span>
      <span>{what} could not be reached just now.</span>
      {onRetry && <button type="button" className="al-quiet al-focus" style={quiet} onClick={onRetry}>Try again</button>}
    </div>
  )
}

export function AreaBars({ progress }: { progress: ParentProgress }) {
  const areas = Object.entries(progress.areas || {})
  if (!areas.length) return <p style={help}>No practice yet.</p>
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 16 }} data-testid="area-bars">
      {areas.map(([area, a]) => (
        <li key={area} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: C.ink, font: `500 16px/1.2 ${FONT_UI}` }}>{AREA_WORD[area] || area}</span>
            <span style={{ ...mono, letterSpacing: '.08em', color: a.mastery == null ? C.faint : C.dim }}>
              {a.mastery == null ? 'no practice yet' : `${pct(a.mastery)} secure`}
            </span>
          </div>
          {a.mastery != null && (
            <div style={cs.bar} role="progressbar" aria-label={`${AREA_WORD[area] || area} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(a.mastery * 100)}>
              <span className="al-grow" style={{ position: 'absolute', inset: 0, width: `${Math.round(a.mastery * 100)}%`, background: C.accent, borderRadius: 999, transformOrigin: 'left' }} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

export function Timeline({ progress }: { progress: ParentProgress }) {
  const days = (progress.timeline || []).slice(-14)
  if (!days.length) return null
  const max = Math.max(1, ...days.map((d) => Object.values(d.areas).reduce((n, a) => n + a.attempts, 0)))
  return (
    <div data-testid="progress-timeline" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={mono}>last {days.length} days of practice</span>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 64 }}>
        {days.map((d) => {
          const n = Object.values(d.areas).reduce((s, a) => s + a.attempts, 0)
          return (
            <span key={d.day} title={`${d.day}: ${n} tries`} style={{ flex: 1, minWidth: 6, height: `${Math.max(4, (n / max) * 64)}px`, background: n ? C.accent : C.hairline, borderRadius: 3, opacity: n ? 0.85 : 1 }} />
          )
        })}
      </div>
    </div>
  )
}

function ChildView({ child, apiBase, extraHeaders, live }: { child: ParentChild; apiBase: string; extraHeaders?: Record<string, string>; live: boolean }) {
  const sid = cseg(child.student_user_id)
  const [progress, setProgress] = useState<ParentProgress | 'loading' | 'offline'>('loading')
  const [weekly, setWeekly] = useState<Insight | 'loading' | 'offline'>('loading')
  const [room, setRoom] = useState<RoomState | 'offline' | null>(null)
  const [feed, setFeed] = useState<ClassEvent[]>([])
  const [stream, setStream] = useState<StreamStatus>('connecting')
  const [note, setNote] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadProgress = useCallback(async () => {
    try { setProgress(await classroomFetch<ParentProgress>(apiBase, `/parent/children/${sid}/progress`, { extraHeaders })) } catch { setProgress('offline') }
  }, [apiBase, extraHeaders, sid])

  const loadRoom = useCallback(async () => {
    try { setRoom(await classroomFetch<RoomState>(apiBase, `/classes/${cseg(child.class_id)}/room/state`, { extraHeaders })) } catch { setRoom('offline') }
  }, [apiBase, child.class_id, extraHeaders])

  useEffect(() => {
    loadProgress()
    loadRoom()
    classroomFetch<Insight>(apiBase, `/parent/children/${sid}/weekly`, { extraHeaders }).then(setWeekly).catch(() => setWeekly('offline'))
  }, [apiBase, extraHeaders, loadProgress, loadRoom, sid])

  useEffect(() => {
    if (!live) { setStream('offline'); return undefined }
    const h = openClassroomStream(apiBase, `/parent/children/${sid}/stream`, (ev) => {
      setFeed((f) => [ev, ...f].slice(0, 8))
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      reloadTimer.current = setTimeout(loadProgress, 1500)
    }, setStream)
    return () => { h.close(); if (reloadTimer.current) clearTimeout(reloadTimer.current) }
  }, [apiBase, live, loadProgress, sid])

  const sendNote = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setSent(null)
    try {
      const r = await send<{ held: boolean; message?: string }>(apiBase, `/parent/children/${sid}/notes`, 'POST', { text: note.trim() }, extraHeaders)
      setSent(r.held ? (r.message || 'Held for review.') : 'Sent. Your note helps the teacher see the whole picture.')
      if (!r.held) setNote('')
    } catch (ex) { setSent(ex instanceof Error ? ex.message : 'Not sent.') } finally { setBusy(false) }
  }

  const thread = room && room !== 'offline' ? (room.threads ?? []).find((t) => t.alias === child.alias) ?? (room.threads ?? [])[0] : undefined

  return (
    <article style={{ display: 'flex', flexDirection: 'column', gap: 16 }} data-testid="parent-child">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ ...cs.h2, fontSize: 26, fontWeight: 300, letterSpacing: '-0.02em' }}>{child.alias}</h2>
        <span style={{ ...mono, letterSpacing: '.08em' }}>
          {[child.class_name, child.subject].filter(Boolean).join(' · ')}{' · '}
          {live && <span style={{ color: stream === 'live' ? C.accent : C.faint }} data-testid="stream-status">{stream === 'live' ? '● live' : stream === 'ended' ? 'link closed' : 'live updates paused'}</span>}
        </span>
      </div>
      <div className="cr-split">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <section style={cs.tile} aria-label="Progress by area">
            <span style={mono}>progress by area</span>
            {progress === 'loading' && <><Skel w="100%" h={10} /><Skel w="80%" h={10} /></>}
            {progress === 'offline' && <Offline what="Progress" onRetry={loadProgress} />}
            {progress !== 'loading' && progress !== 'offline' && <><AreaBars progress={progress} /><Timeline progress={progress} /></>}
          </section>
          <section style={cs.tile} aria-label="This week">
            <span style={mono}>this week · observations, not diagnoses</span>
            {weekly === 'loading' && <Skel w="90%" h={14} />}
            {weekly === 'offline' && <Offline what="The weekly review" />}
            {weekly !== 'loading' && weekly !== 'offline' && (
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8, color: C.ink, font: `400 16px/1.5 ${FONT_UI}` }} data-testid="weekly-review">
                {weekly.observations.map((o, i) => <li key={i}>{o.text}</li>)}
              </ul>
            )}
          </section>
          {feed.length > 0 && (
            <section style={cs.tile} aria-label="Just now">
              <span style={mono}>just now</span>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6, font: `400 14px/1.4 ${FONT_UI}`, color: C.dim }}>
                {feed.map((ev, i) => <li key={i}>{describeEvent({ ...ev, alias: undefined })}</li>)}
              </ul>
            </section>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <form onSubmit={sendNote} style={cs.tile} aria-label="Note to the teacher">
            <span style={mono}>note to the teacher</span>
            <p style={help}>What you notice at home: what clicked, what was hard, how practice felt. No links or phone numbers.</p>
            <textarea aria-label="Your note" className="al-field" value={note} maxLength={600} onChange={(e) => setNote(e.target.value)} style={cs.textarea} />
            {sent && <span role="status" style={help}>{sent}</span>}
            <div><button type="submit" className="al-primary al-focus" style={primary} disabled={busy || !note.trim()} data-testid="send-note">Send to teacher</button></div>
          </form>
          <section style={cs.tile} aria-label="Teacher thread" data-testid="parent-thread">
            <span style={mono}>you and the teacher</span>
            {room === null && <Skel w="70%" h={14} />}
            {room === 'offline' && <span style={{ ...mono, color: C.faint }}>offline</span>}
            {room && room !== 'offline' && (
              <>
                {room.announcements.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ ...mono, letterSpacing: '.08em' }}>latest announcement</span>
                    <span style={{ color: C.ink }}>{room.announcements[0].text}</span>
                  </div>
                )}
                {room.materials && room.materials.status === 'ok' && room.materials.items.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-testid="parent-materials">
                    <span style={{ ...mono, letterSpacing: '.08em' }}>from the teacher</span>
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                      {room.materials.items.map((m) => (
                        <li key={m.id} style={cs.row}>
                          <a href={materialDownloadHref(apiBase, child.class_id, m.id)} className="al-quiet al-focus" style={{ ...quiet, color: C.accent }}
                            target="_blank" rel="noopener noreferrer" data-testid="parent-material">{m.title || 'Material'}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!thread ? <p style={help}>The thread opens once the class room is set up.</p> : (
                  <ThreadBox apiBase={apiBase} classId={child.class_id} memberId={thread.member_id} msgs={thread.messages ?? []}
                    status={thread.status} extraHeaders={extraHeaders} onSent={loadRoom} />
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </article>
  )
}

function ThreadBox({ apiBase, classId, memberId, msgs, status, extraHeaders, onSent }: {
  apiBase: string; classId: string; memberId: string; msgs: RoomMessage[]; status?: string
  extraHeaders?: Record<string, string>; onSent: () => void
}) {
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const go = async (e: FormEvent) => {
    e.preventDefault(); setErr(null)
    try {
      await send(apiBase, `/classes/${cseg(classId)}/room/threads/${cseg(memberId)}/messages`, 'POST', { text: text.trim() }, extraHeaders)
      setText(''); onSent()
    } catch (ex) { setErr(ex instanceof Error ? ex.message : 'Not sent.') }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {status && status !== 'ok' ? <span style={{ ...mono, color: C.faint }}>chat offline</span> : msgs.length === 0 ? <p style={help}>No messages yet.</p> : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {msgs.map((m, i) => (
            <li key={m.id || i}><span style={{ ...mono, letterSpacing: '.08em', display: 'block' }}>{m.nick}</span><span style={{ color: C.ink, fontFamily: FONT_UI }}>{m.content}</span></li>
          ))}
        </ul>
      )}
      <form onSubmit={go} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <textarea aria-label="Message the teacher" className="al-field" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} style={{ ...cs.textarea, minHeight: 56, flex: '1 1 200px' }} />
        <button type="submit" className="al-quiet al-focus" style={{ ...quiet, color: C.accent }} disabled={!text.trim()}>Send</button>
      </form>
      {err && <span role="alert" style={{ ...help, color: C.amber }}>{err}</span>}
    </div>
  )
}

export default function ClassroomParentPanel({ apiBase = CLASSROOM_API, child, extraHeaders, live = true }: ClassroomParentPanelProps) {
  const { mode, pref, setPref, rootRef, rootStyle, sheetHost } = useClassroomSurface(cs.root)
  const [children, setChildren] = useState<ParentChild[] | 'loading' | 'offline'>(child ? [child] : 'loading')

  const load = useCallback(async () => {
    if (child) { setChildren([child]); return }
    setChildren('loading')
    try {
      const r = await classroomFetch<{ children: ParentChild[] }>(apiBase, '/parent/children', { extraHeaders })
      setChildren(r?.children ?? [])
    } catch { setChildren('offline') }
  }, [apiBase, child, extraHeaders])

  useEffect(() => { load() }, [load])

  return (
    <div ref={rootRef} style={rootStyle} data-learn-theme={mode} data-testid="classroom-parent">
      <style>{LEARN_CSS + CLASSROOM_CSS}</style>
      <div className="cr-col">
        <header className="cr-head al-in">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={mono}>aither classroom · family</span>
            <h1 style={cs.h1}>At school</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <ClassroomNoticesBell apiBase={apiBase} extraHeaders={extraHeaders} mode={mode} host={sheetHost} pollMs={live ? 60000 : 0} />
            <LearnModeSwitch pref={pref} onChange={setPref} />
          </div>
        </header>
        {children === 'loading' && <Skel w="100%" h={160} r={16} />}
        {children === 'offline' && <Offline what="Your child's class" onRetry={load} />}
        {Array.isArray(children) && children.length === 0 && (
          <p style={cs.sub} data-testid="parent-no-children">No class linked yet. Ask the teacher for a parent code.</p>
        )}
        {Array.isArray(children) && children.map((c) => (
          <ChildView key={`${c.class_id}:${c.student_user_id}`} child={c} apiBase={apiBase} extraHeaders={extraHeaders} live={live} />
        ))}
      </div>
    </div>
  )
}
