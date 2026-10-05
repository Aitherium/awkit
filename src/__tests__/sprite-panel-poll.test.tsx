/**
 * SpritePanel must poll, not loop. Live on 2026-10-05 the panel fired /me/status,
 * /me/appearance and /me/guide ~25 times a second: the polling effect depended on
 * `sprite` (which every status fetch replaces) and `extraHeaders = {}` was a new object
 * every render. Runs under AitherVeil's jest (roots include awkit/src).
 */
import React from 'react'
import { act, render } from '@testing-library/react'
import SpritePanel from '../panels/SpritePanel'
import SpriteGuideCard from '../panels/SpriteGuideCard'

const SPRITE = {
  name: 'Pip', stage: 'baby', form: 'base', mood_label: 'content', dormant: false, age_days: 3,
  needs: { hunger: 40, energy: 80, hygiene: 70, bond: 55 },
  mood: { valence: 0.4, arousal: 0.3 },
}
const GUIDE = {
  temperament: 'bright', available_acts: ['train'], offer: null,
  stats: { strength: 1, dexterity: 1, speed: 1 }, stat_cap: 10,
  ladder: { rung: 1, of: 5, next_foe: 'Moth', wins: 0, losses: 0 },
  charms: [], equipped: [],
}

function installFetch() {
  const calls: string[] = []
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
    calls.push(String(url))
    const u = String(url)
    const body = u.endsWith('/me/status') ? SPRITE
      : u.endsWith('/me/appearance') ? { stage: 'baby', form: 'base', mood_label: 'content', assets: {} }
      : u.endsWith('/me/guide') ? GUIDE
      : {}
    return { status: 200, ok: true, json: async () => body } as unknown as Response
  })
  return calls
}

const count = (calls: string[], suffix: string) => calls.filter(u => u.endsWith(suffix)).length

async function settle() {
  // Let every fetch resolve and every resulting render commit, several rounds over.
  for (let i = 0; i < 20; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 5)) })
  }
}

describe('SpritePanel polling', () => {
  it('fetches status and appearance once on mount, not in a loop (default headers)', async () => {
    const calls = installFetch()
    render(<SpritePanel apiBase="/api/sprite" />)
    await settle()
    expect(count(calls, '/me/status')).toBeLessThanOrEqual(1)
    expect(count(calls, '/me/appearance')).toBeLessThanOrEqual(1)
  })

  it('does not loop when the caller passes a fresh headers object each render', async () => {
    const calls = installFetch()
    const { rerender } = render(<SpritePanel apiBase="/api/sprite" extraHeaders={{ 'X-T': '1' }} />)
    await settle()
    rerender(<SpritePanel apiBase="/api/sprite" extraHeaders={{ 'X-T': '1' }} />)
    await settle()
    expect(count(calls, '/me/status')).toBeLessThanOrEqual(1)
  })
})

describe('SpriteGuideCard', () => {
  it('loads /me/guide once, not on every render', async () => {
    const calls = installFetch()
    render(<SpriteGuideCard apiBase="/api/sprite" name="Pip" />)
    await settle()
    expect(count(calls, '/me/guide')).toBeLessThanOrEqual(1)
  })
})
