'use client'

import { useState, useEffect, useCallback } from 'react'
import PortalFiles from './PortalFiles'

interface ServiceStatus {
  status: string
  url?: string
}

interface PlatformStatus {
  genesis: ServiceStatus
  node: ServiceStatus
  strata: ServiceStatus
  directory?: ServiceStatus
  memory?: ServiceStatus
  embeddings?: ServiceStatus
  relay?: ServiceStatus
  deployment_mode: string
  portal: string
}

interface PlatformPanelProps {
  apiBase?: string
}

export default function PlatformPanel({ apiBase = '/api/platform' }: PlatformPanelProps = {}) {
  const [status, setStatus] = useState<PlatformStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/status`)
      if (r.ok) setStatus(await r.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  const syncStrata = async () => {
    setSyncing(true); setSyncResult(null)
    try {
      const r = await fetch(`${apiBase}/files/sync`, { method: 'POST' })
      const d = await r.json()
      setSyncResult(`Synced ${d.synced}/${d.total} documents to Strata`)
    } catch { setSyncResult('Sync failed') }
    finally { setSyncing(false) }
  }

  const syncMemory = async () => {
    setSyncing(true); setSyncResult(null)
    try {
      const r = await fetch(`${apiBase}/memory/sync`, { method: 'POST' })
      const d = await r.json()
      setSyncResult(`Pushed ${d.memories_pushed} memories to platform`)
    } catch { setSyncResult('Memory sync failed') }
    finally { setSyncing(false) }
  }

  const reindex = async () => {
    setSyncing(true); setSyncResult(null)
    try {
      const r = await fetch(`${apiBase}/agent/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'gargbot', task: 'reindex_knowledge' }),
      })
      const d = await r.json()
      setSyncResult(d.error ? `Reindex failed: ${d.error}` : 'Knowledge reindex triggered')
    } catch { setSyncResult('Reindex request failed') }
    finally { setSyncing(false) }
  }

  if (loading) return <div style={{ padding: '2rem', color: 'var(--text-muted)' }}>Loading platform status...</div>

  const StatusDot = ({ ok }: { ok: boolean }) => (
    <span style={{ width: 10, height: 10, borderRadius: '50%', display: 'inline-block',
      background: ok ? 'var(--accent-green)' : 'var(--accent-coral)',
      boxShadow: ok ? '0 0 6px var(--accent-green)' : '0 0 6px var(--accent-coral)' }} />
  )

  const services = status ? [
    { name: 'Genesis', key: 'genesis', desc: 'Orchestrator' },
    { name: 'Node', key: 'node', desc: 'MCP Tools' },
    { name: 'Strata', key: 'strata', desc: 'Data Plane' },
    { name: 'Directory', key: 'directory', desc: 'Users & Groups' },
    { name: 'Memory', key: 'memory', desc: 'Memory Hub' },
    { name: 'Embeddings', key: 'embeddings', desc: 'Vector Encoding' },
    { name: 'Relay', key: 'relay', desc: 'Channels' },
  ] : []

  return (
    <div style={{ padding: '1.5rem', maxWidth: 900 }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.5rem' }}>Platform Integration</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '2rem' }}>
        {services.map(svc => {
          const s = (status as any)?.[svc.key]
          const isOk = s?.status === 'ok'
          return (
            <div key={svc.key} style={{ padding: '1rem', background: 'var(--bg-surface)',
              borderRadius: 'var(--radius)', border: `1px solid ${isOk ? 'var(--glass-border)' : 'oklch(0.30 0.10 25 / 0.3)'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                <StatusDot ok={isOk} />
                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{svc.name}</span>
              </div>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{svc.desc}</p>
              <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.2rem', opacity: 0.6 }}>
                {s?.url || 'not configured'}
              </p>
            </div>
          )
        })}
      </div>

      <div style={{ background: 'var(--bg-surface)', padding: '1.25rem', borderRadius: 'var(--radius)',
        border: '1px solid var(--glass-border)', marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem' }}>Sync Actions</h3>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button onClick={syncStrata} disabled={syncing} style={{
            padding: '0.6rem 1rem', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
            borderRadius: 'var(--radius)', fontSize: '0.8rem', border: '1px solid var(--glass-border)',
            opacity: syncing ? 0.5 : 1 }}>
            Sync to Strata
          </button>
          <button onClick={syncMemory} disabled={syncing} style={{
            padding: '0.6rem 1rem', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
            borderRadius: 'var(--radius)', fontSize: '0.8rem', border: '1px solid var(--glass-border)',
            opacity: syncing ? 0.5 : 1 }}>
            Sync Memory
          </button>
          <button onClick={reindex} disabled={syncing} style={{
            padding: '0.6rem 1rem', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
            borderRadius: 'var(--radius)', fontSize: '0.8rem', border: '1px solid var(--glass-border)',
            opacity: syncing ? 0.5 : 1 }}>
            Reindex Knowledge
          </button>
          <a href={status?.portal || 'https://portal.aitherium.com'} target="_blank" rel="noopener"
            style={{ padding: '0.6rem 1rem', background: 'var(--accent-primary)', color: 'var(--bg-deep)',
              borderRadius: 'var(--radius)', fontSize: '0.8rem', fontWeight: 600, textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center' }}>
            Open Portal
          </a>
        </div>
        {syncResult && <p style={{ fontSize: '0.8rem', color: 'var(--accent-green)', marginTop: '0.75rem' }}>{syncResult}</p>}
      </div>

      <div style={{ background: 'var(--bg-surface)', padding: '1.25rem', borderRadius: 'var(--radius)',
        border: '1px solid var(--glass-border)', marginBottom: '1.5rem' }}>
        <PortalFiles />
      </div>

      <div style={{ background: 'var(--bg-surface)', padding: '1.25rem', borderRadius: 'var(--radius)',
        border: '1px solid var(--glass-border)' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem' }}>Deployment</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '0.4rem', fontSize: '0.85rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>Mode:</span>
          <span style={{ fontWeight: 500 }}>{status?.deployment_mode || 'standalone'}</span>
          <span style={{ color: 'var(--text-muted)' }}>App URL:</span>
          <span>garg.aitherium.com</span>
          <span style={{ color: 'var(--text-muted)' }}>Portal:</span>
          <a href={status?.portal} target="_blank" rel="noopener">{status?.portal}</a>
          <span style={{ color: 'var(--text-muted)' }}>App ID:</span>
          <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>gargbot</span>
        </div>
      </div>
    </div>
  )
}
