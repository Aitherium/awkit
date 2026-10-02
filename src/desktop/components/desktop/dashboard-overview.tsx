'use client'

/**
 * DashboardOverview
 * =================
 *
 * The surface the taskbar's Dashboard button opens on a host that has no
 * `/dashboard` ROUTE — i.e. every standalone tenant portal.
 *
 * Why this exists at all: the Dashboard control has never worked off the
 * platform, and the reason was structural rather than a bug in the handler.
 * `onToggleMode` navigated to `/dashboard`, which only AitherVeil serves; on a
 * static tenant the catch-all returns index.html and nothing happens. It was
 * then "fixed" to open `homeWidgetId` instead — and on dgg that resolves to
 * `room`, the Company Room, which is the window ALREADY on screen. So the
 * button called a handler, the handler ran, the correct window was focused, and
 * the user saw absolutely nothing change. Reported, accurately, as "Dashboard
 * still doesn't work at all".
 *
 * Every previous attempt failed the same way — by having nowhere to go:
 *   navigate unconditionally  -> dead on a tenant (no such route)
 *   hide the control          -> worse; the owner asked where the button went
 *   open the home widget      -> a no-op whenever that widget is already open
 *
 * There was no dashboard surface anywhere in desktop-core to open. This is it.
 *
 * It is deliberately NOT a second Start Menu. The launcher is a transient
 * popover you dismiss to get at a window; this is a persistent full-surface
 * home showing the whole workspace at once — what is open, and everything that
 * can be opened — which is the thing a tenant desktop otherwise lacks entirely
 * when no window is up.
 */

import React, { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Brain, Terminal, Settings, Folder, Bot, Sparkles, Radio, Feather, Library,
  Wand2, Gamepad2, GitBranch, Activity, HardDrive, Network, Eye, MessageSquare,
  Code2, Flame, Shield, ShieldCheck, Zap, Globe, Monitor, FileText, Search,
} from 'lucide-react'
import { ALL_APPS } from '../../data/apps-manifest'
import { useAppCatalog } from '../../contexts/app-catalog-context'

const ICON_MAP: Record<string, React.ElementType> = {
  brain: Brain, terminal: Terminal, settings: Settings, folder: Folder,
  bot: Bot, sparkles: Sparkles, radio: Radio, feather: Feather,
  library: Library, wand: Wand2, gamepad: Gamepad2, git: GitBranch,
  activity: Activity, harddrive: HardDrive, network: Network, eye: Eye,
  message: MessageSquare, 'message-square': MessageSquare, code: Code2,
  flame: Flame, shield: Shield, 'shield-check': ShieldCheck, zap: Zap,
  globe: Globe, monitor: Monitor, 'file-text': FileText, search: Search,
}

interface DashboardCard {
  id: string
  name: string
  description: string
  icon: React.ElementType
  widgetId?: string
  route?: string
}

interface DashboardOverviewProps {
  /** Ids of windows currently open, so the card can say so. */
  openWindowIds: readonly string[]
  onOpenWidget: (widgetId: string) => void
  onNavigate: (href: string) => void
  onClose: () => void
}

export function DashboardOverview({
  openWindowIds,
  onOpenWidget,
  onNavigate,
  onClose,
}: DashboardOverviewProps) {
  const { isAllowed, extraApps, hasRoutes } = useAppCatalog()

  // Same two halves as the Start Menu, and both are load-bearing: the platform
  // manifest NARROWED to what this deployment ships, plus the apps the host
  // CONTRIBUTES. A tenant's panels are not in the manifest, so subtraction
  // alone yields an empty grid.
  const cards = useMemo<DashboardCard[]>(() => {
    const fromManifest = ALL_APPS
      .filter(a => isAllowed({ id: a.id, hasWidget: !!a.desktopWidget?.widgetId }))
      .map(a => ({
        id: a.id,
        name: a.name,
        description: a.description,
        icon: ICON_MAP[a.icon] || Monitor,
        widgetId: a.desktopWidget?.widgetId,
        route: a.route,
      }))
    const seen = new Set(fromManifest.map(a => a.id))
    const fromHost = extraApps
      .filter(a => !seen.has(a.id))
      .map(a => ({
        id: a.id,
        name: a.name,
        description: a.description ?? '',
        icon: ICON_MAP[a.icon] || Monitor,
        widgetId: a.widgetId,
        route: undefined,
      }))
    return [...fromManifest, ...fromHost]
  }, [isAllowed, extraApps])

  const open = useMemo(() => new Set(openWindowIds), [openWindowIds])

  const activate = (card: DashboardCard) => {
    if (card.widgetId) {
      onOpenWidget(card.widgetId)
      onClose()
    } else if (card.route && hasRoutes) {
      onNavigate(card.route)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      // Above the windows (100) and below the taskbar (200), so the taskbar
      // stays usable — including the very button that toggles this off.
      className="fixed inset-x-0 top-0 bottom-12 z-[150] overflow-y-auto bg-zinc-950/95 backdrop-blur-2xl"
    >
      <div className="max-w-6xl mx-auto px-8 py-10">
        <h1 className="text-2xl font-semibold text-zinc-100">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {cards.length === 1 ? '1 app' : `${cards.length} apps`} available in this workspace
        </p>

        <div className="mt-8 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(card => {
            const Icon = card.icon
            const isOpen = open.has(card.id) || (card.widgetId ? open.has(card.widgetId) : false)
            return (
              <button
                key={card.id}
                onClick={() => activate(card)}
                className="group text-left p-5 rounded-xl border border-white/[0.08] bg-white/[0.02]
                           hover:bg-white/[0.06] hover:border-white/[0.14] transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-white/[0.06] group-hover:bg-white/10 transition-colors">
                    <Icon className="w-5 h-5 text-[#5EC9CC]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-100 truncate">{card.name}</span>
                      {isOpen && (
                        <span className="shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5
                                         rounded bg-emerald-500/15 text-emerald-300">
                          open
                        </span>
                      )}
                    </div>
                    {card.description && (
                      <p className="mt-1 text-xs leading-relaxed text-zinc-500 line-clamp-2">
                        {card.description}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {cards.length === 0 && (
          <p className="mt-8 text-sm text-zinc-500">
            No apps are available yet. Sign in to unlock this workspace.
          </p>
        )}
      </div>
    </motion.div>
  )
}

export default DashboardOverview
