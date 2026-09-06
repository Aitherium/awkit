'use client'

import { useState, useEffect, useRef } from 'react'

interface ActivityEvent {
  id: string
  user_id: string
  user_name: string
  action: string
  subject: string
  detail: Record<string, unknown>
  created_at: string
}

const ACTION_ICONS: Record<string, string> = {
  upload: '📄',
  generate: '✨',
  feedback: '💬',
  preference: '⚙️',
  query: '🔍',
  selection: '✅',
  export: '📊',
  review: '👁️',
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export interface ActivityFeedPanelProps {
  apiBase?: string
  limit?: number
}

export default function ActivityFeedPanel({ apiBase = '/api/activity', limit = 15 }: ActivityFeedPanelProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource(`${apiBase}/stream`)
    esRef.current = es

    es.onmessage = (msg) => {
      try {
        const event: ActivityEvent = JSON.parse(msg.data)
        setEvents(prev => [event, ...prev].slice(0, limit))
      } catch { /* ignore parse errors */ }
    }

    es.onerror = () => {
      es.close()
      setTimeout(() => {
        esRef.current = new EventSource(`${apiBase}/stream`)
      }, 5000)
    }

    return () => { es.close() }
  }, [apiBase, limit])

  return (
    <div style={{ padding: '0.75rem' }}>
      <h3 style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
        Activity
      </h3>
      {events.length === 0 && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No recent activity</p>
      )}
      {events.map(e => (
        <div
          key={e.id}
          onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
          style={{
            padding: '0.4rem 0',
            borderBottom: '1px solid var(--glass-border)',
            fontSize: '0.8rem',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              <span>{ACTION_ICONS[e.action] || '•'} </span>
              <strong style={{ color: 'var(--text-secondary)' }}>{e.user_name}</strong>
              {' '}
              <span style={{ color: 'var(--text-muted)' }}>{e.action}</span>
              {' '}
              <span>{e.subject.slice(0, 40)}</span>
            </div>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: '0.3rem', whiteSpace: 'nowrap' }}>
              {e.created_at ? timeAgo(e.created_at) : ''}
            </span>
          </div>
          {expandedId === e.id && e.detail && Object.keys(e.detail).length > 0 && (
            <div style={{
              marginTop: '0.3rem',
              padding: '0.3rem 0.5rem',
              background: 'var(--bg-surface)',
              borderRadius: 4,
              fontSize: '0.7rem',
              color: 'var(--text-secondary)',
            }}>
              {Object.entries(e.detail).map(([k, v]) => (
                <div key={k}><strong>{k}:</strong> {String(v)}</div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
