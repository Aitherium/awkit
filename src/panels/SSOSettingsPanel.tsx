"use client"

/**
 * SSOSettingsPanel — a tenant configures its OWN SAML 2.0 / Entra identity
 * provider, without anyone at Aitherium touching it.
 *
 * WHY THIS EXISTS. SAML has been configurable since long before this panel, but
 * only through `/admin/saml/configure` with a platform-admin role — so every
 * customer who wanted Entra SSO had to ask us, and we did it for them. That is
 * not self-service, it is a support ticket with extra steps.
 *
 * 🚨 The reason it could not simply be opened up: that endpoint took the tenant
 * from the REQUEST BODY (`body.pop("tenant_id", "platform")`) and used it as the
 * write scope. Relaxing the role check alone would have turned a
 * platform-admin-only footgun into "any tenant admin can reconfigure any other
 * tenant's SSO" — and whoever controls a tenant's SAML controls who may log in
 * AS that tenant's users, with `group_role_map` in the same payload to mint
 * themselves admin. The scope is now derived from the authenticated caller
 * (`_saml_config_scope` in AitherIdentity), which is what makes this panel
 * safe to ship. This component never sends a tenant id, and the server would
 * ignore it if it did.
 *
 * The metadata-URL path is offered FIRST on purpose. Entra, Okta and OneLogin
 * all publish a federation metadata document, and pasting one URL is both less
 * error-prone and less likely to be abandoned halfway than transcribing an
 * entity id, an SSO URL and a base64 X.509 certificate by hand. Manual entry
 * stays for the IdPs that do not publish one.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { getApiBase } from '../lib/apiBase'

type Provider = 'azure' | 'okta' | 'onelogin' | 'ping' | 'generic'

export interface SSOConfig {
    enabled?: boolean
    idp_provider?: Provider
    idp_entity_id?: string
    idp_sso_url?: string
    idp_x509_cert?: string
    jit_provisioning?: boolean
    group_role_map?: Record<string, string>
    tenant_id?: string
}

export interface SSOSettingsPanelProps {
    /** Override the API base (tests, embedding). Defaults to the resolved one. */
    apiBase?: string
}

const PROVIDERS: { id: Provider; label: string; hint: string }[] = [
    { id: 'azure', label: 'Microsoft Entra ID', hint: 'Azure AD — App registrations → Enterprise app → SAML' },
    { id: 'okta', label: 'Okta', hint: 'Applications → your app → Sign On → SAML metadata' },
    { id: 'onelogin', label: 'OneLogin', hint: 'Applications → SSO → SAML metadata' },
    { id: 'ping', label: 'PingFederate', hint: 'SP connection → metadata export' },
    { id: 'generic', label: 'Other SAML 2.0', hint: 'Any IdP that speaks SAML 2.0' },
]

function useApi(apiBase?: string) {
    const base = apiBase ?? getApiBase()
    return useCallback(
        async (path: string, init?: RequestInit) => {
            const res = await fetch(`${base}${path}`, {
                ...init,
                // Cross-origin on a static host: without this the session cookie
                // never travels and every call is a 401 that reads as "not
                // configured" rather than "not signed in".
                ...(base ? { credentials: 'include' as const } : {}),
                headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
            })
            const body = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(body?.detail || body?.error || `HTTP ${res.status}`)
            return body
        },
        [base],
    )
}

export default function SSOSettingsPanel({ apiBase }: SSOSettingsPanelProps) {
    const api = useApi(apiBase)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [cfg, setCfg] = useState<SSOConfig>({ idp_provider: 'azure', jit_provisioning: true })
    const [metadataUrl, setMetadataUrl] = useState('')
    const [mode, setMode] = useState<'metadata' | 'manual'>('metadata')

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await api('/api/settings/sso')
            if (data?.config) setCfg({ ...data.config })
        } catch (e) {
            // A tenant with no SSO yet is the NORMAL first visit, not an error
            // state — showing a red box to someone who has simply never
            // configured this is how a setup screen reads as broken.
            const msg = e instanceof Error ? e.message : String(e)
            if (!/404|not configured|no saml/i.test(msg)) setError(msg)
        } finally {
            setLoading(false)
        }
    }, [api])

    useEffect(() => { void load() }, [load])

    const save = useCallback(async () => {
        setSaving(true); setError(null); setNotice(null)
        try {
            // No tenant_id is sent, ever. The server derives it from the session;
            // sending one would be ignored and is exactly the shape that made
            // this endpoint dangerous before.
            if (mode === 'metadata') {
                if (!/^https:\/\//i.test(metadataUrl)) {
                    throw new Error('Metadata URL must start with https://')
                }
                await api('/api/settings/sso/from-metadata', {
                    method: 'POST',
                    body: JSON.stringify({
                        metadata_url: metadataUrl,
                        idp_provider: cfg.idp_provider,
                        jit_provisioning: !!cfg.jit_provisioning,
                        enabled: cfg.enabled !== false,
                    }),
                })
            } else {
                for (const [k, label] of [
                    ['idp_entity_id', 'Entity ID'],
                    ['idp_sso_url', 'Sign-on URL'],
                    ['idp_x509_cert', 'Signing certificate'],
                ] as const) {
                    if (!String((cfg as Record<string, unknown>)[k] || '').trim()) {
                        throw new Error(`${label} is required`)
                    }
                }
                await api('/api/settings/sso', {
                    method: 'POST',
                    body: JSON.stringify({ ...cfg, enabled: cfg.enabled !== false }),
                })
            }
            setNotice('Single sign-on saved. Test it in a private window before telling your team.')
            await load()
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setSaving(false)
        }
    }, [api, cfg, metadataUrl, mode, load])

    const disable = useCallback(async () => {
        setSaving(true); setError(null); setNotice(null)
        try {
            await api('/api/settings/sso', { method: 'DELETE' })
            setCfg({ idp_provider: 'azure', jit_provisioning: true })
            setNotice('Single sign-on disabled. Everyone signs in with their Aitherium account again.')
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setSaving(false)
        }
    }, [api])

    const provider = PROVIDERS.find(p => p.id === (cfg.idp_provider || 'azure'))
    const configured = !!(cfg.idp_entity_id || cfg.idp_sso_url)

    if (loading) {
        return <div className="p-6 text-sm text-zinc-400">Loading single sign-on settings…</div>
    }

    return (
        <div className="p-4 sm:p-6 max-w-3xl">
            <header className="mb-5">
                <h2 className="text-xl font-medium text-white">Single sign-on (SAML 2.0)</h2>
                <p className="text-sm text-zinc-400 mt-1">
                    Let your team sign in with your own identity provider. Applies to this
                    workspace only — you cannot change any other organisation&rsquo;s settings,
                    and nobody else can change yours.
                </p>
            </header>

            {configured && (
                <div className="mb-4 rounded-lg border border-emerald-600/40 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-300">
                    Currently configured{cfg.enabled === false ? ' (disabled)' : ''} · {provider?.label}
                </div>
            )}
            {error && (
                <div className="mb-4 rounded-lg border border-red-500/40 bg-red-600/10 px-3 py-2 text-sm text-red-300">
                    {error}
                </div>
            )}
            {notice && (
                <div className="mb-4 rounded-lg border border-blue-500/40 bg-blue-600/10 px-3 py-2 text-sm text-blue-200">
                    {notice}
                </div>
            )}

            <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Identity provider</label>
            <select
                value={cfg.idp_provider || 'azure'}
                onChange={e => setCfg({ ...cfg, idp_provider: e.target.value as Provider })}
                className="w-full mb-1 rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white"
            >
                {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            {provider && <p className="text-xs text-zinc-500 mb-4">{provider.hint}</p>}

            <div className="flex gap-2 mb-4" role="tablist">
                {(['metadata', 'manual'] as const).map(m => (
                    <button
                        key={m}
                        type="button"
                        role="tab"
                        aria-selected={mode === m}
                        onClick={() => setMode(m)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            mode === m
                                ? 'bg-zinc-100 text-black'
                                : 'border border-zinc-700 text-zinc-300 hover:border-zinc-500'
                        }`}
                    >
                        {m === 'metadata' ? 'From metadata URL (recommended)' : 'Enter details manually'}
                    </button>
                ))}
            </div>

            {mode === 'metadata' ? (
                <div className="mb-4">
                    <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">
                        Federation metadata URL
                    </label>
                    <input
                        value={metadataUrl}
                        onChange={e => setMetadataUrl(e.target.value)}
                        placeholder="https://login.microsoftonline.com/<tenant>/federationmetadata/2007-06/federationmetadata.xml"
                        className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white font-mono"
                    />
                    <p className="text-xs text-zinc-500 mt-1">
                        We read the entity ID, sign-on URL and signing certificate from this document,
                        so there is nothing to transcribe.
                    </p>
                </div>
            ) : (
                <div className="space-y-3 mb-4">
                    {([
                        ['idp_entity_id', 'Entity ID (issuer)', 'https://sts.windows.net/<guid>/'],
                        ['idp_sso_url', 'Sign-on URL', 'https://login.microsoftonline.com/<guid>/saml2'],
                    ] as const).map(([key, label, ph]) => (
                        <div key={key}>
                            <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">{label}</label>
                            <input
                                value={String((cfg as Record<string, unknown>)[key] || '')}
                                onChange={e => setCfg({ ...cfg, [key]: e.target.value })}
                                placeholder={ph}
                                className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-white font-mono"
                            />
                        </div>
                    ))}
                    <div>
                        <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">
                            Signing certificate (base64 X.509)
                        </label>
                        <textarea
                            rows={5}
                            value={cfg.idp_x509_cert || ''}
                            onChange={e => setCfg({ ...cfg, idp_x509_cert: e.target.value })}
                            placeholder="MIIC…"
                            className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-xs text-white font-mono"
                        />
                    </div>
                </div>
            )}

            <label className="flex items-center gap-2 mb-5 text-sm text-zinc-300">
                <input
                    type="checkbox"
                    checked={cfg.jit_provisioning !== false}
                    onChange={e => setCfg({ ...cfg, jit_provisioning: e.target.checked })}
                />
                Create accounts automatically on first sign-in
                <span className="text-xs text-zinc-500">
                    (off means a user must already exist here before they can sign in)
                </span>
            </label>

            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium"
                >
                    {saving ? 'Saving…' : configured ? 'Update single sign-on' : 'Enable single sign-on'}
                </button>
                {configured && (
                    <button
                        type="button"
                        onClick={() => void disable()}
                        disabled={saving}
                        className="px-4 py-2 rounded-lg border border-zinc-700 hover:border-zinc-500 disabled:opacity-50 text-zinc-300 text-sm"
                    >
                        Disable
                    </button>
                )}
            </div>

            <p className="text-xs text-zinc-500 mt-5">
                Keep one Aitherium password account with admin rights. If your identity provider
                becomes unreachable, it is the only way back in — a workspace whose sole route is a
                broken IdP is locked out, not degraded.
            </p>
        </div>
    )
}
