/**
 * Voice types for portal-kit voice chat.
 * Extracted subset from Veil's personaplex-client -- only what's needed for STT/TTS.
 */

export type VoiceMode = 'ptt' | 'vad' | 'continuous'
export type VoiceTier = 'browser' | 'server'

export type VoiceState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'speaking'
  | 'error'

export interface VoiceSettings {
  mode: VoiceMode
  tier: VoiceTier
  inputDeviceId: string | null
  outputDeviceId: string | null
  inputVolume: number       // 0.0 - 1.0
  outputVolume: number      // 0.0 - 1.0
  vadSensitivity: number    // 0.0 - 1.0
  autoPlayResponses: boolean
  stopListeningWhileSpeaking: boolean
  ttsVoice: string          // browser voice name or server voice id
}

export interface AudioDevice {
  deviceId: string
  label: string
  kind: 'audioinput' | 'audiooutput'
}

export interface TranscriptionResult {
  text: string
  confidence?: number
  language?: string
  tier: VoiceTier
}

export interface SynthesisResult {
  audio?: ArrayBuffer
  duration?: number
  tier: VoiceTier
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  mode: 'ptt',
  tier: 'browser',
  inputDeviceId: null,
  outputDeviceId: null,
  inputVolume: 1.0,
  outputVolume: 1.0,
  vadSensitivity: 0.5,
  autoPlayResponses: true,
  stopListeningWhileSpeaking: true,
  ttsVoice: '',
}
