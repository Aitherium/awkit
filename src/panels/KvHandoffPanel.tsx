'use client'

import { useState, useEffect, useCallback } from 'react'

// ---------------------------------------------------------------------------
// kv-handoff — cross-model KV cache handoff.
// Lists which fleet model pairs can hand each other a KV cache (so the bigger
// model skips prefill) and judges one mapper pack: PASS only when its measured
// acceptance (top-1 agreement, NLL delta, sample size) clears the floors.
// Backed by the Genesis router /api/v1/kv-handoff/* (routers/kv_handoff.py).
// Read-only. A 503 from /pairs means "could not judge", never "no pairs".
// ---------------------------------------------------------------------------

interface PairRow {
  source: string
  target: string
  regime_flags?: string[]
}

interface PairsResponse {
  ok?: boolean
  measured_at?: string
  models?: string[]
  resolved?: string[]
  unresolved?: Record<string, string>
  eligible?: PairRow[]
  blocked_count?: number
  blocked_summary?: Record<string, number>
}

interface VerdictCheck {
  rule: string
  ok: boolean
  detail: string
}

interface VerdictResponse {
  ok?: boolean
  pack?: string
  verdict?: 'PASS' | 'REFUSED' | string
  refused_by?: string | null
  reason?: string | null
  source?: string
  target?: string
  acceptance?: Record<string, number | string> | null
  derived?: Record<string, number>
  floors?: Record<string, number>
  checks?: VerdictCheck[]
  error?: string
}

export default function KvHandoffPanel({ apiBase = '/api/v1/kv-handoff' }: { apiBase?: string }) {
  const [pairs, setPairs] = useState<PairsResponse | null>(null)
  const [error, setError] = useState('')
  const [pack, setPack] = useState('')
  const [verdict, setVerdict] = useState<VerdictResponse | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const resp = await fetch(`${apiBase}/pairs`)
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(json.detail ?? `HTTP ${resp.status}`)
      setPairs(json)
      setError('')
    } catch (e) {
      setError(`Pairs could not be judged: ${String(e)}`)
    }
  }, [apiBase])

  useEffect(() => {
    void load()
  }, [load])

  const judge = useCallback(async () => {
    const name = pack.trim()
    if (!name) return
    setBusy(true)
    try {
      const resp = await fetch(`${apiBase}/packs/verdict?path=${encodeURIComponent(name)}`)
      const json = await resp.json().catch(() => ({}))
      setVerdict(resp.ok ? json : { ok: false, error: json.detail ?? `HTTP ${resp.status}` })
    } catch (e) {
      setVerdict({ ok: false, error: String(e) })
    } finally {
      setBusy(false)
    }
  }, [apiBase, pack])

  const eligible = pairs?.eligible ?? []
  const blocked = Object.entries(pairs?.blocked_summary ?? {})
  const unresolved = Object.entries(pairs?.unresolved ?? {})

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0 }}>kv-handoff</h3>
        <span style={{ opacity: 0.7, fontSize: 13 }}>
          a pack never serves without measured acceptance
        </span>
        <button onClick={() => void load()} style={{ marginLeft: 'auto' }}>
          Refresh
        </button>
      </div>

      {error && <div style={{ color: '#e06c75' }}>{error}</div>}

      {pairs && (
        <div style={{ fontSize: 13 }}>
          <div style={{ opacity: 0.7 }}>
            geometry measured {pairs.measured_at || '?'} · {pairs.resolved?.length ?? 0}/
            {pairs.models?.length ?? 0} models resolved
          </div>
          <strong>Eligible pairs ({eligible.length})</strong>
          {eligible.length === 0 && <div style={{ opacity: 0.6 }}>none</div>}
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {eligible.map((r) => (
              <li key={`${r.source}->${r.target}`}>
                {r.source} → {r.target}
                {r.regime_flags && r.regime_flags.length > 0 ? ` (flags: ${r.regime_flags.length})` : ''}
              </li>
            ))}
          </ul>
          {blocked.length > 0 && (
            <div>
              <strong>Blocked ({pairs.blocked_count ?? 0})</strong>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {blocked.map(([label, n]) => (
                  <li key={label}>
                    {n} — {label}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {unresolved.length > 0 && (
            <div style={{ opacity: 0.7 }}>unresolved: {unresolved.map(([k]) => k).join(', ')}</div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          value={pack}
          onChange={(e) => setPack(e.target.value)}
          placeholder="pack name (under the packs root)"
          style={{ flex: 1 }}
        />
        <button disabled={busy || !pack.trim()} onClick={() => void judge()}>
          verdict
        </button>
      </div>

      {verdict && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          {verdict.error ? (
            <div style={{ color: '#e06c75' }}>{verdict.error}</div>
          ) : (
            <>
              <strong style={{ color: verdict.verdict === 'PASS' ? '#98c379' : '#e06c75' }}>
                {verdict.verdict} {verdict.pack}
              </strong>
              <div style={{ opacity: 0.7 }}>
                {verdict.source} → {verdict.target}
              </div>
              {verdict.refused_by && (
                <div>
                  refused by {verdict.refused_by}: {verdict.reason}
                </div>
              )}
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {(verdict.checks ?? []).map((c, i) => (
                  <li key={`${c.rule}-${i}`} style={{ color: c.ok ? undefined : '#e06c75' }}>
                    [{c.ok ? 'ok' : 'FAIL'}] {c.rule}: {c.detail}
                  </li>
                ))}
              </ul>
              {Object.entries(verdict.derived ?? {}).map(([k, v]) => (
                <div key={k} style={{ opacity: 0.8 }}>
                  {k}: {v}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
