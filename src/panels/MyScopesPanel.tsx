'use client'

/**
 * My Scopes — your own scopes beside your organization's.
 *
 * Lists the scopes you belong to (your organization, mirrored from its workspace
 * roster; your personal scope; family households and friends enclaves) and the
 * consent links between them, with grant and revoke. Leaving the organization never
 * touches the personal side: households, enclaves and the links between them stay.
 *
 * Backed by the Genesis router /api/scopes/* (routers/scopes.py, awscope). Every
 * call acts as the signed-in person; the server re-checks each scope id against
 * their own memberships.
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'

export interface ScopeMember {
  user_id: string
  role: string
  you?: boolean
}

export interface ScopeView {
  id: string
  kind: 'org' | 'team' | 'person' | 'household' | 'enclave' | 'workspace' | string
  name: string
  realm: 'company' | 'personal' | 'unfiled' | string
  role: string | null
  can_admin: boolean
  source: 'roster' | 'family' | 'self' | string
  family_workspace_id?: string
  members?: ScopeMember[]
}

export interface LinkView {
  id: string
  source: string
  target: string
  source_name: string
  target_name: string
  grants: string[]
  granted_by_me: boolean
  expires_at: number | null
  can_revoke: boolean
}

interface MeResponse {
  person_scope?: string
  scopes?: ScopeView[]
  links?: LinkView[]
  capabilities?: string[]
}

export interface MyScopesPanelProps {
  apiBase?: string
}

const KIND_LABEL: Record<string, string> = {
  org: 'Organization',
  team: 'Team',
  person: 'Personal',
  household: 'Household',
  enclave: 'Friends',
  workspace: 'Workspace',
}

const CAP_LABEL: Record<string, string> = {
  'calendar.read': 'Read calendar',
  'inbox.read': 'Read inbox',
  'todo.read': 'Read to-dos',
  'todo.write': 'Write to-dos',
  'context.read': 'Read context',
}

const card: CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius)',
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}
const muted: CSSProperties = { color: 'var(--text-muted)', fontSize: 12 }
const btn: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius)',
  color: 'var(--text-primary)',
  padding: '4px 10px',
  cursor: 'pointer',
  fontSize: 13,
}
const primaryBtn: CSSProperties = { ...btn, background: 'var(--accent-primary)', color: 'var(--bg-deep)' }
const input: CSSProperties = {
  background: 'var(--bg-deep)',
  border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius)',
  color: 'var(--text-primary)',
  padding: '4px 8px',
  fontSize: 13,
}

function realmBadge(realm: string) {
  const color = realm === 'personal' ? 'var(--accent-green)' : 'var(--text-secondary)'
  return (
    <span style={{ fontSize: 11, color, border: `1px solid ${color}`, borderRadius: 999, padding: '0 6px' }}>
      {realm === 'company' ? 'work' : realm}
    </span>
  )
}

export default function MyScopesPanel({ apiBase = '/api/scopes' }: MyScopesPanelProps) {
  const [data, setData] = useState<MeResponse | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const [caps, setCaps] = useState<string[]>([])
  const [inviteScope, setInviteScope] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [acceptCode, setAcceptCode] = useState('')

  const call = useCallback(
    async (path: string, method = 'GET', body?: object) => {
      const resp = await fetch(`${apiBase}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'include',
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(typeof json.detail === 'string' ? json.detail : `HTTP ${resp.status}`)
      return json
    },
    [apiBase],
  )

  const load = useCallback(async () => {
    try {
      setData(await call('/me'))
      setError('')
    } catch (e) {
      setError(`Could not load your scopes: ${String((e as Error).message ?? e)}`)
    }
  }, [call])

  useEffect(() => {
    void load()
  }, [load])

  const act = useCallback(
    async (fn: () => Promise<unknown>, done: string) => {
      setBusy(true)
      setNotice('')
      try {
        await fn()
        setNotice(done)
        await load()
      } catch (e) {
        setError(String((e as Error).message ?? e))
      } finally {
        setBusy(false)
      }
    },
    [load],
  )

  const scopes = data?.scopes ?? []
  const links = data?.links ?? []
  const capabilities = data?.capabilities ?? Object.keys(CAP_LABEL)
  const hasPerson = scopes.some((s) => s.kind === 'person')
  const adminScopes = useMemo(() => scopes.filter((s) => s.can_admin), [scopes])
  const invitable = useMemo(
    () => scopes.filter((s) => s.can_admin && (s.kind === 'household' || s.kind === 'enclave') && s.source !== 'family'),
    [scopes],
  )

  const grant = () =>
    act(
      () => call('/links', 'POST', { source_scope: source, target_scope: target, grants: caps }),
      'Shared.',
    )

  const invite = () =>
    act(async () => {
      const r = (await call(`/${encodeURIComponent(inviteScope)}/invites`, 'POST', { email: inviteEmail })) as {
        token?: string
      }
      // scope ids never contain ':' (awscope), so the first ':' splits the code.
      setInviteLink(r.token ? `${inviteScope}:${r.token}` : '')
      setInviteEmail('')
    }, 'Invite created. Send the code below to that address; it works once, for that address only.')

  const accept = () =>
    act(async () => {
      const code = acceptCode.trim()
      const cut = code.indexOf(':')
      if (cut < 1) throw new Error('That is not an invite code.')
      await call(`/${encodeURIComponent(code.slice(0, cut))}/invites/accept`, 'POST', { token: code.slice(cut + 1) })
      setAcceptCode('')
    }, 'Joined.')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, color: 'var(--text-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0 }}>My Scopes</h3>
        <span style={muted}>work and personal stay separate; you choose what crosses</span>
        <button style={{ ...btn, marginLeft: 'auto' }} onClick={() => void load()} disabled={busy}>
          Refresh
        </button>
      </div>

      {error && <div style={{ color: 'var(--accent-coral)', fontSize: 13 }}>{error}</div>}
      {notice && <div style={{ color: 'var(--accent-green)', fontSize: 13 }}>{notice}</div>}

      <section style={card}>
        <strong>Your scopes</strong>
        {scopes.length === 0 && <div style={muted}>Nothing yet.</div>}
        {scopes.map((s) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ minWidth: 92, ...muted }}>{KIND_LABEL[s.kind] ?? s.kind}</span>
            <span style={{ fontWeight: 600 }}>{s.name}</span>
            {realmBadge(s.realm)}
            <span style={muted}>
              {s.role ?? ''}
              {s.source === 'roster' ? ' · from your workspace roster' : ''}
              {s.source === 'family' ? ' · follows your family' : ''}
              {s.members ? ` · ${s.members.length} member${s.members.length === 1 ? '' : 's'}` : ''}
            </span>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          {!hasPerson && (
            <button style={primaryBtn} disabled={busy} onClick={() => void act(() => call('/me/person', 'POST'), 'Personal scope ready.')}>
              Create my personal scope
            </button>
          )}
          <input
            style={input}
            placeholder="Name"
            value={newName}
            maxLength={80}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            style={btn}
            disabled={busy}
            onClick={() => void act(() => call('/me/households', 'POST', { name: newName }), 'Household created.')}
          >
            New household
          </button>
          <button
            style={btn}
            disabled={busy}
            onClick={() => void act(() => call('/me/enclaves', 'POST', { name: newName }), 'Friends enclave created.')}
          >
            New friends enclave
          </button>
        </div>
      </section>

      <section style={card}>
        <strong>Shared between scopes</strong>
        {links.length === 0 && <div style={muted}>Nothing is shared across scopes.</div>}
        {links.map((l) => (
          <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
            <span>
              <strong>{l.source_name}</strong> → <strong>{l.target_name}</strong>
            </span>
            <span style={muted}>{l.grants.map((g) => CAP_LABEL[g] ?? g).join(', ')}</span>
            {l.expires_at && <span style={muted}>until {new Date(l.expires_at * 1000).toLocaleDateString()}</span>}
            {l.can_revoke && (
              <button
                style={{ ...btn, marginLeft: 'auto', color: 'var(--accent-coral)' }}
                disabled={busy}
                onClick={() => void act(() => call(`/links/${encodeURIComponent(l.id)}`, 'DELETE'), 'Revoked.')}
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </section>

      {adminScopes.length > 0 && (
        <section style={card}>
          <strong>Share</strong>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <select style={input} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">from…</option>
              {adminScopes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select style={input} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">with…</option>
              {scopes
                .filter((s) => s.id !== source)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 13 }}>
            {capabilities.map((c) => (
              <label key={c} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={caps.includes(c)}
                  onChange={(e) => setCaps(e.target.checked ? [...caps, c] : caps.filter((x) => x !== c))}
                />
                {CAP_LABEL[c] ?? c}
              </label>
            ))}
          </div>
          <div>
            <button style={primaryBtn} disabled={busy || !source || !target || caps.length === 0} onClick={() => void grant()}>
              Share
            </button>
          </div>
        </section>
      )}

      {invitable.length > 0 && (
        <section style={card}>
          <strong>Invite someone</strong>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <select style={input} value={inviteScope} onChange={(e) => setInviteScope(e.target.value)}>
              <option value="">to…</option>
              {invitable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              style={input}
              type="email"
              placeholder="their email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <button style={btn} disabled={busy || !inviteScope || !inviteEmail} onClick={() => void invite()}>
              Create invite
            </button>
          </div>
          {inviteLink && (
            <textarea readOnly value={inviteLink} rows={3} style={{ ...input, fontFamily: 'monospace', width: '100%' }} />
          )}
        </section>
      )}

      <section style={card}>
        <strong>Join with an invite</strong>
        <span style={muted}>Invites work for the verified email address they were sent to.</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            style={{ ...input, flex: 1 }}
            placeholder="paste the invite code"
            value={acceptCode}
            onChange={(e) => setAcceptCode(e.target.value)}
          />
          <button style={btn} disabled={busy || !acceptCode.trim()} onClick={() => void accept()}>
            Join
          </button>
        </div>
      </section>
    </div>
  )
}
