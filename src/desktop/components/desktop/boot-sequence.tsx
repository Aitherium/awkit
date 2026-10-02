'use client'

/* ═══════════════════════════════════════════════════════════════════
   BOOT SEQUENCE (DESKTOP-CORE) — the machine recognising itself.

   This is the desktop shell's boot moment. Unlike the apex boot
   (aitherium.com) or the web desktop boot (Veil), desktop-core is
   a standalone package without access to hardware-probes, so this
   screen simply signals readiness without fabricating capability
   claims.

   REWRITTEN 2026-08-05. Removed:
     - Service checklists and fake health checks
     - Fake version strings and "scanning hardware" theatre
     - Scanlines and gradient backgrounds mimicking old BIOS
     - Box-drawing UI chrome
     - ALL SOUND

   What survives: a brief, skippable moment in Aitherium colours.
   ═══════════════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Brain } from 'lucide-react'

type BootPhase = 'loading' | 'ready'

interface BootSequenceProps {
  onComplete: () => void
  skipEnabled?: boolean
}

export function BootSequence({ onComplete, skipEnabled = true }: BootSequenceProps) {
  const reduce = useReducedMotion()
  const [phase, setPhase] = useState<BootPhase>('loading')
  const [leaving, setLeaving] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const doneRef = useRef(false)

  const senseMs = (reduce ? 0.4 : 1) * 1000
  const holdMs = (reduce ? 0.4 : 1) * 600

  /** Idempotent: ESC, Enter, click and auto-advance can all race to finish. */
  const finish = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    timers.current.forEach(clearTimeout)
    setLeaving(true)
    onComplete()
  }, [onComplete])

  // Phase transition: loading → ready
  useEffect(() => {
    const t = setTimeout(() => setPhase('ready'), senseMs)
    timers.current.push(t)
    return () => clearTimeout(t)
  }, [senseMs])

  // Auto-advance after hold time in ready phase
  useEffect(() => {
    if (phase !== 'ready') return
    const t = setTimeout(finish, holdMs)
    timers.current.push(t)
    return () => clearTimeout(t)
  }, [phase, holdMs, finish])

  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  // ESC cancels; Enter/Space/click advances when ready
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        timers.current.forEach(clearTimeout)
        window.location.href = '/login'
        return
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        if (phase === 'ready') finish()
      }
    }
    const onClick = () => { if (phase === 'ready') finish() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('click', onClick)
    }
  }, [phase, finish])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: leaving ? 0 : 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0.1 : 0.4 }}
      className="fixed inset-0 z-[500] flex items-center justify-center bg-[#07070b]"
    >
      <div className="relative z-10 flex w-full max-w-lg flex-col items-center px-6 text-center">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, scale: reduce ? 1 : 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: reduce ? 0.1 : 0.5 }}
          className="mb-12"
        >
          <div className="relative inline-flex">
            <div className="flex items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500/20 to-[#5EC9CC]/20 p-4">
              <Brain className="h-10 w-10 text-cyan-400/80" />
            </div>
            {/* Subtle pulse ring */}
            <motion.div
              animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0, 0.3] }}
              transition={{ duration: 2.5, repeat: Infinity }}
              className="absolute inset-0 rounded-2xl border border-cyan-400/30"
            />
          </div>
        </motion.div>

        {/* Headline */}
        <div className="min-h-[3rem] w-full">
          <AnimatePresence mode="wait">
            <motion.p
              key={phase === 'ready' ? 'ready' : 'loading'}
              initial={{ opacity: 0, y: reduce ? 0 : 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduce ? 0 : -4 }}
              transition={{ duration: reduce ? 0.1 : 0.3 }}
              className="text-xl font-semibold leading-snug tracking-tight text-white/90"
            >
              {phase === 'ready' ? 'AitherOS Desktop' : 'Initializing…'}
            </motion.p>
          </AnimatePresence>
        </div>

        {/* Progress hairline */}
        <div className="mt-8 h-px w-32 overflow-hidden rounded-full bg-white/10">
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: phase === 'ready' ? 1 : 0.4 }}
            transition={{ duration: reduce ? 0.1 : senseMs / 1000, ease: 'easeOut' }}
            style={{ originX: 0 }}
            className="h-full w-full bg-gradient-to-r from-cyan-400/60 to-[#5EC9CC]/60"
          />
        </div>

        {/* Prompt to continue (only in ready phase) */}
        <AnimatePresence>
          {phase === 'ready' && skipEnabled && (
            <motion.button
              key="continue"
              initial={{ opacity: 0, y: reduce ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0.1 : 0.3, delay: reduce ? 0 : 0.1 }}
              onClick={finish}
              className="mt-10 text-xs text-white/40 transition-colors hover:text-white/60"
            >
              Press any key or click to continue
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Click handler for ready state — keyboard handled in useEffect */}
      {skipEnabled && phase === 'ready' && (
        <div
          className="absolute inset-0 z-20 cursor-pointer"
          onClick={finish}
          tabIndex={0}
          style={{ outline: 'none' }}
          role="button"
          aria-label="Continue to desktop"
        />
      )}
    </motion.div>
  )
}
