/**
 * WebAuthn base64url <-> ArrayBuffer plumbing.
 *
 * The server speaks base64url JSON; `navigator.credentials` speaks
 * ArrayBuffer. Getting this wrong does not throw — it produces a challenge the
 * authenticator silently refuses to sign, which surfaces as "the passkey
 * button does nothing".
 */

/** Base64url encode an ArrayBuffer. */
export function bufferToBase64url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let str = ''
    for (const b of bytes) str += String.fromCharCode(b)
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Base64url decode to Uint8Array. */
export function base64urlToBuffer(b64: string): Uint8Array {
    const padded = b64.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

/** Map IdP provider names to friendly display labels. */
export function idpLabel(provider: string): string {
    const map: Record<string, string> = {
        azure_ad: 'Microsoft Entra ID',
        entra_id: 'Microsoft Entra ID',
        okta: 'Okta',
        google: 'Google Workspace',
        onelogin: 'OneLogin',
        ping: 'PingIdentity',
        jumpcloud: 'JumpCloud',
        auth0: 'Auth0',
        keycloak: 'Keycloak',
    }
    return map[provider] || provider.charAt(0).toUpperCase() + provider.slice(1)
}
