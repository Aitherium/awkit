'use client'

/**
 * Calendar & Drive connectors: Microsoft 365 and Google Workspace, read-only.
 *
 * Self-service. The workspace's own IT registers an OAuth app in THEIR tenant
 * (an Azure AD app registration, or a Google "Internal" OAuth client) and an
 * owner/admin pastes the client id and secret here. The backend keeps them per
 * workspace, encrypted, and never returns the secret (`/api/connectors/*`); the
 * redirect URI shown is the exact one to register. Then anyone in the workspace
 * connects their own account with the Connect button.
 *
 * Members only see status and Connect: the admin gate here is UX, the backend
 * re-checks it.
 *
 * Two admin switches per workspace (stored as "1" / ""):
 * - `gmail` (Google only): adds Google's restricted gmail.readonly scope; members
 *   re-consent on their next Connect.
 * - `cli_tokens`: lets each member fetch THEIR OWN token for their CLI/agents
 *   (`GET /api/connectors/{provider}/token`, used by awsuite, awdk, awsh). Off by default.
 */

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getApiBase } from '../lib/apiBase'

export type ConnectorProvider = 'm365' | 'google'
type Provider = ConnectorProvider

interface Config {
  redirect_uri?: string
  client_id?: string
  tenant_id?: string
  has_secret?: boolean
  configured?: boolean
  /** Google only: "1" = restricted gmail.readonly scope requested. */
  gmail?: string
  /** "1" = members may fetch their own token for their CLI/agents. */
  cli_tokens?: string
}

export interface ConnectorForm {
  client_id: string
  client_secret: string
  tenant_id: string
  gmail: boolean
  cli_tokens: boolean
}

const EMPTY_FORM: ConnectorForm = { client_id: '', client_secret: '', tenant_id: '', gmail: false, cli_tokens: false }

/** The PUT body for a provider. Exported for tests. */
export function connectorConfigBody(provider: ConnectorProvider, form: ConnectorForm): Record<string, string> {
  const base: Record<string, string> = {
    client_id: form.client_id,
    client_secret: form.client_secret,
  }
  if (provider === 'm365') base.tenant_id = form.tenant_id
  if (provider === 'google') base.gmail = form.gmail ? '1' : ''
  base.cli_tokens = form.cli_tokens ? '1' : ''
  return base
}

interface Status { configured?: boolean; connected?: boolean }

const META: Record<Provider, { title: string; reads: string; steps: string[] }> = {
  m365: {
    title: 'Microsoft 365',
    reads: 'Calendar, OneDrive and SharePoint files (read-only)',
    steps: [
      'Azure portal > Microsoft Entra ID > App registrations > New registration.',
      'Supported account types: "Accounts in this organizational directory only".',
      'Redirect URI: platform Web, paste the URI below.',
      'API permissions > Microsoft Graph > Delegated: User.Read, Calendars.Read, Files.Read.All, offline_access. Grant admin consent.',
      'Certificates & secrets > New client secret. Paste the Application (client) ID, Directory (tenant) ID and the secret value here.',
    ],
  },
  google: {
    title: 'Google Workspace',
    reads: 'Calendar and Drive (read-only)',
    steps: [
      'Google Cloud console > APIs & Services: enable the Google Calendar API and Google Drive API.',
      'OAuth consent screen: User type "Internal" (no Google review needed for your own domain).',
      'Scopes: calendar.readonly, drive.readonly (and gmail.readonly if you include Gmail below).',
      'Credentials > Create OAuth client ID > Web application. Authorized redirect URI: paste the URI below.',
      'Paste the client ID and client secret here.',
    ],
  },
}

async function api(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: any }> {
  const r = await fetch(`${getApiBase()}${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const body = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, body }
}

/** A readable sentence for a refused call. Exported for tests. */
export function explainConnectorError(status: number, body: unknown): string {
  const d = (body && typeof body === 'object' ? (body as Record<string, unknown>).detail : '') || ''
  if (status === 401) return 'Sign in first.'
  if (status === 403) return 'Only a workspace owner or admin can change connector settings.'
  if (status === 503) return String(d || 'Secure storage is unavailable on this server right now.')
  return String(d || `The request was refused (${status}).`)
}

const box: React.CSSProperties = {
  background: 'var(--bg-elevated, #222)', borderRadius: 'var(--radius, 6px)',
  padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem',
}
const input: React.CSSProperties = {
  width: '100%', padding: '0.4rem 0.55rem', fontSize: '0.8rem',
  background: 'var(--bg-deep, #111)', color: 'var(--text-primary, #eee)',
  border: '1px solid var(--border, #333)', borderRadius: 4,
}
const btn = (primary: boolean): React.CSSProperties => ({
  padding: '0.35rem 0.8rem', fontSize: '0.75rem', fontWeight: 600, borderRadius: 4,
  background: primary ? 'var(--accent-primary, #5EC9CC)' : 'transparent',
  color: primary ? 'var(--bg-deep, #000)' : 'var(--text-muted, #aaa)',
  border: primary ? 'none' : '1px solid var(--border, #444)', cursor: 'pointer',
})

function ConnectorCard({ provider, isAdmin }: { provider: Provider; isAdmin: boolean }) {
  const meta = META[provider]
  const [status, setStatus] = useState<Status>({})
  const [cfg, setCfg] = useState<Config | null>(null)
  const [form, setForm] = useState<ConnectorForm>(EMPTY_FORM)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const s = await api(`/api/auth/${provider}/status`).catch(() => null)
    if (s?.ok) setStatus(s.body)
    if (!isAdmin) return
    const c = await api(`/api/connectors/${provider}/config`).catch(() => null)
    if (c?.ok) {
      setCfg(c.body)
      setForm({
        client_id: c.body.client_id || '', client_secret: '', tenant_id: c.body.tenant_id || '',
        gmail: c.body.gmail === '1', cli_tokens: c.body.cli_tokens === '1',
      })
    }
  }, [provider, isAdmin])

  useEffect(() => { void load() }, [load])

  const save = async (next: ConnectorForm = form) => {
    setBusy(true); setMsg('')
    const body = connectorConfigBody(provider, next)
    const r = await api(`/api/connectors/${provider}/config`, { method: 'PUT', body: JSON.stringify(body) })
    setBusy(false)
    if (!r.ok) { setMsg(explainConnectorError(r.status, r.body)); return }
    setEditing(false); setMsg('Saved.'); void load()
  }

  /** In the saved view a switch saves at once (blank secret = keep the stored one). */
  const toggle = (key: 'gmail' | 'cli_tokens', on: boolean) => {
    const immediate = !!cfg?.configured && !editing
    const next = { ...form, [key]: on, ...(immediate ? { client_secret: '' } : {}) }
    setForm(next)
    if (immediate) void save(next)
  }

  const switches = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.72rem' }}>
      {provider === 'google' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <input type="checkbox" aria-label="google include gmail" checked={form.gmail}
            disabled={busy} onChange={(e) => toggle('gmail', e.target.checked)} />
          Include Gmail (read-only, Google restricted scope — needs re-consent)
        </label>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
        <input type="checkbox" aria-label={`${provider} cli tokens`} checked={form.cli_tokens}
          disabled={busy} onChange={(e) => toggle('cli_tokens', e.target.checked)} />
        Allow members to use this connection from their CLI/agents (awsuite, awdk, awsh)
      </label>
    </div>
  )

  const remove = async () => {
    setBusy(true); setMsg('')
    const r = await api(`/api/connectors/${provider}/config`, { method: 'DELETE' })
    setBusy(false)
    if (!r.ok) { setMsg(explainConnectorError(r.status, r.body)); return }
    setMsg('Removed.'); void load()
  }

  const dot = status.connected ? '#4ade80' : status.configured ? '#fbbf24' : '#888'
  const line = status.connected ? `Connected: ${meta.reads}`
    : status.configured ? 'Ready. Connect your account to start reading.'
      : isAdmin ? 'Not set up yet. Register your app below.' : 'Not set up yet. Ask a workspace admin.'

  return (
    <div style={box} data-testid={`connector-${provider}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>{meta.title}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted, #888)' }}>{line}</div>
        </div>
        {status.configured && (
          <button style={btn(!status.connected)}
            onClick={() => { window.location.href = `${getApiBase()}/api/auth/${provider}/login` }}>
            {status.connected ? 'Reconnect' : 'Connect'}
          </button>
        )}
      </div>

      {isAdmin && cfg && (cfg.configured && !editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.72rem', color: 'var(--text-muted, #888)' }}>
            <span style={{ flex: 1 }}>
              Your app: <code>{cfg.client_id}</code>{cfg.tenant_id ? <> in tenant <code>{cfg.tenant_id}</code></> : null}
              {cfg.has_secret ? ', secret stored' : ', no secret'}
            </span>
            <button style={btn(false)} onClick={() => setEditing(true)}>Edit</button>
            <button style={btn(false)} disabled={busy} onClick={remove}>Remove</button>
          </div>
          {switches}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <ol style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.72rem', color: 'var(--text-muted, #999)', lineHeight: 1.5 }}>
            {meta.steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
          <label style={{ fontSize: '0.72rem' }}>Redirect URI to register
            <input style={input} readOnly value={cfg.redirect_uri || ''} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <label style={{ fontSize: '0.72rem' }}>Client ID
            <input style={input} aria-label={`${provider} client id`} value={form.client_id}
              onChange={(e) => setForm({ ...form, client_id: e.target.value })} />
          </label>
          {provider === 'm365' && (
            <label style={{ fontSize: '0.72rem' }}>Directory (tenant) ID
              <input style={input} aria-label="m365 tenant id" value={form.tenant_id} placeholder="organizations"
                onChange={(e) => setForm({ ...form, tenant_id: e.target.value })} />
            </label>
          )}
          <label style={{ fontSize: '0.72rem' }}>Client secret
            <input style={input} type="password" autoComplete="off" aria-label={`${provider} client secret`}
              value={form.client_secret} placeholder={cfg.has_secret ? 'Stored. Leave blank to keep it.' : ''}
              onChange={(e) => setForm({ ...form, client_secret: e.target.value })} />
          </label>
          {switches}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button style={btn(true)} disabled={busy || !form.client_id.trim()} onClick={() => { void save() }}>Save</button>
            {editing && <button style={btn(false)} onClick={() => setEditing(false)}>Cancel</button>}
          </div>
        </div>
      ))}
      {msg && <div role="status" style={{ fontSize: '0.72rem', color: 'var(--text-muted, #aaa)' }}>{msg}</div>}
    </div>
  )
}

export default function ConnectorsPanel() {
  const { user } = useAuth()
  const role = (user as { role?: string } | null)?.role
  const isAdmin = role === 'admin' || role === 'owner' || role === 'workspace_admin'
  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem', overflowY: 'auto', height: '100%' }}>
      <div>
        <div style={{ fontSize: '1rem', fontWeight: 600 }}>Calendar & Drive connectors</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)' }}>
          Read-only. The briefing and document tools read what each person connects; nothing is written back.
        </div>
      </div>
      <ConnectorCard provider="m365" isAdmin={isAdmin} />
      <ConnectorCard provider="google" isAdmin={isAdmin} />
    </div>
  )
}
