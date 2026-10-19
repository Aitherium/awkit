/**
 * FamilyQuestPanel: a storytelling adventure a grown-up runs with their kids, every player
 * on their own phone (docs/plans/2026-10-17-family-quest.md).
 *
 * Backed by Hearth /api/v1/tutor/{family,me}/adventure/* through the host app's tutor proxy
 * (apiBase). The same panel serves both sides: a paired child (GET /me/adventure answers)
 * sees the stories their grown-up invited them to; a guardian (GET /family/adventure
 * answers) picks a campaign, invites their kids, and runs the Game Master controls.
 *
 * Play: the scene in big readable words (tap a word to hear it), the Game Master's voice
 * reading each new scene, 2-3 big choice buttons, push-to-talk through the phone app's own
 * on-device recognizer (window.AitherVoice; never a browser vendor's cloud), or type, and a
 * friendly die. Every phone long-polls the shared state (?since=&wait=).
 *
 * Child-first rules this component keeps: 64px+ targets; no links, store, scores, streaks,
 * countdowns or "hurry"; only named fields of a server reply are rendered (familyQuestApi);
 * speech is a nicety: every failure is silence, never an error on screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { C, EASE, FONT_UI, LEARN_CSS, learnVars, useLearnMode } from './learnTheme'
import { createLearnVoice } from './learnVoice'
import { SpriteFace } from './spriteLook'
import {
  DIE_PIPS, asCousins, asInvites, asKids, asQuestView, asTemplates, isMyTurn, sayFor, sceneWords, turnLine,
  type QuestCousins, type QuestInvite, type QuestKid, type QuestTemplate, type QuestView,
} from './familyQuestApi'

export interface FamilyQuestPanelProps {
  /** Base of the tutor proxy, e.g. '/api/tutor'. */
  apiBase: string
  /** Headers the host app adds (its bearer). Never user identity fields. */
  extraHeaders?: Record<string, string>
  /** Test seam: how long a state read waits for a change. */
  waitSeconds?: number
}

type Role = 'loading' | 'kid' | 'host' | 'none'
interface AppVoice { canListen(): boolean; listen(): void; stop(): void }
function appVoice(): AppVoice | null {
  if (typeof window === 'undefined') return null
  const v = (window as unknown as { AitherVoice?: AppVoice }).AitherVoice
  try { return v && typeof v.listen === 'function' && v.canListen() ? v : null } catch { return null }
}

const big: CSSProperties = {
  minHeight: 64, borderRadius: 20, border: 'none', cursor: 'pointer', padding: '10px 18px',
  background: C.accent, color: C.onAccent, font: `700 20px/1.2 ${FONT_UI}`, touchAction: 'manipulation',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
}
const soft: CSSProperties = { ...big, background: C.raise, color: C.ink, border: `2px solid ${C.hairlineStrong}`, fontWeight: 600 }
const card: CSSProperties = {
  background: C.surface, border: `1px solid ${C.hairline}`, borderRadius: 24, padding: 18, width: '100%', boxSizing: 'border-box',
}
const CSS = `
.fq-word{border-radius:8px;padding:0 3px;cursor:pointer;transition:background .18s ${EASE}}
.fq-word:active,.fq-word.on{background:var(--al-accent,#5EC9CC);color:var(--al-on-accent,#050507)}
.fq-die{animation:fq-roll .7s ${EASE} both}
.fq-turn{box-shadow:0 0 0 3px var(--al-accent,#5EC9CC)}
@keyframes fq-roll{0%{transform:rotate(0) scale(.6)}60%{transform:rotate(380deg) scale(1.1)}100%{transform:rotate(360deg) scale(1)}}
@media (prefers-reduced-motion:reduce){.fq-die{animation:none!important}}
`

export function Die({ value, rolling }: { value: number; rolling?: boolean }) {
  const pips = DIE_PIPS[value] || DIE_PIPS[1]
  return (
    <svg data-testid="fq-die" className={rolling ? 'fq-die' : undefined} viewBox="0 0 90 90" width={84} height={84} aria-label={`The die shows ${value}`}>
      <rect x="4" y="4" width="82" height="82" rx="18" fill="#fff6e8" stroke="#1d1d2b" strokeWidth="3" />
      {pips.map(([r, c]) => <circle key={`${r}${c}`} cx={22 + c * 23} cy={22 + r * 23} r="7.5" fill="#1d1d2b" />)}
    </svg>
  )
}

export default function FamilyQuestPanel({ apiBase, extraHeaders, waitSeconds = 20 }: FamilyQuestPanelProps) {
  const { mode } = useLearnMode()
  const [role, setRole] = useState<Role>('loading')
  const [invites, setInvites] = useState<QuestInvite[]>([])
  const [templates, setTemplates] = useState<QuestTemplate[]>([])
  const [kids, setKids] = useState<QuestKid[]>([])
  const [openSessions, setOpenSessions] = useState<Array<{ sid: string; title: string }>>([])
  const [view, setView] = useState<QuestView | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [rolling, setRolling] = useState(false)
  const [typing, setTyping] = useState('')
  const [listening, setListening] = useState(false)
  const [heard, setHeard] = useState('')
  const [voice] = useState<AppVoice | null>(() => appVoice())
  // host setup
  const [pick, setPick] = useState<string>('dragon_egg')
  const [idea, setIdea] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  // Cousins: children a CONNECTED family shared with yours (Hearth connected families). One
  // family per story; the server refuses unless your own players are shared with it too.
  const [cousins, setCousins] = useState<QuestCousins[]>([])
  const [guests, setGuests] = useState<{ connection: string; kids: string[] }>({ connection: '', kids: [] })
  const [minutes, setMinutes] = useState(30)
  const [steer, setSteer] = useState('')
  const headersRef = useRef(extraHeaders || {})
  headersRef.current = extraHeaders || {}
  const spokenRef = useRef(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const call = useCallback(async (path: string, method = 'GET', body?: object) => {
    const r = await fetch(`${apiBase}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headersRef.current },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const data = await r.json().catch(() => null)
    return { status: r.status, ok: r.ok, data }
  }, [apiBase])

  const wordVoice = useMemo(() => createLearnVoice(apiBase, () => headersRef.current), [apiBase])

  // Who am I here: a paired child, or a grown-up who can host.
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const me = await call('/me/adventure')
        if (!live) return
        if (me.ok) { setInvites(asInvites(me.data)); setRole('kid'); return }
        const fam = await call('/family/adventure')
        if (!live) return
        if (fam.ok) {
          setTemplates(asTemplates(fam.data))
          const ks = asKids(fam.data)
          setKids(ks)
          setChosen(ks.map((k) => k.lid))
          setCousins(asCousins(fam.data))
          const d = (fam.data || {}) as { sessions?: Array<{ sid?: unknown; title?: unknown }> }
          setOpenSessions((d.sessions || []).filter((s) => typeof s.sid === 'string')
            .map((s) => ({ sid: String(s.sid), title: String(s.title || 'Adventure') })))
          setRole('host')
          return
        }
        setRole('none')
      } catch { if (live) setRole('none') }
    })()
    return () => { live = false }
  }, [call])

  const base = role === 'host' ? '/family/adventure/sessions' : '/me/adventure'

  // Live sync: long-poll the shared story while one is open.
  const sid = view?.sid
  useEffect(() => {
    if (!sid) return
    let live = true
    let since = 0
    void (async () => {
      while (live) {
        try {
          const r = await call(`${base}/${sid}?since=${since}&wait=${waitSeconds}`)
          if (!live) return
          const v = r.ok ? asQuestView(r.data) : null
          if (v) { since = v.version; setView((cur) => (cur && cur.version > v.version ? cur : v)) }
          else await new Promise((res) => setTimeout(res, 3000))
          if (v?.state === 'ended') return
        } catch { await new Promise((res) => setTimeout(res, 3000)) }
      }
    })()
    return () => { live = false }
  }, [sid, base, call, waitSeconds])

  // The Game Master reads each NEW scene once, in the household's voice.
  const sceneN = view?.scene?.n || 0
  useEffect(() => {
    if (!sid || !sceneN || sceneN <= spokenRef.current) return
    spokenRef.current = sceneN
    void (async () => {
      try {
        const r = await fetch(`${apiBase}${base}/${sid}/voice`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...headersRef.current },
          body: JSON.stringify({ n: sceneN }),
        })
        if (!r.ok || !(r.headers.get('content-type') || '').startsWith('audio/') || typeof Audio === 'undefined') return
        const url = URL.createObjectURL(await r.blob())
        try { audioRef.current?.pause() } catch { /* gone */ }
        const el = new Audio(url)
        audioRef.current = el
        el.addEventListener?.('ended', () => { try { URL.revokeObjectURL(url) } catch { /* gone */ } }, { once: true })
        await el.play().catch(() => undefined)
      } catch { /* silence: the words are on screen */ }
    })()
  }, [sid, sceneN, apiBase, base])

  const act = async (path: string, body?: object) => {
    if (!view || busy) return
    setBusy(true)
    setNote('')
    try {
      const r = await call(`${base}/${view.sid}${path}`, 'POST', body || {})
      const v = r.ok ? asQuestView(r.data) : null
      if (v) setView(v)
      else {
        const d = (r.data || {}) as { say?: unknown; worry?: unknown }
        setNote(typeof d.say === 'string' ? d.say : sayFor(r.status, r.data))
      }
    } catch { setNote("Let's try that again in a moment.") } finally { setBusy(false) }
  }

  const sayTurn = (text: string) => { const t = text.trim(); if (t) { setTyping(''); setHeard(''); void act('/turn', { text: t.slice(0, 500) }) } }
  const roll = async () => { setRolling(true); await act('/roll'); setTimeout(() => setRolling(false), 800) }

  useEffect(() => {
    if (!voice) return
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ type?: string; text?: string }>).detail || {}
      if (d.type === 'listening') { setListening(true); setHeard('') }
      else if (d.type === 'partial') setHeard(d.text || '')
      else if (d.type === 'final' && d.text) { setHeard(d.text); sayTurn(d.text) }
      else if (d.type === 'end' || d.type === 'error') setListening(false)
    }
    window.addEventListener('aither-voice', on)
    return () => window.removeEventListener('aither-voice', on)
  })

  const join = async (s: QuestInvite) => {
    setBusy(true)
    try {
      const r = await call(`/me/adventure/${s.sid}/join`, 'POST', {})
      const v = r.ok ? asQuestView(r.data) : null
      if (v) setView(v)
      else setNote(sayFor(r.status, r.data))
    } finally { setBusy(false) }
  }

  const create = async () => {
    setBusy(true)
    setNote('')
    try {
      const body: Record<string, unknown> = { template: pick, players: chosen, minutes,
        tz_offset_min: -new Date().getTimezoneOffset() }
      if (guests.connection && guests.kids.length) {
        body.connection = guests.connection
        body.guests = guests.kids
      }
      if (pick === 'make_one_up') body.idea = idea.trim()
      const r = await call('/family/adventure/sessions', 'POST', body)
      const v = r.ok ? asQuestView(r.data) : null
      if (v) setView(v)
      else setNote(sayFor(r.status, r.data))
    } finally { setBusy(false) }
  }

  const reopen = async (s: string) => {
    const r = await call(`/family/adventure/sessions/${s}`)
    const v = r.ok ? asQuestView(r.data) : null
    if (v) setView(v)
  }

  const shell = useMemo<CSSProperties>(() => ({
    ...learnVars(mode), background: C.ground, color: C.ink, minHeight: '100%', padding: '16px 14px 40px',
    boxSizing: 'border-box', fontFamily: FONT_UI, fontSize: 20, lineHeight: 1.45, display: 'flex',
    flexDirection: 'column', gap: 16, alignItems: 'stretch', maxWidth: 560, margin: '0 auto', width: '100%',
  }), [mode])

  let body
  if (role === 'loading') body = <div style={{ textAlign: 'center', color: C.dim }}>Getting the story ready…</div>
  else if (role === 'none') body = <div style={{ textAlign: 'center', color: C.dim }}>Family Quest is for your family. Ask a grown-up to start a story.</div>
  else if (view) body = renderPlay()
  else if (role === 'kid') {
    body = (
      <>
        <h1 style={{ margin: 0, fontSize: 30, textAlign: 'center' }}>Family Quest</h1>
        {invites.length === 0 ? (
          <div style={{ ...card, textAlign: 'center', color: C.dim }}>No story yet. Your grown-up can start one!</div>
        ) : invites.map((s) => (
          <button key={s.sid} data-testid="fq-invite" type="button" disabled={busy} onClick={() => void join(s)} style={{ ...big, width: '100%', flexDirection: 'column', minHeight: 96 }}>
            <span style={{ fontSize: 24 }}>{s.title}</span>
            <span style={{ fontSize: 16, fontWeight: 500 }}>{s.host} is ready. Tap to play!</span>
          </button>
        ))}
      </>
    )
  } else {
    body = (
      <>
        <h1 style={{ margin: 0, fontSize: 28 }}>Family Quest</h1>
        <div style={{ color: C.dim, fontSize: 16 }}>Pick a story, choose who plays, then everyone joins on their own phone.</div>
        {openSessions.map((s) => (
          <button key={s.sid} type="button" style={{ ...soft, width: '100%' }} onClick={() => void reopen(s.sid)}>Back to {s.title}</button>
        ))}
        <div role="radiogroup" aria-label="Story" style={{ display: 'grid', gap: 10 }}>
          {templates.map((t) => (
            <button key={t.id} data-testid="fq-template" type="button" role="radio" aria-checked={pick === t.id} onClick={() => setPick(t.id)}
              style={{ ...card, textAlign: 'left', cursor: 'pointer', borderColor: pick === t.id ? C.accent : C.hairline, borderWidth: 2 }}>
              <div style={{ fontWeight: 700, fontSize: 20 }}>{t.title}</div>
              <div style={{ color: C.dim, fontSize: 16 }}>{t.blurb}</div>
            </button>
          ))}
        </div>
        {pick === 'make_one_up' ? (
          <input aria-label="What is the story about?" className="al-field" value={idea} maxLength={140} onChange={(e) => setIdea(e.target.value)}
            placeholder="A pancake who wants to fly…" style={{ ...card, font: `500 18px ${FONT_UI}`, color: C.ink }} />
        ) : null}
        <div style={{ ...card, display: 'grid', gap: 8 }}>
          <div style={{ fontWeight: 600 }}>Who is playing?</div>
          {kids.map((k) => (
            <label key={k.lid} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48 }}>
              <input type="checkbox" checked={chosen.includes(k.lid)} style={{ width: 26, height: 26 }}
                onChange={(e) => setChosen((c) => (e.target.checked ? [...c, k.lid] : c.filter((x) => x !== k.lid)))} />
              {k.name}
            </label>
          ))}
          {cousins.map((fam) => fam.kids.map((k) => {
            const on = guests.connection === fam.connection && guests.kids.includes(k.kid)
            return (
              <label key={k.kid} data-testid="fq-cousin" style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48 }}>
                <input type="checkbox" checked={on} style={{ width: 26, height: 26 }}
                  onChange={(e) => setGuests((g) => {
                    const same = g.connection === fam.connection ? g.kids : []
                    const next = e.target.checked ? [...same, k.kid] : same.filter((x) => x !== k.kid)
                    return { connection: next.length ? fam.connection : '', kids: next }
                  })} />
                {k.name} <span style={{ color: C.dim, fontSize: 15 }}>· {fam.family}</span>
              </label>
            )
          }))}
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48 }}>
            Play for
            <select aria-label="Minutes" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} style={{ font: `600 18px ${FONT_UI}`, minHeight: 44 }}>
              {[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </label>
        </div>
        <button data-testid="fq-create" type="button" disabled={busy || !(chosen.length || guests.kids.length) || (pick === 'make_one_up' && !idea.trim())} onClick={() => void create()} style={{ ...big, width: '100%' }}>Start a new story</button>
      </>
    )
  }

  function renderPlay() {
    const v = view as QuestView
    const mine = isMyTurn(v)
    const words = v.scene ? sceneWords(v.scene.text) : []
    const unseen = v.alerts.filter((a) => !a.seen)
    return (
      <>
        <h1 style={{ margin: 0, fontSize: 24, textAlign: 'center' }}>{v.title}</h1>
        {v.host && unseen.length ? (
          <div data-testid="fq-alert" role="alert" style={{ ...card, background: C.amberWash, borderColor: C.amber, fontSize: 16 }}>
            {unseen.map((a) => `${a.name} said something you should hear.`).join(' ')} The story is paused. Read it in the Guardian Center, then resume when ready.
          </div>
        ) : null}
        <div data-testid="fq-players" style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          {v.players.filter((p) => p.joined || v.state === 'lobby').map((p) => (
            <div key={p.pid} className={p.pid === v.turnPid && v.state === 'playing' ? 'fq-turn' : undefined}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 8, borderRadius: 18, minWidth: 84, opacity: p.joined ? 1 : 0.45 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', overflow: 'hidden', background: C.accentWash, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>
                {p.sprite ? <SpriteFace sprite={p.sprite} size={56} /> : <span aria-hidden="true">{p.kind === 'guardian' ? '🧭' : '⭐'}</span>}
              </div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{p.name}</div>
            </div>
          ))}
        </div>
        {v.scene ? (
          <div data-testid="fq-scene" style={{ ...card, fontSize: 26, lineHeight: 1.55, fontWeight: 500 }}>
            {words.map((w, i) => (
              <span key={i}>
                <span className="fq-word" role="button" tabIndex={0} onClick={() => wordVoice(w.say)}
                  onKeyDown={(e) => { if (e.key === 'Enter') wordVoice(w.say) }}>{w.w}</span>{' '}
              </span>
            ))}
          </div>
        ) : null}
        <div data-testid="fq-turn-line" style={{ textAlign: 'center', fontSize: 20, color: mine ? C.accent : C.dim, fontWeight: 600 }}>{turnLine(v)}</div>
        {v.pendingRoll ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <Die value={v.pendingRoll.value} rolling={rolling} />
            <span style={{ fontSize: 20 }}>{v.pendingRoll.word}!</span>
          </div>
        ) : null}
        {mine ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {(v.scene?.choices || []).map((c, i) => (
              <button key={c} data-testid="fq-choice" type="button" disabled={busy} onClick={() => void act('/turn', { choice: i })} style={{ ...big, width: '100%' }}>{c}</button>
            ))}
            <div style={{ display: 'flex', gap: 10 }}>
              {voice ? (
                <button data-testid="fq-talk" type="button" disabled={busy} onClick={() => (listening ? voice.stop() : voice.listen())} style={{ ...soft, flex: 1 }}>
                  {listening ? 'Listening… tap when done' : '🎤 Say my idea'}
                </button>
              ) : null}
              {!v.pendingRoll ? (
                <button data-testid="fq-roll" type="button" disabled={busy} onClick={() => void roll()} style={{ ...soft, flex: 1 }}>🎲 Roll the die</button>
              ) : null}
            </div>
            {heard ? <div style={{ textAlign: 'center', color: C.dim }}>“{heard}”</div> : null}
            <form onSubmit={(e) => { e.preventDefault(); sayTurn(typing) }} style={{ display: 'flex', gap: 8 }}>
              <input aria-label="Type your idea" className="al-field" value={typing} maxLength={300} onChange={(e) => setTyping(e.target.value)}
                placeholder="Or type your idea" style={{ flex: 1, minHeight: 56, borderRadius: 16, border: `1px solid ${C.hairlineStrong}`, background: C.raise, color: C.ink, padding: '0 14px', font: `500 18px ${FONT_UI}` }} />
              <button type="submit" disabled={busy || !typing.trim()} style={{ ...big, minWidth: 72 }}>Go</button>
            </form>
          </div>
        ) : null}
        {note ? <div data-testid="fq-note" style={{ textAlign: 'center', fontSize: 18 }}>{note}</div> : null}
        {v.host && v.state !== 'ended' ? (
          <div data-testid="fq-gm" style={{ ...card, display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 14, color: C.faint, letterSpacing: '.12em', textTransform: 'lowercase' }}>game master</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {v.state === 'lobby' ? (
                <button data-testid="fq-start" type="button" disabled={busy || v.players.filter((p) => p.joined).length < 2} onClick={() => void act('/start')} style={{ ...big, flex: 1 }}>Begin the story</button>
              ) : null}
              {v.state === 'playing' ? <button type="button" disabled={busy} onClick={() => void act('/control', { action: 'pause' })} style={{ ...soft, flex: 1 }}>Pause</button> : null}
              {v.state === 'paused' ? <button type="button" disabled={busy} onClick={() => void act('/control', { action: 'resume' })} style={{ ...soft, flex: 1 }}>Resume</button> : null}
              {v.state === 'playing' ? <button type="button" disabled={busy} onClick={() => void act('/control', { action: 'skip' })} style={{ ...soft, flex: 1 }}>Skip turn</button> : null}
              <button type="button" disabled={busy} onClick={() => void act('/control', { action: 'end' })} style={{ ...soft, flex: 1 }}>End</button>
            </div>
            {v.state === 'playing' ? (
              <form onSubmit={(e) => { e.preventDefault(); if (steer.trim()) { void act('/control', { action: 'steer', steer: steer.trim() }); setSteer('') } }} style={{ display: 'flex', gap: 8 }}>
                <input aria-label="Steer the story" className="al-field" value={steer} maxLength={160} onChange={(e) => setSteer(e.target.value)}
                  placeholder="Steer: a friendly bunny joins…" style={{ flex: 1, minHeight: 48, borderRadius: 14, border: `1px solid ${C.hairlineStrong}`, background: C.raise, color: C.ink, padding: '0 12px', font: `500 16px ${FONT_UI}` }} />
                <button type="submit" disabled={busy || !steer.trim()} style={{ ...soft, minHeight: 48 }}>Steer</button>
              </form>
            ) : null}
          </div>
        ) : null}
      </>
    )
  }

  return (
    <div data-testid="family-quest" className="al-in" style={shell}>
      <style>{LEARN_CSS + CSS}</style>
      {body}
    </div>
  )
}
