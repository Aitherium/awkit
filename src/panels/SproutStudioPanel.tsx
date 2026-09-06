'use client'

import { useState, useEffect, useCallback } from 'react'

interface StudioClient {
  id: string
  name: string
  email?: string
  stage?: string
  package?: string
  session_date?: string | null
  balance_due?: number
}

interface StudioSession {
  id: string
  client?: string
  type?: string
  start?: string
  end?: string
  location?: string
  status?: string
}

type TabMode = 'sessions' | 'clients'

export interface SproutStudioPanelProps {
  apiBase?: string
}

const STAGE_COLORS: Record<string, string> = {
  inquiry: 'var(--accent-warn, #fb923c)',
  booked: 'var(--accent-primary, #ec4899)',
  delivered: 'var(--accent-success, #7ab08a)',
}

export default function SproutStudioPanel({ apiBase = '/api/sprout-studio' }: SproutStudioPanelProps) {
  const [tab, setTab] = useState<TabMode>('sessions')
  const [clients, setClients] = useState<StudioClient[]>([])
  const [sessions, setSessions] = useState<StudioSession[]>([])
  const [demo, setDemo] = useState(false)
  const [available, setAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [statusRes, clientsRes, sessionsRes] = await Promise.all([
        fetch(`${apiBase}/status`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/clients`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/sessions?upcoming=true`).then(r => r.ok ? r.json() : null),
      ])
      setAvailable(!!statusRes?.available)
      setClients(clientsRes?.clients || [])
      setSessions(sessionsRes?.sessions || [])
      setDemo(!!(clientsRes?.demo ?? sessionsRes?.demo))
    } catch {
      /* leave lists empty on error */
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => { fetchData() }, [fetchData])

  const runSync = useCallback(async () => {
    setSyncing(true)
    setSyncMsg('')
    try {
      const res = await fetch(`${apiBase}/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      }).then(r => r.json())
      setSyncMsg(res?.ok ? `Synced ${res.synced_sessions ?? ''} sessions.` : (res?.message || 'Sync unavailable.'))
      if (res?.ok) await fetchData()
    } catch {
      setSyncMsg('Sync failed.')
    } finally {
      setSyncing(false)
    }
  }, [apiBase, fetchData])

  const fmtDate = (s?: string | null) => {
    if (!s) return '—'
    const d = new Date(s)
    return isNaN(d.getTime()) ? s : d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  }

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto', color: 'var(--text-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Sprout Studio</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
            Photography studio CRM — sessions &amp; clients
          </p>
        </div>
        <button
          onClick={runSync}
          disabled={syncing}
          style={{
            padding: '8px 14px', borderRadius: 'var(--radius, 10px)', cursor: 'pointer',
            background: 'var(--accent-primary, #ec4899)', color: '#fff', border: 'none',
            opacity: syncing ? 0.6 : 1,
          }}
        >
          {syncing ? 'Syncing…' : 'Sync from Sprout Studio'}
        </button>
      </div>

      {(demo || !available) && (
        <div style={{
          padding: '8px 12px', marginBottom: 14, fontSize: 12.5, borderRadius: 8,
          background: 'var(--card-hover, rgba(236,72,153,0.06))', color: 'var(--text-secondary)',
          border: '1px solid var(--divider, rgba(255,255,255,0.06))',
        }}>
          Showing demo data. Add your Sprout Studio iCal feed
          (<code>CHELLE_SPROUT_STUDIO_ICAL_URL</code>) to sync live sessions.
        </div>
      )}
      {syncMsg && (
        <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--text-secondary)' }}>{syncMsg}</div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['sessions', 'clients'] as TabMode[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
              textTransform: 'capitalize', border: '1px solid var(--divider, rgba(255,255,255,0.08))',
              background: tab === t ? 'var(--accent-primary, #ec4899)' : 'transparent',
              color: tab === t ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : tab === 'sessions' ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {sessions.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No upcoming sessions.</p>}
          {sessions.map(s => (
            <div key={s.id} style={{
              padding: 14, borderRadius: 'var(--radius, 10px)',
              background: 'var(--bg-surface, #27202d)',
              border: '1px solid var(--divider, rgba(255,255,255,0.06))',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <strong>{s.type || 'Session'}</strong>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.status}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                {s.client} · {fmtDate(s.start)}{s.location ? ` · ${s.location}` : ''}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {clients.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No clients yet.</p>}
          {clients.map(c => (
            <div key={c.id} style={{
              padding: 14, borderRadius: 'var(--radius, 10px)',
              background: 'var(--bg-surface, #27202d)',
              border: '1px solid var(--divider, rgba(255,255,255,0.06))',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <strong>{c.name}</strong>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {c.package || '—'}{c.session_date ? ` · ${c.session_date}` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {c.stage && (
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 999,
                    background: STAGE_COLORS[c.stage] || 'var(--text-muted)', color: '#fff',
                  }}>{c.stage}</span>
                )}
                {!!c.balance_due && (
                  <div style={{ fontSize: 12, color: 'var(--accent-warn, #fb923c)', marginTop: 4 }}>
                    ${c.balance_due} due
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
