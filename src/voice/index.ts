// Voice chat for portal-kit -- barrel exports
export type {
  VoiceMode,
  VoiceTier,
  VoiceState,
  VoiceSettings,
  AudioDevice,
  TranscriptionResult,
  SynthesisResult,
} from './voice-types'
export { DEFAULT_VOICE_SETTINGS } from './voice-types'

export { loadVoiceSettings, saveVoiceSettings, getAudioDevices } from './voice-settings'

export { useVoiceInput } from './useVoiceInput'
export type { VoiceInputState, VoiceInputCallbacks, UseVoiceInputOptions, UseVoiceInputReturn } from './useVoiceInput'

export { useSpeechOutput } from './useSpeechOutput'
export type { UseSpeechOutputOptions, UseSpeechOutputReturn } from './useSpeechOutput'

export { useSyncedSpeech } from './useSyncedSpeech'
export type { SyncedSpeechOptions, SyncedSpeechState } from './useSyncedSpeech'

export { useVoiceChat } from './useVoiceChat'
export type { UseVoiceChatOptions, UseVoiceChatReturn } from './useVoiceChat'

export { VoiceMicButton } from './VoiceMicButton'
export type { VoiceMicButtonProps } from './VoiceMicButton'

export { VoiceButton } from './VoiceButton'
export type { VoiceButtonProps } from './VoiceButton'
