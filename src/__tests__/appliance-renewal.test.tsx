// @vitest-environment jsdom
/**
 * RenewalBanner / bannerFor: every lifecycle phase maps to the right tone and copy, and
 * every message keeps the contract's promise that the appliance keeps running
 * (aither-license-lifecycle(7)). The component is rendered for real (react-dom in jsdom)
 * against a fake license source, including the 501/503 paths that must render nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import type { ReactElement } from 'react'
import RenewalBanner, { bannerFor, readLifecycle, LAPSED_BODY } from '../appliance/RenewalBanner'
import type { Lifecycle, Phase } from '../appliance/RenewalBanner'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DAY = 86400
const NOW = 1_790_000_000
const EXP = NOW + 20 * DAY

function lc(over: Partial<Lifecycle> = {}): Lifecycle {
  return {
    schema: 1,
    phase: 'active',
    state: 'valid',
    exp: EXP,
    days_to_expiry: 20,
    grace_until: EXP + 30 * DAY,
    reminder: 'none',
    clock: { state: 'ok', trusted_now: NOW, wall_now: NOW },
    gates: { updates: true, 'private-pulls': true, 'component-install': true, packs: true },
    keeps_serving: ['serving', 'inference', 'components', 'console', 'local-api', 'rollback', 'license-renew'],
    ...over,
  }
}

describe('bannerFor', () => {
  it('shows nothing for perpetual, unlicensed, unknown and a far-off active license', () => {
    expect(bannerFor(lc({ phase: 'perpetual', exp: 0, days_to_expiry: null, grace_until: null }))).toBeNull()
    expect(bannerFor(lc({ phase: 'unlicensed', state: 'unlicensed', exp: null }))).toBeNull()
    expect(bannerFor(lc({ phase: 'unknown', state: null }))).toBeNull()
    expect(bannerFor(lc({ phase: 'active', days_to_expiry: 90, reminder: 'none' }))).toBeNull()
    expect(bannerFor(null)).toBeNull()
  })

  it('active inside the reminder window (60..31 days) is an info banner with the days', () => {
    const b = bannerFor(lc({ phase: 'active', days_to_expiry: 45, reminder: 'info' }))
    expect(b?.tone).toBe('info')
    expect(b?.title).toBe('License expires in 45 days')
    expect(b?.body).toContain('keeps running')
    expect(b?.cta).toEqual({ label: 'Renew', href: '#/license' })
  })

  it('renew-soon is warn, and danger at 7 days or fewer', () => {
    const warn = bannerFor(lc({ phase: 'renew-soon', days_to_expiry: 20, reminder: 'warn' }))
    expect(warn?.tone).toBe('warn')
    expect(warn?.title).toBe('License expires in 20 days')
    const day = new Date(EXP * 1000).toISOString().slice(0, 10)
    expect(warn?.body).toContain(`on ${day}`)
    const urgent = bannerFor(lc({ phase: 'renew-soon', days_to_expiry: 1, reminder: 'urgent' }))
    expect(urgent?.tone).toBe('danger')
    expect(urgent?.title).toBe('License expires tomorrow')
    expect(bannerFor(lc({ phase: 'renew-soon', days_to_expiry: 0, reminder: 'urgent' }))?.title).toBe(
      'License expires today',
    )
  })

  it('grace is warn, names the pause date and counts the days left from the trusted clock', () => {
    const b = bannerFor(
      lc({
        phase: 'grace',
        state: 'expired',
        days_to_expiry: -3,
        reminder: 'grace',
        clock: { state: 'ok', trusted_now: EXP + 3 * DAY, wall_now: EXP + 3 * DAY },
      }),
    )
    expect(b?.tone).toBe('warn')
    expect(b?.body).toContain('Your appliance keeps running.')
    expect(b?.body).toContain(new Date((EXP + 30 * DAY) * 1000).toISOString().slice(0, 10))
    expect(b?.body).toContain('(27 days left)')
  })

  it('lapsed says it keeps running and that updates are paused, word for word', () => {
    const b = bannerFor(lc({ phase: 'lapsed', state: 'expired', days_to_expiry: -40, reminder: 'lapsed' }))
    expect(b?.tone).toBe('danger')
    expect(b?.body).toBe('Your appliance keeps running. Updates paused until you renew.')
    expect(b?.body).toBe(LAPSED_BODY)
  })

  it('revoked and invalid are danger and still say the appliance keeps running', () => {
    for (const phase of ['revoked', 'invalid'] as Phase[]) {
      const b = bannerFor(lc({ phase, state: phase, reminder: 'lapsed' }))
      expect(b?.tone).toBe('danger')
      expect(b?.body).toContain('keeps running')
    }
  })

  it('no banner ever threatens to stop serving', () => {
    const phases: Phase[] = ['active', 'renew-soon', 'grace', 'lapsed', 'revoked', 'invalid']
    for (const phase of phases) {
      const b = bannerFor(lc({ phase, reminder: phase === 'active' ? 'info' : 'warn' }))
      const text = `${b?.title} ${b?.body}`.toLowerCase()
      for (const bad of ['read-only', 'shut down', 'stop serving', 'will stop working', 'disabled']) {
        expect(text).not.toContain(bad)
      }
    }
  })

  it('adds a clock hint when the clock is not trusted, and none when it is', () => {
    const ok = bannerFor(lc({ phase: 'renew-soon', reminder: 'warn' }))
    expect(ok?.hint).toBeUndefined()
    const unsynced = bannerFor(
      lc({ phase: 'renew-soon', reminder: 'warn', clock: { state: 'unsynced', trusted_now: NOW, wall_now: NOW } }),
    )
    expect(unsynced?.hint).toMatch(/not synchronised/)
    const rolled = bannerFor(
      lc({ phase: 'lapsed', reminder: 'lapsed', clock: { state: 'rolled-back', trusted_now: NOW, wall_now: 0 } }),
    )
    expect(rolled?.hint).toMatch(/behind the last trusted time/)
  })
})

describe('readLifecycle', () => {
  it('takes .lifecycle from the license status, or a bare lifecycle, and rejects junk', () => {
    const doc = lc({ phase: 'grace' })
    expect(readLifecycle({ state: 'expired', lifecycle: doc })?.phase).toBe('grace')
    expect(readLifecycle(doc)?.phase).toBe('grace')
    expect(readLifecycle({ state: 'valid' })).toBeNull()
    expect(readLifecycle({ lifecycle: { phase: 'bogus', clock: {} } })).toBeNull()
    expect(readLifecycle(null)).toBeNull()
  })
})

describe('<RenewalBanner>', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  async function render(el: ReactElement) {
    await act(async () => {
      root.render(el)
    })
    await act(async () => {
      await Promise.resolve()
    })
  }

  it('fetches the license and renders the lapsed banner with a Renew link', async () => {
    const license = vi.fn(async () => ({
      state: 'ok',
      status: 200,
      data: { state: 'expired', lifecycle: lc({ phase: 'lapsed', state: 'expired', reminder: 'lapsed' }) },
    }))
    await render(<RenewalBanner client={{ license }} />)
    expect(license).toHaveBeenCalledTimes(1)
    const el = host.querySelector('[data-testid="renewal-banner"]')
    expect(el).not.toBeNull()
    expect(el?.getAttribute('role')).toBe('alert')
    expect(el?.textContent).toContain('Your appliance keeps running. Updates paused until you renew.')
    const a = el?.querySelector('a')
    expect(a?.getAttribute('href')).toBe('#/license')
    expect(a?.textContent).toBe('Renew')
  })

  it.each([
    ['501 not an appliance', { state: 'not-an-appliance', status: 501, data: null }],
    ['503 console down', { state: 'unavailable', status: 503, data: null }],
    ['200 without a lifecycle', { state: 'ok', status: 200, data: { state: 'valid' } }],
  ])('renders nothing on %s', async (_name, res) => {
    await render(<RenewalBanner client={{ license: async () => res }} />)
    expect(host.innerHTML).toBe('')
  })

  it('renders nothing when the fetch rejects', async () => {
    await render(<RenewalBanner client={{ license: () => Promise.reject(new Error('boom')) }} />)
    expect(host.innerHTML).toBe('')
  })

  it('renders from a lifecycle prop without fetching, with the clock hint', async () => {
    const license = vi.fn(async () => ({ state: 'ok', data: null }))
    await render(
      <RenewalBanner
        client={{ license }}
        lifecycle={lc({ phase: 'grace', reminder: 'grace', clock: { state: 'unsynced', trusted_now: EXP, wall_now: EXP } })}
      />,
    )
    expect(license).not.toHaveBeenCalled()
    expect(host.querySelector('[data-tone="warn"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="renewal-clock-hint"]')?.textContent).toMatch(/not synchronised/)
  })

  it('renders nothing for a perpetual license', async () => {
    await render(<RenewalBanner lifecycle={lc({ phase: 'perpetual', exp: 0, grace_until: null })} />)
    expect(host.innerHTML).toBe('')
  })
})
