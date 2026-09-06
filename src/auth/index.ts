/**
 * `awkit/auth` — the ONE AitherIdentity sign-in surface.
 *
 * See `types.ts` for why this exists (twelve implementations, one of which
 * showed one tenant's customers two different sign-in screens back to back).
 */

export { default as SignIn } from './SignIn'
export type { SignInProps } from './SignIn'
export { createBffTransport } from './transports/bff'
export type { BffTransportOptions } from './transports/bff'
export { createIdentityTransport } from './transports/identity'
export type { IdentityTransportOptions } from './transports/identity'
export { sanitizeReturnUrl, absoluteReturnUrl } from './return-url'
export { idpLabel, bufferToBase64url, base64urlToBuffer } from './webauthn'
export { domNotifier } from './notify'
export { DEFAULT_METHODS } from './types'
export type {
    AlphaCapacity,
    AuthMethods,
    AuthOutcome,
    AuthTransport,
    HostedFlowContext,
    Notifier,
    OAuthProviders,
    OtpRequestResult,
    SamlTenant,
    SignInHost,
    UpstreamButton,
} from './types'
