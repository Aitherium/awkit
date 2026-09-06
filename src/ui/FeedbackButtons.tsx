import { useState } from 'react'
/* No router import here on purpose. portal-kit is consumed by AitherVeil, a
   Next app, and `react-router-dom` is not a declared dependency of portal-kit
   OR of AitherVeil — so the moment anything pulled this component into the Veil
   module graph the whole dev server failed to compile with "Can't resolve
   'react-router-dom'", taking every route down, not just the one rendering it.
   The single use was `location.pathname`, which needs no router at all. */

interface Props {
  messageId: string
  sessionId?: string
  tenantId?: string
  agentInput?: string  // The user question/prompt
  agentOutput?: string  // The assistant response (typically derived from the message content)
}

const CATEGORIES = ['Bug', 'Wrong Answer', 'Slow', 'Other'] as const
type Category = (typeof CATEGORIES)[number]

// Inline SVG icons — no external deps
const ThumbUp = ({ filled }: { filled?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
  </svg>
)

const ThumbDown = ({ filled }: { filled?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 14V2" /><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
  </svg>
)

export default function FeedbackButtons({ messageId, sessionId, tenantId, agentInput, agentOutput }: Props) {
  const [state, setState] = useState<'idle' | 'correcting' | 'sent' | 'up'>('idle')
  const [correction, setCorrection] = useState('')
  const [category, setCategory] = useState<Category | null>(null)

  const submit = async (rating: number, correctionText?: string, cat?: Category | null) => {
    try {
      // Capture the current page route automatically. Guarded because portal-kit
      // renders server-side first in Next; this runs from a click handler, so
      // window is present in every path that actually reaches it.
      const route = typeof window !== 'undefined' ? window.location.pathname : ''

      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_id: messageId,
          rating,
          correction: correctionText || null,
          category: cat || null,
          session_id: sessionId || null,
          tenant_id: tenantId || null,
          context: route || null,  // Include the route in context
          // The backend will enrich with agent_input/output from the conversation
        }),
      })
      setState('sent')
    } catch { /* ignore */ }
  }

  if (state === 'sent') {
    return (
      <div style={{ fontSize: '0.7rem', color: 'var(--accent-green, #22c55e)', marginTop: '0.3rem', opacity: 0.8 }}>
        Thanks for your feedback!
      </div>
    )
  }

  if (state === 'up') {
    return (
      <div style={{ fontSize: '0.7rem', color: 'var(--accent-green, #22c55e)', marginTop: '0.3rem', opacity: 0.8 }}>
        Thanks for your feedback!
      </div>
    )
  }

  if (state === 'correcting') {
    return (
      <div style={{ marginTop: '0.3rem' }}>
        {/* Category tags */}
        <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(prev => prev === cat ? null : cat)}
              style={{
                padding: '0.15rem 0.5rem',
                borderRadius: 12,
                fontSize: '0.7rem',
                fontWeight: 600,
                background: category === cat ? 'var(--accent-coral, #ef4444)' : 'var(--bg-elevated, #1e1e2e)',
                color: category === cat ? '#fff' : 'var(--text-muted, #888)',
                border: `1px solid ${category === cat ? 'var(--accent-coral, #ef4444)' : 'var(--glass-border, #333)'}`,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {cat}
            </button>
          ))}
        </div>
        {/* Correction input */}
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input
            value={correction}
            onChange={e => setCorrection(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit(1, correction, category)}
            placeholder="What should it have said?"
            autoFocus
            style={{
              flex: 1,
              padding: '0.3rem 0.5rem',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--glass-border)',
              borderRadius: 4,
              color: 'var(--text-primary)',
              fontSize: '0.75rem',
            }}
          />
          <button
            onClick={() => submit(1, correction, category)}
            style={{
              padding: '0.25rem 0.5rem',
              background: 'var(--accent-coral, #ef4444)',
              color: '#fff',
              borderRadius: 4,
              fontSize: '0.7rem',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Send
          </button>
          <button
            onClick={() => { setState('idle'); setCategory(null); setCorrection('') }}
            style={{
              padding: '0.25rem 0.4rem',
              background: 'transparent',
              color: 'var(--text-muted)',
              fontSize: '0.7rem',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // Always-visible thumbs buttons
  return (
    <div style={{ marginTop: '0.3rem', display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
      <button
        onClick={() => { submit(5); setState('up') }}
        title="Good response"
        style={{
          padding: '0.2rem',
          background: 'transparent',
          color: 'var(--text-muted, #888)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          opacity: 0.7,
          transition: 'opacity 0.15s, color 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--accent-green, #22c55e)' }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.color = 'var(--text-muted, #888)' }}
      >
        <ThumbUp />
      </button>
      <button
        onClick={() => setState('correcting')}
        title="Bad response - add correction"
        style={{
          padding: '0.2rem',
          background: 'transparent',
          color: 'var(--text-muted, #888)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          opacity: 0.7,
          transition: 'opacity 0.15s, color 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--accent-coral, #ef4444)' }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.color = 'var(--text-muted, #888)' }}
      >
        <ThumbDown />
      </button>
    </div>
  )
}
