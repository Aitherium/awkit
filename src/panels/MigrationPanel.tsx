'use client'

import { useState, useEffect, useCallback } from 'react'

interface Counts { [k: string]: number }

export interface MigrationPanelProps {
  apiBase?: string
}

const ENTITY_LABELS: Record<string, string> = {
  client: 'Clients', session: 'Sessions', invoice: 'Invoices',
  payment: 'Payments', contract: 'Contracts', gallery: 'Galleries',
  comm: 'Messages', document: 'Captured pages',
}

export default function MigrationPanel({ apiBase = '/api/untether' }: MigrationPanelProps) {
  const [counts, setCounts] = useState<Counts>({})
  const [clients, setClients] = useState<any[]>([])
  const [sessions, setSessions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [src, cl, se] = await Promise.all([
        fetch(`${apiBase}/sources`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/entities/client?limit=50`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/entities/session?limit=50`).then(r => r.ok ? r.json() : null),
      ])
      setCounts(src?.counts || {})
      setClients(cl?.items || [])
      setSessions(se?.items || [])
    } catch { /* leave empty */ } finally { setLoading(false) }
  }, [apiBase])

  useEffect(() => { load() }, [load])

  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  const card = (bg = 'var(--bg-surface, #27202d)'): React.CSSProperties => ({
    padding: 14, borderRadius: 'var(--radius, 10px)', background: bg,
    border: '1px solid var(--divider, rgba(255,255,255,0.06))',
  })

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto', color: 'var(--text-primary)' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Migration &amp; CRM mirror</h2>
      <p style={{ margin: '0 0 18px', color: 'var(--text-secondary)', fontSize: 13 }}>
        Your Sprout Studio data, mirrored into Chelle — captured as you work, plus
        sanctioned CSV / Zapier sync. {total > 0 ? `${total} records so far.` : ''}
      </p>

      {/* capture counts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 10, marginBottom: 22 }}>
        {Object.keys(ENTITY_LABELS).map(k => (
          <div key={k} style={card()}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{counts[k] || 0}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{ENTITY_LABELS[k]}</div>
          </div>
        ))}
      </div>

      {/* connect guide */}
      <div style={{ ...card('var(--card-hover, rgba(236,72,153,0.06))'), marginBottom: 22 }}>
        <strong style={{ fontSize: 13.5 }}>Connect your data</strong>
        <ol style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <li><b>Install the Chelle Companion</b> browser extension, then browse Sprout Studio — your clients, sessions and invoices mirror automatically. Click “Import everything” to backfill.</li>
          <li><b>Zapier</b>: point Sprout’s New Lead / Booking / Payment zaps at <code>{apiBase}/zapier/&lt;event&gt;</code> for real-time sync.</li>
          <li><b>CSV</b>: export Reports → Contact Analytics and upload it (POST <code>{apiBase}/sources/import/csv</code>).</li>
          <li><b>Calendar</b>: authorize your gallery360 Google Calendar in Sprout (two-way sync) so personal time shows busy — no manual switching.</li>
        </ol>
      </div>

      {loading ? <p style={{ color: 'var(--text-muted)' }}>Loading…</p> : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div>
            <h3 style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Clients</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              {clients.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>None yet.</p>}
              {clients.slice(0, 25).map((c, i) => (
                <div key={i} style={card()}>
                  <strong style={{ fontSize: 13 }}>{c.name || c.email || c.source_id}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {[c.stage, c.email].filter(Boolean).join(' · ')}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Sessions</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              {sessions.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>None yet.</p>}
              {sessions.slice(0, 25).map((s, i) => (
                <div key={i} style={card()}>
                  <strong style={{ fontSize: 13 }}>{s.type || 'Session'}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {[s.status, s.start].filter(Boolean).join(' · ')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
