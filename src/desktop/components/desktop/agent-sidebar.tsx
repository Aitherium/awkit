'use client'

/**
 * AgentSidebar
 * ============
 *
 * A slide-out AI assistant panel that renders INSIDE any DesktopWindow.
 * When toggled, it takes ~320px from the right side of the window content area.
 *
 * Features:
 *  - Streaming responses with thinking indicator
 *  - Context-aware quick actions per app type
 *  - Conversation history with auto-scroll
 *  - Markdown rendering for agent responses
 *  - Agent avatar with pulse animation during streaming
 *  - Collapsible thinking blocks
 *  - Clear conversation / copy response
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Bot,
  X,
  Send,
  Sparkles,
  Trash2,
  Copy,
  ChevronDown,
  ChevronRight,
  Brain,
  Loader2,
  Zap,
  MessageSquare,
  Layers,
  Pin,
  PinOff,
  Activity,
  Cpu,
  HardDrive,
  Wifi,
} from 'lucide-react'
// Inline ThinkingBlock — avoids hard dependency on @/components/aeon
function ThinkingBlock({ content }: { content: string }) {
  const [isOpen, setIsOpen] = React.useState(false)
  return (
    <div className="mt-1 text-xs text-muted-foreground border border-muted rounded-md overflow-hidden">
      <button onClick={() => setIsOpen(!isOpen)} className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-muted/30 transition-colors">
        <Brain className="w-3 h-3 text-[#5EC9CC]" />
        <span className="font-medium">Thinking</span>
        {isOpen ? <ChevronDown className="w-3 h-3 ml-auto" /> : <ChevronRight className="w-3 h-3 ml-auto" />}
      </button>
      {isOpen && <pre className="px-2 py-1.5 text-[11px] whitespace-pre-wrap opacity-70 border-t border-muted max-h-40 overflow-auto">{content}</pre>}
    </div>
  )
}
import {
  useWindowAgent,
  type AgentMessage,
  type AgentQuickAction,
  type SessionLayerId,
  type SessionLayerMeta,
} from '../../contexts/desktop-agent-context'

// ============================================================================
// SUBCOMPONENTS
// ============================================================================

// ThinkingBlock — imported from shared component (@/components/aeon/thinking-block)

function MessageBubble({ message, onCopy }: { message: AgentMessage; onCopy: (text: string) => void }) {
  const isUser = message.role === 'user'
  const isStreaming = message.isStreaming

  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'} group`}>
      {/* Avatar */}
      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
        isUser
          ? 'bg-blue-500/20 text-blue-400'
          : 'bg-[#5EC9CC]/20 text-[#5EC9CC]'
      }`}>
        {isUser ? (
          <MessageSquare className="w-3 h-3" />
        ) : (
          <div className="relative">
            <Bot className="w-3 h-3" />
            {isStreaming && (
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className={`max-w-[85%] min-w-0 ${isUser ? 'text-right' : ''}`}>
        {message.thinkingContent && <ThinkingBlock content={message.thinkingContent} />}

        <div className={`rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words ${
          isUser
            ? 'bg-blue-500/15 text-blue-100 border border-blue-500/20'
            : 'bg-zinc-800/80 text-zinc-200 border border-zinc-700/50'
        }`}>
          {message.content}
          {isStreaming && !message.content && (
            <span className="inline-flex gap-1 text-zinc-500">
              <span className="animate-bounce" style={{ animationDelay: '0ms' }}>●</span>
              <span className="animate-bounce" style={{ animationDelay: '150ms' }}>●</span>
              <span className="animate-bounce" style={{ animationDelay: '300ms' }}>●</span>
            </span>
          )}
          {isStreaming && message.content && (
            <span className="inline-block w-1.5 h-4 bg-[#5EC9CC] text-[#050507] animate-pulse ml-0.5 align-middle" />
          )}
        </div>

        {/* Actions (show on hover for assistant messages) */}
        {!isUser && !isStreaming && message.content && (
          <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onCopy(message.content)}
              className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-zinc-800 transition-colors"
              title="Copy response"
            >
              <Copy className="w-3 h-3" /> Copy
            </button>
            {/* Show which layers were active for this response */}
            {message.activeLayers && message.activeLayers.length > 0 && (
              <span className="flex items-center gap-0.5 text-[9px] text-zinc-600 ml-1">
                <Layers className="w-2.5 h-2.5" />
                {message.activeLayers.map((l: SessionLayerMeta) => `L${LAYER_META[l.id]?.level ?? '?'}`).join('+')}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function QuickActionButton({ action, onSelect }: { action: AgentQuickAction; onSelect: (action: AgentQuickAction) => void }) {
  return (
    <button
      onClick={() => onSelect(action)}
      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 hover:text-zinc-100 border border-zinc-700/50 hover:border-zinc-600/50 transition-all shrink-0"
      title={action.prompt}
    >
      {action.icon && <span className="text-[11px]">{action.icon}</span>}
      <span>{action.label}</span>
    </button>
  )
}

// ============================================================================
// SESSION LAYER INDICATOR
// ============================================================================

const LAYER_META: Record<SessionLayerId, { level: number; label: string; color: string; icon: string }> = {
  kernel:   { level: 0, label: 'Kernel',   color: 'text-red-400 bg-red-400',     icon: '⚡' },
  services: { level: 1, label: 'Services', color: 'text-amber-400 bg-amber-400', icon: '🔌' },
  memory:   { level: 2, label: 'Memory',   color: 'text-blue-400 bg-blue-400',   icon: '🧠' },
  full:     { level: 3, label: 'Full',     color: 'text-emerald-400 bg-emerald-400', icon: '🌐' },
}

function SessionLayerIndicator({
  activeLayers,
  pinnedLayers,
  onPin,
  onUnpin,
}: {
  activeLayers: SessionLayerMeta[]
  pinnedLayers: SessionLayerId[]
  onPin: (l: SessionLayerId) => void
  onUnpin: (l: SessionLayerId) => void
}) {
  const allLayers: SessionLayerId[] = ['kernel', 'services', 'memory', 'full']

  return (
    <div className="flex items-center gap-1">
      {allLayers.map(layerId => {
        const meta = LAYER_META[layerId]
        const isActive = activeLayers.some(l => l.id === layerId)
        const isPinned = pinnedLayers.includes(layerId)
        const isStale = activeLayers.find(l => l.id === layerId)?.stale

        return (
          <button
            key={layerId}
            onClick={() => isPinned ? onUnpin(layerId) : onPin(layerId)}
            className={`group relative flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] transition-all ${
              isActive
                ? `${meta.color.split(' ')[0]} bg-opacity-20 border border-current/20`
                : isPinned
                  ? 'text-zinc-400 border border-zinc-600/50 bg-zinc-800/50'
                  : 'text-zinc-600 hover:text-zinc-400'
            }`}
            title={`L${meta.level} ${meta.label}${isPinned ? ' (pinned)' : ''}${isStale ? ' (stale)' : ''}\nClick to ${isPinned ? 'unpin' : 'pin'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${
              isActive ? meta.color.split(' ')[1] : isPinned ? 'bg-zinc-500' : 'bg-zinc-700'
            } ${isActive && !isStale ? 'animate-pulse' : ''}`} />
            <span className="font-mono">{meta.level}</span>
            {isPinned && (
              <Pin className="w-2 h-2 opacity-60" />
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Tiny system vitals bar from the global kernel pulse */
function SystemPulseMini({ pulse }: { pulse: Record<string, any> | null }) {
  if (!pulse) return null

  const cpu = pulse.cpu_percent ?? pulse.cpu ?? null
  const ram = pulse.memory_percent ?? pulse.ram ?? null
  const pain = pulse.pain_level ?? pulse.pain ?? null
  const services = pulse.services_up ?? pulse.healthy_services ?? null

  return (
    <div className="flex items-center gap-2 text-[10px] text-zinc-500 px-1">
      {cpu !== null && (
        <span className={`flex items-center gap-0.5 ${cpu > 80 ? 'text-red-400' : cpu > 50 ? 'text-amber-400' : ''}`}>
          <Cpu className="w-2.5 h-2.5" />
          {Math.round(cpu)}%
        </span>
      )}
      {ram !== null && (
        <span className={`flex items-center gap-0.5 ${ram > 85 ? 'text-red-400' : ram > 60 ? 'text-amber-400' : ''}`}>
          <HardDrive className="w-2.5 h-2.5" />
          {Math.round(ram)}%
        </span>
      )}
      {pain !== null && (
        <span className={`flex items-center gap-0.5 ${pain > 7 ? 'text-red-400' : pain > 4 ? 'text-amber-400' : 'text-green-400'}`}>
          <Activity className="w-2.5 h-2.5" />
          {pain}/10
        </span>
      )}
      {services !== null && (
        <span className="flex items-center gap-0.5 text-zinc-500">
          <Wifi className="w-2.5 h-2.5" />
          {services}
        </span>
      )}
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface AgentSidebarProps {
  windowId: string
  className?: string
}

export function AgentSidebar({ windowId, className = '' }: AgentSidebarProps) {
  const agent = useWindowAgent(windowId)
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [agent.messages])

  // Focus input when sidebar opens
  useEffect(() => {
    if (agent.isOpen) {
      setTimeout(() => inputRef.current?.focus(), 200)
    }
  }, [agent.isOpen])

  const handleSend = useCallback(async () => {
    const msg = input.trim()
    if (!msg || agent.isStreaming) return
    setInput('')
    await agent.send(msg)
  }, [input, agent])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleQuickAction = useCallback((action: AgentQuickAction) => {
    if (action.autoSend) {
      agent.send(action.prompt)
    } else {
      setInput(action.prompt)
      inputRef.current?.focus()
    }
  }, [agent])

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [])

  if (!agent.isOpen) return null

  return (
    <div className={`flex flex-col border-l border-zinc-700/50 bg-zinc-900/95 backdrop-blur-sm w-[320px] shrink-0 ${className}`}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col border-b border-zinc-700/50 bg-zinc-800/50">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Bot className="w-4 h-4 text-[#5EC9CC]" />
              {agent.isStreaming && (
                <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              )}
            </div>
            <span className="text-xs font-medium text-zinc-300">
              AI Agent
            </span>
            {agent.appContext && (
              <span className="text-[10px] text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700/50">
                {agent.appContext.appName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={agent.clear}
              className="p-1 text-zinc-500 hover:text-zinc-300 rounded hover:bg-zinc-700/50 transition-colors"
              title="Clear conversation"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={agent.close}
              className="p-1 text-zinc-500 hover:text-zinc-300 rounded hover:bg-zinc-700/50 transition-colors"
              title="Close agent (Ctrl+J)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Session layers + system pulse */}
        <div className="flex items-center justify-between px-3 pb-1.5">
          <SessionLayerIndicator
            activeLayers={agent.activeLayers}
            pinnedLayers={agent.pinnedLayers}
            onPin={agent.pinLayer}
            onUnpin={agent.unpinLayer}
          />
          <SystemPulseMini pulse={agent.systemPulse} />
        </div>
      </div>

      {/* ── Messages ───────────────────────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-4">
        {agent.messages.length === 0 ? (
          <EmptyState
            appContext={agent.appContext}
            quickActions={agent.quickActions}
            onQuickAction={handleQuickAction}
          />
        ) : (
          agent.messages.map((msg: AgentMessage) => (
            <MessageBubble key={msg.id} message={msg} onCopy={handleCopy} />
          ))
        )}
      </div>

      {/* ── Quick Actions (when there are messages) ────────────────────── */}
      {agent.messages.length > 0 && agent.quickActions.length > 0 && !agent.isStreaming && (
        <div className="px-3 py-1.5 border-t border-zinc-800/50">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
            {agent.quickActions.slice(0, 4).map((action: AgentQuickAction) => (
              <QuickActionButton key={action.id} action={action} onSelect={handleQuickAction} />
            ))}
          </div>
        </div>
      )}

      {/* ── Input ──────────────────────────────────────────────────────── */}
      <div className="border-t border-zinc-700/50 p-2 bg-zinc-800/30">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={agent.isStreaming ? 'Agent is thinking...' : 'Ask anything...'}
            disabled={agent.isStreaming}
            rows={1}
            className="flex-1 bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 resize-none focus:outline-none focus:border-[#5EC9CC]/50 focus:ring-1 focus:ring-[#5EC9CC]/20 disabled:opacity-50 max-h-20"
            style={{ minHeight: '36px' }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || agent.isStreaming}
            className="p-2 rounded-lg bg-[#5EC9CC]/20 hover:bg-[#7AD6D8]/30 text-[#5EC9CC] hover:text-[#5EC9CC] disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-[#5EC9CC]/20"
            title="Send (Enter)"
          >
            {agent.isStreaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
        {copied && (
          <div className="text-[10px] text-green-400 mt-1 text-center animate-pulse">
            Copied to clipboard!
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// EMPTY STATE
// ============================================================================

function EmptyState({
  appContext,
  quickActions,
  onQuickAction,
}: {
  appContext: ReturnType<typeof useWindowAgent>['appContext']
  quickActions: AgentQuickAction[]
  onQuickAction: (action: AgentQuickAction) => void
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4 space-y-4">
      {/* Logo */}
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#5EC9CC]/20 to-blue-500/20 flex items-center justify-center border border-[#5EC9CC]/20">
        <Sparkles className="w-6 h-6 text-[#5EC9CC]" />
      </div>

      <div>
        <h3 className="text-sm font-medium text-zinc-300 mb-1">
          {appContext
            ? `AI Assistant for ${appContext.appName}`
            : 'AI Assistant'
          }
        </h3>
        <p className="text-xs text-zinc-500 leading-relaxed">
          {appContext
            ? `I can help you with anything in ${appContext.appName}. Try a quick action or ask me anything.`
            : 'I\'m here to help with whatever you\'re working on. Ask me anything!'
          }
        </p>
      </div>

      {/* Quick actions grid */}
      {quickActions.length > 0 && (
        <div className="w-full space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 uppercase tracking-wider font-medium px-1">
            <Zap className="w-3 h-3" />
            Quick Actions
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {quickActions.slice(0, 6).map(action => (
              <button
                key={action.id}
                onClick={() => onQuickAction(action)}
                className="flex items-center gap-1.5 px-2.5 py-2 text-xs rounded-lg bg-zinc-800/60 hover:bg-zinc-700/60 text-zinc-400 hover:text-zinc-200 border border-zinc-700/30 hover:border-zinc-600/50 transition-all text-left"
              >
                {action.icon && <span>{action.icon}</span>}
                <span className="truncate">{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Keyboard shortcut hint */}
      <div className="text-[10px] text-zinc-600 flex items-center gap-2">
        <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 font-mono">Ctrl+J</kbd>
        <span>toggle sidebar</span>
        <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 font-mono">Ctrl+K</kbd>
        <span>command palette</span>
      </div>
    </div>
  )
}

// ============================================================================
// AGENT TOGGLE BUTTON (for window title bar)
// ============================================================================

interface AgentToggleButtonProps {
  windowId: string
  className?: string
}

export function AgentToggleButton({ windowId, className = '' }: AgentToggleButtonProps) {
  const agent = useWindowAgent(windowId)

  return (
    <button
      onClick={agent.toggle}
      className={`relative p-1.5 rounded-md transition-all ${
        agent.isOpen
          ? 'bg-[#5EC9CC]/20 text-[#5EC9CC] hover:bg-[#7AD6D8]/30'
          : 'text-zinc-500 hover:text-[#5EC9CC] hover:bg-zinc-700/50'
      } ${className}`}
      title={`${agent.isOpen ? 'Close' : 'Open'} AI Agent (Ctrl+J)`}
    >
      <Brain className="w-3.5 h-3.5" />
      {agent.isStreaming && (
        <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-400 rounded-full animate-pulse" />
      )}
    </button>
  )
}

export default AgentSidebar
