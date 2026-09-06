'use client'

/**
 * ClientsPanel — Billing/CRM panel.
 *
 * Checks /api/billing/status first (Stripe or demo mode).
 * Falls back to local invoicing data from /api/invoicing when billing
 * router is not mounted.
 */

import { useState, useEffect, useCallback } from 'react'

interface ClientSummary {
  name: string
  email?: string
  invoiceCount: number
  totalAmount: number
  lastStatus: string
}

export interface ClientsPanelProps {
  apiBase?: string
  invoicingBase?: string
  integrationName?: string
}

const STATUS_COLORS: Record<string, string> = {
  draft: '#6c7086', sent: '#89b4fa', paid: '#a6e3a1',
  overdue: '#f38ba8', void: '#585b70', viewed: '#cba6f7',
}

export default function ClientsPanel({
  apiBase = '/api/billing',
  invoicingBase = '/api/invoicing',
  integrationName = 'Billing',
}: ClientsPanelProps) {
  const [mode, setMode] = useState<'billing' | 'local' | 'loading'>('loading')
  const [outstanding, setOutstanding] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)

  // Local mode state
  const [clients, setClients] = useState<ClientSummary[]>([])
  const [stats, setStats] = useState<any>(null)
  const [filterStatus, setFilterStatus] = useState('')

  const fetchBilling = useCallback(async () => {
    try {
      const resp = await fetch(`${apiBase}/status`)
      if (resp.ok) {
        const d = await resp.json()
        if (d.connected) {
          setMode('billing')
          const outResp = await fetch(`${apiBase}/outstanding`)
          if (outResp.ok) setOutstanding(await outResp.json())
          return
        }
      }
    } catch {}
    // Billing not available — fall back to local invoicing data
    await fetchLocal()
  }, [apiBase])

  const fetchLocal = useCallback(async () => {
    setMode('local')
    try {
      const [invRes, statsRes] = await Promise.all([
        fetch(`${invoicingBase}/invoices`).then(r => r.ok ? r.json() : null),
        fetch(`${invoicingBase}/stats`).then(r => r.ok ? r.json() : null),
      ])
      if (statsRes?.data) setStats(statsRes.data)
      else if (statsRes && !statsRes.data) setStats(statsRes)

      const invoices: any[] = invRes?.data?.invoices || invRes?.invoices || []
      // Group by client
      const byClient: Record<string, ClientSummary> = {}
      for (const inv of invoices) {
        const data = inv.data || inv
        const name = data.client_name || inv.title || 'Unknown'
        const email = data.client_email || ''
        const key = `${name}::${email}`.toLowerCase()
        if (!byClient[key]) {
          byClient[key] = { name, email, invoiceCount: 0, totalAmount: 0, lastStatus: '' }
        }
        byClient[key].invoiceCount++
        byClient[key].totalAmount += parseFloat(data.total || 0)
        byClient[key].lastStatus = inv.status || data.status || 'draft'
      }
      const sorted = Object.values(byClient).sort((a, b) => b.totalAmount - a.totalAmount)
      setClients(sorted)
    } catch (e) {
      console.error('Clients fetch error:', e)
    }
  }, [invoicingBase])

  useEffect(() => { fetchBilling() }, [fetchBilling])

  const search = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    if (mode === 'billing') {
      try {
        const resp = await fetch(`${apiBase}/customers/search?q=${encodeURIComponent(searchQuery)}`)
        if (resp.ok) setSearchResults(await resp.json())
      } catch {}
    } else {
      const q = searchQuery.toLowerCase()
      setSearchResults(
        clients.filter(c =>
          c.name.toLowerCase().includes(q) ||
          (c.email && c.email.toLowerCase().includes(q))
        )
      )
    }
    setSearching(false)
  }

  const formatCurrency = (amount: number) => {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
    } catch {
      return `$${amount.toFixed(2)}`
    }
  }

  if (mode === 'loading') {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading clients...
      </div>
    )
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Clients</h2>
        <span style={{
          padding: '2px 8px', borderRadius: 4, fontSize: '0.7rem',
          background: mode === 'billing' ? 'rgba(0,200,83,0.15)' : 'rgba(124,58,237,0.15)',
          color: mode === 'billing' ? '#00c853' : '#7c3aed',
        }}>
          {mode === 'billing' ? `${integrationName}: connected` : 'local invoices'}
        </span>
      </div>

      {/* Stats row */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
        marginBottom: '1.5rem',
      }}>
        {mode === 'billing' ? (
          <>
            <div style={{ padding: '14px 16px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>Outstanding</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#89b4fa' }}>
                {formatCurrency(outstanding?.outstanding_total ?? outstanding?.total_outstanding ?? 0)}
              </div>
            </div>
            <div style={{ padding: '14px 16px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>Invoices</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>{outstanding?.invoice_count ?? 0}</div>
            </div>
            <div style={{ padding: '14px 16px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>Mode</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#a6e3a1' }}>Live</div>
            </div>
          </>
        ) : (
          <>
            <div style={{ padding: '14px 16px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>Clients</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>{clients.length}</div>
            </div>
            <div style={{ padding: '14px 16px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>Outstanding</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#89b4fa' }}>
                {formatCurrency(stats?.total_outstanding ?? 0)}
              </div>
            </div>
            <div style={{ padding: '14px 16px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>Paid</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#a6e3a1' }}>
                {formatCurrency(stats?.total_paid ?? 0)}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Search */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="Search clients by name or email..."
            style={{
              flex: 1, padding: '8px 12px', background: 'var(--bg-deep)',
              color: 'var(--text)', border: '1px solid var(--border)',
              borderRadius: 6, fontSize: '0.85rem',
            }}
          />
          <button onClick={search} disabled={searching} style={{
            padding: '8px 16px', background: 'var(--accent)', color: '#fff',
            borderRadius: 6, fontSize: '0.85rem', cursor: 'pointer', border: 'none', fontWeight: 600,
          }}>Search</button>
        </div>
      </div>

      {/* Client list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(searchQuery && searchResults.length > 0 ? searchResults : clients).map((client: any, i: number) => (
          <div key={i} style={{
            padding: '12px 16px', borderRadius: 8, background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{client.name || 'Unnamed'}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {client.email || ''}
                {client.invoiceCount != null && ` · ${client.invoiceCount} invoice${client.invoiceCount !== 1 ? 's' : ''}`}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {client.lastStatus && (
                <span style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: '0.7rem',
                  background: `${STATUS_COLORS[client.lastStatus] || '#6c7086'}22`,
                  color: STATUS_COLORS[client.lastStatus] || '#6c7086',
                }}>
                  {client.lastStatus}
                </span>
              )}
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                {formatCurrency(client.totalAmount ?? client.amount ?? 0)}
              </span>
            </div>
          </div>
        ))}
        {clients.length === 0 && !searchQuery && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
            No clients yet. Create invoices to see clients here.
          </div>
        )}
        {searchQuery && searchResults.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>
            No clients matching "{searchQuery}".
          </div>
        )}
      </div>
    </div>
  )
}
