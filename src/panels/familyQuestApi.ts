/**
 * Family Quest: the pure half of the panel (parsing, word taps, turn words). No React, so
 * the jest suite pins it directly. Server: Hearth /api/v1/tutor/{family,me}/adventure/*
 * (lib/hearth/family_quest_router.py) through the host app's tutor proxy.
 *
 * Only named, expected fields of a server reply are ever kept: an unexpected field (a link,
 * a remote image, a score) never reaches the screen.
 */

export type QuestState = 'lobby' | 'playing' | 'paused' | 'ended'

export interface QuestSprite { name?: string; species?: string; stage?: string; stage_word?: string; level?: number; snapshot?: string | null }
export interface QuestPlayer { pid: string; kind: 'guardian' | 'child'; name: string; sprite: QuestSprite | null; joined: boolean }
export interface QuestScene { n: number; text: string; choices: string[] }
export interface QuestLogRow { n: number; kind: string; pid: string; text: string; roll?: { value: number; word: string } }
export interface QuestRoll { pid: string; value: number; word: string }
export interface QuestAlert { kind: string; pid: string; name: string; told: boolean; seen: boolean }
export interface QuestView {
  sid: string
  version: number
  state: QuestState
  title: string
  art: string
  players: QuestPlayer[]
  me: string
  turnPid: string | null
  scene: QuestScene | null
  log: QuestLogRow[]
  pendingRoll: QuestRoll | null
  host: boolean
  alerts: QuestAlert[]
}
export interface QuestTemplate { id: string; title: string; art: string; blurb: string }
export interface QuestKid { lid: string; name: string; grade?: number }
export interface QuestInvite { sid: string; title: string; art: string; state: QuestState; host: string; joined: boolean }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const STATES: QuestState[] = ['lobby', 'playing', 'paused', 'ended']
const state = (v: unknown): QuestState => (STATES.includes(v as QuestState) ? (v as QuestState) : 'lobby')

function asSprite(v: unknown): QuestSprite | null {
  const o = obj(v)
  if (!str(o.name)) return null
  const snap = str(o.snapshot)
  return { name: str(o.name), species: str(o.species) || undefined, stage: str(o.stage) || undefined,
    stage_word: str(o.stage_word) || undefined, level: num(o.level, 1),
    snapshot: /^[A-Za-z0-9_-]{1,80}$/.test(snap) ? snap : null }
}

function asRoll(v: unknown): QuestRoll | null {
  const o = obj(v)
  const value = num(o.value)
  return value >= 1 && value <= 6 ? { pid: str(o.pid), value, word: str(o.word) } : null
}

/** One state reply, cleaned; null when it is not a quest at all. */
export function asQuestView(raw: unknown): QuestView | null {
  const o = obj(raw)
  const sid = str(o.sid)
  if (!/^fq_[a-f0-9]{16}$/.test(sid)) return null
  const players = (Array.isArray(o.players) ? o.players : []).map((p) => {
    const q = obj(p)
    return { pid: str(q.pid), kind: q.kind === 'guardian' ? 'guardian' : 'child', name: str(q.name, 'Hero'),
      sprite: asSprite(q.sprite), joined: q.joined === true } as QuestPlayer
  }).filter((p) => p.pid)
  const sc = obj(o.scene)
  const scene = str(sc.text) ? { n: num(sc.n), text: str(sc.text),
    choices: (Array.isArray(sc.choices) ? sc.choices : []).filter((c): c is string => typeof c === 'string').slice(0, 3) } : null
  const log = (Array.isArray(o.log) ? o.log : []).map((r) => {
    const q = obj(r)
    const roll = asRoll(q.roll)
    return { n: num(q.n), kind: str(q.kind), pid: str(q.pid), text: str(q.text), ...(roll ? { roll: { value: roll.value, word: roll.word } } : {}) }
  }).filter((r) => r.text)
  const alerts = (Array.isArray(o.alerts) ? o.alerts : []).map((a) => {
    const q = obj(a)
    return { kind: str(q.kind), pid: str(q.pid), name: str(q.name, 'A child'), told: q.told === true, seen: q.seen === true }
  })
  return { sid, version: num(o.version), state: state(o.state), title: str(o.title, 'Our Adventure'),
    art: str(o.art, 'book'), players, me: str(o.me), turnPid: str(o.turn_pid) || null, scene, log,
    pendingRoll: asRoll(o.pending_roll), host: o.host === true, alerts }
}

export function asTemplates(raw: unknown): QuestTemplate[] {
  return (Array.isArray(obj(raw).templates) ? (obj(raw).templates as unknown[]) : []).map((t) => {
    const q = obj(t)
    return { id: str(q.id), title: str(q.title), art: str(q.art, 'book'), blurb: str(q.blurb) }
  }).filter((t) => t.id && t.title)
}

export function asKids(raw: unknown): QuestKid[] {
  return (Array.isArray(obj(raw).kids) ? (obj(raw).kids as unknown[]) : []).map((k) => {
    const q = obj(k)
    return { lid: str(q.lid), name: str(q.name, 'Kid'), grade: num(q.grade) || undefined }
  }).filter((k) => k.lid)
}

/** Children a connected family shared with the host's (GET /family/adventure ``cousins``):
 *  a first name and an opaque per-connection id, never a learner id. */
export interface QuestCousins { connection: string; family: string; kids: Array<{ kid: string; name: string }> }

export function asCousins(raw: unknown): QuestCousins[] {
  return (Array.isArray(obj(raw).cousins) ? (obj(raw).cousins as unknown[]) : []).map((c) => {
    const q = obj(c)
    const kids = (Array.isArray(q.kids) ? (q.kids as unknown[]) : []).map((k) => {
      const o = obj(k)
      return { kid: str(o.kid), name: str(o.name, 'Cousin') }
    }).filter((k) => k.kid)
    return { connection: str(q.connection), family: str(q.family, 'Family'), kids }
  }).filter((c) => c.connection && c.kids.length)
}

export function asInvites(raw: unknown): QuestInvite[] {
  return (Array.isArray(obj(raw).sessions) ? (obj(raw).sessions as unknown[]) : []).map((s) => {
    const q = obj(s)
    return { sid: str(q.sid), title: str(q.title, 'An adventure'), art: str(q.art, 'book'), state: state(q.state),
      host: str(q.host, 'Your grown-up'), joined: q.joined === true }
  }).filter((s) => /^fq_[a-f0-9]{16}$/.test(s.sid))
}

/** The scene split into tappable words (punctuation stays on the word it follows). */
export function sceneWords(text: string): Array<{ w: string; say: string }> {
  return text.split(/\s+/).filter(Boolean).map((w) => ({ w, say: w.replace(/[^A-Za-z']/g, '') }))
}

export function whoseTurn(v: QuestView): QuestPlayer | null {
  return v.players.find((p) => p.pid === v.turnPid) || null
}

export function isMyTurn(v: QuestView): boolean {
  return v.state === 'playing' && !!v.turnPid && v.turnPid === v.me
}

/** The line under the scene. Never a countdown, a score or "hurry". */
export function turnLine(v: QuestView): string {
  if (v.state === 'lobby') return v.host ? 'Waiting for the heroes to join.' : 'Waiting for the story to start.'
  if (v.state === 'paused') return 'The story is taking a little break.'
  if (v.state === 'ended') return 'The End. Thank you for playing!'
  if (isMyTurn(v)) return 'Your turn! What do you do?'
  const p = whoseTurn(v)
  return p ? `It's ${p.name}'s turn.` : 'Listen to the story.'
}

/** A child's own error words for an HTTP refusal (never a code). */
export function sayFor(status: number, detail: unknown): string {
  const d = obj(obj(detail).detail)
  const said = str(d.say) || str(obj(detail).say)
  if (said) return said
  if (status === 409) return "It's someone else's turn."
  if (status === 423) return 'Aither is resting right now.'
  if (status === 404) return 'That story is not here.'
  return "Let's try that again in a moment."
}

/** Dice faces as pips (row, col on a 3x3 grid). */
export const DIE_PIPS: Record<number, Array<[number, number]>> = {
  1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]], 5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
}
