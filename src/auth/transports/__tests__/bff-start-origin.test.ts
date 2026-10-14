/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://acme.aitherium.com/login/"}
 *
 * UX audit live-ui-02: on a tenant page whose auth routes live on another
 * origin (api.aitherium.com), the OAuth link must carry the PAGE origin, or the
 * start route only sees api.* and the visitor is returned there.
 */
import { createBffTransport, crossOriginStartOrigin } from '../bff'

describe('bff oauthUrl start origin', () => {
    it('cross-origin base: carries the page origin as startOrigin', () => {
        const t = createBffTransport({ basePath: 'https://api.aitherium.com/api/auth' })
        const url = new URL(t.oauthUrl('github', '/workspace/dashboard/'))
        expect(url.origin).toBe('https://api.aitherium.com')
        expect(url.pathname).toBe('/api/auth/oauth/github')
        expect(url.searchParams.get('returnUrl')).toBe('/workspace/dashboard/')
        expect(url.searchParams.get('startOrigin')).toBe('https://acme.aitherium.com')
    })

    it('relative base: no startOrigin (the server sees the page host itself)', () => {
        const t = createBffTransport()
        expect(t.oauthUrl('github', '/x')).toBe('/api/auth/oauth/github?returnUrl=%2Fx')
    })

    it('same-origin absolute base: no startOrigin', () => {
        expect(crossOriginStartOrigin('https://acme.aitherium.com/api/auth')).toBeNull()
    })
})
