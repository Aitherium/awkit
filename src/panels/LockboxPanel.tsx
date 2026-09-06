'use client'

import { useState, useEffect, useCallback } from 'react'

/* ── Types ─────────────────────────────────────────────────────────── */

interface Prompt {
  prompt_id: string
  title: string
  category?: string
  created_at: string
  modified_at?: string
  is_starred?: boolean
}

interface PromptDetail {
  prompt_id: string
  title: string
  content: string
  category?: string
  visibility?: string
  created_at: string
  modified_at?: string
}

export interface LockboxPanelProps {
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

/* ── Component ─────────────────────────────────────────────────────── */

export default function LockboxPanel({ apiBase = '/lockbox' }: LockboxPanelProps) {
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [loading, setLoading] = useState(true)
  const [vaultStatus, setVaultStatus] = useState<Record<string, any> | null>(null)
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null)
  const [selectedPromptDetail, setSelectedPromptDetail] = useState<PromptDetail | null>(null)

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newCategory, setNewCategory] = useState('')

  // Edit form
  const [editPromptId, setEditPromptId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')

  // Delete confirmation
  const [deletePromptId, setDeletePromptId] = useState<string | null>(null)

  /* ── Data Fetching ───────────────────────────────────────────── */

  const fetchVaultStatus = useCallback(async () => {
    try {
      const resp = await fetch(`${apiBase}/vault/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (resp.ok) {
        const data = await resp.json()
        setVaultStatus(data?.vault || data)
      }
    } catch (e) {
      console.error('Vault status fetch error:', e)
    }
  }, [apiBase])

  const fetchPrompts = useCallback(async () => {
    setLoading(true)
    try {
      const resp = await fetch(`${apiBase}/list-prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (resp.ok) {
        const data = await resp.json()
        setPrompts(data?.prompts ?? data?.data?.prompts ?? [])
      }
    } catch (e) {
      console.error('Prompts fetch error:', e)
    }
    setLoading(false)
  }, [apiBase])

  useEffect(() => {
    fetchVaultStatus()
    fetchPrompts()
  }, [fetchVaultStatus, fetchPrompts])

  /* ── Actions ─────────────────────────────────────────────────── */

  const handleSelectPrompt = async (promptId: string) => {
    if (selectedPromptId === promptId) {
      setSelectedPromptId(null)
      setSelectedPromptDetail(null)
      return
    }
    try {
      const resp = await fetch(`${apiBase}/get-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt_id: promptId }),
      })
      if (resp.ok) {
        const data = await resp.json()
        setSelectedPromptDetail(data?.prompt || data?.data?.prompt || null)
        setSelectedPromptId(promptId)
      }
    } catch (e) {
      console.error('Fetch prompt detail error:', e)
    }
  }

  const handleCreate = async () => {
    if (!newTitle || !newContent) return
    try {
      const resp = await fetch(`${apiBase}/store-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle,
          content: newContent,
          category: newCategory || undefined,
        }),
      })
      if (resp.ok) {
        setShowCreate(false)
        setNewTitle('')
        setNewContent('')
        setNewCategory('')
        fetchPrompts()
      }
    } catch (e) {
      console.error('Create prompt error:', e)
    }
  }

  const handleUpdate = async () => {
    if (!editPromptId || !editContent) return
    try {
      const resp = await fetch(`${apiBase}/update-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt_id: editPromptId,
          content: editContent,
        }),
      })
      if (resp.ok) {
        setEditPromptId(null)
        setEditContent('')
        setSelectedPromptId(null)
        setSelectedPromptDetail(null)
        fetchPrompts()
      }
    } catch (e) {
      console.error('Update prompt error:', e)
    }
  }

  const handleDelete = async (promptId: string) => {
    try {
      const resp = await fetch(`${apiBase}/delete-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt_id: promptId }),
      })
      if (resp.ok) {
        setDeletePromptId(null)
        setSelectedPromptId(null)
        setSelectedPromptDetail(null)
        fetchPrompts()
      }
    } catch (e) {
      console.error('Delete prompt error:', e)
    }
  }

  /* ── Helpers ─────────────────────────────────────────────────── */

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      })
    } catch {
      return iso
    }
  }

  /* ── Render ──────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading lockbox...
      </div>
    )
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1000, margin: '0 auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Private Prompts Lockbox</h2>
          {vaultStatus && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
              {vaultStatus.prompt_count || 0} prompts stored
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowCreate(!showCreate)} style={sBtn(true)}>
            + New Prompt
          </button>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {deletePromptId && (
        <div
          style={{
            ...sCard,
            marginBottom: '1rem',
            borderColor: '#dc2626',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: '0.85rem' }}>
            Permanently delete this prompt? This cannot be undone.
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setDeletePromptId(null)} style={sBtn()}>
              Cancel
            </button>
            <button
              onClick={() => handleDelete(deletePromptId)}
              style={sBtnDanger}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Create Form */}
      {showCreate && (
        <div style={{ ...sCard, marginBottom: '1rem' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 10,
              marginBottom: 10,
            }}
          >
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Prompt Title"
              style={{ ...sInput, gridColumn: '1 / -1' }}
            />
            <input
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="Category (optional)"
              style={sInput}
            />
            <div style={{ flex: 1 }} />
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Prompt content..."
              rows={6}
              style={{
                ...sInput,
                gridColumn: '1 / -1',
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                resize: 'vertical',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowCreate(false)} style={sBtn()}>
              Cancel
            </button>
            <button onClick={handleCreate} style={sBtn(true)}>
              Create Prompt
            </button>
          </div>
        </div>
      )}

      {/* Edit Form */}
      {editPromptId && (
        <div style={{ ...sCard, marginBottom: '1rem', borderColor: 'var(--accent)' }}>
          <div
            style={{
              fontSize: '0.85rem',
              fontWeight: 600,
              marginBottom: 8,
            }}
          >
            Edit Prompt
          </div>
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            placeholder="Prompt content..."
            rows={6}
            style={{
              ...sInput,
              marginBottom: 10,
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={() => {
                setEditPromptId(null)
                setEditContent('')
              }}
              style={sBtn()}
            >
              Cancel
            </button>
            <button onClick={handleUpdate} style={sBtn(true)}>
              Update
            </button>
          </div>
        </div>
      )}

      {/* Prompts List */}
      {prompts.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            color: 'var(--text-muted)',
            padding: '3rem 0',
          }}
        >
          No prompts in lockbox. Add your first prompt above.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {prompts.map((prompt) => (
          <div key={prompt.prompt_id} style={sCard}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                    {prompt.title}
                  </div>
                  {prompt.category && (
                    <span
                      style={{
                        fontSize: '0.65rem',
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: 'rgba(124,58,237,0.15)',
                        color: 'var(--accent)',
                      }}
                    >
                      {prompt.category}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)',
                    marginTop: 4,
                  }}
                >
                  Created: {formatDate(prompt.created_at)}
                  {prompt.modified_at && ` • Modified: ${formatDate(prompt.modified_at)}`}
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  flexShrink: 0,
                }}
              >
                <button
                  onClick={() => handleSelectPrompt(prompt.prompt_id)}
                  style={sBtn()}
                >
                  {selectedPromptId === prompt.prompt_id ? 'Hide' : 'View'}
                </button>
                <button
                  onClick={() => {
                    setEditPromptId(prompt.prompt_id)
                    setEditContent(selectedPromptDetail?.content || '')
                  }}
                  style={sBtn()}
                >
                  Edit
                </button>
                <button
                  onClick={() => setDeletePromptId(prompt.prompt_id)}
                  style={{ ...sBtn(), color: '#dc2626' }}
                >
                  Delete
                </button>
              </div>
            </div>

            {/* Prompt Content (inline expand) */}
            {selectedPromptId === prompt.prompt_id && selectedPromptDetail && (
              <div
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: '1px solid var(--border)',
                }}
              >
                <div
                  style={{
                    fontSize: '0.75rem',
                    fontFamily: 'monospace',
                    color: 'var(--text-muted)',
                    background: 'var(--bg-deep)',
                    padding: '8px 12px',
                    borderRadius: 4,
                    whiteSpace: 'pre-wrap',
                    wordWrap: 'break-word',
                    maxHeight: 300,
                    overflowY: 'auto',
                  }}
                >
                  {selectedPromptDetail.content}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
