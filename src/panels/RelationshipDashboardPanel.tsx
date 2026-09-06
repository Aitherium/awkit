'use client'

/**
 * RelationshipDashboardPanel — Network-level relationship insights.
 *
 * Relationship types breakdown, network density, connectors vs isolated,
 * collaboration signals, strongest pairs, communication flow.
 */

import { useState, useEffect, useCallback } from 'react'

interface RelationshipData {
  total_relationships: number
  total_people?: number
  relationship_types: Record<string, number>
  network_density: number
  avg_strength?: number
  connectors: Array<{ name: string; connections: number; betweenness?: number }>
  isolated_members: Array<{ name: string; connections: number; suggestion: string }>
  strength_distribution?: Record<string, number>
}

interface CollaborationData {
  total_interactions: number
  interaction_types: Record<string, number>
  team_density: number
  strongest_pairs: Array<{ pair: string[]; strength: number; shared_meetings?: number; channels?: string[] }>
  weakest_connections?: Array<{ pair: string[]; strength: number }>
  communication_flow: { internal_pct: number; external_pct: number; sync_pct?: number; async_pct?: number }
  silos_detected?: Array<{ team_a: string; team_b: string; interaction_score: number; suggestion: string }>
}

export interface RelationshipDashboardPanelProps {
  apiBase?: string
}

function formatPct(n: number): string {
  return `${Math.round(n * 100)}%`
}

export default function RelationshipDashboardPanel({
  apiBase = '/api/workspace-intelligence',
}: RelationshipDashboardPanelProps) {
  const [relationships, setRelationships] = useState<RelationshipData | null>(null)
  const [collaboration, setCollaboration] = useState<CollaborationData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch(`${apiBase}/relationships`).then(r => r.json()).then(d => setRelationships(d.data || d)).catch(() => {}),
      fetch(`${apiBase}/collaboration?days=30`).then(r => r.json()).then(d => setCollaboration(d.data || d)).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [apiBase])

  useEffect(() => { fetchAll() }, [fetchAll])

  if (loading) {
    return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', paddingTop: '20vh' }}>Loading...</div>
  }

  const relTypes = relationships?.relationship_types || {}
  const maxRelType = Math.max(1, ...Object.values(relTypes))

  return (
    <div style={{ padding: 32, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600 }}>Relationship Intelligence</h1>
        <button onClick={fetchAll} style={refreshBtn}>Refresh</button>
      </div>

      {/* Key metrics row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 28 }}>
        {relationships && (
          <>
            <MetricCard label="Relationships" value={relationships.total_relationships} />
            <MetricCard label="People" value={relationships.total_people || 0} />
            <MetricCard label="Network Density" value={formatPct(relationships.network_density)}
              color={relationships.network_density >= 0.4 ? '#10B981' : '#F59E0B'} />
          </>
        )}
        {collaboration && (
          <>
            <MetricCard label="Interactions (30d)" value={collaboration.total_interactions} />
            <MetricCard label="Team Density" value={formatPct(collaboration.team_density)}
              color={collaboration.team_density >= 0.4 ? '#10B981' : '#F59E0B'} />
          </>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        {/* Relationship types */}
        {Object.keys(relTypes).length > 0 && (
          <div style={card}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 12 }}>Relationship Types</div>
            {Object.entries(relTypes).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <div style={{ width: 100, fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                  {type.replace(/_/g, ' ')}
                </div>
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(count / maxRelType) * 100}%`, background: 'var(--accent-primary)', borderRadius: 3, transition: 'width 0.3s' }} />
                </div>
                <div style={{ width: 24, fontSize: '0.65rem', textAlign: 'right', color: 'var(--text-muted)' }}>{count}</div>
              </div>
            ))}
          </div>
        )}

        {/* Communication flow */}
        {collaboration && (
          <div style={card}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 12 }}>Communication Flow</div>

            {/* Interaction types */}
            <div style={{ marginBottom: 16 }}>
              {Object.entries(collaboration.interaction_types).map(([type, count]) => (
                <div key={type} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{type}</span>
                  <span style={{ fontWeight: 500 }}>{count}</span>
                </div>
              ))}
            </div>

            {/* Internal vs External */}
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6 }}>Internal vs External</div>
            <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', marginBottom: 4 }}>
              <div style={{ width: `${collaboration.communication_flow.internal_pct * 100}%`, background: '#3B82F6', transition: 'width 0.3s' }} />
              <div style={{ width: `${collaboration.communication_flow.external_pct * 100}%`, background: '#F59E0B', transition: 'width 0.3s' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
              <span>Internal {formatPct(collaboration.communication_flow.internal_pct)}</span>
              <span>External {formatPct(collaboration.communication_flow.external_pct)}</span>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        {/* Connectors */}
        {relationships && relationships.connectors.length > 0 && (
          <div style={card}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 12, color: '#10B981' }}>Key Connectors</div>
            {relationships.connectors.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#10B981', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700 }}>{i + 1}</div>
                <div style={{ flex: 1, fontSize: '0.8rem' }}>{c.name}</div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{c.connections} connections</span>
              </div>
            ))}
          </div>
        )}

        {/* Isolated / at-risk */}
        {relationships && relationships.isolated_members.length > 0 && (
          <div style={card}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 12, color: '#F59E0B' }}>Needs Connection</div>
            {relationships.isolated_members.map((m, i) => (
              <div key={i} style={{ padding: '8px 0', borderBottom: i < relationships.isolated_members.length - 1 ? '1px solid var(--glass-border)' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                  <span>{m.name}</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{m.connections} conn.</span>
                </div>
                <div style={{ fontSize: '0.65rem', color: '#F59E0B', marginTop: 2 }}>{m.suggestion}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Strongest pairs */}
      {collaboration && collaboration.strongest_pairs.length > 0 && (
        <div style={{ ...card, marginBottom: 24 }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 12 }}>Strongest Collaboration Pairs</div>
          {collaboration.strongest_pairs.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: i < collaboration.strongest_pairs.length - 1 ? '1px solid var(--glass-border)' : 'none' }}>
              <div style={{ flex: 1, fontSize: '0.8rem' }}>
                {p.pair[0]} <span style={{ color: 'var(--text-muted)' }}>&harr;</span> {p.pair[1]}
              </div>
              <div style={{ width: 60, height: 6, borderRadius: 3, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${p.strength * 100}%`, background: '#10B981', borderRadius: 3, transition: 'width 0.3s' }} />
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', minWidth: 40, textAlign: 'right' }}>{formatPct(p.strength)}</span>
              {p.shared_meetings != null && (
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{p.shared_meetings} mtgs</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Silo warnings */}
      {collaboration?.silos_detected && collaboration.silos_detected.length > 0 && (
        <div style={{ ...card, borderLeft: '3px solid #EF4444' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 12, color: '#EF4444' }}>Silo Warnings</div>
          {collaboration.silos_detected.map((s, i) => (
            <div key={i} style={{ padding: '8px 0', fontSize: '0.8rem' }}>
              <div>{s.team_a} &harr; {s.team_b} — interaction score: {formatPct(s.interaction_score)}</div>
              <div style={{ fontSize: '0.7rem', color: '#F59E0B', marginTop: 2 }}>{s.suggestion}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MetricCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={card}>
      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius)', padding: '14px 16px',
}

const refreshBtn: React.CSSProperties = {
  padding: '8px 14px', background: 'var(--bg-surface)',
  border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)',
  color: 'var(--text-secondary)', fontSize: '0.8rem', cursor: 'pointer',
}
