'use client'

import { useState, useEffect, useCallback } from 'react'

/* ── Types ─────────────────────────────────────────────────────────── */

interface ApiKeyStatus {
  provider: string
  display_name: string
  has_key: boolean
  source: string // "tenant" | "platform" | "none"
}

interface IntentRoute {
  provider?: string
  model?: string
  temperature?: number
  fallback_provider?: string
  fallback_model?: string
}

interface CostSummary {
  period: string
  total_cost_usd: number
  cloud_requests: number
  local_requests: number
}

interface InferenceConfig {
  user_id: string
  tenant_id: string
  cloud_mode: string
  routing_preset: string
  enabled: boolean
  intent_routing: Record<string, IntentRoute>
  presets: Record<string, { description?: string }>
  monthly_budget_usd: number
  api_keys: ApiKeyStatus[]
  costs: CostSummary | null
  scope_sources: { user: boolean; tenant: boolean; platform: boolean }
}

export interface InferenceConfigPanelProps {
  apiBase?: string
}

/* ── Styles ────────────────────────────────────────────────────────── */

const sCard: React.CSSProperties = {
  padding: '16px 20px', borderRadius: 10,
  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  marginBottom: 16,
}

const sGrid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '140px 1fr',
  gap: '6px 12px', fontSize: '0.85rem',
}

const sLabel: React.CSSProperties = { color: 'var(--text-muted)', fontSize: '0.8rem' }

const sValue: React.CSSProperties = { fontWeight: 500 }

const sBtn = (primary = false): React.CSSProperties => ({
  padding: '7px 16px', borderRadius: 7,
  border: primary ? 'none' : '1px solid var(--border)',
  background: primary ? 'var(--accent)' : 'transparent',
  color: primary ? '#fff' : 'var(--text-muted)',
  cursor: 'pointer', fontSize: '0.8rem', fontWeight: primary ? 600 : 400,
})

const sBadge = (ok: boolean): React.CSSProperties => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 4,
  fontSize: '0.75rem', fontWeight: 600,
  background: ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.10)',
  color: ok ? 'var(--accent-green, #22c55e)' : 'var(--accent-coral, #ef4444)',
})

const sSelect: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg-deep)',
  color: 'var(--text)', fontSize: '0.85rem',
}

const sInput: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg-deep)',
  color: 'var(--text)', fontSize: '0.85rem', width: 100,
}

const sSection: React.CSSProperties = { marginBottom: 28 }
const sSectionTitle: React.CSSProperties = {
  fontSize: '0.9rem', fontWeight: 600, marginBottom: 10,
  color: 'var(--text-secondary)',
}

/* ── Component ─────────────────────────────────────────────────────── */

export default function InferenceConfigPanel({
  apiBase = '/api/config',
}: InferenceConfigPanelProps) {
  const [config, setConfig] = useState<InferenceConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [keyInput, setKeyInput] = useState<{ provider: string; key: string } | null>(null)

  const genesisBase = '/api/genesis'

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${genesisBase}/config/me/inference`)
      if (res.ok) {
        setConfig(await res.json())
      }
    } catch { /* offline */ }
    setLoading(false)
  }, [genesisBase])

  useEffect(() => { load() }, [load])

  const save = async (updates: Record<string, any>) => {
    setSaving(true)
    setMsg('')
    try {
      const res = await fetch(`${genesisBase}/config/me/inference`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (res.ok) {
        setMsg('Saved')
        await load()
      } else {
        setMsg('Failed to save')
      }
    } catch {
      setMsg('Error saving')
    }
    setSaving(false)
    setTimeout(() => setMsg(''), 3000)
  }

  const setApiKey = async (provider: string, apiKey: string) => {
    setSaving(true)
    try {
      const res = await fetch(`${genesisBase}/tenants/me/llm-keys/${provider}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey }),
      })
      if (res.ok) {
        setMsg(`${provider} key saved`)
        setKeyInput(null)
        await load()
      } else {
        const data = await res.json().catch(() => ({}))
        setMsg(data.detail || 'Failed to save key')
      }
    } catch {
      setMsg('Error saving key')
    }
    setSaving(false)
    setTimeout(() => setMsg(''), 3000)
  }

  const removeApiKey = async (provider: string) => {
    if (!confirm(`Remove ${provider} API key?`)) return
    try {
      await fetch(`${genesisBase}/tenants/me/llm-keys/${provider}`, { method: 'DELETE' })
      setMsg(`${provider} key removed`)
      await load()
    } catch { setMsg('Error') }
    setTimeout(() => setMsg(''), 3000)
  }

  if (loading) return <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading...</div>
  if (!config) return (
    <div style={{ padding: 24 }}>
      <p style={{ color: 'var(--text-muted)' }}>Could not load the AI settings. Try again in a moment — if it keeps failing, contact your administrator.</p>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 8 }}>
        Use <code>adk keys</code>, <code>adk routing</code>, <code>adk costs</code> from the CLI instead.
      </p>
    </div>
  )

  const presetNames = Object.keys(config.presets || {})

  return (
    <div style={{ padding: '1.5rem', maxWidth: 860 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Inference Configuration</h2>
        {msg && <span style={{ fontSize: '0.8rem', color: 'var(--accent-green)' }}>{msg}</span>}
      </div>

      {/* ── Cloud Mode ──────────────────────────────────────────────── */}
      <section style={sSection}>
        <h3 style={sSectionTitle}>Cloud Mode</h3>
        <div style={sCard}>
          <div style={{ ...sGrid, alignItems: 'center' }}>
            <span style={sLabel}>Mode</span>
            <select
              style={sSelect}
              value={config.cloud_mode}
              onChange={e => save({ cloud_mode: e.target.value })}
              disabled={saving}
            >
              <option value="local_first">Local First (try GPU, fall back to cloud)</option>
              <option value="cloud_first">Cloud First (try cloud, fall back to local)</option>
              <option value="cloud_only">Cloud Only (no local GPU)</option>
              <option value="local_only">Local Only (no cloud API calls)</option>
            </select>

            <span style={sLabel}>Routing Preset</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {presetNames.map(p => (
                <button
                  key={p}
                  style={{
                    ...sBtn(config.routing_preset === p),
                    textTransform: 'capitalize',
                  }}
                  onClick={() => save({ preset: p })}
                  disabled={saving}
                >
                  {p}
                </button>
              ))}
            </div>

            <span style={sLabel}>Budget</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem' }}>$</span>
              <input
                type="number"
                style={sInput}
                value={config.monthly_budget_usd || ''}
                placeholder="0 = unlimited"
                onBlur={e => {
                  const val = parseFloat(e.target.value) || 0
                  if (val !== config.monthly_budget_usd) save({ monthly_budget_usd: val })
                }}
                onChange={e => setConfig({ ...config, monthly_budget_usd: parseFloat(e.target.value) || 0 })}
              />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>/month</span>
            </div>
          </div>

          {/* Scope indicator */}
          <div style={{ marginTop: 12, display: 'flex', gap: 8, fontSize: '0.75rem' }}>
            {config.scope_sources.user && <span style={sBadge(true)}>User override</span>}
            {config.scope_sources.tenant && <span style={sBadge(true)}>Tenant defaults</span>}
            {config.scope_sources.platform && <span style={{ ...sBadge(true), background: 'rgba(96,165,250,0.12)', color: '#60a5fa' }}>Platform defaults</span>}
          </div>
        </div>
      </section>

      {/* ── API Keys ────────────────────────────────────────────────── */}
      <section style={sSection}>
        <h3 style={sSectionTitle}>API Keys</h3>
        <div style={sCard}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {config.api_keys.map(k => (
              <div key={k.provider} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '8px 0',
                borderBottom: '1px solid var(--border)',
              }}>
                <span style={{ width: 100, fontWeight: 500, fontSize: '0.85rem' }}>{k.display_name}</span>
                <span style={sBadge(k.has_key)}>
                  {k.has_key ? k.source : 'not set'}
                </span>
                <div style={{ flex: 1 }} />

                {keyInput?.provider === k.provider ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="password"
                      style={{ ...sInput, width: 220 }}
                      placeholder={`${k.display_name} API key`}
                      value={keyInput.key}
                      onChange={e => setKeyInput({ ...keyInput, key: e.target.value })}
                      autoFocus
                    />
                    <button
                      style={sBtn(true)}
                      onClick={() => setApiKey(k.provider, keyInput.key)}
                      disabled={!keyInput.key || saving}
                    >Save</button>
                    <button
                      style={sBtn()}
                      onClick={() => setKeyInput(null)}
                    >Cancel</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      style={sBtn()}
                      onClick={() => setKeyInput({ provider: k.provider, key: '' })}
                    >{k.has_key ? 'Update' : 'Set Key'}</button>
                    {k.has_key && k.source === 'tenant' && (
                      <button
                        style={{ ...sBtn(), color: 'var(--accent-coral, #ef4444)' }}
                        onClick={() => removeApiKey(k.provider)}
                      >Remove</button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          {config.api_keys.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No providers configured. Use <code>adk keys set openai sk-...</code> or set keys above.
            </p>
          )}
        </div>
      </section>

      {/* ── Intent Routing ──────────────────────────────────────────── */}
      <section style={sSection}>
        <h3 style={sSectionTitle}>
          Intent Routing
          <span style={{ marginLeft: 8, ...sBadge(config.enabled) }}>
            {config.enabled ? 'active' : 'disabled'}
          </span>
        </h3>
        <div style={sCard}>
          {Object.keys(config.intent_routing).length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {Object.entries(config.intent_routing).map(([intent, route]) => (
                <div key={intent} style={{
                  display: 'grid', gridTemplateColumns: '180px 120px 1fr',
                  gap: 8, fontSize: '0.83rem', padding: '4px 0',
                  borderBottom: '1px solid var(--glass-border)',
                }}>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{intent}</span>
                  <span style={sValue}>{route.provider || '?'}</span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {route.model || ''}
                    {route.fallback_provider ? ` [fallback: ${route.fallback_provider}]` : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
              No intent overrides. Using effort-based routing.
              Apply a preset above to configure intent routing.
            </p>
          )}
        </div>
      </section>

      {/* ── Cost Summary ────────────────────────────────────────────── */}
      {config.costs && (
        <section style={sSection}>
          <h3 style={sSectionTitle}>Cost Summary (30 days)</h3>
          <div style={sCard}>
            <div style={sGrid}>
              <span style={sLabel}>Total Spend</span>
              <span style={sValue}>${config.costs.total_cost_usd.toFixed(4)}</span>
              <span style={sLabel}>Cloud Requests</span>
              <span style={sValue}>{config.costs.cloud_requests.toLocaleString()}</span>
              <span style={sLabel}>Local Requests</span>
              <span style={sValue}>{config.costs.local_requests.toLocaleString()}</span>
              {config.monthly_budget_usd > 0 && (
                <>
                  <span style={sLabel}>Budget</span>
                  <span style={sValue}>
                    ${config.costs.total_cost_usd.toFixed(2)} / ${config.monthly_budget_usd.toFixed(2)}
                    <span style={{
                      marginLeft: 8,
                      fontSize: '0.75rem',
                      color: config.costs.total_cost_usd > config.monthly_budget_usd * 0.8
                        ? 'var(--accent-coral)' : 'var(--text-muted)',
                    }}>
                      ({((config.costs.total_cost_usd / config.monthly_budget_usd) * 100).toFixed(0)}%)
                    </span>
                  </span>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── CLI Reference ───────────────────────────────────────────── */}
      <section>
        <details>
          <summary style={{ fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
            CLI Commands
          </summary>
          <div style={{ padding: '8px 0', fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            <div>adk keys set openai sk-...</div>
            <div>adk keys list</div>
            <div>adk routing preset balanced</div>
            <div>adk routing set code deepseek</div>
            <div>adk costs</div>
            <div>adk costs budget 50</div>
            <div>adk setup --mode cloud</div>
          </div>
        </details>
      </section>
    </div>
  )
}
