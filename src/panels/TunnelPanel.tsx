'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * AitherTunnel panel -- the product's layer-5 surface in awkit.
 *
 * Read-only view over the Veil proxy `GET /api/tunnel?endpoint=<name>`, which
 * forwards the signed-in user's credential to AitherTunnel (:8310). The service
 * decides what the caller may see; a 401/403 is shown as-is, never hidden.
 * Writes (expose / retire a public hostname) are deliberately NOT here: they go
 * through the gated awrun `tunnel` queue (`awrun:submit:tunnel`), because a public
 * hostname is perimeter.
 */
const VIEWS = ['status', 'routes', 'peers', 'forwards', 'health'] as const
type View = (typeof VIEWS)[number]

export default function TunnelPanel({ apiBase = '/api/tunnel' }: { apiBase?: string }) {
  const [view, setView] = useState<View>('status')
  const [body, setBody] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    async (which: View) => {
      setBusy(true)
      setError('')
      try {
        const res = await fetch(`${apiBase}?endpoint=${encodeURIComponent(which)}`, {
          credentials: 'include',
        })
        const text = await res.text()
        if (!res.ok) {
          setBody('')
          setError(`${res.status}: ${text.slice(0, 500)}`)
          return
        }
        try {
          setBody(JSON.stringify(JSON.parse(text), null, 2))
        } catch {
          setBody(text)
        }
      } catch (e) {
        setBody('')
        setError(`Tunnel service unreachable: ${(e as Error).message}`)
      } finally {
        setBusy(false)
      }
    },
    [apiBase],
  )

  useEffect(() => {
    void load(view)
  }, [view, load])

  return (
    <div style={{ padding: 16, fontFamily: 'sans-serif' }}>
      <h2>AitherTunnel</h2>
      <p>
        Public hostnames, peers and port forwards served by the platform tunnel.
        Exposing or retiring a hostname is an operator action queued through
        <code> awrun submit --kind tunnel</code>.
      </p>
      <div style={{ display: 'flex', gap: 8, margin: '12px 0', flexWrap: 'wrap' }}>
        {VIEWS.map((v) => (
          <button key={v} disabled={busy} aria-pressed={v === view} onClick={() => setView(v)}>
            {v}
          </button>
        ))}
        <button disabled={busy} onClick={() => void load(view)}>
          Refresh
        </button>
      </div>
      {error && (
        <div role="alert" style={{ color: '#b00020', margin: '8px 0' }}>
          {error}
        </div>
      )}
      {body && (
        <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, overflowX: 'auto' }}>
          {body}
        </pre>
      )}
    </div>
  )
}
