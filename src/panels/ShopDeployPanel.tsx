'use client'

import { useCallback, useState } from 'react'

// ---------------------------------------------------------------------------
// White-Label Shop deploy wizard — brand → domain → Stripe → plan → deploy.
// Talks to the portal-kit-backend shop proxy (default /api/v1/shop).
// ---------------------------------------------------------------------------

const C = {
  bg: '#1e1e2e', panel: '#181825', text: '#cdd6f4', sub: '#a6adc8',
  line: '#313244', accent: '#89b4fa', good: '#a6e3a1', warn: '#f9e2af', bad: '#f38ba8',
}

interface PlanTier {
  key: string
  name: string
  price_usd: number
  blurb: string
}

const TIERS: PlanTier[] = [
  { key: 'starter', name: 'Starter', price_usd: 49, blurb: '100 products · 500 orders/mo · preset themes' },
  { key: 'professional', name: 'Professional', price_usd: 149, blurb: 'Unlimited · full theming · custom domain · discounts' },
  { key: 'enterprise', name: 'Enterprise', price_usd: 499, blurb: 'SSO · API access · analytics · priority support' },
]

const STEPS = ['Brand', 'Domain', 'Stripe', 'Plan', 'Deploy'] as const

export interface ShopDeployPanelProps {
  apiBase?: string
  onDeploySuccess?: (shopId: string) => void
}

export default function ShopDeployPanel({ apiBase = '/api/v1/shop', onDeploySuccess }: ShopDeployPanelProps) {
  const [step, setStep] = useState(0)
  const [shopName, setShopName] = useState('')
  const [primary, setPrimary] = useState('#00E5FF')
  const [secondary, setSecondary] = useState('#7C4DFF')
  const [subdomain, setSubdomain] = useState('')
  const [subOk, setSubOk] = useState<boolean | null>(null)
  const [stripeKey, setStripeKey] = useState('')
  const [stripeOk, setStripeOk] = useState<boolean | null>(null)
  const [tier, setTier] = useState('starter')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deploy, setDeploy] = useState<{ status: string; shop_id?: string; url?: string } | null>(null)

  const api = useCallback(async (path: string, opts?: RequestInit) => {
    const resp = await fetch(`${apiBase}${path}`, {
      headers: { 'Content-Type': 'application/json' }, ...opts,
    })
    return resp.json()
  }, [apiBase])

  const checkSubdomain = useCallback(async () => {
    setSubOk(null)
    try {
      const r = await api(`/check-subdomain?subdomain=${encodeURIComponent(subdomain)}`)
      setSubOk(!!r.available)
    } catch { setSubOk(null) }
  }, [api, subdomain])

  const validateStripe = useCallback(async () => {
    setStripeOk(null); setError('')
    try {
      const r = await api('/validate-stripe-key', {
        method: 'POST', body: JSON.stringify({ stripe_secret_key: stripeKey }),
      })
      setStripeOk(!!r.valid)
      if (!r.valid) setError(r.error || 'Stripe key rejected')
    } catch (e) { setStripeOk(false); setError(String(e)) }
  }, [api, stripeKey])

  const runDeploy = useCallback(async () => {
    setBusy(true); setError('')
    try {
      const r = await api('/deploy', {
        method: 'POST',
        body: JSON.stringify({
          shop_name: shopName, subdomain, shop_tier: tier,
          primary_color: primary, secondary_color: secondary,
          stripe_secret_key: stripeKey,
        }),
      })
      if (r.error) { setError(r.error); setBusy(false); return }
      setDeploy({ status: r.status || 'pending', shop_id: r.shop_id, url: r.subdomain })
      // Poll status
      const id = r.shop_id
      if (id) {
        const poll = setInterval(async () => {
          const s = await api(`/${id}/status`)
          setDeploy({ status: s.status, shop_id: id, url: s.url || r.subdomain })
          if (s.status === 'complete' || s.status === 'failed') {
            clearInterval(poll)
            setBusy(false)
            if (s.status === 'complete') onDeploySuccess?.(id)
          }
        }, 2000)
      } else { setBusy(false) }
    } catch (e) { setError(String(e)); setBusy(false) }
  }, [api, shopName, subdomain, tier, primary, secondary, stripeKey, onDeploySuccess])

  const wrap: React.CSSProperties = { background: C.bg, color: C.text, padding: 24, minHeight: '100%' }
  const card: React.CSSProperties = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 20, maxWidth: 640 }
  const input: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.line}`, background: C.bg, color: C.text, marginTop: 4 }
  const btn = (bg: string): React.CSSProperties => ({ padding: '8px 16px', borderRadius: 8, border: 'none', background: bg, color: '#11111b', fontWeight: 600, cursor: 'pointer' })

  return (
    <div style={wrap}>
      {/* Stepper */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{
            flex: 1, textAlign: 'center', padding: '6px 0', borderRadius: 8, fontSize: 13,
            background: i === step ? C.accent : C.panel, color: i === step ? '#11111b' : C.sub,
            border: `1px solid ${i <= step ? C.accent : C.line}`,
          }}>{i + 1}. {s}</div>
        ))}
      </div>

      <div style={card}>
        {step === 0 && (
          <>
            <h3 style={{ marginTop: 0 }}>Brand &amp; theme</h3>
            <label>Shop name<input style={input} value={shopName} onChange={e => setShopName(e.target.value)} placeholder="Acme Goods" /></label>
            <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
              <label>Primary<br /><input type="color" value={primary} onChange={e => setPrimary(e.target.value)} /></label>
              <label>Secondary<br /><input type="color" value={secondary} onChange={e => setSecondary(e.target.value)} /></label>
            </div>
            {/* Live preview swatch */}
            <div style={{ marginTop: 16, borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.line}` }}>
              <div style={{ background: primary, padding: '14px 16px', color: '#11111b', fontWeight: 700 }}>
                {shopName || 'Your Shop'}
              </div>
              <div style={{ padding: 16, background: C.panel }}>
                <span style={{ background: secondary, color: '#11111b', padding: '6px 12px', borderRadius: 8, fontWeight: 600 }}>Add to cart</span>
              </div>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h3 style={{ marginTop: 0 }}>Domain</h3>
            <label>Subdomain
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input style={{ ...input, flex: 1 }} value={subdomain} onChange={e => { setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setSubOk(null) }} placeholder="acme" />
                <span style={{ color: C.sub }}>.aitherium.com</span>
                <button style={btn(C.accent)} onClick={checkSubdomain} disabled={!subdomain}>Check</button>
              </div>
            </label>
            {subOk === true && <p style={{ color: C.good }}>✓ Available</p>}
            {subOk === false && <p style={{ color: C.bad }}>✗ Taken — try another</p>}
          </>
        )}

        {step === 2 && (
          <>
            <h3 style={{ marginTop: 0 }}>Connect Stripe</h3>
            <p style={{ color: C.sub, fontSize: 13 }}>Your own Stripe secret key. Stored in your tenant-scoped vault — we never see it.</p>
            <label>Stripe secret key
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...input, flex: 1 }} type="password" value={stripeKey} onChange={e => { setStripeKey(e.target.value); setStripeOk(null) }} placeholder="sk_live_…" />
                <button style={btn(C.accent)} onClick={validateStripe} disabled={!stripeKey}>Test</button>
              </div>
            </label>
            {stripeOk === true && <p style={{ color: C.good }}>✓ Stripe key valid</p>}
            {stripeOk === false && <p style={{ color: C.bad }}>✗ {error || 'Invalid key'}</p>}
          </>
        )}

        {step === 3 && (
          <>
            <h3 style={{ marginTop: 0 }}>Choose a plan</h3>
            {TIERS.map(t => (
              <div key={t.key} onClick={() => setTier(t.key)} style={{
                padding: 14, marginBottom: 10, borderRadius: 10, cursor: 'pointer',
                background: tier === t.key ? `${C.accent}22` : C.bg,
                border: `1px solid ${tier === t.key ? C.accent : C.line}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{t.name}</strong><span style={{ color: C.accent }}>${t.price_usd}/mo</span>
                </div>
                <div style={{ color: C.sub, fontSize: 13 }}>{t.blurb}</div>
              </div>
            ))}
          </>
        )}

        {step === 4 && (
          <>
            <h3 style={{ marginTop: 0 }}>Review &amp; deploy</h3>
            <ul style={{ color: C.sub, lineHeight: 1.8 }}>
              <li>Shop: <b style={{ color: C.text }}>{shopName || '—'}</b></li>
              <li>URL: <b style={{ color: C.text }}>{subdomain || '—'}.aitherium.com</b></li>
              <li>Plan: <b style={{ color: C.text }}>{tier}</b></li>
              <li>Stripe: <b style={{ color: stripeOk ? C.good : C.warn }}>{stripeOk ? 'connected' : 'connect after deploy'}</b></li>
            </ul>
            {!deploy && <button style={btn(C.good)} onClick={runDeploy} disabled={busy || !subdomain}>Deploy now</button>}
            {deploy && (
              <div style={{ marginTop: 12 }}>
                <p>Status: <b style={{ color: deploy.status === 'complete' ? C.good : deploy.status === 'failed' ? C.bad : C.warn }}>{deploy.status}</b></p>
                {deploy.status === 'complete' && <p style={{ color: C.good }}>Live at {deploy.url}</p>}
              </div>
            )}
          </>
        )}

        {error && step !== 2 && <p style={{ color: C.bad }}>{error}</p>}

        {/* Nav */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
          <button style={{ ...btn(C.line), color: C.text }} onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0 || busy}>Back</button>
          {step < 4 && <button style={btn(C.accent)} onClick={() => setStep(s => Math.min(4, s + 1))}>Next</button>}
        </div>
      </div>
    </div>
  )
}
