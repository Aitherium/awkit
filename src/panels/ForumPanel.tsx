'use client'

/**
 * ForumPanel -- the company's own forum (help center, what's new, discussion).
 *
 * Reads and writes go through the app backend's `/api/forum/*` proxy
 * (awkit-backend routers/forum.py), which forwards the caller's server-side
 * session to AitherRelay. Relay decides who may read: only members of this
 * company's workspace. This panel used to call `${apiBase}/relay/v1/...`, a
 * path no tenant backend serves, so it rendered "No threads yet" for everyone.
 *
 * The workspace is resolved on the SERVER from the session, never from this
 * component, so the `workspace` prop is accepted for compatibility and ignored.
 */

import { useState, useEffect, useCallback } from 'react'
import { useConfig } from '../hooks/useConfig'

export interface ForumPanelProps {
  /** @deprecated The workspace comes from the signed-in session on the server. */
  workspace?: string
}

interface ForumCategory {
  id: string
  name: string
  description?: string
  thread_count?: number
  order?: number
}

interface ForumThread {
  id: string
  category_id: string
  title: string
  author: string
  created_at: string
  updated_at: string
  replies: number
  views: number
  pinned?: boolean
  locked?: boolean
}

interface ForumPost {
  id: string
  thread_id: string
  author: string
  content: string
  created_at: string
  is_agent: boolean
}

type View =
  | { mode: 'list' }
  | { mode: 'thread'; threadId: string; title: string; categoryId: string }

/** Categories only the platform (or a workspace admin) posts in. Mirrors Relay. */
const READ_ONLY_CATEGORIES = new Set(['updates'])

const S = {
  root: { display: 'flex', flexDirection: 'column' as const, height: '100%', color: 'var(--text-primary)' },
  header: { padding: '0.75rem 1rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' } as const,
  tabs: { display: 'flex', gap: '0.25rem', padding: '0 0.75rem', borderBottom: '1px solid var(--glass-border)', overflowX: 'auto' as const },
  tab: (active: boolean) => ({
    padding: '0.5rem 0.75rem', cursor: 'pointer', fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' as const,
    borderTop: 'none', borderLeft: 'none', borderRight: 'none',
    borderBottom: active ? '2px solid var(--accent-primary, #5EC9CC)' : '2px solid transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    background: 'transparent', fontSize: '0.8rem',
  }),
  card: { background: 'var(--bg-surface)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius, 8px)', padding: '0.75rem', marginBottom: '0.5rem' } as const,
  input: { width: '100%', padding: '0.5rem 0.75rem', background: 'var(--bg-elevated)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius, 6px)', color: 'var(--text-primary)', fontSize: '0.85rem', fontFamily: 'inherit' } as const,
  btn: (variant: 'primary' | 'outline' = 'primary') => ({
    padding: '0.4rem 0.9rem', borderRadius: 'var(--radius, 6px)', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer',
    background: variant === 'primary' ? 'var(--accent-primary, #5EC9CC)' : 'transparent',
    color: variant === 'primary' ? '#fff' : 'var(--text-primary)',
    border: variant === 'primary' ? 'none' : '1px solid var(--glass-border)',
  }),
  muted: { fontSize: '0.75rem', color: 'var(--text-muted)' } as const,
  notice: { padding: '0.75rem 1rem', margin: '0.75rem', borderRadius: 'var(--radius, 6px)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontSize: '0.8rem' } as const,
}

function timeAgo(iso: string): string {
  try {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return new Date(iso).toLocaleDateString()
  } catch { return '' }
}

/** A refusal the person can act on, from the proxy's real status code. */
export function forumRefusalText(status: number): string {
  if (status === 401) return 'Sign in to see your company forum.'
  if (status === 403) return 'This forum belongs to a workspace you are not a member of.'
  if (status === 409) return 'Your company workspace is not set up on the platform yet.'
  if (status === 503) return 'The forum is unavailable right now. Try again shortly.'
  return `The forum could not be loaded (HTTP ${status}).`
}

export default function ForumPanel(_props: ForumPanelProps) {
  const { apiBase } = useConfig()
  const base = `${apiBase}/api/forum`

  const [categories, setCategories] = useState<ForumCategory[]>([])
  const [category, setCategory] = useState<string>('general')
  const [view, setView] = useState<View>({ mode: 'list' })
  const [threads, setThreads] = useState<ForumThread[]>([])
  const [posts, setPosts] = useState<ForumPost[]>([])
  const [loading, setLoading] = useState(true)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch(`${base}/categories`, { credentials: 'include' })
      if (!res.ok) { setRefusal(forumRefusalText(res.status)); return }
      const data = await res.json()
      const cats: ForumCategory[] = (data.categories || []).slice()
        .sort((a: ForumCategory, b: ForumCategory) => (a.order ?? 0) - (b.order ?? 0))
      setCategories(cats)
      setRefusal(null)
    } catch {
      setRefusal(forumRefusalText(503))
    }
  }, [base])

  const fetchThreads = useCallback(async (cat: string) => {
    setLoading(true)
    try {
      const res = await fetch(`${base}/categories/${encodeURIComponent(cat)}/threads`, { credentials: 'include' })
      if (!res.ok) { setRefusal(forumRefusalText(res.status)); setThreads([]) }
      else { const data = await res.json(); setThreads(data.threads || []) }
    } catch {
      setRefusal(forumRefusalText(503))
    }
    setLoading(false)
  }, [base])

  const fetchThread = useCallback(async (threadId: string) => {
    try {
      const res = await fetch(`${base}/threads/${encodeURIComponent(threadId)}`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setPosts(data.posts || [])
      } else {
        setWriteError(forumRefusalText(res.status))
      }
    } catch { setWriteError(forumRefusalText(503)) }
  }, [base])

  useEffect(() => { fetchCategories() }, [fetchCategories])

  useEffect(() => {
    if (view.mode === 'list') fetchThreads(category)
    if (view.mode === 'thread') fetchThread(view.threadId)
  }, [view, category, fetchThreads, fetchThread])

  const post = async (url: string, body: Record<string, unknown>): Promise<boolean> => {
    setWriteError(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        let detail: unknown = ''
        try { detail = (await res.json()).detail } catch { /* not json */ }
        setWriteError(typeof detail === 'string' && detail ? detail : forumRefusalText(res.status))
        return false
      }
      return true
    } catch {
      setWriteError(forumRefusalText(503))
      return false
    }
  }

  // The author is the signed-in person; the server sets it, never this body.
  const createThread = async () => {
    if (!newTitle.trim() || !newContent.trim()) return
    if (await post(`${base}/threads`, { category_id: category, title: newTitle.trim(), content: newContent.trim() })) {
      setNewTitle(''); setNewContent(''); setShowCreate(false)
      fetchThreads(category)
    }
  }

  const createReply = async () => {
    if (!replyContent.trim() || view.mode !== 'thread') return
    if (await post(`${base}/threads/${encodeURIComponent(view.threadId)}/posts`, { content: replyContent.trim() })) {
      setReplyContent('')
      fetchThread(view.threadId)
    }
  }

  if (refusal) {
    return <div style={S.root}><div style={S.notice}>{refusal}</div></div>
  }

  if (view.mode === 'thread') {
    const threadReadOnly = READ_ONLY_CATEGORIES.has(view.categoryId)
    return (
      <div style={S.root}>
        <div style={S.header}>
          <button onClick={() => { setView({ mode: 'list' }); setPosts([]) }} style={S.btn('outline')}>Back</button>
          <strong style={{ fontSize: '0.9rem', flex: 1 }}>{view.title}</strong>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '0.75rem' }}>
          {posts.map((p, i) => (
            <div key={p.id} style={S.card}>
              <div style={{ ...S.muted, marginBottom: 4 }}>
                <strong style={{ color: 'var(--text-secondary)' }}>{p.author}</strong>
                {i === 0 && <span style={{ marginLeft: 6, color: 'var(--accent-primary, #5EC9CC)' }}>OP</span>}
                {p.is_agent && <span style={{ marginLeft: 6, color: 'var(--accent-primary, #5EC9CC)' }}>AI</span>}
                <span style={{ marginLeft: 8 }}>{timeAgo(p.created_at)}</span>
              </div>
              <div style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{p.content}</div>
            </div>
          ))}
        </div>
        {writeError && <div style={S.notice}>{writeError}</div>}
        {threadReadOnly ? (
          <div style={{ ...S.muted, padding: '0.75rem', borderTop: '1px solid var(--glass-border)' }}>
            Release notes are read-only.
          </div>
        ) : (
          <div style={{ padding: '0.75rem', borderTop: '1px solid var(--glass-border)', display: 'flex', gap: '0.5rem' }}>
            <input
              value={replyContent}
              onChange={e => setReplyContent(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createReply()}
              placeholder="Write a reply..."
              style={{ ...S.input, flex: 1 }}
            />
            <button onClick={createReply} disabled={!replyContent.trim()} style={S.btn()}>Reply</button>
          </div>
        )}
      </div>
    )
  }

  const readOnly = READ_ONLY_CATEGORIES.has(category)
  const current = categories.find(c => c.id === category)
  return (
    <div style={S.root}>
      <div style={S.header}>
        <div>
          <strong style={{ fontSize: '0.9rem' }}>Company forum</strong>
          {current?.description && <div style={S.muted}>{current.description}</div>}
        </div>
        {!readOnly && (
          <button onClick={() => setShowCreate(!showCreate)} style={S.btn()}>New thread</button>
        )}
      </div>
      {categories.length > 0 && (
        <div style={S.tabs} role="tablist">
          {categories.map(c => (
            <button key={c.id} role="tab" aria-selected={c.id === category}
              onClick={() => { setCategory(c.id); setShowCreate(false) }} style={S.tab(c.id === category)}>
              {c.name}{typeof c.thread_count === 'number' && c.thread_count > 0 ? ` (${c.thread_count})` : ''}
            </button>
          ))}
        </div>
      )}
      {showCreate && !readOnly && (
        <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--glass-border)', background: 'var(--bg-surface)' }}>
          <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Thread title"
            style={{ ...S.input, marginBottom: 8 }} />
          <textarea value={newContent} onChange={e => setNewContent(e.target.value)} placeholder="What's on your mind?"
            rows={3} style={{ ...S.input, resize: 'none', marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowCreate(false)} style={S.btn('outline')}>Cancel</button>
            <button onClick={createThread} disabled={!newTitle.trim() || !newContent.trim()} style={S.btn()}>Post</button>
          </div>
        </div>
      )}
      {writeError && <div style={S.notice}>{writeError}</div>}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ ...S.muted, padding: '2rem', textAlign: 'center' }}>Loading forum...</div>
        ) : threads.length === 0 ? (
          <div style={{ ...S.muted, padding: '2rem', textAlign: 'center' }}>
            {readOnly ? 'No release notes yet.' : 'No threads yet. Start one!'}
          </div>
        ) : threads.map(t => (
          <button key={t.id}
            onClick={() => setView({ mode: 'thread', threadId: t.id, title: t.title, categoryId: t.category_id || category })}
            style={{
              width: '100%', textAlign: 'left', padding: '0.75rem 1rem', cursor: 'pointer',
              borderBottom: '1px solid var(--glass-border)', background: 'transparent',
              borderTop: 'none', borderLeft: 'none', borderRight: 'none',
              display: 'block', color: 'var(--text-primary)',
            }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>
              {t.pinned && <span style={{ color: 'var(--accent-amber, #f59e0b)', marginRight: 6 }}>Pinned</span>}
              {t.locked && <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>Locked</span>}
              {t.title}
            </div>
            <div style={{ ...S.muted, marginTop: 4, display: 'flex', gap: 12 }}>
              <span>{t.author}</span>
              <span>{timeAgo(t.created_at)}</span>
              <span>{t.replies} replies</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
