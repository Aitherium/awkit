'use client'

/**
 * useDrawingSurface — one hook for pen, finger and mouse input on a drawing surface.
 *
 * Attach it to the VIEWPORT element (the untransformed box the user touches) and give it the
 * CONTENT element (the picture + canvases that zoom and pan). It:
 *  - routes each pointer through the pure gesture reducer (gestures.ts): pen = ink, fingers
 *    = pan/pinch once a pen is seen, quick two/three-finger taps = undo/redo;
 *  - expands coalesced events (every pen sample, not one per frame), smooths them, batches
 *    them per animation frame, and hands predicted samples to a preview callback;
 *  - writes the view transform straight to the content element (no React render per move);
 *  - turns off the browser's own touch behaviour on the viewport only: touch-action none,
 *    no text selection, no iOS callout or double-tap zoom, no context menu, no rubber-band.
 *
 * Samples are in client coordinates; map them with clientToCanvas() against the canvas's
 * getBoundingClientRect(), which already includes the zoom.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

import { initialGesture, reduceGesture, setFingerDraws as setFingerPref, viewPointers, type GestureAction, type GestureInput, type GestureMode, type GestureState } from './gestures'
import { expandCoalesced, expandPredicted, pointerKind, Smoother, toSample, type StrokeSample } from './stroke'
import { clampView, IDENTITY_VIEW, panBy, pinch, viewTransform, zoomAt, DEFAULT_LIMITS, type View, type ViewLimits } from './view'

export interface DrawingSurfaceOptions {
  /** false = pointers only move the view (e.g. no image loaded). Default true. */
  enabled?: boolean
  /** true = every pointer pans (a "move" / hand tool), nothing draws. Default false. */
  primaryPans?: boolean
  limits?: ViewLimits
  /** Position/pressure smoothing 0..0.9. Default 0.3. */
  smoothing?: number
  onStrokeStart?: (first: StrokeSample) => void
  /** Committed samples, smoothed, batched once per animation frame. */
  onStrokeSamples?: (samples: StrokeSample[]) => void
  /** The browser's predicted samples for the current frame ([] clears the preview). */
  onStrokePreview?: (predicted: StrokeSample[]) => void
  onStrokeEnd?: () => void
  /** The stroke must be thrown away (it was the first finger of a pinch, or a palm). */
  onStrokeCancel?: () => void
  onUndo?: () => void
  onRedo?: () => void
}

export interface DrawingSurface {
  view: View
  setView: (v: View) => void
  resetView: () => void
  /** Zoom about the viewport centre. */
  zoomBy: (factor: number) => void
  penSeen: boolean
  fingerDraws: boolean
  /** true/false = the user's choice; null = automatic (fingers draw until a pen is seen). */
  setFingerDraws: (v: boolean | null) => void
  mode: GestureMode
}

type ViewportEl = HTMLElement

export function useDrawingSurface(
  viewportRef: RefObject<ViewportEl | null>,
  contentRef: RefObject<HTMLElement | null>,
  options: DrawingSurfaceOptions = {},
): DrawingSurface {
  const opts = useRef(options)
  // Listeners read the latest options through this ref (updated before any event can fire).
  useIsoLayoutEffect(() => { opts.current = options })

  const gesture = useRef<GestureState>(initialGesture())
  const viewRef = useRef<View>(IDENTITY_VIEW)
  const [view, setViewState] = useState<View>(IDENTITY_VIEW)
  const [penSeen, setPenSeen] = useState(false)
  const [fingerDraws, setFingerDrawsState] = useState(true)
  const [mode, setMode] = useState<GestureMode>('idle')

  const pending = useRef<StrokeSample[]>([])
  const predicted = useRef<StrokeSample[] | null>(null)
  const frame = useRef<number | null>(null)
  const viewFrame = useRef<number | null>(null)
  const smoother = useRef(new Smoother(options.smoothing ?? 0.3))
  const lastSample = useRef<StrokeSample | null>(null)

  const limits = () => opts.current.limits ?? DEFAULT_LIMITS

  /** Content origin inside the viewport at the identity view (layout position). */
  const contentOrigin = useCallback((): { x: number; y: number } => {
    const vp = viewportRef.current
    const ct = contentRef.current
    if (!vp || !ct) return { x: 0, y: 0 }
    const a = vp.getBoundingClientRect()
    const b = ct.getBoundingClientRect()
    const v = viewRef.current
    return { x: b.left - a.left - v.x, y: b.top - a.top - v.y }
  }, [viewportRef, contentRef])

  const applyView = useCallback((next: View, commit = false) => {
    const vp = viewportRef.current
    const ct = contentRef.current
    let v = next
    if (vp && ct) {
      const o = contentOrigin()
      const shifted = clampView({ ...v, x: v.x + o.x, y: v.y + o.y }, { w: ct.offsetWidth, h: ct.offsetHeight }, { w: vp.clientWidth, h: vp.clientHeight })
      v = { scale: shifted.scale, x: shifted.x - o.x, y: shifted.y - o.y }
    }
    viewRef.current = v
    if (ct) {
      ct.style.transformOrigin = '0 0'
      ct.style.transform = v.scale === 1 && v.x === 0 && v.y === 0 ? '' : viewTransform(v)
    }
    if (commit) {
      if (viewFrame.current !== null) { cancelFrame(viewFrame.current); viewFrame.current = null }
      setViewState(v)
    } else if (viewFrame.current === null) {
      viewFrame.current = requestFrame(() => { viewFrame.current = null; setViewState(viewRef.current) })
    }
  }, [viewportRef, contentRef, contentOrigin])

  const flush = useCallback(() => {
    frame.current = null
    if (pending.current.length > 0) {
      const batch = pending.current
      pending.current = []
      opts.current.onStrokeSamples?.(batch)
    }
    if (predicted.current) {
      const p = predicted.current
      predicted.current = null
      opts.current.onStrokePreview?.(p)
    }
  }, [])

  const schedule = useCallback(() => {
    if (frame.current === null) frame.current = requestFrame(flush)
  }, [flush])

  const dropPending = () => {
    if (frame.current !== null) { cancelFrame(frame.current); frame.current = null }
    pending.current = []
    predicted.current = null
  }

  // The viewport element can be replaced (a conditional render); re-bind when it is.
  const [el, setEl] = useState<ViewportEl | null>(null)
  useIsoLayoutEffect(() => {
    if (viewportRef.current !== el) setEl(viewportRef.current)
  })

  useEffect(() => {
    if (!el) return

    const style = el.style as CSSStyleDeclaration & Record<string, string>
    const saved = {
      touchAction: style.touchAction, userSelect: style.userSelect, webkitUserSelect: style.webkitUserSelect,
      webkitTouchCallout: style.webkitTouchCallout, webkitTapHighlightColor: style.webkitTapHighlightColor,
      overscrollBehavior: style.overscrollBehavior,
    }
    style.touchAction = 'none'
    style.userSelect = 'none'
    style.webkitUserSelect = 'none'
    style.webkitTouchCallout = 'none'
    style.webkitTapHighlightColor = 'transparent'
    style.overscrollBehavior = 'contain'

    const rel = (x: number, y: number) => {
      const r = el.getBoundingClientRect()
      const o = contentOrigin()
      return { x: x - r.left - o.x, y: y - r.top - o.y }
    }

    const syncFlags = (s: GestureState) => {
      setPenSeen(s.penSeen)
      setFingerDrawsState(s.fingerDraws)
      setMode(s.mode)
    }

    const run = (input: GestureInput, e: PointerEvent): GestureAction[] => {
      const before = gesture.current
      const beforePts = viewPointers(before).map(p => rel(p.x, p.y))
      const beforeIds = Object.keys(before.viewers).map(Number).sort((a, b) => a - b).slice(0, 2)
      const { state, actions } = reduceGesture(before, input)
      gesture.current = state
      for (const a of actions) {
        switch (a.type) {
          case 'pen-seen': break
          case 'stroke-start': {
            try { el.setPointerCapture(e.pointerId) } catch { /* synthetic or already released */ }
            smoother.current.strength = opts.current.smoothing ?? 0.3
            smoother.current.reset()
            const first = smoother.current.push(toSample(e))
            lastSample.current = first
            pending.current = []
            opts.current.onStrokeStart?.(first)
            break
          }
          case 'stroke-move': {
            for (const s of expandCoalesced(e)) {
              const sm = smoother.current.push(s)
              lastSample.current = sm
              pending.current.push(sm)
            }
            predicted.current = expandPredicted(e)
            schedule()
            break
          }
          case 'stroke-end': {
            // Close the smoothing lag: the stroke ends where the pointer lifted.
            const last = lastSample.current
            if (last && input.kind === 'up') {
              const raw = toSample(e)
              if (Math.hypot(raw.x - last.x, raw.y - last.y) > 0.5) pending.current.push({ ...raw, pressure: last.pressure })
            }
            predicted.current = []
            if (frame.current !== null) { cancelFrame(frame.current); frame.current = null }
            flush()
            lastSample.current = null
            opts.current.onStrokeEnd?.()
            break
          }
          case 'stroke-cancel': {
            dropPending()
            lastSample.current = null
            opts.current.onStrokePreview?.([])
            opts.current.onStrokeCancel?.()
            break
          }
          case 'view-start': {
            try { el.setPointerCapture(e.pointerId) } catch { /* ignore */ }
            break
          }
          case 'view-move': {
            const afterIds = Object.keys(state.viewers).map(Number).sort((a, b) => a - b).slice(0, 2)
            const samePair = afterIds.length === beforeIds.length && afterIds.every((id, i) => id === beforeIds[i])
            if (!samePair || input.kind !== 'move') break
            const afterPts = viewPointers(state).map(p => rel(p.x, p.y))
            if (afterPts.length === 2) {
              applyView(pinch(viewRef.current, beforePts[0], beforePts[1], afterPts[0], afterPts[1], limits()))
            } else if (afterPts.length === 1) {
              applyView(panBy(viewRef.current, afterPts[0].x - beforePts[0].x, afterPts[0].y - beforePts[0].y))
            }
            break
          }
          case 'view-end': applyView(viewRef.current, true); break
          case 'undo': opts.current.onUndo?.(); break
          case 'redo': opts.current.onRedo?.(); break
        }
      }
      if (state.penSeen !== before.penSeen || state.fingerDraws !== before.fingerDraws || state.mode !== before.mode) syncFlags(state)
      return actions
    }

    const input = (kind: GestureInput['kind'], e: PointerEvent): GestureInput => ({
      kind, id: e.pointerId, type: pointerKind(e.pointerType), x: e.clientX, y: e.clientY, t: e.timeStamp, button: e.button,
    })

    const onDown = (e: PointerEvent) => {
      const enabled = opts.current.enabled !== false
      const hand = opts.current.primaryPans === true
      if (hand && e.button !== 0 && e.button !== 1) return
      if (!enabled || hand) {
        // Brush off (or the hand tool): fingers and the middle button still move the view,
        // and with the hand tool so do the pen and the main mouse button.
        if (!hand && pointerKind(e.pointerType) !== 'touch' && e.button !== 1) return
        const keep = gesture.current.fingerDraws
        gesture.current = { ...gesture.current, fingerDraws: false }
        const asView: GestureInput = hand ? { ...input('down', e), type: 'touch' } : input('down', e)
        run(asView, e)
        gesture.current = { ...gesture.current, fingerDraws: keep }
      } else {
        run(input('down', e), e)
      }
      e.preventDefault()
    }
    const onMove = (e: PointerEvent) => {
      const g = gesture.current
      if (g.drawId !== e.pointerId && !g.viewers[e.pointerId]) return
      run(input('move', e), e)
      e.preventDefault()
    }
    const onUp = (e: PointerEvent) => {
      const g = gesture.current
      if (g.drawId !== e.pointerId && !g.viewers[e.pointerId]) return
      run(input('up', e), e)
    }
    const onCancel = (e: PointerEvent) => {
      const g = gesture.current
      if (g.drawId !== e.pointerId && !g.viewers[e.pointerId]) return
      run(input('cancel', e), e)
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
      const at = rel(e.clientX, e.clientY)
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch arrives as ctrl+wheel in Chromium and Firefox.
        applyView(zoomAt(viewRef.current, viewRef.current.scale * Math.exp((-e.deltaY * unit) / 200), at, limits()), true)
      } else {
        applyView(panBy(viewRef.current, -e.deltaX * unit, -e.deltaY * unit), true)
      }
    }

    // Safari trackpad / iOS pinch arrives as non-standard GestureEvents.
    let gestureBase: View | null = null
    const onGestureStart = (e: Event) => { e.preventDefault(); gestureBase = viewRef.current }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const g = e as Event & { scale?: number; clientX?: number; clientY?: number }
      if (!gestureBase || typeof g.scale !== 'number') return
      // Pointer-driven pinch already handles touch screens; this is the trackpad path.
      if (Object.keys(gesture.current.viewers).length > 0) return
      const r = el.getBoundingClientRect()
      const at = rel(g.clientX ?? r.left + r.width / 2, g.clientY ?? r.top + r.height / 2)
      applyView(zoomAt(gestureBase, gestureBase.scale * g.scale, at, limits()), true)
    }
    const onGestureEnd = (e: Event) => { e.preventDefault(); gestureBase = null }

    const prevent = (e: Event) => { if (e.cancelable) e.preventDefault() }

    const nonPassive = { passive: false } as AddEventListenerOptions
    el.addEventListener('pointerdown', onDown, nonPassive)
    el.addEventListener('pointermove', onMove, nonPassive)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onCancel)
    el.addEventListener('lostpointercapture', onCancel as EventListener)
    el.addEventListener('wheel', onWheel, nonPassive)
    el.addEventListener('gesturestart', onGestureStart, nonPassive)
    el.addEventListener('gesturechange', onGestureChange, nonPassive)
    el.addEventListener('gestureend', onGestureEnd, nonPassive)
    // Belt and braces for iOS: no scroll, rubber-band, double-tap zoom or callout from here.
    el.addEventListener('touchstart', prevent, nonPassive)
    el.addEventListener('touchmove', prevent, nonPassive)
    el.addEventListener('dblclick', prevent)
    el.addEventListener('contextmenu', prevent)
    el.addEventListener('selectstart', prevent)

    return () => {
      el.removeEventListener('pointerdown', onDown, nonPassive)
      el.removeEventListener('pointermove', onMove, nonPassive)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onCancel)
      el.removeEventListener('lostpointercapture', onCancel as EventListener)
      el.removeEventListener('wheel', onWheel, nonPassive)
      el.removeEventListener('gesturestart', onGestureStart, nonPassive)
      el.removeEventListener('gesturechange', onGestureChange, nonPassive)
      el.removeEventListener('gestureend', onGestureEnd, nonPassive)
      el.removeEventListener('touchstart', prevent, nonPassive)
      el.removeEventListener('touchmove', prevent, nonPassive)
      el.removeEventListener('dblclick', prevent)
      el.removeEventListener('contextmenu', prevent)
      el.removeEventListener('selectstart', prevent)
      Object.assign(style, saved)
      dropPending()
      if (viewFrame.current !== null) { cancelFrame(viewFrame.current); viewFrame.current = null }
    }
    // The listeners read options through refs; re-binding per render would drop pointer capture.
  }, [el, applyView, contentOrigin, flush, schedule])

  const setView = useCallback((v: View) => applyView(v, true), [applyView])
  const resetView = useCallback(() => applyView(IDENTITY_VIEW, true), [applyView])
  const zoomBy = useCallback((factor: number) => {
    const vp = viewportRef.current
    if (!vp) return
    const r = vp.getBoundingClientRect()
    const o = contentOrigin()
    applyView(zoomAt(viewRef.current, viewRef.current.scale * factor, { x: r.width / 2 - o.x, y: r.height / 2 - o.y }, opts.current.limits ?? DEFAULT_LIMITS), true)
  }, [viewportRef, contentOrigin, applyView])
  const setFingerDraws = useCallback((v: boolean | null) => {
    gesture.current = setFingerPref(gesture.current, v)
    setFingerDrawsState(gesture.current.fingerDraws)
  }, [])

  return { view, setView, resetView, zoomBy, penSeen, fingerDraws, setFingerDraws, mode }
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

function requestFrame(fn: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn)
  return setTimeout(fn, 16) as unknown as number
}

function cancelFrame(id: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
  else clearTimeout(id)
}
