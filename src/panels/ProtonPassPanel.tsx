'use client'

import React, { useCallback, useEffect, useState } from 'react'

export interface ProtonPassPanelProps {
  apiBase?: string
  className?: string
}

interface PassItem {
  item_id: string
  name: string
  type: string
  username: string
  url: string
}

export default function ProtonPassPanel({
  apiBase = '/api/proton-pass',
  className = '',
}: ProtonPassPanelProps) {
  const [items, setItems] = useState<PassItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const fetchItems = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/items`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setItems(data.data?.items ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load vault items')
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  const filtered = items.filter(
    (i) =>
      !search ||
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      i.username.toLowerCase().includes(search.toLowerCase()) ||
      i.url.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className={`proton-pass-panel ${className}`}>
      <h3 style={{ margin: '0 0 12px' }}>Proton Pass</h3>
      <p style={{ fontSize: 12, opacity: 0.6, margin: '0 0 12px' }}>
        Read-only vault access. Passwords are never displayed in the list.
      </p>

      <input
        type="text"
        placeholder="Search credentials..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: '100%', padding: '8px 12px', borderRadius: 6, marginBottom: 12,
          border: '1px solid var(--border, #333)',
          background: 'var(--card, #1a1a2e)',
          color: 'inherit', boxSizing: 'border-box',
        }}
      />

      {error && (
        <div style={{ color: '#ef4444', padding: 8, marginBottom: 12 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', opacity: 0.5 }}>Loading vault...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {filtered.map((item) => (
            <div
              key={item.item_id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', borderRadius: 8,
                border: '1px solid var(--border, #333)',
              }}
            >
              <span style={{ fontSize: 18 }}>
                {item.type === 'login' ? '🔑' : item.type === 'note' ? '📝' : '🔒'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.name}
                </div>
                <div style={{ fontSize: 12, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.username}
                  {item.url && ` · ${item.url}`}
                </div>
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', opacity: 0.5 }}>
              {search ? 'No matching credentials' : 'Vault is empty'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
