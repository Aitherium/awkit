'use client'

import React, { useEffect, useState, useCallback, useMemo } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillSummary {
  id: string
  name: string
  source: string
  endpoints: number
  tags: string[]
  category: string
}

interface SkillDetail {
  id: string
  name: string
  description: string
  version?: string
  api_base?: string
  category?: string
  source?: string
  endpoints: Array<{
    id: string
    name: string
    method: string
    path: string
    description: string
    parameters?: Array<{ name: string; type: string; required: boolean; description: string }>
  }>
  instructions?: string
}

interface ToolGroup {
  [category: string]: Array<{ name: string; description: string; source: string }>
}

interface MarketplaceItem {
  id: string
  name: string
  type: 'agent' | 'bundle' | 'tool_pack'
  description: string
  price?: string
  pricing_model?: string
  tags?: string[]
  members?: string[]
  skills?: string[]
  icon?: string
  source?: string
}

interface CommunityListing {
  id: string
  name: string
  type?: string
  description: string
  author?: string
  trust_level?: string
  downloads?: number
  tags?: string[]
}

interface ToolPackSummary {
  id: string
  name: string
  version: string
  description: string
  category: string
  tags: string[]
  tool_count: number
  pricing: { subscription_cents?: number; one_time_cents?: number }
  icon: string
  author: string
  has_mcp_server: boolean
}

export interface SkillLibraryPanelProps {
  apiBase?: string
  onInstall?: (itemId: string, type: string) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type TabId = 'skills' | 'tools' | 'marketplace' | 'packs'

export default function SkillLibraryPanel({
  apiBase = '/api/skill-library',
  onInstall,
}: SkillLibraryPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('skills')
  const [loading, setLoading] = useState(true)

  // Skills state
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [categories, setCategories] = useState<Record<string, number>>({})
  const [allTags, setAllTags] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSkill, setSelectedSkill] = useState<SkillDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Tools state
  const [toolGroups, setToolGroups] = useState<ToolGroup>({})
  const [toolTotal, setToolTotal] = useState(0)
  const [toolSearch, setToolSearch] = useState('')

  // Marketplace state
  const [marketplace, setMarketplace] = useState<MarketplaceItem[]>([])
  const [community, setCommunity] = useState<CommunityListing[]>([])
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [installResult, setInstallResult] = useState<string | null>(null)

  // Packs state
  const [packs, setPacks] = useState<ToolPackSummary[]>([])

  // ── Fetch ───────────────────────────────────────────────────────────
  const fetchSkills = useCallback(async () => {
    try {
      const [skillsRes, catRes] = await Promise.allSettled([
        fetch(`${apiBase}/skills`).then(r => r.json()),
        fetch(`${apiBase}/categories`).then(r => r.json()),
      ])
      if (skillsRes.status === 'fulfilled') setSkills(skillsRes.value.skills || [])
      if (catRes.status === 'fulfilled') {
        setCategories(catRes.value.categories || {})
        setAllTags(catRes.value.tags || [])
      }
    } catch { /* graceful */ }
  }, [apiBase])

  const fetchTools = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/tools`)
      const data = await res.json()
      setToolGroups(data.groups || {})
      setToolTotal(data.total || 0)
    } catch { /* graceful */ }
  }, [apiBase])

  const fetchMarketplace = useCallback(async () => {
    try {
      const [mpRes, comRes] = await Promise.allSettled([
        fetch(`${apiBase}/marketplace`).then(r => r.json()),
        fetch(`${apiBase}/community`).then(r => r.json()),
      ])
      if (mpRes.status === 'fulfilled') setMarketplace(mpRes.value.items || mpRes.value.catalog || [])
      if (comRes.status === 'fulfilled') setCommunity(comRes.value.listings || [])
    } catch { /* graceful */ }
  }, [apiBase])

  const fetchPacks = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/packs`)
      const data = await res.json()
      setPacks(data.packs || [])
    } catch { /* graceful */ }
  }, [apiBase])

  useEffect(() => {
    setLoading(true)
    Promise.allSettled([fetchSkills(), fetchTools(), fetchMarketplace(), fetchPacks()])
      .finally(() => setLoading(false))
  }, [fetchSkills, fetchTools, fetchMarketplace, fetchPacks])

  const openSkillDetail = async (skillId: string) => {
    setDetailLoading(true)
    try {
      const res = await fetch(`${apiBase}/skills/${skillId}`)
      const data = await res.json()
      if (!data.error) setSelectedSkill(data)
    } catch { /* graceful */ }
    setDetailLoading(false)
  }

  const handleInstall = async (itemId: string, type: string) => {
    if (onInstall) {
      onInstall(itemId, type)
      return
    }
    setInstallingId(itemId)
    setInstallResult(null)
    try {
      const res = await fetch(`${apiBase}/install?source=${encodeURIComponent(itemId)}`, { method: 'POST' })
      const data = await res.json()
      setInstallResult(data.success ? `Installed ${data.skill_name || itemId}` : (data.message || 'Install failed'))
    } catch {
      setInstallResult('Install failed — could not reach the server. Try again in a moment.')
    }
    setInstallingId(null)
  }

  // ── Filtering ───────────────────────────────────────────────────────
  const filteredSkills = useMemo(() => {
    let result = skills
    if (selectedCategory) {
      result = result.filter(s => s.category === selectedCategory)
    }
    if (selectedTags.length > 0) {
      result = result.filter(s => selectedTags.some(t => s.tags?.includes(t)))
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        s =>
          s.name.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          s.tags?.some(t => t.toLowerCase().includes(q))
      )
    }
    return result
  }, [skills, selectedCategory, selectedTags, searchQuery])

  const filteredToolGroups = useMemo(() => {
    if (!toolSearch) return toolGroups
    const q = toolSearch.toLowerCase()
    const filtered: ToolGroup = {}
    for (const [cat, tools] of Object.entries(toolGroups)) {
      const matched = tools.filter(
        t => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
      )
      if (matched.length > 0) filtered[cat] = matched
    }
    return filtered
  }, [toolGroups, toolSearch])

  // ── Styles ──────────────────────────────────────────────────────────
  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-elevated, #1a1a2e)',
    border: '1px solid var(--border, #333)',
    borderRadius: '8px',
    padding: '16px',
    cursor: 'pointer',
    transition: 'border-color 0.15s',
  }

  const badgeStyle = (color: string): React.CSSProperties => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 500,
    background: `${color}20`,
    color,
  })

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 20px',
    borderRadius: '6px 6px 0 0',
    border: 'none',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    background: active ? 'var(--bg-elevated, #1a1a2e)' : 'transparent',
    color: active ? 'var(--fg, #e0e0e0)' : 'var(--fg-muted, #888)',
    borderBottom: active ? '2px solid var(--accent, #7c3aed)' : '2px solid transparent',
  })

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-base, #111)',
    border: '1px solid var(--border, #333)',
    borderRadius: '6px',
    padding: '8px 12px',
    color: 'var(--fg, #e0e0e0)',
    fontSize: '13px',
    width: '100%',
  }

  const btnStyle = (color: string, disabled?: boolean): React.CSSProperties => ({
    background: disabled ? 'var(--bg-base, #111)' : `${color}15`,
    border: `1px solid ${disabled ? 'var(--border, #333)' : `${color}40`}`,
    color: disabled ? 'var(--fg-muted, #666)' : color,
    borderRadius: '6px',
    padding: '6px 14px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '12px',
    fontWeight: 500,
  })

  const sourceColor = (source?: string): string => {
    if (!source) return '#90caf9'
    const s = source.toLowerCase()
    if (s === 'builtin' || s === 'platform') return '#81c784'
    if (s === 'community') return '#ffb74d'
    if (s === 'custom' || s === 'user') return '#ce93d8'
    return '#90caf9'
  }

  const sourceLabel = (source?: string): string => {
    if (!source) return 'Platform'
    const s = source.toLowerCase()
    if (s === 'builtin') return 'Platform'
    if (s === 'community') return 'Community'
    if (s === 'custom' || s === 'user') return 'Custom'
    return source
  }

  if (loading) {
    return (
      <div style={{ padding: '24px', color: 'var(--fg-muted, #888)' }}>
        Loading skill library...
      </div>
    )
  }

  // ── Detail Drawer ───────────────────────────────────────────────────
  const renderDetailDrawer = () => {
    if (!selectedSkill) return null
    const src = selectedSkill.source || (skills.find(s => s.id === selectedSkill.id)?.source)
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '480px',
          maxWidth: '100vw',
          background: 'var(--bg-elevated, #1a1a2e)',
          borderLeft: '1px solid var(--border, #333)',
          zIndex: 1000,
          overflowY: 'auto',
          padding: '24px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--fg, #e0e0e0)' }}>
            {selectedSkill.name}
          </div>
          <button
            onClick={() => setSelectedSkill(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--fg-muted, #888)',
              cursor: 'pointer',
              fontSize: '18px',
            }}
          >
            x
          </button>
        </div>

        {selectedSkill.description && (
          <p style={{ color: 'var(--fg-muted, #aaa)', fontSize: '13px', marginBottom: '16px', lineHeight: 1.5 }}>
            {selectedSkill.description}
          </p>
        )}

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
          {selectedSkill.category && <span style={badgeStyle('#7c3aed')}>{selectedSkill.category}</span>}
          {selectedSkill.version && <span style={badgeStyle('#90caf9')}>v{selectedSkill.version}</span>}
          <span style={badgeStyle(sourceColor(src))}>{sourceLabel(src)}</span>
        </div>

        {selectedSkill.endpoints.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg, #e0e0e0)', marginBottom: '8px' }}>
              Endpoints ({selectedSkill.endpoints.length})
            </div>
            {selectedSkill.endpoints.map(ep => (
              <div
                key={ep.id}
                style={{
                  background: 'var(--bg-base, #111)',
                  border: '1px solid var(--border, #333)',
                  borderRadius: '6px',
                  padding: '10px',
                  marginBottom: '8px',
                }}
              >
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={badgeStyle(ep.method === 'GET' ? '#81c784' : '#ffb74d')}>
                    {ep.method}
                  </span>
                  <span style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--fg, #e0e0e0)' }}>
                    {ep.path}
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--fg-muted, #aaa)' }}>
                  {ep.description}
                </div>
                {ep.parameters && ep.parameters.length > 0 && (
                  <div style={{ marginTop: '6px' }}>
                    {ep.parameters.map(p => (
                      <div key={p.name} style={{ fontSize: '11px', color: 'var(--fg-muted, #888)', marginLeft: '8px' }}>
                        <span style={{ fontFamily: 'monospace', color: '#90caf9' }}>{p.name}</span>
                        <span style={{ color: '#666' }}> : {p.type}</span>
                        {p.required && <span style={{ color: '#ef5350' }}> *</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {selectedSkill.instructions && (
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg, #e0e0e0)', marginBottom: '8px' }}>
              Quick Start
            </div>
            <pre
              style={{
                background: 'var(--bg-base, #111)',
                border: '1px solid var(--border, #333)',
                borderRadius: '6px',
                padding: '12px',
                fontSize: '12px',
                color: 'var(--fg-muted, #aaa)',
                whiteSpace: 'pre-wrap',
                overflowX: 'auto',
              }}
            >
              {selectedSkill.instructions}
            </pre>
          </div>
        )}

        {/* Install button for community skills */}
        {src && src.toLowerCase() === 'community' && (
          <div style={{ marginTop: '16px' }}>
            <button
              onClick={() => handleInstall(selectedSkill.id, 'skill')}
              disabled={installingId === selectedSkill.id}
              style={btnStyle('#81c784', installingId === selectedSkill.id)}
            >
              {installingId === selectedSkill.id ? 'Installing...' : 'Install Skill'}
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── Backdrop ────────────────────────────────────────────────────────
  const renderBackdrop = () => {
    if (!selectedSkill) return null
    return (
      <div
        onClick={() => setSelectedSkill(null)}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 999,
        }}
      />
    )
  }

  // ── Skills Tab ──────────────────────────────────────────────────────
  const renderSkillsTab = () => (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px' }}>
          <input
            type="text"
            placeholder="Search skills..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={inputStyle}
          />
        </div>
        <select
          value={selectedCategory}
          onChange={e => setSelectedCategory(e.target.value)}
          style={{ ...inputStyle, width: 'auto', minWidth: '140px', flex: '0 0 auto' }}
        >
          <option value="">All categories</option>
          {Object.entries(categories).map(([cat, count]) => (
            <option key={cat} value={cat}>
              {cat} ({count})
            </option>
          ))}
        </select>
      </div>

      {/* Tag chips */}
      {allTags.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
          {allTags.slice(0, 20).map(tag => {
            const active = selectedTags.includes(tag)
            return (
              <button
                key={tag}
                onClick={() =>
                  setSelectedTags(prev =>
                    active ? prev.filter(t => t !== tag) : [...prev, tag]
                  )
                }
                style={{
                  padding: '3px 10px',
                  borderRadius: '12px',
                  fontSize: '11px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  border: active ? '1px solid var(--accent, #7c3aed)' : '1px solid var(--border, #444)',
                  background: active ? 'var(--accent, #7c3aed)20' : 'transparent',
                  color: active ? 'var(--accent, #7c3aed)' : 'var(--fg-muted, #888)',
                }}
              >
                {tag}
              </button>
            )
          })}
        </div>
      )}

      {/* Skill cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
        {filteredSkills.map(skill => (
          <div
            key={skill.id}
            style={cardStyle}
            onClick={() => openSkillDetail(skill.id)}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent, #7c3aed)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border, #333)')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg, #e0e0e0)' }}>
                {skill.name}
              </div>
              <span style={badgeStyle(sourceColor(skill.source))}>{sourceLabel(skill.source)}</span>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
              {skill.category && <span style={badgeStyle('#7c3aed')}>{skill.category}</span>}
              <span style={badgeStyle('#90caf9')}>{skill.endpoints} endpoints</span>
            </div>
            {skill.tags && skill.tags.length > 0 && (
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {skill.tags.slice(0, 4).map(tag => (
                  <span key={tag} style={{ fontSize: '10px', color: 'var(--fg-muted, #666)' }}>
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {filteredSkills.length === 0 && (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--fg-muted, #666)' }}>
          {skills.length === 0 ? 'No skills available yet — an administrator can add them from the platform.' : 'No skills match your filters'}
        </div>
      )}
    </div>
  )

  // ── Tools Tab ───────────────────────────────────────────────────────
  const renderToolsTab = () => {
    const sortedCategories = Object.keys(filteredToolGroups).sort()
    const filteredTotal = Object.values(filteredToolGroups).reduce((sum, arr) => sum + arr.length, 0)

    return (
      <div>
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <input
              type="text"
              placeholder="Search tools..."
              value={toolSearch}
              onChange={e => setToolSearch(e.target.value)}
              style={inputStyle}
            />
          </div>
          <span style={{ fontSize: '13px', color: 'var(--fg-muted, #888)', whiteSpace: 'nowrap' }}>
            {filteredTotal} / {toolTotal} tools
          </span>
        </div>

        {sortedCategories.map(cat => (
          <div key={cat} style={{ marginBottom: '20px' }}>
            <div
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--fg, #e0e0e0)',
                marginBottom: '8px',
                textTransform: 'capitalize',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {cat}
              <span style={badgeStyle('#90caf9')}>{filteredToolGroups[cat].length}</span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: '8px',
              }}
            >
              {filteredToolGroups[cat].map(tool => (
                <div
                  key={tool.name}
                  style={{
                    background: 'var(--bg-base, #111)',
                    border: '1px solid var(--border, #333)',
                    borderRadius: '6px',
                    padding: '10px 12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 500,
                        color: 'var(--fg, #e0e0e0)',
                        fontFamily: 'monospace',
                      }}
                    >
                      {tool.name}
                    </span>
                    {tool.source !== 'builtin' && (
                      <span style={badgeStyle('#ffb74d')}>{tool.source}</span>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--fg-muted, #888)', lineHeight: 1.4 }}>
                    {tool.description || 'No description'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {sortedCategories.length === 0 && (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--fg-muted, #666)' }}>
            {toolTotal === 0 ? 'No tools available yet — an administrator can add them from the platform.' : 'No tools match your search'}
          </div>
        )}
      </div>
    )
  }

  // ── Packs Tab ──────────────────────────────────────────────────
  const renderPacksTab = () => {
    const formatPrice = (pricing: ToolPackSummary['pricing']) => {
      if (!pricing || (!pricing.subscription_cents && !pricing.one_time_cents)) return 'Free'
      const parts: string[] = []
      if (pricing.subscription_cents) parts.push(`$${(pricing.subscription_cents / 100).toFixed(2)}/mo`)
      if (pricing.one_time_cents) parts.push(`$${(pricing.one_time_cents / 100).toFixed(2)}`)
      return parts.join(' or ')
    }

    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
          {packs.map(pack => (
            <div key={pack.id} style={{ ...cardStyle, cursor: 'default' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg, #e0e0e0)' }}>
                  {pack.icon ? `${pack.icon} ` : ''}{pack.name}
                </div>
                <span style={badgeStyle('#4fc3f7')}>{pack.category}</span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--fg-muted, #aaa)', marginBottom: '10px', lineHeight: 1.4 }}>
                {pack.description || 'No description'}
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                <span style={badgeStyle('#90caf9')}>{pack.tool_count} tools</span>
                <span style={badgeStyle('#81c784')}>v{pack.version}</span>
                {pack.has_mcp_server && <span style={badgeStyle('#ffb74d')}>MCP Server</span>}
              </div>
              {pack.tags && pack.tags.length > 0 && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' }}>
                  {pack.tags.slice(0, 5).map(tag => (
                    <span key={tag} style={{ fontSize: '10px', color: 'var(--fg-muted, #666)' }}>#{tag}</span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg, #e0e0e0)' }}>
                  {formatPrice(pack.pricing)}
                </span>
                <button
                  onClick={() => handleInstall(pack.id, 'tool_pack')}
                  disabled={installingId === pack.id}
                  style={btnStyle('#4fc3f7', installingId === pack.id)}
                >
                  {installingId === pack.id ? 'Adding...' : 'Add to Agent'}
                </button>
              </div>
            </div>
          ))}
        </div>
        {packs.length === 0 && (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--fg-muted, #666)' }}>
            No tool packs discovered. Drop a .toolpack.yaml directory in packs/ to get started.
          </div>
        )}
      </div>
    )
  }

  // ── Marketplace Tab ─────────────────────────────────────────────────
  const renderMarketplaceTab = () => {
    const totalItems = marketplace.length + community.length
    return (
      <div>
        {installResult && (
          <div style={{
            padding: '8px 12px',
            marginBottom: '12px',
            borderRadius: '6px',
            fontSize: '12px',
            background: 'var(--bg-base, #111)',
            border: '1px solid var(--border, #333)',
            color: 'var(--fg-muted, #aaa)',
          }}>
            {installResult}
          </div>
        )}

        {totalItems > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
            {/* Curated marketplace items */}
            {marketplace.map(item => (
              <div key={item.id} style={{ ...cardStyle, cursor: 'default' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg, #e0e0e0)' }}>
                    {item.icon ? `${item.icon} ` : ''}{item.name}
                  </div>
                  <span style={badgeStyle(
                    item.type === 'agent' ? '#7c3aed' : item.type === 'bundle' ? '#f06292' : '#4fc3f7'
                  )}>
                    {item.type === 'tool_pack' ? 'tool pack' : item.type}
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--fg-muted, #aaa)', marginBottom: '10px', lineHeight: 1.4 }}>
                  {item.description}
                </div>
                {item.members && item.members.length > 0 && (
                  <div style={{ fontSize: '11px', color: 'var(--fg-muted, #666)', marginBottom: '6px' }}>
                    Members: {item.members.join(', ')}
                  </div>
                )}
                {item.skills && item.skills.length > 0 && (
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    {item.skills.slice(0, 5).map(s => (
                      <span key={s} style={badgeStyle('#81c784')}>{s}</span>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  {item.price && (
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg, #e0e0e0)' }}>
                      {item.price}
                      {item.pricing_model === 'subscription' && '/mo'}
                    </span>
                  )}
                  <button
                    onClick={() => handleInstall(item.id, item.type)}
                    disabled={installingId === item.id}
                    style={btnStyle('#7c3aed', installingId === item.id)}
                  >
                    {installingId === item.id ? 'Installing...' : item.price === 'free' ? 'Activate' : 'Install'}
                  </button>
                </div>
              </div>
            ))}

            {/* Community listings */}
            {community.map(item => (
              <div key={`community-${item.id}`} style={{ ...cardStyle, cursor: 'default' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg, #e0e0e0)' }}>
                    {item.name}
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <span style={badgeStyle('#ffb74d')}>community</span>
                    {item.trust_level && (
                      <span style={badgeStyle(
                        item.trust_level === 'verified' ? '#81c784' : item.trust_level === 'trusted' ? '#90caf9' : '#666'
                      )}>
                        {item.trust_level}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--fg-muted, #aaa)', marginBottom: '10px', lineHeight: 1.4 }}>
                  {item.description}
                </div>
                {item.author && (
                  <div style={{ fontSize: '11px', color: 'var(--fg-muted, #666)', marginBottom: '6px' }}>
                    by {item.author}
                    {item.downloads != null && ` | ${item.downloads} downloads`}
                  </div>
                )}
                {item.tags && item.tags.length > 0 && (
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    {item.tags.slice(0, 5).map(t => (
                      <span key={t} style={{ fontSize: '10px', color: 'var(--fg-muted, #666)' }}>#{t}</span>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => handleInstall(item.id, item.type || 'skill')}
                    disabled={installingId === item.id}
                    style={btnStyle('#ffb74d', installingId === item.id)}
                  >
                    {installingId === item.id ? 'Installing...' : 'Install'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--fg-muted, #666)' }}>
            No marketplace items available — check Genesis connection
          </div>
        )}
      </div>
    )
  }

  // ── Main Render ─────────────────────────────────────────────────────
  const marketplaceCount = marketplace.length + community.length
  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--fg, #e0e0e0)' }}>
            Skill Library
          </div>
          <div style={{ fontSize: '12px', color: 'var(--fg-muted, #888)', marginTop: '2px' }}>
            {skills.length} skills, {toolTotal} tools
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--border, #333)' }}>
        {(['skills', 'tools', 'packs', 'marketplace'] as TabId[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={tabStyle(activeTab === tab)}
          >
            {tab === 'skills' ? `Skills (${skills.length})` :
             tab === 'tools' ? `Tools (${toolTotal})` :
             tab === 'packs' ? `Packs (${packs.length})` :
             `Marketplace (${marketplaceCount})`}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'skills' && renderSkillsTab()}
      {activeTab === 'tools' && renderToolsTab()}
      {activeTab === 'packs' && renderPacksTab()}
      {activeTab === 'marketplace' && renderMarketplaceTab()}

      {/* Skill detail drawer */}
      {renderBackdrop()}
      {renderDetailDrawer()}

      {detailLoading && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            right: '240px',
            zIndex: 1001,
            color: 'var(--fg-muted, #888)',
            fontSize: '13px',
          }}
        >
          Loading...
        </div>
      )}
    </div>
  )
}
