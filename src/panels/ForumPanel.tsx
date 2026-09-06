'use client'

import { useState, useEffect, useCallback } from 'react'
import { useConfig } from '../hooks/useConfig'

export interface ForumPanelProps {
  workspace?: string
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
  | { mode: 'thread'; threadId: string; title: string }

function timeAgo(iso: string): string {
  try {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return new Date(iso).toLocaleDateString()
  } catch { return '' }
}

export default function ForumPanel({ workspace }: ForumPanelProps) {
  const { apiBase } = useConfig()
  const base = workspace
    ? `${apiBase}/relay/v1/workspaces/${encodeURIComponent(workspace)}/forum`
    : `${apiBase}/relay/v1/forum`

  const [view, setView] = useState<View>({ mode: 'list' })
  const [threads, setThreads] = useState<ForumThread[]>([])
  const [posts, setPosts] = useState<ForumPost[]>([])
  const [loading, setLoading] = useState(true)
  const [replyContent, setReplyContent] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')

  const fetchThreads = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${base}/categories/general/threads`)
      if (res.ok) {
        const data = await res.json()
        setThreads(data.threads || [])
      }
    } catch {}
    setLoading(false)
  }, [base])

  const fetchThread = useCallback(async (threadId: string) => {
    try {
      const res = await fetch(`${base}/threads/${threadId}`)
      if (res.ok) {
        const data = await res.json()
        setPosts(data.posts || [])
      }
    } catch {}
  }, [base])

  useEffect(() => {
    if (view.mode === 'list') fetchThreads()
    if (view.mode === 'thread') fetchThread(view.threadId)
  }, [view, fetchThreads, fetchThread])

  const createThread = async () => {
    if (!newTitle.trim() || !newContent.trim()) return
    try {
      const res = await fetch(`${base}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category_id: 'general', title: newTitle.trim(),
          author: 'portal-user', content: newContent.trim(), is_agent: false,
        }),
      })
      if (res.ok) {
        setNewTitle(''); setNewContent(''); setShowCreate(false)
        fetchThreads()
      }
    } catch {}
  }

  const createReply = async () => {
    if (!replyContent.trim() || view.mode !== 'thread') return
    try {
      const res = await fetch(`${base}/threads/${view.threadId}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: 'portal-user', content: replyContent.trim(), is_agent: false }),
      })
      if (res.ok) {
        setReplyContent('')
        fetchThread(view.threadId)
      }
    } catch {}
  }

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>Loading forum...</div>
  }

  if (view.mode === 'thread') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => { setView({ mode: 'list' }); setPosts([]) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>
            ← Back
          </button>
          <strong style={{ fontSize: 14 }}>{view.title}</strong>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {posts.map((p, i) => (
            <div key={p.id} style={{
              padding: 12, marginBottom: 8, borderRadius: 8,
              background: i === 0 ? '#f0f4ff' : '#f9fafb',
              border: '1px solid #e5e7eb',
            }}>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                <strong>{p.author}</strong>
                {i === 0 && <span style={{ marginLeft: 6, color: '#4f46e5', fontSize: 10 }}>OP</span>}
                {p.is_agent && <span style={{ marginLeft: 6, color: '#7c3aed', fontSize: 10 }}>AI</span>}
                <span style={{ marginLeft: 8 }}>{timeAgo(p.created_at)}</span>
              </div>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{p.content}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: 12, borderTop: '1px solid #e5e7eb', display: 'flex', gap: 8 }}>
          <input
            value={replyContent}
            onChange={e => setReplyContent(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createReply()}
            placeholder="Write a reply..."
            style={{ flex: 1, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
          />
          <button onClick={createReply} disabled={!replyContent.trim()}
            style={{ padding: '6px 14px', borderRadius: 6, background: '#4f46e5', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13 }}>
            Reply
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 14 }}>Forum</strong>
        <button onClick={() => setShowCreate(!showCreate)}
          style={{ padding: '4px 12px', borderRadius: 6, background: '#4f46e5', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12 }}>
          + New Thread
        </button>
      </div>
      {showCreate && (
        <div style={{ padding: 16, borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
          <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Thread title"
            style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, marginBottom: 8 }} />
          <textarea value={newContent} onChange={e => setNewContent(e.target.value)} placeholder="What's on your mind?"
            rows={3} style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, resize: 'none', marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowCreate(false)} style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
            <button onClick={createThread} disabled={!newTitle.trim() || !newContent.trim()}
              style={{ padding: '4px 12px', borderRadius: 6, background: '#4f46e5', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12 }}>Post</button>
          </div>
        </div>
      )}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {threads.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#888', fontSize: 13 }}>No threads yet. Start one!</div>
        ) : threads.map(t => (
          <button key={t.id}
            onClick={() => setView({ mode: 'thread', threadId: t.id, title: t.title })}
            style={{
              width: '100%', textAlign: 'left', padding: '12px 16px', cursor: 'pointer',
              borderBottom: '1px solid #f3f4f6', background: 'transparent', border: 'none',
              display: 'block',
            }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>
              {t.pinned && <span style={{ color: '#f59e0b', marginRight: 4 }}>📌</span>}
              {t.locked && <span style={{ color: '#888', marginRight: 4 }}>🔒</span>}
              {t.title}
            </div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 4, display: 'flex', gap: 12 }}>
              <span>{t.author}</span>
              <span>{timeAgo(t.created_at)}</span>
              <span>{t.replies} replies</span>
              <span>{t.views} views</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
