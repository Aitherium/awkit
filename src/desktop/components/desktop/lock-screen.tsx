'use client'

/**
 * LockScreen
 * ==========
 *
 * A cinematic lock screen that greets the user before the desktop.
 * Shows after boot sequence, before the desktop canvas.
 *
 * Features:
 *  - Beautiful animated wallpaper with particle field
 *  - Large clock with smooth second ticking
 *  - Date display
 *  - "Slide to unlock" / click anywhere prompt
 *  - Quick notification preview
 *  - User avatar with glow
 *  - Smooth unlock animation (slides up and fades)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion'
import { Brain, ChevronUp, Lock, Unlock, Wifi, Battery, BatteryCharging, Volume2 } from 'lucide-react'

// ============================================================================
// ANIMATED CLOCK
// ============================================================================

function AnimatedClock() {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const hours = time.getHours()
  const minutes = time.getMinutes()
  const isPM = hours >= 12
  const displayHours = hours % 12 || 12

  const formatDay = (d: Date) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December']
    return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`
  }

  return (
    <div className="flex flex-col items-center select-none">
      {/* Time */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.8, ease: 'easeOut' }}
        className="flex items-baseline gap-1"
      >
        <span className="text-[120px] font-extralight text-white tracking-tight leading-none tabular-nums"
          style={{ fontFeatureSettings: '"tnum"' }}>
          {String(displayHours).padStart(2, '0')}
        </span>
        <motion.span
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="text-[100px] font-extralight text-white/60 leading-none mx-1"
        >
          :
        </motion.span>
        <span className="text-[120px] font-extralight text-white tracking-tight leading-none tabular-nums"
          style={{ fontFeatureSettings: '"tnum"' }}>
          {String(minutes).padStart(2, '0')}
        </span>
        <span className="text-2xl font-light text-white/40 ml-2 self-start mt-6">
          {isPM ? 'PM' : 'AM'}
        </span>
      </motion.div>

      {/* Date */}
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.6 }}
        className="text-xl font-light text-white/50 mt-2 tracking-wide"
      >
        {formatDay(time)}
      </motion.p>
    </div>
  )
}

// ============================================================================
// AMBIENT PARTICLES — floating orbs behind the clock
// ============================================================================

function AmbientParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    let animId: number

    const particles: {
      x: number; y: number; vx: number; vy: number;
      r: number; alpha: number; hue: number; phase: number
    }[] = []

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    // Floating orbs
    for (let i = 0; i < 40; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.2 - 0.1,
        r: Math.random() * 3 + 1,
        alpha: Math.random() * 0.3 + 0.05,
        hue: Math.random() > 0.5 ? 270 : 200, // purple or cyan
        phase: Math.random() * Math.PI * 2,
      })
    }

    const draw = (t: number) => {
      animId = requestAnimationFrame(draw)
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      particles.forEach(p => {
        p.x += p.vx
        p.y += p.vy

        // Wrap around
        if (p.x < -10) p.x = canvas.width + 10
        if (p.x > canvas.width + 10) p.x = -10
        if (p.y < -10) p.y = canvas.height + 10
        if (p.y > canvas.height + 10) p.y = -10

        const breathe = Math.sin(t * 0.001 + p.phase) * 0.3 + 0.7
        const alpha = p.alpha * breathe

        // Glow
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 8)
        gradient.addColorStop(0, `hsla(${p.hue}, 80%, 70%, ${alpha})`)
        gradient.addColorStop(0.4, `hsla(${p.hue}, 70%, 50%, ${alpha * 0.3})`)
        gradient.addColorStop(1, `hsla(${p.hue}, 60%, 30%, 0)`)

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r * 8, 0, Math.PI * 2)
        ctx.fillStyle = gradient
        ctx.fill()

        // Core
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${p.hue}, 90%, 85%, ${alpha * 2})`
        ctx.fill()
      })
    }

    animId = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ opacity: 0.6 }}
    />
  )
}

// ============================================================================
// STATUS BAR (top)
// ============================================================================

function LockStatusBar() {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.8, duration: 0.5 }}
      className="absolute top-0 left-0 right-0 h-8 flex items-center justify-between px-6 z-10"
    >
      <div className="flex items-center gap-2 text-[11px] text-white/30 font-medium">
        <Brain className="w-3.5 h-3.5" />
        <span>AitherOS</span>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-white/30">
        <Wifi className="w-3.5 h-3.5" />
        <Volume2 className="w-3.5 h-3.5" />
        <BatteryCharging className="w-3.5 h-3.5" />
        <span className="font-mono tabular-nums">
          {time.getHours() % 12 || 12}:{String(time.getMinutes()).padStart(2, '0')} {time.getHours() >= 12 ? 'PM' : 'AM'}
        </span>
      </div>
    </motion.div>
  )
}

// ============================================================================
// LOCK SCREEN
// ============================================================================

interface LockScreenProps {
  onUnlock: () => void
}

export function LockScreen({ onUnlock }: LockScreenProps) {
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const dragY = useMotionValue(0)
  const opacity = useTransform(dragY, [-200, 0], [0, 1])
  const scale = useTransform(dragY, [-200, 0], [0.95, 1])

  // Show hint after 3 seconds
  useEffect(() => {
    const timer = setTimeout(() => setShowHint(true), 3000)
    return () => clearTimeout(timer)
  }, [])

  const handleUnlock = useCallback(() => {
    if (isUnlocking) return
    setIsUnlocking(true)
    // Short delay for the animation
    setTimeout(onUnlock, 600)
  }, [isUnlocking, onUnlock])

  // Click anywhere to unlock
  const handleClick = useCallback(() => {
    handleUnlock()
  }, [handleUnlock])

  // Any key to unlock
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return
      handleUnlock()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleUnlock])

  return (
    <AnimatePresence>
      {!isUnlocking ? (
        <motion.div
          key="lock-screen"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, y: -60, scale: 0.98 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="fixed inset-0 z-[400] cursor-pointer select-none overflow-hidden"
          onClick={handleClick}
          style={{ opacity, scale }}
        >
          {/* Background */}
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-[#0B2526]/20 to-slate-950" />
          <AmbientParticles />

          {/* Vignette */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(0,0,0,0.6)_100%)]" />

          {/* Status bar */}
          <LockStatusBar />

          {/* Center content */}
          <div className="relative z-10 flex flex-col items-center justify-center h-full gap-8">
            {/* User avatar / Logo */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.6, type: 'spring', stiffness: 200 }}
              className="relative"
            >
              <div className="w-24 h-24 rounded-full bg-[#5EC9CC] text-[#050507] flex items-center justify-center shadow-2xl shadow-[#5EC9CC]/30">
                <Brain className="w-12 h-12 text-white" />
              </div>
              {/* Glow ring */}
              <motion.div
                animate={{
                  boxShadow: [
                    '0 0 20px 4px rgba(94,201,204, 0.2)',
                    '0 0 40px 8px rgba(94,201,204, 0.15)',
                    '0 0 20px 4px rgba(94,201,204, 0.2)',
                  ],
                }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute inset-0 rounded-full"
              />
              {/* Status dot */}
              <div className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-black" />
            </motion.div>

            {/* User name */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.5 }}
              className="text-center"
            >
              <h2 className="text-xl font-semibold text-white">AitherOS</h2>
              <p className="text-sm text-white/30 mt-0.5">The Agentic Operating System</p>
            </motion.div>

            {/* Clock */}
            <AnimatedClock />

            {/* Unlock hint */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: showHint ? 1 : 0 }}
              transition={{ duration: 0.8 }}
              className="flex flex-col items-center gap-2 mt-8"
            >
              <motion.div
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              >
                <ChevronUp className="w-5 h-5 text-white/30" />
              </motion.div>
              <div className="flex items-center gap-2 text-sm text-white/25">
                <Unlock className="w-3.5 h-3.5" />
                <span>Click or press any key to unlock</span>
              </div>
            </motion.div>
          </div>

          {/* Bottom gradient fade */}
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black/40 to-transparent" />
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
