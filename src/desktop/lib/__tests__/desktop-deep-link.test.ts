/**
 * aitherium.com/desktop?app=<id> (the AitherDesktop shell). Measured 2026-10-01: elysium,
 * media, sprite, persona and desktop landed on Files + Terminal; and the shell dialled
 * localhost:8136 / :8115 from the public apex. Reverting either fix fails this suite.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { DESKTOP_DEEP_LINK_ALIASES, resolveDesktopDeepLink } from '../desktop-deep-link'
import { localDaemonFetch, localDaemonsReachable } from '../desktop-file-store'

const SHIPPED = new Set(['gobbonet', 'mediaforge', 'darkmatters', 'terminal'])
const has = (id: string) => SHIPPED.has(id)

describe('resolveDesktopDeepLink', () => {
  it('opens a widget this shell ships', () => {
    expect(resolveDesktopDeepLink('?app=darkmatters', has)).toEqual({ kind: 'widget', widgetId: 'darkmatters' })
  })

  it('opens an alias as its widget (Elysium IS the gobbonet widget)', () => {
    expect(resolveDesktopDeepLink('?app=elysium', has)).toEqual({ kind: 'widget', widgetId: 'gobbonet' })
    expect(resolveDesktopDeepLink('?app=media-forge', has)).toEqual({ kind: 'widget', widgetId: 'mediaforge' })
    expect(DESKTOP_DEEP_LINK_ALIASES.elysium).toBe('gobbonet')
  })

  it('hands a Living Desktop id it has no window for to the host', () => {
    for (const id of ['media', 'sprite', 'persona', 'desktop']) {
      expect(resolveDesktopDeepLink(`?shell=aither-desktop&app=${id}`, has)).toEqual({ kind: 'handoff', appId: id })
    }
  })

  it('ignores a missing or malformed id', () => {
    expect(resolveDesktopDeepLink('', has)).toBeNull()
    expect(resolveDesktopDeepLink('?app=', has)).toBeNull()
    expect(resolveDesktopDeepLink('?app=../evil', has)).toBeNull()
    expect(resolveDesktopDeepLink('?app=Media%20Forge', has)).toBeNull()
  })

  it('the shell routes ?app= through it and hands unresolved ids to onUnresolvedApp', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'desktop', 'desktop-shell.tsx'), 'utf8')
    expect(src).toMatch(/resolveDesktopDeepLink\(window\.location\.search/)
    expect(src).toMatch(/onUnresolvedApp\?\.\(link\.appId\)/)
    expect(src).toMatch(/onUnresolvedApp=\{onUnresolvedApp\}/)
  })
})

describe('local daemons (Strata :8136, Recover :8115) are never dialled from a public origin', () => {
  it('judges the host', () => {
    expect(localDaemonsReachable('aitherium.com')).toBe(false)
    expect(localDaemonsReachable('api.aitherium.com')).toBe(false)
    expect(localDaemonsReachable('localhost')).toBe(true)
    expect(localDaemonsReachable('127.0.0.1')).toBe(true)
    expect(localDaemonsReachable('192.168.1.20')).toBe(true)
  })

  it('rejects without a request on a public origin', async () => {
    const spy = jest.fn()
    const realFetch = (globalThis as { fetch?: unknown }).fetch
    ;(globalThis as { fetch?: unknown }).fetch = spy
    const loc = jest.spyOn(window, 'location', 'get').mockReturnValue({ hostname: 'aitherium.com' } as Location)
    try {
      await expect(localDaemonFetch('http://localhost:8136/strata/stats')).rejects.toThrow()
      expect(spy).not.toHaveBeenCalled()
    } finally {
      loc.mockRestore()
      ;(globalThis as { fetch?: unknown }).fetch = realFetch
    }
  })

  it('no raw fetch to a local daemon is left in the file store or the file manager', () => {
    const lib = readFileSync(join(__dirname, '..', 'desktop-file-store.ts'), 'utf8')
    const fm = readFileSync(join(__dirname, '..', '..', 'components', 'desktop', 'file-manager-pro.tsx'), 'utf8')
    for (const src of [lib, fm]) expect(src).not.toMatch(/\bfetch\(`\$\{(STRATA|RECOVER)_BASE/)
  })
})
