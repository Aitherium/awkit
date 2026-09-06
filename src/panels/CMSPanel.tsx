'use client'

import { useState, useEffect, useCallback } from 'react'

export interface CMSPanelProps {
  apiBase?: string
}

interface Post {
  slug: string
  title: string
  status: string
  date: string
  tags: string[]
  featured?: boolean
  excerpt?: string
}

interface DistList {
  cn: string
  member_count: number
  members: string[]
}

type Tab = 'content' | 'newsletter' | 'contacts' | 'lists'

const S = {
  wrap: { display: 'flex', flexDirection: 'column' as const, gap: 16, padding: 16 },
  card: {
    background: 'var(--bg-surface, #1a1a2e)',
    border: '1px solid var(--glass-border, #2a2a3e)',
    borderRadius: 12,
    padding: 16,
  },
  tabs: { display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' as const },
  tab: (active: boolean) => ({
    padding: '8px 16px',
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    background: active ? 'var(--accent-primary, #7c3aed)' : 'var(--bg-surface, #1a1a2e)',
    color: active ? '#fff' : 'var(--text-muted, #888)',
  }),
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 },
  stat: {
    background: 'var(--bg-elevated, #222238)',
    borderRadius: 8,
    padding: 12,
    textAlign: 'center' as const,
  },
  statNum: { fontSize: 24, fontWeight: 700, color: 'var(--accent-primary, #7c3aed)' },
  statLabel: { fontSize: 11, color: 'var(--text-muted, #888)', marginTop: 4 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: {
    textAlign: 'left' as const,
    padding: '8px 12px',
    borderBottom: '1px solid var(--glass-border, #2a2a3e)',
    color: 'var(--text-muted, #888)',
    fontSize: 11,
    textTransform: 'uppercase' as const,
  },
  td: { padding: '8px 12px', borderBottom: '1px solid var(--glass-border, #1a1a2e)' },
  badge: (color: string) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    background: color + '22',
    color,
  }),
  btn: {
    padding: '6px 14px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    background: 'var(--accent-primary, #7c3aed)',
    color: '#fff',
  },
  btnSm: {
    padding: '4px 10px',
    borderRadius: 4,
    border: '1px solid var(--glass-border, #2a2a3e)',
    cursor: 'pointer',
    fontSize: 11,
    background: 'transparent',
    color: 'var(--text-secondary, #aaa)',
  },
  input: {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid var(--glass-border, #2a2a3e)',
    background: 'var(--bg-elevated, #222238)',
    color: 'var(--text-primary, #eee)',
    fontSize: 13,
  },
  empty: { textAlign: 'center' as const, padding: 32, color: 'var(--text-muted, #888)' },
}

export default function CMSPanel({ apiBase = '/api' }: CMSPanelProps) {
  const [tab, setTab] = useState<Tab>('content')
  const [posts, setPosts] = useState<Post[]>([])
  const [lists, setLists] = useState<DistList[]>([])
  const [subscriberCount, setSubscriberCount] = useState(0)
  const [loading, setLoading] = useState(false)

  const fetchContent = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/blog`)
      if (res.ok) {
        const data = await res.json()
        setPosts(Array.isArray(data) ? data : data.posts || [])
      }
    } catch { /* silent */ }
    setLoading(false)
  }, [apiBase])

  const fetchLists = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/admin/distribution-lists`)
      if (res.ok) {
        const data = await res.json()
        setLists(data.lists || [])
      }
    } catch { /* silent */ }
  }, [apiBase])

  const fetchSubscribers = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/notify`)
      if (res.ok) {
        const data = await res.json()
        setSubscriberCount(data.count || 0)
      }
    } catch { /* silent */ }
  }, [apiBase])

  useEffect(() => {
    fetchContent()
    fetchLists()
    fetchSubscribers()
  }, [fetchContent, fetchLists, fetchSubscribers])

  const published = posts.filter(p => p.status === 'published').length
  const drafts = posts.filter(p => p.status === 'draft').length
  const totalListMembers = lists.reduce((s, l) => s + l.member_count, 0)

  return (
    <div style={S.wrap}>
      {/* Stats Overview */}
      <div style={S.grid}>
        <div style={S.stat}>
          <div style={S.statNum}>{posts.length}</div>
          <div style={S.statLabel}>Total Posts</div>
        </div>
        <div style={S.stat}>
          <div style={S.statNum}>{published}</div>
          <div style={S.statLabel}>Published</div>
        </div>
        <div style={S.stat}>
          <div style={S.statNum}>{subscriberCount}</div>
          <div style={S.statLabel}>Subscribers</div>
        </div>
        <div style={S.stat}>
          <div style={S.statNum}>{lists.length}</div>
          <div style={S.statLabel}>Lists</div>
        </div>
      </div>

      {/* Tab Bar */}
      <div style={S.tabs}>
        {(['content', 'newsletter', 'contacts', 'lists'] as Tab[]).map(t => (
          <button key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>
            {t === 'content' ? 'Content' : t === 'newsletter' ? 'Newsletter' : t === 'contacts' ? 'Contacts' : 'Lists'}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'content' && (
        <ContentTab posts={posts} loading={loading} onRefresh={fetchContent} apiBase={apiBase} />
      )}
      {tab === 'newsletter' && (
        <NewsletterTab subscriberCount={subscriberCount} lists={lists} apiBase={apiBase} onRefresh={() => { fetchSubscribers(); fetchLists() }} />
      )}
      {tab === 'contacts' && (
        <ContactsTab apiBase={apiBase} />
      )}
      {tab === 'lists' && (
        <ListsTab lists={lists} loading={loading} onRefresh={fetchLists} apiBase={apiBase} />
      )}
    </div>
  )
}

/* ── Content Tab ─────────────────────────────────────────────────── */

function ContentTab({ posts, loading, onRefresh, apiBase }: {
  posts: Post[]; loading: boolean; onRefresh: () => void; apiBase: string
}) {
  const [filter, setFilter] = useState<'all' | 'published' | 'draft'>('all')
  const filtered = filter === 'all' ? posts : posts.filter(p => p.status === filter)

  const handleScanNotify = async () => {
    await fetch(`${apiBase}/blog/scan-notify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    onRefresh()
  }

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['all', 'published', 'draft'] as const).map(f => (
            <button key={f} style={S.btnSm} onClick={() => setFilter(f)}>
              {f === 'all' ? `All (${posts.length})` : f === 'published' ? `Published (${posts.filter(p => p.status === 'published').length})` : `Drafts (${posts.filter(p => p.status === 'draft').length})`}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.btnSm} onClick={handleScanNotify}>Scan & Notify</button>
          <button style={S.btn} onClick={onRefresh}>Refresh</button>
        </div>
      </div>

      {loading ? (
        <div style={S.empty}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={S.empty}>No posts found</div>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Title</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Date</th>
              <th style={S.th}>Tags</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.slug}>
                <td style={S.td}>{p.title}{p.featured ? ' *' : ''}</td>
                <td style={S.td}>
                  <span style={S.badge(p.status === 'published' ? '#22c55e' : '#eab308')}>
                    {p.status}
                  </span>
                </td>
                <td style={{ ...S.td, color: 'var(--text-muted, #888)', fontSize: 12 }}>{p.date}</td>
                <td style={{ ...S.td, fontSize: 11, color: 'var(--text-muted, #888)' }}>{(p.tags || []).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/* ── Newsletter Tab ──────────────────────────────────────────────── */

function NewsletterTab({ subscriberCount, lists, apiBase, onRefresh }: {
  subscriberCount: number; lists: DistList[]; apiBase: string; onRefresh: () => void
}) {
  const [subject, setSubject] = useState('')
  const [html, setHtml] = useState('')
  const [targetList, setTargetList] = useState('blog-newsletter')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState('')

  const blogList = lists.find(l => l.cn === 'blog-newsletter')

  const handleSend = async () => {
    if (!subject || !html) return
    setSending(true)
    setResult('')
    try {
      const res = await fetch(`${apiBase}/admin/distribution-lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_campaign', list_cn: targetList, subject, html }),
      })
      const data = await res.json()
      setResult(data.ok ? `Sent to ${data.sent || subscriberCount} subscribers` : data.error || 'Send failed')
    } catch {
      setResult('Send failed')
    }
    setSending(false)
  }

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Newsletter Campaign</h3>
        <span style={{ fontSize: 13, color: 'var(--text-muted, #888)' }}>
          {subscriberCount} subscriber{subscriberCount !== 1 ? 's' : ''} on blog-newsletter
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted, #888)', display: 'block', marginBottom: 4 }}>Target List</label>
          <select
            value={targetList}
            onChange={e => setTargetList(e.target.value)}
            style={{ ...S.input, cursor: 'pointer' }}
          >
            {lists.map(l => (
              <option key={l.cn} value={l.cn}>{l.cn} ({l.member_count} members)</option>
            ))}
            {lists.length === 0 && <option value="blog-newsletter">blog-newsletter</option>}
          </select>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted, #888)', display: 'block', marginBottom: 4 }}>Subject</label>
          <input
            style={S.input}
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Email subject line..."
          />
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted, #888)', display: 'block', marginBottom: 4 }}>HTML Content</label>
          <textarea
            style={{ ...S.input, minHeight: 120, resize: 'vertical', fontFamily: 'monospace' }}
            value={html}
            onChange={e => setHtml(e.target.value)}
            placeholder="<h2>Your newsletter content...</h2>"
          />
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={S.btn} onClick={handleSend} disabled={sending || !subject || !html}>
            {sending ? 'Sending...' : 'Send Campaign'}
          </button>
          {result && <span style={{ fontSize: 12, color: result.includes('fail') ? '#ef4444' : '#22c55e' }}>{result}</span>}
        </div>
      </div>
    </div>
  )
}

/* ── Contacts Tab ────────────────────────────────────────────────── */

function ContactsTab({ apiBase }: { apiBase: string }) {
  const [contacts, setContacts] = useState<Array<{ cn: string; email: string; tags: string }>>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)

  const fetchContacts = useCallback(async () => {
    setLoading(true)
    try {
      const q = search ? `?search=${encodeURIComponent(search)}` : ''
      const res = await fetch(`${apiBase}/contacts${q}`)
      if (res.ok) {
        const data = await res.json()
        setContacts(data.contacts || data.results || [])
      }
    } catch { /* silent */ }
    setLoading(false)
  }, [apiBase, search])

  useEffect(() => { fetchContacts() }, [fetchContacts])

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          style={{ ...S.input, flex: 1 }}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search contacts..."
          onKeyDown={e => e.key === 'Enter' && fetchContacts()}
        />
        <button style={S.btn} onClick={fetchContacts}>Search</button>
      </div>

      {loading ? (
        <div style={S.empty}>Loading...</div>
      ) : contacts.length === 0 ? (
        <div style={S.empty}>No contacts found. Subscribers are automatically added as contacts when they sign up.</div>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Name</th>
              <th style={S.th}>Email</th>
              <th style={S.th}>Tags</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c, i) => (
              <tr key={c.cn || i}>
                <td style={S.td}>{c.cn}</td>
                <td style={S.td}>{c.email}</td>
                <td style={{ ...S.td, fontSize: 11, color: 'var(--text-muted, #888)' }}>{c.tags}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/* ── Lists Tab ───────────────────────────────────────────────────── */

function ListsTab({ lists, loading, onRefresh, apiBase }: {
  lists: DistList[]; loading: boolean; onRefresh: () => void; apiBase: string
}) {
  const [newCn, setNewCn] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    if (!newCn.trim()) return
    setCreating(true)
    try {
      await fetch(`${apiBase}/admin/distribution-lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cn: newCn.trim(), members: [], description: newDesc }),
      })
      setNewCn('')
      setNewDesc('')
      onRefresh()
    } catch { /* silent */ }
    setCreating(false)
  }

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Distribution Lists</h3>
        <button style={S.btn} onClick={onRefresh}>Refresh</button>
      </div>

      {/* Create new list */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          style={{ ...S.input, flex: 1 }}
          value={newCn}
          onChange={e => setNewCn(e.target.value)}
          placeholder="List name (e.g. product-updates)"
        />
        <input
          style={{ ...S.input, flex: 1 }}
          value={newDesc}
          onChange={e => setNewDesc(e.target.value)}
          placeholder="Description (optional)"
        />
        <button style={S.btn} onClick={handleCreate} disabled={creating || !newCn.trim()}>
          {creating ? 'Creating...' : 'Create'}
        </button>
      </div>

      {loading ? (
        <div style={S.empty}>Loading...</div>
      ) : lists.length === 0 ? (
        <div style={S.empty}>No distribution lists found. Create one above or seed defaults.</div>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>List Name</th>
              <th style={S.th}>Members</th>
              <th style={S.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {lists.map(l => (
              <tr key={l.cn}>
                <td style={S.td}>{l.cn}</td>
                <td style={S.td}>
                  <span style={S.badge('#06b6d4')}>{l.member_count} member{l.member_count !== 1 ? 's' : ''}</span>
                </td>
                <td style={S.td}>
                  <button
                    style={S.btnSm}
                    onClick={() => navigator.clipboard?.writeText(l.members.join(', ')).catch(() => {})}
                  >
                    Copy Emails
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
