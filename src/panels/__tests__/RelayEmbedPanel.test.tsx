/**
 * T1: the tenant Comms panel defaulted to the platform's global `#general`, so a
 * customer's staff posted company chat into Aitherium's public community. With a
 * workspace it must open on its Company Room, `#<slug>-room`.
 */
import React from 'react'
import { render } from '@testing-library/react'

jest.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { display_name: 'Sam' } }) }))
jest.mock('../../hooks/useConfig', () => ({
  useConfig: () => ({ relay_base_url: '/relay', workspace_slug: 'acme' }),
}))

import RelayEmbedPanel, { relayEmbedChannel } from '../RelayEmbedPanel'

describe('RelayEmbedPanel landing channel', () => {
  it('lands a workspace on its Company Room, where its agents are', () => {
    const { container } = render(<RelayEmbedPanel />)
    const src = container.querySelector('iframe')!.getAttribute('src')!
    const qs = new URLSearchParams(src.split('?')[1])
    expect(qs.get('workspace')).toBe('acme')
    expect(qs.get('channel')).toBe('#acme-room')
  })

  it('refuses a platform room even when a caller asks for it', () => {
    expect(relayEmbedChannel('acme', '#general')).toBe('#acme-room')
    expect(relayEmbedChannel('acme', '#playground')).toBe('#acme-room')
    expect(relayEmbedChannel('acme', '#acme-support')).toBe('#acme-support')
  })

  it('without a workspace it requests no channel of its own', () => {
    expect(relayEmbedChannel(undefined, undefined)).toBeUndefined()
  })
})
