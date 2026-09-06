'use client'

import { useState, useEffect, useCallback } from 'react'

interface LineItem {
  description: string
  quantity: number
  unit_price: number
}

interface Invoice {
  invoice_id: string
  invoice_number?: string
  client_id: string
  client_name?: string
  items: LineItem[]
  total: number
  currency: string
  status: string
  due_date?: string
  notes?: string
  created_at?: string
  paid_at?: string
}

interface Estimate {
  estimate_id: string
  client_id: string
  client_name?: string
  items: LineItem[]
  total: number
  currency: string
  notes?: string
  valid_until?: string
  created_at?: string
}

interface InvoiceStats {
  outstanding_total?: number
  paid_this_month?: number
  overdue_count?: number
  revenue_trend?: number
  currency?: string
}

type TabMode = 'invoices' | 'estimates' | 'stats'

const STATUS_COLORS: Record<string, string> = {
  draft: '#6c7086',
  sent: '#89b4fa',
  viewed: '#cba6f7',
  paid: '#a6e3a1',
  overdue: '#f38ba8',
  void: '#585b70',
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Void',
}

export interface InvoicingPanelProps {
  apiBase?: string
}

export default function InvoicingPanel({ apiBase = '/api/invoicing' }: InvoicingPanelProps) {
  const [tab, setTab] = useState<TabMode>('invoices')
  const [loading, setLoading] = useState(true)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [estimates, setEstimates] = useState<Estimate[]>([])
  const [stats, setStats] = useState<InvoiceStats>({})

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [createMode, setCreateMode] = useState<'invoice' | 'estimate'>('invoice')
  const [newClientId, setNewClientId] = useState('')
  const [newItems, setNewItems] = useState<LineItem[]>([{ description: '', quantity: 1, unit_price: 0 }])
  const [newDueDate, setNewDueDate] = useState('')
  const [newNotes, setNewNotes] = useState('')

  // Filters
  const [filterStatus, setFilterStatus] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterStatus) params.set('status', filterStatus)
      const qs = params.toString()

      const [invoicesRes, estimatesRes, statsRes] = await Promise.all([
        fetch(`${apiBase}/invoices${qs ? `?${qs}` : ''}`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/estimates`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/stats`).then(r => r.ok ? r.json() : null),
      ])

      if (invoicesRes?.data?.invoices) {
        setInvoices(invoicesRes.data.invoices)
      } else if (Array.isArray(invoicesRes?.data)) {
        setInvoices(invoicesRes.data)
      }
      if (estimatesRes?.data?.estimates) {
        setEstimates(estimatesRes.data.estimates)
      } else if (Array.isArray(estimatesRes?.data)) {
        setEstimates(estimatesRes.data)
      }
      if (statsRes?.data) {
        setStats(statsRes.data)
      }
    } catch (e) {
      console.error('Invoicing fetch error:', e)
    }
    setLoading(false)
  }, [apiBase, filterStatus])

  useEffect(() => { fetchData() }, [fetchData])

  const addLineItem = () => {
    setNewItems([...newItems, { description: '', quantity: 1, unit_price: 0 }])
  }

  const removeLineItem = (index: number) => {
    if (newItems.length <= 1) return
    setNewItems(newItems.filter((_, i) => i !== index))
  }

  const updateLineItem = (index: number, field: keyof LineItem, value: string | number) => {
    const updated = [...newItems]
    if (field === 'description') {
      updated[index] = { ...updated[index], description: value as string }
    } else {
      updated[index] = { ...updated[index], [field]: Number(value) || 0 }
    }
    setNewItems(updated)
  }

  const lineTotal = (item: LineItem) => item.quantity * item.unit_price
  const grandTotal = newItems.reduce((sum, item) => sum + lineTotal(item), 0)

  const handleCreate = async () => {
    if (!newClientId || newItems.every(i => !i.description)) return
    const validItems = newItems.filter(i => i.description)

    const endpoint = createMode === 'invoice' ? '/invoices' : '/estimates'
    const payload: any = {
      client_id: newClientId,
      items: validItems,
      notes: newNotes || undefined,
    }
    if (createMode === 'invoice' && newDueDate) {
      payload.due_date = newDueDate
    }

    try {
      const resp = await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (resp.ok) {
        setShowCreate(false)
        setNewClientId('')
        setNewItems([{ description: '', quantity: 1, unit_price: 0 }])
        setNewDueDate('')
        setNewNotes('')
        fetchData()
      }
    } catch (e) {
      console.error('Create error:', e)
    }
  }

  const handleAction = async (invoiceId: string, action: string) => {
    try {
      const resp = await fetch(`${apiBase}/invoices/${invoiceId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (resp.ok) fetchData()
    } catch (e) {
      console.error(`Invoice ${action} error:`, e)
    }
  }

  const handleConvertEstimate = async (estimateId: string) => {
    try {
      const resp = await fetch(`${apiBase}/estimates/${estimateId}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (resp.ok) {
        setTab('invoices')
        fetchData()
      }
    } catch (e) {
      console.error('Convert estimate error:', e)
    }
  }

  const formatCurrency = (amount: number, currency: string = 'USD') => {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
    } catch {
      return `${currency} ${amount.toFixed(2)}`
    }
  }

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    } catch { return iso }
  }

  const inputStyle: React.CSSProperties = {
    padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-deep)', color: 'var(--text)', width: '100%', boxSizing: 'border-box',
  }

  const btnStyle: React.CSSProperties = {
    padding: '6px 14px', borderRadius: 6, border: 'none',
    background: 'var(--accent)', color: '#fff', cursor: 'pointer',
    fontSize: '0.8rem', fontWeight: 600,
  }

  const btnSecondary: React.CSSProperties = {
    ...btnStyle, background: 'transparent', border: '1px solid var(--border)',
    color: 'var(--text-muted)',
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading invoices...
      </div>
    )
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1000, margin: '0 auto' }}>
      {/* Stats row */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12,
        marginBottom: '1.5rem',
      }}>
        {[
          { label: 'Outstanding', value: formatCurrency(stats.outstanding_total || 0, stats.currency), color: '#89b4fa' },
          { label: 'Paid This Month', value: formatCurrency(stats.paid_this_month || 0, stats.currency), color: '#a6e3a1' },
          { label: 'Overdue', value: String(stats.overdue_count || 0), color: '#f38ba8' },
          { label: 'Revenue Trend', value: stats.revenue_trend != null ? `${stats.revenue_trend > 0 ? '+' : ''}${stats.revenue_trend}%` : '--', color: '#cba6f7' },
        ].map(stat => (
          <div key={stat.label} style={{
            padding: '14px 16px', borderRadius: 8, background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
          }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>{stat.label}</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 600, color: stat.color }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Header with tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['invoices', 'estimates', 'stats'] as TabMode[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)',
                background: tab === t ? 'var(--accent)' : 'transparent',
                color: tab === t ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer', fontSize: '0.8rem', textTransform: 'capitalize',
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tab === 'invoices' && (
            <select
              value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              style={{ ...inputStyle, width: 'auto', minWidth: 120 }}
            >
              <option value="">All statuses</option>
              {Object.keys(STATUS_COLORS).map(s => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => { setCreateMode(tab === 'estimates' ? 'estimate' : 'invoice'); setShowCreate(!showCreate) }}
            style={btnStyle}
          >
            + New {tab === 'estimates' ? 'Estimate' : 'Invoice'}
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div style={{
          padding: '1rem', borderRadius: 8, background: 'var(--bg-elevated)',
          border: '1px solid var(--border)', marginBottom: '1rem',
        }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 12 }}>
            New {createMode === 'invoice' ? 'Invoice' : 'Estimate'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <input
              value={newClientId} onChange={e => setNewClientId(e.target.value)}
              placeholder="Client ID or name"
              style={inputStyle}
            />
            {createMode === 'invoice' && (
              <input
                type="date" value={newDueDate} onChange={e => setNewDueDate(e.target.value)}
                style={inputStyle}
              />
            )}
          </div>

          {/* Line items table */}
          <div style={{ marginBottom: 12 }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 40px', gap: 8,
              fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6,
              padding: '0 4px',
            }}>
              <span>Description</span>
              <span>Qty</span>
              <span>Unit Price</span>
              <span>Total</span>
              <span />
            </div>
            {newItems.map((item, idx) => (
              <div key={idx} style={{
                display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 40px', gap: 8,
                marginBottom: 6, alignItems: 'center',
              }}>
                <input
                  value={item.description}
                  onChange={e => updateLineItem(idx, 'description', e.target.value)}
                  placeholder="Item description"
                  style={inputStyle}
                />
                <input
                  type="number" min="0" step="0.5"
                  value={item.quantity}
                  onChange={e => updateLineItem(idx, 'quantity', e.target.value)}
                  style={inputStyle}
                />
                <input
                  type="number" min="0" step="0.01"
                  value={item.unit_price}
                  onChange={e => updateLineItem(idx, 'unit_price', e.target.value)}
                  style={inputStyle}
                />
                <div style={{ fontSize: '0.85rem', fontWeight: 500, padding: '0 4px' }}>
                  {formatCurrency(lineTotal(item))}
                </div>
                <button
                  onClick={() => removeLineItem(idx)}
                  style={{
                    padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)',
                    background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                    fontSize: '0.7rem',
                  }}
                >
                  X
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <button onClick={addLineItem} style={{ ...btnSecondary, fontSize: '0.75rem' }}>
                + Add Line Item
              </button>
              <div style={{ fontSize: '1rem', fontWeight: 600 }}>
                Total: {formatCurrency(grandTotal)}
              </div>
            </div>
          </div>

          <textarea
            value={newNotes} onChange={e => setNewNotes(e.target.value)}
            placeholder="Notes (optional)"
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', marginBottom: 12 }}
          />

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowCreate(false)} style={btnSecondary}>Cancel</button>
            <button onClick={handleCreate} style={btnStyle}>
              Create {createMode === 'invoice' ? 'Invoice' : 'Estimate'}
            </button>
          </div>
        </div>
      )}

      {/* Invoices tab */}
      {tab === 'invoices' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {invoices.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
              No invoices yet. Create your first invoice above.
            </div>
          )}
          {invoices.map(inv => (
            <div
              key={inv.invoice_id}
              style={{
                padding: '12px 16px', borderRadius: 8, background: 'var(--bg-elevated)',
                border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                    {inv.invoice_number || `#${inv.invoice_id.slice(0, 8)}`}
                  </span>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: '0.7rem',
                    background: `${STATUS_COLORS[inv.status] || '#6c7086'}22`,
                    color: STATUS_COLORS[inv.status] || '#6c7086',
                  }}>
                    {STATUS_LABELS[inv.status] || inv.status}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: 12 }}>
                  <span>{inv.client_name || inv.client_id}</span>
                  <span>{formatCurrency(inv.total, inv.currency)}</span>
                  {inv.due_date && <span>Due: {formatDate(inv.due_date)}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {inv.status === 'draft' && (
                  <button onClick={() => handleAction(inv.invoice_id, 'send')} style={{ ...btnSecondary, fontSize: '0.7rem', padding: '4px 10px' }}>
                    Send
                  </button>
                )}
                {(inv.status === 'sent' || inv.status === 'viewed' || inv.status === 'overdue') && (
                  <>
                    <button onClick={() => handleAction(inv.invoice_id, 'remind')} style={{ ...btnSecondary, fontSize: '0.7rem', padding: '4px 10px' }}>
                      Remind
                    </button>
                    <button onClick={() => handleAction(inv.invoice_id, 'mark-paid')} style={{ ...btnStyle, fontSize: '0.7rem', padding: '4px 10px' }}>
                      Mark Paid
                    </button>
                  </>
                )}
                {inv.status !== 'void' && inv.status !== 'paid' && (
                  <button
                    onClick={() => handleAction(inv.invoice_id, 'void')}
                    style={{
                      padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)',
                      background: 'transparent', color: '#585b70', cursor: 'pointer',
                      fontSize: '0.7rem',
                    }}
                  >
                    Void
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Estimates tab */}
      {tab === 'estimates' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {estimates.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
              No estimates yet. Create your first estimate above.
            </div>
          )}
          {estimates.map(est => (
            <div
              key={est.estimate_id}
              style={{
                padding: '12px 16px', borderRadius: 8, background: 'var(--bg-elevated)',
                border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 4 }}>
                  Estimate #{est.estimate_id.slice(0, 8)}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: 12 }}>
                  <span>{est.client_name || est.client_id}</span>
                  <span>{formatCurrency(est.total, est.currency)}</span>
                  <span>{est.items.length} item{est.items.length !== 1 ? 's' : ''}</span>
                  {est.valid_until && <span>Valid until: {formatDate(est.valid_until)}</span>}
                </div>
              </div>
              <button
                onClick={() => handleConvertEstimate(est.estimate_id)}
                style={btnStyle}
              >
                Convert to Invoice
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Stats tab */}
      {tab === 'stats' && (
        <div style={{
          padding: '2rem', borderRadius: 8, background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
        }}>
          <h3 style={{ margin: '0 0 1.5rem 0', fontSize: '1rem' }}>Invoicing Overview</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* By-status breakdown */}
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 10 }}>By Status</div>
              {Object.entries(STATUS_COLORS).map(([status, color]) => {
                const count = invoices.filter(i => i.status === status).length
                const total = invoices.filter(i => i.status === status).reduce((s, i) => s + i.total, 0)
                return (
                  <div key={status} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        width: 10, height: 10, borderRadius: '50%',
                        background: color, display: 'inline-block',
                      }} />
                      <span style={{ fontSize: '0.8rem' }}>{STATUS_LABELS[status]}</span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {count} ({formatCurrency(total, stats.currency)})
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Summary */}
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 10 }}>Summary</div>
              {[
                { label: 'Total Invoices', value: String(invoices.length) },
                { label: 'Total Estimates', value: String(estimates.length) },
                { label: 'Outstanding', value: formatCurrency(stats.outstanding_total || 0, stats.currency) },
                { label: 'Paid This Month', value: formatCurrency(stats.paid_this_month || 0, stats.currency) },
                { label: 'Overdue', value: String(stats.overdue_count || 0) },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{row.label}</span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
