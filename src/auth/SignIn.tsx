"use client"

/**
 * <SignIn> — THE AitherIdentity sign-in surface.
 *
 * This is the only sign-in UI in AitherOS. It is rendered by:
 *   - AitherVeil at portal.aitherium.com/login (BFF transport)
 *   - AitherIdentity itself at {issuer}/oidc/login, as a static bundle
 *     (Identity transport) — which is what every tenant app, including
 *     a tenant portal, actually lands on
 *   - portal-kit apps that have their own backend
 *
 * Markup and Tailwind classes are carried over verbatim from Veil's original
 * login-form so the approved look is preserved exactly. What changed is that
 * every Next.js-specific dependency (`useSearchParams`, `Link`, `useAuth`,
 * `sonner`) is now injected, because none of them exist inside a bundle the
 * Python IdP serves.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import type {
    AlphaCapacity,
    AuthMethods,
    AuthTransport,
    Notifier,
    SignInHost,
    UpstreamButton,
} from './types'
import { DEFAULT_METHODS } from './types'
import { sanitizeReturnUrl, absoluteReturnUrl } from './return-url'
import { base64urlToBuffer, bufferToBase64url, idpLabel } from './webauthn'
import { domNotifier } from './notify'
import LocalDeviceSignIn from './local-device'

export interface SignInProps {
    transport: AuthTransport
    /** Server-rendered starting methods — avoids a flash of missing SSO buttons. */
    initialMethods?: AuthMethods
    host?: SignInHost
    /** Query params. Next apps pass useSearchParams(); the hosted page passes
     *  location.search. Kept as a prop so this component never imports a router. */
    params?: URLSearchParams
    /** Heading. Hosted pages show "Sign in to <client>" for the requesting app. */
    title?: React.ReactNode
    subtitle?: string
    /** Server-resolved federated buttons (tenant Entra/SAML) for hosted mode. */
    upstreamButtons?: UpstreamButton[]
    /** Server-side error to render on first paint (e.g. a failed form POST). */
    initialError?: string
    /** True when the server could not load the compiled bundle and is serving a
     *  reduced page. Renders a visible banner — never a silent degrade. */
    degraded?: boolean
    /** Hosted mode hides "Create Account"/capacity chrome that belongs to the portal. */
    variant?: 'portal' | 'hosted'
}

// ── SSO Buttons (upstream IdP + OAuth + SAML + Cloudflare Access) ────────────

function SSOButtons({
    returnUrl, methods, transport, upstreamButtons,
}: {
    returnUrl: string
    methods: AuthMethods
    transport: AuthTransport
    upstreamButtons?: UpstreamButton[]
}) {
    const { github: githubEnabled, google: googleEnabled, linkedin: linkedinEnabled } =
        methods.oauth_providers || {}

    const hasSaml = methods.saml_sso && methods.saml_tenants.length > 0
    const hasProviders = githubEnabled || googleEnabled || linkedinEnabled
    const hasCfAccess = methods.cloudflare_access
    const hasUpstream = (upstreamButtons?.length ?? 0) > 0

    // Password and magic-link are handled by the main form (passwordless-first),
    // so SSOButtons only covers external/federated identity providers.
    if (!hasSaml && !hasProviders && !hasCfAccess && !hasUpstream) return null

    return (
        <>
            <div className="space-y-3">
                {/* ── Tenant's own IdP first: an enterprise user wants THEIR button ── */}
                {(upstreamButtons || []).map(btn => (
                    <a
                        key={btn.href}
                        href={btn.href}
                        className="flex items-center justify-center gap-3 w-full py-3 px-4 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 font-medium rounded border border-indigo-500/40 transition-all duration-200"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                        {btn.label}
                    </a>
                ))}

                {githubEnabled && (
                    <a
                        href={transport.oauthUrl('github', returnUrl)}
                        className="flex items-center justify-center gap-3 w-full py-3 px-4 bg-zinc-800 hover:bg-zinc-700 text-white font-medium rounded border border-zinc-700 transition-all duration-200"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                        </svg>
                        Continue with GitHub
                    </a>
                )}
                {googleEnabled && (
                    <a
                        href={transport.oauthUrl('google', returnUrl)}
                        className="flex items-center justify-center gap-3 w-full py-3 px-4 bg-zinc-800 hover:bg-zinc-700 text-white font-medium rounded border border-zinc-700 transition-all duration-200"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11.96 11.96 0 001 12c0 1.94.46 3.77 1.18 5.42l3.66-2.84z" />
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                        </svg>
                        Continue with Google
                    </a>
                )}
                {linkedinEnabled && (
                    <a
                        href={transport.oauthUrl('linkedin', returnUrl)}
                        className="flex items-center justify-center gap-3 w-full py-3 px-4 bg-zinc-800 hover:bg-zinc-700 text-white font-medium rounded border border-zinc-700 transition-all duration-200"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                        </svg>
                        Continue with LinkedIn
                    </a>
                )}

                {/* ── SAML SSO tenants (enterprise AitherIdentity SSO) ── */}
                {hasSaml && methods.saml_tenants.map(tenant => (
                    <a
                        key={tenant.tenant_id}
                        href={transport.samlUrl(tenant.tenant_id, returnUrl)}
                        className="flex items-center justify-center gap-3 w-full py-3 px-4 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 font-medium rounded border border-indigo-500/40 transition-all duration-200"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                        Sign in with {idpLabel(tenant.idp_provider)}
                    </a>
                ))}

                {/* Fallback: generic CF Access button when no specific providers detected */}
                {hasCfAccess && !hasProviders && (
                    <a
                        href={transport.cloudflareAccessUrl(returnUrl)}
                        className="flex items-center justify-center gap-3 w-full py-3 px-4 bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 font-medium rounded border border-orange-500/40 transition-all duration-200"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                        Sign in with Cloudflare Access
                    </a>
                )}
            </div>

            <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-zinc-800" />
                </div>
                <div className="relative flex justify-center text-xs">
                    <span className="bg-zinc-900 px-3 text-zinc-500">or</span>
                </div>
            </div>
        </>
    )
}

// ── Passkey / WebAuthn Button ───────────────────────────────────────────────

function PasskeyButton({
    transport, notify, onOutcome,
}: {
    transport: AuthTransport
    notify: Notifier
    onOutcome: (o: Awaited<ReturnType<AuthTransport['webauthnComplete']>>) => void
}) {
    const [isAuthenticating, setIsAuthenticating] = useState(false)

    const handlePasskeyLogin = useCallback(async () => {
        if (typeof window === 'undefined' || !window.PublicKeyCredential) {
            notify.error('Passkeys are not supported in this browser.')
            return
        }

        setIsAuthenticating(true)
        try {
            const { options, state_token } = await transport.webauthnBegin()

            // Convert base64url fields to ArrayBuffer for the browser API
            const publicKeyOptions = {
                ...options,
                challenge: base64urlToBuffer(options.challenge),
                allowCredentials: (options.allowCredentials || []).map(c => ({
                    ...c,
                    id: base64urlToBuffer(c.id),
                })),
            } as unknown as PublicKeyCredentialRequestOptions

            // Browser prompt — user touches fingerprint reader / security key
            const credential = await navigator.credentials.get({
                publicKey: publicKeyOptions,
            }) as PublicKeyCredential | null

            if (!credential) throw new Error('No credential returned')
            const response = credential.response as AuthenticatorAssertionResponse

            const outcome = await transport.webauthnComplete({
                state_token,
                assertion_response: {
                    credentialId: bufferToBase64url(credential.rawId),
                    clientDataJSON: bufferToBase64url(response.clientDataJSON),
                    authenticatorData: bufferToBase64url(response.authenticatorData),
                    signature: bufferToBase64url(response.signature),
                },
            })
            onOutcome(outcome)
        } catch (err: unknown) {
            // A user who dismissed the OS prompt did not hit an error.
            if (err instanceof DOMException && err.name === 'NotAllowedError') return
            notify.error(err instanceof Error ? err.message : 'Passkey authentication failed')
        } finally {
            setIsAuthenticating(false)
        }
    }, [transport, notify, onOutcome])

    return (
        <button
            type="button"
            onClick={handlePasskeyLogin}
            disabled={isAuthenticating}
            className="flex items-center justify-center gap-3 w-full py-3 px-4 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 font-medium rounded border border-emerald-500/40 transition-all duration-200 disabled:opacity-50"
        >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z" />
                <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
            </svg>
            {isAuthenticating ? 'Authenticating...' : 'Sign in with Passkey'}
        </button>
    )
}

// ── The sign-in surface ─────────────────────────────────────────────────────

export default function SignIn({
    transport,
    initialMethods,
    host = {},
    params,
    title,
    subtitle,
    upstreamButtons,
    initialError,
    degraded,
    variant = 'portal',
}: SignInProps) {
    const notify = host.notify ?? domNotifier
    const Anchor = host.Link ?? (({ href, className, children }) =>
        <a href={href} className={className}>{children}</a>)
    const hosted = variant === 'hosted'

    const query = params ?? (typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search)
        : new URLSearchParams())

    // ── Password form state ───────────────────────────────────────────────────
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [showTokenField, setShowTokenField] = useState(false)
    const [apiKey, setApiKey] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)

    const [rememberMe, setRememberMeState] = useState(true)

    // Passwordless-first: magic link is the headline, email code the fallback.
    // Password is break-glass only (revealed via ?admin=1).
    const startMethods = initialMethods ?? DEFAULT_METHODS
    const [loginMode, setLoginMode] = useState<'magic_link' | 'email_otp' | 'password'>(
        startMethods.magic_link ? 'magic_link' : 'email_otp',
    )

    const [magicEmail, setMagicEmail] = useState('')
    const [isMagicSubmitting, setIsMagicSubmitting] = useState(false)
    const [magicSent, setMagicSent] = useState(false)

    const [otpStep, setOtpStep] = useState<'request' | 'verify'>('request')
    const [otpIdentifier, setOtpIdentifier] = useState('')
    const [otpToken, setOtpToken] = useState('')
    const [otpDevCode, setOtpDevCode] = useState<string | undefined>()
    const [otpCode, setOtpCode] = useState('')
    const [isOtpSubmitting, setIsOtpSubmitting] = useState(false)

    const [twoFaChallenge, setTwoFaChallenge] = useState<{
        challenge_token: string
        username: string
        expires_at?: string
    } | null>(null)
    const [totpCode, setTotpCode] = useState('')
    const [isTotpSubmitting, setIsTotpSubmitting] = useState(false)

    const [alphaCapacity, setAlphaCapacity] = useState<AlphaCapacity | null>(null)
    const [authMethods, setAuthMethods] = useState<AuthMethods>(startMethods)

    // `returnUrl` is canonical; `redirect` is accepted as an alias because ~30
    // in-app callers link `/login?redirect=...`.
    const returnUrl = sanitizeReturnUrl(query.get('returnUrl') || query.get('redirect'))
    const errorParam = query.get('error')
    // Break-glass: ?admin=1 reveals password sign-in for recovery.
    const adminMode = query.get('admin') === '1' || query.get('password') === '1'

    const modeTouchedRef = useRef(false)
    const selectMode = useCallback((mode: 'magic_link' | 'email_otp' | 'password') => {
        modeTouchedRef.current = true
        setLoginMode(mode)
    }, [])

    useEffect(() => {
        if (adminMode) {
            modeTouchedRef.current = true
            setLoginMode('password')
        }
    }, [adminMode])

    useEffect(() => {
        if (!modeTouchedRef.current && !adminMode && authMethods.magic_link && loginMode === 'email_otp') {
            setLoginMode('magic_link')
        }
    }, [authMethods.magic_link, adminMode, loginMode])

    // If magic link is selected but unavailable (provider down), fall back to
    // the always-on email code so the form is never broken.
    const activeMode = (loginMode === 'magic_link' && !authMethods.magic_link) ? 'email_otp' : loginMode

    // A server-rendered error (failed form POST) surfaces once on mount.
    const initialErrorRef = useRef(initialError)
    useEffect(() => {
        if (initialErrorRef.current) notify.error(initialErrorRef.current)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // ── Methods refresh with self-healing backoff ─────────────────────────────
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const retryAttemptRef = useRef(0)
    const [autoRetrying, setAutoRetrying] = useState(false)

    const refreshAuthMethods = useCallback(() => {
        if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current)
            retryTimerRef.current = null
        }
        transport.fetchMethods()
            .then(data => {
                retryAttemptRef.current = 0
                setAutoRetrying(false)
                setAuthMethods(prev => ({ ...prev, ...data, identity_unreachable: false }))
            })
            .catch(() => {
                const attempt = Math.min(retryAttemptRef.current + 1, 6)
                retryAttemptRef.current = attempt
                /*
                 * Do NOT cry outage on the first failure.
                 *
                 * The methods probe routinely fails its FIRST call on a cold
                 * identity (AitherIdentity lives inside the security-core
                 * compound and lazily loads DirectoryStore + auth sessions on
                 * first touch), and the very next attempt succeeds. Reported by
                 * the owner 2026-07-26: the login page opened on the outage
                 * screen and then "finally loaded" the normal form.
                 *
                 * Telling a user their platform is down when it is merely
                 * warming up is the worst possible first impression, and it is
                 * wrong — the retry that follows proves the service was fine.
                 * So we ride out GRACE_ATTEMPTS quiet retries (~3s) and only
                 * hard-block after that. A REAL outage still surfaces, 3s later,
                 * with the same screen and the same self-healing poll.
                 */
                const GRACE_ATTEMPTS = 2
                if (attempt > GRACE_ATTEMPTS) {
                    setAuthMethods(prev => ({ ...prev, identity_unreachable: true }))
                }
                const delay = Math.min(1000 * 2 ** (attempt - 1), 15000)
                setAutoRetrying(true)
                retryTimerRef.current = setTimeout(refreshAuthMethods, delay)
            })
    }, [transport])

    useEffect(() => {
        refreshAuthMethods()
        return () => {
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
        }
    }, [refreshAuthMethods])

    useEffect(() => {
        if (hosted || !transport.fetchAlphaCapacity) return
        transport.fetchAlphaCapacity()
            .then(setAlphaCapacity)
            .catch(() => { /* CTA chrome only — never blocks sign-in */ })
    }, [transport, hosted])

    const messageParam = query.get('message')
    useEffect(() => {
        if (messageParam) notify.info(messageParam, { duration: 10000 })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messageParam])

    useEffect(() => {
        if (!errorParam) return
        if (errorParam === 'forbidden') {
            const detail = query.get('detail')
            notify.error(detail
                ? `Access denied: you need the ${detail} permission. Contact an admin to upgrade your role.`
                : "Access denied: your account doesn't have permission for that page. Contact an admin.")
        } else {
            notify.error(`Sign-in failed: ${errorParam}`)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [errorParam])

    // ── Outcome handling ──────────────────────────────────────────────────────

    const handleOutcome = useCallback(async (
        outcome: { kind: string; [k: string]: unknown },
        displayHint?: string,
    ) => {
        // Hosted flows complete server-side: no token, just go where told.
        if (outcome.kind === 'redirect') {
            window.location.href = outcome.url as string
            return
        }
        if (outcome.kind === 'twofa') {
            setTwoFaChallenge({
                challenge_token: outcome.challenge_token as string,
                username: outcome.username as string,
                expires_at: outcome.expires_at as string | undefined,
            })
            setTotpCode('')
            notify.info('Enter the code from your authenticator app.')
            return
        }

        const user = outcome.user as Record<string, unknown>
        const displayName =
            (user.display_name as string) || (user.username as string) || displayHint || 'there'
        // The host owns the cookie/session contract and the post-login route —
        // this component deliberately knows neither.
        const dest = await host.onSession?.({
            access_token: outcome.access_token as string,
            user,
            rememberMe,
        })
        notify.success(`Welcome back, ${displayName}! Redirecting...`)
        // Brief delay so the user sees the success toast before navigation.
        setTimeout(() => { window.location.href = dest || returnUrl }, 800)
    }, [host, notify, rememberMe, returnUrl])

    // ── Handlers ──────────────────────────────────────────────────────────────

    const handleMagicRequest = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!magicEmail || !magicEmail.includes('@')) {
            notify.error('Please enter your email address.')
            return
        }
        setIsMagicSubmitting(true)
        try {
            await transport.magicLinkRequest({
                email: magicEmail,
                // Absolute, so the centralized magic-link page lands the user
                // back on the SAME origin they started from.
                return_to: absoluteReturnUrl(returnUrl),
            })
            // Success stays deliberately vague about whether the account EXISTS
            // (anti-enumeration). It is no longer vague about whether we
            // actually managed to send anything.
            setMagicSent(true)
            notify.success('Check your email for a login link.')
        } catch (err: unknown) {
            notify.error(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
        } finally {
            setIsMagicSubmitting(false)
        }
    }

    const handleOtpRequest = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!otpIdentifier) {
            notify.error('Please enter your username or email.')
            return
        }
        setIsOtpSubmitting(true)
        try {
            const isEmail = otpIdentifier.includes('@')
            const data = await transport.otpRequest(
                isEmail ? { email: otpIdentifier } : { username: otpIdentifier },
            )
            if (data.otp_token) {
                setOtpToken(data.otp_token)
                setOtpDevCode(data.code)
                sessionStorage.setItem('aither_otp_token', data.otp_token)
                setOtpStep('verify')
                notify.success('Check your email for a login code.')
            } else {
                // Anti-enumeration: account-not-found looks like success. Only
                // reachable on a 2xx, so the backend did not fail to send — it
                // simply had nothing to send.
                setOtpToken('')
                sessionStorage.removeItem('aither_otp_token')
                setOtpStep('verify')
                notify.success('If an account with a verified email exists, a code has been sent.')
            }
        } catch (err: unknown) {
            notify.error(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
        } finally {
            setIsOtpSubmitting(false)
        }
    }

    const handleOtpVerify = async (e: React.FormEvent) => {
        e.preventDefault()
        const trimmedCode = otpCode.trim()
        if (!trimmedCode || trimmedCode.length !== 6) {
            notify.error('Please enter the 6-digit code.')
            return
        }
        // Restore otp_token from sessionStorage in case of component remount.
        let activeToken = otpToken
        if (!activeToken) {
            const saved = sessionStorage.getItem('aither_otp_token')
            if (!saved) {
                notify.error('No valid session. Please request a new code.')
                return
            }
            activeToken = saved
            setOtpToken(saved)
        }
        setIsOtpSubmitting(true)
        try {
            const outcome = await transport.otpVerify({ otp_token: activeToken, code: trimmedCode })
            sessionStorage.removeItem('aither_otp_token')
            await handleOutcome(outcome, otpIdentifier)
        } catch (err: unknown) {
            notify.error(err instanceof Error ? err.message : 'Verification failed')
        } finally {
            setIsOtpSubmitting(false)
        }
    }

    const handleTotpVerify = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!twoFaChallenge || !totpCode || totpCode.length !== 6) {
            notify.error('Please enter the 6-digit code from your authenticator app.')
            return
        }
        setIsTotpSubmitting(true)
        try {
            const outcome = await transport.passwordLogin({
                username: twoFaChallenge.username,
                challenge_token: twoFaChallenge.challenge_token,
                totp_code: totpCode,
                remember_me: rememberMe,
            })
            setTwoFaChallenge(null)
            setTotpCode('')
            await handleOutcome(outcome, twoFaChallenge.username)
        } catch (err: unknown) {
            notify.error(err instanceof Error ? err.message : 'Verification failed')
        } finally {
            setIsTotpSubmitting(false)
        }
    }

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!username || (!password && !apiKey)) {
            notify.error('Please enter a username and password.')
            return
        }
        setIsSubmitting(true)
        // Safety: always reset the button even if something goes catastrophically wrong.
        const safetyTimer = setTimeout(() => setIsSubmitting(false), 20_000)
        try {
            const outcome = await transport.passwordLogin({
                username,
                remember_me: rememberMe,
                ...(showTokenField && apiKey ? { api_key: apiKey } : { password }),
            })
            await handleOutcome(outcome, username)
        } catch (err: unknown) {
            notify.error(err instanceof Error ? err.message : 'Failed to login. Check your credentials.')
        } finally {
            clearTimeout(safetyTimer)
            setIsSubmitting(false)
        }
    }

    // ── Hard block: AitherIdentity unreachable ───────────────────────────────
    // (SelfHostHandoff is defined below this component; see its comment for why
    // it reads the static config directly instead of useConfig().)
    // When the identity service is down we refuse to render a login form at all.
    // A degraded form (no OAuth/SSO, local-only) silently hides the outage and
    // is worse than an honest error — so fail loudly instead.
    if (authMethods.identity_unreachable) {
        return (
            <div className="flex min-h-[100dvh] w-full items-center justify-center bg-black px-4 py-20 sm:py-0">
                <div className="w-full max-w-md p-5 sm:p-8 bg-zinc-900 border border-red-500/40 rounded-xl shadow-2xl">
                    <h1 className="text-2xl sm:text-3xl font-light tracking-wide text-white mb-2 font-mono text-center">
                        Aither<span className="text-blue-400">Identity</span>
                    </h1>
                    <div className="mt-6 flex flex-col items-center text-center">
                        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-red-600/20 border border-red-500/40 mb-4">
                            <svg className="w-7 h-7 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                <line x1="12" y1="9" x2="12" y2="13" />
                                <line x1="12" y1="17" x2="12.01" y2="17" />
                            </svg>
                        </div>
                        <p className="text-red-300 font-medium text-lg mb-2">Identity service is unavailable</p>
                        <p className="text-zinc-400 text-sm mb-6">
                            AitherIdentity is unreachable, so sign-in is disabled. This is a
                            service outage, not your credentials.{' '}
                            {autoRetrying
                                ? 'Reconnecting automatically — the sign-in form will return on its own.'
                                : 'Please try again shortly.'}
                        </p>
                        <button
                            type="button"
                            onClick={refreshAuthMethods}
                            className="w-full py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium transition-colors inline-flex items-center justify-center gap-2"
                        >
                            {autoRetrying && (
                                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                </svg>
                            )}
                            {autoRetrying ? 'Reconnecting…' : 'Retry'}
                        </button>
                        <p className="text-zinc-600 text-xs mt-4 font-mono">AitherIdentity unreachable · 503</p>
                        <SelfHostHandoff />
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex min-h-[100dvh] w-full items-center justify-center bg-black px-4 py-20 sm:py-0">
            <div className="w-full max-w-md p-5 sm:p-8 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl">
                <h1 className="text-2xl sm:text-3xl font-light tracking-wide text-white mb-2 font-mono text-center">
                    {title ?? <>Aither<span className="text-blue-400">Identity</span></>}
                </h1>
                <p className="text-zinc-400 text-sm mb-6 sm:mb-8 text-center">
                    {subtitle ?? 'Sign in to access AitherOS.'}
                </p>

                {degraded && (
                    <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-200">
                        Reduced sign-in page — the compiled UI could not be loaded on the server.
                        Sign-in still works; please report this.
                    </div>
                )}

                {/* This device: a signed-in local Aitherium node, opt-in first. */}
                {!twoFaChallenge && host.localHandoff && (
                    <LocalDeviceSignIn
                        redeemUrl={host.localHandoff.redeemUrl}
                        returnUrl={host.localHandoff.returnUrl}
                    />
                )}

                {/* SSO: upstream tenant IdP + OAuth providers + SAML + Cloudflare Access */}
                {!twoFaChallenge && (
                    <SSOButtons
                        returnUrl={returnUrl}
                        methods={authMethods}
                        transport={transport}
                        upstreamButtons={upstreamButtons}
                    />
                )}

                {/* Passkey / WebAuthn login */}
                {!twoFaChallenge && authMethods.passkeys && (
                    <>
                        <PasskeyButton
                            transport={transport}
                            notify={notify}
                            onOutcome={o => { void handleOutcome(o as never) }}
                        />
                        <div className="relative my-6">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-zinc-800" />
                            </div>
                            <div className="relative flex justify-center text-xs">
                                <span className="bg-zinc-900 px-3 text-zinc-500">or use credentials</span>
                            </div>
                        </div>
                    </>
                )}

                {twoFaChallenge ? (
                    <>
                        <div className="text-center mb-6">
                            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-600/20 border border-blue-500/30 mb-3">
                                <svg className="w-6 h-6 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                </svg>
                            </div>
                            <h2 className="text-lg font-medium text-white">Two-Factor Authentication</h2>
                            <p className="text-zinc-400 text-sm mt-1">
                                Enter the 6-digit code from your authenticator app.
                            </p>
                        </div>
                        <form onSubmit={handleTotpVerify} className="space-y-4 sm:space-y-5">
                            <div>
                                <label className="block text-sm font-medium text-zinc-400 mb-1">Authenticator Code</label>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]{6}"
                                    maxLength={6}
                                    value={totpCode}
                                    onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    className="w-full p-4 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 text-2xl text-center tracking-[0.3em] focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 font-mono outline-none transition-colors"
                                    placeholder="000000"
                                    required
                                    autoFocus
                                    autoComplete="one-time-code"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={isTotpSubmitting || totpCode.length !== 6}
                                className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-medium rounded-lg text-base transition-all duration-200 disabled:opacity-50 active:scale-[0.98]"
                            >
                                {isTotpSubmitting ? 'Verifying...' : 'Verify'}
                            </button>
                        </form>
                        <p className="text-zinc-600 text-xs mt-4 text-center">You can also use a backup code.</p>
                        <div className="mt-3 text-center">
                            <button
                                type="button"
                                onClick={() => { setTwoFaChallenge(null); setTotpCode(''); setPassword('') }}
                                className="text-zinc-500 hover:text-zinc-400 text-xs transition"
                            >
                                ← Back to sign in
                            </button>
                        </div>
                    </>
                ) : authMethods.secure_methods_only ? (
                    <div className="text-center py-4 text-zinc-500 text-sm">
                        <p>Your organization requires passwordless authentication.</p>
                        <p className="mt-1 text-zinc-600">Use a passkey, security key, or SSO above.</p>
                    </div>
                ) : (
                    <>
                        {/* ── Login mode tabs (passwordless-first) ── */}
                        <div className="flex rounded-lg border border-zinc-800 mb-6 overflow-hidden">
                            {authMethods.magic_link && (
                                <button
                                    type="button"
                                    onClick={() => selectMode('magic_link')}
                                    className={`flex-1 py-2.5 text-sm font-medium transition-colors ${activeMode === 'magic_link' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-400'}`}
                                >
                                    Magic Link
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => { selectMode('email_otp'); setOtpStep('request') }}
                                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${activeMode === 'email_otp' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-400'}`}
                            >
                                Email Code
                            </button>
                            {adminMode && (
                                <button
                                    type="button"
                                    onClick={() => selectMode('password')}
                                    className={`flex-1 py-2.5 text-sm font-medium transition-colors ${activeMode === 'password' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-400'}`}
                                >
                                    Password
                                </button>
                            )}
                        </div>

                        {activeMode === 'magic_link' ? (
                            <>
                                {!magicSent ? (
                                    <form onSubmit={handleMagicRequest} className="space-y-4 sm:space-y-5">
                                        <div>
                                            <label className="block text-sm font-medium text-zinc-400 mb-1">Email</label>
                                            <input
                                                type="email"
                                                value={magicEmail}
                                                onChange={e => setMagicEmail(e.target.value)}
                                                className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 text-base focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 font-mono outline-none transition-colors"
                                                placeholder="you@example.com"
                                                required
                                                autoComplete="email"
                                                autoFocus
                                            />
                                            <p className="mt-2 text-xs text-zinc-500">
                                                We&apos;ll email you a one-time link that signs you in — no password needed.
                                            </p>
                                        </div>
                                        <button
                                            type="submit"
                                            disabled={isMagicSubmitting}
                                            className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-medium rounded-lg text-base transition-all duration-200 disabled:opacity-50 active:scale-[0.98]"
                                        >
                                            {isMagicSubmitting ? 'Sending...' : 'Send Me a Magic Link'}
                                        </button>
                                    </form>
                                ) : (
                                    <div className="text-center py-2 space-y-4">
                                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-600/20 border border-blue-500/30">
                                            <svg className="w-6 h-6 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <rect x="2" y="4" width="20" height="16" rx="2" />
                                                <path d="m22 7-10 5L2 7" />
                                            </svg>
                                        </div>
                                        <h2 className="text-lg font-medium text-white">Check your email</h2>
                                        <p className="text-zinc-400 text-sm">
                                            If an account exists for <span className="text-zinc-200 font-medium">{magicEmail}</span>,
                                            we&apos;ve sent a login link. It expires in 15 minutes.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => { setMagicSent(false); setMagicEmail('') }}
                                            className="text-zinc-500 hover:text-zinc-400 text-xs transition"
                                        >
                                            ← Use a different email
                                        </button>
                                    </div>
                                )}
                            </>
                        ) : activeMode === 'email_otp' ? (
                            <>
                                {otpStep === 'request' ? (
                                    <form onSubmit={handleOtpRequest} className="space-y-4 sm:space-y-5">
                                        <div>
                                            <label className="block text-sm font-medium text-zinc-400 mb-1">Username or Email</label>
                                            <input
                                                type="text"
                                                value={otpIdentifier}
                                                onChange={e => setOtpIdentifier(e.target.value)}
                                                className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 text-base focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 font-mono outline-none transition-colors"
                                                placeholder="e.g. jessica or jessica@example.com"
                                                required
                                                autoComplete="username"
                                                autoFocus
                                            />
                                        </div>
                                        <label className="flex items-center gap-2 cursor-pointer select-none">
                                            <input
                                                type="checkbox"
                                                checked={rememberMe}
                                                onChange={e => setRememberMeState(e.target.checked)}
                                                className="w-4 h-4 rounded border-zinc-700 bg-zinc-950 text-blue-500 focus:ring-blue-500/50 focus:ring-offset-0 cursor-pointer"
                                            />
                                            <span className="text-sm text-zinc-400">Keep me signed in for 30 days</span>
                                        </label>
                                        <button
                                            type="submit"
                                            disabled={isOtpSubmitting}
                                            className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-medium rounded-lg text-base transition-all duration-200 disabled:opacity-50 active:scale-[0.98]"
                                        >
                                            {isOtpSubmitting ? 'Sending...' : 'Send Me a Login Code'}
                                        </button>
                                    </form>
                                ) : (
                                    <>
                                        <p className="text-zinc-400 text-sm mb-6 text-center">
                                            Enter the 6-digit code sent to your email.
                                        </p>
                                        {otpDevCode && (
                                            <div className="bg-zinc-950 border border-amber-500/30 rounded-lg p-4 mb-6">
                                                <p className="text-xs text-amber-400/70 mb-1">Self-hosted mode — code sent directly:</p>
                                                <p className="text-2xl font-mono text-amber-300 tracking-[0.4em] text-center">{otpDevCode}</p>
                                            </div>
                                        )}
                                        <form onSubmit={handleOtpVerify} className="space-y-4 sm:space-y-5">
                                            <div>
                                                <label className="block text-sm font-medium text-zinc-400 mb-1">Login Code</label>
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    pattern="[0-9]{6}"
                                                    maxLength={6}
                                                    value={otpCode}
                                                    onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                                    className="w-full p-4 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 text-2xl text-center tracking-[0.3em] focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 font-mono outline-none transition-colors"
                                                    placeholder="000000"
                                                    required
                                                    autoFocus
                                                    autoComplete="one-time-code"
                                                />
                                            </div>
                                            <button
                                                type="submit"
                                                disabled={isOtpSubmitting || otpCode.length !== 6}
                                                className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-medium rounded-lg text-base transition-all duration-200 disabled:opacity-50 active:scale-[0.98]"
                                            >
                                                {isOtpSubmitting ? 'Verifying...' : 'Sign In'}
                                            </button>
                                        </form>
                                        <div className="mt-4 text-center">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setOtpStep('request'); setOtpToken(''); setOtpCode('')
                                                    setOtpDevCode(undefined); sessionStorage.removeItem('aither_otp_token')
                                                }}
                                                className="text-zinc-500 hover:text-zinc-400 text-xs transition"
                                            >
                                                ← Request a new code
                                            </button>
                                        </div>
                                    </>
                                )}
                            </>
                        ) : (
                            <>
                                <form onSubmit={handleLogin} className="space-y-4 sm:space-y-5">
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-400 mb-1">Username</label>
                                        <input
                                            type="text"
                                            value={username}
                                            onChange={e => setUsername(e.target.value)}
                                            className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 text-base focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 font-mono outline-none transition-colors"
                                            placeholder="e.g. jessica"
                                            required
                                            autoComplete="username"
                                        />
                                    </div>

                                    {!showTokenField ? (
                                        <div>
                                            <label className="block text-sm font-medium text-zinc-400 mb-1">Password</label>
                                            <input
                                                type="password"
                                                value={password}
                                                onChange={e => setPassword(e.target.value)}
                                                className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 text-base focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 font-mono outline-none transition-colors"
                                                placeholder="Your password"
                                                required={!showTokenField}
                                                autoComplete="current-password"
                                            />
                                            <div className="mt-1 flex justify-end">
                                                <Anchor href={transport.forgotPasswordUrl()} className="text-zinc-500 hover:text-zinc-400 text-xs transition">
                                                    Forgot password?
                                                </Anchor>
                                            </div>
                                        </div>
                                    ) : (
                                        <div>
                                            <label className="block text-sm font-medium text-zinc-400 mb-1">Access Token / API Key</label>
                                            <input
                                                type="password"
                                                value={apiKey}
                                                onChange={e => setApiKey(e.target.value)}
                                                className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 text-base focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 font-mono outline-none transition-colors"
                                                placeholder="Enter your credential token"
                                                required={showTokenField}
                                            />
                                        </div>
                                    )}

                                    <label className="flex items-center gap-2 cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={rememberMe}
                                            onChange={e => setRememberMeState(e.target.checked)}
                                            className="w-4 h-4 rounded border-zinc-700 bg-zinc-950 text-blue-500 focus:ring-blue-500/50 focus:ring-offset-0 cursor-pointer"
                                        />
                                        <span className="text-sm text-zinc-400">Keep me signed in for 30 days</span>
                                    </label>

                                    <button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-medium rounded-lg text-base transition-all duration-200 disabled:opacity-50 active:scale-[0.98]"
                                    >
                                        {isSubmitting ? 'Signing In...' : 'Sign In'}
                                    </button>
                                </form>

                                <div className="mt-4 text-center">
                                    <button
                                        type="button"
                                        onClick={() => { setShowTokenField(!showTokenField); setApiKey(''); setPassword('') }}
                                        className="text-zinc-600 hover:text-zinc-400 text-xs transition"
                                    >
                                        {showTokenField ? '← Use password' : 'Use API key / token instead'}
                                    </button>
                                </div>
                            </>
                        )}
                    </>
                )}

                {!hosted && (
                    <>
                        <p className="text-zinc-500 text-sm mt-6 text-center">
                            Don&apos;t have an account?{' '}
                            {alphaCapacity && !alphaCapacity.is_open && !alphaCapacity.invite_only_registration ? (
                                <span className="text-amber-300">
                                    {alphaCapacity.status_message || 'Registration is currently unavailable.'}
                                </span>
                            ) : (
                                <Anchor href={transport.registerUrl(returnUrl)} className="text-blue-400 hover:text-blue-300 transition">
                                    {alphaCapacity?.invite_only_registration ? 'Use Invite Code' : 'Create Account'}
                                    {alphaCapacity && alphaCapacity.is_open && !alphaCapacity.is_unlimited && alphaCapacity.limit > 0 && (
                                        <span className="text-zinc-500 ml-1">({alphaCapacity.remaining} slots left)</span>
                                    )}
                                </Anchor>
                            )}
                        </p>
                        {alphaCapacity && !alphaCapacity.is_open && !alphaCapacity.invite_only_registration && (
                            <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-200">
                                New registrations are paused while scoped app and widget instances are being finished.
                            </p>
                        )}
                    </>
                )}

                {hosted && (
                    <p className="text-zinc-600 text-xs mt-6 text-center">Secured by AitherIdentity</p>
                )}
            </div>
        </div>
    )
}


/**
 * "Run it on your own machine" — shown ONLY on the identity-unreachable screen.
 *
 * The hard block above is honest but it is a dead end: the sole control is
 * Retry, which does nothing for a user whose platform is genuinely down. For a
 * customer running a business on this app that is the difference between a bad
 * afternoon and a lost day, and the whole point of the sovereign appliance is
 * that they never have to have that day.
 *
 * 🪤 It reads `window.__AITHER_APP_CONFIG__` DIRECTLY rather than useConfig().
 * useConfig() prefers `/api/config/embed` and only falls back to the static
 * object — and that endpoint is unreachable at precisely the moment this
 * component renders. Sourcing the outage instructions from the thing that is
 * down is how a fallback becomes part of the outage. The published config.js is
 * a static asset on the CDN edge; it survives the backend by construction.
 *
 * Renders NOTHING when the tenant declares no `self_host`. A tenant with no
 * local story must not be shown a broken link to one — that is worse than the
 * dead end it replaces.
 *
 * The command is displayed for the user to copy, never executed and never
 * turned into a one-click action: this screen appears during an outage, which
 * is exactly when a stranger-shaped instruction deserves a human reading it
 * first.
 */
/**
 * The platform default. Self-hosting is a capability of AitherOS itself, not of
 * any one tenant — the installer is the SAME for all of them — so every
 * portal-kit app gets this without configuring anything.
 *
 * It shipped opt-in first, and that was wrong: a tenant would have sat on the same
 * dead-end screen another tenant app just got rescued from, purely because nobody had
 * remembered to add a config key. A capability that every tenant should have and
 * each must remember to switch on is a capability most tenants will not have.
 *
 * Both URLs verified live 2026-08-17: install.sh serves `#!/usr/bin/env bash`
 * (not an HTML page — `curl -fsSL` does not fail on a 200, so a wrong URL here
 * would pipe a web page into bash) and /get returns a real install page.
 */
const DEFAULT_SELF_HOST = {
    command: 'curl -fsSL https://aitherium.com/install.sh | bash',
    install_url: 'https://aitherium.com/install.sh',
    docs_url: 'https://portal.aitherium.com/get',
} as const

function SelfHostHandoff() {
    if (typeof window === 'undefined') return null
    const cfg = (window as unknown as Record<string, unknown>)['__AITHER_APP_CONFIG__']
    const raw = (cfg && typeof cfg === 'object'
        ? (cfg as Record<string, unknown>)['self_host']
        : undefined) as
        | { command?: string; docs_url?: string; install_url?: string; blurb?: string; enabled?: boolean }
        | false
        | null
        | undefined

    // Explicit opt-out only — `self_host: false` or `{enabled: false}`. A tenant
    // on an air-gapped or contractually-hosted deployment has a real reason to
    // suppress this; ABSENCE is not that reason, it is just nobody having
    // configured it, which is the case this default exists to cover.
    if (raw === false || (raw && typeof raw === 'object' && raw.enabled === false)) return null

    // A tenant may override any field; whatever it omits falls back to the
    // platform installer rather than disappearing. Partially-configured must not
    // mean worse-than-unconfigured.
    const sh = { ...DEFAULT_SELF_HOST, ...(raw && typeof raw === 'object' ? raw : {}) }
    const { command, docs_url: docsUrl, install_url: installUrl, blurb } = sh
    if (!command && !docsUrl && !installUrl) return null

    return (
        <div className="w-full mt-6 pt-5 border-t border-zinc-700/60 text-left">
            <p className="text-zinc-300 text-sm font-medium mb-1">
                Don&rsquo;t wait for us — run it yourself
            </p>
            <p className="text-zinc-500 text-xs mb-3">
                {blurb || 'This app can run entirely on your own machine, with your data staying there. It keeps working whether or not our platform is up.'}
            </p>
            {command && (
                <pre className="text-[11px] leading-relaxed bg-black/60 border border-zinc-700 rounded-lg p-3 mb-3 overflow-x-auto select-all text-zinc-300 font-mono">
                    {command}
                </pre>
            )}
            <div className="flex flex-wrap gap-2">
                {installUrl && (
                    <a
                        href={installUrl}
                        className="px-3 py-2 rounded-lg bg-zinc-100 hover:bg-white text-black text-xs font-medium transition-colors"
                        rel="noreferrer noopener"
                    >
                        Download
                    </a>
                )}
                {docsUrl && (
                    <a
                        href={docsUrl}
                        className="px-3 py-2 rounded-lg border border-zinc-600 hover:border-zinc-400 text-zinc-300 text-xs font-medium transition-colors"
                        rel="noreferrer noopener"
                    >
                        How it works
                    </a>
                )}
            </div>
        </div>
    )
}
