'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Volume2, VolumeX, ChevronDown } from 'lucide-react'
import type { AudioProfile } from './AudioTypes'
import { BUILTIN_AUDIO_PROFILES } from './AudioTypes'

interface AudioControlsProps {
  enabled: boolean
  onToggle: () => void
  volumes: AudioProfile['volumes']
  onVolumeChange: (category: 'master' | 'ambient' | 'sfx' | 'accent', value: number) => void
  profileId: string
  onProfileChange?: (profile: AudioProfile) => void
  profiles?: AudioProfile[]
  tone?: string
}

function VolumeSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider w-14 shrink-0" style={{ color: 'var(--sf-text-muted)' }}>
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={e => onChange(Number(e.target.value) / 100)}
        className="flex-1 h-1 accent-[var(--sf-primary)] cursor-pointer"
        style={{ accentColor: 'var(--sf-primary)' }}
      />
      <span className="text-[10px] w-7 text-right font-mono" style={{ color: 'var(--sf-text-muted)' }}>
        {Math.round(value * 100)}
      </span>
    </div>
  )
}

export default function AudioControls({
  enabled,
  onToggle,
  volumes,
  onVolumeChange,
  profileId,
  onProfileChange,
  profiles = BUILTIN_AUDIO_PROFILES,
  tone = '',
}: AudioControlsProps) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={enabled ? 'Audio settings' : 'Audio off'}
        className={`rounded-lg p-2 transition-colors duration-200 hover:bg-[var(--sf-border)] ${tone}`}
      >
        {enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-64 rounded-xl border p-3 shadow-xl z-50"
          style={{
            backgroundColor: 'var(--sf-surface)',
            borderColor: 'var(--sf-border)',
            color: 'var(--sf-text)',
          }}
        >
          {/* Toggle + Master */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={onToggle}
              className="flex items-center gap-2 text-sm font-medium"
              style={{ color: enabled ? 'var(--sf-primary)' : 'var(--sf-text-muted)' }}
            >
              {enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              {enabled ? 'On' : 'Off'}
            </button>
          </div>

          <VolumeSlider label="Master" value={volumes.master} onChange={v => onVolumeChange('master', v)} />

          {/* Profile switcher */}
          {onProfileChange && profiles.length > 1 && (
            <div className="mt-3">
              <span className="text-[10px] uppercase tracking-wider block mb-1" style={{ color: 'var(--sf-text-muted)' }}>
                Profile
              </span>
              <div className="flex gap-1">
                {profiles.map(p => (
                  <button
                    key={p.id}
                    onClick={() => onProfileChange(p)}
                    className="flex-1 text-[11px] px-2 py-1.5 rounded-lg border transition-colors"
                    style={{
                      borderColor: profileId === p.id ? 'var(--sf-primary)' : 'var(--sf-border)',
                      backgroundColor: profileId === p.id ? 'color-mix(in srgb, var(--sf-primary) 12%, transparent)' : 'transparent',
                      color: profileId === p.id ? 'var(--sf-primary)' : 'var(--sf-text-secondary)',
                    }}
                  >
                    {p.name.split(' ').pop()}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Expandable per-category sliders */}
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 mt-3 text-[10px] uppercase tracking-wider w-full"
            style={{ color: 'var(--sf-text-muted)' }}
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            Detail
          </button>

          {expanded && (
            <div className="mt-2 space-y-1.5">
              <VolumeSlider label="Ambient" value={volumes.ambient} onChange={v => onVolumeChange('ambient', v)} />
              <VolumeSlider label="SFX" value={volumes.sfx} onChange={v => onVolumeChange('sfx', v)} />
              <VolumeSlider label="Accent" value={volumes.accent} onChange={v => onVolumeChange('accent', v)} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
