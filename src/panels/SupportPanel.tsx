'use client'

import { relayWsUrl as buildRelayWsUrl } from '../lib/relayWsUrl'
import { useState, useEffect, useCallback, useRef } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SupportPanelProps {
  /** Override the API base URL (default: '') */
  apiBase?: string
  /** Show the live chat tab (requires AitherRelay) */
  showChat?: boolean
  /** App name displayed in tickets */
  appName?: string
  /** Relay WebSocket URL (default: auto-detected) */
  relayWsUrl?: string
}

interface Ticket {
  id: string
  subject: string
  body: string
  status: string
  priority: string
  category: string
  created_at: string
  updated_at: string
  labels: string[]
  comments?: Comment[]
}

interface Comment {
  id: string
  author: string
  body: string
  created_at: string
}

interface ChatMessage {
  id: string
  author: string
  content: string
  timestamp: string
  isAgent: boolean
}

type Tab = 'tickets' | 'bug' | 'feature' | 'chat'

// ---------------------------------------------------------------------------
// Auto log capture
// ---------------------------------------------------------------------------

function captureClientLogs(): {
  consoleErrors: string[]
  pageUrl: string
  userAgent: string
  viewport: string
  timestamp: string
  performance: Record<string, number>
  localStorage_keys: string[]
} {
  const errors: string[] = []

  // Collect recent console errors from the error buffer
  if (typeof window !== 'undefined' && (window as any).__aither_error_buffer) {
    const buf = (window as any).__aither_error_buffer as string[]
    errors.push(...buf.slice(-20))
  }

  // Performance metrics
  const perf: Record<string, number> = {}
  if (typeof window !== 'undefined' && window.performance) {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (nav) {
      perf.dns_ms = Math.round(nav.domainLookupEnd - nav.domainLookupStart)
      perf.connect_ms = Math.round(nav.connectEnd - nav.connectStart)
      perf.ttfb_ms = Math.round(nav.responseStart - nav.requestStart)
      perf.dom_load_ms = Math.round(nav.domContentLoadedEventEnd - nav.startTime)
      perf.full_load_ms = Math.round(nav.loadEventEnd - nav.startTime)
    }
    perf.heap_mb = Math.round(((performance as any).memory?.usedJSHeapSize || 0) / 1048576)
  }

  // LocalStorage keys (no values — privacy)
  let lsKeys: string[] = []
  try {
    lsKeys = Object.keys(localStorage).filter(k => !k.includes('token') && !k.includes('key'))
  } catch { /* storage access denied */ }

  return {
    consoleErrors: errors,
    pageUrl: typeof window !== 'undefined' ? window.location.href : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
    timestamp: new Date().toISOString(),
    performance: perf,
    localStorage_keys: lsKeys,
  }
}

// Install global error buffer (runs once)
if (typeof window !== 'undefined' && !(window as any).__aither_error_buffer) {
  (window as any).__aither_error_buffer = [] as string[]
  const origError = console.error
  console.error = (...args: any[]) => {
    const buf = (window as any).__aither_error_buffer as string[]
    buf.push(args.map(a => (typeof a === 'object' ? JSON.stringify(a, null, 0) : String(a))).join(' '))
    if (buf.length > 50) buf.splice(0, buf.length - 50)
    origError.apply(console, args)
  }
  window.addEventListener('error', (e) => {
    const buf = (window as any).__aither_error_buffer as string[]
    buf.push(`[unhandled] ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const buf = (window as any).__aither_error_buffer as string[]
    buf.push(`[unhandled-promise] ${e.reason}`)
  })
}

// ---------------------------------------------------------------------------
// Styles (inline, no Tailwind dependency for awkit portability)
// ---------------------------------------------------------------------------

const S = {
  root: { padding: '1.5rem', maxWidth: 900, margin: '0 auto' } as const,
  h2: { fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem' } as const,
  tabs: { display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--glass-border)', marginBottom: '1.5rem' } as const,
  tab: (active: boolean) => ({
    padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: active ? 600 : 400,
    borderBottom: active ? '2px solid var(--accent-primary, #6366f1)' : '2px solid transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    background: 'transparent', fontSize: '0.85rem',
  } as const),
  card: { background: 'var(--bg-surface)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius, 8px)', padding: '1rem', marginBottom: '0.75rem' } as const,
  label: { fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', display: 'block' } as const,
  input: { width: '100%', padding: '0.5rem 0.75rem', background: 'var(--bg-elevated)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius, 6px)', color: 'var(--text-primary)', fontSize: '0.85rem' } as const,
  textarea: { width: '100%', padding: '0.5rem 0.75rem', minHeight: 120, resize: 'vertical' as const, background: 'var(--bg-elevated)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius, 6px)', color: 'var(--text-primary)', fontSize: '0.85rem', fontFamily: 'inherit' } as const,
  select: { padding: '0.5rem', background: 'var(--bg-elevated)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius, 6px)', color: 'var(--text-primary)', fontSize: '0.85rem' } as const,
  btn: (variant: 'primary' | 'outline' = 'primary') => ({
    padding: '0.5rem 1rem', borderRadius: 'var(--radius, 6px)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
    background: variant === 'primary' ? 'var(--accent-primary, #6366f1)' : 'transparent',
    color: variant === 'primary' ? '#fff' : 'var(--text-primary)',
    border: variant === 'primary' ? 'none' : '1px solid var(--glass-border)',
  } as const),
  badge: (color: string) => ({
    display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600,
    background: `${color}20`, color,
  } as const),
  row: { display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' } as const,
  chat: { display: 'flex', flexDirection: 'column' as const, height: 400, border: '1px solid var(--glass-border)', borderRadius: 'var(--radius, 8px)', overflow: 'hidden' },
  chatMessages: { flex: 1, overflowY: 'auto' as const, padding: '0.75rem', display: 'flex', flexDirection: 'column' as const, gap: '0.5rem' },
  chatInput: { display: 'flex', gap: '0.5rem', padding: '0.5rem', borderTop: '1px solid var(--glass-border)', background: 'var(--bg-surface)' },
  success: { padding: '0.75rem 1rem', background: 'var(--accent-green, #22c55e)20', borderRadius: 'var(--radius, 6px)', color: 'var(--accent-green, #22c55e)', fontSize: '0.85rem', fontWeight: 600 } as const,
}

const PRIORITY_COLORS: Record<string, string> = { low: '#6b7280', medium: '#f59e0b', high: '#ef4444', urgent: '#dc2626', critical: '#dc2626' }
const STATUS_COLORS: Record<string, string> = { open: '#3b82f6', in_progress: '#f59e0b', resolved: '#22c55e', closed: '#6b7280' }

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SupportPanel({ apiBase = '', showChat = true, appName, relayWsUrl }: SupportPanelProps) {
  const [tab, setTab] = useState<Tab>('tickets')
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState<string | null>(null)

  // Bug report form
  const [bugTitle, setBugTitle] = useState('')
  const [bugDesc, setBugDesc] = useState('')
  const [bugCategory, setBugCategory] = useState('general')
  const [bugSeverity, setBugSeverity] = useState('medium')
  const [bugSteps, setBugSteps] = useState('')
  const [attachLogs, setAttachLogs] = useState(true)

  // Feature request form
  const [featureTitle, setFeatureTitle] = useState('')
  const [featureDesc, setFeatureDesc] = useState('')

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatConnected, setChatConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // New comment
  const [commentText, setCommentText] = useState('')

  // ── Fetch tickets ──
  const fetchTickets = useCallback(async () => {
    setLoading(true)
    try {
      // Try new support ticket endpoint first, fallback to legacy
      let res = await fetch(`${apiBase}/api/support/tickets`)
      if (!res.ok) {
        res = await fetch(`${apiBase}/api/tickets`)
      }
      if (res.ok) {
        const data = await res.json()
        setTickets(data.tickets || data || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [apiBase])

  useEffect(() => { fetchTickets() }, [fetchTickets])

  // ── View ticket detail ──
  const viewTicket = async (id: string) => {
    try {
      let res = await fetch(`${apiBase}/api/support/tickets/${id}`)
      if (!res.ok) {
        res = await fetch(`${apiBase}/api/tickets?id=${id}`)
      }
      if (res.ok) {
        const data = await res.json()
        setSelectedTicket(data.ticket || data)
      }
    } catch { /* ignore */ }
  }

  // ── Submit bug report ──
  const submitBug = async () => {
    if (!bugTitle.trim() || !bugDesc.trim()) return
    setLoading(true)
    const logs = attachLogs ? captureClientLogs() : null
    try {
      await fetch(`${apiBase}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'bug_report',
          title: bugTitle,
          description: bugDesc,
          category: bugCategory,
          severity: bugSeverity,
          steps_to_reproduce: bugSteps || undefined,
          app_name: appName || undefined,
          client_logs: logs,
        }),
      })
      setSubmitted('Bug report submitted! We\'ll get back to you soon.')
      setBugTitle(''); setBugDesc(''); setBugSteps('')
      fetchTickets()
    } catch {
      setSubmitted('Failed to submit. Please try again.')
    }
    setLoading(false)
    setTimeout(() => setSubmitted(null), 5000)
  }

  // ── Submit feature request ──
  const submitFeature = async () => {
    if (!featureTitle.trim() || !featureDesc.trim()) return
    setLoading(true)
    try {
      await fetch(`${apiBase}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'platform_feedback',
          feedback_type: 'suggestion',
          subject: featureTitle,
          body: featureDesc,
          app_name: appName || undefined,
          client_logs: attachLogs ? captureClientLogs() : undefined,
        }),
      })
      setSubmitted('Feature request submitted! Thank you for your feedback.')
      setFeatureTitle(''); setFeatureDesc('')
      fetchTickets()
    } catch {
      setSubmitted('Failed to submit. Please try again.')
    }
    setLoading(false)
    setTimeout(() => setSubmitted(null), 5000)
  }

  // ── Add comment to ticket ──
  const addComment = async () => {
    if (!selectedTicket || !commentText.trim()) return
    const ticketId = selectedTicket.id || (selectedTicket as any).ticket_id
    try {
      let res = await fetch(`${apiBase}/api/support/tickets/${ticketId}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentText }),
      })
      if (!res.ok) {
        await fetch(`${apiBase}/api/tickets/comment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticket_id: ticketId, body: commentText }),
        })
      }
      setCommentText('')
      viewTicket(ticketId)
    } catch { /* ignore */ }
  }

  // ── Relay chat connection ──
  useEffect(() => {
    if (tab !== 'chat' || !showChat) return
    // Was: same-origin host + '/api/relay/ws'. BOTH halves were wrong on a
    // static tenant host -- the origin serves no socket, and the tenant
    // backend answers 403 on that path while '/api/platform/ws/relay'
    // returns 101. Three components had drifted copies of this line.
    const wsUrl = buildRelayWsUrl(relayWsUrl, apiBase)
    try {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws
      ws.onopen = () => {
        setChatConnected(true)
        ws.send(JSON.stringify({ type: 'join', channel: '#support' }))
      }
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data)
          if (msg.type === 'message' || msg.type === 'chat') {
            setChatMessages(prev => [...prev.slice(-100), {
              id: msg.id || String(Date.now()),
              author: msg.author || msg.from || 'system',
              content: msg.content || msg.text || msg.body || '',
              timestamp: msg.timestamp || new Date().toISOString(),
              isAgent: msg.is_agent || msg.author === 'aither' || false,
            }])
          }
        } catch { /* malformed */ }
      }
      ws.onclose = () => setChatConnected(false)
      ws.onerror = () => setChatConnected(false)
      return () => { ws.close(); wsRef.current = null }
    } catch {
      setChatConnected(false)
    }
  }, [tab, showChat, relayWsUrl])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const sendChat = () => {
    if (!chatInput.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify({ type: 'message', channel: '#support', content: chatInput }))
    setChatInput('')
  }

  // ── Render ──

  return (
    <div style={S.root}>
      <h2 style={S.h2}>Support & Feedback</h2>

      {submitted && <div style={S.success}>{submitted}</div>}

      {/* Tabs */}
      <div style={S.tabs}>
        <button style={S.tab(tab === 'tickets')} onClick={() => setTab('tickets')}>My Tickets</button>
        <button style={S.tab(tab === 'bug')} onClick={() => setTab('bug')}>Bug Report</button>
        <button style={S.tab(tab === 'feature')} onClick={() => setTab('feature')}>Feature Request</button>
        {showChat && <button style={S.tab(tab === 'chat')} onClick={() => setTab('chat')}>Live Support</button>}
      </div>

      {/* ── Tickets tab ── */}
      {tab === 'tickets' && (
        selectedTicket ? (
          <div>
            <button style={S.btn('outline')} onClick={() => setSelectedTicket(null)}>Back to list</button>
            <div style={{ ...S.card, marginTop: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>{selectedTicket.subject}</h3>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <span style={S.badge(STATUS_COLORS[selectedTicket.status] || '#6b7280')}>{selectedTicket.status}</span>
                  <span style={S.badge(PRIORITY_COLORS[selectedTicket.priority] || '#6b7280')}>{selectedTicket.priority}</span>
                </div>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{selectedTicket.body}</p>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                Created: {new Date(selectedTicket.created_at).toLocaleString()}
              </div>
            </div>

            {/* Comments */}
            {selectedTicket.comments && selectedTicket.comments.length > 0 && (
              <div>
                <label style={S.label}>Comments</label>
                {selectedTicket.comments.map(c => (
                  <div key={c.id} style={{ ...S.card, paddingLeft: '1.5rem', borderLeft: '3px solid var(--glass-border)' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{c.author}</div>
                    <div style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{c.body}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>{new Date(c.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Add comment */}
            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
              <input value={commentText} onChange={e => setCommentText(e.target.value)}
                placeholder="Add a reply..." style={{ ...S.input, flex: 1 }}
                onKeyDown={e => e.key === 'Enter' && addComment()} />
              <button style={S.btn('primary')} onClick={addComment}>Reply</button>
            </div>
          </div>
        ) : (
          <div>
            {tickets.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                {loading ? 'Loading...' : 'No tickets yet. Submit a bug report or feature request to get started.'}
              </div>
            ) : (
              tickets.map(t => (
                <div key={t.id} style={{ ...S.card, cursor: 'pointer' }} onClick={() => viewTicket(t.id)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t.subject}</span>
                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                      <span style={S.badge(STATUS_COLORS[t.status] || '#6b7280')}>{t.status}</span>
                      <span style={S.badge(PRIORITY_COLORS[t.priority] || '#6b7280')}>{t.priority}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
                    {t.body?.slice(0, 120)}{t.body?.length > 120 ? '...' : ''}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                    {t.category} | {new Date(t.created_at).toLocaleDateString()}
                  </div>
                </div>
              ))
            )}
          </div>
        )
      )}

      {/* ── Bug report tab ── */}
      {tab === 'bug' && (
        <div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={S.label}>Title *</label>
            <input value={bugTitle} onChange={e => setBugTitle(e.target.value)} placeholder="Brief summary of the issue" style={S.input} />
          </div>
          <div style={S.row}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>Category</label>
              <select value={bugCategory} onChange={e => setBugCategory(e.target.value)} style={S.select}>
                <option value="general">General</option>
                <option value="ui">UI / Display</option>
                <option value="agent">Agent / AI</option>
                <option value="performance">Performance</option>
                <option value="data">Data / Storage</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.label}>Severity</label>
              <select value={bugSeverity} onChange={e => setBugSeverity(e.target.value)} style={S.select}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={S.label}>Description *</label>
            <textarea value={bugDesc} onChange={e => setBugDesc(e.target.value)} placeholder="What happened? What did you expect to happen?" style={S.textarea} />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={S.label}>Steps to reproduce (optional)</label>
            <textarea value={bugSteps} onChange={e => setBugSteps(e.target.value)} placeholder="1. Go to...\n2. Click on...\n3. See error..." style={{ ...S.textarea, minHeight: 80 }} />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={attachLogs} onChange={e => setAttachLogs(e.target.checked)} />
              Attach browser logs and performance data automatically
            </label>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '1.5rem', marginTop: '0.2rem' }}>
              Captures console errors, page URL, viewport size, and load times. No personal data or passwords.
            </div>
          </div>
          <button style={S.btn('primary')} onClick={submitBug} disabled={loading || !bugTitle.trim() || !bugDesc.trim()}>
            {loading ? 'Submitting...' : 'Submit Bug Report'}
          </button>
        </div>
      )}

      {/* ── Feature request tab ── */}
      {tab === 'feature' && (
        <div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={S.label}>Feature Title *</label>
            <input value={featureTitle} onChange={e => setFeatureTitle(e.target.value)} placeholder="What would you like to see?" style={S.input} />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={S.label}>Description *</label>
            <textarea value={featureDesc} onChange={e => setFeatureDesc(e.target.value)} placeholder="Describe the feature and how it would help you..." style={S.textarea} />
          </div>
          <button style={S.btn('primary')} onClick={submitFeature} disabled={loading || !featureTitle.trim() || !featureDesc.trim()}>
            {loading ? 'Submitting...' : 'Submit Feature Request'}
          </button>
        </div>
      )}

      {/* ── Live chat tab ── */}
      {tab === 'chat' && showChat && (
        <div style={S.chat}>
          <div style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-elevated)', fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600 }}>#support</span>
            <span style={{ color: chatConnected ? 'var(--accent-green, #22c55e)' : 'var(--accent-coral, #ef4444)', fontSize: '0.75rem' }}>
              {chatConnected ? 'Connected' : 'Connecting...'}
            </span>
          </div>
          <div style={S.chatMessages}>
            {chatMessages.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem', fontSize: '0.85rem' }}>
                {chatConnected ? 'Welcome to live support! Type a message to get started.' : 'Connecting to support channel...'}
              </div>
            )}
            {chatMessages.map(m => (
              <div key={m.id} style={{
                alignSelf: m.isAgent ? 'flex-start' : 'flex-end',
                maxWidth: '80%',
                padding: '0.5rem 0.75rem',
                borderRadius: 8,
                background: m.isAgent ? 'var(--bg-elevated)' : 'var(--accent-primary, #6366f1)',
                color: m.isAgent ? 'var(--text-primary)' : '#fff',
                fontSize: '0.85rem',
              }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.2rem', opacity: 0.7 }}>{m.author}</div>
                {m.content}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div style={S.chatInput}>
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendChat()}
              placeholder={chatConnected ? 'Type a message...' : 'Connecting...'}
              disabled={!chatConnected}
              style={{ ...S.input, flex: 1 }}
            />
            <button style={S.btn('primary')} onClick={sendChat} disabled={!chatConnected || !chatInput.trim()}>Send</button>
          </div>
        </div>
      )}
    </div>
  )
}
