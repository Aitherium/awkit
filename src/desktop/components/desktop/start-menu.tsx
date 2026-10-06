'use client'

/**
 * StartMenu
 * =========
 * 
 * Linux-style application launcher / start menu.
 * 
 * **MANIFEST-DRIVEN**: Reads from apps-manifest.ts — the single source of truth.
 * Every app with a `desktopWidget` or a `route` is shown automatically.
 * To add a new app to the Start Menu, add it to apps-manifest.ts.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain, Terminal, Settings, Folder, Bot, Sparkles, Radio,
  Feather, Library, Wand2, Gamepad2, GitBranch, Activity,
  HardDrive, Network, Eye, MessageSquare, Code2, Flame,
  Shield, Zap, Globe, Monitor, Search, Power, LogOut,
  RefreshCw, Palette, Key, Mail, Workflow, PlugZap,
  Gauge, Layers, Database, FileCode, Cpu, Bug, ExternalLink,
  Clock, CheckSquare, Bell, FolderOpen, FileEdit,
  Calculator, Camera, CloudSun, Image, Paintbrush, BookOpen, Box,
  Music, Film, Clipboard, Package, Users, FlaskConical, PenTool,
  Scale, Server, Wrench, User, ShieldCheck, LogIn,
} from 'lucide-react'
import type { DesktopIdentity } from './account-chip'
import { ALL_APPS, CATEGORY_CONFIG, type AitherApp, type AppCategory } from '../../data/apps-manifest'
import { useViewScope } from '../../contexts/view-scope-context'
import { useAppCatalog } from '../../contexts/app-catalog-context'
import { isPlatformScoped } from '../../lib/view-scope'

// ============================================================================
// ICON MAPPING — Lucide icon string → React component
// ============================================================================

const ICON_MAP: Record<string, React.ElementType> = {
  brain: Brain, terminal: Terminal, settings: Settings, folder: Folder,
  'folder-open': FolderOpen, bot: Bot, sparkles: Sparkles, radio: Radio,
  feather: Feather, library: Library, 'wand-2': Wand2, wand: Wand2,
  gamepad: Gamepad2, 'git-branch': GitBranch, activity: Activity,
  'hard-drive': HardDrive, network: Network, eye: Eye,
  'message-square': MessageSquare, 'code-2': Code2, flame: Flame,
  shield: Shield, 'shield-check': ShieldCheck, zap: Zap, globe: Globe, monitor: Monitor,
  palette: Palette, key: Key, mail: Mail, workflow: Workflow,
  'plug-zap': PlugZap, gauge: Gauge, layers: Layers, database: Database,
  'file-text': FileCode, cpu: Cpu, 'calendar-days': Clock, clock: Clock,
  'check-square': CheckSquare, bell: Bell, 'file-edit': FileEdit,
  calculator: Calculator, camera: Camera, 'cloud-sun': CloudSun,
  image: Image, 'pen-tool': PenTool, box: Box, music: Music, film: Film,
  clipboard: Clipboard, package: Package, users: Users,
  'flask-conical': FlaskConical, search: Search, scale: Scale,
  server: Server, wrench: Wrench, 'monitor-smartphone': Monitor,
  user: User, 'layout-dashboard': Layers, telescope: GitBranch,
  'graduation-cap': BookOpen, cog: Settings, rocket: Zap, wallet: Gauge,
}

// Category icon mapping for the sidebar
const CATEGORY_ICONS: Record<string, React.ElementType> = {
  core: Terminal, agents: Bot, creative: Palette, dev: Code2,
  social: Globe, labs: FlaskConical, monitor: Activity, infra: HardDrive,
  admin: Shield, utility: Wrench,
}

// Category color mapping
const CATEGORY_COLORS: Record<string, string> = {
  core: 'text-zinc-400', agents: 'text-[#5EC9CC]', creative: 'text-pink-400',
  dev: 'text-cyan-400', social: 'text-blue-400', labs: 'text-amber-400',
  monitor: 'text-green-400', infra: 'text-orange-400', admin: 'text-red-400',
  utility: 'text-emerald-400',
}

// ============================================================================
// BUILD START MENU APPS FROM MANIFEST
// ============================================================================

interface StartMenuApp {
  id: string
  name: string
  icon: React.ElementType
  category: AppCategory
  color: string
  widgetId?: string
  href?: string
}

/** Build start menu entries from the manifest — includes any app with a desktop widget or a route */
function buildStartMenuApps(): StartMenuApp[] {
  // Skip dashboard/desktop themselves and purely dashboard-widget-only entries (dw-*)
  const excluded = new Set(['dashboard', 'desktop'])
  
  return ALL_APPS
    .filter(app => {
      if (excluded.has(app.id)) return false
      if (app.id.startsWith('dw-')) return false  // Dashboard-only composites
      // Must have a desktop widget or a route to be launchable
      return app.desktopWidget != null || app.route != null
    })
    .map(app => {
      const IconComponent = ICON_MAP[app.icon] || Monitor
      return {
        id: app.id,
        name: app.name,
        icon: IconComponent,
        category: app.category,
        color: CATEGORY_COLORS[app.category] || 'text-zinc-400',
        widgetId: app.desktopWidget?.widgetId,
        href: !app.desktopWidget ? app.route : undefined,
      }
    })
}

const APPS = buildStartMenuApps()

// Build categories dynamically from what's actually in the list
const CATEGORIES = Object.entries(CATEGORY_CONFIG)
  .filter(([cat]) => APPS.some(a => a.category === cat))
  .sort(([, a], [, b]) => a.order - b.order)
  .map(([cat, config]) => ({
    id: cat as AppCategory,
    label: config.label,
    icon: CATEGORY_ICONS[cat] || Monitor,
  }))

interface StartMenuProps {
  isOpen: boolean
  onClose: () => void
  onOpenWidget: (widgetId: string) => void
  onOpenTerminal: () => void
  onOpenSettings: () => void
  onNavigate: (path: string) => void
  /**
   * Host-supplied sign-out. Without it this button navigates to `/login`, which
   * is an AitherVeil page — on a standalone tenant SPA the catch-all serves the
   * app's own index and the user stays signed in, so the desktop's only auth
   * control silently does nothing.
   */
  onSignOut?: () => void
  /**
   * Who is signed in, from the host. When given, the footer names the account and
   * offers Sign in to an anonymous visitor instead of a Log out icon that had
   * nothing to log out of (2026-10-01).
   */
  identity?: DesktopIdentity
}

export function StartMenu({
  isOpen,
  onClose,
  onOpenWidget,
  onOpenTerminal,
  onOpenSettings,
  onNavigate,
  onSignOut,
  identity,
}: StartMenuProps) {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus search on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
      setSearch('')
      setActiveCategory(null)
    }
  }, [isOpen])

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

  // Scope filtering — hide platform apps from tenant/Elysium users
  const { canViewPlatform } = useViewScope()

  // Catalog filtering — what this DEPLOYMENT ships, as opposed to what the
  // platform-wide manifest knows about. Unfiltered for AitherVeil; a tenant app
  // passes its entitled panel set (see app-catalog-context).
  const { isAllowed, hasRoutes, homeWidgetId, extraApps } = useAppCatalog()

  // Everything this host may launch, before the category/search narrowing. The
  // category rail counts from this too, so a category whose apps are all absent
  // disappears instead of opening onto an empty grid.
  //
  // Two halves, and both are load-bearing: the manifest NARROWED to what this
  // deployment ships, plus the apps the host CONTRIBUTES. A tenant's panels are
  // not in the manifest, so subtraction alone empties their launcher.
  const catalogApps = useMemo(() => {
    const fromManifest = APPS.filter(a => isAllowed({ id: a.id, hasWidget: !!a.widgetId }))
    const seen = new Set(fromManifest.map(a => a.id))
    const fromHost: StartMenuApp[] = extraApps
      .filter(a => !seen.has(a.id))
      .map(a => ({
        id: a.id,
        name: a.name,
        icon: ICON_MAP[a.icon] || Monitor,
        category: a.category as AppCategory,
        color: CATEGORY_COLORS[a.category as AppCategory] || 'text-zinc-400',
        widgetId: a.widgetId,
        href: undefined,
      }))
    return [...fromManifest, ...fromHost]
  }, [isAllowed, extraApps])

  // Filter apps
  const filteredApps = useMemo(() => {
    let apps = catalogApps
    // Scope filter: remove platform-only apps for tenant users
    if (!canViewPlatform) {
      apps = apps.filter(a => !isPlatformScoped(a.id, a.category))
    }
    if (activeCategory) {
      apps = apps.filter(a => a.category === activeCategory)
    }
    if (search) {
      const q = search.toLowerCase()
      apps = apps.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
      )
    }
    return apps
  }, [catalogApps, search, activeCategory, canViewPlatform])

  const handleOpenApp = (app: StartMenuApp) => {
    if (app.widgetId === 'terminal') {
      onOpenTerminal()
    } else if (app.widgetId === 'settings') {
      onOpenSettings()
    } else if (app.href) {
      onNavigate(app.href)
    } else if (app.widgetId) {
      onOpenWidget(app.widgetId)
    }
    onClose()
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        ref={menuRef}
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.96 }}
        transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
        className="fixed bottom-14 left-2 w-[min(540px,calc(100vw-1rem))] max-h-[75vh] bg-zinc-950/90 backdrop-blur-2xl border border-white/[0.08] rounded-2xl shadow-2xl shadow-black/60 z-[250] overflow-hidden flex flex-col"
      >
        {/* Search — spotlight style */}
        <div className="p-3 border-b border-white/[0.05]">
          <div className="flex items-center gap-2.5 bg-white/[0.06] rounded-xl px-3.5 py-2.5 ring-1 ring-white/[0.04] focus-within:ring-[#5EC9CC]/30 transition-all">
            <Search className="w-4 h-4 text-zinc-500" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search apps..."
              className="flex-1 bg-transparent text-sm text-white placeholder:text-zinc-500 outline-none"
            />
            {search && (
              <span className="text-[10px] text-zinc-600 font-mono">{filteredApps.length} results</span>
            )}
          </div>
        </div>

        {/* Main panel: sidebar + grid */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* Category sidebar */}
          <div className="w-[140px] border-r border-white/[0.04] py-2 px-1.5 flex flex-col gap-0.5 shrink-0 overflow-y-auto">
            <button
              onClick={() => setActiveCategory(null)}
              className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px] font-medium transition-all w-full text-left
                ${!activeCategory
                  ? 'bg-[#5EC9CC]/15 text-[#5EC9CC] ring-1 ring-[#5EC9CC]/20'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              All Apps
            </button>
            {CATEGORIES.filter(cat => {
              // Hide entirely platform-only categories from tenant users
              if (!canViewPlatform && (['infra', 'monitor', 'admin'] as string[]).includes(cat.id)) return false
              return true
            }).map(cat => {
              const CatIcon = cat.icon
              const count = (canViewPlatform ? catalogApps : catalogApps.filter(a => !isPlatformScoped(a.id, a.category)))
                .filter(a => a.category === cat.id).length
              if (count === 0) return null
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id === activeCategory ? null : cat.id)}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px] font-medium transition-all w-full text-left
                    ${activeCategory === cat.id
                      ? 'bg-[#5EC9CC]/15 text-[#5EC9CC] ring-1 ring-[#5EC9CC]/20'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}
                >
                  <CatIcon className="w-3.5 h-3.5" />
                  <span className="flex-1 truncate">{cat.label}</span>
                  <span className="text-[9px] text-zinc-600 font-mono">{count}</span>
                </button>
              )
            })}
          </div>

          {/* App grid */}
          <div className="flex-1 overflow-y-auto p-3">
            {/* Category title when filtered */}
            {activeCategory && (
              <motion.h3
                key={activeCategory}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold mb-2 px-1"
              >
                {CATEGORIES.find(c => c.id === activeCategory)?.label}
              </motion.h3>
            )}

            {/* gap-2, not gap-1: at 4px the labels of one row sat against the icons of
                the next and the whole grid read as one cramped mass (owner report,
                2026-08-13). 8px gutters let each tile breathe without losing a column. */}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {filteredApps.map(app => {
                const Icon = app.icon
                return (
                  <motion.button
                    key={app.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    onClick={() => handleOpenApp(app)}
                    className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl hover:bg-white/[0.06] active:bg-white/10 transition-all group"
                  >
                    <div className="p-2.5 rounded-xl bg-white/[0.04] group-hover:bg-white/[0.08] transition-colors ring-1 ring-white/[0.03] group-hover:ring-white/[0.06]">
                      <Icon className={`w-5 h-5 ${app.color}`} />
                    </div>
                    <span className="text-[10px] text-zinc-400 group-hover:text-zinc-200 text-center leading-tight truncate w-full transition-colors">
                      {app.name}
                    </span>
                  </motion.button>
                )
              })}
            </div>

            {filteredApps.length === 0 && (
              <div className="text-center py-12 text-zinc-600 text-sm">
                <Search className="w-6 h-6 mx-auto mb-2 text-zinc-700" />
                No apps found for &ldquo;{search}&rdquo;
              </div>
            )}
          </div>
        </div>

        {/* Bottom bar: AitherOS branding + power actions */}
        <div className="border-t border-white/[0.05] px-3 py-2 flex items-center justify-between bg-zinc-950/50">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <div className="p-1 rounded-md bg-gradient-to-br from-[#5EC9CC]/30 to-[#5EC9CC]/30">
              <Brain className="w-3 h-3 text-[#5EC9CC]" />
            </div>
            <span className="font-medium text-zinc-400">AitherOS</span>
            <span className="text-zinc-700">•</span>
            <span className="font-mono text-[10px] text-zinc-600">{catalogApps.length} apps</span>
            {identity?.account && (
              <>
                <span className="text-zinc-700">•</span>
                <span className="max-w-[10rem] truncate text-zinc-400" data-testid="start-menu-account">
                  {identity.account.name}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => { onOpenSettings(); onClose() }}
              className="p-1.5 rounded-md hover:bg-white/10 text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
            {/* `/dashboard` is an AitherVeil PAGE. On a standalone tenant SPA that
                path does not exist, so this navigated the browser out of the app
                and the catch-all served the app's own index — landing the user on
                the pre-redesign surface and reading as "the dashboard is broken".
                A host with no routes opens its home WINDOW instead; a host with
                neither routes nor a home widget does not show the button at all,
                rather than offering a control that cannot work. */}
            {(hasRoutes || homeWidgetId) && (
              <button
                onClick={() => {
                  if (hasRoutes) onNavigate('/dashboard')
                  else if (homeWidgetId) { onOpenWidget(homeWidgetId); onClose() }
                }}
                className="p-1.5 rounded-md hover:bg-white/10 text-zinc-500 hover:text-zinc-300 transition-colors"
                title={hasRoutes ? 'Switch to Dashboard' : 'Open home'}
              >
                <Monitor className="w-3.5 h-3.5" />
              </button>
            )}
            {identity && !identity.account && !identity.loading ? (
              <button
                onClick={() => { onClose(); identity.onSignIn() }}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#5EC9CC] text-[#050507] text-[11px] font-semibold hover:brightness-110 transition-all"
                title="Sign in"
                data-testid="start-menu-sign-in"
              >
                <LogIn className="w-3.5 h-3.5" />
                Sign in
              </button>
            ) : (!identity || identity.account) && (
              <button
                onClick={() => {
                  const out = identity?.onSignOut ?? onSignOut
                  if (out) { out(); onClose() } else onNavigate('/login')
                }}
                className="p-1.5 rounded-md hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-colors"
                title="Log out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
