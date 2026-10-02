'use client'

/**
 * SpotlightSearch
 * ================
 *
 * macOS Spotlight-style universal search overlay.
 * Searches across apps, files, settings, agents, and services.
 *
 * Activated with Cmd/Ctrl+Space or from the taskbar search button.
 *
 * Features:
 *  - Instant app/widget filtering from manifest
 *  - Recent launches
 *  - AI query fallback (if no exact match, asks the AI)
 *  - Category sections (Apps, Files, Settings, Agents)
 *  - Keyboard navigation (arrow keys + enter)
 *  - Beautiful blur + glassmorphism
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Terminal, Brain, Bot, Sparkles, Code2, Folder, Globe,
  Monitor, Calculator, FileText, Settings, Eye, Shield, Zap,
  Palette, Image, Music, Film, Activity, HardDrive, Network,
  ArrowRight, CornerDownLeft, ChevronUp, ChevronDown,
  Wand2, Radio, Feather, Library, Gamepad2, GitBranch,
  MessageSquare, Flame, Database, Cpu, Gauge, Workflow, PlugZap,
  Key, Layers, Clock, Bell, FolderOpen, FileEdit, Camera,
  CloudSun, Paintbrush, Package, Users, FlaskConical, PenTool,
  Scale, Server, Wrench, User, BookOpen, Box, ShieldCheck,
} from 'lucide-react'
import { ALL_APPS, type AitherApp } from '../../data/apps-manifest'
import { useAppCatalog } from '../../contexts/app-catalog-context'

// ============================================================================
// ICON MAP (same as start-menu)
// ============================================================================

const ICON_MAP: Record<string, React.ElementType> = {
  brain: Brain, terminal: Terminal, settings: Settings, folder: Folder,
  'folder-open': FolderOpen, bot: Bot, sparkles: Sparkles, radio: Radio,
  feather: Feather, library: Library, 'wand-2': Wand2, wand: Wand2,
  gamepad: Gamepad2, 'git-branch': GitBranch, activity: Activity,
  'hard-drive': HardDrive, network: Network, eye: Eye,
  'message-square': MessageSquare, 'code-2': Code2, flame: Flame,
  shield: Shield, 'shield-check': ShieldCheck, zap: Zap, globe: Globe, monitor: Monitor,
  palette: Palette, key: Key, mail: MessageSquare, workflow: Workflow,
  'plug-zap': PlugZap, gauge: Gauge, layers: Layers, database: Database,
  'file-text': FileText, cpu: Cpu, clock: Clock, bell: Bell,
  'file-edit': FileEdit, calculator: Calculator, camera: Camera,
  'cloud-sun': CloudSun, image: Image, 'pen-tool': PenTool, box: Box,
  music: Music, film: Film, clipboard: FileText, package: Package,
  users: Users, 'flask-conical': FlaskConical, search: Search,
  scale: Scale, server: Server, wrench: Wrench, user: User,
  'layout-dashboard': Layers, telescope: GitBranch,
  'graduation-cap': BookOpen, cog: Settings, rocket: Zap, wallet: Gauge,
  'monitor-smartphone': Monitor, paintbrush: Paintbrush,
}

// ============================================================================
// SEARCH RESULT TYPES
// ============================================================================

interface SearchResult {
  id: string
  type: 'app' | 'action' | 'agent' | 'setting' | 'ai-query'
  title: string
  subtitle?: string
  icon: React.ElementType
  iconColor: string
  widgetId?: string
  href?: string
  action?: () => void
}

// Category colors
const CATEGORY_COLORS: Record<string, string> = {
  core: 'text-zinc-400', agents: 'text-[#5EC9CC]', creative: 'text-pink-400',
  dev: 'text-cyan-400', social: 'text-blue-400', labs: 'text-amber-400',
  monitor: 'text-green-400', infra: 'text-orange-400', admin: 'text-red-400',
  utility: 'text-emerald-400',
}

// Quick actions
const QUICK_ACTIONS: SearchResult[] = [
  { id: 'qa-terminal', type: 'action', title: 'Open Terminal', subtitle: 'Launch a terminal session', icon: Terminal, iconColor: 'text-green-400', widgetId: 'terminal' },
  { id: 'qa-ai', type: 'action', title: 'Ask AI', subtitle: 'Open AI command palette', icon: Brain, iconColor: 'text-[#5EC9CC]', action: undefined }, // wired at use site
  { id: 'qa-files', type: 'action', title: 'File Manager', subtitle: 'Browse files', icon: Folder, iconColor: 'text-amber-400', widgetId: 'filesystem' },
  { id: 'qa-settings', type: 'action', title: 'Settings', subtitle: 'System preferences', icon: Settings, iconColor: 'text-zinc-400', widgetId: 'settings' },
]

// ============================================================================
// COMPONENT
// ============================================================================

interface SpotlightSearchProps {
  isOpen: boolean
  onClose: () => void
  onOpenWidget: (widgetId: string) => void
  onNavigate: (path: string) => void
  onOpenCommandPalette: () => void
}

export function SpotlightSearch({
  isOpen,
  onClose,
  onOpenWidget,
  onNavigate,
  onOpenCommandPalette,
}: SpotlightSearchProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Catalog scoping — search must not surface an app this deployment does not
  // ship. Spotlight is a second, independent launcher: filtering only the Start
  // Menu would leave every hidden app one Ctrl+K away.
  const { isAllowed, extraApps } = useAppCatalog()

  // Host-contributed apps are searchable too. Omitting them would make Spotlight
  // disagree with the Start Menu about what exists — and Spotlight is the faster
  // path, so the tenant's own panels would be the only ones it could not find.
  const hostResults = useMemo((): SearchResult[] =>
    extraApps.map(app => ({
      id: app.id,
      type: 'app' as const,
      title: app.name,
      subtitle: app.description || app.category,
      icon: ICON_MAP[app.icon] || Monitor,
      iconColor: CATEGORY_COLORS[app.category as keyof typeof CATEGORY_COLORS] || 'text-zinc-400',
      widgetId: app.widgetId,
      href: undefined,
    })), [extraApps])

  // Build searchable app list from manifest
  const searchableApps = useMemo((): SearchResult[] => {
    return ALL_APPS
      .filter(app => app.id !== 'dashboard' && app.id !== 'desktop' && !app.id.startsWith('dw-'))
      .filter(app => app.desktopWidget || app.route)
      .filter(app => isAllowed({ id: app.id, hasWidget: !!app.desktopWidget }))
      .map((app): SearchResult => ({
        id: app.id,
        type: 'app' as const,
        title: app.name,
        subtitle: app.description || app.category,
        icon: ICON_MAP[app.icon] || Monitor,
        iconColor: CATEGORY_COLORS[app.category] || 'text-zinc-400',
        widgetId: app.desktopWidget?.widgetId,
        href: app.route,
      }))
      .concat(hostResults.filter(h => !ALL_APPS.some(a => a.id === h.id)))
  }, [isAllowed, hostResults])

  // Filter results
  const results = useMemo((): SearchResult[] => {
    if (!query.trim()) {
      // Show quick actions + recent (top 8 apps)
      return [
        ...QUICK_ACTIONS.map(qa => ({
          ...qa,
          action: qa.id === 'qa-ai' ? onOpenCommandPalette : qa.action,
        })),
      ]
    }

    const q = query.toLowerCase()
    const matched = searchableApps.filter(app =>
      app.title.toLowerCase().includes(q) ||
      app.subtitle?.toLowerCase().includes(q) ||
      app.id.toLowerCase().includes(q)
    )

    // Add an "Ask AI" fallback if no exact matches
    if (matched.length === 0) {
      return [{
        id: 'ai-query',
        type: 'ai-query',
        title: `Ask AI: "${query}"`,
        subtitle: 'Send this to the AI assistant',
        icon: Brain,
        iconColor: 'text-[#5EC9CC]',
        action: () => {
          onClose()
          onOpenCommandPalette()
        },
      }]
    }

    // Limit to 12 results
    return matched.slice(0, 12)
  }, [query, searchableApps, onOpenCommandPalette, onClose])

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [results.length])

  // Focus input when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const selected = results[selectedIndex]
      if (selected) activateResult(selected)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [results, selectedIndex, onClose])

  // Scroll selected into view
  useEffect(() => {
    if (!listRef.current) return
    const items = listRef.current.querySelectorAll('[data-spotlight-item]')
    const item = items[selectedIndex] as HTMLElement
    if (item) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedIndex])

  const activateResult = useCallback((result: SearchResult) => {
    onClose()
    if (result.action) {
      result.action()
    } else if (result.widgetId) {
      onOpenWidget(result.widgetId)
    } else if (result.href) {
      onNavigate(result.href)
    }
  }, [onClose, onOpenWidget, onNavigate])

  // Global shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Space or Cmd+Space
      if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
        e.preventDefault()
        if (isOpen) onClose()
        else { /* parent handles opening */ }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[350] bg-black/40 backdrop-blur-md"
            onClick={onClose}
          />

          {/* Spotlight Panel */}
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.98 }}
            transition={{ type: 'spring', damping: 30, stiffness: 400 }}
            className="fixed top-[18%] left-1/2 -translate-x-1/2 z-[351] w-[580px] max-w-[90vw]
              bg-zinc-900/95 backdrop-blur-3xl rounded-2xl border border-white/[0.08]
              shadow-[0_25px_60px_rgba(0,0,0,0.5),0_0_40px_rgba(94,201,204,0.05)]
              overflow-hidden"
          >
            {/* Search Input */}
            <div className="flex items-center gap-3 px-5 h-14 border-b border-white/[0.06]">
              <Search className="w-5 h-5 text-zinc-500 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search apps, files, actions..."
                className="flex-1 bg-transparent text-base text-zinc-100 placeholder:text-zinc-600
                  outline-none font-light"
                autoComplete="off"
                spellCheck={false}
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="text-zinc-600 hover:text-zinc-400 transition-colors text-xs px-1.5 py-0.5 rounded bg-zinc-800/50"
                >
                  ESC
                </button>
              )}
            </div>

            {/* Results */}
            <div ref={listRef} className="max-h-[400px] overflow-y-auto py-2 scrollbar-none">
              {results.length === 0 && query ? (
                <div className="py-8 text-center">
                  <Search className="w-8 h-8 text-zinc-800 mx-auto mb-2" />
                  <p className="text-xs text-zinc-600">No results for &ldquo;{query}&rdquo;</p>
                </div>
              ) : (
                <>
                  {!query && (
                    <div className="px-4 py-1 text-[10px] text-zinc-600 font-semibold uppercase tracking-wider">
                      Quick Actions
                    </div>
                  )}
                  {results.map((result, idx) => {
                    const Icon = result.icon
                    const isSelected = idx === selectedIndex

                    return (
                      <button
                        key={result.id}
                        data-spotlight-item
                        onClick={() => activateResult(result)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          isSelected
                            ? 'bg-[#5EC9CC]/10 border-l-2 border-[#5EC9CC]'
                            : 'border-l-2 border-transparent hover:bg-white/[0.03]'
                        }`}
                      >
                        <div className={`p-1.5 rounded-lg ${
                          isSelected ? 'bg-[#5EC9CC]/20' : 'bg-zinc-800/80'
                        }`}>
                          <Icon className={`w-4 h-4 ${result.iconColor}`} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium truncate ${
                            isSelected ? 'text-zinc-100' : 'text-zinc-300'
                          }`}>
                            {result.title}
                          </div>
                          {result.subtitle && (
                            <div className="text-[11px] text-zinc-600 truncate">{result.subtitle}</div>
                          )}
                        </div>

                        {isSelected && (
                          <div className="flex items-center gap-1 text-[10px] text-zinc-600">
                            <CornerDownLeft className="w-3 h-3" />
                            <span>Open</span>
                          </div>
                        )}
                      </button>
                    )
                  })}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.04] text-[10px] text-zinc-700">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <ChevronUp className="w-3 h-3" /><ChevronDown className="w-3 h-3" /> Navigate
                </span>
                <span className="flex items-center gap-1">
                  <CornerDownLeft className="w-3 h-3" /> Open
                </span>
                <span>ESC Close</span>
              </div>
              <span className="flex items-center gap-1">
                <Brain className="w-3 h-3" /> Powered by AitherOS
              </span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
