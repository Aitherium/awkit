'use client'

import { useState, useEffect, useCallback } from 'react'
import PeopleStaffNotes from './PeopleStaffNotes'

interface WorkspaceUser {
  id: string
  username: string
  email: string
  role: string
  display_name: string
  last_active: string
}

interface StaffMember {
  id: string
  name: string
  title: string
  location: string
  school?: string
  degree?: string
  certifications: string[]
  specialties: string[]
  firms: string[]
  years_experience: number | null
  source_doc_id: string | null
  email?: string
  phone?: string
}

interface PeopleData {
  workspace_users: WorkspaceUser[]
  company_staff: StaffMember[]
  counts: { workspace_users: number; company_staff: number }
  /** Set when the member list could not be loaded: say so, never "nobody". */
  workspace_users_error?: string | null
}

export interface PeoplePanelProps {
  apiBase?: string
}

function getInitials(name: string): string {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

const CERT_COLORS: Record<string, string> = {
  PE: '#059669', SE: '#0891b2', PMP: '#5EC9CC', 'LEED AP': '#65a30d',
  AIA: '#2563eb', NCARB: '#d97706', 'OSHA-30': '#dc2626',
}

function getCertColor(cert: string): string {
  return CERT_COLORS[cert] || '#5EC9CC'
}

export default function PeoplePanel({ apiBase = '/api/people' }: PeoplePanelProps) {
  const [data, setData] = useState<PeopleData | null>(null)
  const [loading, setLoading] = useState(true)

  // Detail / editing
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null)
  const [selectedUser, setSelectedUser] = useState<WorkspaceUser | null>(null)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<Partial<StaffMember>>({})

  // Search
  const [searchText, setSearchText] = useState('')

  // Add staff form
  const [showAddStaff, setShowAddStaff] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newLocation, setNewLocation] = useState('')
  const [newCerts, setNewCerts] = useState('')
  const [newSpecialties, setNewSpecialties] = useState('')
  const [newYears, setNewYears] = useState('')

  // Toast
  const [toast, setToast] = useState('')
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const fetchPeople = useCallback(async () => {
    try {
      const r = await fetch(apiBase)
      if (r.ok) setData(await r.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [apiBase])

  useEffect(() => { fetchPeople() }, [fetchPeople])

  // A write the server refused must read as refused: Save, Add and Remove used to
  // toast success whatever came back, and Save sent nothing at all ("Staff updated
  // (save pending backend PUT)", live on a customer appliance 2026-10-17).
  const [staffError, setStaffError] = useState('')
  const refusal = async (r: Response, fallback: string) => {
    const d = await r.json().catch(() => ({} as Record<string, unknown>))
    const detail = (d as { detail?: unknown }).detail
    return typeof detail === 'string' && detail.trim() ? detail : fallback
  }

  const saveStaff = async () => {
    if (!selectedStaff) return
    setStaffError('')
    const body = {
      name: (editForm.name || '').trim(),
      title: editForm.title || '',
      location: editForm.location || '',
      certifications: editForm.certifications || [],
      specialties: editForm.specialties || [],
      years_experience: editForm.years_experience ?? null,
    }
    if (!body.name) { setStaffError('A staff member needs a name.'); return }
    try {
      const r = await fetch(`${apiBase}/staff/${encodeURIComponent(selectedStaff.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        setStaffError(await refusal(r, 'The change could not be saved.'))
        return
      }
      setSelectedStaff({ ...selectedStaff, ...body })
      setEditing(false)
      showToast('Saved')
      fetchPeople()
    } catch {
      setStaffError('The change could not be saved: the workspace did not answer.')
    }
  }

  const addStaff = async () => {
    if (!newName) return
    setStaffError('')
    const r = await fetch(`${apiBase}/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName,
        title: newTitle,
        email: newEmail,
        department: newLocation,
        certifications: newCerts ? newCerts.split(',').map(s => s.trim()).filter(Boolean) : [],
        specialties: newSpecialties ? newSpecialties.split(',').map(s => s.trim()).filter(Boolean) : [],
      }),
    }).catch(() => null)
    if (!r || !r.ok) {
      showToast(r ? await refusal(r, 'The staff member could not be added.')
        : 'The staff member could not be added: the workspace did not answer.')
      return
    }
    setNewName(''); setNewTitle(''); setNewEmail(''); setNewPhone('')
    setNewLocation(''); setNewCerts(''); setNewSpecialties(''); setNewYears('')
    setShowAddStaff(false)
    showToast('Staff member added')
    fetchPeople()
  }

  const removeStaff = async (id: string) => {
    if (!confirm('Remove this staff member?')) return
    setStaffError('')
    const r = await fetch(`${apiBase}/staff/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .catch(() => null)
    if (!r || !r.ok) {
      setStaffError(r ? await refusal(r, 'The staff member could not be removed.')
        : 'The staff member could not be removed: the workspace did not answer.')
      return
    }
    if (selectedStaff?.id === id) setSelectedStaff(null)
    showToast('Staff member removed')
    fetchPeople()
  }

  const startEditStaff = (s: StaffMember) => {
    setStaffError('')
    setEditForm({
      name: s.name,
      title: s.title,
      location: s.location,
      email: s.email || '',
      certifications: s.certifications || [],
      specialties: s.specialties || [],
      years_experience: s.years_experience,
    })
    setEditing(true)
  }

  // Filter
  const filteredStaff = data?.company_staff.filter(s => {
    if (!searchText) return true
    const q = searchText.toLowerCase()
    return s.name.toLowerCase().includes(q)
      || (s.title || '').toLowerCase().includes(q)
      || (s.location || '').toLowerCase().includes(q)
      || (s.email || '').toLowerCase().includes(q)
      || s.certifications.some(c => c.toLowerCase().includes(q))
      || s.specialties.some(sp => sp.toLowerCase().includes(q))
  }) || []

  const filteredUsers = data?.workspace_users.filter(u => {
    if (!searchText) return true
    const q = searchText.toLowerCase()
    return (u.display_name || u.username).toLowerCase().includes(q)
      || u.email.toLowerCase().includes(q)
  }) || []

  const inputStyle: React.CSSProperties = {
    padding: '0.6rem 0.85rem', background: 'var(--bg-deep, #111)',
    border: '1px solid var(--glass-border, var(--border, #333))', borderRadius: 'var(--radius, 8px)',
    color: 'var(--text-primary, #eee)', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box',
  }

  const btnStyle: React.CSSProperties = {
    padding: '6px 14px', borderRadius: 'var(--radius, 8px)', border: 'none',
    cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
  }

  const actionBtn: React.CSSProperties = {
    ...btnStyle,
    padding: '5px 10px', fontSize: '0.75rem', fontWeight: 500,
    background: 'var(--bg-deep, #111)', color: 'var(--text-secondary, #aaa)',
    border: '1px solid var(--glass-border, var(--border, #333))',
  }

  // One roster, so the two kinds of person are grouped rather than tabbed apart.
  const groupLabel: React.CSSProperties = {
    color: 'var(--text-muted, #888)', fontSize: '0.72rem', fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0.25rem 0 0.15rem',
  }

  if (loading) return <div style={{ padding: '2rem', color: 'var(--text-muted, #888)' }}>Loading...</div>

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1100, margin: '0 auto' }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 9999,
          padding: '10px 20px', borderRadius: 8, fontSize: '0.85rem', fontWeight: 500,
          background: 'var(--accent-primary, #d97706)', color: '#fff',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>{toast}</div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>People</h2>
        <button onClick={() => setShowAddStaff(!showAddStaff)}
          style={{ ...btnStyle, background: 'var(--accent-primary, #d97706)', color: 'var(--bg-deep, #111)' }}>
          + Add Staff
        </button>
      </div>

      {/* Search — one roster: company staff and workspace users together */}
      <input
        value={searchText}
        onChange={e => setSearchText(e.target.value)}
        placeholder="Search people by name, title, certification, specialty, email..."
        style={{ ...inputStyle, marginBottom: '1rem' }}
      />

      {/* Add Staff Form */}
      {showAddStaff && (
        <div style={{
          padding: '1.25rem', borderRadius: 'var(--radius, 8px)', marginBottom: '1rem',
          background: 'var(--bg-surface, var(--bg-elevated, #222))',
          border: '1px solid var(--glass-border, var(--border, #333))',
        }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 12 }}>Add Staff Member</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Full name *" style={inputStyle} />
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Title / Degree" style={inputStyle} />
            <input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="Email" style={inputStyle} />
            <input value={newLocation} onChange={e => setNewLocation(e.target.value)} placeholder="Address" style={inputStyle} />
            <input value={newCerts} onChange={e => setNewCerts(e.target.value)} placeholder="Certifications (comma-separated)" style={inputStyle} />
            <input value={newSpecialties} onChange={e => setNewSpecialties(e.target.value)} placeholder="Specialties (comma-separated)" style={inputStyle} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button onClick={() => setShowAddStaff(false)} style={{ ...btnStyle, background: 'transparent', color: 'var(--text-muted, #888)', border: '1px solid var(--border, #333)' }}>Cancel</button>
            <button onClick={addStaff} disabled={!newName} style={{ ...btnStyle, background: 'var(--accent-primary, #d97706)', color: 'var(--bg-deep, #111)', opacity: newName ? 1 : 0.5 }}>Add</button>
          </div>
        </div>
      )}

      {/* Main content: list + detail */}
      <div style={{ display: 'flex', gap: 16 }}>
        {/* List — ONE roster: company staff and workspace users together (Jason
            Morse, 2026-11-17: "the 'workspace user' can be included right into
            here and not be separate tabs"). */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {data?.workspace_users_error && (
            <p role="status" style={{ color: 'var(--text-muted, #888)', fontSize: '0.8rem', margin: '0 0 0.5rem' }}>
              {data.workspace_users_error}
            </p>
          )}
          {filteredStaff.length === 0 && filteredUsers.length === 0 ? (
            <p style={{ color: 'var(--text-muted, #888)', textAlign: 'center', padding: '2rem' }}>
              No people yet. Upload resumes to populate staff automatically, or add manually.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {filteredStaff.length > 0 && filteredUsers.length > 0 && (
                <div style={groupLabel}>Company staff ({filteredStaff.length})</div>
              )}
              {filteredStaff.map(s => {
                const isSelected = selectedStaff?.id === s.id
                return (
                  <div key={s.id}
                    onClick={() => { setSelectedStaff(s); setSelectedUser(null); setEditing(false); setStaffError('') }}
                    style={{
                      padding: '0.75rem 1rem',
                      background: 'var(--bg-surface, var(--bg-elevated, #222))',
                      borderRadius: 'var(--radius, 8px)',
                      border: isSelected
                        ? '1px solid var(--accent-primary, #d97706)'
                        : '1px solid var(--glass-border, var(--border, #333))',
                      display: 'flex', alignItems: 'center', gap: '1rem',
                      cursor: 'pointer', transition: 'border-color 0.15s',
                    }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%', background: 'var(--bg-elevated, #333)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.85rem', fontWeight: 600, flexShrink: 0,
                      color: 'var(--accent-primary, #d97706)',
                    }}>
                      {getInitials(s.name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{s.name}</span>
                        {s.title && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)' }}>{s.title}</span>}
                      </div>
                      <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                        {s.certifications.slice(0, 3).map((c, i) => (
                          <span key={i} style={{ background: `${getCertColor(c)}18`, padding: '0.1rem 0.4rem',
                            borderRadius: 4, fontSize: '0.7rem', color: getCertColor(c), fontWeight: 600 }}>{c}</span>
                        ))}
                        {s.specialties.slice(0, 2).map((sp, i) => (
                          <span key={`s${i}`} style={{ background: 'var(--bg-elevated, #333)', padding: '0.1rem 0.4rem',
                            borderRadius: 4, fontSize: '0.7rem', color: 'var(--text-secondary, #aaa)' }}>{sp}</span>
                        ))}
                      </div>
                    </div>
                    {s.years_experience && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)', flexShrink: 0 }}>
                        {s.years_experience}y exp
                      </span>
                    )}
                  </div>
                )
              })}
              {filteredUsers.length > 0 && (
                <div style={{ ...groupLabel, marginTop: filteredStaff.length ? 8 : 0 }}>
                  Workspace users ({filteredUsers.length})
                </div>
              )}
              {filteredUsers.map(u => {
                const isSelected = selectedUser?.id === u.id
                return (
                  <div key={u.id}
                    onClick={() => { setSelectedUser(u); setSelectedStaff(null); setEditing(false) }}
                    style={{
                      padding: '0.75rem 1rem',
                      background: 'var(--bg-surface, var(--bg-elevated, #222))',
                      borderRadius: 'var(--radius, 8px)',
                      border: isSelected
                        ? '1px solid var(--accent-primary, #d97706)'
                        : '1px solid var(--glass-border, var(--border, #333))',
                      display: 'flex', alignItems: 'center', gap: '1rem',
                      cursor: 'pointer', transition: 'border-color 0.15s',
                    }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%',
                      background: 'var(--accent-primary, #d97706)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.85rem', fontWeight: 600, color: 'var(--bg-deep, #111)',
                      flexShrink: 0,
                    }}>
                      {(u.display_name || u.username).charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{u.display_name || u.username}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)' }}>{u.email}</div>
                    </div>
                    <span style={{
                      background: 'var(--bg-elevated, #333)', padding: '0.15rem 0.5rem',
                      borderRadius: 4, fontSize: '0.7rem', color: 'var(--text-secondary, #aaa)',
                    }}>{u.role}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Detail Side Panel — Staff profile */}
        {selectedStaff && (
          <div style={{
            width: 360, flexShrink: 0, padding: '1.25rem', borderRadius: 'var(--radius, 8px)',
            background: 'var(--bg-surface, var(--bg-elevated, #222))',
            border: '1px solid var(--glass-border, var(--border, #333))',
            alignSelf: 'flex-start',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: '50%', background: 'var(--bg-elevated, #333)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1rem', fontWeight: 700, color: 'var(--accent-primary, #d97706)',
                  flexShrink: 0,
                }}>
                  {getInitials(selectedStaff.name)}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1rem' }}>{selectedStaff.name}</div>
                  {selectedStaff.title && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #888)' }}>{selectedStaff.title}</div>
                  )}
                </div>
              </div>
              <button onClick={() => { setSelectedStaff(null); setEditing(false) }} style={{
                background: 'transparent', border: 'none', color: 'var(--text-muted, #888)',
                cursor: 'pointer', fontSize: '1rem',
              }}>x</button>
            </div>

            {staffError && (
              <div role="alert" data-testid="people-staff-error" style={{
                marginBottom: 12, padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: '0.8rem',
                background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444',
              }}>{staffError}</div>
            )}

            {editing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)', display: 'block', marginBottom: 4 }}>Name</label>
                  <input value={editForm.name || ''} onChange={e => setEditForm({ ...editForm, name: e.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)', display: 'block', marginBottom: 4 }}>Title / Degree</label>
                  <input value={editForm.title || ''} onChange={e => setEditForm({ ...editForm, title: e.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)', display: 'block', marginBottom: 4 }}>Address</label>
                  <input value={editForm.location || ''} onChange={e => setEditForm({ ...editForm, location: e.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)', display: 'block', marginBottom: 4 }}>Certifications (comma-separated)</label>
                  <input value={(editForm.certifications || []).join(', ')} onChange={e => setEditForm({ ...editForm, certifications: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)', display: 'block', marginBottom: 4 }}>Specialties (comma-separated)</label>
                  <input value={(editForm.specialties || []).join(', ')} onChange={e => setEditForm({ ...editForm, specialties: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)', display: 'block', marginBottom: 4 }}>Years Experience</label>
                  <input type="number" value={editForm.years_experience ?? ''} onChange={e => setEditForm({ ...editForm, years_experience: e.target.value ? parseInt(e.target.value) : null })} style={inputStyle} />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                  <button onClick={() => { setEditing(false); setStaffError('') }} style={{ ...btnStyle, background: 'transparent', color: 'var(--text-muted, #888)', border: '1px solid var(--border, #333)' }}>Cancel</button>
                  <button onClick={saveStaff} style={{ ...btnStyle, background: 'var(--accent-primary, #d97706)', color: 'var(--bg-deep, #111)' }}>Save</button>
                </div>
              </div>
            ) : (
              <>
                {/* Profile — the record itself, not an action list (Jason Morse,
                    2026-11-17: this area should be "essentially their whole
                    'profile' ... email, address, Certs, Resume"). Only fields
                    the data has are shown; no invented placeholders. */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: '0.85rem' }}>
                  {(selectedStaff.email || selectedStaff.phone || selectedStaff.location) && (
                    <div>
                      <div style={groupLabel}>Contact</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {selectedStaff.email && (
                          <div><span style={{ color: 'var(--text-muted, #888)', fontSize: '0.75rem' }}>Email: </span>
                            <a href={`mailto:${selectedStaff.email}`} style={{ color: 'var(--accent-primary, #d97706)', textDecoration: 'none' }}>{selectedStaff.email}</a>
                          </div>
                        )}
                        {selectedStaff.phone && (
                          <div><span style={{ color: 'var(--text-muted, #888)', fontSize: '0.75rem' }}>Phone: </span>
                            <a href={`tel:${selectedStaff.phone}`} style={{ color: 'var(--text-primary, #eee)', textDecoration: 'none' }}>{selectedStaff.phone}</a>
                          </div>
                        )}
                        {selectedStaff.location && (
                          <div><span style={{ color: 'var(--text-muted, #888)', fontSize: '0.75rem' }}>Address: </span>{selectedStaff.location}</div>
                        )}
                      </div>
                    </div>
                  )}

                  {(selectedStaff.school || selectedStaff.years_experience
                    || selectedStaff.certifications.length > 0
                    || selectedStaff.specialties.length > 0
                    || (selectedStaff.firms && selectedStaff.firms.length > 0)) && (
                    <div>
                      <div style={groupLabel}>Professional</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {selectedStaff.school && (
                          <div><span style={{ color: 'var(--text-muted, #888)', fontSize: '0.75rem' }}>School: </span>{selectedStaff.school}</div>
                        )}
                        {selectedStaff.years_experience && (
                          <div><span style={{ color: 'var(--text-muted, #888)', fontSize: '0.75rem' }}>Experience: </span>{selectedStaff.years_experience} years</div>
                        )}

                        {/* Certifications */}
                        {selectedStaff.certifications.length > 0 && (
                          <div>
                            <div style={{ color: 'var(--text-muted, #888)', fontSize: '0.75rem', marginBottom: 6 }}>Certifications</div>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {selectedStaff.certifications.map((c, i) => (
                                <span key={i} style={{
                                  padding: '3px 10px', borderRadius: 10, fontSize: '0.7rem', fontWeight: 600,
                                  background: `${getCertColor(c)}18`, color: getCertColor(c),
                                }}>{c}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Specialties */}
                        {selectedStaff.specialties.length > 0 && (
                          <div>
                            <div style={{ color: 'var(--text-muted, #888)', fontSize: '0.75rem', marginBottom: 6 }}>Specialties</div>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {selectedStaff.specialties.map((sp, i) => (
                                <span key={i} style={{
                                  padding: '3px 10px', borderRadius: 10, fontSize: '0.7rem',
                                  background: 'var(--bg-elevated, #333)', color: 'var(--text-secondary, #aaa)',
                                }}>{sp}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Firms */}
                        {selectedStaff.firms && selectedStaff.firms.length > 0 && (
                          <div>
                            <div style={{ color: 'var(--text-muted, #888)', fontSize: '0.75rem', marginBottom: 6 }}>Previous Firms</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {selectedStaff.firms.map((f, i) => (
                                <div key={i} style={{ fontSize: '0.8rem', color: 'var(--text-primary, #eee)' }}>{f}</div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <PeopleStaffNotes
                  key={selectedStaff.id}
                  apiBase={apiBase}
                  staffId={selectedStaff.id}
                  resumeDocId={selectedStaff.source_doc_id}
                  onResumeLinked={docId => {
                    setSelectedStaff(prev => (prev ? { ...prev, source_doc_id: docId } : prev))
                    fetchPeople()
                  }}
                />

                {/* Profile controls, below the profile itself */}
                <div style={{
                  display: 'flex', gap: 6, marginTop: 16, paddingTop: 12, flexWrap: 'wrap',
                  borderTop: '1px solid var(--glass-border, var(--border, #333))',
                }}>
                  {selectedStaff.email && (
                    <a href={`mailto:${selectedStaff.email}`} style={{ textDecoration: 'none' }}>
                      <button style={actionBtn}>Send Email</button>
                    </a>
                  )}
                  <button onClick={() => startEditStaff(selectedStaff)} style={actionBtn}>Edit</button>
                  <button onClick={() => removeStaff(selectedStaff.id)} style={{ ...actionBtn, color: '#ef4444' }}>Remove</button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Detail Side Panel — Workspace User profile */}
        {selectedUser && (
          <div style={{
            width: 360, flexShrink: 0, padding: '1.25rem', borderRadius: 'var(--radius, 8px)',
            background: 'var(--bg-surface, var(--bg-elevated, #222))',
            border: '1px solid var(--glass-border, var(--border, #333))',
            alignSelf: 'flex-start',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: '50%',
                  background: 'var(--accent-primary, #d97706)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1rem', fontWeight: 700, color: 'var(--bg-deep, #111)',
                }}>
                  {(selectedUser.display_name || selectedUser.username).charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1rem' }}>{selectedUser.display_name || selectedUser.username}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #888)' }}>@{selectedUser.username}</div>
                </div>
              </div>
              <button onClick={() => setSelectedUser(null)} style={{
                background: 'transparent', border: 'none', color: 'var(--text-muted, #888)',
                cursor: 'pointer', fontSize: '1rem',
              }}>x</button>
            </div>

            {/* Details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.85rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted, #888)', fontSize: '0.75rem' }}>Email: </span>
                <a href={`mailto:${selectedUser.email}`} style={{ color: 'var(--accent-primary, #d97706)', textDecoration: 'none' }}>{selectedUser.email}</a>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted, #888)', fontSize: '0.75rem' }}>Role: </span>
                <span style={{
                  background: 'var(--bg-elevated, #333)', padding: '2px 8px',
                  borderRadius: 4, fontSize: '0.75rem',
                }}>{selectedUser.role}</span>
              </div>
              {selectedUser.last_active && (
                <div>
                  <span style={{ color: 'var(--text-muted, #888)', fontSize: '0.75rem' }}>Last active: </span>
                  {new Date(selectedUser.last_active).toLocaleString()}
                </div>
              )}
            </div>

            {/* Controls, below the profile itself */}
            <div style={{
              display: 'flex', gap: 6, marginTop: 16, paddingTop: 12, flexWrap: 'wrap',
              borderTop: '1px solid var(--glass-border, var(--border, #333))',
            }}>
              <a href={`mailto:${selectedUser.email}`} style={{ textDecoration: 'none' }}>
                <button style={actionBtn}>Send Email</button>
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
