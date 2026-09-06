'use client'

/**
 * CertificatesPanel — the client AitherCert never had.
 *
 * AitherCert (port 8113) has been a complete, tenant-scoped private CA the whole
 * time: create an authority, issue certificates from it, fetch the chain, revoke,
 * and list what is expiring. It had no way in from a browser — no genesis router,
 * and `services.yaml` records it with `widgets: []`. The absence was written down
 * in config and nobody read it.
 *
 * This talks to `/cert/*` (AitherGenesis/routers/cert_mgmt.py), which proxies to
 * AitherCert and derives the tenant from the AUTHENTICATED caller rather than
 * anything this component sends. Nothing here can select another tenant's
 * namespace, and that is deliberate: a CA that mints for whoever asks is worse
 * than no CA.
 *
 * Errors are SHOWN. The house idiom of `if (res.ok)` with no else turns a denied
 * call into an empty list, and on this surface "you have no certificates" and
 * "you were refused" must never look the same.
 */

import React, { useCallback, useEffect, useState } from 'react'

interface CertificatesPanelProps {
  /** Genesis prefix. Overridable so a tenant host can point at its own origin. */
  apiBase?: string
}

interface Authority {
  name?: string
  ca_name?: string
  subject?: string
  created?: string
  expires?: string
}

interface Expiring {
  common_name?: string
  ca_name?: string
  expires?: string
  days_remaining?: number
}

export default function CertificatesPanel({ apiBase = '/cert' }: CertificatesPanelProps) {
  const [authorities, setAuthorities] = useState<Authority[]>([])
  const [expiring, setExpiring] = useState<Expiring[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [chain, setChain] = useState<{ name: string; pem: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [caRes, expRes] = await Promise.all([
        fetch(`${apiBase}/authorities`, { credentials: 'include' }),
        fetch(`${apiBase}/expiring?days=30`, { credentials: 'include' }),
      ])
      if (!caRes.ok) {
        // Surfaced, not swallowed. 403 here means the caller carries no tenant,
        // which is a refusal to act unscoped rather than an empty account.
        setError(`Could not list authorities (HTTP ${caRes.status}).`)
        setAuthorities([])
      } else {
        const data = await caRes.json()
        setAuthorities(Array.isArray(data) ? data : (data.authorities ?? data.cas ?? []))
      }
      if (expRes.ok) {
        const data = await expRes.json()
        setExpiring(Array.isArray(data) ? data : (data.expiring ?? data.certificates ?? []))
      }
    } catch (e) {
      setError(`AitherCert is unreachable: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => { void load() }, [load])

  const fetchChain = async (name: string) => {
    setError(null)
    try {
      const res = await fetch(`${apiBase}/authorities/${encodeURIComponent(name)}/chain`, {
        credentials: 'include',
      })
      if (!res.ok) {
        setError(`Could not fetch the chain for ${name} (HTTP ${res.status}).`)
        return
      }
      const data = await res.json()
      setChain({ name, pem: data.chain ?? data.pem ?? JSON.stringify(data, null, 2) })
    } catch (e) {
      setError(`Could not fetch the chain: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Certificates</h2>
        <button type="button" onClick={() => void load()} disabled={loading}
                style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer' }}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div role="alert" style={{ padding: 10, borderRadius: 6, fontSize: 13,
                                   background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)' }}>
          {error}
        </div>
      )}

      <section>
        <h3 style={{ fontSize: 13, opacity: 0.75, margin: '0 0 8px' }}>
          Authorities {authorities.length > 0 && `(${authorities.length})`}
        </h3>
        {!loading && authorities.length === 0 && !error && (
          <p style={{ fontSize: 13, opacity: 0.7, margin: 0 }}>
            No certificate authorities yet. Creating one lets this workspace issue its own
            certificates and trust them across its machines.
          </p>
        )}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {authorities.map((ca, i) => {
            const name = ca.name ?? ca.ca_name ?? `authority-${i}`
            return (
              <li key={name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10,
                                      borderRadius: 8, border: '1px solid rgba(255,255,255,0.10)' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{name}</div>
                  {ca.subject && <div style={{ fontSize: 11, opacity: 0.65 }}>{ca.subject}</div>}
                </div>
                <button type="button" onClick={() => void fetchChain(name)}
                        style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer' }}>
                  Chain
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      {expiring.length > 0 && (
        <section>
          <h3 style={{ fontSize: 13, opacity: 0.75, margin: '0 0 8px' }}>Expiring within 30 days</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {expiring.map((c, i) => (
              <li key={`${c.common_name ?? i}`} style={{ fontSize: 12, display: 'flex', gap: 8 }}>
                <span>{c.common_name ?? 'certificate'}</span>
                <span style={{ opacity: 0.65 }}>
                  {c.days_remaining != null ? `${c.days_remaining}d left` : c.expires}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {chain && (
        <section>
          <h3 style={{ fontSize: 13, opacity: 0.75, margin: '0 0 8px' }}>Chain — {chain.name}</h3>
          <textarea readOnly value={chain.pem} rows={10}
                    style={{ width: '100%', fontFamily: 'monospace', fontSize: 11, padding: 8, borderRadius: 6 }} />
          <p style={{ fontSize: 11, opacity: 0.65, margin: '6px 0 0' }}>
            Install this chain on a machine to trust certificates issued by {chain.name}.
          </p>
        </section>
      )}
    </div>
  )
}
