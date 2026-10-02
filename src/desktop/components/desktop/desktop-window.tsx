'use client'

/**
 * DesktopWindow
 * =============
 * 
 * A proper OS-style window component with title bar, drag, resize,
 * minimize/maximize/close, and focus management.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Minus, Maximize2, Minimize2, X, GripVertical,
} from 'lucide-react'
import { AgentToggleButton } from './agent-sidebar'
import { AgentSidebar } from './agent-sidebar'
import { detectSnapZone, getSnapGeometry, type SnapZone } from './window-snap-preview'

/** Below this width a floating window cannot work: there is nowhere to float to. */
export const MOBILE_MAX_WIDTH = 768

/**
 * Is this a phone-sized viewport?
 *
 * Measured by WIDTH, never by user-agent. iPadOS 13+ sends a DESKTOP Safari UA
 * containing "Macintosh", so a UA regex misses every modern iPad — the same trap
 * BIH004 exists for on the in-browser inference surface. Width is what actually
 * decides whether a 900px window fits.
 *
 * Re-evaluated on resize AND orientation change: a phone rotated to landscape is
 * still a phone, and a window sized at mount stays wrong forever otherwise.
 */
function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= MOBILE_MAX_WIDTH : false
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`)
    const sync = () => setIsMobile(mq.matches)
    sync()
    // `change` is the modern event; older Safari only has addListener.
    if (mq.addEventListener) mq.addEventListener('change', sync)
    else mq.addListener(sync)
    window.addEventListener('orientationchange', sync)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', sync)
      else mq.removeListener(sync)
      window.removeEventListener('orientationchange', sync)
    }
  }, [])
  return isMobile
}

interface DesktopWindowProps {
  id: string
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
  position: { x: number; y: number }
  size: { width: number; height: number }
  isMinimized: boolean
  isMaximized: boolean
  isFocused: boolean
  zIndex: number
  minWidth?: number
  minHeight?: number
  onFocus: () => void
  onClose: () => void
  onMinimize: () => void
  onMaximize: () => void
  onRestore: () => void
  onPositionChange: (pos: { x: number; y: number }) => void
  onSizeChange: (size: { width: number; height: number }) => void
  onSnapZoneChange?: (zone: SnapZone) => void
  onSnapCommit?: (zone: SnapZone) => void
}

export function DesktopWindow({
  id,
  title,
  icon,
  children,
  position,
  size,
  isMinimized,
  isMaximized,
  isFocused,
  zIndex,
  minWidth = 300,
  minHeight = 200,
  onFocus,
  onClose,
  onMinimize,
  onMaximize,
  onRestore,
  onPositionChange,
  onSizeChange,
  onSnapZoneChange,
  onSnapCommit,
}: DesktopWindowProps) {
  const windowRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [resizeDir, setResizeDir] = useState<string | null>(null)
  const dragStart = useRef({ x: 0, y: 0 })
  const posStart = useRef({ x: 0, y: 0 })
  const sizeStart = useRef({ width: 0, height: 0 })
  const preMaxState = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const pendingSnapZone = useRef<SnapZone>(null)

  // A phone has nowhere for a window to float TO. Measured 2026-08-19 on a real
  // iPhone viewport (390px): a tenant portal rendered a 900px window starting at
  // x=215, so it hung off the right edge with its traffic-light buttons and drag
  // bar reachable and its content not — and drag/resize are mouse-only here
  // (onMouseDown), so a touch user could not even move it back. The shell already
  // has the correct geometry for this; it was only ever reachable by clicking
  // maximize.
  const isMobile = useIsMobileViewport()
  const fullBleed = isMaximized || isMobile

  const actualPos = fullBleed ? { x: 0, y: 0 } : position
  const actualSize = fullBleed
    ? { width: typeof window !== 'undefined' ? window.innerWidth : 1920, height: typeof window !== 'undefined' ? window.innerHeight - 48 : 1032 }
    : size

  // Drag handlers
  const handleDragStart = (e: React.PointerEvent) => {
    if (fullBleed) return
    e.preventDefault()
    setIsDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY }
    posStart.current = { ...position }
    onFocus()
  }

  // Resize handlers
  const handleResizeStart = (e: React.PointerEvent, direction: string) => {
    if (fullBleed) return
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    setResizeDir(direction)
    dragStart.current = { x: e.clientX, y: e.clientY }
    sizeStart.current = { ...size }
    posStart.current = { ...position }
    onFocus()
  }

  useEffect(() => {
    if (!isDragging && !isResizing) return

    const handleMouseMove = (e: PointerEvent) => {
      if (isDragging) {
        const dx = e.clientX - dragStart.current.x
        const dy = e.clientY - dragStart.current.y
        // x may go NEGATIVE. It was clamped at 0, so a window wider than the
        // viewport could never be pulled leftward and its right-hand side was
        // permanently unreachable -- exactly the report: "it goes off screen to
        // the right but you can't drag it off screen to the left at all".
        // A strip stays on screen so a window can never be lost entirely.
        const KEEP_VISIBLE = 120
        onPositionChange({
          x: Math.max(KEEP_VISIBLE - size.width, posStart.current.x + dx),
          y: Math.max(0, posStart.current.y + dy),
        })

        // Detect snap zone
        if (onSnapZoneChange) {
          const zone = detectSnapZone(
            e.clientX, e.clientY,
            window.innerWidth, window.innerHeight,
          )
          pendingSnapZone.current = zone
          onSnapZoneChange(zone)
        }
      }
      if (isResizing && resizeDir) {
        const dx = e.clientX - dragStart.current.x
        const dy = e.clientY - dragStart.current.y

        let newWidth = sizeStart.current.width
        let newHeight = sizeStart.current.height

        if (resizeDir.includes('e')) newWidth = Math.max(minWidth, sizeStart.current.width + dx)
        if (resizeDir.includes('s')) newHeight = Math.max(minHeight, sizeStart.current.height + dy)
        // Derive the position from the size that was ACTUALLY applied, not from
        // the raw pointer delta. Moving by dx while the width is clamped at
        // minWidth kept sliding the whole window after it had stopped resizing,
        // so the opposite edge drifted and the gesture felt inverted -- the
        // "resizes backwards" report. Pinning the far edge is the invariant:
        // dragging the west edge must leave the east edge exactly where it was.
        if (resizeDir.includes('w')) {
          newWidth = Math.max(minWidth, sizeStart.current.width - dx)
          onPositionChange({
            x: posStart.current.x + (sizeStart.current.width - newWidth),
            y: position.y,
          })
        }
        if (resizeDir.includes('n')) {
          newHeight = Math.max(minHeight, sizeStart.current.height - dy)
          onPositionChange({
            x: position.x,
            y: posStart.current.y + (sizeStart.current.height - newHeight),
          })
        }

        onSizeChange({ width: newWidth, height: newHeight })
      }
    }

    const handleMouseUp = () => {
      // Commit snap if we're in a snap zone
      if (isDragging && pendingSnapZone.current && onSnapCommit) {
        onSnapCommit(pendingSnapZone.current)
        pendingSnapZone.current = null
        onSnapZoneChange?.(null)
      }
      setIsDragging(false)
      setIsResizing(false)
      setResizeDir(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.userSelect = 'none'
    if (isResizing) {
      const cursorMap: Record<string, string> = {
        'e': 'ew-resize', 'w': 'ew-resize',
        's': 'ns-resize', 'n': 'ns-resize',
        'se': 'nwse-resize', 'sw': 'nesw-resize',
        'ne': 'nesw-resize', 'nw': 'nwse-resize',
      }
      document.body.style.cursor = cursorMap[resizeDir || ''] || 'default'
    }

    // Pointer events, not mouse events: a touch drag never synthesizes
    // mousemove, so a tablet could focus a window but never move or resize it.
    // pointercancel ends the gesture when the browser takes the touch back.
    document.addEventListener('pointermove', handleMouseMove)
    document.addEventListener('pointerup', handleMouseUp)
    document.addEventListener('pointercancel', handleMouseUp)
    return () => {
      document.removeEventListener('pointermove', handleMouseMove)
      document.removeEventListener('pointerup', handleMouseUp)
      document.removeEventListener('pointercancel', handleMouseUp)
    }
  }, [isDragging, isResizing, resizeDir, minWidth, minHeight, position, onPositionChange, onSizeChange])

  const handleDoubleClickTitle = () => {
    if (isMaximized) {
      onRestore()
    } else {
      preMaxState.current = { x: position.x, y: position.y, w: size.width, h: size.height }
      onMaximize()
    }
  }

  if (isMinimized) return null

  return (
    <div
      ref={windowRef}
      className={`fixed flex flex-col overflow-hidden transition-shadow duration-200
        ${isFocused
          ? 'shadow-2xl shadow-black/40'
          : 'shadow-lg shadow-black/20'
        }
        ${fullBleed ? 'rounded-none' : 'rounded-xl'}
        ${isFocused
          ? 'ring-1 ring-white/10'
          : 'ring-1 ring-white/5'
        }`}
      style={{
        left: actualPos.x,
        top: actualPos.y,
        width: actualSize.width,
        height: actualSize.height,
        zIndex,
      }}
      onPointerDown={onFocus}
    >
      {/* Title Bar — glass effect */}
      <div
        className={`flex items-center justify-between h-10 px-3 select-none shrink-0 backdrop-blur-xl
          ${isFocused
            ? 'bg-gradient-to-b from-zinc-700/80 to-zinc-800/90 border-b border-white/[0.06]'
            : 'bg-zinc-800/70 border-b border-white/[0.03]'
          }`}
        style={{ touchAction: fullBleed ? undefined : 'none' }}
        onPointerDown={handleDragStart}
        onDoubleClick={handleDoubleClickTitle}
      >
        {/* Left: traffic-light buttons */}
        <div className="flex items-center gap-1.5 mr-3 flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onClose() }}
            className="w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-500 transition-colors ring-1 ring-red-600/40 flex items-center justify-center group"
            title="Close"
          >
            <X className="w-2 h-2 text-red-900 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onMinimize() }}
            className="w-3 h-3 rounded-full bg-yellow-500/80 hover:bg-yellow-500 transition-colors ring-1 ring-yellow-600/40 flex items-center justify-center group"
            title="Minimize"
          >
            <Minus className="w-2 h-2 text-yellow-900 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (isMaximized) onRestore()
              else onMaximize()
            }}
            className="w-3 h-3 rounded-full bg-green-500/80 hover:bg-green-500 transition-colors ring-1 ring-green-600/40 flex items-center justify-center group"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized
              ? <Minimize2 className="w-2 h-2 text-green-900 opacity-0 group-hover:opacity-100 transition-opacity" />
              : <Maximize2 className="w-2 h-2 text-green-900 opacity-0 group-hover:opacity-100 transition-opacity" />
            }
          </button>
        </div>

        {/* Center: title */}
        <div className="flex items-center gap-2 min-w-0 flex-1 justify-center">
          {icon && <div className="flex-shrink-0 opacity-80">{icon}</div>}
          <span className={`text-xs font-medium truncate ${isFocused ? 'text-zinc-200' : 'text-zinc-500'}`}>
            {title}
          </span>
        </div>

        {/* Right: agent toggle */}
        <div className="flex items-center gap-0.5 flex-shrink-0 ml-3">
          <AgentToggleButton windowId={id} />
        </div>
      </div>

      {/* Window Content + Agent Sidebar */}
      <div className="flex-1 flex overflow-hidden bg-zinc-900/98 backdrop-blur-sm">
        {/* Main content area */}
        <div className="flex-1 overflow-auto min-w-0">
          {children}
        </div>
        {/* Agent sidebar (slides in from right) */}
        <AgentSidebar windowId={id} />
      </div>

      {/* Resize handles (only when not maximized) */}
      {!fullBleed && (
        <>
          {/* East */}
          <div className="absolute top-10 right-0 w-1.5 bottom-0 cursor-ew-resize hover:bg-[#7AD6D8]/20 transition-colors"
            style={{ touchAction: 'none' }} onPointerDown={e => handleResizeStart(e, 'e')} />
          {/* South */}
          <div className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-[#7AD6D8]/20 transition-colors"
            style={{ touchAction: 'none' }} onPointerDown={e => handleResizeStart(e, 's')} />
          {/* South-East corner */}
          <div className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize hover:bg-[#7AD6D8]/20 transition-colors"
            style={{ touchAction: 'none' }} onPointerDown={e => handleResizeStart(e, 'se')} />
          {/* West */}
          <div className="absolute top-10 left-0 w-1.5 bottom-0 cursor-ew-resize hover:bg-[#7AD6D8]/20 transition-colors"
            style={{ touchAction: 'none' }} onPointerDown={e => handleResizeStart(e, 'w')} />
          {/* North (below title) */}
          <div className="absolute top-0 left-0 right-0 h-1 cursor-ns-resize"
            style={{ touchAction: 'none' }} onPointerDown={e => handleResizeStart(e, 'n')} />
          {/* South-West corner */}
          <div className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize hover:bg-[#7AD6D8]/20 transition-colors"
            style={{ touchAction: 'none' }} onPointerDown={e => handleResizeStart(e, 'sw')} />
          {/* North-East corner */}
          <div className="absolute top-0 right-0 w-4 h-4 cursor-nesw-resize"
            style={{ touchAction: 'none' }} onPointerDown={e => handleResizeStart(e, 'ne')} />
          {/* North-West corner */}
          <div className="absolute top-0 left-0 w-4 h-4 cursor-nwse-resize"
            style={{ touchAction: 'none' }} onPointerDown={e => handleResizeStart(e, 'nw')} />
        </>
      )}
    </div>
  )
}
