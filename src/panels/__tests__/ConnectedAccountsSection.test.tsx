/**
 * The data-sources window lists the platform's real connectors and connects /
 * disconnects them through the tenant backend's /api/connections hop.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import ConnectedAccountsSection, { connectionsNav, errorLine } from '../ConnectedAccountsSection'

const LIST = {
  can_manage: true,
  connectors: [
    { connector: 'google_drive', display_name: 'Google Drive', oauth: true, available: true, status: 'not_connected', account: '' },
    { connector: 'onedrive', display_name: 'OneDrive', oauth: true, available: true, status: 'connected', account: 'j@example.com' },
    { connector: 'dropbox', display_name: 'Dropbox', oauth: true, available: false, status: 'not_connected', account: '' },
  ],
}

function mockFetch(list: unknown = LIST, listStatus = 200) {
  const calls: { method: string; url: string }[] = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    calls.push({ method, url: String(url) })
    const u = String(url)
    if (u.endsWith('/start')) return { ok: true, status: 200, json: async () => ({ authorize_url: 'https://idp.example/auth/connectors/oauth/begin?t=abc' }) }
    if (u.endsWith('/disconnect')) return { ok: true, status: 200, json: async () => ({ disconnected: true }) }
    if (u.endsWith('/api/connections')) return { ok: listStatus === 200, status: listStatus, json: async () => list }
    return { ok: false, status: 404, json: async () => { throw new SyntaxError("Unexpected token '<'") } }
  })
  return calls
}

describe('ConnectedAccountsSection', () => {
  it('lists every connector with its status, and only offers Connect where it can work', async () => {
    mockFetch()
    render(<ConnectedAccountsSection />)
    expect(await screen.findByText('Google Drive')).toBeTruthy()
    expect(screen.getByTestId('connect-google_drive')).toBeTruthy()
    expect(screen.getByTestId('disconnect-onedrive')).toBeTruthy()
    expect(screen.queryByTestId('connect-dropbox')).toBeNull()
    expect(screen.getByTestId('connection-dropbox').textContent).toMatch(/not available yet/)
  })

  it('starts a connect and sends the browser to the https begin hop', async () => {
    const calls = mockFetch()
    const go = jest.spyOn(connectionsNav, 'go').mockImplementation(() => {})
    render(<ConnectedAccountsSection />)
    fireEvent.click(await screen.findByTestId('connect-google_drive'))
    await waitFor(() => expect(go).toHaveBeenCalledWith('https://idp.example/auth/connectors/oauth/begin?t=abc'))
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/connections/google_drive/start')).toBe(true)
  })

  it('disconnects only after a confirm click', async () => {
    const calls = mockFetch()
    render(<ConnectedAccountsSection />)
    const btn = await screen.findByTestId('disconnect-onedrive')
    fireEvent.click(btn)
    expect(calls.some((c) => c.url.endsWith('/disconnect'))).toBe(false)
    fireEvent.click(btn)
    await waitFor(() => expect(calls.some((c) => c.url === '/api/connections/onedrive/disconnect')).toBe(true))
  })

  it('says why a failed read failed instead of rendering an empty list', async () => {
    mockFetch({ detail: 'Sign in to see your connections.' }, 401)
    render(<ConnectedAccountsSection />)
    expect((await screen.findByTestId('connected-accounts-offline')).textContent).toBe('Sign in to see your connections.')
  })

  it('turns a 422 detail list into a sentence', () => {
    expect(errorLine({ detail: [{ msg: 'field required' }] }, 'x')).toBe('field required')
    expect(errorLine(null, 'fallback')).toBe('fallback')
  })
})
