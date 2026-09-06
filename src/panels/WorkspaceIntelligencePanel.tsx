'use client'

/**
 * WorkspaceIntelligencePanel — Workspace health, engagement, collaboration metrics.
 *
 * Composite dashboard showing health score, active users, meeting/email/message
 * volume, engagement trends, top contributors, and collaboration density.
 */

import { useState, useEffect, useCallback } from 'react'

interface HealthData {
  score: number
  active_users: number
  total_users: number
  engagement_rate: number
  messages_today: number
  meetings_today: number
  docs_edited_today: number
  email_volume_today: number
  relay_channels?: number
  graph_people?: number
  graph_relationships?: number
  trends: {
    activity_7d?: number[]
    engagement_7d?: number[]
    messages_7d?: number[]
  }
  top_contributors: Array<{ name: string; score: number; actions: number }>
  mode: string
}

interface MeetingData {
  total_meetings: number
  hours_in_meetings: number
  avg_meeting_duration_min: number
  avg_attendees: number
  by_type: Record<string, number>
  top_collaborators: Array<{ name: string; shared_meetings: number }>
  busiest_days: string[]
  free_time_pct: number
}

interface EmailData {
  total_emails: number
  top_senders: Array<{ email: string; count: number; category: string }>
  by_category: Record<string, number>
  busiest_hours: number[]
  thread_depth_avg: number
}

export interface WorkspaceIntelligencePanelProps {
  apiBase?: string
}

function formatPct(n: number): string {
  return `${Math.round(n * 100)}%`
}

function ScoreRing({ score, size = 100 }: { score: number; size?: number }) {
  const r = (size - 10) / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - score / 100)
  const color = score >= 70 ? '#10B981' : score >= 40 ? '#F59E0B' : '#EF4444'
  return (
    <svg width={size} height={size} style={{ display: 'block', margin: '0 auto' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--glass-border)" strokeWidth={6} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={6}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset 0.5s' }} />
      <text x={size / 2} y={size / 2 + 6} textAnchor="middle" fontSize={size / 4} fontWeight={700}
        fill="var(--text-primary)">{score}</text>
    </svg>
  )
}

function MiniBar({ values, maxVal, color = 'var(--accent-primary)' }: { values: number[]; maxVal?: number; color?: string }) {
  const mx = maxVal || Math.max(1, ...values)
  return (
    <div style={{ display: 'flex', alignItems: 'end', gap: 2, height: 32 }}>
      {values.map((v, i) => (
        <div key={i} style={{
          flex: 1, background: color, borderRadius: 2, opacity: 0.7,
          height: `${Math.max(4, (v / mx) * 100)}%`, transition: 'height 0.3s',
        }} />
      ))}
    </div>
  )
}

export default function WorkspaceIntelligencePanel({
  apiBase = '/api/workspace-intelligence',
}: WorkspaceIntelligencePanelProps) {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [meetings, setMeetings] = useState<MeetingData | null>(null)
  const [emails, setEmails] = useState<EmailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'overview' | 'meetings' | 'email'>('overview')

  const fetchAll = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch(`${apiBase}/health?days=7`).then(r => r.json()).then(d => setHealth(d.data || d)).catch(() => {}),
      fetch(`${apiBase}/meeting-intelligence?days=30`).then(r => r.json()).then(d => setMeetings(d.data || d)).catch(() => {}),
      fetch(`${apiBase}/email-intelligence?days=30`).then(r => r.json()).then(d => setEmails(d.data || d)).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [apiBase])

  useEffect(() => { fetchAll() }, [fetchAll])

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'meetings' as const, label: 'Meetings' },
    { id: 'email' as const, label: 'Email' },
  ]

  return (
    <div style={{ padding: 32, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600 }}>Workspace Intelligence</h1>
        <button onClick={fetchAll} style={refreshBtn}>Refresh</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--bg-base)', padding: 4, borderRadius: 'var(--radius)' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: '10px 16px', borderRadius: 'var(--radius)',
            background: tab === t.id ? 'var(--bg-elevated)' : 'transparent',
            color: tab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
            fontSize: '0.8rem', fontWeight: 500, cursor: 'pointer', border: 'none',
          }}>{t.label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Loading...</div>
      ) : (
        <>
          {/* ── Overview tab ── */}
          {tab === 'overview' && health && (
            <div>
              {/* Health score + key stats */}
              <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 24, marginBottom: 28 }}>
                <div style={{ ...card, textAlign: 'center', padding: '24px 16px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 8 }}>HEALTH SCORE</div>
                  <ScoreRing score={health.score} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
                  <StatTile label="Active Users" value={`${health.active_users}/${health.total_users}`} />
                  <StatTile label="Engagement" value={formatPct(health.engagement_rate)} color={health.engagement_rate >= 0.6 ? '#10B981' : '#F59E0B'} />
                  <StatTile label="Meetings Today" value={String(health.meetings_today)} />
                  <StatTile label="Emails Today" value={String(health.email_volume_today)} />
                  <StatTile label="Docs Edited" value={String(health.docs_edited_today)} />
                  <StatTile label="Messages" value={String(health.messages_today)} />
                  {health.graph_people != null && health.graph_people > 0 && (
                    <StatTile label="Graph Nodes" value={String(health.graph_people)} />
                  )}
                  {health.relay_channels != null && health.relay_channels > 0 && (
                    <StatTile label="Channels" value={String(health.relay_channels)} />
                  )}
                </div>
              </div>

              {/* Activity trend */}
              {(health.trends.activity_7d || health.trends.messages_7d) && (
                <div style={{ ...card, marginBottom: 20, padding: 16 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 10 }}>Activity (7 days)</div>
                  <MiniBar values={health.trends.activity_7d || health.trends.messages_7d || []} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    <span>7d ago</span><span>Today</span>
                  </div>
                </div>
              )}

              {/* Top contributors */}
              {health.top_contributors.length > 0 && (
                <div style={{ ...card, padding: 16 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 10 }}>Top Contributors</div>
                  {health.top_contributors.map((c, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                      <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent-primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700 }}>{i + 1}</div>
                      <div style={{ flex: 1, fontSize: '0.8rem' }}>{c.name}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{c.actions} actions</div>
                      <div style={{ width: 60, height: 6, borderRadius: 3, background: 'var(--bg-base)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${c.score}%`, background: 'var(--accent-primary)', borderRadius: 3 }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Meetings tab ── */}
          {tab === 'meetings' && meetings && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 24 }}>
                <StatTile label="Total Meetings" value={String(meetings.total_meetings)} />
                <StatTile label="Hours in Meetings" value={String(meetings.hours_in_meetings)} />
                <StatTile label="Avg Duration" value={`${meetings.avg_meeting_duration_min}m`} />
                <StatTile label="Avg Attendees" value={String(meetings.avg_attendees)} />
                <StatTile label="Free Time" value={formatPct(meetings.free_time_pct)} color={meetings.free_time_pct >= 0.4 ? '#10B981' : '#EF4444'} />
              </div>

              {/* By type */}
              <div style={{ ...card, padding: 16, marginBottom: 20 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 10 }}>Meeting Types</div>
                {Object.entries(meetings.by_type).map(([type, count]) => (
                  <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                    <div style={{ width: 100, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {type.replace(/_/g, ' ')}
                    </div>
                    <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--bg-base)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(count / Math.max(meetings.total_meetings, 1)) * 100}%`, background: 'var(--accent-primary)', borderRadius: 4, transition: 'width 0.3s' }} />
                    </div>
                    <div style={{ width: 30, fontSize: '0.7rem', textAlign: 'right' }}>{count}</div>
                  </div>
                ))}
              </div>

              {/* Top collaborators */}
              {meetings.top_collaborators.length > 0 && (
                <div style={{ ...card, padding: 16 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 10 }}>Top Meeting Partners</div>
                  {meetings.top_collaborators.slice(0, 8).map((c, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '0.8rem' }}>
                      <span>{c.name}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{c.shared_meetings} meetings</span>
                    </div>
                  ))}
                </div>
              )}

              {meetings.busiest_days.length > 0 && (
                <div style={{ marginTop: 12, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Busiest days: {meetings.busiest_days.join(', ')}
                </div>
              )}
            </div>
          )}

          {/* ── Email tab ── */}
          {tab === 'email' && emails && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 24 }}>
                <StatTile label="Total Emails" value={String(emails.total_emails)} />
                <StatTile label="Avg Thread Depth" value={String(emails.thread_depth_avg)} />
              </div>

              {/* By category */}
              {Object.keys(emails.by_category).length > 0 && (
                <div style={{ ...card, padding: 16, marginBottom: 20 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 10 }}>By Category</div>
                  {Object.entries(emails.by_category).map(([cat, count]) => {
                    const colors: Record<string, string> = { vip: '#8B5CF6', urgent: '#EF4444', approval: '#3B82F6', fyi: '#6B7280' }
                    return (
                      <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: colors[cat] || '#888' }} />
                        <div style={{ width: 80, fontSize: '0.75rem', textTransform: 'uppercase' }}>{cat}</div>
                        <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--bg-base)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${(count / Math.max(emails.total_emails, 1)) * 100}%`, background: colors[cat] || '#888', borderRadius: 4 }} />
                        </div>
                        <div style={{ width: 30, fontSize: '0.7rem', textAlign: 'right' }}>{count}</div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Top senders */}
              {emails.top_senders.length > 0 && (
                <div style={{ ...card, padding: 16 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 10 }}>Top Senders</div>
                  {emails.top_senders.slice(0, 8).map((s, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '0.8rem' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{s.email}</span>
                      <span style={{ color: 'var(--text-muted)', marginLeft: 12 }}>{s.count}</span>
                    </div>
                  ))}
                </div>
              )}

              {emails.busiest_hours.length > 0 && (
                <div style={{ marginTop: 12, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Busiest hours: {emails.busiest_hours.map(h => `${h}:00`).join(', ')}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={card}>
      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius)', padding: '12px 14px',
}

const refreshBtn: React.CSSProperties = {
  padding: '8px 14px', background: 'var(--bg-surface)',
  border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)',
  color: 'var(--text-secondary)', fontSize: '0.8rem', cursor: 'pointer',
}
