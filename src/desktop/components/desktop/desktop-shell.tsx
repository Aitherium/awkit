'use client'

/**
 * DesktopShell
 * ============
 * 
 * The full Linux-desktop-style shell that composes:
 * - Desktop canvas (wallpaper + icons)
 * - Taskbar (bottom bar with running apps)
 * - Start menu (app launcher)
 * - Window manager (floating windows with proper focus stack)
 * - Alt+Tab switcher
 * - Boot sequence animation
 * 
 * Shared across AitherVeil (/desktop route) and AitherDesktop (standalone).
 * Each consuming app provides its own `widgetImportMap` — the dynamic import
 * registry that maps widget IDs to lazy-loaded React components.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef, Component, type ErrorInfo } from 'react'
// Optional Next.js router — only used when no onNavigate prop is provided
let useRouterFromNext: (() => { push: (path: string) => void }) | undefined
try { useRouterFromNext = require('next/navigation').useRouter } catch { /* standalone mode */ }
import { AnimatePresence } from 'framer-motion'
import {
  Brain, Search, Power, RefreshCw, X, Menu, Bot, Code2, Terminal,
  Maximize2, Minimize2, Laptop, Monitor, Zap, Database,
  Layout, Folder, File, ImageIcon, ChevronRight, HardDrive,
  Settings, FileText, Sparkles, Radio, Feather, Library, Wand2, Box,
  AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'

import { WindowManagerProvider, useWindowManager } from '../../contexts/window-manager-context'
import { AppCatalogProvider, useAppCatalog, type AppCatalogScope } from '../../contexts/app-catalog-context'
import { DesktopAgentProvider, useDesktopAgent } from '../../contexts/desktop-agent-context'
import { DesktopCanvas } from './desktop-canvas'
import { Taskbar } from './taskbar'
import { StartMenu } from './start-menu'
import { DashboardOverview } from './dashboard-overview'
import { publishUserActivity } from '../../hooks/useUserActivity'
import { DesktopWindow } from './desktop-window'
import { AltTabSwitcher } from './alt-tab-switcher'
import { BootSequence } from './boot-sequence'
import { WidgetErrorBoundary } from '../error-boundaries/widget-error-boundary'
import { DashboardErrorBoundary } from '../error-boundaries/dashboard-error-boundary'
import { AgentCommandPalette } from './agent-command-palette'
import { AgentContextRegistrar } from './agent-context-registrar'
import { AgentControlBusProvider } from '../../contexts/agent-control-bus'
import { AmbientSensesOverlay } from './ambient-senses-overlay'
import { LockScreen } from './lock-screen'
import { NotificationCenter, type DesktopNotification } from './notification-center'
import { WindowSnapPreview } from './window-snap-preview'
import { SpotlightSearch } from './spotlight-search'
import { useAIDesktopController } from './ai-desktop-controller'
import type { DesktopIdentity } from './account-chip'

// ============================================================================
// PUBLIC API — Types consumed by AitherVeil and AitherDesktop
// ============================================================================

/**
 * A map of widget IDs to async component loaders.
 * Each consuming app provides its own map so the shell is host-agnostic.
 *
 * @example
 * const veilImportMap: WidgetImportMap = {
 *   terminal: () => import('@/components/desktop/desktop-terminal').then(m => m.DesktopTerminal),
 *   brain:    () => import('@/components/dashboard/protocol-command-center').then(m => m.ProtocolCommandCenter),
 *   // ... all 60+ widgets
 * }
 */
export type WidgetImportMap = Record<string, () => Promise<React.ComponentType<any>>>

export interface DesktopShellProps {
  /** Dynamic import map — each host app provides its own widget set */
  widgetImportMap: WidgetImportMap
  /** Optional Settings dialog component. If omitted, settings opens as a notification. */
  SettingsDialog?: React.ComponentType<{ open: boolean; onOpenChange: (open: boolean) => void }>
  /** Optional navigation handler. Defaults to Next.js router.push. */
  onNavigate?: (path: string) => void
  /**
   * Which apps this DEPLOYMENT ships, and whether this host serves the
   * manifest's `route` paths. Omit entirely on AitherVeil — the platform host
   * ships the whole catalogue and has every route. A tenant app passes its
   * entitled set (the brain pack's ACTA-gated `panels` from
   * `/api/config/embed`) plus `hasRoutes: false`.
   *
   * Without this, every host renders the full platform manifest: the Start Menu,
   * Spotlight and the desktop canvas each read `ALL_APPS` directly, so a tenant
   * saw the entire internal platform and every route-only entry navigated the
   * browser out of the SPA. See contexts/app-catalog-context.
   */
  appCatalog?: AppCatalogScope
  /**
   * Windows this HOST provides that the platform manifest does not describe.
   *
   * The registry is built from `apps-manifest.ts`, so opening a widgetId absent
   * from it fails with "Unknown widget". A tenant app's home surface is exactly
   * that case: a tenant's Company Room is an awkit SURFACE, not a panel, and
   * `company-room` was deliberately removed from the manifest (it resolved to no
   * registry entry and rendered nothing). It therefore has to be contributed by
   * the host rather than discovered.
   */
  extraWidgets?: Record<string, { title: string; icon: string; defaultSize: { width: number; height: number } }>
  /**
   * Windows opened on a first-ever boot. Defaults to a terminal and a file
   * browser — right for the platform desktop, wrong for a tenant employee, who
   * should land on their home surface rather than a shell prompt.
   */
  starterWidgets?: readonly string[]
  /**
   * Sign the current user out. Supplied by the host because auth lives there;
   * without it the Start Menu's log-out button navigates to `/login`, an
   * AitherVeil page that does not exist on a tenant origin.
   */
  onSignOut?: () => void
  /**
   * A `?app=<id>` this shell has no window for (after its aliases). The host decides
   * where it goes; Veil hands it to the Living Desktop, which owns those ids. Omitted =
   * the link is a no-op, as before.
   */
  onUnresolvedApp?: (appId: string) => void
  /**
   * Who is signed in, and the sign-in / sign-out / account / devices actions.
   * Renders the taskbar's account chip and the Start Menu's account footer.
   * Supplied by the host because auth lives there; omitted = no chip (a host
   * that has not wired auth must not be shown a guessed identity).
   */
  identity?: DesktopIdentity
}

// ============================================================================
// SETTINGS ERROR BOUNDARY — Shows a dismissible dialog on crash
// ============================================================================

import {
  Dialog as ErrorDialog,
  DialogContent as ErrorDialogContent,
  DialogHeader as ErrorDialogHeader,
  DialogTitle as ErrorDialogTitle,
  DialogDescription as ErrorDialogDescription,
  DialogFooter as ErrorDialogFooter,
} from '../ui/dialog'
import { Button } from '../ui/button'

interface SettingsErrorBoundaryProps {
  onClose: () => void
  children: React.ReactNode
}

interface SettingsErrorBoundaryState {
  hasError: boolean
  errorMessage: string
  retryKey: number
}

class SettingsErrorBoundary extends Component<SettingsErrorBoundaryProps, SettingsErrorBoundaryState> {
  constructor(props: SettingsErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, errorMessage: '', retryKey: 0 }
  }

  static getDerivedStateFromError(error: Error): Partial<SettingsErrorBoundaryState> {
    return { hasError: true, errorMessage: error.message || 'Unknown error' }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[DesktopShell] Settings dialog error:', error, info)
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: '', retryKey: Date.now() })
  }

  handleClose = () => {
    this.setState({ hasError: false, errorMessage: '', retryKey: Date.now() })
    this.props.onClose()
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorDialog open={true} onOpenChange={(open) => { if (!open) this.handleClose() }}>
          <ErrorDialogContent className="max-w-md">
            <ErrorDialogHeader>
              <ErrorDialogTitle className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-amber-500" />
                Settings Unavailable
              </ErrorDialogTitle>
              <ErrorDialogDescription>
                The settings panel failed to load. This usually means backend
                services are starting up or temporarily unavailable.
              </ErrorDialogDescription>
            </ErrorDialogHeader>
            <div className="rounded-lg bg-muted/50 p-3 text-xs font-mono text-muted-foreground break-all">
              {this.state.errorMessage}
            </div>
            <ErrorDialogFooter>
              <Button variant="outline" onClick={this.handleClose}>
                Close
              </Button>
              <Button onClick={this.handleRetry}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry
              </Button>
            </ErrorDialogFooter>
          </ErrorDialogContent>
        </ErrorDialog>
      )
    }

    return (
      <React.Fragment key={this.state.retryKey}>
        {this.props.children}
      </React.Fragment>
    )
  }
}

// ============================================================================
// WIDGET REGISTRY — Generated from the unified apps-manifest.ts
// ============================================================================
import { buildWidgetRegistry } from '../../data/apps-manifest'
import { resolveDesktopDeepLink } from '../../lib/desktop-deep-link'

// Single source of truth: apps-manifest.ts defines all widget metadata.
// To add a new desktop windowed app, add it to apps-manifest.ts with a
// `desktopWidget` config and it will appear here automatically.
const WIDGET_REGISTRY = buildWidgetRegistry()

// Also include settings (dialog, not a windowed widget in the manifest)
if (!WIDGET_REGISTRY['settings']) {
  WIDGET_REGISTRY['settings'] = { title: 'Settings', icon: 'settings', defaultSize: { width: 600, height: 550 }, component: null }
}

const DESKTOP_SESSION_STORAGE_KEY = 'aitheros-desktop-session-v1'
const DEFAULT_STARTER_WIDGETS = ['terminal', 'filesystem'] as const

interface PersistedDesktopWindow {
  id: string
  type: 'widget'
  position: { x: number; y: number }
  size: { width: number; height: number }
  isMinimized: boolean
  isMaximized: boolean
}

// ============================================================================
// DESKTOP SHELL INNER (Uses WindowManager context)
// ============================================================================

interface DesktopShellInnerProps {
  widgetImportMap: WidgetImportMap
  SettingsDialog?: React.ComponentType<{ open: boolean; onOpenChange: (open: boolean) => void }>
  onNavigateOverride?: (path: string) => void
  extraWidgets?: DesktopShellProps['extraWidgets']
  starterWidgets?: readonly string[]
  onSignOut?: () => void
  onUnresolvedApp?: (appId: string) => void
  identity?: DesktopIdentity
}

function DesktopShellInner({ widgetImportMap, SettingsDialog: SettingsDialogProp, onNavigateOverride, extraWidgets, starterWidgets, onSignOut, onUnresolvedApp, identity }: DesktopShellInnerProps) {
  /**
   * Widget metadata lookup: the platform manifest first, then anything the host
   * contributed. Host entries cannot shadow a manifest widget — a tenant must
   * not be able to redefine a platform app's window under the same id.
   */
  // Read from the catalog context (DesktopShellInner renders inside
  // AppCatalogProvider). `hasRoutes` tells us whether this origin serves real
  // Next.js routes; a static tenant SPA does not.
  const { hasRoutes: catalogHasRoutes, homeWidgetId: catalogHomeWidgetId } = useAppCatalog()
  const resolveWidget = React.useCallback(
    (widgetId: string) => {
      const reg = WIDGET_REGISTRY[widgetId] ?? extraWidgets?.[widgetId] ?? null
      if (!reg) return null
      // WIDGET_REGISTRY is METADATA (title, icon) built from the platform
      // manifest; `widgetImportMap` is what actually has a COMPONENT. A widget
      // present in the first and absent from the second passed this check,
      // opened a window, and rendered the import map's fallback:
      // "<id> is in the app catalogue but this workspace does not ship it."
      //
      // That is the whole bug, and it is why filtering the launcher list did
      // not fix it: resolveWidget feeds session RESTORE, handleOpenWidget and
      // the STARTER widgets too, so a tenant reopened five dead windows on
      // every load (iris, constellation, strata, terminal, brain -- measured
      // live on dgg.aitherium.com 2026-08-16) while mail and agents worked.
      // The desktop ICONS have the same origin: DEFAULT_ICONS is built from
      // the manifest, so a tenant SHIPS icons for widgets it has no code for.
      //
      // `in` (not a truthy read) is required but is NOT sufficient, and this
      // comment used to claim otherwise. A tenant map may be a Proxy whose
      // get-trap returns an "unavailable" placeholder for EVERY key, so
      // `map[id]` is always truthy — `in` defeats that. But `in` fires the HAS
      // trap, and a Proxy can lie there too: one tenant's map shipped
      // `has() { return true }`, so this guard passed for all 263 manifest
      // widgets and a tenant portal reopened dead windows on every load
      // (measured 2026-08-17). The guard reads correctly and asserts nothing
      // when the map it is asking chooses to lie.
      //
      // A host cannot be trusted to answer honestly about itself, so the
      // dishonest shape is pinned by a test beside each tenant map rather than
      // by this comment. See the tenant desktop widget-map specs.
      if (widgetImportMap && !(widgetId in widgetImportMap)) return null
      return reg
    },
    [extraWidgets, widgetImportMap],
  )
  const {
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
  } = useWindowManager()

  const router = useRouterFromNext ? useRouterFromNext() : { push: (path: string) => { window.location.href = path } }
  const [isStartMenuOpen, setIsStartMenuOpen] = useState(false)
  // The Dashboard surface for hosts with no /dashboard route (every tenant).
  const [isDashboardOpen, setIsDashboardOpen] = useState(false)
  const [isBootComplete, setIsBootComplete] = useState(() => {
    if (typeof window === 'undefined') return false
    return sessionStorage.getItem('aitheros-boot-complete') === '1'
  })
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [hasInitializedDesktop, setHasInitializedDesktop] = useState(false)

  // ── New feature state ─────────────────────────────────────────────────
  const [isLocked, setIsLocked] = useState(false)
  const [isNotificationCenterOpen, setIsNotificationCenterOpen] = useState(false)
  const [isSpotlightOpen, setIsSpotlightOpen] = useState(false)
  const [notifications, setNotifications] = useState<DesktopNotification[]>(() => [
    {
      id: 'welcome',
      title: 'Welcome to AitherOS',
      message: 'Your agentic operating system is ready. Press Ctrl+K for AI, Ctrl+Space for search.',
      icon: 'system',
      timestamp: Date.now(),
      appName: 'System',
    },
    {
      id: 'agents-ready',
      title: 'Agent Fleet Online',
      message: '12 agents initialized and ready for dispatch.',
      icon: 'agent',
      timestamp: Date.now() - 30000,
      appName: 'Constellation',
    },
    {
      id: 'services',
      title: 'Services Status',
      message: 'All core services operational. MicroScheduler routing enabled.',
      icon: 'success',
      timestamp: Date.now() - 120000,
      appName: 'Watch',
    },
  ])

  const addNotification = useCallback((title: string, message: string, icon: DesktopNotification['icon'] = 'info') => {
    setNotifications(prev => [{
      id: `notif-${Date.now()}`,
      title,
      message,
      icon,
      timestamp: Date.now(),
    }, ...prev])
  }, [])

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }, [])

  const clearAllNotifications = useCallback(() => {
    setNotifications([])
  }, [])

  const persistDesktopSession = useCallback((nextWindows: typeof windows) => {
    if (typeof window === 'undefined') return

    const serializableWindows: PersistedDesktopWindow[] = nextWindows
      .filter(win => win.type === 'widget')
      .map(win => ({
        id: win.id,
        type: 'widget',
        position: win.position,
        size: win.size,
        isMinimized: win.isMinimized,
        isMaximized: win.isMaximized,
      }))

    window.localStorage.setItem(DESKTOP_SESSION_STORAGE_KEY, JSON.stringify(serializableWindows))
  }, [])

  // Dynamically loaded widget components cache
  const [loadedWidgets, setLoadedWidgets] = useState<Record<string, React.ComponentType<any>>>({})

  // Load a widget component dynamically using the host-provided import map
  const loadWidget = useCallback(async (widgetId: string) => {
    if (loadedWidgets[widgetId]) return loadedWidgets[widgetId]

    const loader = widgetImportMap[widgetId]
    if (!loader) return null

    try {
      const Component = await loader()
      setLoadedWidgets(prev => ({ ...prev, [widgetId]: Component }))
      return Component
    } catch (err) {
      console.error(`Failed to load widget ${widgetId}:`, err)
      return null
    }
  }, [loadedWidgets])

  // Open a widget as a desktop window
  const handleOpenWidget = useCallback(async (widgetId: string) => {
    // Settings opens as a dialog overlay, not a window
    if (widgetId === 'settings') {
      setIsSettingsOpen(true)
      return
    }

    const reg = resolveWidget(widgetId)
    if (!reg) {
      toast.error(`Unknown widget: ${widgetId}`)
      return
    }

    // Load the component if not already loaded
    await loadWidget(widgetId)

    // Publish what the user is DOING onto the event spine, so other apps and the
    // agent can react. Fire-and-forget on purpose: opening a window must never
    // wait on -- or fail because of -- the event bus. publishUserActivity returns
    // a reason rather than throwing, and is a deliberate no-op on hosts with no
    // server (the tenant SPAs), so this is safe everywhere the shell runs.
    void publishUserActivity({ action: 'app_opened', appId: widgetId }, catalogHasRoutes)

    // Center new windows on screen with cascade offset
    const existingCount = windows.length
    const cascadeOffset = (existingCount % 6) * 28
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1920
    const vh = typeof window !== 'undefined' ? window.innerHeight : 1080
    // Clamp the opening size to the VIEWPORT. defaultSize is authored for a
    // roomy desktop -- Company Room asks for a wide window -- and it was used
    // verbatim, so on a narrow screen the window opened wider than the display
    // with its right-hand side off the edge and unreachable. Reported exactly
    // that way. 48px is the taskbar; the margins keep the frame's own chrome
    // (title bar, resize handles) reachable.
    const maxW = Math.max(320, vw - 32)
    const maxH = Math.max(240, vh - 48 - 24)
    const openSize = {
      width: Math.min(reg.defaultSize.width, maxW),
      height: Math.min(reg.defaultSize.height, maxH),
    }
    const cx = Math.max(16, Math.round((vw - openSize.width) / 2) + cascadeOffset)
    const cy = Math.max(12, Math.round((vh - openSize.height - 48) / 2) + cascadeOffset)

    openWindow({
      id: widgetId,
      title: reg.title,
      icon: reg.icon,
      type: 'widget',
      position: { x: cx, y: cy },
      size: openSize,
      isMinimized: false,
      isMaximized: false,
    })
  }, [windows.length, openWindow, loadWidget])

  const handleOpenTerminal = useCallback(() => {
    handleOpenWidget('terminal')
  }, [handleOpenWidget])

  const handleOpenSettings = useCallback(() => {
    setIsSettingsOpen(true)
  }, [])

  // Open a file in a file editor window
  const handleOpenFile = useCallback(async (fileId: string, fileName: string) => {
    const windowId = `file:${fileId}`

    // Load the file editor component
    await loadWidget('file-editor')

    const existingCount = windows.length
    const cascadeOffset = (existingCount % 8) * 30

    openWindow({
      id: windowId,
      title: fileName,
      icon: 'file',
      type: 'file',
      position: { x: 150 + cascadeOffset, y: 80 + cascadeOffset },
      size: { width: 650, height: 500 },
      isMinimized: false,
      isMaximized: false,
      filePath: `aither://desktop/${fileName}`,
      fileContent: fileId,   // pass fileId via fileContent field for the renderer
    })
  }, [windows.length, openWindow, loadWidget])

  const handleNavigate = useCallback((path: string) => {
    if (onNavigateOverride) {
      onNavigateOverride(path)
    } else {
      router.push(path)
    }
  }, [router, onNavigateOverride])

  useEffect(() => {
    if (!isBootComplete || hasInitializedDesktop) return

    let cancelled = false

    const restoreOrSeedDesktop = async () => {
      const savedSessionRaw = window.localStorage.getItem(DESKTOP_SESSION_STORAGE_KEY)

      if (savedSessionRaw) {
        try {
          const savedSession = JSON.parse(savedSessionRaw) as PersistedDesktopWindow[]
          const restorableWindows = savedSession.filter(win => resolveWidget(win.id))

          if (restorableWindows.length > 0) {
            for (const win of restorableWindows) {
              if (cancelled) return

              await loadWidget(win.id)
              const reg = resolveWidget(win.id)!
              openWindow({
                id: win.id,
                title: reg.title,
                icon: reg.icon,
                type: 'widget',
                position: win.position,
                size: win.size,
                isMinimized: win.isMinimized,
                isMaximized: win.isMaximized,
              })
            }

            addNotification('Desktop Restored', `Reopened ${restorableWindows.length} app${restorableWindows.length === 1 ? '' : 's'} from your last session.`, 'success')
            setHasInitializedDesktop(true)
            return
          }
        } catch (error) {
          console.warn('[DesktopShell] Failed to restore desktop session:', error)
          window.localStorage.removeItem(DESKTOP_SESSION_STORAGE_KEY)
        }
      }

      const starters = starterWidgets ?? DEFAULT_STARTER_WIDGETS
      for (const [index, widgetId] of [...starters].entries()) {
        if (cancelled) return

        const reg = resolveWidget(widgetId)
        if (!reg) continue

        await loadWidget(widgetId)

        openWindow({
          id: widgetId,
          title: reg.title,
          icon: reg.icon,
          type: 'widget',
          position: { x: 72 + index * 42, y: 72 + index * 32 },
          size: { ...reg.defaultSize },
          isMinimized: false,
          isMaximized: false,
        })
      }

      addNotification('Starter Workspace Ready', 'Opened Files and Terminal so the desktop is ready to use immediately.', 'info')
      setHasInitializedDesktop(true)
    }

    void restoreOrSeedDesktop()

    return () => {
      cancelled = true
    }
  }, [isBootComplete, hasInitializedDesktop, loadWidget, openWindow, addNotification])

  // `?app=<id>` deep link (e.g. aitherium.com/desktop?app=darkmatters): once the desktop has
  // restored or seeded its windows, open that app on top. This shell never read ?app=, so
  // the link landed on Files + Terminal. resolveWidget covers host extraWidgets too (Veil's
  // Dark Matters, Media Forge...). An alias opens its widget (elysium = gobbonet); any other
  // well-formed id goes to the host's onUnresolvedApp (Veil: the Living Desktop), never a toast.
  const deepLinkFired = useRef(false)
  useEffect(() => {
    if (!hasInitializedDesktop || deepLinkFired.current) return
    deepLinkFired.current = true
    try {
      const link = resolveDesktopDeepLink(window.location.search, id => !!resolveWidget(id))
      if (link?.kind === 'widget') void handleOpenWidget(link.widgetId)
      else if (link?.kind === 'handoff') onUnresolvedApp?.(link.appId)
    } catch { /* a malformed URL must never break the desktop */ }
  }, [hasInitializedDesktop, handleOpenWidget, resolveWidget, onUnresolvedApp])

  useEffect(() => {
    if (!isBootComplete || !hasInitializedDesktop) return
    persistDesktopSession(windows)
  }, [windows, isBootComplete, hasInitializedDesktop, persistDesktopSession])

  // Alt+Tab keyboard handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'Tab') {
        e.preventDefault()
        if (!isAltTabOpen) {
          startAltTab()
        } else {
          cycleAltTab(e.shiftKey ? 'prev' : 'next')
        }
      }
      if (isAltTabOpen && e.key === 'Enter') {
        commitAltTab()
      }
      if (isAltTabOpen && e.key === 'Escape') {
        cancelAltTab()
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isAltTabOpen && e.key === 'Alt') {
        commitAltTab()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [isAltTabOpen, startAltTab, cycleAltTab, commitAltTab, cancelAltTab])

  // ── Agent integration: track active window ───────────────────────────
  const agentCtx = useDesktopAgent()

  useEffect(() => {
    agentCtx.setActiveWindowId(focusedWindowId)
  }, [focusedWindowId, agentCtx])

  // Ctrl+J → toggle agent sidebar for focused window
  useEffect(() => {
    const handleAgentKeys = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'j' && focusedWindowId) {
        e.preventDefault()
        agentCtx.toggleWindowAgent(focusedWindowId)
      }
    }
    window.addEventListener('keydown', handleAgentKeys)
    return () => window.removeEventListener('keydown', handleAgentKeys)
  }, [focusedWindowId, agentCtx])

  // Ctrl+Space → Spotlight search
  useEffect(() => {
    const handleSpotlight = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
        e.preventDefault()
        setIsSpotlightOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleSpotlight)
    return () => window.removeEventListener('keydown', handleSpotlight)
  }, [])

  // AI Desktop Controller
  const aiController = useAIDesktopController({
    openWidget: handleOpenWidget,
    closeWindow,
    focusWindow,
    snapWindow,
    maximizeWindow,
    minimizeWindow,
    changeWallpaper: (name) => {
      addNotification('Wallpaper Changed', `Switched to ${name}`, 'success')
    },
    toggleFeature: (feature) => {
      addNotification('Feature Toggled', `${feature} has been toggled`, 'info')
    },
    showNotification: (title, message, icon) => {
      addNotification(title, message, (icon as any) || 'info')
    },
    lockScreen: () => setIsLocked(true),
    openSettings: () => setIsSettingsOpen(true),
    getWindows: () => windows.map(w => ({ id: w.id, title: w.title })),
    getFocusedWindowId: () => focusedWindowId,
  })

  // Boot completion
  const handleBootComplete = useCallback(() => {
    setIsBootComplete(true)
    sessionStorage.setItem('aitheros-boot-complete', '1')
  }, [])

  // Render widget content inside a window
  const renderWidgetContent = (win: { id: string; type: string; fileContent?: string }) => {
    // File windows render the file editor with the fileId
    if (win.type === 'file') {
      const FileEditorComp = loadedWidgets['file-editor']
      if (!FileEditorComp) {
        return (
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mr-3" />
            Loading editor...
          </div>
        )
      }
      return (
        <AgentContextRegistrar windowId={win.id}>
          <WidgetErrorBoundary widgetTitle="File Editor">
            <div className="h-full overflow-hidden">
              <FileEditorComp fileId={win.fileContent} className="h-full" />
            </div>
          </WidgetErrorBoundary>
        </AgentContextRegistrar>
      )
    }

    const Component = loadedWidgets[win.id]
    if (!Component) {
      return (
        <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#5EC9CC] mr-3" />
          Loading...
        </div>
      )
    }

    return (
      <AgentContextRegistrar windowId={win.id}>
        <WidgetErrorBoundary widgetTitle={WIDGET_REGISTRY[win.id]?.title || win.id}>
          <div className="h-full p-3 overflow-auto">
            <Component
              className="h-full"
              onOpenWidget={handleOpenWidget}
              onNavigate={handleNavigate}
            />
          </div>
        </WidgetErrorBoundary>
      </AgentContextRegistrar>
    )
  }

  // Icon to React element mapping
  const getIconElement = (iconName: string) => {
    const iconMap: Record<string, React.ReactNode> = {
      brain: <Brain className="w-3.5 h-3.5 text-[#5EC9CC]" />,
      terminal: <Terminal className="w-3.5 h-3.5 text-green-400" />,
      settings: <Settings className="w-3.5 h-3.5 text-zinc-400" />,
      folder: <Folder className="w-3.5 h-3.5 text-amber-400" />,
      file: <FileText className="w-3.5 h-3.5 text-blue-400" />,
      sparkles: <Sparkles className="w-3.5 h-3.5 text-[#5EC9CC]" />,
      radio: <Radio className="w-3.5 h-3.5 text-rose-400" />,
      feather: <Feather className="w-3.5 h-3.5 text-[#5EC9CC]" />,
      library: <Library className="w-3.5 h-3.5 text-amber-400" />,
      wand: <Wand2 className="w-3.5 h-3.5 text-[#5EC9CC]" />,
      code: <Code2 className="w-3.5 h-3.5 text-cyan-400" />,
      bot: <Bot className="w-3.5 h-3.5 text-blue-400" />,
      zap: <Zap className="w-3.5 h-3.5 text-yellow-400" />,
      database: <Database className="w-3.5 h-3.5 text-[#5EC9CC]" />,
      box: <Box className="w-3.5 h-3.5 text-[#5EC9CC]" />,
    }
    return iconMap[iconName] || <Monitor className="w-3.5 h-3.5 text-zinc-400" />
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-black">
      {/* Boot Sequence */}
      <AnimatePresence>
        {!isBootComplete && (
          <BootSequence onComplete={handleBootComplete} />
        )}
      </AnimatePresence>

      {/* Lock Screen */}
      <AnimatePresence>
        {isBootComplete && isLocked && (
          <LockScreen onUnlock={() => setIsLocked(false)} />
        )}
      </AnimatePresence>

      {/* Desktop Canvas */}
      {isBootComplete && (
        <>
          <DesktopCanvas
            onOpenWidget={handleOpenWidget}
            onOpenFile={handleOpenFile}
            onOpenTerminal={handleOpenTerminal}
            onOpenSettings={handleOpenSettings}
            onNavigate={handleNavigate}
          />

          {/* Window Snap Preview */}
          <WindowSnapPreview zone={activeSnapZone} />

          {/* Desktop Windows */}
          {windows.map(win => (
            <DesktopWindow
              key={win.id}
              id={win.id}
              title={win.title}
              icon={getIconElement(win.icon)}
              position={win.position}
              size={win.size}
              isMinimized={win.isMinimized}
              isMaximized={win.isMaximized}
              isFocused={win.isFocused}
              zIndex={win.zIndex}
              onFocus={() => focusWindow(win.id)}
              onClose={() => closeWindow(win.id)}
              onMinimize={() => minimizeWindow(win.id)}
              onMaximize={() => maximizeWindow(win.id)}
              onRestore={() => restoreWindow(win.id)}
              onPositionChange={(pos) => updateWindowPosition(win.id, pos)}
              onSizeChange={(size) => updateWindowSize(win.id, size)}
              onSnapZoneChange={(zone) => setActiveSnapZone(zone)}
              onSnapCommit={(zone) => { if (zone) snapWindow(win.id, zone) }}
            >
              {renderWidgetContent(win)}
            </DesktopWindow>
          ))}

          {/* Taskbar */}
          <Taskbar
            windows={windows.map(w => ({
              id: w.id,
              title: w.title,
              icon: w.icon,
              isMinimized: w.isMinimized,
              isFocused: w.isFocused,
            }))}
            onFocusWindow={focusWindow}
            onMinimizeWindow={minimizeWindow}
            onOpenStartMenu={() => setIsStartMenuOpen(!isStartMenuOpen)}
            onOpenSearch={() => setIsSpotlightOpen(true)}
            onOpenWidget={handleOpenWidget}
            onToggleMode={() => {
              // It is a TOGGLE, and it did not toggle: it navigated to
              // /dashboard unconditionally, so from the dashboard it could
              // never bring you back to the Living OS desktop. The button even
              // relabels itself "Desktop" in that state while still going to
              // /dashboard. Reported by the owner as "the Dashboard button
              // doesn't properly open the AitherOS Living OS desktop".
              //
              // /desktop is that surface -- it renders this same DesktopShell
              // with Veil's full widget import map. Both routes exist on the
              // platform; neither exists on a static tenant origin, where the
              // catch-all serves index.html and nothing happens, so there the
              // workspace's own home surface is the honest answer.
              //
              // Earlier attempts, for the record: navigate unconditionally
              // (dead on a tenant), then hide the control entirely (worse -- it
              // vanished), then always open the home widget (ignored the
              // platform's real routes).
              // NOTE the asymmetry, deliberately left: this component IS the
              // desktop (it renders at /desktop and passes mode="desktop" as a
              // literal), so there is no mode state here to toggle against and
              // the only correct destination from here is /dashboard. Getting
              // BACK to the Living OS desktop is the dashboard page's own
              // control, not this one. Wiring a mode check here compiled to
              // "Cannot find name 'mode'" because the prop is a constant.
              // UPDATE 2026-08-17: the `homeWidgetId` fallback below was still a
              // no-op in the commonest case. On dgg it resolves to `room` -- the
              // Company Room -- which is the window already on screen, so the
              // handler ran, focused the right window, and changed nothing
              // visible. That is what "Dashboard still doesn't work at all"
              // means: not an unhandled click, a handled one with nowhere to go.
              // There was no dashboard surface in desktop-core to open;
              // DashboardOverview is now that surface.
              if (catalogHasRoutes) {
                handleNavigate('/dashboard')
              } else {
                setIsDashboardOpen(v => !v)
              }
            }}
            mode={isDashboardOpen ? 'dashboard' : 'desktop'}
            identity={identity}
            onOpenSettings={handleOpenSettings}
            onLock={() => setIsLocked(true)}
          />

          {/* Dashboard — the surface the taskbar's Dashboard button opens on a
              host with no /dashboard route. Rendered above the windows and BELOW
              the taskbar, so the button that toggles it stays reachable. */}
          <AnimatePresence>
            {isDashboardOpen && (
              <DashboardOverview
                openWindowIds={windows.map(w => w.id)}
                onOpenWidget={handleOpenWidget}
                onNavigate={handleNavigate}
                onClose={() => setIsDashboardOpen(false)}
              />
            )}
          </AnimatePresence>

          {/* Start Menu */}
          <StartMenu
            isOpen={isStartMenuOpen}
            onClose={() => setIsStartMenuOpen(false)}
            onOpenWidget={handleOpenWidget}
            onOpenTerminal={handleOpenTerminal}
            onOpenSettings={handleOpenSettings}
            onNavigate={handleNavigate}
            onSignOut={onSignOut}
            identity={identity}
          />

          {/* Alt+Tab Switcher */}
          <AltTabSwitcher
            isOpen={isAltTabOpen}
            windows={windows.map(w => ({
              id: w.id,
              title: w.title,
              icon: w.icon,
              isMinimized: w.isMinimized,
            }))}
            selectedIndex={altTabIndex}
            onSelect={(id) => {
              focusWindow(id)
              cancelAltTab()
            }}
            onClose={cancelAltTab}
          />

          {/* Notification Center */}
          <NotificationCenter
            isOpen={isNotificationCenterOpen}
            onClose={() => setIsNotificationCenterOpen(false)}
            notifications={notifications}
            onDismissNotification={dismissNotification}
            onClearAll={clearAllNotifications}
          />

          {/* Spotlight Search (Ctrl+Space) */}
          <SpotlightSearch
            isOpen={isSpotlightOpen}
            onClose={() => setIsSpotlightOpen(false)}
            onOpenWidget={handleOpenWidget}
            onNavigate={handleNavigate}
            onOpenCommandPalette={() => {
              setIsSpotlightOpen(false)
              agentCtx.openCommandPalette()
            }}
          />

          {/* Settings Dialog — only mounted when open so a crash never leaves a stale
              error card on the desktop surface. Error boundary shows a dismissible dialog. */}
          {isSettingsOpen && SettingsDialogProp && (
            <SettingsErrorBoundary onClose={() => setIsSettingsOpen(false)}>
              <SettingsDialogProp open={true} onOpenChange={setIsSettingsOpen} />
            </SettingsErrorBoundary>
          )}

          {/* Global AI Agent Command Palette (Ctrl+K) */}
          <WidgetErrorBoundary widgetTitle="Command Palette">
            <AgentCommandPalette />
          </WidgetErrorBoundary>

          {/* Ambient Senses Overlay — voice/vision/tasks/approvals */}
          <WidgetErrorBoundary widgetTitle="Ambient Senses">
            <AmbientSensesOverlay />
          </WidgetErrorBoundary>
        </>
      )}
    </div>
  )
}

// ============================================================================
// EXPORTED WRAPPER WITH PROVIDER
// ============================================================================

export function DesktopShell({ widgetImportMap, SettingsDialog: SettingsDialogProp, onNavigate, appCatalog, extraWidgets, starterWidgets, onSignOut, onUnresolvedApp, identity }: DesktopShellProps) {
  return (
    <DashboardErrorBoundary>
      <AppCatalogProvider
        // `?? false` and NOT `?? true`: a host that has not wired auth yet gets
        // the anonymous surface. The opposite default is what showed the entire
        // 263-entry manifest — Workspace Admin, Audit Log, Secrets, Billing —
        // to anyone who loaded the page.
        authenticated={appCatalog?.authenticated ?? false}
        allowedAppIds={appCatalog?.allowedAppIds ?? null}
        hasRoutes={appCatalog?.hasRoutes ?? true}
        homeWidgetId={appCatalog?.homeWidgetId ?? null}
        extraApps={appCatalog?.extraApps}
        // The five gate inputs. Each is optional on AppCatalogScope and
        // defaults CLOSED inside the provider (free tier, deny, no tenant) --
        // but a scope the host DID supply was dropped here, so every app with
        // an rbac/feature/licence/tenant requirement was denied to everyone.
        // CSF001 (check_catalog_scope_forwarded.py) asserts the forwarding.
        tier={appCatalog?.tier}
        can={appCatalog?.can}
        hasFeature={appCatalog?.hasFeature}
        hasLicense={appCatalog?.hasLicense}
        hasTenant={appCatalog?.hasTenant}
      >
        <WindowManagerProvider>
          <DesktopAgentProvider>
            <AgentControlBusProvider>
              <DesktopShellInner
                widgetImportMap={widgetImportMap}
                SettingsDialog={SettingsDialogProp}
                onNavigateOverride={onNavigate}
                extraWidgets={extraWidgets}
                starterWidgets={starterWidgets}
                onSignOut={onSignOut}
                onUnresolvedApp={onUnresolvedApp}
                identity={identity}
              />
            </AgentControlBusProvider>
          </DesktopAgentProvider>
        </WindowManagerProvider>
      </AppCatalogProvider>
    </DashboardErrorBoundary>
  )
}
