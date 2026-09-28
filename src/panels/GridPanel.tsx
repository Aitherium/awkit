'use client'

/**
 * GridPanel -- AitherGrid node topology.
 *
 * Two sources, each optional and independent (a failure in one does not blank
 * the other):
 *   - `${apiBase}/grid/status`  the ADK node's configured LAN grid nodes
 *                               (awdk/adk/grid_status.py; auth = the ADK server's
 *                               global middleware: loopback or bearer)
 *   - `nodesUrl`                the platform gateway's enrolled mesh nodes
 *                               (GET /nodes, the list `adk grid ls` prints)
 */

import { useCallback, useEffect, useState } from 'react'

export interface GridPanelProps {
  /** Base URL of the ADK node server that serves GET /grid/status. */
  apiBase?: string
  /** Optional URL of the gateway's GET /nodes (enrolled mesh nodes). */
  nodesUrl?: string
  /** Extra request headers (e.g. an Authorization bearer). */
  headers?: Record<string, string>
  /** Auto-refresh interval in ms; 0 disables. */
  refreshMs?: number
}

interface GridNode {
  role: string
  host: string
  port: number
  model?: string
  state: 'healthy' | 'no_api' | 'unreachable' | string
  models?: string[]
}

interface GridStatus {
  configured: boolean
  total: number
  healthy: number
  nodes: GridNode[]
}

interface MeshNode {
  node_id?: string
  name?: string
  status?: string
  hardware?: { gpu?: string; memory_gb?: number }
}

const STATE_COLORS: Record<string, string> = {
  healthy: '#00c853',
  online: '#00c853',
  no_api: '#ffc107',
  unreachable: '#ff5252',
  offline: '#ff5252',
}

const STATE_LABELS: Record<string, string> = {
  healthy: 'healthy',
  no_api: 'up, no /v1 API',
  unreachable: 'unreachable',
}

function Dot({ state }: { state: string }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
        background: STATE_COLORS[state] || 'var(--text-muted)', marginRight: 8,
      }}
    />
  )
}

export default function GridPanel({
  apiBase = '',
  nodesUrl,
  headers,
  refreshMs = 30000,
}: GridPanelProps) {
  const [grid, setGrid] = useState<GridStatus | null>(null)
  const [gridError, setGridError] = useState<string | null>(null)
  const [mesh, setMesh] = useState<MeshNode[] | null>(null)
  const [meshError, setMeshError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Keyed on the serialized headers: an inline object prop is a new identity
  // every render and would otherwise re-fire the effect in a loop.
  const headersKey = headers ? JSON.stringify(headers) : ''
  const load = useCallback(async () => {
    const init: RequestInit = headersKey ? { headers: JSON.parse(headersKey) } : {}
    const gridReq = fetch(`${apiBase}/grid/status`, init)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        setGrid(await r.json())
        setGridError(null)
      })
      .catch(e => setGridError(String(e?.message || e)))
    const meshReq = nodesUrl
      ? fetch(nodesUrl, init)
          .then(async r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            const body = await r.json()
            setMesh(Array.isArray(body) ? body : body?.nodes || [])
            setMeshError(null)
          })
          .catch(e => setMeshError(String(e?.message || e)))
      : Promise.resolve()
    await Promise.all([gridReq, meshReq])
    setLoading(false)
  }, [apiBase, nodesUrl, headersKey])

  useEffect(() => {
    load()
    if (!refreshMs) return undefined
    const t = setInterval(load, refreshMs)
    return () => clearInterval(t)
  }, [load, refreshMs])

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading grid nodes...</div>
  }

  const card = {
    padding: '10px 14px', borderRadius: 8, background: 'var(--bg-elevated)',
    border: '1px solid var(--border)', marginBottom: 8, fontSize: '0.85rem',
  } as const

  return (
    <div>
      <h3 style={{ margin: '0 0 0.75rem' }}>Grid nodes</h3>
      {gridError && <div role="alert" style={{ ...card, color: '#ff5252' }}>Grid status unavailable: {gridError}</div>}
      {grid && !grid.configured && (
        <div style={card}>No grid nodes configured. Run <code>adk deploy grid</code> to add one.</div>
      )}
      {grid && grid.configured && (
        <>
          <div style={{ ...card, display: 'flex', gap: 24 }}>
            <span>{grid.total} node(s)</span>
            <span>{grid.healthy} healthy</span>
          </div>
          {grid.nodes.map(n => (
            <div key={`${n.role}-${n.host}-${n.port}`} style={card}>
              <Dot state={n.state} />
              <strong>{n.host}:{n.port}</strong>
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{n.role}</span>
              <span style={{ marginLeft: 8 }}>{STATE_LABELS[n.state] || n.state}</span>
              {n.models && n.models.length > 0 && (
                <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>models: {n.models.slice(0, 3).join(', ')}</div>
              )}
            </div>
          ))}
        </>
      )}

      {nodesUrl && (
        <>
          <h3 style={{ margin: '1.25rem 0 0.75rem' }}>Enrolled mesh nodes</h3>
          {meshError && <div role="alert" style={{ ...card, color: '#ff5252' }}>Mesh nodes unavailable: {meshError}</div>}
          {mesh && mesh.length === 0 && <div style={card}>No mesh nodes enrolled.</div>}
          {mesh && mesh.map((m, i) => {
            const state = m.status === 'online' ? 'online' : 'offline'
            return (
              <div key={m.node_id || m.name || i} style={card}>
                <Dot state={state} />
                <strong>{m.name || m.node_id || '?'}</strong>
                <span style={{ marginLeft: 8 }}>{state}</span>
                {m.hardware?.gpu && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{m.hardware.gpu}</span>}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
