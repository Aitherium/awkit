'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'

export interface ModelBrowserProps {
  apiBase?: string
  selectedModel?: string
  onModelSelect?: (modelId: string) => void
  hardwareProfile?: string
}

interface ModelEntry {
  id: string
  name: string
  provider: string
  category: string  // "chat" | "reasoning" | "embedding" | "vision" | "code" | "image" | "voice"
  /** Voice models: "tts" (speech out) or "stt" (speech in). */
  subcategory?: string
  parameters: string  // e.g. "7B", "70B"
  vram_gb: number
  context_length: number
  quantization?: string
  license: string
  description: string
  recommended?: boolean
  /**
   * "platform" (catalog), "tenant" (this workspace's own models) or "appliance"
   * (downloadable onto this appliance from its models/models.yaml).
   */
  source?: string
  status?: string
  /** Appliance models: total download size and the one command that fetches it. */
  size_bytes?: number | null
  download_command?: string
  deprecated?: boolean
  releases?: { tag: string; url: string; eval?: string | null }[]
}

const HARDWARE_PROFILES: Record<string, { label: string; vram: number }> = {
  none: { label: 'CPU Only', vram: 0 },
  low: { label: 'Low (4-8 GB)', vram: 8 },
  mid: { label: 'Mid (12-16 GB)', vram: 16 },
  high: { label: 'High (24 GB)', vram: 24 },
  ultra: { label: 'Ultra (48+ GB)', vram: 80 },
}

const CATEGORY_ICONS: Record<string, string> = {
  chat: '\uD83D\uDCAC',
  reasoning: '\uD83E\uDDE0',
  embedding: '\uD83D\uDD17',
  vision: '\uD83D\uDC41',
  code: '\uD83D\uDCBB',
  image: '\uD83C\uDFA8',
  voice: '\uD83C\uDF99',
}

/**
 * The types the filter always offers, in this order, so image and voice models
 * are discoverable even before a catalog row of that kind has loaded. Any other
 * category the catalog returns is appended after these.
 */
export const KNOWN_CATEGORIES = ['chat', 'reasoning', 'code', 'vision', 'image', 'voice', 'embedding']

const SUBCATEGORY_LABELS: Record<string, string> = {
  tts: 'Text to speech',
  stt: 'Speech to text',
}

/** Categories for the filter: the known ones first, then anything else the data has. */
export function categoryOptions(models: { category?: string }[]): string[] {
  const extra = new Set(
    models.map(m => m.category || '').filter(c => c && !KNOWN_CATEGORIES.includes(c)),
  )
  return [...KNOWN_CATEGORIES, ...Array.from(extra).sort()]
}

/** 9731112222 -> "9.7 GB" (decimal units, as download pages quote them). */
export function formatBytes(n?: number | null): string {
  if (!n || n <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i += 1
  }
  return i === 0 ? `${v} B` : `${v.toFixed(1)} ${units[i]}`
}

export default function ModelBrowser({
  apiBase = '',
  selectedModel,
  onModelSelect,
  hardwareProfile: initialProfile = 'mid',
}: ModelBrowserProps) {
  const [models, setModels] = useState<ModelEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [hwProfile, setHwProfile] = useState(initialProfile)
  const [platformAvailable, setPlatformAvailable] = useState(true)

  const fetchModels = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (categoryFilter !== 'all') params.set('category', categoryFilter)
      const res = await fetch(`${apiBase}/api/marketplace/models?${params}`)
      if (res.ok) {
        const data = await res.json()
        setModels(data.models || [])
        setPlatformAvailable(data.platform_available !== false)
        setError(null)
      } else {
        // No built-in model list: an unreachable catalog is stated, not papered over.
        setModels([])
        setError(res.status === 401 ? 'Sign in to browse models.' : 'The model catalog is unavailable right now.')
      }
    } catch {
      setModels([])
      setError('The model catalog is unavailable right now.')
    } finally {
      setLoading(false)
    }
  }, [apiBase, search, categoryFilter])

  useEffect(() => { fetchModels() }, [fetchModels])

  const maxVram = HARDWARE_PROFILES[hwProfile]?.vram || 999

  const filtered = useMemo(() => {
    return models.filter(m => {
      if (categoryFilter !== 'all' && m.category !== categoryFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!m.name.toLowerCase().includes(q) && !m.provider.toLowerCase().includes(q) && !m.id.toLowerCase().includes(q)) return false
      }
      // Show cloud models (vram_gb=0) always; filter local by hardware profile
      if (m.vram_gb > 0 && m.vram_gb > maxVram && maxVram > 0) return false
      return true
    })
  }, [models, categoryFilter, search, maxVram])

  const categories = useMemo(() => categoryOptions(models), [models])

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search models..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, minWidth: 140, padding: '7px 12px',
            background: 'var(--bg-deep, #111)', border: '1px solid var(--glass-border, #333)',
            borderRadius: 'var(--radius, 8px)', color: 'var(--text-primary, #e0e0e0)',
            fontSize: 13, outline: 'none',
          }}
        />
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          style={{
            padding: '7px 12px', background: 'var(--bg-deep, #111)',
            border: '1px solid var(--glass-border, #333)', borderRadius: 'var(--radius, 8px)',
            color: 'var(--text-primary, #e0e0e0)', fontSize: 12, outline: 'none',
          }}
        >
          <option value="all">All Types</option>
          {categories.map(c => <option key={c} value={c}>{CATEGORY_ICONS[c] || ''} {c}</option>)}
        </select>
        <select
          value={hwProfile}
          onChange={e => setHwProfile(e.target.value)}
          style={{
            padding: '7px 12px', background: 'var(--bg-deep, #111)',
            border: '1px solid var(--glass-border, #333)', borderRadius: 'var(--radius, 8px)',
            color: 'var(--text-primary, #e0e0e0)', fontSize: 12, outline: 'none',
          }}
        >
          {Object.entries(HARDWARE_PROFILES).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      {!platformAvailable && !error && (
        <div role="status" style={{ marginBottom: 8, fontSize: 11, color: '#fbbf24' }}>
          The platform catalog is unreachable; showing the models this appliance can download.
        </div>
      )}

      {/* Model grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 8, maxHeight: '400px', overflowY: 'auto',
      }}>
        {filtered.map(model => {
          const isSelected = selectedModel === model.id
          const fits = model.vram_gb === 0 || model.vram_gb <= maxVram
          return (
            <div
              key={model.id}
              onClick={() => onModelSelect?.(model.id)}
              style={{
                padding: 12, borderRadius: 'var(--radius, 8px)',
                background: isSelected ? 'var(--bg-active, #1a2a4a)' : 'var(--bg-surface, #16162a)',
                border: `1px solid ${isSelected ? 'var(--accent, #5EC9CC)' : 'var(--glass-border, #2a2a4a)'}`,
                cursor: 'pointer', opacity: fits ? 1 : 0.5,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{model.name}</span>
                  {model.source === 'tenant' && (
                    <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 5px', borderRadius: 8, background: 'var(--bg-active, #1a2a4a)', color: 'var(--accent, #5EC9CC)' }}>
                      Yours
                    </span>
                  )}
                  {model.source === 'appliance' && (
                    <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 5px', borderRadius: 8, background: 'var(--bg-deep, #111)', color: 'var(--text-muted, #aaa)' }}>
                      {model.status === 'unavailable' ? 'Not downloadable yet' : 'Download'}
                    </span>
                  )}
                  {model.status === 'offline' && (
                    <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 5px', borderRadius: 8, background: '#3a2a1a', color: '#fbbf24' }}>
                      Offline
                    </span>
                  )}
                  {model.recommended && (
                    <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 5px', borderRadius: 8, background: '#1a3a1a', color: '#4ade80' }}>
                      Recommended
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 10, color: 'var(--text-muted, #666)' }}>{model.parameters}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted, #888)', marginBottom: 6 }}>
                {model.description}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 10, color: 'var(--text-muted, #666)' }}>
                <span>{model.provider}</span>
                <span>{CATEGORY_ICONS[model.category] || ''} {model.category}</span>
                {model.subcategory && <span>{SUBCATEGORY_LABELS[model.subcategory] || model.subcategory}</span>}
                {model.vram_gb > 0 && <span>{model.vram_gb} GB VRAM</span>}
                {model.vram_gb === 0 && model.source === 'appliance' && <span>runs on CPU</span>}
                {model.context_length > 0 && <span>{(model.context_length / 1000).toFixed(0)}k ctx</span>}
                {model.size_bytes ? <span>{formatBytes(model.size_bytes)}</span> : null}
              </div>
              <div
                data-testid="model-license"
                style={{ marginTop: 6, fontSize: 10, color: model.license ? 'var(--text-primary, #ccc)' : '#fbbf24' }}
              >
                Licence: {model.license || 'not recorded'}
              </div>
              {model.download_command && (
                <code
                  title="Run this in your appliance's repo to download the model"
                  onClick={e => e.stopPropagation()}
                  style={{
                    display: 'block', marginTop: 6, padding: '3px 6px', fontSize: 10,
                    background: 'var(--bg-deep, #111)', borderRadius: 4,
                    color: 'var(--text-muted, #aaa)', userSelect: 'all', overflowX: 'auto',
                  }}
                >
                  {model.download_command}
                </code>
              )}
              {model.releases && model.releases.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                  {model.releases.map(r => (
                    <a
                      key={r.tag}
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={e => e.stopPropagation()}
                      style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: 'var(--bg-deep, #111)', color: 'var(--text-muted, #888)', textDecoration: 'none' }}
                    >
                      {r.tag}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {error && !loading && (
        <div role="alert" style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted, #888)', fontSize: 12 }}>
          {error}
        </div>
      )}

      {filtered.length === 0 && !loading && !error && (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted, #888)', fontSize: 12 }}>
          No models match your hardware profile and filters
        </div>
      )}
    </div>
  )
}
