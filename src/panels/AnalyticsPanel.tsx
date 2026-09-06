'use client'

import { useState, useEffect, useCallback } from 'react'

interface OverviewMetric {
  label: string
  value: string | number
  trend: 'up' | 'down' | 'flat'
  change?: string
}

interface RevenuePoint {
  date: string
  amount: number
}

interface EngagementData {
  chat_sessions: number
  form_submissions: number
  bookings: number
}

interface AgentMetric {
  agent_name: string
  tasks_completed: number
  avg_response_time: string
  satisfaction?: number
}

interface FunnelStage {
  stage: string
  count: number
  rate?: number
}

export interface AnalyticsPanelProps {
  apiBase?: string
}

type Period = '7d' | '30d' | '90d' | '12m'

export default function AnalyticsPanel({ apiBase = '/api/analytics' }: AnalyticsPanelProps) {
  const [period, setPeriod] = useState<Period>('30d')
  const [loading, setLoading] = useState(true)

  const [overview, setOverview] = useState<OverviewMetric[]>([])
  const [revenue, setRevenue] = useState<RevenuePoint[]>([])
  const [engagement, setEngagement] = useState<EngagementData | null>(null)
  const [agents, setAgents] = useState<AgentMetric[]>([])
  const [funnel, setFunnel] = useState<FunnelStage[]>([])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const qs = `?period=${period}`
      const [overviewRes, revenueRes, engagementRes, agentsRes, funnelRes] = await Promise.all([
        fetch(`${apiBase}/overview${qs}`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/revenue${qs}`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/engagement${qs}`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/agents${qs}`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/funnel${qs}`).then(r => r.ok ? r.json() : null),
      ])

      if (overviewRes?.data?.metrics) {
        setOverview(overviewRes.data.metrics)
      } else if (Array.isArray(overviewRes?.data)) {
        setOverview(overviewRes.data)
      }
      if (revenueRes?.data?.points) {
        setRevenue(revenueRes.data.points)
      } else if (Array.isArray(revenueRes?.data)) {
        setRevenue(revenueRes.data)
      }
      if (engagementRes?.data) {
        setEngagement(engagementRes.data)
      }
      if (agentsRes?.data?.agents) {
        setAgents(agentsRes.data.agents)
      } else if (Array.isArray(agentsRes?.data)) {
        setAgents(agentsRes.data)
      }
      if (funnelRes?.data?.stages) {
        setFunnel(funnelRes.data.stages)
      } else if (Array.isArray(funnelRes?.data)) {
        setFunnel(funnelRes.data)
      }
    } catch (e) {
      console.error('Analytics fetch error:', e)
    }
    setLoading(false)
  }, [apiBase, period])

  useEffect(() => { fetchData() }, [fetchData])

  const trendArrow = (trend: string) => {
    if (trend === 'up') return { symbol: '\u2191', color: '#059669' }
    if (trend === 'down') return { symbol: '\u2193', color: '#dc2626' }
    return { symbol: '\u2192', color: 'var(--text-muted)' }
  }

  const cardStyle: React.CSSProperties = {
    padding: '16px', borderRadius: 8, background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
  }

  const sectionTitle: React.CSSProperties = {
    fontSize: '0.9rem', fontWeight: 600, marginBottom: 12,
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading analytics...
      </div>
    )
  }

  // Revenue chart helpers
  const maxRevenue = Math.max(...revenue.map(p => p.amount), 1)

  // Funnel helpers
  const maxFunnelCount = Math.max(...funnel.map(s => s.count), 1)

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1000, margin: '0 auto' }}>
      {/* Header + Period Selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Analytics</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['7d', '30d', '90d', '12m'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)',
                background: period === p ? 'var(--accent)' : 'transparent',
                color: period === p ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Overview Cards */}
      {overview.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(overview.length, 4)}, 1fr)`, gap: 12, marginBottom: '1.5rem' }}>
          {overview.map((metric, i) => {
            const arrow = trendArrow(metric.trend)
            return (
              <div key={i} style={cardStyle}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                  {metric.label}
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 4 }}>
                  {metric.value}
                </div>
                <div style={{ fontSize: '0.75rem', color: arrow.color }}>
                  {arrow.symbol} {metric.change || metric.trend}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Revenue Chart */}
      {revenue.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: '1.5rem' }}>
          <div style={sectionTitle}>Revenue</div>
          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: 2, height: 140,
            padding: '0 4px',
          }}>
            {revenue.map((point, i) => {
              const heightPct = (point.amount / maxRevenue) * 100
              return (
                <div key={i} style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'flex-end', height: '100%',
                }}>
                  <div
                    title={`${point.date}: $${point.amount.toLocaleString()}`}
                    style={{
                      width: '100%', maxWidth: 32, borderRadius: '4px 4px 0 0',
                      background: 'var(--accent)', minHeight: 2,
                      height: `${heightPct}%`,
                      transition: 'height 0.3s ease',
                    }}
                  />
                </div>
              )
            })}
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', marginTop: 6,
            fontSize: '0.65rem', color: 'var(--text-muted)',
          }}>
            {revenue.length > 0 && <span>{revenue[0].date}</span>}
            {revenue.length > 1 && <span>{revenue[revenue.length - 1].date}</span>}
          </div>
        </div>
      )}

      {/* Engagement Section */}
      {engagement && (
        <div style={{ ...cardStyle, marginBottom: '1.5rem' }}>
          <div style={sectionTitle}>Engagement</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {[
              { label: 'Chat Sessions', value: engagement.chat_sessions },
              { label: 'Form Submissions', value: engagement.form_submissions },
              { label: 'Bookings', value: engagement.bookings },
            ].map((item, i) => (
              <div key={i} style={{
                padding: '12px', borderRadius: 6, background: 'var(--bg-deep)',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 4 }}>
                  {item.value.toLocaleString()}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {item.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent Performance Table */}
      {agents.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: '1.5rem' }}>
          <div style={sectionTitle}>Agent Performance</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 500 }}>Agent</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 500 }}>Tasks</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 500 }}>Avg Response</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 500 }}>Satisfaction</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 500 }}>{agent.agent_name}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{agent.tasks_completed}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-muted)' }}>{agent.avg_response_time}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                    {agent.satisfaction != null ? (
                      <span style={{
                        color: agent.satisfaction >= 4 ? '#059669' : agent.satisfaction >= 3 ? '#d97706' : '#dc2626',
                      }}>
                        {agent.satisfaction.toFixed(1)}/5
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>--</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Conversion Funnel */}
      {funnel.length > 0 && (
        <div style={cardStyle}>
          <div style={sectionTitle}>Conversion Funnel</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {funnel.map((stage, i) => {
              const widthPct = Math.max((stage.count / maxFunnelCount) * 100, 8)
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 90, fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'right', flexShrink: 0 }}>
                    {stage.stage}
                  </div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <div style={{
                      height: 28, borderRadius: 6,
                      background: 'var(--accent)',
                      width: `${widthPct}%`,
                      transition: 'width 0.4s ease',
                      opacity: 1 - (i * 0.15),
                      display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                      paddingRight: 8, boxSizing: 'border-box',
                    }}>
                      <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#fff' }}>
                        {stage.count.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  {stage.rate != null && (
                    <div style={{ width: 50, fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                      {stage.rate}%
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {overview.length === 0 && revenue.length === 0 && !engagement && agents.length === 0 && funnel.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
          No analytics data available for this period.
        </div>
      )}
    </div>
  )
}
