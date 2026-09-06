'use client'

import { useCallback, useEffect, useState } from 'react'

// ---------------------------------------------------------------------------
// Shop ↔ hub connection / pairing status. Reads the backend proxy
// /api/v1/shop/{id}/connection-status (which reads the shop's /api/hub/status).
// ---------------------------------------------------------------------------

const C = {
  bg: '#1e1e2e', panel: '#181825', text: '#cdd6f4', sub: '#a6adc8',
  line: '#313244', accent: '#89b4fa', good: '#a6e3a1', warn: '#f9e2af', bad: '#f38ba8',
}

interface ConnectionStatus {
  instance_id?: string
  tenant_id?: string
  registered?: boolean
  api_key_present?: boolean
  plan?: string
  license?: { valid?: boolean; grace_period?: boolean; status?: string }
  entitlements?: string[]
  limits?: Record<string, unknown>
  last_heartbeat?: number
  maintenance?: boolean
  maintenance_reason?: string
  error?: string
}

export interface ShopConnectionPanelProps {
  shopId: string
  apiBase?: string
  autoRefreshMs?: number
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  const color = ok ? C.good : C.bad
  return (
    <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: `${color}22`, color, border: `1px solid ${color}44` }}>
      {label}
    </span>
  )
}

export default function ShopConnectionPanel({ shopId, apiBase = '/api/v1/shop', autoRefreshMs = 30000 }: ShopConnectionPanelProps) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [repairing, setRepairing] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/${shopId}/connection-status`)
      setStatus(await r.json())
    } catch (e) {
      setStatus({ error: String(e), registered: false })
    } finally { setLoading(false) }
  }, [apiBase, shopId])

  useEffect(() => {
    load()
    const t = setInterval(load, autoRefreshMs)
    return () => clearInterval(t)
  }, [load, autoRefreshMs])

  const rePair = useCallback(async () => {
    setRepairing(true)
    try {
      await fetch(`${apiBase}/${shopId}/re-pair`, { method: 'POST' })
      await load()
    } finally { setRepairing(false) }
  }, [apiBase, shopId, load])

  const wrap: React.CSSProperties = { background: C.bg, color: C.text, padding: 24, minHeight: '100%' }
  const card: React.CSSProperties = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 18, marginBottom: 16 }
  const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${C.line}` }
  const btn: React.CSSProperties = { padding: '8px 16px', borderRadius: 8, border: 'none', background: C.accent, color: '#11111b', fontWeight: 600, cursor: 'pointer' }

  if (loading) return <div style={wrap}><p style={{ color: C.sub }}>Loading connection status…</p></div>

  const s = status || {}
  const lic = s.license || {}
  const hb = s.last_heartbeat ? new Date(s.last_heartbeat * 1000).toLocaleString() : '—'

  return (
    <div style={wrap}>
      {s.maintenance && (
        <div style={{ ...card, borderColor: C.bad, background: `${C.bad}11` }}>
          <strong style={{ color: C.bad }}>Maintenance mode</strong>
          <div style={{ color: C.sub }}>{s.maintenance_reason || 'Set by hub'}</div>
        </div>
      )}

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>Hub pairing</h3>
          <Badge ok={!!s.registered} label={s.registered ? 'registered' : 'not paired'} />
        </div>
        <div style={row}><span style={{ color: C.sub }}>Instance ID</span><code>{s.instance_id || '—'}</code></div>
        <div style={row}><span style={{ color: C.sub }}>API key</span><Badge ok={!!s.api_key_present} label={s.api_key_present ? 'present' : 'missing'} /></div>
        <div style={row}><span style={{ color: C.sub }}>Last heartbeat</span><span>{hb}</span></div>
        <button style={{ ...btn, marginTop: 14 }} onClick={rePair} disabled={repairing}>{repairing ? 'Re-pairing…' : 'Re-pair with hub'}</button>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>License &amp; plan</h3>
          <Badge ok={!!lic.valid} label={lic.valid ? (lic.grace_period ? 'grace' : 'valid') : 'invalid'} />
        </div>
        <div style={row}><span style={{ color: C.sub }}>Plan</span><b>{s.plan || '—'}</b></div>
        <div style={row}><span style={{ color: C.sub }}>Status</span><span>{lic.status || '—'}</span></div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Entitlements</h3>
        {(s.entitlements && s.entitlements.length) ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {s.entitlements.map(e => (
              <span key={e} style={{ background: `${C.accent}22`, color: C.accent, padding: '4px 10px', borderRadius: 8, fontSize: 13 }}>{e}</span>
            ))}
          </div>
        ) : <p style={{ color: C.sub }}>No entitlements synced yet.</p>}
        {s.limits && Object.keys(s.limits).length > 0 && (
          <div style={{ marginTop: 12 }}>
            {Object.entries(s.limits).map(([k, v]) => (
              <div key={k} style={row}><span style={{ color: C.sub }}>{k}</span><span>{String(v)}</span></div>
            ))}
          </div>
        )}
      </div>

      {s.error && <p style={{ color: C.bad }}>{s.error}</p>}
    </div>
  )
}
