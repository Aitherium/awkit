/**
 * ClassroomRoomPanel: the class room, the classroom version of the company room.
 *
 * Genesis /api/v1/classroom/classes/{id}/room/*: GET /state (one poll: role,
 * announcements, materials, threads, presence, agents), POST /announcements
 * (teacher), GET|POST /threads/{member_id}/messages (the teacher and that
 * student's linked parents only), POST|DELETE /agents (teacher; the agent sits in
 * the staff channel only). Role comes from the server's answer, never from a prop:
 * a parent sees the announcements, the shared materials shelf and their own
 * family thread, nothing else.
 * Students are not in the room (their side is the kid inbox).
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { C, FONT_MONO, FONT_UI, LEARN_CSS, LearnModeSwitch } from './learnTheme'
import { Skel, fieldBox, help, mono, primary, quiet } from './learnParts'
import {
  CLASSROOM_API, CLASSROOM_CSS, classroomFetch, cs, cseg, materialDownloadHref, send, useClassroomSurface,
  type MaterialItem, type RoomMessage, type RoomState, type RoomThread,
} from './classroomApi'

export interface ClassroomRoomPanelProps {
  classId: string
  apiBase?: string
  /** Poll interval for /state (ms). 0 = no polling. */
  pollMs?: number
  /** Map a material to a link the host serves (default: `${apiBase}/classes/{id}/room/materials/{mid}/download`). */
  materialHref?: (m: MaterialItem) => string | undefined
  extraHeaders?: Record<string, string>
}

const KIND_ICON: Record<string, string> = { document: '▤', outline: '☰', image: '◫', video: '▶', audio: '♪' }

function MaterialTile({ m, href }: { m: MaterialItem; href?: string }) {
  const body = (
    <>
      <span aria-hidden style={{ font: `400 22px/1 ${FONT_MONO}`, color: C.accent }}>{KIND_ICON[m.kind || ''] || '▤'}</span>
      <span style={{ color: C.ink, font: `500 15px/1.3 ${FONT_UI}`, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title || 'Material'}</span>
      <span style={{ ...mono, letterSpacing: '.08em' }}>{[m.topic, m.tier ? `tier ${m.tier.toLowerCase()}` : null].filter(Boolean).join(' · ')}</span>
    </>
  )
  const style = { ...cs.tile, gap: 8, padding: 16, textDecoration: 'none' }
  return href
    ? <a href={href} className="al-tile al-focus" style={style} data-testid="material-tile" target="_blank" rel="noopener noreferrer">{body}</a>
    : <div className="al-tile" style={style} data-testid="material-tile">{body}</div>
}

function Messages({ msgs }: { msgs: RoomMessage[] }) {
  if (!msgs.length) return <p style={help}>No messages yet.</p>
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {msgs.map((m, i) => (
        <li key={m.id || i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ ...mono, letterSpacing: '.08em' }}>{m.nick || '—'}{m.timestamp ? ` · ${String(m.timestamp).slice(0, 16).replace('T', ' ')}` : ''}</span>
          <span style={{ color: C.ink, font: `400 15px/1.45 ${FONT_UI}`, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.content}</span>
        </li>
      ))}
    </ul>
  )
}

function Composer({ label, onSend, primaryAction }: { label: string; onSend: (text: string) => Promise<void>; primaryAction?: boolean }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try { await onSend(text.trim()); setText('') } catch (ex) { setErr(ex instanceof Error ? ex.message : 'Not sent.') } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <textarea aria-label={label} className="al-field" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)}
        style={{ ...cs.textarea, minHeight: 56, flex: '1 1 220px' }} />
      <button type="submit" className={primaryAction ? 'al-primary al-focus' : 'al-quiet al-focus'}
        style={primaryAction ? primary : { ...quiet, color: C.accent }} disabled={busy || !text.trim()}>
        {primaryAction ? 'Post' : 'Send'}
      </button>
      {err && <span role="alert" style={{ ...help, color: C.amber, flexBasis: '100%' }}>{err}</span>}
    </form>
  )
}

export default function ClassroomRoomPanel({ classId, apiBase = CLASSROOM_API, pollMs = 20000, materialHref, extraHeaders }: ClassroomRoomPanelProps) {
  const { mode, pref, setPref, rootRef, rootStyle } = useClassroomSurface(cs.root)
  const room = `/classes/${cseg(classId)}/room`
  const [st, setSt] = useState<RoomState | 'loading' | 'offline' | 'missing'>('loading')
  const [openThread, setOpenThread] = useState<string | null>(null)
  const [threadMsgs, setThreadMsgs] = useState<RoomMessage[] | 'offline' | null>(null)
  const [agentName, setAgentName] = useState('')
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setSt(await classroomFetch<RoomState>(apiBase, `${room}/state`, { extraHeaders }))
    } catch (e) {
      setSt((cur) => (cur !== 'loading' && cur !== 'offline' && cur !== 'missing' ? cur : (e as { status?: number })?.status === 404 ? 'missing' : 'offline'))
    }
  }, [apiBase, extraHeaders, room])

  useEffect(() => {
    load()
    if (!pollMs) return undefined
    const t = setInterval(load, pollMs)
    return () => clearInterval(t)
  }, [load, pollMs])

  const openFor = async (mid: string) => {
    setOpenThread(mid); setThreadMsgs(null)
    try {
      const r = await classroomFetch<{ messages: RoomMessage[]; status: string }>(apiBase, `${room}/threads/${cseg(mid)}/messages`, { extraHeaders })
      setThreadMsgs(r.status === 'ok' ? r.messages : 'offline')
    } catch { setThreadMsgs('offline') }
  }

  const sendTo = async (mid: string, text: string) => {
    await send(apiBase, `${room}/threads/${cseg(mid)}/messages`, 'POST', { text }, extraHeaders)
    if (openThread === mid) await openFor(mid)
    await load()
  }

  const announce = async (text: string) => {
    await send(apiBase, `${room}/announcements`, 'POST', { text }, extraHeaders)
    await load()
  }

  const addAgent = async (e: FormEvent) => {
    e.preventDefault()
    setNote(null)
    try { await send(apiBase, `${room}/agents`, 'POST', { agent: agentName.trim() }, extraHeaders); setAgentName(''); await load() } catch (ex) { setNote(ex instanceof Error ? ex.message : 'Agent not added.') }
  }
  const removeAgent = async (name: string) => {
    try { await classroomFetch(apiBase, `${room}/agents/${cseg(name)}`, { method: 'DELETE', extraHeaders }); await load() } catch (ex) { setNote(ex instanceof Error ? ex.message : 'Agent not removed.') }
  }

  const ready = st !== 'loading' && st !== 'offline' && st !== 'missing'
  const teacher = ready && st.role === 'teacher'

  return (
    <div ref={rootRef} style={rootStyle} data-learn-theme={mode} data-testid="classroom-room">
      <style>{LEARN_CSS + CLASSROOM_CSS}</style>
      <div className="cr-col">
        <header className="cr-head al-in">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            <span style={mono}>aither classroom · room{ready ? ` · ${st.role}` : ''}</span>
            <h1 style={cs.h1}>{ready ? st.class.name || 'Class room' : 'Class room'}</h1>
            {ready && (
              <span style={{ ...mono, color: st.room.status === 'ok' ? C.accent : C.faint, letterSpacing: '.08em' }} data-testid="room-status">
                {st.room.status === 'ok' ? '● room open' : 'chat offline · announcements still work'}
              </span>
            )}
          </div>
          <LearnModeSwitch pref={pref} onChange={setPref} />
        </header>

        {st === 'loading' && <div className="cr-grid"><Skel w="100%" h={140} r={16} /><Skel w="100%" h={140} r={16} /></div>}
        {(st === 'offline' || st === 'missing') && (
          <div style={cs.offline} data-testid="classroom-offline" role="status">
            <span style={mono}>{st === 'missing' ? 'not found' : 'offline'}</span>
            <span>{st === 'missing' ? 'This class room is not one of yours.' : 'The class room could not be reached just now.'}</span>
            {st === 'offline' && <button type="button" className="al-quiet al-focus" style={quiet} onClick={load}>Try again</button>}
          </div>
        )}
        {note && <div role="status" style={cs.amberNote}>{note}</div>}

        {ready && (
          <div className="cr-split">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              <section style={cs.tile} aria-label="Announcements" data-testid="room-announcements">
                <span style={mono}>announcements</span>
                {teacher && <Composer label="New announcement" onSend={announce} primaryAction />}
                {st.announcements.length === 0 ? <p style={help}>Nothing posted yet.</p> : (
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                    {st.announcements.map((a, i) => (
                      <li key={a.id || i} style={{ ...cs.row, flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                        <span style={{ color: C.ink, font: `400 16px/1.5 ${FONT_UI}`, whiteSpace: 'pre-wrap' }}>{a.text}</span>
                        {a.created_at && <span style={{ ...mono, letterSpacing: '.08em' }}>{a.created_at.slice(0, 10)}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {st.materials && (
                <section style={cs.tile} aria-label="Materials" data-testid="room-materials">
                  <span style={mono}>{teacher ? 'materials shelf' : 'from the teacher'}</span>
                  {st.materials.status !== 'ok' ? <span style={{ ...mono, color: C.faint }}>offline</span>
                    : st.materials.items.length === 0 ? <p style={help}>{teacher ? 'Published lesson materials appear here.' : 'Nothing shared yet.'}</p> : (
                      <div className="cr-grid" data-three="">
                        {st.materials.items.map((m) => <MaterialTile key={m.id} m={m} href={materialHref ? materialHref(m) : materialDownloadHref(apiBase, classId, m.id)} />)}
                      </div>
                    )}
                </section>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              <section style={cs.tile} aria-label="Family threads" data-testid="room-threads">
                <span style={mono}>{teacher ? 'family threads' : 'you and the teacher'}</span>
                {(st.threads ?? []).length === 0 && <p style={help}>{teacher ? 'Threads open once a parent links with their code.' : 'No thread yet.'}</p>}
                {(st.threads ?? []).map((t: RoomThread) => (
                  <div key={t.member_id} style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 10, borderTop: `1px solid ${C.hairline}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ flex: 1, color: C.ink }}>{t.alias}{teacher && t.parents ? <span style={{ ...mono, marginLeft: 8 }}>{t.parents} parent</span> : null}</span>
                      {teacher && openThread !== t.member_id && <button type="button" className="al-quiet al-focus" style={quiet} onClick={() => openFor(t.member_id)}>Open</button>}
                    </div>
                    {!teacher && (t.status === 'ok' ? <Messages msgs={t.messages ?? []} /> : <span style={{ ...mono, color: C.faint }}>chat offline</span>)}
                    {teacher && openThread === t.member_id && (
                      threadMsgs === null ? <Skel w="70%" h={14} /> : threadMsgs === 'offline' ? <span style={{ ...mono, color: C.faint }}>chat offline</span> : <Messages msgs={threadMsgs} />
                    )}
                    {(!teacher || openThread === t.member_id) && <Composer label={`Message about ${t.alias}`} onSend={(text) => sendTo(t.member_id, text)} />}
                  </div>
                ))}
              </section>

              {teacher && (
                <section style={cs.tile} aria-label="Presence and class agent" data-testid="room-presence">
                  <span style={mono}>who is here</span>
                  {st.presence?.status === 'ok'
                    ? (st.presence.people.length === 0 ? <p style={help}>Nobody online.</p> : (
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {st.presence.people.map((p) => (
                          <li key={p.nick} style={{ ...cs.chip, cursor: 'default', color: p.online ? C.ink : C.faint }}>
                            <span aria-hidden style={{ color: p.online ? C.accent : C.faint }}>●</span>{p.nick}{p.is_agent ? ' · agent' : ''}
                          </li>
                        ))}
                      </ul>
                    ))
                    : <span style={{ ...mono, color: C.faint }}>presence offline</span>}
                  <span style={{ ...mono, marginTop: 6 }}>class agent · staff channel only</span>
                  {(st.agents ?? []).map((a) => (
                    <div key={a} style={cs.row}>
                      <span style={{ flex: 1, color: C.ink }}>{a}</span>
                      <button type="button" className="al-quiet al-focus" style={quiet} onClick={() => removeAgent(a)} aria-label={`Remove ${a}`}>Remove</button>
                    </div>
                  ))}
                  <form onSubmit={addAgent} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <input aria-label="Agent name" className="al-field" value={agentName} maxLength={64} onChange={(e) => setAgentName(e.target.value)}
                      placeholder="agent name" style={{ ...fieldBox, flex: '1 1 160px', minHeight: 44 }} />
                    <button type="submit" className="al-quiet al-focus" style={{ ...quiet, color: C.accent }} disabled={!agentName.trim()} data-testid="agent-add">Add agent</button>
                  </form>
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
