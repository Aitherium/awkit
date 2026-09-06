'use client'

import { useState, useEffect, useCallback } from 'react'
import ChannelManagementPanel from './ChannelManagementPanel'

interface Props { apiBase?: string }

interface UsageData {
  tokens: { used: number; limit: number; pct: number }
  dispatches: { used: number; limit: number; pct: number }
}

interface WorkspaceUser {
  id?: string; username?: string; email?: string; display_name?: string; role: string; nick?: string
}

interface ApiKey { id: string; name: string; prefix: string; created_at: string; last_used?: string }
interface AuditEntry { action_type: string; agent_id: string; timestamp: number; gate_decision: string }

type Section = 'usage' | 'users' | 'identity' | 'integrations' | 'keys' | 'audit' | 'branding' | 'channels'

export default function WorkspaceAdminPanel({ apiBase = '/api/platform' }: Props) {
  const [section, setSection] = useState<Section>('usage')
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [users, setUsers] = useState<WorkspaceUser[]>([])
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  // Invite
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviteStatus, setInviteStatus] = useState('')
  // Key gen
  const [newKeyName, setNewKeyName] = useState('')
  const [generatedKey, setGeneratedKey] = useState('')
  // Identity & Directory
  const [ldapStatus, setLdapStatus] = useState<'unknown' | 'configured' | 'not_configured'>('unknown')
  const [m365Status, setM365Status] = useState<{ configured: boolean; connected: boolean } | null>(null)
  const [dirMembers, setDirMembers] = useState<{ id: string; name: string; email: string; role: string; source?: string }[]>([])
  const [csvText, setCsvText] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const [importSource, setImportSource] = useState<'csv' | 'google' | 'microsoft'>('csv')
  const [idpCredentials, setIdpCredentials] = useState('')
  // IdP management (AitherIdentity as IdP for external services)
  const [idpTab, setIdpTab] = useState<'saml' | 'oidc'>('saml')
  const [samlSPs, setSamlSPs] = useState<{ sp_id: string; entity_id: string; name?: string; acs_url?: string }[]>([])
  const [oidcClients, setOidcClients] = useState<{ client_id: string; name?: string; redirect_uris?: string[] }[]>([])
  const [idpMetadataUrl, setIdpMetadataUrl] = useState('')
  const [idpHasKeypair, setIdpHasKeypair] = useState(false)
  // SP registration form
  const [newSpName, setNewSpName] = useState('')
  const [newSpEntityId, setNewSpEntityId] = useState('')
  const [newSpAcsUrl, setNewSpAcsUrl] = useState('')
  const [spRegStatus, setSpRegStatus] = useState('')
  // OIDC client registration form
  const [newOidcName, setNewOidcName] = useState('')
  const [newOidcRedirect, setNewOidcRedirect] = useState('')
  const [oidcRegResult, setOidcRegResult] = useState<{ client_id?: string; client_secret?: string } | null>(null)
  const [oidcRegStatus, setOidcRegStatus] = useState('')
  // Branding
  const [brandName, setBrandName] = useState('')
  const [brandColor, setBrandColor] = useState('#6366f1')
  const [brandSaving, setBrandSaving] = useState(false)
  const [brandStatus, setBrandStatus] = useState('')

  const fetchUsage = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/workspace/usage`)
      if (r.ok) setUsage(await r.json())
    } catch {}
  }, [apiBase])

  const fetchUsers = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/workspace/members`)
      if (r.ok) {
        const d = await r.json()
        setUsers(d.directory_users || d.online_users || d.users || [])
      }
    } catch {}
  }, [apiBase])

  const fetchKeys = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/workspace/keys`)
      if (r.ok) setKeys((await r.json()).keys || [])
    } catch { setKeys([]) }
  }, [apiBase])

  const fetchIdentity = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/m365/status')
      if (r.ok) setM365Status(await r.json())
    } catch {}
    // Check LDAP — if the endpoint exists, it's configured
    try {
      const r = await fetch('/api/auth/ldap/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      setLdapStatus(r.status === 501 ? 'not_configured' : 'configured')
    } catch { setLdapStatus('unknown') }
    // Fetch IdP status (SAML SPs + OIDC clients)
    try {
      const r = await fetch('/api/admin/saml-idp')
      if (r.ok) {
        const d = await r.json()
        setSamlSPs(d.service_providers || d.sps || [])
        setIdpHasKeypair(!!d.has_keypair || !!d.certificate)
        setIdpMetadataUrl(d.metadata_url || '')
      }
    } catch {}
    try {
      const r = await fetch('/api/admin/oidc')
      if (r.ok) {
        const d = await r.json()
        setOidcClients(d.clients || [])
      }
    } catch {}
  }, [apiBase])

  const fetchDirectory = useCallback(async () => {
    try {
      const r = await fetch('/api/directory/members')
      if (r.ok) {
        const d = await r.json()
        const items = d.data || d.items || d
        setDirMembers(Array.isArray(items) ? items.map((m: any) => ({
          id: m.id || '', name: m.data?.name || m.name || '', email: m.data?.email || m.email || '',
          role: m.data?.role || m.role || 'member', source: m.data?.source || '',
        })) : [])
      }
    } catch {}
  }, [])

  const fetchAudit = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/workspace/audit?limit=50`)
      if (r.ok) {
        const d = await r.json()
        setAudit(d.entries || d.trail || [])
      }
    } catch { setAudit([]) }
  }, [apiBase])

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchUsage(), fetchUsers()]).finally(() => setLoading(false))
  }, [fetchUsage, fetchUsers])

  useEffect(() => {
    if (section === 'keys') fetchKeys()
    if (section === 'audit') fetchAudit()
    if (section === 'identity') { fetchIdentity(); fetchDirectory() }
  }, [section, fetchKeys, fetchAudit, fetchIdentity, fetchDirectory])

  const invite = async () => {
    if (!inviteEmail) return
    setInviteStatus('Sending...')
    try {
      const r = await fetch(`${apiBase}/users/invite`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      })
      if (r.ok) { setInviteStatus('Invite sent!'); setInviteEmail('') }
      else setInviteStatus('Failed')
    } catch { setInviteStatus('Failed') }
    setTimeout(() => setInviteStatus(''), 3000)
  }

  const changeRole = async (username: string, newRole: string) => {
    await fetch(`${apiBase}/users/${username}/role`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    })
    fetchUsers()
  }

  const generateKey = async () => {
    if (!newKeyName) return
    try {
      const r = await fetch(`${apiBase}/workspace/keys`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName }),
      })
      if (r.ok) {
        const d = await r.json()
        setGeneratedKey(d.key || d.token || '')
        setNewKeyName('')
        fetchKeys()
      }
    } catch {}
  }

  const revokeKey = async (keyId: string) => {
    await fetch(`${apiBase}/workspace/keys/${keyId}`, { method: 'DELETE' })
    fetchKeys()
  }

  const saveBranding = async () => {
    setBrandSaving(true); setBrandStatus('')
    try {
      const r = await fetch(`${apiBase}/workspace/branding`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_name: brandName, primary_color: brandColor }),
      })
      setBrandStatus(r.ok ? 'Saved' : 'Failed')
    } catch { setBrandStatus('Failed') }
    finally { setBrandSaving(false); setTimeout(() => setBrandStatus(''), 3000) }
  }

  const sections: { id: Section; label: string }[] = [
    { id: 'usage', label: 'Usage' },
    { id: 'users', label: 'Users & Roles' },
    { id: 'channels', label: 'Channels' },
    { id: 'identity', label: 'Identity & Directory' },
    { id: 'integrations', label: 'Integrations' },
    { id: 'keys', label: 'API Keys' },
    { id: 'audit', label: 'Activity' },
    { id: 'branding', label: 'Branding' },
  ]

  return (
    <div style={{ padding: '1.5rem', maxWidth: 900 }}>
      <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1.25rem' }}>Workspace Settings</h2>

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {sections.map(s => (
          <button key={s.id} onClick={() => setSection(s.id)} style={{
            padding: '0.45rem 0.85rem', borderRadius: 'var(--radius, 6px)', fontSize: '0.8rem', fontWeight: 500,
            background: section === s.id ? 'var(--accent-primary, #6366f1)' : 'var(--bg-surface, #1a1a1a)',
            color: section === s.id ? 'var(--bg-deep, #000)' : 'var(--text-secondary, #aaa)',
            border: section === s.id ? 'none' : '1px solid var(--glass-border, #333)',
          }}>{s.label}</button>
        ))}
      </div>

      {/* Usage */}
      {section === 'usage' && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {loading ? <p style={{ color: 'var(--text-muted, #888)' }}>Loading...</p> : !usage ? (
            <p style={{ color: 'var(--text-muted, #888)' }}>Usage data unavailable (platform services may not be connected)</p>
          ) : (
            <>
              <UsageMeter label="Tokens (today)" used={usage.tokens.used} limit={usage.tokens.limit} pct={usage.tokens.pct} color="#06b6d4" />
              <UsageMeter label="Agent Dispatches (this hour)" used={usage.dispatches.used} limit={usage.dispatches.limit} pct={usage.dispatches.pct} color="#8b5cf6" />
            </>
          )}
        </div>
      )}

      {/* Users & Roles */}
      {section === 'users' && (
        <div>
          {/* Invite */}
          <div style={{ padding: '1rem', background: 'var(--bg-surface, #1a1a1a)', borderRadius: 'var(--radius, 6px)',
            border: '1px solid var(--glass-border, #333)', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Invite User</h3>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="email@company.com"
                onKeyDown={e => e.key === 'Enter' && invite()}
                style={inputStyle} />
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={{ ...inputStyle, width: 100 }}>
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
              <button onClick={invite} disabled={!inviteEmail} style={{
                padding: '0.5rem 1rem', background: 'var(--accent-primary, #6366f1)', color: 'var(--bg-deep, #000)',
                borderRadius: 'var(--radius, 6px)', fontSize: '0.8rem', fontWeight: 600, opacity: inviteEmail ? 1 : 0.4,
              }}>Invite</button>
            </div>
            {inviteStatus && <p style={{ fontSize: '0.75rem', color: 'var(--accent-green, #4ade80)', marginTop: '0.4rem' }}>{inviteStatus}</p>}
          </div>

          {/* User list with role dropdown */}
          {users.length === 0 ? (
            <p style={{ color: 'var(--text-muted, #888)', textAlign: 'center', padding: '2rem' }}>No workspace members found</p>
          ) : (
            <div style={{ display: 'grid', gap: '0.4rem' }}>
              {users.map((u, i) => (
                <div key={u.id || u.username || i} style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.85rem',
                  background: 'var(--bg-surface, #1a1a1a)', borderRadius: 'var(--radius, 6px)', border: '1px solid var(--glass-border, #333)',
                }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--bg-elevated, #222)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 600, flexShrink: 0 }}>
                    {(u.display_name || u.username || u.nick || '?').charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 500 }}>{u.display_name || u.username || u.nick}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)' }}>{u.email || ''}</div>
                  </div>
                  <select value={u.role} onChange={e => changeRole(u.username || u.nick || '', e.target.value)}
                    style={{ padding: '0.3rem 0.5rem', background: 'var(--bg-elevated, #222)', border: '1px solid var(--glass-border, #333)',
                      borderRadius: 4, fontSize: '0.7rem', color: 'var(--text-primary, #fff)' }}>
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Channels */}
      {section === 'channels' && (
        <ChannelManagementPanel apiBase="/api/relay/v1" />
      )}

      {/* Identity & Directory */}
      {section === 'identity' && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {/* Auth Providers */}
          <div style={{ padding: '1.25rem', background: 'var(--bg-surface, #1a1a1a)', borderRadius: 'var(--radius, 6px)', border: '1px solid var(--glass-border, #333)' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '1rem' }}>Authentication Providers</h3>
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              {/* Local Auth */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.85rem', background: 'var(--bg-elevated, #222)', borderRadius: 'var(--radius, 6px)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 500 }}>Email & Password</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)' }}>Built-in authentication (always active)</div>
                </div>
                <span style={{ fontSize: '0.7rem', color: '#4ade80', fontWeight: 500 }}>Active</span>
              </div>

              {/* LDAP/AD */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.85rem', background: 'var(--bg-elevated, #222)', borderRadius: 'var(--radius, 6px)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: ldapStatus === 'configured' ? '#4ade80' : '#888', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 500 }}>LDAP / Active Directory</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)' }}>
                    {ldapStatus === 'configured' ? 'Connected to directory server' : 'Configure via LDAP_URL, LDAP_BASE_DN env vars'}
                  </div>
                </div>
                <span style={{ fontSize: '0.7rem', color: ldapStatus === 'configured' ? '#4ade80' : 'var(--text-muted, #888)', fontWeight: 500 }}>
                  {ldapStatus === 'configured' ? 'Active' : ldapStatus === 'not_configured' ? 'Not Configured' : '...'}
                </span>
              </div>

              {/* Microsoft 365 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.85rem', background: 'var(--bg-elevated, #222)', borderRadius: 'var(--radius, 6px)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: m365Status?.connected ? '#4ade80' : m365Status?.configured ? '#fbbf24' : '#888', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 500 }}>Microsoft 365</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)' }}>
                    {m365Status?.connected ? 'Connected (Calendar, Email, OneDrive)' : m365Status?.configured ? 'Configured but not connected' : 'Configure via MICROSOFT_* env vars'}
                  </div>
                </div>
                {m365Status?.configured && !m365Status?.connected ? (
                  <button onClick={() => window.location.href = '/api/auth/m365/login'} style={{
                    padding: '0.35rem 0.7rem', background: 'var(--accent-primary, #6366f1)', color: 'var(--bg-deep, #000)',
                    borderRadius: 4, fontSize: '0.7rem', fontWeight: 600,
                  }}>Connect</button>
                ) : (
                  <span style={{ fontSize: '0.7rem', color: m365Status?.connected ? '#4ade80' : 'var(--text-muted, #888)', fontWeight: 500 }}>
                    {m365Status?.connected ? 'Connected' : 'Not Configured'}
                  </span>
                )}
              </div>

              {/* SAML SSO */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.85rem', background: 'var(--bg-elevated, #222)', borderRadius: 'var(--radius, 6px)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#888', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 500 }}>SAML 2.0 SSO</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)' }}>Enterprise single sign-on (configure via platform admin)</div>
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)', fontWeight: 500 }}>Platform Admin</span>
              </div>
            </div>
          </div>

          {/* IdP Management — AitherIdentity as IdP for external services */}
          <div style={{ padding: '1.25rem', background: 'var(--bg-surface, #1a1a1a)', borderRadius: 'var(--radius, 6px)', border: '1px solid var(--glass-border, #333)' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>SSO for Your Apps</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)', marginBottom: '1rem' }}>
              Register your external services so your team can SSO into them via this workspace.
            </p>

            {/* IdP metadata download */}
            {idpHasKeypair && (
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <a href={idpMetadataUrl || '/identity/idp/saml/metadata'} target="_blank" rel="noreferrer" style={{
                  padding: '0.4rem 0.75rem', background: 'var(--bg-elevated, #222)', border: '1px solid var(--glass-border, #333)',
                  borderRadius: 4, fontSize: '0.72rem', color: 'var(--accent-primary, #6366f1)', textDecoration: 'none',
                }}>Download SAML IdP Metadata XML</a>
                <button onClick={async () => {
                  try {
                    const r = await fetch('/api/admin/saml-idp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'github-config' }) })
                    if (r.ok) { const d = await r.json(); navigator.clipboard?.writeText(JSON.stringify(d, null, 2)); setSpRegStatus('GitHub config copied to clipboard') }
                  } catch {}
                  setTimeout(() => setSpRegStatus(''), 3000)
                }} style={{ padding: '0.4rem 0.75rem', background: 'var(--bg-elevated, #222)', border: '1px solid var(--glass-border, #333)', borderRadius: 4, fontSize: '0.72rem', color: 'var(--text-secondary, #aaa)' }}>Copy GitHub SAML Config</button>
              </div>
            )}
            {!idpHasKeypair && (
              <button onClick={async () => {
                try {
                  await fetch('/api/admin/saml-idp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate-keypair', common_name: 'AitherOS IdP', validity_years: 3 }) })
                  fetchIdentity()
                  setSpRegStatus('Signing keypair generated')
                } catch { setSpRegStatus('Failed to generate keypair') }
                setTimeout(() => setSpRegStatus(''), 3000)
              }} style={{ padding: '0.5rem 1rem', background: 'var(--accent-primary, #6366f1)', color: 'var(--bg-deep, #000)', borderRadius: 'var(--radius, 6px)', fontSize: '0.8rem', fontWeight: 600, marginBottom: '1rem' }}>Generate Signing Keypair</button>
            )}

            {/* SAML / OIDC tabs */}
            <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem' }}>
              {(['saml', 'oidc'] as const).map(t => (
                <button key={t} onClick={() => setIdpTab(t)} style={{
                  padding: '0.35rem 0.7rem', borderRadius: 4, fontSize: '0.75rem', fontWeight: 500,
                  background: idpTab === t ? 'var(--accent-primary, #6366f1)' : 'var(--bg-elevated, #222)',
                  color: idpTab === t ? 'var(--bg-deep, #000)' : 'var(--text-secondary, #aaa)',
                  border: idpTab === t ? 'none' : '1px solid var(--glass-border, #333)',
                }}>{t === 'saml' ? 'SAML Service Providers' : 'OIDC Clients'}</button>
              ))}
            </div>

            {idpTab === 'saml' && (
              <div>
                {/* Registered SPs */}
                {samlSPs.length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted, #888)', marginBottom: '0.4rem' }}>Registered Service Providers</div>
                    <div style={{ display: 'grid', gap: '0.3rem' }}>
                      {samlSPs.map(sp => (
                        <div key={sp.sp_id} style={{
                          display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0.75rem',
                          background: 'var(--bg-elevated, #222)', borderRadius: 4, fontSize: '0.78rem',
                        }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 500 }}>{sp.name || sp.sp_id}</div>
                            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted, #888)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sp.entity_id}</div>
                          </div>
                          <button onClick={async () => {
                            await fetch(`/api/admin/saml-idp?sp_id=${sp.sp_id}`, { method: 'DELETE' })
                            fetchIdentity()
                          }} style={{ padding: '0.25rem 0.5rem', background: 'transparent', color: 'var(--accent-coral, #f87171)', fontSize: '0.65rem', border: '1px solid var(--accent-coral, #f87171)', borderRadius: 4 }}>Remove</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Register new SP */}
                <div style={{ padding: '0.85rem', background: 'var(--bg-elevated, #222)', borderRadius: 'var(--radius, 6px)', border: '1px solid var(--glass-border, #333)' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.6rem' }}>Register Service Provider</div>
                  <div style={{ display: 'grid', gap: '0.4rem' }}>
                    <input value={newSpName} onChange={e => setNewSpName(e.target.value)} placeholder="Display name (e.g. Jira, Slack)"
                      style={{ ...inputStyle, fontSize: '0.78rem' }} />
                    <input value={newSpEntityId} onChange={e => setNewSpEntityId(e.target.value)} placeholder="Entity ID / Issuer (e.g. https://your-app.atlassian.net)"
                      style={{ ...inputStyle, fontSize: '0.78rem', fontFamily: 'monospace' }} />
                    <input value={newSpAcsUrl} onChange={e => setNewSpAcsUrl(e.target.value)} placeholder="ACS URL (e.g. https://your-app.atlassian.net/plugins/servlet/saml/auth)"
                      style={{ ...inputStyle, fontSize: '0.78rem', fontFamily: 'monospace' }} />
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button onClick={async () => {
                        if (!newSpEntityId || !newSpAcsUrl) { setSpRegStatus('Entity ID and ACS URL required'); return }
                        try {
                          const r = await fetch('/api/admin/saml-idp', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'register-sp', sp_id: newSpName?.toLowerCase().replace(/\s+/g, '-') || 'custom-sp', entity_id: newSpEntityId, acs_url: newSpAcsUrl, name: newSpName }) })
                          if (r.ok) { setSpRegStatus('SP registered'); setNewSpName(''); setNewSpEntityId(''); setNewSpAcsUrl(''); fetchIdentity() }
                          else { const d = await r.json(); setSpRegStatus(d.detail || 'Registration failed') }
                        } catch { setSpRegStatus('Registration failed') }
                        setTimeout(() => setSpRegStatus(''), 5000)
                      }} disabled={!newSpEntityId || !newSpAcsUrl} style={{
                        padding: '0.45rem 0.85rem', background: 'var(--accent-primary, #6366f1)', color: 'var(--bg-deep, #000)',
                        borderRadius: 4, fontSize: '0.75rem', fontWeight: 600, opacity: newSpEntityId && newSpAcsUrl ? 1 : 0.4,
                      }}>Register SP</button>
                      <button onClick={async () => {
                        try {
                          const r = await fetch('/api/admin/saml-idp', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'register-github', org_name: newSpName || 'my-org' }) })
                          if (r.ok) { setSpRegStatus('GitHub org registered'); fetchIdentity() }
                        } catch {}
                        setTimeout(() => setSpRegStatus(''), 3000)
                      }} style={{
                        padding: '0.45rem 0.85rem', background: 'var(--bg-deep, #0a0a0a)', color: 'var(--text-secondary, #aaa)',
                        borderRadius: 4, fontSize: '0.75rem', border: '1px solid var(--glass-border, #333)',
                      }}>GitHub One-Click</button>
                    </div>
                  </div>
                </div>
                {spRegStatus && <p style={{ fontSize: '0.72rem', color: spRegStatus.includes('fail') || spRegStatus.includes('required') ? 'var(--accent-coral, #f87171)' : 'var(--accent-green, #4ade80)', marginTop: '0.5rem' }}>{spRegStatus}</p>}
              </div>
            )}

            {idpTab === 'oidc' && (
              <div>
                {/* Registered OIDC Clients */}
                {oidcClients.length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted, #888)', marginBottom: '0.4rem' }}>Registered OIDC Clients</div>
                    <div style={{ display: 'grid', gap: '0.3rem' }}>
                      {oidcClients.map(c => (
                        <div key={c.client_id} style={{
                          display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0.75rem',
                          background: 'var(--bg-elevated, #222)', borderRadius: 4, fontSize: '0.78rem',
                        }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 500 }}>{c.name || c.client_id}</div>
                            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted, #888)', fontFamily: 'monospace' }}>client_id: {c.client_id}</div>
                          </div>
                          <button onClick={async () => {
                            await fetch(`/api/admin/oidc?client_id=${c.client_id}`, { method: 'DELETE' })
                            fetchIdentity()
                          }} style={{ padding: '0.25rem 0.5rem', background: 'transparent', color: 'var(--accent-coral, #f87171)', fontSize: '0.65rem', border: '1px solid var(--accent-coral, #f87171)', borderRadius: 4 }}>Remove</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Register new OIDC client */}
                <div style={{ padding: '0.85rem', background: 'var(--bg-elevated, #222)', borderRadius: 'var(--radius, 6px)', border: '1px solid var(--glass-border, #333)' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.6rem' }}>Register OIDC Client (Relying Party)</div>
                  <div style={{ display: 'grid', gap: '0.4rem' }}>
                    <input value={newOidcName} onChange={e => setNewOidcName(e.target.value)} placeholder="Client name (e.g. Internal Wiki)"
                      style={{ ...inputStyle, fontSize: '0.78rem' }} />
                    <input value={newOidcRedirect} onChange={e => setNewOidcRedirect(e.target.value)} placeholder="Redirect URI (e.g. https://wiki.internal/auth/callback)"
                      style={{ ...inputStyle, fontSize: '0.78rem', fontFamily: 'monospace' }} />
                    <button onClick={async () => {
                      if (!newOidcName || !newOidcRedirect) { setOidcRegStatus('Name and redirect URI required'); return }
                      try {
                        const r = await fetch('/api/admin/oidc', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ name: newOidcName, redirect_uris: [newOidcRedirect] }) })
                        if (r.ok) {
                          const d = await r.json()
                          setOidcRegResult({ client_id: d.client_id, client_secret: d.client_secret })
                          setOidcRegStatus('Client registered')
                          setNewOidcName(''); setNewOidcRedirect('')
                          fetchIdentity()
                        } else { const d = await r.json(); setOidcRegStatus(d.detail || 'Registration failed') }
                      } catch { setOidcRegStatus('Registration failed') }
                    }} disabled={!newOidcName || !newOidcRedirect} style={{
                      padding: '0.45rem 0.85rem', background: 'var(--accent-primary, #6366f1)', color: 'var(--bg-deep, #000)',
                      borderRadius: 4, fontSize: '0.75rem', fontWeight: 600, justifySelf: 'start', opacity: newOidcName && newOidcRedirect ? 1 : 0.4,
                    }}>Register Client</button>
                  </div>
                </div>

                {/* Show generated credentials */}
                {oidcRegResult && (
                  <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'var(--bg-deep, #0a0a0a)', borderRadius: 'var(--radius, 6px)', border: '1px solid var(--accent-green, #4ade80)' }}>
                    <p style={{ fontSize: '0.72rem', color: 'var(--accent-green, #4ade80)', fontWeight: 600, marginBottom: '0.4rem' }}>Client registered. Save these credentials now — the secret won't be shown again.</p>
                    <div style={{ fontSize: '0.75rem', fontFamily: 'monospace', display: 'grid', gap: '0.25rem' }}>
                      <div><span style={{ color: 'var(--text-muted, #888)' }}>client_id:</span> <span style={{ userSelect: 'all' }}>{oidcRegResult.client_id}</span></div>
                      <div><span style={{ color: 'var(--text-muted, #888)' }}>client_secret:</span> <span style={{ userSelect: 'all' }}>{oidcRegResult.client_secret}</span></div>
                      <div><span style={{ color: 'var(--text-muted, #888)' }}>issuer:</span> <span style={{ userSelect: 'all' }}>{window.location.origin}/identity</span></div>
                    </div>
                  </div>
                )}
                {oidcRegStatus && !oidcRegResult && <p style={{ fontSize: '0.72rem', color: oidcRegStatus.includes('fail') || oidcRegStatus.includes('required') ? 'var(--accent-coral, #f87171)' : 'var(--accent-green, #4ade80)', marginTop: '0.5rem' }}>{oidcRegStatus}</p>}
              </div>
            )}
          </div>

          {/* Directory Import */}
          <div style={{ padding: '1.25rem', background: 'var(--bg-surface, #1a1a1a)', borderRadius: 'var(--radius, 6px)', border: '1px solid var(--glass-border, #333)' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem' }}>Import Users</h3>
            <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem' }}>
              {(['csv', 'google', 'microsoft'] as const).map(s => (
                <button key={s} onClick={() => setImportSource(s)} style={{
                  padding: '0.35rem 0.7rem', borderRadius: 4, fontSize: '0.75rem', fontWeight: 500,
                  background: importSource === s ? 'var(--accent-primary, #6366f1)' : 'var(--bg-elevated, #222)',
                  color: importSource === s ? 'var(--bg-deep, #000)' : 'var(--text-secondary, #aaa)',
                  border: importSource === s ? 'none' : '1px solid var(--glass-border, #333)',
                }}>{s === 'csv' ? 'CSV Upload' : s === 'google' ? 'Google Workspace' : 'Microsoft Graph'}</button>
              ))}
            </div>

            {importSource === 'csv' ? (
              <div>
                <textarea value={csvText} onChange={e => setCsvText(e.target.value)} rows={5}
                  placeholder={'name,email,title,role,department\nJohn Smith,john@example.com,Engineer,member,Engineering'}
                  style={{ ...inputStyle, width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.75rem' }} />
                <button onClick={async () => {
                  if (!csvText.trim()) return
                  setImportStatus('Importing...')
                  try {
                    const r = await fetch('/api/directory/members/import-csv', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ csv_data: csvText }),
                    })
                    const d = await r.json()
                    setImportStatus(r.ok ? `Imported ${d.imported || 0} users` : d.detail || 'Failed')
                    if (r.ok) { setCsvText(''); fetchDirectory() }
                  } catch { setImportStatus('Import failed') }
                  setTimeout(() => setImportStatus(''), 5000)
                }} disabled={!csvText.trim()} style={{
                  marginTop: '0.5rem', padding: '0.5rem 1rem', background: 'var(--accent-primary, #6366f1)', color: 'var(--bg-deep, #000)',
                  borderRadius: 'var(--radius, 6px)', fontSize: '0.8rem', fontWeight: 600, opacity: csvText.trim() ? 1 : 0.4,
                }}>Import CSV</button>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)', marginBottom: '0.5rem' }}>
                  {importSource === 'google' ? 'Paste Google Workspace service account JSON:' : 'Paste Microsoft Graph app credentials JSON:'}
                </p>
                <textarea value={idpCredentials} onChange={e => setIdpCredentials(e.target.value)} rows={4}
                  placeholder='{"client_id": "...", "client_secret": "...", ...}'
                  style={{ ...inputStyle, width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.75rem' }} />
                <button onClick={async () => {
                  if (!idpCredentials.trim()) return
                  setImportStatus('Importing...')
                  try {
                    const r = await fetch('/api/directory/members/import-external', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        source: importSource === 'google' ? 'google_workspace' : 'microsoft_graph',
                        credentials_json: idpCredentials,
                        default_role: 'member',
                      }),
                    })
                    const d = await r.json()
                    setImportStatus(r.ok ? `Imported ${d.imported || 0} of ${d.total_found || 0} users` : d.detail || 'Failed')
                    if (r.ok) { setIdpCredentials(''); fetchDirectory() }
                  } catch { setImportStatus('Import failed') }
                  setTimeout(() => setImportStatus(''), 5000)
                }} disabled={!idpCredentials.trim()} style={{
                  marginTop: '0.5rem', padding: '0.5rem 1rem', background: 'var(--accent-primary, #6366f1)', color: 'var(--bg-deep, #000)',
                  borderRadius: 'var(--radius, 6px)', fontSize: '0.8rem', fontWeight: 600, opacity: idpCredentials.trim() ? 1 : 0.4,
                }}>Import from {importSource === 'google' ? 'Google Workspace' : 'Microsoft Graph'}</button>
              </div>
            )}
            {importStatus && <p style={{ fontSize: '0.75rem', color: importStatus.startsWith('Import') && !importStatus.includes('fail') ? 'var(--accent-green, #4ade80)' : 'var(--accent-coral, #f87171)', marginTop: '0.5rem' }}>{importStatus}</p>}
          </div>

          {/* Directory Members List */}
          <div style={{ padding: '1.25rem', background: 'var(--bg-surface, #1a1a1a)', borderRadius: 'var(--radius, 6px)', border: '1px solid var(--glass-border, #333)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 600 }}>Directory Members ({dirMembers.length})</h3>
              <button onClick={fetchDirectory} style={{ padding: '0.3rem 0.6rem', background: 'var(--bg-elevated, #222)', border: '1px solid var(--glass-border, #333)', borderRadius: 4, fontSize: '0.7rem', color: 'var(--text-secondary, #aaa)' }}>Refresh</button>
            </div>
            {dirMembers.length === 0 ? (
              <p style={{ color: 'var(--text-muted, #888)', textAlign: 'center', padding: '1.5rem', fontSize: '0.8rem' }}>No directory members yet. Import from CSV or an identity provider above.</p>
            ) : (
              <div style={{ display: 'grid', gap: '0.3rem', maxHeight: 300, overflowY: 'auto' }}>
                {dirMembers.map(m => (
                  <div key={m.id} style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem',
                    background: 'var(--bg-elevated, #222)', borderRadius: 4, fontSize: '0.78rem',
                  }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-deep, #0a0a0a)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 600, flexShrink: 0 }}>
                      {(m.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>{m.name}</div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted, #888)' }}>{m.email}</div>
                    </div>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted, #888)', padding: '0.15rem 0.4rem', background: 'var(--bg-surface, #1a1a1a)', borderRadius: 3 }}>{m.role}</span>
                    {m.source && <span style={{ fontSize: '0.6rem', color: 'var(--text-muted, #666)' }}>{m.source}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Integrations */}
      {section === 'integrations' && (
        <div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted, #888)', marginBottom: '1rem' }}>
            Enable integrations for your workspace. Each addon connects securely to external services.
          </p>
          <iframe src="/?section=integrations&embedded=true" style={{
            width: '100%', height: 500, border: 'none', borderRadius: 'var(--radius, 6px)',
          }} title="Integration Marketplace" />
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)', marginTop: '0.5rem' }}>
            Or manage via API: GET /api/addons/available, POST /api/addons/stripe/enable
          </p>
        </div>
      )}

      {/* API Keys */}
      {section === 'keys' && (
        <div>
          <div style={{ padding: '1rem', background: 'var(--bg-surface, #1a1a1a)', borderRadius: 'var(--radius, 6px)',
            border: '1px solid var(--glass-border, #333)', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Generate API Key</h3>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input value={newKeyName} onChange={e => setNewKeyName(e.target.value)} placeholder="Key name (e.g. 'CI Pipeline')"
                onKeyDown={e => e.key === 'Enter' && generateKey()} style={{ ...inputStyle, flex: 1 }} />
              <button onClick={generateKey} disabled={!newKeyName} style={{
                padding: '0.5rem 1rem', background: 'var(--accent-primary, #6366f1)', color: 'var(--bg-deep, #000)',
                borderRadius: 'var(--radius, 6px)', fontSize: '0.8rem', fontWeight: 600, opacity: newKeyName ? 1 : 0.4,
              }}>Generate</button>
            </div>
            {generatedKey && (
              <div style={{ marginTop: '0.75rem', padding: '0.6rem', background: 'var(--bg-deep, #0a0a0a)',
                borderRadius: 4, border: '1px solid var(--accent-green, #4ade80)' }}>
                <p style={{ fontSize: '0.7rem', color: 'var(--accent-green, #4ade80)', marginBottom: '0.3rem' }}>Key generated! Copy it now — it won't be shown again.</p>
                <code style={{ fontSize: '0.75rem', color: 'var(--text-primary, #fff)', userSelect: 'all', wordBreak: 'break-all' }}>{generatedKey}</code>
              </div>
            )}
          </div>

          {keys.length === 0 ? (
            <p style={{ color: 'var(--text-muted, #888)', textAlign: 'center', padding: '1.5rem', fontSize: '0.8rem' }}>No API keys yet</p>
          ) : (
            <div style={{ display: 'grid', gap: '0.3rem' }}>
              {keys.map(k => (
                <div key={k.id} style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.85rem',
                  background: 'var(--bg-surface, #1a1a1a)', borderRadius: 'var(--radius, 6px)', border: '1px solid var(--glass-border, #333)',
                }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>{k.name}</span>
                    <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--text-muted, #888)', fontFamily: 'monospace' }}>{k.prefix}...</span>
                  </div>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted, #888)' }}>{k.last_used ? `Used ${k.last_used}` : 'Never used'}</span>
                  <button onClick={() => revokeKey(k.id)} style={{
                    padding: '0.3rem 0.6rem', background: 'transparent', color: 'var(--accent-coral, #f87171)',
                    fontSize: '0.7rem', border: '1px solid var(--accent-coral, #f87171)', borderRadius: 4,
                  }}>Revoke</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Audit */}
      {section === 'audit' && (
        <div>
          {audit.length === 0 ? (
            <p style={{ color: 'var(--text-muted, #888)', textAlign: 'center', padding: '2rem', fontSize: '0.8rem' }}>No recent activity</p>
          ) : (
            <div style={{ display: 'grid', gap: '0.25rem' }}>
              {audit.map((e, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0.75rem',
                  background: 'var(--bg-surface, #1a1a1a)', borderRadius: 4, fontSize: '0.78rem',
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: e.gate_decision === 'ALLOW' ? '#4ade80' : e.gate_decision === 'DENY' ? '#f87171' : '#fbbf24' }} />
                  <span style={{ fontWeight: 500, color: 'var(--text-primary, #fff)', minWidth: 100 }}>{e.action_type}</span>
                  <span style={{ color: 'var(--text-muted, #888)' }}>{e.agent_id || '-'}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted, #888)' }}>
                    {e.timestamp ? new Date(e.timestamp * 1000).toLocaleString() : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Branding */}
      {section === 'branding' && (
        <div style={{ padding: '1.25rem', background: 'var(--bg-surface, #1a1a1a)', borderRadius: 'var(--radius, 6px)',
          border: '1px solid var(--glass-border, #333)' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '1rem' }}>Workspace Branding</h3>
          <div style={{ display: 'grid', gap: '0.75rem', maxWidth: 400 }}>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)', marginBottom: '0.25rem', display: 'block' }}>App Name</label>
              <input value={brandName} onChange={e => setBrandName(e.target.value)} placeholder="Your App Name" style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)', marginBottom: '0.25rem', display: 'block' }}>Primary Color</label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input type="color" value={brandColor} onChange={e => setBrandColor(e.target.value)}
                  style={{ width: 40, height: 32, border: 'none', borderRadius: 4, cursor: 'pointer' }} />
                <input value={brandColor} onChange={e => setBrandColor(e.target.value)}
                  style={{ ...inputStyle, width: 100, fontFamily: 'monospace' }} />
              </div>
            </div>
            <button onClick={saveBranding} disabled={brandSaving} style={{
              padding: '0.6rem 1.25rem', background: 'var(--accent-primary, #6366f1)', color: 'var(--bg-deep, #000)',
              borderRadius: 'var(--radius, 6px)', fontSize: '0.85rem', fontWeight: 600, justifySelf: 'start',
            }}>{brandSaving ? 'Saving...' : 'Save Branding'}</button>
            {brandStatus && <p style={{ fontSize: '0.75rem', color: brandStatus === 'Saved' ? 'var(--accent-green, #4ade80)' : 'var(--accent-coral, #f87171)' }}>{brandStatus}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function UsageMeter({ label, used, limit, pct, color }: { label: string; used: number; limit: number; pct: number; color: string }) {
  const barColor = pct >= 90 ? '#f87171' : pct >= 70 ? '#fbbf24' : color
  return (
    <div style={{ padding: '1rem', background: 'var(--bg-surface, #1a1a1a)', borderRadius: 'var(--radius, 6px)', border: '1px solid var(--glass-border, #333)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)' }}>
          {used >= 1000 ? `${(used / 1000).toFixed(0)}k` : used} / {limit >= 1000 ? `${(limit / 1000).toFixed(0)}k` : limit}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-elevated, #222)', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 4, background: barColor, width: `${Math.min(pct, 100)}%`, transition: 'width 0.3s' }} />
      </div>
      <div style={{ textAlign: 'right', fontSize: '0.65rem', color: 'var(--text-muted, #888)', marginTop: '0.25rem' }}>{pct}%</div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem', background: 'var(--bg-deep, #0a0a0a)',
  border: '1px solid var(--glass-border, #333)', borderRadius: 'var(--radius, 6px)',
  color: 'var(--text-primary, #fff)', fontSize: '0.82rem',
}
