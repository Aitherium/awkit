/**
 * Open-redirect guard for post-auth return URLs.
 *
 * Accepts only same-origin relative paths: must start with a single `/`
 * (rejects `//host` protocol-relative and `/\host` backslash tricks), and the
 * check is re-applied AFTER URL normalization so dot-segment smuggling
 * (`/..//evil.com` → `//evil.com`) can't normalize into a protocol-relative
 * path. Anything else falls back to `fallback`.
 *
 * Ported verbatim from AitherVeil's `src/lib/safe-return-url.ts` (Athena
 * finding 2026-07-05) when the sign-in UI moved here. Keep the two in step —
 * `check_signin_surface_parity.py` asserts they have not diverged, because a
 * weakened copy of an open-redirect guard is worse than no copy: it looks
 * reviewed.
 */
const SAFE_LEADING = /^\/(?![/\\])/

/**
 * Absolute return targets that are allowed DESPITE being cross-origin.
 *
 * Exists for exactly one flow: the IdP delegates a pending OIDC authorization to
 * this login page and needs the browser sent back to `<issuer>/oidc/resume` once
 * a session exists. Without it a tenant-app user with a Google address and no
 * password cannot sign in at all, because the hosted IdP page can only carry
 * password + email OTP to completion.
 *
 * The match is on `URL.origin` and is EXACT — never `startsWith`, never a suffix
 * test. `https://idp.aitherium.com.evil.test` shares a prefix with the issuer and
 * must not match; comparing parsed origins is what makes that impossible rather
 * than merely unlikely.
 *
 * Empty by default, so every existing caller keeps today's same-origin-only
 * behaviour. Opting in is a deliberate act at one call site, not a global
 * relaxation of the guard.
 */
export function sanitizeReturnUrl(
    raw: string | null | undefined,
    fallback = '/dashboard',
    allowedOrigins: readonly string[] = [],
): string {
    if (!raw) return fallback

    // Absolute + explicitly allowlisted origin. Checked BEFORE the relative
    // path rules, since an absolute URL fails SAFE_LEADING by construction.
    if (allowedOrigins.length > 0 && /^https:\/\//i.test(raw)) {
        try {
            const abs = new URL(raw)
            // https only: an allowlisted origin reached over http would send a
            // freshly-minted session cookie across a cleartext hop.
            if (abs.protocol === 'https:' && allowedOrigins.includes(abs.origin)) {
                return abs.toString()
            }
        } catch {
            return fallback
        }
        return fallback
    }

    if (!SAFE_LEADING.test(raw)) return fallback
    try {
        // Dummy base: if the input smuggles a host, the origin changes.
        const normalized = new URL(raw, 'https://relative.invalid')
        if (normalized.origin !== 'https://relative.invalid') return fallback
        if (!SAFE_LEADING.test(normalized.pathname)) return fallback
        return normalized.pathname + normalized.search + normalized.hash
    } catch {
        return fallback
    }
}

/**
 * Absolute form of a return URL, anchored to the CURRENT origin.
 *
 * Magic-link needs this: a relative `return_to` made the backend fall back to
 * the default Veil host, so a user who started on localhost:3080 (or on a
 * tenant subdomain) was landed somewhere else entirely, with an unhydrated
 * AuthProvider — which reads as a login bounce, not a redirect bug.
 */
export function absoluteReturnUrl(returnUrl: string): string {
    if (typeof window === 'undefined') return returnUrl
    try {
        return new URL(returnUrl, window.location.origin).toString()
    } catch {
        return returnUrl
    }
}
