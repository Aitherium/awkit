/**
 * LocalDeviceSignIn — "Continue as <name> from this device".
 *
 * The visitor may be running an Aitherium node (awdk daemon, 127.0.0.1:9001)
 * that is already signed in. This block lets the sign-in card offer that
 * identity instead of a fresh login. Two explicit acts, never a page view:
 *
 *   1. "look on this device" — grants a per-browser opt-in (localStorage key
 *      shared with the Living OS: `aither-local-node-probe-optin`). Until then
 *      NOTHING here touches loopback; a stranger's ports are not scanned by
 *      a login page they merely opened.
 *   2. "Continue as <name>" — asks the daemon for a one-time ticket and
 *      navigates top-level to the platform's redeem URL with a first-party
 *      return, which sets the `.aitherium.com` session cookie and comes back
 *      to finish this flow (the IdP's silent-SSO branch honors that cookie).
 *
 * Audience: the daemon stamps THIS page's Origin into the ticket and the
 * redeem URL checks it against the return's origin, so a ticket minted for
 * one surface cannot sign the visitor into another.
 *
 * The daemon refuses non-loopback peers and any Origin that is not a
 * first-party host, and can be switched off with AITHER_BROWSER_HANDOFF=0.
 */

import React, { useCallback, useEffect, useState } from 'react'

const DAEMON = 'http://127.0.0.1:9001'
const OPTIN_KEY = 'aither-local-node-probe-optin'
const POLL_MS = 8000

type Who = { username: string; display_name: string; tenant_slug?: string }
type State = 'not-probed' | 'checking' | 'none' | 'found'

function readOptIn(): boolean {
    try { return window.localStorage.getItem(OPTIN_KEY) === '1' } catch { return false }
}

async function whoami(): Promise<Who | null> {
    const res = await fetch(`${DAEMON}/identity/whoami`, { signal: AbortSignal.timeout(1500), cache: 'no-store' })
    if (!res.ok) return null
    const j = await res.json().catch(() => null)
    if (!j || !j.logged_in || !j.handoff || !j.username) return null
    return { username: String(j.username), display_name: String(j.display_name || j.username), tenant_slug: j.tenant_slug ? String(j.tenant_slug) : undefined }
}

export interface LocalDeviceSignInProps {
    redeemUrl: string
    returnUrl: string
}

export default function LocalDeviceSignIn({ redeemUrl, returnUrl }: LocalDeviceSignInProps) {
    const [optedIn, setOptedIn] = useState(false)
    const [state, setState] = useState<State>('not-probed')
    const [who, setWho] = useState<Who | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')

    useEffect(() => { setOptedIn(readOptIn()) }, [])

    useEffect(() => {
        if (!optedIn) { setState('not-probed'); return }
        let cancelled = false
        let timer: ReturnType<typeof setTimeout> | undefined
        setState(s => (s === 'not-probed' ? 'checking' : s))
        const probe = async () => {
            let w: Who | null = null
            try { w = await whoami() } catch { w = null }
            if (cancelled) return
            setWho(w)
            setState(w ? 'found' : 'none')
            if (!w) timer = setTimeout(probe, POLL_MS)
        }
        void probe()
        return () => { cancelled = true; if (timer) clearTimeout(timer) }
    }, [optedIn])

    const grant = useCallback(() => {
        try { window.localStorage.setItem(OPTIN_KEY, '1') } catch { /* private mode: this session only */ }
        setOptedIn(true)
    }, [])

    const revoke = useCallback(() => {
        try { window.localStorage.removeItem(OPTIN_KEY) } catch { /* nothing to remove */ }
        setOptedIn(false)
        setWho(null)
    }, [])

    const go = useCallback(async () => {
        if (busy) return
        setBusy(true)
        setError('')
        try {
            const res = await fetch(`${DAEMON}/identity/handoff`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
                signal: AbortSignal.timeout(10000),
            })
            const j = await res.json().catch(() => ({}))
            if (!res.ok || typeof j?.ticket !== 'string' || !j.ticket) {
                setError(j?.detail || `The node on this device refused (${res.status}).`)
                setBusy(false)
                return
            }
            const u = new URL(redeemUrl)
            u.searchParams.set('ticket', j.ticket)
            u.searchParams.set('return', returnUrl)
            window.location.assign(u.toString())
        } catch {
            setError('The node on this device did not answer.')
            setBusy(false)
        }
    }, [busy, redeemUrl, returnUrl])

    // The redeem URL is a login endpoint; only ever navigate to https.
    if (!/^https:\/\//.test(redeemUrl)) return null

    if (state === 'not-probed') {
        return (
            <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-3 text-left">
                <p className="text-xs leading-relaxed text-zinc-400">
                    Running an Aitherium node on this device? With your OK this page will check
                    <span className="font-mono text-blue-300"> 127.0.0.1</span> for a node you are already
                    signed into, so you can continue as that user. Nothing is sent anywhere until you choose to continue.
                </p>
                <button type="button" onClick={grant}
                    className="mt-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-200 hover:bg-blue-500/20">
                    Look on this device
                </button>
            </div>
        )
    }
    if (state === 'found' && who) {
        return (
            <div className="mb-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-left">
                <p className="text-xs leading-relaxed text-emerald-100/80">
                    This device is signed in as <span className="font-semibold text-emerald-200">{who.display_name}</span>
                    {who.tenant_slug ? <> in <span className="font-mono">{who.tenant_slug}</span></> : null}.
                </p>
                <button type="button" onClick={() => { void go() }} disabled={busy}
                    className="mt-2 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-emerald-400 disabled:opacity-50">
                    {busy ? 'Signing in…' : `Continue as ${who.display_name} from this device`}
                </button>
                {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
            </div>
        )
    }
    // checking / none: a one-line honest status with a way to stop looking.
    return (
        <p className="mb-6 text-center text-[11px] text-zinc-500">
            {state === 'checking' ? 'Checking this device for a signed-in node…' : 'No signed-in node found on this device.'}{' '}
            <button type="button" onClick={revoke} className="underline hover:text-zinc-300">Stop looking</button>
        </p>
    )
}
