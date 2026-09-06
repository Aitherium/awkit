'use client'

import React, { useState, useEffect, useCallback } from 'react'

interface WorkspaceConfigPanelProps {
  workspaceId: string
  apiBase?: string
}

export default function WorkspaceConfigPanel({ workspaceId, apiBase = '' }: WorkspaceConfigPanelProps) {
  const [config, setConfig] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'identity' | 'features' | 'llm' | 'branding' | 'verification'>('identity')
  const [message, setMessage] = useState('')

  // Editable fields
  const [systemPrompt, setSystemPrompt] = useState('')
  const [welcomeMessage, setWelcomeMessage] = useState('')
  const [features, setFeatures] = useState<string[]>([])
  const [handsOffPatterns, setHandsOffPatterns] = useState('')
  const [requireTests, setRequireTests] = useState(true)

  const fetchConfig = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/workspaces/${workspaceId}/config`)
      if (res.ok) {
        const data = await res.json()
        setConfig(data)
        const bp = data.brain_pack || {}
        setSystemPrompt(bp.system_prompt || '')
        setWelcomeMessage(bp.welcome_message || '')
        setFeatures(bp.features || [])
        const v = bp.verification || {}
        setHandsOffPatterns((v.hands_off_patterns || []).join('\n'))
        setRequireTests(v.require_tests !== false)
      }
    } catch {
      setMessage('Failed to load config')
    }
    setLoading(false)
  }, [workspaceId, apiBase])

  useEffect(() => { fetchConfig() }, [fetchConfig])

  const save = async () => {
    setSaving(true)
    setMessage('')
    try {
      const body: any = {}
      if (tab === 'identity') {
        body.system_prompt = systemPrompt
        body.welcome_message = welcomeMessage
      } else if (tab === 'features') {
        body.features = features
      } else if (tab === 'verification') {
        body.verification = {
          hands_off_patterns: handsOffPatterns.split('\n').filter(Boolean),
          require_tests: requireTests,
        }
      }
      const res = await fetch(`${apiBase}/workspaces/${workspaceId}/configure`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        setMessage(`Saved! Changes: ${data.changes?.join(', ')}${data.restarted ? ' (container restarted)' : ''}`)
        fetchConfig()
      } else {
        setMessage('Save failed')
      }
    } catch {
      setMessage('Connection error')
    }
    setSaving(false)
  }

  if (loading) return <div className="p-6 text-gray-400">Loading config...</div>

  const tabs = [
    { id: 'identity' as const, label: 'Identity' },
    { id: 'features' as const, label: 'Features' },
    { id: 'llm' as const, label: 'LLM' },
    { id: 'branding' as const, label: 'Branding' },
    { id: 'verification' as const, label: 'Verification' },
  ]

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Workspace Config</h2>
        <span className="text-xs text-gray-500">{workspaceId}</span>
      </div>

      <div className="flex gap-1">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              tab === t.id ? 'bg-cyan-500/15 text-cyan-400' : 'text-gray-500 hover:text-gray-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-gray-800/40 rounded-lg p-4 space-y-3">
        {tab === 'identity' && (
          <>
            <label className="block">
              <span className="text-xs text-gray-400">System Prompt</span>
              <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)}
                rows={4} className="w-full mt-1 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-gray-200" />
            </label>
            <label className="block">
              <span className="text-xs text-gray-400">Welcome Message</span>
              <input value={welcomeMessage} onChange={e => setWelcomeMessage(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-gray-200" />
            </label>
          </>
        )}

        {tab === 'features' && (
          <div className="space-y-2">
            <span className="text-xs text-gray-400">Enabled Features</span>
            <div className="flex flex-wrap gap-2">
              {['chat', 'documents', 'comms', 'people', 'agents', 'platform', 'settings', 'calendar', 'tasks', 'invoicing', 'analytics'].map(f => (
                <button key={f} onClick={() => setFeatures(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f])}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    features.includes(f) ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'bg-gray-800 text-gray-500 border border-gray-700'
                  }`}>
                  {f}
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === 'llm' && (
          <div className="text-sm text-gray-400">
            <p>LLM config: {JSON.stringify(config?.brain_pack?.llm_config || {}, null, 2)}</p>
          </div>
        )}

        {tab === 'branding' && (
          <div className="text-sm text-gray-400">
            <p>Brand config: {JSON.stringify(config?.brand || {}, null, 2)}</p>
          </div>
        )}

        {tab === 'verification' && (
          <>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={requireTests} onChange={e => setRequireTests(e.target.checked)} />
              <span className="text-sm text-gray-300">Require tests to pass</span>
            </label>
            <label className="block">
              <span className="text-xs text-gray-400">Hands-off patterns (one per line)</span>
              <textarea value={handsOffPatterns} onChange={e => setHandsOffPatterns(e.target.value)}
                rows={3} placeholder="*.env&#10;docker-compose.yml&#10;Dockerfile"
                className="w-full mt-1 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-gray-200 font-mono" />
            </label>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-40 transition-all">
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        {message && <span className="text-xs text-gray-400">{message}</span>}
      </div>
    </div>
  )
}
