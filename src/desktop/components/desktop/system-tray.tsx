'use client'

/**
 * SystemTray
 * ==========
 * 
 * Right side of the taskbar: clock, connection indicators, notifications bell,
 * volume, and a quick-settings flyout panel.
 */

import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Wifi, WifiOff, Bell, Volume2, VolumeX, Moon, Sun,
  ChevronUp, BatteryFull, BatteryMedium, BatteryLow,
  PlugZap, Activity, Server, HardDrive, Cpu,
  Settings, Power, LogOut, RefreshCw, Monitor,
  Bug, ExternalLink,
} from 'lucide-react'

// ============================================================================
// CLOCK
// ============================================================================

function Clock() {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const dateStr = time.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <div className="text-right leading-tight">
      <div className="text-xs font-medium text-zinc-200">{timeStr}</div>
      <div className="text-[10px] text-zinc-500">{dateStr}</div>
    </div>
  )
}

// ============================================================================
// SYSTEM TRAY
// ============================================================================

export interface SystemTrayProps {
  /** Opens the host's Settings dialog. Without it the button is not rendered. */
  onOpenSettings?: () => void
  /** Locks the desktop (the shell's lock screen). Without it the button is not rendered. */
  onLock?: () => void
}

export function SystemTray({ onOpenSettings, onLock }: SystemTrayProps = {}) {
  const [isQuickSettingsOpen, setIsQuickSettingsOpen] = useState(false)
  const [notificationCount, setNotificationCount] = useState(0)
  // Pending A2A permission cards. These are DECISIONS, not FYIs — a federated
  // agent is blocked until one is answered — so they get their own count and
  // their own colour rather than being folded into the unread total.
  const [cards, setCards] = useState<any[]>([])
  const [isCardsOpen, setIsCardsOpen] = useState(false)
  const [cardError, setCardError] = useState<string | null>(null)
  const [grant, setGrant] = useState<{ token: string; ttl?: number } | null>(null)
  const [deciding, setDeciding] = useState<string | null>(null)
  const [mcpConnected, setMcpConnected] = useState(false)
  const [realtimeConnected, setRealtimeConnected] = useState(false)
  const [systemMetrics, setSystemMetrics] = useState<{ cpu: number; memory: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Poll system & connection status
  useEffect(() => {
    const checkStatus = async () => {
      // Check MCP
      try {
        const mcpRes = await fetch('/api/mcp/status', { signal: AbortSignal.timeout(2000) })
        setMcpConnected(mcpRes.ok)
      } catch (_e) { setMcpConnected(false) }

      // Check system metrics
      try {
        const sysRes = await fetch('/api/system', { signal: AbortSignal.timeout(2000) })
        if (sysRes.ok) {
          const data = await sysRes.json()
          setSystemMetrics({
            cpu: data.cpu?.usage || 0,
            memory: data.memory?.usagePercent || 0,
          })
        }
      } catch (_e) { /* silent */ }

      // Check notifications + pending permission cards. Cards are pulled from
      // the SAME feed the portal tray, Awconnect and `adk approvals` read,
      // so deciding in any one of them clears the others.
      try {
        const notifRes = await fetch('/api/notifications?limit=50', { signal: AbortSignal.timeout(4000) })
        if (notifRes.ok) {
          const data = await notifRes.json()
          const list = data.notifications || []
          setNotificationCount(data.unread_count ?? list.filter((n: any) => !n.read).length)
          setCards(list.filter((n: any) => n.access_request_id && n.status !== 'action' && !n.dismissed))
        }
      } catch (_e) { /* silent */ }
    }

    checkStatus()
    const interval = setInterval(checkStatus, 15000)
    return () => clearInterval(interval)
  }, [])

  async function decide(id: string, action: string) {
    setDeciding(id); setCardError(null)
    try {
      const res = await fetch(`/api/notifications/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => null)
      // Keep the card on refusal. A 403 (not the owner) or 409 (already
      // decided) is an answer; dropping the card would claim the agent was
      // approved while it stays blocked, and remove the only way to retry.
      if (!res.ok) {
        const d = data?.detail ?? data?.error ?? `HTTP ${res.status}`
        setCardError(typeof d === 'string' ? d : JSON.stringify(d))
        return
      }
      // Returned exactly once — show it or the approval is unusable.
      if (data?.grant_token) setGrant({ token: data.grant_token, ttl: data.ttl_minutes })
      setCards(prev => prev.filter(c => c.id !== id))
    } catch (e: any) {
      setCardError(e?.message || 'Request failed')
    } finally {
      setDeciding(null)
    }
  }

  // Close quick settings on outside click
  useEffect(() => {
    if (!isQuickSettingsOpen) return
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsQuickSettingsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isQuickSettingsOpen])

  return (
    <div className="flex items-center gap-1.5 relative" ref={panelRef}>
      {/* Connection indicators */}
      <button
        className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
        title={mcpConnected ? 'MCP Connected' : 'MCP Disconnected'}
      >
        <PlugZap className={`w-3.5 h-3.5 ${mcpConnected ? 'text-emerald-400' : 'text-zinc-600'}`} />
      </button>

      {/* System resources mini-indicator */}
      {systemMetrics && (
        <button
          onClick={() => setIsQuickSettingsOpen(!isQuickSettingsOpen)}
          className="hidden sm:flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-white/10 transition-colors"
          title={`CPU: ${Math.round(systemMetrics.cpu)}% | RAM: ${Math.round(systemMetrics.memory)}%`}
        >
          <div className="flex items-center gap-0.5">
            <Cpu className="w-3 h-3 text-zinc-500" />
            <div className="w-6 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${systemMetrics.cpu > 80 ? 'bg-red-500' : systemMetrics.cpu > 50 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                style={{ width: `${systemMetrics.cpu}%` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <HardDrive className="w-3 h-3 text-zinc-500" />
            <div className="w-6 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${systemMetrics.memory > 80 ? 'bg-red-500' : systemMetrics.memory > 50 ? 'bg-amber-500' : 'bg-cyan-500'
                  }`}
                style={{ width: `${systemMetrics.memory}%` }}
              />
            </div>
          </div>
        </button>
      )}

      {/* Notifications + pending permission cards.
          A card OUTRANKS the unread count: an unread notification is an FYI,
          a card means a federated agent is blocked right now waiting on this
          human. The bell was previously a dead button with no onClick. */}
      <button
        onClick={() => { setIsCardsOpen(!isCardsOpen); setCardError(null) }}
        className="relative p-1.5 rounded-md hover:bg-white/10 transition-colors"
        title={cards.length
          ? `${cards.length} access request(s) awaiting your decision`
          : `${notificationCount} notifications`}
      >
        <Bell className={`w-3.5 h-3.5 ${cards.length ? 'text-cyan-300' : 'text-zinc-400'}`} />
        {(cards.length > 0 || notificationCount > 0) && (
          <span className={`absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full text-[8px] text-white font-bold flex items-center justify-center ${cards.length ? 'bg-cyan-500' : 'bg-red-500'
            }`}>
            {(cards.length || notificationCount) > 9 ? '9+' : (cards.length || notificationCount)}
          </span>
        )}
      </button>

      {/* Access-request flyout */}
      <AnimatePresence>
        {isCardsOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-full right-0 mb-2 w-80 max-h-96 overflow-auto rounded-lg border border-white/10 bg-zinc-900/95 backdrop-blur p-2 shadow-2xl z-[250]"  /* was z-50: BELOW the taskbar (200) that opens it, so anything floating above the bar covered it. Both tray popovers now sit at 250, the same level as the start menu. */
          >
            <div className="px-1 pb-1.5 text-[11px] font-semibold text-zinc-300">
              Access Requests
            </div>

            {cardError && (
              <div className="mb-1.5 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-300">
                {cardError}
              </div>
            )}

            {grant && (
              <div className="mb-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5">
                <div className="text-[10px] text-emerald-300">
                  Approved — send back as <code>X-A2A-Grant</code>
                  {grant.ttl ? ` (${grant.ttl}m)` : ''}
                </div>
                <code className="mt-1 block break-all font-mono text-[9px] text-emerald-200">
                  {grant.token}
                </code>
                <button
                  onClick={() => navigator.clipboard?.writeText(grant.token)}
                  className="mt-1 text-[9px] text-emerald-400 hover:underline"
                >
                  Copy
                </button>
              </div>
            )}

            {cards.length === 0 && !grant && (
              <div className="px-1 py-3 text-center text-[10px] text-zinc-500">
                Nothing awaiting a decision.
              </div>
            )}

            {cards.map((c) => (
              <div key={c.id} className="mb-1.5 rounded border border-white/10 bg-white/[0.03] p-2">
                <div className="text-[11px] font-medium text-zinc-200">
                  {c.requesting_agent || 'agent'}
                  <span className="ml-1 text-[9px] font-normal text-zinc-500">
                    {c.requesting_tenant || 'unknown'}
                  </span>
                </div>
                <div className="mt-0.5 break-all font-mono text-[9px] text-cyan-300">
                  {c.requested_resource || ''}
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  <button
                    disabled={deciding === c.id}
                    onClick={() => decide(c.id, 'approve')}
                    className="flex-1 rounded bg-emerald-500/20 py-1 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    disabled={deciding === c.id}
                    onClick={() => decide(c.id, 'deny')}
                    className="flex-1 rounded bg-red-500/20 py-1 text-[10px] font-semibold text-red-300 hover:bg-red-500/30 disabled:opacity-50"
                  >
                    Deny
                  </button>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expand arrow for quick settings */}
      <button
        onClick={() => setIsQuickSettingsOpen(!isQuickSettingsOpen)}
        className="p-1 rounded-md hover:bg-white/10 transition-colors"
        title="Quick Settings"
      >
        <ChevronUp className={`w-3 h-3 text-zinc-500 transition-transform ${isQuickSettingsOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Clock */}
      <button
        onClick={() => setIsQuickSettingsOpen(!isQuickSettingsOpen)}
        className="px-2 py-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
      >
        <Clock />
      </button>

      {/* Quick Settings Flyout */}
      <AnimatePresence>
        {isQuickSettingsOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-14 right-0 w-80 bg-zinc-900/95 backdrop-blur-xl border border-zinc-700/80 rounded-xl shadow-2xl shadow-black/50 max-h-[70vh] overflow-y-auto overscroll-contain z-[250]"  /* max-h + scroll, NOT the bare overflow-hidden this had. The panel is anchored to the BOTTOM and grows UPWARD, so on a short viewport its head — the "SYSTEM" label, CPU and Memory — leaves the top of the screen. overflow-hidden then clipped that content and made it UNREACHABLE: there was nothing to scroll. Reported from screenshots 2026-08-16/17 as "you're hiding the ambient context menu" — the menu rendered correctly and was cut in half. Its sibling above already did this right; one panel was fixed and the other was not. */
          >
            {/* System Stats */}
            <div className="p-4 space-y-3">
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">System</h3>

              {/* CPU */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300 flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-cyan-400" /> CPU
                  </span>
                  <span className="text-zinc-500 font-mono">{systemMetrics ? `${Math.round(systemMetrics.cpu)}%` : '—'}</span>
                </div>
                <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all"
                    style={{ width: `${systemMetrics?.cpu || 0}%` }}
                  />
                </div>
              </div>

              {/* Memory */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300 flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-[#5EC9CC]" /> Memory
                  </span>
                  <span className="text-zinc-500 font-mono">{systemMetrics ? `${Math.round(systemMetrics.memory)}%` : '—'}</span>
                </div>
                <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#5EC9CC] text-[#050507] transition-all"
                    style={{ width: `${systemMetrics?.memory || 0}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="h-px bg-zinc-800" />

            {/* Connection Status */}
            <div className="p-4 space-y-2">
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Connections</h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-zinc-800/50">
                  <PlugZap className={`w-3.5 h-3.5 ${mcpConnected ? 'text-emerald-400' : 'text-red-400'}`} />
                  <span className="text-xs text-zinc-300">MCP</span>
                  <span className={`ml-auto text-[10px] font-mono ${mcpConnected ? 'text-emerald-500' : 'text-red-500'}`}>
                    {mcpConnected ? 'ON' : 'OFF'}
                  </span>
                </div>
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-zinc-800/50">
                  <Activity className={`w-3.5 h-3.5 ${realtimeConnected ? 'text-emerald-400' : 'text-zinc-600'}`} />
                  <span className="text-xs text-zinc-300">Pulse</span>
                  <span className={`ml-auto text-[10px] font-mono ${realtimeConnected ? 'text-emerald-500' : 'text-zinc-600'}`}>
                    {realtimeConnected ? 'ON' : 'OFF'}
                  </span>
                </div>
              </div>
            </div>

            <div className="h-px bg-zinc-800" />

            {/* Report Issue */}
            <div className="px-4 py-3">
              <a
                href="https://github.com/Aitherium/awdk/issues/new/choose"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15 hover:border-amber-400/30 transition-all group cursor-pointer"
              >
                <Bug className="w-4 h-4 text-amber-400" />
                <div className="flex-1">
                  <span className="text-xs font-semibold text-amber-300">Report Issue</span>
                  <p className="text-[10px] text-zinc-500">Bug, feature, or question</p>
                </div>
                <ExternalLink className="w-3 h-3 text-zinc-600 group-hover:text-amber-400 transition-colors" />
              </a>
            </div>

            <div className="h-px bg-zinc-800" />

            {/* Quick Actions. All three were rendered with NO onClick -- Settings,
                Refresh and Shutdown looked live and did nothing (measured
                2026-10-01). Each is now wired, or not rendered when the shell
                gives it nothing to do; "Shutdown" is the shell's lock screen,
                which is what a browser desktop can honestly offer. */}
            <div className="p-2 flex items-center gap-1">
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={() => { setIsQuickSettingsOpen(false); onOpenSettings() }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-zinc-200 transition-colors text-xs"
                >
                  <Settings className="w-3.5 h-3.5" />
                  Settings
                </button>
              )}
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-zinc-200 transition-colors text-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </button>
              {onLock && (
                <button
                  type="button"
                  onClick={() => { setIsQuickSettingsOpen(false); onLock() }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg hover:bg-red-500/10 text-zinc-400 hover:text-red-400 transition-colors text-xs"
                >
                  <Power className="w-3.5 h-3.5" />
                  Lock
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
