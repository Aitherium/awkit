/**
 * KidInboxCard: a note from a grown-up, on the child's /learn home (Aither Learn).
 *
 * Backed by Genesis /api/v1/tutor/me/messages through the host app's proxy
 * (apiBase). The server derives the learner from the child's own session, so no
 * request carries a learner id or a channel.
 *
 * Child-first rules this card keeps:
 * - One big card, the newest note only. A speaker button reads it aloud
 *   (speechSynthesis); nothing plays by itself.
 * - Replies are big picture buttons and a few ready-made sayings. Free typing
 *   appears only when the server offers it (older band, <= free_text_max chars).
 * - No red, no X, no timers, no counts of missed notes, no "you haven't replied".
 * - Only named fields are read from the server; nothing else is rendered.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { C, FONT_MONO, FONT_UI } from './learnTheme'

export interface KidInboxCardProps {
  /** Base of the tutor proxy, e.g. '/api/tutor'. */
  apiBase: string
  /** Headers the host app adds (its bearer). Never user identity fields. */
  extraHeaders?: Record<string, string>
}

interface KidMessage {
  msg_id: string
  from: 'grown_up' | 'me'
  kind: string
  text: string
  read?: boolean
  practice?: { skill_id?: string; title?: string } | null
}

interface ReplyOptions { reactions: string[]; phrases: string[]; free_text_max: number }

const BIG: CSSProperties = {
  minHeight: 64,
  minWidth: 64,
  fontSize: 32,
  fontFamily: FONT_UI,
  borderRadius: 20,
  border: `1px solid ${C.hairlineStrong}`,
  background: C.raise,
  color: C.ink,
  cursor: 'pointer',
  padding: '6px 14px',
  touchAction: 'manipulation',
}

function speak(text: string | undefined) {
  if (!text || typeof window === 'undefined') return
  const synth = (window as unknown as { speechSynthesis?: SpeechSynthesis }).speechSynthesis
  const Utter = (window as unknown as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance })
    .SpeechSynthesisUtterance
  if (!synth || !Utter) return
  try {
    synth.cancel()
    const u = new Utter(text)
    u.rate = 0.9
    u.pitch = 1.05
    synth.speak(u)
  } catch { /* speech is a nicety, never a blocker */ }
}

function asOptions(raw: unknown): ReplyOptions {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const max = typeof o.free_text_max === 'number' && o.free_text_max > 0 ? Math.min(o.free_text_max, 140) : 0
  return { reactions: strings(o.reactions).slice(0, 8), phrases: strings(o.phrases).slice(0, 8), free_text_max: max }
}

function asMessages(raw: unknown): KidMessage[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((m) => {
    if (!m || typeof m !== 'object') return []
    const r = m as Record<string, unknown>
    if (typeof r.msg_id !== 'string' || typeof r.text !== 'string') return []
    const p = r.practice && typeof r.practice === 'object' ? (r.practice as Record<string, unknown>) : null
    return [{
      msg_id: r.msg_id,
      from: r.from === 'me' ? 'me' : 'grown_up',
      kind: typeof r.kind === 'string' ? r.kind : 'note',
      text: r.text,
      read: r.read === true,
      practice: p ? { title: typeof p.title === 'string' ? p.title : '' } : null,
    } as KidMessage]
  })
}

export default function KidInboxCard({ apiBase, extraHeaders = {} }: KidInboxCardProps) {
  const headersRef = useRef(extraHeaders)
  headersRef.current = extraHeaders
  const [note, setNote] = useState<KidMessage | null>(null)
  const [opts, setOpts] = useState<ReplyOptions>({ reactions: [], phrases: [], free_text_max: 0 })
  const [typed, setTyped] = useState('')
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const call = useCallback(async (path: string, method = 'GET', body?: object) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headersRef.current } }
    if (body) init.body = JSON.stringify(body)
    const r = await fetch(`${apiBase}${path}`, init)
    const data = await r.json().catch(() => null)
    return { ok: r.ok, status: r.status, data }
  }, [apiBase])

  const load = useCallback(async () => {
    try {
      const r = await call('/me/messages?limit=20')
      if (!r.ok || !r.data) return
      const d = r.data as Record<string, unknown>
      const msgs = asMessages(d.messages).filter((m) => m.from === 'grown_up')
      setOpts(asOptions(d.reply_options))
      setNote(msgs.length ? msgs[msgs.length - 1] : null)
    } catch { /* no inbox today: the card simply does not show */ }
  }, [call])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (note && !note.read) {
      call(`/me/messages/${encodeURIComponent(note.msg_id)}/read`, 'POST').catch(() => null)
    }
  }, [note, call])

  const send = async (body: Record<string, string>) => {
    if (!note || busy) return
    setBusy(true)
    try {
      const r = await call('/me/messages', 'POST', { reply_to: note.msg_id, ...body })
      const d = (r.data || {}) as { sent?: boolean; say?: string }
      if (r.ok && d.sent) { setSaid('Sent! 💌'); setTyped('') }
      else setSaid(typeof d.say === 'string' ? d.say : 'Let’s send a picture instead!')
    } catch {
      setSaid('Let’s try again in a little bit.')
    } finally {
      setBusy(false)
    }
  }

  if (!note) return null
  const spoken = note.practice?.title ? `${note.text}. Let’s practice ${note.practice.title}!` : note.text
  return (
    <section
      data-testid="kid-inbox-card"
      aria-label="a note from your grown-up"
      className="al-in"
      style={{
        background: C.surface, border: `1px solid ${C.hairline}`, borderRadius: 24, padding: '22px 18px',
        display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', color: C.ink,
        maxWidth: 560, width: '100%', boxSizing: 'border-box', fontFamily: FONT_UI,
      }}
    >
      <div style={{ fontFamily: FONT_MONO, fontSize: 12, letterSpacing: '.18em', textTransform: 'lowercase', color: C.faint }}>
        a note from your grown-up
      </div>
      <div aria-hidden style={{ fontSize: 44 }}>💌</div>
      <div style={{ fontSize: 26, fontWeight: 500, letterSpacing: '-0.02em', textAlign: 'center', overflowWrap: 'anywhere' }}>{note.text}</div>
      {note.practice?.title && (
        <div data-testid="practice-card" style={{
          fontSize: 22, color: C.accent, fontWeight: 600, background: C.accentWash, borderRadius: 16, padding: '8px 16px',
        }}>
          Practice: {note.practice.title}
        </div>
      )}
      <button type="button" aria-label="read it to me" className="al-focus" style={BIG} onClick={() => speak(spoken)}>🔊</button>
      {said ? (
        <div data-testid="inbox-said" className="al-in" style={{ fontSize: 24, fontWeight: 500 }}>{said}</div>
      ) : (
        <>
          {opts.reactions.length > 0 && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              {opts.reactions.map((e) => (
                <button key={e} type="button" className="al-focus" style={BIG} disabled={busy} aria-label={`send ${e}`}
                  onClick={() => send({ reaction: e })}>{e}</button>
              ))}
            </div>
          )}
          {opts.phrases.length > 0 && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              {opts.phrases.map((p) => (
                <button key={p} type="button" className="al-focus" style={{ ...BIG, fontSize: 20, fontWeight: 600 }} disabled={busy}
                  onClick={() => { speak(p); send({ phrase: p }) }}>{p}</button>
              ))}
            </div>
          )}
          {opts.free_text_max > 0 && (
            <div style={{ display: 'flex', gap: 8, width: '100%', flexWrap: 'wrap', justifyContent: 'center' }}>
              <input
                aria-label="write a note back"
                value={typed}
                maxLength={opts.free_text_max}
                onChange={(e) => setTyped(e.target.value.slice(0, opts.free_text_max))}
                className="al-field"
                style={{ flex: '1 1 200px', minHeight: 64, fontSize: 20, borderRadius: 16, border: `1px solid ${C.hairlineStrong}`, padding: '0 14px', background: C.ground, color: C.ink, fontFamily: FONT_UI }}
              />
              <button type="button" className="al-primary al-focus" style={{ ...BIG, fontSize: 24, fontWeight: 600, background: C.accent, borderColor: C.accent, color: C.onAccent }} disabled={busy || !typed.trim()}
                onClick={() => send({ text: typed.trim() })}>Send</button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
