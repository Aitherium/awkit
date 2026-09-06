'use client'

import { useEffect, useState, useRef } from 'react'

interface ApprovalItem {
  id: string
  source: 'expedition_gate' | 'business_pilot' | 'access_request'
  title: string
  description: string
  created_at: string
  tenant_id: string
}

interface GroupedApprovals {
  [key: string]: ApprovalItem[]
}

const SOURCE_NAMES: Record<string, string> = {
  expedition_gate: 'Expedition Gate',
  business_pilot: 'Business Pilot',
  access_request: 'Access Request',
}

const SOURCE_ICONS: Record<string, string> = {
  expedition_gate: '⚙️',
  business_pilot: '🚀',
  access_request: '🔐',
}

const SOURCE_COLORS: Record<string, { bg: string; fg: string }> = {
  expedition_gate: { bg: 'rgba(139,92,246,0.15)', fg: '#a78bfa' },
  business_pilot: { bg: 'rgba(59,130,246,0.15)', fg: '#60a5fa' },
  access_request: { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e' },
}

export default function ApprovalsInboxPanel() {
  const [items, setItems] = useState<ApprovalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [respondingId, setRespondingId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const fetchApprovals = async () => {
    try {
      const res = await fetch('/api/approvals/inbox')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || data.detail || `Failed to fetch approvals (${res.status})`)
      }
      const data = await res.json()
      const list = Array.isArray(data.items) ? data.items : data || []
      setItems(list as ApprovalItem[])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch approvals')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchApprovals()
    pollIntervalRef.current = setInterval(fetchApprovals, 15000)
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [])

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  const handleRespond = async (itemId: string, approved: boolean) => {
    setRespondingId(itemId)
    const item = items.find(i => i.id === itemId)
    if (!item) {
      setRespondingId(null)
      return
    }

    try {
      const res = await fetch(`/api/approvals/${item.source}/${itemId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approved,
          note: '',
        }),
      })

      if (res.ok) {
        setItems(prev => prev.filter(i => i.id !== itemId))
        showToast(
          approved ? `Approved: ${item.title}` : `Rejected: ${item.title}`,
          'success'
        )
      } else {
        const data = await res.json().catch(() => ({}))
        throw new Error(
          data.error || data.detail || `Failed to respond to approval (${res.status})`
        )
      }
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : 'Failed to respond to approval',
        'error'
      )
    } finally {
      setRespondingId(null)
    }
  }

  const groupedItems: GroupedApprovals = items.reduce((acc, item) => {
    if (!acc[item.source]) acc[item.source] = []
    acc[item.source].push(item)
    return acc
  }, {} as GroupedApprovals)

  const sources = Object.keys(groupedItems).sort()

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--bg-base, #111)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '1rem',
          borderBottom: '1px solid var(--glass-border, #333)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 0.2rem' }}>
              Approvals Inbox
            </h2>
            <p
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted, #888)',
                margin: 0,
              }}
            >
              {items.length} pending {items.length === 1 ? 'item' : 'items'}
            </p>
          </div>
          {loading && items.length === 0 && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #888)' }}>
              Loading…
            </span>
          )}
        </div>
      </div>

      {/* Toast notification */}
      {toast && (
        <div
          style={{
            padding: '0.5rem 1rem',
            background: toast.type === 'success' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
            color: toast.type === 'success' ? '#22c55e' : 'var(--accent-coral, #ef4444)',
            fontSize: '0.8rem',
            flexShrink: 0,
            borderBottom: '1px solid var(--glass-border, #333)',
          }}
        >
          {toast.type === 'success' ? '✓' : '✕'} {toast.message}
        </div>
      )}

      {/* Error state */}
      {error && items.length === 0 && (
        <div
          style={{
            padding: '1.5rem',
            textAlign: 'center',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              fontSize: '0.9rem',
              color: 'var(--accent-coral, #ef4444)',
              marginBottom: '0.5rem',
            }}
          >
            ⚠️ Error loading approvals
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #888)' }}>
            {error}
          </div>
          <button
            onClick={() => {
              setLoading(true)
              setError(null)
              fetchApprovals()
            }}
            style={{
              marginTop: '0.75rem',
              padding: '0.4rem 0.8rem',
              background: 'var(--accent-primary, #3b82f6)',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              fontSize: '0.8rem',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty state */}
      {!error && items.length === 0 && !loading && (
        <div
          style={{
            padding: '2rem',
            textAlign: 'center',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            color: 'var(--text-muted, #888)',
          }}
        >
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✓</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>All caught up!</div>
          <p style={{ fontSize: '0.8rem', margin: '0.3rem 0 0' }}>
            No pending approvals at this time.
          </p>
        </div>
      )}

      {/* Grouped items */}
      {items.length > 0 && (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '1rem',
          }}
        >
          <div style={{ display: 'grid', gap: '1rem' }}>
            {sources.map(source => (
              <div key={source}>
                {/* Source group header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    marginBottom: '0.5rem',
                    paddingBottom: '0.5rem',
                    borderBottom: '1px solid var(--glass-border, #333)',
                  }}
                >
                  <span style={{ fontSize: '1rem' }}>
                    {SOURCE_ICONS[source as keyof typeof SOURCE_ICONS]}
                  </span>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                    {SOURCE_NAMES[source as keyof typeof SOURCE_NAMES]}
                  </span>
                  <span
                    style={{
                      marginLeft: 'auto',
                      padding: '0.1rem 0.5rem',
                      borderRadius: 999,
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      background: SOURCE_COLORS[source as keyof typeof SOURCE_COLORS]?.bg,
                      color: SOURCE_COLORS[source as keyof typeof SOURCE_COLORS]?.fg,
                    }}
                  >
                    {groupedItems[source].length}
                  </span>
                </div>

                {/* Items in this source group */}
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {groupedItems[source].map(item => (
                    <div
                      key={item.id}
                      style={{
                        padding: '0.75rem',
                        background: 'var(--bg-surface, #1a1a2e)',
                        border: '1px solid var(--glass-border, #333)',
                        borderRadius: 'var(--radius, 6px)',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '0.85rem',
                          fontWeight: 500,
                          marginBottom: '0.25rem',
                        }}
                      >
                        {item.title}
                      </div>
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-muted, #888)',
                          marginBottom: '0.4rem',
                          lineHeight: 1.4,
                        }}
                      >
                        {item.description}
                      </div>
                      <div
                        style={{
                          fontSize: '0.7rem',
                          color: 'var(--text-muted, #666)',
                          marginBottom: '0.5rem',
                        }}
                      >
                        {new Date(item.created_at).toLocaleDateString()} at{' '}
                        {new Date(item.created_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button
                          onClick={() => handleRespond(item.id, true)}
                          disabled={respondingId === item.id}
                          style={{
                            flex: 1,
                            padding: '0.35rem 0.6rem',
                            background: 'rgba(34,197,94,0.15)',
                            color: '#22c55e',
                            border: '1px solid rgba(34,197,94,0.3)',
                            borderRadius: 4,
                            fontSize: '0.75rem',
                            fontWeight: 500,
                            cursor: respondingId === item.id ? 'wait' : 'pointer',
                            opacity: respondingId === item.id ? 0.6 : 1,
                          }}
                        >
                          {respondingId === item.id ? '…' : '✓ Approve'}
                        </button>
                        <button
                          onClick={() => handleRespond(item.id, false)}
                          disabled={respondingId === item.id}
                          style={{
                            flex: 1,
                            padding: '0.35rem 0.6rem',
                            background: 'rgba(239,68,68,0.12)',
                            color: 'var(--accent-coral, #ef4444)',
                            border: '1px solid rgba(239,68,68,0.3)',
                            borderRadius: 4,
                            fontSize: '0.75rem',
                            fontWeight: 500,
                            cursor: respondingId === item.id ? 'wait' : 'pointer',
                            opacity: respondingId === item.id ? 0.6 : 1,
                          }}
                        >
                          {respondingId === item.id ? '…' : '✕ Reject'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
