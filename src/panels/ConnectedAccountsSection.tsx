'use client'

/**
 * ConnectedAccountsSection -- the platform's real connectors, one click each.
 *
 * Customer report 2026-10-20: "the data sources tab doesn't work -- we need
 * proper connectors like perplexity has". The data-sources wizard only offered
 * paste-a-password / paste-a-JSON forms. This section lists every connector the
 * platform offers (Genesis /connectors/mine, reached through the tenant
 * backend's `/api/connections` credential hop) with the caller's own status, and
 * connects (OAuth via Identity's begin hop) or disconnects each one.
 *
 * A provider the platform has no credentials for says "not available yet" and
 * has no button. A read that fails says so, never an empty list.
 */

import { useCallback, useEffect, useState } from 'react'

export interface Connection {
  connector: string
  display_name: string
  oauth: boolean
  available: boolean | null
  status: string
  account: string
}

type Load = { state: 'loading' } | { state: 'ready'; canManage: boolean; rows: Connection[] } | { state: 'offline'; reason: string }

/** Leaving the page is a seam so a test can watch it. */
export const connectionsNav = {
  go(url: string) { window.location.assign(url) },
}

/** The `detail` of an error answer as one readable line, whatever shape it came in. */
export function errorLine(data: unknown, fallback: string): string {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const detail = d.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0] as Record<string, unknown> | undefined
    if (first && typeof first.msg === 'string') return first.msg
  }
  if (typeof d.error === 'string' && d.error.trim()) return d.error
  return fallback
}

/** Read a response body as JSON without throwing on an HTML/empty error page. */
export async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function rowsFrom(data: unknown): Connection[] | null {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  if (!Array.isArray(d.connectors)) return null
  return d.connectors
    .map((c) => {
      const r = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
      return {
        connector: typeof r.connector === 'string' ? r.connector : '',
        display_name: typeof r.display_name === 'string' && r.display_name ? r.display_name : String(r.connector || ''),
        oauth: r.oauth === true,
        available: typeof r.available === 'boolean' ? r.available : null,
        status: typeof r.status === 'string' ? r.status : 'not_connected',
        account: typeof r.account === 'string' ? r.account : '',
      }
    })
    .filter((c) => c.connector)
}

const STATUS_TEXT: Record<string, string> = {
  connected: 'Connected',
  needs_reconnect: 'Needs reconnecting',
  disconnecting: 'Disconnecting',
  not_connected: 'Not connected',
}

export default function ConnectedAccountsSection({ apiBase = '/api' }: { apiBase?: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [busy, setBusy] = useState('')
  const [confirm, setConfirm] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/connections`, { cache: 'no-store', credentials: 'include' })
      const data = await readJson(res)
      const rows = res.ok ? rowsFrom(data) : null
      if (rows) {
        const canManage = (data as Record<string, unknown>).can_manage === true
        setLoad({ state: 'ready', canManage, rows })
      } else {
        setLoad({ state: 'offline', reason: errorLine(data, 'Your connections could not be read.') })
      }
    } catch {
      setLoad({ state: 'offline', reason: 'Your connections could not be read.' })
    }
  }, [apiBase])

  useEffect(() => { void refresh() }, [refresh])

  const post = async (url: string) => {
    try {
      const res = await fetch(url, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      return { ok: res.ok, status: res.status, data: await readJson(res) }
    } catch {
      return { ok: false, status: 0, data: null }
    }
  }

  const connect = async (id: string) => {
    setBusy(id); setNotice('')
    const r = await post(`${apiBase}/connections/${id}/start`)
    setBusy('')
    const url = (r.data as Record<string, unknown> | null)?.authorize_url
    if (r.ok && typeof url === 'string' && url.startsWith('https://')) {
      connectionsNav.go(url)
      return
    }
    setNotice(r.status === 409 ? 'This one is not available yet.'
      : errorLine(r.data, 'The connection could not be started.'))
  }

  const disconnect = async (id: string) => {
    if (confirm !== id) { setConfirm(id); return }
    setBusy(id); setConfirm(''); setNotice('')
    const r = await post(`${apiBase}/connections/${id}/disconnect`)
    setBusy('')
    setNotice(r.ok ? 'Disconnected.' : errorLine(r.data, 'It could not be disconnected. Try again.'))
    void refresh()
  }

  const row: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    padding: '0.75rem 1rem', border: '1px solid var(--glass-border)',
    borderRadius: 'var(--radius-md, 8px)', background: 'var(--bg-surface)',
  }
  const btn: React.CSSProperties = {
    padding: '0.4rem 1rem', borderRadius: 'var(--radius-sm, 4px)', cursor: 'pointer',
    fontSize: '0.8rem', fontWeight: 600, border: '1px solid var(--glass-border)',
    background: 'transparent', color: 'var(--text)',
  }

  return (
    <section data-testid="connected-accounts" style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8 }}>Connected accounts</h3>
      {notice ? <p role="status" data-testid="connected-accounts-notice" style={{ fontSize: '0.85rem', marginBottom: 8 }}>{notice}</p> : null}
      {load.state === 'loading' ? <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading...</p> : null}
      {load.state === 'offline' ? <p data-testid="connected-accounts-offline" style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{load.reason}</p> : null}
      {load.state === 'ready' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {load.rows.map((c) => {
            const on = c.status === 'connected' || c.status === 'needs_reconnect' || c.status === 'disconnecting'
            const canConnect = load.canManage && c.oauth && c.available === true
            return (
              <div key={c.connector} style={row} data-testid={`connection-${c.connector}`}>
                <div>
                  <div style={{ fontWeight: 500 }}>{c.display_name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {STATUS_TEXT[c.status] || 'Not connected'}{c.account ? ` - ${c.account}` : ''}
                    {!on && c.available === false ? ' - not available yet' : ''}
                  </div>
                </div>
                {on && load.canManage ? (
                  <button type="button" style={btn} disabled={busy === c.connector}
                    data-testid={`disconnect-${c.connector}`} onClick={() => void disconnect(c.connector)}>
                    {confirm === c.connector ? 'Confirm disconnect' : 'Disconnect'}
                  </button>
                ) : null}
                {(!on || c.status === 'needs_reconnect') && canConnect ? (
                  <button type="button" style={{ ...btn, background: 'var(--accent-primary)', color: '#fff', border: 'none' }}
                    disabled={busy === c.connector} data-testid={`connect-${c.connector}`}
                    onClick={() => void connect(c.connector)}>
                    {c.status === 'needs_reconnect' ? 'Reconnect' : 'Connect'}
                  </button>
                ) : null}
              </div>
            )
          })}
          {!load.canManage ? <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Only a workspace member with a full account can connect or disconnect.</p> : null}
        </div>
      ) : null}
    </section>
  )
}
