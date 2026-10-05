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
  app_id?: string
}

interface ReleaseEntry {
  version: string
  channel?: string
  changelog?: string
  released_at?: string
  breaking_changes?: boolean
}

interface WhatsNew {
  slug?: string
  current_version?: string | null
  /** The deployment's release channel; versions are already filtered to it. */
  channel?: string
  latest?: string | null
  versions: ReleaseEntry[]
  available?: boolean | null
}

interface PlatformPanelProps {
  apiBase?: string
  /** Base of the platform-events router (signed release/member webhooks). */
  eventsBase?: string
  /** Agent the reindex task is dispatched to; omitted, the host backend picks its own. */
  agent?: string
  /** Shown as App ID; defaults to the status payload's app_id. */
  appId?: string
}

/** One metered quantity as the platform reports it. Nothing here is defaulted. */
interface UsageRow { key: string; used: number; limit?: number }

/**
 * Read whatever usage the platform returned into rows, without inventing any of
 * it: a row needs a numeric `used`; `limit` is shown only when the platform sent
 * one. (The backend that feeds this once answered an outage with made-up limits,
 * 1,000,000 tokens and 200 dispatches; it now answers 503, and so must we.)
 */
function usageRows(data: unknown): UsageRow[] {
  if (!data || typeof data !== 'object') return []
  const rows: UsageRow[] = []
  for (const [key, v] of Object.entries(data as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const used = (v as Record<string, unknown>).used
    const limit = (v as Record<string, unknown>).limit
    if (typeof used !== 'number') continue
    rows.push({ key, used, ...(typeof limit === 'number' ? { limit } : {}) })
  }
  return rows
}

export default function PlatformPanel({ apiBase = '/api/platform', eventsBase = '/api/platform-events', agent, appId }: PlatformPanelProps = {}) {
  const [status, setStatus] = useState<PlatformStatus | null>(null)
  // 'unavailable' = the status probe itself did not answer; we say so rather than
  // render an empty grid that reads as "no services".
  const [statusState, setStatusState] = useState<'loading' | 'ok' | 'unavailable'>('loading')
  const [usage, setUsage] = useState<UsageRow[] | 'unavailable' | null>(null)
  const [whatsNew, setWhatsNew] = useState<WhatsNew | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/status`)
      if (r.ok) { setStatus(await r.json()); setStatusState('ok') }
      else setStatusState('unavailable')
    } catch { setStatusState('unavailable') }
    finally { setLoading(false) }
  }, [apiBase])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  useEffect(() => {
    let cancelled = false
    fetch(`${apiBase}/workspace/usage`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return
        const rows = usageRows(d)
        setUsage(rows.length ? rows : 'unavailable')
      })
      .catch(() => { if (!cancelled) setUsage('unavailable') })
    return () => { cancelled = true }
  }, [apiBase])

  useEffect(() => {
    let cancelled = false
    fetch(`${eventsBase}/whats-new`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setWhatsNew(d ? { ...d, versions: d.versions ?? [] } : { versions: [], available: false }) })
      .catch(() => { if (!cancelled) setWhatsNew({ versions: [], available: false }) })
    return () => { cancelled = true }
  }, [eventsBase])

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
        body: JSON.stringify({ ...(agent ? { agent } : {}), task: 'reindex_knowledge' }),
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
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.5rem' }}>Your Platform</h2>

      {statusState === 'unavailable' && (
        <div role="status" style={{ padding: '1rem', marginBottom: '1.5rem', background: 'var(--bg-surface)',
          borderRadius: 'var(--radius)', border: '1px solid oklch(0.30 0.10 25 / 0.3)' }}>
          <strong style={{ fontSize: '0.9rem' }}>Platform status is unavailable</strong>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
            This app could not get an answer from its platform probe, so the state of the connected
            services is unknown. Nothing below is a guess: sections that need the platform say so.
          </p>
        </div>
      )}
      {statusState === 'ok' && status?.genesis?.status !== 'ok' && (
        <div role="status" style={{ padding: '1rem', marginBottom: '1.5rem', background: 'var(--bg-surface)',
          borderRadius: 'var(--radius)', border: '1px solid oklch(0.30 0.10 25 / 0.3)' }}>
          <strong style={{ fontSize: '0.9rem' }}>The Aitherium platform is not answering</strong>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
            Genesis is unreachable from this app right now. Usage, release notes and agent actions
            are unavailable until it answers.
          </p>
        </div>
      )}

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
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem' }}>Usage</h3>
        {usage === null ? (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Loading usage...</p>
        ) : usage === 'unavailable' ? (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Usage is unavailable right now: the platform did not report it.
          </p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '0.4rem', fontSize: '0.85rem' }}>
            {usage.map(u => (
              <div key={u.key} style={{ display: 'contents' }}>
                <span style={{ color: 'var(--text-muted)' }}>{u.key.replace(/_/g, ' ')}</span>
                <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                  {u.used.toLocaleString()}{u.limit !== undefined ? ` of ${u.limit.toLocaleString()}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
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
          <a href={status?.portal || 'https://api.aitherium.com'} target="_blank" rel="noopener"
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
        border: '1px solid var(--glass-border)', marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem' }}>Version and what&apos;s new</h3>
        {whatsNew === null ? (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Loading release notes...</p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '0.4rem', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Running:</span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{whatsNew.current_version || 'unknown'}</span>
              <span style={{ color: 'var(--text-muted)' }}>Latest:</span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{whatsNew.latest ?? '-'}</span>
            </div>
            {whatsNew.available === false && whatsNew.versions.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Release information is unavailable right now.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.6rem' }}>
                {whatsNew.versions.slice(0, 5).map(v => (
                  <li key={v.version} style={{ padding: '0.6rem 0.75rem', background: 'var(--bg-elevated)',
                    borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '0.85rem' }}>{v.version}</strong>
                      {v.channel && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{v.channel}</span>}
                      {v.breaking_changes && <span style={{ fontSize: '0.7rem', color: 'var(--accent-coral)' }}>breaking changes</span>}
                      {v.released_at && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                        {new Date(v.released_at).toLocaleDateString()}</span>}
                    </div>
                    {v.changelog && <p style={{ fontSize: '0.8rem', marginTop: '0.3rem', whiteSpace: 'pre-wrap' }}>{v.changelog}</p>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div style={{ background: 'var(--bg-surface)', padding: '1.25rem', borderRadius: 'var(--radius)',
        border: '1px solid var(--glass-border)' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem' }}>Deployment</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '0.4rem', fontSize: '0.85rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>Mode:</span>
          <span style={{ fontWeight: 500 }}>{status?.deployment_mode || 'standalone'}</span>
          <span style={{ color: 'var(--text-muted)' }}>App URL:</span>
          <span>{typeof window !== 'undefined' ? window.location.host : ''}</span>
          <span style={{ color: 'var(--text-muted)' }}>Portal:</span>
          <a href={status?.portal} target="_blank" rel="noopener">{status?.portal}</a>
          <span style={{ color: 'var(--text-muted)' }}>App ID:</span>
          <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{appId ?? status?.app_id ?? '-'}</span>
        </div>
      </div>
    </div>
  )
}
