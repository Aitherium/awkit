'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

/* ── Types ─────────────────────────────────────────────────────────── */

interface MailAccount {
  id: string
  email: string
  provider: string
  display_name?: string
  status?: string
  last_sync_at?: string | null
  last_error?: string | null
}

interface ProviderPreset {
  id: string
  defaults: {
    imap_host?: string
    imap_port?: number
    imap_ssl?: boolean
    smtp_host?: string
    smtp_port?: number
    smtp_starttls?: boolean
  }
}

interface MailFolder {
  name: string
  unread_count: number
  total_count: number
}

interface MailMessage {
  id: string
  from_address: string
  from_name?: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  preview: string
  body_html?: string
  body_text?: string
  date: string
  is_read: boolean
  is_starred: boolean
  folder: string
  attachments?: MailAttachment[]
}

interface MailAttachment {
  id: string
  filename: string
  size: number
  content_type: string
  download_url?: string
}

interface DirectoryContact {
  email: string
  name?: string
}

export interface MailPanelProps {
  apiBase?: string
}

/* ── Styles ────────────────────────────────────────────────────────── */

const sBtn = (active = false): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 6,
  border: active ? 'none' : '1px solid var(--border)',
  background: active ? 'var(--accent)' : 'transparent',
  color: active ? '#fff' : 'var(--text-muted)',
  cursor: 'pointer', fontSize: '0.8rem', fontWeight: active ? 600 : 400,
})

const sInput: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg-deep)',
  color: 'var(--text)', width: '100%', boxSizing: 'border-box',
}

const sCard: React.CSSProperties = {
  padding: '10px 14px', borderRadius: 8,
  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
}

/* ── Component ─────────────────────────────────────────────────────── */

export default function MailPanel({ apiBase = '/api/mail' }: MailPanelProps) {
  const [accounts, setAccounts] = useState<MailAccount[]>([])
  const [activeAccount, setActiveAccount] = useState<string | null>(null)
  const [folders, setFolders] = useState<MailFolder[]>([])
  const [activeFolder, setActiveFolder] = useState('INBOX')
  const [messages, setMessages] = useState<MailMessage[]>([])
  const [selectedMsg, setSelectedMsg] = useState<MailMessage | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  // Compose state
  const [showCompose, setShowCompose] = useState(false)
  const [composeTo, setComposeTo] = useState('')
  const [composeCc, setComposeCc] = useState('')
  const [composeBcc, setComposeBcc] = useState('')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [showCcBcc, setShowCcBcc] = useState(false)
  const [sending, setSending] = useState(false)
  const [toSuggestions, setToSuggestions] = useState<DirectoryContact[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const toInputRef = useRef<HTMLInputElement>(null)

  // Connect Account modal state
  const [showConnect, setShowConnect] = useState(false)
  const [providers, setProviders] = useState<ProviderPreset[]>([])
  const [cProvider, setCProvider] = useState('gmail')
  const [cEmail, setCEmail] = useState('')
  const [cUsername, setCUsername] = useState('')
  const [cPassword, setCPassword] = useState('')
  const [cDisplayName, setCDisplayName] = useState('')
  const [cShowAdvanced, setCShowAdvanced] = useState(false)
  const [cImapHost, setCImapHost] = useState('')
  const [cImapPort, setCImapPort] = useState('')
  const [cSmtpHost, setCSmtpHost] = useState('')
  const [cSmtpPort, setCSmtpPort] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  /* ── Data fetching ────────────────────────────────────────────── */

  const fetchAccounts = useCallback(async () => {
    try {
      const resp = await fetch(`${apiBase}/accounts`)
      if (resp.ok) {
        const data = await resp.json()
        const list: MailAccount[] = data?.data?.accounts ?? data?.accounts ?? []
        setAccounts(list)
        if (list.length > 0 && !activeAccount) {
          setActiveAccount(list[0].id)
        }
      }
    } catch (e) {
      console.error('Mail accounts fetch error:', e)
    }
  }, [apiBase, activeAccount])

  const fetchFolders = useCallback(async () => {
    try {
      const resp = await fetch(`${apiBase}/folders`)
      if (resp.ok) {
        const data = await resp.json()
        setFolders(data?.data?.folders ?? data?.folders ?? [])
      }
    } catch (e) {
      console.error('Mail folders fetch error:', e)
    }
  }, [apiBase])

  const fetchMessages = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ folder: activeFolder })
      if (searchQuery) params.set('search', searchQuery)
      const resp = await fetch(`${apiBase}/messages?${params}`)
      if (resp.ok) {
        const data = await resp.json()
        const raw = data?.data?.messages ?? data?.messages ?? data?.items ?? []
        setMessages(raw.map(normalizeMsg))
      }
    } catch (e) {
      console.error('Mail messages fetch error:', e)
    }
    setLoading(false)
  }, [apiBase, activeFolder, searchQuery])

  const fetchFullMessage = useCallback(async (id: string) => {
    try {
      const resp = await fetch(`${apiBase}/messages/${id}`)
      if (resp.ok) {
        const data = await resp.json()
        const raw = data?.data?.message ?? data?.message ?? data?.data ?? data
        setSelectedMsg(normalizeMsg(raw))
      }
    } catch (e) {
      console.error('Mail message detail error:', e)
    }
  }, [apiBase])

  useEffect(() => { fetchAccounts() }, [fetchAccounts])
  useEffect(() => { fetchFolders() }, [fetchFolders])
  useEffect(() => { fetchMessages() }, [fetchMessages])

  // Load provider presets when modal opens
  useEffect(() => {
    if (!showConnect || providers.length > 0) return
    fetch(`${apiBase}/providers`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.providers) setProviders(d.providers) })
      .catch(() => {})
  }, [showConnect, providers.length, apiBase])

  /* ── Actions ──────────────────────────────────────────────────── */

  const markRead = async (id: string) => {
    try {
      await fetch(`${apiBase}/messages/${id}/read`, { method: 'POST' })
      setMessages(prev => prev.map(m => m.id === id ? { ...m, is_read: true } : m))
    } catch (e) { console.error('Mark read error:', e) }
  }

  const markUnread = async (id: string) => {
    try {
      await fetch(`${apiBase}/messages/${id}/unread`, { method: 'POST' })
      setMessages(prev => prev.map(m => m.id === id ? { ...m, is_read: false } : m))
    } catch (e) { console.error('Mark unread error:', e) }
  }

  const toggleStar = async (id: string) => {
    try {
      await fetch(`${apiBase}/messages/${id}/star`, { method: 'POST' })
      setMessages(prev => prev.map(m => m.id === id ? { ...m, is_starred: !m.is_starred } : m))
    } catch (e) { console.error('Star toggle error:', e) }
  }

  const deleteMessage = async (id: string) => {
    try {
      await fetch(`${apiBase}/messages/${id}`, { method: 'DELETE' })
      setMessages(prev => prev.filter(m => m.id !== id))
      if (selectedMsg?.id === id) setSelectedMsg(null)
    } catch (e) { console.error('Delete message error:', e) }
  }

  const moveToFolder = async (id: string, folder: string) => {
    try {
      await fetch(`${apiBase}/messages/${id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder }),
      })
      fetchMessages()
    } catch (e) { console.error('Move message error:', e) }
  }

  const handleSend = async () => {
    if (!composeTo || !composeSubject) return
    setSending(true)
    try {
      const resp = await fetch(`${apiBase}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: composeTo.split(',').map(s => s.trim()),
          cc: composeCc ? composeCc.split(',').map(s => s.trim()) : [],
          bcc: composeBcc ? composeBcc.split(',').map(s => s.trim()) : [],
          subject: composeSubject,
          body: composeBody,
          from_account: activeAccount,
        }),
      })
      if (resp.ok) {
        setShowCompose(false)
        setComposeTo(''); setComposeCc(''); setComposeBcc('')
        setComposeSubject(''); setComposeBody('')
        setShowCcBcc(false)
        fetchMessages()
      }
    } catch (e) {
      console.error('Send mail error:', e)
    }
    setSending(false)
  }

  const handleRefresh = async () => {
    // Trigger remote sync for any connected accounts, then re-fetch.
    try {
      if (accounts.length > 0) {
        await fetch(`${apiBase}/sync/trigger`, { method: 'POST' })
      }
    } catch (e) { console.error('Sync trigger error:', e) }
    fetchFolders()
    fetchMessages()
  }

  const handleConnect = async () => {
    if (!cEmail || !cPassword) {
      setConnectError('Email and password are required.')
      return
    }
    setConnecting(true)
    setConnectError(null)
    try {
      const body: Record<string, unknown> = {
        provider: cProvider,
        email: cEmail,
        password: cPassword,
        username: cUsername || undefined,
        display_name: cDisplayName || undefined,
      }
      if (cShowAdvanced) {
        if (cImapHost) body.imap_host = cImapHost
        if (cImapPort) body.imap_port = parseInt(cImapPort, 10)
        if (cSmtpHost) body.smtp_host = cSmtpHost
        if (cSmtpPort) body.smtp_port = parseInt(cSmtpPort, 10)
      }
      const resp = await fetch(`${apiBase}/accounts/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.detail || `HTTP ${resp.status}`)
      }
      setShowConnect(false)
      setCEmail(''); setCUsername(''); setCPassword('')
      setCDisplayName(''); setCImapHost(''); setCImapPort('')
      setCSmtpHost(''); setCSmtpPort(''); setCShowAdvanced(false)
      await fetchAccounts()
      await fetchFolders()
      await fetchMessages()
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : String(e))
    }
    setConnecting(false)
  }

  const disconnectAccount = async (id: string) => {
    if (!confirm('Disconnect this account? Cached messages will be removed.')) return
    try {
      await fetch(`${apiBase}/accounts/${id}/disconnect`, { method: 'POST' })
      if (activeAccount === id) setActiveAccount(null)
      await fetchAccounts()
      await fetchMessages()
    } catch (e) { console.error('Disconnect error:', e) }
  }

  /* ── Directory autocomplete ──────────────────────────────────── */

  const handleToChange = async (val: string) => {
    setComposeTo(val)
    const lastToken = val.split(',').pop()?.trim() ?? ''
    if (lastToken.length >= 2) {
      try {
        const resp = await fetch(`${apiBase.replace('/mail', '/directory')}/members?search=${encodeURIComponent(lastToken)}`)
        if (resp.ok) {
          const data = await resp.json()
          const members = data?.data?.members ?? data?.members ?? []
          setToSuggestions(members.map((m: any) => ({ email: m.email, name: m.name })))
          setShowSuggestions(true)
        }
      } catch { setShowSuggestions(false) }
    } else {
      setShowSuggestions(false)
    }
  }

  const applySuggestion = (contact: DirectoryContact) => {
    const parts = composeTo.split(',')
    parts[parts.length - 1] = ` ${contact.email}`
    setComposeTo(parts.join(',').replace(/^,\s*/, ''))
    setShowSuggestions(false)
    toInputRef.current?.focus()
  }

  /* ── Field normalization ────────────────────────────────────── */

  /** Backend may return from_addr/to_addr/body/created_at instead of
   *  from_address/to/body_text/date. Normalize to MailMessage shape. */
  const normalizeMsg = (raw: any): MailMessage => ({
    id: raw.id,
    from_address: raw.from_address || raw.from_addr || '',
    from_name: raw.from_name || '',
    to: Array.isArray(raw.to) ? raw.to : (raw.to_addr ? [raw.to_addr] : []),
    cc: Array.isArray(raw.cc) ? raw.cc : raw.cc ? [raw.cc] : [],
    bcc: Array.isArray(raw.bcc) ? raw.bcc : raw.bcc ? [raw.bcc] : [],
    subject: raw.subject || '',
    preview: raw.preview || raw.body?.slice(0, 120) || '',
    body_html: raw.body_html || '',
    body_text: raw.body_text || raw.body || '',
    date: raw.date || raw.created_at || raw.received_at || '',
    is_read: raw.is_read ?? false,
    is_starred: raw.is_starred ?? false,
    folder: raw.folder || '',
    attachments: raw.attachments || [],
  })

  /* ── Helpers ──────────────────────────────────────────────────── */

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso)
      const now = new Date()
      if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
      }
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    } catch { return iso }
  }

  const formatFullDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
      })
    } catch { return iso }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const folderIcon = (name: string) => {
    const map: Record<string, string> = {
      INBOX: '\u2709', Sent: '\u2197', Drafts: '\u270E', Trash: '\u2716', Starred: '\u2605',
    }
    return map[name] ?? '\u2500'
  }

  const inboxUnread = folders.find(f => f.name === 'INBOX')?.unread_count ?? 0

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 500, maxWidth: 1200, margin: '0 auto' }}>
      {/* Folder Sidebar */}
      <div style={{
        width: 200, flexShrink: 0, borderRight: '1px solid var(--border)',
        padding: '1rem 0.75rem', display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        {/* Account selector */}
        {accounts.length > 1 && (
          <select
            value={activeAccount ?? ''}
            onChange={e => setActiveAccount(e.target.value)}
            style={{
              ...sInput, marginBottom: 12, fontSize: '0.75rem', padding: '6px 8px',
            }}
          >
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.email}</option>
            ))}
          </select>
        )}
        {accounts.length === 1 && (
          <div style={{
            fontSize: '0.7rem', color: 'var(--text-muted)', padding: '4px 8px',
            marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {accounts[0].email}
          </div>
        )}

        <button onClick={() => { setShowCompose(true); setSelectedMsg(null) }} style={{
          ...sBtn(true), marginBottom: 8, width: '100%', textAlign: 'center',
        }}>
          Compose
        </button>

        <button onClick={() => setShowConnect(true)} style={{
          ...sBtn(), marginBottom: 12, width: '100%', textAlign: 'center',
          fontSize: '0.72rem',
        }} title="Connect Gmail / Outlook / IMAP account">
          {accounts.length === 0 ? '+ Connect Mailbox' : '+ Add Account'}
        </button>

        {(folders.length > 0 ? folders : [
          { name: 'INBOX', unread_count: 0, total_count: 0 },
          { name: 'Sent', unread_count: 0, total_count: 0 },
          { name: 'Drafts', unread_count: 0, total_count: 0 },
          { name: 'Trash', unread_count: 0, total_count: 0 },
        ]).map(f => (
          <button
            key={f.name}
            onClick={() => { setActiveFolder(f.name); setSelectedMsg(null) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '8px 10px', borderRadius: 6, border: 'none',
              background: activeFolder === f.name ? 'rgba(124,58,237,0.15)' : 'transparent',
              color: activeFolder === f.name ? 'var(--accent)' : 'var(--text)',
              cursor: 'pointer', fontSize: '0.8rem', textAlign: 'left',
              fontWeight: f.unread_count > 0 ? 600 : 400,
            }}
          >
            <span style={{ fontSize: '0.9rem', width: 18, textAlign: 'center' }}>
              {folderIcon(f.name)}
            </span>
            <span style={{ flex: 1 }}>{f.name}</span>
            {f.unread_count > 0 && (
              <span style={{
                fontSize: '0.65rem', padding: '1px 6px', borderRadius: 10,
                background: 'var(--accent)', color: '#fff', fontWeight: 700,
              }}>
                {f.unread_count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Message List */}
      <div style={{
        width: selectedMsg ? 300 : undefined,
        flex: selectedMsg ? '0 0 300px' : 1,
        borderRight: selectedMsg ? '1px solid var(--border)' : 'none',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Toolbar */}
        <div style={{
          display: 'flex', gap: 6, padding: '10px 12px',
          borderBottom: '1px solid var(--border)', alignItems: 'center', flexWrap: 'wrap',
        }}>
          <button onClick={handleRefresh} style={sBtn()} title="Refresh">Refresh</button>
          {selectedMsg && (
            <>
              <button onClick={() => selectedMsg.is_read ? markUnread(selectedMsg.id) : markRead(selectedMsg.id)} style={sBtn()}>
                {selectedMsg.is_read ? 'Unread' : 'Read'}
              </button>
              <button onClick={() => deleteMessage(selectedMsg.id)} style={sBtn()}>Delete</button>
              <select
                defaultValue=""
                onChange={e => { if (e.target.value) moveToFolder(selectedMsg.id, e.target.value); e.target.value = '' }}
                style={{ ...sInput, width: 'auto', fontSize: '0.75rem', padding: '4px 8px' }}
              >
                <option value="" disabled>Move to...</option>
                {folders.filter(f => f.name !== activeFolder).map(f => (
                  <option key={f.name} value={f.name}>{f.name}</option>
                ))}
              </select>
            </>
          )}
          <div style={{ flex: 1 }} />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') fetchMessages() }}
            placeholder="Search mail..."
            style={{ ...sInput, width: 180, fontSize: '0.75rem', padding: '6px 10px' }}
          />
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading messages...
            </div>
          )}
          {!loading && messages.length === 0 && (
            <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              No messages in {activeFolder}.
            </div>
          )}
          {!loading && messages.map(msg => (
            <div
              key={msg.id}
              onClick={() => { fetchFullMessage(msg.id); if (!msg.is_read) markRead(msg.id) }}
              style={{
                display: 'flex', gap: 10, padding: '10px 14px', cursor: 'pointer',
                borderBottom: '1px solid var(--border)',
                background: selectedMsg?.id === msg.id ? 'rgba(124,58,237,0.08)' : 'transparent',
              }}
            >
              <button
                onClick={e => { e.stopPropagation(); toggleStar(msg.id) }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  color: msg.is_starred ? '#f59e0b' : 'var(--border)', fontSize: '1rem',
                  flexShrink: 0, marginTop: 2,
                }}
              >
                {msg.is_starred ? '\u2605' : '\u2606'}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{
                    fontWeight: msg.is_read ? 400 : 700,
                    fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {msg.from_name || msg.from_address}
                  </span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                    {formatDate(msg.date)}
                  </span>
                </div>
                <div style={{
                  fontSize: '0.8rem', fontWeight: msg.is_read ? 400 : 600,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {msg.subject || '(no subject)'}
                </div>
                <div style={{
                  fontSize: '0.7rem', color: 'var(--text-muted)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {msg.preview}
                </div>
              </div>
              {!msg.is_read && (
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)',
                  flexShrink: 0, marginTop: 6,
                }} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Message Detail / Compose */}
      {(selectedMsg || showCompose) && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {showCompose ? (
            /* ── Compose View ─────────────────────────────── */
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>New Message</h3>
                <button onClick={() => setShowCompose(false)} style={sBtn()}>Close</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                <div style={{ position: 'relative' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      ref={toInputRef}
                      value={composeTo}
                      onChange={e => handleToChange(e.target.value)}
                      onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                      placeholder="To (comma-separated)"
                      style={sInput}
                    />
                    {!showCcBcc && (
                      <button onClick={() => setShowCcBcc(true)} style={{
                        ...sBtn(), fontSize: '0.7rem', whiteSpace: 'nowrap',
                      }}>
                        Cc/Bcc
                      </button>
                    )}
                  </div>
                  {showSuggestions && toSuggestions.length > 0 && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                      borderRadius: 6, maxHeight: 150, overflowY: 'auto',
                    }}>
                      {toSuggestions.map(c => (
                        <div
                          key={c.email}
                          onClick={() => applySuggestion(c)}
                          style={{
                            padding: '6px 12px', cursor: 'pointer', fontSize: '0.8rem',
                            borderBottom: '1px solid var(--border)',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(124,58,237,0.1)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          {c.name ? `${c.name} <${c.email}>` : c.email}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {showCcBcc && (
                  <>
                    <input value={composeCc} onChange={e => setComposeCc(e.target.value)} placeholder="Cc" style={sInput} />
                    <input value={composeBcc} onChange={e => setComposeBcc(e.target.value)} placeholder="Bcc" style={sInput} />
                  </>
                )}
                <input value={composeSubject} onChange={e => setComposeSubject(e.target.value)} placeholder="Subject" style={sInput} />
                <textarea
                  value={composeBody}
                  onChange={e => setComposeBody(e.target.value)}
                  placeholder="Write your message..."
                  style={{ ...sInput, flex: 1, resize: 'none', minHeight: 200 }}
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setShowCompose(false)} style={sBtn()}>Discard</button>
                  <button onClick={handleSend} disabled={sending} style={sBtn(true)}>
                    {sending ? 'Sending...' : 'Send'}
                  </button>
                </div>
              </div>
            </div>
          ) : selectedMsg ? (
            /* ── Detail View ──────────────────────────────── */
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Header */}
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem', lineHeight: 1.3 }}>
                    {selectedMsg.subject || '(no subject)'}
                  </h3>
                  <button onClick={() => setSelectedMsg(null)} style={sBtn()}>Close</button>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text)' }}>
                  <strong>{selectedMsg.from_name || selectedMsg.from_address}</strong>
                  {selectedMsg.from_name && (
                    <span style={{ color: 'var(--text-muted)' }}> &lt;{selectedMsg.from_address}&gt;</span>
                  )}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  To: {selectedMsg.to?.join(', ')}
                  {selectedMsg.cc && selectedMsg.cc.length > 0 && ` | Cc: ${selectedMsg.cc.join(', ')}`}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  {formatFullDate(selectedMsg.date)}
                </div>

                {/* Reply / Forward */}
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <button onClick={() => {
                    setShowCompose(true)
                    setComposeTo(selectedMsg.from_address)
                    setComposeSubject(selectedMsg.subject.startsWith('Re:') ? selectedMsg.subject : `Re: ${selectedMsg.subject}`)
                    setComposeBody(`\n\n--- Original message ---\nFrom: ${selectedMsg.from_name || selectedMsg.from_address}\nDate: ${formatFullDate(selectedMsg.date)}\n\n${selectedMsg.body_text || selectedMsg.preview}`)
                  }} style={sBtn()}>Reply</button>
                  {selectedMsg.to && selectedMsg.to.length > 1 && (
                    <button onClick={() => {
                      setShowCompose(true)
                      const allRecipients = [selectedMsg.from_address, ...selectedMsg.to.filter(a => a !== 'you@app.local'), ...(selectedMsg.cc || [])]
                      setComposeTo(allRecipients.join(', '))
                      setComposeSubject(selectedMsg.subject.startsWith('Re:') ? selectedMsg.subject : `Re: ${selectedMsg.subject}`)
                      setComposeBody(`\n\n--- Original message ---\nFrom: ${selectedMsg.from_name || selectedMsg.from_address}\nDate: ${formatFullDate(selectedMsg.date)}\n\n${selectedMsg.body_text || selectedMsg.preview}`)
                    }} style={sBtn()}>Reply All</button>
                  )}
                  <button onClick={() => {
                    setShowCompose(true)
                    setComposeTo('')
                    setComposeSubject(selectedMsg.subject.startsWith('Fwd:') ? selectedMsg.subject : `Fwd: ${selectedMsg.subject}`)
                    setComposeBody(`\n\n--- Forwarded message ---\nFrom: ${selectedMsg.from_name || selectedMsg.from_address}\nTo: ${selectedMsg.to?.join(', ')}\nDate: ${formatFullDate(selectedMsg.date)}\nSubject: ${selectedMsg.subject}\n\n${selectedMsg.body_text || selectedMsg.preview}`)
                  }} style={sBtn()}>Forward</button>
                </div>
              </div>

              {/* Body */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>
                {selectedMsg.body_html ? (
                  <div
                    dangerouslySetInnerHTML={{ __html: selectedMsg.body_html }}
                    style={{ fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text)' }}
                  />
                ) : (
                  <pre style={{
                    fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text)',
                    whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0,
                  }}>
                    {selectedMsg.body_text || selectedMsg.preview}
                  </pre>
                )}

                {/* Attachments */}
                {selectedMsg.attachments && selectedMsg.attachments.length > 0 && (
                  <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
                      Attachments ({selectedMsg.attachments.length})
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {selectedMsg.attachments.map(att => (
                        <a
                          key={att.id}
                          href={att.download_url || '#'}
                          download={att.filename}
                          style={{
                            ...sCard, display: 'flex', gap: 8, alignItems: 'center',
                            textDecoration: 'none', color: 'var(--text)',
                            fontSize: '0.75rem', padding: '8px 12px',
                          }}
                        >
                          <span style={{ fontWeight: 500 }}>{att.filename}</span>
                          <span style={{ color: 'var(--text-muted)' }}>{formatSize(att.size)}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Connect Account Modal */}
      {showConnect && (
        <div
          onClick={() => !connecting && setShowConnect(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-elevated)', borderRadius: 8, padding: '1.25rem 1.5rem',
              width: 'min(480px, 90vw)', maxHeight: '90vh', overflowY: 'auto',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>Connect Mail Account</h3>
              <button onClick={() => setShowConnect(false)} style={sBtn()} disabled={connecting}>Close</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Provider
                <select
                  value={cProvider}
                  onChange={e => setCProvider(e.target.value)}
                  style={{ ...sInput, marginTop: 4 }}
                >
                  {(providers.length > 0
                    ? providers.map(p => p.id)
                    : ['gmail', 'outlook', 'protonmail', 'fastmail', 'yahoo', 'icloud', 'imap']
                  ).map(id => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
              </label>

              {cProvider === 'gmail' && (
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', padding: 8, background: 'rgba(245,158,11,0.1)', borderRadius: 4 }}>
                  Use a Google App Password (not your account password). Enable 2FA, then create one at myaccount.google.com/apppasswords.
                </div>
              )}
              {cProvider === 'protonmail' && (
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', padding: 8, background: 'rgba(245,158,11,0.1)', borderRadius: 4 }}>
                  Requires ProtonMail Bridge running locally (127.0.0.1:1143 IMAP / 1025 SMTP).
                </div>
              )}

              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Email Address
                <input value={cEmail} onChange={e => setCEmail(e.target.value)} placeholder="you@example.com" style={{ ...sInput, marginTop: 4 }} />
              </label>

              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Display Name (optional)
                <input value={cDisplayName} onChange={e => setCDisplayName(e.target.value)} placeholder="Personal Gmail" style={{ ...sInput, marginTop: 4 }} />
              </label>

              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Username (if different from email)
                <input value={cUsername} onChange={e => setCUsername(e.target.value)} placeholder="" style={{ ...sInput, marginTop: 4 }} />
              </label>

              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Password / App Password
                <input type="password" value={cPassword} onChange={e => setCPassword(e.target.value)} style={{ ...sInput, marginTop: 4 }} />
              </label>

              <button onClick={() => setCShowAdvanced(v => !v)} style={{ ...sBtn(), alignSelf: 'flex-start', fontSize: '0.7rem' }}>
                {cShowAdvanced ? 'Hide' : 'Show'} advanced (IMAP/SMTP host)
              </button>

              {cShowAdvanced && (
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    IMAP Host
                    <input value={cImapHost} onChange={e => setCImapHost(e.target.value)} placeholder="imap.example.com" style={{ ...sInput, marginTop: 4 }} />
                  </label>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    IMAP Port
                    <input value={cImapPort} onChange={e => setCImapPort(e.target.value)} placeholder="993" style={{ ...sInput, marginTop: 4 }} />
                  </label>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    SMTP Host
                    <input value={cSmtpHost} onChange={e => setCSmtpHost(e.target.value)} placeholder="smtp.example.com" style={{ ...sInput, marginTop: 4 }} />
                  </label>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    SMTP Port
                    <input value={cSmtpPort} onChange={e => setCSmtpPort(e.target.value)} placeholder="587" style={{ ...sInput, marginTop: 4 }} />
                  </label>
                </div>
              )}

              {connectError && (
                <div style={{ fontSize: '0.75rem', color: '#ef4444', padding: 8, background: 'rgba(239,68,68,0.1)', borderRadius: 4 }}>
                  {connectError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={handleConnect} disabled={connecting} style={{ ...sBtn(true), flex: 1 }}>
                  {connecting ? 'Verifying IMAP...' : 'Connect & Verify'}
                </button>
                <button onClick={() => setShowConnect(false)} disabled={connecting} style={sBtn()}>
                  Cancel
                </button>
              </div>

              {accounts.length > 0 && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 8 }}>Connected Accounts</div>
                  {accounts.map(a => (
                    <div key={a.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '6px 8px', borderRadius: 4, background: 'var(--bg-deep)', marginBottom: 4,
                    }}>
                      <span style={{ fontSize: '0.75rem' }}>
                        {a.email} <span style={{ color: 'var(--text-muted)' }}>({a.provider})</span>
                      </span>
                      <button onClick={() => disconnectAccount(a.id)} style={{ ...sBtn(), fontSize: '0.65rem', padding: '3px 8px' }}>
                        Disconnect
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
