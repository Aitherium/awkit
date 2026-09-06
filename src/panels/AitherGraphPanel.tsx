'use client'

/**
 * AitherGraphPanel — Unified Intelligence Graph
 *
 * Tabs: Search | Code | Knowledge | Events | Memory | Watchers | Analytics | Research
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  Search, Code2, BookOpen, Zap, Brain, Eye,
  BarChart3, FlaskConical, RefreshCw, Play, Square,
  Plus, Trash2, AlertTriangle, CheckCircle2, Clock,
  Network, FileText, Activity, Lightbulb,
} from 'lucide-react'

export interface AitherGraphPanelProps {
  apiBase?: string
}

type Tab = 'search' | 'code' | 'knowledge' | 'events' | 'memory' | 'watchers' | 'analytics' | 'research'

interface SearchResult {
  content: string
  domain: string
  source_graph: string
  relevance: number
  node_id: string
  node_type: string
}

interface DomainStatus {
  domain: string
  status: 'loaded' | 'failed' | 'available'
}

const TAB_ICONS: Record<Tab, React.ReactNode> = {
  search: <Search size={16} />,
  code: <Code2 size={16} />,
  knowledge: <BookOpen size={16} />,
  events: <Zap size={16} />,
  memory: <Brain size={16} />,
  watchers: <Eye size={16} />,
  analytics: <BarChart3 size={16} />,
  research: <FlaskConical size={16} />,
}

const TAB_LABELS: Record<Tab, string> = {
  search: 'Search',
  code: 'Code',
  knowledge: 'Knowledge',
  events: 'Events',
  memory: 'Memory',
  watchers: 'Watchers',
  analytics: 'Analytics',
  research: 'Research',
}

interface DeploymentInfo {
  mode: 'platform' | 'selfhosted'
  license_tier: string
  federation_active: boolean
  federation_url: string
  features: Record<string, { available: boolean; requires: string }>
}

export default function AitherGraphPanel({ apiBase = '/api/graph' }: AitherGraphPanelProps) {
  const [tab, setTab] = useState<Tab>('search')
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [domain, setDomain] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [domains, setDomains] = useState<DomainStatus[]>([])
  const [stats, setStats] = useState<any>(null)
  const [error, setError] = useState('')
  const [deployment, setDeployment] = useState<DeploymentInfo | null>(null)

  const fetchJson = useCallback(async (path: string, opts?: RequestInit) => {
    setLoading(true)
    setError('')
    try {
      const resp = await fetch(`${apiBase}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
      })
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
      return await resp.json()
    } catch (e: any) {
      setError(e.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  const loadDomains = useCallback(async () => {
    const data = await fetchJson('/domains')
    if (data?.domains) setDomains(data.domains)
  }, [fetchJson])

  const loadStats = useCallback(async () => {
    const data = await fetchJson('/stats')
    if (data) setStats(data)
  }, [fetchJson])

  const loadDeployment = useCallback(async () => {
    const data = await fetchJson('/deployment')
    if (data) setDeployment(data)
  }, [fetchJson])

  useEffect(() => {
    loadDomains()
    loadStats()
    loadDeployment()
  }, [loadDomains, loadStats, loadDeployment])

  const featureAvailable = (feature: string) => {
    if (!deployment) return true // loading, assume available
    return deployment.features[feature]?.available !== false
  }

  const handleSearch = async () => {
    if (!query.trim()) return
    const params = new URLSearchParams({ q: query, limit: '20' })
    if (domain) params.set('domain', domain)
    const data = await fetchJson(`/search?${params}`)
    if (data?.results) setResults(data.results)
  }

  const renderTabNav = () => (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #333', paddingBottom: 8, marginBottom: 16, flexWrap: 'wrap' }}>
      {(Object.keys(TAB_ICONS) as Tab[]).map(t => (
        <button
          key={t}
          onClick={() => setTab(t)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '6px 12px', border: 'none', borderRadius: 6,
            background: tab === t ? '#3b82f6' : 'transparent',
            color: tab === t ? '#fff' : '#999',
            cursor: 'pointer', fontSize: 13,
          }}
        >
          {TAB_ICONS[t]} {TAB_LABELS[t]}
        </button>
      ))}
    </div>
  )

  // ── Search Tab ──────────────────────────────────────────────────

  const renderSearch = () => (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Search across all graph domains..."
          style={{
            flex: 1, padding: '8px 12px', background: '#1a1a2e',
            border: '1px solid #333', borderRadius: 6, color: '#fff',
          }}
        />
        <select
          value={domain}
          onChange={e => setDomain(e.target.value)}
          style={{
            padding: '8px 12px', background: '#1a1a2e',
            border: '1px solid #333', borderRadius: 6, color: '#fff',
          }}
        >
          <option value="">All domains</option>
          {domains.filter(d => d.status !== 'failed').map(d => (
            <option key={d.domain} value={d.domain}>{d.domain}</option>
          ))}
        </select>
        <button onClick={handleSearch} style={{
          padding: '8px 16px', background: '#3b82f6', border: 'none',
          borderRadius: 6, color: '#fff', cursor: 'pointer',
        }}>
          <Search size={16} />
        </button>
      </div>
      {results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {results.map((r, i) => (
            <div key={i} style={{
              padding: 12, background: '#1a1a2e', borderRadius: 8,
              border: '1px solid #333',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 4,
                  background: '#3b82f620', color: '#3b82f6',
                }}>{r.domain}</span>
                <span style={{ fontSize: 11, color: '#666' }}>
                  {(r.relevance * 100).toFixed(0)}% | {r.source_graph}
                </span>
              </div>
              <pre style={{
                fontSize: 12, color: '#ccc', whiteSpace: 'pre-wrap',
                wordBreak: 'break-word', margin: 0, maxHeight: 120, overflow: 'hidden',
              }}>{r.content}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // ── Code Tab ────────────────────────────────────────────────────

  const [codeResults, setCodeResults] = useState<any[]>([])
  const [codeQuery, setCodeQuery] = useState('')

  const handleCodeSearch = async () => {
    if (!codeQuery.trim()) return
    const data = await fetchJson(`/code/search?q=${encodeURIComponent(codeQuery)}&limit=20`)
    if (data?.results) setCodeResults(data.results)
  }

  const renderCode = () => (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          value={codeQuery}
          onChange={e => setCodeQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCodeSearch()}
          placeholder="Search functions, classes, symbols..."
          style={{
            flex: 1, padding: '8px 12px', background: '#1a1a2e',
            border: '1px solid #333', borderRadius: 6, color: '#fff',
          }}
        />
        <button onClick={handleCodeSearch} style={{
          padding: '8px 16px', background: '#3b82f6', border: 'none',
          borderRadius: 6, color: '#fff', cursor: 'pointer',
        }}>
          <Search size={16} />
        </button>
      </div>
      {codeResults.length > 0 && (
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #333', color: '#888' }}>
              <th style={{ textAlign: 'left', padding: 8 }}>Name</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Type</th>
              <th style={{ textAlign: 'left', padding: 8 }}>File</th>
              <th style={{ textAlign: 'right', padding: 8 }}>Lines</th>
            </tr>
          </thead>
          <tbody>
            {codeResults.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #222' }}>
                <td style={{ padding: 8, color: '#3b82f6' }}>{r.name}</td>
                <td style={{ padding: 8, color: '#888' }}>{r.type}</td>
                <td style={{ padding: 8, color: '#666', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.file}</td>
                <td style={{ padding: 8, textAlign: 'right', color: '#666' }}>{r.line_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )

  // ── Knowledge Tab ───────────────────────────────────────────────

  const [bases, setBases] = useState<any[]>([])

  const loadBases = useCallback(async () => {
    const data = await fetchJson('/knowledge/bases')
    if (data?.bases) setBases(data.bases)
  }, [fetchJson])

  const renderKnowledge = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Knowledge Bases</h3>
        <button onClick={loadBases} style={{
          padding: '4px 12px', background: '#333', border: 'none',
          borderRadius: 4, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      {bases.length === 0 ? (
        <div style={{ color: '#666', textAlign: 'center', padding: 32 }}>
          No knowledge bases. Create one with /graph kb create.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bases.map((b, i) => (
            <div key={i} style={{
              padding: 12, background: '#1a1a2e', borderRadius: 8, border: '1px solid #333',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontWeight: 600 }}>{b.name || b.base_id}</div>
                <div style={{ fontSize: 12, color: '#666' }}>
                  {b.doc_count || 0} docs | {b.source_type || 'directory'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {b.watcher_active && <Eye size={14} style={{ color: '#10b981' }} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // ── Events Tab ──────────────────────────────────────────────────

  const renderEvents = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <button onClick={() => fetchJson('/events/critical-path').then(d => d && setResults([]))}
          style={{ padding: 16, background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, cursor: 'pointer', color: '#fff', textAlign: 'left' }}>
          <Activity size={20} style={{ marginBottom: 8, color: '#f59e0b' }} />
          <div style={{ fontWeight: 600 }}>Critical Path</div>
          <div style={{ fontSize: 12, color: '#666' }}>Longest dependency chain</div>
        </button>
        <button onClick={() => fetchJson('/events/bottlenecks').then(d => d && setResults([]))}
          style={{ padding: 16, background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, cursor: 'pointer', color: '#fff', textAlign: 'left' }}>
          <AlertTriangle size={20} style={{ marginBottom: 8, color: '#ef4444' }} />
          <div style={{ fontWeight: 600 }}>Bottlenecks</div>
          <div style={{ fontSize: 12, color: '#666' }}>High fan-in/fan-out nodes</div>
        </button>
      </div>
    </div>
  )

  // ── Memory Tab ──────────────────────────────────────────────────

  const [memQuery, setMemQuery] = useState('')
  const [memResults, setMemResults] = useState<any[]>([])

  const handleMemQuery = async () => {
    if (!memQuery.trim()) return
    const data = await fetchJson('/memory/query', {
      method: 'POST', body: JSON.stringify({ query: memQuery }),
    })
    if (data?.results) setMemResults(data.results)
  }

  const renderMemory = () => (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          value={memQuery}
          onChange={e => setMemQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleMemQuery()}
          placeholder="Query memories..."
          style={{
            flex: 1, padding: '8px 12px', background: '#1a1a2e',
            border: '1px solid #333', borderRadius: 6, color: '#fff',
          }}
        />
        <button onClick={handleMemQuery} style={{
          padding: '8px 16px', background: '#3b82f6', border: 'none',
          borderRadius: 6, color: '#fff', cursor: 'pointer',
        }}>
          <Search size={16} />
        </button>
      </div>
      {memResults.map((r, i) => (
        <div key={i} style={{
          padding: 12, marginBottom: 8, background: '#1a1a2e',
          borderRadius: 8, border: '1px solid #333',
        }}>
          <pre style={{ fontSize: 12, color: '#ccc', whiteSpace: 'pre-wrap', margin: 0 }}>
            {r.content || JSON.stringify(r)}
          </pre>
        </div>
      ))}
    </div>
  )

  // ── Watchers Tab ────────────────────────────────────────────────

  const [watchers, setWatchers] = useState<any>(null)

  const loadWatchers = useCallback(async () => {
    const data = await fetchJson('/watchers/status')
    if (data) setWatchers(data.watchers || data)
  }, [fetchJson])

  const renderWatchers = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Active Watchers</h3>
        <button onClick={loadWatchers} style={{
          padding: '4px 12px', background: '#333', border: 'none',
          borderRadius: 4, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <pre style={{ fontSize: 12, color: '#ccc' }}>
        {watchers ? JSON.stringify(watchers, null, 2) : 'No active watchers'}
      </pre>
    </div>
  )

  // ── Analytics Tab ───────────────────────────────────────────────

  const renderAnalytics = () => (
    <div>
      {stats ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div style={{ padding: 16, background: '#1a1a2e', borderRadius: 8, border: '1px solid #333' }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Loaded Backends</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>
              {stats.loaded_backends?.length || 0}
            </div>
          </div>
          <div style={{ padding: 16, background: '#1a1a2e', borderRadius: 8, border: '1px solid #333' }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Available Domains</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>
              {stats.available_domains?.length || 0}
            </div>
          </div>
          <div style={{ padding: 16, background: '#1a1a2e', borderRadius: 8, border: '1px solid #333' }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Code Chunks</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>
              {stats.code?.chunks || 0}
            </div>
          </div>
          <div style={{ padding: 16, background: '#1a1a2e', borderRadius: 8, border: '1px solid #333' }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Failed Backends</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: stats.failed_backends?.length ? '#ef4444' : '#10b981' }}>
              {stats.failed_backends?.length || 0}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ color: '#666', textAlign: 'center', padding: 32 }}>
          Loading statistics...
        </div>
      )}
      {domains.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 14, color: '#888', marginBottom: 12 }}>Domain Health</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {domains.map(d => (
              <div key={d.domain} style={{
                padding: '4px 12px', borderRadius: 16, fontSize: 12,
                background: d.status === 'loaded' ? '#10b98120' : d.status === 'failed' ? '#ef444420' : '#33333340',
                color: d.status === 'loaded' ? '#10b981' : d.status === 'failed' ? '#ef4444' : '#666',
                border: `1px solid ${d.status === 'loaded' ? '#10b98140' : d.status === 'failed' ? '#ef444440' : '#333'}`,
              }}>
                {d.domain}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  // ── Research Tab ────────────────────────────────────────────────

  const [researchQuery, setResearchQuery] = useState('')
  const [researchResult, setResearchResult] = useState<any>(null)

  const handleResearch = async () => {
    if (!researchQuery.trim()) return
    const data = await fetchJson('/research', {
      method: 'POST',
      body: JSON.stringify({ query: researchQuery, effort: 'library_session' }),
    })
    if (data) setResearchResult(data)
  }

  const renderResearch = () => (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          value={researchQuery}
          onChange={e => setResearchQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleResearch()}
          placeholder="Research a topic..."
          style={{
            flex: 1, padding: '8px 12px', background: '#1a1a2e',
            border: '1px solid #333', borderRadius: 6, color: '#fff',
          }}
        />
        <button onClick={handleResearch} style={{
          padding: '8px 16px', background: '#8b5cf6', border: 'none',
          borderRadius: 6, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <Lightbulb size={16} /> Research
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <button onClick={() => fetchJson('/research/status').then(d => d && setResearchResult(d))}
          style={{ padding: 12, background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, cursor: 'pointer', color: '#fff', textAlign: 'left' }}>
          <Clock size={16} style={{ marginBottom: 4 }} />
          <div style={{ fontSize: 13 }}>Pipeline Status</div>
        </button>
        <button onClick={() => fetchJson('/research/discoveries?limit=10').then(d => d && setResearchResult(d))}
          style={{ padding: 12, background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, cursor: 'pointer', color: '#fff', textAlign: 'left' }}>
          <Lightbulb size={16} style={{ marginBottom: 4 }} />
          <div style={{ fontSize: 13 }}>Recent Discoveries</div>
        </button>
      </div>
      {researchResult && (
        <pre style={{
          padding: 12, background: '#1a1a2e', borderRadius: 8,
          border: '1px solid #333', fontSize: 12, color: '#ccc',
          whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto',
        }}>
          {JSON.stringify(researchResult, null, 2)}
        </pre>
      )}
    </div>
  )

  // ── Main Render ─────────────────────────────────────────────────

  const renderTab = () => {
    switch (tab) {
      case 'search': return renderSearch()
      case 'code': return renderCode()
      case 'knowledge': return renderKnowledge()
      case 'events': return renderEvents()
      case 'memory': return renderMemory()
      case 'watchers': return renderWatchers()
      case 'analytics': return renderAnalytics()
      case 'research': return featureAvailable('research') ? renderResearch() : (
        <div style={{ textAlign: 'center', padding: 48, color: '#666' }}>
          <FlaskConical size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
          <div style={{ fontSize: 16, marginBottom: 8 }}>Research requires Pro tier</div>
          <div style={{ fontSize: 13 }}>Upgrade your AitherGraph license to unlock autonomous research, knowledge improvement, and curation.</div>
        </div>
      )
    }
  }

  return (
    <div style={{ padding: 16, color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>AitherGraph</h2>
          {deployment && (
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 4,
              background: deployment.mode === 'selfhosted' ? '#8b5cf620' : '#3b82f620',
              color: deployment.mode === 'selfhosted' ? '#8b5cf6' : '#3b82f6',
              border: `1px solid ${deployment.mode === 'selfhosted' ? '#8b5cf640' : '#3b82f640'}`,
            }}>
              {deployment.mode === 'selfhosted' ? 'Self-Hosted' : 'Platform'} | {deployment.license_tier}
              {deployment.federation_active && ' | Federated'}
            </span>
          )}
        </div>
        {loading && <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite', color: '#3b82f6' }} />}
      </div>
      {error && (
        <div style={{
          padding: 8, marginBottom: 12, background: '#ef444420',
          border: '1px solid #ef444440', borderRadius: 6, fontSize: 12, color: '#ef4444',
        }}>
          {error}
        </div>
      )}
      {renderTabNav()}
      {renderTab()}
    </div>
  )
}
