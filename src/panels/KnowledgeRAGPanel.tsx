'use client'

/**
 * KnowledgeRAGPanel — Knowledge Base Management + Audit + Graph Visualization
 *
 * Tabs: Bases | Documents | Audit | Graph | Topics | Watcher
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  BookOpen, FileText, BarChart3, Network, Tag, Eye,
  Plus, Trash2, Search, RefreshCw, Play, Square,
  AlertTriangle, CheckCircle2, XCircle, Clock,
} from 'lucide-react'

// Lazy import KnowledgeGraphCanvas
let KnowledgeGraphCanvas: React.ComponentType<any> | null = null
try {
  KnowledgeGraphCanvas = require('../components/KnowledgeGraphCanvas').default
} catch {
  // Component may not be available in all builds
}

export interface KnowledgeRAGPanelProps {
  apiBase?: string
}

type Tab = 'bases' | 'documents' | 'audit' | 'graph' | 'topics' | 'watcher'

interface KnowledgeBase {
  base_id: string
  name: string
  description?: string
  source_path?: string
  source_type?: string
  doc_count: number
  watcher_active?: boolean
  last_audit?: number | null
}

interface AuditReport {
  total_documents: number
  avg_freshness: number
  grade_distribution: Record<string, number>
  dead_doc_count: number
  orphan_count: number
  duplicate_count: number
  broken_link_count: number
  documents: Array<{
    doc_id: string
    file_name: string
    freshness_score: number
    grade: string
    is_orphan: boolean
    broken_links: string[]
    inbound_refs: number
    outbound_refs: number
  }>
}

interface GraphData {
  nodes: Array<{ id: string; name: string; freshness: number; grade: string; is_orphan: boolean }>
  edges: Array<{ source: string; target: string; type: string }>
}

const GRADE_COLORS: Record<string, string> = {
  A: '#10b981', B: '#06b6d4', C: '#f59e0b', D: '#f97316', F: '#ef4444',
}

export default function KnowledgeRAGPanel({ apiBase = '/api/knowledge-rag' }: KnowledgeRAGPanelProps) {
  const [tab, setTab] = useState<Tab>('bases')
  const [bases, setBases] = useState<KnowledgeBase[]>([])
  const [selectedBase, setSelectedBase] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [audit, setAudit] = useState<AuditReport | null>(null)
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [topics, setTopics] = useState<any[]>([])
  const [watcherStatus, setWatcherStatus] = useState<any>(null)
  const [documents, setDocuments] = useState<any[]>([])
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSource, setNewSource] = useState('')
  const [inspectedNode, setInspectedNode] = useState<any>(null)

  const api = useCallback(async (path: string, method = 'GET', body?: any) => {
    const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } }
    if (body) opts.body = JSON.stringify(body)
    const res = await fetch(`${apiBase}${path}`, opts)
    return res.ok ? res.json() : null
  }, [apiBase])

  // Load bases
  const loadBases = useCallback(async () => {
    setLoading(true)
    const data = await api('/bases')
    if (data?.bases) setBases(data.bases)
    setLoading(false)
  }, [api])

  useEffect(() => { loadBases() }, [loadBases])

  // Load tab-specific data when base or tab changes
  useEffect(() => {
    if (!selectedBase) return
    const load = async () => {
      setLoading(true)
      if (tab === 'documents') {
        const data = await api(`/bases/${selectedBase}/documents`)
        setDocuments(data?.documents || [])
      } else if (tab === 'audit') {
        const data = await api(`/bases/${selectedBase}/audit`)
        if (data && !data.status) setAudit(data)
        else setAudit(null)
      } else if (tab === 'graph') {
        const data = await api(`/bases/${selectedBase}/graph`)
        setGraphData(data || null)
      } else if (tab === 'topics') {
        const data = await api(`/bases/${selectedBase}/topics`)
        setTopics(data?.clusters || [])
      } else if (tab === 'watcher') {
        const data = await api(`/bases/${selectedBase}/watcher/status`)
        setWatcherStatus(data?.status || null)
      }
      setLoading(false)
    }
    load()
  }, [selectedBase, tab, api])

  const createBase = async () => {
    if (!newName.trim()) return
    setCreating(true)
    await api('/bases', 'POST', { name: newName, source_path: newSource, source_type: 'local' })
    setNewName('')
    setNewSource('')
    setCreating(false)
    loadBases()
  }

  const deleteBase = async (id: string) => {
    await api(`/bases/${id}`, 'DELETE')
    if (selectedBase === id) setSelectedBase('')
    loadBases()
  }

  const runAudit = async () => {
    if (!selectedBase) return
    setLoading(true)
    const data = await api(`/bases/${selectedBase}/audit/run`, 'POST')
    if (data) setAudit(data)
    setLoading(false)
  }

  const toggleWatcher = async (start: boolean) => {
    if (!selectedBase) return
    const endpoint = start ? 'start' : 'stop'
    await api(`/bases/${selectedBase}/watcher/${endpoint}`, 'POST')
    const data = await api(`/bases/${selectedBase}/watcher/status`)
    setWatcherStatus(data?.status || null)
  }

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'bases', label: 'Bases', icon: BookOpen },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'audit', label: 'Audit', icon: BarChart3 },
    { id: 'graph', label: 'Graph', icon: Network },
    { id: 'topics', label: 'Topics', icon: Tag },
    { id: 'watcher', label: 'Watcher', icon: Eye },
  ]

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', color: '#e2e8f0' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #1e293b', marginBottom: 16, padding: '0 4px' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 14px', fontSize: 13, cursor: 'pointer', border: 'none',
              background: tab === t.id ? '#1e293b' : 'transparent',
              color: tab === t.id ? '#e2e8f0' : '#64748b',
              borderBottom: tab === t.id ? '2px solid #3b82f6' : '2px solid transparent',
              borderRadius: '6px 6px 0 0', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <t.icon size={14} />{t.label}
          </button>
        ))}
      </div>

      {/* ── Bases tab ── */}
      {tab === 'bases' && (
        <div>
          {/* Create form */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <input
              value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Knowledge base name"
              style={{ flex: 1, minWidth: 160, padding: '6px 10px', background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 13 }}
            />
            <input
              value={newSource} onChange={e => setNewSource(e.target.value)}
              placeholder="Source path (optional)"
              style={{ flex: 1, minWidth: 160, padding: '6px 10px', background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 13 }}
            />
            <button onClick={createBase} disabled={creating || !newName.trim()}
              style={{ padding: '6px 14px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Plus size={14} />Create
            </button>
          </div>

          {/* Base list */}
          {bases.length === 0 && !loading && (
            <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>
              No knowledge bases yet. Create one above.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {bases.map(kb => (
              <div key={kb.base_id}
                onClick={() => { setSelectedBase(kb.base_id); setTab('documents') }}
                style={{
                  padding: 14, background: selectedBase === kb.base_id ? '#1e293b' : '#0f172a',
                  border: `1px solid ${selectedBase === kb.base_id ? '#3b82f6' : '#1e293b'}`,
                  borderRadius: 8, cursor: 'pointer',
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{kb.name}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{kb.source_path || 'No source'}</div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); deleteBase(kb.base_id) }}
                    style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 11, color: '#94a3b8' }}>
                  <span><FileText size={12} style={{ display: 'inline', verticalAlign: -2 }} /> {kb.doc_count} docs</span>
                  <span>{kb.watcher_active ? '🟢 watching' : '⭘ manual'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Documents tab ── */}
      {tab === 'documents' && (
        <div>
          {!selectedBase ? (
            <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Select a knowledge base first</div>
          ) : (
            <div>
              <div style={{ marginBottom: 12, fontSize: 12, color: '#94a3b8' }}>{documents.length} documents</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1e293b', color: '#64748b' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px' }}>Name</th>
                    <th style={{ textAlign: 'center', padding: '6px 8px' }}>Grade</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px' }}>Freshness</th>
                    <th style={{ textAlign: 'center', padding: '6px 8px' }}>Refs</th>
                    <th style={{ textAlign: 'center', padding: '6px 8px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((d: any, i: number) => (
                    <tr key={d.doc_id || i} style={{ borderBottom: '1px solid #0f172a' }}>
                      <td style={{ padding: '6px 8px' }}>{d.file_name || d.doc_id}</td>
                      <td style={{ textAlign: 'center', padding: '6px 8px' }}>
                        {d.grade && <span style={{ color: GRADE_COLORS[d.grade] || '#94a3b8', fontWeight: 600 }}>{d.grade}</span>}
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 8px' }}>
                        {d.freshness_score != null ? `${(d.freshness_score * 100).toFixed(0)}%` : '—'}
                      </td>
                      <td style={{ textAlign: 'center', padding: '6px 8px', color: '#94a3b8' }}>{d.inbound_refs ?? '—'}</td>
                      <td style={{ textAlign: 'center', padding: '6px 8px' }}>
                        {d.is_orphan ? <span style={{ color: '#ef4444' }}>orphan</span> : <span style={{ color: '#10b981' }}>linked</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Audit tab ── */}
      {tab === 'audit' && (
        <div>
          {!selectedBase ? (
            <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Select a knowledge base first</div>
          ) : (
            <div>
              <button onClick={runAudit} disabled={loading}
                style={{ marginBottom: 16, padding: '6px 14px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <RefreshCw size={14} />{loading ? 'Running...' : 'Run Audit'}
              </button>

              {audit && (
                <div>
                  {/* Stats row */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
                    <div style={{ background: '#1e293b', padding: 12, borderRadius: 8, textAlign: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 700 }}>{audit.total_documents}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>Documents</div>
                    </div>
                    <div style={{ background: '#1e293b', padding: 12, borderRadius: 8, textAlign: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 700 }}>{(audit.avg_freshness * 100).toFixed(0)}%</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>Avg Freshness</div>
                    </div>
                    <div style={{ background: '#1e293b', padding: 12, borderRadius: 8, textAlign: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: '#ef4444' }}>{audit.dead_doc_count}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>Dead Docs</div>
                    </div>
                    <div style={{ background: '#1e293b', padding: 12, borderRadius: 8, textAlign: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: '#f59e0b' }}>{audit.orphan_count}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>Orphans</div>
                    </div>
                    <div style={{ background: '#1e293b', padding: 12, borderRadius: 8, textAlign: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: '#f97316' }}>{audit.duplicate_count}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>Duplicates</div>
                    </div>
                    <div style={{ background: '#1e293b', padding: 12, borderRadius: 8, textAlign: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: '#ef4444' }}>{audit.broken_link_count}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>Broken Links</div>
                    </div>
                  </div>

                  {/* Grade distribution */}
                  <div style={{ marginBottom: 20 }}>
                    <h4 style={{ fontSize: 13, marginBottom: 8, color: '#94a3b8' }}>Grade Distribution</h4>
                    <div style={{ display: 'flex', gap: 6, height: 28 }}>
                      {['A', 'B', 'C', 'D', 'F'].map(g => {
                        const count = audit.grade_distribution[g] || 0
                        const pct = audit.total_documents > 0 ? (count / audit.total_documents) * 100 : 0
                        return (
                          <div key={g} style={{ flex: Math.max(pct, 3), background: GRADE_COLORS[g], borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: '#0f172a', minWidth: 24 }}>
                            {count > 0 && `${g}: ${count}`}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              {!audit && !loading && (
                <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>
                  No audit available. Click "Run Audit" to analyze your knowledge base.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Graph tab ── */}
      {tab === 'graph' && (
        <div>
          {!selectedBase ? (
            <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Select a knowledge base first</div>
          ) : graphData && KnowledgeGraphCanvas ? (
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, minHeight: 500 }}>
                <KnowledgeGraphCanvas
                  nodes={graphData.nodes}
                  edges={graphData.edges}
                  heatmapMode="freshness"
                  onNodeClick={(node: any) => setInspectedNode(node)}
                />
              </div>
              {inspectedNode && (
                <div style={{ width: 240, background: '#1e293b', borderRadius: 8, padding: 14, fontSize: 12 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{inspectedNode.name}</h4>
                  <div style={{ marginBottom: 6 }}>
                    <span style={{ color: '#64748b' }}>Freshness: </span>
                    <span style={{ color: GRADE_COLORS[inspectedNode.grade] || '#94a3b8', fontWeight: 600 }}>
                      {(inspectedNode.freshness * 100).toFixed(0)}% ({inspectedNode.grade})
                    </span>
                  </div>
                  {inspectedNode.is_orphan && <div style={{ color: '#ef4444', marginBottom: 6 }}>No inbound references (orphan)</div>}
                  <button onClick={() => setInspectedNode(null)}
                    style={{ marginTop: 8, padding: '4px 10px', background: '#334155', border: 'none', borderRadius: 4, color: '#94a3b8', cursor: 'pointer', fontSize: 11 }}>
                    Close
                  </button>
                </div>
              )}
            </div>
          ) : graphData ? (
            <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>
              {graphData.nodes.length} nodes, {graphData.edges.length} edges (canvas not available)
            </div>
          ) : (
            <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>
              {loading ? 'Loading...' : 'Run an audit first to generate the graph.'}
            </div>
          )}
        </div>
      )}

      {/* ── Topics tab ── */}
      {tab === 'topics' && (
        <div>
          {!selectedBase ? (
            <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Select a knowledge base first</div>
          ) : topics.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
              {topics.map((c: any) => (
                <div key={c.cluster_id} style={{ background: '#1e293b', padding: 14, borderRadius: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Cluster {c.cluster_id}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>{c.doc_count} documents</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Avg freshness: {(c.avg_freshness * 100).toFixed(0)}%</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>
              {loading ? 'Loading...' : 'Run an audit first to compute topic clusters.'}
            </div>
          )}
        </div>
      )}

      {/* ── Watcher tab ── */}
      {tab === 'watcher' && (
        <div>
          {!selectedBase ? (
            <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Select a knowledge base first</div>
          ) : (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <button onClick={() => toggleWatcher(true)}
                  style={{ padding: '6px 14px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Play size={14} />Start Watcher
                </button>
                <button onClick={() => toggleWatcher(false)}
                  style={{ padding: '6px 14px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Square size={14} />Stop Watcher
                </button>
              </div>
              {watcherStatus && (
                <div style={{ background: '#1e293b', padding: 14, borderRadius: 8, fontSize: 13 }}>
                  <div><span style={{ color: '#64748b' }}>State: </span>{watcherStatus.state || 'stopped'}</div>
                  <div><span style={{ color: '#64748b' }}>Type: </span>{watcherStatus.source_type || '—'}</div>
                  <div><span style={{ color: '#64748b' }}>Interval: </span>{watcherStatus.poll_interval || 0}s</div>
                  <div><span style={{ color: '#64748b' }}>Files tracked: </span>{watcherStatus.files_tracked || 0}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
