'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TraceStats {
  total_interactions: number
  success_count: number
  success_rate: number
  avg_confidence: number
  avg_latency_ms: number
  total_prompt_tokens: number
  total_completion_tokens: number
  confidence_source_breakdown?: Record<string, number>
}

interface ReliabilityData {
  pending_approvals: number
  approval_rate: number
  low_confidence_count: number
  confidence_distribution: {
    '0-0.3': number
    '0.3-0.5': number
    '0.5-0.7': number
    '0.7-0.9': number
    '0.9-1.0': number
  }
}

interface RecentTrace {
  id: string
  type: string
  input_snippet: string
  confidence: number
  outcome: 'success' | 'error' | 'pending' | 'timeout'
  timestamp: string
}

type TimeRange = 7 | 30 | 90

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function confidenceClass(v: number): string {
  if (v >= 0.7) return 'confidence-high'
  if (v >= 0.4) return 'confidence-mid'
  return 'confidence-low'
}

function successRateColor(rate: number): string {
  if (rate >= 0.95) return 'var(--accent-green)'
  if (rate >= 0.80) return 'oklch(0.85 0.12 85)'
  return 'var(--accent-coral)'
}

const OUTCOME_BADGE: Record<string, string> = {
  success: 'badge badge-success',
  error: 'badge badge-error',
  pending: 'badge badge-pending',
  timeout: 'badge badge-warning',
}

/* ------------------------------------------------------------------ */
/*  Skeleton placeholder                                               */
/* ------------------------------------------------------------------ */

function Skeleton({ width, height = '1.4rem' }: { width?: string; height?: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: width ?? '100%',
        height,
        borderRadius: 'var(--radius)',
        background: 'var(--bg-elevated)',
        animation: 'pulse 1.5s ease-in-out infinite',
      }}
    />
  )
}

function StatCardSkeleton() {
  return (
    <div className="stat-card">
      <Skeleton width="60%" height="1.5rem" />
      <Skeleton width="40%" height="0.7rem" />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function ReliabilityDashboard() {
  const [stats, setStats] = useState<TraceStats | null>(null)
  const [reliability, setReliability] = useState<ReliabilityData | null>(null)
  const [traces, setTraces] = useState<RecentTrace[]>([])
  const [days, setDays] = useState<TimeRange>(30)
  const [loadingStats, setLoadingStats] = useState(true)
  const [loadingReliability, setLoadingReliability] = useState(true)
  const [loadingTraces, setLoadingTraces] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async (range: TimeRange) => {
    setLoadingStats(true)
    setLoadingReliability(true)
    setLoadingTraces(true)
    setError(null)

    const fetchStats = async () => {
      try {
        const res = await fetch(`/api/traces/stats?days=${range}`)
        if (!res.ok) throw new Error(`Stats: ${res.status}`)
        setStats(await res.json())
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to load stats'
        setError(prev => prev ? `${prev}; ${msg}` : msg)
        setStats(null)
      } finally {
        setLoadingStats(false)
      }
    }

    const fetchReliability = async () => {
      try {
        const res = await fetch(`/api/traces/reliability?days=${range}`)
        if (!res.ok) throw new Error(`Reliability: ${res.status}`)
        setReliability(await res.json())
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to load reliability data'
        setError(prev => prev ? `${prev}; ${msg}` : msg)
        setReliability(null)
      } finally {
        setLoadingReliability(false)
      }
    }

    const fetchTraces = async () => {
      try {
        const res = await fetch(`/api/traces/recent?days=${range}&limit=5`)
        if (!res.ok) throw new Error(`Traces: ${res.status}`)
        const data = await res.json()
        setTraces(data.traces ?? data ?? [])
      } catch {
        setTraces([])
      } finally {
        setLoadingTraces(false)
      }
    }

    await Promise.all([fetchStats(), fetchReliability(), fetchTraces()])
  }, [])

  useEffect(() => {
    fetchData(days)
  }, [days, fetchData])

  const timeRanges: TimeRange[] = [7, 30, 90]

  return (
    <div className="panel">
      {/* ---- Header ---- */}
      <div className="panel-header">
        <h2 className="panel-title">Reliability</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div className="seg-control">
            {timeRanges.map(range => (
              <button
                key={range}
                data-active={days === range}
                onClick={() => setDays(range)}
              >
                {range}d
              </button>
            ))}
          </div>
          <button
            className="btn btn-ghost"
            onClick={() => fetchData(days)}
            disabled={loadingStats && loadingReliability}
            style={{ padding: '0.4rem 0.7rem', fontSize: '0.78rem' }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* ---- Global error ---- */}
      {error && (
        <div className="error-banner" style={{ marginBottom: '1rem' }}>
          {error}
          <button
            className="btn btn-ghost"
            onClick={() => fetchData(days)}
            style={{ marginLeft: '0.75rem', padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* ---- Top stat row ---- */}
      <section style={{ marginBottom: '0.75rem' }}>
        <div className="grid-stats" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {loadingStats ? (
            <>
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </>
          ) : (
            <>
              <div className="stat-card">
                <span
                  className="stat-value"
                  style={{ color: stats ? successRateColor(stats.success_rate) : undefined }}
                >
                  {stats ? `${(stats.success_rate * 100).toFixed(1)}%` : '--'}
                </span>
                <span className="stat-label">Success Rate</span>
                {stats && (
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                    of {formatCount(stats.total_interactions)} total interactions
                  </span>
                )}
              </div>

              <div className="stat-card">
                <span className={`stat-value ${stats ? confidenceClass(stats.avg_confidence) : ''}`}>
                  {stats ? stats.avg_confidence.toFixed(2) : '--'}
                </span>
                <span className="stat-label">Avg Confidence</span>
                {stats?.confidence_source_breakdown && (
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                    {Object.entries(stats.confidence_source_breakdown)
                      .map(([k, v]) => `${k}: ${(v * 100).toFixed(0)}%`)
                      .join(' / ')}
                  </span>
                )}
              </div>

              <div className="stat-card">
                <span className="stat-value" style={{ color: 'var(--accent-cyan)' }}>
                  {stats ? `${stats.avg_latency_ms.toFixed(0)}ms` : '--'}
                </span>
                <span className="stat-label">Avg Latency</span>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                  median response time
                </span>
              </div>

              <div className="stat-card">
                <span className="stat-value">
                  {stats ? formatCount(stats.total_interactions) : '--'}
                </span>
                <span className="stat-label">Total Interactions</span>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                  last {days} days
                </span>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ---- Approval row ---- */}
      <section style={{ marginBottom: '1.25rem' }}>
        <div className="grid-stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {loadingReliability ? (
            <>
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </>
          ) : (
            <>
              <div
                className="stat-card"
                style={{
                  cursor: reliability && reliability.pending_approvals > 0 ? 'pointer' : undefined,
                }}
                onClick={() => {
                  if (reliability && reliability.pending_approvals > 0) {
                    window.location.hash = '#approvals'
                  }
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="stat-value">
                    {reliability ? String(reliability.pending_approvals) : '--'}
                  </span>
                  {reliability && reliability.pending_approvals > 0 && (
                    <span className="badge badge-pending">needs review</span>
                  )}
                </div>
                <span className="stat-label">Pending Approvals</span>
              </div>

              <div className="stat-card">
                <span className="stat-value" style={{ color: 'var(--accent-green)' }}>
                  {reliability ? `${(reliability.approval_rate * 100).toFixed(1)}%` : '--'}
                </span>
                <span className="stat-label">Approval Rate</span>
                {reliability && (
                  <div className="progress-bar" style={{ marginTop: '0.5rem' }}>
                    <div
                      className="progress-bar-fill"
                      style={{
                        width: `${reliability.approval_rate * 100}%`,
                        background: 'var(--accent-green)',
                      }}
                    />
                  </div>
                )}
              </div>

              <div className="stat-card">
                <span
                  className="stat-value"
                  style={{
                    color: reliability && reliability.low_confidence_count > 5
                      ? 'var(--accent-coral)'
                      : 'var(--text-secondary)',
                  }}
                >
                  {reliability ? String(reliability.low_confidence_count) : '--'}
                </span>
                <span className="stat-label">Low Confidence</span>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                  responses below 0.5 threshold
                </span>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ---- Confidence Distribution ---- */}
      <section style={{ marginBottom: '1rem' }}>
        <div className="card" style={{ padding: '1.25rem' }}>
          <h3 style={{
            fontSize: '0.85rem',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: '1rem',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}>
            Confidence Distribution
          </h3>
          {loadingReliability ? (
            <div style={{ display: 'grid', gap: '0.65rem' }}>
              {[1, 2, 3, 4, 5].map(i => (
                <Skeleton key={i} height="24px" />
              ))}
            </div>
          ) : reliability ? (
            <ConfidenceChart distribution={reliability.confidence_distribution} />
          ) : (
            <div className="empty-state" style={{ padding: '1.5rem 0' }}>
              <p>No confidence data available</p>
            </div>
          )}
        </div>
      </section>

      {/* ---- Token Usage ---- */}
      <section style={{ marginBottom: '1rem' }}>
        <div className="card" style={{ padding: '1.25rem' }}>
          <h3 style={{
            fontSize: '0.85rem',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: '1rem',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}>
            Token Usage ({days}d)
          </h3>
          {loadingStats ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ textAlign: 'center' }}>
                  <Skeleton width="60%" height="1.5rem" />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
              <TokenCell
                value={stats ? formatCount(stats.total_prompt_tokens + stats.total_completion_tokens) : '--'}
                label="Total Tokens"
              />
              <TokenCell
                value={stats ? formatCount(stats.total_prompt_tokens) : '--'}
                label="Prompt"
                color="var(--accent-cyan)"
              />
              <TokenCell
                value={stats ? formatCount(stats.total_completion_tokens) : '--'}
                label="Completion"
                color="var(--accent-primary)"
              />
            </div>
          )}
        </div>
      </section>

      {/* ---- Recent Traces ---- */}
      <section>
        <div className="card" style={{ padding: '1.25rem' }}>
          <h3 style={{
            fontSize: '0.85rem',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: '1rem',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}>
            Recent Traces
          </h3>
          {loadingTraces ? (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {[1, 2, 3].map(i => (
                <Skeleton key={i} height="36px" />
              ))}
            </div>
          ) : traces.length === 0 ? (
            <div className="empty-state" style={{ padding: '1.5rem 0' }}>
              <p>No recent traces</p>
            </div>
          ) : (
            <div className="custom-scroll" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <Th>Type</Th>
                    <Th style={{ width: '40%' }}>Input</Th>
                    <Th align="right">Confidence</Th>
                    <Th align="center">Outcome</Th>
                    <Th align="right">Time</Th>
                  </tr>
                </thead>
                <tbody>
                  {traces.map(trace => (
                    <tr
                      key={trace.id}
                      style={{ borderBottom: '1px solid var(--glass-border)' }}
                    >
                      <Td>
                        <span className="badge">{trace.type}</span>
                      </Td>
                      <Td>
                        <span
                          style={{
                            color: 'var(--text-secondary)',
                            display: '-webkit-box',
                            WebkitLineClamp: 1,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            maxWidth: '280px',
                          }}
                        >
                          {trace.input_snippet}
                        </span>
                      </Td>
                      <Td align="right">
                        <span className={confidenceClass(trace.confidence)}>
                          {trace.confidence.toFixed(2)}
                        </span>
                      </Td>
                      <Td align="center">
                        <span className={OUTCOME_BADGE[trace.outcome] ?? 'badge'}>
                          {trace.outcome}
                        </span>
                      </Td>
                      <Td align="right">
                        <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {timeAgo(trace.timestamp)}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Keyframe for skeleton pulse -- injected once */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.15; }
        }
      `}</style>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function ConfidenceChart({ distribution }: { distribution: Record<string, number> }) {
  const buckets: { label: string; key: string; color: string }[] = [
    { label: '0 - 0.3', key: '0-0.3', color: 'var(--accent-coral)' },
    { label: '0.3 - 0.5', key: '0.3-0.5', color: 'oklch(0.80 0.12 45)' },
    { label: '0.5 - 0.7', key: '0.5-0.7', color: 'oklch(0.85 0.12 85)' },
    { label: '0.7 - 0.9', key: '0.7-0.9', color: 'var(--accent-cyan)' },
    { label: '0.9 - 1.0', key: '0.9-1.0', color: 'var(--accent-green)' },
  ]

  const maxVal = Math.max(1, ...Object.values(distribution))

  return (
    <div style={{ display: 'grid', gap: '0.65rem' }}>
      {buckets.map(bucket => {
        const count = distribution[bucket.key] || 0
        const pct = (count / maxVal) * 100

        return (
          <div
            key={bucket.key}
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
          >
            <span style={{
              fontSize: '0.72rem',
              color: 'var(--text-muted)',
              width: 60,
              textAlign: 'right',
              flexShrink: 0,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {bucket.label}
            </span>
            <div className="progress-bar" style={{ flex: 1, height: 20, borderRadius: 5 }}>
              <div
                className="progress-bar-fill"
                style={{
                  width: `${Math.max(pct, count > 0 ? 2 : 0)}%`,
                  background: bucket.color,
                  borderRadius: 5,
                }}
              />
            </div>
            <span style={{
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              width: 42,
              textAlign: 'right',
              flexShrink: 0,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {formatCount(count)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function TokenCell({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        fontSize: '1.4rem',
        fontWeight: 700,
        color: color ?? 'var(--text-primary)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
        {label}
      </div>
    </div>
  )
}

function Th({
  children,
  align = 'left',
  style,
}: {
  children: ReactNode
  align?: 'left' | 'center' | 'right'
  style?: React.CSSProperties
}) {
  return (
    <th style={{
      textAlign: align,
      padding: '0.5rem 0.6rem',
      fontWeight: 500,
      color: 'var(--text-muted)',
      fontSize: '0.7rem',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      ...style,
    }}>
      {children}
    </th>
  )
}

function Td({
  children,
  align = 'left',
}: {
  children: ReactNode
  align?: 'left' | 'center' | 'right'
}) {
  return (
    <td style={{
      textAlign: align,
      padding: '0.55rem 0.6rem',
      verticalAlign: 'middle',
    }}>
      {children}
    </td>
  )
}
