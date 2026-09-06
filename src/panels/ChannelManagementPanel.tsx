'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useConfig } from '../hooks/useConfig'

interface Channel {
  id?: string
  name: string
  description?: string
  is_private?: boolean
  workspace_id?: string
}

interface Props {
  apiBase?: string
  workspace?: string
}

export default function ChannelManagementPanel({
  apiBase = '/api/relay/v1',
  workspace,
}: Props) {
  const { user } = useAuth()
  const config = useConfig()

  // Determine workspace_id: prop > config > tenant_id
  const ws =
    workspace ||
    config?.workspace_slug ||
    config?.tenant_id ||
    (user?.tenant_id as string | undefined)

  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Form states for create/edit
  const [isCreating, setIsCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formPrivate, setFormPrivate] = useState(false)
  const [formStatus, setFormStatus] = useState('')

  // Fetch channels
  const fetchChannels = useCallback(async () => {
    if (!ws) {
      setLoading(false)
      return
    }
    try {
      const r = await fetch(
        `${apiBase}/channels?workspace_id=${encodeURIComponent(ws)}`
      )
      if (r.ok) {
        const data = await r.json()
        setChannels(data.channels || data.items || [])
      } else {
        setError('Failed to load channels')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [apiBase, ws])

  useEffect(() => {
    fetchChannels()
  }, [fetchChannels])

  // Create channel
  const createChannel = async () => {
    if (!formName.trim() || !ws) return
    setFormStatus('Creating...')
    try {
      const r = await fetch(`${apiBase}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: ws,
          name: formName,
          description: formDesc,
          is_private: formPrivate,
        }),
      })
      if (r.ok) {
        setFormStatus('Channel created!')
        setFormName('')
        setFormDesc('')
        setFormPrivate(false)
        setIsCreating(false)
        await fetchChannels()
      } else {
        const d = await r.json()
        setFormStatus(d.detail || d.error || 'Failed to create channel')
      }
    } catch (e) {
      setFormStatus('Error: ' + String(e))
    }
    setTimeout(() => setFormStatus(''), 3000)
  }

  // Update channel
  const updateChannel = async (ch: Channel) => {
    if (!ch.id || !ws) return
    setFormStatus('Updating...')
    try {
      const r = await fetch(`${apiBase}/channels/${encodeURIComponent(ch.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: ws,
          name: formName || ch.name,
          description: formDesc !== '' ? formDesc : ch.description,
          is_private: formPrivate !== undefined ? formPrivate : ch.is_private,
        }),
      })
      if (r.ok) {
        setFormStatus('Channel updated!')
        setEditingId(null)
        setFormName('')
        setFormDesc('')
        setFormPrivate(false)
        await fetchChannels()
      } else {
        const d = await r.json()
        setFormStatus(d.detail || d.error || 'Failed to update channel')
      }
    } catch (e) {
      setFormStatus('Error: ' + String(e))
    }
    setTimeout(() => setFormStatus(''), 3000)
  }

  // Delete channel
  const deleteChannel = async (ch: Channel) => {
    if (!ch.id || !ws) return
    if (!confirm(`Delete channel "#${ch.name}"? This cannot be undone.`)) return
    setFormStatus('Deleting...')
    try {
      const r = await fetch(`${apiBase}/channels/${encodeURIComponent(ch.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: ws }),
      })
      if (r.ok) {
        setFormStatus('Channel deleted!')
        await fetchChannels()
      } else {
        const d = await r.json()
        setFormStatus(d.detail || d.error || 'Failed to delete channel')
      }
    } catch (e) {
      setFormStatus('Error: ' + String(e))
    }
    setTimeout(() => setFormStatus(''), 3000)
  }

  if (loading) {
    return (
      <div style={{ padding: '1rem', color: 'var(--text-muted, #888)' }}>
        Loading channels...
      </div>
    )
  }

  if (!ws) {
    return (
      <div style={{ padding: '1rem', color: 'var(--text-muted, #888)' }}>
        No workspace context available
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {/* Create new channel form */}
      <div
        style={{
          padding: '1rem',
          background: 'var(--bg-surface, #1a1a1a)',
          borderRadius: 'var(--radius, 6px)',
          border: '1px solid var(--glass-border, #333)',
        }}
      >
        <h3 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          {isCreating ? 'Create New Channel' : 'Create Channel'}
        </h3>
        {!isCreating ? (
          <button
            onClick={() => setIsCreating(true)}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--accent-primary, #6366f1)',
              color: 'var(--bg-deep, #000)',
              borderRadius: 'var(--radius, 6px)',
              fontSize: '0.8rem',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Create Channel
          </button>
        ) : (
          <div style={{ display: 'grid', gap: '0.4rem' }}>
            <input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Channel name (e.g. general, support)"
              style={inputStyle}
            />
            <input
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
              placeholder="Description (optional)"
              style={inputStyle}
            />
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.8rem',
                color: 'var(--text-primary, #fff)',
              }}
            >
              <input
                type="checkbox"
                checked={formPrivate}
                onChange={(e) => setFormPrivate(e.target.checked)}
              />
              Private channel (members only)
            </label>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                onClick={createChannel}
                disabled={!formName.trim()}
                style={{
                  padding: '0.5rem 1rem',
                  background: 'var(--accent-primary, #6366f1)',
                  color: 'var(--bg-deep, #000)',
                  borderRadius: 'var(--radius, 6px)',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  border: 'none',
                  cursor: formName.trim() ? 'pointer' : 'default',
                  opacity: formName.trim() ? 1 : 0.4,
                }}
              >
                Create
              </button>
              <button
                onClick={() => {
                  setIsCreating(false)
                  setFormName('')
                  setFormDesc('')
                  setFormPrivate(false)
                  setFormStatus('')
                }}
                style={{
                  padding: '0.5rem 1rem',
                  background: 'var(--bg-elevated, #222)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--glass-border, #333)',
                  borderRadius: 'var(--radius, 6px)',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {formStatus && (
          <p
            style={{
              fontSize: '0.75rem',
              color:
                formStatus.includes('fail') ||
                formStatus.includes('Error') ||
                formStatus.includes('Failed')
                  ? 'var(--accent-coral, #f87171)'
                  : 'var(--accent-green, #4ade80)',
              marginTop: '0.5rem',
              margin: '0.5rem 0 0 0',
            }}
          >
            {formStatus}
          </p>
        )}
      </div>

      {/* Channel list */}
      {error && (
        <div
          style={{
            padding: '0.75rem',
            background: 'var(--bg-elevated, #222)',
            border: '1px solid var(--accent-coral, #f87171)',
            borderRadius: 'var(--radius, 6px)',
            color: 'var(--accent-coral, #f87171)',
            fontSize: '0.8rem',
          }}
        >
          {error}
        </div>
      )}

      {channels.length === 0 ? (
        <p
          style={{
            color: 'var(--text-muted, #888)',
            textAlign: 'center',
            padding: '1.5rem',
            fontSize: '0.8rem',
          }}
        >
          No channels yet. Create one to get started.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          {channels.map((ch, i) => (
            <div
              key={ch.id || i}
              style={{
                display: 'grid',
                alignItems: editingId === ch.id ? 'start' : 'center',
                gap: '0.75rem',
                gridTemplateColumns: editingId === ch.id ? '1fr' : 'auto 1fr auto',
                padding: '0.6rem 0.85rem',
                background:
                  editingId === ch.id
                    ? 'var(--bg-elevated, #222)'
                    : 'var(--bg-surface, #1a1a1a)',
                borderRadius: 'var(--radius, 6px)',
                border: '1px solid var(--glass-border, #333)',
              }}
            >
              {editingId === ch.id ? (
                <>
                  <div style={{ display: 'grid', gap: '0.4rem' }}>
                    <input
                      value={formName || ch.name}
                      onChange={(e) => setFormName(e.target.value)}
                      style={inputStyle}
                    />
                    <input
                      value={formDesc !== '' ? formDesc : ch.description || ''}
                      onChange={(e) => setFormDesc(e.target.value)}
                      placeholder="Description (optional)"
                      style={inputStyle}
                    />
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        fontSize: '0.8rem',
                        color: 'var(--text-primary, #fff)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={
                          formPrivate !== undefined
                            ? formPrivate
                            : ch.is_private ?? false
                        }
                        onChange={(e) => setFormPrivate(e.target.checked)}
                      />
                      Private channel (members only)
                    </label>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button
                        onClick={() => updateChannel(ch)}
                        style={{
                          padding: '0.35rem 0.7rem',
                          background: 'var(--accent-primary, #6366f1)',
                          color: 'var(--bg-deep, #000)',
                          borderRadius: 4,
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          border: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(null)
                          setFormName('')
                          setFormDesc('')
                          setFormPrivate(false)
                          setFormStatus('')
                        }}
                        style={{
                          padding: '0.35rem 0.7rem',
                          background: 'var(--bg-deep, #0a0a0a)',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--glass-border, #333)',
                          borderRadius: 4,
                          fontSize: '0.7rem',
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '1rem' }}>
                    {ch.is_private ? '🔒' : '🌐'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '0.82rem',
                        fontWeight: 500,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        marginBottom: '0.2rem',
                      }}
                    >
                      #{ch.name}
                      {ch.is_private && (
                        <span
                          style={{
                            fontSize: '0.65rem',
                            padding: '0.1rem 0.35rem',
                            background: 'var(--accent-coral, #f87171)',
                            color: 'white',
                            borderRadius: 2,
                            fontWeight: 400,
                          }}
                        >
                          private
                        </span>
                      )}
                    </div>
                    {ch.description && (
                      <div
                        style={{
                          fontSize: '0.7rem',
                          color: 'var(--text-muted, #888)',
                        }}
                      >
                        {ch.description}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.3rem' }}>
                    <button
                      onClick={() => {
                        setEditingId(ch.id || null)
                        setFormName(ch.name)
                        setFormDesc(ch.description || '')
                        setFormPrivate(ch.is_private ?? false)
                      }}
                      style={{
                        padding: '0.3rem 0.6rem',
                        background: 'var(--bg-elevated, #222)',
                        color: 'var(--text-secondary)',
                        fontSize: '0.7rem',
                        border: '1px solid var(--glass-border, #333)',
                        borderRadius: 4,
                        cursor: 'pointer',
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteChannel(ch)}
                      style={{
                        padding: '0.3rem 0.6rem',
                        background: 'transparent',
                        color: 'var(--accent-coral, #f87171)',
                        fontSize: '0.7rem',
                        border: '1px solid var(--accent-coral, #f87171)',
                        borderRadius: 4,
                        cursor: 'pointer',
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  background: 'var(--bg-deep, #0a0a0a)',
  border: '1px solid var(--glass-border, #333)',
  borderRadius: 'var(--radius, 6px)',
  color: 'var(--text-primary, #fff)',
  fontSize: '0.82rem',
}
