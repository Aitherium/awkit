/**
 * awkit's copy of getRelayWsUrl() follows the same host rule as Veil's
 * (AitherVeil/src/lib/service-urls.ts): an API-less host dials the live API
 * origin, every host with its own server stays same-origin. awkit cannot
 * import Veil, so the rule is mirrored and pinned here.
 */
import * as serviceUrls from '../service-urls'

const { getRelayWsUrl } = serviceUrls
const REAL_LOCATION = window.location

function setLocation(href: string) {
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: new URL(href) })
}

describe('awkit getRelayWsUrl', () => {
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: REAL_LOCATION })
    delete process.env.NEXT_PUBLIC_RELAY_WS_URL
    delete process.env.NEXT_PUBLIC_LIVE_API_ORIGIN
  })

  it.each([
    'https://aitherium.com/?mode=overlay',
    'https://www.aitherium.com/',
    'https://aitherium.github.io/',
  ])('dials the live API host from %s', (href) => {
    setLocation(href)
    expect(getRelayWsUrl()).toBe('wss://api.aitherium.com/ws/chat')
  })

  it('follows NEXT_PUBLIC_LIVE_API_ORIGIN on the apex', () => {
    setLocation('https://aitherium.com/')
    process.env.NEXT_PUBLIC_LIVE_API_ORIGIN = 'https://live.example.test/'
    expect(getRelayWsUrl()).toBe('wss://live.example.test/ws/chat')
  })

  it('lets NEXT_PUBLIC_RELAY_WS_URL win on the apex', () => {
    setLocation('https://aitherium.com/')
    process.env.NEXT_PUBLIC_RELAY_WS_URL = 'wss://irc.aitherium.com/ws/chat'
    expect(getRelayWsUrl()).toBe('wss://irc.aitherium.com/ws/chat')
  })

  it.each([
    ['the live desktop host', 'https://desktop.aitherium.com/', 'wss://desktop.aitherium.com/ws/chat'],
    ['a tenant subdomain', 'https://acme.aitherium.com/workspace', 'wss://acme.aitherium.com/ws/chat'],
    ['a tenant custom domain', 'https://portal.example.org/', 'wss://portal.example.org/ws/chat'],
  ])('%s stays same-origin', (_name, href, expected) => {
    setLocation(href)
    expect(getRelayWsUrl()).toBe(expected)
  })

  it('exports no RELAY_WS_URL constant frozen at import time', () => {
    expect('RELAY_WS_URL' in serviceUrls).toBe(false)
  })
})
