'use client'

import { useState, useEffect, useCallback } from 'react'

// ---------------------------------------------------------------------------
// awgym — the ARC-AGI-3 training gym panel.
// Shows the live LeWM world-model state (train steps, recon, device), the
// game pool, and the solver-run ledger. The data comes from the genesis /gym
// proxy (the same surface the MCP tools dial), so the panel and the tools
// can never disagree about what the gym reports.
// ---------------------------------------------------------------------------

interface WmHealth {
  ok?: boolean
  device?: string
  train_steps?: number
  recon?: number
  z_std?: number
  checkpoint_exists?: boolean
  last_save_step?: number
}

interface GameInfo {
  game_id: string
  title?: string
  baseline_actions?: number[]
  tags?: string[]
}

interface RunRow {
  run_id?: string
  game_id?: string
  kind?: string
  steps?: number
  rounds?: number
  simulator?: string
  mean_surprise?: number
  hypothesis?: string
}

interface TrainingResponse {
  wm?: WmHealth
  games?: GameInfo[]
  runs?: RunRow[]
}

export default function GymPanel({ apiBase = '/api/bridge/genesis/gym' }: { apiBase?: string }) {
  const [data, setData] = useState<TrainingResponse | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [ranBurst, setRanBurst] = useState(false)

  const load = useCallback(async () => {
    // The gym's own surface (served through the genesis /gym proxy): /gym/games
    // (pool), /gym/score (recent ledger rows), /gym/wm/health (LeWM state).
    // There is no /gym/training aggregate — the panel composes the three.
    try {
      const [gamesR, scoreR, wmR] = await Promise.all([
        fetch(`${apiBase}/games`),
        fetch(`${apiBase}/score`),
        fetch(`${apiBase}/wm/health`),
      ])
      if (!gamesR.ok || !scoreR.ok || !wmR.ok) {
        throw new Error(`HTTP ${gamesR.status}/${scoreR.status}/${wmR.status}`)
      }
      const games: GameInfo[] = (await gamesR.json())?.games ?? []
      const score = await scoreR.json()
      const runs: RunRow[] = score?.runs ?? (Array.isArray(score) ? score : [])
      const wm: WmHealth = wmR.ok ? await wmR.json() : {}
      setData({ wm, games, runs })
      setError('')
    } catch (e) {
      setError(`Cannot reach the gym router: ${String(e)}`)
    }
  }, [apiBase])

  useEffect(() => {
    void load()
    const t = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(t)
  }, [load])

  const runBurst = useCallback(async () => {
    setBusy(true)
    setRanBurst(false)
    try {
      const resp = await fetch(`${apiBase}/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps: 100 }),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      setRanBurst(true)
      await load()
    } catch (e) {
      setError(`Train burst failed: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [apiBase, load])

  const wm = data?.wm
  const games = data?.games ?? []
  const runs = data?.runs ?? []

  return (
    <div className="gym-panel" style={{ padding: '0.75rem' }}>
      <h3 style={{ margin: '0 0 0.5rem' }}>AitherGym — ARC training loop</h3>
      {error && <p style={{ color: '#c44' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <section style={{ minWidth: '16rem', flex: 1 }}>
          <h4 style={{ margin: '0.25rem 0' }}>World model (LeWM)</h4>
          {wm ? (
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              <li>ok: {String(wm.ok)}</li>
              <li>device: {wm.device ?? '?'}</li>
              <li>train steps: {wm.train_steps?.toLocaleString() ?? '?'}</li>
              <li>recon: {wm.recon != null ? wm.recon.toFixed(4) : '?'}</li>
              <li>checkpoint: {wm.checkpoint_exists ? 'saved' : 'missing'}
                {wm.last_save_step != null ? ` @ ${wm.last_save_step}` : ''}</li>
            </ul>
          ) : (
            <p>loading…</p>
          )}
          <button
            onClick={runBurst}
            disabled={busy}
            style={{ marginTop: '0.5rem' }}
          >
            {busy ? 'training…' : 'run a 100-step burst'}
          </button>
          {ranBurst && <span style={{ color: '#2a6', marginLeft: '0.5rem' }}>burst done ✓</span>}
        </section>

        <section style={{ minWidth: '14rem', flex: 1 }}>
          <h4 style={{ margin: '0.25rem 0' }}>Game pool ({games.length})</h4>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', maxHeight: '10rem', overflowY: 'auto' }}>
            {games.slice(0, 12).map((g) => (
              <li key={g.game_id}>
                <code>{g.game_id}</code>
                {g.tags?.length ? ` (${g.tags.join(', ')})` : ''}
              </li>
            ))}
          </ul>
        </section>

        <section style={{ minWidth: '18rem', flex: 2 }}>
          <h4 style={{ margin: '0.25rem 0' }}>Solver runs ({runs.length})</h4>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.85rem', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ borderBottom: '1px solid #888', textAlign: 'left' }}>game</th>
                <th style={{ borderBottom: '1px solid #888', textAlign: 'left' }}>sim</th>
                <th style={{ borderBottom: '1px solid #888', textAlign: 'right' }}>steps</th>
                <th style={{ borderBottom: '1px solid #888', textAlign: 'right' }}>surprise</th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(-8).reverse().map((r, i) => (
                <tr key={`${r.run_id}-${i}`}>
                  <td style={{ borderBottom: '1px solid #ddd' }}>
                    <code>{(r.game_id ?? '').slice(0, 14)}</code>
                  </td>
                  <td style={{ borderBottom: '1px solid #ddd' }}>{r.simulator ?? '?'}</td>
                  <td style={{ borderBottom: '1px solid #ddd', textAlign: 'right' }}>{r.steps ?? 0}</td>
                  <td style={{ borderBottom: '1px solid #ddd', textAlign: 'right' }}>
                    {r.mean_surprise != null ? r.mean_surprise.toFixed(2) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  )
}
