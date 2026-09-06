/**
 * VoiceMicButton -- Minimal mic button with zero external deps.
 * Inline SVG mic icon, CSS keyframe pulse, portal-kit CSS vars.
 */

import React from 'react'

export interface VoiceMicButtonProps {
  isListening: boolean
  audioLevel: number
  disabled?: boolean
  onClick: () => void
}

export function VoiceMicButton({ isListening, audioLevel, disabled, onClick }: VoiceMicButtonProps) {
  const scale = isListening ? 1 + audioLevel * 0.15 : 1

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={isListening ? 'Stop recording' : 'Start recording'}
        aria-pressed={isListening}
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          background: isListening ? 'rgba(239, 68, 68, 0.15)' : 'var(--bg-elevated, #1a1a2e)',
          color: isListening ? '#ef4444' : 'var(--text-secondary, #a0a0b0)',
          transition: 'background 0.15s, color 0.15s',
          transform: `scale(${scale})`,
          flexShrink: 0,
        }}
      >
        {/* Pulse ring when recording */}
        {isListening && (
          <span
            style={{
              position: 'absolute',
              inset: -3,
              borderRadius: '50%',
              border: '2px solid #ef4444',
              opacity: 0.4,
              animation: 'pk-mic-pulse 1.2s ease-in-out infinite',
            }}
          />
        )}
        {/* Mic SVG */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="1" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0" />
          <line x1="12" y1="17" x2="12" y2="21" />
          <line x1="8" y1="21" x2="16" y2="21" />
        </svg>
      </button>
      <style>{`
        @keyframes pk-mic-pulse {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50% { transform: scale(1.15); opacity: 0.15; }
        }
      `}</style>
    </>
  )
}
