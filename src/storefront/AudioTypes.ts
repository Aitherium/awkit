/**
 * Audio System Type Definitions
 *
 * Shared types for the storefront audio system — synthesis, real file playback,
 * sound profiles, and SFX triggers.
 */

export type SynthProfile = 'digital' | 'nature' | 'none'
export type AudioCategory = 'sfx' | 'ambient' | 'accent' | 'voice'
export type SfxTrigger = 'click' | 'hover' | 'transition' | 'alert' | 'success' | 'error'

export interface AudioAsset {
  id: string
  name: string
  src: string
  format: 'mp3' | 'ogg' | 'wav'
  duration: number
  category: AudioCategory
  tags?: string[]
}

export interface AudioProfile {
  id: string
  name: string
  description: string
  synthesis: SynthProfile
  ambient?: { assetId: string; volume: number; fadeMs: number; loop: boolean }
  sfx: Partial<Record<SfxTrigger, string>>
  volumes: { master: number; ambient: number; sfx: number; accent: number }
}

// Built-in profiles matching THEME_PRESETS
// The wildroot profile was REMOVED 2026-09-05 alongside its theme preset:
// a customer's name in a package strangers install. AWK003 refuses to
// publish over it, and nothing consumed it -- the profile was reachable
// only from the preset that named the same customer.
export const BUILTIN_AUDIO_PROFILES: AudioProfile[] = [
  {
    id: 'aitherium-digital',
    name: 'Aitherium Digital',
    description: 'Clean digital ambience with synthesized accents',
    synthesis: 'digital',
    ambient: { assetId: 'tour-ambient', volume: 0.3, fadeMs: 1800, loop: true },
    sfx: {
      click: 'click-soft',
      hover: 'whoosh',
      transition: 'whoosh-long',
      alert: 'alert-ding',
      success: 'bright-bell',
      error: 'tension-ring',
    },
    volumes: { master: 0.7, ambient: 0.3, sfx: 0.5, accent: 0.2 },
  },
]

export function getAudioProfile(id: string): AudioProfile | undefined {
  return BUILTIN_AUDIO_PROFILES.find(p => p.id === id)
}
