/**
 * Owner report 2026-11-08: the Sprite app showed "rendering art… 0/8" forever (progress on
 * SpriteAtelier stills that nothing displays) and every stat at 0% in red after he was away.
 * The panel must not fetch or pump generated art, an away-sleeping sprite says so kindly with
 * no red bars, and red is kept for genuinely low needs while the sprite is awake.
 * Runs under AitherVeil's jest (roots include awkit/src).
 */
import React from 'react'
import { act, render, screen } from '@testing-library/react'
import SpritePanel, { needIsLow } from '../panels/SpritePanel'

const BASE = {
  name: 'BB-00', stage: 'baby', form: 'balanced', age_days: 23,
  mood: { valence: -0.3, arousal: -0.3 },
}

function installFetch(status: Record<string, unknown>) {
  const calls: Array<{ url: string; method: string }> = []
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, method: (init?.method || 'GET').toUpperCase() })
    const body = u.endsWith('/me/status') ? status
      : u.endsWith('/me/appearance') ? {
        stage: 'baby', form: 'balanced', mood_label: 'sad',
        assets: { a: { status: 'pending', file: null, hash: 'a' }, b: { status: 'failed', file: null, hash: 'b' } },
      }
      : null
    // Anything else (guide, snapshot, knowledge) is simply absent here.
    if (body === null) return { status: 404, ok: false, json: async () => ({}) } as unknown as Response
    return { status: 200, ok: true, json: async () => body } as unknown as Response
  })
  return calls
}

async function settle() {
  for (let i = 0; i < 20; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 5)) })
  }
}

describe('SpritePanel without the hidden art pipeline', () => {
  it('never fetches or pumps generated art and shows no "rendering art" badge', async () => {
    const calls = installFetch({
      ...BASE, mood_label: 'content', dormant: false, dormant_reason: '',
      needs: { hunger: 0.8, energy: 0.8, hygiene: 0.8, bond: 0.8 },
    })
    render(<SpritePanel apiBase="/api/sprite" />)
    await settle()
    expect(calls.filter(c => c.url.includes('/me/appearance'))).toEqual([])
    expect(screen.queryByText(/rendering art/i)).toBeNull()
  })

  it('an away-sleeping sprite is asleep, not neglected, and shows no red', async () => {
    installFetch({
      ...BASE, mood_label: 'dormant', dormant: true, dormant_reason: 'away',
      needs: { hunger: 0.2, energy: 0.4, hygiene: 0.6, bond: 0.1 },
    })
    const { container } = render(<SpritePanel apiBase="/api/sprite" />)
    await settle()
    expect(screen.getByText(/curled up to sleep while you were away/)).toBeTruthy()
    expect(screen.getByText(/Wake BB-00/)).toBeTruthy()
    expect(screen.queryByText(/from neglect/)).toBeNull()
    expect(container.querySelectorAll('[data-low="true"]').length).toBe(0)
  })

  it('a just-woken sprite says it missed you', async () => {
    installFetch({
      ...BASE, mood_label: 'sleepy', dormant: false, dormant_reason: '', missed_you: true,
      needs: { hunger: 0.35, energy: 0.35, hygiene: 0.35, bond: 0.35 },
    })
    render(<SpritePanel apiBase="/api/sprite" />)
    await settle()
    expect(screen.getByTestId('sprite-missed-you')).toBeTruthy()
  })
})

describe('needIsLow', () => {
  it('is red only for a low need on an awake sprite', () => {
    expect(needIsLow(0.1, false)).toBe(true)
    expect(needIsLow(0.1, true)).toBe(false)
    expect(needIsLow(0.35, false)).toBe(false)
  })
})
