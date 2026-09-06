'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

type SoundProfile = 'digital' | 'nature' | 'none'

interface AmbientAudioOptions {
  profile?: SoundProfile
  initialVolume?: number
}

function createNoiseBuffer(context: AudioContext) {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate)
  const channel = buffer.getChannelData(0)
  let lastOut = 0

  for (let i = 0; i < channel.length; i++) {
    const white = Math.random() * 2 - 1
    lastOut = (lastOut + 0.02 * white) / 1.02
    channel[i] = lastOut * 2.8
  }
  return buffer
}

function playAccent(context: AudioContext, masterGain: GainNode, profile: SoundProfile) {
  if (profile === 'none') return

  const osc = context.createOscillator()
  const gain = context.createGain()
  const now = context.currentTime
  const duration = 0.15 + Math.random() * 0.15

  if (profile === 'digital') {
    osc.type = 'sine'
    const freq = 400 + Math.random() * 800
    osc.frequency.setValueAtTime(freq, now)
    osc.frequency.exponentialRampToValueAtTime(freq * (0.8 + Math.random() * 0.4), now + duration)
  } else {
    // nature — bird-like chirps
    osc.type = 'sine'
    const startFreq = 1200 + Math.random() * 600
    osc.frequency.setValueAtTime(startFreq, now)
    osc.frequency.exponentialRampToValueAtTime(startFreq + 350 + Math.random() * 500, now + duration)
  }

  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.02, now + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)

  osc.connect(gain)
  gain.connect(masterGain)
  osc.start(now)
  osc.stop(now + duration)
}

export function useAmbientAudio(options: AmbientAudioOptions = {}) {
  const { profile = 'digital', initialVolume = 0.22 } = options
  const [enabled, setEnabled] = useState(false)
  const [volume, setVolume] = useState(initialVolume)

  const ctxRef = useRef<AudioContext | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const srcRef = useRef<AudioBufferSourceNode | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }, [])

  const startLoop = useCallback(() => {
    const ctx = ctxRef.current
    const gain = gainRef.current
    if (!ctx || !gain || !enabled || profile === 'none') return

    const delay = 3000 + Math.random() * 6000
    timerRef.current = setTimeout(() => {
      playAccent(ctx, gain, profile)
      startLoop()
    }, delay)
  }, [enabled, profile])

  const start = useCallback(async () => {
    if (typeof window === 'undefined') return
    const ctx = ctxRef.current ?? new window.AudioContext()
    ctxRef.current = ctx
    if (ctx.state === 'suspended') await ctx.resume()

    if (!gainRef.current) {
      const mg = ctx.createGain()
      mg.gain.value = 0.0001
      mg.connect(ctx.destination)
      gainRef.current = mg

      const src = ctx.createBufferSource()
      src.buffer = createNoiseBuffer(ctx)
      src.loop = true

      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = profile === 'digital' ? 500 : 700

      const bed = ctx.createGain()
      bed.gain.value = 0.18

      src.connect(filter)
      filter.connect(bed)
      bed.connect(mg)
      src.start()
      srcRef.current = src
    }

    gainRef.current.gain.cancelScheduledValues(ctx.currentTime)
    gainRef.current.gain.setValueAtTime(gainRef.current.gain.value, ctx.currentTime)
    gainRef.current.gain.linearRampToValueAtTime(volume, ctx.currentTime + 1.8)

    clearTimer()
    startLoop()
  }, [clearTimer, startLoop, volume, profile])

  const stop = useCallback(() => {
    const ctx = ctxRef.current
    const gain = gainRef.current
    if (!ctx || !gain) return
    clearTimer()
    gain.gain.cancelScheduledValues(ctx.currentTime)
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 1.2)
  }, [clearTimer])

  useEffect(() => {
    if (enabled) { start().catch(() => setEnabled(false)) } else { stop() }
  }, [enabled, start, stop])

  useEffect(() => {
    const ctx = ctxRef.current
    const gain = gainRef.current
    if (!ctx || !gain || !enabled) return
    gain.gain.cancelScheduledValues(ctx.currentTime)
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.8)
  }, [enabled, volume])

  useEffect(() => {
    return () => {
      clearTimer()
      srcRef.current?.stop()
      ctxRef.current?.close().catch(() => {})
    }
  }, [clearTimer])

  return { enabled, setEnabled, volume, setVolume, toggle: () => setEnabled(v => !v) }
}
