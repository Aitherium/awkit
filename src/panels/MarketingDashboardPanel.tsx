'use client'

/**
 * MarketingDashboardPanel — Cross-platform analytics dashboard.
 *
 * Time range selector, stat cards, platform comparison,
 * top performing posts table.
 */

import { useState, useEffect } from 'react'

interface AnalyticsData {
  summary: {
    total_reach: number
    total_engagement: number
    avg_engagement_rate: number
    follower_growth: number
    posts_count: number
  }
  by_platform: Record<string, {
    reach: number
    engagement: number
    engagement_rate: number
    follower_growth?: number
    subscriber_growth?: number
    posts?: number
    sends?: number
  }>
  top_posts: Array<{
    id: string
    text: string
    platform: string
    reach: number
    engagement: number
  }>
  daily: Array<{ date: string; reach: number; engagement: number }>
}

export interface MarketingDashboardPanelProps {
  apiBase?: string
}

const PLATFORM_COLORS: Record<string, string> = {
  bluesky: '#0085FF',
  linkedin: '#0A66C2',
  email: '#10B981',
  twitter: '#1DA1F2',
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

export default function MarketingDashboardPanel({
  apiBase = '/api/social',
}: MarketingDashboardPanelProps) {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`${apiBase}/analytics?days=${days}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [apiBase, days])

  const ranges = [
    { label: '7d', value: 7 },
    { label: '30d', value: 30 },
    { label: '90d', value: 90 },
  ]

  const summary = data?.summary
  const byPlatform = data?.by_platform || {}
  const topPosts = data?.top_posts || []

  // Find max reach for bar scaling
  const maxReach = Math.max(1, ...Object.values(byPlatform).map(p => p.reach || 0))

  return (
    <div style={{ padding: 32, maxWidth: 1000, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600 }}>Marketing Dashboard</h1>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-base)', padding: 3, borderRadius: 'var(--radius)' }}>
          {ranges.map(r => (
            <button
              key={r.value}
              onClick={() => setDays(r.value)}
              style={{
                padding: '6px 14px', borderRadius: 'var(--radius)',
                background: days === r.value ? 'var(--bg-elevated)' : 'transparent',
                color: days === r.value ? 'var(--text-primary)' : 'var(--text-muted)',
                fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer', border: 'none',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Loading...</div>
      ) : !summary ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>No analytics data available.</div>
      ) : (
        <>
          {/* Stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 28 }}>
            {[
              { label: 'Total Reach', value: formatNumber(summary.total_reach) },
              { label: 'Engagement', value: formatNumber(summary.total_engagement) },
              { label: 'Avg Rate', value: `${summary.avg_engagement_rate.toFixed(1)}%` },
              { label: 'Follower Growth', value: `+${formatNumber(summary.follower_growth)}` },
              { label: 'Posts', value: String(summary.posts_count) },
            ].map(s => (
              <div key={s.label} style={{
                background: 'var(--bg-base)', border: '1px solid var(--glass-border)',
                borderRadius: 'var(--radius)', padding: '16px 18px',
              }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Platform comparison */}
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 14 }}>Platform Comparison</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Object.entries(byPlatform).map(([plat, stats]) => (
                <div key={plat} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 80, fontSize: '0.75rem', fontWeight: 500, color: PLATFORM_COLORS[plat] || 'var(--text-primary)' }}>
                    {plat.charAt(0).toUpperCase() + plat.slice(1)}
                  </div>
                  <div style={{ flex: 1, display: 'flex', gap: 4, alignItems: 'center' }}>
                    {/* Reach bar */}
                    <div style={{ flex: 1, height: 24, background: 'var(--bg-base)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                      <div style={{
                        height: '100%', borderRadius: 4,
                        width: `${(stats.reach / maxReach) * 100}%`,
                        background: PLATFORM_COLORS[plat] || '#888',
                        opacity: 0.7, transition: 'width 0.3s',
                      }} />
                      <span style={{
                        position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                        fontSize: '0.65rem', color: 'var(--text-secondary)',
                      }}>
                        {formatNumber(stats.reach)} reach
                      </span>
                    </div>
                  </div>
                  <div style={{ width: 80, textAlign: 'right', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                    {stats.engagement_rate?.toFixed(1)}% rate
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top posts */}
          {topPosts.length > 0 && (
            <div>
              <h2 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 14 }}>Top Performing Posts</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {topPosts.map((post, i) => (
                  <div key={post.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                    background: 'var(--bg-base)', borderRadius: 'var(--radius)',
                    border: '1px solid var(--glass-border)',
                  }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                      {i + 1}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '0.8rem', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{post.text}</p>
                    </div>
                    <span style={{
                      fontSize: '0.65rem', padding: '2px 8px', borderRadius: 10,
                      background: PLATFORM_COLORS[post.platform] || '#888', color: 'white',
                    }}>
                      {post.platform}
                    </span>
                    <div style={{ textAlign: 'right', minWidth: 70 }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>{formatNumber(post.reach)}</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{formatNumber(post.engagement)} eng.</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
