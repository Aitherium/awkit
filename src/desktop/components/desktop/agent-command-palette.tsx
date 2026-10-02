'use client'

/**
 * AgentCommandPalette
 * ====================
 *
 * A global quick-access overlay (Ctrl+K) for instant AI agent queries.
 * Think Spotlight/Raycast but for AI — type a question, get an answer.
 *
 * Features:
 *  - Floating overlay that appears center-screen
 *  - Context-aware (knows which window is focused)
 *  - Streaming response inline
 *  - Recently used prompts
 *  - Quick action chips
 *  - Auto-close on Escape
 *  - Send to sidebar for longer conversations
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Sparkles,
  Send,
  X,
  Loader2,
  ArrowRight,
  Brain,
  Copy,
  Check,
  Zap,
  Clock,
  Layers,
} from 'lucide-react'
import {
  useDesktopAgent,
  buildContextualSystemPrompt,
  type SessionLayerMeta,
} from '../../contexts/desktop-agent-context'

// ============================================================================
// TYPES
// ============================================================================

interface PaletteResult {
  content: string
  isStreaming: boolean
  thinkingContent?: string
  error?: string
  activeLayers?: SessionLayerMeta[]
}

// ============================================================================
// COMPONENT
// ============================================================================

export function AgentCommandPalette() {
  const agent = useDesktopAgent()
  const [input, setInput] = useState('')
  const [result, setResult] = useState<PaletteResult | null>(null)
  const [recentPrompts, setRecentPrompts] = useState<string[]>([])
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Focus input when palette opens
  useEffect(() => {
    if (agent.isCommandPaletteOpen) {
      setInput('')
      setResult(null)
      setTimeout(() => inputRef.current?.focus(), 100)
    } else {
      // Abort any in-flight request when closing
      abortRef.current?.abort()
    }
  }, [agent.isCommandPaletteOpen])

  // Global keyboard shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        agent.toggleCommandPalette()
      }
      if (e.key === 'Escape' && agent.isCommandPaletteOpen) {
        e.preventDefault()
        agent.closeCommandPalette()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [agent])

  // Auto-scroll result
  useEffect(() => {
    if (resultRef.current) {
      resultRef.current.scrollTop = resultRef.current.scrollHeight
    }
  }, [result?.content])

  const handleSend = useCallback(async () => {
    const msg = input.trim()
    if (!msg || result?.isStreaming) return

    // Save to recents
    setRecentPrompts(prev => {
      const next = [msg, ...prev.filter(p => p !== msg)].slice(0, 5)
      return next
    })

    setResult({ content: '', isStreaming: true })
    const controller = new AbortController()
    abortRef.current = controller

    try {
      // Get context from the active window
      const activeId = agent.activeWindowId
      const appContext = activeId ? agent.getWindowState(activeId).appContext : null
      const systemPrompt = buildContextualSystemPrompt(appContext)

      // Route through agent-bridge for layered backend context
      const palettePayload = {
        message: msg,
        windowId: activeId || 'command-palette',
        appContext: appContext ? {
          appId: appContext.appId,
          appName: appContext.appName,
          appType: appContext.appType,
          currentState: appContext.currentState,
        } : undefined,
        systemPrompt,
        stream: true,
        serviceQueries: appContext?.relevantServices,
      }
      let response = await fetch('/api/agent-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(palettePayload),
        signal: controller.signal,
      })

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '2', 10)
        await new Promise(r => setTimeout(r, Math.min(retryAfter, 5) * 1000))
        response = await fetch('/api/agent-bridge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(palettePayload),
          signal: controller.signal,
        })
      }
      if (!response.ok) {
        throw new Error(`Agent bridge returned ${response.status}`)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      let thinking = ''
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
                  continue
                }

                if (event.type === 'token' || event.t) {
                  accumulated += event.t || event.token || event.content || ''
                } else if (event.type === 'thinking') {
                  thinking = event.content || ''
                } else if (event.type === 'complete' || event.type === 'final_answer') {
                  if (event.content) accumulated = event.content
                } else if (event.type === 'error') {
                  accumulated = `⚠️ ${event.error || 'Unknown error'}`
                }
              } catch (_e) {
                if (data && data !== '[DONE]') accumulated += data
              }
            }

            setResult({
              content: accumulated,
              isStreaming: true,
              thinkingContent: thinking,
              activeLayers: receivedLayers,
            })
          }
        }
      }

      setResult({
        content: accumulated || 'No response received.',
        isStreaming: false,
        thinkingContent: thinking,
        activeLayers: receivedLayers,
      })
    } catch (error: any) {
      if (error.name === 'AbortError') return
      setResult({
        content: '',
        isStreaming: false,
        error: `Connection failed: ${error.message}. Is Genesis running?`,
      })
    }
  }, [input, result, agent])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleCopy = useCallback(() => {
    if (result?.content) {
      navigator.clipboard.writeText(result.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [result])

  const handleSendToSidebar = useCallback(() => {
    const activeId = agent.activeWindowId
    if (!activeId || !input.trim()) return

    agent.setWindowAgentOpen(activeId, true)
    agent.sendMessage(activeId, input.trim())
    agent.closeCommandPalette()
  }, [agent, input])

  if (!agent.isCommandPaletteOpen) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={agent.closeCommandPalette}
      />

      {/* Palette */}
      <div className="relative w-full max-w-[640px] mx-4 bg-zinc-900/95 border border-zinc-700/60 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden animate-in fade-in slide-in-from-top-4 duration-200">
        {/* Header / Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800/50">
          <div className="relative shrink-0">
            <Sparkles className="w-5 h-5 text-[#5EC9CC]" />
            {result?.isStreaming && (
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            )}
          </div>

          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the AI anything... (Ctrl+K)"
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 outline-none"
            disabled={result?.isStreaming}
          />

          <div className="flex items-center gap-1.5">
            {input.trim() && (
              <button
                onClick={handleSend}
                disabled={result?.isStreaming}
                className="p-1.5 rounded-lg bg-[#5EC9CC]/20 hover:bg-[#7AD6D8]/30 text-[#5EC9CC] disabled:opacity-30 transition-all"
                title="Send"
              >
                {result?.isStreaming ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            )}
            <button
              onClick={agent.closeCommandPalette}
              className="p-1.5 text-zinc-500 hover:text-zinc-300 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Result Area */}
        {result && (
          <div className="border-b border-zinc-800/50">
            <div
              ref={resultRef}
              className="px-4 py-3 max-h-[40vh] overflow-y-auto text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap"
            >
              {result.error ? (
                <div className="flex items-start gap-2 text-red-400">
                  <span className="text-red-500">⚠️</span>
                  <span>{result.error}</span>
                </div>
              ) : (
                <>
                  {result.thinkingContent && (
                    <div className="text-xs text-[#5EC9CC]/60 mb-2 flex items-center gap-1.5">
                      <Brain className="w-3 h-3" />
                      <span className="italic">Thinking...</span>
                    </div>
                  )}
                  <div>
                    {result.content}
                    {result.isStreaming && result.content && (
                      <span className="inline-block w-1.5 h-4 bg-[#5EC9CC] text-[#050507] animate-pulse ml-0.5 align-middle" />
                    )}
                    {result.isStreaming && !result.content && (
                      <span className="inline-flex gap-1 text-zinc-500">
                        <span className="animate-bounce" style={{ animationDelay: '0ms' }}>●</span>
                        <span className="animate-bounce" style={{ animationDelay: '150ms' }}>●</span>
                        <span className="animate-bounce" style={{ animationDelay: '300ms' }}>●</span>
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Result actions */}
            {!result.isStreaming && result.content && (
              <div className="flex items-center justify-between px-4 py-2 bg-zinc-800/30">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopy}
                    className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-zinc-700/50 transition-colors"
                  >
                    {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  {agent.activeWindowId && (
                    <button
                      onClick={handleSendToSidebar}
                      className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-zinc-700/50 transition-colors"
                    >
                      <ArrowRight className="w-3 h-3" />
                      Continue in sidebar
                    </button>
                  )}
                </div>
                {/* Active layers badge */}
                {result.activeLayers && result.activeLayers.length > 0 && (
                  <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                    <Layers className="w-3 h-3" />
                    {result.activeLayers.map(l => (
                      <span
                        key={l.id}
                        className={`px-1 py-0.5 rounded font-mono ${
                          l.id === 'kernel' ? 'text-red-400/70' :
                          l.id === 'services' ? 'text-amber-400/70' :
                          l.id === 'memory' ? 'text-blue-400/70' :
                          'text-emerald-400/70'
                        }`}
                      >
                        L{l.level}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Quick Actions & Recents (when no result) */}
        {!result && (
          <div className="px-4 py-3 space-y-3 max-h-[40vh] overflow-y-auto">
            {/* Context indicator */}
            {agent.activeWindowId && (() => {
              const appCtx = agent.getWindowState(agent.activeWindowId!).appContext
              if (!appCtx) return null
              return (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <Zap className="w-3 h-3 text-[#5EC9CC]" />
                  <span>Context: <span className="text-zinc-400">{appCtx.appName}</span></span>
                  {appCtx.currentState && (
                    <span className="text-zinc-600">— {appCtx.currentState}</span>
                  )}
                </div>
              )
            })()}

            {/* Suggestion chips */}
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: '✨ Summarize this', prompt: 'Summarize what I\'m looking at right now.' },
                { label: '🔧 Help me fix', prompt: 'Help me fix an issue with: ' },
                { label: '💡 Explain this', prompt: 'Explain what I\'m currently looking at.' },
                { label: '📝 Write for me', prompt: 'Write a ' },
                { label: '🧠 Think deeply', prompt: 'Analyze this deeply and give me insights: ' },
                { label: '🔍 Search for', prompt: 'Search and find information about: ' },
              ].map(chip => (
                <button
                  key={chip.label}
                  onClick={() => {
                    setInput(chip.prompt)
                    inputRef.current?.focus()
                  }}
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-zinc-800/60 hover:bg-zinc-700/60 text-zinc-400 hover:text-zinc-200 border border-zinc-700/30 hover:border-zinc-600/50 transition-all"
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* Recent prompts */}
            {recentPrompts.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-600 uppercase tracking-wider font-medium">
                  <Clock className="w-3 h-3" />
                  Recent
                </div>
                {recentPrompts.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setInput(prompt)
                      inputRef.current?.focus()
                    }}
                    className="w-full text-left text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1.5 rounded hover:bg-zinc-800/50 transition-colors truncate"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            {/* Keyboard hints */}
            <div className="flex items-center justify-center gap-4 text-[10px] text-zinc-600 pt-1">
              <div className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-500 font-mono">Enter</kbd>
                <span>send</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-500 font-mono">Esc</kbd>
                <span>close</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AgentCommandPalette
