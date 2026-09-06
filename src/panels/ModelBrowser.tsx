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

// Fallback models when API is unavailable
const FALLBACK_MODELS: ModelEntry[] = [
  { id: 'qwen3-4b', name: 'Qwen 3 4B', provider: 'Ollama', category: 'chat', parameters: '4B', vram_gb: 4, context_length: 32768, license: 'Apache 2.0', description: 'Fast, efficient chat model', recommended: true },
  { id: 'qwen3-8b', name: 'Qwen 3 8B', provider: 'Ollama', category: 'chat', parameters: '8B', vram_gb: 6, context_length: 131072, license: 'Apache 2.0', description: 'Balanced chat model with thinking mode' },
  { id: 'qwen3-32b', name: 'Qwen 3 32B', provider: 'Ollama', category: 'reasoning', parameters: '32B', vram_gb: 20, context_length: 131072, license: 'Apache 2.0', description: 'Strong reasoning model', recommended: true },
  { id: 'gemma3-4b', name: 'Gemma 3 4B', provider: 'Ollama', category: 'chat', parameters: '4B', vram_gb: 4, context_length: 32768, license: 'Gemma', description: 'Google lightweight chat model' },
  { id: 'deepseek-r1-14b', name: 'DeepSeek R1 14B', provider: 'Ollama', category: 'reasoning', parameters: '14B', vram_gb: 10, context_length: 65536, license: 'MIT', description: 'Open reasoning model' },
  { id: 'nomic-embed', name: 'Nomic Embed Text', provider: 'Ollama', category: 'embedding', parameters: '137M', vram_gb: 1, context_length: 8192, license: 'Apache 2.0', description: 'Fast text embeddings' },
  { id: 'claude-sonnet', name: 'Claude Sonnet 4.6', provider: 'Anthropic', category: 'chat', parameters: 'Cloud', vram_gb: 0, context_length: 200000, license: 'Commercial', description: 'Anthropic cloud — balanced speed & intelligence' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI', category: 'chat', parameters: 'Cloud', vram_gb: 0, context_length: 128000, license: 'Commercial', description: 'OpenAI cloud — multimodal' },
  { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'DeepSeek', category: 'chat', parameters: 'Cloud', vram_gb: 0, context_length: 65536, license: 'Commercial', description: 'DeepSeek cloud — affordable reasoning' },
]

export default function ModelBrowser({
  apiBase = '',
  selectedModel,
  onModelSelect,
  hardwareProfile: initialProfile = 'mid',
}: ModelBrowserProps) {
  const [models, setModels] = useState<ModelEntry[]>(FALLBACK_MODELS)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [hwProfile, setHwProfile] = useState(initialProfile)

  const fetchModels = useCallback(async () => {
    setLoading(true)
    try {
      const vram = HARDWARE_PROFILES[hwProfile]?.vram || 0
      const res = await fetch(`${apiBase}/api/marketplace/models?search=${search}&min_vram=0&category=${categoryFilter === 'all' ? '' : categoryFilter}`)
      if (res.ok) {
        const data = await res.json()
        if (data.models?.length) setModels(data.models)
      }
    } catch {
      // Use fallback models
    } finally {
      setLoading(false)
    }
  }, [apiBase, search, categoryFilter, hwProfile])

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
                border: `1px solid ${isSelected ? 'var(--accent, #6366f1)' : 'var(--glass-border, #2a2a4a)'}`,
                cursor: 'pointer', opacity: fits ? 1 : 0.5,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{model.name}</span>
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
                <span>{(model.context_length / 1000).toFixed(0)}k ctx</span>
              </div>
            </div>
          )
        })}
      </div>

      {filtered.length === 0 && !loading && (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted, #888)', fontSize: 12 }}>
          No models match your hardware profile and filters
        </div>
      )}
    </div>
  )
}
