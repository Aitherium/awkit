'use client'

import { useState, useEffect, useCallback } from 'react'

interface Props {
  apiBase?: string
}

interface UserStats {
  user_id: string
  messages_sent: number
  documents_uploaded: number
  tokens_consumed: number
  last_active: string | null
}

interface WorkspaceStats {
  total_users: number
  total_messages: number
  total_documents: number
  total_tokens: number
  active_today: number
  users: UserStats[]
}

interface TrendPoint {
  date: string
  count: number
  unique_users: number
}

export default function UserAnalyticsDashboard({ apiBase = '/api' }: Props) {
  const [stats, setStats] = useState<WorkspaceStats | null>(null)
  const [myStats, setMyStats] = useState<Record<string, number> | null>(null)
  const [trends, setTrends] = useState<TrendPoint[]>([])
  const [period, setPeriod] = useState('7d')
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    // My stats (always available)
    try {
      const r = await fetch(`${apiBase}/analytics/me`)
      if (r.ok) {
        const data = await r.json()
        setMyStats(data.stats || {})
      }
    } catch { /* best-effort */ }

    // Workspace dashboard (admin only)
    try {
      const r = await fetch(`${apiBase}/analytics/dashboard`)
      if (r.ok) {
        const data = await r.json()
        setStats(data.stats || null)
        setIsAdmin(true)
      }
    } catch { /* non-admin gets 403, that's fine */ }

    // Trends
    try {
      const r = await fetch(`${apiBase}/analytics/trends?period=${period}`)
      if (r.ok) {
        const data = await r.json()
        setTrends(data.series || [])
      }
    } catch { /* best-effort */ }

    setLoading(false)
  }, [apiBase, period])

  useEffect(() => { fetchAll() }, [fetchAll])

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading analytics...</div>
  }

  const statCard = (label: string, value: number | string, sub?: string) => (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: 16,
      textAlign: 'center',
      minWidth: 120,
    }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  )

  // Simple bar chart using divs
  const maxCount = Math.max(1, ...trends.map(t => t.count))

  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <h2 style={{ margin: '0 0 16px', fontSize: 18 }}>Analytics</h2>

      {/* My Stats */}
      {myStats && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 8px' }}>
            My Usage
          </h3>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {statCard('Messages', myStats.messages_sent || 0)}
            {statCard('Documents', myStats.documents_uploaded || 0)}
            {statCard('Tokens', myStats.tokens_consumed || 0)}
            {statCard('Feedback', myStats.feedback_given || 0)}
          </div>
        </div>
      )}

      {/* Workspace Stats (admin only) */}
      {isAdmin && stats && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 8px' }}>
            Workspace Overview
          </h3>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {statCard('Total Users', stats.total_users)}
            {statCard('Messages', stats.total_messages)}
            {statCard('Documents', stats.total_documents)}
            {statCard('Active Today', stats.active_today)}
            {statCard('Tokens Used', stats.total_tokens)}
          </div>
        </div>
      )}

      {/* Activity Trends */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <h3 style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>
            Activity Trends
          </h3>
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            style={{
              padding: '2px 8px',
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--text-primary)',
              fontSize: 12,
            }}
          >
            <option value="7d">7 days</option>
            <option value="30d">30 days</option>
            <option value="90d">90 days</option>
          </select>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 2,
          height: 120,
          padding: '0 4px',
          borderBottom: '1px solid var(--border)',
        }}>
          {trends.map((t, i) => (
            <div
              key={t.date}
              title={`${t.date}: ${t.count} actions, ${t.unique_users} users`}
              style={{
                flex: 1,
                background: 'var(--accent)',
                opacity: 0.7 + (t.count / maxCount) * 0.3,
                height: `${Math.max(2, (t.count / maxCount) * 100)}%`,
                borderRadius: '2px 2px 0 0',
                minWidth: 4,
                cursor: 'default',
              }}
            />
          ))}
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 10,
          color: 'var(--text-muted)',
          marginTop: 4,
        }}>
          <span>{trends[0]?.date || ''}</span>
          <span>{trends[trends.length - 1]?.date || ''}</span>
        </div>
      </div>

      {/* User table (admin only) */}
      {isAdmin && stats && stats.users.length > 0 && (
        <div>
          <h3 style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 8px' }}>
            Per-User Breakdown
          </h3>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
          }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 500 }}>User</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 500 }}>Messages</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 500 }}>Docs</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 500 }}>Tokens</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-muted)', fontWeight: 500 }}>Last Active</th>
              </tr>
            </thead>
            <tbody>
              {stats.users.map(u => (
                <tr key={u.user_id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px' }}>{u.user_id}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{u.messages_sent}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{u.documents_uploaded}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{u.tokens_consumed.toLocaleString()}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>
                    {u.last_active ? new Date(u.last_active).toLocaleDateString() : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
