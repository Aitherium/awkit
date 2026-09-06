'use client'

import { useState, useEffect, useCallback } from 'react'

interface ProviderDef {
  id: string
  name: string
  type: 'local' | 'cloud' | 'custom'
  description: string
  requires_key: boolean
  configured: boolean
  has_key: boolean
  url: string | null
  model: string | null
  key_field?: string
  url_field?: string
  model_field?: string
}

interface LLMConfig {
  primary: string
  fallback: string | null
  providers: Record<string, ProviderDef>
}

interface TestResult {
  ok: boolean
  provider: string
  error?: string
  response_preview?: string
  model?: string
}

const TYPE_LABELS: Record<string, string> = {
  local: 'Local',
  cloud: 'Cloud API',
  custom: 'Custom',
}

const TYPE_COLORS: Record<string, string> = {
  local: '#4ade80',
  cloud: '#60a5fa',
  custom: '#c084fc',
}

export default function LLMConfigPanel() {
  const [config, setConfig] = useState<LLMConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [editProvider, setEditProvider] = useState<string | null>(null)
  const [editKey, setEditKey] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [editModel, setEditModel] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const fetchConfig = useCallback(async () => {
    try {
      const resp = await fetch('/api/settings/llm')
      if (!resp.ok) throw new Error(`${resp.status}`)
      setConfig(await resp.json())
      setError(null)
    } catch (e: any) {
      setError(e.message || 'Failed to load config')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchConfig() }, [fetchConfig])

  const updateProvider = async (
    provider: string,
    updates: { provider?: string; fallback?: string; api_key?: string; url?: string; model?: string },
  ) => {
    setSaving(true)
    try {
      const resp = await fetch('/api/settings/llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, ...updates }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.detail || 'Failed to update')
      showToast(`Updated ${provider}`)
      await fetchConfig()
    } catch (e: any) {
      showToast(`Error: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  const setPrimary = async (pid: string) => {
    await updateProvider(pid, { provider: pid })
  }

  const setFallback = async (pid: string | null) => {
    setSaving(true)
    try {
      const resp = await fetch('/api/settings/llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fallback: pid || '' }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.detail || 'Failed')
      showToast(pid ? `Fallback set to ${pid}` : 'Fallback disabled')
      await fetchConfig()
    } catch (e: any) {
      showToast(`Error: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  const testProvider = async (pid: string) => {
    setTesting(pid)
    setTestResult(null)
    try {
      const resp = await fetch('/api/settings/llm/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: pid }),
      })
      setTestResult(await resp.json())
    } catch (e: any) {
      setTestResult({ ok: false, provider: pid, error: e.message })
    } finally {
      setTesting(null)
    }
  }

  const saveProviderEdit = async () => {
    if (!editProvider) return
    const updates: any = {}
    if (editKey) updates.api_key = editKey
    if (editUrl) updates.url = editUrl
    if (editModel) updates.model = editModel
    if (Object.keys(updates).length === 0) {
      setEditProvider(null)
      return
    }
    await updateProvider(editProvider, updates)
    setEditProvider(null)
    setEditKey('')
    setEditUrl('')
    setEditModel('')
  }

  const startEdit = (pid: string, prov: ProviderDef) => {
    setEditProvider(pid)
    setEditKey('')
    setEditUrl(prov.url || '')
    setEditModel(prov.model || '')
    setTestResult(null)
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="loading-spinner" /> Loading LLM configuration...
      </div>
    )
  }

  if (error || !config) {
    return (
      <div style={{ padding: '2rem' }}>
        <div style={{ color: 'var(--accent-coral, #f87171)', padding: '1rem',
          background: 'rgba(255,100,100,0.08)', borderRadius: 8, border: '1px solid rgba(255,100,100,0.2)' }}>
          Failed to load LLM configuration: {error}
          <button onClick={fetchConfig} style={{
            marginLeft: 12, padding: '4px 12px', borderRadius: 4, cursor: 'pointer',
            background: 'var(--bg-elevated)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)',
          }}>Retry</button>
        </div>
      </div>
    )
  }

  const providerList = Object.entries(config.providers)
  const localProviders = providerList.filter(([, p]) => p.type === 'local')
  const cloudProviders = providerList.filter(([, p]) => p.type === 'cloud')
  const customProviders = providerList.filter(([, p]) => p.type === 'custom')

  const renderProvider = ([pid, prov]: [string, ProviderDef]) => {
    const isPrimary = config.primary === pid
    const isFallback = config.fallback === pid
    const isEditing = editProvider === pid
    const isTesting = testing === pid
    const hasTestResult = testResult?.provider === pid

    return (
      <div key={pid} style={{
        padding: '12px 16px', borderRadius: 8, marginBottom: 8,
        background: isPrimary
          ? 'rgba(100, 200, 150, 0.08)'
          : isFallback
            ? 'rgba(100, 180, 255, 0.06)'
            : 'var(--bg-surface)',
        border: `1px solid ${isPrimary
          ? 'rgba(100, 200, 150, 0.25)'
          : isFallback
            ? 'rgba(100, 180, 255, 0.2)'
            : 'var(--glass-border)'}`,
        transition: 'all 0.15s',
      }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{
            fontSize: '0.6rem', padding: '1px 6px', borderRadius: 3,
            background: TYPE_COLORS[prov.type] + '22', color: TYPE_COLORS[prov.type],
            fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {TYPE_LABELS[prov.type]}
          </span>
          <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
            {prov.name}
          </span>
          {isPrimary && (
            <span style={{
              fontSize: '0.6rem', padding: '1px 6px', borderRadius: 3,
              background: 'rgba(100, 200, 150, 0.2)', color: '#4ade80', fontWeight: 700,
            }}>
              PRIMARY
            </span>
          )}
          {isFallback && (
            <span style={{
              fontSize: '0.6rem', padding: '1px 6px', borderRadius: 3,
              background: 'rgba(100, 180, 255, 0.2)', color: '#60a5fa', fontWeight: 700,
            }}>
              FALLBACK
            </span>
          )}
          {prov.requires_key && (
            <span style={{
              fontSize: '0.6rem', padding: '1px 6px', borderRadius: 3, marginLeft: 'auto',
              background: prov.has_key ? 'rgba(100,200,150,0.15)' : 'rgba(255,180,50,0.15)',
              color: prov.has_key ? '#4ade80' : '#fbbf24',
            }}>
              {prov.has_key ? 'Key set' : 'No key'}
            </span>
          )}
        </div>

        {/* Description + model */}
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>
          {prov.description}
          {prov.model && (
            <span style={{ marginLeft: 8, fontFamily: 'monospace', opacity: 0.7 }}>
              model: {prov.model}
            </span>
          )}
          {prov.url && (
            <span style={{ marginLeft: 8, fontFamily: 'monospace', opacity: 0.5, fontSize: '0.65rem' }}>
              {prov.url}
            </span>
          )}
        </div>

        {/* Edit form */}
        {isEditing && (
          <div style={{
            padding: '10px 12px', borderRadius: 6, marginBottom: 8,
            background: 'rgba(0,0,0,0.15)', border: '1px solid var(--glass-border)',
          }}>
            {prov.key_field && (
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>
                  API Key {prov.has_key && '(leave blank to keep current)'}
                </label>
                <input
                  type="password"
                  value={editKey}
                  onChange={e => setEditKey(e.target.value)}
                  placeholder={prov.has_key ? '********' : 'Enter API key...'}
                  style={{
                    width: '100%', padding: '6px 10px', borderRadius: 4, fontSize: '0.8rem',
                    background: 'var(--bg-base)', border: '1px solid var(--glass-border)',
                    color: 'var(--text-primary)', fontFamily: 'monospace',
                  }}
                />
              </div>
            )}
            {prov.url_field && (
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>
                  Endpoint URL
                </label>
                <input
                  value={editUrl}
                  onChange={e => setEditUrl(e.target.value)}
                  placeholder="https://..."
                  style={{
                    width: '100%', padding: '6px 10px', borderRadius: 4, fontSize: '0.8rem',
                    background: 'var(--bg-base)', border: '1px solid var(--glass-border)',
                    color: 'var(--text-primary)', fontFamily: 'monospace',
                  }}
                />
              </div>
            )}
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>
                Model
              </label>
              <input
                value={editModel}
                onChange={e => setEditModel(e.target.value)}
                placeholder="auto"
                style={{
                  width: '100%', padding: '6px 10px', borderRadius: 4, fontSize: '0.8rem',
                  background: 'var(--bg-base)', border: '1px solid var(--glass-border)',
                  color: 'var(--text-primary)', fontFamily: 'monospace',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={saveProviderEdit} disabled={saving} style={{
                padding: '5px 14px', borderRadius: 4, fontSize: '0.75rem', cursor: 'pointer',
                background: 'var(--accent-green, #4ade80)', color: '#000', border: 'none', fontWeight: 600,
                opacity: saving ? 0.5 : 1,
              }}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setEditProvider(null)} style={{
                padding: '5px 14px', borderRadius: 4, fontSize: '0.75rem', cursor: 'pointer',
                background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--glass-border)',
              }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Test result */}
        {hasTestResult && testResult && (
          <div style={{
            padding: '8px 10px', borderRadius: 4, marginBottom: 8, fontSize: '0.75rem',
            background: testResult.ok ? 'rgba(100,200,150,0.1)' : 'rgba(255,100,100,0.1)',
            border: `1px solid ${testResult.ok ? 'rgba(100,200,150,0.2)' : 'rgba(255,100,100,0.2)'}`,
            color: testResult.ok ? '#4ade80' : '#f87171',
          }}>
            {testResult.ok ? (
              <>
                Connected {testResult.model && `(${testResult.model})`}
                {testResult.response_preview && (
                  <span style={{ opacity: 0.6, marginLeft: 8 }}>
                    "{testResult.response_preview}"
                  </span>
                )}
              </>
            ) : (
              <>Failed: {testResult.error}</>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {!isPrimary && (
            <button onClick={() => setPrimary(pid)} disabled={saving || (prov.requires_key && !prov.has_key)} style={{
              padding: '4px 10px', borderRadius: 4, fontSize: '0.7rem', cursor: 'pointer',
              background: 'rgba(100, 200, 150, 0.15)', color: '#4ade80', border: '1px solid rgba(100,200,150,0.25)',
              fontWeight: 600, opacity: (saving || (prov.requires_key && !prov.has_key)) ? 0.4 : 1,
            }}>
              Set as Primary
            </button>
          )}
          {!isFallback && pid !== config.primary && (
            <button onClick={() => setFallback(pid)} disabled={saving || (prov.requires_key && !prov.has_key)} style={{
              padding: '4px 10px', borderRadius: 4, fontSize: '0.7rem', cursor: 'pointer',
              background: 'rgba(100, 180, 255, 0.1)', color: '#60a5fa', border: '1px solid rgba(100,180,255,0.2)',
              opacity: (saving || (prov.requires_key && !prov.has_key)) ? 0.4 : 1,
            }}>
              Set as Fallback
            </button>
          )}
          {isFallback && (
            <button onClick={() => setFallback(null)} disabled={saving} style={{
              padding: '4px 10px', borderRadius: 4, fontSize: '0.7rem', cursor: 'pointer',
              background: 'rgba(255, 180, 50, 0.1)', color: '#fbbf24', border: '1px solid rgba(255,180,50,0.2)',
            }}>
              Remove Fallback
            </button>
          )}
          {!isEditing && (
            <button onClick={() => startEdit(pid, prov)} style={{
              padding: '4px 10px', borderRadius: 4, fontSize: '0.7rem', cursor: 'pointer',
              background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--glass-border)',
            }}>
              Configure
            </button>
          )}
          <button onClick={() => testProvider(pid)} disabled={isTesting || (prov.requires_key && !prov.has_key)} style={{
            padding: '4px 10px', borderRadius: 4, fontSize: '0.7rem', cursor: 'pointer',
            background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--glass-border)',
            opacity: (isTesting || (prov.requires_key && !prov.has_key)) ? 0.5 : 1,
          }}>
            {isTesting ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '1.25rem' }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 9999,
          padding: '10px 18px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600,
          background: 'var(--bg-elevated)', color: 'var(--text-primary)',
          border: '1px solid var(--glass-border)', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-primary)', fontWeight: 700 }}>
          LLM Configuration
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Select your primary inference provider, configure API keys, and set a fallback chain.
          Changes take effect immediately.
        </p>
      </div>

      {/* Active config summary */}
      <div style={{
        padding: '12px 16px', borderRadius: 8, marginBottom: '1.25rem',
        background: 'var(--bg-surface)', border: '1px solid var(--glass-border)',
        display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
            Primary
          </div>
          <div style={{ fontWeight: 700, color: '#4ade80', fontSize: '0.9rem' }}>
            {config.providers[config.primary]?.name || config.primary}
          </div>
        </div>
        <div style={{ width: 1, height: 30, background: 'var(--glass-border)' }} />
        <div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
            Fallback
          </div>
          <div style={{ fontWeight: 600, color: config.fallback ? '#60a5fa' : 'var(--text-muted)', fontSize: '0.9rem' }}>
            {config.fallback ? (config.providers[config.fallback]?.name || config.fallback) : 'None'}
          </div>
        </div>
        <div style={{ width: 1, height: 30, background: 'var(--glass-border)' }} />
        <div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
            Model
          </div>
          <div style={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.85rem', fontFamily: 'monospace' }}>
            {config.providers[config.primary]?.model || 'auto'}
          </div>
        </div>
        <button onClick={() => testProvider(config.primary)} disabled={!!testing}
          style={{
            marginLeft: 'auto', padding: '6px 14px', borderRadius: 6, fontSize: '0.75rem',
            cursor: 'pointer', fontWeight: 600,
            background: testing === config.primary ? 'var(--bg-elevated)' : 'rgba(100,200,150,0.15)',
            color: '#4ade80', border: '1px solid rgba(100,200,150,0.25)',
          }}>
          {testing === config.primary ? 'Testing...' : 'Test Primary'}
        </button>
      </div>

      {testResult?.provider === config.primary && (
        <div style={{
          padding: '10px 14px', borderRadius: 6, marginBottom: '1.25rem', fontSize: '0.8rem',
          background: testResult.ok ? 'rgba(100,200,150,0.08)' : 'rgba(255,100,100,0.08)',
          border: `1px solid ${testResult.ok ? 'rgba(100,200,150,0.2)' : 'rgba(255,100,100,0.2)'}`,
          color: testResult.ok ? '#4ade80' : '#f87171',
        }}>
          {testResult.ok
            ? `Primary is working. Model: ${testResult.model || 'unknown'}. Response: "${testResult.response_preview}"`
            : `Primary test failed: ${testResult.error}`
          }
        </div>
      )}

      {/* Local providers */}
      {localProviders.length > 0 && (
        <div style={{ marginBottom: '1.25rem' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '0.8rem', color: '#4ade80', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Local Inference
          </h3>
          {localProviders.map(renderProvider)}
        </div>
      )}

      {/* Cloud providers */}
      {cloudProviders.length > 0 && (
        <div style={{ marginBottom: '1.25rem' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '0.8rem', color: '#60a5fa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Cloud APIs
          </h3>
          {cloudProviders.map(renderProvider)}
        </div>
      )}

      {/* Custom */}
      {customProviders.length > 0 && (
        <div style={{ marginBottom: '1.25rem' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '0.8rem', color: '#c084fc', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Custom Endpoints
          </h3>
          {customProviders.map(renderProvider)}
        </div>
      )}
    </div>
  )
}
