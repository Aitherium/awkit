/**
 * Entry point for the bundle AitherIdentity serves at `{issuer}/oidc/login`.
 *
 * The Python IdP cannot import React, so this file is compiled by
 * `scripts/build-signin.mjs` into ONE self-contained JS file (React inlined)
 * plus one CSS file, both baked into the security-core image. Identity renders
 * a thin HTML shell that inlines `window.__AITHER_SIGNIN__` and loads these two
 * assets — so the hosted page needs no CDN, no network at render time, and
 * critically no dependency on Veil being up in order for anyone to sign in.
 */

import React from 'react'
import { createRoot } from 'react-dom/client'
import SignIn from './SignIn'
import { createIdentityTransport } from './transports/identity'
import { DEFAULT_METHODS, type AuthMethods, type HostedFlowContext } from './types'

declare global {
    interface Window {
        __AITHER_SIGNIN__?: HostedFlowContext
    }
}

function mount() {
    const el = document.getElementById('aither-signin-root')
    if (!el) return

    const ctx = window.__AITHER_SIGNIN__
    if (!ctx?.flow_id || !ctx?.issuer) {
        // No flow context means the shell rendered without server state. Say so
        // instead of painting an inert form that can never complete a login.
        el.innerHTML =
            '<div style="min-height:100dvh;display:flex;align-items:center;justify-content:center;' +
            'background:#000;color:#f87171;font-family:ui-monospace,monospace;font-size:14px;padding:24px;' +
            'text-align:center">Sign-in flow context missing — this link has expired. ' +
            'Please start again from the app you were signing in to.</div>'
        return
    }

    const methods: AuthMethods = { ...DEFAULT_METHODS, ...(ctx.methods || {}) }
    const transport = createIdentityTransport({ issuer: ctx.issuer, flowId: ctx.flow_id })
    // Local-node sign-in: redeem at the platform apex, return to THIS flow's
    // resume URL so the pending authorization completes once the cookie is set.
    // The apex is derived from the issuer host (idp.aitherium.com -> aitherium.com)
    // so a staging issuer redeems at a staging apex rather than production.
    let localHandoff: { redeemUrl: string; returnUrl: string } | undefined
    try {
        const iss = new URL(ctx.issuer)
        const apexHost = iss.hostname.replace(/^idp\./, '')
        if (iss.protocol === 'https:' && apexHost !== iss.hostname) {
            localHandoff = {
                redeemUrl: `https://${apexHost}/api/auth/local-handoff`,
                returnUrl: `${ctx.issuer.replace(/\/$/, '')}/oidc/resume?flow_id=${encodeURIComponent(ctx.flow_id)}`,
            }
        }
    } catch { localHandoff = undefined }

    createRoot(el).render(
        <React.StrictMode>
            <SignIn
                transport={transport}
                initialMethods={methods}
                upstreamButtons={ctx.upstream_buttons}
                initialError={ctx.error}
                degraded={ctx.degraded}
                variant="hosted"
                host={localHandoff ? { localHandoff } : {}}
                title={ctx.client_name
                    ? <>Sign in to <span className="text-blue-400">{ctx.client_name}</span></>
                    : <>Aither<span className="text-blue-400">Identity</span></>}
                subtitle={ctx.client_host
                    ? `to continue to ${ctx.client_host}`
                    : 'Choose how to authenticate'}
            />
        </React.StrictMode>,
    )
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount)
} else {
    mount()
}
