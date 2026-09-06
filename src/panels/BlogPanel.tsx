'use client'

/**
 * BlogPanel — Full blog/content management for portal-kit apps.
 *
 * CRUD: list, create, edit, publish, delete posts.
 * Scoped via identityFetch (auto-injects tenant/workspace/user headers).
 */

import { useState, useEffect, useCallback, useMemo } from 'react'

export interface BlogPanelProps {
  apiBase?: string
}

interface Post {
  id: string
  slug: string
  title: string
  content: string
  excerpt: string
  status: 'draft' | 'published'
  author: string
  tags: string[]
  featured: boolean
  created_at: string
  updated_at: string
  published_at: string | null
}

interface Stats {
  total: number
  published: number
  drafts: number
  featured: number
  top_tags: [string, number][]
}

const S = {
  card: {
    background: 'var(--bg-surface)', border: '1px solid var(--glass-border)',
    borderRadius: 'var(--radius)', padding: 16,
  } as React.CSSProperties,
  input: {
    width: '100%', padding: '10px 14px', background: 'var(--bg-surface)',
    color: 'var(--text-primary)', border: '1px solid var(--glass-border)',
    borderRadius: 'var(--radius)', fontSize: '0.85rem',
  } as React.CSSProperties,
  btn: {
    padding: '8px 16px', background: 'var(--accent-primary)', color: 'white',
    borderRadius: 'var(--radius)', fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer',
    border: 'none',
  } as React.CSSProperties,
  btnOutline: {
    padding: '8px 16px', background: 'transparent', color: 'var(--text-secondary)',
    borderRadius: 'var(--radius)', fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer',
    border: '1px solid var(--glass-border)',
  } as React.CSSProperties,
  btnSmall: {
    padding: '4px 10px', fontSize: '0.75rem', borderRadius: 'var(--radius)',
    cursor: 'pointer', border: 'none',
  } as React.CSSProperties,
  label: {
    display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)',
    marginBottom: 6,
  } as React.CSSProperties,
  badge: (color?: string) => ({
    display: 'inline-block', padding: '2px 8px', fontSize: '0.7rem',
    borderRadius: 12, fontWeight: 500,
    background: color || 'var(--bg-elevated)', color: color ? 'white' : 'var(--text-muted)',
  }) as React.CSSProperties,
}

export default function BlogPanel({ apiBase = '/api/blog' }: BlogPanelProps) {
  const [view, setView] = useState<'list' | 'editor'>('list')
  const [posts, setPosts] = useState<Post[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'published' | 'draft'>('all')
  const [search, setSearch] = useState('')
  const [editPost, setEditPost] = useState<Post | null>(null)

  const fetchPosts = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filter !== 'all') params.set('status', filter)
      if (search) params.set('search', search)
      const q = params.toString()
      const [postsRes, statsRes] = await Promise.all([
        fetch(`${apiBase}${q ? `?${q}` : ''}`),
        fetch(`${apiBase}/stats`),
      ])
      if (postsRes.ok) {
        const d = await postsRes.json()
        setPosts(d.items || d || [])
      }
      if (statsRes.ok) setStats(await statsRes.json())
    } catch { /* silent */ } finally { setLoading(false) }
  }, [apiBase, filter, search])

  useEffect(() => { fetchPosts() }, [fetchPosts])

  const openEditor = (post?: Post) => {
    setEditPost(post || null)
    setView('editor')
  }

  const handleSaved = () => {
    setView('list')
    setEditPost(null)
    fetchPosts()
  }

  if (view === 'editor') {
    return <PostEditor apiBase={apiBase} post={editPost} onBack={handleSaved} />
  }

  return (
    <div style={{ padding: 32, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600 }}>Blog</h1>
        <button onClick={() => openEditor()} style={S.btn}>New Post</button>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Total', value: stats.total },
            { label: 'Published', value: stats.published },
            { label: 'Drafts', value: stats.drafts },
            { label: 'Featured', value: stats.featured },
          ].map(s => (
            <div key={s.label} style={S.card}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 600, color: 'var(--text-primary)' }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search posts..."
          style={{ ...S.input, maxWidth: 280 }}
        />
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-base)', padding: 4, borderRadius: 'var(--radius)' }}>
          {(['all', 'published', 'draft'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              ...S.btnSmall,
              background: filter === f ? 'var(--bg-elevated)' : 'transparent',
              color: filter === f ? 'var(--text-primary)' : 'var(--text-muted)',
            }}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>
          ))}
        </div>
      </div>

      {/* Posts list */}
      {loading && posts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>Loading...</div>
      ) : posts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: 12 }}>No posts yet</div>
          <button onClick={() => openEditor()} style={S.btn}>Create your first post</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {posts.map(post => (
            <PostRow key={post.id} post={post} apiBase={apiBase}
              onEdit={() => openEditor(post)} onRefresh={fetchPosts} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Post Row ─────────────────────────────────────────────────────────────

function PostRow({ post, apiBase, onEdit, onRefresh }: {
  post: Post; apiBase: string; onEdit: () => void; onRefresh: () => void
}) {
  const [acting, setActing] = useState(false)

  const togglePublish = async () => {
    setActing(true)
    const action = post.status === 'published' ? 'unpublish' : 'publish'
    await fetch(`${apiBase}/${post.id}/${action}`, { method: 'POST' })
    onRefresh()
    setActing(false)
  }

  const deletePost = async () => {
    if (!confirm(`Delete "${post.title}"?`)) return
    setActing(true)
    await fetch(`${apiBase}/${post.id}`, { method: 'DELETE' })
    onRefresh()
    setActing(false)
  }

  return (
    <div style={{
      ...S.card, display: 'flex', alignItems: 'center', gap: 16,
      cursor: 'pointer', transition: 'border-color 0.15s',
    }} onClick={onEdit}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: '0.95rem', fontWeight: 500, color: 'var(--text-primary)' }}>
            {post.title}
          </span>
          <span style={S.badge(post.status === 'published' ? 'var(--accent-green, #2d8c4e)' : undefined)}>
            {post.status}
          </span>
          {post.featured && <span style={S.badge('var(--accent-primary)')}>featured</span>}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {post.author} &middot; {new Date(post.updated_at).toLocaleDateString()}
          {post.tags?.length > 0 && ` · ${post.tags.join(', ')}`}
        </div>
        {post.excerpt && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 4,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {post.excerpt}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
        <button onClick={togglePublish} disabled={acting} style={{
          ...S.btnSmall, background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
        }}>{post.status === 'published' ? 'Unpublish' : 'Publish'}</button>
        <button onClick={deletePost} disabled={acting} style={{
          ...S.btnSmall, background: 'var(--bg-elevated)', color: 'var(--accent-red, #c44)',
        }}>Delete</button>
      </div>
    </div>
  )
}

// ── Post Editor ──────────────────────────────────────────────────────────

function PostEditor({ apiBase, post, onBack }: {
  apiBase: string; post: Post | null; onBack: () => void
}) {
  const [title, setTitle] = useState(post?.title || '')
  const [slug, setSlug] = useState(post?.slug || '')
  const [content, setContent] = useState(post?.content || '')
  const [excerpt, setExcerpt] = useState(post?.excerpt || '')
  const [tags, setTags] = useState(post?.tags?.join(', ') || '')
  const [featured, setFeatured] = useState(post?.featured || false)
  const [status, setStatus] = useState<string>(post?.status || 'draft')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!title.trim()) return
    setSaving(true)
    try {
      const body = {
        title: title.trim(),
        slug: slug.trim() || undefined,
        content,
        excerpt: excerpt.trim() || undefined,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        featured,
        status,
      }
      if (post) {
        await fetch(`${apiBase}/${post.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        await fetch(apiBase, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      }
      onBack()
    } catch { /* silent */ } finally { setSaving(false) }
  }

  return (
    <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <button onClick={onBack} style={S.btnOutline}>Back</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={status} onChange={e => setStatus(e.target.value)} style={{
            ...S.input, width: 'auto',
          }}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
          <button onClick={save} disabled={saving || !title.trim()} style={{
            ...S.btn, opacity: saving ? 0.6 : 1,
          }}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={S.label}>Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Post title" style={{ ...S.input, fontSize: '1.1rem', fontWeight: 500 }} />
        </div>

        <div>
          <label style={S.label}>Slug</label>
          <input value={slug} onChange={e => setSlug(e.target.value)}
            placeholder="auto-generated-from-title" style={S.input} />
        </div>

        <div>
          <label style={S.label}>Excerpt</label>
          <input value={excerpt} onChange={e => setExcerpt(e.target.value)}
            placeholder="Brief summary..." style={S.input} />
        </div>

        <div>
          <label style={S.label}>Content (Markdown)</label>
          <textarea value={content} onChange={e => setContent(e.target.value)}
            placeholder="Write your post..."
            rows={20} style={{
              ...S.input, resize: 'vertical', fontFamily: 'monospace', lineHeight: 1.7,
            }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={S.label}>Tags (comma-separated)</label>
            <input value={tags} onChange={e => setTags(e.target.value)}
              placeholder="news, update, release" style={S.input} />
          </div>
          <div>
            <label style={S.label}>Featured</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 4 }}>
              <input type="checkbox" checked={featured} onChange={e => setFeatured(e.target.checked)} />
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Pin to top</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
