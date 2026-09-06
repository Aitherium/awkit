'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface Props {
  apiBase?: string
}

interface Channel {
  name: string
  topic?: string
  mode?: string
  unread?: number
}

interface Message {
  id?: string
  nick: string
  content: string
  timestamp?: string
  metadata?: Record<string, unknown>
}

export default function RelayChannelsPanel({ apiBase = '/api' }: Props) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  const fetchChannels = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/workspace/channels`)
      if (r.ok) {
        const data = await r.json()
        setChannels(data.channels || [])
        setConnected(data.relay_connected ?? false)
        if (!active && data.channels?.length) {
          setActive(data.channels[0].name)
        }
      }
    } catch { /* best-effort */ }
    setLoading(false)
  }, [apiBase, active])

  const fetchHistory = useCallback(async (ch: string) => {
    try {
      const r = await fetch(`${apiBase}/workspace/channels/${ch}/history?limit=50`)
      if (r.ok) {
        const data = await r.json()
        setMessages(data.messages || [])
      }
    } catch { /* best-effort */ }
  }, [apiBase])

  useEffect(() => { fetchChannels() }, [fetchChannels])
  useEffect(() => {
    if (active) fetchHistory(active)
  }, [active, fetchHistory])
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Poll for new messages every 10s
  useEffect(() => {
    if (!active) return
    const iv = setInterval(() => fetchHistory(active), 10_000)
    return () => clearInterval(iv)
  }, [active, fetchHistory])

  const send = async () => {
    if (!input.trim() || !active) return
    try {
      await fetch(`${apiBase}/workspace/channels/${active}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: input }),
      })
      setInput('')
      fetchHistory(active)
    } catch { /* best-effort */ }
  }

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading channels...</div>
  }

  if (!connected) {
    return (
      <div style={{ padding: 24 }}>
        <h3 style={{ margin: '0 0 8px' }}>Team Channels</h3>
        <p style={{ color: 'var(--text-muted)' }}>
          Relay not connected. Channels will be available once the workspace is provisioned.
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* Channel list sidebar */}
      <aside style={{
        width: 200,
        borderRight: '1px solid var(--border)',
        padding: '12px 0',
        overflowY: 'auto',
        background: 'var(--bg-elevated)',
      }}>
        <div style={{ padding: '0 12px 8px', fontWeight: 600, fontSize: 13 }}>
          Channels
        </div>
        {channels.map(ch => (
          <button
            key={ch.name}
            onClick={() => setActive(ch.name)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '6px 12px',
              border: 'none',
              background: ch.name === active ? 'var(--bg-active)' : 'transparent',
              color: ch.name === active ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 13,
              borderRadius: 4,
              margin: '0 4px',
              maxWidth: 'calc(100% - 8px)',
            }}
          >
            # {ch.name}
          </button>
        ))}
      </aside>

      {/* Message area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <div style={{
          padding: '8px 16px',
          borderBottom: '1px solid var(--border)',
          fontWeight: 600,
          fontSize: 14,
        }}>
          {active ? `# ${active}` : 'Select a channel'}
          {active && channels.find(c => c.name === active)?.topic && (
            <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)', marginLeft: 12 }}>
              {channels.find(c => c.name === active)!.topic}
            </span>
          )}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {messages.length === 0 && (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 40 }}>
              No messages yet
            </div>
          )}
          {messages.map((msg, i) => {
            const isAgent = msg.metadata && (
              (msg.metadata as Record<string, unknown>).source === 'aitherchat'
              || (msg.nick || '').includes('bot')
              || (msg.nick || '').includes('system')
            )
            return (
              <div key={msg.id || i} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, marginBottom: 2 }}>
                  <strong style={{
                    color: isAgent ? 'var(--accent)' : 'var(--text-primary)',
                  }}>
                    {msg.nick || 'unknown'}
                  </strong>
                  {msg.timestamp && (
                    <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 11 }}>
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                <div style={{
                  fontSize: 13,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  color: isAgent ? 'var(--text-secondary)' : 'var(--text-primary)',
                  background: isAgent ? 'var(--bg-elevated)' : 'transparent',
                  padding: isAgent ? '4px 8px' : 0,
                  borderRadius: 4,
                }}>
                  {msg.content}
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        {active && (
          <div style={{
            padding: '8px 16px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: 8,
          }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
              placeholder={`Message #${active}`}
              style={{
                flex: 1,
                padding: '8px 12px',
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: 'var(--bg)',
                color: 'var(--text-primary)',
                fontSize: 13,
              }}
            />
            <button
              onClick={send}
              disabled={!input.trim()}
              style={{
                padding: '8px 16px',
                border: 'none',
                borderRadius: 6,
                background: 'var(--accent)',
                color: 'white',
                cursor: input.trim() ? 'pointer' : 'default',
                opacity: input.trim() ? 1 : 0.5,
                fontSize: 13,
              }}
            >
              Send
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
