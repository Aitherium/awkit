'use client'

import { useState, useEffect, useCallback } from 'react'

// ---------------------------------------------------------------------------
// embed-migrate — switch the fleet's embedding model without losing recall.
// Shows three things, all read from the engine (lib/memory/embed_migration.py):
//   plan         which collections migrate, to what target, how many points
//   status       per-collection progress and the recall verdict
//   retire gate  is the old embedder safe to retire: ready yes/no + blockers
// Backed by the Genesis router /api/v1/embed-migrate/* (GET plan, status,
// retire-gate; each answers JSON with ok:boolean).
// Read-only: nothing here starts a migration run or retires anything.
// ok:false (or a non-2xx) means "could not judge", never "nothing to migrate"
// and never "ready".
// ---------------------------------------------------------------------------

interface PlanRow {
  store?: string
  source?: string
  target?: string
  points?: number
  target_points?: number | null
  dim?: number
  action?: string
  reason?: string
}

interface StatusRow {
  key?: string
  store?: string
  source?: string
  target?: string
  source_points?: number
  pending?: number
  embedded_total?: number
  skipped?: number
  preview_fallback?: number
  verified_at?: string | null
  verified?: boolean | null
  verdict?: string | null
  reasons?: string[]
}

interface Envelope {
  ok?: boolean
  reason?: string
  error?: string
  detail?: string
}

interface PlanResponse extends Envelope {
  source_space?: string
  target_space?: string
  collections?: PlanRow[] | Record<string, PlanRow>
  plan?: PlanRow[] | Record<string, PlanRow>
}

interface StatusResponse extends Envelope {
  updated_at?: string
  pending_total?: number
  unverified?: string[]
  collections?: StatusRow[] | Record<string, StatusRow>
}

interface RetireGateResponse extends Envelope {
  ready?: boolean
  blockers?: string[]
  steps?: string[]
}

interface Slot<T> {
  loading: boolean
  data: T | null
  error: string
}

const BAD = '#e06c75'
const GOOD = '#98c379'

/** Accept the rows as a list or as the engine's `{ "store/source": row }` map. */
function rowsOf<T extends { key?: string }>(v: T[] | Record<string, T> | undefined | null): T[] {
  if (!v) return []
  if (Array.isArray(v)) return v
  return Object.entries(v).map(([key, row]) => ({ ...(row ?? ({} as T)), key }))
}

function rowKey(r: { key?: string; store?: string; source?: string }, i: number): string {
  if (r.key) return r.key
  if (r.source) return r.store ? `${r.store}/${r.source}` : r.source
  return `row-${i}`
}

function num(v: number | null | undefined): string {
  return typeof v === 'number' ? v.toLocaleString() : '?'
}

/** The recall verdict for one collection, from what the engine actually said. */
function verdictOf(r: StatusRow): { label: string; color?: string } {
  if (typeof r.verdict === 'string' && r.verdict) {
    const v = r.verdict.toUpperCase()
    return { label: v, color: v === 'PASS' || v === 'VERIFIED' ? GOOD : BAD }
  }
  if (r.verified === true) return { label: 'VERIFIED', color: GOOD }
  if (r.verified === false || (r.reasons && r.reasons.length > 0)) return { label: 'FAILED', color: BAD }
  if (r.verified_at) return { label: 'VERIFIED', color: GOOD }
  return { label: 'not verified yet' }
}

const cell = { padding: '2px 10px 2px 0', textAlign: 'left' as const, verticalAlign: 'top' as const }

export default function EmbedMigratePanel({ apiBase = '/api/v1/embed-migrate' }: { apiBase?: string }) {
  const [plan, setPlan] = useState<Slot<PlanResponse>>({ loading: true, data: null, error: '' })
  const [status, setStatus] = useState<Slot<StatusResponse>>({ loading: true, data: null, error: '' })
  const [gate, setGate] = useState<Slot<RetireGateResponse>>({ loading: true, data: null, error: '' })

  const fetchOne = useCallback(
    async <T extends Envelope>(path: string, what: string): Promise<Slot<T>> => {
      try {
        const resp = await fetch(`${apiBase}/${path}`)
        const json = await resp.json().catch(() => ({}))
        if (!resp.ok) throw new Error(json.detail ?? json.reason ?? `HTTP ${resp.status}`)
        if (json.ok !== true) throw new Error(json.reason ?? json.error ?? json.detail ?? 'engine answered ok=false')
        return { loading: false, data: json as T, error: '' }
      } catch (e) {
        return { loading: false, data: null, error: `${what} could not be judged: ${String(e)}` }
      }
    },
    [apiBase],
  )

  const load = useCallback(async () => {
    setPlan((s) => ({ ...s, loading: true }))
    setStatus((s) => ({ ...s, loading: true }))
    setGate((s) => ({ ...s, loading: true }))
    await Promise.all([
      fetchOne<PlanResponse>('plan', 'Plan').then(setPlan),
      fetchOne<StatusResponse>('status', 'Status').then(setStatus),
      fetchOne<RetireGateResponse>('retire-gate', 'Retire gate').then(setGate),
    ])
  }, [fetchOne])

  useEffect(() => {
    void load()
  }, [load])

  const planRows = rowsOf<PlanRow & { key?: string }>(plan.data?.collections ?? plan.data?.plan)
  const statusRows = rowsOf<StatusRow>(status.data?.collections)
  const blockers = gate.data?.blockers ?? []
  const steps = gate.data?.steps ?? []
  // Ready only when the engine said so AND listed no blocker; anything else is "no".
  const ready = gate.data?.ready === true && blockers.length === 0
  const anyLoading = plan.loading || status.loading || gate.loading

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0 }}>embed-migrate</h3>
        <span style={{ opacity: 0.7, fontSize: 13 }}>
          the old embedder is never retired without verified recall · read-only
        </span>
        <button onClick={() => void load()} disabled={anyLoading} style={{ marginLeft: 'auto' }}>
          Refresh
        </button>
      </div>

      {/* ── Plan ─────────────────────────────────────────────────────── */}
      <div style={{ fontSize: 13 }}>
        <strong>Plan{plan.data ? ` (${planRows.length})` : ''}</strong>
        {plan.loading && !plan.data && <div style={{ opacity: 0.6 }}>loading…</div>}
        {plan.error && <div style={{ color: BAD }}>{plan.error}</div>}
        {plan.data && (
          <>
            {(plan.data.source_space || plan.data.target_space) && (
              <div style={{ opacity: 0.7 }}>
                {plan.data.source_space || '?'} → {plan.data.target_space || '?'}
              </div>
            )}
            {planRows.length === 0 ? (
              <div style={{ opacity: 0.6 }}>no collections in the plan</div>
            ) : (
              <table style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ opacity: 0.7 }}>
                    <th style={cell}>collection</th>
                    <th style={cell}>target</th>
                    <th style={cell}>points</th>
                    <th style={cell}>in target</th>
                    <th style={cell}>action</th>
                  </tr>
                </thead>
                <tbody>
                  {planRows.map((r, i) => (
                    <tr key={rowKey(r, i)} style={{ opacity: r.action && r.action.startsWith('skip') ? 0.6 : 1 }}>
                      <td style={cell}>{rowKey(r, i)}</td>
                      <td style={cell}>{r.target || '?'}</td>
                      <td style={cell}>{num(r.points)}</td>
                      <td style={cell}>{r.target_points == null ? 'not created' : num(r.target_points)}</td>
                      <td style={cell}>
                        {r.action || '?'}
                        {r.reason ? ` — ${r.reason}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {/* ── Status ───────────────────────────────────────────────────── */}
      <div style={{ fontSize: 13 }}>
        <strong>Status{status.data ? ` (${statusRows.length})` : ''}</strong>
        {status.loading && !status.data && <div style={{ opacity: 0.6 }}>loading…</div>}
        {status.error && <div style={{ color: BAD }}>{status.error}</div>}
        {status.data && (
          <>
            <div style={{ opacity: 0.7 }}>
              {typeof status.data.pending_total === 'number' ? `${num(status.data.pending_total)} pending` : 'pending ?'}
              {status.data.updated_at ? ` · state updated ${status.data.updated_at}` : ''}
            </div>
            {statusRows.length === 0 ? (
              <div style={{ opacity: 0.6 }}>no collection has been migrated yet</div>
            ) : (
              <table style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ opacity: 0.7 }}>
                    <th style={cell}>collection</th>
                    <th style={cell}>target</th>
                    <th style={cell}>source points</th>
                    <th style={cell}>pending</th>
                    <th style={cell}>skipped</th>
                    <th style={cell}>recall verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {statusRows.map((r, i) => {
                    const v = verdictOf(r)
                    return (
                      <tr key={rowKey(r, i)}>
                        <td style={cell}>{rowKey(r, i)}</td>
                        <td style={cell}>{r.target || '?'}</td>
                        <td style={cell}>{num(r.source_points)}</td>
                        <td style={cell}>{num(r.pending)}</td>
                        <td style={cell}>{num(r.skipped)}</td>
                        <td style={cell}>
                          <span style={{ color: v.color, opacity: v.color ? 1 : 0.6 }}>{v.label}</span>
                          {r.verified_at ? <span style={{ opacity: 0.7 }}> {r.verified_at}</span> : null}
                          {(r.reasons ?? []).map((why, j) => (
                            <div key={j} style={{ color: BAD }}>
                              {why}
                            </div>
                          ))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {/* ── Retire gate ──────────────────────────────────────────────── */}
      <div style={{ fontSize: 13 }}>
        <strong>Retire gate</strong>
        {gate.loading && !gate.data && <div style={{ opacity: 0.6 }}>loading…</div>}
        {gate.error && <div style={{ color: BAD }}>{gate.error}</div>}
        {gate.data && (
          <>
            <div>
              <strong style={{ color: ready ? GOOD : BAD }}>
                {ready ? 'READY — the old embedder is safe to retire' : 'NOT READY — keep the old embedder'}
              </strong>
            </div>
            {blockers.length > 0 && (
              <div>
                Blockers ({blockers.length})
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {blockers.map((b, i) => (
                    <li key={i} style={{ color: BAD }}>
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!ready && blockers.length === 0 && (
              <div style={{ opacity: 0.6 }}>the engine did not report ready and named no blocker</div>
            )}
            {ready && steps.length > 0 && (
              <div>
                Retirement steps (advisory; this panel runs none of them)
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
