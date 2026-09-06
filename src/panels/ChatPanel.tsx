'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useConfig } from '../hooks/useConfig'
import CitationPopover, { renderCitedText, type Citation } from '../ui/CitationPopover'
import FeedbackButtons from '../ui/FeedbackButtons'
import SourceCitations from '../ui/SourceCitations'
import SelectionCard from '../ui/SelectionCard'
import BrandGlyph from '../ui/BrandGlyph'
import { useTheme } from '../ui/ThemeProvider'
import { markFile } from '../lib/brandTokens'
import { useVoiceChat } from '../voice/useVoiceChat'
import { VoiceMicButton } from '../voice/VoiceMicButton'

interface LLMUsage {
  provider: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost_usd: number
  is_fallback?: boolean
}

interface PipelineTrace {
  intent: string
  effort: number
  domain: string
  model_tier: string
  reasoning_depth: string
  max_steps: number
  max_tokens?: number
  using_microscheduler: boolean
  context: { memories: number; history_turns: number; rag_sources: number; tools_available: number }
}

interface PipelineUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  model_tier: string
  turns: { turn: number; model: string; latency_ms: number; prompt_tokens: number; completion_tokens: number }[]
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  message_id?: string
  sources?: any[]
  confidence?: number
  confidence_source?: string
  citations?: Citation[]
  citation_coverage?: number
  isError?: boolean
  steering?: boolean   // a follow-up that STEERED the running loop (Layer 2)
  attachments?: { name: string; type: string }[]
  usage?: LLMUsage
  tool_calls?: { step: number; name: string; args?: Record<string, unknown>; ok: boolean; result?: unknown }[]
  selection?: {
    query: string
    recommendations: { name: string; [key: string]: unknown }[]
    category: string
  }
  pipeline?: PipelineTrace
  pipeline_usage?: PipelineUsage
}

interface Props {
  conversationId: string | null
  onNewConversation: (id: string) => void
  externalInput?: string
  onExternalInputConsumed?: () => void
  voiceEnabled?: boolean
  voiceTier?: 'browser' | 'server'
}

function parseSelection(content: string): Message['selection'] | undefined {
  const match = content.match(/```selection\n([\s\S]*?)```/)
  if (!match) return undefined
  try {
    const parsed = JSON.parse(match[1])
    if (parsed.type === 'selection' && Array.isArray(parsed.recommendations)) {
      return { query: parsed.query || '', recommendations: parsed.recommendations, category: parsed.category || 'general' }
    }
  } catch { /* not valid JSON */ }
  return undefined
}

function stripSelectionBlock(content: string): string {
  return content.replace(/```selection\n[\s\S]*?```/, '').trim()
}

function formatMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code style="background:var(--bg-elevated);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em">$1</code>')
    .replace(/^- (.*)/gm, '<li style="margin-left:1rem">$1</li>')
    .replace(/^(\d+)\. (.*)/gm, '<li style="margin-left:1rem">$2</li>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>')
}

/** Parse <think>...</think> blocks out of a complete response string */
function parseThinkBlocks(text: string): { thinking: string; content: string } {
  const thinkRe = /<think>([\s\S]*?)<\/think>\s*/g
  let thinking = ''
  let match
  while ((match = thinkRe.exec(text)) !== null) {
    thinking += match[1].trim() + '\n'
  }
  const content = text.replace(thinkRe, '').trim()
  return { thinking: thinking.trim(), content }
}

function ThinkingBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  // Default open = true. If we collapsed after streaming finished, the
  // reasoning the user just watched scroll by would visibly disappear when
  // the final assistant message hydrates -- which reads as a UI bug.
  const [open, setOpen] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  const thinkRafRef = useRef<number>(0)

  useEffect(() => {
    if (streaming && ref.current) {
      if (thinkRafRef.current) cancelAnimationFrame(thinkRafRef.current)
      thinkRafRef.current = requestAnimationFrame(() => {
        thinkRafRef.current = 0
        if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
      })
    }
    return () => { if (thinkRafRef.current) cancelAnimationFrame(thinkRafRef.current) }
  }, [text, streaming])

  if (!text) return null
  return (
    <div style={{
      marginBottom: 8, borderRadius: 'var(--radius, 8px)',
      border: '1px solid rgba(180, 160, 140, 0.15)',
      background: 'rgba(196, 149, 106, 0.06)',
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          padding: '6px 10px', background: 'none',
          color: 'var(--text-muted)', fontSize: '0.7rem', cursor: 'pointer',
          fontStyle: 'italic', border: 'none',
        }}
      >
        <span style={streaming ? { animation: 'pk-pulse 1.5s ease infinite' } : undefined}>
          {streaming ? 'Thinking...' : 'Reasoning'}
        </span>
        <span style={{ fontSize: '0.6rem' }}>{open ? '\u25BC' : '\u25B6'}</span>
      </button>
      {open && (
        <div ref={ref} style={{
          padding: '6px 10px 10px', fontSize: '0.75rem', lineHeight: 1.5,
          color: 'var(--text-muted)', whiteSpace: 'pre-wrap',
          borderTop: '1px solid rgba(180, 160, 140, 0.1)',
          maxHeight: 300, overflow: 'auto',
        }}>
          {text}
        </div>
      )}
    </div>
  )
}

type StreamEvent =
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_start'; step: number; name: string; args?: Record<string, unknown> }
  | { kind: 'tool_result'; step: number; name: string; args?: Record<string, unknown>; ok: boolean; result?: unknown }
  | { kind: 'status'; text: string }
  | { kind: 'content'; text: string }
  | { kind: 'turn_start'; turn: number }
  | { kind: 'turn_end'; turn: number; model?: string; latency_ms?: number; prompt_tokens?: number; completion_tokens?: number }

function StreamTimeline({ events, formattedContent, status }: {
  events: StreamEvent[]; formattedContent: string; status: string | null
}) {
  const { brand } = useTheme()
  const ref = useRef<HTMLDivElement>(null)
  const rafId = useRef(0)

  useEffect(() => {
    if (rafId.current) cancelAnimationFrame(rafId.current)
    rafId.current = requestAnimationFrame(() => {
      rafId.current = 0
      if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
    })
    return () => { if (rafId.current) cancelAnimationFrame(rafId.current) }
  }, [events, formattedContent])

  if (events.length === 0 && !formattedContent) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)' }}>
        {markFile(brand, 'spark') ? (
          <BrandGlyph brand={brand} markKey="spark" className="loading-spinner"
            style={{ border: 'none', borderRadius: 0, color: 'var(--accent-primary)' }} />
        ) : (
          <div className="loading-spinner" />
        )}
        <span style={{ fontSize: '0.85rem' }}>{status || 'Waiting for model...'}</span>
      </div>
    )
  }

  return (
    <div ref={ref} style={{ maxHeight: 500, overflowY: 'auto' }}>
      {events.map((evt, i) => {
        if (evt.kind === 'thinking') return (
          <div key={i} style={{
            fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic',
            padding: '4px 0', lineHeight: 1.5, whiteSpace: 'pre-wrap',
          }}>
            {evt.text}
          </div>
        )
        if (evt.kind === 'tool_start') return (
          <div key={i} style={{
            padding: '4px 8px', margin: '4px 0', borderRadius: 4,
            background: 'rgba(100, 180, 255, 0.08)',
            border: '1px solid rgba(100, 180, 255, 0.15)',
            fontSize: '0.75rem', color: 'var(--text-muted)',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <span style={{ animation: 'pk-pulse 1.5s ease infinite' }}>{'\u27F3'}</span>
            <span style={{ fontFamily: 'monospace' }}>Calling {evt.name}...</span>
          </div>
        )
        if (evt.kind === 'tool_result') return (
          <ToolResultBlock key={i} evt={evt} />
        )
        if (evt.kind === 'status') return (
          <div key={i} style={{
            fontSize: '0.7rem', color: 'var(--text-muted)', padding: '2px 0', opacity: 0.7,
          }}>
            {evt.text}
          </div>
        )
        return null
      })}
      {formattedContent && (
        <div style={{ marginTop: events.length > 0 ? 8 : 0 }}
          dangerouslySetInnerHTML={{ __html: formattedContent }} />
      )}
    </div>
  )
}

function ToolResultBlock({ evt }: { evt: StreamEvent & { kind: 'tool_result' } }) {
  const [open, setOpen] = useState(false)
  const resultStr = evt.result != null ? JSON.stringify(evt.result, null, 2) : ''
  const preview = resultStr.length > 200 ? resultStr.slice(0, 200) + '...' : resultStr

  return (
    <div style={{
      padding: '4px 8px', margin: '4px 0', borderRadius: 4,
      background: evt.ok ? 'rgba(100, 200, 150, 0.08)' : 'rgba(255, 100, 100, 0.08)',
      border: `1px solid ${evt.ok ? 'rgba(100, 200, 150, 0.15)' : 'rgba(255, 100, 100, 0.15)'}`,
      fontSize: '0.75rem',
    }}>
      <button onClick={() => setOpen(!open)} style={{
        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        display: 'flex', alignItems: 'center', gap: 4, width: '100%',
        color: evt.ok ? 'var(--accent-green, #4ade80)' : 'var(--accent-coral, #f87171)',
        fontFamily: 'monospace', fontSize: '0.75rem',
      }}>
        <span>{evt.ok ? '\u2713' : '\u2717'}</span>
        <span>{evt.name}</span>
        {evt.args && <span style={{ opacity: 0.5, fontStyle: 'normal' }}>({Object.keys(evt.args).join(', ')})</span>}
        <span style={{ marginLeft: 'auto', fontSize: '0.6rem' }}>{open ? '\u25BC' : '\u25B6'}</span>
      </button>
      {open && resultStr && (
        <pre style={{
          margin: '4px 0 0', padding: '6px', borderRadius: 3,
          background: 'rgba(0,0,0,0.15)', fontSize: '0.65rem',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 200, overflowY: 'auto', color: 'var(--text-secondary)',
        }}>
          {preview}
        </pre>
      )}
    </div>
  )
}

function UsageBadge({ usage }: { usage: LLMUsage }) {
  const costStr = usage.cost_usd > 0 ? `$${usage.cost_usd.toFixed(4)}` : 'local'
  return (
    <div style={{
      marginTop: 4, fontSize: '0.6rem', color: 'var(--text-muted)',
      opacity: 0.6, display: 'flex', gap: 8, flexWrap: 'wrap',
    }}>
      <span>{usage.provider}/{usage.model}</span>
      <span>{usage.total_tokens} tok</span>
      <span>{costStr}</span>
      {usage.is_fallback && (
        <span style={{ color: '#e67e22', fontWeight: 600 }}>FALLBACK</span>
      )}
    </div>
  )
}

function PipelineTraceBadge({ pipeline, usage }: { pipeline?: PipelineTrace; usage?: PipelineUsage }) {
  const [expanded, setExpanded] = useState(false)
  if (!pipeline) return null

  const effortColors: Record<string, string> = {
    '1': '#64748b', '2': '#64748b',
    '3': '#3b82f6', '4': '#3b82f6',
    '5': '#22c55e', '6': '#22c55e',
    '7': '#f59e0b', '8': '#f59e0b',
    '9': '#8b5cf6', '10': '#8b5cf6',
  }
  const eColor = effortColors[String(pipeline.effort)] || '#64748b'

  return (
    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 4 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer',
          color: 'var(--text-muted)', fontSize: '0.65rem', textAlign: 'left',
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}
      >
        <span style={{ color: eColor, fontWeight: 600 }}>E{pipeline.effort}</span>
        <span style={{ opacity: 0.5 }}>&middot;</span>
        <span>{pipeline.model_tier}</span>
        <span style={{ opacity: 0.5 }}>&middot;</span>
        <span>{pipeline.reasoning_depth}</span>
        {pipeline.using_microscheduler && (
          <><span style={{ opacity: 0.5 }}>&middot;</span><span style={{ color: '#f59e0b', fontWeight: 600 }}>MS</span></>
        )}
        {usage && usage.total_tokens > 0 && (
          <><span style={{ opacity: 0.5 }}>&middot;</span><span>{usage.total_tokens} tok</span></>
        )}
        <span style={{ opacity: 0.4, fontSize: '0.55rem' }}>{expanded ? '\u25B4' : '\u25BE'}</span>
      </button>
      {expanded && (
        <div style={{
          marginTop: 2, padding: '4px 8px',
          background: 'var(--glass-bg, rgba(0,0,0,0.15))',
          borderRadius: 'var(--radius, 6px)',
          lineHeight: 1.6,
        }}>
          <div>Intent: {pipeline.intent} ({pipeline.domain})</div>
          <div>Model: {pipeline.model_tier} &middot; Reasoning: {pipeline.reasoning_depth}</div>
          <div>Context: {pipeline.context.memories} memories, {pipeline.context.history_turns} history, {pipeline.context.rag_sources} RAG, {pipeline.context.tools_available} tools</div>
          {usage && usage.total_tokens > 0 && (
            <>
              <div>Tokens: {usage.prompt_tokens} in / {usage.completion_tokens} out = {usage.total_tokens}</div>
              {usage.turns.map(t => (
                <div key={t.turn} style={{ opacity: 0.8 }}>
                  Turn {t.turn}: {t.model || '?'} &middot; {t.latency_ms}ms &middot; {t.prompt_tokens}&rarr;{t.completion_tokens} tok
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

type ChatEngine = 'aitherchat' | 'native'
const ENGINE_KEY = 'app:chat-engine'
function getStoredEngine(): ChatEngine {
  // Default = 'aitherchat' so the bot actually has access to calendar /
  // mail / contacts / comms tools. 'native' goes to /api/chat/stream which
  // is a bare LLM call with NO tool access -- that path makes the bot
  // confidently claim it cannot see the user's data, which is the wrong
  // demo experience.
  try { return (localStorage.getItem(ENGINE_KEY) as ChatEngine) || 'aitherchat' } catch { return 'aitherchat' }
}

export default function ChatPanel({ conversationId, onNewConversation, externalInput, onExternalInputConsumed, voiceEnabled: voiceEnabledProp, voiceTier: voiceTierProp }: Props) {
  const config = useConfig()
  const { brand } = useTheme()

  // Voice config: props override brain pack config
  const voiceCfg = config.voice
  const voiceEnabled = voiceEnabledProp ?? voiceCfg?.enabled ?? false
  const voiceTier = voiceTierProp ?? (voiceCfg?.default_tier as 'browser' | 'server') ?? 'browser'
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [lastFailedInput, setLastFailedInput] = useState('')
  const [engine, setEngine] = useState<ChatEngine>(getStoredEngine)

  // Streaming state
  const [streamThinking, setStreamThinking] = useState('')
  const [streamContent, setStreamContent] = useState('')
  const [streamStatus, setStreamStatus] = useState<string | null>(null)
  const [streamToolCalls, setStreamToolCalls] = useState<any[]>([])
  const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  // Pre-send LLM-lane health: null=unknown, true=usable, false=down. When down
  // we surface an obvious banner and block Send so the user never types into a
  // wedged backend and waits minutes.
  const [llmOk, setLlmOk] = useState<boolean | null>(null)
  const [llmDetail, setLlmDetail] = useState('')
  // composite key `${msgIdx}:${toolStep}` -> expanded?
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({})

  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // When we just sent a message and got a new conversation_id back, skip the
  // history reload — the in-memory messages are already complete (with thinking,
  // tool_calls, etc.) and the DB persist may still be in flight.
  const skipHistoryReload = useRef(false)

  // rAF-throttled stream state flushing — coalesces per-token updates to ~60fps
  const rafRef = useRef<number>(0)
  const pendingStreamRef = useRef<{ content: string; thinking: string; status: string | null }>({ content: '', thinking: '', status: null })

  const scheduleStreamFlush = useCallback(() => {
    if (rafRef.current) return  // already scheduled
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      const { content, thinking, status } = pendingStreamRef.current
      setStreamContent(content)
      setStreamThinking(thinking)
      if (status !== null) setStreamStatus(status)
    })
  }, [])

  // Voice chat integration
  const sendForVoice = useCallback(async (text: string): Promise<string> => {
    // Reuse the existing send flow but return the assistant response text
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setLoading(true)
    try {
      const resp = await fetch(engine === 'aitherchat' ? '/api/chat/aither' : '/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversation_id: conversationId || undefined }),
      })
      if (!resp.ok) throw new Error(`Server error (${resp.status})`)
      const data = await resp.json()
      const responseText = data.response || data.content || ''
      const parsed = parseThinkBlocks(responseText)
      const selection = parseSelection(parsed.content)
      const displayContent = selection ? stripSelectionBlock(parsed.content) : parsed.content
      setMessages(prev => [...prev, {
        role: 'assistant', content: displayContent.trim(),
        thinking: parsed.thinking || undefined,
        message_id: data.message_id, sources: data.sources, selection,
        confidence: data.confidence, citations: data.citations,
      }])
      if (!conversationId && data.conversation_id) {
        skipHistoryReload.current = true
        onNewConversation(data.conversation_id)
      }
      return displayContent.trim()
    } catch (err: any) {
      const errMsg = err.message || 'Failed to get response'
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errMsg}`, isError: true }])
      return ''
    } finally {
      setLoading(false)
    }
  }, [engine, conversationId, onNewConversation])

  const voice = useVoiceChat({
    enabled: voiceEnabled,
    tier: voiceTier,
    mode: voiceCfg?.default_mode ?? 'ptt',
    ttsVoice: voiceCfg?.tts_voice ?? '',
    autoSpeakResponses: voiceCfg?.auto_speak_responses ?? true,
    sendMessage: sendForVoice,
    onTranscript: (text) => setInput(text),
  })

  const formattedStream = useMemo(() => formatMarkdown(streamContent), [streamContent])

  const toggleEngine = () => {
    const next = engine === 'aitherchat' ? 'native' : 'aitherchat'
    setEngine(next)
    try { localStorage.setItem(ENGINE_KEY, next) } catch {}
  }

  useEffect(() => {
    // Only auto-scroll if user is near the bottom (within 150px)
    const container = bottomRef.current?.parentElement
    if (container) {
      const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150
      if (nearBottom) container.scrollTop = container.scrollHeight
    }
  }, [messages, streamThinking, streamContent])

  useEffect(() => {
    if (externalInput) { setInput(externalInput); onExternalInputConsumed?.() }
  }, [externalInput, onExternalInputConsumed])

  // Probe the LLM lane on mount and every 20s so an unavailable backend is
  // surfaced BEFORE the user sends (fail-fast UX). A SINGLE transient miss —
  // a Genesis cold-boot blip, a slow >timeout response, a momentary network
  // hiccup — must NOT flash the scary banner: the actual chat stream survives
  // brief blips, so flashing "backend unavailable" then self-healing 20s later
  // is pure false-alarm noise. We therefore require TWO consecutive failures
  // before declaring the lane down, and re-probe fast (3s) after the first
  // miss so a *real* sustained outage still surfaces promptly.
  useEffect(() => {
    let cancelled = false
    let consecutiveFailures = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = (ms: number) => {
      if (cancelled) return
      timer = setTimeout(probe, ms)
    }
    const probe = async () => {
      let down = false
      let detail = ''
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 8000)
        // Probe the lane the SELECTED engine will use. The aither probe is
        // session-gated on tenant apps (401 without a tenant session), and
        // it was probed even in 'native' mode -- so a native chat that worked
        // still showed 'AI backend unavailable' and paused sending (measured
        // on garg.aitherium.com 2026-09-04). Native uses the app's own health.
        const probePath = engine === 'aitherchat' ? '/api/chat/aither/llm-health' : '/api/health'
        const r = await fetch(probePath, { signal: ctrl.signal, cache: 'no-store' })
        clearTimeout(t)
        const j = r.ok
          ? (engine === 'aitherchat' ? await r.json() : { ok: true, detail: '' })
          : { ok: false, detail: `HTTP ${r.status}` }
        down = !j.ok
        detail = j.detail || ''
      } catch {
        down = true
        detail = 'cannot reach backend'
      }
      if (cancelled) return
      if (down) {
        consecutiveFailures += 1
        // First miss: stay optimistic (don't flash), re-probe soon. Only
        // alarm once a second consecutive probe confirms it's sustained.
        if (consecutiveFailures >= 2) {
          setLlmOk(false)
          setLlmDetail(detail)
        }
        schedule(consecutiveFailures < 2 ? 3000 : 20000)
      } else {
        consecutiveFailures = 0
        setLlmOk(true)
        setLlmDetail(detail)
        schedule(20000)
      }
    }
    probe()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [engine])

  // Load conversation history when conversationId changes.
  // Empty string ("") means "new conversation" -> clear messages.
  // Non-empty -> fetch transcript from /api/chat/conversations/{id}/messages.
  // null -> leave current messages alone (first mount before user picks).
  useEffect(() => {
    if (conversationId === null) return
    if (conversationId === '') { setMessages([]); return }
    if (skipHistoryReload.current) { skipHistoryReload.current = false; return }
    let cancelled = false
    ;(async () => {
      // Try the native chat router first, then fall back to the aitherchat
      // ReAct store. Apps wire one, the other, or both -- and the active
      // engine determines which one persisted the turn.
      const tryFetch = async (url: string): Promise<any[] | null> => {
        try {
          const r = await fetch(url)
          if (!r.ok) return null
          const data = await r.json()
          const msgs = data.messages || []
          return Array.isArray(msgs) ? msgs : null
        } catch { return null }
      }

      let raw: any[] | null = await tryFetch(
        `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
      )
      if (!raw || raw.length === 0) {
        raw = await tryFetch(
          `/api/chat/aither/conversations/${encodeURIComponent(conversationId)}/messages`,
        )
      }
      if (!raw || raw.length === 0) {
        // Legacy aither path
        raw = await tryFetch(
          `/api/chat/aither/history/${encodeURIComponent(conversationId)}`,
        )
      }
      if (cancelled || !raw) return
      const msgs: Message[] = raw.map((m: any) => {
        const parsed = parseThinkBlocks(m.content || '')
        const selection = parseSelection(parsed.content)
        const displayContent = selection ? stripSelectionBlock(parsed.content) : parsed.content
        return {
          role: m.role,
          content: displayContent.trim(),
          // Prefer the persisted thinking column (ReAct scratchpad) when
          // present, fall back to inline <think> tags parsed from content.
          thinking: m.thinking || parsed.thinking || undefined,
          tool_calls: m.tool_calls || undefined,
          selection,
        }
      })
      setMessages(msgs)
    })()
    return () => { cancelled = true }
  }, [conversationId])

  const uploadFile = useCallback(async (file: File): Promise<string | null> => {
    const form = new FormData()
    form.append('file', file)
    form.append('auto_extract', 'true')
    try {
      const res = await fetch('/api/documents/upload', { method: 'POST', body: form })
      if (res.ok) {
        const data = await res.json()
        return `Uploaded ${file.name} (${data.chunks_created ?? data.chunk_count ?? '?'} chunks ingested)`
      }
      return `Failed to upload ${file.name}`
    } catch {
      return `Error uploading ${file.name}`
    }
  }, [])

  const handleFileAttach = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    setPendingFiles(prev => [...prev, ...fileArray])

    setUploading(true)
    const results: string[] = []
    for (const file of fileArray) {
      const result = await uploadFile(file)
      if (result) results.push(result)
    }
    setUploading(false)
    setPendingFiles([])

    if (results.length > 0) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: results.join('\n'),
        attachments: fileArray.map(f => ({ name: f.name, type: f.type })),
      }])
    }
  }, [uploadFile])

  const sendAitherChat = async (msg: string) => {
    // SSE streaming aitherchat engine — tool calls appear progressively
    setStreamThinking('')
    setStreamContent('')
    setStreamStatus(null)
    setStreamToolCalls([])
    setStreamEvents([])
    setIsStreaming(true)

    let thinkBuf = ''
    let contentBuf = ''
    let streamSources: any[] = []
    let streamConvId = ''
    let streamMsgId = ''
    let toolCalls: any[] = []
    let thinkingText = ''
    let streamPipeline: PipelineTrace | undefined
    let streamUsage: PipelineUsage | undefined
    let doneReceived = false

    try {
      const controller = new AbortController()
      const connectTimeout = setTimeout(() => controller.abort(), 60_000)
      const resp = await fetch('/api/chat/aither', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          conversation_id: conversationId || undefined,
          stream: true,
        }),
        signal: controller.signal,
      })
      clearTimeout(connectTimeout)
      if (!resp.ok) {
        let detail = `Server error (${resp.status})`
        try { const err = await resp.json(); detail = err.detail || err.error || detail } catch {}
        throw new Error(detail)
      }

      const reader = resp.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          const payload = trimmed.slice(6)
          if (payload === '[DONE]') continue

          try {
            const evt = JSON.parse(payload)
            if (evt.type === 'meta') {
              streamSources = evt.sources || []
              streamConvId = evt.conversation_id || streamConvId
              streamMsgId = evt.message_id || streamMsgId
            } else if (evt.type === 'thinking') {
              thinkBuf += (thinkBuf ? '\n' : '') + (evt.text || '')
              pendingStreamRef.current.thinking = thinkBuf
              setStreamEvents(prev => [...prev, { kind: 'thinking', text: evt.text || '' }])
              scheduleStreamFlush()
            } else if (evt.type === 'status') {
              pendingStreamRef.current.status = evt.detail || evt.status || 'Working...'
              setStreamEvents(prev => [...prev, { kind: 'status', text: evt.detail || evt.status || 'Working...' }])
              scheduleStreamFlush()
            } else if (evt.type === 'tool_start') {
              pendingStreamRef.current.status = `Calling ${evt.name}...`
              setStreamEvents(prev => [...prev, { kind: 'tool_start', step: evt.step, name: evt.name, args: evt.args }])
              scheduleStreamFlush()
            } else if (evt.type === 'step') {
              toolCalls.push(evt)
              setStreamToolCalls(prev => [...prev, evt])
              // Replace the tool_start spinner with a result block
              setStreamEvents(prev => {
                const updated = prev.filter(e => !(e.kind === 'tool_start' && e.step === evt.step))
                return [...updated, { kind: 'tool_result', step: evt.step, name: evt.name, args: evt.args, ok: evt.ok, result: evt.result }]
              })
              pendingStreamRef.current.status = null
              scheduleStreamFlush()
            } else if (evt.type === 'pipeline') {
              streamPipeline = evt as unknown as PipelineTrace
            } else if (evt.type === 'turn_start') {
              setStreamEvents(prev => [...prev, { kind: 'turn_start', turn: evt.turn }])
              scheduleStreamFlush()
            } else if (evt.type === 'turn_end') {
              setStreamEvents(prev => [...prev, { kind: 'turn_end', ...evt }])
              scheduleStreamFlush()
            } else if (evt.type === 'content') {
              contentBuf += evt.text || ''
              pendingStreamRef.current.content = contentBuf
              scheduleStreamFlush()
            } else if (evt.type === 'done') {
              contentBuf = evt.content || contentBuf
              thinkingText = thinkBuf || evt.thinking
              toolCalls = evt.tool_calls || toolCalls
              streamConvId = evt.conversation_id || streamConvId
              streamMsgId = evt.message_id || streamMsgId
              streamPipeline = evt.pipeline || streamPipeline
              streamUsage = evt.usage || streamUsage
              doneReceived = true
            } else if (evt.type === 'error') {
              throw new Error(evt.content)
            }
          } catch (e: any) {
            if (e.message && !e.message.includes('JSON')) throw e
          }
        }

        await new Promise(resolve => setTimeout(resolve, 0))
      }

      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
      pendingStreamRef.current = { content: '', thinking: '', status: null }

      const parsed = parseThinkBlocks(contentBuf)
      const selection = parseSelection(parsed.content)
      const displayContent = selection ? stripSelectionBlock(parsed.content) : parsed.content

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: displayContent.trim(),
        message_id: streamMsgId || undefined,
        thinking: thinkingText || thinkBuf || parsed.thinking || undefined,
        sources: streamSources, selection,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        pipeline: streamPipeline,
        pipeline_usage: streamUsage,
      }])
      if (!conversationId && streamConvId) {
        skipHistoryReload.current = true
        onNewConversation(streamConvId)
      }
    } catch (err: any) {
      if (doneReceived && contentBuf) {
        // Response was fully delivered — the error is from post-stream
        // cleanup (persist, side-effects). Commit the content instead
        // of showing an error that replaces the valid response.
        const parsed = parseThinkBlocks(contentBuf)
        const selection = parseSelection(parsed.content)
        const displayContent = selection ? stripSelectionBlock(parsed.content) : parsed.content
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: displayContent.trim(),
          message_id: streamMsgId || undefined,
          thinking: thinkingText || thinkBuf || parsed.thinking || undefined,
          sources: streamSources, selection,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          pipeline: streamPipeline,
          pipeline_usage: streamUsage,
        }])
        if (!conversationId && streamConvId) {
          skipHistoryReload.current = true
          onNewConversation(streamConvId)
        }
      } else {
        setLastFailedInput(msg)
        const isAbort = err?.name === 'AbortError'
        const isNetwork = err instanceof TypeError && err.message.includes('fetch')
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: isAbort
            ? 'Request timed out -- the model may be busy or unavailable. Try again.'
            : isNetwork
              ? 'Connection failed -- the backend may be down.'
              : `Error: ${err.message || 'Failed to get response'}`,
          isError: true,
        }])
      }
    } finally {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
      pendingStreamRef.current = { content: '', thinking: '', status: null }
      setIsStreaming(false)
      setStreamThinking('')
      setStreamContent('')
      setStreamStatus(null)
      setStreamToolCalls([])
    }
  }

  const sendNativeStream = async (msg: string) => {
    // SSE streaming with thinking support
    setStreamThinking('')
    setStreamContent('')
    setIsStreaming(true)

    let thinkBuf = ''
    let contentBuf = ''
    let streamSources: any[] = []
    let streamConvId = ''
    let usage: LLMUsage | undefined

    try {
      const resp = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, conversation_id: conversationId || undefined }),
      })
      if (!resp.ok) {
        let detail = `Server error (${resp.status})`
        try { const err = await resp.json(); detail = err.detail || err.error || detail } catch {}
        throw new Error(detail)
      }

      const reader = resp.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          const payload = trimmed.slice(6)
          if (payload === '[DONE]') continue

          try {
            const evt = JSON.parse(payload)
            if (evt.type === 'thinking') {
              thinkBuf += evt.text
              pendingStreamRef.current.thinking = thinkBuf
              scheduleStreamFlush()
            } else if (evt.type === 'content') {
              contentBuf += evt.text
              pendingStreamRef.current.content = contentBuf
              scheduleStreamFlush()
            } else if (evt.type === 'meta' || evt.type === 'sources') {
              streamSources = evt.sources || []
              streamConvId = evt.conversation_id || streamConvId
            } else if (evt.type === 'usage') {
              usage = {
                provider: evt.provider, model: evt.model,
                prompt_tokens: evt.prompt_tokens, completion_tokens: evt.completion_tokens,
                total_tokens: evt.total_tokens, cost_usd: evt.cost_usd,
                is_fallback: evt.is_fallback,
              }
            } else if (evt.type === 'done') {
              contentBuf = evt.content || contentBuf
            } else if (evt.type === 'error') {
              throw new Error(evt.content)
            }
          } catch (e: any) {
            if (e.message && !e.message.includes('JSON')) throw e
          }
        }

        // Yield to browser rendering pipeline between read chunks
        await new Promise(resolve => setTimeout(resolve, 0))
      }

      // Flush any pending rAF before building final message
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
      pendingStreamRef.current = { content: '', thinking: '', status: null }

      // Safety net: some backends emit the `done` event with the full content
      // payload including unparsed <think>...</think> blocks. Re-parse so the
      // reasoning is preserved in the final, persisted message instead of
      // vanishing when the streaming bubble unmounts.
      const finalParsed = parseThinkBlocks(contentBuf)
      const mergedThinking = [thinkBuf, finalParsed.thinking]
        .map(s => (s || '').trim())
        .filter(Boolean)
        .join('\n')
      const finalContent = finalParsed.content

      const selection = parseSelection(finalContent)
      const displayContent = selection ? stripSelectionBlock(finalContent) : finalContent

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: displayContent.trim(),
        thinking: mergedThinking || undefined,
        sources: streamSources,
        selection, usage,
      }])
      if (!conversationId && streamConvId) {
        skipHistoryReload.current = true
        onNewConversation(streamConvId)
      }
    } catch (err: any) {
      setLastFailedInput(msg)
      const errMsg = err instanceof TypeError && err.message.includes('fetch')
        ? 'Connection failed -- the backend may be down.'
        : `Error: ${err.message || 'Failed to get response'}`
      setMessages(prev => [...prev, {
        role: 'assistant', content: errMsg, isError: true,
      }])
    } finally {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
      pendingStreamRef.current = { content: '', thinking: '', status: null }
      setIsStreaming(false)
      setStreamThinking('')
      setStreamContent('')
    }
  }

  const send = async (overrideInput?: string) => {
    const userMsg = (overrideInput || input).trim()
    if (!userMsg) return

    // Chat-as-steering (Layer 2): if a response is currently streaming, fold this
    // message into the RUNNING reasoning loop (POST /steer) instead of starting a
    // new turn — the user keeps typing and redirects the background work live. The
    // steered continuation streams on the SAME open response.
    if (isStreaming && conversationId && engine === 'aitherchat') {
      setInput('')
      setMessages(prev => [...prev, { role: 'user', content: userMsg, steering: true }])
      try {
        const r = await fetch(`/api/chat/aither/steer/${encodeURIComponent(conversationId)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: userMsg }),
        })
        const j = await r.json().catch(() => ({} as any))
        if (j && j.steered) return   // ingested by the running loop — done
      } catch { /* fall through to a normal turn below */ }
      // Loop already finished (or steer failed) between keypress and fetch — drop
      // the optimistic steer bubble and send it as a fresh turn instead.
      setMessages(prev => prev.filter(m => !(m.role === 'user' && m.steering && m.content === userMsg)))
    }

    if (loading) return
    setInput('')
    setLastFailedInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setLoading(true)

    try {
      if (engine === 'aitherchat') {
        await sendAitherChat(userMsg)
      } else {
        await sendNativeStream(userMsg)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSelection = async (msg: Message, chosen: { name: string }, reasoning: string) => {
    if (!msg.selection) return
    try {
      await fetch('/api/selections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: msg.selection.query, recommended: msg.selection.recommendations,
          chosen, reasoning, category: msg.selection.category,
        }),
      })
    } catch { /* ignore */ }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    if (e.dataTransfer.files.length > 0) handleFileAttach(e.dataTransfer.files)
  }, [handleFileAttach])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)} onDrop={handleDrop}>

      {dragOver && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ padding: '2rem 3rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg, 12px)',
            border: '2px dashed var(--accent-primary)', color: 'var(--accent-primary)', fontSize: '1.1rem', fontWeight: 600 }}>
            Drop files to upload to knowledge base
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: '1rem', position: 'relative' }}>
        {messages.length === 0 && !isStreaming && (
          <div style={{ textAlign: 'center', marginTop: '3rem', color: 'var(--text-muted)' }}>
            {markFile(brand, 'dot') ? (
              <BrandGlyph brand={brand} markKey="dot"
                style={{ width: '2rem', height: '2rem', margin: '0 auto 0.75rem', opacity: 0.3 }} />
            ) : (
              <div style={{ fontSize: '2rem', marginBottom: '0.75rem', opacity: 0.3 }}>
                {config.app_name.charAt(0)}
              </div>
            )}
            <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
              Ask {config.app_name} anything
            </p>
            <p style={{ fontSize: '0.85rem', maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
              {config.welcome_message || 'Upload documents and ask questions about your knowledge base.'}
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column',
            alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>

            {msg.role === 'assistant' && markFile(brand) && (
              <BrandGlyph brand={brand}
                style={{ width: 24, height: 24, marginBottom: '0.35rem',
                  color: 'var(--accent-primary)' }} />
            )}

            {msg.attachments && msg.attachments.length > 0 && (
              <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.3rem', flexWrap: 'wrap' }}>
                {msg.attachments.map((a, j) => (
                  <span key={j} className="badge" style={{ fontSize: '0.7rem' }}>
                    {a.name}
                  </span>
                ))}
              </div>
            )}

            <div style={{
              maxWidth: '75%', padding: '0.75rem 1rem', borderRadius: 'var(--radius, 8px)',
              background: msg.isError ? 'oklch(0.15 0.06 25)' :
                msg.role === 'user' ? 'var(--accent-primary)' : 'var(--bg-surface)',
              color: msg.isError ? 'var(--accent-coral)' :
                msg.role === 'user' ? 'var(--bg-deep)' : 'var(--text-primary)',
              fontSize: '0.9rem', lineHeight: 1.6,
              border: msg.isError ? '1px solid oklch(0.30 0.10 25)' : undefined,
            }}>
              {msg.role === 'assistant' && msg.thinking && (
                <ThinkingBlock text={msg.thinking} />
              )}
              {msg.role === 'assistant' ? (
                msg.citations && msg.citations.length > 0
                  ? <div>{renderCitedText(msg.content, msg.citations)}</div>
                  : <div dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.content) }} />
              ) : msg.content}
            </div>

            {msg.isError && lastFailedInput && (
              <button onClick={() => send(lastFailedInput)} style={{
                marginTop: '0.3rem', padding: '0.3rem 0.8rem', background: 'var(--bg-elevated)',
                color: 'var(--text-secondary)', borderRadius: 'var(--radius, 8px)', fontSize: '0.75rem',
                border: '1px solid var(--glass-border)',
              }}>
                Retry
              </button>
            )}

            {msg.role === 'assistant' && !msg.isError && (
              <div style={{ maxWidth: '75%' }}>
                {msg.tool_calls && msg.tool_calls.length > 0 && (
                  <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem',
                    marginTop: '0.4rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)',
                      textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tools used:</span>
                    {msg.tool_calls.map((tc, ti) => {
                      const key = `${i}:${tc.step ?? ti}`
                      const isOpen = !!expandedTools[key]
                      return (
                      <button
                        key={ti}
                        type="button"
                        onClick={() => setExpandedTools(s => ({ ...s, [key]: !s[key] }))}
                        title={isOpen ? 'Hide details' : 'Show args + result'}
                        style={{
                          fontSize: '0.7rem', padding: '0.15rem 0.5rem',
                          borderRadius: 'var(--radius, 8px)',
                          background: tc.ok ? 'oklch(0.30 0.06 150 / 0.4)' : 'oklch(0.30 0.10 25 / 0.4)',
                          color: tc.ok ? 'var(--accent-green, #4ade80)' : 'var(--accent-coral, #f87171)',
                          border: `1px solid ${tc.ok ? 'oklch(0.45 0.08 150)' : 'oklch(0.40 0.12 25)'}`,
                          fontFamily: 'var(--font-mono, monospace)',
                          cursor: 'pointer',
                        }}>
                        {tc.name} {tc.ok ? '\u2713' : '\u2717'} {isOpen ? '\u25BC' : '\u25B6'}
                      </button>
                      )
                    })}
                  </div>
                  {/* Artifact chips — downloadable files produced by tool calls */}
                  {(() => {
                    const ARTIFACT_TOOLS = new Set([
                      'document_generate', 'diagram_generate', 'spreadsheet_create',
                    ])
                    type Art = { id: string; kind: string; title: string; filename?: string; mime?: string; size_bytes?: number; download_url?: string; preview?: string }
                    const arts: Art[] = []
                    for (const tc of msg.tool_calls) {
                      if (!tc.ok || !ARTIFACT_TOOLS.has(tc.name)) continue
                      const r: unknown = tc.result
                      // _local_tool wraps as {ok:true, data:{...}}, but some
                      // call paths return the dict directly; handle both.
                      let data: Record<string, unknown> | undefined
                      if (r && typeof r === 'object') {
                        const obj = r as Record<string, unknown>
                        if (obj.data && typeof obj.data === 'object') {
                          data = obj.data as Record<string, unknown>
                        } else if (typeof obj.id === 'string' && typeof obj.kind === 'string') {
                          data = obj
                        }
                      }
                      if (!data || typeof data.id !== 'string') continue
                      arts.push({
                        id: data.id as string,
                        kind: (data.kind as string) || 'file',
                        title: (data.title as string) || 'Untitled',
                        filename: data.filename as string | undefined,
                        mime: data.mime as string | undefined,
                        size_bytes: data.size_bytes as number | undefined,
                        download_url: data.download_url as string | undefined,
                        preview: data.preview as string | undefined,
                      })
                    }
                    if (arts.length === 0) return null
                    const kindIcon = (k: string) => {
                      if (k === 'docx' || k === 'markdown' || k === 'html') return '\uD83D\uDCC4'
                      if (k === 'mermaid') return '\uD83D\uDD27'
                      if (k === 'csv') return '\uD83D\uDCCA'
                      if (k === 'json') return '{ }'
                      return '\uD83D\uDCCE'
                    }
                    const fmtSize = (n?: number) => {
                      if (!n || n <= 0) return ''
                      if (n < 1024) return `${n} B`
                      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
                      return `${(n / 1024 / 1024).toFixed(2)} MB`
                    }
                    return (
                      <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        {arts.map((a) => (
                          <a
                            key={a.id}
                            href={a.download_url || `/api/chat/aither/artifacts/${a.id}/download`}
                            target="_blank"
                            rel="noreferrer"
                            download={a.filename}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '0.6rem',
                              padding: '0.5rem 0.7rem',
                              background: 'var(--glass-bg, rgba(255,255,255,0.04))',
                              border: '1px solid var(--glass-border, rgba(255,255,255,0.1))',
                              borderRadius: 'var(--radius, 8px)',
                              textDecoration: 'none',
                              color: 'var(--text-primary)',
                              fontSize: '0.8rem',
                              maxWidth: 460,
                            }}
                          >
                            <span style={{ fontSize: '1.1rem' }}>{kindIcon(a.kind)}</span>
                            <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                              <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {a.title}
                              </strong>
                              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                                {a.kind}{fmtSize(a.size_bytes) ? ' \u00b7 ' + fmtSize(a.size_bytes) : ''}{a.filename ? ' \u00b7 ' + a.filename : ''}
                              </span>
                            </span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--accent-blue, #60a5fa)' }}>
                              Download ↓
                            </span>
                          </a>
                        ))}
                      </div>
                    )
                  })()}
                  {msg.tool_calls.map((tc, ti) => {
                    const key = `${i}:${tc.step ?? ti}`
                    if (!expandedTools[key]) return null
                    const argsStr = tc.args ? JSON.stringify(tc.args, null, 2) : '(no args)'
                    const resStr = tc.result === undefined
                      ? '(no result)'
                      : (typeof tc.result === 'string'
                          ? tc.result
                          : JSON.stringify(tc.result, null, 2))
                    return (
                      <div key={`exp-${ti}`} style={{
                        marginTop: '0.4rem',
                        padding: '0.5rem 0.6rem',
                        background: 'var(--glass-bg, rgba(0,0,0,0.2))',
                        border: '1px solid var(--glass-border)',
                        borderRadius: 'var(--radius, 8px)',
                        fontSize: '0.7rem',
                        fontFamily: 'var(--font-mono, monospace)',
                      }}>
                        <div style={{ color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                          Step {tc.step ?? ti + 1}: <strong>{tc.name}</strong>
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '0.3rem' }}>args</div>
                        <pre style={{ margin: '0.15rem 0 0.4rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          color: 'var(--text-primary)' }}>{argsStr}</pre>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>result</div>
                        <pre style={{ margin: '0.15rem 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          maxHeight: 240, overflowY: 'auto',
                          color: tc.ok ? 'var(--text-primary)' : 'var(--accent-coral, #f87171)' }}>
                          {resStr.length > 4000 ? resStr.slice(0, 4000) + '\n\u2026' : resStr}
                        </pre>
                      </div>
                    )
                  })}
                  </>
                )}
                {(msg.confidence != null || (msg.citations && msg.citations.length > 0)) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
                    marginTop: '0.3rem', flexWrap: 'wrap' }}>
                    {msg.confidence != null && (
                      <span style={{
                        fontSize: '0.7rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                        color: msg.confidence >= 0.7 ? 'var(--accent-green, #4ade80)' :
                          msg.confidence >= 0.5 ? 'oklch(0.85 0.12 85)' : 'var(--accent-coral, #f87171)',
                      }}>
                        <span style={{
                          width: 6, height: 6, borderRadius: '50%', background: 'currentColor',
                        }} />
                        {(msg.confidence * 100).toFixed(0)}% confidence
                      </span>
                    )}
                    {msg.citations && msg.citations.length > 0 && (
                      <CitationPopover citations={msg.citations} />
                    )}
                  </div>
                )}
                <SourceCitations sources={msg.sources || []} />
                {msg.usage && <UsageBadge usage={msg.usage} />}
                <PipelineTraceBadge pipeline={msg.pipeline} usage={msg.pipeline_usage} />
                {msg.selection && (
                  <SelectionCard query={msg.selection.query} recommendations={msg.selection.recommendations}
                    category={msg.selection.category}
                    onSelect={(chosen, reasoning) => handleSelection(msg, chosen, reasoning)} />
                )}
                {msg.message_id && <FeedbackButtons messageId={msg.message_id} />}
              </div>
            )}
          </div>
        ))}

        {/* Live streaming bubble */}
        {isStreaming && (
          <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <div style={{
              maxWidth: '75%', padding: '0.75rem 1rem', borderRadius: 'var(--radius, 8px)',
              background: 'var(--bg-surface)', color: 'var(--text-primary)',
              fontSize: '0.9rem', lineHeight: 1.6,
            }}>
              <StreamTimeline events={streamEvents} formattedContent={formattedStream} status={streamStatus} />
            </div>
          </div>
        )}

        {loading && !isStreaming && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', color: 'var(--text-muted)' }}>
            <div className="loading-spinner" /> <span style={{ fontSize: '0.85rem' }}>Thinking...</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {pendingFiles.length > 0 && (
        <div style={{ padding: '0.5rem 1rem', borderTop: '1px solid var(--glass-border)', fontSize: '0.8rem',
          color: 'var(--accent-cyan, #22d3ee)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div className="loading-spinner" style={{ width: 14, height: 14 }} />
          Uploading {pendingFiles.map(f => f.name).join(', ')}...
        </div>
      )}

      {/* LLM-lane unavailable banner — surfaced before the user sends */}
      {llmOk === false && (
        <div style={{ padding: '0.5rem 1rem', borderTop: '1px solid var(--glass-border)',
          background: 'rgba(220, 38, 38, 0.12)', color: 'var(--accent-red, #f87171)',
          fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1rem' }}>⚠️</span>
          AI backend unavailable{llmDetail ? ` — ${llmDetail}` : ''}. Sending is paused; it should recover shortly.
        </div>
      )}

      {/* Engine toggle + Input bar */}
      <div style={{ padding: '4px 1rem 0', borderTop: '1px solid var(--glass-border)',
        background: 'var(--bg-base)', display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={toggleEngine} style={{
          fontSize: '0.65rem', color: 'var(--text-muted)', background: 'none',
          padding: '2px 6px', cursor: 'pointer', border: 'none',
        }} title={engine === 'aitherchat' ? 'Using AitherChat (full pipeline)' : 'Using native chat (streaming + thinking)'}>
          {engine === 'aitherchat' ? '\u26A1 AitherChat' : '\u25CB Native'}
        </button>
      </div>
      <div style={{ padding: '0.5rem 1rem 0.75rem',
        display: 'flex', gap: '0.5rem', alignItems: 'flex-end', background: 'var(--bg-base)' }}>

        <button onClick={() => fileRef.current?.click()} title="Upload file"
          disabled={uploading} style={{
            padding: '0.6rem', background: 'var(--bg-elevated)', borderRadius: 'var(--radius, 8px)',
            color: 'var(--text-secondary)', fontSize: '1.1rem', lineHeight: 1, flexShrink: 0,
            border: '1px solid var(--glass-border)', opacity: uploading ? 0.5 : 1,
          }}>
          +
        </button>
        <input ref={fileRef} type="file" hidden multiple
          accept=".pdf,.docx,.doc,.txt,.xlsx,.xls,.md,.csv"
          onChange={e => { if (e.target.files) handleFileAttach(e.target.files); e.target.value = '' }} />

        {voiceEnabled && (
          <VoiceMicButton
            isListening={voice.isListening}
            audioLevel={voice.audioLevel}
            disabled={loading}
            onClick={voice.toggleListening}
          />
        )}

        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && llmOk !== false && send()}
          placeholder={llmOk === false ? 'AI backend unavailable…'
            : isStreaming ? `Type to steer ${config.app_name} while it works…`
            : `Ask ${config.app_name}... (or drop files here)`}
          style={{ flex: 1, padding: '0.7rem 1rem', background: 'var(--bg-surface)',
            border: isStreaming ? '1px solid var(--accent-primary)' : '1px solid var(--glass-border)',
            borderRadius: 'var(--radius, 8px)',
            color: 'var(--text-primary)', fontSize: '0.9rem' }} />

        {/* Steer (not disabled while streaming) lets the user redirect the running
            loop; send() routes to /steer when isStreaming, else a normal turn. */}
        <button onClick={() => send()} disabled={!input.trim() || llmOk === false} style={{
          padding: '0.7rem 1.5rem', background: 'var(--accent-primary)', color: 'var(--bg-deep)',
          borderRadius: 'var(--radius, 8px)', fontWeight: 600,
          opacity: !input.trim() || llmOk === false ? 0.5 : 1,
          flexShrink: 0, border: 'none',
        }}>
          {isStreaming ? 'Steer' : 'Send'}
        </button>
      </div>

      <style>{`
        @keyframes pk-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
      `}</style>
    </div>
  )
}
