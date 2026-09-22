'use client'

/**
 * Who gets in — invitations, grants, and the door's own history.
 *
 * Owner, 2026-09-18: measured that day, `/api/gate/invite`, `/revoke` and the
 * grant ledger had existed since the front door shipped and NO surface called
 * any of them. A workspace admin could let a colleague in only by hand-crafting
 * an API request, and could not answer "who did I let in?" at all — which is how
 * a revocation feature ends up never being used.
 *
 * Owner/admin only. The gate re-checks `door.invite` / `door.revoke` /
 * `door.audit.read` on every call through awbac (app/authz.py), so this gate is
 * UX, not security — a member simply sees the read-only half.
 */

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'

interface Grant {
  id: string
  uses: number
  who: string[]
  last_used_at: number | null
  revoked: boolean
  revoked_at: number | null
  revoked_reason: string
}

interface AuditEvent {
  ts: number
  event: string
  data: Record<string, unknown>
}

interface AuditHealth {
  available: boolean
  ok?: boolean
  anchored?: boolean
  records?: number
  problems?: string[]
  reason?: string
}

const when = (t: number | null | undefined) =>
  t ? new Date(t * 1000).toLocaleString() : '—'

/** What each door event means, in the words an operator would use. */
const EVENT_LABEL: Record<string, string> = {
  'door.admitted': 'admitted',
  'door.refused': 'refused',
  'door.invited': 'invited',
  'door.revoked': 'revoked',
  'door.policy.changed': 'doors changed',
  'device.refused': 'device refused',
}

export default function DoorPeoplePanel() {
  const { user } = useAuth()
  const role = (user as { role?: string } | null)?.role
  const isAdmin = role === 'admin' || role === 'owner'

  const [grants, setGrants] = useState<Grant[] | null>(null)
  const [events, setEvents] = useState<AuditEvent[] | null>(null)
  const [health, setHealth] = useState<AuditHealth | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [to, setTo] = useState('')
  const [uses, setUses] = useState(1)
  const [days, setDays] = useState(7)
  const [send, setSend] = useState(false)
  const [minted, setMinted] = useState<{ link: string; emailed: boolean } | null>(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const [g, a] = await Promise.all([
        fetch('/api/gate/grants', { credentials: 'include' }),
        fetch('/api/gate/audit?limit=50', { credentials: 'include' }),
      ])
      if (g.ok) setGrants((await g.json()).grants || [])
      if (a.ok) {
        const body = await a.json()
        setEvents(body.events || [])
        setHealth(body.health || null)
      }
      if (!g.ok && !a.ok) setError('You do not have access to this workspace’s door history.')
    } catch (e) {
      setError(`Could not read the door (${e instanceof Error ? e.message : 'error'}).`)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const invite = useCallback(async () => {
    if (!to.trim()) return
    setBusy(true); setError(''); setMinted(null)
    try {
      const r = await fetch('/api/gate/invite', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.trim(), uses, days, send }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body?.detail || body?.error || `HTTP ${r.status}`)
      // The LINK, never the raw invitation: the link is what a person is sent,
      // and showing the token separately invites pasting it somewhere public.
      setMinted({ link: body.link || '', emailed: !!body.emailed })
      setTo('')
      await load()
    } catch (e) {
      setError(`Invitation not created (${e instanceof Error ? e.message : 'error'}).`)
    } finally {
      setBusy(false)
    }
  }, [to, uses, days, send, load])

  const revoke = useCallback(async (id: string) => {
    setBusy(true); setError('')
    try {
      const r = await fetch('/api/gate/revoke', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitation_id: id, reason: 'revoked from the workspace' }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await load()
    } catch (e) {
      setError(`Not revoked (${e instanceof Error ? e.message : 'error'}).`)
    } finally {
      setBusy(false)
    }
  }, [load])

  const card: React.CSSProperties = {
    background: 'var(--bg-surface)', padding: '1rem', borderRadius: 'var(--radius)',
    border: '1px solid var(--glass-border)',
  }
  const input: React.CSSProperties = {
    padding: '0.4rem 0.6rem', borderRadius: 'var(--radius)',
    border: '1px solid var(--glass-border)', background: 'transparent',
    color: 'inherit', fontSize: '0.85rem',
  }

  return (
    <section style={{ marginBottom: '2rem' }} data-testid="door-people-panel">
      <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.25rem', color: 'var(--text-secondary)' }}>
        Who gets in
      </h3>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        Invitations name one person, so forwarding one stops working. Revoking the one you
        regret does not revoke anyone else&apos;s.
      </p>

      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        {error && <div style={{ fontSize: '0.85rem', color: 'var(--accent-coral)' }}>{error}</div>}

        {isAdmin && (
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.35rem' }}>Invite someone</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
              <input
                value={to}
                onChange={e => setTo(e.target.value)}
                placeholder="their email address"
                aria-label="Invite email"
                style={{ ...input, flex: '1 1 220px' }}
              />
              <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                uses{' '}
                <input type="number" min={1} max={100} value={uses}
                  onChange={e => setUses(Math.max(1, Number(e.target.value) || 1))}
                  aria-label="Uses" style={{ ...input, width: 64 }} />
              </label>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                days{' '}
                <input type="number" min={1} max={365} value={days}
                  onChange={e => setDays(Math.max(1, Number(e.target.value) || 1))}
                  aria-label="Days" style={{ ...input, width: 64 }} />
              </label>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                <input type="checkbox" checked={send} onChange={e => setSend(e.target.checked)} aria-label="Email it" />
                email it
              </label>
              <button
                type="button" disabled={busy || !to.trim()} onClick={() => void invite()}
                style={{ padding: '0.4rem 0.9rem', borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)',
                  background: 'var(--accent-primary, #22d3ee)', color: '#04060c', fontWeight: 600, fontSize: '0.8rem' }}
              >
                Invite
              </button>
            </div>
            {minted && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.78rem' }}>
                {minted.emailed ? 'Sent. ' : 'Not emailed — send this link yourself: '}
                <code style={{ wordBreak: 'break-all', color: 'var(--text-secondary)' }}>{minted.link}</code>
              </div>
            )}
          </div>
        )}

        <div>
          <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.35rem' }}>Invitations in use</div>
          {!grants && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>loading…</div>}
          {grants && !grants.length && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Nobody has used an invitation yet.
            </div>
          )}
          {grants && grants.map(g => (
            <div key={g.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', fontSize: '0.8rem', padding: '0.25rem 0', borderBottom: '1px solid var(--glass-border)' }}>
              <code style={{ color: 'var(--text-muted)' }}>{g.id.slice(0, 12)}</code>
              <span>{g.who.length ? g.who.join(', ') : '—'}</span>
              <span style={{ color: 'var(--text-muted)' }}>{g.uses} use{g.uses === 1 ? '' : 's'}</span>
              <span style={{ color: 'var(--text-muted)' }}>{when(g.last_used_at)}</span>
              {g.revoked ? (
                <span style={{ color: 'var(--accent-coral)' }}>revoked{g.revoked_reason ? ` — ${g.revoked_reason}` : ''}</span>
              ) : isAdmin ? (
                <button type="button" disabled={busy} onClick={() => void revoke(g.id)}
                  style={{ marginLeft: 'auto', padding: '0.2rem 0.6rem', borderRadius: 'var(--radius)',
                    border: '1px solid var(--glass-border)', background: 'transparent', color: 'var(--accent-coral)', fontSize: '0.75rem' }}>
                  Revoke
                </button>
              ) : null}
            </div>
          ))}
        </div>

        <div>
          <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.35rem' }}>
            Door history
            {health && health.available && (
              <span style={{ marginLeft: '0.5rem', fontSize: '0.72rem', color: health.ok && health.anchored ? 'var(--accent-green)' : 'var(--accent-coral)' }}>
                {health.ok
                  ? (health.anchored ? 'chain verified' : 'chain intact, truncation NOT checked')
                  : `chain broken${health.problems?.length ? `: ${health.problems[0]}` : ''}`}
              </span>
            )}
          </div>
          {!events && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>loading…</div>}
          {events && !events.length && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Nothing has happened at this door yet.</div>
          )}
          {events && [...events].reverse().map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.6rem', fontSize: '0.78rem', padding: '0.15rem 0' }}>
              <span style={{ color: 'var(--text-muted)', minWidth: 140 }}>{when(e.ts)}</span>
              <span style={{ fontWeight: 600, minWidth: 110 }}>{EVENT_LABEL[e.event] || e.event}</span>
              <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-word' }}>
                {String((e.data as { subject?: string })?.subject || '')}
                {(e.data as { invited?: string })?.invited ? ` → ${(e.data as { invited?: string }).invited}` : ''}
                {(e.data as { reason?: string })?.reason ? ` (${(e.data as { reason?: string }).reason})` : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
