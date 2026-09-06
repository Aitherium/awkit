'use client'

import React, { useState, useEffect, useCallback } from 'react'

export interface FleetDashboardProps {
  apiBase?: string
}

interface FleetEndpoint {
  id: string
  name: string
  url: string
  agent_type: string
  status: 'healthy' | 'degraded' | 'offline' | 'unknown'
  capabilities: string[]
  registered_at: string
  last_seen: string
  metrics: {
    requests_today: number
    tokens_today: number
    errors_today: number
    avg_latency_ms: number
    uptime_pct: number
  }
}

interface RegisterForm {
  name: string
  url: string
  agent_type: string
  capabilities: string
  billing_email: string
}

const STATUS_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  healthy: { bg: '#1a3a1a', fg: '#4ade80', label: 'Healthy' },
  degraded: { bg: '#3a3a1a', fg: '#fbbf24', label: 'Degraded' },
  offline: { bg: '#3a1a1a', fg: '#f87171', label: 'Offline' },
  unknown: { bg: '#2a2a2a', fg: '#888', label: 'Unknown' },
}

function formatRelative(iso: string): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

export default function FleetDashboard({ apiBase = '' }: FleetDashboardProps) {
  const [endpoints, setEndpoints] = useState<FleetEndpoint[]>([])
  const [loading, setLoading] = useState(true)
  const [showRegister, setShowRegister] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [registerResult, setRegisterResult] = useState<{ api_key?: string; endpoint_id?: string } | null>(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState<RegisterForm>({
    name: '', url: '', agent_type: 'assistant', capabilities: '', billing_email: '',
  })
  const [selectedEndpoint, setSelectedEndpoint] = useState<string | null>(null)
  const [dispatchInput, setDispatchInput] = useState('')
  const [dispatchResult, setDispatchResult] = useState<{ response?: string; endpoint_used?: string } | null>(null)
  const [dispatching, setDispatching] = useState(false)

  const fetchEndpoints = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/fleet/endpoints`)
      if (res.ok) {
        const data = await res.json()
        setEndpoints(data.endpoints || [])
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => { fetchEndpoints() }, [fetchEndpoints])

  const handleRegister = async () => {
    setRegistering(true)
    setError('')
    setRegisterResult(null)
    try {
      const res = await fetch(`${apiBase}/api/fleet/endpoints/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          capabilities: form.capabilities.split(',').map(c => c.trim()).filter(Boolean),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || `Registration failed: ${res.status}`)
      }
      const data = await res.json()
      setRegisterResult(data)
      await fetchEndpoints()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRegistering(false)
    }
  }

  const handleUnregister = async (id: string) => {
    try {
      await fetch(`${apiBase}/api/fleet/endpoints/${id}`, { method: 'DELETE' })
      await fetchEndpoints()
    } catch {
      // silent
    }
  }

  const handleDispatch = async () => {
    if (!dispatchInput.trim()) return
    setDispatching(true)
    setDispatchResult(null)
    try {
      const res = await fetch(`${apiBase}/api/fleet/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: dispatchInput,
          preferred_endpoint: selectedEndpoint || undefined,
        }),
      })
      if (res.ok) {
        setDispatchResult(await res.json())
      }
    } catch {
      // silent
    } finally {
      setDispatching(false)
    }
  }

  const totalCost = endpoints.length * 5  // $5/mo per endpoint

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px',
    background: 'var(--bg-deep, #111)', border: '1px solid var(--glass-border, #333)',
    borderRadius: 'var(--radius, 8px)', color: 'var(--text-primary, #e0e0e0)',
    fontSize: 13, outline: 'none',
  }

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700 }}>Fleet Management</h2>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted, #888)' }}>
            {endpoints.length} endpoint{endpoints.length !== 1 ? 's' : ''} registered
            {totalCost > 0 && ` \u00b7 $${totalCost}/mo`}
          </p>
        </div>
        <button
          onClick={() => setShowRegister(!showRegister)}
          style={{
            padding: '8px 16px', borderRadius: 'var(--radius, 8px)', border: 'none',
            background: 'var(--accent, #6366f1)', color: '#fff',
            cursor: 'pointer', fontSize: 13, fontWeight: 600,
          }}
        >
          + Register Endpoint
        </button>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Total', value: endpoints.length, color: '#e0e0e0' },
          { label: 'Healthy', value: endpoints.filter(e => e.status === 'healthy').length, color: '#4ade80' },
          { label: 'Degraded', value: endpoints.filter(e => e.status === 'degraded').length, color: '#fbbf24' },
          { label: 'Offline', value: endpoints.filter(e => e.status === 'offline').length, color: '#f87171' },
        ].map(s => (
          <div key={s.label} style={{
            padding: '8px 16px', background: 'var(--bg-surface, #16162a)',
            border: '1px solid var(--glass-border, #2a2a4a)', borderRadius: 8, textAlign: 'center', minWidth: 80,
          }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#888' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Registration form */}
      {showRegister && (
        <div style={{
          padding: 16, marginBottom: 16, borderRadius: 'var(--radius, 10px)',
          background: 'var(--bg-surface, #16162a)', border: '1px solid var(--glass-border, #2a2a4a)',
        }}>
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>Register New Endpoint</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Name *</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="My Agent" style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>URL *</label>
              <input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="http://localhost:8080" style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Agent Type</label>
              <select value={form.agent_type} onChange={e => setForm({ ...form, agent_type: e.target.value })} style={inputStyle}>
                <option value="assistant">Assistant</option>
                <option value="knowledge">Knowledge Agent</option>
                <option value="creative">Creative Agent</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Capabilities (comma-sep)</label>
              <input value={form.capabilities} onChange={e => setForm({ ...form, capabilities: e.target.value })} placeholder="chat, rag, tools" style={inputStyle} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Billing Email</label>
              <input value={form.billing_email} onChange={e => setForm({ ...form, billing_email: e.target.value })} placeholder="billing@example.com" style={inputStyle} />
            </div>
          </div>
          {error && <div style={{ marginTop: 8, fontSize: 12, color: '#f87171' }}>{error}</div>}
          {registerResult && (
            <div style={{ marginTop: 8, padding: 10, background: '#0a1a0a', borderRadius: 8, fontSize: 12 }}>
              <div style={{ color: '#4ade80', marginBottom: 4 }}>Registered successfully!</div>
              <div>Endpoint ID: <code>{registerResult.endpoint_id}</code></div>
              {registerResult.api_key && <div>API Key: <code style={{ color: '#fbbf24' }}>{registerResult.api_key}</code> (save this — shown once)</div>}
            </div>
          )}
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button onClick={handleRegister} disabled={registering || !form.name || !form.url} style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: 'var(--accent, #6366f1)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              opacity: registering ? 0.6 : 1,
            }}>
              {registering ? 'Registering...' : 'Register ($5/mo)'}
            </button>
            <button onClick={() => setShowRegister(false)} style={{
              padding: '8px 16px', borderRadius: 8, background: 'transparent',
              border: '1px solid var(--glass-border, #2a2a4a)', color: '#888', cursor: 'pointer', fontSize: 12,
            }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Endpoint grid */}
      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#888' }}>Loading fleet...</div>
      ) : endpoints.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#666', fontSize: 13 }}>
          No endpoints registered yet. Deploy an agent and register it to see it here.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {endpoints.map(ep => {
            const sc = STATUS_COLORS[ep.status] || STATUS_COLORS.unknown
            return (
              <div key={ep.id} style={{
                padding: 14, borderRadius: 10,
                background: selectedEndpoint === ep.id ? 'var(--bg-active, #1a2a4a)' : 'var(--bg-surface, #16162a)',
                border: `1px solid ${selectedEndpoint === ep.id ? 'var(--accent, #6366f1)' : 'var(--glass-border, #2a2a4a)'}`,
                cursor: 'pointer',
              }} onClick={() => setSelectedEndpoint(ep.id === selectedEndpoint ? null : ep.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <strong style={{ fontSize: 14 }}>{ep.name}</strong>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: sc.bg, color: sc.fg }}>
                    {sc.label}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                  {ep.url} &middot; {ep.agent_type} &middot; Last seen {formatRelative(ep.last_seen)}
                </div>
                {ep.capabilities.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                    {ep.capabilities.map(c => (
                      <span key={c} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: '#111', color: '#777' }}>{c}</span>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#666' }}>
                  <span>{ep.metrics.requests_today} req/day</span>
                  <span>{ep.metrics.avg_latency_ms}ms avg</span>
                  <span>{ep.metrics.uptime_pct}% up</span>
                  {ep.metrics.errors_today > 0 && <span style={{ color: '#f87171' }}>{ep.metrics.errors_today} errors</span>}
                </div>
                {selectedEndpoint === ep.id && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                    <button onClick={e => { e.stopPropagation(); handleUnregister(ep.id) }} style={{
                      padding: '4px 10px', borderRadius: 6, border: '1px solid #3a1a1a',
                      background: 'transparent', color: '#f87171', cursor: 'pointer', fontSize: 11,
                    }}>
                      Unregister
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Dispatch panel */}
      {endpoints.length > 0 && (
        <div style={{
          marginTop: 20, padding: 14, borderRadius: 10,
          background: 'var(--bg-surface, #16162a)', border: '1px solid var(--glass-border, #2a2a4a)',
        }}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Fleet Dispatch</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              placeholder="Send a message to your fleet..."
              value={dispatchInput}
              onChange={e => setDispatchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleDispatch()}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button onClick={handleDispatch} disabled={dispatching} style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: 'var(--accent, #6366f1)', color: '#fff',
              cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}>
              {dispatching ? '...' : 'Dispatch'}
            </button>
          </div>
          {dispatchResult && (
            <div style={{ marginTop: 10, padding: 10, background: '#0a0a1a', borderRadius: 8, fontSize: 12 }}>
              <div style={{ color: '#888', marginBottom: 4 }}>Routed to: {dispatchResult.endpoint_used}</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{dispatchResult.response}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
