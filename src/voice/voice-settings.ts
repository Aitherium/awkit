/**
 * Voice settings persistence -- localStorage read/write + device enumeration.
 */

import { DEFAULT_VOICE_SETTINGS, type VoiceSettings, type AudioDevice } from './voice-types'

const STORAGE_KEY = 'portal_kit_voice_settings'

export function loadVoiceSettings(): VoiceSettings {
  if (typeof window === 'undefined') return DEFAULT_VOICE_SETTINGS

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return { ...DEFAULT_VOICE_SETTINGS, ...parsed }
    }
  } catch (e) {
    console.warn('Failed to load voice settings:', e)
  }
  return DEFAULT_VOICE_SETTINGS
}

export function saveVoiceSettings(settings: Partial<VoiceSettings>): VoiceSettings {
  if (typeof window === 'undefined') return DEFAULT_VOICE_SETTINGS

  const current = loadVoiceSettings()
  const updated = { ...current, ...settings }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  } catch (e) {
    console.warn('Failed to save voice settings:', e)
  }

  return updated
}

export async function getAudioDevices(): Promise<{
  inputs: AudioDevice[]
  outputs: AudioDevice[]
}> {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true })

    const devices = await navigator.mediaDevices.enumerateDevices()

    const inputs: AudioDevice[] = devices
      .filter(d => d.kind === 'audioinput')
      .map(d => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${d.deviceId.slice(0, 8)}`,
        kind: 'audioinput' as const,
      }))

    const outputs: AudioDevice[] = devices
      .filter(d => d.kind === 'audiooutput')
      .map(d => ({
        deviceId: d.deviceId,
        label: d.label || `Speaker ${d.deviceId.slice(0, 8)}`,
        kind: 'audiooutput' as const,
      }))

    return { inputs, outputs }
  } catch {
    return { inputs: [], outputs: [] }
  }
}
