/**
 * SpriteCosmeticsCard is the wardrobe door for /me/cosmetics: it shows the
 * catalog by slot, equips/unequips through the service, explains a 402 for a premium
 * item, and loads once rather than looping on a fresh headers object.
 * Runs under AitherVeil's jest (roots include awkit/src).
 */
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import SpriteCosmeticsCard, { type CosmeticsView } from '../panels/SpriteCosmeticsCard'

const VIEW: CosmeticsView = {
  entitled: false,
  entitlement: 'sprite_cosmetics',
  equipped: [],
  inactive: [],
  catalog: [
    { id: 'hat_leaf', name: 'Leaf Cap', slot: 'hat', tier: 'base', owned: true, equipped: false },
    { id: 'hat_crown', name: 'Crown', slot: 'hat', tier: 'premium', owned: false, equipped: false },
  ],
}
const EQUIPPED: CosmeticsView = {
  ...VIEW,
  equipped: ['hat_leaf'],
  catalog: VIEW.catalog.map(c => (c.id === 'hat_leaf' ? { ...c, equipped: true } : c)),
}

type Call = { url: string; method: string; body?: string }

function installFetch(postStatus = 200) {
  const calls: Call[] = []
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url: String(url), method, body: init?.body as string | undefined })
    if (method === 'GET') {
      return { status: 200, ok: true, json: async () => VIEW } as unknown as Response
    }
    const ok = postStatus === 200
    return {
      status: postStatus, ok,
      json: async () => (ok ? EQUIPPED : { detail: 'premium' }),
    } as unknown as Response
  })
  return calls
}

async function settle() {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 5)) })
  }
}

describe('SpriteCosmeticsCard', () => {
  it('loads the catalog once and renders it by slot', async () => {
    const calls = installFetch()
    const { rerender } = render(<SpriteCosmeticsCard apiBase="/api/sprite" name="Pip" extraHeaders={{ 'X-T': '1' }} />)
    await settle()
    rerender(<SpriteCosmeticsCard apiBase="/api/sprite" name="Pip" extraHeaders={{ 'X-T': '1' }} />)
    await settle()
    expect(calls.filter(c => c.url === '/api/sprite/me/cosmetics')).toHaveLength(1)
    expect(screen.getByText('Leaf Cap')).toBeTruthy()
    expect(screen.getByText(/Crown/)).toBeTruthy()
  })

  it('equips an owned item through /me/cosmetics/equip and shows it pressed', async () => {
    const calls = installFetch()
    render(<SpriteCosmeticsCard apiBase="/api/sprite" name="Pip" />)
    await settle()
    await act(async () => { fireEvent.click(screen.getByText('Leaf Cap')) })
    await settle()
    const post = calls.find(c => c.method === 'POST')
    expect(post?.url).toBe('/api/sprite/me/cosmetics/equip')
    expect(JSON.parse(post?.body ?? '{}')).toEqual({ cosmetic_id: 'hat_leaf' })
    expect(screen.getByText('Leaf Cap').getAttribute('aria-pressed')).toBe('true')
  })

  it('explains a premium refusal (402) instead of failing silently', async () => {
    installFetch(402)
    render(<SpriteCosmeticsCard apiBase="/api/sprite" name="Pip" />)
    await settle()
    await act(async () => { fireEvent.click(screen.getByText(/Crown/)) })
    await settle()
    expect(screen.getByRole('status').textContent).toMatch(/premium/i)
  })

  it('stays hidden, without throwing, when a 200 body is not a wardrobe', async () => {
    // A mock (or an older service) that answers every URL with the sprite status must
    // not crash the card -- inside SpritePanel that throw unmounted the whole panel.
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => (
      { status: 200, ok: true, json: async () => ({ name: 'Pip', stage: 'egg' }) } as unknown as Response
    ))
    const { container } = render(<SpriteCosmeticsCard apiBase="/api/sprite" name="Pip" />)
    await settle()
    expect(container.querySelector('[data-testid="sprite-cosmetics"]')).toBeNull()
  })
})
