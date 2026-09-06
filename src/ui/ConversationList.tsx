import { useCallback, useEffect, useState } from 'react'

interface Conversation {
  conversation_id: string
  title: string
  started_by: string
  visibility: string
  started_at: string | null
  message_count: number
}

interface Props {
  activeId: string | null
  onSelect: (id: string) => void
  /** Bump this number from the parent to force a re-fetch (e.g. after a new
   *  conversation is created by the chat endpoint). */
  refreshKey?: number
}

export default function ConversationList({ activeId, onSelect, refreshKey = 0 }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [authError, setAuthError] = useState(false)

  const reload = useCallback(async () => {
    // Two parallel sources of truth: the native chat router
    // (`/api/chat/conversations`) and the aitherchat ReAct loop
    // (`/api/chat/aither/conversations`). Different apps wire one, the other,
    // or both -- so we union them and dedupe by conversation_id.
    let saw401 = false
    const safeJson = async (url: string): Promise<any> => {
      try {
        const r = await fetch(url, { credentials: 'include' })
        if (r.status === 401 || r.status === 403) { saw401 = true; return null }
        if (!r.ok) return null
        return await r.json()
      } catch { return null }
    }

    const [nativeRaw, aitherRaw] = await Promise.all([
      safeJson('/api/chat/conversations'),
      safeJson('/api/chat/aither/conversations'),
    ])

    const merged = new Map<string, Conversation>()

    // Native shape: array of full Conversation objects.
    const nativeList = Array.isArray(nativeRaw) ? nativeRaw : (nativeRaw?.conversations || [])
    for (const c of nativeList) {
      if (!c?.conversation_id) continue
      merged.set(c.conversation_id, {
        conversation_id: c.conversation_id,
        title: c.title || c.preview || c.conversation_id,
        started_by: c.started_by || c.user_id || '',
        visibility: c.visibility || 'private',
        started_at: c.started_at || c.last_at || null,
        message_count: c.message_count ?? c.n ?? 0,
      })
    }

    // Aither shape: { conversations: [{ conversation_id, last_at, message_count, preview }] }
    const aitherList = aitherRaw?.conversations || []
    for (const c of aitherList) {
      if (!c?.conversation_id) continue
      // If native already has it, keep native (it has richer metadata).
      if (merged.has(c.conversation_id)) continue
      merged.set(c.conversation_id, {
        conversation_id: c.conversation_id,
        title: (c.preview || '').slice(0, 80) || c.conversation_id,
        started_by: 'agent',
        visibility: 'private',
        started_at: c.last_at || null,
        message_count: c.message_count ?? 0,
      })
    }

    // Sort by started_at desc when available.
    const out = Array.from(merged.values()).sort((a, b) => {
      const ax = a.started_at ? Date.parse(a.started_at) : 0
      const bx = b.started_at ? Date.parse(b.started_at) : 0
      return bx - ax
    })
    setAuthError(saw401 && out.length === 0)
    setConversations(out)
  }, [])

  useEffect(() => { reload() }, [reload, refreshKey])

  // Refresh when the active conversation changes (a new one likely got
  // persisted after the previous send).
  useEffect(() => { reload() }, [activeId, reload])

  const handleDelete = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!window.confirm('Delete this conversation? This cannot be undone.')) return
    setDeletingId(id)
    try {
      // Best-effort delete from both stores; ignore individual failures so a
      // missing endpoint on either side doesn't block the UX.
      await Promise.all([
        fetch(`/api/chat/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {}),
        fetch(`/api/chat/aither/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {}),
      ])
      setConversations(prev => prev.filter(c => c.conversation_id !== id))
      if (activeId === id) onSelect('')
    } catch {
      // ignore -- list will be reloaded next interaction
    } finally {
      setDeletingId(null)
    }
  }, [activeId, onSelect])

  return (
    <div style={{ overflow: 'auto', maxHeight: 300 }}>
      <div style={{
        padding: '0.5rem 0.75rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <h3 style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          Conversations
        </h3>
        <button
          onClick={() => onSelect('')}
          style={{
            background: 'var(--accent-primary)',
            color: 'var(--bg-deep)',
            padding: '0.2rem 0.5rem',
            borderRadius: 4,
            fontSize: '0.7rem',
            fontWeight: 600,
          }}
        >
          + New
        </button>
      </div>
      {conversations.length === 0 && (
        <div style={{
          padding: '0.5rem 0.75rem',
          fontSize: '0.75rem',
          color: authError ? 'var(--accent-danger, #f87171)' : 'var(--text-primary, var(--text-muted))',
          fontStyle: 'italic',
        }}>
          {authError ? 'Sign in to load conversation history.' : 'No conversations yet.'}
        </div>
      )}
      {conversations.map(c => {
        const active = activeId === c.conversation_id
        const deleting = deletingId === c.conversation_id
        return (
          <div
            key={c.conversation_id}
            onClick={() => onSelect(c.conversation_id)}
            style={{
              padding: '0.5rem 0.75rem',
              cursor: 'pointer',
              background: active ? 'var(--bg-surface)' : 'transparent',
              borderLeft: active ? '3px solid var(--accent-primary)' : '3px solid transparent',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              opacity: deleting ? 0.4 : 1,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.title}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {c.started_by} · {c.message_count} msgs
              </div>
            </div>
            <button
              onClick={(e) => handleDelete(e, c.conversation_id)}
              title="Delete conversation"
              disabled={deleting}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: deleting ? 'wait' : 'pointer',
                fontSize: '0.95rem',
                padding: '0 4px',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
