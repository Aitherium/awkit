'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import PackCard, { PackCardPack } from './PackCard'

export interface PackCatalogProps {
  apiBase?: string
  type?: string  // "agent" | "skill" | "tool" | "" for all
  selectable?: boolean
  multiSelect?: boolean
  selected?: string[]
  owned?: string[]
  onSelectionChange?: (ids: string[]) => void
  onPurchase?: (pack: PackCardPack) => void
  compact?: boolean
  maxHeight?: string
}

export default function PackCatalog({
  apiBase = '',
  type = '',
  selectable = false,
  multiSelect = false,
  selected: externalSelected,
  owned = [],
  onSelectionChange,
  onPurchase,
  compact = false,
  maxHeight,
}: PackCatalogProps) {
  const [packs, setPacks] = useState<PackCardPack[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [selected, setSelected] = useState<Set<string>>(new Set(externalSelected || []))

  useEffect(() => {
    if (externalSelected) setSelected(new Set(externalSelected))
  }, [externalSelected])

  const fetchPacks = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (type) params.set('type', type)
      if (search) params.set('search', search)
      if (categoryFilter !== 'all') params.set('category', categoryFilter)
      const url = `${apiBase}/api/marketplace/packs?${params}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setPacks(data.packs || [])
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [apiBase, type, search, categoryFilter])

  useEffect(() => { fetchPacks() }, [fetchPacks])

  const categories = useMemo(() => {
    const cats = new Set(packs.map(p => p.category).filter(Boolean))
    return Array.from(cats).sort()
  }, [packs])

  const handleSelect = useCallback((pack: PackCardPack) => {
    if (!selectable) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(pack.id)) {
        next.delete(pack.id)
      } else {
        if (!multiSelect) next.clear()
        next.add(pack.id)
      }
      onSelectionChange?.(Array.from(next))
      return next
    })
  }, [selectable, multiSelect, onSelectionChange])

  return (
    <div>
      {/* Search + filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder={`Search ${type || 'all'} packs...`}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, minWidth: 160, padding: '7px 12px',
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
          <option value="all">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Results */}
      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted, #888)' }}>
          Loading packs...
        </div>
      ) : packs.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted, #888)' }}>
          No packs found
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: compact ? 'repeat(auto-fill, minmax(220px, 1fr))' : 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: compact ? 8 : 12,
          maxHeight: maxHeight || undefined,
          overflowY: maxHeight ? 'auto' : undefined,
        }}>
          {packs.map(pack => (
            <PackCard
              key={pack.id}
              pack={pack}
              selected={selected.has(pack.id)}
              owned={owned.includes(pack.id)}
              onSelect={selectable ? handleSelect : undefined}
              onPurchase={onPurchase}
              compact={compact}
            />
          ))}
        </div>
      )}

      {/* Selection summary */}
      {selectable && selected.size > 0 && (
        <div style={{
          marginTop: 10, padding: '8px 12px',
          background: 'var(--bg-active, #1a2a4a)', borderRadius: 'var(--radius, 8px)',
          fontSize: 12, color: 'var(--text-primary, #e0e0e0)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{selected.size} pack{selected.size > 1 ? 's' : ''} selected</span>
          <button
            onClick={() => { setSelected(new Set()); onSelectionChange?.([]) }}
            style={{
              background: 'none', border: 'none', color: 'var(--text-muted, #888)',
              cursor: 'pointer', fontSize: 11,
            }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
