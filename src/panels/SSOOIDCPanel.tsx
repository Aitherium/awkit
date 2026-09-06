"use client"

/**
 * SSOOIDCPanel — a tenant configures its OWN upstream OIDC IdP (Microsoft
 * Entra ID or any OIDC issuer) for the AitherIdentity brokered SSO lane.
 *
 * WHY THIS EXISTS. The brokered upstream lane (`/auth/upstream/{tenant}/{idp}/
 * authorize` → callback → JIT provision → downstream code) is fully built and
 * E2E-verified, but a tenant could only configure it through the admin API —
 * that is a support ticket with extra steps, not self-service. This panel is
 * the self-service surface: it shows the exact values the customer pastes
 * into their Entra app registration (setup-info), lets them configure the
 * IdP, test the connectivity, toggle and delete — all through the
 * auth-forwarding Veil proxy (`/api/workspace/idp-config`).
 *
 * 🚨 SCOPE, the same rule as SSOSettingsPanel: this component NEVER sends a
 * tenant id. The server derives the tenant from the authenticated caller and
 * enforces the workspace-admin role + custom_sso entitlement; a caller-supplied
 * tenant id would be the exact shape that makes a tenant's SSO reconfigurable
 * by someone else. The client secret is write-only: it is sent once when the
 * configuration is created or rotated, and never read back.
 *
 * The proxy + backend shape (measured 2026-09-01):
 *   GET    /api/workspace/idp-config                     → status
 *   GET    /api/workspace/idp-config?target=setup-info   → paste-into-Entra values
 *   POST   /api/workspace/idp-config?action=configure-oidc → PUT {…} to identity
 *   POST   /api/workspace/idp-config?action=toggle-oidc
 *   POST   /api/workspace/idp-config?action=test         → IdP connectivity check
 *   DELETE /api/workspace/idp-config?target=oidc
 */

import React, { useCallback, useEffect, useState } from 'react'
import { getApiBase } from '../lib/apiBase'

export interface SSOOIDCPanelProps {
    /** Override the API base (tests, embedding). Defaults to the resolved one. */
    apiBase?: string
}

interface IdPStatus {
    enabled?: boolean
    provider_preset?: string
    display_name?: string
    issuer?: string
    client_id?: string
    scopes?: string[]
    require_email_domain_claim?: boolean
    require_email_verified?: boolean
    jit_provisioning?: boolean
    has_client_secret?: boolean
    [k: string]: unknown
}

interface SetupInfo {
    oidc_redirect_uri?: string
    saml_sp_entity_id?: string
    saml_acs_url?: string
    [k: string]: unknown
}

function useApi(apiBase?: string) {
    const base = apiBase ?? getApiBase()
    return useCallback(async (path: string, init?: RequestInit) => {
        const res = await fetch(`${base}${path}`, {
            headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
            ...init,
        })
        if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            throw new Error((body as any)?.detail || (body as any)?.error || `HTTP ${res.status}`)
        }
        return res.json()
    }, [base])
}

const FIELD_STYLE = 'w-full px-3 py-2 rounded border border-zinc-700 bg-zinc-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500'
const LABEL_STYLE = 'block text-xs font-medium text-zinc-400 mb-1'

export default function SSOOIDCPanel({ apiBase }: SSOOIDCPanelProps) {
    const api = useApi(apiBase)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [testing, setTesting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)

    const [status, setStatus] = useState<IdPStatus | null>(null)
    const [setup, setSetup] = useState<SetupInfo | null>(null)

    const [entraTenantId, setEntraTenantId] = useState('')
    const [clientId, setClientId] = useState('')
    const [clientSecret, setClientSecret] = useState('')
    const [displayName, setDisplayName] = useState('')
    const [domainClaim, setDomainClaim] = useState(true)
    const [enabled, setEnabled] = useState(false)
    const [entitled, setEntitled] = useState(true)

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const [s, si] = await Promise.all([
                api('/api/workspace/idp-config'),
                api('/api/workspace/idp-config?target=setup-info'),
            ])
            setStatus(s?.config || s || null)
            setSetup(si || null)
        } catch (e) {
            // First visit with no SSO configured is the NORMAL state; a
            // missing custom_sso entitlement is the other honest non-error.
            const msg = e instanceof Error ? e.message : String(e)
            if (/entitlement|not entitled|custom_sso/i.test(msg)) setEntitled(false)
            else if (!/404|not configured|no .*sso/i.test(msg)) setError(msg)
        } finally {
            setLoading(false)
        }
    }, [api])

    useEffect(() => { void load() }, [load])

    const configure = useCallback(async () => {
        setSaving(true); setError(null); setNotice(null)
        try {
            if (!clientId.trim()) throw new Error('Client ID is required')
            if (!clientSecret.trim() && !(status?.has_client_secret)) {
                throw new Error('Client secret is required (or leave blank to keep the existing one)')
            }
            if (domainClaim && !entraTenantId.trim()) {
                throw new Error('Entra tenant ID (directory GUID) is required')
            }
            const body: Record<string, unknown> = {
                provider_preset: 'entra_id',
                client_id: clientId.trim(),
                enabled,
                jit_provisioning: true,
                require_email_domain_claim: domainClaim,
                display_name: displayName.trim() || 'Microsoft Entra ID',
            }
            if (entraTenantId.trim()) body.entra_tenant_id = entraTenantId.trim()
            if (clientSecret.trim()) body.client_secret = clientSecret
            await api('/api/workspace/idp-config?action=configure-oidc', {
                method: 'POST',
                body: JSON.stringify(body),
            })
            setClientSecret('')
            setNotice('Saved. The configuration is ' + (enabled ? 'enabled' : 'disabled') + '.')
            await load()
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setSaving(false)
        }
    }, [api, clientId, clientSecret, displayName, domainClaim, enabled, entraTenantId, status, load])

    const runTest = useCallback(async () => {
        setTesting(true); setError(null); setNotice(null)
        try {
            const r = await api('/api/workspace/idp-config?action=test', { method: 'POST' })
            setNotice((r as any)?.detail || (r as any)?.message || 'Connectivity test passed.')
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setTesting(false)
        }
    }, [api])

    const toggle = useCallback(async () => {
        setSaving(true); setError(null)
        try {
            await api('/api/workspace/idp-config?action=toggle-oidc', { method: 'POST' })
            await load()
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setSaving(false)
        }
    }, [api, load])

    const remove = useCallback(async () => {
        if (!window.confirm('Delete this IdP configuration? Users will sign in with local credentials until you reconfigure.')) return
        setSaving(true); setError(null)
        try {
            await api('/api/workspace/idp-config?target=oidc', { method: 'DELETE' })
            setStatus(null)
            setNotice('Configuration deleted.')
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setSaving(false)
        }
    }, [api])

    if (loading) {
        return <div className="p-6 text-sm text-zinc-400">Loading SSO configuration…</div>
    }

    if (!entitled) {
        return (
            <div className="p-6 space-y-3">
                <h2 className="text-lg font-medium">Single sign-on</h2>
                <div className="text-sm text-amber-300 bg-amber-950/40 border border-amber-800 rounded p-4">
                    Custom SSO is not enabled for this workspace. Contact your administrator to add
                    the <code className="text-amber-200">custom_sso</code> entitlement.
                </div>
            </div>
        )
    }

    return (
        <div className="p-6 space-y-6 max-w-2xl">
            <div>
                <h2 className="text-lg font-medium">Single sign-on</h2>
                <p className="text-sm text-zinc-400">
                    Connect Microsoft Entra ID (or any OIDC IdP). Users who sign in through it are
                    provisioned automatically into this workspace.
                </p>
            </div>

            {error && <div className="text-sm text-red-300 bg-red-950/40 border border-red-800 rounded p-3">{error}</div>}
            {notice && <div className="text-sm text-emerald-300 bg-emerald-950/40 border border-emerald-800 rounded p-3">{notice}</div>}

            {/* ── Setup: what the customer pastes into Entra ── */}
            <section className="space-y-3">
                <h3 className="text-sm font-medium text-zinc-300">1 · Register AitherOS in your IdP</h3>
                {setup?.oidc_redirect_uri ? (
                    <div className="space-y-2 text-sm">
                        <p className="text-zinc-400">
                            Create an app registration in Microsoft Entra ID (or your OIDC IdP) and
                            add this as the single redirect URI:
                        </p>
                        <code className="block text-xs bg-zinc-900 border border-zinc-700 rounded p-2 break-all select-all">
                            {setup.oidc_redirect_uri}
                        </code>
                        <p className="text-zinc-500 text-xs">
                            Client type: <span className="text-zinc-300">Web</span> ·
                            Allow public client flows: <span className="text-zinc-300">off</span>
                        </p>
                    </div>
                ) : (
                    <p className="text-sm text-zinc-500">Redirect URI unavailable right now — refresh to retry.</p>
                )}
            </section>

            {/* ── Configure ── */}
            <section className="space-y-3">
                <h3 className="text-sm font-medium text-zinc-300">2 · Connect your IdP</h3>
                <div className="space-y-3">
                    <div>
                        <label className={LABEL_STYLE}>Entra tenant ID (directory GUID)</label>
                        <input className={FIELD_STYLE} value={entraTenantId}
                            onChange={e => setEntraTenantId(e.target.value)}
                            placeholder="11111111-2222-3333-4444-555555555555" />
                    </div>
                    <div>
                        <label className={LABEL_STYLE}>Application (client) ID</label>
                        <input className={FIELD_STYLE} value={clientId}
                            onChange={e => setClientId(e.target.value)}
                            placeholder="from the Entra app registration" />
                    </div>
                    <div>
                        <label className={LABEL_STYLE}>
                            Client secret {status?.has_client_secret ? '(leave blank to keep the existing one)' : ''}
                        </label>
                        <input className={FIELD_STYLE} type="password" value={clientSecret}
                            onChange={e => setClientSecret(e.target.value)}
                            placeholder={status?.has_client_secret ? '••••••••' : 'required'} />
                    </div>
                    <div>
                        <label className={LABEL_STYLE}>Button label (optional)</label>
                        <input className={FIELD_STYLE} value={displayName}
                            onChange={e => setDisplayName(e.target.value)}
                            placeholder="Sign in with Microsoft" />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-zinc-300">
                        <input type="checkbox" checked={domainClaim}
                            onChange={e => setDomainClaim(e.target.checked)} />
                        Require the user&apos;s email domain to be claimed by this workspace
                    </label>
                    <label className="flex items-center gap-2 text-sm text-zinc-300">
                        <input type="checkbox" checked={enabled}
                            onChange={e => setEnabled(e.target.checked)} />
                        Enable this IdP immediately
                    </label>
                    <button onClick={() => void configure()} disabled={saving}
                        className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium">
                        {saving ? 'Saving…' : 'Save configuration'}
                    </button>
                </div>
            </section>

            {/* ── Status ── */}
            {status && (
                <section className="space-y-3">
                    <h3 className="text-sm font-medium text-zinc-300">3 · Status</h3>
                    <div className="text-sm space-y-1">
                        <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${status.enabled ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
                            <span className="text-zinc-300">{status.enabled ? 'Enabled' : 'Disabled'}</span>
                            <span className="text-zinc-500">
                                {status.display_name || status.provider_preset || ''}
                                {status.issuer ? ` · ${status.issuer}` : ''}
                            </span>
                        </div>
                        {status.client_id && (
                            <div className="text-xs text-zinc-500">Client ID: <span className="text-zinc-300">{status.client_id}</span></div>
                        )}
                        {status.scopes && status.scopes.length > 0 && (
                            <div className="text-xs text-zinc-500">Scopes: <span className="text-zinc-300">{status.scopes.join(' ')}</span></div>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => void runTest()} disabled={testing}
                            className="px-3 py-1.5 rounded border border-zinc-600 hover:bg-zinc-800 text-sm disabled:opacity-50">
                            {testing ? 'Testing…' : 'Test connectivity'}
                        </button>
                        <button onClick={() => void toggle()} disabled={saving}
                            className="px-3 py-1.5 rounded border border-zinc-600 hover:bg-zinc-800 text-sm disabled:opacity-50">
                            {status.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button onClick={() => void remove()} disabled={saving}
                            className="px-3 py-1.5 rounded border border-red-800 text-red-300 hover:bg-red-950/40 text-sm disabled:opacity-50">
                            Delete
                        </button>
                    </div>
                </section>
            )}
        </div>
    )
}
