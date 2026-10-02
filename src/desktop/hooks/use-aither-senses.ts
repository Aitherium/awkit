'use client'

/**
 * useAitherSenses — Unified Perception Layer
 * ============================================
 *
 * Combines AitherVoice (8083) + AitherVision (8084) into a single
 * ambient awareness hook. The OS can hear and see.
 *
 * VOICE:
 *   - Continuous listening via Web Audio API + VAD
 *   - STT through AitherVoice service (Whisper)
 *   - TTS for agent responses (PersonaPlex / Piper)
 *   - Emotion detection from voice
 *
 * VISION:
 *   - Periodic screen capture → AitherVision for analysis
 *   - Window-specific observation mode
 *   - OCR text extraction
 *   - Visual change detection
 *
 * AMBIENT MODE:
 *   - Always-on background listening (VAD triggered)
 *   - Periodic screen observation (configurable interval)
 *   - Auto-routes observations to agent context
 */

import { useState, useCallback, useRef, useEffect } from 'react'

// ============================================================================
// TYPES
// ============================================================================

export type ListenMode = 'off' | 'ptt' | 'vad' | 'continuous'
export type VisionMode = 'off' | 'on-demand' | 'periodic' | 'change-detect'

export interface VoiceState {
  isListening: boolean
  mode: ListenMode
  transcript: string
  interimTranscript: string
  isSpeaking: boolean
  audioLevel: number
  lastEmotion?: string
  error?: string
}

export interface VisionState {
  mode: VisionMode
  isObserving: boolean
  lastAnalysis: string
  lastCaptureTime: number
  observationInterval: number // ms
  error?: string
}

export interface BrowserState {
  /** Whether Awconnect is pushing context to Genesis */
  connected: boolean
  /** Current active tab URL */
  url: string
  /** Current page title */
  title: string
  /** Page description (from OG/meta) */
  description: string
  /** Site name */
  siteName: string
  /** Main content preview */
  contentPreview: string
  /** Page type (article, product, etc.) */
  pageType: string
  /** Structured data richness score 0-15 */
  richness: number
  /** Context age in seconds */
  ageSeconds: number
  /** Whether context is stale (>5 min) */
  stale: boolean
  /** Last time we polled */
  lastPollTime: number
  /** Error if any */
  error?: string
}

export interface SensesConfig {
  voice: {
    mode: ListenMode
    language?: string
    /** Auto-send transcription to agent after silence */
    autoSend?: boolean
    /** Silence duration before auto-send (ms) */
    silenceTimeout?: number
    /** Wake word to activate (e.g., "hey aither") */
    wakeWord?: string
  }
  vision: {
    mode: VisionMode
    /** Observation interval for periodic mode (ms) */
    interval?: number
    /** Target window ID for focused observation */
    targetWindow?: string
  }
  browser: {
    /** Whether to poll for Awconnect browser context */
    enabled: boolean
    /** Poll interval in ms (default: 10000) */
    pollInterval?: number
  }
  /** Callback when voice input is ready to send */
  onVoiceInput?: (transcript: string) => void
  /** Callback when vision observation is ready */
  onVisionObservation?: (analysis: string) => void
  /** Callback when browser context updates */
  onBrowserContextUpdate?: (context: BrowserState) => void
}

interface AitherSensesReturn {
  voice: VoiceState
  vision: VisionState
  browser: BrowserState

  // Voice controls
  startListening: (mode?: ListenMode) => void
  stopListening: () => void
  speak: (text: string, options?: { voice?: string; emotion?: string }) => Promise<void>
  cancelSpeech: () => void

  // Vision controls
  startObserving: (mode?: VisionMode) => void
  stopObserving: () => void
  captureAndAnalyze: (targetWindow?: string) => Promise<string>

  // Browser context controls
  refreshBrowserContext: () => Promise<void>
  startBrowserPolling: () => void
  stopBrowserPolling: () => void

  // Ambient mode
  enableAmbient: () => void
  disableAmbient: () => void
  isAmbient: boolean

  // Config
  updateConfig: (config: Partial<SensesConfig>) => void
}

// ============================================================================
// HOOK
// ============================================================================

export function useAitherSenses(initialConfig?: Partial<SensesConfig>): AitherSensesReturn {
  const configRef = useRef<SensesConfig>({
    voice: {
      mode: 'off',
      language: 'en-US',
      autoSend: true,
      silenceTimeout: 1500,
      wakeWord: 'hey aither',
    },
    vision: {
      mode: 'off',
      interval: 10000,
    },
    browser: {
      enabled: false,
      pollInterval: 10000,
    },
    ...initialConfig,
  })

  // Keep callbacks in sync with latest props (prevents stale closure)
  useEffect(() => {
    if (initialConfig?.onVoiceInput) {
      configRef.current.onVoiceInput = initialConfig.onVoiceInput
    }
    if (initialConfig?.onVisionObservation) {
      configRef.current.onVisionObservation = initialConfig.onVisionObservation
    }
    if (initialConfig?.onBrowserContextUpdate) {
      configRef.current.onBrowserContextUpdate = initialConfig.onBrowserContextUpdate
    }
  }, [initialConfig?.onVoiceInput, initialConfig?.onVisionObservation, initialConfig?.onBrowserContextUpdate])

  const [voice, setVoice] = useState<VoiceState>({
    isListening: false,
    mode: 'off',
    transcript: '',
    interimTranscript: '',
    isSpeaking: false,
    audioLevel: 0,
  })

  const [vision, setVision] = useState<VisionState>({
    mode: 'off',
    isObserving: false,
    lastAnalysis: '',
    lastCaptureTime: 0,
    observationInterval: 10000,
  })

  const [browser, setBrowser] = useState<BrowserState>({
    connected: false,
    url: '',
    title: '',
    description: '',
    siteName: '',
    contentPreview: '',
    pageType: '',
    richness: 0,
    ageSeconds: -1,
    stale: true,
    lastPollTime: 0,
  })

  const [isAmbient, setIsAmbient] = useState(false)

  // Refs for persistent objects
  const recognitionRef = useRef<any>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const browserPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const levelAnimRef = useRef<number>(0)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)

  // ── VOICE: Web Speech API + Audio Level Monitoring ──────────────────
  const startListening = useCallback((mode?: ListenMode) => {
    const listenMode = mode || configRef.current.voice.mode || 'continuous'

    // Check for Web Speech API
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setVoice(prev => ({ ...prev, error: 'Speech recognition not supported in this browser' }))
      return
    }

    // Stop existing
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch (_e) { /* ignore */ }
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = listenMode === 'continuous' || listenMode === 'vad'
    recognition.interimResults = true
    recognition.lang = configRef.current.voice.language || 'en-US'
    recognition.maxAlternatives = 1

    let fullTranscript = ''

    recognition.onresult = (event: any) => {
      let interim = ''
      let final = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          final += result[0].transcript
        } else {
          interim += result[0].transcript
        }
      }

      if (final) {
        fullTranscript += final + ' '

        // Check for wake word
        const wakeWord = configRef.current.voice.wakeWord
        if (wakeWord && fullTranscript.toLowerCase().includes(wakeWord.toLowerCase())) {
          fullTranscript = fullTranscript.toLowerCase().replace(wakeWord.toLowerCase(), '').trim()
        }

        // Auto-send after silence
        if (configRef.current.voice.autoSend) {
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
          silenceTimerRef.current = setTimeout(() => {
            if (fullTranscript.trim()) {
              configRef.current.onVoiceInput?.(fullTranscript.trim())
              setVoice(prev => ({ ...prev, transcript: fullTranscript.trim() }))
              fullTranscript = ''
            }
          }, configRef.current.voice.silenceTimeout || 1500)
        }
      }

      setVoice(prev => ({
        ...prev,
        transcript: fullTranscript.trim(),
        interimTranscript: interim,
      }))
    }

    recognition.onerror = (event: any) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setVoice(prev => ({ ...prev, error: `Speech error: ${event.error}` }))
      }
    }

    recognition.onend = () => {
      // Auto-restart for continuous/VAD modes
      if (configRef.current.voice.mode === 'continuous' || configRef.current.voice.mode === 'vad') {
        try { recognition.start() } catch (_e) { /* ignore */ }
      } else {
        setVoice(prev => ({ ...prev, isListening: false }))
      }
    }

    recognition.start()
    recognitionRef.current = recognition

    // Start audio level monitoring
    startAudioLevelMonitoring()

    setVoice(prev => ({
      ...prev,
      isListening: true,
      mode: listenMode,
      error: undefined,
      transcript: '',
      interimTranscript: '',
    }))
    configRef.current.voice.mode = listenMode
  }, [])

  const stopListening = useCallback(() => {
    configRef.current.voice.mode = 'off'
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch (_e) { /* ignore */ }
      recognitionRef.current = null
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    stopAudioLevelMonitoring()
    setVoice(prev => ({
      ...prev,
      isListening: false,
      mode: 'off',
      interimTranscript: '',
      audioLevel: 0,
    }))
  }, [])

  // Audio level monitoring (for visualizer)
  const startAudioLevelMonitoring = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      const audioCtx = new AudioContext()
      audioContextRef.current = audioCtx
      const analyser = audioCtx.createAnalyser()
      analyserRef.current = analyser
      analyser.fftSize = 256
      const source = audioCtx.createMediaStreamSource(stream)
      source.connect(analyser)

      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      const updateLevel = () => {
        if (!analyserRef.current) return
        analyser.getByteFrequencyData(dataArray)
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
        setVoice(prev => ({ ...prev, audioLevel: avg / 255 }))
        levelAnimRef.current = requestAnimationFrame(updateLevel)
      }
      levelAnimRef.current = requestAnimationFrame(updateLevel)
    } catch (_e) {
      // Mic access denied — that's ok
    }
  }, [])

  const stopAudioLevelMonitoring = useCallback(() => {
    if (levelAnimRef.current) cancelAnimationFrame(levelAnimRef.current)
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop())
      mediaStreamRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    analyserRef.current = null
  }, [])

  // ── VOICE: TTS Output ──────────────────────────────────────────────
  const speak = useCallback(async (text: string, options?: { voice?: string; emotion?: string }) => {
    setVoice(prev => ({ ...prev, isSpeaking: true }))

    try {
      // Try AitherVoice TTS first
      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: options?.voice || 'NATF1',
          emotion: options?.emotion,
        }),
      })

      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        currentAudioRef.current = audio
        audio.onended = () => {
          URL.revokeObjectURL(url)
          setVoice(prev => ({ ...prev, isSpeaking: false }))
          currentAudioRef.current = null
        }
        await audio.play()
        return
      }
    } catch (_e) { /* fallback below */ }

    // Fallback: Web Speech API
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.onend = () => setVoice(prev => ({ ...prev, isSpeaking: false }))
      speechSynthesis.speak(utterance)
    } else {
      setVoice(prev => ({ ...prev, isSpeaking: false }))
    }
  }, [])

  const cancelSpeech = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
      currentAudioRef.current = null
    }
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel()
    }
    setVoice(prev => ({ ...prev, isSpeaking: false }))
  }, [])

  // ── VISION: Screen Observation ─────────────────────────────────────
  const captureAndAnalyze = useCallback(async (targetWindow?: string): Promise<string> => {
    try {
      setVision(prev => ({ ...prev, isObserving: true }))

      const windowTarget = targetWindow || configRef.current.vision.targetWindow

      // ── Capture actual DOM state for context ──────────────────────────
      let domSnapshot = ''
      try {
        // Gather visible window titles and content summaries from the desktop
        const windowElements = document.querySelectorAll('[data-window-id]')
        const windowInfo: string[] = []
        windowElements.forEach(el => {
          const id = el.getAttribute('data-window-id') || 'unknown'
          const title = el.querySelector('[data-window-title]')?.textContent || el.getAttribute('data-window-title') || id
          const visible = (el as HTMLElement).offsetParent !== null
          if (visible) {
            // Get a content summary (text content, truncated)
            const content = (el as HTMLElement).innerText?.slice(0, 500) || ''
            windowInfo.push(`[Window: ${title}] ${content.slice(0, 200).replace(/\n+/g, ' ')}`)
          }
        })

        // Also capture the focused element context
        const focused = document.activeElement
        const focusedInfo = focused ? `Focused element: <${focused.tagName.toLowerCase()}> ${focused.getAttribute('aria-label') || focused.getAttribute('title') || ''}` : ''

        // Get visible text from the viewport
        const bodyText = document.body.innerText?.slice(0, 2000) || ''
        const visibleApps = windowInfo.length > 0 ? `\nOpen windows:\n${windowInfo.join('\n')}` : '\nNo application windows visible (desktop view)'

        domSnapshot = `\n\nDOM SNAPSHOT (what is actually on screen):\n${visibleApps}\n${focusedInfo}\nPage title: ${document.title}\nViewport: ${window.innerWidth}x${window.innerHeight}\nVisible text excerpt: ${bodyText.slice(0, 600).replace(/\n+/g, ' ')}`
      } catch (_e) {
        domSnapshot = '\n(DOM snapshot unavailable)'
      }

      // ── Try to capture a screenshot via Canvas if getDisplayMedia is available ──
      const screenshotDataUrl = ''
      try {
        // Note: getDisplayMedia requires user gesture and permission — may not work in all contexts
        // For now, we rely on DOM snapshot which is always available
      } catch (_e) {
        // Screenshot capture not available
      }

      const res = await fetch('/api/agent-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Observe and analyze the current desktop state${windowTarget ? ` focusing on the ${windowTarget} window` : ''}. Based on the DOM snapshot, describe what the user is looking at and what they seem to be doing. Provide actionable observations.${domSnapshot}`,
          windowId: windowTarget || 'desktop',
          layers: ['kernel'],
          stream: false,
        }),
      })

      const text = await res.text()
      const lines = text.split('\n').filter((l: string) => l.startsWith('data: '))
      let analysis = ''
      for (const line of lines) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const event = JSON.parse(data)
          if (event.t || event.token || event.content) {
            analysis += event.t || event.token || event.content || ''
          }
          if (event.type === 'complete' && event.content) analysis = event.content
        } catch (_e) { /* skip */ }
      }

      setVision(prev => ({
        ...prev,
        lastAnalysis: analysis,
        lastCaptureTime: Date.now(),
        isObserving: false,
      }))

      configRef.current.onVisionObservation?.(analysis)
      return analysis

    } catch (error: any) {
      setVision(prev => ({
        ...prev,
        isObserving: false,
        error: `Vision error: ${error.message}`,
      }))
      return `Vision failed: ${error.message}`
    }
  }, [])

  const startObserving = useCallback((mode?: VisionMode) => {
    const observeMode = mode || 'periodic'
    const interval = configRef.current.vision.interval || 10000

    setVision(prev => ({ ...prev, mode: observeMode, observationInterval: interval }))
    configRef.current.vision.mode = observeMode

    if (observeMode === 'periodic' || observeMode === 'change-detect') {
      // Clear any existing interval
      if (visionIntervalRef.current) clearInterval(visionIntervalRef.current)
      visionIntervalRef.current = setInterval(() => {
        captureAndAnalyze()
      }, interval)
      // Immediate first capture
      captureAndAnalyze()
    }
  }, [captureAndAnalyze])

  const stopObserving = useCallback(() => {
    configRef.current.vision.mode = 'off'
    if (visionIntervalRef.current) {
      clearInterval(visionIntervalRef.current)
      visionIntervalRef.current = null
    }
    setVision(prev => ({ ...prev, mode: 'off', isObserving: false }))
  }, [])

  // ── BROWSER: Awconnect Context Polling ─────────────────────────
  const refreshBrowserContext = useCallback(async () => {
    try {
      const res = await fetch('/api/browser-context', {
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) {
        setBrowser(prev => ({ ...prev, connected: false, error: `HTTP ${res.status}` }))
        return
      }

      const data = await res.json()
      const ctx = data.context

      const newState: BrowserState = {
        connected: data.connected ?? false,
        url: ctx?.url || '',
        title: ctx?.title || '',
        description: ctx?.opengraph?.['og:description'] || ctx?.meta?.description || '',
        siteName: ctx?.opengraph?.['og:site_name'] || '',
        contentPreview: ctx?.structure?.main_content?.text_preview?.slice(0, 300) || '',
        pageType: ctx?.json_ld?.[0]?.['@type'] || ctx?.opengraph?.['og:type'] || '',
        richness: ctx?.agent_richness_score || 0,
        ageSeconds: data.age_seconds ?? -1,
        stale: data.stale ?? true,
        lastPollTime: Date.now(),
        error: data.error,
      }

      setBrowser(newState)
      configRef.current.onBrowserContextUpdate?.(newState)
    } catch (error: any) {
      setBrowser(prev => ({
        ...prev,
        connected: false,
        error: `Poll failed: ${error.message}`,
        lastPollTime: Date.now(),
      }))
    }
  }, [])

  const startBrowserPolling = useCallback(() => {
    configRef.current.browser.enabled = true
    if (browserPollRef.current) clearInterval(browserPollRef.current)
    const interval = configRef.current.browser.pollInterval || 10000
    browserPollRef.current = setInterval(refreshBrowserContext, interval)
    // Immediate first poll
    refreshBrowserContext()
  }, [refreshBrowserContext])

  const stopBrowserPolling = useCallback(() => {
    configRef.current.browser.enabled = false
    if (browserPollRef.current) {
      clearInterval(browserPollRef.current)
      browserPollRef.current = null
    }
  }, [])

  // ── AMBIENT MODE ───────────────────────────────────────────────────
  const enableAmbient = useCallback(() => {
    setIsAmbient(true)
    startListening('vad')
    startObserving('periodic')
    startBrowserPolling()
  }, [startListening, startObserving, startBrowserPolling])

  const disableAmbient = useCallback(() => {
    setIsAmbient(false)
    stopListening()
    stopObserving()
    stopBrowserPolling()
  }, [stopListening, stopObserving, stopBrowserPolling])

  // Config update
  const updateConfig = useCallback((config: Partial<SensesConfig>) => {
    if (config.voice) configRef.current.voice = { ...configRef.current.voice, ...config.voice }
    if (config.vision) configRef.current.vision = { ...configRef.current.vision, ...config.vision }
    if (config.browser) configRef.current.browser = { ...configRef.current.browser, ...config.browser }
    if (config.onVoiceInput) configRef.current.onVoiceInput = config.onVoiceInput
    if (config.onVisionObservation) configRef.current.onVisionObservation = config.onVisionObservation
    if (config.onBrowserContextUpdate) configRef.current.onBrowserContextUpdate = config.onBrowserContextUpdate
  }, [])

  // Cleanup
  useEffect(() => {
    return () => {
      stopListening()
      stopObserving()
      stopBrowserPolling()
      stopAudioLevelMonitoring()
    }
  }, [stopListening, stopObserving, stopBrowserPolling, stopAudioLevelMonitoring])

  return {
    voice,
    vision,
    browser,
    startListening,
    stopListening,
    speak,
    cancelSpeech,
    startObserving,
    stopObserving,
    captureAndAnalyze,
    refreshBrowserContext,
    startBrowserPolling,
    stopBrowserPolling,
    enableAmbient,
    disableAmbient,
    isAmbient,
    updateConfig,
  }
}
