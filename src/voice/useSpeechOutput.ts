/**
 * useSpeechOutput -- TTS output hook with dual-tier support.
 *
 * Browser tier: window.speechSynthesis (zero config, works offline)
 * Server tier: POST /api/voice/synthesize -> base64 audio -> Web Audio playback
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import type { VoiceTier } from './voice-types'

export interface UseSpeechOutputOptions {
  tier?: VoiceTier
  voice?: string
  rate?: number
  volume?: number
}

export interface UseSpeechOutputReturn {
  speak: (text: string) => Promise<void>
  speakSentence: (sentence: string) => Promise<void>
  stop: () => void
  isSpeaking: boolean
  availableVoices: SpeechSynthesisVoice[]
  browserTTSAvailable: boolean
}

export function useSpeechOutput(options: UseSpeechOutputOptions = {}): UseSpeechOutputReturn {
  const { tier = 'browser', voice = '', rate = 1.0, volume = 1.0 } = options

  const [isSpeaking, setIsSpeaking] = useState(false)
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])
  const audioContextRef = useRef<AudioContext | null>(null)
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const abortRef = useRef(false)

  const browserTTSAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window

  // Load browser voices
  useEffect(() => {
    if (!browserTTSAvailable) return

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices()
      if (voices.length > 0) setAvailableVoices(voices)
    }

    loadVoices()
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices)
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices)
    }
  }, [browserTTSAvailable])

  const speakBrowser = useCallback((text: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!browserTTSAvailable) {
        reject(new Error('Browser TTS not available'))
        return
      }

      window.speechSynthesis.cancel()

      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = rate
      utterance.volume = volume

      if (voice) {
        const match = availableVoices.find(
          v => v.name === voice || v.voiceURI === voice
        )
        if (match) utterance.voice = match
      }

      utterance.onstart = () => setIsSpeaking(true)
      utterance.onend = () => { setIsSpeaking(false); resolve() }
      utterance.onerror = (e) => {
        setIsSpeaking(false)
        if (e.error === 'canceled') resolve()
        else reject(new Error(`TTS error: ${e.error}`))
      }

      window.speechSynthesis.speak(utterance)
    })
  }, [browserTTSAvailable, voice, rate, volume, availableVoices])

  const speakServer = useCallback(async (text: string): Promise<void> => {
    abortRef.current = false
    setIsSpeaking(true)

    try {
      const resp = await fetch('/api/voice/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: voice || 'nova', speed: rate }),
      })

      if (!resp.ok) throw new Error(`Synthesis failed: ${resp.status}`)
      if (abortRef.current) return

      const data = await resp.json()
      const audioBase64 = data.audio || data.audio_base64
      if (!audioBase64) throw new Error('No audio data in response')

      const raw = atob(audioBase64)
      const bytes = new Uint8Array(raw.length)
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)

      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new AudioContext()
      }
      const ctx = audioContextRef.current
      if (ctx.state === 'suspended') await ctx.resume()

      const audioBuffer = await ctx.decodeAudioData(bytes.buffer)
      if (abortRef.current) return

      const source = ctx.createBufferSource()
      source.buffer = audioBuffer

      const gainNode = ctx.createGain()
      gainNode.gain.value = volume
      source.connect(gainNode)
      gainNode.connect(ctx.destination)

      currentSourceRef.current = source

      return new Promise<void>((resolve) => {
        source.onended = () => {
          setIsSpeaking(false)
          currentSourceRef.current = null
          resolve()
        }
        source.start()
      })
    } catch (e) {
      setIsSpeaking(false)
      throw e
    }
  }, [voice, rate, volume])

  const speak = useCallback(async (text: string): Promise<void> => {
    if (tier === 'server') {
      try {
        await speakServer(text)
      } catch {
        // Fallback to browser TTS if server fails
        if (browserTTSAvailable) await speakBrowser(text)
      }
    } else {
      await speakBrowser(text)
    }
  }, [tier, speakServer, speakBrowser, browserTTSAvailable])

  const stop = useCallback(() => {
    abortRef.current = true
    setIsSpeaking(false)

    if (browserTTSAvailable) {
      window.speechSynthesis.cancel()
    }

    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop() } catch { /* already stopped */ }
      currentSourceRef.current = null
    }
  }, [browserTTSAvailable])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current = true
      if (browserTTSAvailable) window.speechSynthesis.cancel()
      if (currentSourceRef.current) {
        try { currentSourceRef.current.stop() } catch { /* ignore */ }
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close()
      }
    }
  }, [browserTTSAvailable])

  return {
    speak,
    speakSentence: speak,
    stop,
    isSpeaking,
    availableVoices,
    browserTTSAvailable,
  }
}
