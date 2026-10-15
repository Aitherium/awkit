/**
 * The awkit desktop's starfield is OPT-IN (owner 2026-10-14) and follows the
 * Living Desktop's "Animated background" switch, stored by AitherVeil's
 * universe-settings.ts under the key pinned below (that suite pins it too).
 */
import { AMBIENT_SETTINGS_KEY, animatedBackgroundAllowed } from '../ambient-motion'

function setReduced(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduced : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
}

describe('animatedBackgroundAllowed', () => {
  beforeEach(() => { localStorage.clear(); setReduced(false) })

  it('shares the Living Desktop key', () => {
    expect(AMBIENT_SETTINGS_KEY).toBe('aitheros:universe-settings:v1')
  })
  it('is off by default', () => {
    expect(animatedBackgroundAllowed()).toBe(false)
  })
  it('is off for settings stored before the switch existed', () => {
    localStorage.setItem(AMBIENT_SETTINGS_KEY, JSON.stringify({ enabled: true }))
    expect(animatedBackgroundAllowed()).toBe(false)
  })
  it('follows an explicit ON', () => {
    localStorage.setItem(AMBIENT_SETTINGS_KEY, JSON.stringify({ animated: true }))
    expect(animatedBackgroundAllowed()).toBe(true)
  })
  it('reduced motion forces it off', () => {
    localStorage.setItem(AMBIENT_SETTINGS_KEY, JSON.stringify({ animated: true }))
    setReduced(true)
    expect(animatedBackgroundAllowed()).toBe(false)
  })
  it('garbage in storage is off, never a throw', () => {
    localStorage.setItem(AMBIENT_SETTINGS_KEY, '{not json')
    expect(animatedBackgroundAllowed()).toBe(false)
  })
})
