'use client'

import { useState, useEffect, useCallback } from 'react'

// ---------------------------------------------------------------------------
// awprove — prove a surface renders what it should.
// Lists the checked-in proofs, checks one offline (every assertion can fail),
// and — for platform operators only — runs it live and shows PASS/FAIL per
// assertion plus the evidence screenshot. Backed by the Genesis router
// /api/v1/awprove/* (routers/awprove.py). A DEAD run (exit 2) is shown as
// "could not judge", never as a pass.
// ---------------------------------------------------------------------------

interface ProofEntry {
  name: string
  source: 'shipped' | 'internal' | string
}

interface ProofsResponse {
  proofs?: ProofEntry[]
  can_run?: boolean
}

interface AssertionResult {
  id: string
  ok: boolean
  detail?: string
  describe?: string
}

interface RunResponse {
  ok?: boolean
  name?: string
  passed?: boolean
  dead?: boolean
  dead_reason?: string
  exit_code?: number
  error?: string
  observed_url?: string
  results?: AssertionResult[]
  screenshot_base64?: string
}

interface CheckResponse {
  ok?: boolean
  name?: string
  error?: string
  assertions?: string[]
  cannot_fail?: string[]
  detail?: string
}

function verdictLabel(r: RunResponse): { text: string; color: string } {
  if (r.dead || r.exit_code === 2) return { text: 'DEAD — could not judge', color: '#e5c07b' }
  if (r.passed) return { text: 'PASS', color: '#98c379' }
  return { text: 'FAIL', color: '#e06c75' }
}

export default function AwprovePanel({ apiBase = '/api/v1/awprove' }: { apiBase?: string }) {
  const [data, setData] = useState<ProofsResponse | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')
  const [check, setCheck] = useState<CheckResponse | null>(null)
  const [run, setRun] = useState<RunResponse | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const resp = await fetch(`${apiBase}/proofs`)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      setData(await resp.json())
      setError('')
    } catch (e) {
      setError(`Cannot reach the awprove router: ${String(e)}`)
    }
  }, [apiBase])

  useEffect(() => {
    void load()
  }, [load])

  const post = useCallback(
    async (path: string, body: object) => {
      const resp = await fetch(`${apiBase}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok) return { ok: false, error: json.detail ?? `HTTP ${resp.status}` }
      return json
    },
    [apiBase],
  )

  const doCheck = useCallback(
    async (name: string) => {
      setSelected(name)
      setRun(null)
      setBusy(true)
      try {
        setCheck(await post('check', { proof: name }))
      } catch (e) {
        setCheck({ ok: false, error: String(e) })
      } finally {
        setBusy(false)
      }
    },
    [post],
  )

  const doRun = useCallback(
    async (name: string) => {
      setSelected(name)
      setCheck(null)
      setBusy(true)
      try {
        setRun(await post('run', { proof: name, include_screenshot: true }))
      } catch (e) {
        setRun({ ok: false, dead: true, exit_code: 2, error: String(e) })
      } finally {
        setBusy(false)
      }
    },
    [post],
  )

  const proofs = data?.proofs ?? []
  const canRun = Boolean(data?.can_run)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0 }}>awprove</h3>
        <span style={{ opacity: 0.7, fontSize: 13 }}>
          prove what actually rendered{canRun ? '' : ' · live runs are platform-only'}
        </span>
        <button onClick={() => void load()} style={{ marginLeft: 'auto' }}>
          Refresh
        </button>
      </div>

      {error && <div style={{ color: '#e06c75' }}>{error}</div>}
      {proofs.length === 0 && !error && <div style={{ opacity: 0.6 }}>No proofs found.</div>}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th>proof</th>
            <th>source</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {proofs.map((p) => (
            <tr key={`${p.source}:${p.name}`} style={{ borderTop: '1px solid rgba(127,127,127,0.25)' }}>
              <td style={{ fontWeight: p.name === selected ? 600 : 400 }}>{p.name}</td>
              <td>{p.source}</td>
              <td style={{ display: 'flex', gap: 6 }}>
                <button disabled={busy} onClick={() => void doCheck(p.name)}>
                  check
                </button>
                {canRun && (
                  <button disabled={busy} onClick={() => void doRun(p.name)}>
                    run
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {busy && <div style={{ opacity: 0.7 }}>Working on {selected}…</div>}

      {check && (
        <div style={{ fontSize: 13 }}>
          <strong style={{ color: check.ok ? '#98c379' : '#e06c75' }}>
            {check.ok ? 'CHECK OK' : 'CHECK FAILED'}
          </strong>{' '}
          {check.ok
            ? `${check.assertions?.length ?? 0} assertion(s), each proven able to fail`
            : check.error}
          {check.cannot_fail && check.cannot_fail.length > 0 && (
            <div>cannot fail: {check.cannot_fail.join(', ')}</div>
          )}
        </div>
      )}

      {run && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
          <strong style={{ color: verdictLabel(run).color }}>
            {verdictLabel(run).text} {run.name ?? selected}
          </strong>
          {(run.error || run.dead_reason) && <div>{run.error ?? run.dead_reason}</div>}
          {run.observed_url && <div style={{ opacity: 0.7 }}>observed: {run.observed_url}</div>}
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {(run.results ?? []).map((r) => (
              <li key={r.id} style={{ color: r.ok ? undefined : '#e06c75' }}>
                [{r.ok ? 'ok' : 'FAIL'}] {r.id}: {r.describe || r.detail}
                {!r.ok && r.detail ? ` — ${r.detail}` : ''}
              </li>
            ))}
          </ul>
          {run.screenshot_base64 && (
            <img
              alt={`evidence for ${run.name ?? selected}`}
              src={`data:image/jpeg;base64,${run.screenshot_base64}`}
              style={{ maxWidth: '100%', border: '1px solid rgba(127,127,127,0.35)' }}
            />
          )}
        </div>
      )}
    </div>
  )
}
