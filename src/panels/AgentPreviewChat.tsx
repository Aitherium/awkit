'use client'

import React, { useState, useRef, useEffect } from 'react'

export interface AgentPreviewChatProps {
  apiBase?: string
  /** @deprecated ignored: the preview is stateless on the host's own model. */
  sessionId?: string
  agentName?: string
  systemPrompt?: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Live preview of a draft agent. Each turn POSTs to the HOST app's
 * `/api/agent-builder/preview/chat` (awkit-backend), which answers with the
 * workspace's own model -- never the retired Elysium demo-chat endpoints.
 */
export default function AgentPreviewChat({
  apiBase = '',
  agentName = 'Agent',
  systemPrompt,
}: AgentPreviewChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const messagesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return
    const history = messages
    setInput('')
    setError('')
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setLoading(true)

    try {
      const res = await fetch(`${apiBase}/api/agent-builder/preview/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history,
          ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || `Error ${res.status}`)
      }
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.response || '(no response)' }])
    } catch (e: any) {
      setError(e.message || 'Chat failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', minHeight: 300,
      background: 'var(--bg-deep, #0a0a1a)', borderRadius: 'var(--radius, 10px)',
      border: '1px solid var(--glass-border, #2a2a4a)', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--glass-border, #2a2a4a)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Preview: {agentName}</span>
      </div>

      {/* Messages */}
      <div ref={messagesRef} style={{
        flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {messages.length === 0 && (
          <div style={{ color: 'var(--text-muted, #666)', fontSize: 12, textAlign: 'center', marginTop: 40 }}>
            Send a message to preview your agent
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '80%', padding: '8px 12px', borderRadius: 10,
            background: msg.role === 'user'
              ? 'var(--accent, #5EC9CC)'
              : 'var(--bg-surface, #16162a)',
            color: msg.role === 'user' ? '#fff' : 'var(--text-primary, #e0e0e0)',
            fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap',
          }}>
            {msg.content}
          </div>
        ))}
        {loading && (
          <div style={{
            alignSelf: 'flex-start', padding: '8px 12px', borderRadius: 10,
            background: 'var(--bg-surface, #16162a)', color: 'var(--text-muted, #888)',
            fontSize: 13,
          }}>
            Thinking...
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '6px 14px', fontSize: 11, color: '#f87171', background: '#1a0a0a' }}>
          {error}
        </div>
      )}

      {/* Input */}
      <div style={{
        display: 'flex', gap: 8, padding: '10px 14px',
        borderTop: '1px solid var(--glass-border, #2a2a4a)',
      }}>
        <input
          type="text"
          placeholder="Type a message..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          disabled={loading}
          style={{
            flex: 1, padding: '8px 12px',
            background: 'var(--bg-surface, #16162a)',
            border: '1px solid var(--glass-border, #333)',
            borderRadius: 'var(--radius, 8px)',
            color: 'var(--text-primary, #e0e0e0)', fontSize: 13, outline: 'none',
          }}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          style={{
            padding: '8px 16px', borderRadius: 'var(--radius, 8px)', border: 'none',
            background: 'var(--accent, #5EC9CC)', color: '#fff',
            cursor: loading ? 'wait' : 'pointer', fontSize: 13, fontWeight: 600,
            opacity: loading || !input.trim() ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </div>
    </div>
  )
}
