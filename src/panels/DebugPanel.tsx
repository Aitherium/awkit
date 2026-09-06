'use client'

import { useState, useEffect } from 'react'
import { submitDebugBundle, SubmitBundleResult } from '../lib/telemetry'

interface RelayStatus {
  status: string
  connected?: boolean
  [key: string]: any
}

interface AgentCheckResult {
  status: string
  healthy?: boolean
  [key: string]: any
}

interface CapturedBundle {
  artifact_id?: string
  captured_at?: string
  size_bytes?: number
  [key: string]: any
}

export interface DebugPanelProps {
  apiBase?: string
}

const StatusDot = ({ ok }: { ok: boolean }) => (
  <span style={{
    width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
    background: ok ? 'var(--accent-green)' : 'var(--accent-coral)',
  }} />
)

export default function DebugPanel({ apiBase = '' }: DebugPanelProps) {
  const [relayStatus, setRelayStatus] = useState<RelayStatus | null>(null)
  const [agentStatus, setAgentStatus] = useState<AgentCheckResult | null>(null)
  const [bundleResult, setBundleResult] = useState<SubmitBundleResult | null>(null)
  const [capturingBundle, setCapturingBundle] = useState(false)
  const [capturedBundles, setCapturedBundles] = useState<CapturedBundle[]>([])

  useEffect(() => {
    fetch(`${apiBase}/api/platform/relay-status`)
      .then(r => r.json())
      .then(setRelayStatus)
      .catch(() => setRelayStatus({ status: 'error' }))
  }, [apiBase])

  useEffect(() => {
    fetch(`${apiBase}/api/platform/agent-check`, { method: 'POST' })
      .then(r => r.json())
      .then(setAgentStatus)
      .catch(() => setAgentStatus({ status: 'error' }))
  }, [apiBase])

  useEffect(() => {
    fetch(`${apiBase}/api/debug/bundles`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => {
        const list = Array.isArray(data) ? data : data?.bundles
        if (Array.isArray(list)) setCapturedBundles(list)
      })
      .catch(() => setCapturedBundles([]))
  }, [apiBase])

  const handleCaptureBundle = async () => {
    setCapturingBundle(true)
    setBundleResult(null)
    const result = await submitDebugBundle(apiBase, { captured_from: 'DebugPanel' })
    setBundleResult(result)
    setCapturingBundle(false)
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 800 }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.5rem' }}>Debug Panel</h2>

      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>
          Capture Debug Bundle
        </h3>
        <div style={{
          background: 'var(--bg-surface)', padding: '1rem', borderRadius: 'var(--radius)',
          border: '1px solid var(--glass-border)',
        }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
            Capture console logs, network activity, performance metrics, and browser state.
          </p>
          <button
            onClick={handleCaptureBundle}
            disabled={capturingBundle}
            style={{
              padding: '0.6rem 1rem', borderRadius: 'var(--radius)', fontWeight: 600, fontSize: '0.85rem',
              cursor: capturingBundle ? 'not-allowed' : 'pointer', border: 'none',
              background: capturingBundle ? 'var(--text-muted)' : 'var(--accent-primary)',
              color: '#fff', opacity: capturingBundle ? 0.6 : 1,
            }}
          >
            {capturingBundle ? 'Capturing...' : 'Capture Debug Bundle'}
          </button>

          {bundleResult && (
            <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'var(--bg-elevated)', borderRadius: 'var(--radius)' }}>
              {bundleResult.ok ? (
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--accent-green)' }}>
                  Bundle captured successfully
                </div>
              ) : (
                <div style={{ fontSize: '0.85rem', color: 'var(--accent-coral)' }}>
                  Error: {bundleResult.error}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>
          Relay Status
        </h3>
        <div style={{ background: 'var(--bg-surface)', padding: '1rem', borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)' }}>
          {relayStatus ? (
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '0.5rem', fontSize: '0.85rem' }}>
              <StatusDot ok={relayStatus.status === 'ok'} />
              <span style={{ color: 'var(--text-muted)' }}>Status:</span>
              <span style={{ fontWeight: 600 }}>{relayStatus.status || 'unknown'}</span>
            </div>
          ) : (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Loading...</div>
          )}
        </div>
      </section>

      <section>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>
          Agent Status
        </h3>
        <div style={{ background: 'var(--bg-surface)', padding: '1rem', borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)' }}>
          {agentStatus ? (
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '0.5rem', fontSize: '0.85rem' }}>
              <StatusDot ok={agentStatus.status === 'ok'} />
              <span style={{ color: 'var(--text-muted)' }}>Status:</span>
              <span style={{ fontWeight: 600 }}>{agentStatus.status || 'unknown'}</span>
            </div>
          ) : (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Loading...</div>
          )}
        </div>
      </section>
    </div>
  )
}
