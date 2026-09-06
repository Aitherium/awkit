'use client'

/**
 * SocialPanel — Social media analytics, posts, inbox, and scheduled content.
 *
 * Generic panel that connects to any social media integration backend
 * (Sprout Social, Buffer, etc.) via configurable API base URLs.
 */

import { useState, useEffect } from 'react'

export interface SocialPanelProps {
  /** API base for social endpoints, default "/api/sprout" */
  apiBase?: string
  /** What to call the integration in empty states */
  integrationName?: string
  /** Where to link for connection setup */
  connectHref?: string
  /** Called instead of navigating to connectHref */
  onConnect?: () => void
}

export default function SocialPanel({
  apiBase = '/api/social',
  integrationName = 'Social Media',
  connectHref = '/settings/integrations',
  onConnect,
}: SocialPanelProps) {
  const [tab, setTab] = useState<'analytics' | 'posts' | 'inbox' | 'scheduled'>('analytics')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    fetch(`${apiBase}/status`).then(r => r.json()).then(d => setConnected(d.connected)).catch(() => {})
  }, [apiBase])

  useEffect(() => {
    if (!connected) return
    setLoading(true)
    const endpoints: Record<string, string> = {
      analytics: `${apiBase}/analytics?days=30`,
      posts: `${apiBase}/posts/published?limit=20`,
      inbox: `${apiBase}/inbox?limit=20`,
      scheduled: `${apiBase}/posts/scheduled`,
    }
    fetch(endpoints[tab])
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [tab, connected, apiBase])

  if (!connected) {
    return (
      <div style={{ padding: 32, textAlign: 'center', paddingTop: '20vh' }}>
        <div style={{ fontSize: '2rem', marginBottom: 16, opacity: 0.4 }}>S</div>
        <h2 style={{ fontSize: '1.2rem', marginBottom: 8 }}>{integrationName} not connected</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
          Connect your {integrationName} account to see analytics, posts, and inbox.
        </p>
        {onConnect ? (
          <button onClick={onConnect} style={{
            padding: '10px 20px', background: 'var(--accent-primary)', color: 'white',
            borderRadius: 'var(--radius)', fontSize: '0.85rem', cursor: 'pointer',
          }}>Connect {integrationName}</button>
        ) : (
          <a href={connectHref} style={{
            padding: '10px 20px', background: 'var(--accent-primary)', color: 'white',
            borderRadius: 'var(--radius)', fontSize: '0.85rem', textDecoration: 'none',
          }}>Connect {integrationName}</a>
        )}
      </div>
    )
  }

  const tabs = [
    { id: 'analytics' as const, label: 'Analytics' },
    { id: 'posts' as const, label: 'Published' },
    { id: 'inbox' as const, label: 'Inbox' },
    { id: 'scheduled' as const, label: 'Scheduled' },
  ]

  return (
    <div style={{ padding: 32, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600 }}>Social Media</h1>
        <button onClick={() => setLoading(true)} style={{
          padding: '8px 14px', background: 'var(--bg-surface)',
          border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)',
          color: 'var(--text-secondary)', fontSize: '0.8rem', cursor: 'pointer',
        }}>Refresh</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--bg-base)', padding: 4, borderRadius: 'var(--radius)' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: '10px 16px', borderRadius: 'var(--radius)',
            background: tab === t.id ? 'var(--bg-elevated)' : 'transparent',
            color: tab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
            fontSize: '0.8rem', fontWeight: 500, cursor: 'pointer',
          }}>{t.label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>Loading...</div>
      ) : (
        <div>
          {tab === 'analytics' && data && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              {(Array.isArray(data) ? data : data.summary ? [data.summary] : []).map((profile: any, i: number) => (
                <div key={i} style={{
                  background: 'var(--bg-base)', border: '1px solid var(--glass-border)',
                  borderRadius: 'var(--radius)', padding: 16,
                }}>
                  {Object.entries(profile.metrics || profile).map(([key, val]) => (
                    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.8rem' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{key.replace(/_/g, ' ')}</span>
                      <span style={{ fontWeight: 500 }}>{String(val)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {(tab === 'posts' || tab === 'scheduled') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(!data || (Array.isArray(data) && data.length === 0)) ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>No posts found.</p>
              ) : (Array.isArray(data) ? data : []).map((post: any, i: number) => (
                <div key={i} style={{
                  background: 'var(--bg-base)', border: '1px solid var(--glass-border)',
                  borderRadius: 'var(--radius)', padding: '14px 16px',
                }}>
                  <p style={{ fontSize: '0.85rem', marginBottom: 8, lineHeight: 1.5 }}>
                    {post.text || post.content || 'No text'}
                  </p>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {post.created_time || post.schedule_time || ''}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'inbox' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(!data || (Array.isArray(data) && data.length === 0)) ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>Inbox empty.</p>
              ) : (Array.isArray(data) ? data : []).map((msg: any, i: number) => (
                <div key={i} style={{
                  background: 'var(--bg-base)', border: '1px solid var(--glass-border)',
                  borderRadius: 'var(--radius)', padding: '14px 16px',
                }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', marginBottom: 4, fontWeight: 500 }}>
                    {msg.from?.name || 'Unknown'}
                  </div>
                  <p style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>{msg.text || 'No content'}</p>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    {msg.created_time || ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
