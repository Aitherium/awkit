'use client'

import React, { useEffect, useState, useCallback } from 'react'

interface EmailSummary {
  total: number
  unread: number
  categories: Record<string, number>
  action_required: Array<{ subject: string; from: string }>
}

interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  location?: string
}

interface RoutineStatus {
  id: string
  name: string
  enabled: boolean
  last_run?: string
  status?: string
}

interface IntegrationHealth {
  id: string
  name: string
  connected: boolean
  status: string
}

export interface PersonalAutomationPanelProps {
  apiBase?: string
}

export default function PersonalAutomationPanel({
  apiBase = '/api/personal',
}: PersonalAutomationPanelProps) {
  const [emailSummary, setEmailSummary] = useState<EmailSummary | null>(null)
  const [calendar, setCalendar] = useState<CalendarEvent[]>([])
  const [routines, setRoutines] = useState<RoutineStatus[]>([])
  const [integrations, setIntegrations] = useState<IntegrationHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [actionResult, setActionResult] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [emailRes, calRes, routineRes, intRes] = await Promise.allSettled([
        fetch(`${apiBase}/email-summary`).then(r => r.json()),
        fetch(`${apiBase}/calendar-today`).then(r => r.json()),
        fetch(`${apiBase}/routines`).then(r => r.json()),
        fetch(`${apiBase}/integrations`).then(r => r.json()),
      ])
      if (emailRes.status === 'fulfilled') setEmailSummary(emailRes.value)
      if (calRes.status === 'fulfilled') setCalendar(calRes.value.events || [])
      if (routineRes.status === 'fulfilled') setRoutines(routineRes.value.routines || [])
      if (intRes.status === 'fulfilled') setIntegrations(intRes.value.integrations || [])
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const quickAction = async (action: string) => {
    setActionResult(null)
    try {
      const resp = await fetch(`${apiBase}/action/${action}`, { method: 'POST' })
      const data = await resp.json()
      setActionResult(data.message || data.status || 'Done')
      fetchData()
    } catch (e) {
      setActionResult(`Error: ${e}`)
    }
  }

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-elevated, #1a1a2e)',
    border: '1px solid var(--border, #333)',
    borderRadius: '8px',
    padding: '16px',
  }

  const headingStyle: React.CSSProperties = {
    fontSize: '14px',
    fontWeight: 600,
    marginBottom: '12px',
    color: 'var(--fg, #e0e0e0)',
  }

  const badgeStyle = (color: string): React.CSSProperties => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 500,
    background: `${color}20`,
    color,
  })

  if (loading) {
    return (
      <div style={{ padding: '24px', color: 'var(--fg-muted, #888)' }}>
        Loading personal automation data...
      </div>
    )
  }

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Quick Actions */}
      <div style={cardStyle}>
        <div style={headingStyle}>Quick Actions</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {[
            { label: 'Sort Inbox', action: 'sort-inbox', color: '#4fc3f7' },
            { label: "Today's Schedule", action: 'today-schedule', color: '#81c784' },
            { label: 'Morning Briefing', action: 'morning-briefing', color: '#ffb74d' },
          ].map(btn => (
            <button
              key={btn.action}
              onClick={() => quickAction(btn.action)}
              style={{
                background: `${btn.color}15`,
                border: `1px solid ${btn.color}40`,
                color: btn.color,
                borderRadius: '6px',
                padding: '8px 16px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 500,
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>
        {actionResult && (
          <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--fg-muted, #aaa)' }}>
            {actionResult}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Email Summary */}
        <div style={cardStyle}>
          <div style={headingStyle}>Email</div>
          {emailSummary ? (
            <>
              <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
                <div>
                  <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--fg, #fff)' }}>
                    {emailSummary.unread}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--fg-muted, #888)' }}>Unread</div>
                </div>
                <div>
                  <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--fg, #fff)' }}>
                    {emailSummary.total}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--fg-muted, #888)' }}>Total</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                {Object.entries(emailSummary.categories || {}).map(([cat, count]) => (
                  <span key={cat} style={badgeStyle('#90caf9')}>
                    {cat}: {count}
                  </span>
                ))}
              </div>
              {emailSummary.action_required?.length > 0 && (
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#ef5350', marginBottom: '4px' }}>
                    Action Required
                  </div>
                  {emailSummary.action_required.slice(0, 3).map((item, i) => (
                    <div key={i} style={{ fontSize: '12px', color: 'var(--fg-muted, #aaa)', marginBottom: '2px' }}>
                      {item.subject}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div style={{ color: 'var(--fg-muted, #666)', fontSize: '13px' }}>
              No email data — connect an email account in Integrations
            </div>
          )}
        </div>

        {/* Calendar Today */}
        <div style={cardStyle}>
          <div style={headingStyle}>Today's Schedule</div>
          {calendar.length > 0 ? (
            calendar.slice(0, 6).map(ev => (
              <div key={ev.id} style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--fg, #e0e0e0)' }}>
                  {ev.title}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--fg-muted, #888)' }}>
                  {ev.start} - {ev.end}
                  {ev.location && ` | ${ev.location}`}
                </div>
              </div>
            ))
          ) : (
            <div style={{ color: 'var(--fg-muted, #666)', fontSize: '13px' }}>
              No events today
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Routines */}
        <div style={cardStyle}>
          <div style={headingStyle}>Personal Routines</div>
          {routines.length > 0 ? (
            routines.map(r => (
              <div
                key={r.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px',
                  fontSize: '13px',
                }}
              >
                <span style={{ color: 'var(--fg, #e0e0e0)' }}>{r.name}</span>
                <span style={badgeStyle(r.enabled ? '#81c784' : '#666')}>
                  {r.enabled ? (r.status || 'active') : 'disabled'}
                </span>
              </div>
            ))
          ) : (
            <div style={{ color: 'var(--fg-muted, #666)', fontSize: '13px' }}>
              No personal routines configured
            </div>
          )}
        </div>

        {/* Integration Health */}
        <div style={cardStyle}>
          <div style={headingStyle}>Connected Services</div>
          {integrations.length > 0 ? (
            integrations.map(int_ => (
              <div
                key={int_.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px',
                  fontSize: '13px',
                }}
              >
                <span style={{ color: 'var(--fg, #e0e0e0)' }}>{int_.name}</span>
                <span style={badgeStyle(int_.connected ? '#81c784' : '#ef5350')}>
                  {int_.connected ? 'connected' : 'disconnected'}
                </span>
              </div>
            ))
          ) : (
            <div style={{ color: 'var(--fg-muted, #666)', fontSize: '13px' }}>
              No integrations connected
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
