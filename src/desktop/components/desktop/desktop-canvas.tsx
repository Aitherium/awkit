'use client'

/**
 * DesktopCanvas
 * =============
 * 
 * The actual desktop surface — a full-viewport canvas that hosts:
 * - Desktop icons (shortcuts to widgets/apps/files)
 * - Wallpaper background
 * - Right-click context menu
 * - Drag-and-drop icon arrangement
 * - File creation & saving via Strata
 * 
 * This is the Linux desktop experience for AitherVeil.
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { motion, AnimatePresence, useMotionValue } from 'framer-motion'
import {
  Brain, Terminal, Settings, Folder, FileText, Globe, Bot,
  Sparkles, Radio, Feather, Library, Wand2, Gamepad2,
  GitBranch, Eye, Activity, HardDrive, Network, Shield,
  Code2, MessageSquare, Monitor, Image, Music, Film,
  Plus, Trash2, Edit3, Copy, FolderPlus, FilePlus,
  RotateCcw, Palette, LayoutGrid, Grid3X3, Play,
  Key, Layers, Database, Cpu, Zap, Gauge, Workflow, PlugZap,
} from 'lucide-react'
import { useWindowManager } from '../../contexts/window-manager-context'
import { DesktopContextMenu } from './desktop-context-menu'
import { NeuralMinimap } from './neural-minimap'
import { toast } from 'sonner'
import { createFile as createLocalFile } from '../../lib/desktop-file-store'
import { DESKTOP_ICON_APPS } from '../../data/apps-manifest'
import { useAppCatalog } from '../../contexts/app-catalog-context'

// ============================================================================
// TYPES
// ============================================================================

export interface DesktopIcon {
  id: string
  name: string
  icon: string // icon identifier
  type: 'app' | 'widget' | 'folder' | 'file' | 'link'
  position: { x: number; y: number }
  // For apps/widgets
  widgetId?: string
  // For files — backed by desktop-file-store
  filePath?: string
  fileId?: string
  // For links  
  href?: string
  // Visual
  color?: string
}

interface WallpaperConfig {
  type: 'gradient' | 'solid' | 'image'
  value: string
  blur?: number
}

const WALLPAPER_PRESETS: { name: string; config: WallpaperConfig }[] = [
  { name: 'Deep Space', config: { type: 'gradient', value: 'from-slate-950 via-[#0B2526]/30 to-slate-950' } },
  { name: 'Aurora', config: { type: 'gradient', value: 'from-slate-950 via-emerald-950/40 to-cyan-950/30' } },
  { name: 'Sunset', config: { type: 'gradient', value: 'from-slate-950 via-orange-950/30 to-rose-950/20' } },
  { name: 'Midnight', config: { type: 'gradient', value: 'from-slate-950 via-blue-950/20 to-slate-950' } },
  { name: 'Carbon', config: { type: 'solid', value: 'bg-zinc-950' } },
  { name: 'Nebula', config: { type: 'gradient', value: 'from-[#0B2526] via-[#0B2526]/50 to-pink-950/30' } },
]

// Icon mapping for rendering
const ICON_MAP: Record<string, React.ElementType> = {
  brain: Brain,
  terminal: Terminal,
  settings: Settings,
  folder: Folder,
  'folder-open': Folder,
  file: FileText,
  'file-text': FileText,
  globe: Globe,
  bot: Bot,
  sparkles: Sparkles,
  radio: Radio,
  feather: Feather,
  library: Library,
  wand: Wand2,
  'wand-2': Wand2,
  gamepad: Gamepad2,
  git: GitBranch,
  'git-branch': GitBranch,
  eye: Eye,
  activity: Activity,
  harddrive: HardDrive,
  'hard-drive': HardDrive,
  network: Network,
  shield: Shield,
  code: Code2,
  'code-2': Code2,
  message: MessageSquare,
  'message-square': MessageSquare,
  monitor: Monitor,
  image: Image,
  music: Music,
  film: Film,
  play: Play,
  palette: Palette,
  key: Key,
  layers: Layers,
  database: Database,
  cpu: Cpu,
  zap: Zap,
  gauge: Gauge,
  workflow: Workflow,
  'plug-zap': PlugZap,
}

/**
 * Build DEFAULT_ICONS from the manifest.
 * Only apps with `desktopIcon` defined appear here.
 * This ensures the desktop canvas is always in sync with apps-manifest.ts.
 */
function buildDefaultIcons(): DesktopIcon[] {
  return DESKTOP_ICON_APPS.map(app => ({
    id: app.id,
    name: app.name,
    icon: app.icon,
    type: (app.desktopWidget ? 'widget' : 'link') as DesktopIcon['type'],
    widgetId: app.desktopWidget?.widgetId,
    href: !app.desktopWidget ? app.route : undefined,
    position: {
      x: app.desktopIcon!.column,
      y: app.desktopIcon!.row,
    },
    color: `text-zinc-300`,  // Neutral default — Lucide icons look clean
  }))
}

const DEFAULT_ICONS: DesktopIcon[] = buildDefaultIcons()

// ============================================================================
// DESKTOP STARFIELD — ambient twinkling background
// ============================================================================

function DesktopStarfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    let animId: number
    let isVisible = true

    const handleVisibility = () => { isVisible = document.visibilityState === 'visible' }
    document.addEventListener('visibilitychange', handleVisibility)

    const stars: { x: number; y: number; r: number; baseAlpha: number; speed: number; hue: number; phase: number }[] = []

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    // Create stars — lightweight, spread across the viewport
    const count = 120
    for (let i = 0; i < count; i++) {
      const rand = Math.random()
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.2 + 0.3,
        baseAlpha: Math.random() * 0.5 + 0.15,
        speed: Math.random() * 0.002 + 0.0005,
        phase: Math.random() * Math.PI * 2,
        // Mostly white, some purple, some cyan
        hue: rand > 0.92 ? 270 : rand > 0.84 ? 200 : 0,
      })
    }

    let lastFrame = 0
    const frameInterval = 1000 / 24 // 24 fps — light on GPU

    const draw = (timestamp: number) => {
      animId = requestAnimationFrame(draw)
      if (!isVisible) return
      const elapsed = timestamp - lastFrame
      if (elapsed < frameInterval) return
      lastFrame = timestamp - (elapsed % frameInterval)

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      stars.forEach(s => {
        const twinkle = Math.sin(timestamp * s.speed + s.phase) * 0.35 + 0.65
        const alpha = s.baseAlpha * twinkle

        if (s.hue > 0) {
          ctx.fillStyle = `hsla(${s.hue}, 55%, 72%, ${alpha})`
        } else {
          ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
        }
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fill()
      })
    }

    animId = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(animId)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-[0]" />
}

// ============================================================================
// GRID HELPERS
// ============================================================================

const GRID_SIZE_X = 104 // pixels per grid cell horizontally
const GRID_SIZE_Y = 120 // pixels per grid cell vertically
const ICON_SIZE = 80

function snapToGrid(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.round(x / GRID_SIZE_X),
    y: Math.round(y / GRID_SIZE_Y),
  }
}

function gridToPixel(gx: number, gy: number): { x: number; y: number } {
  return {
    x: gx * GRID_SIZE_X + 20,
    y: gy * GRID_SIZE_Y + 20,
  }
}

// ============================================================================
// DESKTOP ICON COMPONENT
// ============================================================================

function DesktopIconView({
  icon,
  isSelected,
  onSelect,
  onOpen,
  onDragEnd,
}: {
  icon: DesktopIcon
  isSelected: boolean
  onSelect: (e: React.MouseEvent) => void
  onOpen: () => void
  onDragEnd: (x: number, y: number) => void
}) {
  const IconComponent = ICON_MAP[icon.icon] || FileText
  const pos = gridToPixel(icon.position.x, icon.position.y)
  const lastTapRef = useRef<number>(0)
  const didDragRef = useRef(false)
  // framer-motion drags by writing a transform (x/y), and that transform STAYS
  // after release. The drop also moves left/top to the snapped cell, so without
  // zeroing these the icon rendered at the new cell PLUS the drag offset, and
  // every later drag piled another offset on top -- icons flew off the grid.
  const dragX = useMotionValue(0)
  const dragY = useMotionValue(0)

  // Use framer-motion's onTap which correctly distinguishes taps from drags.
  // onTap only fires when the pointer is released WITHOUT a drag gesture,
  // solving the issue where drag swallows click/double-click events.
  const handleTap = useCallback((e: MouseEvent | TouchEvent | PointerEvent) => {
    const now = Date.now()
    const delta = now - lastTapRef.current
    if (delta < 400 && delta > 0) {
      // Double-tap detected → open
      lastTapRef.current = 0
      onOpen()
    } else {
      lastTapRef.current = now
      // Single tap → select
      onSelect(e as unknown as React.MouseEvent)
    }
  }, [onOpen, onSelect])

  return (
    <motion.div
      className={`absolute flex flex-col items-center justify-center cursor-pointer select-none group
        ${isSelected ? 'bg-white/10 ring-1 ring-white/30' : 'hover:bg-white/5'}
        rounded-lg p-2 transition-colors duration-100`}
      style={{
        left: pos.x,
        top: pos.y,
        width: ICON_SIZE,
        height: ICON_SIZE + 32,
        x: dragX,
        y: dragY,
      }}
      drag
      dragMomentum={false}
      dragSnapToOrigin={false}
      onDragStart={() => { didDragRef.current = true }}
      onDragEnd={(_, info) => {
        // Only commit the move if the user dragged more than a few pixels
        const dist = Math.abs(info.offset.x) + Math.abs(info.offset.y)
        if (dist > 8) {
          const newX = pos.x + info.offset.x
          const newY = pos.y + info.offset.y
          const snapped = snapToGrid(newX - 20, newY - 20)
          onDragEnd(snapped.x, snapped.y)
        }
        dragX.set(0)
        dragY.set(0)
        didDragRef.current = false
      }}
      onTap={handleTap}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      <div className={`p-3 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 
        group-hover:bg-white/10 group-hover:border-white/20 transition-all
        ${isSelected ? 'bg-white/15 border-white/30 shadow-lg shadow-[#5EC9CC]/10' : ''}`}>
        <IconComponent className={`w-6 h-6 ${icon.color || 'text-white'}`} />
      </div>
      <span className="text-[11px] text-white/90 mt-1.5 text-center leading-tight max-w-[90px] line-clamp-2 font-medium drop-shadow-lg">
        {icon.name}
      </span>
    </motion.div>
  )
}

// ============================================================================
// MAIN DESKTOP CANVAS
// ============================================================================

interface DesktopCanvasProps {
  onOpenWidget: (widgetId: string) => void
  onOpenFile: (fileId: string, fileName: string) => void
  onOpenTerminal: () => void
  onOpenSettings: () => void
  onNavigate: (path: string) => void
}

export function DesktopCanvas({ onOpenWidget, onOpenFile, onOpenTerminal, onOpenSettings, onNavigate }: DesktopCanvasProps) {
  // Persisted state
  const [icons, setIcons] = useState<DesktopIcon[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_ICONS
    const saved = localStorage.getItem('aitherzero:desktop-icons')
    return saved ? JSON.parse(saved) : DEFAULT_ICONS
  })

  const [wallpaper, setWallpaper] = useState<WallpaperConfig>(() => {
    if (typeof window === 'undefined') return WALLPAPER_PRESETS[0].config
    const saved = localStorage.getItem('aitherzero:desktop-wallpaper')
    return saved ? JSON.parse(saved) : WALLPAPER_PRESETS[0].config
  })

  // Catalog scoping, applied to the RENDERED set rather than to DEFAULT_ICONS.
  // The icon layout is persisted in localStorage, so a session that already
  // stored the unfiltered set would keep every out-of-catalog icon forever if
  // only the defaults were filtered. Filtering here also means the icons come
  // back untouched if the deployment's entitlements later widen — the user's
  // arrangement is preserved, not rewritten.
  const { isAllowed } = useAppCatalog()
  const visibleIcons = useMemo(
    () => icons.filter(icon =>
      // Files and folders the user created are theirs, never catalog-scoped.
      icon.type === 'file' || icon.type === 'folder' ||
      isAllowed({ id: icon.id, hasWidget: !!icon.widgetId })
    ),
    [icons, isAllowed],
  )

  const [selectedIcons, setSelectedIcons] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; targetIcon?: DesktopIcon } | null>(null)
  const [isCreatingFile, setIsCreatingFile] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [newFilePosition, setNewFilePosition] = useState({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)

  // Save icons to localStorage
  useEffect(() => {
    localStorage.setItem('aitherzero:desktop-icons', JSON.stringify(icons))
  }, [icons])

  // Save wallpaper
  useEffect(() => {
    localStorage.setItem('aitherzero:desktop-wallpaper', JSON.stringify(wallpaper))
  }, [wallpaper])

  // Click on empty space to deselect
  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.desktop-bg')) {
      setSelectedIcons(new Set())
      setContextMenu(null)
    }
  }, [])

  // Right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const target = (e.target as HTMLElement).closest('[data-icon-id]')
    const iconId = target?.getAttribute('data-icon-id')
    const targetIcon = iconId ? icons.find(i => i.id === iconId) : undefined

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      targetIcon,
    })
  }, [icons])

  // Open an icon
  const handleOpenIcon = useCallback((icon: DesktopIcon) => {
    // Settings always opens as a dialog overlay, regardless of icon type
    if (icon.id === 'settings') {
      onOpenSettings()
      return
    }

    switch (icon.type) {
      case 'widget':
        if (icon.widgetId) onOpenWidget(icon.widgetId)
        break
      case 'app':
        if (icon.widgetId === 'terminal') onOpenTerminal()
        else if (icon.widgetId) onOpenWidget(icon.widgetId)
        break
      case 'link':
        if (icon.href) onNavigate(icon.href)
        break
      case 'folder':
        onOpenWidget('strata')
        break
      case 'file':
        if (icon.fileId) {
          onOpenFile(icon.fileId, icon.name)
        } else {
          toast.info(`📄 ${icon.name}`, {
            description: 'No file data associated',
          })
        }
        break
    }
  }, [onOpenWidget, onOpenFile, onOpenTerminal, onOpenSettings, onNavigate])

  // Move icon on drag end
  // Dropping onto an occupied cell used to stack two icons on one spot, the
  // lower one unreachable. Take the nearest free cell instead (ring search).
  const handleIconDragEnd = useCallback((iconId: string, newX: number, newY: number) => {
    setIcons(prev => {
      const taken = new Set(prev.filter(i => i.id !== iconId).map(i => `${i.position.x},${i.position.y}`))
      const tx = Math.max(0, newX)
      const ty = Math.max(0, newY)
      let target = { x: tx, y: ty }
      search: for (let r = 0; r < 50; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
            const x = tx + dx
            const y = ty + dy
            if (x < 0 || y < 0 || taken.has(`${x},${y}`)) continue
            target = { x, y }
            break search
          }
        }
      }
      return prev.map(i => (i.id === iconId ? { ...i, position: target } : i))
    })
  }, [])

  // Create new file icon
  const handleCreateFile = useCallback((name: string, type: 'file' | 'folder') => {
    const fileName = name || (type === 'folder' ? 'New Folder' : 'New File')
    let fileId: string | undefined

    // Create backing file in local store
    if (type === 'file') {
      const localFile = createLocalFile(fileName)
      fileId = localFile.id
    }

    const newIcon: DesktopIcon = {
      id: fileId || `user-${Date.now()}`,
      name: fileName,
      icon: type === 'folder' ? 'folder' : 'file',
      type,
      position: newFilePosition,
      color: type === 'folder' ? 'text-amber-400' : 'text-blue-400',
      filePath: type === 'file' ? `aither://desktop/${fileName}` : undefined,
      fileId,
    }
    setIcons(prev => [...prev, newIcon])
    setIsCreatingFile(false)
    setNewFileName('')

    toast.success(`Created ${fileName}${type === 'file' ? ' — double-click to edit' : ''}`)

    // Auto-open file editor for new files
    if (type === 'file' && fileId) {
      onOpenFile(fileId, fileName)
    }
  }, [newFilePosition, onOpenFile])

  // Delete selected icons
  const handleDeleteSelected = useCallback(() => {
    setIcons(prev => prev.filter(i => !selectedIcons.has(i.id)))
    setSelectedIcons(new Set())
    toast.success('Deleted selected items')
  }, [selectedIcons])

  // Reset desktop layout
  const handleResetDesktop = useCallback(() => {
    setIcons(DEFAULT_ICONS)
    setSelectedIcons(new Set())
    toast.success('Desktop reset to default')
  }, [])

  // Auto-arrange icons
  const handleAutoArrange = useCallback(() => {
    setIcons(prev => {
      const sorted = [...prev]
      let col = 0
      let row = 0
      const maxRows = Math.floor((window.innerHeight - 100) / GRID_SIZE_Y) - 1
      return sorted.map(icon => {
        const newIcon = { ...icon, position: { x: col, y: row } }
        row++
        if (row > maxRows) {
          row = 0
          col++
        }
        return newIcon
      })
    })
    toast.success('Icons arranged')
  }, [])

  // Change wallpaper
  const handleChangeWallpaper = useCallback((preset: typeof WALLPAPER_PRESETS[0]) => {
    setWallpaper(preset.config)
    toast.success(`Wallpaper: ${preset.name}`)
  }, [])

  // Context menu actions
  const handleContextMenuAction = useCallback((action: string) => {
    const menuPos = contextMenu
    setContextMenu(null)

    switch (action) {
      case 'new-file':
        if (menuPos) {
          const grid = snapToGrid(menuPos.x - 20, menuPos.y - 80)
          setNewFilePosition(grid)
          setIsCreatingFile(true)
        }
        break
      case 'new-folder':
        if (menuPos) {
          const grid = snapToGrid(menuPos.x - 20, menuPos.y - 80)
          handleCreateFile('New Folder', 'folder')
        }
        break
      case 'open':
        if (contextMenu?.targetIcon) handleOpenIcon(contextMenu.targetIcon)
        break
      case 'delete':
        if (contextMenu?.targetIcon) {
          setIcons(prev => prev.filter(i => i.id !== contextMenu.targetIcon!.id))
          toast.success(`Removed ${contextMenu.targetIcon.name}`)
        }
        break
      case 'arrange':
        handleAutoArrange()
        break
      case 'reset':
        handleResetDesktop()
        break
      case 'wallpaper-0':
      case 'wallpaper-1':
      case 'wallpaper-2':
      case 'wallpaper-3':
      case 'wallpaper-4':
      case 'wallpaper-5':
        const idx = parseInt(action.split('-')[1])
        if (WALLPAPER_PRESETS[idx]) handleChangeWallpaper(WALLPAPER_PRESETS[idx])
        break
      case 'terminal':
        onOpenTerminal()
        break
      case 'settings':
        onOpenSettings()
        break
    }
  }, [contextMenu, handleOpenIcon, handleAutoArrange, handleResetDesktop, handleCreateFile, handleChangeWallpaper, onOpenTerminal, onOpenSettings])

  // Keyboard: Delete key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && selectedIcons.size > 0) {
        handleDeleteSelected()
      }
      if (e.key === 'Escape') {
        setContextMenu(null)
        setIsCreatingFile(false)
        setSelectedIcons(new Set())
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedIcons, handleDeleteSelected])

  const wallpaperClass = wallpaper.type === 'gradient'
    ? `bg-gradient-to-br ${wallpaper.value}`
    : wallpaper.type === 'solid'
      ? wallpaper.value
      : ''

  return (
    <div
      ref={canvasRef}
      className={`fixed inset-0 overflow-hidden ${wallpaperClass}`}
      style={{ top: 0, bottom: 48 }} // Leave room for taskbar
      onClick={handleCanvasClick}
      onContextMenu={handleContextMenu}
    >
      {/* Starfield — ambient twinkling stars */}
      <DesktopStarfield />

      {/* Neural Field minimap removed — takes over screen with empty view */}

      {/* Subtle grid pattern overlay */}
      <div className="desktop-bg absolute inset-0 pointer-events-none opacity-[0.03] z-[2]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
          backgroundSize: `${GRID_SIZE_X}px ${GRID_SIZE_Y}px`,
        }}
      />

      {/* Ambient glow effects */}
      <div className="absolute inset-0 pointer-events-none z-[3]">
        <div className="absolute top-1/4 left-1/3 w-[600px] h-[400px] bg-[#5EC9CC]/5 rounded-full blur-[150px]" />
        <div className="absolute bottom-1/3 right-1/4 w-[500px] h-[350px] bg-cyan-600/5 rounded-full blur-[120px]" />
      </div>

      {/* Desktop Icons - z-index ensures they are above background effects */}
      {visibleIcons.map(icon => (
        <div key={icon.id} data-icon-id={icon.id} className="z-[10]">
          <DesktopIconView
            icon={icon}
            isSelected={selectedIcons.has(icon.id)}
            onSelect={(e) => {
              e.stopPropagation()
              if (e.ctrlKey || e.metaKey) {
                setSelectedIcons(prev => {
                  const next = new Set(prev)
                  if (next.has(icon.id)) next.delete(icon.id)
                  else next.add(icon.id)
                  return next
                })
              } else {
                setSelectedIcons(new Set([icon.id]))
              }
            }}
            onOpen={() => handleOpenIcon(icon)}
            onDragEnd={(x, y) => handleIconDragEnd(icon.id, x, y)}
          />
        </div>
      ))}

      {/* New file name input overlay */}
      <AnimatePresence>
        {isCreatingFile && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed inset-0 flex items-center justify-center z-[200] bg-black/40 backdrop-blur-sm"
            onClick={() => setIsCreatingFile(false)}
          >
            <div
              className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 shadow-2xl w-80"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <FilePlus className="w-4 h-4 text-blue-400" />
                Create New File
              </h3>
              <input
                autoFocus
                type="text"
                value={newFileName}
                onChange={e => setNewFileName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newFileName.trim()) {
                    handleCreateFile(newFileName.trim(), 'file')
                  }
                  if (e.key === 'Escape') setIsCreatingFile(false)
                }}
                placeholder="filename.txt"
                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:ring-2 focus:ring-[#5EC9CC]/50"
              />
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => {
                    if (newFileName.trim()) handleCreateFile(newFileName.trim(), 'file')
                  }}
                  className="flex-1 bg-[#5EC9CC] hover:bg-[#7AD6D8] text-[#050507] text-xs py-1.5 rounded-lg font-medium transition-colors"
                >
                  Create File
                </button>
                <button
                  onClick={() => {
                    if (newFileName.trim()) handleCreateFile(newFileName.trim(), 'folder')
                    else handleCreateFile('New Folder', 'folder')
                  }}
                  className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white text-xs py-1.5 rounded-lg font-medium transition-colors"
                >
                  Create Folder
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Context Menu */}
      <DesktopContextMenu
        isOpen={contextMenu !== null}
        position={contextMenu || { x: 0, y: 0 }}
        targetIcon={contextMenu?.targetIcon}
        onAction={handleContextMenuAction}
        onClose={() => setContextMenu(null)}
        wallpaperPresets={WALLPAPER_PRESETS.map(p => p.name)}
      />
    </div>
  )
}
