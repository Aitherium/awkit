'use client'

/**
 * Volunteer Compute — Embedding contribution surface for DGG
 * ===========================================================
 * Three panes:
 *
 *   (a) ROSTER — live peers embedding Reddit comments. Shows peer_id, reputation,
 *       tokens earned, verification %, last heartbeat. No email (session-scoped,
 *       tenant-only; use display handle + peer_id for identity).
 *   (b) STATUS — queue depth, active batches, throughput. Measures the pool's
 *       real-time health.
 *   (c) JOIN INSTRUCTIONS — three exact adk commands to start contributing.
 *       Admin button to drain the pool (gated to admins only).
 *
 * Like lend-compute: fail-closed disclosure before claiming work. No USD figure
 * while token rate is 0.0 (accounting-only). Reputation as a visible credential,
 * not a hidden score.
 */

import { useCallback, useEffect, useState } from 'react'

interface RosterEntry {
  peer_id: string
  display_name: string | null
  reputation: number
  tokens_earned: number
  batches_verified: number
  verification_pct: number
  last_heartbeat: string
}

interface VolunteerStatus {
  ok: boolean
  roster: RosterEntry[]
  queue_depth: number
  active_batches: number
  throughput_tokens_per_min: number
  roster_size: number
  disclosure: {
    available: boolean
    model_name: string | null
    model_size_mb: number | null
    reason: string
  }
  user_is_admin: boolean
  user_is_volunteer: boolean
}

const CARD =
  'rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm leading-relaxed'

export function VolunteerComputePanel() {
  const [state, setState] = useState<VolunteerStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch('/api/volunteer/roster', { cache: 'no-store' })
      if (!res.ok) {
        setLoadError(
          res.status === 401
            ? 'Sign in to view the volunteer roster.'
            : `Could not read roster (HTTP ${res.status}).`,
        )
        setState(null)
        return
      }
      setState((await res.json()) as VolunteerStatus)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
      setState(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const drainPool = useCallback(async () => {
    if (!state?.user_is_admin) return
    setBusy(true)
    setActionError(null)
    try {
      const res = await fetch('/api/volunteer/admin/drain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setActionError(body.error ?? `Operation failed (HTTP ${res.status}).`)
        return
      }
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [state, load])

  if (loadError) {
    return (
      <div className="p-6 text-sm text-amber-300">
        <p className="font-medium">Volunteer Compute</p>
        <p className="mt-2 opacity-80">{loadError}</p>
      </div>
    )
  }

  if (!state) {
    return (
      <div className="p-6 text-sm opacity-60">
        Reading volunteer pool status…
      </div>
    )
  }

  const { roster, disclosure, user_is_admin, queue_depth, active_batches, throughput_tokens_per_min } = state

  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-6">
      <header>
        <h1 className="text-lg font-semibold">Volunteer Compute</h1>
        <p className="mt-1 text-sm opacity-70">
          Embed Reddit comments on your machine and earn tokens for verified work.
          Every peer's embeddings are verified by a second volunteer (cosine similarity ≥ 0.99).
        </p>
      </header>

      {/* (a) DISCLOSURE — what model, what will run */}
      <section className={CARD}>
        <h2 className="font-medium">What runs here</h2>
        {disclosure.available ? (
          <div className="mt-2 space-y-2">
            <p className="opacity-85">
              Model: <code className="text-xs opacity-75">{disclosure.model_name}</code>
            </p>
            <p className="text-xs opacity-70">
              {disclosure.model_size_mb && (
                <>Download: {(disclosure.model_size_mb / 1024).toFixed(1)} GB</>
              )}
            </p>
            <p className="text-xs opacity-70">
              Embedding: 256-dimensional float32 vectors from Reddit code comments,
              verified by cosine agreement with a peer's independent embedding.
            </p>
          </div>
        ) : (
          <p className="mt-2 opacity-80">{disclosure.reason}</p>
        )}
      </section>

      {/* (b) POOL STATUS — queue, throughput, roster size */}
      <section className={CARD}>
        <h2 className="font-medium">Pool Status</h2>
        <dl className="mt-2 grid grid-cols-2 gap-3">
          <dt className="text-xs opacity-60">Active Volunteers</dt>
          <dd className="font-mono">{roster.length}</dd>
          <dt className="text-xs opacity-60">Pending Batches</dt>
          <dd className="font-mono">{queue_depth}</dd>
          <dt className="text-xs opacity-60">Active Batches</dt>
          <dd className="font-mono">{active_batches}</dd>
          <dt className="text-xs opacity-60">Throughput</dt>
          <dd className="font-mono">{throughput_tokens_per_min.toFixed(1)} tokens/min</dd>
        </dl>
      </section>

      {/* (c) ROSTER — leaderboard, no email */}
      <section className={CARD}>
        <h2 className="font-medium">Roster</h2>
        {roster.length === 0 ? (
          <p className="mt-2 opacity-70">No active volunteers yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-2 px-2 opacity-60">Peer</th>
                  <th className="text-right py-2 px-2 opacity-60">Reputation</th>
                  <th className="text-right py-2 px-2 opacity-60">Tokens</th>
                  <th className="text-right py-2 px-2 opacity-60">Verified</th>
                  <th className="text-left py-2 px-2 opacity-60">Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {roster.map(entry => (
                  <tr
                    key={entry.peer_id}
                    className="border-b border-white/5 hover:bg-white/5"
                  >
                    <td className="py-2 px-2 font-mono opacity-85">
                      {entry.display_name || entry.peer_id.slice(0, 12)}
                    </td>
                    <td className="text-right py-2 px-2 opacity-85">
                      {entry.reputation > 0 ? '+' : ''}{entry.reputation}
                    </td>
                    <td className="text-right py-2 px-2 opacity-85">
                      {entry.tokens_earned}
                    </td>
                    <td className="text-right py-2 px-2 opacity-85">
                      {entry.batches_verified} ({entry.verification_pct.toFixed(0)}%)
                    </td>
                    <td className="py-2 px-2 opacity-70">
                      {entry.last_heartbeat
                        ? new Date(entry.last_heartbeat).toLocaleTimeString()
                        : 'never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs opacity-60">
          Display names and peer IDs only (no email). Reputation starts at 0,
          +1 per verified batch, -5 for disagreement with peers.
        </p>
      </section>

      {/* (d) JOIN INSTRUCTIONS — copy-paste three commands */}
      <section className={CARD}>
        <h2 className="font-medium">Get Started (3 Commands)</h2>
        <p className="mt-2 text-xs opacity-70 mb-3">
          Install awdk, enroll as a volunteer, download the embedding model, and start.
          All work happens locally on your machine.
        </p>
        <div className="space-y-2 font-mono text-xs bg-white/5 p-3 rounded border border-white/10">
          <div>
            <span className="opacity-50">$ </span>
            <code>pip install awdk</code>
          </div>
          <div>
            <span className="opacity-50">$ </span>
            <code>adk volunteer enroll --dgg</code>
          </div>
          <div>
            <span className="opacity-50">$ </span>
            <code>adk volunteer serve --model aither-code-embed-0.6b</code>
          </div>
          <div>
            <span className="opacity-50">$ </span>
            <code>adk volunteer start</code>
          </div>
        </div>
        <p className="mt-3 text-xs opacity-60">
          Enroll grants mesh peer registration and community inference consent.
          Serve downloads the 639 MB GGUF model. Start enters a background loop:
          claim batches, embed locally, submit results, heartbeat every 5 min.
        </p>
      </section>

      {/* (e) EARNINGS — tokens earned (never USD) */}
      <section className={CARD}>
        <h2 className="font-medium">Earnings Model</h2>
        <dl className="mt-2 space-y-2 text-xs">
          <div>
            <dt className="opacity-60">Token Base</dt>
            <dd className="opacity-85">10 tokens per verified batch (64 comments)</dd>
          </div>
          <div>
            <dt className="opacity-60">Bonus</dt>
            <dd className="opacity-85">+1 per cosine score point above 0.99</dd>
          </div>
          <div>
            <dt className="opacity-60">Penalty</dt>
            <dd className="opacity-85">-5 reputation on disagreement (cosine &lt; 0.99)</dd>
          </div>
          <div>
            <dt className="opacity-60">Floor</dt>
            <dd className="opacity-85">No earnings if reputation &lt; -10</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs opacity-60">
          Valuation pending: tokens are counted, not yet valued in USD. Current rate
          is 0.0 (accounting-only).
        </p>
      </section>

      {/* (f) ADMIN DRAIN — visible to admins only */}
      {user_is_admin && (
        <section className={CARD + ' border-amber-500/30 bg-amber-500/10'}>
          <h2 className="font-medium text-amber-200">Admin Controls</h2>
          <p className="mt-2 text-xs opacity-80">
            Drain the volunteer pool (mark all active jobs failed, reset leases).
            Use only for maintenance or poisoning response.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void drainPool()}
            className={`mt-3 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              busy
                ? 'cursor-not-allowed opacity-50 bg-amber-500/20'
                : 'hover:bg-amber-500/30 bg-amber-500/20 text-amber-200'
            }`}
          >
            {busy ? 'Draining…' : 'Drain Pool'}
          </button>
          {actionError && (
            <p className="mt-2 text-xs text-red-300">{actionError}</p>
          )}
        </section>
      )}
    </div>
  )
}

export default VolunteerComputePanel
