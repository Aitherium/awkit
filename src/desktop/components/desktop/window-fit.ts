/**
 * Window geometry for the viewport the desktop is ACTUALLY on.
 *
 * Owner, 2026-10-07: "make sure apps open to appropriate screen sizes by default --
 * rough experience with AitherDesktop on mobile right now". Every geometry source in
 * this shell was authored for a roomy desktop: a widget's defaultSize, the starter
 * seed (72 + i*42), the file editor's fixed 650x500 and -- worst -- the persisted
 * session, which replays a 1600px window from the desktop onto a 412px phone.
 *
 * One pure function decides, so every way a window appears (open, restore, seed,
 * rotate, fold/unfold) goes through the same rule:
 *
 *   phone  (<= 768px)    full screen above the taskbar. DesktopWindow paints it
 *                        full-bleed with CSS insets anyway; storing the same geometry
 *                        keeps a later tablet/desktop refit starting from something sane.
 *   tablet (769-1279px)  full height, at least 70% of the width, centered.
 *   desktop              the requested size, clamped so the whole frame is reachable.
 *
 * Width, never user-agent (see useIsMobileViewport in desktop-window.tsx for why).
 * No imports on purpose: unit-testable without the shell.
 */

/** At or below this width a floating window cannot work: there is nowhere to float to. */
export const MOBILE_MAX_WIDTH = 768
/** Below this width a desktop-sized window is too big to float usefully (unfolded Fold, iPad). */
export const TABLET_MAX_WIDTH = 1279
/** The taskbar (taskbar.tsx, h-12). */
export const TASKBAR_PX = 48
/** Breathing room kept around a floating window so its frame stays grabbable. */
export const EDGE_PX = 16
/** A tablet window is at least this share of the viewport width. */
export const TABLET_MIN_SHARE = 0.7

export type ViewportClass = 'phone' | 'tablet' | 'desktop'

export interface Geometry {
  position: { x: number; y: number }
  size: { width: number; height: number }
}

export interface Viewport { width: number; height: number }

export interface FitOptions {
  /** The window's own floor (DesktopWindow defaults: 300x200). Never above the viewport. */
  minWidth?: number
  minHeight?: number
  /** 'open': choose the layout for this class. 'clamp': keep the user's geometry, only pull it into view. */
  mode?: 'open' | 'clamp'
}

export function viewportClass(width: number): ViewportClass {
  if (width <= MOBILE_MAX_WIDTH) return 'phone'
  if (width <= TABLET_MAX_WIDTH) return 'tablet'
  return 'desktop'
}

const finite = (n: unknown, fallback: number) =>
  typeof n === 'number' && Number.isFinite(n) ? n : fallback

export function fitWindowGeometry(geo: Geometry, vp: Viewport, opts: FitOptions = {}): Geometry {
  const vw = Math.max(1, Math.round(vp.width))
  const vh = Math.max(1, Math.round(vp.height))
  const usableH = Math.max(1, vh - TASKBAR_PX)
  const cls = viewportClass(vw)

  if (cls === 'phone') {
    return { position: { x: 0, y: 0 }, size: { width: vw, height: usableH } }
  }

  const maxW = Math.max(1, vw - EDGE_PX * 2)
  const maxH = Math.max(1, usableH - EDGE_PX)
  const minW = Math.min(finite(opts.minWidth, 300), maxW)
  const minH = Math.min(finite(opts.minHeight, 200), maxH)
  const clampW = (w: number) => Math.min(maxW, Math.max(minW, Math.round(w)))
  const clampH = (h: number) => Math.min(maxH, Math.max(minH, Math.round(h)))

  const reqW = finite(geo.size?.width, maxW)
  const reqH = finite(geo.size?.height, maxH)

  if (cls === 'tablet' && (opts.mode ?? 'open') === 'open') {
    const width = clampW(Math.max(reqW, vw * TABLET_MIN_SHARE))
    const height = maxH
    return {
      position: { x: Math.round((vw - width) / 2), y: Math.round((usableH - height) / 2) },
      size: { width, height },
    }
  }

  const width = clampW(reqW)
  const height = clampH(reqH)
  // Keep the WHOLE frame on screen: the title bar (drag + close) and the resize edges.
  const x = Math.min(Math.max(0, Math.round(finite(geo.position?.x, EDGE_PX))), vw - width)
  const y = Math.min(Math.max(0, Math.round(finite(geo.position?.y, EDGE_PX))), usableH - height)
  return { position: { x: Math.max(0, x), y: Math.max(0, y) }, size: { width, height } }
}

/** The live viewport, with a desktop fallback for SSR. */
export function currentViewport(): Viewport {
  if (typeof window === 'undefined') return { width: 1920, height: 1080 }
  return { width: window.innerWidth, height: window.innerHeight }
}
