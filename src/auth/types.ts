/**
 * The ONE sign-in contract for AitherOS.
 * ============================================================================
 * Before this module there were TWELVE sign-in implementations: five hand-rolled
 * inline-HTML pages inside AitherIdentity itself (OIDC login, OIDC OTP verify,
 * SAML login, SAML OTP email, SAML OTP verify), Veil's 1238-line login-form,
 * AitherWorkspace's near-copy of it, portal-kit's own LoginPage, and four apps
 * (ForgeIDE, MCPPortal, Elysium, AitherAdmin) that took a PASTED API KEY and
 * never spoke to AitherIdentity at all.
 *
 * The visible symptom was a tenant customer seeing TWO unrelated sign-in screens
 * back to back — portal-kit's card, then the IdP's GitHub-dark page — and
 * neither of them looking like portal.aitherium.com.
 *
 * Everything now renders `<SignIn>`. What differs per host is not the UI, it is
 * the TRANSPORT (which endpoints the actions hit) and the HOST adapter (what
 * happens to a session once one exists). Both are injected, which is what lets
 * the same component render inside Next.js *and* inside a static bundle the
 * Python IdP serves with no React on the server.
 */

export interface SamlTenant {
    tenant_id: string
    idp_provider: string
    login_url: string
}

export interface OAuthProviders {
    github: boolean
    google: boolean
    linkedin: boolean
}

export interface AuthMethods {
    password: boolean
    email_otp: boolean
    totp_2fa: boolean
    webauthn: boolean
    passkeys: boolean
    security_keys: boolean
    saml_sso: boolean
    saml_tenants: SamlTenant[]
    cloudflare_access: boolean
    magic_link: boolean
    oauth_providers: OAuthProviders
    require_2fa: boolean
    secure_methods_only: boolean
    /** True when AitherIdentity could not be reached. Triggers a hard-block
     *  error screen instead of a (misleading) degraded login form. */
    identity_unreachable?: boolean
}

export const DEFAULT_METHODS: AuthMethods = {
    password: true,
    email_otp: true,
    totp_2fa: false,
    webauthn: false,
    passkeys: false,
    security_keys: false,
    saml_sso: false,
    saml_tenants: [],
    cloudflare_access: false,
    magic_link: false,
    oauth_providers: { github: false, google: false, linkedin: false },
    require_2fa: false,
    secure_methods_only: false,
    identity_unreachable: false,
}

/**
 * Buttons the SERVER decided to show — tenant upstream IdP (Entra/Okta) and
 * SAML. These are resolved server-side from the OIDC flow's client_id, never
 * from anything the browser supplied: which tenant a flow belongs to is an
 * authz-adjacent decision (security-review-patterns #2).
 */
export interface UpstreamButton {
    label: string
    href: string
    preset: string
}

/**
 * The result of an authentication attempt.
 *
 * Two hosts, two shapes, one union — this is the whole reason the same
 * component can drive a Next.js BFF and a server-completed OIDC flow:
 *
 *  - `session`  Veil/Next: we hold a token; the host stores it and routes.
 *  - `redirect` Hosted IdP: the flow was completed SERVER-side and an
 *               authorization code was minted. The browser must simply go
 *               where it is told. No token ever reaches this component.
 *  - `twofa`    Password was right, TOTP still owed.
 */
export type AuthOutcome =
    | { kind: 'session'; access_token: string; user: Record<string, unknown> }
    | { kind: 'redirect'; url: string }
    | { kind: 'twofa'; challenge_token: string; username: string; expires_at?: string }

/** Result of an OTP request — deliberately vague about account existence. */
export interface OtpRequestResult {
    /** Absent when the account does not exist (anti-enumeration), present on a real send. */
    otp_token?: string
    /** Self-hosted mode returns the code directly instead of mailing it. */
    code?: string
}

export interface AlphaCapacity {
    limit: number
    remaining: number
    is_open: boolean
    is_unlimited?: boolean
    invite_only_registration?: boolean
    status_reason?: string
    status_message?: string
}

/**
 * Every network call the sign-in UI can make. One implementation per host.
 *
 * Contract for implementors: a method REJECTS on failure with a human-readable
 * Error. It must never resolve to a falsy/empty success — the "silent no-op"
 * class in security-review-patterns #5 is exactly how a totally inert login
 * surface passes every test that only asserts denials.
 */
export interface AuthTransport {
    /** Current auth methods. Rejects if Identity is unreachable — the caller
     *  distinguishes a cold-start blip from an outage via its retry policy. */
    fetchMethods(): Promise<Partial<AuthMethods>>

    /** Registration capacity for the "Create Account" CTA. Best-effort. */
    fetchAlphaCapacity?(): Promise<AlphaCapacity>

    /** Username + password (or api key), optionally completing a TOTP challenge. */
    passwordLogin(input: {
        username: string
        password?: string
        api_key?: string
        remember_me: boolean
        challenge_token?: string
        totp_code?: string
    }): Promise<AuthOutcome>

    /** Email a one-time login link. */
    magicLinkRequest(input: { email: string; return_to: string }): Promise<void>

    /** Email a 6-digit code. */
    otpRequest(input: { email?: string; username?: string }): Promise<OtpRequestResult>

    /** Exchange the 6-digit code. */
    otpVerify(input: { otp_token: string; code: string }): Promise<AuthOutcome>

    /** WebAuthn/passkey — discoverable-credential flow. */
    webauthnBegin(): Promise<{ options: PublicKeyCredentialRequestOptions_JSON; state_token: string }>
    webauthnComplete(input: {
        state_token: string
        assertion_response: {
            credentialId: string
            clientDataJSON: string
            authenticatorData: string
            signature: string
        }
    }): Promise<AuthOutcome>

    /** Navigation targets for federated identity — plain hrefs, no fetch. */
    oauthUrl(provider: string, returnUrl: string): string
    samlUrl(tenantId: string, returnUrl: string): string
    cloudflareAccessUrl(returnUrl: string, provider?: string): string

    /** Where "Create Account" / "Forgot password" go. Hosts differ. */
    registerUrl(returnUrl: string): string
    forgotPasswordUrl(): string
}

/** The JSON form of PublicKeyCredentialRequestOptions as the server sends it. */
export interface PublicKeyCredentialRequestOptions_JSON {
    challenge: string
    allowCredentials?: Array<{ id: string; type: string; transports?: string[] }>
    [k: string]: unknown
}

/** Minimal notification surface. Hosts with a real toaster pass theirs. */
export interface Notifier {
    success(message: string): void
    error(message: string): void
    info(message: string, opts?: { duration?: number }): void
}

/**
 * What the HOST does once authentication succeeds. Veil writes the canonical
 * cookie + primes its AuthProvider; the hosted IdP page never sees a token at
 * all (its outcomes are `redirect`), so it does not implement this.
 */
export interface SignInHost {
    /** Called with a real session. Return the URL to navigate to, or null to
     *  let the component use `returnUrl`. */
    onSession?(session: {
        access_token: string
        user: Record<string, unknown>
        rememberMe: boolean
    }): Promise<string | null> | string | null
    /** Anchor renderer — Next apps pass a `Link` wrapper for client routing. */
    Link?: React.ComponentType<{ href: string; className?: string; children: React.ReactNode }>
    notify?: Notifier
    /** Local-node sign-in ("Continue as <name> from this device"). When set,
     *  the card may — after the visitor's explicit opt-in — ask the awdk
     *  daemon on 127.0.0.1:9001 who is signed in, and on a click navigate
     *  top-level to `redeemUrl?ticket=…&return=returnUrl`, which sets the
     *  platform cookie and comes back. Absent = the block never renders and
     *  loopback is never touched. See awkit `auth/local-device.tsx`. */
    localHandoff?: { redeemUrl: string; returnUrl: string }
}

/** Server-rendered context for the hosted (IdP) page. */
export interface HostedFlowContext {
    flow_id: string
    /** Display-only. Resolved server-side from the OIDC client registration. */
    client_name?: string
    client_host?: string
    upstream_buttons?: UpstreamButton[]
    /** Public issuer base, e.g. https://idp.aitherium.com/identity */
    issuer: string
    methods?: Partial<AuthMethods>
    error?: string
    /** Which sub-flow this page is serving. */
    mode?: 'oidc' | 'saml' | 'saml_otp_email' | 'saml_otp_verify' | 'oidc_otp_verify'
    /** Pre-seeded OTP state when the server already sent a code. */
    otp_token?: string
    otp_email?: string
    /** Set by the server when the compiled bundle could not be found on disk.
     *  Renders a visible degraded banner — never a silent fallback. */
    degraded?: boolean
}
