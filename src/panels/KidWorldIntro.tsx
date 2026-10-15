/**
 * KidWorldIntro: "the light comes on", a child's first run in Aither Learn
 * (docs/plans/2026-10-14-kids-suite.md section 1, slice S3).
 *
 * Seven full-screen moments, one choice each, one spoken line each, no typing:
 *   1 egg        a dark classroom and one glowing egg
 *   2 hatch      pick an egg (or wake the Sprite they already have); it hatches and says,
 *                honestly, that it is a helper made by a computer, not a person
 *   3 name       tap one of six picture names (read aloud); the server screens the name
 *                (minor gate + PII: never the child's own name, an address, a school)
 *   4 paint      eight curated paint pots plus a "surprise me" die
 *   5 loves      "What do you love?" picture cards: a Space favourite + the first story world
 *   6 wall       the wall fills in from those picks; the child places one sticker
 *   7 adventure  the first adventure. For an unplaced child the server makes it the
 *                placement check in disguise ("help your Sprite fix the bridge")
 *
 * Seven taps reach the first adventure. Resumable: after every tap the step id is saved
 * to the server (PUT /me/intro {step: 'paint'}, lib/hearth/kid_world_router.py, which
 * stores only the step) and the step plus picks are mirrored on the device, so a reload
 * lands on the same step. "Let's go!" sends {done: true}; the device copy is dropped only
 * once the server has recorded the intro as done, so a failed save resumes at step 7 and
 * tries again instead of restarting from the egg. Saves to the real child doors are best
 * effort and never block the next step: the Sprite's name and paint (PUT
 * /me/sprite-design), the favourite (POST /me/space/favorites).
 *
 * Child-safety rules kept here: no text input anywhere (no keyboard ever opens), no
 * links, no purchases, no timers, streaks or scores; nothing but fixed lists is sent.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createLearnVoice, type LearnSpeak } from './learnVoice'
import { SpriteVector } from './SpriteVectorView'
import { FONT_UI } from './learnTheme'

// --------------------------------------------------------------------------- the step machine

/** The step ids, in order. They ARE the server's ids (lib/tutor/kid_intro.py STEPS, sent
 *  as strings to PUT /me/intro); dev/tests/test_kid_intro_first_run.py reads this line
 *  and walks the real router with it, so a rename on either side fails a test. */
export const INTRO_STEPS = ['egg', 'hatch', 'name', 'paint', 'loves', 'wall', 'adventure'] as const
export type IntroStepId = typeof INTRO_STEPS[number]
export const INTRO_VERSION = 1

export type StarterId = 'fox' | 'owl' | 'dragon'

export interface IntroPicks {
  egg?: string
  name?: string
  paint?: string
  love?: string
  sticker?: string
}

export interface IntroState {
  v: number
  /** 1..7 (INTRO_STEPS[step - 1]) */
  step: number
  picks: IntroPicks
  /** step 2: the egg has hatched and is saying hello */
  hatched: boolean
}

export type IntroAction =
  | { type: 'tapEgg' }
  | { type: 'pickEgg'; egg: string }
  | { type: 'greet' }
  | { type: 'name'; name: string }
  | { type: 'paint'; paint: string }
  | { type: 'love'; love: string }
  | { type: 'sticker'; sticker: string }
  | { type: 'restore'; state: IntroState }

export const FRESH_INTRO: IntroState = { v: INTRO_VERSION, step: 1, picks: {}, hatched: false }

/** The step machine. Pure: every tap is one action, and a tap that does not belong to
 *  the current step changes nothing (a double tap cannot skip a step). */
export function introReducer(s: IntroState, a: IntroAction): IntroState {
  const at = (n: number) => s.step === n
  switch (a.type) {
    case 'tapEgg':
      return at(1) ? { ...s, step: 2 } : s
    case 'pickEgg':
      return at(2) && !s.hatched ? { ...s, hatched: true, picks: { ...s.picks, egg: a.egg } } : s
    case 'greet':
      return at(2) && s.hatched ? { ...s, step: 3 } : s
    case 'name':
      return at(3) && a.name ? { ...s, step: 4, picks: { ...s.picks, name: a.name } } : s
    case 'paint':
      return at(4) && a.paint ? { ...s, step: 5, picks: { ...s.picks, paint: a.paint } } : s
    case 'love':
      return at(5) && a.love ? { ...s, step: 6, picks: { ...s.picks, love: a.love } } : s
    case 'sticker':
      return at(6) && a.sticker ? { ...s, step: 7, picks: { ...s.picks, sticker: a.sticker } } : s
    case 'restore':
      return a.state
  }
  return s
}

const PICK_KEYS: (keyof IntroPicks)[] = ['egg', 'name', 'paint', 'love', 'sticker']

/** Anything (a stale device copy, a server row) made into a valid state, or null. A
 *  step whose earlier picks are missing falls back to the first step that still needs
 *  one, so a resume never shows a wall with no Sprite on it (device copies only). */
export function cleanIntroState(raw: unknown): IntroState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  // The server sends the step id ('paint'); the device copy holds the step number.
  const fromServer = typeof r.step === 'string'
  const step = fromServer
    ? INTRO_STEPS.indexOf(r.step as IntroStepId) + 1
    : Math.floor(Number(r.step))
  if (!Number.isFinite(step) || step < 1) return null
  const pr = (r.picks && typeof r.picks === 'object' ? r.picks : {}) as Record<string, unknown>
  const picks: IntroPicks = {}
  for (const k of PICK_KEYS) {
    const v = pr[k]
    if (typeof v === 'string' && v && v.length <= 24) picks[k] = v
  }
  // the pick each step needs before it can be shown: step N needs picks of steps 2..N-1.
  // The server stores the step only (never the picks) and moves only on a child's tap, so
  // its step is trusted as is: every later step draws with the Sprite they already have.
  const need: (keyof IntroPicks)[] = ['egg', 'name', 'paint', 'love', 'sticker']
  let ok = Math.min(step, INTRO_STEPS.length)
  for (let i = 0; i < need.length && !fromServer; i++) {
    const stepNeeding = i + 3 // egg is needed from step 3 on, name from 4, ...
    if (ok >= stepNeeding && !picks[need[i]]) { ok = stepNeeding - 1; break }
  }
  const hatched = ok > 2 || (ok === 2 && Boolean(picks.egg) && r.hatched !== false)
  return { v: INTRO_VERSION, step: ok, picks, hatched }
}

/** Where to resume: the further of the server's and the device's copies (a step is
 *  never taken back, so the furthest valid copy is the truest). */
export function resumeIntro(server: unknown, device: unknown): IntroState {
  const a = cleanIntroState(server)
  const b = cleanIntroState(device)
  if (a && b) return b.step >= a.step ? b : a // a tie keeps the device's picks
  return a || b || FRESH_INTRO
}

/** The body of PUT /me/intro for a step change: exactly the server's IntroMove
 *  ({step: <id>}; the router forbids extra fields, so picks never go there). */
export function introMoveBody(s: IntroState): { step: IntroStepId } {
  return { step: INTRO_STEPS[Math.min(Math.max(1, s.step), INTRO_STEPS.length) - 1] }
}

/** The body of PUT /me/intro that finishes the intro. */
export const INTRO_DONE_BODY = { done: true } as const

export function introStorageKey(who: string): string {
  return `aither.learn.intro.v${INTRO_VERSION}:${who || 'me'}`
}

// --------------------------------------------------------------------------- curated content

/** Three-tone paint pots (body, belly, accent), chosen to read at 48px on dark and light. */
export const PAINT_POTS: { id: string; body: string; belly: string; accent: string }[] = [
  { id: 'sunrise', body: '#ff8a3d', belly: '#fff1e0', accent: '#c2410c' },
  { id: 'lagoon', body: '#2fb5a4', belly: '#e0fbf6', accent: '#0f766e' },
  { id: 'berry', body: '#c0479a', belly: '#fde6f3', accent: '#7e1d5c' },
  { id: 'meadow', body: '#7ccf6b', belly: '#effae4', accent: '#3f9b4b' },
  { id: 'starlight', body: '#6d6af6', belly: '#e9e8ff', accent: '#3b38b8' },
  { id: 'honey', body: '#f5b82e', belly: '#fff6d8', accent: '#a86a00' },
  { id: 'sky', body: '#4aa8f0', belly: '#e6f4ff', accent: '#1d5f99' },
  { id: 'cocoa', body: '#9a6b52', belly: '#f6e8dc', accent: '#5d3a28' },
]

const SPECIES_PAINT: Record<string, string> = {
  fox: 'sunrise', owl: 'cocoa', dragon: 'lagoon', bunny: 'berry', cat: 'honey',
  otter: 'cocoa', turtle: 'meadow', sprout: 'meadow',
}

export const STARTERS: { id: StarterId; say: string }[] = [
  { id: 'fox', say: 'a quick little fox' },
  { id: 'owl', say: 'a wise little owl' },
  { id: 'dragon', say: 'a friendly little dragon' },
]

/** Six names, each short, easy to say and nobody's real name. */
export const NAME_IDEAS = ['Pip', 'Luma', 'Bix', 'Momo', 'Ziggy', 'Nova', 'Tumble', 'Sunny'] as const

/** "What do you love?" Each card is a real story world (the quest's theme) and, when it
 *  has one, an animal from the Space's fixed favourite list. */
export const LOVES: { id: string; emoji: string; label: string; theme: string; animal?: string }[] = [
  { id: 'dinos', emoji: '🦕', label: 'Dinosaurs', theme: 'dinos', animal: 'dinosaur' },
  { id: 'ocean', emoji: '🐬', label: 'The ocean', theme: 'ocean', animal: 'dolphin' },
  { id: 'space', emoji: '🚀', label: 'Space', theme: 'space' },
  { id: 'jungle', emoji: '🦁', label: 'Jungle animals', theme: 'jungle', animal: 'lion' },
  { id: 'farm', emoji: '🐴', label: 'The farm', theme: 'farm', animal: 'horse' },
  { id: 'castle', emoji: '🦄', label: 'Castles', theme: 'castle', animal: 'unicorn' },
]

export const STICKERS: { id: string; emoji: string; label: string }[] = [
  { id: 'star', emoji: '⭐', label: 'star' },
  { id: 'rainbow', emoji: '🌈', label: 'rainbow' },
  { id: 'heart', emoji: '💜', label: 'heart' },
  { id: 'moon', emoji: '🌙', label: 'moon' },
]

const HONEST_LINE = "Hi! I'm a helper made by a computer. I'm not a person, but I'll learn alongside you."

/** Names to offer: never one that is (part of) the child's own name. The server screens
 *  again; this only keeps an obviously bad choice off the screen. */
export function nameIdeasFor(alias: string, refused: readonly string[] = []): string[] {
  const own = new Set((alias || '').toLowerCase().match(/[a-z]{2,}/g) || [])
  const out = NAME_IDEAS.filter((n) => !own.has(n.toLowerCase()) && !refused.includes(n))
  return out.slice(0, 6)
}

// --------------------------------------------------------------------------- the creature

function paintOf(id?: string, species?: string) {
  return PAINT_POTS.find((p) => p.id === id)
    ?? PAINT_POTS.find((p) => p.id === SPECIES_PAINT[species || ''])
    ?? PAINT_POTS[0]
}

const INK = '#2a1f3d'

/** The child's starter creature in the sprites-v2 vector art (the one Sprite look, spriteVector.ts),
 *  in the paint pot they picked; it breathes (off under reduced motion). */
export function IntroCreature({ species = 'fox', paint, size = 180, label }: {
  species?: string; paint?: string; size?: number; label?: string
}) {
  const p = paintOf(paint, species)
  const design = useMemo(() => ({ species, colors: { body: p.body, belly: p.belly, accent: p.accent } }), [species, p.body, p.belly, p.accent])
  return (
    <span data-testid="intro-creature" data-species={species} data-paint={p.id} data-look="vector" role="img"
      aria-label={label || `your ${species}`} style={{ display: 'block', width: size, height: size }}>
      <SpriteVector design={design} size={size} label={label || `your ${species}`} shadow className="kwi-breathe" />
    </span>
  )
}

/** The glowing egg. `wobble` rocks it; `tone` tints its speckles to the starter inside. */
function Egg({ size = 150, wobble = false, tone = '#ffd166', testId }: { size?: number; wobble?: boolean; tone?: string; testId?: string }) {
  return (
    <svg data-testid={testId} width={size} height={size * 1.2} viewBox="0 0 100 120" aria-hidden
      className={wobble ? 'kwi-wobble' : undefined} style={{ overflow: 'visible' }}>
      <defs>
        <radialGradient id={`kwi-egg-${tone.slice(1)}`} cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor="#fffdf5" />
          <stop offset="70%" stopColor="#fbecc8" />
          <stop offset="100%" stopColor="#e8cf98" />
        </radialGradient>
      </defs>
      <path d="M50 6 C78 6 94 52 94 74 C94 100 74 116 50 116 C26 116 6 100 6 74 C6 52 22 6 50 6 Z"
        fill={`url(#kwi-egg-${tone.slice(1)})`} stroke={INK} strokeWidth={4} />
      <circle cx="34" cy="62" r="7" fill={tone} opacity=".8" />
      <circle cx="62" cy="44" r="5" fill={tone} opacity=".8" />
      <circle cx="64" cy="84" r="8" fill={tone} opacity=".8" />
      <circle cx="40" cy="94" r="4" fill={tone} opacity=".8" />
    </svg>
  )
}

const KWI_CSS = `
.kwi-breathe{transform-origin:50% 90%;display:inline-block;animation:kwi-breathe 3.2s ease-in-out infinite}
.kwi-blink{transform-origin:100px 98px;animation:kwi-blink 5.4s infinite}
.kwi-wobble{transform-origin:50% 90%;animation:kwi-wobble 1.6s ease-in-out infinite}
.kwi-pop{animation:kwi-pop .7s cubic-bezier(.2,.8,.2,1) both}
.kwi-glow{filter:drop-shadow(0 0 28px rgba(255,214,120,.65))}
.kwi-tap{transition:transform .18s cubic-bezier(.2,.8,.2,1)}
.kwi-tap:active{transform:scale(.95)}
@keyframes kwi-breathe{50%{transform:scale(1.035,.975)}}
@keyframes kwi-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes kwi-wobble{0%,100%{transform:rotate(0)}25%{transform:rotate(-7deg)}75%{transform:rotate(7deg)}}
@keyframes kwi-pop{from{opacity:0;transform:scale(.6)}}
@media (prefers-reduced-motion:reduce){.kwi-breathe,.kwi-blink,.kwi-wobble,.kwi-pop{animation:none!important}}
`

// --------------------------------------------------------------------------- the panel

export interface KidWorldIntroProps {
  apiBase: string
  extraHeaders?: Record<string, string>
  /** The child's alias (who the room is for; also keys the device copy). */
  alias?: string
  /** The Sprite they already have, when a grown-up hatched one before. */
  sprite?: { name?: string; species?: string; stage?: string } | null
  /** The server's saved intro (/me.intro: {needed, step: 'paint', ...}), when it has one.
   *  A device copy (numeric step plus picks) is accepted too. */
  saved?: { step?: string | number | null; picks?: IntroPicks; needed?: boolean } | null
  /** Read-aloud; defaults to the tutor voice over apiBase. */
  speak?: LearnSpeak
  /** Step 7's "Let's go!": the host starts the first adventure in this story world. */
  onDone: (adventure: { theme: string; spriteName: string }) => void
}

function readDevice(key: string): unknown {
  try { return JSON.parse(window.localStorage.getItem(key) || 'null') } catch { return null }
}
function writeDevice(key: string, value: unknown): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(value))
  } catch { /* private mode: the server copy still resumes */ }
}

const LINES: Record<IntroStepId, string> = {
  egg: "This is your classroom. Someone's waiting to meet you. Tap the egg!",
  hatch: 'Pick an egg!',
  name: 'What should we call me? Pick a name.',
  paint: 'Paint me! Pick a color.',
  loves: 'What do you love?',
  wall: 'This is your wall! Pick a sticker to put on it.',
  adventure: 'Your first adventure is ready!',
}

export default function KidWorldIntro({ apiBase, extraHeaders = {}, alias = '', sprite, saved, speak, onDone }: KidWorldIntroProps) {
  const headersRef = useRef(extraHeaders)
  headersRef.current = extraHeaders
  const voice = useMemo<LearnSpeak>(
    () => speak ?? createLearnVoice(apiBase, () => headersRef.current),
    [speak, apiBase],
  )
  const key = introStorageKey(alias)
  const [state, dispatch] = useReducer(introReducer, undefined, () =>
    resumeIntro(saved ?? null, typeof window === 'undefined' ? null : readDevice(key)))
  const [refused, setRefused] = useState<string[]>([])
  const [note, setNote] = useState<string | null>(null)
  const hatchedAlready = Boolean(sprite && sprite.species && sprite.stage && sprite.stage !== 'egg')
  const stepId: IntroStepId = INTRO_STEPS[Math.min(state.step, INTRO_STEPS.length) - 1]
  const species = state.picks.egg || sprite?.species || 'fox'
  const spriteName = state.picks.name || ''
  const love = LOVES.find((l) => l.id === state.picks.love)

  const call = useCallback(async (path: string, method: string, body: object) => {
    const r = await fetch(`${apiBase}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headersRef.current },
      body: JSON.stringify(body),
    })
    return r
  }, [apiBase])

  // Save after every step change: the device copy at once, the server copy best effort.
  const first = useRef(true)
  useEffect(() => {
    writeDevice(key, state)
    if (first.current) { first.current = false; return }
    call('/me/intro', 'PUT', introMoveBody(state)).catch(() => {})
  }, [state, key, call])

  // One spoken line per moment (and the honest hello when it hatches).
  useEffect(() => {
    if (stepId === 'hatch' && state.hatched) voice(HONEST_LINE)
    else if (stepId === 'hatch' && hatchedAlready) voice('Someone is waking up. Tap the egg!')
    else if (stepId === 'name' && note) voice(note)
    else voice(LINES[stepId])
  }, [stepId, state.hatched, hatchedAlready, note, voice])

  const pickName = async (name: string) => {
    setNote(null)
    try {
      const r = await call('/me/sprite-design', 'PUT', { design: { v: 1, kind: 'creature', species, name } })
      if (r.status === 422) {
        // The server's PII screen said no (for example it is part of the child's own name).
        setRefused((x) => [...x, name])
        setNote("Let's pick a different name!")
        return
      }
    } catch { /* offline: the name is kept on the device and saved with the next step */ }
    dispatch({ type: 'name', name })
  }

  const pickPaint = (id: string) => {
    const pot = PAINT_POTS.find((p) => p.id === id) ?? PAINT_POTS[0]
    call('/me/sprite-design', 'PUT', {
      design: { v: 1, kind: 'creature', species, name: spriteName, colors: { body: pot.body, belly: pot.belly, accent: pot.accent } },
    }).catch(() => {})
    dispatch({ type: 'paint', paint: pot.id })
  }

  const pickLove = (id: string) => {
    const card = LOVES.find((l) => l.id === id)
    if (card?.animal) call('/me/space/favorites', 'POST', { animals: [card.animal] }).catch(() => {})
    dispatch({ type: 'love', love: id })
  }

  const go = () => {
    // Drop the device copy only once the server has the intro as done (409: there is no
    // intro left to finish). Otherwise keep it, so the next open resumes here and retries.
    call('/me/intro', 'PUT', INTRO_DONE_BODY)
      .then((r) => { if (r.ok || r.status === 409) writeDevice(key, null) })
      .catch(() => {})
    onDone({ theme: love?.theme || 'space', spriteName })
  }

  const shell: CSSProperties = {
    minHeight: '100dvh', width: '100%', boxSizing: 'border-box', padding: '28px 18px 36px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22,
    fontFamily: FONT_UI, color: '#f6f1ff', textAlign: 'center', overflow: 'hidden',
    background: stepId === 'egg'
      ? 'radial-gradient(circle at 50% 46%, #3a2c5e 0%, #160f29 46%, #07050f 100%)'
      : 'radial-gradient(circle at 50% 30%, #4b3b86 0%, #251b4a 52%, #120c26 100%)',
    transition: 'background .8s ease',
  }
  const line: CSSProperties = { fontSize: 30, fontWeight: 600, lineHeight: 1.25, maxWidth: 520, letterSpacing: '-0.01em' }
  const tile: CSSProperties = {
    minWidth: 96, minHeight: 96, borderRadius: 28, border: '2px solid rgba(255,255,255,.18)',
    background: 'rgba(255,255,255,.08)', color: '#fff', cursor: 'pointer', touchAction: 'manipulation',
    fontFamily: FONT_UI, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
  }
  const big: CSSProperties = {
    ...tile, minHeight: 88, padding: '0 34px', fontSize: 30, fontWeight: 700, borderRadius: 999,
    background: 'linear-gradient(180deg,#ffd166,#f9a83b)', color: '#2a1f3d', border: 'none',
    boxShadow: '0 0 36px rgba(255,209,102,.55)', flexDirection: 'row',
  }
  const grid = (cols: number): CSSProperties => ({
    display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(96px, 1fr))`, gap: 14, width: '100%', maxWidth: 460,
  })

  let body: ReactNode = null
  switch (stepId) {
    case 'egg':
      body = (
        <>
          <button type="button" data-testid="intro-egg" aria-label="the glowing egg" className="kwi-tap kwi-glow"
            onClick={() => dispatch({ type: 'tapEgg' })}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 12, touchAction: 'manipulation' }}>
            <Egg size={170} wobble />
          </button>
          <div style={line}>This is <b>your</b> classroom.</div>
        </>
      )
      break
    case 'hatch':
      if (state.hatched) {
        body = (
          <>
            <div className="kwi-pop kwi-glow"><IntroCreature species={species} size={220} /></div>
            <div data-testid="honest-line" style={{ ...line, fontSize: 26 }}>{HONEST_LINE}</div>
            <button type="button" data-testid="intro-greet" className="kwi-tap" style={big}
              onClick={() => dispatch({ type: 'greet' })}>👋 Hi!</button>
          </>
        )
      } else if (hatchedAlready) {
        // A grown-up hatched their Sprite already: this egg is theirs, the tap wakes it.
        body = (
          <>
            <div style={line}>Someone is waking up…</div>
            <button type="button" data-testid="intro-pick-egg" aria-label="wake it up" className="kwi-tap kwi-glow"
              onClick={() => dispatch({ type: 'pickEgg', egg: String(sprite?.species) })}
              style={{ background: 'none', border: 'none', cursor: 'pointer', touchAction: 'manipulation' }}>
              <Egg size={170} wobble tone={paintOf(undefined, sprite?.species).body} />
            </button>
          </>
        )
      } else {
        body = (
          <>
            <div style={line}>Pick an egg!</div>
            <div style={grid(3)}>
              {STARTERS.map((s) => (
                <button key={s.id} type="button" data-testid="intro-pick-egg" aria-label={s.say} className="kwi-tap"
                  onClick={() => dispatch({ type: 'pickEgg', egg: s.id })}
                  style={{ ...tile, background: 'none', border: 'none', minHeight: 150 }}>
                  <Egg size={92} wobble tone={paintOf(undefined, s.id).body} />
                </button>
              ))}
            </div>
          </>
        )
      }
      break
    case 'name': {
      const ideas = nameIdeasFor(alias, refused)
      body = (
        <>
          <IntroCreature species={species} size={150} />
          <div style={line}>{note || 'What should we call me?'}</div>
          <div style={grid(2)}>
            {ideas.map((n) => (
              <button key={n} type="button" data-testid="intro-name" className="kwi-tap"
                onClick={() => { void pickName(n) }}
                style={{ ...tile, fontSize: 28, fontWeight: 700 }}>
                {n}
              </button>
            ))}
          </div>
          <button type="button" aria-label="hear the names" className="kwi-tap"
            onClick={() => voice(`${ideas.join('. ')}.`)} style={{ ...tile, minHeight: 64, minWidth: 64, fontSize: 26 }}>🔊</button>
        </>
      )
      break
    }
    case 'paint':
      body = (
        <>
          <IntroCreature species={species} size={150} label={spriteName} />
          <div style={line}>Paint {spriteName || 'me'}!</div>
          <div style={grid(3)}>
            {PAINT_POTS.map((p) => (
              <button key={p.id} type="button" data-testid="intro-paint" aria-label={`${p.id} paint`} className="kwi-tap"
                onClick={() => pickPaint(p.id)} style={tile}>
                <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden>
                  <path d="M10 22 h44 l-4 34 a6 6 0 0 1 -6 5 h-24 a6 6 0 0 1 -6 -5 Z" fill={p.accent} stroke={INK} strokeWidth="3" />
                  <ellipse cx="32" cy="22" rx="22" ry="7" fill={p.body} stroke={INK} strokeWidth="3" />
                  <circle cx="26" cy="21" r="3" fill={p.belly} />
                </svg>
              </button>
            ))}
            <button type="button" data-testid="intro-surprise" aria-label="surprise me" className="kwi-tap"
              onClick={() => pickPaint(PAINT_POTS[Math.floor(Math.random() * PAINT_POTS.length)].id)}
              style={{ ...tile, fontSize: 44 }}>🎲</button>
          </div>
        </>
      )
      break
    case 'loves':
      body = (
        <>
          <div style={line}>What do you love?</div>
          <div style={grid(3)}>
            {LOVES.map((l) => (
              <button key={l.id} type="button" data-testid="intro-love" aria-label={l.label} className="kwi-tap"
                onClick={() => pickLove(l.id)} style={{ ...tile, minHeight: 116 }}>
                <span aria-hidden style={{ fontSize: 52, lineHeight: 1 }}>{l.emoji}</span>
              </button>
            ))}
          </div>
        </>
      )
      break
    case 'wall':
      body = (
        <>
          <div data-testid="intro-wall" style={{
            width: '100%', maxWidth: 460, borderRadius: 32, padding: '22px 16px', boxSizing: 'border-box',
            background: 'linear-gradient(160deg, rgba(255,255,255,.14), rgba(255,255,255,.04))',
            border: '2px solid rgba(255,255,255,.2)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          }}>
            <IntroCreature species={species} paint={state.picks.paint} size={130} label={spriteName} />
            <div style={{ fontSize: 26, fontWeight: 700 }}>{spriteName}</div>
            {love && <div aria-hidden style={{ fontSize: 44 }}>{love.emoji}</div>}
          </div>
          <div style={line}>Pick a sticker!</div>
          <div style={grid(4)}>
            {STICKERS.map((s) => (
              <button key={s.id} type="button" data-testid="intro-sticker" aria-label={s.label} className="kwi-tap"
                onClick={() => dispatch({ type: 'sticker', sticker: s.id })} style={{ ...tile, fontSize: 44 }}>
                {s.emoji}
              </button>
            ))}
          </div>
        </>
      )
      break
    case 'adventure': {
      const sticker = STICKERS.find((s) => s.id === state.picks.sticker)
      body = (
        <>
          <div data-testid="intro-adventure" style={{ position: 'relative' }}>
            <div className="kwi-pop kwi-glow"><IntroCreature species={species} paint={state.picks.paint} size={190} label={spriteName} /></div>
            {sticker && <span aria-hidden style={{ position: 'absolute', right: -6, top: 0, fontSize: 44 }}>{sticker.emoji}</span>}
          </div>
          <div style={line}>{spriteName ? `${spriteName} is ready for your first adventure!` : 'Your first adventure is ready!'}</div>
          <button type="button" data-testid="intro-go" className="kwi-tap" style={big} onClick={go}>
            {love?.emoji ?? '✨'} Let’s go!
          </button>
        </>
      )
      break
    }
  }

  return (
    <div data-testid="kid-world-intro" data-step={state.step} data-step-id={stepId} style={shell}>
      <style>{KWI_CSS}</style>
      <div aria-hidden style={{ display: 'flex', gap: 8 }}>
        {INTRO_STEPS.map((s, i) => (
          <span key={s} style={{
            width: 10, height: 10, borderRadius: 5,
            background: i < state.step ? '#ffd166' : 'rgba(255,255,255,.18)',
          }} />
        ))}
      </div>
      {body}
      {stepId !== 'name' && (
        <button type="button" aria-label="say it again" className="kwi-tap"
          onClick={() => voice(stepId === 'hatch' && state.hatched ? HONEST_LINE : LINES[stepId])}
          style={{ ...tile, minHeight: 64, minWidth: 64, fontSize: 26, background: 'transparent' }}>🔊</button>
      )}
    </div>
  )
}
