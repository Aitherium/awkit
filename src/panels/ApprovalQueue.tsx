'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Approval {
  id: string
  action_type: string
  preview: string
  confidence: number
  created_at: string
  proposed_by?: string
  payload: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected'
}

type Filter = 'all' | 'pending' | 'approved' | 'rejected'

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function confidenceClass(score: number): string {
  if (score >= 0.7) return 'confidence-high'
  if (score >= 0.5) return 'confidence-mid'
  return 'confidence-low'
}

function actionBadgeClass(actionType: string): string {
  switch (actionType.toLowerCase()) {
    case 'email': return 'badge-info'
    case 'social_post': case 'social': return 'badge-pending'
    case 'document': case 'publish': return 'badge-success'
    default: return 'badge'
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'approved': return 'badge badge-success'
    case 'rejected': return 'badge badge-error'
    case 'pending': return 'badge badge-pending'
    default: return 'badge'
  }
}

/* ------------------------------------------------------------------ */
/*  Skeleton loader                                                    */
/* ------------------------------------------------------------------ */

function SkeletonCards() {
  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="card animate-in"
          style={{
            padding: '0.85rem 1rem',
            animationDelay: `${i * 60}ms`,
            animationFillMode: 'both',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="skeleton-pulse" style={{
              width: 56, height: 20, borderRadius: 4,
              background: 'var(--bg-elevated)',
            }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <div className="skeleton-pulse" style={{
                width: '70%', height: 14, borderRadius: 4,
                background: 'var(--bg-elevated)',
              }} />
              <div className="skeleton-pulse" style={{
                width: '40%', height: 10, borderRadius: 4,
                background: 'var(--bg-elevated)',
              }} />
            </div>
            <div className="skeleton-pulse" style={{
              width: 36, height: 20, borderRadius: 4,
              background: 'var(--bg-elevated)',
            }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Collapsible JSON viewer                                            */
/* ------------------------------------------------------------------ */

function JsonViewer({
  data,
  defaultCollapsed = false,
}: {
  data: Record<string, unknown>
  defaultCollapsed?: boolean
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const formatted = JSON.stringify(data, null, 2)

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <button
        className="btn btn-ghost"
        onClick={() => setCollapsed(c => !c)}
        style={{
          padding: '0.25rem 0',
          fontSize: '0.72rem',
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
        }}
      >
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
          style={{
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)',
            transition: 'transform 0.15s ease',
          }}
        >
          <path d="M2 3l3 3.5L8 3" fill="none" stroke="currentColor"
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Raw Payload
      </button>
      <div
        style={{
          maxHeight: collapsed ? 0 : 320,
          opacity: collapsed ? 0 : 1,
          overflow: 'hidden',
          transition: 'max-height 0.25s ease, opacity 0.2s ease',
        }}
      >
        <pre
          className="custom-scroll"
          style={{
            marginTop: '0.35rem',
            padding: '0.75rem',
            background: 'var(--bg-deep)',
            borderRadius: 'var(--radius)',
            fontSize: '0.73rem',
            color: 'var(--text-secondary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            lineHeight: 1.55,
            maxHeight: 300,
            overflowY: 'auto',
          }}
        >
          {formatted}
        </pre>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function ApprovalQueue() {
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('pending')
  const [pendingCount, setPendingCount] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPayload, setEditPayload] = useState('')
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [dismissingId, setDismissingId] = useState<string | null>(null)

  const listRef = useRef<HTMLDivElement>(null)

  /* -- Fetch approvals by filter ----------------------------------- */
  const fetchApprovals = useCallback(async (activeFilter?: Filter) => {
    const f = activeFilter ?? filter
    setLoading(true)
    setError(null)
    try {
      const url = f === 'all'
        ? '/api/approvals?status=all'
        : `/api/approvals?status=${f}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Failed to load (${res.status})`)
      const data = await res.json()
      setApprovals(data.approvals ?? data.items ?? data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load approvals')
      setApprovals([])
    } finally {
      setLoading(false)
    }
  }, [filter])

  /* -- Fetch pending badge count ----------------------------------- */
  const fetchPendingCount = useCallback(async () => {
    try {
      const res = await fetch('/api/approvals/pending')
      if (res.ok) {
        const data = await res.json()
        const items = data.approvals ?? data.pending ?? data ?? []
        setPendingCount(Array.isArray(items) ? items.length : 0)
      }
    } catch { /* non-critical -- badge just won't update */ }
  }, [])

  useEffect(() => { fetchApprovals() }, [fetchApprovals])
  useEffect(() => { fetchPendingCount() }, [fetchPendingCount])

  /* -- Review action (approve / reject) ---------------------------- */
  const reviewApproval = async (
    id: string,
    status: 'approved' | 'rejected',
    editedPayload?: string,
  ) => {
    setReviewingId(id)
    try {
      const body: Record<string, unknown> = { status }
      if (editedPayload) {
        try { body.edited_payload = JSON.parse(editedPayload) }
        catch { body.edited_payload = editedPayload }
      }
      const res = await fetch(`/api/approvals/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Review failed')

      /* Animate out, then remove */
      setDismissingId(id)
      setTimeout(() => {
        setApprovals(prev => prev.filter(a => a.id !== id))
        setDismissingId(null)
        setExpandedId(null)
        setEditingId(null)
        setPendingCount(c => Math.max(0, c - 1))
      }, 280)
    } catch {
      setError('Failed to submit review. Please try again.')
    } finally {
      setReviewingId(null)
    }
  }

  /* -- Edit helpers ------------------------------------------------- */
  const startEdit = (approval: Approval) => {
    setEditingId(approval.id)
    setEditPayload(JSON.stringify(approval.payload, null, 2))
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditPayload('')
  }

  /* -- Filter change ----------------------------------------------- */
  const handleFilterChange = (f: Filter) => {
    setFilter(f)
    setExpandedId(null)
    cancelEdit()
    fetchApprovals(f)
  }

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
  ]

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="panel">
      {/* Header */}
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <h2 className="panel-title">Approvals</h2>
          {pendingCount > 0 && (
            <span className="badge badge-pending" style={{ position: 'relative' }}>
              <span
                style={{
                  position: 'absolute',
                  top: -2,
                  right: -2,
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--accent-primary)',
                  animation: 'pulse-dot 1.8s ease-in-out infinite',
                }}
              />
              {pendingCount}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {/* Filter pills */}
          <div className="seg-control">
            {filters.map(f => (
              <button
                key={f.key}
                data-active={filter === f.key}
                onClick={() => handleFilterChange(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          {/* Refresh button */}
          <button
            className="btn btn-secondary"
            onClick={() => { fetchApprovals(); fetchPendingCount() }}
            disabled={loading}
            style={{
              padding: '0.4rem 0.75rem',
              fontSize: '0.78rem',
              opacity: loading ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                animation: loading ? 'spin 0.6s linear infinite' : 'none',
              }}
            >
              <path d="M21.5 2v6h-6M2.5 22v-6h6" />
              <path d="M2.5 11.5a10 10 0 0 1 18.8-4.3M21.5 12.5a10 10 0 0 1-18.8 4.3" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="error-banner animate-in" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button
            className="btn btn-ghost"
            onClick={() => setError(null)}
            style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading ? (
        <SkeletonCards />
      ) : approvals.length === 0 ? (
        /* Empty state */
        <div className="empty-state animate-in">
          <svg
            width="48" height="48" viewBox="0 0 24 24" fill="none"
            stroke="var(--text-muted)" strokeWidth="1.2"
            strokeLinecap="round" strokeLinejoin="round"
            style={{ marginBottom: '0.75rem', opacity: 0.5 }}
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          <h3>
            {filter === 'pending'
              ? 'No pending approvals'
              : filter === 'all'
                ? 'No approvals yet'
                : `No ${filter} approvals`}
          </h3>
          <p>
            {filter === 'pending'
              ? 'All clear -- nothing waiting for review.'
              : 'Items will appear here as agents submit proposals for review.'}
          </p>
        </div>
      ) : (
        /* Card list */
        <div ref={listRef} style={{ display: 'grid', gap: '0.5rem' }}>
          {approvals.map((approval, index) => {
            const isExpanded = expandedId === approval.id
            const isEditing = editingId === approval.id
            const isReviewing = reviewingId === approval.id
            const isDismissing = dismissingId === approval.id

            return (
              <div
                key={approval.id}
                className={`card card-interactive animate-in ${isDismissing ? 'dismiss-out' : ''}`}
                style={{
                  borderColor: isExpanded ? 'var(--accent-primary)' : undefined,
                  boxShadow: isExpanded
                    ? '0 0 0 1px oklch(0.72 0.14 290 / 0.15)'
                    : undefined,
                  animationDelay: `${index * 40}ms`,
                  animationFillMode: 'both',
                }}
              >
                {/* --- Summary row --- */}
                <div
                  onClick={() => {
                    setExpandedId(isExpanded ? null : approval.id)
                    if (!isExpanded) cancelEdit()
                  }}
                  style={{
                    padding: '0.85rem 1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                  }}
                >
                  {/* Action type badge */}
                  <span
                    className={`badge ${actionBadgeClass(approval.action_type)}`}
                    style={{
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {approval.action_type.replace(/_/g, ' ')}
                  </span>

                  {/* Preview text + proposed_by */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '0.82rem',
                      color: 'var(--text-primary)',
                      lineHeight: 1.4,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}>
                      {approval.preview}
                    </div>
                    {approval.proposed_by && (
                      <div style={{
                        fontSize: '0.68rem',
                        color: 'var(--text-muted)',
                        marginTop: '0.15rem',
                      }}>
                        by {approval.proposed_by}
                      </div>
                    )}
                  </div>

                  {/* Confidence indicator */}
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: 'currentColor',
                      }}
                      className={confidenceClass(approval.confidence)}
                    />
                    <span
                      className={confidenceClass(approval.confidence)}
                      style={{ fontSize: '0.72rem', fontWeight: 600 }}
                    >
                      {(approval.confidence * 100).toFixed(0)}%
                    </span>
                  </div>

                  {/* Status badge */}
                  {approval.status !== 'pending' && (
                    <span
                      className={statusBadgeClass(approval.status)}
                      style={{ fontSize: '0.65rem', fontWeight: 600, flexShrink: 0 }}
                    >
                      {approval.status}
                    </span>
                  )}

                  {/* Relative time */}
                  <span style={{
                    fontSize: '0.65rem',
                    color: 'var(--text-muted)',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}>
                    {relativeTime(approval.created_at)}
                  </span>

                  {/* Chevron */}
                  <svg
                    width="14" height="14" viewBox="0 0 14 14" fill="none"
                    stroke="var(--text-muted)" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round"
                    style={{
                      flexShrink: 0,
                      transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)',
                      transition: 'transform 0.2s ease',
                    }}
                  >
                    <path d="M3.5 5.25L7 8.75l3.5-3.5" />
                  </svg>
                </div>

                {/* --- Expanded detail --- */}
                <div
                  style={{
                    maxHeight: isExpanded ? 600 : 0,
                    opacity: isExpanded ? 1 : 0,
                    overflow: 'hidden',
                    transition: 'max-height 0.3s ease, opacity 0.25s ease',
                  }}
                >
                  <div style={{
                    padding: '0 1rem 1rem',
                    borderTop: '1px solid var(--glass-border)',
                    paddingTop: '0.85rem',
                  }}>
                    {isEditing ? (
                      /* --- Edit mode --- */
                      <>
                        <label style={{
                          fontSize: '0.72rem',
                          color: 'var(--text-muted)',
                          fontWeight: 500,
                          marginBottom: '0.35rem',
                          display: 'block',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                        }}>
                          Edit Payload
                        </label>
                        <textarea
                          className="auto-resize custom-scroll"
                          value={editPayload}
                          onChange={e => setEditPayload(e.target.value)}
                          rows={10}
                          style={{
                            width: '100%',
                            padding: '0.65rem 0.85rem',
                            background: 'var(--bg-deep)',
                            border: '1px solid var(--glass-border)',
                            borderRadius: 'var(--radius)',
                            color: 'var(--text-primary)',
                            fontSize: '0.76rem',
                            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                            lineHeight: 1.55,
                          }}
                        />
                        <div style={{
                          display: 'flex',
                          gap: '0.4rem',
                          marginTop: '0.65rem',
                        }}>
                          <button
                            className="btn btn-primary"
                            onClick={() => reviewApproval(approval.id, 'approved', editPayload)}
                            disabled={isReviewing}
                            style={{
                              background: 'var(--accent-green)',
                              opacity: isReviewing ? 0.5 : 1,
                            }}
                          >
                            {isReviewing ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                                <span className="loading-spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
                                Saving...
                              </span>
                            ) : 'Save & Approve'}
                          </button>
                          <button className="btn btn-secondary" onClick={cancelEdit}>
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      /* --- Read-only expanded view --- */
                      <>
                        {/* Full preview text */}
                        <p style={{
                          fontSize: '0.82rem',
                          color: 'var(--text-primary)',
                          lineHeight: 1.55,
                          marginBottom: '0.5rem',
                        }}>
                          {approval.preview}
                        </p>

                        {/* Collapsible JSON viewer */}
                        <JsonViewer data={approval.payload} defaultCollapsed />

                        {/* Action buttons */}
                        <div style={{
                          display: 'flex',
                          gap: '0.4rem',
                          marginTop: '0.75rem',
                          paddingTop: '0.65rem',
                          borderTop: '1px solid var(--glass-border)',
                        }}>
                          <button
                            className="btn btn-primary"
                            onClick={() => reviewApproval(approval.id, 'approved')}
                            disabled={isReviewing || approval.status !== 'pending'}
                            style={{
                              background: 'var(--accent-green)',
                              opacity: isReviewing ? 0.5 : 1,
                              flex: 'none',
                            }}
                          >
                            {isReviewing && reviewingId === approval.id ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                                <span className="loading-spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
                                Approving...
                              </span>
                            ) : 'Approve'}
                          </button>
                          <button
                            className="btn btn-secondary"
                            onClick={() => startEdit(approval)}
                            disabled={approval.status !== 'pending'}
                            style={{ flex: 'none' }}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-ghost"
                            onClick={() => reviewApproval(approval.id, 'rejected')}
                            disabled={isReviewing || approval.status !== 'pending'}
                            style={{
                              color: 'var(--accent-coral)',
                              opacity: isReviewing ? 0.5 : 1,
                              flex: 'none',
                            }}
                          >
                            {isReviewing && reviewingId === approval.id ? 'Rejecting...' : 'Reject'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Scoped styles -- animations that the design system doesn't provide */}
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.4); }
        }
        @keyframes dismiss-slide {
          to {
            opacity: 0;
            transform: translateX(24px);
            max-height: 0;
            margin: 0;
            padding: 0;
            overflow: hidden;
          }
        }
        .dismiss-out {
          animation: dismiss-slide 0.28s ease forwards;
          pointer-events: none;
        }
        .skeleton-pulse {
          animation: skeleton-shimmer 1.2s ease-in-out infinite alternate;
        }
        @keyframes skeleton-shimmer {
          from { opacity: 0.4; }
          to { opacity: 0.15; }
        }
      `}</style>
    </div>
  )
}
