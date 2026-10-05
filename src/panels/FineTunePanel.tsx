'use client'

/**
 * FineTunePanel — fine-tuning as a service for a tenant workspace.
 *
 * Ported from Veil's ftaas-dashboard to the awkit backend proxy
 * (`/api/ftaas/*` -> Genesis `/ftaas/*`, carried with the signed-in user's own
 * session). Genesis decides the tenant, the plan gate and the permissions; this
 * panel shows what it answers:
 *
 *   - plan limits and whether the workspace's OWN Vast.ai account is connected
 *     (rented training runs on that key only — never the platform's)
 *   - dataset upload -> estimate -> submit
 *   - jobs (with cancel) and trained adapters (deploy / undeploy)
 *
 * Rules kept from the other awkit panels: an unreachable service renders as an
 * ERROR, never as "no jobs"; a plan refusal says so without quoting any price.
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react'

/* ── Types ─────────────────────────────────────────────────────────────── */

interface Budget {
  tier?: string
  max_gpu_minutes_per_job?: number
  max_concurrent_jobs?: number
  max_dataset_mb?: number
  vast_account_connected?: boolean
  vast_referral_link?: string
  billing_note?: string
}

interface BaseModel {
  id: string
  description?: string
  vram_gb?: number
}

interface Job {
  job_id: string
  status: string
  base_model: string
  gpu_provider?: string
  current_step?: number
  total_steps?: number
  adapter_id?: string
  error?: string
  created_at?: string
}

interface Adapter {
  adapter_id: string
  base_model: string
  version?: number
  benchmark_score?: number
  training_examples?: number
  deployed?: boolean
  created_at?: string
}

interface TrainingNode {
  id: string
  name?: string
}

interface Estimate {
  estimated_gpu_minutes?: number
  recommended_provider?: string
  estimated_cost_usd?: number
}

export interface FineTunePanelProps {
  apiBase?: string
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

const card: CSSProperties = {
  background: 'var(--bg-surface)', border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius)', padding: '1rem', marginBottom: '1rem',
}
const btn: CSSProperties = {
  padding: '0.45rem 0.9rem', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)', fontSize: '0.8rem',
  cursor: 'pointer',
}
const input: CSSProperties = {
  padding: '0.4rem 0.6rem', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
  border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)', fontSize: '0.8rem',
}
const muted: CSSProperties = { fontSize: '0.75rem', color: 'var(--text-muted)' }

/** Turn a non-2xx answer into words; a plan refusal is named, never priced. */
async function failure(r: Response): Promise<string> {
  let body: any = null
  try { body = await r.json() } catch { /* not JSON */ }
  const detail = body?.detail ?? body
  const code = typeof detail === 'object' ? detail?.error : undefined
  if (r.status === 401) return 'Sign in with your Aitherium account to use fine-tuning.'
  if (code === 'plan_tier_required' || code === 'frontier_tuning_requires_professional') {
    return 'Fine-tuning is not included in this workspace\'s current plan.'
  }
  if (r.status === 403) return 'Your role cannot do this — ask a workspace admin.'
  if (r.status === 502 || r.status === 503) return 'The fine-tuning service is unreachable right now.'
  const msg = typeof detail === 'string' ? detail : (detail?.message || detail?.errors?.join?.('; ') || body?.error)
  return msg ? String(msg) : `Request failed (HTTP ${r.status})`
}

function statusColor(status?: string): string {
  switch ((status || '').toLowerCase()) {
    case 'completed': return 'var(--accent-green)'
    case 'failed':
    case 'cancelled': return 'var(--accent-coral)'
    default: return 'var(--text-muted)'
  }
}

/* ── Panel ─────────────────────────────────────────────────────────────── */

export default function FineTunePanel({ apiBase = '/api/ftaas' }: FineTunePanelProps) {
  const [budget, setBudget] = useState<Budget | null>(null)
  const [models, setModels] = useState<BaseModel[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [adapters, setAdapters] = useState<Adapter[]>([])
  const [nodes, setNodes] = useState<TrainingNode[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [vastKey, setVastKey] = useState('')
  const [datasetPath, setDatasetPath] = useState('')
  const [examples, setExamples] = useState(500)
  const [baseModel, setBaseModel] = useState('llama-3.2-3b')
  const [epochs, setEpochs] = useState(3)
  const [target, setTarget] = useState('auto')
  const [nodeId, setNodeId] = useState('')
  const [estimate, setEstimate] = useState<Estimate | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const b = await fetch(`${apiBase}/budget`)
      if (!b.ok) {
        setError(await failure(b))
        setBudget(null)
        return
      }
      setBudget(await b.json())
      const [m, j, a, n] = await Promise.all([
        fetch(`${apiBase}/models`), fetch(`${apiBase}/jobs`),
        fetch(`${apiBase}/adapters`), fetch(`${apiBase}/nodes`),
      ])
      if (m.ok) setModels(((await m.json())?.models ?? []) as BaseModel[])
      if (j.ok) setJobs(((await j.json())?.jobs ?? []) as Job[])
      else setError(await failure(j))
      if (a.ok) setAdapters(((await a.json())?.adapters ?? []) as Adapter[])
      if (n.ok) setNodes(((await n.json())?.nodes ?? []) as TrainingNode[])
    } catch {
      setError('The fine-tuning service is unreachable right now.')
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => { void load() }, [load])

  const act = async (fn: () => Promise<Response>, ok: string, after?: (body: any) => void) => {
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const r = await fn()
      if (!r.ok) { setError(await failure(r)); return }
      const body = await r.json().catch(() => ({}))
      after?.(body)
      setNotice(ok)
      await load()
    } catch {
      setError('The fine-tuning service is unreachable right now.')
    } finally {
      setBusy(false)
    }
  }

  const post = (path: string, body?: unknown) => fetch(`${apiBase}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })

  const connectVast = () => act(
    () => fetch(`${apiBase}/vast-key`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: vastKey }),
    }),
    'Vast.ai account connected.', () => setVastKey(''),
  )
  const disconnectVast = () => act(
    () => fetch(`${apiBase}/vast-key`, { method: 'DELETE' }), 'Vast.ai account disconnected.',
  )

  const upload = (file: File) => {
    const form = new FormData()
    form.append('file', file)
    void act(
      () => fetch(`${apiBase}/upload?dataset_format=jsonl_chat`, { method: 'POST', body: form }),
      `Uploaded ${file.name}.`,
      (body) => {
        if (body?.dataset_path) setDatasetPath(String(body.dataset_path))
        if (typeof body?.examples === 'number') setExamples(body.examples)
      },
    )
  }

  const runEstimate = () => act(
    () => post('/estimate', {
      base_model: baseModel, dataset_examples: examples, epochs,
      gpu_provider: target === 'vastai' ? 'vast.ai' : (target === 'local' ? 'local' : 'auto'),
    }),
    'Estimate ready.', (body) => setEstimate(body as Estimate),
  )

  const submit = () => act(
    () => post('/jobs', {
      base_model: baseModel, dataset_path: datasetPath, epochs,
      execution_target: target, ...(target === 'customer' ? { target_node_id: nodeId } : {}),
    }),
    'Fine-tuning job submitted.',
  )

  if (loading && !budget && !error) {
    return <div style={{ padding: '1.5rem', ...muted }}>Loading fine-tuning…</div>
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 960 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Fine-Tuning</h2>
          <p style={muted}>Train a model on your own data, then deploy the adapter to your workspace.</p>
        </div>
        <button type="button" style={btn} onClick={() => void load()} disabled={busy}>Refresh</button>
      </header>

      {error && (
        <div role="alert" style={{ ...card, borderColor: 'var(--accent-coral)', color: 'var(--accent-coral)' }}>{error}</div>
      )}
      {notice && <div style={{ ...card, borderColor: 'var(--accent-green)' }}>{notice}</div>}

      {budget && (
        <>
          <section style={card}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>Plan limits</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.5rem' }}>
              <div><div style={muted}>GPU minutes per job</div><div>{budget.max_gpu_minutes_per_job ?? '—'}</div></div>
              <div><div style={muted}>Concurrent jobs</div><div>{budget.max_concurrent_jobs ?? '—'}</div></div>
              <div><div style={muted}>Dataset size (MB)</div><div>{budget.max_dataset_mb ?? '—'}</div></div>
            </div>
            {budget.billing_note && <p style={{ ...muted, marginTop: '0.5rem' }}>{budget.billing_note}</p>}
          </section>

          <section style={card}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>Your Vast.ai account</h3>
            {budget.vast_account_connected ? (
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <span style={{ color: 'var(--accent-green)' }}>Connected</span>
                <button type="button" style={btn} onClick={() => void disconnectVast()} disabled={busy}>Disconnect</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <input type="password" autoComplete="off" placeholder="Vast.ai API key" value={vastKey}
                  onChange={(e) => setVastKey(e.target.value)} style={{ ...input, minWidth: 260 }} />
                <button type="button" style={btn} onClick={() => void connectVast()} disabled={busy || !vastKey}>Connect</button>
                {budget.vast_referral_link && (
                  <a href={budget.vast_referral_link} target="_blank" rel="noreferrer" style={muted}>Create a Vast.ai account</a>
                )}
              </div>
            )}
            <p style={{ ...muted, marginTop: '0.5rem' }}>Rented GPU training runs only on this key. Without it, use a local or your own registered GPU node.</p>
          </section>

          <section style={card}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>New fine-tune</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.6rem' }}>
              <label style={muted}>Dataset (.jsonl, .json, .csv, .parquet)
                <input type="file" accept=".jsonl,.json,.csv,.parquet" disabled={busy}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f) }} style={{ ...input, width: '100%' }} />
              </label>
              <label style={muted}>Base model
                <select value={baseModel} onChange={(e) => setBaseModel(e.target.value)} style={{ ...input, width: '100%' }}>
                  {(models.length ? models : [{ id: baseModel }]).map((m) => (
                    <option key={m.id} value={m.id}>{m.id}</option>
                  ))}
                </select>
              </label>
              <label style={muted}>Examples
                <input type="number" min={10} value={examples} onChange={(e) => setExamples(Number(e.target.value) || 10)} style={{ ...input, width: '100%' }} />
              </label>
              <label style={muted}>Epochs
                <input type="number" min={1} max={10} value={epochs} onChange={(e) => setEpochs(Number(e.target.value) || 1)} style={{ ...input, width: '100%' }} />
              </label>
              <label style={muted}>Run on
                <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ ...input, width: '100%' }}>
                  <option value="auto">Automatic</option>
                  <option value="local">Platform local GPU</option>
                  <option value="vastai">My Vast.ai account</option>
                  <option value="customer" disabled={!nodes.length}>My own GPU node</option>
                </select>
              </label>
              {target === 'customer' && (
                <label style={muted}>GPU node
                  <select value={nodeId} onChange={(e) => setNodeId(e.target.value)} style={{ ...input, width: '100%' }}>
                    <option value="">Choose…</option>
                    {nodes.map((n) => <option key={n.id} value={n.id}>{n.name || n.id}</option>)}
                  </select>
                </label>
              )}
            </div>
            {datasetPath && <p style={{ ...muted, marginTop: '0.5rem' }}>Dataset ready: {datasetPath.split(/[\\/]/).pop()}</p>}
            {estimate && (
              <p style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
                Estimate: {estimate.estimated_gpu_minutes ?? '—'} GPU minutes
                {estimate.recommended_provider ? ` on ${estimate.recommended_provider}` : ''}
                {typeof estimate.estimated_cost_usd === 'number' ? ` · service estimate $${estimate.estimated_cost_usd.toFixed(2)}` : ''}
              </p>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <button type="button" style={btn} onClick={() => void runEstimate()} disabled={busy}>Estimate</button>
              <button type="button" style={btn} onClick={() => void submit()}
                disabled={busy || !datasetPath || (target === 'customer' && !nodeId)}>Start training</button>
            </div>
          </section>

          <section style={card}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>Jobs</h3>
            {jobs.length === 0 ? <p style={muted}>No fine-tuning jobs yet.</p> : (
              <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                <thead><tr style={muted}><th align="left">Job</th><th align="left">Model</th><th align="left">Status</th><th align="left">Progress</th><th /></tr></thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.job_id} style={{ borderTop: '1px solid var(--glass-border)' }}>
                      <td style={{ fontFamily: 'monospace' }}>{j.job_id.slice(0, 12)}</td>
                      <td>{j.base_model}</td>
                      <td style={{ color: statusColor(j.status) }} title={j.error || ''}>{j.status}</td>
                      <td>{j.total_steps ? `${j.current_step ?? 0}/${j.total_steps}` : '—'}</td>
                      <td align="right">
                        {['pending', 'running'].includes(j.status) && (
                          <button type="button" style={btn} disabled={busy}
                            onClick={() => void act(() => post(`/jobs/${encodeURIComponent(j.job_id)}/cancel`), 'Job cancelled.')}>Cancel</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section style={card}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>Adapters</h3>
            {adapters.length === 0 ? <p style={muted}>No trained adapters yet.</p> : (
              <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                <thead><tr style={muted}><th align="left">Adapter</th><th align="left">Base</th><th align="left">Score</th><th align="left">State</th><th /></tr></thead>
                <tbody>
                  {adapters.map((a) => (
                    <tr key={a.adapter_id} style={{ borderTop: '1px solid var(--glass-border)' }}>
                      <td style={{ fontFamily: 'monospace' }}>{a.adapter_id.slice(0, 14)}{a.version ? ` v${a.version}` : ''}</td>
                      <td>{a.base_model}</td>
                      <td>{typeof a.benchmark_score === 'number' ? a.benchmark_score.toFixed(2) : '—'}</td>
                      <td style={{ color: a.deployed ? 'var(--accent-green)' : 'var(--text-muted)' }}>{a.deployed ? 'Deployed' : 'Ready'}</td>
                      <td align="right">
                        {a.deployed ? (
                          <button type="button" style={btn} disabled={busy}
                            onClick={() => void act(() => post(`/adapters/${encodeURIComponent(a.adapter_id)}/undeploy`), 'Adapter undeployed.')}>Undeploy</button>
                        ) : (
                          <button type="button" style={btn} disabled={busy}
                            onClick={() => void act(() => post(`/adapters/${encodeURIComponent(a.adapter_id)}/deploy`, { force: false }), 'Adapter deployed.')}>Deploy</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  )
}
