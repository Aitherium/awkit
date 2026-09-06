'use client'

import React, { useState } from 'react'

export interface LLMProviderConfigProps {
  onConfigChange?: (config: LLMProviderSettings) => void
  initialConfig?: Partial<LLMProviderSettings>
}

export interface LLMProviderSettings {
  provider: string  // "local" | "openai" | "anthropic" | "deepseek" | "openrouter"
  api_key: string
  base_url: string
  model: string
}

/**
 * Would the browser refuse this request as MIXED CONTENT?
 *
 * An https:// page may not load an http:// subresource, and the block happens in
 * the browser — no request is sent, so the failure looks identical to "the server
 * is down". That distinction is the whole reason this helper exists: a hosted
 * portal telling a customer "Ollama not reachable" is describing a request it
 * never made.
 *
 * `http://localhost` is a SECURE CONTEXT by spec and is NOT blocked when the page
 * itself is http://localhost — so this must key on the page's protocol, not on
 * the word "localhost". Returns false during SSR, where there is no page.
 */
export function isMixedContentBlocked(target: string): boolean {
  if (typeof window === 'undefined') return false
  if (window.location.protocol !== 'https:') return false
  try {
    return new URL(target, window.location.href).protocol === 'http:'
  } catch {
    return false
  }
}

const PROVIDERS = [
  { id: 'local', name: 'Local (Ollama)', description: 'Run models on your own hardware — no API key needed', requiresKey: false, defaultUrl: 'http://localhost:11434', defaultModel: 'qwen3:8b' },
  { id: 'openai', name: 'OpenAI', description: 'GPT-4o, GPT-4o-mini', requiresKey: true, defaultUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' },
  { id: 'anthropic', name: 'Anthropic', description: 'Claude Sonnet 4.6, Claude Haiku 4.5', requiresKey: true, defaultUrl: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-4-6-20250514' },
  { id: 'deepseek', name: 'DeepSeek', description: 'DeepSeek Chat, DeepSeek Reasoner', requiresKey: true, defaultUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  { id: 'openrouter', name: 'OpenRouter', description: 'Access many providers through one API', requiresKey: true, defaultUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4o' },
]

export default function LLMProviderConfig({
  onConfigChange,
  initialConfig,
}: LLMProviderConfigProps) {
  const [provider, setProvider] = useState(initialConfig?.provider || 'local')
  const [apiKey, setApiKey] = useState(initialConfig?.api_key || '')
  const [baseUrl, setBaseUrl] = useState(initialConfig?.base_url || '')
  const [model, setModel] = useState(initialConfig?.model || '')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const currentProvider = PROVIDERS.find(p => p.id === provider) || PROVIDERS[0]

  const emitChange = (overrides: Partial<LLMProviderSettings> = {}) => {
    const config: LLMProviderSettings = {
      provider: overrides.provider ?? provider,
      api_key: overrides.api_key ?? apiKey,
      base_url: overrides.base_url ?? (baseUrl || currentProvider.defaultUrl),
      model: overrides.model ?? (model || currentProvider.defaultModel),
    }
    onConfigChange?.(config)
  }

  const handleProviderChange = (newProvider: string) => {
    const p = PROVIDERS.find(pr => pr.id === newProvider) || PROVIDERS[0]
    setProvider(newProvider)
    setBaseUrl(p.defaultUrl)
    setModel(p.defaultModel)
    setApiKey('')
    setTestResult(null)
    emitChange({ provider: newProvider, base_url: p.defaultUrl, model: p.defaultModel, api_key: '' })
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      // Simple validation: for local, check Ollama is running; for cloud, check API key format
      if (provider === 'local') {
        const url = baseUrl || 'http://localhost:11434'
        // A hosted portal is served over HTTPS, and a browser BLOCKS an http://
        // subresource from an https:// page (mixed content) before the request is
        // ever made. The old message said "Ollama not reachable at
        // http://localhost:11434", which blames Ollama for something it never
        // saw — measured 2026-08-19, a customer hit exactly this on a hosted
        // portal and read it as the setup being broken. Ollama may well be
        // running; the browser simply refused to ask.
        if (isMixedContentBlocked(url)) {
          setTestResult({
            ok: false,
            message:
              `This page is served over HTTPS, so your browser blocks requests to ${url} ` +
              `before they are sent — a local Ollama cannot be reached from a hosted portal, ` +
              `whether or not it is running. Use a cloud provider here, or open the portal ` +
              `from your own machine to use Ollama.`,
          })
        } else {
          const res = await fetch(`${url}/api/version`).catch(() => null)
          if (res?.ok) {
            setTestResult({ ok: true, message: 'Ollama is running' })
          } else {
            setTestResult({ ok: false, message: 'Ollama not reachable at ' + url })
          }
        }
      } else {
        if (!apiKey) {
          setTestResult({ ok: false, message: 'API key is required' })
        } else if (provider === 'openai' && !apiKey.startsWith('sk-')) {
          setTestResult({ ok: false, message: 'OpenAI keys start with sk-' })
        } else if (provider === 'anthropic' && !apiKey.startsWith('sk-ant-')) {
          setTestResult({ ok: false, message: 'Anthropic keys start with sk-ant-' })
        } else {
          setTestResult({ ok: true, message: 'API key format looks valid' })
        }
      }
    } finally {
      setTesting(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px',
    background: 'var(--bg-deep, #111)', border: '1px solid var(--glass-border, #333)',
    borderRadius: 'var(--radius, 8px)', color: 'var(--text-primary, #e0e0e0)',
    fontSize: 13, outline: 'none',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 11, color: 'var(--text-muted, #888)', marginBottom: 4, display: 'block', fontWeight: 500,
  }

  return (
    <div>
      {/* Provider selection */}
      <label style={labelStyle}>LLM Provider</label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginBottom: 16 }}>
        {PROVIDERS.map(p => (
          <div
            key={p.id}
            onClick={() => handleProviderChange(p.id)}
            style={{
              padding: 10, borderRadius: 'var(--radius, 8px)',
              background: provider === p.id ? 'var(--bg-active, #1a2a4a)' : 'var(--bg-surface, #16162a)',
              border: `1px solid ${provider === p.id ? 'var(--accent, #6366f1)' : 'var(--glass-border, #2a2a4a)'}`,
              cursor: 'pointer', transition: 'border-color 0.15s',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted, #888)', marginTop: 2 }}>{p.description}</div>
          </div>
        ))}
      </div>

      {/* Configuration fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {currentProvider.requiresKey && (
          <div>
            <label style={labelStyle}>API Key</label>
            <input
              type="password"
              placeholder="Enter API key..."
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); emitChange({ api_key: e.target.value }) }}
              style={inputStyle}
            />
          </div>
        )}

        <div>
          <label style={labelStyle}>Base URL</label>
          <input
            type="text"
            placeholder={currentProvider.defaultUrl}
            value={baseUrl}
            onChange={e => { setBaseUrl(e.target.value); emitChange({ base_url: e.target.value }) }}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Model</label>
          <input
            type="text"
            placeholder={currentProvider.defaultModel}
            value={model}
            onChange={e => { setModel(e.target.value); emitChange({ model: e.target.value }) }}
            style={inputStyle}
          />
        </div>

        {/* Test button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={testConnection}
            disabled={testing}
            style={{
              padding: '8px 16px', borderRadius: 'var(--radius, 8px)',
              background: 'var(--bg-surface, #16162a)', color: 'var(--text-primary, #e0e0e0)',
              cursor: testing ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600,
              border: '1px solid var(--glass-border, #2a2a4a)',
            }}
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
          {testResult && (
            <span style={{ fontSize: 12, color: testResult.ok ? '#4ade80' : '#f87171' }}>
              {testResult.message}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
