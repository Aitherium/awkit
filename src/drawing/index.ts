/**
 * awkit/drawing — pen, touch and mouse input for drawing surfaces.
 *
 * Pure core (no DOM): view.ts (zoom/pan/pinch math), stroke.ts (pressure, coalesced
 * samples, smoothing, stamp spacing), gestures.ts (palm rejection and multi-finger taps),
 * history.ts (bounded undo/redo). DOM/React: canvas-history.ts (dirty-rect canvas undo)
 * and react.ts (useDrawingSurface).
 */

export * from './view'
export * from './stroke'
export * from './gestures'
export * from './history'
export * from './canvas-history'
export * from './react'
