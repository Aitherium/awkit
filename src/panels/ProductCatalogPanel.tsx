'use client'

import { useCallback, useEffect, useState } from 'react'

// ---------------------------------------------------------------------------
// Product catalog admin for a white-label shop. Full CRUD against the
// shop_admin endpoints (/api/shop/products): list, create, publish, delete.
// ---------------------------------------------------------------------------

const C = {
  bg: '#1e1e2e', panel: '#181825', text: '#cdd6f4', sub: '#a6adc8',
  line: '#313244', accent: '#89b4fa', good: '#a6e3a1', warn: '#f9e2af', bad: '#f38ba8',
}

interface Product {
  id: string
  name: string
  description: string
  category: string
  price: string
  price_cents: number
  status: string
  featured: boolean
  stock_quantity: number
}

export interface ProductCatalogPanelProps {
  apiBase?: string
}

export default function ProductCatalogPanel({ apiBase = '/api/shop' }: ProductCatalogPanelProps) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ name: '', price: '', category: 'uncategorized', description: '' })
  const [busy, setBusy] = useState(false)

  const api = useCallback(async (path: string, opts?: RequestInit) => {
    const r = await fetch(`${apiBase}${path}`, {
      headers: { 'Content-Type': 'application/json' }, ...opts,
    })
    if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(() => '')}`.slice(0, 120))
    return r.json()
  }, [apiBase])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await api('/products')
      setProducts(r.products || r || [])
    } catch (e) { setError(String(e)) } finally { setLoading(false) }
  }, [api])

  useEffect(() => { load() }, [load])

  const create = useCallback(async () => {
    if (!form.name) return
    setBusy(true); setError('')
    try {
      await api('/products', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          category: form.category || 'uncategorized',
          price_cents: Math.round(parseFloat(form.price || '0') * 100),
        }),
      })
      setForm({ name: '', price: '', category: 'uncategorized', description: '' })
      setShowNew(false)
      await load()
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }, [api, form, load])

  const publish = useCallback(async (id: string) => {
    try { await api(`/products/${id}/publish`, { method: 'POST' }); await load() } catch (e) { setError(String(e)) }
  }, [api, load])

  const remove = useCallback(async (id: string) => {
    try { await api(`/products/${id}`, { method: 'DELETE' }); await load() } catch (e) { setError(String(e)) }
  }, [api, load])

  const wrap: React.CSSProperties = { background: C.bg, color: C.text, padding: 24, minHeight: '100%' }
  const card: React.CSSProperties = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16 }
  const input: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.line}`, background: C.bg, color: C.text, marginTop: 4 }
  const btn = (bg: string): React.CSSProperties => ({ padding: '7px 14px', borderRadius: 8, border: 'none', background: bg, color: '#11111b', fontWeight: 600, cursor: 'pointer' })

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>Product Catalog</h3>
        <button style={btn(C.accent)} onClick={() => setShowNew(s => !s)}>{showNew ? 'Cancel' : '+ New product'}</button>
      </div>

      {showNew && (
        <div style={{ ...card, marginBottom: 16, maxWidth: 520 }}>
          <label>Name<input style={input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <label style={{ flex: 1 }}>Price (USD)<input style={input} value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="19.99" /></label>
            <label style={{ flex: 1 }}>Category<input style={input} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /></label>
          </div>
          <label>Description<input style={input} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          <button style={{ ...btn(C.good), marginTop: 12 }} onClick={create} disabled={busy || !form.name}>{busy ? 'Creating…' : 'Create product'}</button>
        </div>
      )}

      {error && <p style={{ color: C.bad }}>{error}</p>}
      {loading ? <p style={{ color: C.sub }}>Loading…</p> : (
        <div style={card}>
          {products.length === 0 ? <p style={{ color: C.sub }}>No products yet. Add your first one.</p> : products.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: `1px solid ${C.line}` }}>
              <div>
                <strong>{p.name}</strong> <span style={{ color: C.accent }}>{p.price}</span>
                <span style={{ marginLeft: 10, fontSize: 12, color: p.status === 'active' ? C.good : C.warn }}>{p.status}</span>
                <div style={{ color: C.sub, fontSize: 12 }}>{p.category}{p.description ? ` · ${p.description.slice(0, 60)}` : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {p.status !== 'active' && <button style={btn(C.good)} onClick={() => publish(p.id)}>Publish</button>}
                <button style={btn(C.bad)} onClick={() => remove(p.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
