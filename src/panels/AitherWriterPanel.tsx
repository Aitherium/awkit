'use client'

/**
 * AitherWriterPanel — Editorial CMS with supersession management and git versioning.
 *
 * Features:
 * - Full blog CRUD (list, create, edit, publish, delete)
 * - Supersession system: mark posts as superseded, view chains
 * - Git integration: commit, diff, and version control blog content
 * - Status filtering: draft / published / superseded
 * - Supersession wizard: select which post a new post replaces
 */

import { useState, useEffect, useCallback } from 'react'

export interface AitherWriterPanelProps {
  apiBase?: string
}

interface Post {
  slug: string
  title: string
  excerpt: string
  status: 'draft' | 'published' | 'superseded' | 'scheduled' | 'pending_review'
  date: string
  readTime: string
  tags: string[]
  featured?: boolean
  highlight?: boolean
  author?: string
  agent?: string
  content?: string
  superseded_by?: string
  supersedes?: string[]
  superseded_date?: string
  scheduled_for?: string
  scheduled_by?: string
  review_status?: string
  reviewed_by?: string
  reviewed_at?: string
  id?: string
}

type View = 'list' | 'editor' | 'supersede' | 'git' | 'review' | 'generate'
type StatusFilter = 'all' | 'published' | 'draft' | 'superseded' | 'scheduled' | 'pending_review'

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
  btnDanger: {
    padding: '4px 10px', fontSize: '0.75rem', borderRadius: 'var(--radius)',
    cursor: 'pointer', border: 'none', background: 'var(--accent-red, #c44)', color: 'white',
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

const STATUS_COLORS: Record<string, string> = {
  published: 'var(--accent-green, #2d8c4e)',
  draft: 'var(--bg-elevated)',
  superseded: '#b45309',
  scheduled: '#6366F1',
  pending_review: '#d97706',
}

const writerApiBase = (apiBase: string) =>
  apiBase.replace('/api/blog', '/api/writer')

export default function AitherWriterPanel({ apiBase = '/api/blog' }: AitherWriterPanelProps) {
  const [view, setView] = useState<View>('list')
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [editPost, setEditPost] = useState<Post | null>(null)
  const [supersedeTarget, setSupersedeTarget] = useState<Post | null>(null)

  const fetchPosts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}?drafts=true`)
      if (res.ok) {
        const data = await res.json()
        setPosts(Array.isArray(data) ? data : data.items || [])
      }
    } catch { /* silent */ } finally { setLoading(false) }
  }, [apiBase])

  useEffect(() => { fetchPosts() }, [fetchPosts])

  const filteredPosts = posts.filter(p => {
    if (filter !== 'all' && p.status !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      return p.title.toLowerCase().includes(q) ||
        p.excerpt?.toLowerCase().includes(q) ||
        p.tags?.some(t => t.toLowerCase().includes(q))
    }
    return true
  })

  const stats = {
    total: posts.length,
    published: posts.filter(p => p.status === 'published').length,
    drafts: posts.filter(p => p.status === 'draft').length,
    scheduled: posts.filter(p => p.status === 'scheduled').length,
    pendingReview: posts.filter(p => p.status === 'pending_review').length,
    superseded: posts.filter(p => p.status === 'superseded').length,
  }

  const openEditor = (post?: Post) => {
    setEditPost(post || null)
    setView('editor')
  }

  const openSupersede = (post: Post) => {
    setSupersedeTarget(post)
    setView('supersede')
  }

  const handleSaved = () => {
    setView('list')
    setEditPost(null)
    setSupersedeTarget(null)
    fetchPosts()
  }

  const wApi = writerApiBase(apiBase)

  if (view === 'editor') {
    return <PostEditor apiBase={apiBase} writerApi={wApi} post={editPost} allPosts={posts} onBack={handleSaved} />
  }

  if (view === 'supersede') {
    return <SupersedeWizard apiBase={apiBase} target={supersedeTarget!} allPosts={posts} onBack={handleSaved} />
  }

  if (view === 'review') {
    return <ReviewQueue apiBase={apiBase} writerApi={wApi} onBack={handleSaved} />
  }

  if (view === 'generate') {
    return <ContentGenerator writerApi={wApi} onBack={() => setView('list')} onDraft={(content, title) => {
      setEditPost({ slug: '', title: title || '', excerpt: '', content, status: 'draft', date: '', readTime: '', tags: [] })
      setView('editor')
    }} />
  }

  if (view === 'git') {
    return <GitPanel apiBase={apiBase} onBack={() => setView('list')} />
  }

  return (
    <div style={{ padding: 32, maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 600, marginBottom: 4 }}>AitherWriter</h1>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Content management with supersession tracking and version control
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setView('git')} style={S.btnOutline}>Git</button>
          {stats.pendingReview > 0 && (
            <button onClick={() => setView('review')} style={{
              ...S.btnOutline, borderColor: '#d97706', color: '#d97706',
            }}>Review ({stats.pendingReview})</button>
          )}
          <button onClick={() => setView('generate')} style={S.btnOutline}>AI Generate</button>
          <button onClick={() => openEditor()} style={S.btn}>New Post</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total', value: stats.total, color: undefined },
          { label: 'Published', value: stats.published, color: '#2d8c4e' },
          { label: 'Drafts', value: stats.drafts, color: undefined },
          { label: 'Scheduled', value: stats.scheduled, color: '#6366F1' },
          { label: 'Review', value: stats.pendingReview, color: '#d97706' },
          { label: 'Superseded', value: stats.superseded, color: '#b45309' },
        ].map(s => (
          <div key={s.label} style={S.card}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 600, color: s.color || 'var(--text-primary)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search posts..."
          style={{ ...S.input, maxWidth: 280 }}
        />
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-base)', padding: 4, borderRadius: 'var(--radius)' }}>
          {(['all', 'published', 'draft', 'scheduled', 'pending_review', 'superseded'] as StatusFilter[]).map(f => (
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
      ) : filteredPosts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: 12 }}>
            {search || filter !== 'all' ? 'No matching posts' : 'No posts yet'}
          </div>
          {!search && filter === 'all' && (
            <button onClick={() => openEditor()} style={S.btn}>Create your first post</button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filteredPosts.map(post => (
            <WriterPostRow
              key={post.slug}
              post={post}
              allPosts={posts}
              onEdit={() => openEditor(post)}
              onSupersede={() => openSupersede(post)}
              onRefresh={fetchPosts}
              apiBase={apiBase}
              writerApi={wApi}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Post Row ──────────────────────────────────────────────────────────────

function WriterPostRow({ post, allPosts, onEdit, onSupersede, onRefresh, apiBase, writerApi }: {
  post: Post; allPosts: Post[]; onEdit: () => void
  onSupersede: () => void; onRefresh: () => void; apiBase: string; writerApi?: string
}) {
  const [acting, setActing] = useState(false)

  const togglePublish = async () => {
    setActing(true)
    await fetch(apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: post.slug, status: post.status === 'published' ? 'draft' : 'published' }),
    })
    onRefresh()
    setActing(false)
  }

  const deletePost = async () => {
    if (!confirm(`Delete "${post.title}"?`)) return
    setActing(true)
    await fetch(`${apiBase}?slug=${encodeURIComponent(post.slug)}`, { method: 'DELETE' })
    onRefresh()
    setActing(false)
  }

  const unsupersede = async () => {
    setActing(true)
    await fetch(`${apiBase}/supersede?slug=${encodeURIComponent(post.slug)}`, { method: 'DELETE' })
    onRefresh()
    setActing(false)
  }

  const supersededByTitle = post.superseded_by
    ? allPosts.find(p => p.slug === post.superseded_by)?.title || post.superseded_by
    : null

  return (
    <div style={{
      ...S.card, display: 'flex', alignItems: 'flex-start', gap: 16,
      cursor: 'pointer', transition: 'border-color 0.15s',
      opacity: post.status === 'superseded' ? 0.7 : 1,
    }} onClick={onEdit}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.95rem', fontWeight: 500, color: 'var(--text-primary)' }}>
            {post.title}
          </span>
          <span style={S.badge(STATUS_COLORS[post.status] || undefined)}>
            {post.status}
          </span>
          {post.featured && <span style={S.badge('var(--accent-primary)')}>featured</span>}
          {post.highlight && <span style={S.badge('#6366F1')}>highlight</span>}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {post.author || 'Aitherium'} &middot; {post.date}
          {post.tags?.length > 0 && ` · ${post.tags.join(', ')}`}
          {post.readTime && ` · ${post.readTime}`}
        </div>
        {post.excerpt && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 4,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {post.excerpt}
          </div>
        )}
        {/* Scheduling info */}
        {post.scheduled_for && (
          <div style={{ fontSize: '0.7rem', color: '#6366F1', marginTop: 6 }}>
            Scheduled: {new Date(post.scheduled_for).toLocaleString()}
            {post.scheduled_by && ` by ${post.scheduled_by}`}
          </div>
        )}
        {/* Review info */}
        {post.review_status === 'pending_review' && (
          <div style={{ fontSize: '0.7rem', color: '#d97706', marginTop: 6 }}>
            Awaiting review
          </div>
        )}
        {post.reviewed_by && (
          <div style={{ fontSize: '0.7rem', color: post.review_status === 'approved' ? '#2d8c4e' : '#c44', marginTop: 6 }}>
            {post.review_status === 'approved' ? 'Approved' : 'Rejected'} by {post.reviewed_by}
          </div>
        )}
        {/* Supersession info */}
        {post.superseded_by && (
          <div style={{ fontSize: '0.7rem', color: '#b45309', marginTop: 6 }}>
            Superseded by: {supersededByTitle} ({post.superseded_date})
          </div>
        )}
        {post.supersedes && post.supersedes.length > 0 && (
          <div style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', marginTop: 6 }}>
            Supersedes: {post.supersedes.map(s =>
              allPosts.find(p => p.slug === s)?.title || s
            ).join(', ')}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
        {post.status === 'draft' && (
          <button onClick={async () => {
            setActing(true)
            await fetch(`${writerApi || apiBase.replace('/api/blog', '/api/writer')}/submit-review/${post.id || post.slug}`, { method: 'POST' })
            onRefresh(); setActing(false)
          }} disabled={acting} style={{
            ...S.btnSmall, background: 'var(--bg-elevated)', color: '#d97706',
          }}>Submit for Review</button>
        )}
        {post.status !== 'superseded' && post.status !== 'pending_review' && (
          <button onClick={togglePublish} disabled={acting} style={{
            ...S.btnSmall, background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
          }}>{post.status === 'published' ? 'Unpublish' : 'Publish'}</button>
        )}
        {post.status === 'published' && (
          <button onClick={async () => {
            setActing(true)
            await fetch(`${writerApi || apiBase.replace('/api/blog', '/api/writer')}/distribute/${post.id || post.slug}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
            })
            onRefresh(); setActing(false)
          }} disabled={acting} style={{
            ...S.btnSmall, background: 'var(--bg-elevated)', color: '#6366F1',
          }}>Share</button>
        )}
        {post.status !== 'superseded' && post.status === 'published' && (
          <button onClick={onSupersede} disabled={acting} style={{
            ...S.btnSmall, background: 'var(--bg-elevated)', color: '#b45309',
          }}>Supersede</button>
        )}
        {post.status === 'superseded' && (
          <button onClick={unsupersede} disabled={acting} style={{
            ...S.btnSmall, background: 'var(--bg-elevated)', color: 'var(--accent-green, #2d8c4e)',
          }}>Restore</button>
        )}
        <button onClick={deletePost} disabled={acting} style={S.btnDanger}>Delete</button>
      </div>
    </div>
  )
}

// ── Post Editor ───────────────────────────────────────────────────────────

function PostEditor({ apiBase, writerApi, post, allPosts, onBack }: {
  apiBase: string; writerApi: string; post: Post | null; allPosts: Post[]; onBack: () => void
}) {
  const [title, setTitle] = useState(post?.title || '')
  const [slug, setSlug] = useState(post?.slug || '')
  const [content, setContent] = useState(post?.content || '')
  const [excerpt, setExcerpt] = useState(post?.excerpt || '')
  const [tags, setTags] = useState(post?.tags?.join(', ') || '')
  const [featured, setFeatured] = useState(post?.featured || false)
  const [highlight, setHighlight] = useState(post?.highlight || false)
  const [status, setStatus] = useState<string>(post?.status || 'draft')
  const [saving, setSaving] = useState(false)
  const [loadingContent, setLoadingContent] = useState(!!post && !post.content)
  const [scheduleDate, setScheduleDate] = useState(post?.scheduled_for || '')
  const [requireReview, setRequireReview] = useState(true)

  // If editing and we don't have content, fetch the full post
  useEffect(() => {
    if (post && !post.content) {
      setLoadingContent(true)
      fetch(`${apiBase}?slug=${encodeURIComponent(post.slug)}&drafts=true`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.content) setContent(data.content)
        })
        .finally(() => setLoadingContent(false))
    }
  }, [post, apiBase])

  const save = async () => {
    if (!title.trim()) return
    setSaving(true)
    try {
      await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          slug: slug.trim() || undefined,
          content,
          excerpt: excerpt.trim() || undefined,
          tags: tags.split(',').map(t => t.trim()).filter(Boolean),
          featured,
          highlight,
          status,
        }),
      })
      onBack()
    } catch { /* silent */ } finally { setSaving(false) }
  }

  // Posts available for supersession linking
  const publishedPosts = allPosts.filter(p =>
    p.status === 'published' && p.slug !== post?.slug
  )

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
          {post && (post.status === 'draft' || !post.status) && (
            <button onClick={async () => {
              await save()
              const postId = post?.id || post?.slug || slug
              if (!postId) return
              if (scheduleDate) {
                await fetch(`${writerApi}/schedule/${postId}`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ scheduled_for: scheduleDate, require_review: requireReview }),
                })
              } else {
                await fetch(`${writerApi}/submit-review/${postId}`, { method: 'POST' })
              }
              onBack()
            }} disabled={saving} style={{
              ...S.btn, background: '#d97706', opacity: saving ? 0.6 : 1,
            }}>{scheduleDate ? 'Schedule' : 'Submit for Review'}</button>
          )}
        </div>
      </div>

      {loadingContent ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>Loading post content...</div>
      ) : (
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
            <textarea value={excerpt} onChange={e => setExcerpt(e.target.value)}
              placeholder="Brief summary for listings and SEO..."
              rows={3} style={{ ...S.input, resize: 'vertical' }} />
          </div>

          <div>
            <label style={S.label}>Content (Markdown)</label>
            <textarea value={content} onChange={e => setContent(e.target.value)}
              placeholder="Write your post..."
              rows={24} style={{
                ...S.input, resize: 'vertical', fontFamily: 'monospace', lineHeight: 1.7,
              }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={S.label}>Tags (comma-separated)</label>
              <input value={tags} onChange={e => setTags(e.target.value)}
                placeholder="engineering, architecture, agents" style={S.input} />
            </div>
            <div>
              <label style={S.label}>Options</label>
              <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={featured} onChange={e => setFeatured(e.target.checked)} />
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Featured</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={highlight} onChange={e => setHighlight(e.target.checked)} />
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Highlight</span>
                </label>
              </div>
            </div>
          </div>

          {/* Scheduling */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={S.label}>Schedule publish (optional)</label>
              <input type="datetime-local" value={scheduleDate ? scheduleDate.slice(0, 16) : ''}
                onChange={e => setScheduleDate(e.target.value ? new Date(e.target.value).toISOString() : '')}
                style={S.input} />
            </div>
            <div>
              <label style={S.label}>Review requirement</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 4 }}>
                <input type="checkbox" checked={requireReview} onChange={e => setRequireReview(e.target.checked)} />
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Require human review before publish</span>
              </label>
            </div>
          </div>

          {/* Supersession info (read-only in editor, managed via wizard) */}
          {post?.supersedes && post.supersedes.length > 0 && (
            <div style={{ ...S.card, borderColor: 'var(--accent-primary)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', marginBottom: 4 }}>
                This post supersedes:
              </div>
              {post.supersedes.map(s => {
                const sp = publishedPosts.find(p => p.slug === s) || allPosts.find(p => p.slug === s)
                return (
                  <div key={s} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                    {sp?.title || s}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Supersede Wizard ──────────────────────────────────────────────────────

function SupersedeWizard({ apiBase, target, allPosts, onBack }: {
  apiBase: string; target: Post; allPosts: Post[]; onBack: () => void
}) {
  const [selectedSlug, setSelectedSlug] = useState('')
  const [acting, setActing] = useState(false)
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<'existing' | 'new'>('existing')

  // Candidate posts that could supersede the target
  const candidates = allPosts.filter(p =>
    p.slug !== target.slug &&
    p.status === 'published' &&
    !p.superseded_by &&
    (search ? p.title.toLowerCase().includes(search.toLowerCase()) : true)
  )

  const handleSupersede = async () => {
    if (!selectedSlug) return
    setActing(true)
    try {
      await fetch(`${apiBase}/supersede`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldSlug: target.slug, newSlug: selectedSlug }),
      })
      onBack()
    } catch { /* silent */ } finally { setActing(false) }
  }

  return (
    <div style={{ padding: 32, maxWidth: 700, margin: '0 auto' }}>
      <button onClick={onBack} style={{ ...S.btnOutline, marginBottom: 24 }}>Back</button>

      <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 8 }}>Supersede Post</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 24 }}>
        Mark <strong style={{ color: 'var(--text-primary)' }}>&ldquo;{target.title}&rdquo;</strong> as
        superseded by another post. Readers will see a banner directing them to the newer content.
      </p>

      {/* Mode selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button onClick={() => setMode('existing')} style={{
          ...S.btnSmall,
          background: mode === 'existing' ? 'var(--accent-primary)' : 'var(--bg-elevated)',
          color: mode === 'existing' ? 'white' : 'var(--text-muted)',
          padding: '6px 14px',
        }}>Select existing post</button>
        <button onClick={() => setMode('new')} style={{
          ...S.btnSmall,
          background: mode === 'new' ? 'var(--accent-primary)' : 'var(--bg-elevated)',
          color: mode === 'new' ? 'white' : 'var(--text-muted)',
          padding: '6px 14px',
        }}>Write new post first</button>
      </div>

      {mode === 'new' ? (
        <div style={{ textAlign: 'center', padding: 32, ...S.card }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
            Create the new post first, then come back here to link them.
          </p>
          <button onClick={onBack} style={S.btn}>Go to editor</button>
        </div>
      ) : (
        <>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search for the superseding post..."
            style={{ ...S.input, marginBottom: 16 }}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
            {candidates.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No eligible published posts found
              </div>
            ) : candidates.map(p => (
              <div
                key={p.slug}
                onClick={() => setSelectedSlug(p.slug)}
                style={{
                  ...S.card,
                  cursor: 'pointer',
                  borderColor: selectedSlug === p.slug ? 'var(--accent-primary)' : 'var(--glass-border)',
                  background: selectedSlug === p.slug ? 'var(--accent-primary-10, rgba(99,102,241,0.1))' : 'var(--bg-surface)',
                }}
              >
                <div style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2 }}>
                  {p.title}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {p.date} &middot; {p.tags?.join(', ')}
                </div>
              </div>
            ))}
          </div>

          {selectedSlug && (
            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={onBack} style={S.btnOutline}>Cancel</button>
              <button onClick={handleSupersede} disabled={acting} style={{
                ...S.btn, background: '#b45309', opacity: acting ? 0.6 : 1,
              }}>{acting ? 'Applying...' : 'Mark as Superseded'}</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Git Panel ─────────────────────────────────────────────────────────────

function GitPanel({ apiBase, onBack }: { apiBase: string; onBack: () => void }) {
  const [gitLog, setGitLog] = useState<GitEntry[]>([])
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [committing, setCommitting] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [diffContent, setDiffContent] = useState<string | null>(null)

  interface GitEntry {
    hash: string
    short: string
    message: string
    date: string
    author: string
    files?: string[]
  }

  interface GitStatus {
    modified: string[]
    added: string[]
    deleted: string[]
    clean: boolean
  }

  const fetchGit = useCallback(async () => {
    setLoading(true)
    try {
      const [logRes, statusRes] = await Promise.all([
        fetch(`${apiBase}/git/log`),
        fetch(`${apiBase}/git/status`),
      ])
      if (logRes.ok) setGitLog(await logRes.json())
      if (statusRes.ok) setGitStatus(await statusRes.json())
    } catch { /* silent */ } finally { setLoading(false) }
  }, [apiBase])

  useEffect(() => { fetchGit() }, [fetchGit])

  const handleCommit = async () => {
    if (!commitMsg.trim()) return
    setCommitting(true)
    try {
      await fetch(`${apiBase}/git/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMsg.trim() }),
      })
      setCommitMsg('')
      fetchGit()
    } catch { /* silent */ } finally { setCommitting(false) }
  }

  const viewDiff = async (file?: string) => {
    try {
      const q = file ? `?file=${encodeURIComponent(file)}` : ''
      const res = await fetch(`${apiBase}/git/diff${q}`)
      if (res.ok) {
        const data = await res.json()
        setDiffContent(data.diff || 'No changes')
      }
    } catch { setDiffContent('Failed to load diff') }
  }

  return (
    <div style={{ padding: 32, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 4 }}>Content Version Control</h2>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Blog content is version-controlled alongside code
          </p>
        </div>
        <button onClick={onBack} style={S.btnOutline}>Back to posts</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>Loading git status...</div>
      ) : (
        <>
          {/* Working changes */}
          {gitStatus && !gitStatus.clean && (
            <div style={{ ...S.card, marginBottom: 20 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 500, marginBottom: 12 }}>Uncommitted Changes</div>
              {gitStatus.modified.map(f => (
                <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={S.badge('#b45309')}>M</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{f}</span>
                  <button onClick={() => viewDiff(f)} style={{
                    ...S.btnSmall, background: 'var(--bg-elevated)', color: 'var(--text-muted)', marginLeft: 'auto',
                  }}>Diff</button>
                </div>
              ))}
              {gitStatus.added.map(f => (
                <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={S.badge('var(--accent-green, #2d8c4e)')}>A</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{f}</span>
                </div>
              ))}
              {gitStatus.deleted.map(f => (
                <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={S.badge('var(--accent-red, #c44)')}>D</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{f}</span>
                </div>
              ))}

              {/* Commit form */}
              <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                <input
                  value={commitMsg}
                  onChange={e => setCommitMsg(e.target.value)}
                  placeholder="Commit message (e.g., content: update layer 4 naming)"
                  onKeyDown={e => e.key === 'Enter' && handleCommit()}
                  style={{ ...S.input, flex: 1 }}
                />
                <button onClick={handleCommit} disabled={committing || !commitMsg.trim()} style={{
                  ...S.btn, opacity: committing ? 0.6 : 1,
                }}>{committing ? 'Committing...' : 'Commit'}</button>
              </div>
            </div>
          )}

          {gitStatus?.clean && (
            <div style={{ ...S.card, marginBottom: 20, textAlign: 'center', color: 'var(--accent-green, #2d8c4e)', fontSize: '0.85rem' }}>
              Working tree clean — all content changes committed
            </div>
          )}

          {/* Diff viewer */}
          {diffContent !== null && (
            <div style={{ ...S.card, marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Diff</span>
                <button onClick={() => setDiffContent(null)} style={S.btnSmall}>Close</button>
              </div>
              <pre style={{
                fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--text-secondary)',
                background: 'var(--bg-base)', padding: 12, borderRadius: 'var(--radius)',
                overflowX: 'auto', maxHeight: 400, whiteSpace: 'pre-wrap',
              }}>{diffContent}</pre>
            </div>
          )}

          {/* Commit history */}
          <div>
            <div style={{ fontSize: '0.85rem', fontWeight: 500, marginBottom: 12 }}>Content History</div>
            {gitLog.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No content commits found. Git integration endpoints not yet connected.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {gitLog.map(entry => (
                  <div key={entry.hash} style={S.card}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <code style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', fontFamily: 'monospace' }}>
                        {entry.short}
                      </code>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', flex: 1 }}>
                        {entry.message}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {entry.date}
                      </span>
                    </div>
                    {entry.files && entry.files.length > 0 && (
                      <div style={{ marginTop: 6, fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {entry.files.join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Review Queue ──────────────────────────────────────────────────────────

function ReviewQueue({ apiBase, writerApi, onBack }: {
  apiBase: string; writerApi: string; onBack: () => void
}) {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)

  const fetchPending = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${writerApi}/pending-review`)
      if (res.ok) {
        const data = await res.json()
        setPosts(data.items || [])
      }
    } catch { /* silent */ } finally { setLoading(false) }
  }, [writerApi])

  useEffect(() => { fetchPending() }, [fetchPending])

  const review = async (postId: string, action: 'approve' | 'reject') => {
    setActing(postId)
    try {
      await fetch(`${writerApi}/review/${postId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      fetchPending()
    } catch { /* silent */ } finally { setActing(null) }
  }

  return (
    <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 4 }}>Review Queue</h2>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Posts awaiting human review before publishing
          </p>
        </div>
        <button onClick={onBack} style={S.btnOutline}>Back</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>Loading...</div>
      ) : posts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
          No posts pending review
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {posts.map(post => (
            <div key={post.id || post.slug} style={S.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>
                    {post.title}
                  </div>
                  {post.excerpt && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                      {post.excerpt}
                    </div>
                  )}
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {post.author} &middot; {post.tags?.join(', ')}
                    {post.scheduled_for && (
                      <span style={{ color: '#6366F1' }}>
                        {' '}&middot; Scheduled: {new Date(post.scheduled_for).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => review(post.id || post.slug, 'approve')}
                    disabled={acting === (post.id || post.slug)}
                    style={{ ...S.btn, background: 'var(--accent-green, #2d8c4e)' }}
                  >Approve</button>
                  <button
                    onClick={() => review(post.id || post.slug, 'reject')}
                    disabled={acting === (post.id || post.slug)}
                    style={{ ...S.btn, background: 'var(--accent-red, #c44)' }}
                  >Reject</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Content Generator ─────────────────────────────────────────────────────

function ContentGenerator({ writerApi, onBack, onDraft }: {
  writerApi: string; onBack: () => void
  onDraft: (content: string, title?: string) => void
}) {
  const [topic, setTopic] = useState('')
  const [type, setType] = useState<string>('draft')
  const [tone, setTone] = useState('technical')
  const [length, setLength] = useState('medium')
  const [tags, setTags] = useState('')
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const generate = async () => {
    if (!topic.trim()) return
    setGenerating(true)
    setResult(null)
    try {
      const res = await fetch(`${writerApi}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          topic: topic.trim(),
          tags: tags.split(',').map(t => t.trim()).filter(Boolean),
          tone,
          length,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setResult(data.content || 'No content generated')
      } else {
        const err = await res.json().catch(() => ({ error: 'Generation failed' }))
        setResult(`Error: ${err.error || err.detail || 'Unknown error'}`)
      }
    } catch (e) {
      setResult(`Error: ${e}`)
    } finally { setGenerating(false) }
  }

  return (
    <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 4 }}>AI Content Generator</h2>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Generate blog drafts, outlines, titles, and excerpts
          </p>
        </div>
        <button onClick={onBack} style={S.btnOutline}>Back</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={S.label}>Topic / Prompt</label>
          <textarea value={topic} onChange={e => setTopic(e.target.value)}
            placeholder="What should the post be about?"
            rows={3} style={{ ...S.input, resize: 'vertical' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <div>
            <label style={S.label}>Type</label>
            <select value={type} onChange={e => setType(e.target.value)} style={S.input}>
              <option value="draft">Full Draft</option>
              <option value="outline">Outline</option>
              <option value="title">Title Ideas</option>
              <option value="excerpt">Excerpt</option>
            </select>
          </div>
          <div>
            <label style={S.label}>Tone</label>
            <select value={tone} onChange={e => setTone(e.target.value)} style={S.input}>
              <option value="technical">Technical</option>
              <option value="conversational">Conversational</option>
              <option value="thought-leadership">Thought Leadership</option>
            </select>
          </div>
          <div>
            <label style={S.label}>Length</label>
            <select value={length} onChange={e => setLength(e.target.value)} style={S.input}>
              <option value="short">Short (~500 words)</option>
              <option value="medium">Medium (~1500 words)</option>
              <option value="long">Long (~3000 words)</option>
            </select>
          </div>
          <div>
            <label style={S.label}>Tags</label>
            <input value={tags} onChange={e => setTags(e.target.value)}
              placeholder="ai, engineering" style={S.input} />
          </div>
        </div>

        <button onClick={generate} disabled={generating || !topic.trim()} style={{
          ...S.btn, opacity: generating ? 0.6 : 1, alignSelf: 'flex-start',
        }}>{generating ? 'Generating...' : 'Generate'}</button>

        {result && (
          <div style={{ ...S.card, marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Generated Content</span>
              <button onClick={() => onDraft(result, topic)} style={S.btn}>
                Use as Draft
              </button>
            </div>
            <pre style={{
              fontSize: '0.8rem', fontFamily: 'monospace', color: 'var(--text-secondary)',
              background: 'var(--bg-base)', padding: 16, borderRadius: 'var(--radius)',
              whiteSpace: 'pre-wrap', maxHeight: 500, overflowY: 'auto', lineHeight: 1.6,
            }}>{result}</pre>
          </div>
        )}
      </div>
    </div>
  )
}
