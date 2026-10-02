/**
 * VoiceButton Component
 * =====================
 * 
 * Animated microphone button for voice input with visual feedback.
 * Shows audio level visualization, recording state, and connection status.
 * 
 * Features:
 * - Pulsing animation during recording
 * - Audio level visualization (ring or waveform)
 * - Push-to-talk (hold) and toggle modes
 * - Connection state indicator
 * - Customizable size and colors
 */

'use client'

import React, { useState, useCallback, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '../../lib/utils'
import { 
  Mic, 
  MicOff, 
  Loader2,
  AlertCircle,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { ConnectionState, VoiceMode } from '../../lib/personaplex-client'

// ============================================================================
// TYPES
// ============================================================================

export interface VoiceButtonProps {
  // State
  isRecording: boolean
  audioLevel: number  // 0.0 - 1.0
  connectionState?: ConnectionState
  mode?: VoiceMode
  disabled?: boolean
  
  // Callbacks
  onStartRecording?: () => void
  onStopRecording?: () => void
  onClick?: () => void
  
  // Styling
  size?: 'sm' | 'md' | 'lg' | 'xl'
  variant?: 'default' | 'ghost' | 'outline'
  className?: string
  showConnectionStatus?: boolean
  pulseColor?: string
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SIZE_MAP = {
  sm: { button: 32, icon: 14, ring: 40 },
  md: { button: 40, icon: 18, ring: 52 },
  lg: { button: 48, icon: 22, ring: 64 },
  xl: { button: 64, icon: 28, ring: 80 },
}

// ============================================================================
// COMPONENT
// ============================================================================

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
  pulseColor = 'rgb(239, 68, 68)',  // red-500
}: VoiceButtonProps) {
  const [isHolding, setIsHolding] = useState(false)
  const holdTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const { button: buttonSize, icon: iconSize, ring: ringSize } = SIZE_MAP[size]
  
  // ===========================================================================
  // PTT (PUSH-TO-TALK) HANDLING
  // ===========================================================================
  
  const handleMouseDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (disabled || mode !== 'ptt') return
    
    // Prevent default to disable text selection and context menu on mobile
    if (e.type === 'touchstart') {
      e.preventDefault();
    }
    
    setIsHolding(true)
    onStartRecording?.()
  }, [disabled, mode, onStartRecording])
  
  const handleMouseUp = useCallback((e?: React.MouseEvent | React.TouchEvent) => {
    if (mode !== 'ptt') return
    
    if (e?.type === 'touchend') {
      // Don't prevent default on touchend as it might block other events if needed
      // e.preventDefault(); 
    }
    
    if (isHolding) {
      setIsHolding(false)
      onStopRecording?.()
    }
  }, [mode, isHolding, onStopRecording])

  // Handle pointer leave (if user drags outside button while holding)
  const handleMouseLeave = useCallback(() => {
    if (mode === 'ptt' && isHolding) {
      setIsHolding(false)
      onStopRecording?.()
    }
  }, [mode, isHolding, onStopRecording])
  
  const handleClick = useCallback(() => {
    if (disabled) return
    
    if (mode === 'ptt') {
      // PTT uses mouse down/up, not click
      return
    }
    
    // Toggle mode for VAD and continuous
    onClick?.()
    
    if (isRecording) {
      onStopRecording?.()
    } else {
      onStartRecording?.()
    }
  }, [disabled, mode, isRecording, onClick, onStartRecording, onStopRecording])
  
  // ===========================================================================
  // RENDER HELPERS
  // ===========================================================================
  
  const isActive = isRecording || isHolding
  const isConnected = connectionState === 'connected'
  const isConnecting = connectionState === 'connecting' || connectionState === 'reconnecting'
  const hasError = connectionState === 'error'
  
  const getIcon = () => {
    if (hasError) return <AlertCircle className="text-destructive" style={{ width: iconSize, height: iconSize }} />
    if (isConnecting) return <Loader2 className="animate-spin" style={{ width: iconSize, height: iconSize }} />
    if (disabled) return <MicOff className="text-muted-foreground" style={{ width: iconSize, height: iconSize }} />
    return <Mic style={{ width: iconSize, height: iconSize }} />
  }
  
  const getButtonClasses = () => {
    const base = 'relative flex items-center justify-center rounded-full transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
    
    const variants = {
      default: cn(
        'bg-primary text-primary-foreground hover:bg-primary/90',
        isActive && 'bg-red-500 hover:bg-red-600',
        disabled && 'opacity-50 cursor-not-allowed',
        hasError && 'bg-destructive hover:bg-destructive/90'
      ),
      ghost: cn(
        'hover:bg-accent hover:text-accent-foreground',
        isActive && 'bg-red-500/10 text-red-500',
        disabled && 'opacity-50 cursor-not-allowed'
      ),
      outline: cn(
        'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        isActive && 'border-red-500 bg-red-500/10 text-red-500',
        disabled && 'opacity-50 cursor-not-allowed'
      ),
    }
    
    return cn(base, variants[variant], className)
  }
  
  // ===========================================================================
  // RENDER
  // ===========================================================================
  
  return (
    <div className="relative inline-flex items-center justify-center">
      {/* Audio level ring */}
      <AnimatePresence>
        {isActive && (
          <>
            {/* Outer pulse ring */}
            <motion.div
              initial={{ scale: 1, opacity: 0.6 }}
              animate={{ 
                scale: [1, 1.2 + audioLevel * 0.3, 1],
                opacity: [0.6, 0.2, 0.6],
              }}
              exit={{ scale: 1, opacity: 0 }}
              transition={{
                duration: 1,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
              className="absolute rounded-full"
              style={{
                width: ringSize,
                height: ringSize,
                backgroundColor: pulseColor,
                opacity: 0.3,
              }}
            />
            
            {/* Audio level ring */}
            <motion.div
              initial={{ scale: 1 }}
              animate={{ 
                scale: 1 + audioLevel * 0.2,
              }}
              transition={{ duration: 0.05 }}
              className="absolute rounded-full border-2"
              style={{
                width: buttonSize + 8,
                height: buttonSize + 8,
                borderColor: pulseColor,
                opacity: 0.5 + audioLevel * 0.5,
              }}
            />
          </>
        )}
      </AnimatePresence>
      
      {/* Main button */}
      <motion.button
        type="button"
        className={getButtonClasses()}
        style={{ width: buttonSize, height: buttonSize }}
        disabled={disabled || hasError}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleMouseDown}
        onTouchEnd={handleMouseUp}
        onTouchCancel={handleMouseUp}
        title={mode === 'ptt' ? 'Hold to talk' : 'Click to toggle recording'}
        whileTap={{ scale: mode === 'ptt' ? 0.95 : 1 }}
        aria-label={isActive ? 'Stop recording' : 'Start recording'}
        aria-pressed={isActive}
      >
        <motion.div
          animate={isActive ? { scale: [1, 1.1, 1] } : { scale: 1 }}
          transition={{ 
            duration: 0.5, 
            repeat: isActive ? Infinity : 0,
            ease: 'easeInOut'
          }}
        >
          {getIcon()}
        </motion.div>
      </motion.button>
      
      {/* Connection status indicator */}
      {showConnectionStatus && (
        <div 
          className={cn(
            'absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-background flex items-center justify-center',
            isConnected && 'bg-green-500',
            isConnecting && 'bg-yellow-500',
            !isConnected && !isConnecting && 'bg-red-500'
          )}
        >
          {isConnecting && (
            <Loader2 className="w-2 h-2 animate-spin text-background" />
          )}
        </div>
      )}
      
      {/* Mode indicator (optional) */}
      {mode === 'ptt' && !isActive && (
        <span className="absolute -bottom-5 text-[10px] text-muted-foreground whitespace-nowrap">
          Hold to talk
        </span>
      )}
    </div>
  )
}

// ============================================================================
// MINI VOICE BUTTON (for inline use)
// ============================================================================

export function MiniVoiceButton({
  isRecording,
  audioLevel,
  disabled = false,
  onClick,
  className,
}: {
  isRecording: boolean
  audioLevel: number
  disabled?: boolean
  onClick?: () => void
  className?: string
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'relative p-2 rounded-full transition-colors',
        'hover:bg-accent',
        isRecording && 'bg-red-500/10 text-red-500',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
      whileTap={{ scale: 0.95 }}
      aria-label={isRecording ? 'Stop recording' : 'Start recording'}
    >
      {/* Level indicator */}
      {isRecording && (
        <motion.div
          className="absolute inset-0 rounded-full bg-red-500"
          initial={{ opacity: 0.2 }}
          animate={{ opacity: 0.2 + audioLevel * 0.3 }}
        />
      )}
      
      <Mic className={cn('w-4 h-4 relative z-10', isRecording && 'text-red-500')} />
    </motion.button>
  )
}

export default VoiceButton
