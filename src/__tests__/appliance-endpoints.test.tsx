// @vitest-environment jsdom
/**
 * EndpointsPanel (awkit/appliance): renders the box's outbound endpoints, flags a
 * fleet-internal default, names the /etc file an admin edits and the command that
 * really applies it, and never renders a 501/503 as an empty table.
 *
 * Same harness as appliance-console.test.tsx: react-dom/client in jsdom, explicit
 * vitest imports (no globals needed), and every root unmounted in afterEach so one
 * test's DOM never leaks into the next. Needs vitest + jsdom + react + react-dom.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import EndpointsPanel, {
  type EndpointsClient,
  type EndpointsResult,
} from '../appliance/EndpointsPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const FIXTURE: EndpointsResult = {
  state: 'ok',
  data: {
    endpoints: [
      { var: 'QDRANT_URL', value: 'http://127.0.0.1:6333', source: 'vendor-env', internal: false, chain: 'acme', file: '/etc/acme/appliance.env' },
      { var: 'GENESIS_URL', value: 'https://aitheros-genesis:8001', source: 'admin-env', internal: true, chain: 'acme', file: '/etc/acme/appliance.env' },
      { var: 'RELAY_URL', value: '', source: 'vendor-env', internal: false, chain: 'acme', file: '/etc/acme/appliance.env' },
      { var: 'AWNIX_PYPI', value: 'https://pypi.org/pypi', source: 'default', internal: false, chain: 'awnix' },
    ],
  },
}

const client = (r: EndpointsResult, probe?: EndpointsResult): EndpointsClient => ({
  getEndpoints: async () => r,
  ...(probe ? { probeEndpoints: async () => probe } : {}),
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(c: EndpointsClient): Promise<void> {
  await act(async () => {
    root.render(<EndpointsPanel client={c} />)
  })
  // Let the load effect's promise settle and re-render.
  await act(async () => {
    await Promise.resolve()
  })
}

const byTestId = (id: string): HTMLElement | null => host.querySelector(`[data-testid="${id}"]`)

describe('EndpointsPanel', () => {
  it('renders every endpoint with its source and flags the fleet-internal default', async () => {
    await render(client(FIXTURE))
    expect(host.textContent).toContain('GENESIS_URL')
    expect(host.textContent).toContain('QDRANT_URL')
    expect(host.textContent).toContain('admin override')
    expect(byTestId('endpoint-row-GENESIS_URL')?.textContent).toContain('fleet-internal default')
    expect(byTestId('endpoint-row-QDRANT_URL')?.textContent).not.toContain('fleet-internal default')
    expect(byTestId('endpoint-row-RELAY_URL')?.textContent).toContain('(off)')
    expect(byTestId('endpoints-internal-warning')?.textContent).toContain('1 endpoint')
    expect(document.querySelectorAll('table')).toHaveLength(1)
  })

  it('names the files an admin edits and the command that really applies them', async () => {
    await render(client(FIXTURE))
    const footer = byTestId('endpoints-footer')?.textContent ?? ''
    // The tenant product's file comes from the rows (the CLI emits `file`), not the kit.
    expect(footer).toContain('/etc/acme/appliance.env')
    expect(footer).toContain('/etc/awnix/endpoints.env')
    expect(footer).toContain('sudo awnix endpoints apply')
    // Restarting the first-boot unit skips a running backend, so it must not read as the fix.
    expect(footer).toContain('first-boot unit alone is not enough')
  })

  it('renders 503 as an explicit unreachable state, never an empty table', async () => {
    await render(client({ state: 'unreachable', detail: 'console down' }))
    expect(byTestId('endpoints-unreachable')?.textContent).toContain('unknown')
    expect(document.querySelector('table')).toBeNull()
  })

  it('renders 501 as an explicit unavailable state', async () => {
    await render(client({ state: 'unavailable' }))
    expect(byTestId('endpoints-unavailable')).not.toBeNull()
    expect(document.querySelector('table')).toBeNull()
  })

  it('renders a thrown client error as an error, not an empty list', async () => {
    const broken: EndpointsClient = { getEndpoints: async () => { throw new Error('boom') } }
    await render(broken)
    expect(byTestId('endpoints-error')?.textContent).toContain('boom')
  })

  it('probe replaces the rows with reachability', async () => {
    const probed: EndpointsResult = {
      state: 'ok',
      data: { endpoints: [{ var: 'QDRANT_URL', value: 'http://127.0.0.1:6333', source: 'vendor-env',
                            internal: false, chain: 'acme', file: '/etc/acme/appliance.env', reachable: 'unreachable' }] },
    }
    await render(client(FIXTURE, probed))
    const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Check reachability')
    expect(button).toBeTruthy()
    await act(async () => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(byTestId('endpoint-row-QDRANT_URL')?.textContent).toContain('unreachable')
    expect(byTestId('endpoint-row-GENESIS_URL')).toBeNull()
    expect(document.querySelectorAll('table')).toHaveLength(1)
  })
})
