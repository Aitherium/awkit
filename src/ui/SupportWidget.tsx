import { useState, useEffect, useRef, useCallback } from 'react'
import { installTelemetry, captureDebugBundle } from '../lib/telemetry'
import { getApiBase } from '../lib/apiBase'
import { relayWsUrl as buildRelayWsUrl } from '../lib/relayWsUrl'

/**
 * SupportWidget — Floating chat bubble + quick-action support widget.
 *
 * Drop this component into any page layout to give users instant access to:
 * - Live chat with the support agent (via AitherRelay #support channel)
 * - Quick bug report form (with auto log capture)
 * - Quick feature request form
 * - Link to full support panel / tickets page
 *
 * Usage:
 *   import { SupportWidget } from '@aitherium/awkit'
 *   <SupportWidget apiBase="" appName="Acme" />
 */

export interface SupportWidgetProps {
  /** API base URL for submitting reports (default: '') */
  apiBase?: string
  /** App name included in reports */
  appName?: string
  /** Relay WebSocket URL (default: same-origin /api/platform/ws/relay — the awkit-backend comms proxy) */
  relayWsUrl?: string
  /**
   * Optional link to a full support/tickets PAGE. Only rendered when explicitly
   * provided — tickets are otherwise shown in-widget via /api/support/tickets,
   * so there is no default route that may not exist in the host app.
   */
  supportPageUrl?: string
  /** Position: 'bottom-right' | 'bottom-left' */
  position?: 'bottom-right' | 'bottom-left'
  /** Distance from the bottom edge. Defaults to 88 so the bubble clears the standard ChatPanel composer row. */
  offsetBottom?: number
  /** Distance from the side edge (right or left per `position`). */
  offsetSide?: number
}

interface Ticket {
  id: string
  subject: string
  status: string
  priority?: string
  created_at?: string
  comment_count?: number
}

interface ChatMsg {
  id: string
  author: string
  content: string
  isAgent: boolean
}

type View = 'closed' | 'menu' | 'chat' | 'bug' | 'feature' | 'submitted' | 'tickets'

// Delegate to the shared telemetry module so the "logs captured automatically"
// promise is actually kept — it captures console errors, the network log, and
// Navigation-Timing performance (the exact keys routers/support.py formats).
function captureQuickLogs(): object {
  return { ...captureDebugBundle(), timestamp: new Date().toISOString() }
}

export default function SupportWidget({
  // Default resolved from the RUNTIME config, never a bare ''.
  //
  // A '' default means SAME-ORIGIN, which is correct for a backend-hosted
  // app and wrong for a STATIC one. Relative /api/* fetches survive it
  // because installIdentityHeaders wraps window.fetch and rewrites them --
  // but a WebSocket is NOT window.fetch, so the chat URL below is built
  // from window.location.host and dials the static host directly.
  //
  // Measured 2026-08-21 on a tenant portal (GitHub Pages + a separate
  // API backend): wss://<portal-host>/api/platform/ws/relay -> 404, while
  // wss://<api-host>/api/platform/ws/relay -> 101 Switching
  // Protocols. The correct origin was already published in /config.js and
  // this component was the only thing not reading it, so support chat said
  // 'unavailable' on every tenant while the socket was healthy.
  //
  // getApiBase() returns '' when no absolute base is configured, so a
  // same-origin deployment behaves exactly as before.
  apiBase = getApiBase(),
  appName,
  relayWsUrl,
  supportPageUrl,
  position = 'bottom-right',
  offsetBottom = 88,
  offsetSide = 20,
}: SupportWidgetProps) {
  const [view, setView] = useState<View>('closed')
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [connected, setConnected] = useState(false)
  const [chatFailed, setChatFailed] = useState(false)
  const [chatRetry, setChatRetry] = useState(0)
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [ticketsError, setTicketsError] = useState<string | null>(null)
  const [bugTitle, setBugTitle] = useState('')
  const [bugDesc, setBugDesc] = useState('')
  const [bugFiles, setBugFiles] = useState<File[]>([])
  const [featureTitle, setFeatureTitle] = useState('')
  const [featureDesc, setFeatureDesc] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const everConnectedRef = useRef(false)
  const endRef = useRef<HTMLDivElement>(null)

  const posStyle = position === 'bottom-left'
    ? { left: offsetSide, bottom: offsetBottom }
    : { right: offsetSide, bottom: offsetBottom }

  // Ensure client telemetry is trapping console/network errors. Idempotent —
  // apps should also call installTelemetry() at their root for earliest coverage,
  // but installing here guarantees the widget's auto-captured logs are non-empty.
  useEffect(() => { installTelemetry() }, [])

  // WebSocket for chat — default path is the awkit-backend relay proxy
  // (comms_router mounts at /api/platform), which every awkit tenant app has.
  useEffect(() => {
    if (view !== 'chat') return
    // One shared resolver -- see lib/relayWsUrl.ts. The previous inline copy
    // fell back to window.location.host, which is the STATIC host on a Pages
    // deployment and serves no socket.
    const url = buildRelayWsUrl(relayWsUrl, apiBase)
    everConnectedRef.current = false
    setChatFailed(false)
    try {
      const ws = new WebSocket(url)
      wsRef.current = ws
      ws.onopen = () => {
        everConnectedRef.current = true
        setConnected(true)
        ws.send(JSON.stringify({ type: 'join', channel: '#support' }))
      }
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data)
          if (m.type === 'message' || m.type === 'chat') {
            setChatMsgs(prev => [...prev.slice(-50), {
              id: m.id || String(Date.now()),
              author: m.author || m.from || 'system',
              content: m.content || m.text || m.body || '',
              isAgent: m.is_agent || m.author === 'aither' || false,
            }])
          }
        } catch {}
      }
      // A socket that dies without EVER opening is a dead endpoint, not a blip —
      // surface an honest failure state instead of "Connecting..." forever.
      ws.onclose = () => { setConnected(false); if (!everConnectedRef.current) setChatFailed(true) }
      ws.onerror = () => { setConnected(false); if (!everConnectedRef.current) setChatFailed(true) }
      return () => { ws.close(); wsRef.current = null }
    } catch { setConnected(false); setChatFailed(true) }
  }, [view, relayWsUrl, apiBase, chatRetry])

  // Tickets — in-widget list from the shared support proxy
  useEffect(() => {
    if (view !== 'tickets') return
    setTickets(null)
    setTicketsError(null)
    fetch(`${apiBase}/api/support/tickets`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => {
        const list = Array.isArray(d) ? d : d?.tickets
        if (Array.isArray(list)) setTickets(list)
        else throw new Error(d?.error || 'unexpected response')
      })
      .catch(e => setTicketsError(String(e?.message || e)))
  }, [view, apiBase])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMsgs])

  const sendChat = () => {
    if (!chatInput.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify({ type: 'message', channel: '#support', content: chatInput }))
    setChatInput('')
  }

  // Upload screenshot/video evidence first; server validates type/size and
  // stores it tenant-scoped, returning a reference we attach to the report.
  const uploadAttachments = async (): Promise<object[]> => {
    const refs: object[] = []
    for (const f of bugFiles.slice(0, 5)) {
      try {
        const fd = new FormData()
        fd.append('file', f)
        const res = await fetch(`${apiBase}/api/files/feedback-attachment`, { method: 'POST', body: fd })
        if (res.ok) refs.push(await res.json())
      } catch { /* best-effort — a failed attachment must not block the report */ }
    }
    return refs
  }

  // `fetch` only rejects on a NETWORK failure. A 404 or a 401 is a perfectly
  // resolved promise, so `await fetch(...)` followed by setView('submitted')
  // reports "Thanks! Your submission has been received." for a report that
  // reached nothing at all. Measured 2026-08-18 on dgg.aitherium.com: the site
  // is a static GitHub Pages host with `__AITHER_API_BASE__ = ""`, so all four
  // support endpoints 404 -- and every bug report ever filed there was discarded
  // while the user was thanked for it. The READ path in this same file already
  // checked `r.ok` (which is why "My Tickets" honestly said HTTP 404), so the
  // widget was telling the truth about reads and lying about writes.
  const postReport = async (payload: object): Promise<void> => {
    const res = await fetch(`${apiBase}/api/feedback/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      // 401 is not a bug, it is "you are signed out" -- and it is the most
      // likely failure on a tenant desktop, so it must not read as an outage.
      throw new Error(
        res.status === 401 || res.status === 403
          ? 'Please sign in first — your report needs an account to attach to.'
          : `Could not send your report (HTTP ${res.status}).`
      )
    }
  }

  const submitBug = async () => {
    if (!bugTitle.trim() || !bugDesc.trim()) return
    setSubmitError(null)
    setSubmitting(true)
    try {
      const attachments = await uploadAttachments()
      await postReport({
        type: 'bug_report', title: bugTitle, description: bugDesc,
        category: 'general', severity: 'medium',
        app_name: appName, client_logs: captureQuickLogs(),
        attachments,
      })
      setBugTitle(''); setBugDesc(''); setBugFiles([])
      setSubmitError(null)
      setView('submitted')
    } catch (e: any) {
      // Keep what they typed. Clearing the form on a failed send destroys the
      // report AND tells them it worked.
      setSubmitError(String(e?.message || e))
    }
    setSubmitting(false)
  }

  const submitFeature = async () => {
    if (!featureTitle.trim() || !featureDesc.trim()) return
    setSubmitError(null)
    setSubmitting(true)
    try {
      await postReport({
        type: 'platform_feedback', feedback_type: 'suggestion',
        subject: featureTitle, body: featureDesc,
        app_name: appName, client_logs: captureQuickLogs(),
      })
      setFeatureTitle(''); setFeatureDesc('')
      setSubmitError(null)
      setView('submitted')
    } catch (e: any) {
      setSubmitError(String(e?.message || e))
    }
    setSubmitting(false)
  }

  // ── Bubble (closed state) ──
  if (view === 'closed') {
    return (
      <button
        onClick={() => setView('menu')}
        aria-label="Open support"
        style={{
          // zIndex 210, not 9999. The desktop has a real stacking order --
          // windows from 100, taskbar 200, tray popovers 250, start menu 250 --
          // and 9999 sat outside it as an island, so this 56px bubble painted
          // ON TOP of an open system-tray popover and covered its Report Issue
          // row. Reported by the owner from a screenshot of the live desktop.
          // 210 keeps it above the taskbar and page content while losing to any
          // popover the user has deliberately opened.
          position: 'fixed', ...posStyle, zIndex: 210,
          width: 56, height: 56, borderRadius: '50%',
          background: 'var(--accent-primary, #6366f1)', color: '#fff',
          border: 'none', cursor: 'pointer', fontSize: '1.5rem',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        ?
      </button>
    )
  }

  // ── Panel container ──
  const panelStyle: React.CSSProperties = {
    // 260: the OPEN panel is a surface the user is deliberately looking at, so
    // it may sit above tray popovers (250) -- unlike the closed bubble, which
    // must not. Still inside the shell's scale rather than an island at 9999.
    position: 'fixed', ...posStyle, zIndex: 260,
    width: 360, maxHeight: 520,
    background: 'var(--bg-surface, #1e1e2e)', color: 'var(--text-primary, #e0e0e0)',
    border: '1px solid var(--glass-border, #333)', borderRadius: 12,
    boxShadow: '0 8px 30px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column',
    overflow: 'hidden', fontFamily: 'system-ui, sans-serif',
  }

  const headerStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '0.75rem 1rem', borderBottom: '1px solid var(--glass-border, #333)',
    fontWeight: 600, fontSize: '0.9rem',
  }

  const bodyStyle: React.CSSProperties = { flex: 1, overflowY: 'auto', padding: '1rem' }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.5rem', background: 'var(--bg-elevated, #2a2a3e)',
    border: '1px solid var(--glass-border, #333)', borderRadius: 6,
    color: 'var(--text-primary, #e0e0e0)', fontSize: '0.85rem', fontFamily: 'inherit',
  }

  const btnStyle = (primary = true): React.CSSProperties => ({
    padding: '0.5rem 1rem', borderRadius: 6, fontWeight: 600, fontSize: '0.85rem',
    cursor: 'pointer', border: primary ? 'none' : '1px solid var(--glass-border, #333)',
    background: primary ? 'var(--accent-primary, #6366f1)' : 'transparent',
    color: primary ? '#fff' : 'var(--text-primary, #e0e0e0)', width: '100%',
  })

  const menuItemStyle: React.CSSProperties = {
    display: 'block', width: '100%', padding: '0.75rem 1rem', textAlign: 'left',
    background: 'var(--bg-elevated, #2a2a3e)', border: '1px solid var(--glass-border, #333)',
    borderRadius: 8, cursor: 'pointer', color: 'var(--text-primary, #e0e0e0)',
    fontSize: '0.85rem', marginBottom: '0.5rem', fontFamily: 'inherit',
  }

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span>{view === 'menu' ? 'How can we help?' : view === 'chat' ? '#support' : view === 'bug' ? 'Bug Report' : view === 'feature' ? 'Feature Request' : view === 'tickets' ? 'My Tickets' : 'Thank you!'}</span>
        <button onClick={() => setView('closed')} style={{ background: 'none', border: 'none', color: 'var(--text-muted, #888)', cursor: 'pointer', fontSize: '1.2rem' }}>x</button>
      </div>

      <div style={bodyStyle}>
        {/* Menu */}
        {view === 'menu' && (
          <div>
            <button style={menuItemStyle} onClick={() => setView('chat')}>
              <strong>Live Chat</strong>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)', marginTop: 2 }}>Chat with our AI support agent</div>
            </button>
            <button style={menuItemStyle} onClick={() => setView('bug')}>
              <strong>Report a Bug</strong>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)', marginTop: 2 }}>Logs captured automatically</div>
            </button>
            <button style={menuItemStyle} onClick={() => setView('feature')}>
              <strong>Request a Feature</strong>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)', marginTop: 2 }}>Tell us what you need</div>
            </button>
            <button style={menuItemStyle} onClick={() => setView('tickets')}>
              <strong>View My Tickets</strong>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)', marginTop: 2 }}>Check status of your requests</div>
            </button>
            {supportPageUrl && (
              <a href={supportPageUrl} style={{ ...menuItemStyle, textDecoration: 'none', display: 'block' }}>
                <strong>Open Support Page</strong>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)', marginTop: 2 }}>Full support portal</div>
              </a>
            )}
          </div>
        )}

        {/* Chat */}
        {view === 'chat' && chatFailed && (
          <div style={{ textAlign: 'center', padding: '1.5rem' }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>Support chat is unavailable</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #888)', marginBottom: '1rem' }}>
              We couldn't reach the live chat service. You can report the problem instead — reports go straight to our triage queue.
            </div>
            <button onClick={() => setView('bug')} style={btnStyle(true)}>Report a Bug</button>
            <button onClick={() => setChatRetry(n => n + 1)} style={{ ...btnStyle(false), marginTop: '0.4rem' }}>Retry chat</button>
            <button onClick={() => setView('menu')} style={{ ...btnStyle(false), marginTop: '0.4rem' }}>Back</button>
          </div>
        )}
        {view === 'chat' && !chatFailed && (
          <div style={{ display: 'flex', flexDirection: 'column', height: 360 }}>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.5rem' }}>
              {chatMsgs.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem', fontSize: '0.8rem' }}>
                  {connected ? 'Type a message to get started.' : 'Connecting...'}
                </div>
              )}
              {chatMsgs.map(m => (
                <div key={m.id} style={{
                  alignSelf: m.isAgent ? 'flex-start' : 'flex-end', maxWidth: '85%',
                  padding: '0.4rem 0.6rem', borderRadius: 8, fontSize: '0.8rem',
                  background: m.isAgent ? 'var(--bg-elevated, #2a2a3e)' : 'var(--accent-primary, #6366f1)',
                  color: m.isAgent ? 'var(--text-primary)' : '#fff',
                }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 600, opacity: 0.6 }}>{m.author}</div>
                  {m.content}
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendChat()} disabled={!connected}
                placeholder={connected ? 'Type a message...' : 'Connecting...'}
                style={{ ...inputStyle, flex: 1 }} />
              <button onClick={sendChat} disabled={!connected} style={{ ...btnStyle(true), width: 'auto', padding: '0.5rem 0.8rem' }}>Send</button>
            </div>
          </div>
        )}

        {/* Tickets */}
        {view === 'tickets' && (
          <div>
            {tickets === null && !ticketsError && (
              <div style={{ textAlign: 'center', color: 'var(--text-muted, #888)', padding: '1rem', fontSize: '0.8rem' }}>Loading tickets...</div>
            )}
            {ticketsError && (
              <div style={{ textAlign: 'center', padding: '1rem' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #888)', marginBottom: '0.75rem' }}>
                  Couldn't load your tickets ({ticketsError}).
                </div>
                <button onClick={() => setView('menu')} style={btnStyle(false)}>Back</button>
              </div>
            )}
            {tickets !== null && tickets.length === 0 && (
              <div style={{ textAlign: 'center', padding: '1rem' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #888)', marginBottom: '0.75rem' }}>
                  No tickets yet. Bug reports and feature requests you submit show up here.
                </div>
                <button onClick={() => setView('menu')} style={btnStyle(false)}>Back</button>
              </div>
            )}
            {tickets !== null && tickets.length > 0 && (
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: 340, overflowY: 'auto', marginBottom: '0.5rem' }}>
                  {tickets.map(t => (
                    <div key={t.id} style={{ padding: '0.6rem 0.75rem', background: 'var(--bg-elevated, #2a2a3e)',
                      border: '1px solid var(--glass-border, #333)', borderRadius: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'baseline' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</span>
                        <span style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', flexShrink: 0,
                          color: t.status === 'resolved' || t.status === 'closed' ? 'var(--accent-green, #4ade80)' : 'var(--accent-primary, #6366f1)' }}>
                          {t.status}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted, #888)', marginTop: 2 }}>
                        {t.created_at ? new Date(t.created_at).toLocaleDateString() : ''}
                        {typeof t.comment_count === 'number' ? ` · ${t.comment_count} comment${t.comment_count === 1 ? '' : 's'}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={() => setView('menu')} style={btnStyle(false)}>Back</button>
              </div>
            )}
          </div>
        )}

        {/* Bug report */}
        {view === 'bug' && (
          <div>
            <div style={{ marginBottom: '0.5rem' }}>
              <input value={bugTitle} onChange={e => setBugTitle(e.target.value)} placeholder="Brief title" style={inputStyle} />
            </div>
            <div style={{ marginBottom: '0.5rem' }}>
              <textarea value={bugDesc} onChange={e => setBugDesc(e.target.value)} placeholder="What happened?"
                style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }} />
            </div>
            <div style={{ marginBottom: '0.5rem' }}>
              <label style={{ fontSize: '0.72rem', color: 'var(--text-muted, #888)', cursor: 'pointer' }}>
                📎 Attach screenshots / video (optional)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime"
                  multiple
                  style={{ display: 'block', marginTop: 4, fontSize: '0.72rem' }}
                  onChange={e => setBugFiles(Array.from(e.target.files || []).slice(0, 5))}
                />
              </label>
              {bugFiles.length > 0 && (
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted, #888)', marginTop: 2 }}>
                  {bugFiles.length} file{bugFiles.length > 1 ? 's' : ''} attached
                </div>
              )}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)', marginBottom: '0.75rem' }}>
              Browser logs and page context will be attached automatically.
            </div>
            {submitError && (
              <div role="alert" style={{
                fontSize: '0.78rem', color: '#fca5a5',
                background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.35)',
                borderRadius: 6, padding: '0.5rem 0.6rem', marginBottom: '0.5rem',
              }}>
                {submitError} Your text is still here — nothing was lost.
              </div>
            )}
            <button onClick={submitBug} disabled={submitting || !bugTitle.trim() || !bugDesc.trim()} style={btnStyle(true)}>
              {submitting ? 'Submitting...' : 'Submit Bug Report'}
            </button>
            <button onClick={() => setView('menu')} style={{ ...btnStyle(false), marginTop: '0.4rem' }}>Back</button>
          </div>
        )}

        {/* Feature request */}
        {view === 'feature' && (
          <div>
            <div style={{ marginBottom: '0.5rem' }}>
              <input value={featureTitle} onChange={e => setFeatureTitle(e.target.value)} placeholder="Feature name" style={inputStyle} />
            </div>
            <div style={{ marginBottom: '0.75rem' }}>
              <textarea value={featureDesc} onChange={e => setFeatureDesc(e.target.value)} placeholder="Describe what you'd like..."
                style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }} />
            </div>
            {submitError && (
              <div role="alert" style={{
                fontSize: '0.78rem', color: '#fca5a5',
                background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.35)',
                borderRadius: 6, padding: '0.5rem 0.6rem', marginBottom: '0.5rem',
              }}>
                {submitError} Your text is still here — nothing was lost.
              </div>
            )}
            <button onClick={submitFeature} disabled={submitting || !featureTitle.trim() || !featureDesc.trim()} style={btnStyle(true)}>
              {submitting ? 'Submitting...' : 'Submit Feature Request'}
            </button>
            <button onClick={() => setView('menu')} style={{ ...btnStyle(false), marginTop: '0.4rem' }}>Back</button>
          </div>
        )}

        {/* Submitted */}
        {view === 'submitted' && (
          <div style={{ textAlign: 'center', padding: '1.5rem' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Thanks!</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Your submission has been received. We'll follow up in your tickets.
            </div>
            <button onClick={() => setView('menu')} style={btnStyle(false)}>Back to menu</button>
          </div>
        )}
      </div>
    </div>
  )
}
