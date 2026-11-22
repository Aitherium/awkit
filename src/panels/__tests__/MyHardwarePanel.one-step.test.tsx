/**
 * My Hardware enrolls with ONE command. The six separate commands that a
 * customer admin never got through are kept, behind "Show the individual steps";
 * on a host with no one-step setup they render exactly as they did.
 *
 * Collected by AitherVeil's jest (roots include ../packages/awkit/src).
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import MyHardwarePanel from '../MyHardwarePanel'

const ONE_LINER = 'irm "https://acme-api.example.test/api/devices/setup/abc.ps1" | iex'

function mockFetch(onboarding: unknown | null) {
  const calls: Array<{ url: string; method: string }> = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    const method = (init?.method || 'GET').toUpperCase()
    calls.push({ url: u, method })
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
    if (u.endsWith('/devices/onboarding')) {
      return onboarding ? ok(onboarding) : { ok: false, status: 404, json: async () => ({}) }
    }
    if (u.endsWith('/devices/enroll') && method === 'POST') {
      return ok({
        device: { id: 'dev-1', node_id: 'pc-1', name: 'My Windows PC', os: 'windows',
          role: 'worker', status: 'enrolling', agent_scope: 'acme' },
        device_secret: 's', commands: { windows: 'python -m adk login', linux: 'adk login', macos: 'adk login' },
        one_liner: { windows: ONE_LINER, macos: ONE_LINER, linux: ONE_LINER },
        setup_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      })
    }
    if (u.endsWith('/devices')) return ok({ devices: [] })
    return { ok: false, status: 404, json: async () => ({}) }
  })
  return calls
}

beforeEach(() => {
  window.sessionStorage.clear()
  Object.defineProperty(window.navigator, 'clipboard',
    { value: { writeText: jest.fn(async () => undefined) }, configurable: true })
})

describe('MyHardwarePanel one-step enrollment', () => {
  it('offers the one command even to someone who dismissed the sign-in prompt', async () => {
    mockFetch({ prompt: false, reason: 'dismissed', device: null })
    render(<MyHardwarePanel setupUrl="" productName="Acme Assistant" />)
    const cardEl = await screen.findByTestId('device-setup-card')
    expect(cardEl.getAttribute('data-mode')).toBe('panel')
    expect(screen.queryByTestId('setup-not-now')).toBeNull()

    // The manual flow is still there, collapsed inside the card.
    const manual = screen.getByTestId('setup-manual') as HTMLDetailsElement
    expect(manual.open).toBe(false)
    expect(manual.contains(screen.getByText('Enroll this machine', { selector: 'button' }))).toBe(true)

    fireEvent.click(screen.getByTestId('setup-copy'))
    await waitFor(() => expect(screen.getByTestId('setup-command').textContent).toBe(ONE_LINER))
  })

  it('on a host with no one-step setup the manual flow renders as it always did', async () => {
    const calls = mockFetch(null)
    render(<MyHardwarePanel setupUrl="" />)
    const enroll = await screen.findByText('Enroll this machine', { selector: 'button' })
    expect(screen.queryByTestId('device-setup-card')).toBeNull()
    expect(screen.queryByTestId('setup-manual')).toBeNull()
    expect(enroll.closest('details')).toBeNull()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })
})
