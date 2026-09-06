'use client'

import { useState, useEffect, useCallback } from 'react'

export interface BenchmarkPanelProps {
  apiBase?: string
}

interface LatestBenchmark {
  score: number
  previous_score?: number
  profile: string
  completed_at: string
  categories?: Record<string, number>
}

interface ScorePoint {
  date: string
  score: number
}

export default function BenchmarkPanel({ apiBase = '/api/benchmark' }: BenchmarkPanelProps) {
  const [latest, setLatest] = useState<LatestBenchmark | null>(null)
  const [scores, setScores] = useState<ScorePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const [latestRes, scoresRes] = await Promise.all([
        fetch(`${apiBase}/latest`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/scores`).then(r => r.ok ? r.json() : null),
      ])
      if (latestRes) setLatest(latestRes)
      if (scoresRes?.scores) setScores(scoresRes.scores)
    } catch { /* graceful fallback */ }
    setLoading(false)
  }, [apiBase])

  useEffect(() => { fetchData() }, [fetchData])

  const handleQuickRun = async () => {
    setRunning(true)
    try {
      await fetch(`${apiBase}/quick-run`, { method: 'POST' })
      // Poll for completion
      setTimeout(fetchData, 10000)
    } catch { /* ignore */ }
    setRunning(false)
  }

  const delta = latest && typeof latest.previous_score === 'number'
    ? latest.score - latest.previous_score
    : null

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ height: 20, background: '#27272a', borderRadius: 4, width: '60%', marginBottom: 12 }} />
        <div style={{ height: 60, background: '#27272a', borderRadius: 8 }} />
      </div>
    )
  }

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, color: '#d4d4d8' }}>
        Benchmark
      </h3>

      {!latest ? (
        <p style={{ color: '#71717a', fontSize: 13 }}>No benchmark data yet</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Score + trend */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 28, fontWeight: 700, fontFamily: 'monospace', color: '#e4e4e7' }}>
              {(latest.score * 100).toFixed(1)}%
            </span>
            {delta !== null && (
              <span style={{
                fontSize: 12,
                fontWeight: 600,
                color: delta > 0 ? '#4ade80' : delta < 0 ? '#f87171' : '#71717a',
              }}>
                {delta > 0 ? '+' : ''}{(delta * 100).toFixed(1)}%
              </span>
            )}
          </div>

          {/* Mini radar (compact SVG) */}
          {latest.categories && (() => {
            const cats = Object.entries(latest.categories)
            const size = 120
            const cx = size / 2
            const cy = size / 2
            const maxR = size * 0.38
            const step = 360 / cats.length
            const toXY = (angle: number, r: number) => {
              const rad = (angle - 90) * (Math.PI / 180)
              return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
            }
            const pts = cats.map(([, v], i) => toXY(i * step, Math.min(1, v) * maxR))
            const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z'

            return (
              <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                {/* Grid */}
                {[0.5, 1].map(r => {
                  const gPts = cats.map((_, i) => toXY(i * step, r * maxR))
                  const gd = gPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z'
                  return <path key={r} d={gd} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                })}
                <path d={d} fill="rgba(34,211,238,0.15)" stroke="rgba(34,211,238,0.7)" strokeWidth="1.5" />
                {pts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r="2" fill="#22d3ee" />
                ))}
              </svg>
            )
          })()}

          {/* Meta */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#71717a' }}>
            <span>Profile: {latest.profile}</span>
            <span>{new Date(latest.completed_at).toLocaleDateString()}</span>
          </div>

          {/* Quick run */}
          <button
            onClick={handleQuickRun}
            disabled={running}
            style={{
              padding: '8px 16px',
              fontSize: 12,
              fontWeight: 600,
              background: running ? '#27272a' : '#0891b2',
              color: running ? '#71717a' : '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: running ? 'default' : 'pointer',
              marginTop: 4,
            }}
          >
            {running ? 'Running...' : 'Quick Benchmark'}
          </button>
        </div>
      )}
    </div>
  )
}
