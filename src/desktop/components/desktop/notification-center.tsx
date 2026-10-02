'use client'

/**
 * NotificationCenter
 * ==================
 *
 * A macOS-style notification center that slides in from the right edge.
 * Shows recent notifications, quick toggles, and system status.
 *
 * Features:
 *  - Slide-in panel from right edge
 *  - Notification list with dismiss/clear
 *  - Quick Settings toggles (Wi-Fi, Bluetooth, Do Not Disturb, etc.)
 *  - Now Playing / Active Agent indicator
 *  - Calendar widget
 *  - System resource meters
 *  - Grouped notifications by app/service
 */

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Trash2, Bell, BellOff, Wifi, WifiOff, Bluetooth, BluetoothOff,
  Moon, Sun, Volume2, VolumeX, Monitor, Eye, EyeOff, Zap, Shield,
  Activity, Brain, Bot, Terminal, AlertTriangle, CheckCircle2, Info,
  XCircle, Flame, Sparkles, Radio, ChevronRight, Settings, Maximize2,
  Cpu, HardDrive, MemoryStick, Clock, Calendar, ChevronDown, ChevronUp,
  Mic, MicOff, Cast, Lock, Unlock, Plane, MessageSquare,
} from 'lucide-react'

// ============================================================================
// TYPES
// ============================================================================

export interface DesktopNotification {
  id: string
  title: string
  message: string
  icon: 'info' | 'success' | 'warning' | 'error' | 'agent' | 'system' | 'security'
  timestamp: number
  appId?: string
  appName?: string
  read?: boolean
  persistent?: boolean
  actions?: { label: string; action: string }[]
}

interface QuickToggle {
  id: string
  icon: React.ElementType
  iconOff?: React.ElementType
  label: string
  enabled: boolean
  color: string
}

// ============================================================================
// NOTIFICATION ITEM
// ============================================================================

function NotificationItem({
  notification,
  onDismiss,
  onAction,
}: {
  notification: DesktopNotification
  onDismiss: (id: string) => void
  onAction?: (notifId: string, action: string) => void
}) {
  const iconMap = {
    info: <Info className="w-4 h-4 text-blue-400" />,
    success: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-400" />,
    error: <XCircle className="w-4 h-4 text-red-400" />,
    agent: <Bot className="w-4 h-4 text-[#5EC9CC]" />,
    system: <Brain className="w-4 h-4 text-[#5EC9CC]" />,
    security: <Shield className="w-4 h-4 text-cyan-400" />,
  }

  const timeAgo = (ts: number) => {
    const diff = Date.now() - ts
    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return `${Math.floor(diff / 86400000)}d ago`
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 20, height: 0 }}
      animate={{ opacity: 1, x: 0, height: 'auto' }}
      exit={{ opacity: 0, x: 20, height: 0 }}
      transition={{ duration: 0.2 }}
      className={`group relative p-3 rounded-xl border transition-colors ${
        notification.read
          ? 'bg-zinc-900/40 border-white/[0.04] hover:bg-zinc-900/60'
          : 'bg-zinc-800/50 border-white/[0.08] hover:bg-zinc-800/70'
      }`}
    >
      <div className="flex gap-2.5">
        {/* Icon */}
        <div className="mt-0.5 shrink-0">{iconMap[notification.icon]}</div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {notification.appName && (
                <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">
                  {notification.appName}
                </span>
              )}
              <h4 className={`text-xs font-semibold truncate ${notification.read ? 'text-zinc-400' : 'text-zinc-200'}`}>
                {notification.title}
              </h4>
            </div>
            <span className="text-[10px] text-zinc-600 shrink-0 tabular-nums">{timeAgo(notification.timestamp)}</span>
          </div>
          <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2">{notification.message}</p>

          {/* Actions */}
          {notification.actions && notification.actions.length > 0 && (
            <div className="flex gap-1.5 mt-2">
              {notification.actions.map(action => (
                <button
                  key={action.action}
                  onClick={(e) => { e.stopPropagation(); onAction?.(notification.id, action.action) }}
                  className="px-2 py-0.5 text-[10px] font-medium rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 transition-colors"
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Dismiss */}
        <button
          onClick={(e) => { e.stopPropagation(); onDismiss(notification.id) }}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-white/10 shrink-0 self-start"
        >
          <X className="w-3 h-3 text-zinc-500" />
        </button>
      </div>

      {/* Unread indicator */}
      {!notification.read && (
        <div className="absolute top-3 left-1.5 w-1.5 h-1.5 rounded-full bg-[#5EC9CC] text-[#050507]" />
      )}
    </motion.div>
  )
}

// ============================================================================
// QUICK TOGGLE BUTTON
// ============================================================================

function QuickToggleButton({ toggle, onToggle }: { toggle: QuickToggle; onToggle: (id: string) => void }) {
  const Icon = toggle.enabled ? toggle.icon : (toggle.iconOff || toggle.icon)

  return (
    <button
      onClick={() => onToggle(toggle.id)}
      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all duration-200 ${
        toggle.enabled
          ? `bg-gradient-to-b from-white/[0.08] to-white/[0.04] border border-white/[0.1] shadow-lg shadow-black/20`
          : 'bg-zinc-900/60 border border-white/[0.04] hover:bg-zinc-800/60'
      }`}
    >
      <Icon className={`w-5 h-5 transition-colors ${toggle.enabled ? toggle.color : 'text-zinc-600'}`} />
      <span className={`text-[10px] font-medium ${toggle.enabled ? 'text-zinc-300' : 'text-zinc-600'}`}>
        {toggle.label}
      </span>
    </button>
  )
}

// ============================================================================
// SYSTEM METER
// ============================================================================

function SystemMeter({ label, value, color, icon: Icon }: {
  label: string; value: number; color: string; icon: React.ElementType
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={`w-3.5 h-3.5 ${color}`} />
      <div className="flex-1">
        <div className="flex justify-between mb-1">
          <span className="text-[10px] text-zinc-500">{label}</span>
          <span className="text-[10px] text-zinc-400 font-mono tabular-nums">{value}%</span>
        </div>
        <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${value}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className={`h-full rounded-full ${color.replace('text-', 'bg-')}`}
          />
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface NotificationCenterProps {
  isOpen: boolean
  onClose: () => void
  notifications: DesktopNotification[]
  onDismissNotification: (id: string) => void
  onClearAll: () => void
  onNotificationAction?: (notifId: string, action: string) => void
}

export function NotificationCenter({
  isOpen,
  onClose,
  notifications,
  onDismissNotification,
  onClearAll,
  onNotificationAction,
}: NotificationCenterProps) {
  const [toggles, setToggles] = useState<QuickToggle[]>([
    { id: 'wifi', icon: Wifi, iconOff: WifiOff, label: 'Wi-Fi', enabled: true, color: 'text-blue-400' },
    { id: 'bluetooth', icon: Bluetooth, iconOff: BluetoothOff, label: 'Bluetooth', enabled: false, color: 'text-blue-400' },
    { id: 'dnd', icon: BellOff, iconOff: Bell, label: 'Do Not Disturb', enabled: false, color: 'text-[#5EC9CC]' },
    { id: 'nightlight', icon: Moon, iconOff: Sun, label: 'Night Light', enabled: false, color: 'text-amber-400' },
    { id: 'agents', icon: Bot, label: 'Agents', enabled: true, color: 'text-[#5EC9CC]' },
    { id: 'voice', icon: Mic, iconOff: MicOff, label: 'Voice', enabled: false, color: 'text-emerald-400' },
    { id: 'vision', icon: Eye, iconOff: EyeOff, label: 'Vision', enabled: false, color: 'text-cyan-400' },
    { id: 'security', icon: Shield, label: 'Security', enabled: true, color: 'text-green-400' },
  ])

  const [systemMetrics, setSystemMetrics] = useState({ cpu: 32, memory: 58, gpu: 15 })

  // Simulate live metrics
  useEffect(() => {
    if (!isOpen) return
    const timer = setInterval(() => {
      setSystemMetrics({
        cpu: Math.min(100, Math.max(5, 32 + Math.floor(Math.random() * 20 - 10))),
        memory: Math.min(100, Math.max(20, 58 + Math.floor(Math.random() * 10 - 5))),
        gpu: Math.min(100, Math.max(0, 15 + Math.floor(Math.random() * 15 - 5))),
      })
    }, 3000)
    return () => clearInterval(timer)
  }, [isOpen])

  const handleToggle = useCallback((id: string) => {
    setToggles(prev => prev.map(t => t.id === id ? { ...t, enabled: !t.enabled } : t))
  }, [])

  const unreadCount = notifications.filter(n => !n.read).length

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
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
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[300] bg-black/20 backdrop-blur-[2px]"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, x: 380 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 380 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed top-2 right-2 bottom-14 w-[360px] z-[301] rounded-2xl overflow-hidden
              bg-zinc-950/90 backdrop-blur-2xl border border-white/[0.08]
              shadow-[0_0_60px_rgba(0,0,0,0.5),0_0_20px_rgba(94,201,204,0.05)]
              flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-zinc-400" />
                <h3 className="text-sm font-semibold text-zinc-200">Notifications</h3>
                {unreadCount > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-[#5EC9CC]/20 text-[#5EC9CC]">
                    {unreadCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {notifications.length > 0 && (
                  <button
                    onClick={onClearAll}
                    className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-500 hover:text-zinc-300 transition-colors text-[11px] font-medium"
                  >
                    Clear All
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-4 scrollbar-none">
              {/* Quick Toggles */}
              <div>
                <div className="flex items-center justify-between px-1 mb-2">
                  <span className="text-[10px] text-zinc-600 font-semibold uppercase tracking-wider">Quick Settings</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {toggles.map(toggle => (
                    <QuickToggleButton key={toggle.id} toggle={toggle} onToggle={handleToggle} />
                  ))}
                </div>
              </div>

              {/* System Resources */}
              <div>
                <div className="flex items-center justify-between px-1 mb-2">
                  <span className="text-[10px] text-zinc-600 font-semibold uppercase tracking-wider">System</span>
                  <Activity className="w-3 h-3 text-zinc-600" />
                </div>
                <div className="p-3 rounded-xl bg-zinc-900/50 border border-white/[0.04] space-y-2.5">
                  <SystemMeter label="CPU" value={systemMetrics.cpu} color="text-blue-400" icon={Cpu} />
                  <SystemMeter label="Memory" value={systemMetrics.memory} color="text-emerald-400" icon={MemoryStick} />
                  <SystemMeter label="GPU" value={systemMetrics.gpu} color="text-[#5EC9CC]" icon={Zap} />
                </div>
              </div>

              {/* Active Agent */}
              <div className="p-3 rounded-xl bg-gradient-to-r from-[#5EC9CC]/[0.06] to-[#5EC9CC]/[0.04] border border-[#5EC9CC]/10">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-[#5EC9CC]/20">
                    <Brain className="w-3.5 h-3.5 text-[#5EC9CC]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-zinc-300">AitherOS Agent</span>
                    <p className="text-[10px] text-zinc-500">Listening • 12 services online</p>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                </div>
              </div>

              {/* Notifications */}
              <div>
                <div className="flex items-center justify-between px-1 mb-2">
                  <span className="text-[10px] text-zinc-600 font-semibold uppercase tracking-wider">Recent</span>
                </div>

                {notifications.length === 0 ? (
                  <div className="py-8 text-center">
                    <Bell className="w-8 h-8 text-zinc-800 mx-auto mb-2" />
                    <p className="text-xs text-zinc-600">No notifications</p>
                    <p className="text-[10px] text-zinc-700 mt-0.5">All quiet on the AI front</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <AnimatePresence mode="popLayout">
                      {notifications.map(notif => (
                        <NotificationItem
                          key={notif.id}
                          notification={notif}
                          onDismiss={onDismissNotification}
                          onAction={onNotificationAction}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ============================================================================
// NOTIFICATION TOAST — For push notifications that appear temporarily
// ============================================================================

interface NotificationToastProps {
  notification: DesktopNotification
  onDismiss: () => void
  onAction?: (action: string) => void
}

export function NotificationToast({ notification, onDismiss, onAction }: NotificationToastProps) {
  useEffect(() => {
    if (notification.persistent) return
    const timer = setTimeout(onDismiss, 5000)
    return () => clearTimeout(timer)
  }, [notification.persistent, onDismiss])

  const iconMap = {
    info: <Info className="w-4 h-4 text-blue-400" />,
    success: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-400" />,
    error: <XCircle className="w-4 h-4 text-red-400" />,
    agent: <Bot className="w-4 h-4 text-[#5EC9CC]" />,
    system: <Brain className="w-4 h-4 text-[#5EC9CC]" />,
    security: <Shield className="w-4 h-4 text-cyan-400" />,
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 80, y: 0 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, x: 80 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className="w-[340px] p-3 rounded-xl bg-zinc-900/95 backdrop-blur-2xl border border-white/[0.1] shadow-2xl shadow-black/30"
    >
      <div className="flex gap-2.5">
        <div className="mt-0.5 shrink-0">{iconMap[notification.icon]}</div>
        <div className="flex-1 min-w-0">
          {notification.appName && (
            <span className="text-[10px] text-zinc-600 font-medium uppercase tracking-wider">{notification.appName}</span>
          )}
          <h4 className="text-xs font-semibold text-zinc-200 truncate">{notification.title}</h4>
          <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2">{notification.message}</p>
        </div>
        <button
          onClick={onDismiss}
          className="p-1 rounded-md hover:bg-white/10 text-zinc-500 shrink-0 self-start"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </motion.div>
  )
}
