/**
 * Identity transport — for the page AitherIdentity HOSTS itself at
 * `{issuer}/oidc/login`, served as a static bundle with no React on the server.
 *
 * The defining difference from the BFF transport: authentication here completes
 * a pending OIDC flow SERVER-side and mints an authorization code. No access
 * token ever reaches this browser context, so every successful outcome is a
 * `redirect` — the browser navigates to the tenant app's `redirect_uri` and the
 * code is delivered by that navigation.
 *
 * That is also why these endpoints content-negotiate: they answer a normal form
 * POST with a 302 (so the page still works with JS off), and answer
 * `Accept: application/json` with `{redirect_to}` / `{error}` so this UI can
 * render an error inline instead of reloading the whole page.
 */

import type {
    AuthMethods,
    AuthOutcome,
    AuthTransport,
    OtpRequestResult,
    PublicKeyCredentialRequestOptions_JSON,
} from '../types'

async function readJson(res: Response): Promise<Record<string, unknown>> {
    try {
        return (await res.json()) as Record<string, unknown>
    } catch {
        return {}
    }
}

function errorMessage(body: Record<string, unknown>, fallback: string): string {
    // FastAPI's HTTPException serializes to `detail`; our handlers use `error`.
    return (
        (body.error as string) ||
        (body.detail as string) ||
        (body.message as string) ||
        fallback
    )
}

/**
 * Unwrap a flow-completion response.
 *
 * `redirect_to` is produced by the server from the flow's REGISTERED
 * redirect_uri, never from anything the browser sent — the client cannot steer
 * where an authorization code lands (security-review-patterns #2).
 */
function redirectFromBody(body: Record<string, unknown>): AuthOutcome {
    const url = body.redirect_to as string | undefined
    if (!url) throw new Error('Invalid response from identity server')
    return { kind: 'redirect', url }
}

export interface IdentityTransportOptions {
    /** Public issuer base, e.g. `https://idp.aitherium.com/identity`. */
    issuer: string
    /** The pending OIDC browser flow this page is completing. */
    flowId: string
}

export function createIdentityTransport(opts: IdentityTransportOptions): AuthTransport {
    const issuer = opts.issuer.replace(/\/$/, '')
    const flow_id = opts.flowId

    const postJson = async (path: string, body: unknown, signal?: AbortSignal) =>
        fetch(`${issuer}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            // Same-origin: the IdP session cookie must ride along so a
            // successful passkey/OTP login can establish SSO for the next app.
            credentials: 'same-origin',
            body: JSON.stringify(body),
            signal,
        })

    /**
     * Federated entry points carry the flow, not a returnUrl — the flow already
     * knows where to land. `returnUrl` is ignored on purpose here; accepting it
     * would let a crafted link redirect an authorization code off-flow.
     */
    const withFlow = (path: string) =>
        `${issuer}${path}${path.includes('?') ? '&' : '?'}flow_id=${encodeURIComponent(flow_id)}`

    return {
        async fetchMethods(): Promise<Partial<AuthMethods>> {
            const res = await fetch(`${issuer}/auth/methods`, { headers: { Accept: 'application/json' } })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await readJson(res)
            if (!data || Object.keys(data).length === 0) throw new Error('empty methods response')
            return data as Partial<AuthMethods>
        },

        async passwordLogin(input): Promise<AuthOutcome> {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), 18_000)
            let res: Response
            try {
                res = await postJson('/oidc/login', {
                    flow_id,
                    username: input.username,
                    password: input.password,
                    challenge_token: input.challenge_token,
                    totp_code: input.totp_code,
                }, controller.signal)
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
            return redirectFromBody(body)
        },

        async magicLinkRequest(input): Promise<void> {
            // `return_to` is the flow-resume URL, so following the emailed link
            // lands back on THIS pending flow rather than on the portal. The
            // server re-validates the flow id; a stale one 400s rather than
            // silently signing the user into somewhere else.
            const res = await postJson('/oidc/login/magic-request', {
                flow_id,
                email: input.email,
            })
            const body = await readJson(res)
            if (body.status === 'rate_limited') {
                throw new Error(
                    (body.message as string) ||
                    'Too many requests. Please wait a moment and try again.',
                )
            }
            if (!res.ok) {
                throw new Error(errorMessage(
                    body,
                    "We couldn't send your login link right now. Please try again in a moment.",
                ))
            }
        },

        async otpRequest(input): Promise<OtpRequestResult> {
            const res = await postJson('/oidc/login/otp-request', {
                flow_id,
                email: input.email,
                username: input.username,
            })
            const body = await readJson(res)
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
            const res = await postJson('/oidc/login/otp-verify', {
                flow_id,
                otp_token: input.otp_token,
                code: input.code,
            })
            const body = await readJson(res)
            if (!res.ok) throw new Error(errorMessage(body, 'Verification failed'))
            return redirectFromBody(body)
        },

        async webauthnBegin() {
            const res = await postJson('/auth/webauthn/authenticate/begin', {})
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
            // Flow-aware variant: verifies the assertion AND completes the
            // pending OIDC flow in one server call, so the passkey path cannot
            // leave a user authenticated at the IdP but stranded on this page.
            const res = await postJson('/oidc/login/webauthn-complete', { flow_id, ...input })
            const body = await readJson(res)
            if (!res.ok) throw new Error(errorMessage(body, 'Passkey authentication failed'))
            return redirectFromBody(body)
        },

        oauthUrl: provider => withFlow(`/oidc/login/oauth/${encodeURIComponent(provider)}`),
        samlUrl: tenantId =>
            `${issuer}/saml/login/${encodeURIComponent(tenantId)}` +
            `?return_to=${encodeURIComponent('oidc_flow:' + flow_id)}`,
        cloudflareAccessUrl: () => withFlow('/oidc/login/cf-access'),

        // Registration leaves the flow deliberately: the portal owns sign-up,
        // and coming back through the app restarts a clean authorize request.
        registerUrl: () => 'https://portal.aitherium.com/register',
        forgotPasswordUrl: () => 'https://portal.aitherium.com/forgot-password',
    }
}
