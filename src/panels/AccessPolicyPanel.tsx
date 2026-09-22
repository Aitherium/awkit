'use client'

/**
 * Access & sign-in — which doors this workspace's front door offers.
 *
 * The lock screen on <tenant>.aitherium.com draws ONLY the doors this panel
 * turns on (`GET /api/gate/status` → `doors`). Owner/admin only: the backend
 * re-checks the session on every PUT (this gate is UX, not security), and a
 * member sees the read-only state so they can tell an admin what to change.
 *
 * Owner, 2026-09-18: "there shouldn't be guest access, or it should be
 * configurable from the workspace admins in the app". This is that switch.
 */

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getApiBase } from '../lib/apiBase'

interface Doors {
  identity: boolean
  invitation: boolean
  boot_code: boolean
  guest: boolean
  device_session: boolean
}

interface Policy {
  doors: Doors
  allowed_domains: string[]
  human_check: boolean
  updated_at: number | null
  updated_by: string
  advertised?: Record<string, boolean>
  invitation_gate_built?: boolean
}

const DOOR_COPY: { key: keyof Doors; label: string; help: string }[] = [
  { key: 'identity', label: 'Sign in with AitherIdentity',
    help: 'The centre tile. Employees sign in with the account they already have (magic link, code or passkey).' },
  { key: 'invitation', label: 'Invitations (awnboard)',
    help: 'A named, signed invitation lets one person in without a platform account. Needs an invitation secret on this deployment.' },
  { key: 'guest', label: 'Guest access',
    help: 'Anyone can look around with no account. Off by default on a workspace.' },
  { key: 'device_session', label: 'Continue from this device',
    help: 'Offer "continue as <name>" when a local Aitherium node on the visitor\'s machine is already signed in.' },
  { key: 'boot_code', label: 'Boot codes',
    help: 'Stored, but not offered: this workspace backend does not serve a boot-code door yet.' },
]

export default function AccessPolicyPanel() {
  const { user } = useAuth()
  const role = (user as { role?: string } | null)?.role
  const isAdmin = role === 'admin' || role === 'owner'
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [domains, setDomains] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      // Admins read the STORED policy; members read the public offer.
      const r = await fetch(isAdmin ? '/api/gate/policy' : '/api/gate/status', { credentials: 'include' })
      if (!r.ok) throw new Error(`${r.status}`)
      const body = await r.json()
      const p: Policy = isAdmin
        ? body
        : { doors: body.doors, allowed_domains: body.allowed_domains || [], human_check: !!body.doors?.human_check, updated_at: null, updated_by: '' }
      setPolicy(p)
      setDomains((p.allowed_domains || []).join(', '))
    } catch (e) {
      setError(`Could not read the front-door policy (${e instanceof Error ? e.message : 'error'}).`)
    }
  }, [isAdmin])

  useEffect(() => { void load() }, [load])

  const save = useCallback(async (next: Partial<Doors>, nextDomains?: string) => {
    if (!isAdmin || !policy) return
    setBusy(true); setError(''); setSaved(false)
    try {
      const payload: { doors: Doors; allowed_domains?: string[] } = { doors: { ...policy.doors, ...next } }
      if (nextDomains !== undefined) {
        payload.allowed_domains = nextDomains.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
      }
      const r = await fetch(`${getApiBase()}/api/gate/policy`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!r.ok) throw new Error(r.status === 403 ? 'admin only' : `${r.status}`)
      const body: Policy = await r.json()
      setPolicy(body)
      setDomains((body.allowed_domains || []).join(', '))
      setSaved(true)
    } catch (e) {
      setError(`Not saved (${e instanceof Error ? e.message : 'error'}).`)
    } finally {
      setBusy(false)
    }
  }, [isAdmin, policy])

  const card: React.CSSProperties = {
    background: 'var(--bg-surface)', padding: '1rem', borderRadius: 'var(--radius)',
    border: '1px solid var(--glass-border)',
  }

  return (
    <section style={{ marginBottom: '2rem' }} data-testid="access-policy-panel">
      <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--text-secondary)' }}>
        Access &amp; sign-in
      </h3>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        Which doors the front door of this workspace offers. {isAdmin ? 'Changes apply on the next visit to the lock screen.' : 'Only an owner or admin can change these.'}
      </p>
      <div style={card}>
        {!policy && !error && <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>loading…</div>}
        {error && <div style={{ fontSize: '0.85rem', color: 'var(--accent-coral)' }}>{error}</div>}
        {policy && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {DOOR_COPY.map(({ key, label, help }) => {
              const on = !!policy.doors?.[key]
              const offered = policy.advertised ? !!policy.advertised[key] : on
              return (
                <label key={key} style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: '0.5rem', alignItems: 'start', fontSize: '0.85rem', cursor: isAdmin ? 'pointer' : 'default' }}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!isAdmin || busy}
                    onChange={e => void save({ [key]: e.target.checked } as Partial<Doors>)}
                    aria-label={label}
                    data-testid={`door-${key}`}
                  />
                  <span>
                    <span style={{ fontWeight: 600 }}>{label}</span>
                    {on && !offered && (
                      <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--accent-coral)' }}>
                        on, but not offered — {key === 'invitation' ? 'no invitation secret is configured' : 'no door served by this backend'}
                      </span>
                    )}
                    <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.78rem' }}>{help}</span>
                  </span>
                </label>
              )
            })}

            <div style={{ fontSize: '0.85rem' }}>
              <div style={{ fontWeight: 600 }}>Who may sign in</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '0.35rem' }}>
                Email domains allowed through AitherIdentity, comma-separated. Empty = anyone this workspace's tenant admits.
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  value={domains}
                  onChange={e => setDomains(e.target.value)}
                  disabled={!isAdmin || busy}
                  placeholder="example.com, aitherium.com"
                  aria-label="Allowed email domains"
                  style={{ flex: 1, padding: '0.4rem 0.6rem', borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)', background: 'transparent', color: 'inherit', fontSize: '0.85rem' }}
                />
                {isAdmin && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void save({}, domains)}
                    style={{ padding: '0.4rem 0.8rem', borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)', background: 'var(--accent-primary, #22d3ee)', color: '#04060c', fontWeight: 600, fontSize: '0.8rem' }}
                  >
                    Save
                  </button>
                )}
              </div>
            </div>

            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {policy.human_check ? 'Human check (awnest) is ON for invitations. ' : ''}
              {policy.updated_at ? `Last changed ${new Date(policy.updated_at * 1000).toLocaleString()}${policy.updated_by ? ` by ${policy.updated_by}` : ''}.` : 'Defaults — never changed.'}
              {saved ? ' Saved.' : ''}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
