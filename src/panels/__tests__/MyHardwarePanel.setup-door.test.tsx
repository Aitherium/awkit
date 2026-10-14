/**
 * My Hardware leads with the one-click /setup-pc door and keeps the copy-paste pip
 * commands collapsed under "Advanced" — the commands are the path that failed a real
 * customer four times. Where the host serves no door (localhost, an appliance) the
 * button is absent and the commands are expanded instead. The appliance card leads
 * with the boot-proven release and labels a booted:false build as preview.
 *
 * Collected by AitherVeil's jest (roots include ../packages/awkit/src).
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

import MyHardwarePanel, { pickApplianceReleases, resolveSetupUrl } from '../MyHardwarePanel'

const DOOR = 'https://acme.aitherium.com/setup-pc/'

const DOWNLOADS = {
  packages: [
    { id: 'awdk', name: 'awdk', version: '1.0.0', install: 'python -m pip install awdk', description: 'the CLI' },
  ],
  bonsai: { name: 'Bonsai', install: 'python -m pip install bonsai', description: 'local model' },
}

const TENANT_PREVIEW = {
  release_tag: 'appliance-20260912', release_url: 'https://example.invalid/t', asset: 'a.iso',
  size_bytes: 1, slices: 1, booted: false, boot_proof: 'not yet boot-tested',
}
const PLATFORM_BOOTED = {
  release_tag: 'awnix-iso-acme-2026.09.01', release_url: 'https://example.invalid/p', asset: 'a.iso',
  size_bytes: 1, slices: 1, booted: true, boot_proof: 'PASS',
}

function mockFetch(appliance: unknown) {
  ;(global as any).fetch = jest.fn(async (url: string) => {
    const u = String(url)
    if (u.endsWith('/devices/downloads')) return { ok: true, status: 200, json: async () => DOWNLOADS }
    if (u.endsWith('/appliance')) {
      return appliance
        ? { ok: true, status: 200, json: async () => appliance }
        : { ok: false, status: 404, json: async () => ({}) }
    }
    if (u.endsWith('/devices')) return { ok: true, status: 200, json: async () => [] }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}

describe('MyHardwarePanel setup door', () => {
  it('renders the setup-pc link first and the pip block collapsed by default', async () => {
    mockFetch(null)
    const { container } = render(<MyHardwarePanel setupUrl={DOOR} />)
    // Wait for the downloads surface so the pip commands are actually in the DOM.
    await waitFor(() => expect(screen.getByText('python -m pip install awdk')).toBeTruthy())

    const firstLink = container.querySelector('a')
    expect(firstLink).not.toBeNull()
    expect(firstLink!.getAttribute('href')).toBe(DOOR)
    expect(firstLink!.textContent).toBe('Set up this PC')
    // Nothing actionable precedes the door.
    expect(container.querySelector('a, button, code, details')).toBe(firstLink)

    const advanced = screen.getByTestId('advanced-install') as HTMLDetailsElement
    expect(advanced.tagName).toBe('DETAILS')
    expect(advanced.open).toBe(false)
    // Every pip command lives inside the collapsed block.
    for (const code of Array.from(container.querySelectorAll('code'))) {
      if (/pip install/.test(code.textContent || '')) expect(advanced.contains(code)).toBe(true)
    }
  })

  it('on a host with no door (jsdom = localhost) hides the button and expands the commands', async () => {
    mockFetch(null)
    render(<MyHardwarePanel />)
    await waitFor(() => expect(screen.getByText('python -m pip install awdk')).toBeTruthy())
    expect(screen.queryByTestId('setup-pc-link')).toBeNull()
    expect((screen.getByTestId('advanced-install') as HTMLDetailsElement).open).toBe(true)
  })

  it('leads the appliance card with the boot-proven release; booted:false is preview', async () => {
    mockFetch({ tenant: TENANT_PREVIEW, platform: PLATFORM_BOOTED })
    render(<MyHardwarePanel />)
    const card = await screen.findByTestId('appliance-card')
    expect(card.textContent).toContain(PLATFORM_BOOTED.release_tag)
    expect(screen.getByTestId('appliance-badge').textContent).toBe('✓ boot-proven')
    const other = screen.getByTestId('appliance-other')
    expect(other.textContent).toContain(TENANT_PREVIEW.release_tag)
    expect(other.textContent).toContain('preview')
  })

  it('labels the lead preview when no release is boot-proven', async () => {
    mockFetch({ tenant: TENANT_PREVIEW })
    render(<MyHardwarePanel />)
    await screen.findByTestId('appliance-card')
    expect(screen.getByTestId('appliance-badge').textContent).toBe('preview')
  })
})

describe('pickApplianceReleases', () => {
  it('prefers the tenant build when it is boot-proven', () => {
    const tenant = { ...TENANT_PREVIEW, booted: true }
    const picked = pickApplianceReleases({ tenant, platform: PLATFORM_BOOTED })
    expect(picked!.lead).toBe(tenant)
    expect(picked!.other).toBe(PLATFORM_BOOTED)
  })

  it('returns null without a manifest', () => {
    expect(pickApplianceReleases(null)).toBeNull()
  })

  it('keeps a platform-only manifest', () => {
    const picked = pickApplianceReleases({ platform: PLATFORM_BOOTED })
    expect(picked!.lead).toBe(PLATFORM_BOOTED)
    expect(picked!.other).toBeNull()
  })
})

describe('resolveSetupUrl', () => {
  it.each([
    ['acme.aitherium.com', 'https://acme.aitherium.com/setup-pc/'],
    ['acme-api.aitherium.com', 'https://acme.aitherium.com/setup-pc/'],
    ['localhost', null],
    ['192.168.1.20', null],
    ['app.aitherium.com', null],
    ['api.aitherium.com', null],
    ['acme.aitherium.com.evil.example', null],
    ['acme-beta.aitherium.com', 'https://acme.aitherium.com/setup-pc/'],
    ['globex-api.aitherium.com', 'https://globex.aitherium.com/setup-pc/'],
    ['demo.aitherium.com', null],
    ['initech.aitherium.com', null],
    ['elysium.aitherium.com', null],
  ])('%s -> %s', (host, want) => {
    expect(resolveSetupUrl(undefined, host, new Set(['acme', 'globex']))).toBe(want)
  })

  it('an explicit URL wins; an empty one hides the door', () => {
    expect(resolveSetupUrl(DOOR, 'localhost')).toBe(DOOR)
    expect(resolveSetupUrl('', 'acme.aitherium.com')).toBeNull()
  })
})
