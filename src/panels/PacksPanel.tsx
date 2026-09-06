'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'

interface PackEntry {
  id: string
  name: string
  version: string
  description: string
  category: string
  tags: string[]
  tool_count: number
  skills: string[]
  persona_fragments: string[]
  pricing: { subscription_cents?: number; one_time_cents?: number }
  icon: string
  author: string
  licensed: boolean
  app_manifest_id?: string
  type?: string
}

export interface PacksPanelProps {
  apiBase?: string
}

type TierFilter = 'all' | 'free' | 'starter' | 'pro' | 'enterprise'

function formatPrice(pricing: PackEntry['pricing']): string {
  if (!pricing || (!pricing.subscription_cents && !pricing.one_time_cents)) return 'Free'
  if (pricing.subscription_cents) return `$${(pricing.subscription_cents / 100).toFixed(0)}/mo`
  if (pricing.one_time_cents) return `$${(pricing.one_time_cents / 100).toFixed(0)}`
  return 'Paid'
}

function packTier(pack: PackEntry): string {
  if (!pack.pricing?.subscription_cents && !pack.pricing?.one_time_cents) return 'free'
  const cents = pack.pricing.subscription_cents || pack.pricing.one_time_cents || 0
  if (cents <= 999) return 'starter'
  if (cents <= 4999) return 'pro'
  return 'enterprise'
}

const TIER_COLORS: Record<string, { bg: string; color: string }> = {
  free: { bg: '#1a2a3a', color: '#60a5fa' },
  starter: { bg: '#1a2a3a', color: '#60a5fa' },
  pro: { bg: '#2a1a3a', color: '#a78bfa' },
  enterprise: { bg: '#3a2a1a', color: '#fbbf24' },
}

export default function PacksPanel({ apiBase = '' }: PacksPanelProps) {
  const [packs, setPacks] = useState<PackEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [tierFilter, setTierFilter] = useState<TierFilter>('all')
  const [installing, setInstalling] = useState<string | null>(null)
  const [deploying, setDeploying] = useState<string | null>(null)

  const fetchPacks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/packs/catalog`)
      if (res.ok) {
        const data = await res.json()
        setPacks(data.packs || [])
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => { fetchPacks() }, [fetchPacks])

  // Post-checkout claim handler
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('claim')
    if (!sessionId) return
    ;(async () => {
      try {
        const res = await fetch(
          `${apiBase}/api/packs/checkout?session_id=${encodeURIComponent(sessionId)}`,
        )
        if (res.ok) {
          await fetch(`${apiBase}/api/packs/reload`, { method: 'POST' }).catch(() => {})
          await fetchPacks()
        }
        const url = new URL(window.location.href)
        url.searchParams.delete('claim')
        window.history.replaceState({}, '', url.toString())
      } catch { /* silent */ }
    })()
  }, [apiBase, fetchPacks])

  const categories = useMemo(() => {
    const cats = new Set(packs.map(p => p.category).filter(Boolean))
    return Array.from(cats).sort()
  }, [packs])

  const stats = useMemo(() => ({
    total: packs.length,
    installed: packs.filter(p => (p as PackEntry & { installed?: boolean }).installed).length,
    licensed: packs.filter(p => p.licensed).length,
    free: packs.filter(p => !p.pricing?.subscription_cents && !p.pricing?.one_time_cents).length,
  }), [packs])

  const filtered = useMemo(() => {
    return packs.filter(p => {
      if (search) {
        const q = search.toLowerCase()
        if (!p.name.toLowerCase().includes(q) &&
          !p.description.toLowerCase().includes(q) &&
          !p.id.toLowerCase().includes(q) &&
          !p.tags?.some(t => t.includes(q))) return false
      }
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false
      if (tierFilter !== 'all' && packTier(p) !== tierFilter) return false
      return true
    })
  }, [packs, search, categoryFilter, tierFilter])

  const handleInstall = useCallback(async (packId: string) => {
    setInstalling(packId)
    try {
      await fetch(`${apiBase}/api/packs/reload`, { method: 'POST' })
      await fetchPacks()
    } finally {
      setInstalling(null)
    }
  }, [apiBase, fetchPacks])

  const handleDeploy = useCallback(async (manifestId: string) => {
    setDeploying(manifestId)
    try {
      const res = await fetch(`${apiBase}/api/bridge/genesis/apps/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: manifestId }),
      })
      if (res.ok) {
        await fetchPacks()
      }
    } catch { /* silent */ }
    finally {
      setDeploying(null)
    }
  }, [apiBase, fetchPacks])

  const handlePurchase = useCallback(async (packId: string) => {
    try {
      const res = await fetch(`${apiBase}/api/packs/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: packId.startsWith('toolpack.') ? packId : `toolpack.${packId}`,
          mode: 'subscription',
        }),
      })
      if (res.ok) {
        const { checkout_url } = await res.json()
        if (checkout_url) window.location.href = checkout_url
      }
    } catch { /* silent */ }
  }, [apiBase])

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 600 }}>Extension Packs</h2>
        <p style={{ color: '#888' }}>Loading packs...</p>
      </div>
    )
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Extension Packs</h2>
        <span style={{ color: '#888', fontSize: 13 }}>{filtered.length} of {packs.length} packs</span>
      </div>

      {/* Stats row */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap',
      }}>
        {[
          { label: 'Total', value: stats.total, color: '#e0e0e0' },
          { label: 'Installed', value: stats.installed, color: '#4ade80' },
          { label: 'Licensed', value: stats.licensed, color: '#60a5fa' },
          { label: 'Free', value: stats.free, color: '#a78bfa' },
        ].map(s => (
          <div key={s.label} style={{
            padding: '8px 16px', background: '#16162a', border: '1px solid #2a2a4a',
            borderRadius: 8, textAlign: 'center', minWidth: 80,
          }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#888' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search packs..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, minWidth: 180, padding: '8px 12px',
            background: '#1a1a2e', border: '1px solid #333', borderRadius: 8,
            color: '#e0e0e0', fontSize: 14, outline: 'none',
          }}
        />

        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          style={{
            padding: '8px 12px', background: '#1a1a2e', border: '1px solid #333',
            borderRadius: 8, color: '#e0e0e0', fontSize: 13, outline: 'none',
          }}
        >
          <option value="all">All Categories</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>

        <select
          value={tierFilter}
          onChange={e => setTierFilter(e.target.value as TierFilter)}
          style={{
            padding: '8px 12px', background: '#1a1a2e', border: '1px solid #333',
            borderRadius: 8, color: '#e0e0e0', fontSize: 13, outline: 'none',
          }}
        >
          <option value="all">All Tiers</option>
          <option value="free">Free</option>
          <option value="starter">Starter</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {filtered.map(pack => {
          const isFree = !pack.pricing?.subscription_cents && !pack.pricing?.one_time_cents
          const tier = packTier(pack)
          const tierColor = TIER_COLORS[tier] || TIER_COLORS.free
          return (
            <div key={pack.id} style={{
              background: '#16162a', border: '1px solid #2a2a4a', borderRadius: 10,
              padding: 16, display: 'flex', flexDirection: 'column',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <strong style={{ fontSize: 14 }}>{pack.name}</strong>
                <div style={{ display: 'flex', gap: 4 }}>
                  <span style={{
                    fontSize: 10, padding: '2px 6px', borderRadius: 12,
                    background: tierColor.bg, color: tierColor.color,
                  }}>
                    {tier}
                  </span>
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 12,
                    background: pack.licensed ? '#1a3a1a' : isFree ? '#1a2a3a' : '#3a2a1a',
                    color: pack.licensed ? '#4ade80' : isFree ? '#60a5fa' : '#fbbf24',
                  }}>
                    {pack.licensed ? 'Active' : isFree ? 'Free' : formatPrice(pack.pricing)}
                  </span>
                </div>
              </div>

              <p style={{ fontSize: 12, color: '#888', margin: '0 0 8px', flex: 1 }}>
                {pack.description}
              </p>

              <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>
                {pack.tool_count} tools
                {pack.skills?.length > 0 && ` · ${pack.skills.length} skills`}
                {pack.author && ` · ${pack.author}`}
              </div>

              {pack.tags?.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                  {pack.tags.slice(0, 3).map(tag => (
                    <span key={tag} style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 4,
                      background: '#222', color: '#888',
                    }}>{tag}</span>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 6 }}>
                {!pack.licensed && !isFree ? (
                  <button
                    onClick={() => handlePurchase(pack.id)}
                    style={{
                      padding: '6px 12px', fontSize: 12, borderRadius: 6,
                      background: '#d97706', color: '#fff', border: 'none', cursor: 'pointer',
                    }}
                  >
                    Subscribe — {formatPrice(pack.pricing)}
                  </button>
                ) : !pack.licensed && isFree ? (
                  <button
                    onClick={() => handleInstall(pack.id)}
                    disabled={installing === pack.id}
                    style={{
                      padding: '6px 12px', fontSize: 12, borderRadius: 6,
                      background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer',
                      opacity: installing === pack.id ? 0.5 : 1,
                    }}
                  >
                    {installing === pack.id ? 'Activating...' : 'Activate'}
                  </button>
                ) : null}
                {pack.app_manifest_id && (pack.licensed || isFree) && (
                  <button
                    onClick={() => handleDeploy(pack.app_manifest_id!)}
                    disabled={deploying === pack.app_manifest_id}
                    style={{
                      padding: '6px 12px', fontSize: 12, borderRadius: 6,
                      background: '#059669', color: '#fff', border: 'none', cursor: 'pointer',
                      opacity: deploying === pack.app_manifest_id ? 0.5 : 1,
                    }}
                  >
                    {deploying === pack.app_manifest_id ? 'Deploying...' : 'Deploy Workspace'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {filtered.length === 0 && (
        <p style={{ color: '#666', textAlign: 'center', padding: 32 }}>
          {search || categoryFilter !== 'all' || tierFilter !== 'all'
            ? 'No packs match your filters'
            : 'No extension packs available'}
        </p>
      )}
    </div>
  )
}
