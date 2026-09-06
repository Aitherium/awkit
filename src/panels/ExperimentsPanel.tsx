'use client'

/**
 * ExperimentsPanel — the portal's face on the AitherLab experiment ledger.
 *
 * Every lane that runs an experiment (the ratchet, finetune_run, a SWE-bench arm,
 * an AitherBench sweep) writes rows to AitherLab; this panel lists them, shows one
 * in detail, and launches a run — so planning an experiment does not require a
 * terminal.
 *
 * 🚨 An unreachable backend renders as an ERROR, never as an empty list. The
 * backend router answers {reachable:false, error}; a panel that showed "no
 * experiments" for that would be indistinguishable from a healthy empty ledger,
 * which is the failure this whole plane exists to stop.
 */

import { useCallback, useEffect, useState } from 'react'

/* ── Types ─────────────────────────────────────────────────────────────── */

interface Envelope<T> {
  reachable?: boolean
  error?: string
  detail?: string
  data?: T
  ok?: boolean
}

interface RunSummary {
  id?: string
  run_id?: string
  status?: string
  started_at?: string
  created_at?: string
  score?: number | null
}

interface ExperimentSpec {
  name: string
  description?: string
  status?: string
  latest_run?: RunSummary | null
  runs?: RunSummary[]
}

export interface ExperimentsPanelProps {
  apiBase?: string
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function timeAgo(date?: string): string {
  if (!date) return '—'
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (Number.isNaN(seconds)) return '—'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function statusTone(status?: string): string {
  switch ((status || '').toLowerCase()) {
    case 'completed':
    case 'succeeded':
      return 'text-emerald-600'
    case 'running':
      return 'text-blue-600'
    case 'failed':
    case 'error':
      return 'text-red-600'
    case 'cancelled':
      return 'text-amber-600'
    default:
      return 'text-gray-500'
  }
}

/** Read an envelope the routers produce, turning "unreachable" into a message. */
function unwrap<T>(env: Envelope<T> | null, what: string): { data: T | null; error: string | null } {
  if (!env) return { data: null, error: `${what}: no response from the portal backend` }
  if (env.reachable === false) return { data: null, error: env.error || `${what}: AitherLab unreachable` }
  if (env.error) return { data: null, error: `${env.error}${env.detail ? ` — ${env.detail}` : ''}` }
  return { data: (env.data ?? null) as T | null, error: null }
}

/** Pull a list out of a payload without GUESSING: an unrecognised shape is reported,
 * never silently treated as empty. The Lab answers {specs}/{runs}/{events}/{rows}
 * depending on the route, and a wrong key looks exactly like "nothing here yet". */
function pickList<T>(
  payload: unknown,
  keys: string[],
): { items: T[]; unknownShape: boolean; keys: string[] } {
  if (payload == null) return { items: [], unknownShape: false, keys: [] }
  if (Array.isArray(payload)) return { items: payload as T[], unknownShape: false, keys: [] }
  if (typeof payload === 'object') {
    const obj = payload as Record<string, unknown>
    for (const k of keys) {
      if (Array.isArray(obj[k])) return { items: obj[k] as T[], unknownShape: false, keys: Object.keys(obj) }
    }
    // A count of 0 with a known envelope is a genuinely empty ledger, not a mismatch.
    const known = Object.keys(obj).some((k) => keys.includes(k) || k === 'count')
    return { items: [], unknownShape: !known, keys: Object.keys(obj) }
  }
  return { items: [], unknownShape: true, keys: [] }
}

/* ── Panel ─────────────────────────────────────────────────────────────── */

export default function ExperimentsPanel({
  apiBase = '/api/v1/experiments',
}: ExperimentsPanelProps) {
  const [specs, setSpecs] = useState<ExperimentSpec[]>([])
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [launching, setLaunching] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [specEnv, runEnv] = await Promise.all([
        fetch(`${apiBase}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`${apiBase}/runs?limit=25`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ])
      const s = unwrap<{ experiments?: ExperimentSpec[] } | ExperimentSpec[]>(specEnv, 'experiments')
      const r = unwrap<{ runs?: RunSummary[] } | RunSummary[]>(runEnv, 'runs')
      if (s.error) {
        setError(s.error)
      } else {
        const picked = pickList<ExperimentSpec>(s.data, ['specs', 'experiments'])
        if (picked.unknownShape) {
          // The route answers {specs: [...]}; guessing a key and falling back to []
          // renders "no experiments yet" over a ledger that holds seven — the exact
          // silence this panel exists to refuse. Say the shape is unrecognised.
          setError(
            `The ledger answered in an unrecognised shape (keys: ${picked.keys.join(', ') || 'none'}). ` +
              'Nothing is being hidden — this is not an empty ledger.',
          )
        }
        setSpecs(picked.items)
      }
      setRuns(pickList<RunSummary>(r.data, ['runs']).items)
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => {
    void load()
  }, [load])

  const launch = useCallback(
    async (name: string, dryRun: boolean) => {
      setLaunching(name)
      setNotice(null)
      try {
        const res = await fetch(`${apiBase}/${encodeURIComponent(name)}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dry_run: dryRun }),
        })
          .then((r) => r.json())
          .catch(() => null)
        const { error: err } = unwrap(res, 'launch')
        setNotice(err ? `Launch refused — ${err}` : `${dryRun ? 'Dry run' : 'Run'} started for ${name}`)
        await load()
      } finally {
        setLaunching(null)
      }
    },
    [apiBase, load],
  )

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Experiments</h2>
          <p className="text-sm text-gray-500">
            Every lane writes here — ratchet, fine-tunes, benchmark arms.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded border px-3 py-1 text-sm hover:bg-gray-50"
        >
          Refresh
        </button>
      </header>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <strong>Ledger unavailable.</strong> {error}
          <div className="mt-1 text-xs text-red-700">
            This is an error, not an empty ledger — nothing is being hidden from you.
          </div>
        </div>
      )}

      {notice && (
        <div className="rounded border border-blue-300 bg-blue-50 p-3 text-sm text-blue-800">{notice}</div>
      )}

      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {!loading && !error && specs.length === 0 && (
        <p className="text-sm text-gray-500">
          The ledger is reachable and holds no experiment specs yet.
        </p>
      )}

      <ul className="divide-y rounded border">
        {specs.map((s) => (
          <li key={s.name} className="p-3">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                className="text-left"
                onClick={() => setSelected(selected === s.name ? null : s.name)}
              >
                <div className="font-medium">{s.name}</div>
                {s.description && <div className="text-sm text-gray-500">{s.description}</div>}
                <div className="text-xs text-gray-500">
                  latest:{' '}
                  <span className={statusTone(s.latest_run?.status)}>
                    {s.latest_run?.status || 'never run'}
                  </span>{' '}
                  {timeAgo(s.latest_run?.started_at || s.latest_run?.created_at)}
                </div>
              </button>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={launching === s.name}
                  onClick={() => void launch(s.name, true)}
                  className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                  title="Plan only — the Lab honours dry_run"
                >
                  Dry run
                </button>
                <button
                  type="button"
                  disabled={launching === s.name}
                  onClick={() => void launch(s.name, false)}
                  className="rounded bg-black px-2 py-1 text-xs text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {launching === s.name ? 'Starting…' : 'Run'}
                </button>
              </div>
            </div>
            {selected === s.name && (
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-gray-50 p-2 text-xs">
                {JSON.stringify(s, null, 2)}
              </pre>
            )}
          </li>
        ))}
      </ul>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Recent runs</h3>
        {runs.length === 0 ? (
          <p className="text-sm text-gray-500">No runs recorded yet.</p>
        ) : (
          <ul className="divide-y rounded border text-sm">
            {runs.map((r, i) => (
              <li key={r.run_id || r.id || i} className="flex justify-between p-2">
                <span className="truncate">{r.run_id || r.id}</span>
                <span className={statusTone(r.status)}>{r.status}</span>
                <span className="text-gray-500">{timeAgo(r.started_at || r.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
