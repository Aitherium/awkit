'use client'

/**
 * WindowManagerContext
 * ====================
 * 
 * Manages window focus stack, z-index ordering, and Alt+Tab cycling
 * for the Desktop mode. Tracks all open "applications" (windows/widgets)
 * as first-class OS windows.
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import type { SnapZone } from '../components/desktop/window-snap-preview'
import { currentViewport, fitWindowGeometry, viewportClass } from '../components/desktop/window-fit'

// ============================================================================
// TYPES
// ============================================================================

export interface DesktopWindow {
  id: string
  title: string
  icon: string // lucide icon name
  type: 'widget' | 'app' | 'file'
  position: { x: number; y: number }
  size: { width: number; height: number }
  isMinimized: boolean
  isMaximized: boolean
  isFocused: boolean
  zIndex: number
  // For file-type windows
  filePath?: string
  fileContent?: string
  // Pre-snap state for restoring after unsnap
  preSnapState?: { x: number; y: number; width: number; height: number }
}

export interface WindowManagerContextValue {
  windows: DesktopWindow[]
  focusedWindowId: string | null
  isAltTabOpen: boolean
  altTabIndex: number

  // Window lifecycle
  openWindow: (window: Omit<DesktopWindow, 'zIndex' | 'isFocused'>) => void
  closeWindow: (id: string) => void
  focusWindow: (id: string) => void
  minimizeWindow: (id: string) => void
  maximizeWindow: (id: string) => void
  restoreWindow: (id: string) => void
  updateWindowPosition: (id: string, position: { x: number; y: number }) => void
  updateWindowSize: (id: string, size: { width: number; height: number }) => void

  // Alt+Tab
  startAltTab: () => void
  cycleAltTab: (direction: 'next' | 'prev') => void
  commitAltTab: () => void
  cancelAltTab: () => void

  // Window snapping
  activeSnapZone: SnapZone
  setActiveSnapZone: (zone: SnapZone) => void
  snapWindow: (id: string, zone: SnapZone) => void
  unsnapWindow: (id: string) => void

  // Helpers
  getNextZIndex: () => number
  getWindowById: (id: string) => DesktopWindow | undefined
  getTaskbarWindows: () => DesktopWindow[]
}

// ============================================================================
// CONTEXT
// ============================================================================

const WindowManagerContext = createContext<WindowManagerContextValue | undefined>(undefined)

export function WindowManagerProvider({ children }: { children: React.ReactNode }) {
  const [windows, setWindows] = useState<DesktopWindow[]>([])
  const [focusedWindowId, setFocusedWindowId] = useState<string | null>(null)
  const [isAltTabOpen, setIsAltTabOpen] = useState(false)
  const [altTabIndex, setAltTabIndex] = useState(0)
  const zIndexCounter = useRef(100)

  const getNextZIndex = useCallback(() => {
    zIndexCounter.current += 1
    return zIndexCounter.current
  }, [])

  const openWindow = useCallback((window: Omit<DesktopWindow, 'zIndex' | 'isFocused'>) => {
    setWindows(prev => {
      // If window already exists, just focus it
      const existing = prev.find(w => w.id === window.id)
      if (existing) {
        return prev.map(w => ({
          ...w,
          isFocused: w.id === window.id,
          isMinimized: w.id === window.id ? false : w.isMinimized,
          zIndex: w.id === window.id ? zIndexCounter.current + 1 : w.zIndex,
        }))
      }

      const newZ = zIndexCounter.current + 1
      zIndexCounter.current = newZ

      // Every caller (open, session restore, starter seed, file editor) hands in
      // desktop-authored geometry; fit it to the screen we are on. A persisted
      // 1600px window must not replay onto a phone. See window-fit.ts.
      const fitted = fitWindowGeometry(
        { position: window.position, size: window.size },
        currentViewport(),
        { mode: 'open' },
      )
      const newWindow: DesktopWindow = {
        ...window,
        ...fitted,
        zIndex: newZ,
        isFocused: true,
      }

      return [
        ...prev.map(w => ({ ...w, isFocused: false })),
        newWindow,
      ]
    })
    setFocusedWindowId(window.id)
  }, [])

  const closeWindow = useCallback((id: string) => {
    setWindows(prev => {
      const filtered = prev.filter(w => w.id !== id)
      // Focus the topmost remaining window
      if (filtered.length > 0) {
        const topWindow = filtered.reduce((max, w) => w.zIndex > max.zIndex ? w : max, filtered[0])
        return filtered.map(w => ({ ...w, isFocused: w.id === topWindow.id }))
      }
      return filtered
    })
    if (focusedWindowId === id) {
      setFocusedWindowId(null)
    }
  }, [focusedWindowId])

  const focusWindow = useCallback((id: string) => {
    const newZ = zIndexCounter.current + 1
    zIndexCounter.current = newZ

    setWindows(prev => prev.map(w => ({
      ...w,
      isFocused: w.id === id,
      zIndex: w.id === id ? newZ : w.zIndex,
      isMinimized: w.id === id ? false : w.isMinimized,
    })))
    setFocusedWindowId(id)
  }, [])

  const minimizeWindow = useCallback((id: string) => {
    setWindows(prev => {
      const updated = prev.map(w => ({
        ...w,
        isMinimized: w.id === id ? true : w.isMinimized,
        isFocused: w.id === id ? false : w.isFocused,
      }))
      // Focus next visible window
      const visible = updated.filter(w => !w.isMinimized)
      if (visible.length > 0) {
        const topWindow = visible.reduce((max, w) => w.zIndex > max.zIndex ? w : max, visible[0])
        return updated.map(w => ({ ...w, isFocused: w.id === topWindow.id }))
      }
      return updated
    })
    if (focusedWindowId === id) {
      setFocusedWindowId(null)
    }
  }, [focusedWindowId])

  const maximizeWindow = useCallback((id: string) => {
    setWindows(prev => prev.map(w => ({
      ...w,
      isMaximized: w.id === id ? true : w.isMaximized,
    })))
  }, [])

  const restoreWindow = useCallback((id: string) => {
    setWindows(prev => prev.map(w => ({
      ...w,
      isMaximized: w.id === id ? false : w.isMaximized,
      isMinimized: w.id === id ? false : w.isMinimized,
    })))
    focusWindow(id)
  }, [focusWindow])

  const updateWindowPosition = useCallback((id: string, position: { x: number; y: number }) => {
    setWindows(prev => prev.map(w =>
      w.id === id ? { ...w, position } : w
    ))
  }, [])

  const updateWindowSize = useCallback((id: string, size: { width: number; height: number }) => {
    setWindows(prev => prev.map(w =>
      w.id === id ? { ...w, size } : w
    ))
  }, [])

  // Rotation, a Fold opening/closing, a browser resize: re-fit every open window so
  // none is left cut off. Crossing a class boundary (phone -> tablet on unfold) lays
  // the window out fresh for the new class; within a class the user's geometry is
  // kept and only pulled back into view.
  useEffect(() => {
    if (typeof window === 'undefined') return
    let lastClass = viewportClass(currentViewport().width)
    let frame = 0
    const refit = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const vp = currentViewport()
        const cls = viewportClass(vp.width)
        const mode = cls === lastClass ? 'clamp' : 'open'
        lastClass = cls
        setWindows(prev => {
          let changed = false
          const next = prev.map(w => {
            const fitted = fitWindowGeometry({ position: w.position, size: w.size }, vp, { mode })
            if (
              fitted.position.x === w.position.x && fitted.position.y === w.position.y &&
              fitted.size.width === w.size.width && fitted.size.height === w.size.height
            ) return w
            changed = true
            return { ...w, ...fitted }
          })
          return changed ? next : prev
        })
      })
    }
    window.addEventListener('resize', refit)
    window.addEventListener('orientationchange', refit)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', refit)
      window.removeEventListener('orientationchange', refit)
    }
  }, [])

  // ── Window Snapping ──────────────────────────────────────────────────
  const [activeSnapZone, setActiveSnapZone] = useState<SnapZone>(null)

  const snapWindow = useCallback((id: string, zone: SnapZone) => {
    if (!zone) return
    const { getSnapGeometry } = require('@/components/desktop/window-snap-preview')
    const screenW = typeof window !== 'undefined' ? window.innerWidth : 1920
    const screenH = typeof window !== 'undefined' ? window.innerHeight : 1080
    const geo = getSnapGeometry(zone, screenW, screenH, 48)
    if (!geo) return

    setWindows(prev => prev.map(w => {
      if (w.id !== id) return w
      return {
        ...w,
        preSnapState: w.preSnapState || { x: w.position.x, y: w.position.y, width: w.size.width, height: w.size.height },
        position: geo.position,
        size: geo.size,
        isMaximized: zone === 'top',
      }
    }))
    setActiveSnapZone(null)
  }, [])

  const unsnapWindow = useCallback((id: string) => {
    setWindows(prev => prev.map(w => {
      if (w.id !== id || !w.preSnapState) return w
      return {
        ...w,
        position: { x: w.preSnapState.x, y: w.preSnapState.y },
        size: { width: w.preSnapState.width, height: w.preSnapState.height },
        isMaximized: false,
        preSnapState: undefined,
      }
    }))
  }, [])

  // Alt+Tab cycling
  const startAltTab = useCallback(() => {
    const visible = windows.filter(w => !w.isMinimized || true) // include minimized in alt-tab
    if (visible.length <= 1) return
    setIsAltTabOpen(true)
    setAltTabIndex(1) // Start at second window (first is current)
  }, [windows])

  const cycleAltTab = useCallback((direction: 'next' | 'prev') => {
    const count = windows.length
    if (count === 0) return
    setAltTabIndex(prev => {
      if (direction === 'next') return (prev + 1) % count
      return (prev - 1 + count) % count
    })
  }, [windows.length])

  const commitAltTab = useCallback(() => {
    // Sort by z-index descending to get the stack order
    const sorted = [...windows].sort((a, b) => b.zIndex - a.zIndex)
    const target = sorted[altTabIndex]
    if (target) {
      focusWindow(target.id)
    }
    setIsAltTabOpen(false)
    setAltTabIndex(0)
  }, [windows, altTabIndex, focusWindow])

  const cancelAltTab = useCallback(() => {
    setIsAltTabOpen(false)
    setAltTabIndex(0)
  }, [])

  const getWindowById = useCallback((id: string) => {
    return windows.find(w => w.id === id)
  }, [windows])

  const getTaskbarWindows = useCallback(() => {
    return windows
  }, [windows])

  const value: WindowManagerContextValue = {
    windows,
    focusedWindowId,
    isAltTabOpen,
    altTabIndex,
    openWindow,
    closeWindow,
    focusWindow,
    minimizeWindow,
    maximizeWindow,
    restoreWindow,
    updateWindowPosition,
    updateWindowSize,
    startAltTab,
    cycleAltTab,
    commitAltTab,
    cancelAltTab,
    activeSnapZone,
    setActiveSnapZone,
    snapWindow,
    unsnapWindow,
    getNextZIndex,
    getWindowById,
    getTaskbarWindows,
  }

  return (
    <WindowManagerContext.Provider value={value}>
      {children}
    </WindowManagerContext.Provider>
  )
}

export function useWindowManager(): WindowManagerContextValue {
  const context = useContext(WindowManagerContext)
  if (!context) {
    throw new Error('useWindowManager must be used within WindowManagerProvider')
  }
  return context
}
