'use client'

import { useState, useEffect, useCallback } from 'react'

// ---------------------------------------------------------------------------
// AitherStrata — tiered storage panel (product layer 5).
// Reads the Veil proxies /api/strata/stats and /api/strata/files, which
// authenticate the caller (requireAuth) and forward to the Strata service.
// Read-only: tier usage (HOT/WARM/COLD) and the caller's file listing.
// ---------------------------------------------------------------------------

interface TierStat {
  bytes: number
  files: number
  label?: string
}

interface StatsResponse {
  total_bytes?: number
  total_files?: number
  files_docs?: string
  tiers?: { hot?: TierStat; warm?: TierStat; cold?: TierStat }
}

interface StrataFile {
  name: string
  path: string
  size?: number
  modified_at?: string
  tier?: string
  type?: string
}

interface FilesResponse {
  files?: StrataFile[]
  total?: number
  path?: string
}

const TIERS: Array<'hot' | 'warm' | 'cold'> = ['hot', 'warm', 'cold']

function fmtBytes(n?: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

export interface StrataPanelProps {
  apiBase?: string
  workspace?: string
}

export default function StrataPanel({ apiBase = '/api/strata', workspace = '' }: StrataPanelProps) {
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [files, setFiles] = useState<FilesResponse | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const qs = workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''
      const [s, f] = await Promise.all([
        fetch(`${apiBase}/stats`),
        fetch(`${apiBase}/files${qs}`),
      ])
      if (!s.ok) throw new Error(`stats HTTP ${s.status}`)
      if (!f.ok) throw new Error(`files HTTP ${f.status}`)
      setStats(await s.json())
      setFiles(await f.json())
      setError('')
    } catch (e) {
      setError(`Cannot reach Strata: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [apiBase, workspace])

  useEffect(() => {
    void load()
  }, [load])

  const list = files?.files ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0 }}>Your files</h3>
        <span style={{ opacity: 0.7, fontSize: 13 }}>
          {fmtBytes(stats?.total_bytes)} · {stats?.total_files ?? 0} files
        </span>
        <button onClick={() => void load()} disabled={busy} style={{ marginLeft: 'auto' }}>
          {busy ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div style={{ color: '#e06c75' }}>{error}</div>}

      <div style={{ display: 'flex', gap: 12 }}>
        {TIERS.map((t) => {
          const tier = stats?.tiers?.[t]
          return (
            <div
              key={t}
              style={{ flex: 1, padding: 8, border: '1px solid rgba(127,127,127,0.25)', borderRadius: 6 }}
            >
              <div style={{ fontSize: 12, textTransform: 'uppercase', opacity: 0.7 }}>{t}</div>
              <div style={{ fontSize: 16 }}>{tier?.label ?? fmtBytes(tier?.bytes)}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{tier?.files ?? 0} files</div>
            </div>
          )
        })}
      </div>

      {list.length === 0 && !error && <div style={{ opacity: 0.6 }}>No files yet.</div>}

      {list.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th>name</th>
              <th>size</th>
              <th>tier</th>
              <th>modified</th>
            </tr>
          </thead>
          <tbody>
            {list.map((f) => (
              <tr key={f.path} style={{ borderTop: '1px solid rgba(127,127,127,0.25)' }}>
                <td title={f.path}>{f.name}</td>
                <td>{fmtBytes(f.size)}</td>
                <td>{f.tier ?? '—'}</td>
                <td>{f.modified_at ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
