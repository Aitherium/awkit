'use client'

/**
 * PollWidget — the votable poll UI + live results bars.
 *
 * Shared by:
 *   - PollPanel (admin preview / results)
 *   - Veil's /polls/embed client (blog embeds + emailed vote-link landing)
 *
 * It is backend-agnostic: it talks to the polls API at `apiBase` (default
 * `/api/polls`, same-origin in product apps; the Veil embed passes a proxied
 * base). A `token` (from an emailed link) ties the vote to a recipient and
 * enables one-vote-per-person; without it the backend dedupes anonymously by
 * IP+UA.
 */

import { useCallback, useEffect, useState } from 'react'

interface PollView {
  poll_id: string
  title?: string
  description?: string
  poll_type: 'single' | 'multiple'
  options: string[]
  status: string
  recipient?: string | null
}

interface PollResults {
  poll_id: string
  status: string
  results_hidden: boolean
  options: string[]
  counts: number[]
  percentages: number[]
  total_votes: number
}

export interface PollWidgetProps {
  pollId: string
  apiBase?: string
  token?: string
  /** Skip the vote form and show results only (admin preview). */
  resultsOnly?: boolean
  compact?: boolean
}

export default function PollWidget({
  pollId,
  apiBase = '/api/polls',
  token,
  resultsOnly = false,
  compact = false,
}: PollWidgetProps) {
  const [poll, setPoll] = useState<PollView | null>(null)
  const [results, setResults] = useState<PollResults | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [voted, setVoted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const qs = token ? `?token=${encodeURIComponent(token)}` : ''

  const loadResults = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/${pollId}/results${qs}`)
      if (r.ok) setResults(await r.json())
    } catch { /* offline — leave as-is */ }
  }, [apiBase, pollId, qs])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`${apiBase}/${pollId}/vote${qs}`)
        if (r.ok && !cancelled) setPoll(await r.json())
        else if (!r.ok && !cancelled) setError('This poll is unavailable.')
      } catch {
        if (!cancelled) setError('Could not load the poll.')
      }
      await loadResults()
    })()
    return () => { cancelled = true }
  }, [apiBase, pollId, qs, loadResults])

  const toggle = (i: number) => {
    if (!poll) return
    if (poll.poll_type === 'single') setSelected([i])
    else setSelected(s => s.includes(i) ? s.filter(x => x !== i) : [...s, i])
  }

  const submit = async () => {
    if (!selected.length) return
    setBusy(true); setError(null)
    try {
      const r = await fetch(`${apiBase}/${pollId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected, token }),
      })
      if (r.ok) {
        setVoted(true)
        await loadResults()
      } else {
        const body = await r.json().catch(() => ({}))
        if (r.status === 409) { setVoted(true); await loadResults() }
        setError(body.detail || (r.status === 409 ? 'You have already voted.' : 'Vote failed.'))
      }
    } catch {
      setError('Vote failed — please try again.')
    }
    setBusy(false)
  }

  if (error && !poll) {
    return <div style={{ padding: 16, color: 'var(--text-muted)' }}>{error}</div>
  }
  if (!poll) {
    return <div style={{ padding: 16, color: 'var(--text-muted)' }}>Loading…</div>
  }

  const closed = poll.status === 'closed'
  const canVote = !resultsOnly && !voted && !closed

  return (
    <div style={{
      padding: compact ? 12 : 20, borderRadius: 10,
      background: 'var(--bg-elevated, #1e1e2e)', color: 'var(--text, #cdd6f4)',
      border: '1px solid var(--border, #313244)', maxWidth: 560,
    }}>
      <div style={{ fontSize: compact ? '0.95rem' : '1.1rem', fontWeight: 700, marginBottom: 4 }}>
        {poll.title}
      </div>
      {poll.description && (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #a6adc8)', marginBottom: 12 }}>
          {poll.description}
        </div>
      )}
      {poll.recipient && (
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted, #a6adc8)', marginBottom: 10 }}>
          Voting as {poll.recipient}
        </div>
      )}

      {canVote ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {poll.options.map((opt, i) => (
            <label key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
              borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${selected.includes(i) ? 'var(--accent, #7c3aed)' : 'var(--border, #313244)'}`,
              background: selected.includes(i) ? 'rgba(124,58,237,0.12)' : 'transparent',
            }}>
              <input
                type={poll.poll_type === 'single' ? 'radio' : 'checkbox'}
                name="poll-option" checked={selected.includes(i)}
                onChange={() => toggle(i)}
              />
              <span>{opt}</span>
            </label>
          ))}
          <button
            onClick={submit} disabled={busy || !selected.length}
            style={{
              marginTop: 6, padding: '10px 18px', borderRadius: 8, border: 'none',
              fontWeight: 600, cursor: busy || !selected.length ? 'default' : 'pointer',
              background: !selected.length ? 'rgba(124,58,237,0.4)' : 'var(--accent, #7c3aed)',
              color: '#fff',
            }}
          >
            {busy ? 'Submitting…' : 'Vote'}
          </button>
          {error && <div style={{ fontSize: '0.75rem', color: '#f38ba8' }}>{error}</div>}
        </div>
      ) : (
        <ResultsBars results={results} />
      )}

      {(voted || closed) && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted, #a6adc8)', marginTop: 10 }}>
          {closed ? 'This poll is closed.' : 'Thanks for voting!'}
        </div>
      )}
    </div>
  )
}

function ResultsBars({ results }: { results: PollResults | null }) {
  if (!results) return <div style={{ color: 'var(--text-muted, #a6adc8)' }}>No results yet.</div>
  if (results.results_hidden) {
    return <div style={{ color: 'var(--text-muted, #a6adc8)' }}>Results are hidden until voting closes.</div>
  }
  const max = Math.max(1, ...results.counts)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {results.options.map((opt, i) => {
        const count = results.counts[i] ?? 0
        const pct = results.percentages[i] ?? 0
        return (
          <div key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 3 }}>
              <span>{opt}</span>
              <span style={{ color: 'var(--text-muted, #a6adc8)' }}>{count} · {pct}%</span>
            </div>
            <div style={{ height: 10, borderRadius: 5, background: 'var(--bg-deep, #11111b)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${(count / max) * 100}%`,
                background: 'var(--accent, #7c3aed)', borderRadius: 5, transition: 'width .3s',
              }} />
            </div>
          </div>
        )
      })}
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted, #a6adc8)', marginTop: 2 }}>
        {results.total_votes} vote{results.total_votes !== 1 ? 's' : ''}
      </div>
    </div>
  )
}
