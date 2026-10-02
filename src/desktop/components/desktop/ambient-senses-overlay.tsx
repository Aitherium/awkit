'use client'

/**
 * AmbientSensesOverlay
 * =====================
 *
 * Persistent desktop overlay that provides:
 *  - Voice command microphone (always visible, toggleable)
 *  - Vision observation indicator
 *  - Background task progress indicators
 *  - Agent action approval queue
 *  - Desktop file drop zone
 *  - System pulse heartbeat
 *
 * This sits at the bottom-right of the desktop, above the taskbar.
 * It's the physical manifestation of "the OS can hear and see."
 */

import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  Mic,
  MicOff,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
  Brain,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronUp,
  ChevronDown,
  Sparkles,
  Image as ImageIcon,
  FileText,
  X,
  Check,
  Play,
  Square,
  Activity,
  Waves,
  Radio,
  Zap,
  Globe,
} from 'lucide-react'
import {
  useAitherSenses,
  type ListenMode,
  type VisionMode,
} from '../../hooks/use-aither-senses'
import {
  useAgentControlBus,
  type AgentAction,
  type BackgroundTask,
  type DesktopFile,
} from '../../contexts/agent-control-bus'
import { useDesktopAgent } from '../../contexts/desktop-agent-context'

// ============================================================================
// SUBCOMPONENTS
// ============================================================================

/** Pulsing audio level ring around the mic button */
function AudioLevelRing({ level, isListening }: { level: number; isListening: boolean }) {
  if (!isListening) return null
  const size = 48 + level * 24 // 48-72px
  const opacity = 0.15 + level * 0.3

  return (
    <div
      className="absolute rounded-full bg-[#5EC9CC] text-[#050507] transition-all duration-75 pointer-events-none"
      style={{
        width: size,
        height: size,
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        opacity,
      }}
    />
  )
}

/** Single background task indicator */
function TaskPill({ task }: { task: BackgroundTask }) {
  const icon = task.type === 'llm' ? <Brain className="w-3 h-3" /> :
               task.type === 'canvas' ? <ImageIcon className="w-3 h-3" /> :
               task.type === 'vision' ? <Eye className="w-3 h-3" /> :
               task.type === 'voice' ? <Volume2 className="w-3 h-3" /> :
               <Zap className="w-3 h-3" />

  const statusColor = task.status === 'running' ? 'text-blue-400' :
                      task.status === 'completed' ? 'text-green-400' :
                      task.status === 'failed' ? 'text-red-400' :
                      'text-zinc-500'

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-800/80 border border-zinc-700/50 text-[10px] ${statusColor}`}>
      {task.status === 'running' ? <Loader2 className="w-3 h-3 animate-spin" /> : icon}
      <span className="truncate max-w-[120px]">{task.description.slice(0, 30)}</span>
      {task.status === 'completed' && <CheckCircle2 className="w-3 h-3 text-green-400" />}
      {task.status === 'failed' && <XCircle className="w-3 h-3 text-red-400" />}
    </div>
  )
}

/** Approval request card */
function ApprovalCard({
  action,
  onApprove,
  onDeny,
}: {
  action: AgentAction
  onApprove: () => void
  onDeny: () => void
}) {
  return (
    <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 animate-in slide-in-from-right-2 duration-300">
      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-amber-200 font-medium truncate">{action.description}</div>
        <div className="text-[10px] text-amber-400/60 mt-0.5">
          {action.agentId || 'Agent'} wants to: {action.action}
        </div>
      </div>
      <div className="flex gap-1 shrink-0">
        <button
          onClick={onApprove}
          className="p-1 rounded bg-green-500/20 hover:bg-green-500/30 text-green-400 transition-colors"
          title="Approve"
        >
          <Check className="w-3 h-3" />
        </button>
        <button
          onClick={onDeny}
          className="p-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors"
          title="Deny"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

/** Desktop file thumbnail */
function DesktopFileThumbnail({ file, onRemove }: { file: DesktopFile; onRemove: () => void }) {
  return (
    <div className="group relative w-12 h-12 rounded-lg overflow-hidden border border-zinc-700/50 bg-zinc-800/80 hover:border-[#5EC9CC]/50 transition-colors cursor-pointer">
      {file.type === 'image' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={file.data} alt={file.name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <FileText className="w-5 h-5 text-zinc-500" />
        </div>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X className="w-2.5 h-2.5" />
      </button>
      <div className="absolute bottom-0 inset-x-0 bg-black/60 px-0.5 py-px">
        <span className="text-[8px] text-zinc-300 truncate block">{file.name}</span>
      </div>
    </div>
  )
}

// ============================================================================
// MAIN OVERLAY
// ============================================================================

export function AmbientSensesOverlay() {
  const [expanded, setExpanded] = useState(false)
  const [showFiles, setShowFiles] = useState(false)
  const [voiceResponse, setVoiceResponse] = useState<{ text: string; isStreaming: boolean } | null>(null)
  const [voiceProcessing, setVoiceProcessing] = useState(false)
  const voiceResponseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const agentCtx = useDesktopAgent()
  const bus = useAgentControlBus()

  // ── Desktop-level voice window ID (used when no app window is focused)
  const DESKTOP_VOICE_ID = '__desktop_voice__'

  // Ensure a desktop voice agent context is registered for global voice commands
  // Stable callbacks only -- the context VALUE is rebuilt on every provider render and
  // registering forces one, so depending on `agentCtx` looped forever (see
  // agent-context-registrar.tsx).
  const { registerAppContext, unregisterAppContext } = agentCtx
  useEffect(() => {
    registerAppContext(DESKTOP_VOICE_ID, {
      appId: 'desktop-voice',
      appName: 'Desktop Voice Assistant',
      appType: 'system',
      systemPromptAddition: 'The user is speaking to you via voice command at the desktop level. Respond concisely — your response will be spoken aloud via TTS. If they ask you to open apps, run commands, or control the OS, produce the appropriate action. Keep responses under 2-3 sentences unless they ask for detail.',
    })
    return () => unregisterAppContext(DESKTOP_VOICE_ID)
  }, [registerAppContext, unregisterAppContext])

  // Voice input routes to the active window's agent, or desktop voice if none
  const handleVoiceInput = useCallback(async (transcript: string) => {
    if (!transcript.trim()) return

    // Route to active window, or fall back to desktop-level voice agent
    const targetId = agentCtx.activeWindowId || DESKTOP_VOICE_ID

    setVoiceProcessing(true)
    setVoiceResponse({ text: '', isStreaming: true })

    // Clear any existing auto-dismiss timer
    if (voiceResponseTimerRef.current) {
      clearTimeout(voiceResponseTimerRef.current)
    }

    try {
      // Send message and track the response for TTS
      await agentCtx.sendMessage(targetId, transcript, {
        layers: ['kernel'],
        stream: true,
      })

      // After sending, read the latest assistant message for TTS
      const state = agentCtx.getWindowState(targetId)
      const lastAssistant = [...state.messages].reverse().find(m => m.role === 'assistant')
      const responseText = lastAssistant?.content || ''

      setVoiceResponse({ text: responseText, isStreaming: false })
      setVoiceProcessing(false)

      // Speak the response aloud if we got one
      if (responseText && responseText.length > 0 && !responseText.startsWith('Connection failed')) {
        // Use the senses TTS (will be available via ref below)
        sensesRef.current?.speak(responseText)
      }

      // Auto-dismiss the response bubble after 8 seconds
      voiceResponseTimerRef.current = setTimeout(() => {
        setVoiceResponse(null)
      }, 8000)

    } catch (error) {
      console.error('[VoiceInput] Failed to process:', error)
      setVoiceResponse({ text: 'Failed to process voice command.', isStreaming: false })
      setVoiceProcessing(false)

      voiceResponseTimerRef.current = setTimeout(() => {
        setVoiceResponse(null)
      }, 4000)
    }
  }, [agentCtx])

  // Vision observations go to context
  const handleVisionObservation = useCallback((analysis: string) => {
    // Store as ambient context — don't interrupt user
    console.log('[Vision]', analysis.slice(0, 100))
  }, [])

  const senses = useAitherSenses({
    onVoiceInput: handleVoiceInput,
    onVisionObservation: handleVisionObservation,
  })

  // Keep a ref to senses for TTS access from async callbacks
  const sensesRef = useRef(senses)
  useEffect(() => { sensesRef.current = senses }, [senses])

  // Auto-start browser context polling on mount (Awconnect awareness)
  useEffect(() => {
    senses.startBrowserPolling()
    return () => senses.stopBrowserPolling()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Active tasks count
  const activeTasks = bus.backgroundTasks.filter(t => t.status === 'running' || t.status === 'queued')
  const recentTasks = bus.backgroundTasks.filter(t =>
    t.status === 'completed' || t.status === 'failed'
  ).slice(-3)

  return (
    <div className="fixed top-4 right-4 z-[150] flex flex-col items-end gap-2">
      {/* ── Main Control Bar ───────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 bg-zinc-900/95 border border-zinc-700/50 rounded-2xl px-2 py-1.5 backdrop-blur-sm shadow-lg shadow-black/30">
        {/* Expand/collapse */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1 text-zinc-500 hover:text-zinc-300 rounded transition-colors"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {/* Voice mic button */}
        <div className="relative">
          <AudioLevelRing level={senses.voice.audioLevel} isListening={senses.voice.isListening} />
          {voiceProcessing && (
            <div className="absolute -top-1 -right-1 w-3 h-3 z-20">
              <Loader2 className="w-3 h-3 text-emerald-400 animate-spin" />
            </div>
          )}
          <button
            onClick={() => {
              if (senses.voice.isListening) {
                senses.stopListening()
              } else {
                senses.startListening('continuous')
              }
            }}
            className={`relative z-10 p-2 rounded-full transition-all ${
              senses.voice.isListening
                ? 'bg-[#5EC9CC]/30 text-[#5EC9CC] hover:bg-[#7AD6D8]/40 ring-2 ring-[#5EC9CC]/50'
                : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
            }`}
            title={senses.voice.isListening ? 'Stop listening' : 'Start listening (voice commands)'}
          >
            {senses.voice.isListening ? (
              <Mic className="w-4 h-4" />
            ) : (
              <MicOff className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* TTS / Speaking indicator */}
        <button
          onClick={() => senses.voice.isSpeaking ? senses.cancelSpeech() : undefined}
          className={`p-1.5 rounded-lg transition-colors ${
            senses.voice.isSpeaking
              ? 'text-blue-400 bg-blue-500/20 animate-pulse'
              : 'text-zinc-600'
          }`}
          title={senses.voice.isSpeaking ? 'Cancel speech' : 'TTS idle'}
        >
          {senses.voice.isSpeaking ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
        </button>

        {/* Vision eye button */}
        <button
          onClick={() => {
            if (senses.vision.mode !== 'off') {
              senses.stopObserving()
            } else {
              senses.captureAndAnalyze()
            }
          }}
          className={`p-1.5 rounded-lg transition-colors ${
            senses.vision.mode !== 'off'
              ? 'text-cyan-400 bg-cyan-500/20'
              : 'text-zinc-600 hover:text-zinc-400'
          }`}
          title={senses.vision.mode !== 'off' ? 'Vision active' : 'Capture screen'}
        >
          {senses.vision.mode !== 'off' ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        </button>

        {/* Browser awareness (Awconnect) */}
        <button
          onClick={() => {
            setExpanded(true)
            senses.startBrowserPolling()
            void senses.refreshBrowserContext()
          }}
          className={`p-1.5 rounded-lg transition-colors ${
            senses.browser.connected && !senses.browser.stale
              ? 'text-orange-400 bg-orange-500/20'
              : senses.browser.connected && senses.browser.stale
                ? 'text-amber-600 bg-amber-500/10'
                : 'text-zinc-600 hover:text-zinc-400'
          }`}
          title={
            senses.browser.connected && !senses.browser.stale
              ? `Browsing: ${senses.browser.title || senses.browser.url || 'unknown'} — click to refresh`
              : senses.browser.connected && senses.browser.stale
                ? 'Browser context stale — click to refresh'
                : 'Awconnect not connected — click to check status'
          }
          aria-label="Refresh browser context"
        >
          <Globe className="w-3.5 h-3.5" />
        </button>

        {/* Ambient mode toggle */}
        <button
          onClick={() => senses.isAmbient ? senses.disableAmbient() : senses.enableAmbient()}
          className={`p-1.5 rounded-lg transition-colors ${
            senses.isAmbient
              ? 'text-emerald-400 bg-emerald-500/20 ring-1 ring-emerald-500/30'
              : 'text-zinc-600 hover:text-zinc-400'
          }`}
          title={senses.isAmbient ? 'Ambient mode ON (hearing + seeing)' : 'Enable ambient mode'}
        >
          <Radio className="w-3.5 h-3.5" />
        </button>

        {/* Divider */}
        <div className="w-px h-5 bg-zinc-700/50" />

        {/* Background tasks counter */}
        {activeTasks.length > 0 && (
          <div className="flex items-center gap-1 text-[10px] text-blue-400 px-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>{activeTasks.length}</span>
          </div>
        )}

        {/* Desktop files */}
        {bus.desktopFiles.length > 0 && (
          <button
            onClick={() => setShowFiles(!showFiles)}
            className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200 px-1"
            title="Desktop files"
          >
            <ImageIcon className="w-3 h-3" />
            <span>{bus.desktopFiles.length}</span>
          </button>
        )}

        {/* Quick generate button */}
        <button
          onClick={() => agentCtx.openCommandPalette()}
          className="p-1.5 rounded-lg text-zinc-500 hover:text-[#5EC9CC] hover:bg-[#7AD6D8]/10 transition-colors"
          title="AI Command (Ctrl+K)"
        >
          <Sparkles className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── Transcript Display ─────────────────────────────────────────── */}
      {senses.voice.isListening && (senses.voice.transcript || senses.voice.interimTranscript) && (
        <div className="bg-zinc-900/95 border border-[#5EC9CC]/30 rounded-xl px-3 py-2 max-w-[280px] backdrop-blur-sm animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-1.5">
            <Waves className="w-3 h-3 text-[#5EC9CC] shrink-0" />
            <div className="text-xs text-zinc-200">
              {senses.voice.transcript}
              {senses.voice.interimTranscript && (
                <span className="text-zinc-500 italic"> {senses.voice.interimTranscript}</span>
              )}
            </div>
          </div>
          {voiceProcessing && (
            <div className="flex items-center gap-1 mt-1 text-[10px] text-[#5EC9CC]">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Processing voice command...</span>
            </div>
          )}
        </div>
      )}

      {/* ── Voice Response Bubble ──────────────────────────────────────── */}
      {voiceResponse && (
        <div className="bg-zinc-900/95 border border-emerald-500/30 rounded-xl px-3 py-2 max-w-[320px] backdrop-blur-sm animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-start gap-1.5">
            <Brain className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-xs text-zinc-200 leading-relaxed">
              {voiceResponse.isStreaming ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
                  <span className="text-zinc-400">Thinking...</span>
                </span>
              ) : (
                voiceResponse.text.slice(0, 300)
              )}
              {!voiceResponse.isStreaming && voiceResponse.text.length > 300 && (
                <span className="text-zinc-500">...</span>
              )}
            </div>
            <button
              onClick={() => setVoiceResponse(null)}
              className="p-0.5 text-zinc-500 hover:text-zinc-300 shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          {senses.voice.isSpeaking && (
            <div className="flex items-center gap-1 mt-1 text-[10px] text-blue-400">
              <Volume2 className="w-3 h-3 animate-pulse" />
              <span>Speaking...</span>
            </div>
          )}
        </div>
      )}

      {/* ── Browser Context (Awconnect) ──────────────────────────── */}
      {expanded && (senses.browser.lastPollTime > 0 || senses.browser.connected) && (
        <div className="bg-zinc-900/95 border border-orange-500/30 rounded-xl px-3 py-2 max-w-[300px] backdrop-blur-sm animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-start gap-1.5">
            <Globe className="w-3 h-3 text-orange-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-orange-400 font-medium">
                {senses.browser.connected && !senses.browser.stale
                  ? 'User is browsing'
                  : senses.browser.connected
                    ? 'Browser context is stale'
                    : 'Awconnect status'}
              </div>

              {senses.browser.connected && senses.browser.title ? (
                <>
                  <div className="text-xs text-zinc-200 truncate" title={senses.browser.url}>
                    {senses.browser.title}
                  </div>
                  {senses.browser.siteName && (
                    <div className="text-[10px] text-zinc-500">{senses.browser.siteName}</div>
                  )}
                  {senses.browser.description && (
                    <div className="text-[10px] text-zinc-400 mt-0.5 line-clamp-2">{senses.browser.description}</div>
                  )}
                  <div className="flex items-center gap-2 mt-1 text-[9px] text-zinc-600">
                    <span>{senses.browser.ageSeconds}s ago</span>
                    {senses.browser.pageType && <span>• {senses.browser.pageType}</span>}
                    <span>• richness {senses.browser.richness}/15</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-xs text-zinc-300">
                    {senses.browser.error || 'Awconnect is not currently providing browser context.'}
                  </div>
                  <div className="mt-1 text-[10px] text-zinc-500">
                    Install/connect the extension, then click the globe again to refresh.
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Background Tasks ───────────────────────────────────────────── */}
      {expanded && (activeTasks.length > 0 || recentTasks.length > 0) && (
        <div className="w-64 space-y-1 animate-in slide-in-from-top-2 duration-200">
          {activeTasks.map(task => (
            <TaskPill key={task.id} task={task} />
          ))}
          {recentTasks.map(task => (
            <TaskPill key={task.id} task={task} />
          ))}
        </div>
      )}

      {/* ── Desktop Files ──────────────────────────────────────────────── */}
      {showFiles && bus.desktopFiles.length > 0 && (
        <div className="bg-zinc-900/95 border border-zinc-700/50 rounded-xl p-2 backdrop-blur-sm animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <span className="text-[10px] text-zinc-400 font-medium">Desktop Files</span>
            <button onClick={() => setShowFiles(false)} className="text-zinc-500 hover:text-zinc-300">
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="flex gap-1.5 flex-wrap max-w-[240px]">
            {bus.desktopFiles.map(file => (
              <DesktopFileThumbnail
                key={file.id}
                file={file}
                onRemove={() => bus.removeFromDesktop(file.id)}
              />
            ))}
          </div>
        </div>
      )}
      
      {/* ── Approval Queue ─────────────────────────────────────────────── */}
      {bus.pendingApprovals.length > 0 && (
        <div className="w-72 space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center justify-between text-[10px] text-amber-400/60 px-1">
            <span>⚠️ {bus.pendingApprovals.length} action{bus.pendingApprovals.length > 1 ? 's' : ''} pending approval</span>
            <button
              onClick={bus.approveAll}
              className="text-amber-400 hover:text-amber-300 underline"
            >
              Approve all
            </button>
          </div>
          {bus.pendingApprovals.slice(0, 3).map(action => (
            <ApprovalCard
              key={action.id}
              action={action}
              onApprove={() => bus.approveAction(action.id)}
              onDeny={() => bus.denyAction(action.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default AmbientSensesOverlay
