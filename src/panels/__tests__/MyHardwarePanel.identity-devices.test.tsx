/**
 * My Hardware lists machines the host's identity registry holds (the setup door's
 * `adk enroll`) beside its own rows. Such a row has no Remove (it is revoked where
 * it was registered), and a registry the host could not read is SAID, so an outage
 * never reads as "nothing enrolled".
 *
 * Collected by AitherVeil's jest (roots include ../packages/awkit/src).
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

import MyHardwarePanel, { identityJoinWarning } from '../MyHardwarePanel'

const IDENTITY_ROW = {
  id: 'identity:adk-1', node_id: 'adk-1', name: 'ACME-PC', os: 'windows', role: 'worker',
  status: 'online', agent_scope: 'identity', source: 'identity', removable: false,
}
const LOCAL_ROW = {
  id: 'abc', node_id: 'box-1', name: 'Old box', os: 'linux', role: 'worker',
  status: 'offline', agent_scope: 'acme', source: 'host', removable: true,
}

function mockFetch(devicesBody: unknown) {
  ;(global as any).fetch = jest.fn(async (url: string) => {
    const u = String(url)
    if (u.endsWith('/devices')) return { ok: true, status: 200, json: async () => devicesBody }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}

describe('MyHardwarePanel identity-registered machines', () => {
  it('shows the machine online with no Remove, and keeps Remove on the host row', async () => {
    mockFetch({ devices: [IDENTITY_ROW, LOCAL_ROW], identity: { ok: true, errors: [] } })
    render(<MyHardwarePanel setupUrl="" />)
    await waitFor(() => expect(screen.getByText('ACME-PC')).toBeTruthy())
    expect(screen.getByText('Old box')).toBeTruthy()
    expect(screen.getAllByText('Remove')).toHaveLength(1)
    expect(screen.getByText(/registered with your account/)).toBeTruthy()
    expect(screen.queryByText(/set up on this PC/)).toBeNull()
    expect(screen.queryByTestId('identity-warning')).toBeNull()
  })

  it('says so when the registry could not be read', async () => {
    mockFetch({ devices: [], identity: { ok: false, errors: ['tnt_acme:identity_http_503'] } })
    render(<MyHardwarePanel setupUrl="" />)
    const warn = await screen.findByTestId('identity-warning')
    expect(warn.textContent).toContain('could not be checked')
    // internal codes and tenant ids never reach the person reading the panel
    expect(warn.textContent).not.toContain('identity_http_503')
    expect(warn.textContent).not.toContain('tnt_acme')
  })
})

describe('identityJoinWarning', () => {
  it('is empty for a host with no join, or a join that worked', () => {
    expect(identityJoinWarning([])).toBe('')
    expect(identityJoinWarning({ devices: [] })).toBe('')
    expect(identityJoinWarning({ identity: { ok: true } })).toBe('')
  })
  it('says it in plain words, never the host error code', () => {
    const line = identityJoinWarning({ identity: { ok: false, errors: ['x:identity_unconfigured'] } })
    expect(line).toContain('could not be checked')
    expect(line).not.toMatch(/identity_|x:/)
  })
})
