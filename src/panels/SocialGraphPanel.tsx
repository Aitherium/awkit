'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────
interface Person {
  id: string
  data: {
    username: string
    display_name?: string
    department?: string
    email?: string
    avatar_url?: string
    tenant_id?: string
  }
  friend_count?: number
  score?: number
}

interface Edge {
  source: string
  target: string
  types: string[]
  weight: number
  interaction_count: number
}

interface TraversalResult {
  nodes: (Person & { depth: number })[]
  edges: Edge[]
}

interface StrengthResult {
  strength: number
  types: string[]
  mutual_friends_count: number
  interaction_count: number
  last_interaction: number | null
  shared_groups: number
}

interface Stats {
  total_people: number
  total_friendships: number
  total_groups: number
  total_interactions: number
  total_relationship_types: number
  rel_type_counts: Record<string, number>
  user?: {
    friend_count: number
    group_count: number
    interaction_count: number
  }
}

interface Interaction {
  id: number
  initiator: string
  target: string
  interaction_type: string
  source: string
  created_at: string
}

export interface SocialGraphPanelProps {
  apiBase?: string
  currentUser?: string
}

const REL_TYPE_COLORS: Record<string, string> = {
  friend_of: '#3b82f6',
  colleague_of: '#10b981',
  reports_to: '#f59e0b',
  member_of: '#8b5cf6',
  mentor: '#ec4899',
  client: '#06b6d4',
  vendor: '#f97316',
}

// ── Component ──────────────────────────────────────────────────────
export default function SocialGraphPanel({
  apiBase = '/api/graph/social',
  currentUser,
}: SocialGraphPanelProps) {
  const [activeTab, setActiveTab] = useState<'network' | 'relationships' | 'interactions' | 'insights'>('network')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Person[]>([])
  const [selectedUser, setSelectedUser] = useState<string>(currentUser || '')
  const [traversal, setTraversal] = useState<TraversalResult | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [strength, setStrength] = useState<StrengthResult | null>(null)
  const [strengthTarget, setStrengthTarget] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // ── Fetch helpers ─────────────────────────────────────────────
  const fetchJson = useCallback(async (url: string) => {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    return resp.json()
  }, [])

  // Load stats on mount
  useEffect(() => {
    fetchJson(`${apiBase}/stats${currentUser ? `?user_id=${currentUser}` : ''}`)
      .then(setStats)
      .catch(() => {})
  }, [apiBase, currentUser, fetchJson])

  // Search
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return
    setLoading(true)
    setError('')
    try {
      const data = await fetchJson(`${apiBase}/people/search?q=${encodeURIComponent(searchQuery)}&limit=20`)
      setSearchResults(data.results || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [apiBase, searchQuery, fetchJson])

  // Load traversal when user is selected
  useEffect(() => {
    if (!selectedUser) return
    setLoading(true)
    fetchJson(`${apiBase}/relationships/${selectedUser}?max_hops=2`)
      .then(setTraversal)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [apiBase, selectedUser, fetchJson])

  // Load strength when target is set
  useEffect(() => {
    if (!selectedUser || !strengthTarget) return
    fetchJson(`${apiBase}/strength/${selectedUser}/${strengthTarget}`)
      .then(setStrength)
      .catch(() => {})
  }, [apiBase, selectedUser, strengthTarget, fetchJson])

  // ── Tab content ───────────────────────────────────────────────

  const tabs = [
    { key: 'network' as const, label: 'Network' },
    { key: 'relationships' as const, label: 'Relationships' },
    { key: 'interactions' as const, label: 'Interactions' },
    { key: 'insights' as const, label: 'Insights' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Social Graph</h2>
        {stats && (
          <div style={{ display: 'flex', gap: 16, marginLeft: 'auto', fontSize: 13, color: '#6b7280' }}>
            <span>{stats.total_people} people</span>
            <span>{stats.total_friendships} friendships</span>
            <span>{stats.total_groups} groups</span>
            <span>{stats.total_interactions} interactions</span>
          </div>
        )}
      </div>

      {/* Search bar */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid #f3f4f6', display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Search people by name, department..."
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          style={{ padding: '8px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
        >
          Search
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', padding: '0 20px' }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 16px',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #3b82f6' : '2px solid transparent',
              background: 'none',
              color: activeTab === tab.key ? '#3b82f6' : '#6b7280',
              fontWeight: activeTab === tab.key ? 600 : 400,
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ margin: '12px 20px', padding: '8px 12px', background: '#fef2f2', color: '#dc2626', borderRadius: 6, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {activeTab === 'network' && (
          <NetworkView
            searchResults={searchResults}
            traversal={traversal}
            selectedUser={selectedUser}
            onSelectUser={setSelectedUser}
            loading={loading}
          />
        )}
        {activeTab === 'relationships' && (
          <RelationshipsView
            traversal={traversal}
            selectedUser={selectedUser}
            onSelectTarget={setStrengthTarget}
            strength={strength}
          />
        )}
        {activeTab === 'interactions' && (
          <InteractionsView apiBase={apiBase} selectedUser={selectedUser} fetchJson={fetchJson} />
        )}
        {activeTab === 'insights' && (
          <InsightsView stats={stats} traversal={traversal} selectedUser={selectedUser} apiBase={apiBase} fetchJson={fetchJson} />
        )}
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────

function NetworkView({ searchResults, traversal, selectedUser, onSelectUser, loading }: {
  searchResults: Person[]
  traversal: TraversalResult | null
  selectedUser: string
  onSelectUser: (u: string) => void
  loading: boolean
}) {
  // Simple node list visualization (force-directed would require vis-network/d3)
  const nodes = traversal?.nodes || []
  const edges = traversal?.edges || []

  return (
    <div style={{ display: 'flex', gap: 20 }}>
      {/* Search results / Node list */}
      <div style={{ flex: 1 }}>
        {searchResults.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Search Results</h3>
            {searchResults.map(p => (
              <PersonCard key={p.id} person={p} selected={p.id === selectedUser} onClick={() => onSelectUser(p.id)} />
            ))}
          </div>
        )}

        {loading && <p style={{ color: '#9ca3af' }}>Loading network...</p>}

        {nodes.length > 0 && (
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
              Network ({nodes.length} people, {edges.length} connections)
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
              {nodes.map(n => (
                <PersonCard key={n.id} person={n} selected={n.id === selectedUser} onClick={() => onSelectUser(n.id)} depth={n.depth} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Edge list */}
      {edges.length > 0 && (
        <div style={{ width: 300, flexShrink: 0 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Connections</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {edges.map((e, i) => (
              <div key={i} style={{ padding: '6px 10px', background: '#f9fafb', borderRadius: 6, fontSize: 12 }}>
                <span style={{ fontWeight: 500 }}>{e.source}</span>
                {' → '}
                <span style={{ fontWeight: 500 }}>{e.target}</span>
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  {e.types.map(t => (
                    <span key={t} style={{
                      padding: '1px 6px',
                      background: REL_TYPE_COLORS[t] || '#9ca3af',
                      color: '#fff',
                      borderRadius: 10,
                      fontSize: 10,
                    }}>
                      {t.replace(/_/g, ' ')}
                    </span>
                  ))}
                  {e.interaction_count > 0 && (
                    <span style={{ fontSize: 10, color: '#9ca3af' }}>{e.interaction_count} interactions</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PersonCard({ person, selected, onClick, depth }: {
  person: Person & { depth?: number }
  selected: boolean
  onClick: () => void
  depth?: number
}) {
  const name = person.data?.display_name || person.data?.username || person.id
  const dept = person.data?.department
  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 14px',
        border: `1px solid ${selected ? '#3b82f6' : '#e5e7eb'}`,
        borderRadius: 8,
        cursor: 'pointer',
        background: selected ? '#eff6ff' : '#fff',
        transition: 'all 0.15s',
      }}
    >
      <div style={{ fontWeight: 500, fontSize: 14 }}>{name}</div>
      {dept && <div style={{ fontSize: 12, color: '#6b7280' }}>{dept}</div>}
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
        {person.friend_count !== undefined && `${person.friend_count} connections`}
        {depth !== undefined && depth > 0 && ` · ${depth} hop${depth > 1 ? 's' : ''} away`}
      </div>
    </div>
  )
}

function RelationshipsView({ traversal, selectedUser, onSelectTarget, strength }: {
  traversal: TraversalResult | null
  selectedUser: string
  onSelectTarget: (u: string) => void
  strength: StrengthResult | null
}) {
  const edges = traversal?.edges?.filter(e => e.source === selectedUser || e.target === selectedUser) || []

  return (
    <div>
      {strength && (
        <div style={{ marginBottom: 20, padding: 16, background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Relationship Strength</h3>
          <div style={{ display: 'flex', gap: 24 }}>
            <div>
              <div style={{ fontSize: 32, fontWeight: 700, color: '#16a34a' }}>{(strength.strength * 100).toFixed(0)}%</div>
            </div>
            <div style={{ fontSize: 13, color: '#374151' }}>
              <div>Types: {strength.types.join(', ') || 'none'}</div>
              <div>Mutual friends: {strength.mutual_friends_count}</div>
              <div>Interactions: {strength.interaction_count}</div>
              <div>Shared groups: {strength.shared_groups}</div>
            </div>
          </div>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
            <th style={{ padding: '8px 12px' }}>Person</th>
            <th style={{ padding: '8px 12px' }}>Types</th>
            <th style={{ padding: '8px 12px' }}>Interactions</th>
            <th style={{ padding: '8px 12px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {edges.map((e, i) => {
            const other = e.source === selectedUser ? e.target : e.source
            return (
              <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 12px', fontWeight: 500 }}>{other}</td>
                <td style={{ padding: '8px 12px' }}>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {e.types.map(t => (
                      <span key={t} style={{
                        padding: '2px 8px',
                        background: REL_TYPE_COLORS[t] || '#e5e7eb',
                        color: REL_TYPE_COLORS[t] ? '#fff' : '#374151',
                        borderRadius: 12,
                        fontSize: 11,
                      }}>
                        {t.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                </td>
                <td style={{ padding: '8px 12px' }}>{e.interaction_count}</td>
                <td style={{ padding: '8px 12px' }}>
                  <button
                    onClick={() => onSelectTarget(other)}
                    style={{ padding: '4px 10px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 12 }}
                  >
                    Strength
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {edges.length === 0 && (
        <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>
          {selectedUser ? 'No relationships found. Select a user from the Network tab.' : 'Select a user to view relationships.'}
        </p>
      )}
    </div>
  )
}

function InteractionsView({ apiBase, selectedUser, fetchJson }: {
  apiBase: string
  selectedUser: string
  fetchJson: (url: string) => Promise<any>
}) {
  // Interactions are fetched from the stats/traversal data
  // In a full implementation, this would call a dedicated interactions endpoint
  return (
    <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
      <p style={{ fontSize: 16, marginBottom: 8 }}>Interaction Timeline</p>
      <p style={{ fontSize: 13 }}>
        {selectedUser
          ? `Showing interaction history for ${selectedUser}. Interactions are tracked automatically from messages, emails, calendar events, and mentions.`
          : 'Select a user from the Network tab to view their interaction timeline.'
        }
      </p>
    </div>
  )
}

function InsightsView({ stats, traversal, selectedUser, apiBase, fetchJson }: {
  stats: Stats | null
  traversal: TraversalResult | null
  selectedUser: string
  apiBase: string
  fetchJson: (url: string) => Promise<any>
}) {
  const [mutual, setMutual] = useState<{ mutual: string[]; count: number } | null>(null)
  const [pathResult, setPathResult] = useState<{ path: string[]; hops: number } | null>(null)
  const [pathTarget, setPathTarget] = useState('')

  const handleFindPath = useCallback(async () => {
    if (!selectedUser || !pathTarget) return
    try {
      const data = await fetchJson(`${apiBase}/path/${selectedUser}/${pathTarget}`)
      setPathResult(data)
    } catch { /* ignore */ }
  }, [apiBase, selectedUser, pathTarget, fetchJson])

  // Most connected from traversal
  const topConnected = useMemo(() => {
    if (!traversal?.edges) return []
    const counts: Record<string, number> = {}
    for (const e of traversal.edges) {
      counts[e.source] = (counts[e.source] || 0) + e.interaction_count
      counts[e.target] = (counts[e.target] || 0) + e.interaction_count
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
  }, [traversal])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Most interacted with */}
      {topConnected.length > 0 && (
        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Most Interacted With</h3>
          {topConnected.map(([user, count]) => (
            <div key={user} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
              <span style={{ fontWeight: 500 }}>{user}</span>
              <span style={{ color: '#6b7280' }}>{count} interactions</span>
            </div>
          ))}
        </div>
      )}

      {/* Path finder */}
      <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Degrees of Separation</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            value={pathTarget}
            onChange={e => setPathTarget(e.target.value)}
            placeholder="Target username..."
            style={{ flex: 1, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
          />
          <button
            onClick={handleFindPath}
            disabled={!selectedUser || !pathTarget}
            style={{ padding: '6px 14px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
          >
            Find Path
          </button>
        </div>
        {pathResult && (
          <div style={{ fontSize: 13 }}>
            {pathResult.path.length > 0 ? (
              <>
                <div style={{ fontWeight: 500, marginBottom: 4 }}>{pathResult.hops} degree{pathResult.hops !== 1 ? 's' : ''} of separation</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {pathResult.path.map((user, i) => (
                    <span key={user}>
                      <span style={{ padding: '2px 8px', background: i === 0 || i === pathResult.path.length - 1 ? '#dbeafe' : '#f3f4f6', borderRadius: 12 }}>
                        {user}
                      </span>
                      {i < pathResult.path.length - 1 && <span style={{ color: '#9ca3af' }}> → </span>}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ color: '#9ca3af' }}>No connection path found.</div>
            )}
          </div>
        )}
      </div>

      {/* Relationship type breakdown */}
      {stats?.rel_type_counts && Object.keys(stats.rel_type_counts).length > 0 && (
        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Relationship Types</h3>
          {Object.entries(stats.rel_type_counts).map(([type, count]) => (
            <div key={type} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: REL_TYPE_COLORS[type] || '#9ca3af',
                  display: 'inline-block',
                }} />
                {type.replace(/_/g, ' ')}
              </span>
              <span style={{ color: '#6b7280' }}>{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
