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
 *
 * "Start my lesson" (POST /me/lesson/start) runs the same item loop as a quest,
 * shaped by the server into warm-up, one new step, practice and a fun finish. A
 * segment change shows its opener (read aloud); the new step opens with a worked
 * "watch me" card. Items arrive at the level the server's difficulty dial chose;
 * the child never sees a level. "I'm not sure" is always there: it gets the same
 * kind worked steps as a miss and tells the dial to ease off.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import FamilySpaceCard from './FamilySpaceCard'
import { createLearnVoice, type LearnSpeak } from './learnVoice'
import { QUIET_RULE, fetchVoiceRule, readChildMuted, spriteMaySpeak, type SpriteVoiceRule } from './spriteVoice'
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
  /** passage / sentence / word: the text the question is about */
  text?: string
  title?: string
  /** fraction_bar: equal parts and how many are shaded */
  parts?: number
  shaded?: number
  /** grid: an area model */
  rows?: number
  cols?: number
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
  segment?: string | null
}

/** The worked "watch me" example for a lesson's new step (never graded). */
interface TeachCard {
  kid_title?: string
  prompt_text?: string
  tts_text?: string
  visual?: ItemVisual | null
  steps?: string[]
  answer_label?: string
}

interface LessonInfo {
  segment?: string | null
  segments?: { id: string; label: string; items: number }[]
  lines?: Record<string, string>
  teach?: TeachCard | null
}

interface KidProgress {
  learned?: string[]
  learned_count?: number
  growing?: string[]
  today?: { goal_met?: boolean; goal_minutes?: number | null }
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
  // A lesson segment opener; `teach` is the worked example before the new step.
  | { kind: 'segment'; segment: string; line: string; teach: TeachCard | null }

const DEFAULT_THEMES = ['space', 'ocean']
const THEME_EMOJI: Record<string, string> = {
  space: '🚀', ocean: '🐠', jungle: '🦜', dinos: '🦕', farm: '🐮', castle: '🏰',
}
const LOOK_LINE = "Let's look together"
const SAVED_LINE = 'Saved, all done!'
const SEGMENT_LABEL: Record<string, string> = {
  warmup: 'warm-up', new: 'something new', practice: 'practice', finish: 'fun finish',
}
const SEGMENT_EMOJI: Record<string, string> = { warmup: '🌤️', new: '✨', practice: '💪', finish: '🎉' }

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

/** Place value: one tall bar per ten, one small square per one. */
export function TensOnes({ tens, ones }: { tens: number; ones: number }) {
  const t = Math.max(0, Math.min(9, Math.floor(tens)))
  const o = Math.max(0, Math.min(19, Math.floor(ones)))
  return (
    <div data-testid="tens-ones" role="img" aria-label={`${t} tens and ${o} ones`}
      style={{ display: 'flex', gap: 6, alignItems: 'flex-end', justifyContent: 'center', flexWrap: 'wrap' }}>
      {Array.from({ length: t }, (_, i) => (
        <span key={`t${i}`} style={{ width: 14, height: 120, borderRadius: 4, background: C.accent, boxShadow: `0 0 10px ${C.accentGlow}` }} />
      ))}
      <span style={{ width: 12 }} />
      <span style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 14px)', gap: 4 }}>
        {Array.from({ length: o }, (_, i) => (
          <span key={`o${i}`} style={{ width: 14, height: 14, borderRadius: 3, background: C.accent }} />
        ))}
      </span>
    </div>
  )
}

/** A bar cut into `parts` equal pieces with `shaded` filled (a fraction model). */
export function FractionBar({ parts, shaded }: { parts: number; shaded: number }) {
  const n = Math.max(1, Math.min(24, Math.floor(parts)))
  const s = Math.max(0, Math.min(n, Math.floor(shaded)))
  return (
    <div data-testid="fraction-bar" role="img" aria-label={`${s} of ${n} equal parts shaded`}
      style={{ display: 'flex', width: 'min(100%, 420px)', height: 56, borderRadius: 10, overflow: 'hidden', border: `2px solid ${C.hairlineStrong}` }}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} style={{
          flex: 1, background: i < s ? C.accent : C.surface,
          borderLeft: i ? `2px solid ${C.hairlineStrong}` : 'none',
        }} />
      ))}
    </div>
  )
}

/** The text a reading question is about: a short story, a sentence or one word. */
function ReadingText({ visual, kind }: { visual: ItemVisual; kind: string }) {
  const text = String(visual.text ?? '')
  if (!text) return null
  if (kind === 'word') {
    return <div data-testid="reading-word" style={{ fontSize: 44, fontWeight: 600, letterSpacing: '0.02em' }}>{text}</div>
  }
  const passage = kind === 'passage'
  return (
    <div data-testid={passage ? 'reading-passage' : 'reading-sentence'} style={{
      alignSelf: 'stretch', textAlign: 'left', background: C.ground, border: `1px solid ${C.hairline}`,
      borderRadius: 18, padding: '14px 18px', fontSize: passage ? 20 : 24, lineHeight: 1.6, maxWidth: 680, margin: '0 auto',
    }}>
      {passage && visual.title && <div style={{ fontWeight: 600, marginBottom: 6 }}>{String(visual.title)}</div>}
      {text}
    </div>
  )
}

function Visual({ visual }: { visual?: ItemVisual | null }) {
  if (!visual) return null
  const kind = String(visual.kind ?? visual.type ?? '').replace(/[-_]/g, '')
  if (kind === 'passage' || kind === 'sentence' || kind === 'word') return <ReadingText visual={visual} kind={kind} />
  if (kind === 'fractionbar') return <FractionBar parts={Number(visual.parts ?? 1)} shaded={Number(visual.shaded ?? 0)} />
  if (kind === 'grid') {
    const rows = Math.max(1, Math.min(10, Number(visual.rows ?? 1)))
    const cols = Math.max(1, Math.min(10, Number(visual.cols ?? 1)))
    return (
      <div data-testid="area-grid" role="img" aria-label={`${rows} rows of ${cols} squares`}
        style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 22px)`, gap: 3, justifyContent: 'center' }}>
        {Array.from({ length: rows * cols }, (_, i) => (
          <span key={i} style={{ width: 22, height: 22, borderRadius: 3, background: C.accentWash, border: `1px solid ${C.accent}` }} />
        ))}
      </div>
    )
  }
  if (kind === 'tensones') {
    const v = visual as ItemVisual & { tens?: number; ones?: number }
    return <TensOnes tens={Number(v.tens ?? 0)} ones={Number(v.ones ?? 0)} />
  }
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

/** Big for "7 + 5 = ?", smaller for a word problem so it fits without scrolling. */
function promptSize(text?: string): number {
  const n = (text || '').length
  return n > 90 ? 20 : n > 40 ? 24 : 32
}

/** Digits the pad accepts: grade 4-5 answers reach six digits (999,999). */
const PAD_DIGITS = 6

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
          ...BIG, fontSize: 40, textAlign: 'center', margin: '0 auto 14px', width: 232, cursor: 'default',
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
              onClick={() => onChange(value.length >= PAD_DIGITS ? value : value + k)}>{k}</button>
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
  // The Sprite's own line ("I learned...") is read aloud only when the guardian's lock, the
  // chat-off switch and the child's mute allow it (spriteVoice; quiet until the server says).
  const voiceRule = useRef<SpriteVoiceRule>(QUIET_RULE)
  const spriteSay = (ev: SpriteEvent | null | undefined): string =>
    ev && ev.say && spriteMaySpeak(voiceRule.current, readChildMuted()) ? ev.say : ''
  const withSprite = (line: string, sprite: string) => [line, sprite].filter(Boolean).join('. ')
  // The open lesson (null for a plain quest) and the segment on screen.
  const [lesson, setLesson] = useState<LessonInfo | null>(null)
  const [segment, setSegment] = useState<string | null>(null)
  const [kidProgress, setKidProgress] = useState<KidProgress | null>(null)
  const shownAt = useRef<number>(0)
  // The segment the server said the pending next item belongs to.
  const pendingSegment = useRef<string | null>(null)
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
      if (r.ok && r.data) {
        setMe(r.data as MeView)
        setScreen({ kind: 'home' })
        fetchVoiceRule(apiBase, headersRef.current).then((rule) => { voiceRule.current = rule }).catch(() => {})
        // Encouragement only (what was learned, today's goal); never a score.
        call('/me/progress').then((p) => { if (p.ok && p.data) setKidProgress(p.data as KidProgress) }).catch(() => {})
        return
      }
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

  /** Show the next item, opening its lesson segment first when the segment changes. */
  const advanceTo = (next: QuestItem, nextSegment: string | null | undefined, isRedo: boolean) => {
    if (lesson && nextSegment && nextSegment !== segment) {
      setSegment(nextSegment)
      setPendingNext(next)
      const line = lesson.lines?.[nextSegment] || SEGMENT_LABEL[nextSegment] || ''
      const teach = nextSegment === 'new' ? lesson.teach ?? null : null
      setScreen({ kind: 'segment', segment: nextSegment, line, teach })
      speakRef.current([line, teach?.tts_text].filter(Boolean).join('. '))
      return
    }
    showItem(next, isRedo)
  }

  const startLesson = async (theme: string) => {
    setBusy(true)
    try {
      const r = await call('/me/lesson/start', 'POST', { theme })
      const d = (r.data || {}) as {
        quest_id?: string; items_total?: number; item?: QuestItem; say?: string; lesson?: LessonInfo
        progress?: { done?: number; total?: number }
      }
      if (r.status === 429) { setScreen({ kind: 'rest', say: d.say || 'That’s lots of learning today. Rest time!' }); return }
      if (r.ok && d.quest_id && d.item) {
        setQuestId(d.quest_id)
        setProgress({ done: Number(d.progress?.done ?? 0), total: Number(d.items_total ?? 0) })
        setSpriteEvent(null)
        const info = d.lesson ?? null
        setLesson(info)
        setSegment(null)
        if (info && info.segment) {
          // Open the first segment (its line, and the watch-me card if it is the new step).
          setSegment(info.segment)
          setPendingNext(d.item)
          const line = info.lines?.[info.segment] || SEGMENT_LABEL[info.segment] || ''
          const teach = info.segment === 'new' ? info.teach ?? null : null
          setScreen({ kind: 'segment', segment: info.segment, line, teach })
          speakRef.current([line, teach?.tts_text].filter(Boolean).join('. '))
          return
        }
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

  const finish = async (spriteLine = '') => {
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
    setLesson(null)
    setSegment(null)
    setScreen({ kind: 'saved', say })
    speakRef.current(withSprite(say, spriteLine))
  }

  const answer = async (value: string, idk = false) => {
    if (!item || !questId || busy) return
    setBusy(true)
    const latency = Math.max(0, Date.now() - shownAt.current)
    try {
      const r = await call(`/me/quest/${encodeURIComponent(questId)}/answer`, 'POST', {
        item_id: item.item_id,
        answer: idk ? '' : value.slice(0, 16),
        latency_ms: latency,
        redo: idk ? false : redo,
        idk,
      })
      if (!r.ok || !r.data) { setScreen({ kind: 'oops', say: 'Let’s try that again.' }); return }
      const out = r.data as AnswerOutcome
      bumpProgress(out.progress)
      if (out.sprite_event) setSpriteEvent(out.sprite_event)
      const spriteLine = spriteSay(out.sprite_event)
      if (out.done) { await finish(spriteLine); return }
      setPendingNext(out.next_item ?? null)
      pendingSegment.current = out.segment ?? null
      // Warm the next prompt's audio while the child hears this feedback.
      if (out.next_item) speakRef.current.prefetch?.(out.next_item.tts_text ?? out.next_item.prompt_text)
      if (out.feedback === 'lets_look') {
        // A miss never loses its worked steps, even when it also triggers a break:
        // the look card comes first, then the break, then the redo.
        const steps = Array.isArray(out.hint_steps) ? out.hint_steps.filter((s) => typeof s === 'string') : []
        const say = out.say || LOOK_LINE
        setScreen({ kind: 'look', say, steps, thenBreak: Boolean(out.break) })
        speakRef.current(withSprite([say, ...steps].join('. '), spriteLine))
        return
      }
      if (out.break) { setScreen({ kind: 'break', afterLook: false }); speakRef.current(withSprite('Wiggle break!', spriteLine)); return }
      const say = out.say || 'Yay!'
      setScreen({ kind: 'yay', say })
      speakRef.current(withSprite(say, spriteLine))
    } catch {
      setScreen({ kind: 'oops', say: 'Let’s try that again.' })
    } finally {
      setBusy(false)
    }
  }

  const goOn = (afterLook: boolean) => {
    if (pendingNext) {
      const next = pendingNext
      setPendingNext(null)
      advanceTo(next, pendingSegment.current, false)
      return
    }
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
          <button type="button" data-testid="start-lesson" className="al-primary al-focus" disabled={busy}
            onClick={() => startLesson(themes[0])}
            style={{ ...PRIMARY, width: '100%', minHeight: 96, fontSize: 30, borderRadius: 28 }}>
            ✨ Start my lesson
          </button>
          {kidProgress && (kidProgress.learned_count || kidProgress.today?.goal_minutes) ? (
            <div data-testid="kid-progress" style={{
              width: '100%', background: C.surface, border: `1px solid ${C.hairline}`, borderRadius: 24,
              padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left',
            }}>
              {kidProgress.today?.goal_minutes ? (
                <div style={{ fontSize: 22 }}>
                  {kidProgress.today.goal_met ? '🌟 You did your learning today!' : '🌱 Today’s learning is waiting for you.'}
                </div>
              ) : null}
              {kidProgress.learned && kidProgress.learned.length > 0 && (
                <div>
                  <div style={LABEL}>things you learned</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {kidProgress.learned.slice(0, 6).map((t) => (
                      <span key={t} style={{ fontSize: 17, padding: '6px 12px', borderRadius: 999, background: C.accentWash, border: `1px solid ${C.hairline}` }}>{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {kidProgress.growing && kidProgress.growing.length > 0 && (
                <div style={{ color: C.dim, fontSize: 18 }}>Growing: {kidProgress.growing.slice(0, 2).join(' · ')}</div>
              )}
            </div>
          ) : null}
          <div style={{ color: C.dim }}>Or pick a world for quick practice.</div>
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
          {lesson && segment && <div data-testid="segment-chip" style={LABEL}>{SEGMENT_LABEL[segment] ?? segment}</div>}
          <div style={{ fontSize: promptSize(item.prompt_text || item.tts_text), fontWeight: 500, letterSpacing: '-0.02em' }}>{item.prompt_text || item.tts_text}</div>
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
                    style={{
                      ...BIG, minWidth: 110, minHeight: 110, borderRadius: 24,
                      // A phrase answer (a meaning, a story answer) wraps at reading size.
                      fontSize: face.emoji ? 56 : (face.label && face.label.length > 12 ? 20 : 32),
                      maxWidth: '100%', whiteSpace: 'normal', lineHeight: 1.3,
                    }}
                    onClick={() => answer(choiceValue(c))}>
                    {face.emoji ?? face.label}
                  </button>
                )
              })}
            </div>
          )}
          {left === 3 && <div data-testid="three-more" style={{ color: C.dim }}>3 more then done</div>}
          <button type="button" data-testid="not-sure" className="al-quiet al-focus" disabled={busy}
            style={{ ...BIG, fontSize: 20, background: 'transparent', color: C.dim }}
            onClick={() => answer('', true)}>
            🤔 I’m not sure
          </button>
        </Card>
      )
      break
    }
    case 'segment': {
      const t = screen.teach
      body = (
        <Card testId="segment-card">
          <div aria-hidden className="al-grow" style={{ fontSize: 52 }}>{SEGMENT_EMOJI[screen.segment] ?? '⭐'}</div>
          <div style={LABEL}>{SEGMENT_LABEL[screen.segment] ?? screen.segment}</div>
          <div style={title}>{screen.line}</div>
          {t && (
            <div data-testid="teach-card" style={{
              alignSelf: 'stretch', background: C.accentWash, borderRadius: 20, border: `1px solid ${C.hairline}`,
              padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left',
            }}>
              <div style={LABEL}>watch me</div>
              <div style={{ fontSize: 28, fontWeight: 500 }}>{t.prompt_text}</div>
              <Visual visual={t.visual} />
              {Array.isArray(t.steps) && t.steps.length > 0 && (
                <ol style={{ margin: 0, paddingLeft: 24 }}>
                  {t.steps.filter((x) => typeof x === 'string').map((x, i) => <li key={i} style={{ margin: '4px 0' }}>{x}</li>)}
                </ol>
              )}
              {t.answer_label && <div style={{ fontSize: 26 }}>So it is <b>{t.answer_label}</b>!</div>}
            </div>
          )}
          <button type="button" className="al-primary al-focus" style={PRIMARY}
            onClick={() => { const next = pendingNext; setPendingNext(null); if (next) showItem(next, false); else finish() }}>
            {t ? 'My turn!' : 'Let’s go'}
          </button>
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

  const inQuest = questId !== null && ['item', 'yay', 'look', 'break', 'segment'].includes(screen.kind)
  return (
    <div style={shell} data-testid="kid-quest-panel" data-learn-theme={mode}>
      <style>{LEARN_CSS}</style>
      {inQuest && <ProgressPath done={progress.done} total={progress.total} />}
      {body}
      {inQuest && (
        <button type="button" className="al-quiet al-focus"
          style={{ ...BIG, alignSelf: 'center', fontSize: 20, background: 'transparent', borderColor: 'transparent', color: C.dim }}
          onClick={() => { void finish() }}>
          All done for now
        </button>
      )}
    </div>
  )
}
