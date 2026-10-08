/**
 * Undo/redo for one or more <canvas> elements, stored as dirty-rectangle patches.
 *
 * Each tracked canvas keeps a hidden "shadow" copy of its last committed state. After an
 * edit, commit(key, rect) reads the before-pixels from the shadow and the after-pixels from
 * the live canvas for just that rectangle, so a brush stroke on a 4096² mask costs the bytes
 * of the stroke, not 64 MB per step. rollback() restores a rectangle from the shadow (a
 * stroke the gesture layer cancelled, e.g. the first finger of a pinch).
 */

import { PatchStack, type PatchStackOptions } from './history'
import type { Rect } from './stroke'

interface Patch {
  key: string
  rect: Rect
  before: ImageData
  after: ImageData
}

interface Tracked {
  live: HTMLCanvasElement
  shadow: HTMLCanvasElement
}

export class CanvasHistory {
  private readonly stack: PatchStack<Patch>
  private readonly tracked = new Map<string, Tracked>()
  private readonly listeners = new Set<() => void>()

  constructor(opts: PatchStackOptions = {}) {
    this.stack = new PatchStack<Patch>(opts)
  }

  get canUndo(): boolean { return this.stack.canUndo }
  get canRedo(): boolean { return this.stack.canRedo }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private emit(): void { for (const fn of this.listeners) fn() }

  /** Start tracking `live` under `key` (or re-sync it after a resize/reload). Clears history for it. */
  track(key: string, live: HTMLCanvasElement): void {
    const prev = this.tracked.get(key)
    const shadow = prev?.shadow ?? live.ownerDocument.createElement('canvas')
    shadow.width = live.width
    shadow.height = live.height
    const sctx = shadow.getContext('2d')
    if (sctx && live.width > 0 && live.height > 0) {
      sctx.clearRect(0, 0, shadow.width, shadow.height)
      sctx.drawImage(live, 0, 0)
    }
    this.tracked.set(key, { live, shadow })
    // Patches recorded against the old size cannot be replayed onto the new one.
    this.stack.clear()
    this.emit()
  }

  /** Record the change made to `key` inside `rect` (default: the whole canvas). */
  commit(key: string, rect?: Rect | null): void {
    const t = this.tracked.get(key)
    if (!t) return
    const r = clip(rect ?? { x: 0, y: 0, w: t.live.width, h: t.live.height }, t.live)
    if (!r) return
    const lctx = t.live.getContext('2d')
    const sctx = t.shadow.getContext('2d')
    if (!lctx || !sctx) return
    const before = sctx.getImageData(r.x, r.y, r.w, r.h)
    const after = lctx.getImageData(r.x, r.y, r.w, r.h)
    sctx.putImageData(after, r.x, r.y)
    this.stack.push({ key, rect: r, before, after }, before.data.byteLength + after.data.byteLength)
    this.emit()
  }

  /** Throw away uncommitted pixels in `rect` (default: the whole canvas). */
  rollback(key: string, rect?: Rect | null): void {
    const t = this.tracked.get(key)
    if (!t) return
    const r = clip(rect ?? { x: 0, y: 0, w: t.live.width, h: t.live.height }, t.live)
    if (!r) return
    const lctx = t.live.getContext('2d')
    const sctx = t.shadow.getContext('2d')
    if (!lctx || !sctx) return
    lctx.putImageData(sctx.getImageData(r.x, r.y, r.w, r.h), r.x, r.y)
  }

  /** Revert the last change; returns the key of the canvas it touched. */
  undo(): string | null {
    const p = this.stack.undo()
    if (!p) return null
    this.apply(p, p.before)
    this.emit()
    return p.key
  }

  redo(): string | null {
    const p = this.stack.redo()
    if (!p) return null
    this.apply(p, p.after)
    this.emit()
    return p.key
  }

  private apply(p: Patch, data: ImageData): void {
    const t = this.tracked.get(p.key)
    if (!t) return
    t.live.getContext('2d')?.putImageData(data, p.rect.x, p.rect.y)
    t.shadow.getContext('2d')?.putImageData(data, p.rect.x, p.rect.y)
  }
}

function clip(r: Rect, c: { width: number; height: number }): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x))
  const y0 = Math.max(0, Math.floor(r.y))
  const x1 = Math.min(c.width, Math.ceil(r.x + r.w))
  const y1 = Math.min(c.height, Math.ceil(r.y + r.h))
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
