/**
 * The creator plane in a tenant app: apply, list, upload, earnings, payouts.
 *
 * Everything goes to the tenant backend's /api/creator/* (which proxies as the
 * signed-in person); a refusal is shown in words, never as an empty panel.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import CreatorPanel, { explainCreatorError, formatCents } from '../CreatorPanel'

type Call = { method: string; url: string; body?: unknown }

function mockFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    const u = String(url)
    calls.push({ method, url: u, body: init?.body })
    const key = `${method} ${u.replace(/^https?:\/\/[^/]+/, '')}`
    const hit = routes[key]
    if (!hit) return { ok: false, status: 404, json: async () => ({ detail: `no mock for ${key}` }) }
    const status = hit.status ?? 200
    return { ok: status < 300, status, json: async () => hit.body }
  })
  return calls
}

const APPROVED = {
  publisher: { status: 'approved', can_publish: true },
  publisher_status_code: 200,
  payout: { connected: true, payouts_enabled: true },
  payout_status_code: 200,
}

const EARNINGS = {
  total_earned_cents: 4000, pending_cents: 4000, paid_cents: 0, sales_count: 1,
  min_payout_cents: 1000, publisher_share: 0.8,
  payouts: [{ id: 'po.1', amount_cents: 4000, status: 'pending', can_request: true }],
}

describe('CreatorPanel', () => {
  it('lets a non-publisher apply', async () => {
    const calls = mockFetch({
      'GET /api/creator/status': { body: { publisher: { status: 'none', can_publish: false }, publisher_status_code: 200, payout: null, payout_status_code: 503 } },
      'POST /api/creator/apply': { body: { ok: true, publisher: { status: 'pending' } } },
    })
    render(<CreatorPanel />)
    const intent = await screen.findByLabelText('publisher intent')
    fireEvent.change(intent, { target: { value: 'weather tools' } })
    fireEvent.click(screen.getByText('Apply'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/creator/apply'))).toBe(true))
    const post = calls.find((c) => c.method === 'POST')!
    expect(JSON.parse(String(post.body))).toEqual({ intent: 'weather tools' })
    expect(calls.some((c) => c.url.endsWith('/api/creator/listings'))).toBe(false)
  })

  it('shows an approved publisher their listings and earnings, and requests a payout', async () => {
    const calls = mockFetch({
      'GET /api/creator/status': { body: APPROVED },
      'GET /api/creator/listings': { body: { listings: [{ id: 'comm.abc', name: 'Weather', kind: 'tool', version: '0.1.0', status: 'approved', one_time_cents: 500, artifact_sha256: 'ab', trust: { risk_level: 'clean', signed: true } }] } },
      'GET /api/creator/earnings': { body: EARNINGS },
      'POST /api/creator/payout/po.1/request': { body: { ok: true, status: 'paid', transfer_id: 'tr_1' } },
    })
    render(<CreatorPanel />)
    expect(await screen.findByText(/Weather/)).toBeTruthy()
    expect(screen.getByText(/\$5\.00 once/)).toBeTruthy()
    expect(screen.getByText(/adk pack install community:comm\.abc/)).toBeTruthy()
    fireEvent.click(await screen.findByText('Request payout'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/creator/payout/po.1/request'))).toBe(true))
    expect(await screen.findByText(/Payout paid \(tr_1\)/)).toBeTruthy()
  })

  it('creates a listing with exactly the prices typed (blank is free)', async () => {
    const calls = mockFetch({
      'GET /api/creator/status': { body: APPROVED },
      'GET /api/creator/listings': { body: { listings: [] } },
      'GET /api/creator/earnings': { body: { ...EARNINGS, payouts: [] } },
      'POST /api/creator/listings': { status: 201, body: { ok: true, listing: { id: 'comm.new' } } },
    })
    render(<CreatorPanel />)
    fireEvent.change(await screen.findByLabelText('listing name'), { target: { value: 'Forecast' } })
    fireEvent.change(screen.getByLabelText('listing summary'), { target: { value: 'weather for agents' } })
    fireEvent.click(screen.getByText('Create listing'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/creator/listings'))).toBe(true))
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/creator/listings'))!
    expect(JSON.parse(String(post.body))).toMatchObject({
      kind: 'tool', name: 'Forecast', summary: 'weather for agents', one_time_cents: 0, subscription_cents: 0,
    })
  })

  it('sends a payout-less publisher to Stripe onboarding', async () => {
    const assign = jest.fn()
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign } })
    mockFetch({
      'GET /api/creator/status': { body: { ...APPROVED, payout: { connected: false } } },
      'GET /api/creator/listings': { body: { listings: [] } },
      'GET /api/creator/earnings': { body: { ...EARNINGS, payouts: [] } },
      'POST /api/creator/payout/connect': { body: { ok: true, url: 'https://connect.stripe.test/onboard' } },
    })
    render(<CreatorPanel />)
    fireEvent.click(await screen.findByText('Set up payouts'))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://connect.stripe.test/onboard'))
  })

  it('explains a signed-out caller instead of rendering an empty panel', async () => {
    mockFetch({ 'GET /api/creator/status': { status: 401, body: { error: 'unauthenticated' } } })
    render(<CreatorPanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Sign in/)
  })

  it('formats cents and refusals', () => {
    expect(formatCents(0)).toBe('free')
    expect(formatCents(1999)).toBe('$19.99')
    expect(explainCreatorError(403, { detail: 'publisher account not approved' })).toMatch(/not approved/)
    expect(explainCreatorError(503, {})).toMatch(/unavailable/)
  })
})
