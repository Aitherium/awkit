/**
 * KidNest: the child's daily hub, with their Sprite as a personal assistant (Aither Learn).
 *
 * Backed by Hearth /api/v1/tutor/me/nest/* through the host app's tutor proxy (apiBase).
 * The server derives the child from their own session (no learner id in any request) and
 * owns every rule: which tools the guardian switched on, quiet hours, the reminder cap,
 * the worry escalation, the Sprite's memory. This panel shows one thing at a time and
 * sends taps.
 *
 * Child-first rules this component keeps (ADHD friendly, docs/plans/2026-10-14-kids-suite.md):
 * - ONE screen: the Sprite's bubble, "What's today?", the routine as big picture circles,
 *   the Mailbox, and up to five tool bubbles. Each tool opens one full view with Back.
 * - Pictures first, 64px+ targets, every line can be heard (the speaker on the bubble).
 * - No streaks, no counts of missed things, no red, no timers, no badges that nag.
 *   "Today" is all there is; an unfinished routine is just unfinished.
 * - A new gift wiggles and the Sprite says "Your grown-up left you something!" (the Nest
 *   re-reads My day every few seconds while it is on screen, so it arrives within 5 s).
 * - Nothing leaves the app: no links are ever rendered; a game gift calls `onOpenGame`.
 * - Only named, expected fields are read from the server.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { C, EASE, FONT_UI } from './learnTheme'
import { createLearnVoice, type LearnSpeak } from './learnVoice'
import { fetchVoiceRule, readChildMuted, spriteMaySpeak } from './spriteVoice'

export interface KidNestProps {
  /** Base of the tutor proxy, e.g. '/api/tutor'. */
  apiBase: string
  /** Headers the host app adds (its bearer). Never user identity fields. */
  extraHeaders?: Record<string, string>
  /** A gift that is a game: the host opens its own in-app games view. */
  onOpenGame?: (game: string) => void
  /** How often My day is re-read while the Nest is on screen (ms). */
  refreshMs?: number
}

interface Step { sid: string; text: string; icon: string; done: boolean }
interface Routine { rid: string; name: string; when: string; steps: Step[]; done_count: number; all_done: boolean }
interface MailItem { id: string; kind: 'gift' | 'task' | 'practice'; title: string; gift_type?: string }
interface Reminder { id: string; text: string; icon: string; when: string; now?: boolean }
interface DayEvent { id: string; title: string; time: string; icon: string }
interface Preset { id: string; text: string; icon: string }
interface WhenChoice { id: string; label: string }
interface Day {
  greeting: string
  announce: string
  remembered: string
  speak: string
  routine: Routine | null
  mailbox: MailItem[]
  reminders: Reminder[]
  events: DayEvent[]
  tools: string[]
  tool_words: Record<string, string>
  reminder_presets: Preset[]
  when_choices: WhenChoice[]
  ask_presets: string[]
  free_text: boolean
}
interface StoryTurn { who: 'child' | 'sprite'; text: string }
interface OpenedGift { type: string; title: string; text?: string; prompt?: string; game?: string; blurb?: string; say?: string }

type View = 'home' | 'remind' | 'read' | 'journal' | 'ask' | 'homework' | 'gift'

/** The picture for each routine/reminder icon id (the server only ever sends ids). */
export const NEST_ICONS: Record<string, string> = {
  teeth: '🪥', dress: '👕', shoes: '👟', backpack: '🎒', breakfast: '🥣', lunch: '🥪',
  dinner: '🍽️', bath: '🛁', pajamas: '🌙', book: '📖', bed: '🛏️', toys: '🧸', pet: '🐾',
  plant: '🪴', water: '💧', hands: '🧼', hair: '💇', homework: '✏️', music: '🎵',
  outside: '🌳', hug: '🤗', star: '⭐',
}
const TOOL_ICONS: Record<string, string> = {
  remind_me: '⏰', read_with_me: '📚', tell_my_sprite: '💬', ask_a_grownup: '🙋', homework_help: '✏️',
}
const GIFT_ICONS: Record<string, string> = { game: '🎲', book: '📖', story: '✨', art: '🎨' }
const FEELINGS: { emoji: string; word: string }[] = [
  { emoji: '😊', word: 'happy' }, { emoji: '🤩', word: 'excited' }, { emoji: '😴', word: 'tired' },
  { emoji: '😢', word: 'sad' }, { emoji: '😠', word: 'mad' },
]
const NEXT_IDEAS = ['A friend arrives!', 'They find a treasure!', 'It starts to rain!', 'They fly to the moon!']

const NEST_CSS = `
.kn-wiggle{animation:kn-wiggle 1.6s ${EASE} infinite;transform-origin:50% 80%}
.kn-breathe{animation:kn-breathe 4s ease-in-out infinite}
.kn-pop{animation:kn-pop .42s ${EASE} both}
@keyframes kn-wiggle{0%,60%,100%{transform:rotate(0)}70%{transform:rotate(-8deg)}80%{transform:rotate(8deg)}90%{transform:rotate(-4deg)}}
@keyframes kn-breathe{50%{transform:scale(1.04)}}
@keyframes kn-pop{from{transform:scale(.6);opacity:0}}
@media (prefers-reduced-motion:reduce){.kn-wiggle,.kn-breathe,.kn-pop{animation:none!important}}
`

const CARD: CSSProperties = {
  width: '100%', maxWidth: 720, boxSizing: 'border-box', borderRadius: 28, padding: 20,
  border: `1px solid ${C.hairline}`, background: C.raise, display: 'flex', flexDirection: 'column', gap: 16,
  fontFamily: FONT_UI, color: C.ink,
}
const BIG: CSSProperties = {
  minHeight: 64, minWidth: 64, borderRadius: 22, border: `1px solid ${C.hairlineStrong}`, background: C.surface,
  color: C.ink, cursor: 'pointer', fontFamily: FONT_UI, fontSize: 20, padding: '8px 16px', touchAction: 'manipulation',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
}
const ROUND: CSSProperties = {
  ...BIG, width: 76, height: 76, minWidth: 76, borderRadius: '50%', padding: 0, fontSize: 34, flexDirection: 'column', gap: 0,
}
const ROW: CSSProperties = { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
function str(v: unknown): string { return typeof v === 'string' ? v : '' }

/** Read only the named fields of My day (a server bug never reaches the screen). */
export function asDay(raw: unknown): Day | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const r = d.routine && typeof d.routine === 'object' ? (d.routine as Record<string, unknown>) : null
  const routine: Routine | null = r && typeof r.rid === 'string' ? {
    rid: r.rid, name: str(r.name), when: str(r.when),
    steps: (Array.isArray(r.steps) ? r.steps : []).flatMap((s) => {
      const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>
      return typeof o.sid === 'string' ? [{ sid: o.sid, text: str(o.text), icon: str(o.icon) || 'star', done: o.done === true }] : []
    }),
    done_count: Number(r.done_count) || 0, all_done: r.all_done === true,
  } : null
  const list = <T,>(v: unknown, f: (o: Record<string, unknown>) => T | null): T[] =>
    (Array.isArray(v) ? v : []).flatMap((x) => {
      const got = x && typeof x === 'object' ? f(x as Record<string, unknown>) : null
      return got ? [got] : []
    })
  const words = (d.tool_words && typeof d.tool_words === 'object' ? d.tool_words : {}) as Record<string, unknown>
  return {
    greeting: str(d.greeting), announce: str(d.announce), remembered: str(d.remembered), speak: str(d.speak),
    routine,
    mailbox: list(d.mailbox, (o) => (typeof o.id === 'string' && ['gift', 'task', 'practice'].includes(str(o.kind))
      ? { id: o.id, kind: o.kind as MailItem['kind'], title: str(o.title), gift_type: str(o.gift_type) } : null)),
    reminders: list(d.reminders, (o) => (typeof o.id === 'string'
      ? { id: o.id, text: str(o.text), icon: str(o.icon) || 'star', when: str(o.when), now: o.now === true } : null)),
    events: list(d.events, (o) => (typeof o.id === 'string'
      ? { id: o.id, title: str(o.title), time: str(o.time), icon: str(o.icon) || 'star' } : null)),
    tools: strings(d.tools),
    tool_words: Object.fromEntries(Object.entries(words).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
    reminder_presets: list(d.reminder_presets, (o) => (typeof o.id === 'string'
      ? { id: o.id, text: str(o.text), icon: str(o.icon) || 'star' } : null)),
    when_choices: list(d.when_choices, (o) => (typeof o.id === 'string' ? { id: o.id, label: str(o.label) } : null)),
    ask_presets: strings(d.ask_presets),
    free_text: d.free_text === true,
  }
}

function sayOf(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const o = data as Record<string, unknown>
  if (typeof o.say === 'string') return o.say
  const det = o.detail
  if (det && typeof det === 'object' && typeof (det as Record<string, unknown>).say === 'string') {
    return (det as Record<string, string>).say
  }
  return ''
}

export default function KidNest({ apiBase, extraHeaders = {}, onOpenGame, refreshMs = 4000 }: KidNestProps) {
  const headersRef = useRef(extraHeaders)
  headersRef.current = extraHeaders
  const speakRef = useRef<LearnSpeak>(() => {})
  const voiceBase = useRef<string | null>(null)
  if (voiceBase.current !== apiBase) {
    voiceBase.current = apiBase
    speakRef.current = createLearnVoice(apiBase, () => headersRef.current)
  }
  const mayAutoSpeak = useRef(false)
  const [day, setDay] = useState<Day | null>(null)
  const [view, setView] = useState<View>('home')
  const [bubble, setBubble] = useState('')
  const [busy, setBusy] = useState(false)
  const [opened, setOpened] = useState<OpenedGift | null>(null)
  const [storyGift, setStoryGift] = useState<string | undefined>(undefined)
  const seenGifts = useRef<Set<string> | null>(null)
  const tz = -new Date().getTimezoneOffset()

  const call = useCallback(async (path: string, method = 'GET', body?: object) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headersRef.current } }
    if (body) init.body = JSON.stringify(body)
    const r = await fetch(`${apiBase}${path}`, init)
    const data = await r.json().catch(() => null)
    return { ok: r.ok, status: r.status, data }
  }, [apiBase])

  const say = useCallback((line: string, speak = false) => {
    setBubble(line)
    if (line && speak) speakRef.current(line)
  }, [])

  const load = useCallback(async () => {
    try {
      const r = await call(`/me/nest/day?tz=${tz}`)
      if (!r.ok) return
      const d = asDay(r.data)
      if (!d) return
      setDay(d)
      const gifts = d.mailbox.filter((i) => i.kind === 'gift').map((i) => i.id)
      if (seenGifts.current === null) {
        seenGifts.current = new Set(gifts)
        setBubble((b) => b || d.announce || (d.remembered ? `${d.greeting} I remember: ${d.remembered}.` : d.greeting))
      } else if (gifts.some((g) => !seenGifts.current!.has(g))) {
        gifts.forEach((g) => seenGifts.current!.add(g))
        say(d.announce || 'Your grown-up left you something!', mayAutoSpeak.current)
      }
    } catch { /* the Nest simply waits for the next look */ }
  }, [call, tz, say])

  useEffect(() => {
    let live = true
    fetchVoiceRule(apiBase, headersRef.current).then((rule) => {
      if (live) mayAutoSpeak.current = spriteMaySpeak(rule, readChildMuted())
    }).catch(() => undefined)
    return () => { live = false }
  }, [apiBase])

  useEffect(() => {
    load()
    if (view !== 'home' || refreshMs <= 0) return
    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') load()
    }, refreshMs)
    return () => clearInterval(id)
  }, [load, view, refreshMs])

  if (!day) return null
  const on = (t: string) => day.tools.includes(t)
  const home = () => { setView('home'); setStoryGift(undefined); load() }

  const openGift = (id: string) => {
    setOpened(null)
    call(`/me/nest/gifts/${encodeURIComponent(id)}/open`, 'POST').then((r) => {
      if (!r.ok || !r.data || typeof r.data !== 'object') { home(); return }
      const g = (r.data as Record<string, unknown>).gift as Record<string, unknown> | undefined
      if (!g) { home(); return }
      const gift: OpenedGift = {
        type: str(g.type), title: str(g.title), text: str(g.text), prompt: str(g.prompt),
        game: str(g.game), blurb: str(g.blurb), say: str(g.say),
      }
      if (gift.type === 'story') setStoryGift(id)
      setOpened(gift)
      say(gift.say || gift.title, true)
    }).catch(() => home())
  }

  const tick = async (step: Step) => {
    if (!day.routine || busy) return
    setBusy(true)
    const r = await call(`/me/nest/routines/${encodeURIComponent(day.routine.rid)}/steps/${encodeURIComponent(step.sid)}`,
      'POST', { done: !step.done, tz }).catch(() => null)
    setBusy(false)
    if (r && r.ok) {
      say(sayOf(r.data), true)
      load()
    }
  }

  return (
    <section data-testid="kid-nest" aria-label="My Nest" style={CARD}>
      <style>{NEST_CSS}</style>
      <SpriteBubble text={bubble || day.greeting} onSpeak={() => speakRef.current(bubble || day.greeting)} />
      {view === 'home' && (
        <>
          <button type="button" className="al-focus kn-breathe" data-testid="nest-today"
            style={{ ...BIG, fontSize: 24, minHeight: 72, background: C.accentWash, borderColor: C.accent }}
            onClick={() => say(day.speak, true)}>
            <span aria-hidden>☀️</span> What's today?
          </button>
          {day.routine && on('my_routine') && (
            <div data-testid="nest-routine" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 18, color: C.dim }}>{day.routine.name}</div>
              <div style={ROW}>
                {day.routine.steps.map((s) => (
                  <button key={s.sid} type="button" className="al-focus" data-testid={`routine-step-${s.sid}`}
                    aria-pressed={s.done} aria-label={`${s.text}${s.done ? ', done' : ''}`}
                    style={{ ...ROUND, background: s.done ? C.accentWash : C.surface, borderColor: s.done ? C.accent : C.hairlineStrong }}
                    onClick={() => tick(s)}>
                    <span aria-hidden>{s.done ? '✅' : (NEST_ICONS[s.icon] || '⭐')}</span>
                    <span style={{ fontSize: 11, color: C.dim, maxWidth: 68, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <Mailbox day={day} onGift={(id) => { setView('gift'); openGift(id) }} onHelp={on('homework_help') ? () => setView('homework') : undefined} />
          {(day.events.length > 0 || day.reminders.length > 0) && (
            <div data-testid="nest-today-list" style={{ ...ROW, fontSize: 18 }}>
              {day.events.map((e) => (
                <span key={e.id} style={{ ...BIG, cursor: 'default' }}><span aria-hidden>{NEST_ICONS[e.icon] || '📅'}</span>{e.title}{e.time ? ` · ${e.time}` : ''}</span>
              ))}
              {day.reminders.map((m) => (
                <span key={m.id} style={{ ...BIG, cursor: 'default', borderColor: m.now ? C.accent : C.hairlineStrong }}>
                  <span aria-hidden>⏰</span>{m.text} · {m.when}
                </span>
              ))}
            </div>
          )}
          <div role="group" aria-label="Ask your Sprite" style={{ ...ROW, justifyContent: 'center' }}>
            {(['read_with_me', 'tell_my_sprite', 'remind_me', 'ask_a_grownup'] as const).filter(on).map((t) => (
              <button key={t} type="button" className="al-focus" data-testid={`nest-tool-${t}`}
                style={{ ...ROUND, width: 96, height: 96, minWidth: 96 }} aria-label={day.tool_words[t] || t}
                onClick={() => { setView(VIEW_OF[t]); say(OPENERS[t]) }}>
                <span aria-hidden>{TOOL_ICONS[t]}</span>
                <span style={{ fontSize: 12, color: C.dim }}>{day.tool_words[t] || t}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {view === 'remind' && <RemindView day={day} call={call} tz={tz} say={say} onBack={home} />}
      {view === 'read' && <ReadView call={call} say={say} onBack={home} giftId={storyGift} />}
      {view === 'journal' && <JournalView call={call} say={say} onBack={home} />}
      {view === 'ask' && <AskView day={day} call={call} say={say} onBack={home} />}
      {view === 'homework' && <HomeworkView day={day} call={call} say={say} onBack={home} />}
      {view === 'gift' && (
        <GiftView gift={opened} onBack={() => { setOpened(null); home() }} speak={(t) => speakRef.current(t)}
          onGame={(g) => { onOpenGame?.(g); setOpened(null); home() }}
          onStory={() => { setView('read') }} />
      )}
    </section>
  )
}

const VIEW_OF: Record<string, View> = {
  remind_me: 'remind', read_with_me: 'read', tell_my_sprite: 'journal', ask_a_grownup: 'ask', homework_help: 'homework',
}
const OPENERS: Record<string, string> = {
  remind_me: 'What should I remind you about?',
  read_with_me: "Let's make a story together!",
  tell_my_sprite: 'How was your day? Tell me!',
  ask_a_grownup: 'What would you like to ask?',
  homework_help: "Which one shall we look at? I'll give you hints.",
}

type Call = (path: string, method?: string, body?: object) => Promise<{ ok: boolean; status: number; data: unknown }>
type Say = (line: string, speak?: boolean) => void

function SpriteBubble({ text, onSpeak }: { text: string; onSpeak: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
      <div aria-hidden className="kn-breathe" style={{
        width: 84, height: 84, minWidth: 84, borderRadius: '50%', background: `radial-gradient(circle at 35% 30%, ${C.accentGlow}, ${C.accentWash})`,
        border: `1px solid ${C.hairline}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 44,
      }}>🪺</div>
      <div data-testid="nest-bubble" role="status" aria-live="polite" style={{
        flex: 1, fontSize: 22, lineHeight: 1.35, padding: '12px 16px', borderRadius: 22, background: C.surface,
        border: `1px solid ${C.hairline}`,
      }}>{text}</div>
      <button type="button" className="al-focus" aria-label="Say it again" style={{ ...ROUND, width: 64, height: 64, minWidth: 64, fontSize: 26 }} onClick={onSpeak}>🔊</button>
    </div>
  )
}

function Mailbox({ day, onGift, onHelp }: { day: Day; onGift: (id: string) => void; onHelp?: () => void }) {
  if (day.mailbox.length === 0) return null
  const gifts = day.mailbox.filter((i) => i.kind === 'gift')
  const work = day.mailbox.filter((i) => i.kind !== 'gift')
  return (
    <div data-testid="nest-mailbox" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 18, color: C.dim }}><span aria-hidden>📬</span> Mailbox</div>
      <div style={ROW}>
        {gifts.map((g) => (
          <button key={g.id} type="button" className="al-focus kn-wiggle" data-testid={`nest-gift-${g.id}`}
            aria-label="Open your gift" style={{ ...ROUND, width: 96, height: 96, minWidth: 96, fontSize: 48, borderColor: C.accent, background: C.accentWash }}
            onClick={() => onGift(g.id)}>🎁</button>
        ))}
        {work.map((w) => (
          <span key={w.id} data-testid={`nest-work-${w.id}`} style={{ ...BIG, cursor: 'default' }}>
            <span aria-hidden>{w.kind === 'practice' ? '🧩' : '📝'}</span>{w.title}
          </span>
        ))}
        {work.length > 0 && onHelp && (
          <button type="button" className="al-focus" style={BIG} onClick={onHelp}><span aria-hidden>✏️</span> Help me</button>
        )}
      </div>
    </div>
  )
}

function Back({ onBack }: { onBack: () => void }) {
  return <button type="button" className="al-focus" style={{ ...BIG, alignSelf: 'flex-start' }} onClick={onBack} aria-label="Back to my Nest">⬅️ Back</button>
}

function RemindView({ day, call, tz, say, onBack }: { day: Day; call: Call; tz: number; say: Say; onBack: () => void }) {
  const [what, setWhat] = useState<Preset | null>(null)
  const make = async (when: string) => {
    if (!what) return
    const r = await call('/me/nest/reminders', 'POST', { preset: what.id, when, tz }).catch(() => null)
    say(r ? sayOf(r.data) || 'Hmm, let me try that again later.' : 'Hmm, let me try that again later.', true)
    if (r && r.ok) onBack()
  }
  return (
    <div data-testid="nest-remind" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Back onBack={onBack} />
      {!what ? (
        <div style={ROW}>
          {day.reminder_presets.map((p) => (
            <button key={p.id} type="button" className="al-focus" style={BIG} data-testid={`remind-${p.id}`}
              onClick={() => { setWhat(p); say(`${p.text}. When?`, true) }}>
              <span aria-hidden style={{ fontSize: 30 }}>{NEST_ICONS[p.icon] || '⭐'}</span>{p.text}
            </button>
          ))}
        </div>
      ) : (
        <div style={ROW}>
          {day.when_choices.map((w) => (
            <button key={w.id} type="button" className="al-focus" style={BIG} data-testid={`when-${w.id}`} onClick={() => make(w.id)}>{w.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function ReadView({ call, say, onBack, giftId }: { call: Call; say: Say; onBack: () => void; giftId?: string }) {
  const [turns, setTurns] = useState<StoryTurn[]>([])
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const send = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true)
    const r = await call('/me/nest/read', 'POST', body).catch(() => null)
    setBusy(false)
    if (!r) return
    say(sayOf(r.data), true)
    const t = r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>).turns : null
    if (Array.isArray(t)) {
      setTurns(t.flatMap((x) => (x && typeof x === 'object' && typeof (x as StoryTurn).text === 'string'
        ? [{ who: (x as StoryTurn).who === 'child' ? 'child' : 'sprite', text: (x as StoryTurn).text } as StoryTurn] : [])))
    }
  }, [call, say])
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    send(giftId ? { start: true, gift_id: giftId } : { start: true })
  }, [send, giftId])
  return (
    <div data-testid="nest-read" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Back onBack={onBack} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {turns.map((t, i) => (
          <div key={i} className="kn-pop" style={{
            alignSelf: t.who === 'child' ? 'flex-end' : 'flex-start', maxWidth: '85%', fontSize: 20, padding: '10px 14px',
            borderRadius: 18, background: t.who === 'child' ? C.accentWash : C.surface, border: `1px solid ${C.hairline}`,
          }}>{t.text}</div>
        ))}
      </div>
      <div style={ROW}>
        {NEXT_IDEAS.map((idea) => (
          <button key={idea} type="button" className="al-focus" style={BIG} disabled={busy} onClick={() => send({ line: idea })}>{idea}</button>
        ))}
      </div>
      <form style={ROW} onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { send({ line: typed.trim() }); setTyped('') } }}>
        <input aria-label="What happens next?" value={typed} maxLength={300} onChange={(e) => setTyped(e.target.value)}
          placeholder="What happens next?" style={{ ...BIG, flex: 1, cursor: 'text', justifyContent: 'flex-start' }} />
        <button type="submit" className="al-focus" style={BIG} disabled={busy || !typed.trim()} aria-label="Add to the story">➡️</button>
      </form>
      <button type="button" className="al-focus" style={BIG} disabled={busy} onClick={() => { setTurns([]); send({ start: true }) }}>✨ New story</button>
    </div>
  )
}

function JournalView({ call, say, onBack }: { call: Call; say: Say; onBack: () => void }) {
  const [typed, setTyped] = useState('')
  const [kept, setKept] = useState<string[]>([])
  const send = async (text: string) => {
    const r = await call('/me/nest/journal', 'POST', { text }).catch(() => null)
    if (!r) return
    say(sayOf(r.data), true)
    const rem = r.data && typeof r.data === 'object' ? strings((r.data as Record<string, unknown>).remembered) : []
    setKept(rem)
  }
  return (
    <div data-testid="nest-journal" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Back onBack={onBack} />
      <div style={ROW}>
        {FEELINGS.map((f) => (
          <button key={f.word} type="button" className="al-focus" style={ROUND} aria-label={`I feel ${f.word}`}
            onClick={() => send(`I feel ${f.word} today`)}>{f.emoji}</button>
        ))}
      </div>
      <form style={ROW} onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { send(typed.trim()); setTyped('') } }}>
        <input aria-label="Tell my Sprite" value={typed} maxLength={300} onChange={(e) => setTyped(e.target.value)}
          placeholder="Today I…" style={{ ...BIG, flex: 1, cursor: 'text', justifyContent: 'flex-start' }} />
        <button type="submit" className="al-focus" style={BIG} disabled={!typed.trim()} aria-label="Tell my Sprite">💬</button>
      </form>
      {kept.length > 0 && <div style={{ fontSize: 18, color: C.dim }}>I'll remember: {kept.join(', ')}</div>}
    </div>
  )
}

function AskView({ day, call, say, onBack }: { day: Day; call: Call; say: Say; onBack: () => void }) {
  const [typed, setTyped] = useState('')
  const send = async (body: Record<string, string>) => {
    const r = await call('/me/nest/ask-grownup', 'POST', body).catch(() => null)
    say(r ? sayOf(r.data) || 'Hmm, let me try again later.' : 'Hmm, let me try again later.', true)
    if (r && r.ok) onBack()
  }
  return (
    <div data-testid="nest-ask" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Back onBack={onBack} />
      <div style={ROW}>
        {day.ask_presets.map((p) => (
          <button key={p} type="button" className="al-focus" style={BIG} onClick={() => send({ preset: p })}>{p}</button>
        ))}
      </div>
      {day.free_text && (
        <form style={ROW} onSubmit={(e) => { e.preventDefault(); if (typed.trim()) send({ text: typed.trim() }) }}>
          <input aria-label="My question" value={typed} maxLength={140} onChange={(e) => setTyped(e.target.value)}
            style={{ ...BIG, flex: 1, cursor: 'text', justifyContent: 'flex-start' }} />
          <button type="submit" className="al-focus" style={BIG} disabled={!typed.trim()} aria-label="Send to my grown-up">🙋</button>
        </form>
      )}
    </div>
  )
}

function HomeworkView({ day, call, say, onBack }: { day: Day; call: Call; say: Say; onBack: () => void }) {
  const work = day.mailbox.filter((i) => i.kind !== 'gift')
  const [item, setItem] = useState<MailItem | null>(work.length === 1 ? work[0] : null)
  const [step, setStep] = useState(0)
  const [typed, setTyped] = useState('')
  const hint = async (line?: string) => {
    if (!item) return
    const r = await call('/me/nest/homework', 'POST', { item_id: item.id, step, ...(line ? { line } : {}) }).catch(() => null)
    say(r ? sayOf(r.data) : 'Let\'s ask a grown-up to look with us.', true)
    setStep((s) => s + 1)
  }
  return (
    <div data-testid="nest-homework" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Back onBack={onBack} />
      {!item ? (
        <div style={ROW}>{work.map((w) => (
          <button key={w.id} type="button" className="al-focus" style={BIG} onClick={() => { setItem(w); setStep(0) }}>{w.title}</button>
        ))}</div>
      ) : (
        <>
          <div style={{ fontSize: 20 }}>{item.title}</div>
          <button type="button" className="al-focus" style={{ ...BIG, background: C.accentWash, borderColor: C.accent }} onClick={() => hint()}>💡 A hint, please</button>
          <form style={ROW} onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { hint(typed.trim()); setTyped('') } }}>
            <input aria-label="What I think" value={typed} maxLength={200} onChange={(e) => setTyped(e.target.value)}
              placeholder="I think…" style={{ ...BIG, flex: 1, cursor: 'text', justifyContent: 'flex-start' }} />
            <button type="submit" className="al-focus" style={BIG} disabled={!typed.trim()} aria-label="Tell my Sprite what I think">💬</button>
          </form>
        </>
      )}
    </div>
  )
}

function GiftView({ gift, onBack, speak, onGame, onStory }: {
  gift: OpenedGift | null; onBack: () => void; speak: (t: string) => void; onGame: (g: string) => void; onStory: () => void
}): ReactNode {
  if (!gift) {
    return <div data-testid="nest-gift-opening" className="kn-wiggle" aria-hidden style={{ fontSize: 96, textAlign: 'center' }}>🎁</div>
  }
  return (
    <div data-testid="nest-gift" className="kn-pop" style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', textAlign: 'center' }}>
      <div aria-hidden style={{ fontSize: 72 }}>{GIFT_ICONS[gift.type] || '🎁'}</div>
      <div style={{ fontSize: 26, fontWeight: 600 }}>{gift.title}</div>
      {gift.type === 'book' && gift.text && (
        <>
          <p style={{ fontSize: 22, lineHeight: 1.6, maxWidth: 560, margin: 0 }}>{gift.text}</p>
          <button type="button" className="al-focus" style={BIG} onClick={() => speak(`${gift.title}. ${gift.text}`)}>🔊 Read it to me</button>
        </>
      )}
      {gift.type === 'game' && (
        <button type="button" className="al-focus" style={{ ...BIG, background: C.accentWash, borderColor: C.accent }}
          onClick={() => onGame(gift.game || '')}>🎲 Let's play!</button>
      )}
      {gift.type === 'story' && (
        <>
          <p style={{ fontSize: 22, margin: 0 }}>{gift.prompt}</p>
          <button type="button" className="al-focus" style={{ ...BIG, background: C.accentWash, borderColor: C.accent }} onClick={onStory}>✨ Make the story</button>
        </>
      )}
      {gift.type === 'art' && <p style={{ fontSize: 22, margin: 0 }}>{gift.prompt}</p>}
      <button type="button" className="al-focus" style={BIG} onClick={onBack}>🪺 Back to my Nest</button>
    </div>
  )
}
