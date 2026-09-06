'use client'

/**
 * MarketingCalendarPanel — Visual calendar grid for scheduling posts across platforms.
 *
 * Month view with color-coded platform badges per day,
 * click to see/edit posts, quick stats header, inline composer trigger.
 */

import { useState, useEffect, useMemo } from 'react'

interface ScheduledPost {
  id: string
  text: string
  platforms: string[]
  schedule_time: string
  status: string
}

export interface MarketingCalendarPanelProps {
  apiBase?: string
}

const PLATFORM_COLORS: Record<string, string> = {
  bluesky: '#0085FF',
  linkedin: '#0A66C2',
  email: '#10B981',
  twitter: '#1DA1F2',
  facebook: '#1877F2',
  instagram: '#E4405F',
  threads: '#666',
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfWeek(year: number, month: number) {
  const day = new Date(year, month, 1).getDay()
  return day === 0 ? 6 : day - 1 // Monday = 0
}

export default function MarketingCalendarPanel({
  apiBase = '/api/social',
}: MarketingCalendarPanelProps) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [posts, setPosts] = useState<ScheduledPost[]>([])
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`${apiBase}/posts/scheduled`)
      .then(r => r.json())
      .then(d => { setPosts(Array.isArray(d) ? d : d.data || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [apiBase])

  const postsByDay = useMemo(() => {
    const map: Record<number, ScheduledPost[]> = {}
    for (const post of posts) {
      const d = new Date(post.schedule_time)
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate()
        if (!map[day]) map[day] = []
        map[day].push(post)
      }
    }
    return map
  }, [posts, year, month])

  const totalThisMonth = Object.values(postsByDay).reduce((s, p) => s + p.length, 0)
  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfWeek(year, month)
  const monthName = new Date(year, month).toLocaleString('default', { month: 'long' })

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
    setSelectedDay(null)
  }
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
    setSelectedDay(null)
  }

  const selectedPosts = selectedDay ? postsByDay[selectedDay] || [] : []

  return (
    <div style={{ padding: 32, maxWidth: 1000, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600 }}>Marketing Calendar</h1>
        <div style={{ display: 'flex', gap: 12, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <span>{totalThisMonth} posts this month</span>
        </div>
      </div>

      {/* Month navigation */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <button onClick={prevMonth} style={navBtnStyle}>&larr;</button>
        <span style={{ fontSize: '1.1rem', fontWeight: 500 }}>{monthName} {year}</span>
        <button onClick={nextMonth} style={navBtnStyle}>&rarr;</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Loading...</div>
      ) : (
        <>
          {/* Calendar grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: 'var(--glass-border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            {WEEKDAYS.map(d => (
              <div key={d} style={{ background: 'var(--bg-elevated)', padding: '8px 4px', textAlign: 'center', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)' }}>{d}</div>
            ))}
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`pad-${i}`} style={{ background: 'var(--bg-base)', padding: 12, minHeight: 80 }} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1
              const dayPosts = postsByDay[day] || []
              const isToday = day === now.getDate() && month === now.getMonth() && year === now.getFullYear()
              const isSelected = day === selectedDay
              return (
                <div
                  key={day}
                  onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                  style={{
                    background: isSelected ? 'var(--bg-elevated)' : 'var(--bg-base)',
                    padding: '8px 6px', minHeight: 80, cursor: 'pointer',
                    borderLeft: isToday ? '3px solid var(--accent-primary)' : 'none',
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', fontWeight: isToday ? 700 : 400, marginBottom: 4, color: isToday ? 'var(--accent-primary)' : 'var(--text-primary)' }}>{day}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {dayPosts.map((p, j) => (
                      <div key={j} style={{ display: 'flex', gap: 2 }}>
                        {(p.platforms || []).map(plat => (
                          <div key={plat} style={{
                            width: 8, height: 8, borderRadius: '50%',
                            background: PLATFORM_COLORS[plat] || '#888',
                          }} title={plat} />
                        ))}
                      </div>
                    ))}
                  </div>
                  {dayPosts.length > 0 && (
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 4 }}>
                      {dayPosts.length} post{dayPosts.length > 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Platform legend */}
          <div style={{ display: 'flex', gap: 16, marginTop: 12, justifyContent: 'center' }}>
            {Object.entries(PLATFORM_COLORS).slice(0, 3).map(([name, color]) => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
                {name.charAt(0).toUpperCase() + name.slice(1)}
              </div>
            ))}
          </div>

          {/* Selected day detail */}
          {selectedDay !== null && (
            <div style={{ marginTop: 20, background: 'var(--bg-elevated)', borderRadius: 'var(--radius)', padding: 16, border: '1px solid var(--glass-border)' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 12 }}>
                {monthName} {selectedDay} — {selectedPosts.length} scheduled post{selectedPosts.length !== 1 ? 's' : ''}
              </h3>
              {selectedPosts.length === 0 ? (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No posts scheduled for this day.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {selectedPosts.map(p => (
                    <div key={p.id} style={{ padding: '10px 12px', background: 'var(--bg-base)', borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)' }}>
                      <p style={{ fontSize: '0.8rem', marginBottom: 6, lineHeight: 1.5 }}>{p.text}</p>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {(p.platforms || []).map(plat => (
                          <span key={plat} style={{
                            fontSize: '0.65rem', padding: '2px 8px', borderRadius: 10,
                            background: PLATFORM_COLORS[plat] || '#888', color: 'white',
                          }}>{plat}</span>
                        ))}
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                          {new Date(p.schedule_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

const navBtnStyle: React.CSSProperties = {
  padding: '6px 14px', background: 'var(--bg-surface)',
  border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)',
  color: 'var(--text-secondary)', fontSize: '0.85rem', cursor: 'pointer',
}
