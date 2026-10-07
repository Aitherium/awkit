/**
 * An admin registers the workspace's own OAuth app without an operator.
 *
 * The panel must show the exact redirect URI to register, send the pasted client id
 * and secret to the backend, and never put a stored secret back into the form.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

let mockRole = 'admin'
jest.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: mockRole } }) }))

import ConnectorsPanel, { connectorConfigBody, explainConnectorError } from '../ConnectorsPanel'

const REDIRECT = 'https://tenant-api.example/api/auth/m365/callback'

function mockFetch(stored: Record<string, unknown> | null) {
  const calls: { method: string; url: string; body?: string }[] = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    calls.push({ method, url: String(url), body: init?.body as string | undefined })
    const u = String(url)
    if (u.endsWith('/status')) return { ok: true, status: 200, json: async () => ({ configured: !!stored, connected: false }) }
    if (u.includes('/api/connectors/')) {
      if (mockRole === 'member') return { ok: false, status: 403, json: async () => ({ detail: 'admin only' }) }
      const view = method === 'PUT'
        ? { client_id: 'cid', tenant_id: 'contoso', has_secret: true, configured: true }
        : stored || { configured: false, has_secret: false }
      return { ok: true, status: 200, json: async () => ({ redirect_uri: REDIRECT, ...view }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  return calls
}

describe('ConnectorsPanel', () => {
  beforeEach(() => { mockRole = 'admin' })

  it('lets an admin register the Microsoft app and shows the redirect URI', async () => {
    const calls = mockFetch(null)
    render(<ConnectorsPanel />)
    expect((await screen.findAllByDisplayValue(REDIRECT)).length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('m365 client id'), { target: { value: 'cid' } })
    fireEvent.change(screen.getByLabelText('m365 tenant id'), { target: { value: 'contoso' } })
    fireEvent.change(screen.getByLabelText('m365 client secret'), { target: { value: 'shh' } })
    fireEvent.click(screen.getAllByText('Save')[0])
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.url).toMatch(/\/api\/connectors\/m365\/config$/)
    expect(JSON.parse(put.body!)).toEqual({ client_id: 'cid', client_secret: 'shh', tenant_id: 'contoso', cli_tokens: '' })
  })

  it('sends the Gmail and CLI hand-off switches for Google', async () => {
    const calls = mockFetch(null)
    render(<ConnectorsPanel />)
    await screen.findAllByDisplayValue(REDIRECT)
    // Gmail is Google-only; the CLI switch exists for both providers.
    expect(screen.queryByLabelText('m365 include gmail')).toBeNull()
    expect(screen.getByLabelText('m365 cli tokens')).toBeTruthy()
    expect(screen.getByText(/Include Gmail \(read-only, Google restricted scope/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('google client id'), { target: { value: 'gid' } })
    fireEvent.change(screen.getByLabelText('google client secret'), { target: { value: 'gs' } })
    // a switch in the form must not wipe a secret the admin just typed
    fireEvent.click(screen.getByLabelText('google include gmail'))
    fireEvent.click(screen.getByLabelText('google cli tokens'))
    fireEvent.click(screen.getAllByText('Save')[1])
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/google/'))).toBe(true))
    const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/google/'))!
    expect(JSON.parse(put.body!)).toEqual({ client_id: 'gid', client_secret: 'gs', gmail: '1', cli_tokens: '1' })
  })

  it('a switch in the saved view saves at once and keeps the stored secret', async () => {
    const calls = mockFetch({ client_id: 'cid', has_secret: true, configured: true, gmail: '', cli_tokens: '' })
    render(<ConnectorsPanel />)
    await screen.findAllByText(/secret stored/)
    const cli = (await screen.findByLabelText('google cli tokens')) as HTMLInputElement
    expect(cli.checked).toBe(false)
    fireEvent.click(cli)
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/google/'))).toBe(true))
    const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/google/'))!
    expect(JSON.parse(put.body!)).toEqual({ client_id: 'cid', client_secret: '', gmail: '', cli_tokens: '1' })
  })

  it('builds per-provider bodies', () => {
    const form = { client_id: 'c', client_secret: '', tenant_id: 't', gmail: true, cli_tokens: false }
    expect(connectorConfigBody('m365', form)).toEqual({ client_id: 'c', client_secret: '', tenant_id: 't', cli_tokens: '' })
    expect(connectorConfigBody('google', form)).toEqual({ client_id: 'c', client_secret: '', gmail: '1', cli_tokens: '' })
  })

  it('never fills a stored secret back into the form', async () => {
    mockFetch({ client_id: 'cid', tenant_id: 'contoso', has_secret: true, configured: true })
    render(<ConnectorsPanel />)
    await screen.findAllByText(/secret stored/)
    fireEvent.click(screen.getAllByText('Edit')[0])
    const secret = screen.getByLabelText('m365 client secret') as HTMLInputElement
    expect(secret.value).toBe('')
    expect(secret.placeholder).toMatch(/Leave blank to keep it/)
  })

  it('shows members only status, no credential form', async () => {
    mockRole = 'member'
    const calls = mockFetch(null)
    render(<ConnectorsPanel />)
    await screen.findAllByText(/Ask a workspace admin/)
    expect(screen.queryByLabelText('m365 client id')).toBeNull()
    expect(calls.some((c) => c.url.includes('/api/connectors/'))).toBe(false)
    expect(screen.queryByLabelText('google cli tokens')).toBeNull()
  })

  it('explains refusals in words', () => {
    expect(explainConnectorError(403, {})).toMatch(/owner or admin/)
    expect(explainConnectorError(503, { detail: 'Connector token storage is unavailable' })).toMatch(/unavailable/)
  })
})
