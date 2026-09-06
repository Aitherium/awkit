'use client'

import { useState, useEffect, useCallback } from 'react'

// ---------------------------------------------------------------------------
// awrtifact — the artifact release store panel.
// Specs (what the store holds) + live verify + fetch URLs. The serving
// surface is the generated Worker at artifact.aitherium.com; this panel is
// the control-plane view via the Genesis router.
// ---------------------------------------------------------------------------

interface StoreInfo {
  name?: string
  repo?: string
  mirror_host?: string
}

interface ArtifactSummary {
  name: string
  release?: string
  total: number
  parts: number
}

interface SpecsResponse {
  store?: StoreInfo
  artifacts?: ArtifactSummary[]
}

interface VerifyResponse {
  name?: string
  ok?: boolean
  checks?: { check: string; ok: boolean; detail?: string }[]
}

export default function AwrtifactPanel({ apiBase = '/api/v1/awrtifact' }: { apiBase?: string }) {
  const [specs, setSpecs] = useState<SpecsResponse | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')
  const [verify, setVerify] = useState<VerifyResponse | null>(null)
  const [verifyBusy, setVerifyBusy] = useState(false)
  const [fetchUrl, setFetchUrl] = useState('')
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const resp = await fetch(`${apiBase}/specs`)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      setSpecs(await resp.json())
      setError('')
    } catch (e) {
      setError(`Cannot reach the awrtifact router: ${String(e)}`)
    }
  }, [apiBase])

  useEffect(() => {
    void load()
  }, [load])

  const runVerify = useCallback(
    async (name: string) => {
      setVerifyBusy(true)
      setVerify(null)
      try {
        const resp = await fetch(`${apiBase}/specs/${encodeURIComponent(name)}/verify`)
        setVerify(await resp.json())
      } catch (e) {
        setVerify({ ok: false, checks: [{ check: 'probe', ok: false, detail: String(e) }] })
      } finally {
        setVerifyBusy(false)
      }
    },
    [apiBase],
  )

  const mintUrl = useCallback(
    async (name: string) => {
      try {
        const resp = await fetch(`${apiBase}/fetch-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        })
        const data = await resp.json()
        setFetchUrl(data.url ?? JSON.stringify(data))
        setCopied(false)
      } catch (e) {
        setFetchUrl(`error: ${String(e)}`)
      }
    },
    [apiBase],
  )

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fetchUrl)
      setCopied(true)
    } catch {
      /* clipboard unavailable — the URL is visible to copy by hand */
    }
  }

  const artifacts = specs?.artifacts ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0 }}>Artifact Store</h3>
        <span style={{ opacity: 0.7, fontSize: 13 }}>
          {specs?.store?.repo ?? '…'} · {specs?.store?.mirror_host ?? ''}
        </span>
        <button onClick={() => void load()} style={{ marginLeft: 'auto' }}>
          Refresh
        </button>
      </div>

      {error && <div style={{ color: '#e06c75' }}>{error}</div>}

      {artifacts.length === 0 && !error && <div style={{ opacity: 0.6 }}>Store is empty.</div>}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th>artifact</th>
            <th>bytes</th>
            <th>parts</th>
            <th>release</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {artifacts.map((a) => (
            <tr key={a.name} style={{ borderTop: '1px solid rgba(127,127,127,0.25)' }}>
              <td>
                <button
                  onClick={() => {
                    setSelected(a.name)
                    void runVerify(a.name)
                  }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  {a.name}
                </button>
              </td>
              <td>{a.total.toLocaleString()}</td>
              <td>{a.parts}</td>
              <td>{a.release ?? '?'}</td>
              <td>
                <button onClick={() => void mintUrl(a.name)}>fetch URL</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {verifyBusy && <div style={{ opacity: 0.6 }}>verifying {selected}…</div>}
      {verify && (
        <div style={{ border: '1px solid rgba(127,127,127,0.3)', padding: 10, fontSize: 13 }}>
          <div>
            <b>{verify.name}</b>:{' '}
            <span style={{ color: verify.ok ? '#98c379' : '#e06c75' }}>
              {verify.ok ? 'OK' : 'FAILED'}
            </span>
          </div>
          {(verify.checks ?? []).map((c) => (
            <div key={c.check} style={{ opacity: 0.8 }}>
              {c.check}: {c.ok ? 'ok' : 'FAIL'} — {c.detail ?? ''}
            </div>
          ))}
        </div>
      )}

      {fetchUrl && (
        <div style={{ border: '1px solid rgba(127,127,127,0.3)', padding: 10, fontSize: 13 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={{ wordBreak: 'break-all', flex: 1 }}>{fetchUrl}</code>
            <button onClick={() => void copy()}>{copied ? 'copied' : 'copy'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
