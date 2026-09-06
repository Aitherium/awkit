'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAmbientAudio } from './useAmbientAudio'
import type { AudioProfile, SfxTrigger } from './AudioTypes'

interface AudioSystemOptions {
  profile: AudioProfile
  assetBaseUrl?: string
  storageKey?: string
}

interface AudioSystemReturn {
  enabled: boolean
  toggle: () => void
  setVolume: (category: 'master' | 'ambient' | 'sfx' | 'accent', value: number) => void
  playSfx: (trigger: SfxTrigger) => void
  volumes: AudioProfile['volumes']
  profileId: string
  setProfile: (profile: AudioProfile) => void
  isLoading: boolean
}

const STORAGE_VERSION = 1

function loadPersistedState(key: string) {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed.v !== STORAGE_VERSION) return null
    return parsed
  } catch { return null }
}

function persistState(key: string, enabled: boolean, volumes: AudioProfile['volumes'], profileId: string) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify({ v: STORAGE_VERSION, enabled, volumes, profileId }))
  } catch { /* quota exceeded — ignore */ }
}

export function useAudioSystem({ profile, assetBaseUrl = '/audio', storageKey = 'sf-audio' }: AudioSystemOptions): AudioSystemReturn {
  const persisted = useRef(loadPersistedState(storageKey))
  const [currentProfile, setCurrentProfile] = useState(profile)
  const [volumes, setVolumes] = useState<AudioProfile['volumes']>(
    persisted.current?.volumes ?? profile.volumes
  )
  const [isLoading, setIsLoading] = useState(false)

  // Synthesis fallback via existing hook
  const synthesis = useAmbientAudio({
    profile: currentProfile.synthesis,
    initialVolume: volumes.ambient * volumes.master,
  })

  // Ambient audio element for real file playback
  const ambientRef = useRef<HTMLAudioElement | null>(null)
  const ambientFailed = useRef(false)

  // SFX buffer cache
  const sfxCtxRef = useRef<AudioContext | null>(null)
  const sfxBuffers = useRef<Map<string, AudioBuffer>>(new Map())
  const sfxGainRef = useRef<GainNode | null>(null)

  // Resolve asset URL from ID
  const resolveUrl = useCallback((assetId: string) => {
    if (assetId.startsWith('http') || assetId.startsWith('/')) return assetId
    // Check sfx/ subdirectory first, then root
    return `${assetBaseUrl}/sfx/${assetId}.mp3`
  }, [assetBaseUrl])

  const resolveAmbientUrl = useCallback((assetId: string) => {
    if (assetId.startsWith('http') || assetId.startsWith('/')) return assetId
    return `${assetBaseUrl}/${assetId}.mp3`
  }, [assetBaseUrl])

  // Load SFX buffers
  useEffect(() => {
    const sfxEntries = Object.entries(currentProfile.sfx).filter(([, v]) => v)
    if (sfxEntries.length === 0) return

    let cancelled = false
    setIsLoading(true)

    const ctx = sfxCtxRef.current ?? new AudioContext()
    sfxCtxRef.current = ctx

    if (!sfxGainRef.current) {
      const gain = ctx.createGain()
      gain.connect(ctx.destination)
      sfxGainRef.current = gain
    }

    async function loadAll() {
      const uniqueIds = [...new Set(sfxEntries.map(([, v]) => v!))]
      await Promise.allSettled(
        uniqueIds.map(async (assetId) => {
          if (sfxBuffers.current.has(assetId)) return
          try {
            const url = resolveUrl(assetId)
            const resp = await fetch(url)
            if (!resp.ok) return
            const arrayBuf = await resp.arrayBuffer()
            const audioBuf = await ctx.decodeAudioData(arrayBuf)
            if (!cancelled) sfxBuffers.current.set(assetId, audioBuf)
          } catch { /* SFX load failure is non-fatal */ }
        })
      )
      if (!cancelled) setIsLoading(false)
    }

    loadAll()
    return () => { cancelled = true }
  }, [currentProfile.sfx, resolveUrl])

  // Ambient track management
  useEffect(() => {
    if (!synthesis.enabled) {
      // Stop ambient file when audio is off
      if (ambientRef.current) {
        ambientRef.current.pause()
        ambientRef.current.currentTime = 0
      }
      return
    }

    const amb = currentProfile.ambient
    if (!amb?.assetId) {
      ambientFailed.current = true
      return
    }

    const url = resolveAmbientUrl(amb.assetId)
    const audio = new Audio(url)
    audio.loop = amb.loop
    audio.volume = 0
    ambientRef.current = audio

    const fadeIn = () => {
      const target = amb.volume * volumes.master * volumes.ambient
      const steps = Math.max(1, Math.round(amb.fadeMs / 50))
      let step = 0
      const interval = setInterval(() => {
        step++
        audio.volume = Math.min(1, target * (step / steps))
        if (step >= steps) clearInterval(interval)
      }, 50)
    }

    audio.addEventListener('canplay', () => {
      audio.play().then(fadeIn).catch(() => {
        ambientFailed.current = true
      })
    }, { once: true })

    audio.addEventListener('error', () => {
      ambientFailed.current = true
    }, { once: true })

    return () => {
      audio.pause()
      audio.src = ''
      ambientRef.current = null
    }
  }, [synthesis.enabled, currentProfile.ambient, resolveAmbientUrl, volumes.master, volumes.ambient])

  // Sync ambient volume
  useEffect(() => {
    if (ambientRef.current && currentProfile.ambient) {
      ambientRef.current.volume = Math.min(1,
        currentProfile.ambient.volume * volumes.master * volumes.ambient
      )
    }
  }, [volumes.master, volumes.ambient, currentProfile.ambient])

  // Sync SFX gain
  useEffect(() => {
    if (sfxGainRef.current) {
      sfxGainRef.current.gain.value = volumes.master * volumes.sfx
    }
  }, [volumes.master, volumes.sfx])

  // Persistence
  useEffect(() => {
    persistState(storageKey, synthesis.enabled, volumes, currentProfile.id)
  }, [synthesis.enabled, volumes, currentProfile.id, storageKey])

  const playSfx = useCallback((trigger: SfxTrigger) => {
    if (!synthesis.enabled) return
    const assetId = currentProfile.sfx[trigger]
    if (!assetId) return

    const ctx = sfxCtxRef.current
    const gain = sfxGainRef.current
    const buffer = sfxBuffers.current.get(assetId)
    if (!ctx || !gain || !buffer) return

    if (ctx.state === 'suspended') ctx.resume()

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(gain)
    source.start()
  }, [synthesis.enabled, currentProfile.sfx])

  const setVolume = useCallback((category: 'master' | 'ambient' | 'sfx' | 'accent', value: number) => {
    setVolumes(prev => ({ ...prev, [category]: Math.max(0, Math.min(1, value)) }))
  }, [])

  const setProfile = useCallback((p: AudioProfile) => {
    setCurrentProfile(p)
    setVolumes(p.volumes)
  }, [])

  return {
    enabled: synthesis.enabled,
    toggle: synthesis.toggle,
    setVolume,
    playSfx,
    volumes,
    profileId: currentProfile.id,
    setProfile,
    isLoading,
  }
}
