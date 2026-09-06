'use client'

import React, { useState, useRef, useCallback } from 'react'
import { Play, Pause, Search, Upload, Music } from 'lucide-react'
import type { AudioAsset, AudioCategory } from './AudioTypes'

interface SoundLibraryProps {
  assets: AudioAsset[]
  onSelect?: (asset: AudioAsset) => void
  onUpload?: (file: File) => void
  selectMode?: boolean
  selectedId?: string
}

const CATEGORY_TABS: { value: AudioCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'sfx', label: 'SFX' },
  { value: 'ambient', label: 'Ambient' },
  { value: 'accent', label: 'Accent' },
  { value: 'voice', label: 'Voice' },
]

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function AssetCard({
  asset,
  selected,
  onSelect,
  selectMode,
}: {
  asset: AudioAsset
  selected: boolean
  onSelect?: (asset: AudioAsset) => void
  selectMode?: boolean
}) {
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!audioRef.current) {
      audioRef.current = new Audio(asset.src)
      audioRef.current.addEventListener('ended', () => setPlaying(false))
    }
    if (playing) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      setPlaying(false)
    } else {
      audioRef.current.play().then(() => setPlaying(true)).catch(() => {})
    }
  }

  return (
    <div
      onClick={() => onSelect?.(asset)}
      className="flex items-center gap-3 p-3 rounded-lg border transition-colors"
      style={{
        borderColor: selected ? 'var(--sf-primary)' : 'var(--sf-border)',
        backgroundColor: selected ? 'color-mix(in srgb, var(--sf-primary) 8%, transparent)' : 'transparent',
        cursor: selectMode ? 'pointer' : 'default',
      }}
    >
      <button
        onClick={togglePlay}
        className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--sf-primary) 15%, transparent)',
          color: 'var(--sf-primary)',
        }}
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate" style={{ color: 'var(--sf-text)' }}>{asset.name}</div>
        <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--sf-text-muted)' }}>
          <span className="uppercase">{asset.category}</span>
          <span>{formatDuration(asset.duration)}</span>
          <span className="uppercase">{asset.format}</span>
        </div>
      </div>
      {asset.tags && asset.tags.length > 0 && (
        <div className="flex gap-1">
          {asset.tags.slice(0, 2).map(t => (
            <span
              key={t}
              className="text-[9px] px-1.5 py-0.5 rounded-full"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--sf-primary) 10%, transparent)',
                color: 'var(--sf-text-secondary)',
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function SoundLibrary({
  assets,
  onSelect,
  onUpload,
  selectMode = false,
  selectedId,
}: SoundLibraryProps) {
  const [filter, setFilter] = useState<AudioCategory | 'all'>('all')
  const [search, setSearch] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const filtered = assets.filter(a => {
    if (filter !== 'all' && a.category !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      return a.name.toLowerCase().includes(q) || a.tags?.some(t => t.toLowerCase().includes(q))
    }
    return true
  })

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && onUpload && /^audio\/(mp3|mpeg|ogg|wav)/.test(file.type)) {
      onUpload(file)
    }
  }, [onUpload])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && onUpload) onUpload(file)
    if (e.target) e.target.value = ''
  }, [onUpload])

  return (
    <div className="space-y-3">
      {/* Search + filter bar */}
      <div className="flex items-center gap-2">
        <div
          className="flex items-center gap-2 flex-1 px-3 py-1.5 rounded-lg border"
          style={{ borderColor: 'var(--sf-border)', backgroundColor: 'transparent' }}
        >
          <Search className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--sf-text-muted)' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search sounds..."
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: 'var(--sf-text)' }}
          />
        </div>
        {onUpload && (
          <>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors hover:opacity-80"
              style={{
                borderColor: 'var(--sf-primary)',
                color: 'var(--sf-primary)',
              }}
            >
              <Upload className="h-3 w-3" /> Upload
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/mp3,audio/mpeg,audio/ogg,audio/wav"
              onChange={handleFileChange}
              className="hidden"
            />
          </>
        )}
      </div>

      {/* Category tabs */}
      <div className="flex gap-1">
        {CATEGORY_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className="text-[11px] px-3 py-1 rounded-full border transition-colors"
            style={{
              borderColor: filter === tab.value ? 'var(--sf-primary)' : 'var(--sf-border)',
              backgroundColor: filter === tab.value ? 'color-mix(in srgb, var(--sf-primary) 12%, transparent)' : 'transparent',
              color: filter === tab.value ? 'var(--sf-primary)' : 'var(--sf-text-secondary)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Upload drop zone */}
      {onUpload && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className="flex items-center justify-center gap-2 p-4 rounded-lg border-2 border-dashed transition-colors"
          style={{
            borderColor: dragOver ? 'var(--sf-primary)' : 'var(--sf-border)',
            backgroundColor: dragOver ? 'color-mix(in srgb, var(--sf-primary) 5%, transparent)' : 'transparent',
            color: 'var(--sf-text-muted)',
          }}
        >
          <Music className="h-4 w-4" />
          <span className="text-xs">Drop audio files here (MP3, OGG, WAV)</span>
        </div>
      )}

      {/* Asset grid */}
      <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-sm" style={{ color: 'var(--sf-text-muted)' }}>
            {assets.length === 0 ? 'No audio assets yet' : 'No matches'}
          </div>
        ) : (
          filtered.map(asset => (
            <AssetCard
              key={asset.id}
              asset={asset}
              selected={selectedId === asset.id}
              onSelect={onSelect}
              selectMode={selectMode}
            />
          ))
        )}
      </div>
    </div>
  )
}
