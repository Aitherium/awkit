'use client'

/**
 * Managed agents — run this workspace's agent as a hosted managed agent.
 *
 * Connect the workspace's own Anthropic key (BYOK), deploy the agent into that
 * account, see whether it is live, and chat with it. Every call goes to the
 * tenant backend's `/api/managed-agents/*`, a credential hop that forwards the
 * signed-in user's own identity to the platform; the platform decides plan,
 * tenant and key scope. Owner/admin only for the key and deploy (the backend
 * re-checks: this gate is UX, not security). Members see status and can chat.
 *
 * Mirrors the Veil managed onboarding (`onboarding--managed/Body.tsx`), including
 * its reading of a deploy refusal's `needs`. The one thing it adds is saying a
 * PLAN refusal out loud: Genesis answers `403 feature_not_in_plan` when the
 * workspace's plan lacks managed agents, and a panel that rendered that as
 * "error" would look broken rather than unbought.
 */

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getApiBase } from '../lib/apiBase'

interface Status {
  deployed: boolean
  agent_id?: string
  model?: string
  version?: number
  last_run_at?: string
  mcp_servers?: { name?: string; url?: string; enabled?: boolean }[]
}

interface Turn { who: 'you' | 'agent'; text: string }

/**
 * A readable sentence for a refused managed-agent call. Exported for tests.
 *
 * FastAPI wraps a structured refusal as `{detail: {...}}`; the tenant backend's
 * own refusals are flat `{error, detail}`. Both shapes are read.
 */
export function explainManagedError(status: number, body: unknown): string {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const d = (b.detail && typeof b.detail === 'object' ? b.detail : b) as Record<string, unknown>
  // Genesis's chat refusals are `{error: true, error_type: 'deployment_needed'}`: a
  // boolean `error` is a flag, not the code, so only a STRING field names the reason.
  const pick = (v: unknown) => (typeof v === 'string' && v ? v : '')
  const code = pick(d.error) || pick(d.error_type) || pick(b.error) || pick(b.error_type)
  if (code === 'feature_not_in_plan') {
    const tiers = Array.isArray(d.required_tiers) ? (d.required_tiers as string[]) : []
    return 'Managed agents are not included in this workspace\'s plan'
      + (tiers.length ? ` (available on: ${tiers.join(', ')})` : '')
      + '. Ask the workspace owner to upgrade, or contact Aitherium to enable it.'
  }
  if (code === 'tenant_anthropic_key_required' || code === 'provider_key_required'
      || (Array.isArray(d.needs) && (d.needs as string[]).includes('anthropic_api_key'))) {
    return 'No Anthropic key is connected for this workspace yet. An owner or admin must connect one first.'
  }
  if (code === 'deployment_needed') return 'The agent is not deployed yet. An owner or admin must deploy it first.'
  if (code === 'fleet_cap_reached') return String(d.hint || 'This workspace has reached its managed-agent limit.')
  if (code === 'no_platform_identity') return String(b.detail || 'Sign in with AitherIdentity to use managed agents.')
  if (status === 401) return 'Sign in to use managed agents.'
  if (status === 403) return 'Only a workspace owner or admin can do this.'
  const hint = d.hint || (typeof b.detail === 'string' ? b.detail : '') || d.error_message
  return hint ? String(hint) : `The request was refused (${status}).`
}

async function call(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: any }> {
  const r = await fetch(`${getApiBase()}/api/managed-agents${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const body = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, body }
}

export default function ManagedAgentsPanel() {
  const { user } = useAuth()
  const role = (user as { role?: string } | null)?.role
  const isAdmin = role === 'admin' || role === 'owner'

  const [status, setStatus] = useState<Status | null>(null)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [message, setMessage] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])

  const load = useCallback(async () => {
    setError('')
    try {
      const s = await call('/status')
      if (!s.ok) { setError(explainManagedError(s.status, s.body)); return }
      setStatus(s.body as Status)
      if (isAdmin) {
        const k = await call('/byok')
        if (k.ok) setHasKey(!!k.body?.has_key)
        else setError(explainManagedError(k.status, k.body))
      }
    } catch {
      setError('Could not reach the workspace backend. Try again in a minute.')
    }
  }, [isAdmin])

  useEffect(() => { void load() }, [load])

  const saveKey = useCallback(async () => {
    const key = apiKey.trim()
    if (!key) return
    setBusy(true); setError(''); setNotice('')
    try {
      const r = await call('/byok', { method: 'POST', body: JSON.stringify({ anthropic_api_key: key }) })
      // Cleared whatever the answer: the key never lingers in the page.
      setApiKey('')
      if (!r.ok) { setError(explainManagedError(r.status, r.body)); return }
      setHasKey(true); setNotice('Key connected. It is stored in the vault and never shown again.')
    } catch {
      setError('Network error. The key was not saved.')
    } finally { setBusy(false) }
  }, [apiKey])

  const deploy = useCallback(async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      const r = await call('/deploy', { method: 'POST', body: JSON.stringify({}) })
      if (!r.ok || !r.body?.ok) { setError(explainManagedError(r.status, r.body)); return }
      setNotice('Deployed. Your agent is live.')
      await load()
    } catch {
      setError('Network error. The deploy did not complete.')
    } finally { setBusy(false) }
  }, [load])

  const send = useCallback(async () => {
    const text = message.trim()
    if (!text) return
    setBusy(true); setError('')
    setTurns(t => [...t, { who: 'you', text }])
    setMessage('')
    try {
      const r = await call('/chat', { method: 'POST', body: JSON.stringify({ message: text }) })
      if (!r.ok || r.body?.error) { setError(explainManagedError(r.status, r.body)); return }
      setTurns(t => [...t, { who: 'agent', text: String(r.body?.content ?? '') }])
    } catch {
      setError('Network error. The message was not delivered.')
    } finally { setBusy(false) }
  }, [message])

  const card: React.CSSProperties = {
    background: 'var(--bg-surface)', padding: '1rem', borderRadius: 'var(--radius)',
    border: '1px solid var(--glass-border)', marginBottom: '0.75rem',
  }
  const btn: React.CSSProperties = {
    padding: '0.4rem 0.9rem', borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)',
    background: 'var(--accent-primary)', color: 'var(--text-on-accent, #fff)', cursor: 'pointer', fontSize: '0.85rem',
  }
  const input: React.CSSProperties = {
    flex: 1, padding: '0.4rem 0.6rem', borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)',
    background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.85rem',
  }

  return (
    <section style={{ padding: '1rem' }} data-testid="managed-agents-panel">
      <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--text-secondary)' }}>
        Managed agents
      </h3>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        Run this workspace&apos;s agent as a hosted agent on your own Anthropic account. Your tools and data stay
        reachable through the workspace&apos;s secure connections.
      </p>

      {error && (
        <div role="alert" data-testid="managed-agents-error"
          style={{ ...card, color: 'var(--accent-coral)', fontSize: '0.85rem' }}>{error}</div>
      )}
      {notice && <div style={{ ...card, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{notice}</div>}

      <div style={card}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          {status === null ? (error ? 'Status unavailable.' : 'loading…')
            : status.deployed
              ? <>Live{status.model ? <> · {status.model}</> : null}{status.version ? <> · v{status.version}</> : null}</>
              : 'Not deployed yet.'}
        </div>
      </div>

      {isAdmin && (
        <div style={card}>
          <div style={{ fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
            Anthropic key: {hasKey === null ? 'unknown' : hasKey ? 'connected' : 'not connected'}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <input type="password" autoComplete="off" placeholder="sk-ant-…" aria-label="Anthropic API key"
              value={apiKey} onChange={e => setApiKey(e.target.value)} style={input} />
            <button type="button" onClick={saveKey} disabled={busy || !apiKey.trim()} style={btn}>
              {hasKey ? 'Replace key' : 'Connect key'}
            </button>
          </div>
          <button type="button" onClick={deploy} disabled={busy} style={btn}>
            {status?.deployed ? 'Redeploy' : 'Deploy agent'}
          </button>
        </div>
      )}

      {status?.deployed && (
        <div style={card}>
          <div style={{ maxHeight: 280, overflowY: 'auto', marginBottom: '0.5rem' }}>
            {turns.map((t, i) => (
              <div key={i} style={{ fontSize: '0.85rem', margin: '0.25rem 0', whiteSpace: 'pre-wrap',
                color: t.who === 'you' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                <strong>{t.who === 'you' ? 'You' : 'Agent'}:</strong> {t.text}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input placeholder="Message your agent" aria-label="Message your agent" value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void send() }} style={input} />
            <button type="button" onClick={send} disabled={busy || !message.trim()} style={btn}>Send</button>
          </div>
        </div>
      )}
    </section>
  )
}
