/**
 * View math for a zoomable, pannable drawing surface. Pure: no DOM, no React.
 *
 * The view maps a content point c to a viewport point s as `s = c * scale + (x, y)`, with
 * both measured in CSS px relative to the viewport's top-left corner. A surface renders it
 * as `transform: translate(x px, y px) scale(scale)` with `transform-origin: 0 0`, so the
 * identity view leaves the content exactly where layout put it.
 */

export interface View {
  scale: number
  x: number
  y: number
}

export interface Point {
  x: number
  y: number
}

export interface ViewLimits {
  minScale: number
  maxScale: number
}

export const IDENTITY_VIEW: View = Object.freeze({ scale: 1, x: 0, y: 0 })
export const DEFAULT_LIMITS: ViewLimits = Object.freeze({ minScale: 0.5, maxScale: 8 })

export function clampScale(scale: number, limits: ViewLimits = DEFAULT_LIMITS): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(limits.maxScale, Math.max(limits.minScale, scale))
}

/** Content point under the viewport point `s`. */
export function toContent(view: View, s: Point): Point {
  return { x: (s.x - view.x) / view.scale, y: (s.y - view.y) / view.scale }
}

/** Viewport point that shows the content point `c`. */
export function toViewport(view: View, c: Point): Point {
  return { x: c.x * view.scale + view.x, y: c.y * view.scale + view.y }
}

/** Zoom to `nextScale` keeping the viewport point `at` fixed on screen (wheel, buttons). */
export function zoomAt(view: View, nextScale: number, at: Point, limits: ViewLimits = DEFAULT_LIMITS): View {
  const scale = clampScale(nextScale, limits)
  if (scale === view.scale) return view
  const c = toContent(view, at)
  return { scale, x: at.x - c.x * scale, y: at.y - c.y * scale }
}

export function panBy(view: View, dx: number, dy: number): View {
  return { scale: view.scale, x: view.x + dx, y: view.y + dy }
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Two-finger pinch: the content point that sat under the old midpoint of (a0, b0) ends up
 * under the new midpoint of (a1, b1), and the scale follows the change in finger spread.
 * Pan and zoom in one step, so a pinch that also drifts moves the picture with the hand.
 */
export function pinch(view: View, a0: Point, b0: Point, a1: Point, b1: Point, limits: ViewLimits = DEFAULT_LIMITS): View {
  const d0 = dist(a0, b0)
  const d1 = dist(a1, b1)
  const ratio = d0 > 0.5 && d1 > 0.5 ? d1 / d0 : 1
  const scale = clampScale(view.scale * ratio, limits)
  const m0 = mid(a0, b0)
  const m1 = mid(a1, b1)
  const c = toContent(view, m0)
  return { scale, x: m1.x - c.x * scale, y: m1.y - c.y * scale }
}

/**
 * Keep at least `margin` px of the content on screen, so a fling can never lose the picture.
 * `content` is the content box at scale 1, `viewport` the visible box, both CSS px.
 */
export function clampView(view: View, content: { w: number; h: number }, viewport: { w: number; h: number }, margin = 48): View {
  const w = content.w * view.scale
  const h = content.h * view.scale
  const m = Math.max(0, margin)
  const minX = m - w
  const maxX = viewport.w - m
  const minY = m - h
  const maxY = viewport.h - m
  const x = minX > maxX ? (minX + maxX) / 2 : Math.min(maxX, Math.max(minX, view.x))
  const y = minY > maxY ? (minY + maxY) / 2 : Math.min(maxY, Math.max(minY, view.y))
  if (x === view.x && y === view.y) return view
  return { scale: view.scale, x, y }
}

/** CSS for a view. */
export function viewTransform(view: View): string {
  return `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
}

/**
 * Map a client (page) point to a canvas's own pixel grid. `rect` is the canvas's
 * getBoundingClientRect(), which already includes every CSS transform above it, so this is
 * right at any zoom.
 */
export function clientToCanvas(
  client: Point,
  rect: { left: number; top: number; width: number; height: number },
  size: { width: number; height: number },
): Point | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  return {
    x: ((client.x - rect.left) * size.width) / rect.width,
    y: ((client.y - rect.top) * size.height) / rect.height,
  }
}
