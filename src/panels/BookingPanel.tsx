'use client'

import { useState, useEffect, useCallback } from 'react'

interface Appointment {
  appointment_id: string
  name: string
  email: string
  service_type: string
  date: string
  time: string
  status: string
  notes?: string
  created_at?: string
}

interface BookableService {
  service_id: string
  name: string
  duration_minutes: number
  price?: number
  description?: string
  active: boolean
}

interface BookingSettings {
  business_hours_start: string
  business_hours_end: string
  buffer_minutes: number
  advance_booking_days: number
  timezone: string
  auto_confirm: boolean
}

type TabMode = 'appointments' | 'services' | 'settings'

export interface BookingPanelProps {
  apiBase?: string
}

export default function BookingPanel({ apiBase = '/api/booking' }: BookingPanelProps) {
  const [tab, setTab] = useState<TabMode>('appointments')
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [services, setServices] = useState<BookableService[]>([])
  const [settings, setSettings] = useState<BookingSettings | null>(null)
  const [loading, setLoading] = useState(true)

  // Appointment filter
  const [filterDate, setFilterDate] = useState('')

  // Create service form
  const [showCreateService, setShowCreateService] = useState(false)
  const [newServiceName, setNewServiceName] = useState('')
  const [newServiceDuration, setNewServiceDuration] = useState('30')
  const [newServicePrice, setNewServicePrice] = useState('')
  const [newServiceDescription, setNewServiceDescription] = useState('')

  // Settings form
  const [editSettings, setEditSettings] = useState<BookingSettings | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = filterDate ? `?date_from=${filterDate}&date_to=${filterDate}` : ''
      const [apptRes, svcRes, settingsRes] = await Promise.all([
        fetch(`${apiBase}/appointments${params}`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/services`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/settings`).then(r => r.ok ? r.json() : null),
      ])

      if (apptRes?.data?.appointments) {
        setAppointments(apptRes.data.appointments)
      } else if (Array.isArray(apptRes?.data)) {
        setAppointments(apptRes.data)
      }
      if (svcRes?.data?.services) {
        setServices(svcRes.data.services)
      } else if (Array.isArray(svcRes?.data)) {
        setServices(svcRes.data)
      }
      if (settingsRes?.data) {
        const s = settingsRes.data
        setSettings(s)
        setEditSettings(s)
      }
    } catch (e) {
      console.error('Booking fetch error:', e)
    }
    setLoading(false)
  }, [apiBase, filterDate])

  useEffect(() => { fetchData() }, [fetchData])

  const handleUpdateStatus = async (id: string, status: string) => {
    try {
      const resp = await fetch(`${apiBase}/appointments/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (resp.ok) fetchData()
    } catch (e) {
      console.error('Update appointment error:', e)
    }
  }

  const handleCreateService = async () => {
    if (!newServiceName || !newServiceDuration) return
    try {
      const payload: any = {
        name: newServiceName,
        duration_minutes: parseInt(newServiceDuration, 10),
        description: newServiceDescription,
      }
      if (newServicePrice) {
        payload.price = parseFloat(newServicePrice)
      }
      const resp = await fetch(`${apiBase}/services`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (resp.ok) {
        setShowCreateService(false)
        setNewServiceName('')
        setNewServiceDuration('30')
        setNewServicePrice('')
        setNewServiceDescription('')
        fetchData()
      }
    } catch (e) {
      console.error('Create service error:', e)
    }
  }

  const handleSaveSettings = async () => {
    if (!editSettings) return
    try {
      const resp = await fetch(`${apiBase}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editSettings),
      })
      if (resp.ok) fetchData()
    } catch (e) {
      console.error('Save settings error:', e)
    }
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return { bg: 'rgba(0,200,83,0.15)', color: '#00c853' }
      case 'pending': return { bg: 'rgba(255,183,77,0.15)', color: '#ffb74d' }
      case 'cancelled': return { bg: 'rgba(244,67,54,0.15)', color: '#f44336' }
      case 'rescheduled': return { bg: 'rgba(124,58,237,0.15)', color: '#7c3aed' }
      default: return { bg: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' }
    }
  }

  const formatDate = (d: string) => {
    try {
      return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    } catch { return d }
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading booking...
      </div>
    )
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Booking</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['appointments', 'services', 'settings'] as TabMode[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)',
                background: tab === t ? 'var(--accent)' : 'transparent',
                color: tab === t ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer', fontSize: '0.8rem', textTransform: 'capitalize',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Appointments Tab */}
      {tab === 'appointments' && (
        <div>
          {/* Date Filter */}
          <div style={{ marginBottom: '1rem', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="date"
              value={filterDate}
              onChange={e => setFilterDate(e.target.value)}
              style={{
                padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'var(--bg-deep)', color: 'var(--text)', fontSize: '0.8rem',
              }}
            />
            {filterDate && (
              <button
                onClick={() => setFilterDate('')}
                style={{
                  padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                  fontSize: '0.75rem',
                }}
              >
                Clear
              </button>
            )}
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {appointments.length} appointment{appointments.length !== 1 ? 's' : ''}
            </span>
          </div>

          {appointments.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
              No appointments found.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {appointments.map(appt => {
              const sc = statusColor(appt.status)
              return (
                <div
                  key={appt.appointment_id}
                  style={{
                    padding: '12px 16px', borderRadius: 8, background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontWeight: 500 }}>{appt.name}</span>
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600,
                        background: sc.bg, color: sc.color,
                      }}>
                        {appt.status}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {appt.service_type} | {formatDate(appt.date)} at {appt.time} | {appt.email}
                    </div>
                    {appt.notes && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
                        {appt.notes}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {appt.status === 'pending' && (
                      <button
                        onClick={() => handleUpdateStatus(appt.appointment_id, 'confirmed')}
                        style={{
                          padding: '4px 10px', borderRadius: 4, border: 'none',
                          background: 'rgba(0,200,83,0.2)', color: '#00c853',
                          cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600,
                        }}
                      >
                        Confirm
                      </button>
                    )}
                    {appt.status !== 'cancelled' && (
                      <button
                        onClick={() => handleUpdateStatus(appt.appointment_id, 'cancelled')}
                        style={{
                          padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)',
                          background: 'transparent', color: 'var(--text-muted)',
                          cursor: 'pointer', fontSize: '0.7rem',
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Services Tab */}
      {tab === 'services' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button
              onClick={() => setShowCreateService(!showCreateService)}
              style={{
                padding: '6px 14px', borderRadius: 6, border: 'none',
                background: 'var(--accent)', color: '#fff', cursor: 'pointer',
                fontSize: '0.8rem', fontWeight: 600,
              }}
            >
              + New Service
            </button>
          </div>

          {/* Create Service Form */}
          {showCreateService && (
            <div style={{
              padding: '1rem', borderRadius: 8, background: 'var(--bg-elevated)',
              border: '1px solid var(--border)', marginBottom: '1rem',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <input
                  value={newServiceName} onChange={e => setNewServiceName(e.target.value)}
                  placeholder="Service name"
                  style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)', gridColumn: '1 / -1' }}
                />
                <input
                  type="number" value={newServiceDuration} onChange={e => setNewServiceDuration(e.target.value)}
                  placeholder="Duration (minutes)"
                  style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)' }}
                />
                <input
                  type="number" value={newServicePrice} onChange={e => setNewServicePrice(e.target.value)}
                  placeholder="Price (optional)"
                  step="0.01"
                  style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)' }}
                />
                <textarea
                  value={newServiceDescription} onChange={e => setNewServiceDescription(e.target.value)}
                  placeholder="Description (optional)"
                  rows={2}
                  style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)', gridColumn: '1 / -1', resize: 'vertical' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowCreateService(false)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={handleCreateService} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                  Create Service
                </button>
              </div>
            </div>
          )}

          {services.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
              No services defined. Create your first bookable service above.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {services.map(svc => (
              <div
                key={svc.service_id}
                style={{
                  padding: '16px', borderRadius: 8, background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{svc.name}</div>
                  {!svc.active && (
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: '0.65rem',
                      background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)',
                    }}>
                      Inactive
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                  {svc.duration_minutes} min
                  {svc.price != null && svc.price > 0 && ` | $${svc.price.toFixed(2)}`}
                </div>
                {svc.description && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {svc.description}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Settings Tab */}
      {tab === 'settings' && editSettings && (
        <div style={{
          padding: '1.5rem', borderRadius: 8, background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
        }}>
          <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>Booking Settings</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Business Hours Start</span>
              <input
                type="time"
                value={editSettings.business_hours_start || '09:00'}
                onChange={e => setEditSettings({ ...editSettings, business_hours_start: e.target.value })}
                style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Business Hours End</span>
              <input
                type="time"
                value={editSettings.business_hours_end || '17:00'}
                onChange={e => setEditSettings({ ...editSettings, business_hours_end: e.target.value })}
                style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Buffer Between Appointments (min)</span>
              <input
                type="number"
                value={editSettings.buffer_minutes ?? 15}
                onChange={e => setEditSettings({ ...editSettings, buffer_minutes: parseInt(e.target.value, 10) })}
                style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Advance Booking (days)</span>
              <input
                type="number"
                value={editSettings.advance_booking_days ?? 30}
                onChange={e => setEditSettings({ ...editSettings, advance_booking_days: parseInt(e.target.value, 10) })}
                style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Timezone</span>
              <input
                value={editSettings.timezone || 'America/Los_Angeles'}
                onChange={e => setEditSettings({ ...editSettings, timezone: e.target.value })}
                style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)' }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
              <input
                type="checkbox"
                checked={editSettings.auto_confirm ?? false}
                onChange={e => setEditSettings({ ...editSettings, auto_confirm: e.target.checked })}
              />
              <span style={{ fontSize: '0.8rem', color: 'var(--text)' }}>Auto-confirm appointments</span>
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
            <button
              onClick={handleSaveSettings}
              style={{
                padding: '8px 20px', borderRadius: 6, border: 'none',
                background: 'var(--accent)', color: '#fff', cursor: 'pointer',
                fontSize: '0.85rem', fontWeight: 600,
              }}
            >
              Save Settings
            </button>
          </div>
        </div>
      )}

      {tab === 'settings' && !editSettings && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
          Could not load booking settings.
        </div>
      )}
    </div>
  )
}
