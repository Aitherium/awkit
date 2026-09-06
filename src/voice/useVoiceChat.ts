/**
 * useVoiceChat -- Orchestrator hook wiring the full voice loop.
 *
 * Record -> transcribe -> inject into chat -> get response -> speak
 *
 * Browser STT: webkitSpeechRecognition (Chrome/Edge) with auto-fallback to server.
 * Server STT: POST audio blob as base64 to /api/voice/transcribe.
 * Echo prevention: mic paused during TTS playback.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import type { VoiceTier, VoiceMode } from './voice-types'
import { useVoiceInput } from './useVoiceInput'
import { useSpeechOutput } from './useSpeechOutput'

export interface UseVoiceChatOptions {
  enabled?: boolean
  tier?: VoiceTier
  mode?: VoiceMode
  ttsVoice?: string
  autoSpeakResponses?: boolean
  sendMessage: (text: string) => Promise<string>
  onTranscript?: (text: string) => void
}

export interface UseVoiceChatReturn {
  isListening: boolean
  isSpeaking: boolean
  isTranscribing: boolean
  audioLevel: number
  error: string | null
  toggleListening: () => void
  startListening: () => void
  stopListening: () => void
  speakResponse: (text: string) => Promise<void>
  stopSpeaking: () => void
  browserSTTAvailable: boolean
  browserTTSAvailable: boolean
}

// Detect browser STT
function hasBrowserSTT(): boolean {
  if (typeof window === 'undefined') return false
  return !!(
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition
  )
}

export function useVoiceChat(options: UseVoiceChatOptions): UseVoiceChatReturn {
  const {
    enabled = true,
    tier = 'browser',
    mode = 'ptt',
    ttsVoice = '',
    autoSpeakResponses = true,
    sendMessage,
    onTranscript,
  } = options

  const [isTranscribing, setIsTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<any>(null)
  const effectiveTier = tier === 'browser' && !hasBrowserSTT() ? 'server' : tier

  const speechOutput = useSpeechOutput({
    tier: effectiveTier,
    voice: ttsVoice,
  })

  const voiceInput = useVoiceInput(
    {
      onRecordingStop: async (blob) => {
        if (!blob || effectiveTier === 'browser') return
        await transcribeServer(blob)
      },
      onError: (err) => setError(err),
    },
    { mode }
  )

  // Browser STT via webkitSpeechRecognition
  const startBrowserSTT = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.continuous = mode === 'continuous'
    recognition.interimResults = false
    recognition.lang = 'en-US'

    recognition.onresult = async (event: any) => {
      const transcript = event.results[event.results.length - 1][0].transcript.trim()
      if (!transcript) return

      onTranscript?.(transcript)
      setIsTranscribing(false)

      // Pause mic during response to prevent echo
      if (speechOutput.isSpeaking) return

      try {
        const response = await sendMessage(transcript)
        if (autoSpeakResponses && response) {
          await speechOutput.speak(response)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Chat send failed')
      }
    }

    recognition.onerror = (event: any) => {
      if (event.error !== 'aborted') {
        setError(`Speech recognition error: ${event.error}`)
      }
      setIsTranscribing(false)
    }

    recognition.onend = () => {
      setIsTranscribing(false)
      recognitionRef.current = null
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsTranscribing(true)
    setError(null)
  }, [mode, onTranscript, sendMessage, autoSpeakResponses, speechOutput])

  const stopBrowserSTT = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    setIsTranscribing(false)
  }, [])

  // Server STT: POST base64 audio to backend
  const transcribeServer = useCallback(async (blob: Blob) => {
    setIsTranscribing(true)
    setError(null)

    try {
      const buffer = await blob.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      let binary = ''
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i])
      }
      const base64 = btoa(binary)

      const resp = await fetch('/api/voice/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_base64: base64 }),
      })

      if (!resp.ok) throw new Error(`Transcription failed: ${resp.status}`)

      const data = await resp.json()
      const transcript = data.text || data.transcript || ''

      if (transcript) {
        onTranscript?.(transcript)

        try {
          const response = await sendMessage(transcript)
          if (autoSpeakResponses && response) {
            await speechOutput.speak(response)
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Chat send failed')
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transcription failed')
    } finally {
      setIsTranscribing(false)
    }
  }, [onTranscript, sendMessage, autoSpeakResponses, speechOutput])

  const startListening = useCallback(() => {
    if (!enabled) return
    setError(null)

    // Pause TTS if it's playing to prevent feedback
    if (speechOutput.isSpeaking) {
      speechOutput.stop()
    }

    if (effectiveTier === 'browser') {
      startBrowserSTT()
    } else {
      voiceInput.startRecording()
    }
  }, [enabled, effectiveTier, startBrowserSTT, voiceInput, speechOutput])

  const stopListening = useCallback(() => {
    if (effectiveTier === 'browser') {
      stopBrowserSTT()
    } else {
      voiceInput.stopRecording()
    }
  }, [effectiveTier, stopBrowserSTT, voiceInput])

  const toggleListening = useCallback(() => {
    const listening = effectiveTier === 'browser' ? !!recognitionRef.current : voiceInput.isRecording
    if (listening) {
      stopListening()
    } else {
      startListening()
    }
  }, [effectiveTier, voiceInput.isRecording, startListening, stopListening])

  const isListening = effectiveTier === 'browser' ? isTranscribing : voiceInput.isRecording

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    }
  }, [])

  return {
    isListening,
    isSpeaking: speechOutput.isSpeaking,
    isTranscribing,
    audioLevel: voiceInput.audioLevel,
    error,
    toggleListening,
    startListening,
    stopListening,
    speakResponse: speechOutput.speak,
    stopSpeaking: speechOutput.stop,
    browserSTTAvailable: hasBrowserSTT(),
    browserTTSAvailable: speechOutput.browserTTSAvailable,
  }
}
