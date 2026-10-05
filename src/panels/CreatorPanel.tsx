'use client'

/**
 * Creator: build, publish and earn on the Aitherium community marketplace.
 *
 * The tenant app's backend (`/api/creator/*`, awkit-backend routers/creator.py)
 * talks to Genesis as the signed-in person, so everything shown here is that
 * person's own: their publisher application, their listings, their earnings and
 * their Stripe payout account. Four steps, top to bottom:
 *
 *   1. Apply to publish (a moderator approves publishers).
 *   2. Submit a listing and upload its bundle (or `adk pack publish <dir>`).
 *   3. See sales and earnings; request a payout once over the minimum.
 *   4. Connect a Stripe payout account (hosted Stripe onboarding).
 *
 * Prices are whatever the creator types, in cents; nothing here suggests one.
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { getApiBase } from '../lib/apiBase'

interface PublisherStatus {
  status?: 'none' | 'pending' | 'approved' | 'rejected' | 'suspended'
  can_publish?: boolean
}

interface PayoutAccount {
  connected?: boolean
  payouts_enabled?: boolean
  details_submitted?: boolean
}

interface StatusView {
  publisher: PublisherStatus | null
  publisher_status_code: number
  payout: PayoutAccount | null
  payout_status_code: number
}

interface Listing {
  id: string
  name: string
  kind: string
  version?: string
  status: string
  one_time_cents?: number
  subscription_cents?: number
  artifact_sha256?: string | null
  trust?: { risk_level?: string; signed?: boolean }
}

interface Payout {
  id: string
  amount_cents: number
  status: string
  can_request?: boolean
  last_error?: string | null
}

interface Earnings {
  total_earned_cents: number
  pending_cents: number
  paid_cents: number
  sales_count: number
  min_payout_cents: number
  publisher_share?: number
  payouts: Payout[]
}

type Reply = { ok: boolean; status: number; body: any }

async function api(path: string, init?: RequestInit): Promise<Reply> {
  const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData
  const r = await fetch(`${getApiBase()}${path}`, {
    credentials: 'include',
    ...init,
    headers: isForm ? (init?.headers || {}) : { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const body = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, body }
}

/** A readable sentence for a refused call. Exported for tests. */
export function explainCreatorError(status: number, body: unknown): string {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>).detail : ''
  const d = typeof raw === 'string' ? raw : raw ? JSON.stringify(raw) : ''
  if (status === 401) return 'Sign in with your Aitherium account first.'
  if (status === 403) return d || 'Your publisher account is not approved yet.'
  if (status === 413) return d || 'That bundle is too large.'
  if (status === 503) return d || 'The marketplace is unavailable right now. Try again shortly.'
  return d || `The request was refused (${status}).`
}

/** Cents exactly as the data has them, shown as dollars; 0 or missing is "free". */
export function formatCents(cents?: number | null): string {
  if (!cents) return 'free'
  return `$${(cents / 100).toFixed(2)}`
}

const box: CSSProperties = {
  background: 'var(--bg-elevated, #222)', borderRadius: 'var(--radius, 6px)',
  border: '1px solid var(--glass-border, #333)',
  padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem',
}
const input: CSSProperties = {
  width: '100%', padding: '0.4rem 0.55rem', fontSize: '0.8rem',
  background: 'var(--bg-deep, #111)', color: 'var(--text-primary, #eee)',
  border: '1px solid var(--border, #333)', borderRadius: 4,
}
const label: CSSProperties = { fontSize: '0.72rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }
const muted: CSSProperties = { fontSize: '0.72rem', color: 'var(--text-muted, #888)' }
const h: CSSProperties = { fontSize: '0.88rem', fontWeight: 600 }
const btn = (primary: boolean): CSSProperties => ({
  padding: '0.35rem 0.8rem', fontSize: '0.75rem', fontWeight: 600, borderRadius: 4,
  background: primary ? 'var(--accent-primary, #5EC9CC)' : 'transparent',
  color: primary ? 'var(--bg-deep, #000)' : 'var(--text-muted, #aaa)',
  border: primary ? 'none' : '1px solid var(--border, #444)', cursor: 'pointer',
})

const KINDS = ['tool', 'skill', 'mcp', 'agent', 'agent_card', 'integration', 'plugin', 'bundle']

function ApplyCard({ status, onDone }: { status: PublisherStatus | null; onDone: () => void }) {
  const [intent, setIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const state = status?.status || 'none'

  if (state === 'pending') {
    return (
      <div style={box} data-testid="creator-apply">
        <div style={h}>Application under review</div>
        <div style={muted}>A moderator reviews every publisher before their first listing. You can prepare your pack meanwhile: <code>adk pack new yourname.tool</code>.</div>
      </div>
    )
  }
  if (state === 'rejected' || state === 'suspended') {
    return (
      <div style={box} data-testid="creator-apply">
        <div style={h}>Publishing is not available on this account</div>
        <div style={muted}>Your publisher account is {state}. Contact support if you think this is a mistake.</div>
      </div>
    )
  }

  const apply = async () => {
    setBusy(true); setMsg('')
    const r = await api('/api/creator/apply', { method: 'POST', body: JSON.stringify({ intent }) })
    setBusy(false)
    if (!r.ok) { setMsg(explainCreatorError(r.status, r.body)); return }
    setMsg('Application sent.')
    onDone()
  }

  return (
    <div style={box} data-testid="creator-apply">
      <div style={h}>Apply to publish</div>
      <div style={muted}>Publishers sell agents, tools, skills and MCP servers to every Aitherium workspace. A moderator approves each publisher once.</div>
      <label style={label}>What will you publish?
        <textarea style={{ ...input, minHeight: 64 }} aria-label="publisher intent" value={intent}
          onChange={(e) => setIntent(e.target.value)} />
      </label>
      <div><button style={btn(true)} disabled={busy || !intent.trim()} onClick={apply}>Apply</button></div>
      {msg && <div role="status" style={muted}>{msg}</div>}
    </div>
  )
}

function NewListing({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ kind: 'tool', name: '', summary: '', version: '0.1.0', one_time_cents: '', subscription_cents: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const cents = (v: string) => Math.max(0, Math.floor(Number(v) || 0))

  const submit = async () => {
    setBusy(true); setMsg('')
    const body = {
      kind: form.kind, name: form.name.trim(), summary: form.summary.trim(), version: form.version.trim() || '0.1.0',
      one_time_cents: cents(form.one_time_cents), subscription_cents: cents(form.subscription_cents),
    }
    const r = await api('/api/creator/listings', { method: 'POST', body: JSON.stringify(body) })
    setBusy(false)
    if (!r.ok) { setMsg(explainCreatorError(r.status, r.body)); return }
    setForm({ ...form, name: '', summary: '' })
    setMsg('Listing created. Upload its bundle below; a moderator reviews it before buyers see it.')
    onCreated()
  }

  return (
    <div style={box} data-testid="creator-new-listing">
      <div style={h}>New listing</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.5rem' }}>
        <label style={label}>Kind
          <select style={input} aria-label="listing kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label style={label}>Name
          <input style={input} aria-label="listing name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label style={label}>Version
          <input style={input} aria-label="listing version" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
        </label>
        <label style={label}>One-time price (cents, blank = free)
          <input style={input} inputMode="numeric" aria-label="one-time price cents" value={form.one_time_cents}
            onChange={(e) => setForm({ ...form, one_time_cents: e.target.value.replace(/[^0-9]/g, '') })} />
        </label>
        <label style={label}>Monthly price (cents, blank = none)
          <input style={input} inputMode="numeric" aria-label="monthly price cents" value={form.subscription_cents}
            onChange={(e) => setForm({ ...form, subscription_cents: e.target.value.replace(/[^0-9]/g, '') })} />
        </label>
      </div>
      <label style={label}>Summary
        <input style={input} aria-label="listing summary" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
      </label>
      <div><button style={btn(true)} disabled={busy || !form.name.trim() || !form.summary.trim()} onClick={submit}>Create listing</button></div>
      {msg && <div role="status" style={muted}>{msg}</div>}
    </div>
  )
}

function ListingRow({ listing, onChanged }: { listing: Listing; onChanged: () => void }) {
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const upload = async (file: File | undefined) => {
    if (!file) return
    setBusy(true); setMsg('')
    const fd = new FormData()
    fd.append('file', file)
    const r = await api(`/api/creator/listings/${encodeURIComponent(listing.id)}/upload`, { method: 'POST', body: fd })
    setBusy(false)
    if (!r.ok) { setMsg(explainCreatorError(r.status, r.body)); return }
    const decision = r.body?.scan?.decision ? `, scan: ${r.body.scan.decision}` : ''
    setMsg(`Uploaded (sha256 ${String(r.body?.sha256 || '').slice(0, 12)}...${decision}).`)
    onChanged()
  }

  const price = [
    listing.one_time_cents ? `${formatCents(listing.one_time_cents)} once` : '',
    listing.subscription_cents ? `${formatCents(listing.subscription_cents)}/mo` : '',
  ].filter(Boolean).join(' or ') || 'free'

  return (
    <div style={{ ...box, gap: '0.35rem' }} data-testid={`creator-listing-${listing.id}`}>
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <div style={h}>{listing.name} <span style={muted}>v{listing.version || '?'} · {listing.kind}</span></div>
          <div style={muted}>{listing.status} · {price}{listing.trust?.risk_level ? ` · scan ${listing.trust.risk_level}` : ''}{listing.trust?.signed ? ' · signed' : ''}</div>
        </div>
        <label style={{ ...btn(!listing.artifact_sha256), display: 'inline-block' }}>
          {listing.artifact_sha256 ? 'Replace bundle' : 'Upload bundle'}
          <input type="file" aria-label={`upload bundle ${listing.id}`} style={{ display: 'none' }} disabled={busy}
            onChange={(e) => upload(e.target.files?.[0])} />
        </label>
      </div>
      <div style={muted}>Buyers install it with <code>adk pack install community:{listing.id}</code></div>
      {msg && <div role="status" style={muted}>{msg}</div>}
    </div>
  )
}

function EarningsCard({ earnings, payout, onChanged }: { earnings: Earnings | null; payout: PayoutAccount | null; onChanged: () => void }) {
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const connect = async () => {
    setBusy(true); setMsg('')
    const r = await api('/api/creator/payout/connect', { method: 'POST', body: '{}' })
    setBusy(false)
    if (!r.ok || !r.body?.url) { setMsg(explainCreatorError(r.status, r.body)); return }
    window.location.assign(r.body.url)
  }

  const request = async (id: string) => {
    setBusy(true); setMsg('')
    const r = await api(`/api/creator/payout/${encodeURIComponent(id)}/request`, { method: 'POST', body: '{}' })
    setBusy(false)
    if (!r.ok) { setMsg(explainCreatorError(r.status, r.body)); return }
    setMsg(`Payout ${r.body?.status || 'sent'}${r.body?.transfer_id ? ` (${r.body.transfer_id})` : ''}.`)
    onChanged()
  }

  const ready = !!payout?.payouts_enabled
  return (
    <div style={box} data-testid="creator-earnings">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <div style={{ flex: 1 }}>
          <div style={h}>Earnings</div>
          {earnings ? (
            <div style={muted}>
              {earnings.sales_count} sale{earnings.sales_count === 1 ? '' : 's'} · earned {formatCents(earnings.total_earned_cents)} ·
              pending {formatCents(earnings.pending_cents)} · paid {formatCents(earnings.paid_cents)}
              {earnings.publisher_share ? ` · your share ${Math.round(earnings.publisher_share * 100)}%` : ''}
            </div>
          ) : <div style={muted}>No earnings data yet.</div>}
        </div>
        <button style={btn(!ready)} disabled={busy} onClick={connect}>
          {payout?.connected ? (ready ? 'Payout account ready' : 'Finish payout setup') : 'Set up payouts'}
        </button>
      </div>
      {earnings?.payouts?.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {earnings.payouts.map((p) => (
            <div key={p.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', fontSize: '0.75rem' }}>
              <span style={{ flex: 1 }}>{formatCents(p.amount_cents)} · {p.status}{p.last_error ? ` · ${p.last_error}` : ''}</span>
              {p.can_request && (
                <button style={btn(true)} disabled={busy || !ready} onClick={() => request(p.id)}
                  title={ready ? '' : 'Set up payouts first'}>Request payout</button>
              )}
            </div>
          ))}
          <div style={muted}>Minimum payout {formatCents(earnings.min_payout_cents)}. Recent sales are held for the refund window before they can be paid.</div>
        </div>
      ) : null}
      {msg && <div role="status" style={muted}>{msg}</div>}
    </div>
  )
}

export default function CreatorPanel() {
  const [status, setStatus] = useState<StatusView | null>(null)
  const [listings, setListings] = useState<Listing[]>([])
  const [earnings, setEarnings] = useState<Earnings | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    const s = await api('/api/creator/status').catch(() => null)
    if (!s) { setError(explainCreatorError(503, {})); return }
    if (!s.ok) { setError(explainCreatorError(s.status, s.body)); return }
    setStatus(s.body as StatusView)
    if (!(s.body as StatusView).publisher?.can_publish) return
    const [l, e] = await Promise.all([
      api('/api/creator/listings').catch(() => null),
      api('/api/creator/earnings').catch(() => null),
    ])
    if (l?.ok) setListings((l.body?.listings as Listing[]) || [])
    else if (l) setError(explainCreatorError(l.status, l.body))
    if (e?.ok) setEarnings(e.body as Earnings)
  }, [])

  useEffect(() => { void load() }, [load])

  const canPublish = !!status?.publisher?.can_publish
  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem', overflowY: 'auto', height: '100%' }}>
      <div>
        <div style={{ fontSize: '1rem', fontWeight: 600 }}>Creator</div>
        <div style={muted}>
          Build packs with <code>adk pack new</code>, publish with <code>adk pack publish &lt;dir&gt;</code> or below, and get paid through Stripe.
        </div>
      </div>
      {error && <div role="alert" style={{ ...box, color: 'var(--accent-coral, #f87171)', fontSize: '0.78rem' }}>{error}</div>}
      {status && !canPublish && <ApplyCard status={status.publisher} onDone={load} />}
      {canPublish && (
        <>
          <EarningsCard earnings={earnings} payout={status?.payout || null} onChanged={load} />
          <NewListing onCreated={load} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={h}>Your listings</div>
            {listings.length === 0
              ? <div style={muted}>No listings yet.</div>
              : listings.map((l) => <ListingRow key={l.id} listing={l} onChanged={load} />)}
          </div>
        </>
      )}
    </div>
  )
}
