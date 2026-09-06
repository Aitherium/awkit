'use client'

import { useState, useEffect, useCallback } from 'react'
import { AlertCircle, Loader2, Package, ExternalLink, RefreshCw, Trash2, PlayCircle, PauseCircle, Activity, ArrowUpCircle } from 'lucide-react'

interface Deployment {
  deployment_id: string
  slug: string
  name: string
  status: 'provisioning' | 'running' | 'failed' | 'unreachable' | 'restarting' | 'stopped' | 'destroying'
  endpoint_url?: string
  health_status?: string
  created_at: string
  replicas?: number
}

type StatusType = Deployment['status']

export default function DeployedAppsPanel() {
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set())
  const [lastRefetch, setLastRefetch] = useState(Date.now())
  const [updates, setUpdates] = useState<Record<string, boolean>>({})
  // Per-deployment "what's new": [{version, notes[]}, ...] newest first, from
  // the app manifest's changelog via update-status. Empty = show the plain
  // banner; the update itself never depends on notes existing.
  const [releaseNotes, setReleaseNotes] = useState<Record<string, { version: string; notes: string[] }[]>>({})
  const [targetVersions, setTargetVersions] = useState<Record<string, string>>({})

  // Poll deployments every 10 seconds
  useEffect(() => {
    fetchDeployments()
    const interval = setInterval(() => {
      fetchDeployments()
    }, 10000)
    return () => clearInterval(interval)
  }, [])

  const fetchDeployments = useCallback(async () => {
    try {
      const res = await fetch('/api/apps/deployments', {
        headers: { 'Content-Type': 'application/json' },
      })

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setError('Not authorized to view deployments')
          setIsAdmin(false)
          return
        }
        throw new Error(`Failed to load deployments: ${res.status}`)
      }

      const data = await res.json()
      setDeployments(data || [])
      setError(null)

      // Best-effort "update available" check per running deployment. Fail-soft:
      // an inspect error just means no badge — never a false "update available".
      const upd: Record<string, boolean> = {}
      const notes: Record<string, { version: string; notes: string[] }[]> = {}
      const targets: Record<string, string> = {}
      await Promise.all((data || [])
        .filter((dp: Deployment) => dp.status === 'running')
        .map(async (dp: Deployment) => {
          try {
            const r = await fetch(`/api/apps/deployments/${encodeURIComponent(dp.deployment_id)}/update-status`, {
              headers: { 'Content-Type': 'application/json' },
            })
            if (r.ok) {
              const j = await r.json()
              upd[dp.deployment_id] = j.update_available === true
              if (Array.isArray(j.release_notes)) notes[dp.deployment_id] = j.release_notes
              if (j.target_version) targets[dp.deployment_id] = j.target_version
            }
          } catch { /* ignore — no badge */ }
        }))
      setUpdates(upd)
      setReleaseNotes(notes)
      setTargetVersions(targets)

      // Reading deployments is allowed for any workspace member, so a 200 here says
      // nothing about admin rights. Ask the server who the caller is; restart/scale are
      // admin-gated server-side regardless of what this flag renders.
      try {
        const meRes = await fetch('/api/workspace/members', {
          headers: { 'Content-Type': 'application/json' },
        })
        setIsAdmin(meRes.ok && (await meRes.json()).caller_is_admin === true)
      } catch {
        setIsAdmin(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deployments')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleRefresh = useCallback(async (deploymentId: string) => {
    setActionLoading(prev => new Set(prev).add(deploymentId))
    try {
      const res = await fetch(`/api/apps/deployments/${encodeURIComponent(deploymentId)}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) throw new Error(`Failed to restart deployment`)
      await fetchDeployments()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restart deployment')
    } finally {
      setActionLoading(prev => {
        const next = new Set(prev)
        next.delete(deploymentId)
        return next
      })
    }
  }, [fetchDeployments])

  const handleUpgrade = useCallback(async (deploymentId: string) => {
    setActionLoading(prev => new Set(prev).add(deploymentId))
    try {
      // Sanctioned, health-gated, rollback-capable redeploy onto the newer image.
      const res = await fetch(`/api/apps/deployments/${encodeURIComponent(deploymentId)}/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      })
      if (!res.ok) throw new Error('Failed to start update')
      setUpdates(prev => ({ ...prev, [deploymentId]: false }))
      await fetchDeployments()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start update')
    } finally {
      setActionLoading(prev => {
        const next = new Set(prev)
        next.delete(deploymentId)
        return next
      })
    }
  }, [fetchDeployments])

  const handleDelete = useCallback(async (deploymentId: string) => {
    if (!confirm('Permanently delete this deployment?')) return
    setActionLoading(prev => new Set(prev).add(deploymentId))
    try {
      const res = await fetch(`/api/apps/deployments/${encodeURIComponent(deploymentId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) throw new Error(`Failed to delete deployment`)
      await fetchDeployments()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete deployment')
    } finally {
      setActionLoading(prev => {
        const next = new Set(prev)
        next.delete(deploymentId)
        return next
      })
    }
  }, [fetchDeployments])

  const handleToggleScale = useCallback(async (deploymentId: string, currentReplicas: number) => {
    const newReplicas = currentReplicas > 0 ? 0 : 1
    setActionLoading(prev => new Set(prev).add(deploymentId))
    try {
      const res = await fetch(`/api/apps/deployments/${encodeURIComponent(deploymentId)}/scale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replicas: newReplicas }),
      })
      if (!res.ok) throw new Error(`Failed to scale deployment`)
      await fetchDeployments()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scale deployment')
    } finally {
      setActionLoading(prev => {
        const next = new Set(prev)
        next.delete(deploymentId)
        return next
      })
    }
  }, [fetchDeployments])

  const getStatusColor = (status: StatusType): string => {
    switch (status) {
      case 'running':
        return 'var(--accent-green)'
      case 'provisioning':
      case 'restarting':
        return 'var(--accent-cyan)'
      case 'stopped':
        return 'var(--text-secondary)'
      case 'failed':
      case 'unreachable':
        return 'var(--text-danger)'
      default:
        return 'var(--text-secondary)'
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <Loader2 style={{ display: 'inline-block', marginRight: '0.5rem', animation: 'spin 1s linear infinite' }} size={20} />
        Loading deployments...
      </div>
    )
  }

  if (error && !deployments.length) {
    return (
      <div style={{ padding: '2rem', color: 'var(--text-danger)' }}>
        <AlertCircle style={{ display: 'inline-block', marginRight: '0.5rem' }} size={20} />
        {error}
        <button
          onClick={() => fetchDeployments()}
          style={{ marginLeft: '1rem', padding: '0.35rem 0.75rem', borderRadius: 'var(--radius)', border: 'none', background: 'var(--bg-base)', cursor: 'pointer' }}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.25rem' }}>Deployments ({deployments.length})</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Monitor and manage your app deployments.</p>
        </div>
        <button
          onClick={() => fetchDeployments()}
          style={{
            padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)', border: 'none', background: 'var(--bg-elevated)',
            color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem',
          }}
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      {deployments.length === 0 ? (
        <div style={{
          padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', borderRadius: 'var(--radius)',
          background: 'var(--bg-elevated)',
        }}>
          <Package size={32} style={{ margin: '0 auto 0.5rem', opacity: 0.5 }} />
          <p>No deployed applications yet.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {deployments.map(deployment => {
            const isActive = ['running', 'provisioning', 'restarting'].includes(deployment.status)
            const isStopped = deployment.status === 'stopped'
            const isLoading = actionLoading.has(deployment.deployment_id)
            return (
              <div
                key={deployment.deployment_id}
                style={{
                  borderRadius: 'var(--radius)', background: 'var(--bg-elevated)', padding: '1.25rem',
                  borderLeft: `3px solid ${getStatusColor(deployment.status)}`,
                  opacity: deployment.status === 'destroying' ? 0.5 : 1,
                  transition: 'opacity 0.2s',
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <div>
                    <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.35rem' }}>{deployment.name}</h4>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      {deployment.slug} • {new Date(deployment.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.75rem',
                    borderRadius: '0.25rem', background: getStatusColor(deployment.status) + '15',
                    color: getStatusColor(deployment.status), fontSize: '0.85rem', fontWeight: 500,
                  }}>
                    <Activity size={14} />
                    {deployment.status === 'running' ? 'Running' : deployment.status === 'provisioning' ? 'Provisioning' : deployment.status === 'restarting' ? 'Restarting' : deployment.status === 'stopped' ? 'Stopped' : 'Failed'}
                  </div>
                </div>

                {updates[deployment.deployment_id] && (
                  <div style={{
                    marginBottom: '0.75rem', padding: '0.5rem 0.6rem', borderRadius: 'var(--radius)',
                    background: 'var(--accent-cyan)15', fontSize: '0.82rem',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-cyan)', fontWeight: 500 }}>
                      <ArrowUpCircle size={15} />
                      {targetVersions[deployment.deployment_id]
                        ? `Version ${targetVersions[deployment.deployment_id]} is available.`
                        : 'A newer version of this app is available.'}
                    </div>
                    {(releaseNotes[deployment.deployment_id] || []).map((rel) => (
                      <div key={rel.version} style={{ marginTop: '0.45rem', color: 'var(--text-primary)' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.78rem', opacity: 0.85 }}>What's new in {rel.version}</div>
                        <ul style={{ margin: '0.25rem 0 0 1.1rem', padding: 0 }}>
                          {rel.notes.map((n, i) => (
                            <li key={i} style={{ marginBottom: '0.15rem' }}>{n}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}

                {/* URL and Health */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem', fontSize: '0.9rem' }}>
                  {deployment.endpoint_url && (
                    <div>
                      <div style={{ color: 'var(--text-secondary)', marginBottom: '0.25rem', fontSize: '0.85rem' }}>Endpoint</div>
                      <a
                        href={deployment.endpoint_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: 'var(--accent-cyan)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.35rem',
                          wordBreak: 'break-all',
                        }}
                      >
                        Visit <ExternalLink size={14} />
                      </a>
                    </div>
                  )}
                  <div>
                    <div style={{ color: 'var(--text-secondary)', marginBottom: '0.25rem', fontSize: '0.85rem' }}>Replicas</div>
                    <div>{deployment.replicas ?? 1}</div>
                  </div>
                </div>

                {/* Actions */}
                {isAdmin && (
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => handleToggleScale(deployment.deployment_id, deployment.replicas ?? 1)}
                      disabled={isLoading || !isActive}
                      style={{
                        padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)', border: 'none',
                        background: isStopped ? 'var(--accent-green)15' : 'var(--bg-base)', color: isStopped ? 'var(--accent-green)' : 'var(--text-secondary)',
                        cursor: isLoading ? 'not-allowed' : 'pointer', fontSize: '0.9rem', display: 'flex', alignItems: 'center',
                        gap: '0.35rem', opacity: isLoading ? 0.6 : 1, transition: 'opacity 0.2s',
                      }}
                    >
                      {isLoading ? (
                        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                      ) : isStopped ? (
                        <PlayCircle size={16} />
                      ) : (
                        <PauseCircle size={16} />
                      )}
                      {isStopped ? 'Start' : 'Stop'}
                    </button>

                    {updates[deployment.deployment_id] && (
                      <button
                        onClick={() => handleUpgrade(deployment.deployment_id)}
                        disabled={isLoading}
                        style={{
                          padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)', border: 'none',
                          background: 'var(--accent-cyan)', color: '#fff', cursor: isLoading ? 'not-allowed' : 'pointer',
                          fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.35rem',
                          opacity: isLoading ? 0.6 : 1, transition: 'opacity 0.2s',
                        }}
                      >
                        {isLoading ? (
                          <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                        ) : (
                          <ArrowUpCircle size={16} />
                        )}
                        Update now
                      </button>
                    )}

                    <button
                      onClick={() => handleRefresh(deployment.deployment_id)}
                      disabled={isLoading || !isActive}
                      style={{
                        padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)', border: 'none',
                        background: 'var(--bg-base)', color: 'var(--text-primary)', cursor: isLoading ? 'not-allowed' : 'pointer',
                        fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.35rem',
                        opacity: isLoading ? 0.6 : 1, transition: 'opacity 0.2s',
                      }}
                    >
                      {isLoading ? (
                        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                      ) : (
                        <RefreshCw size={16} />
                      )}
                      Restart
                    </button>

                    <button
                      onClick={() => handleDelete(deployment.deployment_id)}
                      disabled={isLoading}
                      style={{
                        padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)', border: 'none',
                        background: 'var(--bg-base)', color: 'var(--text-danger)', cursor: isLoading ? 'not-allowed' : 'pointer',
                        fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.35rem',
                        opacity: isLoading ? 0.6 : 1, transition: 'opacity 0.2s', marginLeft: 'auto',
                      }}
                    >
                      {isLoading ? (
                        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                      ) : (
                        <Trash2 size={16} />
                      )}
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {error && deployments.length > 0 && (
        <div style={{
          padding: '1rem', borderRadius: 'var(--radius)', background: 'var(--bg-danger-subtle)',
          color: 'var(--text-danger)', display: 'flex', gap: '0.5rem', alignItems: 'center',
        }}>
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
