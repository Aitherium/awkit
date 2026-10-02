/**
 * FamilyMessagesSection: the guardian's note-and-practice sender for one learner
 * (Aither Learn), mounted inside FamilyTutorConsolePanel.
 *
 * Backed by Genesis /api/v1/tutor/family/learners/{lid}/messages through the host
 * app's proxy. Genesis refuses anyone but the guardian of record (404), so this
 * component holds no authorization logic. The whole thread is shown, the child's
 * held (safety-screened) messages included and labelled, because the parent sees
 * everything. "Fix family chat" re-ensures the private relay family channel.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { C, FONT_MONO, FONT_UI } from './learnTheme'
import { SheetHeading, fieldBox, help, labelText, mono, primary, quiet } from './learnParts'

export interface FamilyMessagesSectionProps {
  apiBase: string
  extraHeaders?: Record<string, string>
  lid: string
  name?: string
}

interface ThreadMessage {
  msg_id: string
  direction: 'to_kid' | 'from_kid'
  kind: string
  text: string
  kid_title?: string | null
  created_at?: string
  read?: boolean
  held?: boolean
}

const S: Record<string, CSSProperties> = {
  card: { display: 'flex', flexDirection: 'column', gap: 16, fontFamily: FONT_UI, color: C.ink },
  row: { display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' },
  btn: quiet,
  primary,
  msg: { padding: '10px 14px', borderRadius: 14, maxWidth: '85%', overflowWrap: 'anywhere', border: `1px solid ${C.hairline}`, font: `400 15px/1.45 ${FONT_UI}` },
}

export default function FamilyMessagesSection({ apiBase, extraHeaders = {}, lid, name }: FamilyMessagesSectionProps) {
  const headersRef = useRef(extraHeaders)
  headersRef.current = extraHeaders
  const [thread, setThread] = useState<ThreadMessage[]>([])
  const [text, setText] = useState('')
  const [skillId, setSkillId] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const call = useCallback(async (path: string, method = 'GET', body?: object) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headersRef.current } }
    if (body) init.body = JSON.stringify(body)
    const r = await fetch(`${apiBase}${path}`, init)
    const data = await r.json().catch(() => null)
    return { ok: r.ok, status: r.status, data }
  }, [apiBase])

  const base = `/family/learners/${encodeURIComponent(lid)}/messages`

  const load = useCallback(async () => {
    const r = await call(`${base}?limit=100`).catch(() => null)
    const msgs = (r?.ok && r.data && Array.isArray((r.data as { messages?: unknown }).messages))
      ? ((r.data as { messages: ThreadMessage[] }).messages)
      : []
    setThread(msgs)
  }, [call, base])

  useEffect(() => { load() }, [load])

  const send = async (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    const body: Record<string, string> = { text: t.slice(0, 500) }
    if (skillId.trim()) body.skill_id = skillId.trim()
    const r = await call(base, 'POST', body).catch(() => null)
    setBusy(false)
    if (r?.ok) { setText(''); setSkillId(''); setStatus('Sent.'); load() }
    else setStatus(r?.status === 422 ? 'Check the message or skill id.' : 'Could not send that note.')
  }

  const repair = async () => {
    const r = await call('/family/channel/ensure', 'POST').catch(() => null)
    setStatus(r?.ok && (r.data as { ok?: boolean })?.ok ? 'Family chat is set up.' : 'Family chat could not be fully set up yet.')
  }

  return (
    <section style={S.card} data-testid="family-messages-view">
      <SheetHeading label="messages" title={`Notes${name ? ` with ${name}` : ''}`} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="family-thread">
        {thread.length === 0 && <div style={mono}>no notes yet</div>}
        {thread.map((m) => (
          <div key={m.msg_id} style={{
            ...S.msg,
            alignSelf: m.direction === 'to_kid' ? 'flex-end' : 'flex-start',
            background: m.direction === 'to_kid' ? C.accentWash : C.raise,
          }}>
            {m.kind === 'practice' && m.kid_title ? <strong>Practice: {m.kid_title}. </strong> : null}
            {m.text}
            {m.held && <em style={{ display: 'block', marginTop: 4, color: C.amber, fontStyle: 'normal', font: `400 13px/1.4 ${FONT_UI}` }}>Held by the safety check (not delivered).</em>}
            {m.direction === 'to_kid' && <span style={{ display: 'block', marginTop: 4, font: `400 11px/1.4 ${FONT_MONO}`, letterSpacing: '.12em', textTransform: 'lowercase', color: C.faint }}>{m.read ? 'Seen' : 'Not seen yet'}</span>}
          </div>
        ))}
      </div>
      <form onSubmit={send} style={{ display: 'flex', flexDirection: 'column', gap: 14, borderTop: `1px solid ${C.hairline}`, paddingTop: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={labelText}>Note (short and warm)</span>
          <textarea value={text} maxLength={500} rows={3} onChange={(e) => setText(e.target.value)}
            className="al-field" style={{ ...fieldBox, resize: 'vertical' }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={labelText}>Practice this (optional skill id)</span>
          <input value={skillId} maxLength={80} onChange={(e) => setSkillId(e.target.value)}
            placeholder="math.add_within_20" className="al-field" style={{ ...fieldBox, fontFamily: FONT_MONO }} />
        </label>
        <div style={S.row}>
          <button type="submit" className="al-primary al-focus" style={S.primary} disabled={busy || !text.trim()}>Send note</button>
          <button type="button" className="al-quiet al-focus" style={S.btn} onClick={repair}>Fix family chat</button>
        </div>
      </form>
      {status && <div role="status" style={help}>{status}</div>}
    </section>
  )
}
