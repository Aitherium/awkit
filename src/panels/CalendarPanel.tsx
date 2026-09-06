'use client'

import { useState, useEffect, useCallback } from 'react'

interface CalendarEvent {
  event_id: string
  title: string
  start_time: string
  end_time: string
  description?: string
  location?: string
  attendees?: string[]
  status?: string
  recurrence?: string
}

interface AgendaDay {
  date: string
  dayName: string
  events: CalendarEvent[]
}

type ViewMode = 'agenda' | 'month' | 'week'

export interface CalendarPanelProps {
  apiBase?: string
}

export default function CalendarPanel({ apiBase = '/api/calendar' }: CalendarPanelProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [agendaDays, setAgendaDays] = useState<AgendaDay[]>([])
  const [view, setView] = useState<ViewMode>('agenda')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [syncStatus, setSyncStatus] = useState<any>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  // AI scheduling
  const [showAISchedule, setShowAISchedule] = useState(false)
  const [aiDescription, setAIDescription] = useState('')
  const [aiDuration, setAIDuration] = useState('30')
  const [aiDate, setAIDate] = useState('')
  const [aiLoading, setAILoading] = useState(false)

  // Form state (shared by create + edit)
  const [newTitle, setNewTitle] = useState('')
  const [newDate, setNewDate] = useState('')
  const [newStartTime, setNewStartTime] = useState('09:00')
  const [newEndTime, setNewEndTime] = useState('10:00')
  const [newDescription, setNewDescription] = useState('')
  const [newAttendees, setNewAttendees] = useState('')

  const resetForm = useCallback(() => {
    setNewTitle(''); setNewDate(''); setNewStartTime('09:00'); setNewEndTime('10:00')
    setNewDescription(''); setNewAttendees(''); setEditingId(null)
  }, [])

  const openCreate = useCallback((dateStr?: string) => {
    resetForm()
    if (dateStr) setNewDate(dateStr)
    setShowCreate(true)
  }, [resetForm])

  const openEdit = useCallback((evt: CalendarEvent) => {
    setEditingId(evt.event_id)
    setNewTitle(evt.title || '')
    const s = evt.start_time || ''
    const e = evt.end_time || ''
    setNewDate(s.slice(0, 10))
    setNewStartTime(s.slice(11, 16) || '09:00')
    setNewEndTime(e.slice(11, 16) || '10:00')
    setNewDescription(evt.description || '')
    setNewAttendees((evt.attendees || []).join(', '))
    setShowCreate(true)
  }, [])

  const closeModal = useCallback(() => { setShowCreate(false); resetForm() }, [resetForm])

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    try {
      const [eventsRes, agendaRes, syncRes] = await Promise.all([
        fetch(`${apiBase}/events`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/agenda?days=14`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/sync/status`).then(r => r.ok ? r.json() : null),
      ])

      if (eventsRes?.data?.events) {
        setEvents(eventsRes.data.events)
      }
      if (agendaRes?.data?.days) {
        const days: AgendaDay[] = Object.entries(agendaRes.data.days as Record<string, any[]>).map(
          ([date, dayEvents]) => ({
            date,
            dayName: new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }),
            events: dayEvents as CalendarEvent[],
          })
        )
        days.sort((a, b) => a.date.localeCompare(b.date))
        setAgendaDays(days)
      }
      if (syncRes?.data) {
        setSyncStatus(syncRes.data)
      }
    } catch (e) {
      console.error('Calendar fetch error:', e)
    }
    setLoading(false)
  }, [apiBase])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  const handleSave = async () => {
    if (!newTitle || !newDate) return
    const startTime = `${newDate}T${newStartTime}:00Z`
    const endTime = `${newDate}T${newEndTime}:00Z`
    const body = {
      title: newTitle,
      start_time: startTime,
      end_time: endTime,
      description: newDescription,
      attendees: newAttendees ? newAttendees.split(',').map(s => s.trim()).filter(Boolean) : [],
    }
    try {
      const url = editingId ? `${apiBase}/events/${editingId}` : `${apiBase}/events`
      const method = editingId ? 'PUT' : 'POST'
      const resp = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (resp.ok) {
        closeModal()
        fetchEvents()
      }
    } catch (e) {
      console.error('Save event error:', e)
    }
  }

  const handleDelete = async (eventId: string) => {
    if (!window.confirm('Delete this event?')) return
    try {
      await fetch(`${apiBase}/events/${eventId}`, { method: 'DELETE' })
      if (editingId === eventId) closeModal()
      fetchEvents()
    } catch (e) {
      console.error('Delete event error:', e)
    }
  }

  const handleAISchedule = async () => {
    if (!aiDescription) return
    setAILoading(true)
    try {
      const resp = await fetch(`${apiBase}/ai-schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: aiDescription,
          duration_minutes: parseInt(aiDuration, 10) || 30,
          preferred_date: aiDate || undefined,
        }),
      })
      if (resp.ok) {
        setShowAISchedule(false)
        setAIDescription('')
        setAIDuration('30')
        setAIDate('')
        fetchEvents()
      }
    } catch (e) {
      console.error('AI schedule error:', e)
    }
    setAILoading(false)
  }

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    } catch { return iso }
  }

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    } catch { return iso }
  }

  const formatDayLabel = (dateStr: string) => {
    try {
      const d = new Date(dateStr + 'T12:00:00')
      return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    } catch { return dateStr }
  }

  const eventsForDate = (dateStr: string) =>
    events.filter(e => e.start_time.startsWith(dateStr) && e.status !== 'cancelled')

  const handleDayClick = (dateStr: string) => {
    if (selectedDate === dateStr) {
      setSelectedDate(null)
    } else {
      setSelectedDate(dateStr)
      setShowCreate(false)
    }
  }

  const todayStr = (() => {
    const n = new Date()
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
  })()

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading calendar...
      </div>
    )
  }

  /* ── Shared sub-components ── */

  const eventCard = (evt: CalendarEvent) => (
    <div
      key={evt.event_id}
      onClick={() => openEdit(evt)}
      title="Click to edit"
      style={{
        padding: '10px 14px', borderRadius: 8, background: 'var(--bg-elevated)',
        border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', cursor: 'pointer',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500 }}>{evt.title}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {formatTime(evt.start_time)} – {formatTime(evt.end_time)}
          {evt.location && ` · ${evt.location}`}
          {evt.attendees && evt.attendees.length > 0 && ` · ${evt.attendees.length} attendee${evt.attendees.length > 1 ? 's' : ''}`}
        </div>
        {evt.description && (
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4, opacity: 0.8 }}>
            {evt.description.length > 100 ? evt.description.slice(0, 100) + '...' : evt.description}
          </div>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); handleDelete(evt.event_id) }}
        style={{
          padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)',
          background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
          fontSize: '0.7rem', flexShrink: 0, marginLeft: 8,
        }}
      >
        Delete
      </button>
    </div>
  )

  const selectedDayPanel = selectedDate && (view === 'month' || view === 'week') && (
    <div style={{
      marginTop: '1rem', padding: '1rem', borderRadius: 8,
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
          {formatDayLabel(selectedDate)}
          {selectedDate === todayStr && (
            <span style={{ marginLeft: 8, fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 400 }}>Today</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => openCreate(selectedDate)}
            style={{
              padding: '4px 12px', borderRadius: 6, border: 'none',
              background: 'var(--accent)', color: '#fff', cursor: 'pointer',
              fontSize: '0.75rem', fontWeight: 600,
            }}
          >
            + Add event
          </button>
          <button
            onClick={() => setSelectedDate(null)}
            style={{
              padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem',
            }}
          >
            Close
          </button>
        </div>
      </div>
      {eventsForDate(selectedDate).length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic', padding: '0.5rem 0' }}>
          No events on this day.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {eventsForDate(selectedDate).map(eventCard)}
        </div>
      )}
    </div>
  )

  return (
    <div style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Calendar</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['agenda', 'week', 'month'] as ViewMode[]).map(v => (
            <button
              key={v}
              onClick={() => { setView(v); setSelectedDate(null) }}
              style={{
                padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)',
                background: view === v ? 'var(--accent)' : 'transparent',
                color: view === v ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer', fontSize: '0.8rem', textTransform: 'capitalize',
              }}
            >
              {v}
            </button>
          ))}
          <button
            onClick={() => { setShowAISchedule(!showAISchedule); if (showCreate) closeModal() }}
            style={{
              padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)',
              background: showAISchedule ? 'var(--accent)' : 'transparent',
              color: showAISchedule ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer', fontSize: '0.8rem',
            }}
          >
            AI Schedule
          </button>
          <button
            onClick={() => { showCreate ? closeModal() : openCreate(); setShowAISchedule(false) }}
            style={{
              padding: '6px 14px', borderRadius: 6, border: 'none',
              background: 'var(--accent)', color: '#fff', cursor: 'pointer',
              fontSize: '0.8rem', fontWeight: 600,
            }}
          >
            + New Event
          </button>
        </div>
      </div>

      {/* Sync Status */}
      {syncStatus && (
        <div style={{
          padding: '8px 12px', borderRadius: 6, background: 'var(--bg-elevated)',
          marginBottom: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)',
          display: 'flex', gap: 12, alignItems: 'center',
        }}>
          <span>{events.length} events</span>
          {syncStatus.providers?.map((p: any) => (
            <span key={p.name} style={{
              padding: '2px 8px', borderRadius: 4,
              background: p.status === 'connected' ? 'rgba(0,200,83,0.15)' : 'rgba(255,255,255,0.05)',
              color: p.status === 'connected' ? '#00c853' : 'var(--text-muted)',
            }}>
              {p.name}: {p.status}
            </span>
          ))}
        </div>
      )}

      {/* AI Scheduling */}
      {showAISchedule && (
        <div style={{
          padding: '1rem', borderRadius: 8, background: 'var(--bg-elevated)',
          border: '1px solid var(--border)', marginBottom: '1rem',
        }}>
          <div style={{ marginBottom: 8, fontSize: '0.85rem', fontWeight: 600 }}>
            AI Schedule
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 12 }}>
            Describe what you need to schedule and the AI will find the best available slot.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <input
              value={aiDescription} onChange={e => setAIDescription(e.target.value)}
              placeholder="e.g. Team standup, 15 min"
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)', gridColumn: '1 / -1' }}
            />
            <input
              type="number" value={aiDuration} onChange={e => setAIDuration(e.target.value)}
              placeholder="Duration (minutes)"
              min="5" step="5"
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)' }}
            />
            <input
              type="date" value={aiDate} onChange={e => setAIDate(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowAISchedule(false)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={handleAISchedule} disabled={aiLoading || !aiDescription} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontWeight: 600, opacity: aiLoading || !aiDescription ? 0.5 : 1 }}>
              {aiLoading ? 'Finding slot...' : 'Find Best Slot'}
            </button>
          </div>
        </div>
      )}

      {/* Create / Edit Event Modal */}
      {showCreate && (
        <div style={{
          padding: '1rem', borderRadius: 8, background: 'var(--bg-elevated)',
          border: '1px solid var(--border)', marginBottom: '1rem',
        }}>
          <div style={{ marginBottom: 8, fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>
            {editingId ? 'Edit event' : 'New event'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <input
              value={newTitle} onChange={e => setNewTitle(e.target.value)}
              placeholder="Event title"
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)', gridColumn: '1 / -1' }}
            />
            <input
              type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="time" value={newStartTime} onChange={e => setNewStartTime(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)', flex: 1 }}
              />
              <input
                type="time" value={newEndTime} onChange={e => setNewEndTime(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)', flex: 1 }}
              />
            </div>
            <textarea
              value={newDescription} onChange={e => setNewDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)', gridColumn: '1 / -1', resize: 'vertical' }}
            />
            <input
              value={newAttendees} onChange={e => setNewAttendees(e.target.value)}
              placeholder="Attendees (comma-separated emails)"
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)', gridColumn: '1 / -1' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              {editingId && (
                <button
                  onClick={() => handleDelete(editingId)}
                  style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: '#ff6b6b', cursor: 'pointer' }}
                >
                  Delete
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={closeModal} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleSave} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                {editingId ? 'Save changes' : 'Create Event'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Agenda View */}
      {view === 'agenda' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {agendaDays.length === 0 && events.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
              No events scheduled. Create your first event above.
            </div>
          )}
          {agendaDays.map(day => (
            <div key={day.date}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8, color: 'var(--text-muted)' }}>
                {day.dayName}, {formatDate(day.date + 'T12:00:00')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {day.events.map(eventCard)}
              </div>
            </div>
          ))}
          {/* Show ungrouped events if agenda didn't cover them */}
          {agendaDays.length === 0 && events.length > 0 && (
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8, color: 'var(--text-muted)' }}>
                All Events
              </div>
              {events.filter(e => e.status !== 'cancelled').map(eventCard)}
            </div>
          )}
        </div>
      )}

      {/* Week View */}
      {view === 'week' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', padding: 8 }}>
                {d}
              </div>
            ))}
            {(() => {
              const now = new Date()
              const monday = new Date(now)
              monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
              return Array.from({ length: 7 }, (_, i) => {
                const day = new Date(monday)
                day.setDate(monday.getDate() + i)
                const dateStr = day.toISOString().split('T')[0]
                const dayEvents = eventsForDate(dateStr)
                const isToday = dateStr === todayStr
                const isSelected = dateStr === selectedDate
                return (
                  <div
                    key={dateStr}
                    onClick={() => handleDayClick(dateStr)}
                    style={{
                      padding: 8, borderRadius: 6, minHeight: 80, cursor: 'pointer',
                      background: isSelected ? 'rgba(124,58,237,0.18)' : isToday ? 'rgba(124,58,237,0.08)' : 'var(--bg-elevated)',
                      border: isSelected ? '2px solid var(--accent)' : isToday ? '1px solid var(--accent)' : '1px solid var(--border)',
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 4, color: isToday || isSelected ? 'var(--accent)' : 'var(--text-muted)' }}>
                      {day.getDate()}
                    </div>
                    {dayEvents.map(e => (
                      <div key={e.event_id}
                        onClick={(ev) => { ev.stopPropagation(); openEdit(e) }}
                        title={`${e.title} — click to edit`}
                        style={{
                          fontSize: '0.65rem', padding: '2px 4px', borderRadius: 3,
                          background: 'var(--accent)', color: '#fff', marginBottom: 2, cursor: 'pointer',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                        {e.title}
                      </div>
                    ))}
                  </div>
                )
              })
            })()}
          </div>
          {selectedDayPanel}
        </>
      )}

      {/* Month View */}
      {view === 'month' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', padding: 4 }}>
                {d}
              </div>
            ))}
            {(() => {
              const now = new Date()
              const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
              const startOffset = (firstDay.getDay() + 6) % 7
              const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
              const cells: React.ReactElement[] = []

              for (let i = 0; i < startOffset; i++) {
                cells.push(<div key={`pad-${i}`} style={{ padding: 4 }} />)
              }
              for (let d = 1; d <= daysInMonth; d++) {
                const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
                const dayEvents = eventsForDate(dateStr)
                const isToday = d === now.getDate()
                const isSelected = dateStr === selectedDate
                const hasEvents = dayEvents.length > 0
                cells.push(
                  <div key={d}
                    onClick={() => handleDayClick(dateStr)}
                    title={hasEvents ? `${dayEvents.length} event(s) — click to view` : 'Click to select'}
                    style={{
                      padding: 4, borderRadius: 4, minHeight: 44, fontSize: '0.7rem', cursor: 'pointer',
                      background: isSelected ? 'rgba(124,58,237,0.2)' : isToday ? 'rgba(124,58,237,0.1)' : 'transparent',
                      border: isSelected ? '2px solid var(--accent)' : isToday ? '1px solid var(--accent)' : '1px solid transparent',
                      transition: 'background 0.12s, border 0.12s',
                    }}>
                    <div style={{
                      fontWeight: isToday || isSelected ? 700 : 400,
                      color: isToday || isSelected ? 'var(--accent)' : hasEvents ? 'var(--text)' : 'var(--text-muted)',
                    }}>
                      {d}
                    </div>
                    {hasEvents && (
                      <div style={{
                        marginTop: 2, fontSize: '0.6rem', color: 'var(--accent)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {dayEvents.length === 1 ? dayEvents[0].title : `${dayEvents.length} events`}
                      </div>
                    )}
                  </div>
                )
              }
              return cells
            })()}
          </div>
          {selectedDayPanel}
        </>
      )}
    </div>
  )
}
