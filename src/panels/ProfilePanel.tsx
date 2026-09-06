'use client'

import { useState, useEffect, useCallback } from 'react'

export interface ProfilePanelProps {
  apiBase?: string
  onLogout?: () => void
}

interface UserInfo {
  user_id?: string
  display_name?: string
  email?: string
  role?: string
  tenant_id?: string
  workspace_id?: string
  onboarding_complete?: boolean
  authenticated?: boolean
}

export default function ProfilePanel({ apiBase = '/api/auth', onLogout }: ProfilePanelProps) {
  const [user, setUser] = useState<UserInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const fetchUser = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/me`)
      if (r.ok) {
        const data = await r.json()
        if (data.authenticated !== false) setUser(data)
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [apiBase])

  useEffect(() => { fetchUser() }, [fetchUser])

  const startEdit = () => {
    setEditName(user?.display_name || '')
    setEditEmail(user?.email || '')
    setEditing(true)
  }

  const saveProfile = async () => {
    try {
      const r = await fetch(`${apiBase}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: editName, email: editEmail }),
      })
      if (r.ok) {
        setEditing(false)
        showToast('Profile updated')
        fetchUser()
      }
    } catch { showToast('Failed to save') }
  }

  const inputStyle: React.CSSProperties = {
    padding: '0.6rem 0.85rem', background: 'var(--bg-deep, #111)',
    border: '1px solid var(--glass-border, var(--border, #333))', borderRadius: 'var(--radius, 8px)',
    color: 'var(--text-primary, #eee)', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box',
  }

  if (loading) return <div style={{ padding: '2rem', color: 'var(--text-muted, #888)' }}>Loading...</div>
  if (!user) return <div style={{ padding: '2rem', color: 'var(--text-muted, #888)' }}>Not authenticated</div>

  return (
    <div style={{ padding: '2rem', maxWidth: 600, margin: '0 auto' }}>
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 9999,
          padding: '10px 20px', borderRadius: 8, fontSize: '0.85rem', fontWeight: 500,
          background: 'var(--accent-primary, #d97706)', color: '#fff',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>{toast}</div>
      )}

      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.5rem' }}>Profile</h2>

      {/* Avatar + name header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, marginBottom: '2rem',
        padding: '1.25rem', borderRadius: 'var(--radius, 8px)',
        background: 'var(--bg-surface, var(--bg-elevated, #222))',
        border: '1px solid var(--glass-border, var(--border, #333))',
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'var(--accent-primary, #d97706)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.4rem', fontWeight: 700, color: 'var(--bg-deep, #111)',
          flexShrink: 0,
        }}>
          {(user.display_name || 'U').charAt(0).toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{user.display_name || 'Unknown'}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #888)' }}>{user.email || '—'}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)', marginTop: 2 }}>
            <span style={{
              background: 'var(--bg-elevated, #333)', padding: '2px 8px',
              borderRadius: 4, fontSize: '0.65rem', fontWeight: 600,
            }}>{user.role || 'member'}</span>
          </div>
        </div>
      </div>

      {editing ? (
        <div style={{
          padding: '1.25rem', borderRadius: 'var(--radius, 8px)',
          background: 'var(--bg-surface, var(--bg-elevated, #222))',
          border: '1px solid var(--glass-border, var(--border, #333))',
          marginBottom: '1.5rem',
        }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 12 }}>Edit Profile</div>
          <div style={{ display: 'grid', gap: 12 }}>
            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)', display: 'block', marginBottom: 4 }}>Display Name</label>
              <input value={editName} onChange={e => setEditName(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)', display: 'block', marginBottom: 4 }}>Email</label>
              <input value={editEmail} onChange={e => setEditEmail(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button onClick={() => setEditing(false)} style={{
              padding: '6px 14px', borderRadius: 'var(--radius, 8px)', border: '1px solid var(--border, #333)',
              background: 'transparent', color: 'var(--text-muted, #888)', cursor: 'pointer', fontSize: '0.8rem',
            }}>Cancel</button>
            <button onClick={saveProfile} style={{
              padding: '6px 14px', borderRadius: 'var(--radius, 8px)', border: 'none',
              background: 'var(--accent-primary, #d97706)', color: 'var(--bg-deep, #111)',
              cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
            }}>Save</button>
          </div>
        </div>
      ) : (
        <div style={{
          padding: '1.25rem', borderRadius: 'var(--radius, 8px)',
          background: 'var(--bg-surface, var(--bg-elevated, #222))',
          border: '1px solid var(--glass-border, var(--border, #333))',
          marginBottom: '1.5rem',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Account Details</div>
            <button onClick={startEdit} style={{
              padding: '4px 12px', borderRadius: 'var(--radius, 8px)',
              border: '1px solid var(--glass-border, var(--border, #333))',
              background: 'var(--bg-deep, #111)', color: 'var(--text-secondary, #aaa)',
              cursor: 'pointer', fontSize: '0.75rem',
            }}>Edit</button>
          </div>
          <div style={{ display: 'grid', gap: 10, fontSize: '0.85rem' }}>
            <div>
              <span style={{ color: 'var(--text-muted, #888)', fontSize: '0.75rem' }}>User ID: </span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{user.user_id || '—'}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted, #888)', fontSize: '0.75rem' }}>Tenant: </span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{user.tenant_id || '—'}</span>
            </div>
            {user.workspace_id && (
              <div>
                <span style={{ color: 'var(--text-muted, #888)', fontSize: '0.75rem' }}>Workspace: </span>
                <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{user.workspace_id}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        {onLogout && (
          <button onClick={onLogout} style={{
            padding: '8px 20px', borderRadius: 'var(--radius, 8px)',
            background: 'var(--bg-elevated, #333)', color: 'var(--text-secondary, #aaa)',
            border: '1px solid var(--glass-border, var(--border, #333))',
            cursor: 'pointer', fontSize: '0.85rem',
          }}>Sign Out</button>
        )}
      </div>
    </div>
  )
}
