import { describe, expect, it } from 'vitest'

import {
  GRACE_MS, initialGesture, reduceGesture, setFingerDraws, TAP_MS, type GestureAction, type GestureInput, type GestureState,
} from '../gestures'
import { PatchStack } from '../history'
import { brushFor, expandCoalesced, expandPredicted, growRect, normalizePressure, Smoother, stampsAlong, toSample } from '../stroke'
import { clampView, clientToCanvas, IDENTITY_VIEW, pinch, toContent, toViewport, zoomAt } from '../view'

// ── gesture helpers ──────────────────────────────────────────────────────────
function play(events: Partial<GestureInput>[], start: GestureState = initialGesture()) {
  let s = start
  const all: GestureAction[][] = []
  for (const e of events) {
    const r = reduceGesture(s, { kind: 'down', id: 1, type: 'touch', x: 0, y: 0, t: 0, button: 0, ...e } as GestureInput)
    s = r.state
    all.push(r.actions)
  }
  return { state: s, actions: all, flat: all.flat().map(a => a.type) }
}

describe('pressure', () => {
  it('mouse and touch always draw at full pressure', () => {
    expect(normalizePressure({ pointerType: 'mouse', pressure: 0.5, buttons: 1 })).toBe(1)
    expect(normalizePressure({ pointerType: 'touch', pressure: 0, buttons: 1 })).toBe(1)
    expect(normalizePressure({ pointerType: 'touch', pressure: 0.5, buttons: 1 })).toBe(1)
  })

  it('a pen keeps its own pressure, clamped', () => {
    expect(normalizePressure({ pointerType: 'pen', pressure: 0.3, buttons: 1 })).toBeCloseTo(0.3)
    expect(normalizePressure({ pointerType: 'pen', pressure: 1.7, buttons: 1 })).toBe(1)
  })

  it('a pen that is down but reports 0 draws at 0.5, not zero width', () => {
    expect(normalizePressure({ pointerType: 'pen', pressure: 0, buttons: 1 })).toBe(0.5)
    expect(normalizePressure({ pointerType: 'pen', pressure: 0, buttons: 0 })).toBe(0)
  })

  it('pressure scales the brush size; opacity stays constant unless asked', () => {
    const light = brushFor({ pressure: 0, tiltX: 0, tiltY: 0, pointerType: 'pen' }, 40)
    const hard = brushFor({ pressure: 1, tiltX: 0, tiltY: 0, pointerType: 'pen' }, 40)
    expect(light.radius).toBeCloseTo(4)
    expect(hard.radius).toBeCloseTo(20)
    expect(light.opacity).toBe(1)
    const faded = brushFor({ pressure: 0, tiltX: 0, tiltY: 0, pointerType: 'pen' }, 40, 1, { opacity: [0.3, 1] })
    expect(faded.opacity).toBeCloseTo(0.3)
    const off = brushFor({ pressure: 0.1, tiltX: 0, tiltY: 0, pointerType: 'pen' }, 40, 1, { pressure: false })
    expect(off.radius).toBeCloseTo(20)
  })

  it('tilt widens a pen only when asked', () => {
    const flat = brushFor({ pressure: 1, tiltX: 90, tiltY: 0, pointerType: 'pen' }, 20, 1, { tiltWiden: 1 })
    expect(flat.radius).toBeCloseTo(20)
    const finger = brushFor({ pressure: 1, tiltX: 90, tiltY: 0, pointerType: 'touch' }, 20, 1, { tiltWiden: 1 })
    expect(finger.radius).toBeCloseTo(10)
  })
})

describe('coalesced and predicted samples', () => {
  it('expands every coalesced sample, inheriting the pointer type', () => {
    const e = {
      clientX: 30, clientY: 30, pressure: 0.9, pointerType: 'pen', buttons: 1,
      getCoalescedEvents: () => [
        { clientX: 10, clientY: 10, pressure: 0.2 },
        { clientX: 20, clientY: 20, pressure: 0.6 },
        { clientX: 30, clientY: 30, pressure: 0.9 },
      ],
    }
    const out = expandCoalesced(e)
    expect(out.map(s => s.x)).toEqual([10, 20, 30])
    expect(out.map(s => s.pressure)).toEqual([0.2, 0.6, 0.9])
    expect(out.every(s => s.pointerType === 'pen')).toBe(true)
  })

  it('falls back to the event itself when the browser has no coalesced list', () => {
    expect(expandCoalesced({ clientX: 5, clientY: 6, pointerType: 'touch' })).toHaveLength(1)
    expect(expandCoalesced({ clientX: 5, clientY: 6, pointerType: 'mouse', getCoalescedEvents: () => [] })[0].x).toBe(5)
  })

  it('predicted samples are separate and empty when unsupported', () => {
    expect(expandPredicted({ clientX: 1, clientY: 1 })).toEqual([])
    expect(expandPredicted({ clientX: 1, clientY: 1, pointerType: 'pen', getPredictedEvents: () => [{ clientX: 9, clientY: 9, pressure: 0.4 }] })[0].x).toBe(9)
  })
})

describe('smoothing and stamping', () => {
  it('first sample passes through; later samples lag toward the input', () => {
    const sm = new Smoother(0.5)
    const a = sm.push(toSample({ clientX: 0, clientY: 0 }))
    expect(a.x).toBe(0)
    const b = sm.push(toSample({ clientX: 10, clientY: 0 }))
    expect(b.x).toBeCloseTo(5)
    sm.reset()
    expect(sm.push(toSample({ clientX: 100, clientY: 0 })).x).toBe(100)
  })

  it('a fast segment becomes evenly spaced stamps with interpolated pressure', () => {
    const { stamps, carry } = stampsAlong({ x: 0, y: 0, pressure: 0 }, { x: 100, y: 0, pressure: 1 }, 10)
    expect(stamps).toHaveLength(10)
    expect(stamps[0].x).toBeCloseTo(10)
    expect(stamps[4].pressure).toBeCloseTo(0.5)
    expect(carry).toBeCloseTo(0)
  })

  it('carries leftover distance into the next segment', () => {
    const first = stampsAlong({ x: 0, y: 0, pressure: 1 }, { x: 15, y: 0, pressure: 1 }, 10)
    expect(first.stamps.map(s => s.x)).toEqual([10])
    expect(first.carry).toBeCloseTo(5)
    const second = stampsAlong({ x: 15, y: 0, pressure: 1 }, { x: 30, y: 0, pressure: 1 }, 10, first.carry)
    expect(second.stamps.map(s => Math.round(s.x))).toEqual([20, 30])
  })

  it('growRect covers each stamp and stays inside the canvas', () => {
    let r = growRect(null, 5, 5, 4, { width: 100, height: 100 })
    expect(r).toEqual({ x: 0, y: 0, w: 10, h: 10 })
    r = growRect(r, 98, 50, 4, { width: 100, height: 100 })
    expect(r!.x + r!.w).toBe(100)
  })
})

describe('view math', () => {
  it('zoomAt keeps the anchor point fixed', () => {
    const at = { x: 120, y: 80 }
    const before = toContent(IDENTITY_VIEW, at)
    const v = zoomAt(IDENTITY_VIEW, 2, at)
    expect(v.scale).toBe(2)
    const after = toViewport(v, before)
    expect(after.x).toBeCloseTo(at.x)
    expect(after.y).toBeCloseTo(at.y)
  })

  it('pinch: spreading the fingers zooms about their midpoint, drifting pans', () => {
    const v = pinch(IDENTITY_VIEW, { x: 90, y: 100 }, { x: 110, y: 100 }, { x: 80, y: 100 }, { x: 120, y: 100 })
    expect(v.scale).toBeCloseTo(2)
    expect(toViewport(v, { x: 100, y: 100 }).x).toBeCloseTo(100)
    const moved = pinch(IDENTITY_VIEW, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 30, y: 40 }, { x: 40, y: 40 })
    expect(moved).toEqual({ scale: 1, x: 30, y: 40 })
  })

  it('pinch clamps the scale', () => {
    const v = pinch(IDENTITY_VIEW, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1000, y: 0 }, { minScale: 0.5, maxScale: 4 })
    expect(v.scale).toBe(4)
  })

  it('clampView keeps some of the picture on screen', () => {
    const v = clampView({ scale: 1, x: 5000, y: -5000 }, { w: 400, h: 300 }, { w: 400, h: 300 }, 40)
    expect(v.x).toBe(360)
    expect(v.y).toBe(-260)
  })

  it('clientToCanvas maps through the on-screen rect to canvas pixels', () => {
    const p = clientToCanvas({ x: 60, y: 30 }, { left: 10, top: 10, width: 100, height: 50 }, { width: 1000, height: 500 })
    expect(p).toEqual({ x: 500, y: 200 })
    expect(clientToCanvas({ x: 0, y: 0 }, { left: 0, top: 0, width: 0, height: 0 }, { width: 1, height: 1 })).toBeNull()
  })
})

describe('gestures: palm rejection', () => {
  it('before any pen, one finger draws', () => {
    const r = play([{ kind: 'down', id: 1, type: 'touch' }, { kind: 'move', id: 1, type: 'touch', x: 30, t: 50 }, { kind: 'up', id: 1, type: 'touch', x: 30, t: 400 }])
    expect(r.flat).toEqual(['stroke-start', 'stroke-move', 'stroke-end'])
  })

  it('once a pen is seen, a finger pans instead of drawing', () => {
    const r = play([
      { kind: 'down', id: 5, type: 'pen' }, { kind: 'up', id: 5, type: 'pen', t: 100 },
      { kind: 'down', id: 1, type: 'touch', t: 1000 }, { kind: 'move', id: 1, type: 'touch', x: 40, t: 1050 }, { kind: 'up', id: 1, type: 'touch', x: 40, t: 1500 },
    ])
    expect(r.state.penSeen).toBe(true)
    expect(r.flat).toEqual(['pen-seen', 'stroke-start', 'stroke-end', 'view-start', 'view-move', 'view-end'])
  })

  it('a palm touching down while the pen draws is ignored', () => {
    const r = play([
      { kind: 'down', id: 5, type: 'pen' },
      { kind: 'down', id: 1, type: 'touch', t: 20 }, { kind: 'move', id: 1, type: 'touch', x: 50, t: 30 },
      { kind: 'move', id: 5, type: 'pen', x: 10, t: 40 }, { kind: 'up', id: 5, type: 'pen', t: 60 },
    ])
    expect(r.flat).toEqual(['pen-seen', 'stroke-start', 'stroke-move', 'stroke-end'])
  })

  it('a pen landing on a finger stroke cancels the finger stroke (it was the palm)', () => {
    const r = play([{ kind: 'down', id: 1, type: 'touch' }, { kind: 'down', id: 5, type: 'pen', t: 30 }])
    expect(r.flat).toEqual(['stroke-start', 'pen-seen', 'stroke-cancel', 'stroke-start'])
    expect(r.state.drawId).toBe(5)
  })

  it('the user can turn finger drawing back on after a pen', () => {
    let s = play([{ kind: 'down', id: 5, type: 'pen' }, { kind: 'up', id: 5, type: 'pen', t: 10 }]).state
    s = setFingerDraws(s, true)
    expect(play([{ kind: 'down', id: 1, type: 'touch', t: 500 }], s).flat).toEqual(['stroke-start'])
    s = setFingerDraws(s, null)
    expect(s.fingerDraws).toBe(false)
  })
})

describe('gestures: pinch takeover', () => {
  it('a second finger early in a stroke cancels it and starts a pinch', () => {
    const r = play([{ kind: 'down', id: 1, type: 'touch' }, { kind: 'down', id: 2, type: 'touch', x: 50, t: GRACE_MS - 50 }])
    expect(r.flat).toEqual(['stroke-start', 'stroke-cancel', 'view-start'])
    expect(r.state.mode).toBe('view')
    expect(Object.keys(r.state.viewers)).toHaveLength(2)
  })

  it('a second finger late in a long stroke keeps the stroke', () => {
    const r = play([
      { kind: 'down', id: 1, type: 'touch' }, { kind: 'move', id: 1, type: 'touch', x: 200, t: 400 },
      { kind: 'down', id: 2, type: 'touch', x: 50, t: 500 },
    ])
    expect(r.flat).toEqual(['stroke-start', 'stroke-move', 'stroke-end', 'view-start'])
  })

  it('the pinch ends when the last finger lifts', () => {
    const r = play([
      { kind: 'down', id: 1, type: 'touch' }, { kind: 'down', id: 2, type: 'touch', x: 50, t: 10 },
      { kind: 'move', id: 2, type: 'touch', x: 150, t: 60 }, { kind: 'up', id: 2, type: 'touch', t: 400 }, { kind: 'up', id: 1, type: 'touch', t: 410 },
    ])
    expect(r.flat.slice(-3)).toEqual(['view-move', 'view-move', 'view-end'])
    expect(r.state.mode).toBe('idle')
  })
})

describe('gestures: taps', () => {
  it('a quick two-finger tap is undo', () => {
    const r = play([
      { kind: 'down', id: 1, type: 'touch' }, { kind: 'down', id: 2, type: 'touch', x: 50, t: 20 },
      { kind: 'up', id: 1, type: 'touch', t: 120 }, { kind: 'up', id: 2, type: 'touch', x: 50, t: 130 },
    ])
    expect(r.flat).toContain('undo')
    expect(r.flat).toContain('stroke-cancel')   // the first finger's dot is rolled back too
  })

  it('a quick three-finger tap is redo', () => {
    const pen = play([{ kind: 'down', id: 9, type: 'pen' }, { kind: 'up', id: 9, type: 'pen', t: 5 }]).state
    const r = play([
      { kind: 'down', id: 1, type: 'touch', t: 1000 }, { kind: 'down', id: 2, type: 'touch', x: 40, t: 1010 }, { kind: 'down', id: 3, type: 'touch', x: 80, t: 1020 },
      { kind: 'up', id: 1, type: 'touch', t: 1100 }, { kind: 'up', id: 2, type: 'touch', x: 40, t: 1105 }, { kind: 'up', id: 3, type: 'touch', x: 80, t: 1110 },
    ], pen)
    expect(r.flat).toContain('redo')
    expect(r.flat).not.toContain('undo')
  })

  it('a slow or moving two-finger touch is a pinch, not undo', () => {
    const slow = play([
      { kind: 'down', id: 1, type: 'touch' }, { kind: 'down', id: 2, type: 'touch', x: 50, t: 10 },
      { kind: 'up', id: 1, type: 'touch', t: TAP_MS + 100 }, { kind: 'up', id: 2, type: 'touch', t: TAP_MS + 110 },
    ])
    expect(slow.flat).not.toContain('undo')
    const moved = play([
      { kind: 'down', id: 1, type: 'touch' }, { kind: 'down', id: 2, type: 'touch', x: 50, t: 10 },
      { kind: 'move', id: 2, type: 'touch', x: 90, t: 40 }, { kind: 'up', id: 1, type: 'touch', t: 100 }, { kind: 'up', id: 2, type: 'touch', x: 90, t: 110 },
    ])
    expect(moved.flat).not.toContain('undo')
  })
})

describe('gestures: cancel and mouse', () => {
  it('pointercancel ends (commits) the stroke and frees the surface', () => {
    const r = play([{ kind: 'down', id: 5, type: 'pen' }, { kind: 'move', id: 5, type: 'pen', x: 10 }, { kind: 'cancel', id: 5, type: 'pen' }])
    expect(r.flat).toEqual(['pen-seen', 'stroke-start', 'stroke-move', 'stroke-end'])
    expect(r.state.mode).toBe('idle')
  })

  it('a cancelled pinch never fires undo', () => {
    const r = play([
      { kind: 'down', id: 1, type: 'touch' }, { kind: 'down', id: 2, type: 'touch', x: 50, t: 10 },
      { kind: 'cancel', id: 1, type: 'touch', t: 50 }, { kind: 'cancel', id: 2, type: 'touch', t: 60 },
    ])
    expect(r.flat).not.toContain('undo')
    expect(r.state.mode).toBe('idle')
  })

  it('left button draws, middle button pans, right button does nothing', () => {
    expect(play([{ kind: 'down', type: 'mouse', button: 0 }]).flat).toEqual(['stroke-start'])
    expect(play([{ kind: 'down', type: 'mouse', button: 1 }]).flat).toEqual(['view-start'])
    expect(play([{ kind: 'down', type: 'mouse', button: 2 }]).flat).toEqual([])
  })

  it('moves from an untracked pointer are ignored', () => {
    expect(play([{ kind: 'move', id: 42, type: 'pen' }]).flat).toEqual([])
  })
})

describe('PatchStack', () => {
  it('undo/redo walk the stack; a new entry clears redo', () => {
    const h = new PatchStack<string>()
    h.push('a', 1); h.push('b', 1)
    expect(h.undo()).toBe('b')
    expect(h.redo()).toBe('b')
    expect(h.undo()).toBe('b')
    h.push('c', 1)
    expect(h.canRedo).toBe(false)
    expect(h.undo()).toBe('c')
    expect(h.undo()).toBe('a')
    expect(h.undo()).toBeNull()
  })

  it('drops the oldest entries past the byte budget but always keeps the newest', () => {
    const h = new PatchStack<string>({ maxBytes: 100 })
    h.push('a', 60); h.push('b', 60)
    expect(h.size.undo).toBe(1)
    h.push('huge', 500)
    expect(h.size.undo).toBe(1)
    expect(h.undo()).toBe('huge')
  })

  it('respects maxEntries', () => {
    const h = new PatchStack<number>({ maxEntries: 3 })
    for (let i = 0; i < 10; i++) h.push(i, 1)
    expect(h.size.undo).toBe(3)
    expect(h.undo()).toBe(9)
  })
})
