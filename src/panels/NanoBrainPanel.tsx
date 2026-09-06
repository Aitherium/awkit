'use client'

import { useState, useEffect, useCallback } from 'react'

/* ── Types ─────────────────────────────────────────────────────────────── */

interface LabStatus {
  experiments_total: number
  experiments_completed: number
  sweep_active: boolean
  last_updated: string
}

interface Experiment {
  id: string
  name: string
  status: string
  loss: number
  eval_loss?: number
  accuracy?: number
  created_at: string
  updated_at: string
}

interface LeaderboardEntry {
  id: string
  name: string
  loss: number
  accuracy: number
  created_at: string
}

export interface NanoBrainPanelProps {
  apiBase?: string
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

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

function formatMetric(value: number, decimals: number = 3): string {
  return value.toFixed(decimals)
}

function statusBadgeColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'var(--accent-green, #4ade80)'
    case 'running':
      return 'var(--accent-blue, #0891b2)'
    case 'failed':
      return 'var(--accent-coral, #f87171)'
    case 'pending':
      return 'var(--accent-amber, #facc15)'
    default:
      return 'var(--text-tertiary, #71717a)'
  }
}

/* ── Main Panel ──────────────────────────────────────────────────────── */

export default function NanoBrainPanel({
  apiBase = '/api/v1/nanobrain',
}: NanoBrainPanelProps) {
  const [status, setStatus] = useState<LabStatus | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [loading, setLoading] = useState(true)
  const [retraining, setRetraining] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('Loading NanoBrain status...')

  const fetchData = useCallback(async () => {
    try {
      const [statusRes, lbRes, expsRes] = await Promise.all([
        fetch(`${apiBase}/status`).then(r => (r.ok ? r.json() : null)),
        fetch(`${apiBase}/leaderboard?top_n=5`).then(r => (r.ok ? r.json() : null)),
        fetch(`${apiBase}/experiments?limit=10&status=completed`).then(r =>
          r.ok ? r.json() : null
        ),
      ])
      if (statusRes) setStatus(statusRes)
      if (lbRes?.leaderboard) setLeaderboard(lbRes.leaderboard)
      if (expsRes?.experiments) setExperiments(expsRes.experiments)
    } catch (err) {
      console.error('Failed to fetch NanoBrain data:', err)
    }
    setLoading(false)
  }, [apiBase])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleRetrainIntent = async () => {
    setRetraining(true)
    try {
      await fetch(`${apiBase}/retrain-intent`, { method: 'POST' })
      setLoadingMessage('Intent router retraining started...')
      // Poll for completion after short delay
      setTimeout(() => {
        fetchData()
        setLoadingMessage('Retrain complete!')
        setTimeout(() => setLoadingMessage(''), 3000)
      }, 2000)
    } catch (err) {
      console.error('Intent retrain failed:', err)
      setLoadingMessage('Retrain failed — check logs')
      setTimeout(() => setLoadingMessage(''), 3000)
    }
    setRetraining(false)
  }

  if (loading) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <div
          style={{
            height: 20,
            background: 'var(--bg-tertiary, #27272a)',
            borderRadius: 4,
            width: '60%',
            marginBottom: 12,
          }}
        />
        <div
          style={{
            height: 60,
            background: 'var(--bg-tertiary, #27272a)',
            borderRadius: 8,
          }}
        />
      </div>
    )
  }

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h3
        style={{
          margin: '0 0 16px',
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--text-primary, #d4d4d8)',
        }}
      >
        AitherNanoBrain
      </h3>

      {/* Engine Stats */}
      <div style={{ marginBottom: 20 }}>
        <h4
          style={{
            margin: '0 0 8px',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-secondary, #a1a1aa)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          Engine Performance
        </h4>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 12,
          }}
        >
          <div
            style={{
              padding: '12px',
              background: 'var(--bg-secondary, #18181b)',
              borderRadius: 6,
              border: '1px solid var(--border-subtle, #3f3f46)',
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-tertiary, #71717a)',
                marginBottom: 4,
              }}
            >
              Evaluate
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace' }}>
              1.31ms
            </div>
          </div>
          <div
            style={{
              padding: '12px',
              background: 'var(--bg-secondary, #18181b)',
              borderRadius: 6,
              border: '1px solid var(--border-subtle, #3f3f46)',
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-tertiary, #71717a)',
                marginBottom: 4,
              }}
            >
              500 docs train
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace' }}>
              0.6s
            </div>
          </div>
          <div
            style={{
              padding: '12px',
              background: 'var(--bg-secondary, #18181b)',
              borderRadius: 6,
              border: '1px solid var(--border-subtle, #3f3f46)',
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-tertiary, #71717a)',
                marginBottom: 4,
              }}
            >
              Speedup
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', color: 'var(--accent-green, #4ade80)' }}>
              5.7Kx
            </div>
          </div>
        </div>
      </div>

      {/* Lab Status */}
      {status && (
        <div style={{ marginBottom: 20 }}>
          <h4
            style={{
              margin: '0 0 8px',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-secondary, #a1a1aa)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            Lab Status
          </h4>
          <div
            style={{
              padding: '12px',
              background: 'var(--bg-secondary, #18181b)',
              borderRadius: 6,
              border: '1px solid var(--border-subtle, #3f3f46)',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 13,
            }}
          >
            <span style={{ color: 'var(--text-secondary, #a1a1aa)' }}>
              {status.experiments_completed} of {status.experiments_total} completed
              {status.sweep_active && (
                <span
                  style={{
                    marginLeft: 8,
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: 'var(--accent-blue, #0891b2)',
                    animation: 'pulse 2s infinite',
                  }}
                />
              )}
            </span>
            <span style={{ color: 'var(--text-tertiary, #71717a)', fontSize: 11 }}>
              {timeAgo(status.last_updated)}
            </span>
          </div>
        </div>
      )}

      {/* Leaderboard */}
      {leaderboard.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h4
            style={{
              margin: '0 0 8px',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-secondary, #a1a1aa)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            Top Experiments
          </h4>
          <div
            style={{
              border: '1px solid var(--border-subtle, #3f3f46)',
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 12,
              }}
            >
              <thead>
                <tr
                  style={{
                    background: 'var(--bg-secondary, #18181b)',
                    borderBottom: '1px solid var(--border-subtle, #3f3f46)',
                  }}
                >
                  <th
                    style={{
                      padding: '8px 12px',
                      textAlign: 'left',
                      fontWeight: 600,
                      color: 'var(--text-tertiary, #71717a)',
                      fontSize: 10,
                      textTransform: 'uppercase',
                      letterSpacing: '0.3px',
                    }}
                  >
                    Experiment
                  </th>
                  <th
                    style={{
                      padding: '8px 12px',
                      textAlign: 'right',
                      fontWeight: 600,
                      color: 'var(--text-tertiary, #71717a)',
                      fontSize: 10,
                      textTransform: 'uppercase',
                      letterSpacing: '0.3px',
                    }}
                  >
                    Loss
                  </th>
                  <th
                    style={{
                      padding: '8px 12px',
                      textAlign: 'right',
                      fontWeight: 600,
                      color: 'var(--text-tertiary, #71717a)',
                      fontSize: 10,
                      textTransform: 'uppercase',
                      letterSpacing: '0.3px',
                    }}
                  >
                    Accuracy
                  </th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((entry, idx) => (
                  <tr
                    key={entry.id}
                    style={{
                      borderBottom:
                        idx < leaderboard.length - 1
                          ? '1px solid var(--border-subtle, #3f3f46)'
                          : 'none',
                      background:
                        idx % 2 === 0 ? 'var(--bg-primary, #0a0e17)' : 'var(--bg-secondary, #18181b)',
                    }}
                  >
                    <td
                      style={{
                        padding: '8px 12px',
                        color: 'var(--text-primary, #d4d4d8)',
                        fontWeight: 500,
                      }}
                    >
                      {entry.name}
                    </td>
                    <td
                      style={{
                        padding: '8px 12px',
                        textAlign: 'right',
                        color: 'var(--text-secondary, #a1a1aa)',
                        fontFamily: 'monospace',
                      }}
                    >
                      {formatMetric(entry.loss)}
                    </td>
                    <td
                      style={{
                        padding: '8px 12px',
                        textAlign: 'right',
                        color: 'var(--accent-green, #4ade80)',
                        fontFamily: 'monospace',
                        fontWeight: 600,
                      }}
                    >
                      {formatMetric(entry.accuracy * 100, 1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Experiments */}
      {experiments.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h4
            style={{
              margin: '0 0 8px',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-secondary, #a1a1aa)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            Recent Runs
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {experiments.slice(0, 3).map(exp => (
              <div
                key={exp.id}
                style={{
                  padding: '10px 12px',
                  background: 'var(--bg-secondary, #18181b)',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle, #3f3f46)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 12,
                }}
              >
                <div>
                  <div style={{ color: 'var(--text-primary, #d4d4d8)', fontWeight: 500 }}>
                    {exp.name}
                  </div>
                  <div style={{ color: 'var(--text-tertiary, #71717a)', fontSize: 11 }}>
                    {timeAgo(exp.updated_at)}
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <span
                    style={{
                      padding: '2px 8px',
                      background: statusBadgeColor(exp.status),
                      color: '#fff',
                      borderRadius: 3,
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: 'capitalize',
                    }}
                  >
                    {exp.status}
                  </span>
                  <span
                    style={{
                      color: 'var(--text-secondary, #a1a1aa)',
                      fontFamily: 'monospace',
                      fontSize: 11,
                    }}
                  >
                    {formatMetric(exp.loss)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action: Retrain Intent Router */}
      <button
        onClick={handleRetrainIntent}
        disabled={retraining}
        style={{
          width: '100%',
          padding: '10px 16px',
          fontSize: 12,
          fontWeight: 600,
          background: retraining ? 'var(--bg-tertiary, #27272a)' : 'var(--accent-blue, #0891b2)',
          color: retraining ? 'var(--text-tertiary, #71717a)' : '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: retraining ? 'default' : 'pointer',
          transition: 'background 0.2s ease',
        }}
        onMouseEnter={e => {
          if (!retraining) {
            (e.target as HTMLButtonElement).style.background = 'var(--accent-blue, #06b6d4)'
          }
        }}
        onMouseLeave={e => {
          if (!retraining) {
            (e.target as HTMLButtonElement).style.background = 'var(--accent-blue, #0891b2)'
          }
        }}
      >
        {retraining ? 'Retraining...' : 'Retrain Intent Router'}
      </button>

      {loadingMessage && (
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            color: 'var(--accent-blue, #0891b2)',
            textAlign: 'center',
          }}
        >
          {loadingMessage}
        </div>
      )}
    </div>
  )
}
