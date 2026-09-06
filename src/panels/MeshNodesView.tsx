'use client'

import { useState, useEffect, useCallback } from 'react'

export interface MeshNodesViewProps {
  apiBase?: string
}

interface MeshNode {
  node_id: string
  hostname: string
  role: string
  contributed_gb: number
  free_gb: number
  disk_type: string
  supported_tiers: string[]
  last_heartbeat?: string
  status: string
}

interface MeshStats {
  total_nodes: number
  total_storage_gb: number
  free_storage_gb: number
}

function formatRelativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  } catch { return iso }
}

const STATUS_COLORS: Record<string, string> = {
  active: '#00c853',
  online: '#00c853',
  stale: '#ffc107',
  offline: '#ff5252',
}

export default function MeshNodesView({ apiBase = '/api/data-plane' }: MeshNodesViewProps) {
  const [nodes, setNodes] = useState<MeshNode[]>([])
  const [stats, setStats] = useState<MeshStats | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const [nodesResp, statsResp] = await Promise.all([
        fetch(`${apiBase}/mesh/nodes`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/mesh/stats`).then(r => r.ok ? r.json() : null),
      ])
      if (nodesResp?.peers) setNodes(nodesResp.peers)
      else if (Array.isArray(nodesResp)) setNodes(nodesResp)
      if (statsResp) setStats(statsResp)
    } catch (e) {
      console.error('Fetch mesh data error:', e)
    }
    setLoading(false)
  }, [apiBase])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading mesh nodes...</div>
  }

  return (
    <div>
      {/* Stats bar */}
      {stats && (
        <div style={{
          display: 'flex', gap: 24, padding: '10px 16px', borderRadius: 8,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          marginBottom: '1.5rem', fontSize: '0.8rem',
        }}>
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>Nodes</div>
            <div style={{ fontWeight: 600 }}>{stats.total_nodes}</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>Total Storage</div>
            <div style={{ fontWeight: 600 }}>{stats.total_storage_gb.toFixed(1)} GB</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>Free Storage</div>
            <div style={{ fontWeight: 600 }}>{stats.free_storage_gb.toFixed(1)} GB</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>Usage</div>
            <div style={{ fontWeight: 600 }}>
              {stats.total_storage_gb > 0
                ? `${Math.round(((stats.total_storage_gb - stats.free_storage_gb) / stats.total_storage_gb) * 100)}%`
                : '0%'}
            </div>
          </div>
        </div>
      )}

      {/* Node cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10, marginBottom: '1.5rem' }}>
        {nodes.map(node => (
          <div key={node.node_id || node.hostname} style={{
            padding: '14px 16px', borderRadius: 8, background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{node.hostname}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: STATUS_COLORS[node.status] || '#888',
                }} />
                <span style={{
                  fontSize: '0.65rem', color: STATUS_COLORS[node.status] || 'var(--text-muted)',
                }}>
                  {node.status}
                </span>
              </div>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{
                padding: '1px 5px', borderRadius: 3, background: 'rgba(255,255,255,0.05)',
                fontSize: '0.6rem', fontWeight: 600,
              }}>
                {node.role}
              </span>
              <span style={{
                padding: '1px 5px', borderRadius: 3, background: 'rgba(255,255,255,0.05)',
                fontSize: '0.6rem',
              }}>
                {node.disk_type}
              </span>
              {node.supported_tiers?.map(t => (
                <span key={t} style={{
                  padding: '1px 5px', borderRadius: 3, fontSize: '0.6rem',
                  background: 'rgba(124,58,237,0.1)', color: 'var(--accent, #7c3aed)',
                }}>
                  {t}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: '0.75rem' }}>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.6rem' }}>Contributed</div>
                <div style={{ fontWeight: 500 }}>{node.contributed_gb.toFixed(1)} GB</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.6rem' }}>Free</div>
                <div style={{ fontWeight: 500 }}>{node.free_gb.toFixed(1)} GB</div>
              </div>
            </div>
            {/* Usage bar */}
            <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: 'var(--bg-deep)', overflow: 'hidden' }}>
              <div style={{
                width: node.contributed_gb > 0
                  ? `${Math.round(((node.contributed_gb - node.free_gb) / node.contributed_gb) * 100)}%`
                  : '0%',
                height: '100%', borderRadius: 2,
                background: 'var(--accent, #7c3aed)',
              }} />
            </div>
            {node.last_heartbeat && (
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 4 }}>
                Last heartbeat: {formatRelativeTime(node.last_heartbeat)}
              </div>
            )}
          </div>
        ))}
      </div>

      {nodes.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '2rem', borderRadius: 8,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: '0.9rem', marginBottom: 8, color: 'var(--text)' }}>
            No mesh nodes registered
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>
            Contribute storage by installing ADK on any machine and joining the mesh network.
          </div>
          <div style={{
            padding: '10px 14px', borderRadius: 6, background: 'var(--bg-deep)',
            fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--accent, #7c3aed)',
            textAlign: 'left', display: 'inline-block',
          }}>
            <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}># Install ADK and register as mesh peer</div>
            <div>pip install awdk</div>
            <div>aither mesh contribute --volume /data --tier warm</div>
          </div>
        </div>
      )}
    </div>
  )
}
