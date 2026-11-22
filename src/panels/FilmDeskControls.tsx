'use client'

/**
 * Film desk admin controls — approve/reject a pending proposal, rebuild a shot, build the
 * film, render. Ported from the tenant's own FilmDeskPanel (#14585) so the surface a tenant
 * actually sees (the Veil export mounting this awkit panel) carries them too.
 *
 * What a session may do comes from `GET {base}/desk` — the role the signed-in session/IdP
 * holds, answered by the host backend from its own UserContext, never a request field.
 * media-forge re-checks that role on every write; its 403 arrives as a plain sentence. A
 * verb the role holds but that is blocked right now (a running job, unanswered script
 * questions) is disabled WITH the reason. While a job runs, the steer state is polled.
 *
 * Host contract: `GET {base}/desk`, `GET {base}/projects/{name}/steer`,
 * `POST .../proposals/{pid}/decide {action}`, `POST .../shots/{shot}/rebuild`,
 * `POST .../build {from}`, `POST .../render {steps, tier?}`.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'

export interface DeskCan {
  ask: boolean; decide: boolean; rebuild: boolean; build: boolean; render: boolean
}
export interface DeskCaps { role: string; enabled: boolean; can: DeskCan }
interface DeskStep { state?: string; why?: string }
interface DeskJob { label?: string; status?: string; log_tail?: string }
interface Pending {
  id: string; status?: string; version?: string; changed_steps?: number[]
  open_questions?: number
}
export interface Steer {
  pending?: Pending | null
  open_questions?: number
  steps?: Record<string, DeskStep>
  job?: DeskJob | null
}
interface ShotRef { id: string; chapter?: string | null }

const TIERS = ['draft', 'standard', 'realistic', 'cinematic', 'as-built']

const S: Record<string, CSSProperties> = {
  card: {
    padding: 12,
    border: '1px solid var(--glass-border)',
    borderRadius: 'var(--radius)',
    background: 'var(--glass-bg, transparent)',
  },
  subhead: { marginBottom: 8 },
  note: { color: 'var(--text-muted)', fontSize: 12, margin: '6px 0' },
  ok: { color: 'var(--accent-primary)' },
  err: { color: 'var(--danger, #e06c75)' },
  bar: { display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' },
  row: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 },
  stepName: { flex: 1 },
  btn: {
    padding: '6px 12px', borderRadius: 'var(--radius)', cursor: 'pointer',
    border: '1px solid var(--glass-border)', background: 'transparent', color: 'inherit',
  },
  primary: { background: 'var(--accent-primary)', color: 'var(--bg-deep)', border: 'none' },
  danger: { borderColor: 'var(--danger, #e06c75)', color: 'var(--danger, #e06c75)' },
  off: { opacity: 0.5, cursor: 'not-allowed' },
  log: {
    margin: '6px 0 0', maxHeight: 140, overflow: 'auto', fontSize: 11,
    color: 'var(--text-muted)', whiteSpace: 'pre-wrap',
  },
}

async function sendJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: 'include', ...init })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((body as { detail?: string }).detail || `HTTP ${r.status}`)
  return body as T
}

/** The desk's role + the selected project's steer state, refreshed on demand. */
export function useFilmDesk(base: string, project: string | null) {
  const [caps, setCaps] = useState<DeskCaps | null>(null)
  const [steer, setSteer] = useState<Steer | null>(null)

  useEffect(() => {
    let cancelled = false
    sendJson<DeskCaps>(`${base}/desk`)
      .then((d) => { if (!cancelled) setCaps(d) })
      .catch(() => { if (!cancelled) setCaps(null) })
    return () => { cancelled = true }
  }, [base])

  const refresh = useCallback(() => {
    if (!project) return
    sendJson<{ steer: Steer | null }>(`${base}/projects/${encodeURIComponent(project)}/steer`)
      .then((d) => setSteer(d.steer))
      .catch(() => setSteer(null))
  }, [base, project])

  useEffect(() => { setSteer(null); refresh() }, [project, refresh])
  return { caps, steer, refresh }
}

export default function FilmDeskControls({ base, project, caps, steer, shots, onRefresh,
  onJobDone }: {
  base: string; project: string; caps: DeskCaps | null; steer: Steer | null
  shots: ShotRef[]; onRefresh: () => void; onJobDone?: () => void
}) {
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState('')
  const [err, setErr] = useState('')
  const [steps, setSteps] = useState('stale')
  const [tier, setTier] = useState('')

  useEffect(() => { setResult(''); setErr('') }, [project])

  const jobStatus = steer?.job?.status || ''
  const jobRunning = jobStatus === 'running'
  useEffect(() => {
    if (!jobRunning) return
    const t = setInterval(onRefresh, 3000)
    return () => clearInterval(t)
  }, [jobRunning, onRefresh])

  // a build/render that just finished rewrote the outputs: let the panel reload the film
  const prevJob = useRef('')
  useEffect(() => {
    if (prevJob.current === 'running' && jobStatus && jobStatus !== 'running') onJobDone?.()
    prevJob.current = jobStatus
  }, [jobStatus, onJobDone])

  if (!caps || !caps.enabled || !steer) return null

  const can = caps.can
  const canAdmin = can.decide || can.rebuild || can.build || can.render
  if (!canAdmin) {
    return (
      <div style={S.card}>
        <div style={S.subhead}>Desk</div>
        <div style={S.note}>
          You are signed in as {caps.role || 'a viewer'}. You can watch the film and ask for
          changes; approving, rebuilding, building and rendering need a workspace administrator.
        </div>
      </div>
    )
  }

  const pending = steer.pending || null
  const openQs = steer.open_questions ?? pending?.open_questions ?? 0
  const blocked = busy
    ? `Waiting for ${busy}…`
    : jobRunning ? 'A build or render is already running; wait for it to finish.' : ''
  const decideReason = blocked || (openQs > 0
    ? `Answer the ${openQs} open script question${openQs === 1 ? '' : 's'} first.` : '')

  const post = (path: string, body: unknown, what: string) => {
    setBusy(what); setErr(''); setResult('')
    sendJson<Record<string, unknown>>(
      `${base}/projects/${encodeURIComponent(project)}${path}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body) },
    )
      .then((d) => {
        // decide answers the proposal itself (status on the result); the others start a job
        const status = (d.proposal as { status?: string } | undefined)?.status
          || (typeof d.status === 'string' ? d.status : '')
        const note = typeof d.note === 'string' ? d.note : ''
        setResult(status ? `${what}: the proposal is now ${status}.`
          : note || `${what} requested; the desk is working on it.`)
        onRefresh()
      })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(''))
  }

  const btn = (kind?: 'primary' | 'danger', off?: string): CSSProperties =>
    ({ ...S.btn, ...(kind ? S[kind] : {}), ...(off ? S.off : {}) })

  const rows = Object.entries(steer.steps || {})
    .filter(([k]) => /^\d+$/.test(k))
    .sort(([a], [b]) => Number(a) - Number(b))

  return (
    <div style={S.card}>
      <div style={S.subhead}>Desk</div>
      {steer.job && (
        <div style={{ marginBottom: 8 }}>
          <div style={S.note}>
            {jobRunning ? 'Working' : 'Last job'}: {steer.job.label || 'build'}
            {steer.job.status ? ` — ${steer.job.status}` : ''}
          </div>
          {steer.job.log_tail && <pre style={S.log}>{steer.job.log_tail}</pre>}
        </div>
      )}
      {result && <div style={{ ...S.note, ...S.ok }}>{result}</div>}
      {err && <div role="alert" style={{ ...S.note, ...S.err }}>{err}</div>}

      {can.decide && (pending ? (
        <div style={{ marginBottom: 10 }}>
          <div style={S.note}>
            Pending proposal {pending.version || pending.id} ({pending.status || 'pending'})
            {pending.changed_steps?.length ? ` · steps ${pending.changed_steps.join(', ')}` : ''}
            {openQs > 0 ? ` · ${openQs} open question${openQs === 1 ? '' : 's'}` : ''}
          </div>
          <div style={S.bar}>
            <button type="button" style={btn('primary', decideReason)} disabled={!!decideReason}
              title={decideReason || undefined}
              onClick={() => post(`/proposals/${encodeURIComponent(pending.id)}/decide`,
                { action: 'approve' }, 'Approve')}>
              Approve
            </button>
            <button type="button" style={btn('danger', decideReason)} disabled={!!decideReason}
              title={decideReason || undefined}
              onClick={() => post(`/proposals/${encodeURIComponent(pending.id)}/decide`,
                { action: 'reject' }, 'Reject')}>
              Reject
            </button>
          </div>
          {decideReason && <div style={S.note}>{decideReason}</div>}
        </div>
      ) : <div style={S.note}>No pending proposal to approve.</div>)}

      {can.rebuild && rows.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {rows.map(([n, st]) => {
            const id = `step${n.padStart(2, '0')}`
            const chapter = shots.find((s) => s.id === id)?.chapter
            return (
              <div key={n} style={S.row}>
                <span style={S.stepName}>
                  {n}. {chapter || id}
                  <span style={{ ...S.note, marginLeft: 6 }}>{st.state || 'built'}</span>
                </span>
                <button type="button" style={btn(undefined, blocked)} disabled={!!blocked}
                  title={blocked || undefined}
                  onClick={() => post(`/shots/${id}/rebuild`, {}, `Rebuild ${id}`)}>
                  Rebuild
                </button>
              </div>
            )
          })}
        </div>
      )}

      {can.build && (
        <div style={S.bar}>
          <button type="button" style={btn('primary', blocked)} disabled={!!blocked}
            title={blocked || undefined}
            onClick={() => post('/build', { from: 'mix' }, 'Build')}>
            Build the film
          </button>
        </div>
      )}

      {can.render && (
        <div style={S.bar}>
          <input style={{ ...S.btn, width: 96 }} value={steps} aria-label="steps to render"
            onChange={(e) => setSteps(e.target.value)} />
          <select style={S.btn} value={tier} aria-label="quality tier"
            onChange={(e) => setTier(e.target.value)}>
            <option value="">current tier</option>
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button type="button" style={btn(undefined, blocked)} disabled={!!blocked}
            title={blocked || undefined}
            onClick={() => post('/render', tier ? { steps, tier } : { steps }, 'Render')}>
            Render
          </button>
        </div>
      )}
      {blocked && <div style={S.note}>{blocked}</div>}
    </div>
  )
}
