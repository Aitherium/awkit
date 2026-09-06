'use client'

import { useState, useEffect, useCallback } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectStatus {
  connected: boolean
  account_id?: string
  charges_enabled?: boolean
  payouts_enabled?: boolean
  details_submitted?: boolean
  requirements_currently_due?: string[]
}

interface Product {
  id: string
  name: string
  description: string
  active: boolean
  images: string[]
  prices: { id: string; unit_amount: number; currency: string; recurring: { interval: string } | null }[]
}

interface Payment {
  id: string
  amount: number
  currency: string
  status: string
  customer_email: string
  description: string
  created: number
  refunded: boolean
}

interface Subscription {
  id: string
  customer: string
  status: string
  current_period_end: number
  amount: number
  interval: string
}

interface Customer {
  id: string
  email: string
  name: string
  created: number
}

interface Coupon {
  id: string
  name: string
  percent_off: number | null
  amount_off: number
  duration: string
  times_redeemed: number
  max_redemptions: number | null
}

interface Revenue {
  gross_revenue: number
  available: number
  pending: number
  currency: string
}

interface Payout {
  id: string
  amount: number
  currency: string
  status: string
  arrival_date: number
  created: number
}

interface StorefrontConfig {
  tenant_id: string
  store_name: string
  logo_url: string
  accent_color: string
  tax_behavior: string
  success_url: string
  cancel_url: string
  platform_fee_bps: number
}

type TabMode = 'overview' | 'products' | 'payments' | 'subscriptions' | 'customers' | 'coupons' | 'settings'

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  succeeded: '#a6e3a1',
  active: '#a6e3a1',
  pending: '#f9e2af',
  past_due: '#fab387',
  failed: '#f38ba8',
  canceled: '#6c7086',
  refunded: '#cba6f7',
  paid: '#a6e3a1',
}

const TABS: { id: TabMode; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'chart-bar' },
  { id: 'products', label: 'Products', icon: 'package' },
  { id: 'payments', label: 'Payments', icon: 'credit-card' },
  { id: 'subscriptions', label: 'Subscriptions', icon: 'repeat' },
  { id: 'customers', label: 'Customers', icon: 'users' },
  { id: 'coupons', label: 'Coupons', icon: 'tag' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(amount: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || '#9399b2'
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 12,
      fontSize: 12, fontWeight: 600, letterSpacing: '0.02em',
      background: `${color}22`, color, border: `1px solid ${color}44`,
    }}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  apiBase?: string
}

export default function StripeCommercePanel({ apiBase = '/api/v1/commerce' }: Props) {
  const [tab, setTab] = useState<TabMode>('overview')
  const [connect, setConnect] = useState<ConnectStatus | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [revenue, setRevenue] = useState<Revenue | null>(null)
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [storefront, setStorefront] = useState<StorefrontConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // -- New product form
  const [showNewProduct, setShowNewProduct] = useState(false)
  const [newProduct, setNewProduct] = useState({ name: '', description: '', price: '', recurring: '' })

  // -- Onboarding
  const [onboardEmail, setOnboardEmail] = useState('')

  const api = useCallback(async (path: string, opts?: RequestInit) => {
    const resp = await fetch(`${apiBase}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    })
    return resp.json()
  }, [apiBase])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [cs, ps, pays, subs, custs, rev, pos, sf] = await Promise.all([
        api('/connect/status'),
        api('/products'),
        api('/payments'),
        api('/subscriptions'),
        api('/customers'),
        api('/revenue'),
        api('/payouts'),
        api('/storefront'),
      ])
      setConnect(cs)
      setProducts(ps.products || [])
      setPayments(pays.payments || [])
      setSubscriptions(subs.subscriptions || [])
      setCustomers(custs.customers || [])
      setRevenue(rev)
      setPayouts(pos.payouts || [])
      setStorefront(sf)
    } catch (e: any) {
      setError(e.message || 'Failed to load commerce data')
    }
    setLoading(false)
  }, [api])

  useEffect(() => { loadAll() }, [loadAll])

  const loadCoupons = useCallback(async () => {
    const data = await api('/coupons')
    setCoupons(data.coupons || [])
  }, [api])

  useEffect(() => {
    if (tab === 'coupons') loadCoupons()
  }, [tab, loadCoupons])

  // -- Onboarding flow
  const handleOnboard = async () => {
    if (!onboardEmail) return
    const res = await api('/connect/onboard', {
      method: 'POST',
      body: JSON.stringify({ email: onboardEmail }),
    })
    if (res.onboarding_url) {
      window.open(res.onboarding_url, '_blank')
    }
    setOnboardEmail('')
    setTimeout(loadAll, 3000)
  }

  // -- Create product
  const handleCreateProduct = async () => {
    if (!newProduct.name) return
    await api('/products', {
      method: 'POST',
      body: JSON.stringify({
        name: newProduct.name,
        description: newProduct.description,
        price_cents: Math.round(parseFloat(newProduct.price || '0') * 100),
        recurring_interval: newProduct.recurring,
      }),
    })
    setShowNewProduct(false)
    setNewProduct({ name: '', description: '', price: '', recurring: '' })
    const ps = await api('/products')
    setProducts(ps.products || [])
  }

  // -- Styles
  const card: React.CSSProperties = {
    background: '#1e1e2e', borderRadius: 12, padding: 20,
    border: '1px solid #313244', marginBottom: 16,
  }
  const statCard: React.CSSProperties = {
    ...card, flex: 1, minWidth: 180, textAlign: 'center' as const,
  }
  const label: React.CSSProperties = {
    fontSize: 12, color: '#a6adc8', marginBottom: 4, textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  }
  const value: React.CSSProperties = { fontSize: 28, fontWeight: 700, color: '#cdd6f4' }
  const input: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 8,
    border: '1px solid #45475a', background: '#181825', color: '#cdd6f4',
    fontSize: 14, outline: 'none', marginBottom: 8,
  }
  const btn: React.CSSProperties = {
    padding: '8px 20px', borderRadius: 8, border: 'none',
    background: '#6366f1', color: '#fff', fontWeight: 600,
    cursor: 'pointer', fontSize: 14,
  }
  const btnSecondary: React.CSSProperties = {
    ...btn, background: '#313244', color: '#cdd6f4',
  }
  const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' as const }
  const th: React.CSSProperties = {
    textAlign: 'left' as const, padding: '8px 12px', fontSize: 12,
    color: '#a6adc8', borderBottom: '1px solid #313244',
    textTransform: 'uppercase' as const, letterSpacing: '0.05em',
  }
  const td: React.CSSProperties = {
    padding: '10px 12px', fontSize: 14, color: '#cdd6f4',
    borderBottom: '1px solid #1e1e2e',
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#a6adc8' }}>
        Loading commerce data...
      </div>
    )
  }

  // -- Not connected: show onboarding
  if (connect && !connect.connected) {
    return (
      <div style={{ padding: 32, maxWidth: 560, margin: '0 auto' }}>
        <div style={card}>
          <h2 style={{ color: '#cdd6f4', marginTop: 0 }}>Connect Your Stripe Account</h2>
          <p style={{ color: '#a6adc8', lineHeight: 1.6 }}>
            Set up Stripe Connect to accept payments through your storefront.
            Aitherium handles payment routing, and you receive funds directly
            to your bank account.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <input
              type="email"
              placeholder="your@email.com"
              value={onboardEmail}
              onChange={e => setOnboardEmail(e.target.value)}
              style={{ ...input, marginBottom: 0, flex: 1 }}
            />
            <button onClick={handleOnboard} style={btn}>
              Start Onboarding
            </button>
          </div>
        </div>
      </div>
    )
  }

  // -- KYC incomplete
  if (connect && !connect.charges_enabled) {
    return (
      <div style={{ padding: 32, maxWidth: 560, margin: '0 auto' }}>
        <div style={{ ...card, borderColor: '#fab387' }}>
          <h2 style={{ color: '#fab387', marginTop: 0 }}>Complete Your Stripe Setup</h2>
          <p style={{ color: '#a6adc8', lineHeight: 1.6 }}>
            Your Stripe account is created but verification is incomplete.
            Please complete the onboarding process to start accepting payments.
          </p>
          {connect.requirements_currently_due && connect.requirements_currently_due.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={label}>Requirements due</div>
              <ul style={{ color: '#cdd6f4', paddingLeft: 20 }}>
                {connect.requirements_currently_due.map(r => (
                  <li key={r} style={{ marginBottom: 4 }}>{r.replace(/_/g, ' ')}</li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={async () => {
              const res = await api('/connect/onboard', {
                method: 'POST', body: JSON.stringify({ email: '' }),
              })
              if (res.onboarding_url) window.open(res.onboarding_url, '_blank')
            }}
            style={{ ...btn, marginTop: 16 }}
          >
            Continue Onboarding
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 24 }}>
      {error && (
        <div style={{ ...card, borderColor: '#f38ba8', color: '#f38ba8', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid #313244',
        paddingBottom: 2, overflowX: 'auto',
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 16px', border: 'none', borderRadius: '8px 8px 0 0',
              background: tab === t.id ? '#313244' : 'transparent',
              color: tab === t.id ? '#cdd6f4' : '#6c7086',
              fontWeight: tab === t.id ? 600 : 400, cursor: 'pointer',
              fontSize: 14, transition: 'all 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview ──────────────────────────────── */}
      {tab === 'overview' && (
        <>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
            <div style={statCard}>
              <div style={label}>Available</div>
              <div style={value}>{formatCurrency(revenue?.available || 0)}</div>
            </div>
            <div style={statCard}>
              <div style={label}>Pending</div>
              <div style={value}>{formatCurrency(revenue?.pending || 0)}</div>
            </div>
            <div style={statCard}>
              <div style={label}>Products</div>
              <div style={value}>{products.length}</div>
            </div>
            <div style={statCard}>
              <div style={label}>Active Subscriptions</div>
              <div style={value}>{subscriptions.filter(s => s.status === 'active').length}</div>
            </div>
            <div style={statCard}>
              <div style={label}>Customers</div>
              <div style={value}>{customers.length}</div>
            </div>
          </div>

          {/* Recent payments */}
          <div style={card}>
            <h3 style={{ color: '#cdd6f4', marginTop: 0 }}>Recent Payments</h3>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Customer</th>
                  <th style={th}>Amount</th>
                  <th style={th}>Status</th>
                  <th style={th}>Date</th>
                </tr>
              </thead>
              <tbody>
                {payments.slice(0, 5).map(p => (
                  <tr key={p.id}>
                    <td style={td}>{p.customer_email || 'N/A'}</td>
                    <td style={td}>{formatCurrency(p.amount)}</td>
                    <td style={td}><StatusBadge status={p.status} /></td>
                    <td style={td}>{formatDate(p.created)}</td>
                  </tr>
                ))}
                {payments.length === 0 && (
                  <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: '#6c7086' }}>No payments yet</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Recent payouts */}
          <div style={card}>
            <h3 style={{ color: '#cdd6f4', marginTop: 0 }}>Recent Payouts</h3>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Amount</th>
                  <th style={th}>Status</th>
                  <th style={th}>Arrival</th>
                </tr>
              </thead>
              <tbody>
                {payouts.slice(0, 5).map(p => (
                  <tr key={p.id}>
                    <td style={td}>{formatCurrency(p.amount)}</td>
                    <td style={td}><StatusBadge status={p.status} /></td>
                    <td style={td}>{formatDate(p.arrival_date)}</td>
                  </tr>
                ))}
                {payouts.length === 0 && (
                  <tr><td colSpan={3} style={{ ...td, textAlign: 'center', color: '#6c7086' }}>No payouts yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Products ──────────────────────────────── */}
      {tab === 'products' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ color: '#cdd6f4', margin: 0 }}>Products</h3>
            <button onClick={() => setShowNewProduct(!showNewProduct)} style={btn}>
              {showNewProduct ? 'Cancel' : '+ Add Product'}
            </button>
          </div>

          {showNewProduct && (
            <div style={{ ...card, background: '#181825', marginBottom: 16 }}>
              <input
                placeholder="Product name"
                value={newProduct.name}
                onChange={e => setNewProduct(p => ({ ...p, name: e.target.value }))}
                style={input}
              />
              <input
                placeholder="Description"
                value={newProduct.description}
                onChange={e => setNewProduct(p => ({ ...p, description: e.target.value }))}
                style={input}
              />
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                  placeholder="Price (USD)"
                  type="number"
                  step="0.01"
                  value={newProduct.price}
                  onChange={e => setNewProduct(p => ({ ...p, price: e.target.value }))}
                  style={{ ...input, flex: 1, marginBottom: 0 }}
                />
                <select
                  value={newProduct.recurring}
                  onChange={e => setNewProduct(p => ({ ...p, recurring: e.target.value }))}
                  style={{ ...input, flex: 1, marginBottom: 0 }}
                >
                  <option value="">One-time</option>
                  <option value="month">Monthly</option>
                  <option value="year">Yearly</option>
                </select>
              </div>
              <button onClick={handleCreateProduct} style={btn}>Create Product</button>
            </div>
          )}

          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Price</th>
                <th style={th}>Type</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => {
                const price = p.prices[0]
                return (
                  <tr key={p.id}>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      {p.description && <div style={{ fontSize: 12, color: '#6c7086', marginTop: 2 }}>{p.description}</div>}
                    </td>
                    <td style={td}>{price ? formatCurrency(price.unit_amount / 100) : 'Free'}</td>
                    <td style={td}>{price?.recurring ? `${price.recurring.interval}ly` : 'One-time'}</td>
                    <td style={td}><StatusBadge status={p.active ? 'active' : 'inactive'} /></td>
                  </tr>
                )
              })}
              {products.length === 0 && (
                <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: '#6c7086' }}>No products — create one to get started</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Payments ──────────────────────────────── */}
      {tab === 'payments' && (
        <div style={card}>
          <h3 style={{ color: '#cdd6f4', marginTop: 0 }}>Payments</h3>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>ID</th>
                <th style={th}>Customer</th>
                <th style={th}>Amount</th>
                <th style={th}>Status</th>
                <th style={th}>Date</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id}>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{p.id.slice(0, 16)}...</td>
                  <td style={td}>{p.customer_email || 'N/A'}</td>
                  <td style={td}>{formatCurrency(p.amount)}</td>
                  <td style={td}><StatusBadge status={p.refunded ? 'refunded' : p.status} /></td>
                  <td style={td}>{formatDate(p.created)}</td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#6c7086' }}>No payments yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Subscriptions ─────────────────────────── */}
      {tab === 'subscriptions' && (
        <div style={card}>
          <h3 style={{ color: '#cdd6f4', marginTop: 0 }}>Subscriptions</h3>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>ID</th>
                <th style={th}>Amount</th>
                <th style={th}>Interval</th>
                <th style={th}>Status</th>
                <th style={th}>Renews</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map(s => (
                <tr key={s.id}>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{s.id.slice(0, 16)}...</td>
                  <td style={td}>{formatCurrency(s.amount)}</td>
                  <td style={td}>{s.interval || 'N/A'}</td>
                  <td style={td}><StatusBadge status={s.status} /></td>
                  <td style={td}>{s.current_period_end ? formatDate(s.current_period_end) : 'N/A'}</td>
                </tr>
              ))}
              {subscriptions.length === 0 && (
                <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#6c7086' }}>No subscriptions yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Customers ─────────────────────────────── */}
      {tab === 'customers' && (
        <div style={card}>
          <h3 style={{ color: '#cdd6f4', marginTop: 0 }}>Customers</h3>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Email</th>
                <th style={th}>Since</th>
              </tr>
            </thead>
            <tbody>
              {customers.map(c => (
                <tr key={c.id}>
                  <td style={td}>{c.name || 'N/A'}</td>
                  <td style={td}>{c.email || 'N/A'}</td>
                  <td style={td}>{formatDate(c.created)}</td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr><td colSpan={3} style={{ ...td, textAlign: 'center', color: '#6c7086' }}>No customers yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Coupons ───────────────────────────────── */}
      {tab === 'coupons' && (
        <div style={card}>
          <h3 style={{ color: '#cdd6f4', marginTop: 0 }}>Coupons</h3>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Discount</th>
                <th style={th}>Duration</th>
                <th style={th}>Used</th>
              </tr>
            </thead>
            <tbody>
              {coupons.map(c => (
                <tr key={c.id}>
                  <td style={td}>{c.name}</td>
                  <td style={td}>
                    {c.percent_off ? `${c.percent_off}%` : formatCurrency(c.amount_off)}
                  </td>
                  <td style={td}>{c.duration}</td>
                  <td style={td}>
                    {c.times_redeemed}{c.max_redemptions ? ` / ${c.max_redemptions}` : ''}
                  </td>
                </tr>
              ))}
              {coupons.length === 0 && (
                <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: '#6c7086' }}>No coupons — create one via MCP tools or CLI</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Settings ──────────────────────────────── */}
      {tab === 'settings' && storefront && (
        <div style={card}>
          <h3 style={{ color: '#cdd6f4', marginTop: 0 }}>Storefront Settings</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={label}>Store Name</div>
              <div style={{ color: '#cdd6f4', fontSize: 16 }}>{storefront.store_name || 'Not set'}</div>
            </div>
            <div>
              <div style={label}>Platform Fee</div>
              <div style={{ color: '#cdd6f4', fontSize: 16 }}>{(storefront.platform_fee_bps / 100).toFixed(1)}%</div>
            </div>
            <div>
              <div style={label}>Tax Behavior</div>
              <div style={{ color: '#cdd6f4', fontSize: 16 }}>{storefront.tax_behavior}</div>
            </div>
            <div>
              <div style={label}>Accent Color</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 4,
                  background: storefront.accent_color || '#6366f1',
                  border: '1px solid #45475a',
                }} />
                <span style={{ color: '#cdd6f4', fontFamily: 'monospace' }}>
                  {storefront.accent_color || '#6366f1'}
                </span>
              </div>
            </div>
            <div>
              <div style={label}>Success URL</div>
              <div style={{ color: '#89b4fa', fontSize: 13, wordBreak: 'break-all' }}>
                {storefront.success_url || 'Default'}
              </div>
            </div>
            <div>
              <div style={label}>Cancel URL</div>
              <div style={{ color: '#89b4fa', fontSize: 13, wordBreak: 'break-all' }}>
                {storefront.cancel_url || 'Default'}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 24 }}>
            <h4 style={{ color: '#cdd6f4' }}>Stripe Connect</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={label}>Account ID</div>
                <div style={{ color: '#cdd6f4', fontFamily: 'monospace', fontSize: 13 }}>
                  {connect?.account_id || 'N/A'}
                </div>
              </div>
              <div>
                <div style={label}>Charges</div>
                <StatusBadge status={connect?.charges_enabled ? 'active' : 'pending'} />
              </div>
              <div>
                <div style={label}>Payouts</div>
                <StatusBadge status={connect?.payouts_enabled ? 'active' : 'pending'} />
              </div>
            </div>
            <button
              onClick={async () => {
                const res = await api('/connect/dashboard')
                if (res.url) window.open(res.url, '_blank')
              }}
              style={{ ...btnSecondary, marginTop: 16 }}
            >
              Open Stripe Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
