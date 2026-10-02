'use client'

/**
 * DesktopContextMenu
 * ==================
 * 
 * Right-click context menu for the desktop surface.
 * Provides OS-like actions: new file, new folder, arrange icons, change wallpaper, etc.
 */

import React, { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FilePlus, FolderPlus, Terminal, Settings, LayoutGrid,
  RotateCcw, Palette, Trash2, ExternalLink, Copy, Scissors,
  ChevronRight, Monitor
} from 'lucide-react'

interface DesktopContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  targetIcon?: { id: string; name: string; type: string } | undefined
  onAction: (action: string) => void
  onClose: () => void
  wallpaperPresets: string[]
}

interface MenuItem {
  id: string
  label: string
  icon: React.ElementType
  shortcut?: string
  separator?: boolean
  submenu?: { id: string; label: string }[]
  destructive?: boolean
}

export function DesktopContextMenu({
  isOpen,
  position,
  targetIcon,
  onAction,
  onClose,
  wallpaperPresets,
}: DesktopContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [activeSubmenu, setActiveSubmenu] = React.useState<string | null>(null)

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  // Build menu items based on context
  const desktopItems: MenuItem[] = targetIcon
    ? [
      { id: 'open', label: `Open ${targetIcon.name}`, icon: ExternalLink },
      { id: 'delete', label: 'Remove from Desktop', icon: Trash2, destructive: true, separator: true },
      { id: 'new-file', label: 'New File...', icon: FilePlus, shortcut: 'Ctrl+N' },
      { id: 'new-folder', label: 'New Folder', icon: FolderPlus },
    ]
    : [
      { id: 'new-file', label: 'New File...', icon: FilePlus, shortcut: 'Ctrl+N' },
      { id: 'new-folder', label: 'New Folder', icon: FolderPlus },
      { id: 'terminal', label: 'Open Terminal', icon: Terminal, shortcut: 'Ctrl+`', separator: true },
      { id: 'arrange', label: 'Auto Arrange Icons', icon: LayoutGrid },
      {
        id: 'wallpaper-menu', label: 'Change Wallpaper', icon: Palette,
        submenu: wallpaperPresets.map((name, i) => ({ id: `wallpaper-${i}`, label: name })),
      },
      { id: 'settings', label: 'Display Settings', icon: Monitor, separator: true },
      { id: 'reset', label: 'Reset Desktop', icon: RotateCcw, destructive: true },
    ]

  // Adjust position to keep menu on screen
  const adjustedX = Math.min(position.x, (typeof window !== 'undefined' ? window.innerWidth : 1920) - 220)
  const adjustedY = Math.min(position.y, (typeof window !== 'undefined' ? window.innerHeight : 1080) - 350)

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.95, y: -5 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -5 }}
          transition={{ duration: 0.1 }}
          className="fixed z-[300] min-w-[200px]"
          style={{ left: adjustedX, top: adjustedY }}
        >
          <div className="bg-zinc-900/95 backdrop-blur-xl border border-zinc-700/80 rounded-xl shadow-2xl shadow-black/50 py-1.5 overflow-hidden">
            {desktopItems.map((item, idx) => (
              <React.Fragment key={item.id}>
                {item.separator && idx > 0 && (
                  <div className="h-px bg-zinc-700/50 my-1 mx-2" />
                )}
                <div
                  className="relative"
                  onMouseEnter={() => item.submenu ? setActiveSubmenu(item.id) : setActiveSubmenu(null)}
                  onMouseLeave={() => item.submenu && setActiveSubmenu(null)}
                >
                  <button
                    onClick={() => {
                      if (item.submenu) return
                      onAction(item.id)
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors
                      ${item.destructive
                        ? 'text-red-400 hover:bg-red-500/10'
                        : 'text-zinc-200 hover:bg-white/10'
                      }`}
                  >
                    <item.icon className="w-3.5 h-3.5 opacity-70" />
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.shortcut && (
                      <span className="text-[10px] text-zinc-500 font-mono">{item.shortcut}</span>
                    )}
                    {item.submenu && (
                      <ChevronRight className="w-3 h-3 opacity-50" />
                    )}
                  </button>

                  {/* Submenu */}
                  {item.submenu && activeSubmenu === item.id && (
                    <motion.div
                      initial={{ opacity: 0, x: -5 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="absolute left-full top-0 ml-1 min-w-[160px] bg-zinc-900/95 backdrop-blur-xl border border-zinc-700/80 rounded-xl shadow-2xl py-1.5"
                    >
                      {item.submenu.map(sub => (
                        <button
                          key={sub.id}
                          onClick={() => onAction(sub.id)}
                          className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/10 transition-colors"
                        >
                          <div className="w-3 h-3 rounded-full bg-gradient-to-br from-[#5EC9CC]/50 to-cyan-500/50" />
                          {sub.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </div>
              </React.Fragment>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
