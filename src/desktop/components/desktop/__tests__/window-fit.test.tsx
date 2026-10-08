/**
 * Apps open at a size that fits the screen they are on (owner, 2026-10-07: "make sure
 * apps open to appropriate screen sizes by default -- rough experience with
 * AitherDesktop on mobile right now"). Pure rule in window-fit.ts; the window manager
 * applies it on every open and on every resize/rotation.
 */
import React from 'react'
import { renderHook, act } from '@testing-library/react'
import {
  fitWindowGeometry, viewportClass, TASKBAR_PX, EDGE_PX, TABLET_MIN_SHARE,
} from '../window-fit'
import { WindowManagerProvider, useWindowManager } from '../../../contexts/window-manager-context'

const desktopWin = { position: { x: 200, y: 120 }, size: { width: 1600, height: 1000 } }

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

describe('fitWindowGeometry', () => {
  it('classes the viewport by width', () => {
    expect(viewportClass(412)).toBe('phone')
    expect(viewportClass(768)).toBe('phone')
    expect(viewportClass(900)).toBe('tablet')
    expect(viewportClass(1279)).toBe('tablet')
    expect(viewportClass(1440)).toBe('desktop')
  })

  it('a phone (412x915) gets the full screen above the taskbar, whatever was asked', () => {
    expect(fitWindowGeometry(desktopWin, { width: 412, height: 915 })).toEqual({
      position: { x: 0, y: 0 },
      size: { width: 412, height: 915 - TASKBAR_PX },
    })
  })

  it('a tablet (900x1200) opens full height, >=70% width, centered, inside the viewport', () => {
    const small = fitWindowGeometry({ position: { x: 0, y: 0 }, size: { width: 400, height: 300 } }, { width: 900, height: 1200 })
    expect(small.size.width).toBe(Math.round(900 * TABLET_MIN_SHARE))
    expect(small.size.height).toBe(1200 - TASKBAR_PX - EDGE_PX)
    expect(small.position.x).toBe(Math.round((900 - small.size.width) / 2))

    const huge = fitWindowGeometry(desktopWin, { width: 900, height: 1200 })
    expect(huge.size.width).toBe(900 - EDGE_PX * 2)
    expect(huge.position.x + huge.size.width).toBeLessThanOrEqual(900)
    expect(huge.position.y + huge.size.height).toBeLessThanOrEqual(1200 - TASKBAR_PX)
  })

  it('clamp mode keeps the user geometry and only pulls it back into view', () => {
    const off = { position: { x: 1500, y: 900 }, size: { width: 600, height: 400 } }
    const fitted = fitWindowGeometry(off, { width: 1440, height: 900 }, { mode: 'clamp' })
    expect(fitted.size).toEqual({ width: 600, height: 400 })
    expect(fitted.position).toEqual({ x: 1440 - 600, y: 900 - TASKBAR_PX - 400 })
  })

  it('respects minWidth/minHeight but never exceeds the viewport', () => {
    const tiny = fitWindowGeometry({ position: { x: 10, y: 10 }, size: { width: 50, height: 50 } },
      { width: 1440, height: 900 }, { minWidth: 500, minHeight: 400, mode: 'clamp' })
    expect(tiny.size).toEqual({ width: 500, height: 400 })
    const tooBig = fitWindowGeometry({ position: { x: 10, y: 10 }, size: { width: 50, height: 50 } },
      { width: 1300, height: 700 }, { minWidth: 5000, minHeight: 5000, mode: 'clamp' })
    expect(tooBig.size.width).toBeLessThanOrEqual(1300)
    expect(tooBig.size.height).toBeLessThanOrEqual(700 - TASKBAR_PX)
  })

  it('survives garbage persisted geometry', () => {
    const bad = { position: { x: NaN, y: undefined as unknown as number }, size: { width: Infinity, height: NaN } }
    const fitted = fitWindowGeometry(bad, { width: 1440, height: 900 }, { mode: 'clamp' })
    for (const n of [fitted.position.x, fitted.position.y, fitted.size.width, fitted.size.height]) {
      expect(Number.isFinite(n)).toBe(true)
    }
  })
})

describe('WindowManagerProvider applies the fit', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => <WindowManagerProvider>{children}</WindowManagerProvider>
  const open = (wm: ReturnType<typeof useWindowManager>, id: string, geo = desktopWin) =>
    wm.openWindow({ id, title: id, icon: 'x', type: 'widget', ...geo, isMinimized: false, isMaximized: false })

  beforeEach(() => {
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { cb(0); return 0 })
  })
  afterEach(() => jest.restoreAllMocks())

  it('a persisted 1600px desktop window restored on a 412x915 phone opens full screen', () => {
    setViewport(412, 915)
    const { result } = renderHook(() => useWindowManager(), { wrapper })
    act(() => open(result.current, 'hearth'))
    act(() => open(result.current, 'learn', { position: { x: 72, y: 72 }, size: { width: 650, height: 500 } }))
    for (const w of result.current.windows) {
      expect(w.position).toEqual({ x: 0, y: 0 })
      expect(w.size).toEqual({ width: 412, height: 915 - TASKBAR_PX })
    }
  })

  it('on a 900x1200 tablet a window opens clamped inside the viewport', () => {
    setViewport(900, 1200)
    const { result } = renderHook(() => useWindowManager(), { wrapper })
    act(() => open(result.current, 'control'))
    const w = result.current.windows[0]
    expect(w.size.width).toBeLessThanOrEqual(900 - EDGE_PX * 2)
    expect(w.size.width).toBeGreaterThanOrEqual(Math.round(900 * TABLET_MIN_SHARE))
    expect(w.position.x + w.size.width).toBeLessThanOrEqual(900)
  })

  it('a resize (Fold unfolding, rotation) re-fits open windows', () => {
    setViewport(1920, 1080)
    const { result } = renderHook(() => useWindowManager(), { wrapper })
    act(() => open(result.current, 'hearth', { position: { x: 1000, y: 300 }, size: { width: 800, height: 600 } }))
    expect(result.current.windows[0].position.x).toBe(1000)

    // Down to a phone: full screen.
    act(() => { setViewport(412, 915); window.dispatchEvent(new Event('resize')) })
    expect(result.current.windows[0].size).toEqual({ width: 412, height: 915 - TASKBAR_PX })

    // Fold opens to a tablet: laid out fresh for the tablet, fully on screen.
    act(() => { setViewport(884, 1104); window.dispatchEvent(new Event('resize')) })
    const w = result.current.windows[0]
    expect(w.size.width).toBeGreaterThanOrEqual(Math.round(884 * TABLET_MIN_SHARE))
    expect(w.position.x + w.size.width).toBeLessThanOrEqual(884)
    expect(w.position.y + w.size.height).toBeLessThanOrEqual(1104 - TASKBAR_PX)
  })
})
