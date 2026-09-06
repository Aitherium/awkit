'use client'

import { useState, useEffect, useCallback } from 'react'

export interface StorageTierViewProps {
  apiBase?: string
}

interface TierInfo {
  used_bytes: number
  file_count: number
  type: string
  latency_ms: number
}

interface StorageFile {
  path: string
  size: number
  tier: string
  last_modified?: string
}

const TIER_COLORS: Record<string, string> = {
  HOT: '#ff5252',
  WARM: '#ffc107',
  COLD: '#2196f3',
  CACHE: '#00e676',
}

const TIER_LABELS: Record<string, string> = {
  HOT: 'NVMe',
  WARM: 'SSD',
  COLD: 'NAS / HDD',
  CACHE: 'Memory',
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export default function StorageTierView({ apiBase = '/api/data-plane' }: StorageTierViewProps) {
  const [tiers, setTiers] = useState<Record<string, TierInfo>>({})
  const [files, setFiles] = useState<StorageFile[]>([])
  const [loading, setLoading] = useState(true)
  const [filterTier, setFilterTier] = useState('')
  const [migrating, setMigrating] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [tierResp, fileResp] = await Promise.all([
        fetch(`${apiBase}/storage/tiers`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/storage/files${filterTier ? `?tier=${filterTier}` : ''}`).then(r => r.ok ? r.json() : null),
      ])
      if (tierResp?.tiers) setTiers(tierResp.tiers)
      if (fileResp?.files) setFiles(fileResp.files)
      else setFiles([])
    } catch (e) {
      console.error('Fetch storage data error:', e)
    }
    setLoading(false)
  }, [apiBase, filterTier])

  useEffect(() => { fetchData() }, [fetchData])

  const handleMigrate = async (filePath: string, targetTier: string) => {
    setMigrating(filePath)
    try {
      await fetch(`${apiBase}/storage/migrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: filePath, target_tier: targetTier }),
      })
      setTimeout(fetchData, 1000)
    } catch (e) {
      console.error('Migration error:', e)
    }
    setMigrating(null)
  }

  const totalUsed = Object.values(tiers).reduce((sum, t) => sum + t.used_bytes, 0)

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading storage tiers...</div>
  }

  return (
    <div>
      {/* Tier cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginBottom: '1.5rem' }}>
        {Object.entries(tiers).map(([tier, info]) => {
          const pct = totalUsed > 0 ? (info.used_bytes / totalUsed) * 100 : 0
          return (
            <div
              key={tier}
              onClick={() => setFilterTier(filterTier === tier ? '' : tier)}
              style={{
                padding: '14px 16px', borderRadius: 8,
                background: filterTier === tier ? 'rgba(124,58,237,0.1)' : 'var(--bg-elevated)',
                border: filterTier === tier ? '1px solid var(--accent)' : '1px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: TIER_COLORS[tier] || '#888',
                  }} />
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{tier}</span>
                </div>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {TIER_LABELS[tier] || info.type}
                </span>
              </div>
              <div style={{ fontSize: '0.85rem', fontWeight: 500, marginBottom: 4 }}>
                {formatBytes(info.used_bytes)}
              </div>
              <div style={{ height: 4, borderRadius: 2, background: 'var(--bg-deep)', overflow: 'hidden', marginBottom: 6 }}>
                <div style={{
                  width: `${Math.min(pct, 100)}%`, height: '100%', borderRadius: 2,
                  background: TIER_COLORS[tier] || '#888',
                }} />
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                <span>{info.file_count} files</span>
                <span>{info.latency_ms}ms latency</span>
              </div>
            </div>
          )
        })}
      </div>

      {Object.keys(tiers).length === 0 && (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Storage tier data not available. Ensure AitherStrata is running.
        </div>
      )}

      {/* File browser */}
      {files.length > 0 && (
        <div>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 8 }}>
            Files {filterTier ? `(${filterTier})` : '(all tiers)'}
          </div>
          {files.map((f, i) => (
            <div key={f.path || i} style={{
              padding: '8px 12px', borderRadius: 6, background: 'var(--bg-elevated)',
              border: '1px solid var(--border)', marginBottom: 4,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.path}
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
                  <span>{formatBytes(f.size)}</span>
                  <span style={{ color: TIER_COLORS[f.tier] || 'var(--text-muted)', fontWeight: 600 }}>{f.tier}</span>
                </div>
              </div>
              <select
                value=""
                onChange={e => { if (e.target.value) handleMigrate(f.path, e.target.value) }}
                disabled={migrating === f.path}
                style={{
                  padding: '3px 6px', borderRadius: 4, border: '1px solid var(--border)',
                  background: 'var(--bg-deep)', color: 'var(--text-muted)', fontSize: '0.7rem',
                  cursor: 'pointer',
                }}
              >
                <option value="">Move to...</option>
                {['HOT', 'WARM', 'COLD', 'CACHE'].filter(t => t !== f.tier).map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
