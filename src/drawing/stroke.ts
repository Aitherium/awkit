/**
 * Stroke math: turning pointer events into brush samples. Pure: no DOM, no React.
 *
 * A pen reports real pressure, tilt and twist. A mouse and a finger do not (a finger reports
 * 0 on iOS and 0.5 on most Android builds), so they draw at a constant full pressure: a
 * finger stroke must not come out thin because the hardware cannot measure force.
 */

export type PointerKind = 'pen' | 'touch' | 'mouse'

export interface StrokeSample {
  /** Client (page) coordinates, CSS px. */
  x: number
  y: number
  /** 0..1, already normalized (see normalizePressure). */
  pressure: number
  tiltX: number
  tiltY: number
  twist: number
  /** Event timestamp, ms. */
  t: number
  pointerType: PointerKind
}

/** The PointerEvent fields this module reads, so tests can pass plain objects. */
export interface PointerLike {
  clientX: number
  clientY: number
  pressure?: number
  tiltX?: number
  tiltY?: number
  twist?: number
  timeStamp?: number
  pointerType?: string
  buttons?: number
  getCoalescedEvents?: () => PointerLike[]
  getPredictedEvents?: () => PointerLike[]
}

export function pointerKind(type: string | undefined): PointerKind {
  return type === 'pen' ? 'pen' : type === 'touch' ? 'touch' : 'mouse'
}

/**
 * A pen's own pressure, clamped to 0..1. A pen that is down but reports 0 (Windows Ink on
 * the first sample, some Wacom drivers) gets 0.5, the Pointer Events default for an active
 * button, instead of a zero-width stroke. Mouse and touch are always 1.
 */
export function normalizePressure(e: Pick<PointerLike, 'pressure' | 'pointerType' | 'buttons'>): number {
  if (pointerKind(e.pointerType) !== 'pen') return 1
  const p = typeof e.pressure === 'number' && Number.isFinite(e.pressure) ? e.pressure : 0
  if (p <= 0) return (e.buttons ?? 1) !== 0 ? 0.5 : 0
  return Math.min(1, p)
}

export function toSample(e: PointerLike): StrokeSample {
  return {
    x: e.clientX,
    y: e.clientY,
    pressure: normalizePressure(e),
    tiltX: e.tiltX ?? 0,
    tiltY: e.tiltY ?? 0,
    twist: e.twist ?? 0,
    t: e.timeStamp ?? 0,
    pointerType: pointerKind(e.pointerType),
  }
}

/**
 * Every hardware sample behind one pointermove. Browsers fire one pointermove per frame but
 * a pen (Apple Pencil: 240 Hz) reports several per frame; getCoalescedEvents() returns them.
 * A browser without it, or an empty list (Safari for a synthetic event), falls back to the
 * event itself, so a sample is never lost either way.
 */
export function expandCoalesced(e: PointerLike): StrokeSample[] {
  let list: PointerLike[] | undefined
  try { list = e.getCoalescedEvents?.() } catch { list = undefined }
  const src = list && list.length > 0 ? list : [e]
  // A coalesced entry may omit pointerType/buttons; inherit them from the parent event.
  return src.map(c => toSample({ ...pick(c), pointerType: c.pointerType || e.pointerType, buttons: c.buttons ?? e.buttons }))
}

/** Predicted samples (the browser's guess at the next few ms), for a throwaway preview only. */
export function expandPredicted(e: PointerLike): StrokeSample[] {
  let list: PointerLike[] | undefined
  try { list = e.getPredictedEvents?.() } catch { list = undefined }
  if (!list || list.length === 0) return []
  return list.map(c => toSample({ ...pick(c), pointerType: c.pointerType || e.pointerType, buttons: c.buttons ?? e.buttons }))
}

function pick(c: PointerLike): PointerLike {
  // PointerEvent fields live on the prototype, so a spread would copy nothing.
  return {
    clientX: c.clientX, clientY: c.clientY, pressure: c.pressure, tiltX: c.tiltX, tiltY: c.tiltY,
    twist: c.twist, timeStamp: c.timeStamp, pointerType: c.pointerType, buttons: c.buttons,
  }
}

export interface BrushDynamics {
  /** Pressure 0 -> min * base, pressure 1 -> max * base. Default [0.2, 1]. */
  size?: [number, number]
  /** Pressure -> opacity range; omit to keep opacity constant. */
  opacity?: [number, number]
  /** Widen a tilted pen up to this factor at 90° of tilt (a pencil laid flat shades). Default 0. */
  tiltWiden?: number
  /** false = pressure is ignored and every sample draws at full size. */
  pressure?: boolean
}

/** Radius and opacity for one sample, given the base diameter and opacity. */
export function brushFor(sample: Pick<StrokeSample, 'pressure' | 'tiltX' | 'tiltY' | 'pointerType'>, baseDiameter: number, baseOpacity = 1, dyn: BrushDynamics = {}): { radius: number; opacity: number } {
  const p = dyn.pressure === false ? 1 : Math.max(0, Math.min(1, sample.pressure))
  const [s0, s1] = dyn.size ?? [0.2, 1]
  let diameter = baseDiameter * (s0 + (s1 - s0) * p)
  if (dyn.tiltWiden && sample.pointerType === 'pen') {
    const tilt = Math.min(90, Math.hypot(sample.tiltX, sample.tiltY)) / 90
    diameter *= 1 + dyn.tiltWiden * tilt
  }
  let opacity = baseOpacity
  if (dyn.opacity) {
    const [o0, o1] = dyn.opacity
    opacity = baseOpacity * (o0 + (o1 - o0) * p)
  }
  return { radius: Math.max(0.5, diameter / 2), opacity: Math.max(0, Math.min(1, opacity)) }
}

/**
 * Light exponential smoothing of position and pressure. `strength` 0 = raw input, 0.9 =
 * heavy lag. Stateful per stroke; reset() between strokes. The first sample passes through.
 */
export class Smoother {
  private last: StrokeSample | null = null
  constructor(public strength = 0.35) {}

  reset(): void { this.last = null }

  push(s: StrokeSample): StrokeSample {
    const k = Math.max(0, Math.min(0.95, this.strength))
    if (!this.last || k === 0) {
      this.last = s
      return s
    }
    const a = 1 - k
    const out: StrokeSample = {
      ...s,
      x: this.last.x + (s.x - this.last.x) * a,
      y: this.last.y + (s.y - this.last.y) * a,
      pressure: this.last.pressure + (s.pressure - this.last.pressure) * a,
    }
    this.last = out
    return out
  }
}

export interface Stamp {
  x: number
  y: number
  pressure: number
}

/**
 * Stamps every `spacing` px along a->b (excluding a, which was already stamped), with the
 * pressure interpolated, so a fast stroke is a continuous line instead of a row of dots.
 * `carry` is the distance already travelled since the last stamp; pass back the returned
 * carry on the next segment so spacing stays even across segments.
 */
export function stampsAlong(a: Stamp, b: Stamp, spacing: number, carry = 0): { stamps: Stamp[]; carry: number } {
  const step = Math.max(0.25, spacing)
  const d = Math.hypot(b.x - a.x, b.y - a.y)
  const stamps: Stamp[] = []
  if (d === 0) return { stamps, carry }
  let at = step - carry
  // A runaway segment (a pointer warping across a 16k canvas) must not stamp forever.
  const cap = 20000
  while (at <= d && stamps.length < cap) {
    const f = at / d
    stamps.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, pressure: a.pressure + (b.pressure - a.pressure) * f })
    at += step
  }
  return { stamps, carry: d - (at - step) }
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Grow `r` (or start one) to cover a circle; integer-aligned and clipped to the canvas. */
export function growRect(r: Rect | null, cx: number, cy: number, radius: number, bounds: { width: number; height: number }): Rect | null {
  const x0 = Math.max(0, Math.floor(cx - radius - 1))
  const y0 = Math.max(0, Math.floor(cy - radius - 1))
  const x1 = Math.min(bounds.width, Math.ceil(cx + radius + 1))
  const y1 = Math.min(bounds.height, Math.ceil(cy + radius + 1))
  if (x1 <= x0 || y1 <= y0) return r
  if (!r) return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  const nx0 = Math.min(r.x, x0)
  const ny0 = Math.min(r.y, y0)
  const nx1 = Math.max(r.x + r.w, x1)
  const ny1 = Math.max(r.y + r.h, y1)
  return { x: nx0, y: ny0, w: nx1 - nx0, h: ny1 - ny0 }
}
