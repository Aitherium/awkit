/**
 * Who gets a pointer: the brush, or the view. Pure reducer, no DOM, no React.
 *
 * Rules (the ones tablet painting apps converge on):
 *  - A pen always draws. Once a pen has been seen (`penSeen`, sticky), fingers stop drawing
 *    and only move the view: that is the palm rejection. The user can turn finger drawing
 *    back on (`fingerDraws`).
 *  - A mouse's main button draws; its middle button pans.
 *  - Before any pen is seen, one finger draws. A second finger landing early in that stroke
 *    (inside GRACE_MS and GRACE_PX) means the user was starting a pinch, so the stroke is
 *    rolled back (`stroke-cancel`); a later second finger ends it normally. Either way the
 *    fingers then pinch/pan.
 *  - A quick two-finger tap is undo, a three-finger tap is redo (Procreate's gestures).
 *  - pointercancel / lostpointercapture end whatever that pointer was doing; a cancelled
 *    stroke is committed, not lost.
 */

import type { PointerKind } from './stroke'

export const GRACE_MS = 200
export const GRACE_PX = 12
export const TAP_MS = 300
export const TAP_PX = 10

export type GestureMode = 'idle' | 'draw' | 'view'

export interface Tracked {
  type: PointerKind
  x: number
  y: number
  sx: number
  sy: number
  t0: number
}

export interface GestureState {
  penSeen: boolean
  /** Fingers draw (true until a pen is seen, unless the user overrides). */
  fingerDraws: boolean
  /** null = follow penSeen; true/false = the user's explicit choice. */
  fingerOverride: boolean | null
  mode: GestureMode
  drawId: number | null
  drawType: PointerKind | null
  drawT0: number
  drawTravel: number
  /** Pointers moving the view (fingers, a middle-button mouse). */
  viewers: Record<number, Tracked>
  /** Multi-finger tap candidate: alive from the first finger down until all fingers lift. */
  tap: { t0: number; max: number; moved: boolean } | null
}

export interface GestureInput {
  kind: 'down' | 'move' | 'up' | 'cancel'
  id: number
  type: PointerKind
  x: number
  y: number
  t: number
  /** MouseEvent.button on down (0 main, 1 middle, 2 secondary). */
  button?: number
}

export type GestureAction =
  | { type: 'stroke-start'; id: number }
  | { type: 'stroke-move'; id: number }
  | { type: 'stroke-end'; id: number }
  | { type: 'stroke-cancel'; id: number }
  | { type: 'view-start' }
  | { type: 'view-move' }
  | { type: 'view-end' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'pen-seen' }

export function initialGesture(): GestureState {
  return { penSeen: false, fingerDraws: true, fingerOverride: null, mode: 'idle', drawId: null, drawType: null, drawT0: 0, drawTravel: 0, viewers: {}, tap: null }
}

/** The user's choice for finger drawing (null = automatic: fingers draw until a pen shows up). */
export function setFingerDraws(s: GestureState, value: boolean | null): GestureState {
  return { ...s, fingerOverride: value, fingerDraws: value ?? !s.penSeen }
}

function touchCount(viewers: Record<number, Tracked>): number {
  let n = 0
  for (const k in viewers) if (viewers[k].type === 'touch') n++
  return n
}

export function reduceGesture(s: GestureState, ev: GestureInput): { state: GestureState; actions: GestureAction[] } {
  const actions: GestureAction[] = []
  let st: GestureState = s

  const startView = (id: number) => {
    const viewers = { ...st.viewers, [id]: { type: ev.type, x: ev.x, y: ev.y, sx: ev.x, sy: ev.y, t0: ev.t } }
    if (st.mode !== 'view') actions.push({ type: 'view-start' })
    else actions.push({ type: 'view-move' })
    st = { ...st, mode: 'view', viewers }
  }

  switch (ev.kind) {
    case 'down': {
      if (ev.type === 'pen') {
        if (!st.penSeen) {
          actions.push({ type: 'pen-seen' })
          st = { ...st, penSeen: true, fingerDraws: st.fingerOverride ?? false }
        }
        if (st.mode === 'draw' && st.drawId !== null && st.drawId !== ev.id) {
          // A finger (or palm) was drawing when the pen arrived: that was the palm.
          actions.push({ type: 'stroke-cancel', id: st.drawId })
        }
        if (st.mode === 'view') actions.push({ type: 'view-end' })
        st = { ...st, mode: 'draw', drawId: ev.id, drawType: 'pen', drawT0: ev.t, drawTravel: 0, viewers: {}, tap: null }
        actions.push({ type: 'stroke-start', id: ev.id })
        break
      }
      if (ev.type === 'mouse') {
        if (st.mode !== 'idle') break
        if (ev.button === 1) { startView(ev.id); break }
        if (ev.button !== undefined && ev.button !== 0) break
        st = { ...st, mode: 'draw', drawId: ev.id, drawType: 'mouse', drawT0: ev.t, drawTravel: 0 }
        actions.push({ type: 'stroke-start', id: ev.id })
        break
      }
      // touch
      const tap = st.tap ?? { t0: ev.t, max: 0, moved: false }
      if (st.mode === 'draw' && st.drawId !== null) {
        if (st.drawType !== 'touch' || !st.fingerDraws) {
          // A finger while the pen or mouse draws is a palm or a resting hand: ignore it.
          break
        }
        // Second finger during a finger stroke: a pinch is starting.
        const early = ev.t - st.drawT0 <= GRACE_MS && st.drawTravel <= GRACE_PX
        actions.push({ type: early ? 'stroke-cancel' : 'stroke-end', id: st.drawId })
        // The drawing finger becomes the first finger of the pinch.
        const first = st.viewers[st.drawId]
        const viewers: Record<number, Tracked> = first ? { [st.drawId]: first } : {}
        st = { ...st, mode: 'idle', drawId: null, drawType: null, viewers, tap: early ? { ...tap, max: Math.max(tap.max, 1) } : null }
        startView(ev.id)
        if (st.tap) st = { ...st, tap: { ...st.tap, max: Math.max(st.tap.max, touchCount(st.viewers)) } }
        break
      }
      if (st.mode === 'draw') break
      if (st.mode === 'idle' && st.fingerDraws) {
        // One finger draws. Track it in viewers too so a second finger can take it over.
        st = {
          ...st, mode: 'draw', drawId: ev.id, drawType: 'touch', drawT0: ev.t, drawTravel: 0,
          viewers: { [ev.id]: { type: 'touch', x: ev.x, y: ev.y, sx: ev.x, sy: ev.y, t0: ev.t } },
          tap: { ...tap, max: Math.max(tap.max, 1) },
        }
        actions.push({ type: 'stroke-start', id: ev.id })
        break
      }
      startView(ev.id)
      st = { ...st, tap: { ...tap, max: Math.max(tap.max, touchCount(st.viewers)) } }
      break
    }

    case 'move': {
      if (st.mode === 'draw' && ev.id === st.drawId) {
        const prev = st.viewers[ev.id]
        let travel = st.drawTravel
        if (prev) {
          travel = Math.max(travel, Math.hypot(ev.x - prev.sx, ev.y - prev.sy))
          st = { ...st, viewers: { ...st.viewers, [ev.id]: { ...prev, x: ev.x, y: ev.y } } }
        } else {
          travel = st.drawTravel + 1
        }
        st = { ...st, drawTravel: travel }
        if (st.tap && travel > TAP_PX) st = { ...st, tap: { ...st.tap, moved: true } }
        actions.push({ type: 'stroke-move', id: ev.id })
        break
      }
      const v = st.viewers[ev.id]
      if (st.mode === 'view' && v) {
        st = { ...st, viewers: { ...st.viewers, [ev.id]: { ...v, x: ev.x, y: ev.y } } }
        if (st.tap && Math.hypot(ev.x - v.sx, ev.y - v.sy) > TAP_PX) st = { ...st, tap: { ...st.tap, moved: true } }
        actions.push({ type: 'view-move' })
      }
      break
    }

    case 'up':
    case 'cancel': {
      if (st.mode === 'draw' && ev.id === st.drawId) {
        actions.push({ type: 'stroke-end', id: ev.id })
        const viewers = { ...st.viewers }
        delete viewers[ev.id]
        st = { ...st, mode: 'idle', drawId: null, drawType: null, viewers }
        // A one-finger stroke is never a multi-finger tap.
        st = { ...st, tap: null }
        break
      }
      const v = st.viewers[ev.id]
      if (!v) break
      const viewers = { ...st.viewers }
      delete viewers[ev.id]
      st = { ...st, viewers }
      if (Object.keys(viewers).length > 0) {
        if (st.mode === 'view') actions.push({ type: 'view-move' })
        break
      }
      if (st.mode === 'view') actions.push({ type: 'view-end' })
      const tap = st.tap
      st = { ...st, mode: 'idle', tap: null }
      if (ev.kind === 'up' && tap && !tap.moved && ev.t - tap.t0 <= TAP_MS) {
        if (tap.max === 2) actions.push({ type: 'undo' })
        else if (tap.max === 3) actions.push({ type: 'redo' })
      }
      break
    }
  }
  return { state: st, actions }
}

/** The (up to two) view pointers, in id order, for pan/pinch math. */
export function viewPointers(s: GestureState): Tracked[] {
  return Object.keys(s.viewers).map(Number).sort((a, b) => a - b).map(k => s.viewers[k]).slice(0, 2)
}
