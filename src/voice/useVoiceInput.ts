/**
 * useVoiceInput -- Mic capture hook for portal-kit.
 * Ported from Veil's use-voice-input.ts with local type imports.
 *
 * Features:
 * - MediaRecorder + Web Audio API for capture and level monitoring
 * - PTT / VAD / Continuous modes
 * - Safari fallback: audio/mp4 when audio/webm unsupported
 * - Real-time audio level via requestAnimationFrame
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import type { VoiceMode } from './voice-types'
import { loadVoiceSettings } from './voice-settings'

export interface VoiceInputState {
  isRecording: boolean
  isPaused: boolean
  audioLevel: number
  error: string | null
  hasPermission: boolean
  isSpeaking: boolean
}

export interface VoiceInputCallbacks {
  onAudioChunk?: (chunk: ArrayBuffer) => void
  onRecordingStart?: () => void
  onRecordingStop?: (fullRecording?: Blob) => void
  onSpeechStart?: () => void
  onSpeechEnd?: () => void
  onError?: (error: string) => void
  onLevelChange?: (level: number) => void
}

export interface UseVoiceInputOptions {
  mode?: VoiceMode
  deviceId?: string | null
  vadSensitivity?: number
  chunkInterval?: number
  sampleRate?: number
}

export interface UseVoiceInputReturn extends VoiceInputState {
  startRecording: () => Promise<void>
  stopRecording: () => void
  pauseRecording: () => void
  resumeRecording: () => void
  requestPermission: () => Promise<boolean>
  setMode: (mode: VoiceMode) => void
  setDevice: (deviceId: string | null) => void
  setSensitivity: (sensitivity: number) => void
}

const DEFAULT_SAMPLE_RATE = 24000
const DEFAULT_CHUNK_INTERVAL = 250
const VAD_SILENCE_THRESHOLD = 0.02
const VAD_SILENCE_DURATION = 1500

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm'
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'  // Safari fallback
  return 'audio/webm'
}

export function useVoiceInput(
  callbacks: VoiceInputCallbacks = {},
  options: UseVoiceInputOptions = {}
): UseVoiceInputReturn {
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [hasPermission, setHasPermission] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)

  const [mode, setModeState] = useState<VoiceMode>(options.mode || 'ptt')
  const [deviceId, setDeviceState] = useState<string | null>(options.deviceId || null)
  const [vadSensitivity, setVadSensitivity] = useState(options.vadSensitivity || 0.5)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const animationFrameRef = useRef<number | null>(null)
  const callbacksRef = useRef(callbacks)
  const chunkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const silenceStartRef = useRef<number | null>(null)

  useEffect(() => {
    callbacksRef.current = callbacks
  }, [callbacks])

  useEffect(() => {
    const settings = loadVoiceSettings()
    if (!options.mode) setModeState(settings.mode)
    if (!options.deviceId && settings.inputDeviceId) setDeviceState(settings.inputDeviceId)
    if (!options.vadSensitivity) setVadSensitivity(settings.vadSensitivity)
  }, [options.mode, options.deviceId, options.vadSensitivity])

  const startLevelMonitoring = useCallback(() => {
    if (!analyserRef.current) return

    const analyser = analyserRef.current
    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    const updateLevel = () => {
      analyser.getByteFrequencyData(dataArray)

      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i]
      }
      const avg = sum / dataArray.length / 255

      setAudioLevel(avg)
      callbacksRef.current.onLevelChange?.(avg)

      if (mode === 'vad' && isRecording) {
        const threshold = VAD_SILENCE_THRESHOLD + (vadSensitivity * 0.1)

        if (avg > threshold) {
          if (!isSpeaking) {
            setIsSpeaking(true)
            callbacksRef.current.onSpeechStart?.()
          }
          silenceStartRef.current = null
        } else {
          if (isSpeaking) {
            if (!silenceStartRef.current) {
              silenceStartRef.current = Date.now()
            } else if (Date.now() - silenceStartRef.current > VAD_SILENCE_DURATION) {
              setIsSpeaking(false)
              callbacksRef.current.onSpeechEnd?.()
              silenceStartRef.current = null
            }
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(updateLevel)
    }

    updateLevel()
  }, [mode, vadSensitivity, isRecording, isSpeaking])

  const stopLevelMonitoring = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    setAudioLevel(0)
  }, [])

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(track => track.stop())
      setHasPermission(true)
      return true
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Microphone access denied'
      setError(errorMessage)
      callbacksRef.current.onError?.(errorMessage)
      setHasPermission(false)
      return false
    }
  }, [])

  const startRecording = useCallback(async (): Promise<void> => {
    if (isRecording) return

    try {
      setError(null)

      const constraints: MediaStreamConstraints = {
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          sampleRate: options.sampleRate || DEFAULT_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream
      setHasPermission(true)

      // Resume AudioContext on user gesture (required for iOS Safari)
      const ctx = new AudioContext({ sampleRate: options.sampleRate || DEFAULT_SAMPLE_RATE })
      if (ctx.state === 'suspended') await ctx.resume()
      audioContextRef.current = ctx

      const source = ctx.createMediaStreamSource(stream)
      analyserRef.current = ctx.createAnalyser()
      analyserRef.current.fftSize = 256
      source.connect(analyserRef.current)

      const mimeType = getSupportedMimeType()
      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
          event.data.arrayBuffer().then(buffer => {
            callbacksRef.current.onAudioChunk?.(buffer)
          })
        }
      }

      recorder.onstop = () => {
        const fullRecording = new Blob(chunksRef.current, { type: mimeType })
        callbacksRef.current.onRecordingStop?.(fullRecording)
      }

      const chunkInterval = options.chunkInterval || DEFAULT_CHUNK_INTERVAL
      recorder.start(chunkInterval)

      setIsRecording(true)
      setIsPaused(false)
      startLevelMonitoring()
      callbacksRef.current.onRecordingStart?.()
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to start recording'
      setError(errorMessage)
      callbacksRef.current.onError?.(errorMessage)
      throw e
    }
  }, [isRecording, deviceId, options.sampleRate, options.chunkInterval, startLevelMonitoring])

  const stopRecording = useCallback((): void => {
    if (!isRecording) return

    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current)
      chunkIntervalRef.current = null
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }

    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }

    stopLevelMonitoring()
    setIsRecording(false)
    setIsPaused(false)
    setIsSpeaking(false)
    silenceStartRef.current = null
  }, [isRecording, stopLevelMonitoring])

  const pauseRecording = useCallback((): void => {
    if (!isRecording || isPaused) return
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause()
      setIsPaused(true)
    }
  }, [isRecording, isPaused])

  const resumeRecording = useCallback((): void => {
    if (!isRecording || !isPaused) return
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume()
      setIsPaused(false)
    }
  }, [isRecording, isPaused])

  const setMode = useCallback((newMode: VoiceMode) => {
    setModeState(newMode)
  }, [])

  const setDevice = useCallback((newDeviceId: string | null) => {
    setDeviceState(newDeviceId)
    if (isRecording) {
      stopRecording()
      setTimeout(() => startRecording(), 100)
    }
  }, [isRecording, stopRecording, startRecording])

  const setSensitivity = useCallback((sensitivity: number) => {
    setVadSensitivity(Math.max(0, Math.min(1, sensitivity)))
  }, [])

  useEffect(() => {
    return () => {
      if (isRecording) {
        stopRecording()
      }
    }
  }, [isRecording, stopRecording])

  return {
    isRecording,
    isPaused,
    audioLevel,
    error,
    hasPermission,
    isSpeaking,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    requestPermission,
    setMode,
    setDevice,
    setSensitivity,
  }
}
