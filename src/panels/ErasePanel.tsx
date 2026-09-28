'use client'

/**
 * ErasePanel -- AitherErase personal-data removal (.PRODUCTS/.ERASE layer 5).
 *
 * One panel, four views, all against the Genesis router
 * `/api/v1/aither-erase` (apps/AitherGenesis/routers/aither_erase.py):
 *   - setup      POST /profile, POST /consent   (who you are + the authorization)
 *   - dashboard  GET /profile, GET /tasks, POST /scan, POST /pause|/resume
 *   - report     GET /report                     (confirmed vs still exposed)
 *   - export     GET /report/export              (dated audit trail, JSON download)
 *
 * The owner and tenant come from the AUTHENTICATED caller on the server, never
 * from anything this panel sends: it forwards only the headers the host gives it
 * (the user's own bearer). Consent is typed by the user in this panel; nothing
 * records it on their behalf.
 */

import { useCallback, useEffect, useState } from 'react'

export interface ErasePanelProps {
  /** Base URL that proxies to Genesis `/api/v1/aither-erase` (no trailing slash). */
  apiBase?: string
  /** Extra request headers (e.g. an Authorization bearer). */
  headers?: Record<string, string>
}

interface ProfileState {
  profile: Record<string, unknown>
  residency: string | null
  consent: { recorded: boolean; at: string | null; version: string | null }
  paused: boolean
  last_scan_at: string | null
}

interface EraseTask {
  id: string
  broker: string
  broker_name: string
  method: string | null
  status: string
  cycle: number
  sent_at: string | null
  confirmed_at: string | null
  updated_at: string | null
}

interface EraseReport {
  brokers_checked: number
  confirmed: number
  pending: number
  rejected: number
  still_exposed: number
  by_status: Record<string, number>
  generated_at: string
}

type View = 'dashboard' | 'setup' | 'report'

const STATUS_COLORS: Record<string, string> = {
  confirmed: '#00c853',
  sent: '#40c4ff',
  awaiting_reply: '#40c4ff',
  discovered: 'var(--text-muted)',
  drafted: 'var(--text-muted)',
  needs_verification: '#ffc107',
  no_response: '#ffc107',
  rejected: '#ff5252',
  relisted: '#ff5252',
}

const CONSENT_TEXT =
  'I authorize AitherErase to act as my authorized agent and submit requests to ' +
  'delete, and to opt me out of the sale or sharing of, my personal information ' +
  'held by the data brokers listed in my coverage report, under the privacy laws ' +
  'that apply to me. I can revoke this authorization at any time.'

function splitLines(v: string): string[] {
  return v.split('\n').map(s => s.trim()).filter(Boolean)
}

function errorText(status: number, body: unknown): string {
  const detail = body && typeof body === 'object' && 'detail' in body
    ? (body as { detail: unknown }).detail : body
  if (status === 401) return 'Sign in to use AitherErase.'
  return typeof detail === 'string' ? detail : `HTTP ${status}`
}

export default function ErasePanel({ apiBase = '/api/v1/aither-erase', headers }: ErasePanelProps) {
  const [view, setView] = useState<View>('dashboard')
  const [state, setState] = useState<ProfileState | null>(null)
  const [hasProfile, setHasProfile] = useState<boolean | null>(null)
  const [tasks, setTasks] = useState<EraseTask[]>([])
  const [report, setReport] = useState<EraseReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // setup form
  const [names, setNames] = useState('')
  const [emails, setEmails] = useState('')
  const [phones, setPhones] = useState('')
  const [addresses, setAddresses] = useState('')
  const [residency, setResidency] = useState('')
  const [signature, setSignature] = useState('')

  // Keyed on the serialized headers: an inline object prop is a new identity
  // every render and would otherwise re-fire the effect in a loop.
  const headersKey = headers ? JSON.stringify(headers) : ''

  const call = useCallback(async (method: string, path: string, body?: unknown) => {
    const h: Record<string, string> = headersKey ? JSON.parse(headersKey) : {}
    if (body !== undefined) h['Content-Type'] = 'application/json'
    const r = await fetch(`${apiBase}${path}`, {
      method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await r.json().catch(() => ({}))
    return { status: r.status, ok: r.ok, data }
  }, [apiBase, headersKey])

  const load = useCallback(async () => {
    setError(null)
    try {
      const p = await call('GET', '/profile')
      if (p.status === 404) {
        setHasProfile(false)
        setState(null)
        setTasks([])
        setView('setup')
        return
      }
      if (!p.ok) throw new Error(errorText(p.status, p.data))
      setHasProfile(true)
      setState(p.data as ProfileState)
      const t = await call('GET', '/tasks')
      if (t.ok) setTasks(((t.data as { tasks?: EraseTask[] }).tasks) || [])
    } catch (e) {
      setError(String((e as Error)?.message || e))
    }
  }, [call])

  useEffect(() => { load() }, [load])

  const act = async (fn: () => Promise<string | void>) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const msg = await fn()
      if (msg) setNotice(msg)
      await load()
    } catch (e) {
      setError(String((e as Error)?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const saveProfile = () => act(async () => {
    const r = await call('POST', '/profile', {
      full_names: splitLines(names), emails: splitLines(emails),
      phones: splitLines(phones), addresses: splitLines(addresses),
      residency: residency.trim().toUpperCase(),
    })
    if (!r.ok) throw new Error(errorText(r.status, r.data))
    return 'Profile saved. Review and sign the authorization below to start.'
  })

  const recordConsent = (authorize: boolean) => act(async () => {
    const r = await call('POST', '/consent', { authorize, signature: signature.trim() || 'revoke' })
    if (!r.ok) throw new Error(errorText(r.status, r.data))
    if (authorize) setView('dashboard')
    return authorize ? 'Authorization recorded.' : 'Authorization revoked. No new requests will be filed.'
  })

  const scan = () => act(async () => {
    const r = await call('POST', '/scan', {})
    if (!r.ok) throw new Error(errorText(r.status, r.data))
    const d = r.data as { created: number; directory_size: number }
    return `Scan complete: ${d.created} new broker request(s) across ${d.directory_size} brokers.`
  })

  const setPaused = (paused: boolean) => act(async () => {
    const r = await call('POST', paused ? '/pause' : '/resume', {})
    if (!r.ok) throw new Error(errorText(r.status, r.data))
  })

  const loadReport = () => act(async () => {
    const r = await call('GET', '/report')
    if (!r.ok) throw new Error(errorText(r.status, r.data))
    setReport(r.data as EraseReport)
    setView('report')
  })

  const exportTrail = () => act(async () => {
    const r = await call('GET', '/report/export')
    if (!r.ok) throw new Error(errorText(r.status, r.data))
    const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aither-erase-audit-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    return 'Audit trail downloaded.'
  })

  const card = {
    padding: '10px 14px', borderRadius: 8, background: 'var(--bg-elevated)',
    border: '1px solid var(--border)', marginBottom: 8, fontSize: '0.85rem',
  } as const
  const input = {
    width: '100%', padding: 8, borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg)', color: 'inherit', fontSize: '0.85rem', marginBottom: 8,
  } as const
  const btn = {
    padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--bg-elevated)', color: 'inherit', cursor: 'pointer', marginRight: 8,
  } as const

  if (hasProfile === null && !error) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading AitherErase...</div>
  }

  const consented = !!state?.consent.recorded

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" style={btn} onClick={() => setView('dashboard')} disabled={!hasProfile}>Dashboard</button>
        <button type="button" style={btn} onClick={() => setView('setup')}>Profile &amp; consent</button>
        <button type="button" style={btn} onClick={loadReport} disabled={!hasProfile || busy}>Report</button>
        <button type="button" style={btn} onClick={exportTrail} disabled={!hasProfile || busy}>Export audit trail</button>
      </div>

      {error && <div role="alert" style={{ ...card, color: '#ff5252' }}>{error}</div>}
      {notice && <div role="status" style={card}>{notice}</div>}

      {view === 'setup' && (
        <div>
          <h3 style={{ margin: '0 0 0.75rem' }}>Who should we remove?</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            One entry per line. Stored encrypted; only masked values are shown back.
          </p>
          <textarea aria-label="Full names" style={input} rows={2} placeholder="Full name(s)" value={names} onChange={e => setNames(e.target.value)} />
          <textarea aria-label="Emails" style={input} rows={2} placeholder="Email address(es)" value={emails} onChange={e => setEmails(e.target.value)} />
          <textarea aria-label="Phones" style={input} rows={2} placeholder="Phone number(s) (optional)" value={phones} onChange={e => setPhones(e.target.value)} />
          <textarea aria-label="Addresses" style={input} rows={2} placeholder="Postal address(es) (optional)" value={addresses} onChange={e => setAddresses(e.target.value)} />
          <input aria-label="Residency" style={input} placeholder="Residency, e.g. US-CA" value={residency} onChange={e => setResidency(e.target.value)} />
          <button type="button" style={btn} onClick={saveProfile} disabled={busy}>Save profile</button>

          {hasProfile && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ margin: '0 0 0.75rem' }}>Authorization</h3>
              <div style={card}>{CONSENT_TEXT}</div>
              {consented ? (
                <div style={card}>
                  Authorized {state?.consent.at ? `on ${state.consent.at}` : ''} ({state?.consent.version}).{' '}
                  <button type="button" style={btn} onClick={() => recordConsent(false)} disabled={busy}>Revoke</button>
                </div>
              ) : (
                <>
                  <input aria-label="Signature" style={input} placeholder="Type your full name to sign" value={signature} onChange={e => setSignature(e.target.value)} />
                  <button type="button" style={btn} onClick={() => recordConsent(true)} disabled={busy || signature.trim().length < 2}>I authorize</button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {view === 'dashboard' && state && (
        <div>
          <div style={{ ...card, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <span>Residency: {state.residency || 'not set'}</span>
            <span>Consent: {consented ? 'recorded' : 'missing'}</span>
            <span>{state.paused ? 'Paused' : 'Active'}</span>
            <span>Last scan: {state.last_scan_at || 'never'}</span>
          </div>
          <div style={{ marginBottom: 12 }}>
            <button type="button" style={btn} onClick={scan} disabled={busy || !consented || state.paused}>Scan brokers</button>
            <button type="button" style={btn} onClick={() => setPaused(!state.paused)} disabled={busy}>
              {state.paused ? 'Resume' : 'Pause'}
            </button>
          </div>
          {!consented && <div style={card}>Record your authorization under Profile &amp; consent before scanning.</div>}
          {tasks.length === 0 && consented && <div style={card}>No removal requests yet. Run a scan.</div>}
          {tasks.map(t => (
            <div key={t.id} style={card}>
              <span aria-hidden style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: '50%', marginRight: 8,
                background: STATUS_COLORS[t.status] || 'var(--text-muted)',
              }} />
              <strong>{t.broker_name}</strong>
              <span style={{ marginLeft: 8 }}>{t.status.replace(/_/g, ' ')}</span>
              {t.cycle > 1 && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>cycle {t.cycle}</span>}
              {t.confirmed_at && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>confirmed {t.confirmed_at}</span>}
            </div>
          ))}
        </div>
      )}

      {view === 'report' && report && (
        <div>
          <h3 style={{ margin: '0 0 0.75rem' }}>Coverage report</h3>
          <div style={{ ...card, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <span>{report.brokers_checked} brokers checked</span>
            <span style={{ color: '#00c853' }}>{report.confirmed} confirmed removed</span>
            <span>{report.pending} pending</span>
            <span>{report.rejected} rejected</span>
            <span style={{ color: '#ff5252' }}>{report.still_exposed} still exposed</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            Data stays exposed until a broker reply confirming removal is on file. Generated {report.generated_at}.
          </p>
        </div>
      )}
    </div>
  )
}
