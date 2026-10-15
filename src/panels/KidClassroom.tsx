/**
 * KidClassroom: a child's home in Aither Learn is ONE room, not a scroll of cards.
 *
 * docs/plans/2026-10-14-kids-suite.md section 3. Nine objects stand in the room and each
 * opens exactly one thing; they are also the child's "beads" in the nav manifest
 * (AitherOS/config/nav/aither-nav.yaml profiles.child, asserted by check_child_nav.py --
 * ROOM_OBJECT_IDS below is the list that checker reads):
 *
 *   Nest       -> My day: the child's Sprite, what's waiting, their helpers
 *   Door       -> today's adventure (the lesson)
 *   Bookshelf  -> stories
 *   Easel      -> art (a paint wall on this device; nothing is sent anywhere)
 *   Toy chest  -> games
 *   Mailbox    -> teacher work, notes and gifts from a grown-up
 *   Window     -> family: the household room
 *   Wall       -> my page
 *   Wardrobe   -> my Sprite's look
 *
 * The host passes each object's view (Veil's learn page wires the existing kid panels in);
 * an object with no view is not drawn, so there is never a dead button.
 *
 * Attention through delight, never compulsion (non-negotiable 5): three objects glow as
 * "Today's three" -- one learning, one story, one make-or-play. Opening one counts; the
 * learning one counts when the server says today's learning is done. When all three are
 * done the room says "That's everything for today!" and the glow goes off. "All done" is
 * always there. At the guardian's daily cap the room says goodnight and dims. No streaks,
 * no countdowns, no badges, no score, no infinite list.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { C, EASE, FONT_UI } from './learnTheme'
import { SpriteFace, type SpriteCardLike } from './spriteLook'
import { SpriteVector } from './SpriteVectorView'

/** The room's objects, in the manifest's bead order. check_child_nav.py CHN002 reads this. */
export const ROOM_OBJECT_IDS = ['nest', 'door', 'bookshelf', 'easel', 'toychest', 'mailbox', 'window', 'wall', 'wardrobe'] as const

export type RoomObjectId = typeof ROOM_OBJECT_IDS[number]

export function isRoomObject(v: unknown): v is RoomObjectId {
  return typeof v === 'string' && (ROOM_OBJECT_IDS as readonly string[]).includes(v)
}

interface RoomObjectInfo {
  /** One or two words under the object, read aloud on tap. */
  label: string
  /** What the room says when the child taps it. */
  say: string
  /** The view's title. */
  title: string
  /** Where it stands: 3x3 grid area (row / column), the Nest in the middle. */
  area: string
}

export const ROOM_OBJECTS: Readonly<Record<RoomObjectId, RoomObjectInfo>> = {
  window: { label: 'Window', say: 'Let’s see your family.', title: 'My family', area: '1 / 1' },
  wall: { label: 'My page', say: 'Here is your page.', title: 'My page', area: '1 / 2' },
  bookshelf: { label: 'Books', say: 'Story time!', title: 'Stories', area: '1 / 3' },
  mailbox: { label: 'Mail', say: 'Let’s check your mail.', title: 'My mail', area: '2 / 1' },
  nest: { label: 'My day', say: 'Here’s your day.', title: 'My day', area: '2 / 2' },
  easel: { label: 'Paint', say: 'Let’s make some art!', title: 'Paint', area: '2 / 3' },
  wardrobe: { label: 'Dress up', say: 'Let’s dress up your Sprite.', title: 'Dress up', area: '3 / 1' },
  door: { label: 'Adventure', say: 'Ready for an adventure?', title: 'Today’s adventure', area: '3 / 2' },
  toychest: { label: 'Games', say: 'Let’s play!', title: 'Games', area: '3 / 3' },
}

/** Today's three: one learning, one story, one make-or-play (manifest profiles.child.today_three). */
export const TODAY_SLOTS: Readonly<Record<'learn' | 'story' | 'make', readonly RoomObjectId[]>> = {
  learn: ['door'],
  story: ['bookshelf', 'mailbox'],
  make: ['easel', 'toychest'],
}

/** The glowing three for a room that offers ``present``: the first offered object per slot. */
export function todaysThree(present: ReadonlySet<RoomObjectId>): RoomObjectId[] {
  const out: RoomObjectId[] = []
  for (const slot of ['learn', 'story', 'make'] as const) {
    const pick = TODAY_SLOTS[slot].find((id) => present.has(id))
    if (pick) out.push(pick)
  }
  return out
}

/** Local day, YYYY-MM-DD: the marks reset at the child's midnight, not UTC's. */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const MARKS_PREFIX = 'aither.classroom.'

function marksKey(storageKey: string, day: string): string {
  return `${MARKS_PREFIX}${storageKey}.${day}`
}

/** Objects opened today on this device (only ever ids; nothing about what the child did). */
export function readMarks(storageKey: string, day: string): RoomObjectId[] {
  try {
    const raw = window.localStorage.getItem(marksKey(storageKey, day))
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter(isRoomObject) : []
  } catch {
    return []
  }
}

function writeMarks(storageKey: string, day: string, marks: RoomObjectId[]): void {
  try {
    // Yesterday's marks are dropped: one key per child, per day.
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith(`${MARKS_PREFIX}${storageKey}.`) && k !== marksKey(storageKey, day)) window.localStorage.removeItem(k)
    }
    window.localStorage.setItem(marksKey(storageKey, day), JSON.stringify(marks))
  } catch {
    /* private mode: the glow just resets on reload */
  }
}

export interface KidClassroomProps {
  /** The child's first name (from /me; never typed here). */
  name?: string
  /** The Sprite's name, for the Nest's line. */
  spriteName?: string
  /** The child's Sprite card (/me sprite): drawn in the nest with the sprites-v2 vector art. */
  sprite?: SpriteCardLike | null
  /** What each object opens. An object with no view is not drawn (the Easel has its own). */
  views: Partial<Record<RoomObjectId, ReactNode>>
  /** Open this object's view first (a deep link: /learn?room=<id>). */
  initialObject?: RoomObjectId | null
  /** Minutes of the guardian's daily cap left (/me today_minutes_left). 0 = goodnight. */
  minutesLeft?: number | null
  /** The server says today's learning is done (/me/progress today.goal_met). */
  learnedToday?: boolean
  /** Per-child key for today's marks on a shared tablet. */
  storageKey?: string
  /** Read a line aloud (the Learn voice). */
  speak?: (text: string) => void
  /** Told when an object opens (the host may log it; never a score). */
  onOpen?: (id: RoomObjectId) => void
  /** Clock, for tests. */
  now?: () => Date
}

type Mode = { kind: 'room' } | { kind: 'view'; id: RoomObjectId } | { kind: 'resting' }

const INK = '#2a2440'
const ROOM_CSS = `
.kc-obj{transition:transform .25s ${EASE}}
.kc-obj:active{transform:scale(.94)}
.kc-obj:focus-visible{outline:4px solid #ffd166;outline-offset:4px}
.kc-glow .kc-halo{opacity:1;animation:kc-breathe 3.2s ease-in-out infinite}
.kc-bob{animation:kc-bob 4s ease-in-out infinite;transform-origin:50% 90%}
.kc-blink{animation:kc-blink 5s infinite}
@keyframes kc-breathe{50%{transform:scale(1.08);opacity:.7}}
@keyframes kc-bob{50%{transform:translateY(-3px)}}
@keyframes kc-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes kc-in{from{opacity:0;transform:translateY(10px)}}
@media (prefers-reduced-motion: reduce){.kc-obj,.kc-glow .kc-halo,.kc-bob,.kc-blink{animation:none!important;transition:none!important}}
`

export default function KidClassroom(props: KidClassroomProps) {
  return <NestSprite.Provider value={props.sprite ?? null}><Room {...props} /></NestSprite.Provider>
}

function Room({
  name, spriteName, views, initialObject = null, minutesLeft = null, learnedToday = false,
  storageKey = 'me', speak, onOpen, now = () => new Date(),
}: KidClassroomProps) {
  const day = localDay(now())
  const present = useMemo(() => {
    const s = new Set<RoomObjectId>()
    for (const id of ROOM_OBJECT_IDS) if (views[id] !== undefined && views[id] !== null) s.add(id)
    s.add('easel') // the paint wall is the room's own
    return s
  }, [views])
  const three = useMemo(() => todaysThree(present), [present])
  const [marks, setMarks] = useState<RoomObjectId[]>([])
  useEffect(() => { setMarks(readMarks(storageKey, day)) }, [storageKey, day])
  const done = useCallback((id: RoomObjectId) => (id === 'door' ? learnedToday || marks.includes(id) : marks.includes(id)),
    [learnedToday, marks])
  const allThreeDone = three.length > 0 && three.every(done)
  const goodnight = minutesLeft === 0

  const [mode, setMode] = useState<Mode>(() =>
    initialObject && isRoomObject(initialObject) && !goodnight ? { kind: 'view', id: initialObject } : { kind: 'room' })

  const speakRef = useRef(speak)
  speakRef.current = speak
  const greeted = useRef(false)
  useEffect(() => {
    if (greeted.current || mode.kind !== 'room') return
    greeted.current = true
    const hi = name ? `Hi ${name}!` : 'Hi!'
    const line = goodnight
      ? `${hi} The room is resting now. See you tomorrow.`
      : allThreeDone ? `${hi} That’s everything for today!` : `${hi} ${glowLine(three.length)} for you today.`
    speakRef.current?.(line)
  }, [mode.kind, name, goodnight, allThreeDone, three.length])

  const open = (id: RoomObjectId) => {
    speakRef.current?.(ROOM_OBJECTS[id].say)
    if (id !== 'door' && !marks.includes(id)) {
      const next = [...marks, id]
      setMarks(next)
      writeMarks(storageKey, day, next)
    }
    setMode({ kind: 'view', id })
    onOpen?.(id)
  }
  const home = () => setMode({ kind: 'room' })

  if (goodnight) {
    return (
      <Scene dim>
        <style>{ROOM_CSS}</style>
        <div data-testid="room-goodnight" style={{ ...CENTER, gap: 18, paddingTop: 40 }}>
          <svg viewBox="0 0 120 120" width={150} height={150} aria-hidden>
            <circle cx="88" cy="26" r="14" fill="#fff4c2" stroke={INK} strokeWidth="3" />
            <circle cx="94" cy="22" r="12" fill="#2b2950" />
            <NestArt sleeping />
          </svg>
          <div style={{ fontSize: 30, fontWeight: 600, color: '#fff' }}>Goodnight{name ? `, ${name}` : ''}!</div>
          <div style={{ fontSize: 22, color: '#e5e0ff', maxWidth: 420 }}>
            {spriteName || 'Your Sprite'} is yawning. The room is resting until tomorrow.
          </div>
        </div>
      </Scene>
    )
  }

  if (mode.kind === 'resting') {
    return (
      <Scene dim>
        <style>{ROOM_CSS}</style>
        <div data-testid="room-resting" style={{ ...CENTER, gap: 20, paddingTop: 40 }}>
          <svg viewBox="0 0 120 120" width={150} height={150} aria-hidden><NestArt sleeping /></svg>
          <div style={{ fontSize: 30, fontWeight: 600, color: '#fff' }}>All done! See you next time{name ? `, ${name}` : ''}.</div>
          <button type="button" className="kc-obj" data-testid="room-wake" onClick={home} style={PILL}>Back to my room</button>
        </div>
      </Scene>
    )
  }

  if (mode.kind === 'view') {
    const info = ROOM_OBJECTS[mode.id]
    const body = mode.id === 'easel' && (views.easel === undefined || views.easel === null) ? <Easel /> : views[mode.id]
    return (
      <div data-testid={`room-view-${mode.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 18, animation: `kc-in .35s ${EASE}` }}>
        <style>{ROOM_CSS}</style>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button type="button" className="kc-obj" data-testid="room-back" aria-label="Back to my room" onClick={home}
            style={{ ...PILL, minWidth: 64, padding: '0 20px' }}>← My room</button>
          <svg viewBox="0 0 120 120" width={56} height={56} aria-hidden><Art id={mode.id} /></svg>
          <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.01em', color: C.ink }}>{info.title}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, textAlign: 'left' }}>{body}</div>
      </div>
    )
  }

  const objects = ROOM_OBJECT_IDS.filter((id) => present.has(id))
  return (
    <Scene>
      <style>{ROOM_CSS}</style>
      <div style={{ ...CENTER, gap: 4, padding: '6px 8px 2px' }}>
        <div data-testid="room-hello" style={{ fontSize: 30, fontWeight: 600, color: '#fff', textShadow: '0 2px 0 rgba(0,0,0,.25)' }}>
          Hi{name ? `, ${name}` : ''}!
        </div>
        <div data-testid={allThreeDone ? 'room-all-three-done' : 'room-today'} style={{ fontSize: 20, color: '#f3efff' }}>
          {allThreeDone ? 'That’s everything for today!' : `${glowLine(three.length)} for you.`}
        </div>
      </div>
      <div role="list" aria-label="My classroom" style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gridTemplateRows: 'repeat(3, auto)',
        gap: '10px 8px', padding: '8px 6px 4px', alignItems: 'end',
      }}>
        {objects.map((id) => {
          const glow = !allThreeDone && three.includes(id) && !done(id)
          const info = ROOM_OBJECTS[id]
          return (
            <div role="listitem" key={id} style={{ gridArea: info.area }}>
              <button type="button" data-testid={`room-${id}`} data-glow={glow ? '1' : '0'}
                aria-label={glow ? `${info.label}, glowing for today` : info.label}
                className={`kc-obj${glow ? ' kc-glow' : ''}`} onClick={() => open(id)}
                style={{
                  width: '100%', minHeight: 64, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, fontFamily: FONT_UI,
                }}>
                <span style={{ position: 'relative', width: id === 'nest' ? '100%' : '86%', maxWidth: id === 'nest' ? 150 : 118, aspectRatio: '1 / 1' }}>
                  <span aria-hidden className="kc-halo" style={{
                    position: 'absolute', inset: '6%', borderRadius: '50%', opacity: 0,
                    background: 'radial-gradient(circle, rgba(255,214,102,.75) 0%, rgba(255,214,102,0) 70%)',
                  }} />
                  <svg viewBox="0 0 120 120" width="100%" height="100%" aria-hidden style={{ position: 'relative' }}><Art id={id} /></svg>
                </span>
                <span style={{
                  fontSize: 17, fontWeight: 700, color: '#fff', background: 'rgba(42,36,64,.55)', borderRadius: 999,
                  padding: '3px 12px', whiteSpace: 'nowrap',
                }}>{info.label}{glow ? ' ✦' : ''}</span>
              </button>
            </div>
          )
        })}
      </div>
      <div style={{ ...CENTER, padding: '10px 0 4px' }}>
        <button type="button" className="kc-obj" data-testid="all-done" onClick={() => {
          speakRef.current?.('All done! See you next time.')
          setMode({ kind: 'resting' })
        }} style={PILL}>All done</button>
      </div>
    </Scene>
  )
}

function glowLine(n: number): string {
  return n === 1 ? 'One thing is glowing' : n === 2 ? 'Two things are glowing' : 'Three things are glowing'
}

const CENTER: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }
const PILL: CSSProperties = {
  minHeight: 64, padding: '0 28px', borderRadius: 999, border: `3px solid ${INK}`, background: '#ffd166', color: INK,
  fontSize: 22, fontWeight: 700, fontFamily: FONT_UI, cursor: 'pointer', boxShadow: `0 4px 0 ${INK}`,
}

/** The room itself: a wall, a wooden floor and a rug under the Nest. Its own palette, so it
 *  reads as a place in light and dark mode alike. */
function Scene({ children, dim = false }: { children: ReactNode; dim?: boolean }) {
  return (
    <div data-testid="kid-classroom" style={{
      position: 'relative', borderRadius: 32, overflow: 'hidden', border: `3px solid ${INK}`,
      background: dim
        ? 'linear-gradient(180deg, #1d1b3a 0%, #2b2950 64%, #3a2f3f 64%, #2f2633 100%)'
        : 'linear-gradient(180deg, #7b6fd6 0%, #9a8fe6 58%, #c98f5b 58%, #b97d4b 100%)',
      transition: 'background .8s ease', paddingBottom: 12, minHeight: 560,
    }}>
      {!dim && (
        <svg aria-hidden viewBox="0 0 400 200" preserveAspectRatio="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%', height: '42%' }}>
          {[30, 80, 130, 180].map((y) => <line key={y} x1="0" y1={y} x2="400" y2={y} stroke="#a56c3d" strokeWidth="2" />)}
          <ellipse cx="200" cy="70" rx="150" ry="34" fill="#74c0fc" stroke={INK} strokeWidth="3" opacity=".9" />
          <ellipse cx="200" cy="70" rx="112" ry="24" fill="none" stroke="#d0ebff" strokeWidth="4" strokeDasharray="8 8" />
        </svg>
      )}
      <div style={{ position: 'relative' }}>{children}</div>
    </div>
  )
}

/* ---------- the art: chunky toon shapes with an ink outline, readable at 48px ---------- */

const S = { stroke: INK, strokeWidth: 4, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const }

function Art({ id }: { id: RoomObjectId }) {
  switch (id) {
    case 'nest': return <NestArt />
    case 'door': return <DoorArt />
    case 'bookshelf': return <ShelfArt />
    case 'easel': return <EaselArt />
    case 'toychest': return <ChestArt />
    case 'mailbox': return <MailArt />
    case 'window': return <WindowArt />
    case 'wall': return <WallArt />
    case 'wardrobe': return <WardrobeArt />
  }
}

/** The child's own Sprite (KidClassroom `sprite`), drawn in the nest. */
const NestSprite = createContext<SpriteCardLike | null>(null)

/** The child's Sprite in its nest, in the sprites-v2 vector art (the one Sprite look): their own
 *  design or snapshot when the room has it, else their species' creature. */
function NestArt({ sleeping = false }: { sleeping?: boolean }) {
  const sprite = useContext(NestSprite)
  const own = !!sprite && (!!sprite.design || !!sprite.snapshot)
  return (
    <g>
      <foreignObject x="17" y="-4" width="86" height="86">
        <div data-testid="nest-sprite" data-look="vector" data-species={own ? undefined : sprite?.species || 'sprout'}
          style={{ width: 86, height: 86, lineHeight: 0, display: 'grid', placeItems: 'center' }}>
          {own
            ? <SpriteFace sprite={sprite} size={86} action={sleeping ? 'sleepy' : undefined} />
            : <SpriteVector design={{ species: sprite?.species || 'sprout' }} expression={sleeping ? 'sleepy' : 'content'} size={86} shadow={false} />}
        </div>
      </foreignObject>
      <path d="M18 70 Q60 104 102 70 Q100 92 60 98 Q20 92 18 70 Z" fill="#c98f4f" {...S} />
      <path d="M26 78 Q60 96 94 78 M30 86 Q60 100 90 86" fill="none" stroke="#8a5a2b" strokeWidth="3" strokeLinecap="round" />
    </g>
  )
}

function DoorArt() {
  return (
    <g>
      <path d="M32 108 V44 Q32 16 60 16 Q88 16 88 44 V108 Z" fill="#8f6ad8" {...S} />
      <path d="M42 100 V48 Q42 28 60 28 Q78 28 78 48 V100" fill="none" stroke="#b79cf0" strokeWidth="4" />
      <circle cx="76" cy="66" r="5" fill="#ffd166" {...S} strokeWidth={3} />
      <path d="M60 4 l3 7 7 1 -5 5 1 7 -6 -3 -6 3 1 -7 -5 -5 7 -1 Z" fill="#ffd166" {...S} strokeWidth={2.5} />
      <path d="M24 110 H96" {...S} />
    </g>
  )
}

function ShelfArt() {
  const books = [['#ffa94d', 14], ['#80d8ff', 10], ['#ffd166', 12], ['#b9f6ca', 9], ['#ea80fc', 13]] as const
  return (
    <g>
      <rect x="20" y="10" width="80" height="100" rx="6" fill="#a8743f" {...S} />
      {[44, 76].map((y) => <path key={y} d={`M24 ${y} H96`} {...S} strokeWidth={3} />)}
      {[0, 1, 2].map((row) => {
        let x = 27
        return books.slice(row, row + 4).map(([color, w], i) => {
          const h = 22 - ((i + row) % 3) * 3
          const y = (row === 0 ? 42 : row === 1 ? 74 : 106) - h
          const el = <rect key={`${row}-${i}`} x={x} y={y} width={w} height={h} rx="2" fill={color} {...S} strokeWidth={2.5} />
          x += w + 3
          return el
        })
      })}
    </g>
  )
}

function EaselArt() {
  return (
    <g>
      <path d="M36 112 L56 24 M84 112 L64 24 M60 30 V112" {...S} fill="none" stroke="#8a5a2b" strokeWidth={6} />
      <rect x="26" y="22" width="68" height="54" rx="4" fill="#fffaf0" {...S} />
      <path d="M36 66 Q48 40 60 58 Q72 34 84 62" fill="none" stroke="#b197fc" strokeWidth="5" strokeLinecap="round" />
      <circle cx="78" cy="36" r="8" fill="#ffd166" {...S} strokeWidth={2.5} />
      <path d="M20 92 Q12 104 26 108 Q44 112 42 98 Q40 88 30 90 Z" fill="#f5d6a8" {...S} strokeWidth={3} />
      <circle cx="26" cy="99" r="3" fill="#4fc3f7" />
      <circle cx="34" cy="104" r="3" fill="#b197fc" />
    </g>
  )
}

function ChestArt() {
  return (
    <g>
      <path d="M22 40 L30 18 H90 L98 40" fill="#e08e45" {...S} />
      <circle cx="46" cy="40" r="12" fill="#4fc3f7" {...S} strokeWidth={3} />
      <path d="M72 26 l4 9 10 1 -7 7 2 10 -9 -5 -9 5 2 -10 -7 -7 10 -1 Z" fill="#ffd166" {...S} strokeWidth={2.5} />
      <rect x="18" y="44" width="84" height="62" rx="8" fill="#f2a65a" {...S} />
      <path d="M18 66 H102" {...S} strokeWidth={3} />
      <rect x="52" y="58" width="16" height="16" rx="3" fill="#ffd166" {...S} strokeWidth={3} />
    </g>
  )
}

function MailArt() {
  return (
    <g>
      <path d="M56 112 V70 H64 V112" fill="#8a5a2b" {...S} />
      <path d="M22 72 V46 Q22 24 44 24 H84 Q98 24 98 46 V72 Z" fill="#4fa3e0" {...S} />
      <path d="M44 24 Q66 24 66 46 V72" fill="none" {...S} strokeWidth={3} />
      <path d="M98 40 H108 V22 H98" fill="#b197fc" {...S} strokeWidth={3} />
      <rect x="28" y="12" width="30" height="20" rx="2" fill="#fffaf0" {...S} strokeWidth={3} transform="rotate(-12 43 22)" />
      <path d="M40 22 q3 -5 6 0 q3 -5 6 0 l-6 6 Z" fill="#b197fc" transform="rotate(-12 43 22)" />
    </g>
  )
}

function WindowArt() {
  return (
    <g>
      <rect x="22" y="16" width="76" height="76" rx="6" fill="#bfe9ff" {...S} />
      <circle cx="80" cy="34" r="9" fill="#ffd166" {...S} strokeWidth={2.5} />
      <path d="M32 60 q6 -10 14 -4 q6 -8 14 0 q8 0 6 8 H32 Z" fill="#fff" {...S} strokeWidth={2.5} />
      <path d="M60 16 V92 M22 54 H98" {...S} strokeWidth={4} />
      <path d="M14 12 Q30 50 18 96 L30 96 Q40 50 30 12 Z M106 12 Q90 50 102 96 L90 96 Q80 50 90 12 Z" fill="#ffa94d" {...S} strokeWidth={3} />
      <path d="M16 96 H104" {...S} strokeWidth={5} />
    </g>
  )
}

function WallArt() {
  return (
    <g>
      <rect x="20" y="18" width="80" height="80" rx="6" fill="#ffd166" {...S} />
      <rect x="30" y="28" width="60" height="60" rx="3" fill="#fffaf0" {...S} strokeWidth={3} />
      <path d="M40 76 V58 L60 42 L80 58 V76 Z" fill="#ffa94d" {...S} strokeWidth={3} />
      <rect x="54" y="62" width="12" height="14" fill="#8f6ad8" {...S} strokeWidth={2.5} />
      <circle cx="98" cy="22" r="8" fill="#80d8ff" {...S} strokeWidth={2.5} />
      <path d="M16 96 l6 -12 6 12 Z" fill="#b9f6ca" {...S} strokeWidth={2.5} />
    </g>
  )
}

function WardrobeArt() {
  return (
    <g>
      <rect x="22" y="10" width="76" height="98" rx="8" fill="#5cc6a8" {...S} />
      <path d="M60 14 V104" {...S} strokeWidth={3} />
      <circle cx="54" cy="58" r="3.5" fill="#ffd166" {...S} strokeWidth={2} />
      <circle cx="66" cy="58" r="3.5" fill="#ffd166" {...S} strokeWidth={2} />
      <path d="M86 30 Q104 40 96 64 L80 64 Q84 44 74 36" fill="#b197fc" {...S} strokeWidth={3} />
      <path d="M30 108 V116 M90 108 V116" {...S} />
    </g>
  )
}

/* ---------- the Easel: finger paint on this device. Nothing is uploaded or kept. ---------- */

const PAINTS = ['#2a2440', '#faa2c1', '#ffa94d', '#ffd166', '#69db7c', '#4fc3f7', '#9775fa', '#ffffff'] as const

function Easel() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [paint, setPaint] = useState<string>(PAINTS[1])

  const ctx = () => {
    const c = canvasRef.current
    return c ? c.getContext('2d') : null
  }
  const clear = useCallback(() => {
    const c = canvasRef.current
    const g = c ? c.getContext('2d') : null
    if (!c || !g) return
    g.fillStyle = '#fffaf0'
    g.fillRect(0, 0, c.width, c.height)
  }, [])
  useEffect(() => { clear() }, [clear])

  const at = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const sx = r.width ? e.currentTarget.width / r.width : 1
    const sy = r.height ? e.currentTarget.height / r.height : 1
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy }
  }
  const stroke = (to: { x: number; y: number }) => {
    const g = ctx()
    const from = last.current ?? to
    if (g) {
      g.strokeStyle = paint
      g.lineWidth = 14
      g.lineCap = 'round'
      g.lineJoin = 'round'
      g.beginPath()
      g.moveTo(from.x, from.y)
      g.lineTo(to.x, to.y)
      g.stroke()
    }
    last.current = to
  }

  return (
    <div data-testid="easel" style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
      <canvas ref={canvasRef} data-testid="easel-canvas" width={720} height={540} aria-label="Paint here with your finger"
        style={{ width: '100%', maxWidth: 560, aspectRatio: '4 / 3', borderRadius: 20, border: `4px solid ${INK}`, background: '#fffaf0', touchAction: 'none' }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); last.current = null; stroke(at(e)) }}
        onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') { if (last.current) stroke(at(e)) } }}
        onPointerUp={() => { last.current = null }}
        onPointerLeave={() => { last.current = null }} />
      <div role="radiogroup" aria-label="Paint colours" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
        {PAINTS.map((p) => (
          <button key={p} type="button" role="radio" aria-checked={paint === p} aria-label={`paint ${p}`}
            data-testid={`paint-${p.slice(1)}`} onClick={() => setPaint(p)}
            style={{
              width: 56, height: 56, borderRadius: '50%', background: p, cursor: 'pointer',
              border: `4px solid ${INK}`, boxShadow: paint === p ? `0 0 0 5px #ffd166` : 'none',
            }} />
        ))}
      </div>
      <button type="button" className="kc-obj" data-testid="easel-clear" onClick={clear} style={{ ...PILL, background: '#fffaf0' }}>Start over</button>
      <div style={{ fontSize: 17, color: C.dim }}>Your painting stays on this screen.</div>
    </div>
  )
}
