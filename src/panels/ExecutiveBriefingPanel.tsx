'use client'

/**
 * ExecutiveBriefingPanel — "Good morning" unified dashboard.
 *
 * Next meeting hero card, priority items, today's agenda timeline,
 * quick actions, auto-refresh every 5 minutes.
 */

import { useState, useEffect, useCallback } from 'react'

interface BriefingData {
  date: string
  greeting: string
  next_meeting: {
    event_id: string
    title: string
    start_time: string
    end_time: string
    attendees: string[]
    minutes_until: number | null
  } | null
  priority_items: Array<{
    type: 'email' | 'task' | 'meeting' | 'message'
    priority: string
    title: string
    from?: string
    due?: string
    time?: string
    minutes_until?: number
  }>
  events: Array<{
    event_id: string
    title: string
    start_time: string
    end_time: string
    attendees: string[]
  }>
  emails: {
    vip: number
    urgent: number
    approval: number
    fyi: number
    total_unread: number
  }
  tasks_due: number
  relay_messages?: number
  mode: string
}

export interface ExecutiveBriefingPanelProps {
  apiBase?: string
}

const PRIORITY_COLORS: Record<string, string> = {
  vip: '#8B5CF6',
  urgent: '#EF4444',
  high: '#F59E0B',
  approval: '#3B82F6',
  fyi: '#6B7280',
}

const TYPE_ICONS: Record<string, string> = {
  email: '\u2709',   // envelope
  task: '\u2611',    // checkbox
  meeting: '\u23F0', // alarm clock
  message: '\u{1F4AC}', // speech bubble
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export default function ExecutiveBriefingPanel({
  apiBase = '/api/executive',
}: ExecutiveBriefingPanelProps) {
  const [data, setData] = useState<BriefingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [prepLoading, setPrepLoading] = useState<string | null>(null)

  const fetchBriefing = useCallback(() => {
    fetch(`${apiBase}/briefing`)
      .then(r => r.json())
      .then(d => { setData(d.data || d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [apiBase])

  useEffect(() => {
    fetchBriefing()
    const interval = setInterval(fetchBriefing, 5 * 60 * 1000) // 5 min refresh
    return () => clearInterval(interval)
  }, [fetchBriefing])

  const handleMeetingPrep = async (eventId: string, title: string) => {
    setPrepLoading(eventId)
    try {
      const res = await fetch(`${apiBase}/meeting/prep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, title }),
      })
      const prep = await res.json()
      alert(
        `Meeting Prep: ${title}\n\n` +
        `Talking Points:\n${(prep.talking_points || []).map((t: string, i: number) => `${i + 1}. ${t}`).join('\n')}\n\n` +
        `Related Docs: ${(prep.related_documents || []).length}\n` +
        `Related Emails: ${(prep.related_emails || []).length}`
      )
    } catch {
      // silently fail
    }
    setPrepLoading(null)
  }

  if (loading) {
    return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', paddingTop: '20vh' }}>Loading briefing...</div>
  }

  if (!data) {
    return <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', paddingTop: '20vh' }}>Unable to load briefing.</div>
  }

  const now = new Date()
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }}>
      {/* Greeting */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: 4 }}>{data.greeting}</h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} &middot; {timeStr}
        </p>
      </div>

      {/* Next meeting hero */}
      {data.next_meeting && (
        <div style={{
          background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-primary)cc)',
          borderRadius: 'var(--radius)', padding: '20px 24px', marginBottom: 24, color: 'white',
        }}>
          <div style={{ fontSize: '0.7rem', opacity: 0.8, marginBottom: 6 }}>NEXT MEETING</div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 8 }}>{data.next_meeting.title}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: '0.8rem', opacity: 0.9 }}>
            <span>{formatTime(data.next_meeting.start_time)} - {formatTime(data.next_meeting.end_time)}</span>
            {data.next_meeting.minutes_until != null && (
              <span style={{
                background: 'rgba(255,255,255,0.2)', padding: '3px 10px', borderRadius: 12,
                fontSize: '0.75rem', fontWeight: 600,
              }}>
                {data.next_meeting.minutes_until <= 0 ? 'Now' : `in ${data.next_meeting.minutes_until}m`}
              </span>
            )}
            {data.next_meeting.attendees.length > 0 && (
              <span>{data.next_meeting.attendees.length} attendee{data.next_meeting.attendees.length > 1 ? 's' : ''}</span>
            )}
          </div>
          <button
            onClick={() => handleMeetingPrep(data.next_meeting!.event_id, data.next_meeting!.title)}
            disabled={prepLoading === data.next_meeting.event_id}
            style={{
              marginTop: 12, padding: '6px 16px', borderRadius: 'var(--radius)',
              background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)',
              color: 'white', fontSize: '0.75rem', cursor: 'pointer',
            }}
          >
            {prepLoading === data.next_meeting.event_id ? 'Preparing...' : 'Prepare'}
          </button>
        </div>
      )}

      {/* Quick stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 24 }}>
        <StatCard label="Unread" value={data.emails.total_unread} color={data.emails.urgent > 0 ? '#EF4444' : undefined} />
        <StatCard label="VIP" value={data.emails.vip} color="#8B5CF6" />
        <StatCard label="Approvals" value={data.emails.approval} color="#3B82F6" />
        <StatCard label="Tasks Due" value={data.tasks_due} color="#F59E0B" />
        {(data.relay_messages ?? 0) > 0 && <StatCard label="Messages" value={data.relay_messages!} color="#8B5CF6" />}
        <StatCard label="Meetings" value={data.events.length} />
      </div>

      {/* Priority items */}
      {data.priority_items.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 12 }}>Priority</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.priority_items.map((item, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                background: 'var(--bg-base)', borderRadius: 'var(--radius)',
                border: '1px solid var(--glass-border)',
                borderLeft: `3px solid ${PRIORITY_COLORS[item.priority] || '#888'}`,
              }}>
                <span style={{ fontSize: '1rem' }}>{TYPE_ICONS[item.type] || ''}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 500 }}>{item.title}</div>
                  {item.from && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>from {item.from}</div>}
                </div>
                <span style={{
                  fontSize: '0.6rem', padding: '2px 8px', borderRadius: 10,
                  background: PRIORITY_COLORS[item.priority] || '#888', color: 'white',
                  textTransform: 'uppercase', fontWeight: 700,
                }}>
                  {item.priority}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Today's agenda */}
      <div>
        <h2 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 12 }}>Today's Agenda</h2>
        {data.events.length === 0 ? (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: 16 }}>No meetings today.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.events.map(ev => {
              const isPast = ev.end_time && new Date(ev.end_time) < now
              return (
                <div key={ev.event_id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                  background: 'var(--bg-base)', borderRadius: 'var(--radius)',
                  border: '1px solid var(--glass-border)',
                  opacity: isPast ? 0.5 : 1,
                }}>
                  <div style={{ width: 50, fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {formatTime(ev.start_time)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 500 }}>{ev.title}</div>
                    {ev.attendees.length > 0 && (
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        {ev.attendees.slice(0, 3).join(', ')}
                        {ev.attendees.length > 3 && ` +${ev.attendees.length - 3}`}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleMeetingPrep(ev.event_id, ev.title)}
                    disabled={prepLoading === ev.event_id}
                    style={{
                      padding: '4px 10px', fontSize: '0.65rem', borderRadius: 'var(--radius)',
                      background: 'var(--bg-surface)', border: '1px solid var(--glass-border)',
                      color: 'var(--text-secondary)', cursor: 'pointer',
                    }}
                  >
                    {prepLoading === ev.event_id ? '...' : 'Prep'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{
      background: 'var(--bg-base)', border: '1px solid var(--glass-border)',
      borderRadius: 'var(--radius)', padding: '12px 14px', textAlign: 'center',
    }}>
      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</div>
      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
    </div>
  )
}
