'use client'

/**
 * McpEndpointsPanel — the workspace's own MCP servers ("bring your own tools").
 *
 * Lists, registers and removes the MCP servers a tenant runs on its own hardware
 * through the awkit proxy (`/api/mcp-endpoints` -> Genesis
 * `/v1/agent/mcp-endpoints`, carried with the signed-in user's own session).
 * Genesis owns the registry: it scopes it to the caller's tenant, gates it on the
 * plan's MCP-hosting feature, validates the URL, and keeps a supplied bearer in
 * the workspace vault — the token is write-only here and never shown again.
 *
 * An unreachable registry renders as an ERROR, never as "no servers"; a plan
 * refusal says so without quoting any price.
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react'

interface Endpoint {
  name: string
  url: string
  enabled?: boolean
  auth_vault_key?: string
}

export interface McpEndpointsPanelProps {
  apiBase?: string
}

const card: CSSProperties = {
  background: 'var(--bg-surface)', border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius)', padding: '1rem', marginBottom: '1rem',
}
const btn: CSSProperties = {
  padding: '0.45rem 0.9rem', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)', fontSize: '0.8rem',
  cursor: 'pointer',
}
const input: CSSProperties = {
  padding: '0.4rem 0.6rem', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)', fontSize: '0.8rem',
}
const muted: CSSProperties = { fontSize: '0.75rem', color: 'var(--text-muted)' }

async function failure(r: Response): Promise<string> {
  let body: any = null
  try { body = await r.json() } catch { /* not JSON */ }
  const detail = body?.detail ?? body
  const code = typeof detail === 'object' ? detail?.error : undefined
  if (r.status === 401) return 'Sign in with your Aitherium account to manage MCP servers.'
  if (code === 'feature_not_in_plan' || code === 'plan_tier_required') {
    return 'Custom MCP servers are not included in this workspace\'s current plan.'
  }
  if (r.status === 403) return 'Your role cannot do this — ask a workspace admin.'
  if (r.status === 502 || r.status === 503) return 'The MCP server registry is unreachable right now.'
  const msg = typeof detail === 'string' ? detail : (detail?.detail || detail?.message || body?.error)
  return msg ? String(msg) : `Request failed (HTTP ${r.status})`
}

export default function McpEndpointsPanel({ apiBase = '/api/mcp-endpoints' }: McpEndpointsPanelProps) {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(apiBase)
      if (!r.ok) { setError(await failure(r)); setEndpoints([]); return }
      setEndpoints(((await r.json())?.endpoints ?? []) as Endpoint[])
    } catch {
      setError('The MCP server registry is unreachable right now.')
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => { void load() }, [load])

  const register = async () => {
    setBusy(true); setError(null); setNotice(null)
    try {
      const r = await fetch(apiBase, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), url: url.trim(), ...(token ? { token } : {}) }),
      })
      if (!r.ok) { setError(await failure(r)); return }
      const body = await r.json().catch(() => ({}))
      setNotice(body?.hint ? String(body.hint) : `Registered ${name.trim()}. Your assistant can use its tools.`)
      setName(''); setUrl(''); setToken('')
      await load()
    } catch {
      setError('The MCP server registry is unreachable right now.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (n: string) => {
    setBusy(true); setError(null); setNotice(null)
    try {
      const r = await fetch(`${apiBase}/${encodeURIComponent(n)}`, { method: 'DELETE' })
      if (!r.ok) { setError(await failure(r)); return }
      setNotice(`Removed ${n}.`)
      await load()
    } catch {
      setError('The MCP server registry is unreachable right now.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 900 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>MCP Servers</h2>
          <p style={muted}>Connect the MCP servers your company runs; your assistant can then call their tools.</p>
        </div>
        <button type="button" style={btn} onClick={() => void load()} disabled={busy}>Refresh</button>
      </header>

      {error && <div role="alert" style={{ ...card, borderColor: 'var(--accent-coral)', color: 'var(--accent-coral)' }}>{error}</div>}
      {notice && <div style={{ ...card, borderColor: 'var(--accent-green)' }}>{notice}</div>}

      <section style={card}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>Registered servers</h3>
        {loading ? <p style={muted}>Loading…</p> : endpoints.length === 0 ? (
          <p style={muted}>{error ? 'Unavailable.' : 'No MCP servers registered yet.'}</p>
        ) : (
          <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
            <thead><tr style={muted}><th align="left">Name</th><th align="left">URL</th><th align="left">State</th><th /></tr></thead>
            <tbody>
              {endpoints.map((e) => (
                <tr key={e.name} style={{ borderTop: '1px solid var(--glass-border)' }}>
                  <td>{e.name}</td>
                  <td style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{e.url}</td>
                  <td style={{ color: e.enabled === false ? 'var(--text-muted)' : 'var(--accent-green)' }}>{e.enabled === false ? 'Disabled' : 'Enabled'}</td>
                  <td align="right"><button type="button" style={btn} disabled={busy} onClick={() => void remove(e.name)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={card}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>Add a server</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.6rem' }}>
          <label style={muted}>Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="crm" maxLength={63} style={{ ...input, width: '100%' }} />
          </label>
          <label style={muted}>URL (public https)
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" style={{ ...input, width: '100%' }} />
          </label>
          <label style={muted}>Bearer token (optional, stored in your vault)
            <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} style={{ ...input, width: '100%' }} />
          </label>
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <button type="button" style={btn} onClick={() => void register()} disabled={busy || !name.trim() || !url.trim()}>Register</button>
        </div>
      </section>
    </div>
  )
}
