'use client'

/**
 * Taskbar
 * =======
 * 
 * A persistent bottom taskbar for the desktop mode, inspired by Linux/Windows:
 * - Left: Start menu button + pinned apps
 * - Center: Open window indicators (click to focus/minimize)
 * - Right: System tray (clock, connection status, notifications)
 */

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain, Terminal, Settings, Folder, Bot, Sparkles, Radio,
  Feather, Library, Wand2, Gamepad2, GitBranch, Activity,
  HardDrive, Network, ChevronUp, Search, Wifi, WifiOff,
  Bell, Volume2, Monitor, Moon, Sun, Power,
  LayoutGrid, Maximize2, Minimize2, X, Minus,
  Eye, MessageSquare, Code2, Flame, Shield, ShieldCheck, Zap, Globe, Lock
} from 'lucide-react'
import { SystemTray } from './system-tray'
import { ElysiumSyncIndicator } from './elysium-sync-indicator'
import { AccountChip, type DesktopIdentity } from './account-chip'
import { useAppCatalog } from '../../contexts/app-catalog-context'
import { ALL_APPS } from '../../data/apps-manifest'
// Link was imported but unused — removed to decouple from Next.js

// ============================================================================
// TYPES
// ============================================================================

interface TaskbarWindow {
  id: string
  title: string
  icon: string
  isMinimized: boolean
  isFocused: boolean
}

interface TaskbarProps {
  windows: TaskbarWindow[]
  onFocusWindow: (id: string) => void
  onMinimizeWindow: (id: string) => void
  onOpenStartMenu: () => void
  onOpenSearch: () => void
  onOpenWidget: (widgetId: string) => void
  onToggleMode: () => void
  mode: 'desktop' | 'dashboard'
  /** Who is signed in + the sign-in/out actions, from the host. Omitted = no chip. */
  identity?: DesktopIdentity
  /** Quick Settings -> Settings. */
  onOpenSettings?: () => void
  /** Quick Settings -> Lock. */
  onLock?: () => void
}

/**
 * The PREFERRED pin ORDER — not the pins themselves. See `pinnedApps` below.
 *
 * These are platform apps and this list used to render VERBATIM on every host.
 * A tenant whose catalogue holds two apps (dgg: Chat, Documents) still drew all
 * six, so six of the eight controls on its taskbar opened "Not installed here".
 * That is the most-reported bug on these portals, and it is why gating the Start
 * Menu did not fix it: the launcher was filtered and the taskbar — always on
 * screen, needing no click to find — was not.
 *
 * It fails silently in the way that matters: the icon renders, the click is
 * handled, a window opens, and the window says the app is not installed. No
 * error, no log, nothing unhealthy. It reads as a broken APP rather than as a
 * control that should never have been offered.
 */
// Pinned app shortcuts
interface PinnedApp {
  id: string
  icon: React.ElementType
  label: string
  widgetId: string
  color: string
}

const PINNED_APPS: PinnedApp[] = [
  { id: 'brain', icon: Brain, label: 'Aither Protocol', widgetId: 'brain', color: 'text-[#5EC9CC]' },
  { id: 'terminal', icon: Terminal, label: 'Terminal', widgetId: 'terminal', color: 'text-green-400' },
  { id: 'files', icon: Folder, label: 'Files', widgetId: 'strata', color: 'text-amber-400' },
  { id: 'constellation', icon: Sparkles, label: 'Constellation', widgetId: 'constellation', color: 'text-[#5EC9CC]' },
  { id: 'agents', icon: Bot, label: 'Agent Fleet', widgetId: 'agents', color: 'text-cyan-400' },
  { id: 'iris', icon: Eye, label: 'Iris', widgetId: 'iris', color: 'text-pink-400' },
]

// Icon mapping
const ICON_MAP: Record<string, React.ElementType> = {
  brain: Brain, terminal: Terminal, settings: Settings, folder: Folder,
  bot: Bot, sparkles: Sparkles, radio: Radio, feather: Feather,
  library: Library, wand: Wand2, gamepad: Gamepad2, git: GitBranch,
  activity: Activity, harddrive: HardDrive, network: Network,
  eye: Eye, message: MessageSquare, code: Code2, flame: Flame,
  shield: Shield, 'shield-check': ShieldCheck, zap: Zap, globe: Globe, monitor: Monitor,
}

// ============================================================================
// TASKBAR COMPONENT
// ============================================================================

export function Taskbar({
  windows,
  onFocusWindow,
  onMinimizeWindow,
  onOpenStartMenu,
  onOpenSearch,
  onOpenWidget,
  onToggleMode,
  mode,
  identity,
  onOpenSettings,
  onLock,
}: TaskbarProps) {
  const [hoveredWindow, setHoveredWindow] = useState<string | null>(null)
  // The mode toggle navigates to `/dashboard`, a Next.js route that exists only
  // on the platform origin. A standalone tenant portal (static SPA on Pages)
  // declares `hasRoutes: false`, and there the catch-all serves index.html back
  // — so the button appeared to do NOTHING when clicked, with no error and no
  // navigation. StartMenu already guards the identical call
  // (`if (hasRoutes) onNavigate('/dashboard')`); this control did not.
  // Hidden rather than disabled, for the same reason the launcher no longer
  // lists apps it cannot open: do not offer a control that cannot work.
  const { hasRoutes, isAllowed } = useAppCatalog()

  // Intersect the preferred order with the catalogue — the SAME `isAllowed` the
  // Start Menu uses, so the two surfaces cannot drift apart again.
  //
  // Resolve each pin to its MANIFEST entry first. `allowedAppIds` is keyed by
  // app id, and a pin carries a WIDGET id — they are not the same string
  // ('files' pins widget 'strata'), so asking `isAllowed({ id: widgetId })`
  // compares the wrong key and answers no for everything, entitled or not.
  // That is the identity-mismatch no-op from security-review-patterns #5: it
  // would have looked exactly like a working gate, because on this tenant the
  // right answer is also "hide them" — and it would have silently emptied the
  // taskbar on AitherVeil too, where all six are legitimately entitled.
  //
  // A pin with no manifest entry cannot be validated, so it is dropped: fail
  // closed, never "unknown therefore allow".
  const pinnedApps = React.useMemo(
    () => PINNED_APPS.filter(pin => {
      const entry = ALL_APPS.find(a => a.desktopWidget?.widgetId === pin.widgetId)
      if (!entry) return false
      return isAllowed({ id: entry.id, hasWidget: true })
    }),
    [isAllowed],
  )

  return (
    <div className="fixed bottom-0 left-0 right-0 h-12 z-[200] bg-zinc-950/80 backdrop-blur-2xl border-t border-white/[0.06] flex items-center px-2 gap-2 select-none shadow-[0_-4px_20px_rgba(0,0,0,0.3)]">
      {/* ── Start / Activities Button ── */}
      <button
        onClick={onOpenStartMenu}
        className="flex items-center gap-1.5 px-3 h-9 rounded-lg hover:bg-white/10 active:bg-white/15 transition-all group"
        title="Activities"
      >
        <div className="p-1.5 rounded-lg bg-[#5EC9CC] text-[#050507] group-hover:shadow-lg group-hover:shadow-[#5EC9CC]/20 group-active:scale-95 transition-all">
          <LayoutGrid className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-xs font-semibold text-zinc-300 hidden lg:inline">Activities</span>
      </button>

      {/* ── Pinned Apps ── */}
      {/* Both dividers hang off `pinnedApps.length`. A tenant can legitimately
          allow NONE of them, and an empty pin group would otherwise leave two
          dividers touching — a 2px double rule floating in the middle of the bar,
          which reads as a rendering bug rather than as an empty section. */}
      {pinnedApps.length > 0 && (
        <div className="w-px h-6 bg-white/[0.06] mx-1" />
      )}

      {/* gap-1.5, not gap-0.5: at 2px these read as one fused blob, and the owner called
          it out ("buttons all look cramped together"). 6px keeps the group compact while
          each target still reads as its own button. Same rhythm as the window list below. */}
      <div className="flex items-center gap-1.5">
        {pinnedApps.map(app => {
          const Icon = app.icon
          const isOpen = windows.some(w => w.id === app.widgetId || w.id === app.id)
          return (
            <button
              key={app.id}
              onClick={() => onOpenWidget(app.widgetId)}
              className={`relative flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-150
                ${isOpen
                  ? 'bg-white/10 hover:bg-white/15'
                  : 'hover:bg-white/5 active:bg-white/10'
                }`}
              title={app.label}
            >
              <Icon className={`w-4 h-4 ${app.color}`} />
              {/* Active indicator dot */}
              {isOpen && (
                <motion.div
                  layoutId={`pinned-indicator-${app.id}`}
                  className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#5EC9CC] text-[#050507]"
                />
              )}
            </button>
          )
        })}
      </div>

      {pinnedApps.length > 0 && (
        <div className="w-px h-6 bg-white/[0.06] mx-1" />
      )}

      {/* ── Open Windows ── */}
      <div className="flex-1 flex items-center gap-1.5 overflow-x-auto px-1 scrollbar-none">
        <AnimatePresence mode="popLayout">
          {windows.map(win => {
            const IconComponent = ICON_MAP[win.icon] || Monitor
            return (
              <motion.button
                key={win.id}
                layout
                initial={{ opacity: 0, scale: 0.8, width: 0 }}
                animate={{ opacity: 1, scale: 1, width: 'auto' }}
                exit={{ opacity: 0, scale: 0.8, width: 0 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                onClick={() => {
                  if (win.isFocused && !win.isMinimized) {
                    onMinimizeWindow(win.id)
                  } else {
                    onFocusWindow(win.id)
                  }
                }}
                onMouseEnter={() => setHoveredWindow(win.id)}
                onMouseLeave={() => setHoveredWindow(null)}
                className={`relative flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-medium transition-all max-w-[180px]
                  ${win.isFocused && !win.isMinimized
                    ? 'bg-white/12 text-white'
                    : win.isMinimized
                      ? 'bg-white/[0.03] text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300'
                      : 'bg-white/[0.06] text-zinc-300 hover:bg-white/10'
                  }`}
                title={win.title}
              >
                <IconComponent className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">{win.title}</span>
                {/* Focus indicator — animated underline */}
                {win.isFocused && !win.isMinimized && (
                  <motion.div
                    layoutId="taskbar-focus-indicator"
                    className="absolute -bottom-px left-2 right-2 h-[2px] rounded-full bg-[#5EC9CC] text-[#050507] "
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
              </motion.button>
            )
          })}
        </AnimatePresence>
      </div>

      {/* ── Mode Toggle ── */}
      {/* Always rendered. It was briefly hidden when `hasRoutes` is false,
          which removed the control instead of making it work -- on a tenant
          origin the button simply vanished, which is a worse answer than a
          button that does nothing: the user asked for it to OPEN something.
          The routeless case is handled in the handler below, not by deletion. */}
      {(
        <button
          onClick={onToggleMode}
          className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-zinc-200 transition-colors text-xs"
          title={mode === 'desktop' ? 'Switch to Dashboard' : 'Switch to Desktop'}
        >
          {mode === 'desktop' ? (
            <>
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Dashboard</span>
            </>
          ) : (
            <>
              <Monitor className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Desktop</span>
            </>
          )}
        </button>
      )}

      {/* ── Divider ── */}
      <div className="w-px h-6 bg-white/[0.06] mx-1" />

      {/* ── Elysium Sync (only visible in desktop-anywhere mode) ── */}
      <ElysiumSyncIndicator />

      {/* ── System Tray ── */}
      <SystemTray onOpenSettings={onOpenSettings} onLock={onLock} />

      {/* ── Account — who is signed in, and the one door in or out ── */}
      {identity && <AccountChip identity={identity} />}
    </div>
  )
}
