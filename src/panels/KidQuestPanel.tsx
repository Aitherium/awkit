/**
 * KidQuestPanel: the child's side of Aither Learn (family tutor).
 *
 * Backed by Genesis /api/v1/tutor/me/* through the host app's proxy (apiBase).
 * The server owns every rule: grading, hints, breaks, the redo cap, quest length
 * and the daily cap. This panel only shows one item at a time and sends taps.
 *
 * Child-first rules this component keeps (ADHD/OCD friendly):
 * - One thing per screen, tap targets of 64px or more, every prompt read aloud
 *   with a replay button.
 * - A miss is "Let's look together" plus the worked steps. Never red, never an X,
 *   never a buzz, never the words for being mistaken.
 * - No timer, no countdown, no score, no streak. Answer latency is measured and
 *   sent to the server but never shown.
 * - The progress path only grows, and the quest always ends on "Saved, all done!".
 * - Nothing the server might mistakenly send (for example an answer key) is ever
 *   rendered: only named, expected fields are read.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import FamilySpaceCard from './FamilySpaceCard'
import { createLearnVoice, type LearnSpeak } from './learnVoice'
import { C, EASE, FONT_MONO, FONT_UI, LEARN_CSS, LearnModeSwitch, learnVars, useLearnMode } from './learnTheme'
import { KidSpriteCard, spriteEmoji, type KidSprite } from './LearnerSprite'

export interface KidQuestPanelProps {
  /** Base of the tutor proxy, e.g. '/api/tutor'. */
  apiBase: string
  /** Headers the host app adds (its bearer). Never user identity fields. */
  extraHeaders?: Record<string, string>
  /** Shown on the home screen only (e.g. the family inbox card); never during a quest. */
  homeExtra?: ReactNode
  /** Shown on the home screen ABOVE the quest tiles (e.g. work from a teacher); never during a quest. */
  homeLead?: ReactNode
  /** Called with the quest id when the child finishes a quest (the host may ask how it felt). */
  onQuestEnd?: (questId: string) => void
  /** Called when the signed-in account is a grown-up (a guardian with learners), not a
   *  child. The host sends them to the parent console instead of a child screen. */
  onGuardian?: () => void
}

type ChoiceValue = string | number
interface ChoiceObject { value?: ChoiceValue; id?: ChoiceValue; label?: string; emoji?: string; word?: string }
type Choice = ChoiceValue | ChoiceObject

interface ItemVisual {
  kind?: string
  type?: string
  filled?: number
  count?: number
  frames?: number[]
  emoji?: string
}

interface QuestItem {
  item_id: string
  skill_id?: string
  tts_text?: string
  prompt_text?: string
  visual?: ItemVisual | null
  choices?: Choice[] | null
  input?: 'tap' | 'number'
}

interface MeView {
  alias?: string
  grade?: number
  today_minutes_left?: number
  sprite?: KidSprite | null
  choices?: unknown
}

interface SpriteEvent { say?: string; title?: string; stage?: string; name?: string | null }

interface AnswerOutcome {
  feedback?: 'yay' | 'lets_look'
  say?: string
  hint_steps?: string[]
  next_item?: QuestItem | null
  break?: boolean
  done?: boolean
  progress?: { done?: number; total?: number }
  sprite_event?: SpriteEvent | null
}

type Screen =
  | { kind: 'loading' }
  | { kind: 'oops'; say: string }
  | { kind: 'pair' }
  | { kind: 'grownup' }
  | { kind: 'home' }
  | { kind: 'rest'; say: string }
  | { kind: 'item' }
  | { kind: 'yay'; say: string }
  // thenBreak: a miss that also earned a break shows the worked steps FIRST, then the break.
  | { kind: 'look'; say: string; steps: string[]; thenBreak: boolean }
  // afterLook: the break followed a miss, so the redo still comes after it.
  | { kind: 'break'; afterLook: boolean }
  | { kind: 'saved'; say: string }

const DEFAULT_THEMES = ['space', 'ocean']
const THEME_EMOJI: Record<string, string> = {
  space: '🚀', ocean: '🐠', jungle: '🦜', dinos: '🦕', farm: '🐮', castle: '🏰',
}
const LOOK_LINE = "Let's look together"
const SAVED_LINE = 'Saved, all done!'

const BIG: CSSProperties = {
  minHeight: 64,
  minWidth: 64,
  fontSize: 26,
  fontWeight: 600,
  fontFamily: FONT_UI,
  borderRadius: 20,
  border: `1px solid ${C.hairlineStrong}`,
  background: C.raise,
  color: C.ink,
  cursor: 'pointer',
  padding: '8px 18px',
  touchAction: 'manipulation',
}

const PRIMARY: CSSProperties = {
  ...BIG, background: C.accent, borderColor: C.accent, color: C.onAccent, fontWeight: 600,
  boxShadow: `0 0 28px ${C.accentGlow}`,
}

/** A tiny lowercase mono label: the only "system voice" a child sees. */
const LABEL: CSSProperties = {
  fontFamily: FONT_MONO, fontSize: 12, letterSpacing: '.18em', textTransform: 'lowercase', color: C.faint,
}


function themeList(me: MeView | null): string[] {
  const raw = me?.choices
  const fromObj = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as { themes?: unknown }).themes
    : raw
  if (Array.isArray(fromObj)) {
    const names = fromObj.filter((t): t is string => typeof t === 'string').slice(0, 2)
    if (names.length === 2) return names
  }
  return DEFAULT_THEMES
}

function choiceValue(c: Choice): string {
  if (typeof c === 'string' || typeof c === 'number') return String(c)
  const v = c.value ?? c.id ?? c.word ?? c.label ?? ''
  return String(v)
}

function choiceFace(c: Choice): { emoji?: string; label?: string } {
  if (typeof c === 'string' || typeof c === 'number') return { label: String(c) }
  return { emoji: c.emoji, label: c.label }
}

/** A ten-frame (2 rows x 5) drawn as SVG; `filled` counters are shown. */
export function TenFrame({ filled }: { filled: number }) {
  const n = Math.max(0, Math.min(10, Math.floor(filled)))
  const cell = 44
  const pad = 4
  return (
    <svg
      data-testid="ten-frame"
      role="img"
      aria-label={`ten frame with ${n} counters`}
      width={cell * 5 + pad * 2}
      height={cell * 2 + pad * 2}
      viewBox={`0 0 ${cell * 5 + pad * 2} ${cell * 2 + pad * 2}`}
      style={{ maxWidth: '100%', height: 'auto' }}
    >
      {Array.from({ length: 10 }, (_, i) => {
        const x = pad + (i % 5) * cell
        const y = pad + Math.floor(i / 5) * cell
        return (
          <g key={i}>
            <rect x={x} y={y} width={cell} height={cell} rx={6} strokeWidth={2}
              style={{ fill: C.surface, stroke: C.hairlineStrong }} />
            {i < n && <circle cx={x + cell / 2} cy={y + cell / 2} r={cell / 2 - 8} style={{ fill: C.accent }} />}
          </g>
        )
      })}
    </svg>
  )
}

function Visual({ visual }: { visual?: ItemVisual | null }) {
  if (!visual) return null
  const kind = String(visual.kind ?? visual.type ?? '').replace(/[-_]/g, '')
  if (kind === 'tenframe') {
    const frames = Array.isArray(visual.frames) && visual.frames.length
      ? visual.frames
      : [Number(visual.filled ?? visual.count ?? 0)]
    return (
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        {frames.map((f, i) => <TenFrame key={i} filled={Number(f) || 0} />)}
      </div>
    )
  }
  if (visual.emoji) {
    const count = Math.max(1, Math.min(20, Number(visual.count ?? 1)))
    return (
      <div aria-hidden style={{ fontSize: 44, textAlign: 'center', lineHeight: 1.3 }}>
        {Array.from({ length: count }, () => visual.emoji).join(' ')}
      </div>
    )
  }
  return null
}

/** Progress path: stepping stones that only ever grow. */
function ProgressPath({ done, total }: { done: number; total: number }) {
  if (total <= 0) return null
  return (
    <div data-testid="progress-path" aria-label={`step ${done} of ${total}`} style={{ display: 'flex', gap: 10, justifyContent: 'center', padding: '8px 0' }}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          data-filled={i < done ? 'yes' : 'no'}
          style={{
            width: 18, height: 18, borderRadius: 9, boxSizing: 'border-box',
            background: i < done ? C.accent : 'transparent',
            border: `2px solid ${i < done ? C.accent : C.hairlineStrong}`,
            boxShadow: i < done ? `0 0 12px ${C.accentGlow}` : 'none',
            transition: `background-color .3s ${EASE}, box-shadow .3s ${EASE}`,
          }}
        />
      ))}
    </div>
  )
}

function NumberPad({ value, onChange, onGo, disabled }: {
  value: string; onChange: (v: string) => void; onGo: () => void; disabled: boolean
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'go']
  return (
    <div>
      <div
        data-testid="number-display"
        aria-live="polite"
        style={{
          ...BIG, fontSize: 44, textAlign: 'center', margin: '0 auto 14px', width: 168, cursor: 'default',
          background: C.ground, borderColor: C.hairline, fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value || ' '}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 84px)', gap: 10, justifyContent: 'center' }}>
        {keys.map((k) => {
          if (k === 'back') {
            return (
              <button key={k} type="button" aria-label="take back" className="al-focus" style={BIG} disabled={disabled}
                onClick={() => onChange(value.slice(0, -1))}>⌫</button>
            )
          }
          if (k === 'go') {
            return (
              <button key={k} type="button" aria-label="go" className="al-primary al-focus" style={PRIMARY} disabled={disabled || !value}
                onClick={onGo}>✓</button>
            )
          }
          return (
            <button key={k} type="button" className="al-focus" style={BIG} disabled={disabled}
              onClick={() => onChange(value.length >= 3 ? value : value + k)}>{k}</button>
          )
        })}
      </div>
    </div>
  )
}

function Card({ children, testId, tone }: { children: ReactNode; testId?: string; tone?: 'amber' }) {
  return (
    <div
      data-testid={testId}
      className="al-in"
      style={{
        background: C.surface, borderRadius: 28,
        border: `1px solid ${tone === 'amber' ? C.amber : C.hairline}`,
        boxShadow: C.shadow,
        padding: '28px 22px', display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center', textAlign: 'center',
      }}
    >
      {children}
    </div>
  )
}

/** The child's Sprite as a glowing orb; `grow` plays the calm "it grew" beat. */
function SpriteOrb({ sprite, size = 120, grow = false }: { sprite?: KidSprite | null; size?: number; grow?: boolean }) {
  return (
    <div aria-hidden className={grow ? 'al-grow al-glow' : 'al-glow'} style={{
      width: size, height: size, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.5), lineHeight: 1, background: C.accentWash, border: `1px solid ${C.hairline}`,
      boxShadow: `0 0 40px ${C.accentGlow}`, flexShrink: 0,
    }}>
      {spriteEmoji(sprite)}
    </div>
  )
}

export default function KidQuestPanel({ apiBase, extraHeaders = {}, homeExtra, homeLead, onQuestEnd, onGuardian }: KidQuestPanelProps) {
  const headersRef = useRef(extraHeaders)
  headersRef.current = extraHeaders
  // Read-aloud: the voice plane first, the device's best voice only as a fallback.
  const speakRef = useRef<LearnSpeak>(() => {})
  const voiceBase = useRef<string | null>(null)
  if (voiceBase.current !== apiBase) {
    voiceBase.current = apiBase
    speakRef.current = createLearnVoice(apiBase, () => headersRef.current)
  }

  const [screen, setScreen] = useState<Screen>({ kind: 'loading' })
  const [me, setMe] = useState<MeView | null>(null)
  const [code, setCode] = useState('')
  const [codeNote, setCodeNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [questId, setQuestId] = useState<string | null>(null)
  const [item, setItem] = useState<QuestItem | null>(null)
  const [pendingNext, setPendingNext] = useState<QuestItem | null>(null)
  const [redo, setRedo] = useState(false)
  const [typed, setTyped] = useState('')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [spriteEvent, setSpriteEvent] = useState<SpriteEvent | null>(null)
  const shownAt = useRef<number>(0)
  const { mode, pref, setPref } = useLearnMode()
  const onGuardianRef = useRef(onGuardian)
  onGuardianRef.current = onGuardian

  const call = useCallback(async (path: string, method = 'GET', body?: object) => {
    const init: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json', ...headersRef.current },
    }
    if (body) init.body = JSON.stringify(body)
    const r = await fetch(`${apiBase}${path}`, init)
    const data = await r.json().catch(() => null)
    return { status: r.status, ok: r.ok, data }
  }, [apiBase])

  const loadMe = useCallback(async () => {
    setScreen({ kind: 'loading' })
    try {
      const r = await call('/me')
      if (r.status === 404) {
        // No learner on this account. A guardian (owner/admin with learners) opened the
        // kid page: send them to their console instead of a child's pair-code screen.
        const fam = await call('/family/learners').catch(() => null)
        if (fam && fam.ok) {
          if (onGuardianRef.current) onGuardianRef.current()
          setScreen({ kind: 'grownup' })
          return
        }
        setScreen({ kind: 'pair' })
        return
      }
      if (r.ok && r.data) { setMe(r.data as MeView); setScreen({ kind: 'home' }); return }
      setScreen({ kind: 'oops', say: 'Let’s try again in a little bit.' })
    } catch {
      setScreen({ kind: 'oops', say: 'Let’s try again in a little bit.' })
    }
  }, [call])

  useEffect(() => { loadMe() }, [loadMe])

  const showItem = useCallback((next: QuestItem, isRedo: boolean) => {
    setItem(next)
    setRedo(isRedo)
    setTyped('')
    setScreen({ kind: 'item' })
    shownAt.current = Date.now()
    speakRef.current(next.tts_text ?? next.prompt_text)
  }, [])

  const bumpProgress = (p?: { done?: number; total?: number }) => {
    if (!p) return
    // The path only ever grows: never step a stone back.
    setProgress((prev) => ({
      done: Math.max(prev.done, Number(p.done ?? 0)),
      total: Math.max(prev.total, Number(p.total ?? 0)),
    }))
  }

  const claim = async () => {
    if (!code.trim()) return
    setBusy(true)
    setCodeNote(null)
    try {
      const r = await call('/me/claim', 'POST', { code: code.trim() })
      if (r.ok) { setCode(''); await loadMe(); return }
      if (r.status === 410) setCodeNote('That code is used up. Ask your grown-up for a new one.')
      else setCodeNote('Let’s ask your grown-up to help with the code.')
    } catch {
      setCodeNote('Let’s try again in a little bit.')
    } finally {
      setBusy(false)
    }
  }

  const start = async (theme: string) => {
    setBusy(true)
    try {
      const r = await call('/me/quest/start', 'POST', { theme })
      const d = (r.data || {}) as { quest_id?: string; items_total?: number; item?: QuestItem; say?: string }
      if (r.status === 429) { setScreen({ kind: 'rest', say: d.say || 'That’s lots of learning today. Rest time!' }); return }
      if (r.ok && d.quest_id && d.item) {
        setQuestId(d.quest_id)
        setProgress({ done: 0, total: Number(d.items_total ?? 0) })
        setSpriteEvent(null)
        showItem(d.item, false)
        return
      }
      setScreen({ kind: 'oops', say: 'Let’s try again in a little bit.' })
    } catch {
      setScreen({ kind: 'oops', say: 'Let’s try again in a little bit.' })
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    let say = SAVED_LINE
    if (questId) {
      try {
        const r = await call(`/me/quest/${encodeURIComponent(questId)}/end`, 'POST', {})
        const d = (r.data || {}) as { say?: string }
        if (r.ok && d.say) say = d.say
      } catch { /* still show the calm ending */ }
      onQuestEnd?.(questId)
    }
    setQuestId(null)
    setItem(null)
    setScreen({ kind: 'saved', say })
    speakRef.current(say)
  }

  const answer = async (value: string) => {
    if (!item || !questId || busy) return
    setBusy(true)
    const latency = Math.max(0, Date.now() - shownAt.current)
    try {
      const r = await call(`/me/quest/${encodeURIComponent(questId)}/answer`, 'POST', {
        item_id: item.item_id,
        answer: value.slice(0, 16),
        latency_ms: latency,
        redo,
      })
      if (!r.ok || !r.data) { setScreen({ kind: 'oops', say: 'Let’s try that again.' }); return }
      const out = r.data as AnswerOutcome
      bumpProgress(out.progress)
      if (out.sprite_event) setSpriteEvent(out.sprite_event)
      if (out.done) { await finish(); return }
      setPendingNext(out.next_item ?? null)
      if (out.feedback === 'lets_look') {
        // A miss never loses its worked steps, even when it also triggers a break:
        // the look card comes first, then the break, then the redo.
        const steps = Array.isArray(out.hint_steps) ? out.hint_steps.filter((s) => typeof s === 'string') : []
        const say = out.say || LOOK_LINE
        setScreen({ kind: 'look', say, steps, thenBreak: Boolean(out.break) })
        speakRef.current([say, ...steps].join('. '))
        return
      }
      if (out.break) { setScreen({ kind: 'break', afterLook: false }); speakRef.current('Wiggle break!'); return }
      const say = out.say || 'Yay!'
      setScreen({ kind: 'yay', say })
      speakRef.current(say)
    } catch {
      setScreen({ kind: 'oops', say: 'Let’s try that again.' })
    } finally {
      setBusy(false)
    }
  }

  const goOn = (afterLook: boolean) => {
    if (pendingNext) { showItem(pendingNext, false); setPendingNext(null); return }
    // After "let's look", the same item comes back as a redo (the server caps redos).
    if (item && afterLook) { showItem(item, true); return }
    finish()
  }

  const left = progress.total - progress.done
  const shell: CSSProperties = {
    ...learnVars(mode),
    background: C.ground, color: C.ink, minHeight: '100%', padding: '20px 16px 40px', boxSizing: 'border-box',
    fontFamily: FONT_UI, fontSize: 22, lineHeight: 1.4, letterSpacing: '-0.01em',
    display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 600, margin: '0 auto', width: '100%',
  }
  const title: CSSProperties = { fontSize: 30, fontWeight: 500, letterSpacing: '-0.02em' }

  const spriteCard = spriteEvent ? (
    <div data-testid="sprite-event" className="al-in" style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, width: '100%',
      borderTop: `1px solid ${C.hairline}`, paddingTop: 18,
    }}>
      <SpriteOrb sprite={me?.sprite} size={88} grow />
      <div>{spriteEvent.say || 'Your sprite learned something new!'}</div>
      {spriteEvent.title && <div style={{ color: C.dim, fontSize: 20 }}>{spriteEvent.title}</div>}
    </div>
  ) : null

  let body: ReactNode = null
  switch (screen.kind) {
    case 'loading':
      body = (
        <Card>
          <div aria-hidden className="al-skel" style={{
            width: 72, height: 72, borderRadius: '50%', background: C.accentWash, boxShadow: `0 0 40px ${C.accentGlow}`,
          }} />
          <div>Getting ready…</div>
        </Card>
      )
      break
    case 'oops':
      body = (
        <Card>
          <div>{screen.say}</div>
          <button type="button" className="al-primary al-focus" style={PRIMARY} onClick={loadMe}>Try again</button>
        </Card>
      )
      break
    case 'grownup':
      body = (
        <Card testId="grownup-screen">
          <div style={LABEL}>aither learn · grown-up</div>
          <div style={title}>You are signed in as a grown-up.</div>
          <div style={{ color: C.dim, fontSize: 20 }}>Your family page has everyone in one place.</div>
          <a href="/learn/parent" className="al-primary al-focus"
            style={{ ...PRIMARY, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            Open the parent page
          </a>
        </Card>
      )
      break
    case 'pair':
      body = (
        <Card testId="pair-screen">
          <div style={LABEL}>connect this phone</div>
          <div style={title}>Ask your grown-up to connect this phone.</div>
          <div style={{ color: C.dim, fontSize: 20 }}>They scan you in from their parent page. If they gave you a code instead, type it here.</div>
          <input
            aria-label="pair code"
            className="al-field"
            value={code}
            maxLength={12}
            autoComplete="off"
            inputMode="text"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            style={{
              ...BIG, textAlign: 'center', letterSpacing: 6, width: 260, maxWidth: '100%', boxSizing: 'border-box',
              cursor: 'text', fontFamily: FONT_MONO, background: C.ground,
            }}
          />
          {codeNote && <div style={{ color: C.dim }}>{codeNote}</div>}
          <button type="button" className="al-primary al-focus" style={PRIMARY} disabled={busy || !code.trim()} onClick={claim}>Let’s go</button>
        </Card>
      )
      break
    case 'home': {
      const themes = themeList(me)
      body = (
        <div data-testid="home-screen" className="al-in" style={{ display: 'flex', flexDirection: 'column', gap: 22, alignItems: 'center', textAlign: 'center' }}>
          {me?.sprite && me.sprite.name ? <KidSpriteCard sprite={me.sprite} /> : <SpriteOrb sprite={me?.sprite} size={128} />}
          <div style={{ fontSize: 36, fontWeight: 500, letterSpacing: '-0.02em' }}>Hi{me?.alias ? `, ${me.alias}` : ''}!</div>
          {homeLead && <div style={{ width: '100%', textAlign: 'left' }}>{homeLead}</div>}
          <div style={{ color: C.dim }}>Pick a world, then start.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, width: '100%' }}>
            {themes.map((t) => (
              <button key={t} type="button" className="al-tile al-focus" disabled={busy}
                onClick={() => start(t)} aria-label={`Start ${t}`}
                style={{
                  ...BIG, minHeight: 150, borderRadius: 24, background: C.surface, borderColor: C.hairline,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
                }}>
                <span aria-hidden style={{ fontSize: 56, lineHeight: 1 }}>{THEME_EMOJI[t] ?? '⭐'}</span>
                <span aria-hidden style={{ ...LABEL, fontSize: 13 }}>{t}</span>
                <span style={{ color: C.accent, fontSize: 24, fontWeight: 600 }}>Start</span>
              </button>
            ))}
          </div>
          {spriteCard}
          <FamilySpaceCard mode="kid" apiBase={apiBase} extraHeaders={headersRef.current} />
          {homeExtra}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <span style={LABEL}>light or dark</span>
            <LearnModeSwitch pref={pref} onChange={setPref} big />
          </div>
        </div>
      )
      break
    }
    case 'rest':
      body = (
        <Card testId="rest-card">
          <div aria-hidden style={{ fontSize: 48 }}>🌙</div>
          <div style={title}>{screen.say}</div>
        </Card>
      )
      break
    case 'item': {
      if (!item) break
      const choices = Array.isArray(item.choices) ? item.choices : []
      const numeric = item.input === 'number' || (!choices.length)
      body = (
        <Card testId="item-screen">
          <div style={{ fontSize: 32, fontWeight: 500, letterSpacing: '-0.02em' }}>{item.prompt_text || item.tts_text}</div>
          <button type="button" aria-label="hear it again" className="al-focus" style={BIG}
            onClick={() => speakRef.current(item.tts_text ?? item.prompt_text)}>🔊</button>
          <Visual visual={item.visual} />
          {numeric ? (
            <NumberPad value={typed} onChange={setTyped} onGo={() => answer(typed)} disabled={busy} />
          ) : (
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
              {choices.map((c, i) => {
                const face = choiceFace(c)
                return (
                  <button key={`${choiceValue(c)}-${i}`} type="button" disabled={busy} className="al-tile al-focus"
                    aria-label={face.label || `choice ${i + 1}`}
                    style={{ ...BIG, minWidth: 110, minHeight: 110, borderRadius: 24, fontSize: face.emoji ? 56 : 32 }}
                    onClick={() => answer(choiceValue(c))}>
                    {face.emoji ?? face.label}
                  </button>
                )
              })}
            </div>
          )}
          {left === 3 && <div data-testid="three-more" style={{ color: C.dim }}>3 more then done</div>}
        </Card>
      )
      break
    }
    case 'yay':
      body = (
        <Card testId="yay-card">
          <div aria-hidden className="al-grow" style={{ fontSize: 56 }}>🌟</div>
          <div style={title}>{screen.say}</div>
          {spriteCard}
          <button type="button" className="al-primary al-focus" style={PRIMARY} onClick={() => goOn(false)}>Next</button>
        </Card>
      )
      break
    case 'look':
      body = (
        <Card testId="look-card" tone="amber">
          <div aria-hidden style={{ fontSize: 48 }}>🔍</div>
          <div style={{ ...title, color: C.amber }}>{screen.say}</div>
          {screen.steps.length > 0 && (
            <ol style={{
              textAlign: 'left', margin: 0, background: C.amberWash, borderRadius: 18,
              border: `1px solid ${C.hairline}`, padding: '14px 16px 14px 40px', alignSelf: 'stretch',
            }}>
              {screen.steps.map((s, i) => <li key={i} style={{ margin: '6px 0' }}>{s}</li>)}
            </ol>
          )}
          <button
            type="button"
            className="al-focus"
            style={{ ...BIG, background: C.amber, borderColor: C.amber, color: C.onAccent }}
            onClick={() => {
              if (screen.thenBreak) { setScreen({ kind: 'break', afterLook: true }); speakRef.current('Wiggle break!'); return }
              goOn(true)
            }}
          >
            {screen.thenBreak ? 'Next' : 'Try this one'}
          </button>
        </Card>
      )
      break
    case 'break':
      body = (
        <Card testId="break-card">
          <div aria-hidden style={{ fontSize: 56 }}>🤸</div>
          <div style={title}>Wiggle break!</div>
          <div>Stretch up high, then wiggle your fingers.</div>
          <button type="button" className="al-primary al-focus" style={PRIMARY} onClick={() => goOn(screen.afterLook)}>I’m ready</button>
        </Card>
      )
      break
    case 'saved':
      body = (
        <Card testId="saved-card">
          <SpriteOrb sprite={me?.sprite} size={132} grow />
          <div style={title}>{screen.say}</div>
          {spriteCard}
          <button type="button" className="al-focus" style={BIG} onClick={loadMe}>Back home</button>
        </Card>
      )
      break
  }

  const inQuest = questId !== null && ['item', 'yay', 'look', 'break'].includes(screen.kind)
  return (
    <div style={shell} data-testid="kid-quest-panel" data-learn-theme={mode}>
      <style>{LEARN_CSS}</style>
      {inQuest && <ProgressPath done={progress.done} total={progress.total} />}
      {body}
      {inQuest && (
        <button type="button" className="al-quiet al-focus"
          style={{ ...BIG, alignSelf: 'center', fontSize: 20, background: 'transparent', borderColor: 'transparent', color: C.dim }}
          onClick={finish}>
          All done for now
        </button>
      )}
    </div>
  )
}
