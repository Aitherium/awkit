/**
 * useVoiceInput Hook
 * ==================
 * 
 * React hook for capturing microphone audio with real-time level monitoring.
 * Supports Push-to-Talk (PTT), Voice Activity Detection (VAD), and Continuous modes.
 * 
 * Features:
 * - MediaRecorder API for audio capture
 * - Real-time audio level monitoring via Web Audio API
 * - VAD (Voice Activity Detection) with configurable sensitivity
 * - Device selection support
 * - Automatic chunking for streaming
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { VoiceMode, VoiceSettings, loadVoiceSettings } from '../lib/personaplex-client'

// ============================================================================
// TYPES
// ============================================================================

export interface VoiceInputState {
  isRecording: boolean
  isPaused: boolean
  audioLevel: number  // 0.0 - 1.0
  error: string | null
  hasPermission: boolean
  isSpeaking: boolean  // For VAD mode
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
  chunkInterval?: number  // ms between chunks for streaming
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

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_SAMPLE_RATE = 24000  // PersonaPlex expects 24kHz
const DEFAULT_CHUNK_INTERVAL = 250  // Send audio every 250ms
const VAD_SILENCE_THRESHOLD = 0.02  // Below this is considered silence
const VAD_SILENCE_DURATION = 1500  // ms of silence before ending speech

// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

export function useVoiceInput(
  callbacks: VoiceInputCallbacks = {},
  options: UseVoiceInputOptions = {}
): UseVoiceInputReturn {
  // State
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [hasPermission, setHasPermission] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  
  // Settings
  const [mode, setModeState] = useState<VoiceMode>(options.mode || 'ptt')
  const [deviceId, setDeviceState] = useState<string | null>(options.deviceId || null)
  const [vadSensitivity, setVadSensitivity] = useState(options.vadSensitivity || 0.5)
  
  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const animationFrameRef = useRef<number | null>(null)
  const callbacksRef = useRef(callbacks)
  const chunkIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const silenceStartRef = useRef<number | null>(null)
  
  // Update callbacks ref when callbacks change
  useEffect(() => {
    callbacksRef.current = callbacks
  }, [callbacks])
  
  // Load settings from storage on mount
  useEffect(() => {
    const settings = loadVoiceSettings()
    if (!options.mode) setModeState(settings.mode)
    if (!options.deviceId && settings.inputDeviceId) setDeviceState(settings.inputDeviceId)
    if (!options.vadSensitivity) setVadSensitivity(settings.vadSensitivity)
  }, [options.mode, options.deviceId, options.vadSensitivity])
  
  // ===========================================================================
  // AUDIO LEVEL MONITORING
  // ===========================================================================
  
  const startLevelMonitoring = useCallback(() => {
    if (!analyserRef.current) return
    
    const analyser = analyserRef.current
    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    
    const updateLevel = () => {
      analyser.getByteFrequencyData(dataArray)
      
      // Calculate average level
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i]
      }
      const avg = sum / dataArray.length / 255
      
      setAudioLevel(avg)
      callbacksRef.current.onLevelChange?.(avg)
      
      // VAD logic
      if (mode === 'vad' && isRecording) {
        const threshold = VAD_SILENCE_THRESHOLD + (vadSensitivity * 0.1)
        
        if (avg > threshold) {
          // Speech detected
          if (!isSpeaking) {
            setIsSpeaking(true)
            callbacksRef.current.onSpeechStart?.()
          }
          silenceStartRef.current = null
        } else {
          // Silence detected
          if (isSpeaking) {
            if (!silenceStartRef.current) {
              silenceStartRef.current = Date.now()
            } else if (Date.now() - silenceStartRef.current > VAD_SILENCE_DURATION) {
              // Extended silence - end speech
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
  
  // ===========================================================================
  // PERMISSION REQUEST
  // ===========================================================================
  
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
  
  // ===========================================================================
  // RECORDING CONTROL
  // ===========================================================================
  
  const startRecording = useCallback(async (): Promise<void> => {
    if (isRecording) return
    
    try {
      setError(null)
      
      // Get media stream
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
      
      // Setup Web Audio API for level monitoring
      audioContextRef.current = new AudioContext({
        sampleRate: options.sampleRate || DEFAULT_SAMPLE_RATE,
      })
      const source = audioContextRef.current.createMediaStreamSource(stream)
      analyserRef.current = audioContextRef.current.createAnalyser()
      analyserRef.current.fftSize = 256
      source.connect(analyserRef.current)
      
      // Setup MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      
      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      chunksRef.current = []
      
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
          
          // Convert to ArrayBuffer and send chunk
          event.data.arrayBuffer().then(buffer => {
            callbacksRef.current.onAudioChunk?.(buffer)
          })
        }
      }
      
      recorder.onstop = () => {
        // Create full recording blob
        const fullRecording = new Blob(chunksRef.current, { type: mimeType })
        callbacksRef.current.onRecordingStop?.(fullRecording)
      }
      
      // Start recording with chunking
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
    
    // Stop chunk interval
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current)
      chunkIntervalRef.current = null
    }
    
    // Stop MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    
    // Stop audio context
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    
    // Stop media stream
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
  
  // ===========================================================================
  // SETTINGS CONTROL
  // ===========================================================================
  
  const setMode = useCallback((newMode: VoiceMode) => {
    setModeState(newMode)
  }, [])
  
  const setDevice = useCallback((newDeviceId: string | null) => {
    setDeviceState(newDeviceId)
    
    // Restart recording if active to use new device
    if (isRecording) {
      stopRecording()
      // Small delay before restarting
      setTimeout(() => startRecording(), 100)
    }
  }, [isRecording, stopRecording, startRecording])
  
  const setSensitivity = useCallback((sensitivity: number) => {
    setVadSensitivity(Math.max(0, Math.min(1, sensitivity)))
  }, [])
  
  // ===========================================================================
  // CLEANUP
  // ===========================================================================
  
  useEffect(() => {
    return () => {
      if (isRecording) {
        stopRecording()
      }
    }
  }, [isRecording, stopRecording])
  
  // ===========================================================================
  // RETURN
  // ===========================================================================
  
  return {
    // State
    isRecording,
    isPaused,
    audioLevel,
    error,
    hasPermission,
    isSpeaking,
    
    // Actions
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
