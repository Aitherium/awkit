/**
 * VoiceButton -- Advanced animated mic button.
 * Ported from Veil's voice-button.tsx.
 *
 * Uses framer-motion + lucide-react with runtime checks for graceful degradation.
 * Opt-in only -- tenants import explicitly from awkit/voice.
 */

import React, { useState, useCallback, useRef } from 'react'
import type { VoiceMode } from './voice-types'

// Inline cn() utility
function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

// Runtime imports for optional deps
let motion: any = null
let AnimatePresence: any = null
let MicIcon: any = null
let MicOffIcon: any = null
let Loader2Icon: any = null
let AlertCircleIcon: any = null

try {
  const fm = require('framer-motion')
  motion = fm.motion
  AnimatePresence = fm.AnimatePresence
} catch { /* framer-motion not available */ }

try {
  const lucide = require('lucide-react')
  MicIcon = lucide.Mic
  MicOffIcon = lucide.MicOff
  Loader2Icon = lucide.Loader2
  AlertCircleIcon = lucide.AlertCircle
} catch { /* lucide-react not available */ }

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting'

export interface VoiceButtonProps {
  isRecording: boolean
  audioLevel: number
  connectionState?: ConnectionState
  mode?: VoiceMode
  disabled?: boolean
  onStartRecording?: () => void
  onStopRecording?: () => void
  onClick?: () => void
  size?: 'sm' | 'md' | 'lg' | 'xl'
  variant?: 'default' | 'ghost' | 'outline'
  className?: string
  showConnectionStatus?: boolean
  pulseColor?: string
}

const SIZE_MAP = {
  sm: { button: 32, icon: 14, ring: 40 },
  md: { button: 40, icon: 18, ring: 52 },
  lg: { button: 48, icon: 22, ring: 64 },
  xl: { button: 64, icon: 28, ring: 80 },
}

// Fallback SVG icons when lucide-react is not available
function FallbackMic({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="1" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="8" y1="21" x2="16" y2="21" />
    </svg>
  )
}

function FallbackMicOff({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  )
}

export function VoiceButton({
  isRecording,
  audioLevel,
  connectionState = 'connected',
  mode = 'ptt',
  disabled = false,
  onStartRecording,
  onStopRecording,
  onClick,
  size = 'md',
  variant = 'default',
  className,
  showConnectionStatus = false,
  pulseColor = 'rgb(239, 68, 68)',
}: VoiceButtonProps) {
  const [isHolding, setIsHolding] = useState(false)
  const { button: buttonSize, icon: iconSize, ring: ringSize } = SIZE_MAP[size]

  const handleMouseDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (disabled || mode !== 'ptt') return
    if (e.type === 'touchstart') e.preventDefault()
    setIsHolding(true)
    onStartRecording?.()
  }, [disabled, mode, onStartRecording])

  const handleMouseUp = useCallback(() => {
    if (mode !== 'ptt') return
    if (isHolding) {
      setIsHolding(false)
      onStopRecording?.()
    }
  }, [mode, isHolding, onStopRecording])

  const handleMouseLeave = useCallback(() => {
    if (mode === 'ptt' && isHolding) {
      setIsHolding(false)
      onStopRecording?.()
    }
  }, [mode, isHolding, onStopRecording])

  const handleClick = useCallback(() => {
    if (disabled) return
    if (mode === 'ptt') return
    onClick?.()
    if (isRecording) onStopRecording?.()
    else onStartRecording?.()
  }, [disabled, mode, isRecording, onClick, onStartRecording, onStopRecording])

  const isActive = isRecording || isHolding
  const isConnected = connectionState === 'connected'
  const isConnecting = connectionState === 'connecting' || connectionState === 'reconnecting'
  const hasError = connectionState === 'error'

  const getIcon = () => {
    const iconStyle = { width: iconSize, height: iconSize }
    if (hasError) {
      return AlertCircleIcon
        ? <AlertCircleIcon style={iconStyle} />
        : <span style={{ fontSize: iconSize * 0.6 }}>!</span>
    }
    if (isConnecting) {
      return Loader2Icon
        ? <Loader2Icon style={{ ...iconStyle, animation: 'spin 1s linear infinite' }} />
        : <span style={{ fontSize: iconSize * 0.6, animation: 'spin 1s linear infinite', display: 'inline-block' }}>...</span>
    }
    if (disabled) {
      return MicOffIcon
        ? <MicOffIcon style={iconStyle} />
        : <FallbackMicOff size={iconSize} />
    }
    return MicIcon
      ? <MicIcon style={iconStyle} />
      : <FallbackMic size={iconSize} />
  }

  const baseClasses = 'pk-voice-btn'
  const variantClass = `pk-voice-btn--${variant}`
  const activeClass = isActive ? 'pk-voice-btn--active' : ''
  const disabledClass = disabled ? 'pk-voice-btn--disabled' : ''

  const ButtonEl = motion?.button || 'button'
  const motionProps = motion ? {
    whileTap: mode === 'ptt' ? { scale: 0.95 } : undefined,
  } : {}

  return (
    <>
      <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Pulse ring when active */}
        {isActive && (
          <span style={{
            position: 'absolute',
            width: ringSize,
            height: ringSize,
            borderRadius: '50%',
            backgroundColor: pulseColor,
            opacity: 0.2,
            animation: 'pk-voice-pulse 1s ease-in-out infinite',
            transform: `scale(${1 + audioLevel * 0.3})`,
          }} />
        )}

        {/* Audio level ring */}
        {isActive && (
          <span style={{
            position: 'absolute',
            width: buttonSize + 8,
            height: buttonSize + 8,
            borderRadius: '50%',
            border: `2px solid ${pulseColor}`,
            opacity: 0.5 + audioLevel * 0.5,
            transform: `scale(${1 + audioLevel * 0.2})`,
            transition: 'transform 50ms',
          }} />
        )}

        <ButtonEl
          type="button"
          className={cn(baseClasses, variantClass, activeClass, disabledClass, className)}
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: buttonSize,
            height: buttonSize,
            borderRadius: '50%',
            border: variant === 'outline' ? '1px solid var(--glass-border, #333)' : 'none',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            background: isActive ? 'rgba(239, 68, 68, 0.15)'
              : variant === 'ghost' ? 'transparent'
              : 'var(--accent-primary, #c4956a)',
            color: isActive ? '#ef4444'
              : variant === 'default' ? 'var(--bg-deep, #0a0a1a)'
              : 'var(--text-secondary, #a0a0b0)',
            transition: 'background 0.2s, color 0.2s',
          }}
          disabled={disabled || hasError}
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onTouchStart={handleMouseDown}
          onTouchEnd={handleMouseUp}
          onTouchCancel={handleMouseUp}
          title={mode === 'ptt' ? 'Hold to talk' : 'Click to toggle recording'}
          aria-label={isActive ? 'Stop recording' : 'Start recording'}
          aria-pressed={isActive}
          {...motionProps}
        >
          {getIcon()}
        </ButtonEl>

        {/* Connection status dot */}
        {showConnectionStatus && (
          <span style={{
            position: 'absolute',
            bottom: -1,
            right: -1,
            width: 10,
            height: 10,
            borderRadius: '50%',
            border: '2px solid var(--bg-base, #0f0f23)',
            background: isConnected ? '#22c55e' : isConnecting ? '#eab308' : '#ef4444',
          }} />
        )}

        {mode === 'ptt' && !isActive && (
          <span style={{
            position: 'absolute',
            bottom: -16,
            fontSize: '0.6rem',
            color: 'var(--text-muted, #666)',
            whiteSpace: 'nowrap',
          }}>
            Hold to talk
          </span>
        )}
      </div>

      <style>{`
        @keyframes pk-voice-pulse {
          0%, 100% { transform: scale(1); opacity: 0.2; }
          50% { transform: scale(1.2); opacity: 0.08; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  )
}

export default VoiceButton
