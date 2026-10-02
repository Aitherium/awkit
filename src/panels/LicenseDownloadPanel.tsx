'use client'
/**
 * DownloadPanel -- exchange an appliance licence for its ISO download links.
 *
 * Paste the AITHER1 envelope or pick the .lic file, choose the asset, and the
 * panel calls POST {apiBase}/v1/licenses/download. It shows each part with its
 * size, the whole-image sha256 (from the release's SHA256SUMS), a countdown to
 * the ~5 minute link expiry, and the assemble + verify steps. Every refusal is a
 * named state (see download-client.ts), never an empty page.
 *
 * Vite-safe (no next/*), awkit-vars.css tokens only, light/dark via the tokens,
 * usable at 360 px. The licence text stays in component state only: it is never
 * written to storage, a URL or a log.
 */
import React, { useEffect, useMemo, useState } from 'react'
import {
  assembleInstructions,
  formatBytes,
  looksLikeEnvelope,
  normalizeLicense,
  requestDownload,
  type DownloadResult,
} from '../appliance/download-client'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface DownloadPanelProps {
  apiBase: string
  fetchImpl?: FetchLike
  defaultAsset?: string
  /** Assets offered in the picker; the host names its own (defaults to one generic ISO entry). */
  assets?: { id: string; label: string }[]
  /** Test seam: the clock used for the expiry countdown (ms). */
  now?: () => number
  /** Test seam: render with a result already in hand. */
  initialResult?: DownloadResult
}

const DEFAULT_ASSET_LABEL = 'Appliance ISO (x86_64)'

const MESSAGES: Record<Exclude<DownloadResult['state'], 'ok'>, string> = {
  invalid: 'That licence is not valid. Paste the whole AITHER1… line from your licence file.',
  expired: 'This licence has expired. Renew it to download new media.',
  revoked: 'This licence has been revoked. Contact support if you think that is wrong.',
  'not-entitled': 'This licence does not include that download.',
  throttled: 'Too many download requests. Try again later.',
  unavailable: 'Downloads are temporarily unavailable. Nothing is wrong with your licence; try again shortly.',
  error: 'The download service could not be reached.',
}

const box: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-default)',
  borderRadius: 12,
  padding: 16,
  maxWidth: 760,
  width: '100%',
  boxSizing: 'border-box',
  fontSize: 14,
}
const input: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--bg-base)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  padding: 8,
  fontFamily: 'ui-monospace, monospace',
  fontSize: 12,
}
const button: React.CSSProperties = {
  background: 'var(--accent-primary)',
  color: 'var(--bg-deep)',
  border: 'none',
  borderRadius: 8,
  padding: '8px 16px',
  fontWeight: 600,
  cursor: 'pointer',
}
const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, monospace',
  fontSize: 12,
  overflowWrap: 'anywhere',
}

export function secondsLeft(expiresAt: number, nowMs: number): number {
  return Math.max(0, Math.floor(expiresAt - nowMs / 1000))
}

export default function DownloadPanel(props: DownloadPanelProps) {
  const { apiBase, fetchImpl, defaultAsset, initialResult } = props
  const assets = props.assets && props.assets.length
    ? props.assets
    : [{ id: defaultAsset ?? 'appliance-iso', label: DEFAULT_ASSET_LABEL }]
  const clock = props.now ?? (() => Date.now())
  const [license, setLicense] = useState('')
  const [asset, setAsset] = useState(defaultAsset ?? assets[0].id)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<DownloadResult | undefined>(initialResult)
  const [nowMs, setNowMs] = useState(clock())

  useEffect(() => {
    if (result?.state !== 'ok') return undefined
    const t = setInterval(() => setNowMs(clock()), 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  const shapeOk = useMemo(() => looksLikeEnvelope(license), [license])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 16384) {
      setResult({ state: 'invalid', status: 0, detail: 'That file is too large to be a licence.' })
      return
    }
    setLicense(normalizeLicense(await f.text()))
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!shapeOk || busy) return
    setBusy(true)
    try {
      setResult(await requestDownload(apiBase, { license, asset }, fetchImpl))
      setNowMs(clock())
    } finally {
      setBusy(false)
    }
  }

  const ok = result?.state === 'ok' ? result.data : undefined
  const left = ok ? secondsLeft(ok.expires_at, nowMs) : 0

  return (
    <section style={box} aria-label="Appliance download" data-testid="download-panel">
      <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Download your appliance</h2>
      <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)' }}>
        Your licence is the key. Links last about five minutes; request new ones any time.
      </p>
      <form onSubmit={submit}>
        <label htmlFor="aw-dl-license" style={{ display: 'block', marginBottom: 4 }}>
          Licence (AITHER1…)
        </label>
        <textarea
          id="aw-dl-license"
          style={{ ...input, minHeight: 80 }}
          value={license}
          onChange={(e) => setLicense(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="AITHER1.eyJ…"
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '8px 0' }}>
          <label style={{ color: 'var(--text-secondary)' }}>
            or load a .lic file{' '}
            <input type="file" accept=".lic,text/plain" onChange={onFile} aria-label="Licence file" />
          </label>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <label htmlFor="aw-dl-asset">Media</label>
          <select id="aw-dl-asset" style={{ ...input, width: 'auto' }} value={asset}
            onChange={(e) => setAsset(e.target.value)}>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
          <button type="submit" style={{ ...button, opacity: shapeOk && !busy ? 1 : 0.5 }}
            disabled={!shapeOk || busy}>
            {busy ? 'Checking…' : 'Get download links'}
          </button>
        </div>
        {license && !shapeOk ? (
          <p role="status" style={{ color: 'var(--accent-warn)', margin: '8px 0 0' }}>
            That does not look like an AITHER1 licence yet.
          </p>
        ) : null}
      </form>

      {result && result.state !== 'ok' ? (
        <div role="alert" data-state={result.state}
          style={{ marginTop: 12, padding: 12, borderRadius: 8, border: '1px solid var(--accent-danger)' }}>
          <strong>{MESSAGES[result.state]}</strong>
          {result.state === 'throttled' && result.retryAfter ? (
            <div>Retry in about {Math.ceil(result.retryAfter / 60)} min.</div>
          ) : null}
          {result.code ? <div style={{ ...mono, color: 'var(--text-muted)' }}>code: {result.code}</div> : null}
        </div>
      ) : null}

      {ok ? (
        <div data-state="ok" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <span>Release <strong>{ok.release_tag}</strong></span>
            <span>{ok.filename} · {formatBytes(ok.size)}</span>
            <span data-testid="expiry" style={{ color: left > 0 ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
              {left > 0 ? `links expire in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'links expired — request new ones'}
            </span>
          </div>
          <div style={{ margin: '8px 0' }}>
            sha256 <span style={mono} data-testid="sha256">{ok.sha256}</span>
          </div>
          <ol style={{ paddingLeft: 20, margin: '8px 0' }}>
            {ok.parts.map((p) => (
              <li key={p.name}>
                {left > 0 ? <a href={p.url} rel="noopener noreferrer" download={p.name}>{p.name}</a> : <span>{p.name}</span>}
                {' '}<span style={{ color: 'var(--text-muted)' }}>{formatBytes(p.size)}</span>
              </li>
            ))}
            {ok.extras.map((x) => (
              <li key={x.name}>
                {left > 0 ? <a href={x.url} rel="noopener noreferrer" download={x.name}>{x.name}</a> : <span>{x.name}</span>}
              </li>
            ))}
          </ol>
          <pre style={{ ...mono, background: 'var(--bg-base)', padding: 8, borderRadius: 8, whiteSpace: 'pre-wrap' }}>
            {assembleInstructions(ok).join('\n')}
          </pre>
        </div>
      ) : null}
    </section>
  )
}
