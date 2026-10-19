/**
 * One-click Microsoft 365 mail: a customer never types a mailbox password.
 *
 * Microsoft retired basic auth for Exchange Online, so the old email + password form
 * could never connect a Microsoft 365 mailbox. The panel now leads with "Connect
 * Microsoft 365 / Outlook", routes any Microsoft provider pick to sign-in, and
 * finishes the connect when the user comes back from Microsoft.
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

let mockRole = 'member'
jest.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: mockRole } }) }))

import MailPanel, { CONNECTORS_ROUTE, OAUTH_PENDING_KEY, isMicrosoftProvider, mailNav } from '../MailPanel'
import { M365_ASK_ADMIN } from '../ConnectorsPanel'

type Call = { method: string; url: string; body?: string }

function mockFetch(opts: {
  m365?: Record<string, unknown>
  google?: Record<string, unknown>
  connectStatus?: number
}) {
  const calls: Call[] = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    const u = String(url)
    calls.push({ method, url: u, body: init?.body as string | undefined })
    const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })
    if (u.endsWith('/api/auth/m365/status')) return ok(opts.m365 || {})
    if (u.endsWith('/api/auth/google/status')) return ok(opts.google || {})
    if (u.endsWith('/accounts/connect-oauth')) {
      const st = opts.connectStatus ?? 200
      return st === 409
        ? ok({ detail: { message: 'Connect your account first.', connect_url: '/api/auth/m365/login' } }, 409)
        : ok({ connected: true, account: { id: 'acct_1', email: 'me@contoso.test', provider: 'm365', auth: 'oauth' } }, st)
    }
    if (u.endsWith('/accounts')) return ok({ accounts: [] })
    if (u.endsWith('/folders')) return ok({ folders: [] })
    if (u.includes('/messages')) return ok({ items: [] })
    if (u.endsWith('/providers')) return ok({ providers: [{ id: 'gmail', defaults: {} }, { id: 'outlook', defaults: {} }, { id: 'imap', defaults: {} }] })
    return ok({}, 404)
  })
  return calls
}

let assigned = ''
// jsdom cannot navigate; capture the redirect target instead.
beforeAll(() => { mailNav.go = (url: string) => { assigned = url } })
beforeEach(() => { assigned = ''; mockRole = 'member'; window.sessionStorage.clear() })

async function openConnect() {
  render(<MailPanel />)
  fireEvent.click(await screen.findByText('+ Connect Mailbox'))
  return screen.findByText('Connect Microsoft 365 / Outlook')
}

describe('MailPanel one-click Microsoft 365', () => {
  it('routes every Microsoft provider pick to sign-in, never a password', () => {
    for (const id of ['outlook', 'office365', 'Microsoft', 'm365', 'exchange']) {
      expect(isMicrosoftProvider(id)).toBe(true)
    }
    for (const id of ['gmail', 'imap', 'fastmail', '']) expect(isMicrosoftProvider(id)).toBe(false)
  })

  it('shows the Microsoft button above the IMAP form and hides the password for Outlook', async () => {
    mockFetch({ m365: { configured: true, connected: false } })
    await openConnect()
    expect(screen.getByLabelText(/Password \/ App Password/)).toBeTruthy()
    fireEvent.change(screen.getByDisplayValue('gmail'), { target: { value: 'outlook' } })
    expect(screen.queryByLabelText(/Password \/ App Password/)).toBeNull()
    expect(screen.getByTestId('mail-microsoft-route')).toBeTruthy()
  })

  it('not yet signed in: remembers the intent and goes to Microsoft', async () => {
    const calls = mockFetch({ m365: { configured: true, connected: false } })
    const btn = await openConnect()
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/api/auth/m365/status'))).toBe(true))
    await act(async () => { fireEvent.click(btn) })
    await waitFor(() => expect(assigned).toBe('/api/auth/m365/login'))
    expect(window.sessionStorage.getItem(OAUTH_PENDING_KEY)).toBe('m365')
    expect(calls.some((c) => c.url.endsWith('/accounts/connect')) ).toBe(false)
  })

  it('already signed in: adds the mailbox in one click with no redirect', async () => {
    const calls = mockFetch({ m365: { configured: true, connected: true } })
    const btn = await openConnect()
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/api/auth/m365/status'))).toBe(true))
    await act(async () => { fireEvent.click(btn) })
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/accounts/connect-oauth'))).toBe(true))
    const post = calls.find((c) => c.url.endsWith('/accounts/connect-oauth'))!
    expect(JSON.parse(post.body!)).toEqual({ provider: 'm365' })
    expect(assigned).toBe('')
  })

  it('coming back from Microsoft finishes the connect automatically', async () => {
    window.sessionStorage.setItem(OAUTH_PENDING_KEY, 'm365')
    const calls = mockFetch({ m365: { configured: true, connected: true } })
    render(<MailPanel />)
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/accounts/connect-oauth'))).toBe(true))
    expect(window.sessionStorage.getItem(OAUTH_PENDING_KEY)).toBeNull()
  })

  it('workspace has no Microsoft app: a member is told to ask their admin', async () => {
    const calls = mockFetch({ m365: { configured: false, connected: false } })
    const btn = await openConnect()
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/api/auth/m365/status'))).toBe(true))
    await act(async () => { fireEvent.click(btn) })
    expect((await screen.findByTestId('mail-m365-setup')).textContent).toBe(M365_ASK_ADMIN)
    expect(screen.queryByText(/Settings > Connectors/)).toBeNull()
    expect(assigned).toBe('')
  })

  it('workspace has no Microsoft app: an admin gets a link straight to the setup steps', async () => {
    mockRole = 'admin'
    mockFetch({ m365: { configured: false, connected: false } })
    await openConnect()
    const link = await screen.findByText('Settings > Connectors > Microsoft 365')
    expect(link.getAttribute('href')).toBe(CONNECTORS_ROUTE)
    fireEvent.click(link)
    expect(assigned).toBe(CONNECTORS_ROUTE)
  })

  it('a host shell can open Connectors itself', async () => {
    mockRole = 'owner'
    mockFetch({ m365: { configured: false } })
    const open = jest.fn()
    render(<MailPanel onOpenConnectors={open} />)
    fireEvent.click(await screen.findByText('+ Connect Mailbox'))
    fireEvent.click(await screen.findByText('Settings > Connectors > Microsoft 365'))
    expect(open).toHaveBeenCalled()
    expect(assigned).toBe('')
  })

  it('offers Gmail sign-in only when the workspace enabled Gmail', async () => {
    mockFetch({ m365: { configured: true }, google: { configured: true, gmail: false } })
    await openConnect()
    expect(screen.queryByText('Connect Gmail (Google sign-in)')).toBeNull()
  })

  it('offers Gmail sign-in when Gmail is enabled', async () => {
    mockFetch({ m365: { configured: true }, google: { configured: true, gmail: true } })
    await openConnect()
    expect(await screen.findByText('Connect Gmail (Google sign-in)')).toBeTruthy()
  })
})
