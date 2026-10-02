'use client'

/**
 * WindowSnapPreview
 * =================
 *
 * Shows a translucent preview rectangle when dragging a window near
 * the edges of the screen, indicating where the window will snap to.
 *
 * Snap zones:
 *  - Left edge:   Left half
 *  - Right edge:  Right half
 *  - Top edge:    Maximize
 *  - Top-left:    Top-left quarter
 *  - Top-right:   Top-right quarter
 *  - Bottom-left: Bottom-left quarter
 *  - Bottom-right:Bottom-right quarter
 */

import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export type SnapZone =
  | 'left'
  | 'right'
  | 'top'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | null

interface WindowSnapPreviewProps {
  zone: SnapZone
  taskbarHeight?: number
}

const SNAP_ZONE_STYLES: Record<string, { top: string; left: string; width: string; height: string }> = {
  'left':         { top: '0',   left: '0',   width: '50%', height: '100%' },
  'right':        { top: '0',   left: '50%', width: '50%', height: '100%' },
  'top':          { top: '0',   left: '0',   width: '100%', height: '100%' },
  'top-left':     { top: '0',   left: '0',   width: '50%', height: '50%' },
  'top-right':    { top: '0',   left: '50%', width: '50%', height: '50%' },
  'bottom-left':  { top: '50%', left: '0',   width: '50%', height: '50%' },
  'bottom-right': { top: '50%', left: '50%', width: '50%', height: '50%' },
}

export function WindowSnapPreview({ zone, taskbarHeight = 48 }: WindowSnapPreviewProps) {
  return (
    <AnimatePresence>
      {zone && (
        <motion.div
          key={zone}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="fixed pointer-events-none z-[99]"
          style={{
            ...SNAP_ZONE_STYLES[zone],
            // Account for taskbar — reduce height
            ...(zone !== 'top' ? {} : {}),
            bottom: zone.includes('bottom') || zone === 'left' || zone === 'right'
              ? `${taskbarHeight}px`
              : undefined,
            height: zone === 'top'
              ? `calc(100% - ${taskbarHeight}px)`
              : zone.includes('bottom')
                ? `calc(50% - ${taskbarHeight / 2}px)`
                : zone === 'left' || zone === 'right'
                  ? `calc(100% - ${taskbarHeight}px)`
                  : SNAP_ZONE_STYLES[zone].height,
          }}
        >
          <div className="absolute inset-2 rounded-xl border-2 border-[#5EC9CC]/40 bg-[#5EC9CC]/[0.07] backdrop-blur-sm shadow-[0_0_30px_rgba(94,201,204,0.1)]">
            {/* Corner dots */}
            <div className="absolute top-0 left-0 w-2 h-2 bg-[#5EC9CC]/40 rounded-br-lg" />
            <div className="absolute top-0 right-0 w-2 h-2 bg-[#5EC9CC]/40 rounded-bl-lg" />
            <div className="absolute bottom-0 left-0 w-2 h-2 bg-[#5EC9CC]/40 rounded-tr-lg" />
            <div className="absolute bottom-0 right-0 w-2 h-2 bg-[#5EC9CC]/40 rounded-tl-lg" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * Detect which snap zone the cursor is in based on mouse position.
 * Returns null if not near any edge.
 */
export function detectSnapZone(
  mouseX: number,
  mouseY: number,
  screenWidth: number,
  screenHeight: number,
  edgeThreshold: number = 8,
  cornerThreshold: number = 60,
): SnapZone {
  const nearLeft = mouseX <= edgeThreshold
  const nearRight = mouseX >= screenWidth - edgeThreshold
  const nearTop = mouseY <= edgeThreshold
  const nearBottom = mouseY >= screenHeight - 48 - edgeThreshold // Account for taskbar

  // Corners (top only for now — more intuitive)
  if (nearTop && mouseX < cornerThreshold) return 'top-left'
  if (nearTop && mouseX > screenWidth - cornerThreshold) return 'top-right'
  if (nearBottom && mouseX < cornerThreshold) return 'bottom-left'
  if (nearBottom && mouseX > screenWidth - cornerThreshold) return 'bottom-right'

  // Edges
  if (nearTop) return 'top'
  if (nearLeft) return 'left'
  if (nearRight) return 'right'

  return null
}

/**
 * Calculate window position and size for a given snap zone.
 */
export function getSnapGeometry(
  zone: SnapZone,
  screenWidth: number,
  screenHeight: number,
  taskbarHeight: number = 48,
): { position: { x: number; y: number }; size: { width: number; height: number } } | null {
  if (!zone) return null

  const usableHeight = screenHeight - taskbarHeight
  const halfW = Math.floor(screenWidth / 2)
  const halfH = Math.floor(usableHeight / 2)

  switch (zone) {
    case 'left':
      return { position: { x: 0, y: 0 }, size: { width: halfW, height: usableHeight } }
    case 'right':
      return { position: { x: halfW, y: 0 }, size: { width: halfW, height: usableHeight } }
    case 'top':
      return { position: { x: 0, y: 0 }, size: { width: screenWidth, height: usableHeight } }
    case 'top-left':
      return { position: { x: 0, y: 0 }, size: { width: halfW, height: halfH } }
    case 'top-right':
      return { position: { x: halfW, y: 0 }, size: { width: halfW, height: halfH } }
    case 'bottom-left':
      return { position: { x: 0, y: halfH }, size: { width: halfW, height: halfH } }
    case 'bottom-right':
      return { position: { x: halfW, y: halfH }, size: { width: halfW, height: halfH } }
    default:
      return null
  }
}
