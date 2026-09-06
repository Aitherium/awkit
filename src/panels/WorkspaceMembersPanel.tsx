'use client'

import { useState, useEffect, useCallback } from 'react'
import { AlertCircle, Loader2, Mail, User, Trash2, ChevronDown, Plus, X } from 'lucide-react'

interface Member {
  email: string
  role: 'owner' | 'admin' | 'member' | 'viewer' | 'guest'
  user_id?: string
  display_name?: string
  joined_at?: string
  allowed_channels?: string[]
}

interface PendingInvite {
  token: string
  email: string
  role: string
  created_at: string
  expires_at: string
}

interface RelayChannel {
  slug: string
  name: string
}

type SortKey = 'email' | 'role' | 'joined'
type UserRole = 'owner' | 'admin' | 'member' | 'viewer' | 'guest'

export default function WorkspaceMembersPanel() {
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [channels, setChannels] = useState<RelayChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [sortBy, setSortBy] = useState<SortKey>('email')
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [showGuestInvite, setShowGuestInvite] = useState(false)
  const [guestEmail, setGuestEmail] = useState('')
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set())
  const [inviting, setInviting] = useState(false)
  const [editingChannels, setEditingChannels] = useState<string | null>(null)

  // Load members and invites
  useEffect(() => {
    fetchData()
  }, [])

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch('/api/relay/v1/channels', {
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        const data = await res.json()
        setChannels(Array.isArray(data.channels) ? data.channels : [])
      }
    } catch (err) {
      console.error('Failed to load channels:', err)
    }
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [membersRes, invitesRes] = await Promise.all([
        fetch('/api/workspace/members', {
          headers: { 'Content-Type': 'application/json' },
        }),
        fetch('/api/workspace/invites', {
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => null),
      ])

      if (!membersRes.ok) {
        if (membersRes.status === 401 || membersRes.status === 403) {
          setError('Not authorized to view members')
          setIsAdmin(false)
          return
        }
        throw new Error(`Failed to load members: ${membersRes.status}`)
      }

      const membersData = await membersRes.json()
      setMembers(membersData.members || [])
      // Authority comes from the server's explicit caller_is_admin flag — never from the
      // fact that a request returned 200. (The invites endpoint used to be ungated, so
      // "invites loaded" wrongly implied "I am an admin".)
      setIsAdmin(membersData.caller_is_admin === true)

      if (invitesRes?.ok) {
        const invitesData = await invitesRes.json()
        setInvites(invitesData.invites || [])
      }

      // Fetch channels for guest channel selection
      await fetchChannels()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load members')
    } finally {
      setLoading(false)
    }
  }, [fetchChannels])

  const handleRemoveMember = useCallback(
    async (emailOrId: string) => {
      if (!confirm(`Remove this member from the workspace?`)) return

      try {
        const res = await fetch(`/api/workspace/members/${encodeURIComponent(emailOrId)}`, {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error(`Failed to remove member`)
        await fetchData()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove member')
      }
    },
    [fetchData],
  )

  const handleChangeRole = useCallback(
    async (emailOrId: string, newRole: UserRole) => {
      try {
        const res = await fetch(`/api/workspace/members/${encodeURIComponent(emailOrId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: newRole }),
        })
        if (!res.ok) throw new Error(`Failed to update role`)
        await fetchData()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update role')
      }
    },
    [fetchData],
  )

  const handleRevokeInvite = useCallback(
    async (token: string) => {
      if (!confirm('Revoke this invitation?')) return

      try {
        const res = await fetch(`/api/workspace/invites/${encodeURIComponent(token)}`, {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error(`Failed to revoke invitation`)
        await fetchData()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to revoke invitation')
      }
    },
    [fetchData],
  )

  const handleInviteGuest = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()

      if (!guestEmail.trim()) {
        setError('Email is required')
        return
      }

      if (selectedChannels.size === 0) {
        setError('Select at least one channel for the guest')
        return
      }

      setInviting(true)
      setError(null)

      try {
        const res = await fetch('/api/workspace/directory/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: guestEmail,
            role: 'guest',
            allowed_channels: Array.from(selectedChannels),
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || `Failed to invite guest (${res.status})`)
        }

        setGuestEmail('')
        setSelectedChannels(new Set())
        setShowGuestInvite(false)
        await fetchData()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to invite guest')
      } finally {
        setInviting(false)
      }
    },
    [guestEmail, selectedChannels, fetchData],
  )

  const handleUpdateAssignedChannels = useCallback(
    async (email: string, newChannels: string[]) => {
      try {
        const res = await fetch(`/api/workspace/members/${encodeURIComponent(email)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assigned_channels: newChannels }),
        })
        if (!res.ok) throw new Error(`Failed to update assigned channels`)
        await fetchData()
        setEditingChannels(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update assigned channels')
      }
    },
    [fetchData],
  )

  const sortedMembers = [...members].sort((a, b) => {
    switch (sortBy) {
      case 'role':
        return (a.role || '').localeCompare(b.role || '')
      case 'joined':
        return (a.joined_at || '').localeCompare(b.joined_at || '')
      default:
        return (a.email || '').localeCompare(b.email || '')
    }
  })

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <Loader2 style={{ display: 'inline-block', marginRight: '0.5rem', animation: 'spin 1s linear infinite' }} size={20} />
        Loading members...
      </div>
    )
  }

  if (error && !members.length && !invites.length) {
    return (
      <div style={{ padding: '2rem', color: 'var(--text-danger)' }}>
        <AlertCircle style={{ display: 'inline-block', marginRight: '0.5rem' }} size={20} />
        {error}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Members Section */}
      <div>
        <div style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Team Members ({members.length})</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            {isAdmin ? 'Manage roles and remove members.' : 'View your team members.'}
          </p>
        </div>

        {members.length === 0 ? (
          <div style={{
            padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', borderRadius: 'var(--radius)',
            background: 'var(--bg-elevated)',
          }}>
            <User size={32} style={{ margin: '0 auto 0.5rem', opacity: 0.5 }} />
            <p>No members yet. Invite someone to get started.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {/* Header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '2fr 1fr 1.5fr 2fr 1fr', gap: '1rem', padding: '0.75rem 1rem',
              borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem', color: 'var(--text-secondary)',
              fontWeight: 500,
            }}>
              <div
                onClick={() => setSortBy('email')}
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                Email {sortBy === 'email' && '↓'}
              </div>
              <div
                onClick={() => setSortBy('role')}
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                Role {sortBy === 'role' && '↓'}
              </div>
              <div
                onClick={() => setSortBy('joined')}
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                Joined {sortBy === 'joined' && '↓'}
              </div>
              <div>Channels</div>
              <div style={{ textAlign: 'right' }}>Actions</div>
            </div>

            {/* Rows */}
            {sortedMembers.map(member => (
              <div key={member.email} style={{
                borderRadius: 'var(--radius)', background: 'var(--bg-elevated)', overflow: 'hidden',
              }}>
                <div style={{
                  display: 'grid', gridTemplateColumns: '2fr 1fr 1.5fr 2fr 1fr', gap: '1rem', padding: '1rem',
                  alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{member.display_name || member.email}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{member.email}</div>
                  </div>
                  <div>
                    {isAdmin ? (
                      <select
                        value={member.role}
                        onChange={e => handleChangeRole(member.email, e.target.value as UserRole)}
                        style={{
                          padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)', border: '1px solid var(--border-color)',
                          background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.9rem', cursor: 'pointer',
                        }}
                        disabled={member.role === 'owner' && members.filter(m => m.role === 'owner').length <= 1}
                      >
                        <option value="viewer">Viewer</option>
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                        <option value="owner">Owner</option>
                        <option value="guest">Guest</option>
                      </select>
                    ) : (
                      <span style={{
                        display: 'inline-block', padding: '0.35rem 0.75rem', borderRadius: '0.25rem',
                        background: member.role === 'owner' ? 'var(--accent-primary)' : member.role === 'admin' ? 'var(--accent-blue)' : member.role === 'guest' ? 'var(--accent-secondary)' : 'var(--bg-base)',
                        fontSize: '0.85rem', fontWeight: 500, textTransform: 'capitalize',
                      }}>
                        {member.role}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    {member.joined_at ? new Date(member.joined_at).toLocaleDateString() : 'N/A'}
                  </div>
                  <div>
                    {member.role === 'guest' && isAdmin ? (
                      editingChannels === member.email ? (
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          {channels.map(ch => (
                            <label key={ch.slug} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={(member.allowed_channels || []).includes(ch.slug)}
                                onChange={(e) => {
                                  const updated = e.target.checked
                                    ? [...(member.allowed_channels || []), ch.slug]
                                    : (member.allowed_channels || []).filter(s => s !== ch.slug)
                                  handleUpdateAssignedChannels(member.email, updated)
                                }}
                                style={{ cursor: 'pointer' }}
                              />
                              {ch.name}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <button
                          onClick={() => setEditingChannels(member.email)}
                          style={{
                            padding: '0.35rem 0.75rem', borderRadius: 'var(--radius)', border: '1px solid var(--border-color)',
                            background: 'var(--bg-base)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.85rem',
                          }}
                        >
                          {(member.allowed_channels || []).length > 0 ? `${(member.allowed_channels || []).length} channels` : 'Assign channels'}
                        </button>
                      )
                    ) : member.role === 'guest' ? (
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {(member.allowed_channels || []).length > 0 ? `${(member.allowed_channels || []).length} channels` : 'No channels'}
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>—</span>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {isAdmin && member.role !== 'owner' && (
                      <button
                        onClick={() => handleRemoveMember(member.email)}
                        style={{
                          padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)', border: 'none',
                          background: 'var(--bg-base)', color: 'var(--text-danger)', cursor: 'pointer', fontSize: '0.9rem',
                          display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                        }}
                        title="Remove member"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invite Guest Section */}
      {isAdmin && (
        <div>
          <div style={{ marginBottom: '1rem' }}>
            <button
              onClick={() => setShowGuestInvite(!showGuestInvite)}
              style={{
                padding: '0.75rem 1rem', borderRadius: 'var(--radius)', border: '1px solid var(--border-color)',
                background: 'var(--bg-elevated)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.95rem',
                fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem',
              }}
            >
              <Plus size={18} />
              {showGuestInvite ? 'Hide' : 'Invite Guest'}
            </button>
          </div>

          {showGuestInvite && (
            <div style={{
              padding: '1.5rem', borderRadius: 'var(--radius)', background: 'var(--bg-elevated)',
              border: '1px solid var(--border-color)',
            }}>
              <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Invite Guest to Channels</h4>
              <form onSubmit={handleInviteGuest} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.9rem', fontWeight: 500, marginBottom: '0.5rem', display: 'block' }}>
                    Guest Email
                  </label>
                  <input
                    type="email"
                    value={guestEmail}
                    onChange={e => setGuestEmail(e.target.value)}
                    placeholder="guest@example.com"
                    disabled={inviting}
                    style={{
                      width: '100%', padding: '0.75rem', borderRadius: 'var(--radius)', border: '1px solid var(--border-color)',
                      background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.9rem',
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.9rem', fontWeight: 500, marginBottom: '0.5rem', display: 'block' }}>
                    Allowed Channels ({selectedChannels.size} selected)
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {channels.length > 0 ? (
                      channels.map(ch => (
                        <label key={ch.slug} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                          <input
                            type="checkbox"
                            checked={selectedChannels.has(ch.slug)}
                            onChange={(e) => {
                              const updated = new Set(selectedChannels)
                              if (e.target.checked) {
                                updated.add(ch.slug)
                              } else {
                                updated.delete(ch.slug)
                              }
                              setSelectedChannels(updated)
                            }}
                            disabled={inviting}
                            style={{ cursor: 'pointer' }}
                          />
                          <span>{ch.name}</span>
                        </label>
                      ))
                    ) : (
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>No channels available</p>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowGuestInvite(false)
                      setGuestEmail('')
                      setSelectedChannels(new Set())
                    }}
                    disabled={inviting}
                    style={{
                      padding: '0.5rem 1rem', borderRadius: 'var(--radius)', border: '1px solid var(--border-color)',
                      background: 'var(--bg-base)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.9rem',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={inviting}
                    style={{
                      padding: '0.5rem 1rem', borderRadius: 'var(--radius)', border: 'none',
                      background: 'var(--accent-primary)', color: 'var(--text-contrast)', cursor: 'pointer', fontSize: '0.9rem',
                      fontWeight: 500,
                    }}
                  >
                    {inviting ? 'Inviting...' : 'Send Invite'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Pending Invites Section */}
      {isAdmin && invites.length > 0 && (
        <div>
          <div style={{ marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Pending Invitations ({invites.length})</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Sent invitations awaiting acceptance.</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {invites.map(invite => {
              const expiresAt = new Date(invite.expires_at)
              const isExpired = expiresAt < new Date()
              return (
                <div key={invite.token} style={{
                  borderRadius: 'var(--radius)', background: 'var(--bg-elevated)', padding: '1rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  opacity: isExpired ? 0.5 : 1,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1 }}>
                    <Mail size={20} style={{ color: 'var(--text-secondary)' }} />
                    <div>
                      <div style={{ fontWeight: 500 }}>{invite.email}</div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {isExpired ? (
                          <span style={{ color: 'var(--text-danger)' }}>Expired {expiresAt.toLocaleDateString()}</span>
                        ) : (
                          <>Role: <span style={{ textTransform: 'capitalize' }}>{invite.role}</span> • Expires {expiresAt.toLocaleDateString()}</>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRevokeInvite(invite.token)}
                    style={{
                      padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)', border: 'none',
                      background: 'var(--bg-base)', color: 'var(--text-secondary)', cursor: 'pointer',
                      fontSize: '0.9rem',
                    }}
                  >
                    Revoke
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {error && (
        <div style={{
          padding: '1rem', borderRadius: 'var(--radius)', background: 'var(--bg-danger-subtle)',
          color: 'var(--text-danger)', display: 'flex', gap: '0.5rem', alignItems: 'center',
        }}>
          <AlertCircle size={20} />
          <span>{error}</span>
          <button
            onClick={() => fetchData()}
            style={{ marginLeft: 'auto', padding: '0.35rem 0.75rem', borderRadius: '0.25rem', border: 'none', background: 'var(--bg-base)', cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
