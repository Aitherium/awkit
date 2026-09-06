'use client'

/**
 * ElysiumCreditsPanel — the ELYSIUM S1 earnings surface.
 *
 * Shows a node's earned credits, balance, and recent ledger events from the
 * append-only accounting ledger. Rendered wherever a render_blocks `panel`
 * block with panel_id="elysium-credits" is emitted (DynamicRenderer →
 * PanelBlockComponent), and available in the portal-kit panel registry.
 *
 * SECURITY: this is a display surface. All credit/ledger computation happens
 * server-side (ACTA /v1/elysium/earn + /v1/admin/ledger); this panel only
 * renders what the backend returns. Entitlement is enforced server-side.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Coins, Wallet, ScrollText, RefreshCw, ShieldCheck } from 'lucide-react'

export interface ElysiumCreditsPanelProps {
  apiBase?: string
  nodeId?: string
  /** When emitted via render_blocks, the server may pass props directly */
  balance?: number
  credits?: number
  ledger?: Array<{ event_type: string; tokens_delta: number; tokens_balance: number; timestamp: string }>
}

const ACCENT = '#00D4FF'

export default function ElysiumCreditsPanel({
  apiBase = '/api/elysium',
  nodeId,
  balance: propBalance,
  credits: propCredits,
  ledger: propLedger,
}: ElysiumCreditsPanelProps) {
  const [loading, setLoading] = useState(!propBalance && !propLedger)
  const [data, setData] = useState<any>({
    balance: propBalance ?? 0,
    credits: propCredits ?? 0,
    ledger: propLedger ?? [],
  })
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    // Prefer server-passed props (render_blocks path); fall back to the
    // portal-kit elysium proxy (→ ACTA balance + ledger read endpoints).
    if (propBalance != null && propLedger != null) return
    setLoading(true)
    try {
      const [bal, led] = await Promise.all([
        fetch(`${apiBase}/credits`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${apiBase}/ledger?limit=8`).then((r) => (r.ok ? r.json() : null)),
      ])
      setData({
        balance: propBalance ?? bal?.tokens ?? 0,
        credits: propCredits ?? 0,
        ledger: propLedger ?? led?.ledger ?? [],
      })
    } catch {
      setError('Could not load Elysium credits.')
    } finally {
      setLoading(false)
    }
  }, [apiBase, nodeId, propBalance, propCredits, propLedger])

  useEffect(() => { load() }, [load])

  const events = data.ledger ?? []
  const earned = events.reduce((s: number, e: any) => s + (Number(e.tokens_delta) || 0), 0)

  return (
    <div style={{ padding: 24, color: '#e5e7eb', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <Coins size={22} color={ACCENT} />
        <h2 style={{ margin: 0, fontSize: 20 }}>Elysium Credits</h2>
      </div>
      <p style={{ marginTop: 0, color: '#9ca3af', fontSize: 13 }}>
        Sovereign replica hosting earnings — accrued to the append-only ledger.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, margin: '16px 0' }}>
        <div style={card()}>
          <div style={{ fontSize: 11, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Wallet size={12} /> Balance
          </div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{Number(data.balance).toFixed(3)}</div>
        </div>
        <div style={card()}>
          <div style={{ fontSize: 11, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Coins size={12} /> Earned
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: ACCENT }}>{Number(earned).toFixed(3)}</div>
        </div>
        <div style={card()}>
          <div style={{ fontSize: 11, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4 }}>
            <ShieldCheck size={12} /> Verified
          </div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{events.length}</div>
          <div style={{ fontSize: 10, color: '#6b7280' }}>signed attestations</div>
        </div>
      </div>

      {loading && <div style={{ color: '#6b7280' }}><RefreshCw size={14} className="spin" /> Loading…</div>}
      {error && <div style={{ color: '#f87171', fontSize: 13 }}>{error}</div>}

      <div style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
        <ScrollText size={14} /> Recent ledger events
      </div>
      {events.length === 0 && !loading && (
        <div style={{ color: '#6b7280', fontSize: 13 }}>No earnings yet. Deploy a replica, sign attestations, and they appear here.</div>
      )}
      {events.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ color: '#9ca3af', textAlign: 'left' }}>
              <th style={th()}>Event</th><th style={th()}>Delta</th>
              <th style={th()}>Balance</th><th style={th()}>When</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e: any, i: number) => (
              <tr key={i} style={{ borderTop: '1px solid #1f2937' }}>
                <td style={td()}>{e.event_type}</td>
                <td style={{ ...td(), color: Number(e.tokens_delta) >= 0 ? '#00FF88' : '#f87171' }}>
                  {Number(e.tokens_delta) >= 0 ? '+' : ''}{Number(e.tokens_delta).toFixed(3)}
                </td>
                <td style={td()}>{Number(e.tokens_balance).toFixed(3)}</td>
                <td style={{ ...td(), color: '#6b7280' }}>{(e.timestamp || '').slice(0, 19).replace('T', ' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function card(): React.CSSProperties { return { background: '#0f172a', border: '1px solid #1f2937', borderRadius: 8, padding: 12 } }
function th(): React.CSSProperties { return { padding: '6px 8px', fontWeight: 500 } }
function td(): React.CSSProperties { return { padding: '6px 8px' } }
