'use client'

/**
 * TrainingJobsPanel — running and finished training runs, read from the ledger.
 *
 * Trainers post lifecycle events (started / progress / completed / failed) with
 * metrics and an artifact path to AitherLab's training ledger. This panel is how a
 * fine-tune is watched without tailing a log on a rented box.
 *
 * Same rule as ExperimentsPanel: an unreachable ledger renders as an ERROR, never
 * as "no jobs".
 */

import { useCallback, useEffect, useState } from 'react'

/* ── Types ─────────────────────────────────────────────────────────────── */

interface Envelope<T> {
  reachable?: boolean
  error?: string
  detail?: string
  data?: T
}

interface TrainingEvent {
  id?: string
  source?: string
  run_ref?: string
  status?: string
  model?: string
  base_model?: string
  dataset_ref?: string
  artifact_path?: string
  container?: string
  started_at?: string
  completed_at?: string | null
  created_at?: string
  metrics?: Record<string, number>
}

export interface TrainingJobsPanelProps {
  apiBase?: string
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function timeAgo(date?: string | null): string {
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
      return 'text-emerald-600'
    case 'running':
    case 'progress':
    case 'started':
      return 'text-blue-600'
    case 'failed':
      return 'text-red-600'
    default:
      return 'text-gray-500'
  }
}

function unwrap<T>(env: Envelope<T> | null, what: string): { data: T | null; error: string | null } {
  if (!env) return { data: null, error: `${what}: no response from the portal backend` }
  if (env.reachable === false) return { data: null, error: env.error || `${what}: AitherLab unreachable` }
  if (env.error) return { data: null, error: `${env.error}${env.detail ? ` — ${env.detail}` : ''}` }
  return { data: (env.data ?? null) as T | null, error: null }
}

function metricLine(m?: Record<string, number>): string {
  if (!m) return ''
  const parts = Object.entries(m).slice(0, 4).map(([k, v]) => `${k} ${v}`)
  return parts.join(' · ')
}

/* ── Panel ─────────────────────────────────────────────────────────────── */

export default function TrainingJobsPanel({
  apiBase = '/api/v1/training-jobs',
}: TrainingJobsPanelProps) {
  const [events, setEvents] = useState<TrainingEvent[]>([])
  const [stats, setStats] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sourceFilter, setSourceFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = sourceFilter ? `?source=${encodeURIComponent(sourceFilter)}&limit=50` : '?limit=50'
      const [jobEnv, statEnv] = await Promise.all([
        fetch(`${apiBase}${qs}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`${apiBase}/stats`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ])
      const j = unwrap<{ events?: TrainingEvent[] } | TrainingEvent[]>(jobEnv, 'training jobs')
      if (j.error) {
        setError(j.error)
      } else {
        const payload = j.data as { events?: TrainingEvent[] } | TrainingEvent[] | null
        setEvents(Array.isArray(payload) ? payload : payload?.events ?? [])
      }
      const s = unwrap<Record<string, unknown>>(statEnv, 'stats')
      setStats(s.data)
    } finally {
      setLoading(false)
    }
  }, [apiBase, sourceFilter])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Training Jobs</h2>
          <p className="text-sm text-gray-500">Lifecycle events every trainer writes to the ledger.</p>
        </div>
        <div className="flex gap-2">
          <input
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            placeholder="source (trainer, unsloth…)"
            className="rounded border px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={() => void load()}
            className="rounded border px-3 py-1 text-sm hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <strong>Ledger unavailable.</strong> {error}
          <div className="mt-1 text-xs text-red-700">
            Reported rather than shown as an empty job list.
          </div>
        </div>
      )}

      {stats && (
        <pre className="max-h-28 overflow-auto rounded bg-gray-50 p-2 text-xs">
          {JSON.stringify(stats, null, 2)}
        </pre>
      )}

      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {!loading && !error && events.length === 0 && (
        <p className="text-sm text-gray-500">
          The ledger is reachable and holds no training events for this filter.
        </p>
      )}

      <ul className="divide-y rounded border">
        {events.map((e, i) => (
          <li key={e.id || `${e.run_ref}-${i}`} className="p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {e.run_ref || e.id} <span className="text-gray-400">·</span>{' '}
                  <span className="text-gray-600">{e.source}</span>
                </div>
                <div className="truncate text-xs text-gray-500">
                  {e.model || e.base_model || 'model —'}
                  {e.dataset_ref ? ` · ${e.dataset_ref}` : ''}
                  {metricLine(e.metrics) ? ` · ${metricLine(e.metrics)}` : ''}
                </div>
                {e.artifact_path && (
                  <div className="truncate text-xs text-gray-400">{e.artifact_path}</div>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className={statusTone(e.status)}>{e.status}</div>
                <div className="text-xs text-gray-500">
                  {timeAgo(e.completed_at || e.started_at || e.created_at)}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
