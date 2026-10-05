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
  category: string  // "chat" | "reasoning" | "embedding" | "vision" | "code"
  parameters: string  // e.g. "7B", "70B"
  vram_gb: number
  context_length: number
  quantization?: string
  license: string
  description: string
  recommended?: boolean
  /** "platform" (catalog) or "tenant" (this workspace's own models). */
  source?: string
  status?: string
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

  const categories = useMemo(() => {
    const cats = new Set(models.map(m => m.category).filter(Boolean))
    return Array.from(cats).sort()
  }, [models])

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
              <div style={{ display: 'flex', gap: 8, fontSize: 10, color: 'var(--text-muted, #666)' }}>
                <span>{model.provider}</span>
                <span>{CATEGORY_ICONS[model.category] || ''} {model.category}</span>
                {model.vram_gb > 0 && <span>{model.vram_gb} GB VRAM</span>}
                {model.context_length > 0 && <span>{(model.context_length / 1000).toFixed(0)}k ctx</span>}
              </div>
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
