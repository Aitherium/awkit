'use client'

import { useState, useEffect, useCallback } from 'react'
import type { CSSProperties } from 'react'

/*
 * AitherNanoBrain panel. Talks ONLY to the Genesis router
 * (AitherGenesis/routers/nanobrain.py, /api/v1/nanobrain/*), which scopes every
 * call to the caller's tenant:
 *   Lab       GET  /status, /experiments?status=, /leaderboard, POST /promote
 *             (one-click promote; platform operators only -- a 403 is shown as such)
 *   Training  POST /train-experiment (custom docs), POST /retrain-intent-router
 *             (platform operators only -- a tenant gets a 403, shown as such)
 *   Settings  GET/PUT /settings (PUT is tenant-admin only)
 * Adapter (LoRA) management has no backend route yet, so the panel does not
 * pretend to offer it.
 */

/* ── Types ─────────────────────────────────────────────────────────────── */

interface LabStatus {
  total_experiments?: number
  completed?: number
  sweep_running?: boolean
}

interface Experiment {
  id: string
  status: string
  config?: { name?: string; steps?: number; tags?: string[] }
  created_at?: string
}

interface LeaderboardEntry {
  rank: number
  experiment_id: string
  name?: string
  composite_score?: number
}

interface Settings {
  anomaly_threshold: number
  retrain_interval_hours: number
  auto_retrain: boolean
}

export interface NanoBrainPanelProps {
  apiBase?: string
}

type Tab = 'Lab' | 'Training' | 'Settings'
const TABS: Tab[] = ['Lab', 'Training', 'Settings']
const STATUS_FILTERS = ['', 'completed', 'running', 'failed', 'pending']

/* ── Helpers ─────────────────────────────────────────────────────────── */

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  if (!res.ok) {
    let detail = `${res.status}`
    try {
      const body = await res.json()
      if (body?.detail) detail = `${res.status}: ${body.detail}`
    } catch {
      /* non-JSON error body: keep the status code */
    }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'var(--accent-green, #4ade80)'
    case 'running':
      return 'var(--accent-blue, #0891b2)'
    case 'failed':
      return 'var(--accent-coral, #f87171)'
    case 'pending':
      return 'var(--accent-amber, #facc15)'
    default:
      return 'var(--text-tertiary, #71717a)'
  }
}

const card: CSSProperties = {
  padding: 12,
  background: 'var(--bg-secondary, #18181b)',
  borderRadius: 6,
  border: '1px solid var(--border-subtle, #3f3f46)',
}
const label: CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: 'var(--text-tertiary, #71717a)',
  marginBottom: 4,
}
const input: CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 12,
  background: 'var(--bg-primary, #0a0e17)',
  color: 'var(--text-primary, #d4d4d8)',
  border: '1px solid var(--border-subtle, #3f3f46)',
  borderRadius: 4,
  boxSizing: 'border-box',
}
function button(busy: boolean): CSSProperties {
  return {
    padding: '8px 14px',
    fontSize: 12,
    fontWeight: 600,
    background: busy ? 'var(--bg-tertiary, #27272a)' : 'var(--accent-blue, #0891b2)',
    color: busy ? 'var(--text-tertiary, #71717a)' : '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: busy ? 'default' : 'pointer',
  }
}

function Notice({ error, info }: { error: string; info: string }) {
  if (error) {
    return (
      <div role="alert" style={{ ...card, marginBottom: 12, fontSize: 12, color: 'var(--accent-coral, #f87171)' }}>
        {error}
      </div>
    )
  }
  if (info) {
    return (
      <div role="status" style={{ ...card, marginBottom: 12, fontSize: 12, color: 'var(--accent-green, #4ade80)' }}>
        {info}
      </div>
    )
  }
  return null
}

/* ── Lab tab ─────────────────────────────────────────────────────────── */

function LabTab({ apiBase, onError, onInfo }: {
  apiBase: string
  onError: (m: string) => void
  onInfo: (m: string) => void
}) {
  const [status, setStatus] = useState<LabStatus | null>(null)
  const [board, setBoard] = useState<LeaderboardEntry[]>([])
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [promoting, setPromoting] = useState<string | null>(null)

  // One-click promote (Story 2.1). Genesis refuses anyone but a platform
  // operator with 403; the message says so instead of failing silently.
  const handlePromote = async (entry: LeaderboardEntry) => {
    const experimentId = entry.experiment_id
    setPromoting(experimentId)
    try {
      await call(`${apiBase}/promote`, {
        method: 'POST',
        body: JSON.stringify({ experiment_id: experimentId }),
      })
      onError('')
      onInfo(`Promoted ${entry.name || experimentId}.`)
    } catch (err) {
      const msg = (err as Error).message
      onError(msg.startsWith('403') ? 'Promote requires a platform operator.' : `Promote failed: ${msg}`)
    }
    setPromoting(null)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const q = filter ? `&status=${encodeURIComponent(filter)}` : ''
    try {
      const [s, lb, ex] = await Promise.all([
        call<LabStatus>(`${apiBase}/status`),
        call<{ leaderboard?: LeaderboardEntry[] }>(`${apiBase}/leaderboard?top_n=10`),
        call<{ experiments?: Experiment[] }>(`${apiBase}/experiments?limit=25${q}`),
      ])
      setStatus(s)
      setBoard(lb.leaderboard || [])
      setExperiments(ex.experiments || [])
      onError('')
    } catch (err) {
      onError(`Could not load the Lab: ${(err as Error).message}`)
    }
    setLoading(false)
  }, [apiBase, filter, onError])

  useEffect(() => {
    load()
  }, [load])

  if (loading && !status) return <div style={{ fontSize: 12, color: 'var(--text-tertiary, #71717a)' }}>Loading...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {status && (
        <div style={{ ...card, fontSize: 13, color: 'var(--text-secondary, #a1a1aa)' }}>
          {status.completed ?? 0} of {status.total_experiments ?? 0} experiments completed
          {status.sweep_running ? ' · sweep running' : ''}
        </div>
      )}

      <div>
        <div style={{ ...label, textTransform: 'uppercase' }}>Leaderboard</div>
        {board.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary, #71717a)' }}>No ranked experiments yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--text-tertiary, #71717a)', textAlign: 'left' }}>
                <th style={{ padding: 6 }}>#</th>
                <th style={{ padding: 6 }}>Experiment</th>
                <th style={{ padding: 6, textAlign: 'right' }}>Score</th>
                <th style={{ padding: 6 }} />
              </tr>
            </thead>
            <tbody>
              {board.map(entry => (
                <tr key={entry.experiment_id} style={{ borderTop: '1px solid var(--border-subtle, #3f3f46)' }}>
                  <td style={{ padding: 6 }}>{entry.rank}</td>
                  <td style={{ padding: 6, color: 'var(--text-primary, #d4d4d8)' }}>{entry.name || entry.experiment_id}</td>
                  <td style={{ padding: 6, textAlign: 'right', fontFamily: 'monospace' }}>
                    {typeof entry.composite_score === 'number' ? entry.composite_score.toFixed(3) : '-'}
                  </td>
                  <td style={{ padding: 6, textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => handlePromote(entry)}
                      disabled={promoting !== null}
                      style={{ ...button(promoting !== null), padding: '4px 10px', fontSize: 11 }}
                    >
                      {promoting === entry.experiment_id ? 'Promoting...' : 'Promote'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ ...label, textTransform: 'uppercase', marginBottom: 0 }}>Experiments</span>
          <select
            aria-label="Filter experiments by status"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ ...input, width: 'auto' }}
          >
            {STATUS_FILTERS.map(f => (
              <option key={f} value={f}>{f || 'all'}</option>
            ))}
          </select>
        </div>
        {experiments.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary, #71717a)' }}>No experiments.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {experiments.map(x => (
              <div key={x.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: 'var(--text-primary, #d4d4d8)' }}>{x.config?.name || x.id}</span>
                <span style={{ color: statusColor(x.status), fontWeight: 600 }}>{x.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Training tab ────────────────────────────────────────────────────── */

function TrainingTab({ apiBase, onError, onInfo }: {
  apiBase: string
  onError: (m: string) => void
  onInfo: (m: string) => void
}) {
  const [name, setName] = useState('experiment')
  const [steps, setSteps] = useState(500)
  const [docs, setDocs] = useState('')
  const [busy, setBusy] = useState(false)

  const train = async () => {
    const customDocs = docs.split('\n').map(d => d.trim()).filter(Boolean)
    if (customDocs.length === 0) {
      onError('Add at least one training document (one per line).')
      return
    }
    setBusy(true)
    try {
      const res = await call<{ id?: string; experiment_id?: string }>(`${apiBase}/train-experiment`, {
        method: 'POST',
        body: JSON.stringify({ name, steps, dataset_sources: ['custom'], custom_docs: customDocs }),
      })
      onError('')
      onInfo(`Experiment launched${res.experiment_id || res.id ? `: ${res.experiment_id || res.id}` : ''}.`)
    } catch (err) {
      onError(`Training was not started: ${(err as Error).message}`)
    }
    setBusy(false)
  }

  const retrainRouter = async () => {
    setBusy(true)
    try {
      await call(`${apiBase}/retrain-intent-router`, { method: 'POST', body: JSON.stringify({ force: false }) })
      onError('')
      onInfo('Intent router retraining started.')
    } catch (err) {
      const msg = (err as Error).message
      onError(
        msg.startsWith('403')
          ? 'Retraining the intent router is a platform-operator action.'
          : `Intent router retrain failed: ${msg}`,
      )
    }
    setBusy(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={card}>
        <label style={label} htmlFor="nb-name">Experiment name</label>
        <input id="nb-name" style={input} value={name} maxLength={128} onChange={e => setName(e.target.value)} />
        <label style={{ ...label, marginTop: 8 }} htmlFor="nb-steps">Steps (10 - 10000)</label>
        <input
          id="nb-steps"
          type="number"
          min={10}
          max={10000}
          style={input}
          value={steps}
          onChange={e => setSteps(Number(e.target.value) || 10)}
        />
        <label style={{ ...label, marginTop: 8 }} htmlFor="nb-docs">Training documents (one per line)</label>
        <textarea id="nb-docs" style={{ ...input, minHeight: 120 }} value={docs} onChange={e => setDocs(e.target.value)} />
        <div style={{ marginTop: 10 }}>
          <button type="button" style={button(busy)} disabled={busy} onClick={train}>
            {busy ? 'Working...' : 'Train on my data'}
          </button>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary, #a1a1aa)', marginBottom: 8 }}>
          The fleet intent router serves every workspace; only platform operators can retrain it.
        </div>
        <button type="button" style={button(busy)} disabled={busy} onClick={retrainRouter}>
          Retrain intent router
        </button>
      </div>
    </div>
  )
}

/* ── Settings tab ────────────────────────────────────────────────────── */

function SettingsTab({ apiBase, onError, onInfo }: {
  apiBase: string
  onError: (m: string) => void
  onInfo: (m: string) => void
}) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    call<{ settings: Settings }>(`${apiBase}/settings`)
      .then(r => setSettings(r.settings))
      .catch(err => onError(`Could not load settings: ${(err as Error).message}`))
  }, [apiBase, onError])

  const save = async () => {
    if (!settings) return
    setBusy(true)
    try {
      const r = await call<{ settings: Settings }>(`${apiBase}/settings`, {
        method: 'PUT',
        body: JSON.stringify(settings),
      })
      setSettings(r.settings)
      onError('')
      onInfo('Settings saved.')
    } catch (err) {
      const msg = (err as Error).message
      onError(msg.startsWith('403') ? 'Only a workspace admin can change NanoBrain settings.' : `Save failed: ${msg}`)
    }
    setBusy(false)
  }

  if (!settings) return <div style={{ fontSize: 12, color: 'var(--text-tertiary, #71717a)' }}>Loading...</div>

  return (
    <div style={card}>
      <label style={label} htmlFor="nb-threshold">Anomaly threshold</label>
      <input
        id="nb-threshold"
        type="number"
        step={0.1}
        min={0}
        max={100}
        style={input}
        value={settings.anomaly_threshold}
        onChange={e => setSettings({ ...settings, anomaly_threshold: Number(e.target.value) })}
      />
      <label style={{ ...label, marginTop: 8 }} htmlFor="nb-interval">Retrain interval (hours)</label>
      <input
        id="nb-interval"
        type="number"
        min={1}
        max={8760}
        style={input}
        value={settings.retrain_interval_hours}
        onChange={e => setSettings({ ...settings, retrain_interval_hours: Number(e.target.value) })}
      />
      <label style={{ ...label, marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={settings.auto_retrain}
          onChange={e => setSettings({ ...settings, auto_retrain: e.target.checked })}
        />
        Retrain automatically
      </label>
      <div style={{ marginTop: 10 }}>
        <button type="button" style={button(busy)} disabled={busy} onClick={save}>
          {busy ? 'Saving...' : 'Save settings'}
        </button>
      </div>
    </div>
  )
}

/* ── Main Panel ──────────────────────────────────────────────────────── */

export default function NanoBrainPanel({
  apiBase = '/api/v1/nanobrain',
}: NanoBrainPanelProps) {
  const [tab, setTab] = useState<Tab>('Lab')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const onError = useCallback((m: string) => {
    setError(m)
    if (m) setInfo('')
  }, [])
  const onInfo = useCallback((m: string) => setInfo(m), [])

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', color: 'var(--text-primary, #d4d4d8)' }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>AitherNanoBrain</h3>
      <div role="tablist" style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {TABS.map(t => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t)
              setError('')
              setInfo('')
            }}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              background: tab === t ? 'var(--accent-blue, #0891b2)' : 'var(--bg-tertiary, #27272a)',
              color: tab === t ? '#fff' : 'var(--text-secondary, #a1a1aa)',
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <Notice error={error} info={info} />
      {tab === 'Lab' && <LabTab apiBase={apiBase} onError={onError} onInfo={onInfo} />}
      {tab === 'Training' && <TrainingTab apiBase={apiBase} onError={onError} onInfo={onInfo} />}
      {tab === 'Settings' && <SettingsTab apiBase={apiBase} onError={onError} onInfo={onInfo} />}
    </div>
  )
}
