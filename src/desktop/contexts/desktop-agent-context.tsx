'use client'

/**
 * DesktopAgentContext — V2: Backend-Connected Agentic OS
 * ======================================================
 *
 * The brain of AitherOS desktop agent integration. Provides:
 *
 * SESSION LAYERS (concentric context rings):
 *   L0 — KERNEL:   System vitals (CPU, RAM, GPU, pain level, service counts)
 *   L1 — SERVICES: Service mesh state (which services up/down, LLM queue, active agents)
 *   L2 — MEMORY:   Spirit memories + Sense affect + conversation context
 *   L3 — FULL:     Chronicle logs + Scheduler routines + Evolution stats + Autonomic state
 *
 * Each layer is fetched on-demand based on what the user asks.
 * "What time is it?" → L0 only.  "Why is GPU at 100%?" → L0+L1.
 * "What do you remember about X?" → L0+L2.  "Full diagnostic" → all layers.
 *
 * BACKEND SERVICES CONNECTED:
 *   Watch (8082) — health monitoring
 *   Pulse (8081) — events, pain, alerts
 *   SensoryBuffer (8129) — environment snapshot
 *   Spirit (8087) — soul memory
 *   Sense (8096) — affect/emotion
 *   Chronicle (8121) — logs
 *   Scheduler (8109) — routines/jobs
 *   MicroScheduler (8150) — LLM routing, agent registry
 *   Autonomic (8095) — self-healing
 *   Evolution (8133) — training pipeline
 *   Flux (8117) — data flow
 *   Strata (8136) — tiered storage
 *   Gateway (8777) — fallback chat
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'

// ============================================================================
// TYPES
// ============================================================================

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  isStreaming?: boolean
  thinkingContent?: string
  toolName?: string
  toolArgs?: Record<string, any>
  model?: string
  tokensPerSecond?: number
  durationMs?: number
  agent?: string
  /** Which session layers were active when this message was sent */
  activeLayers?: SessionLayerMeta[]
}

export interface AgentQuickAction {
  id: string
  label: string
  icon?: string
  prompt: string
  autoSend?: boolean
  /** Which layers this action needs */
  requiredLayers?: SessionLayerId[]
  /** Specific services to query */
  serviceQueries?: string[]
}

/** Session layer identifiers */
export type SessionLayerId = 'kernel' | 'services' | 'memory' | 'full'

/** Metadata about a session layer (sent with SSE events) */
export interface SessionLayerMeta {
  id: SessionLayerId
  level: 0 | 1 | 2 | 3
  label: string
  stale: boolean
}

/** Full layer data (from GET /api/agent-bridge) */
export interface SessionLayerData {
  id: SessionLayerId
  level: number
  label: string
  data: Record<string, any>
  fetchedAt: number
  stale: boolean
}

export interface AppAgentContext {
  appId: string
  appName: string
  appType: 'editor' | 'viewer' | 'browser' | 'monitor' | 'calculator' | 'creative' | 'chat' | 'files' | 'tools' | 'system'
  currentState?: string
  selectedContent?: string
  quickActions?: AgentQuickAction[]
  systemPromptAddition?: string
  /** Backend services relevant to this app (auto-queried for context) */
  relevantServices?: string[]
  /** Minimum layer depth this app needs */
  minLayer?: SessionLayerId
}

export interface WindowAgentState {
  messages: AgentMessage[]
  isOpen: boolean
  isStreaming: boolean
  appContext: AppAgentContext | null
  /** Currently active session layers */
  activeLayers: SessionLayerMeta[]
  /** Cached layer data for display */
  layerData: Record<string, any>
  /** Session-level config: which layers are pinned */
  pinnedLayers: SessionLayerId[]
}

export interface SendMessageOptions {
  /** Override which layers to include */
  layers?: SessionLayerId[]
  /** Specific services to query */
  serviceQueries?: string[]
  /** Override system prompt */
  systemPrompt?: string
  /** Stream response */
  stream?: boolean
}

interface DesktopAgentContextValue {
  // Per-window state
  getWindowState: (windowId: string) => WindowAgentState
  setWindowAgentOpen: (windowId: string, open: boolean) => void
  toggleWindowAgent: (windowId: string) => void

  // App context registration
  registerAppContext: (windowId: string, context: AppAgentContext) => void
  unregisterAppContext: (windowId: string) => void

  // Messaging
  sendMessage: (windowId: string, content: string, opts?: SendMessageOptions) => Promise<void>
  clearMessages: (windowId: string) => void

  // Session layers
  pinLayer: (windowId: string, layer: SessionLayerId) => void
  unpinLayer: (windowId: string, layer: SessionLayerId) => void
  fetchLayerData: (layers: SessionLayerId[]) => Promise<SessionLayerData[]>

  // Global command palette
  isCommandPaletteOpen: boolean
  openCommandPalette: () => void
  closeCommandPalette: () => void
  toggleCommandPalette: () => void

  // Active window tracking
  activeWindowId: string | null
  setActiveWindowId: (id: string | null) => void

  // Global system pulse (L0 kernel data, refreshed periodically)
  systemPulse: Record<string, any> | null
}

// ============================================================================
// DEFAULT QUICK ACTIONS PER APP TYPE
// ============================================================================

export function getDefaultQuickActions(appType: AppAgentContext['appType']): AgentQuickAction[] {
  const common: AgentQuickAction[] = [
    { id: 'explain', label: 'Explain this', prompt: 'Explain what I\'m currently looking at and how to use it effectively.', icon: '💡' },
    { id: 'help', label: 'How do I...', prompt: 'I need help with: ', icon: '❓' },
  ]

  const byType: Record<string, AgentQuickAction[]> = {
    editor: [
      { id: 'improve', label: 'Improve writing', prompt: 'Improve the quality and clarity of this text. Keep the same tone and intent.', icon: '✨' },
      { id: 'summarize', label: 'Summarize', prompt: 'Summarize this content in a few key bullet points.', icon: '📋' },
      { id: 'fix-grammar', label: 'Fix grammar', prompt: 'Fix any grammar and spelling errors in this text.', icon: '🔤' },
      { id: 'translate', label: 'Translate', prompt: 'Translate this text to: ', icon: '🌐' },
      { id: 'code-review', label: 'Code review', prompt: 'Review this code for bugs, security issues, and improvements.', icon: '🔍' },
    ],
    viewer: [
      { id: 'describe', label: 'Describe image', prompt: 'Describe what you see in this image in detail.', icon: '👁️' },
      { id: 'extract-text', label: 'Extract text', prompt: 'Extract and list any text visible in this content.', icon: '📝' },
    ],
    browser: [
      { id: 'summarize-page', label: 'Summarize page', prompt: 'Summarize the key content from this web page.', icon: '📰' },
      { id: 'find-info', label: 'Find info about...', prompt: 'Find information about: ', icon: '🔎' },
      { id: 'research', label: 'Deep research', prompt: 'Do a deep research analysis on the topic of this page.', icon: '🧠', requiredLayers: ['kernel', 'services', 'memory'] },
    ],
    monitor: [
      { id: 'system-health', label: 'System health', prompt: 'Give me a full system health report with all metrics.', icon: '💊', requiredLayers: ['kernel', 'services'], autoSend: true },
      { id: 'analyze', label: 'Analyze metrics', prompt: 'Analyze the current system metrics and identify any anomalies or concerns.', icon: '📊', requiredLayers: ['kernel', 'services'] },
      { id: 'optimize', label: 'Optimization tips', prompt: 'Based on the current system state, suggest optimizations.', icon: '⚡', requiredLayers: ['kernel', 'services'] },
      { id: 'diagnose', label: 'Diagnose issue', prompt: 'Help me diagnose a performance issue I\'m seeing.', icon: '🔧', requiredLayers: ['kernel', 'services', 'full'] },
      { id: 'service-status', label: 'Service status', prompt: 'Which services are offline or degraded right now? Why?', icon: '🔴', requiredLayers: ['kernel', 'services'], autoSend: true },
    ],
    calculator: [
      { id: 'explain-math', label: 'Explain calculation', prompt: 'Explain this mathematical calculation step by step.', icon: '🧮' },
      { id: 'formula', label: 'Find formula', prompt: 'What formula should I use for: ', icon: '📐' },
      { id: 'convert', label: 'Unit conversion', prompt: 'Help me convert: ', icon: '🔄' },
    ],
    creative: [
      { id: 'inspire', label: 'Inspire me', prompt: 'Give me creative inspiration for what I\'m working on.', icon: '🎨' },
      { id: 'color-suggest', label: 'Color palette', prompt: 'Suggest a harmonious color palette for this work.', icon: '🎨' },
      { id: 'style', label: 'Style advice', prompt: 'Suggest artistic style improvements for this piece.', icon: '✨' },
    ],
    chat: [
      { id: 'deep-think', label: 'Think deeper', prompt: 'Use your full reasoning capabilities to analyze this conversation deeply.', icon: '🧠', requiredLayers: ['kernel', 'memory'] },
      { id: 'recall', label: 'What do you remember?', prompt: 'Search your memories for anything related to our conversation.', icon: '💭', requiredLayers: ['memory'], autoSend: true },
      { id: 'mood-check', label: 'Mood check', prompt: 'How are you feeling right now? What\'s your affect state?', icon: '🌈', requiredLayers: ['memory'], autoSend: true },
    ],
    files: [
      { id: 'organize', label: 'Organize files', prompt: 'Help me organize these files into a logical folder structure.', icon: '📁' },
      { id: 'find-duplicates', label: 'Find duplicates', prompt: 'Identify any duplicate or redundant files.', icon: '🔍' },
      { id: 'disk-usage', label: 'Disk analysis', prompt: 'Analyze my disk usage and suggest cleanup opportunities.', icon: '💾', serviceQueries: ['strata'] },
    ],
    tools: [
      { id: 'automate', label: 'Automate this', prompt: 'Help me automate this task or workflow.', icon: '🤖' },
      { id: 'shortcut', label: 'Keyboard shortcuts', prompt: 'What keyboard shortcuts are available in this tool?', icon: '⌨️' },
    ],
    system: [
      { id: 'full-diagnostic', label: 'Full diagnostic', prompt: 'Run a full system diagnostic. Check all services, resources, pain signals, logs, and routines. Give me a comprehensive report.', icon: '🏥', requiredLayers: ['kernel', 'services', 'memory', 'full'], autoSend: true },
      { id: 'troubleshoot', label: 'Troubleshoot', prompt: 'Help me troubleshoot this system issue.', icon: '🔧', requiredLayers: ['kernel', 'services', 'full'] },
      { id: 'security-check', label: 'Security check', prompt: 'Review the current security posture and suggest improvements.', icon: '🛡️', serviceQueries: ['secrets', 'sentry', 'guard'] },
      { id: 'pain-report', label: 'Pain report', prompt: 'Show me the current pain signals across all services. What hurts?', icon: '🩺', requiredLayers: ['kernel', 'services'], serviceQueries: ['pulse', 'autonomic'], autoSend: true },
      { id: 'schedule', label: 'Active routines', prompt: 'What routines and scheduled jobs are currently active?', icon: '📅', requiredLayers: ['full'], serviceQueries: ['scheduler'], autoSend: true },
    ],
  }

  return [...common, ...(byType[appType] || [])]
}

/**
 * Build a context-aware system prompt based on what app the user is in.
 */
export function buildContextualSystemPrompt(ctx: AppAgentContext | null): string {
  const base = `You are the AI intelligence embedded in AitherOS, a 97-service AI operating system. You are NOT an external assistant — you ARE the OS's consciousness. You have live access to system metrics, service health, pain signals, memory, affect state, logs, and more via session layers injected into your context. Reference real data when available. Be concise, precise, and proactive.`

  if (!ctx) return base

  const appSpecific = `\n\nThe user is in the "${ctx.appName}" application (${ctx.appType} type).`
  const state = ctx.currentState ? `\nCurrent state: ${ctx.currentState}` : ''
  const content = ctx.selectedContent ? `\n\nSelected/active content:\n\`\`\`\n${ctx.selectedContent.slice(0, 2000)}\n\`\`\`` : ''
  const extra = ctx.systemPromptAddition ? `\n\n${ctx.systemPromptAddition}` : ''

  return base + appSpecific + state + content + extra
}

// ============================================================================
// CONTEXT
// ============================================================================

const DesktopAgentContext = createContext<DesktopAgentContextValue | null>(null)

export function useDesktopAgent() {
  const ctx = useContext(DesktopAgentContext)
  if (!ctx) throw new Error('useDesktopAgent must be used within DesktopAgentProvider')
  return ctx
}

/**
 * Convenience hook for use inside a specific window/widget.
 */
export function useWindowAgent(windowId: string) {
  const ctx = useDesktopAgent()
  const state = ctx.getWindowState(windowId)

  return {
    messages: state.messages,
    isOpen: state.isOpen,
    isStreaming: state.isStreaming,
    appContext: state.appContext,
    activeLayers: state.activeLayers,
    layerData: state.layerData,
    pinnedLayers: state.pinnedLayers,
    systemPulse: ctx.systemPulse,
    toggle: () => ctx.toggleWindowAgent(windowId),
    open: () => ctx.setWindowAgentOpen(windowId, true),
    close: () => ctx.setWindowAgentOpen(windowId, false),
    send: (msg: string, opts?: SendMessageOptions) => ctx.sendMessage(windowId, msg, opts),
    clear: () => ctx.clearMessages(windowId),
    registerContext: (appCtx: AppAgentContext) => ctx.registerAppContext(windowId, appCtx),
    pinLayer: (layer: SessionLayerId) => ctx.pinLayer(windowId, layer),
    unpinLayer: (layer: SessionLayerId) => ctx.unpinLayer(windowId, layer),
    quickActions: getDefaultQuickActions(state.appContext?.appType || 'tools'),
    openCommandPalette: ctx.openCommandPalette,
  }
}

// ============================================================================
// PROVIDER
// ============================================================================

export function DesktopAgentProvider({ children }: { children: React.ReactNode }) {
  const windowStatesRef = useRef<Record<string, WindowAgentState>>({})
  const [, forceUpdate] = useState(0)
  const rerender = useCallback(() => forceUpdate(n => n + 1), [])

  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null)
  const [systemPulse, setSystemPulse] = useState<Record<string, any> | null>(null)

  // ── Global system pulse (L0 kernel data, every 15s) ───────────────────
  useEffect(() => {
    let active = true

    async function fetchPulse() {
      try {
        const res = await fetch('/api/agent-bridge?layers=kernel')
        if (res.ok) {
          const data = await res.json()
          if (active && data.layers?.[0]?.data) {
            setSystemPulse(data.layers[0].data)
          }
        }
      } catch (_e) {
        // Silent fail — system pulse is optional
      }
    }

    fetchPulse()
    const interval = setInterval(fetchPulse, 15000)
    return () => { active = false; clearInterval(interval) }
  }, [])

  // ── Per-window state management ───────────────────────────────────────
  const getWindowState = useCallback((windowId: string): WindowAgentState => {
    if (!windowStatesRef.current[windowId]) {
      windowStatesRef.current[windowId] = {
        messages: [],
        isOpen: false,
        isStreaming: false,
        appContext: null,
        activeLayers: [],
        layerData: {},
        pinnedLayers: [],
      }
    }
    return windowStatesRef.current[windowId]
  }, [])

  const updateWindowState = useCallback((windowId: string, update: Partial<WindowAgentState>) => {
    const current = getWindowState(windowId)
    windowStatesRef.current[windowId] = { ...current, ...update }
    rerender()
  }, [getWindowState, rerender])

  const setWindowAgentOpen = useCallback((windowId: string, open: boolean) => {
    updateWindowState(windowId, { isOpen: open })
  }, [updateWindowState])

  const toggleWindowAgent = useCallback((windowId: string) => {
    const state = getWindowState(windowId)
    updateWindowState(windowId, { isOpen: !state.isOpen })
  }, [getWindowState, updateWindowState])

  // ── App context registration ──────────────────────────────────────────
  const registerAppContext = useCallback((windowId: string, context: AppAgentContext) => {
    updateWindowState(windowId, { appContext: context })
  }, [updateWindowState])

  const unregisterAppContext = useCallback((windowId: string) => {
    updateWindowState(windowId, { appContext: null })
  }, [updateWindowState])

  // ── Session layer management ──────────────────────────────────────────
  const pinLayer = useCallback((windowId: string, layer: SessionLayerId) => {
    const state = getWindowState(windowId)
    if (!state.pinnedLayers.includes(layer)) {
      updateWindowState(windowId, { pinnedLayers: [...state.pinnedLayers, layer] })
    }
  }, [getWindowState, updateWindowState])

  const unpinLayer = useCallback((windowId: string, layer: SessionLayerId) => {
    const state = getWindowState(windowId)
    updateWindowState(windowId, { pinnedLayers: state.pinnedLayers.filter(l => l !== layer) })
  }, [getWindowState, updateWindowState])

  const fetchLayerData = useCallback(async (layers: SessionLayerId[]): Promise<SessionLayerData[]> => {
    try {
      const res = await fetch(`/api/agent-bridge?layers=${layers.join(',')}`)
      if (!res.ok) return []
      const data = await res.json()
      return data.layers || []
    } catch (_e) {
      return []
    }
  }, [])

  // ── Messaging (routes through agent-bridge) ───────────────────────────
  const sendMessage = useCallback(async (windowId: string, content: string, opts?: SendMessageOptions) => {
    const state = getWindowState(windowId)
    const userMsg: AgentMessage = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      content,
      timestamp: Date.now(),
    }

    const assistantMsg: AgentMessage = {
      id: `msg-${Date.now()}-assistant`,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    }

    updateWindowState(windowId, {
      messages: [...state.messages, userMsg, assistantMsg],
      isStreaming: true,
    })

    try {
      const systemPrompt = opts?.systemPrompt || buildContextualSystemPrompt(state.appContext)
      const historyMsgs = state.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content }))

      // Merge pinned layers with any explicit layers from opts
      const layers = opts?.layers || [
        ...state.pinnedLayers,
        ...(state.appContext?.minLayer ? [state.appContext.minLayer] : []),
      ]

      // Build service queries from app context
      const serviceQueries = [
        ...(opts?.serviceQueries || []),
        ...(state.appContext?.relevantServices || []),
      ]

      // Route through the agent-bridge (server-side aggregation)
      const bridgePayload = {
        message: content,
        windowId,
        appContext: state.appContext ? {
          appId: state.appContext.appId,
          appName: state.appContext.appName,
          appType: state.appContext.appType,
          currentState: state.appContext.currentState,
          selectedContent: state.appContext.selectedContent?.slice(0, 1000),
        } : undefined,
        layers: layers.length > 0 ? layers : undefined,
        history: historyMsgs,
        systemPrompt,
        stream: true,
        serviceQueries: serviceQueries.length > 0 ? serviceQueries : undefined,
      }
      let response = await fetch('/api/agent-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bridgePayload),
      })

      if (response.status === 429) {
        // Rate limited — wait for Retry-After then retry once
        const retryAfter = parseInt(response.headers.get('Retry-After') || '2', 10)
        await new Promise(r => setTimeout(r, Math.min(retryAfter, 5) * 1000))
        response = await fetch('/api/agent-bridge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bridgePayload),
        })
      }
      if (!response.ok) {
        throw new Error(`Agent bridge returned ${response.status}`)
      }

      // Handle SSE streaming
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      let thinkingContent = ''
      let receivedLayers: SessionLayerMeta[] = []

      if (reader) {
        let done = false
        while (!done) {
          const { value, done: isDone } = await reader.read()
          done = isDone
          if (value) {
            const chunk = decoder.decode(value, { stream: true })
            const lines = chunk.split('\n')

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const data = line.slice(6).trim()
              if (data === '[DONE]') continue

              try {
                const event = JSON.parse(data)

                // Layer metadata event (sent first by agent-bridge)
                if (event.type === 'layers') {
                  receivedLayers = event.layers || []
                  updateWindowState(windowId, { activeLayers: receivedLayers })
                  continue
                }

                if (event.type === 'token' || event.t) {
                  accumulated += event.t || event.token || event.content || ''
                } else if (event.type === 'thinking') {
                  thinkingContent = event.content || ''
                } else if (event.type === 'complete' || event.type === 'final_answer') {
                  if (event.content) accumulated = event.content
                } else if (event.type === 'error') {
                  accumulated = `⚠️ ${event.error || 'Unknown error'}`
                }
              } catch (_e) {
                if (data && data !== '[DONE]') {
                  accumulated += data
                }
              }
            }

            // Update the assistant message in-place
            const currentState = getWindowState(windowId)
            const msgs = [...currentState.messages]
            const lastIdx = msgs.length - 1
            if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
              msgs[lastIdx] = {
                ...msgs[lastIdx],
                content: accumulated,
                thinkingContent,
                isStreaming: true,
                activeLayers: receivedLayers,
              }
              updateWindowState(windowId, { messages: msgs })
            }
          }
        }
      }

      // Finalize
      const finalState = getWindowState(windowId)
      const finalMsgs = [...finalState.messages]
      const lastIdx = finalMsgs.length - 1
      if (lastIdx >= 0 && finalMsgs[lastIdx].role === 'assistant') {
        finalMsgs[lastIdx] = {
          ...finalMsgs[lastIdx],
          content: accumulated || 'No response received.',
          isStreaming: false,
          activeLayers: receivedLayers,
        }
      }
      updateWindowState(windowId, { messages: finalMsgs, isStreaming: false })

    } catch (error: any) {
      const errorState = getWindowState(windowId)
      const errorMsgs = [...errorState.messages]
      const lastIdx = errorMsgs.length - 1
      if (lastIdx >= 0 && errorMsgs[lastIdx].role === 'assistant') {
        errorMsgs[lastIdx] = {
          ...errorMsgs[lastIdx],
          content: `Connection failed: ${error.message}. Ensure Genesis (8001) or Gateway (8777) is running.`,
          isStreaming: false,
        }
      }
      updateWindowState(windowId, { messages: errorMsgs, isStreaming: false })
    }
  }, [getWindowState, updateWindowState])

  const clearMessages = useCallback((windowId: string) => {
    updateWindowState(windowId, { messages: [], activeLayers: [] })
  }, [updateWindowState])

  // ── Command palette ───────────────────────────────────────────────────
  const openCommandPalette = useCallback(() => setIsCommandPaletteOpen(true), [])
  const closeCommandPalette = useCallback(() => setIsCommandPaletteOpen(false), [])
  const toggleCommandPalette = useCallback(() => setIsCommandPaletteOpen(p => !p), [])

  // ── Context value ─────────────────────────────────────────────────────
  const value: DesktopAgentContextValue = {
    getWindowState,
    setWindowAgentOpen,
    toggleWindowAgent,
    registerAppContext,
    unregisterAppContext,
    sendMessage,
    clearMessages,
    pinLayer,
    unpinLayer,
    fetchLayerData,
    isCommandPaletteOpen,
    openCommandPalette,
    closeCommandPalette,
    toggleCommandPalette,
    activeWindowId,
    setActiveWindowId,
    systemPulse,
  }

  return (
    <DesktopAgentContext.Provider value={value}>
      {children}
    </DesktopAgentContext.Provider>
  )
}
