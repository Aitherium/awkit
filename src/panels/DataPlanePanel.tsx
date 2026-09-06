'use client'

import { useState, useEffect, useCallback } from 'react'
import DataSourcesView from './DataSourcesView'
import KnowledgeView from './KnowledgeView'
import DatastoreView from './DatastoreView'
import StorageTierView from './StorageTierView'
import MeshNodesView from './MeshNodesView'

export interface DataPlanePanelProps {
  apiBase?: string
}

type Tab = 'sources' | 'knowledge' | 'datastore' | 'storage' | 'nodes'

const TABS: { key: Tab; label: string }[] = [
  { key: 'sources', label: 'Sources' },
  { key: 'knowledge', label: 'Knowledge' },
  { key: 'datastore', label: 'Datastore' },
  { key: 'storage', label: 'Storage' },
  { key: 'nodes', label: 'Nodes' },
]

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export default function DataPlanePanel({ apiBase = '/api/data-plane' }: DataPlanePanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('sources')
  const [summary, setSummary] = useState({
    sources: 0,
    collections: 0,
    totalDocs: 0,
    storageUsed: 0,
    meshNodes: 0,
  })

  const fetchSummary = useCallback(async () => {
    try {
      const [sourcesResp, knowledgeResp, tiersResp, meshResp] = await Promise.all([
        fetch(`${apiBase}/sources`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${apiBase}/knowledge/stats`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${apiBase}/storage/tiers`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${apiBase}/mesh/stats`).then(r => r.ok ? r.json() : null).catch(() => null),
      ])

      const sources = Array.isArray(sourcesResp) ? sourcesResp.length : (sourcesResp?.length || 0)
      const collections = knowledgeResp?.collections || 0
      const totalDocs = knowledgeResp?.total_documents || 0
      const tiers = tiersResp?.tiers || {}
      const storageUsed = Object.values(tiers).reduce(
        (sum: number, t: any) => sum + (t?.used_bytes || 0), 0
      )
      const meshNodes = meshResp?.total_nodes || 0

      setSummary({ sources, collections, totalDocs, storageUsed, meshNodes })
    } catch {}
  }, [apiBase])

  useEffect(() => { fetchSummary() }, [fetchSummary])

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', marginBottom: 8 }}>Data Plane</h2>
        {/* Summary stats */}
        <div style={{
          display: 'flex', gap: 20, fontSize: '0.75rem', color: 'var(--text-muted)',
          flexWrap: 'wrap',
        }}>
          <span><strong style={{ color: 'var(--text)' }}>{summary.sources}</strong> sources</span>
          <span><strong style={{ color: 'var(--text)' }}>{summary.collections}</strong> collections</span>
          <span><strong style={{ color: 'var(--text)' }}>{summary.totalDocs}</strong> documents</span>
          <span><strong style={{ color: 'var(--text)' }}>{formatBytes(summary.storageUsed)}</strong> storage</span>
          <span><strong style={{ color: 'var(--text)' }}>{summary.meshNodes}</strong> mesh nodes</span>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 2, marginBottom: '1.5rem',
        borderBottom: '1px solid var(--border, #333)', paddingBottom: 0,
      }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '8px 16px', fontSize: '0.85rem', cursor: 'pointer',
              border: 'none', borderBottom: activeTab === t.key ? '2px solid var(--accent, #7c3aed)' : '2px solid transparent',
              background: 'transparent',
              color: activeTab === t.key ? 'var(--text, #fff)' : 'var(--text-muted, #888)',
              fontWeight: activeTab === t.key ? 600 : 400,
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'sources' && <DataSourcesView apiBase={apiBase} />}
      {activeTab === 'knowledge' && <KnowledgeView apiBase={apiBase} />}
      {activeTab === 'datastore' && <DatastoreView apiBase={apiBase} />}
      {activeTab === 'storage' && <StorageTierView apiBase={apiBase} />}
      {activeTab === 'nodes' && <MeshNodesView apiBase={apiBase} />}
    </div>
  )
}
