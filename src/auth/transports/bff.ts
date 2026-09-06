/**
 * BFF transport — for Next.js apps that proxy AitherIdentity through their own
 * `/api/auth/*` routes (Veil, Workspace, and any portal-kit app with a backend).
 *
 * The app's own routes stay in charge of the session cookie, which is why this
 * transport returns `session` outcomes: the host holds the token.
 */

import type {
    AlphaCapacity,
    AuthMethods,
    AuthOutcome,
    AuthTransport,
    OtpRequestResult,
    PublicKeyCredentialRequestOptions_JSON,
} from '../types'

/** Pull the most useful message out of an error body, in the shapes our routes use. */
function errorMessage(body: Record<string, unknown>, fallback: string): string {
    return (
        (body.error as string) ||
        (body.detail as string) ||
        (body.message as string) ||
        fallback
    )
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
    try {
        return (await res.json()) as Record<string, unknown>
    } catch {
        return {}
    }
}

/**
 * Unwrap `{ data: { access_token, user } }`.
 *
 * Throws rather than returning a falsy outcome: a login that resolves with no
 * token is the "silent no-op" failure — it looks like a working form that just
 * never signs anyone in.
 */
function sessionFromBody(body: Record<string, unknown>): AuthOutcome {
    const data = (body.data ?? body) as Record<string, unknown>
    const token = data?.access_token as string | undefined
    const user = data?.user as Record<string, unknown> | undefined
    if (!token || !user) throw new Error('Invalid response from identity server')
    return { kind: 'session', access_token: token, user }
}

export interface BffTransportOptions {
    /** Defaults to `/api/auth`. */
    basePath?: string
    /** Where "Create Account" points. Defaults to `/register`. */
    registerPath?: string
    /** Where "Forgot password?" points. Defaults to `/forgot-password`. */
    forgotPasswordPath?: string
}

export function createBffTransport(opts: BffTransportOptions = {}): AuthTransport {
    const base = (opts.basePath ?? '/api/auth').replace(/\/$/, '')

    // A BOUNDED signal for the READS. Once `basePath` is absolute -- which it
    // is on the static apex, where same-origin /api/* does not exist -- these
    // become real cross-origin requests, and a request that never settles
    // holds the PAGE open, not just itself.
    //
    // Measured 2026-09-05: making the base absolute took the publish lane's
    // headless-Chromium smoke from 2m01s to an 11-MINUTE HANG, killed by the
    // job cap. That step renders the built export with `waitUntil:
    // 'networkidle'`, so an in-flight fetch is indistinguishable from a page
    // that never finished loading. A real visitor sees the same thing: a
    // login form that never becomes interactive.
    //
    // 8s is well past a healthy round trip and well inside any page budget.
    // On timeout the caller falls back to its default methods, which is the
    // behaviour that already exists for an Identity outage -- so a slow
    // upstream degrades the form rather than freezing the page.
    const _bounded = (ms = 8_000): AbortSignal | undefined => {
        try {
            return AbortSignal.timeout(ms)
        } catch {
            return undefined   // older engines: unbounded, as before
        }
    }
    const registerPath = opts.registerPath ?? '/register'
    const forgotPath = opts.forgotPasswordPath ?? '/forgot-password'

    // `credentials: 'include'` is REQUIRED, not defensive. When `basePath` is
    // absolute -- which it is on the static apex, where same-origin /api/*
    // does not exist -- every one of these is a CROSS-ORIGIN fetch, and the
    // browser default (`same-origin`) sends no cookies and stores no
    // Set-Cookie. A sign-in that cannot set its own session cookie returns
    // 200 and leaves the user signed out: the silent-no-op shape, on the one
    // request where it is least visible.
    const postJson = async (path: string, body: unknown, signal?: AbortSignal) =>
        fetch(`${base}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            credentials: 'include',
            signal,
        })

    return {
        async fetchMethods(): Promise<Partial<AuthMethods>> {
            const res = await fetch(`${base}/methods`, { credentials: 'include', signal: _bounded() })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await readJson(res)
            if (!data || Object.keys(data).length === 0) throw new Error('empty methods response')
            // The BFF flags an Identity outage in-band rather than 502ing, so a
            // 200 is NOT on its own proof that Identity answered.
            if (data._identity_unreachable === true || data.identity_unreachable === true) {
                throw new Error('identity unreachable')
            }
            return data as Partial<AuthMethods>
        },

        async fetchAlphaCapacity(): Promise<AlphaCapacity> {
            const res = await fetch(`${base}/alpha-capacity`, { credentials: 'include', signal: _bounded() })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            return (await res.json()) as AlphaCapacity
        },

        async passwordLogin(input): Promise<AuthOutcome> {
            // Client-side timeout so the button can never hang on an
            // unresponsive route. 18s sits under the form's own 20s reset.
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), 18_000)
            let res: Response
            try {
                res = await postJson('', input, controller.signal)
            } catch (err: unknown) {
                if (err instanceof Error && err.name === 'AbortError') {
                    throw new Error('Sign-in timed out — the identity server may be busy. Please try again.')
                }
                throw err
            } finally {
                clearTimeout(timer)
            }

            const body = await readJson(res)
            if (!res.ok) throw new Error(errorMessage(body, 'Authentication failed'))

            if (body.requires_2fa) {
                return {
                    kind: 'twofa',
                    challenge_token: body.challenge_token as string,
                    username: input.username,
                    expires_at: body.expires_at as string | undefined,
                }
            }
            return sessionFromBody(body)
        },

        async magicLinkRequest(input): Promise<void> {
            const res = await postJson('/magic-link/request', input)
            const body = await readJson(res)
            if (body.status === 'rate_limited') {
                throw new Error(
                    (body.message as string) ||
                    'Too many requests. Please wait a moment and try again.',
                )
            }
            // A 503 means the mail could not be QUEUED. This form used to say
            // "check your email" regardless, so a total mail outage looked
            // exactly like success and users waited for a link never sent.
            if (!res.ok) {
                throw new Error(errorMessage(
                    body,
                    "We couldn't send your login link right now. Please try again in a moment.",
                ))
            }
        },

        async otpRequest(input): Promise<OtpRequestResult> {
            const res = await postJson('/email-otp/request', input)
            const body = await readJson(res)
            // A 503 here means the code could not be queued — NOT that the
            // account is missing. Advancing to code-entry on a real send
            // failure is what stranded users waiting for a nonexistent code.
            if (!res.ok) {
                throw new Error(errorMessage(
                    body,
                    "We couldn't send your login code right now. Please try again in a moment.",
                ))
            }
            return {
                otp_token: body.otp_token as string | undefined,
                code: body.code as string | undefined,
            }
        },

        async otpVerify(input): Promise<AuthOutcome> {
            const res = await postJson('/email-otp/verify', input)
            const body = await readJson(res)
            if (!res.ok) throw new Error(errorMessage(body, 'Verification failed'))
            return sessionFromBody(body)
        },

        async webauthnBegin() {
            const res = await postJson('/webauthn/authenticate/begin', {})
            const body = await readJson(res)
            if (!res.ok) {
                throw new Error(errorMessage(body, 'Failed to start passkey authentication'))
            }
            return {
                options: body.options as PublicKeyCredentialRequestOptions_JSON,
                state_token: body.state_token as string,
            }
        },

        async webauthnComplete(input): Promise<AuthOutcome> {
            const res = await postJson('/webauthn/authenticate/complete', input)
            const body = await readJson(res)
            if (!res.ok) throw new Error(errorMessage(body, 'Passkey authentication failed'))
            return sessionFromBody(body)
        },

        oauthUrl: (provider, returnUrl) =>
            `${base}/oauth/${provider}?returnUrl=${encodeURIComponent(returnUrl)}`,
        samlUrl: (tenantId, returnUrl) =>
            `${base}/saml/login/${encodeURIComponent(tenantId)}?return_to=${encodeURIComponent(returnUrl)}`,
        cloudflareAccessUrl: (returnUrl, provider) => {
            const url = `${base}/cf-access?returnUrl=${encodeURIComponent(returnUrl)}`
            return provider ? `${url}&provider=${provider}` : url
        },
        registerUrl: returnUrl => `${registerPath}?returnUrl=${encodeURIComponent(returnUrl)}`,
        forgotPasswordUrl: () => forgotPath,
    }
}
