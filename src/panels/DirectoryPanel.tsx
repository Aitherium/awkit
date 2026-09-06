'use client'

import { useState, useEffect, useCallback } from 'react'

/* ── Types ─────────────────────────────────────────────────────────── */

interface Member {
  user_id: string
  name: string
  email: string
  role: string
  status: 'active' | 'invited' | 'suspended'
  last_active?: string
  mailbox?: string
  avatar_url?: string
}

interface Role {
  role_id: string
  name: string
  description?: string
  permissions: string[]
  member_count: number
}

interface Group {
  group_id: string
  name: string
  description?: string
  member_count: number
  members?: GroupMember[]
}

interface GroupMember {
  user_id: string
  name: string
  email: string
}

type TabKey = 'members' | 'roles' | 'groups'

const ALL_PERMISSIONS = [
  'read', 'write', 'admin', 'manage_mail', 'manage_secrets', 'manage_webhooks',
]

export interface DirectoryPanelProps {
  apiBase?: string
}

/* ── Styles ────────────────────────────────────────────────────────── */

const sBtn = (primary = false): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 6,
  border: primary ? 'none' : '1px solid var(--border)',
  background: primary ? 'var(--accent)' : 'transparent',
  color: primary ? '#fff' : 'var(--text-muted)',
  cursor: 'pointer', fontSize: '0.8rem', fontWeight: primary ? 600 : 400,
})

const sBtnDanger: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 6, border: 'none',
  background: '#dc2626', color: '#fff', cursor: 'pointer',
  fontSize: '0.8rem', fontWeight: 600,
}

const sInput: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg-deep)',
  color: 'var(--text)', width: '100%', boxSizing: 'border-box',
}

const sCard: React.CSSProperties = {
  padding: '12px 16px', borderRadius: 8,
  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
}

const sTab = (active: boolean): React.CSSProperties => ({
  padding: '8px 20px', borderRadius: '6px 6px 0 0',
  border: 'none', borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
  background: 'transparent',
  color: active ? 'var(--accent)' : 'var(--text-muted)',
  cursor: 'pointer', fontSize: '0.85rem', fontWeight: active ? 600 : 400,
})

const sBadge = (variant: string): React.CSSProperties => {
  const colors: Record<string, { bg: string; fg: string }> = {
    active: { bg: 'rgba(0,200,83,0.15)', fg: '#00c853' },
    invited: { bg: 'rgba(251,191,36,0.15)', fg: '#f59e0b' },
    suspended: { bg: 'rgba(220,38,38,0.15)', fg: '#dc2626' },
    role: { bg: 'rgba(124,58,237,0.15)', fg: 'var(--accent)' },
  }
  const c = colors[variant] ?? colors.role
  return {
    fontSize: '0.65rem', padding: '2px 8px', borderRadius: 4,
    background: c.bg, color: c.fg, fontWeight: 600, textTransform: 'capitalize' as const,
  }
}

/* ── Component ─────────────────────────────────────────────────────── */

export default function DirectoryPanel({ apiBase = '/api/directory' }: DirectoryPanelProps) {
  const [tab, setTab] = useState<TabKey>('members')
  const [loading, setLoading] = useState(true)

  // Members state
  const [members, setMembers] = useState<Member[]>([])
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')

  // Roles state
  const [roles, setRoles] = useState<Role[]>([])
  const [showCreateRole, setShowCreateRole] = useState(false)
  const [newRoleName, setNewRoleName] = useState('')
  const [newRoleDesc, setNewRoleDesc] = useState('')
  const [newRolePerms, setNewRolePerms] = useState<string[]>([])

  // Groups state
  const [groups, setGroups] = useState<Group[]>([])
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupDesc, setNewGroupDesc] = useState('')
  const [addMemberEmail, setAddMemberEmail] = useState('')

  // Confirm dialogs
  const [confirmAction, setConfirmAction] = useState<{ label: string; action: () => void } | null>(null)

  /* ── Data Fetching ───────────────────────────────────────────── */

  const fetchMembers = useCallback(async () => {
    setLoading(true)
    try {
      const resp = await fetch(`${apiBase}/members`)
      if (resp.ok) {
        const data = await resp.json()
        setMembers(data?.data?.members ?? data?.members ?? [])
      }
    } catch (e) { console.error('Members fetch error:', e) }
    setLoading(false)
  }, [apiBase])

  const fetchRoles = useCallback(async () => {
    try {
      const resp = await fetch(`${apiBase}/roles`)
      if (resp.ok) {
        const data = await resp.json()
        setRoles(data?.data?.roles ?? data?.roles ?? [])
      }
    } catch (e) { console.error('Roles fetch error:', e) }
  }, [apiBase])

  const fetchGroups = useCallback(async () => {
    try {
      const resp = await fetch(`${apiBase}/groups`)
      if (resp.ok) {
        const data = await resp.json()
        setGroups(data?.data?.groups ?? data?.groups ?? [])
      }
    } catch (e) { console.error('Groups fetch error:', e) }
  }, [apiBase])

  const fetchGroupDetail = useCallback(async (groupId: string) => {
    try {
      const resp = await fetch(`${apiBase}/groups/${groupId}`)
      if (resp.ok) {
        const data = await resp.json()
        setSelectedGroup(data?.data?.group ?? data?.group ?? data?.data ?? data)
      }
    } catch (e) { console.error('Group detail error:', e) }
  }, [apiBase])

  useEffect(() => {
    if (tab === 'members') fetchMembers()
    else if (tab === 'roles') fetchRoles()
    else if (tab === 'groups') fetchGroups()
  }, [tab, fetchMembers, fetchRoles, fetchGroups])

  /* ── Member Actions ──────────────────────────────────────────── */

  const handleInvite = async () => {
    if (!inviteEmail) return
    try {
      const resp = await fetch(`${apiBase}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      })
      if (resp.ok) {
        setShowInvite(false); setInviteEmail(''); setInviteRole('member')
        fetchMembers()
      }
    } catch (e) { console.error('Invite error:', e) }
  }

  const changeRole = async (userId: string, role: string) => {
    try {
      await fetch(`${apiBase}/members/${userId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      fetchMembers()
      if (selectedMember?.user_id === userId) {
        setSelectedMember(prev => prev ? { ...prev, role } : null)
      }
    } catch (e) { console.error('Change role error:', e) }
  }

  const changeStatus = async (userId: string, status: string) => {
    try {
      await fetch(`${apiBase}/members/${userId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      fetchMembers()
      if (selectedMember?.user_id === userId) {
        setSelectedMember(prev => prev ? { ...prev, status: status as Member['status'] } : null)
      }
    } catch (e) { console.error('Change status error:', e) }
  }

  const removeMember = async (userId: string) => {
    try {
      await fetch(`${apiBase}/members/${userId}`, { method: 'DELETE' })
      setSelectedMember(null)
      fetchMembers()
    } catch (e) { console.error('Remove member error:', e) }
  }

  /* ── Role Actions ────────────────────────────────────────────── */

  const handleCreateRole = async () => {
    if (!newRoleName) return
    try {
      const resp = await fetch(`${apiBase}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newRoleName, description: newRoleDesc, permissions: newRolePerms,
        }),
      })
      if (resp.ok) {
        setShowCreateRole(false); setNewRoleName(''); setNewRoleDesc(''); setNewRolePerms([])
        fetchRoles()
      }
    } catch (e) { console.error('Create role error:', e) }
  }

  const deleteRole = async (roleId: string) => {
    try {
      await fetch(`${apiBase}/roles/${roleId}`, { method: 'DELETE' })
      fetchRoles()
    } catch (e) { console.error('Delete role error:', e) }
  }

  /* ── Group Actions ───────────────────────────────────────────── */

  const handleCreateGroup = async () => {
    if (!newGroupName) return
    try {
      const resp = await fetch(`${apiBase}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupName, description: newGroupDesc }),
      })
      if (resp.ok) {
        setShowCreateGroup(false); setNewGroupName(''); setNewGroupDesc('')
        fetchGroups()
      }
    } catch (e) { console.error('Create group error:', e) }
  }

  const addGroupMember = async (groupId: string, email: string) => {
    if (!email) return
    try {
      await fetch(`${apiBase}/groups/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ add_member_email: email }),
      })
      setAddMemberEmail('')
      fetchGroupDetail(groupId)
      fetchGroups()
    } catch (e) { console.error('Add group member error:', e) }
  }

  const removeGroupMember = async (groupId: string, userId: string) => {
    try {
      await fetch(`${apiBase}/groups/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remove_member_id: userId }),
      })
      fetchGroupDetail(groupId)
      fetchGroups()
    } catch (e) { console.error('Remove group member error:', e) }
  }

  const deleteGroup = async (groupId: string) => {
    try {
      await fetch(`${apiBase}/groups/${groupId}`, { method: 'DELETE' })
      setSelectedGroup(null)
      fetchGroups()
    } catch (e) { console.error('Delete group error:', e) }
  }

  /* ── Helpers ─────────────────────────────────────────────────── */

  const initials = (name: string) => {
    if (!name) return '?'
    const parts = name.split(/\s+/)
    return parts.length > 1
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.substring(0, 2).toUpperCase()
  }

  const formatDate = (iso: string | undefined) => {
    if (!iso) return 'Never'
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    } catch { return iso }
  }

  const togglePerm = (perm: string) => {
    setNewRolePerms(prev =>
      prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]
    )
  }

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1000, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Directory</h2>
      </div>

      {/* Tab Bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}>
        {(['members', 'roles', 'groups'] as TabKey[]).map(t => (
          <button key={t} onClick={() => { setTab(t); setSelectedMember(null); setSelectedGroup(null) }} style={sTab(tab === t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Confirmation Dialog */}
      {confirmAction && (
        <div style={{
          ...sCard, marginBottom: '1rem', borderColor: '#dc2626',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: '0.85rem' }}>{confirmAction.label}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirmAction(null)} style={sBtn()}>Cancel</button>
            <button onClick={() => { confirmAction.action(); setConfirmAction(null) }} style={sBtnDanger}>Confirm</button>
          </div>
        </div>
      )}

      {/* ──────────── MEMBERS TAB ──────────── */}
      {tab === 'members' && (
        <div>
          {/* Invite Button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button onClick={() => setShowInvite(!showInvite)} style={sBtn(true)}>+ Invite User</button>
          </div>

          {/* Invite Form */}
          {showInvite && (
            <div style={{ ...sCard, marginBottom: '1rem' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Email</label>
                  <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="user@example.com" style={sInput} />
                </div>
                <div style={{ width: 160 }}>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Role</label>
                  <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={sInput}>
                    {roles.length > 0
                      ? roles.map(r => <option key={r.role_id} value={r.name}>{r.name}</option>)
                      : <>
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                          <option value="viewer">Viewer</option>
                        </>
                    }
                  </select>
                </div>
                <button onClick={handleInvite} style={sBtn(true)}>Send Invite</button>
                <button onClick={() => setShowInvite(false)} style={sBtn()}>Cancel</button>
              </div>
            </div>
          )}

          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading members...</div>
          ) : (
            <div style={{ display: 'flex', gap: 16 }}>
              {/* Member List */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {members.length === 0 && (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
                    No members yet. Invite your first team member.
                  </div>
                )}
                {members.map(m => (
                  <div
                    key={m.user_id}
                    onClick={() => setSelectedMember(m)}
                    style={{
                      ...sCard, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                      borderColor: selectedMember?.user_id === m.user_id ? 'var(--accent)' : 'var(--border)',
                    }}
                  >
                    {/* Avatar */}
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                      background: 'var(--accent)', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.7rem', fontWeight: 700,
                    }}>
                      {initials(m.name || m.email)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>{m.name || m.email}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{m.email}</div>
                    </div>
                    <span style={sBadge('role')}>{m.role}</span>
                    <span style={sBadge(m.status)}>{m.status}</span>
                  </div>
                ))}
              </div>

              {/* Member Detail Panel */}
              {selectedMember && (
                <div style={{ width: 300, flexShrink: 0 }}>
                  <div style={sCard}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                      <h3 style={{ margin: 0, fontSize: '1rem' }}>Member Details</h3>
                      <button onClick={() => setSelectedMember(null)} style={sBtn()}>Close</button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                      <div style={{
                        width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
                        background: 'var(--accent)', color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.9rem', fontWeight: 700,
                      }}>
                        {initials(selectedMember.name || selectedMember.email)}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{selectedMember.name || selectedMember.email}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{selectedMember.email}</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {/* Role */}
                      <div>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Role</label>
                        <select
                          value={selectedMember.role}
                          onChange={e => changeRole(selectedMember.user_id, e.target.value)}
                          style={sInput}
                        >
                          {roles.length > 0
                            ? roles.map(r => <option key={r.role_id} value={r.name}>{r.name}</option>)
                            : <>
                                <option value="admin">Admin</option>
                                <option value="member">Member</option>
                                <option value="viewer">Viewer</option>
                              </>
                          }
                        </select>
                      </div>

                      {/* Status */}
                      <div>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Status</label>
                        <span style={sBadge(selectedMember.status)}>{selectedMember.status}</span>
                      </div>

                      {/* Last Active */}
                      <div>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Last Active</label>
                        <span style={{ fontSize: '0.8rem' }}>{formatDate(selectedMember.last_active)}</span>
                      </div>

                      {/* Mailbox */}
                      {selectedMember.mailbox && (
                        <div>
                          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Mailbox</label>
                          <span style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>{selectedMember.mailbox}</span>
                        </div>
                      )}

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                        {selectedMember.status === 'active' && (
                          <button onClick={() => setConfirmAction({
                            label: `Suspend ${selectedMember.name || selectedMember.email}?`,
                            action: () => changeStatus(selectedMember.user_id, 'suspended'),
                          })} style={sBtn()}>
                            Suspend
                          </button>
                        )}
                        {selectedMember.status === 'suspended' && (
                          <button onClick={() => changeStatus(selectedMember.user_id, 'active')} style={sBtn()}>
                            Reactivate
                          </button>
                        )}
                        <button onClick={() => setConfirmAction({
                          label: `Remove ${selectedMember.name || selectedMember.email} from workspace?`,
                          action: () => removeMember(selectedMember.user_id),
                        })} style={{ ...sBtn(), color: '#dc2626' }}>
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ──────────── ROLES TAB ──────────── */}
      {tab === 'roles' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button onClick={() => setShowCreateRole(!showCreateRole)} style={sBtn(true)}>+ Create Role</button>
          </div>

          {/* Create Role Form */}
          {showCreateRole && (
            <div style={{ ...sCard, marginBottom: '1rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                <input value={newRoleName} onChange={e => setNewRoleName(e.target.value)} placeholder="Role name" style={sInput} />
                <input value={newRoleDesc} onChange={e => setNewRoleDesc(e.target.value)} placeholder="Description (optional)" style={sInput} />
                <div>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Permissions</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {ALL_PERMISSIONS.map(perm => (
                      <label key={perm} style={{
                        display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem',
                        cursor: 'pointer', padding: '4px 10px', borderRadius: 6,
                        background: newRolePerms.includes(perm) ? 'rgba(124,58,237,0.15)' : 'var(--bg-deep)',
                        border: '1px solid var(--border)',
                      }}>
                        <input
                          type="checkbox"
                          checked={newRolePerms.includes(perm)}
                          onChange={() => togglePerm(perm)}
                          style={{ accentColor: 'var(--accent)' }}
                        />
                        {perm}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => { setShowCreateRole(false); setNewRoleName(''); setNewRoleDesc(''); setNewRolePerms([]) }} style={sBtn()}>Cancel</button>
                <button onClick={handleCreateRole} style={sBtn(true)}>Create Role</button>
              </div>
            </div>
          )}

          {/* Roles List */}
          {roles.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
              No custom roles. Create one to fine-tune permissions.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {roles.map(r => (
              <div key={r.role_id} style={{ ...sCard, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{r.name}</div>
                  {r.description && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{r.description}</div>
                  )}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    {(r.permissions || []).map(p => (
                      <span key={p} style={sBadge('role')}>{p}</span>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{r.member_count} members</span>
                  <button onClick={() => setConfirmAction({
                    label: `Delete role "${r.name}"?`,
                    action: () => deleteRole(r.role_id),
                  })} style={{ ...sBtn(), color: '#dc2626' }}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ──────────── GROUPS TAB ──────────── */}
      {tab === 'groups' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button onClick={() => setShowCreateGroup(!showCreateGroup)} style={sBtn(true)}>+ Create Group</button>
          </div>

          {/* Create Group Form */}
          {showCreateGroup && (
            <div style={{ ...sCard, marginBottom: '1rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="Group name" style={sInput} />
                <input value={newGroupDesc} onChange={e => setNewGroupDesc(e.target.value)} placeholder="Description (optional)" style={sInput} />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => { setShowCreateGroup(false); setNewGroupName(''); setNewGroupDesc('') }} style={sBtn()}>Cancel</button>
                <button onClick={handleCreateGroup} style={sBtn(true)}>Create Group</button>
              </div>
            </div>
          )}

          {groups.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
              No groups yet. Create one to organize team members.
            </div>
          )}

          <div style={{ display: 'flex', gap: 16 }}>
            {/* Group List */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {groups.map(g => (
                <div
                  key={g.group_id}
                  onClick={() => fetchGroupDetail(g.group_id)}
                  style={{
                    ...sCard, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    cursor: 'pointer',
                    borderColor: selectedGroup?.group_id === g.group_id ? 'var(--accent)' : 'var(--border)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{g.name}</div>
                    {g.description && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{g.description}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{g.member_count} members</span>
                    <button onClick={e => { e.stopPropagation(); setConfirmAction({
                      label: `Delete group "${g.name}"?`,
                      action: () => deleteGroup(g.group_id),
                    }) }} style={{ ...sBtn(), color: '#dc2626' }}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Group Detail Panel */}
            {selectedGroup && (
              <div style={{ width: 320, flexShrink: 0 }}>
                <div style={sCard}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <h3 style={{ margin: 0, fontSize: '1rem' }}>{selectedGroup.name}</h3>
                    <button onClick={() => setSelectedGroup(null)} style={sBtn()}>Close</button>
                  </div>
                  {selectedGroup.description && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>{selectedGroup.description}</div>
                  )}

                  {/* Add Member */}
                  <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                    <input
                      value={addMemberEmail}
                      onChange={e => setAddMemberEmail(e.target.value)}
                      placeholder="Add by email..."
                      style={{ ...sInput, fontSize: '0.8rem' }}
                    />
                    <button onClick={() => addGroupMember(selectedGroup.group_id, addMemberEmail)} style={sBtn(true)}>Add</button>
                  </div>

                  {/* Group Members */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(!selectedGroup.members || selectedGroup.members.length === 0) && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem 0' }}>
                        No members in this group.
                      </div>
                    )}
                    {selectedGroup.members?.map(gm => (
                      <div key={gm.user_id} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '6px 10px', borderRadius: 6, background: 'var(--bg-deep)',
                      }}>
                        <div>
                          <div style={{ fontWeight: 500, fontSize: '0.8rem' }}>{gm.name || gm.email}</div>
                          {gm.name && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{gm.email}</div>}
                        </div>
                        <button
                          onClick={() => removeGroupMember(selectedGroup.group_id, gm.user_id)}
                          style={{ ...sBtn(), fontSize: '0.7rem', padding: '3px 8px', color: '#dc2626' }}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
