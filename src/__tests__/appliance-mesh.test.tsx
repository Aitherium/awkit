// @vitest-environment jsdom
/**
 * MeshPanel against a fake MeshClient: unjoined / pending / joined / refused render,
 * 501 maps to "mesh not installed", the console envelope is unwrapped, a join sends the
 * token once and it is never rendered back, retry/leave call the allowlisted verbs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import MeshPanel from '../appliance/MeshPanel'
import type { MeshApiResult, MeshClient, MeshStatus } from '../appliance/mesh-types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TOKEN = 'enroll-token-0123456789abcdef'

function status(over: Partial<MeshStatus>): MeshStatus {
  return {
    schema: 1,
    state: 'unjoined',
    node_id: null,
    compute_node_id: null,
    overlay_ip: null,
    overlay_cidr: null,
    portal: null,
    tenant_id: null,
    iface: 'aithernet0',
    peers: [],
    registered: false,
    capabilities: null,
    node_type: null,
    expires_at: null,
    heartbeat_at: null,
    checked_at: null,
    detail: null,
    ...over,
  }
}

const JOINED = status({
  state: 'joined',
  overlay_ip: '10.77.42.1',
  overlay_cidr: '10.77.42.0/24',
  portal: 'https://api.example',
  registered: true,
  iface_up: true,
  heartbeat_at: new Date().toISOString(),
  peers: [{ node_id: 'hub', hostname: 'hub-1', endpoint: '203.0.113.10:51820', allowed_ips: ['10.77.7.0/24', '10.77.9.0/24'], hub: true }],
  capabilities: {
    arch: 'aarch64',
    cpu_model: 'arm cpu part 0xd85',
    cpu_count: 20,
    mem_gb: 121.6,
    gpus: [{ vendor: 'nvidia', model: 'NVIDIA GB10', vram_gb: null }],
    accelerators: [],
    node_type: 'gpu_node',
  },
  detail: 'joined; capabilities registered',
})

const ok = <T,>(data: T): MeshApiResult<T> => ({ state: 'ok', status: 200, data })
/** How the console answers a read: an envelope around the CLI's JSON. */
const envelope = (s: MeshStatus, http = 200, exit = 0): MeshApiResult<unknown> => ({
  state: http === 200 ? 'ok' : http === 409 ? 'refused' : 'unavailable',
  status: http,
  data: { verb: 'mesh', exit, state: s.state, result: s, stdout_tail: '' },
})

function fakeClient(reads: MeshApiResult<unknown>[], over: Partial<MeshClient> = {}) {
  let i = 0
  const getJson = vi.fn(async () => reads[Math.min(i++, reads.length - 1)])
  const action = vi.fn(async () => ok<unknown>({}))
  return { getJson, action, ...over } as MeshClient & { getJson: typeof getJson; action: typeof action }
}

let host: HTMLDivElement
let root: Root

async function render(client: MeshClient) {
  await act(async () => {
    root.render(<MeshPanel client={client} />)
  })
  await act(async () => {
    await Promise.resolve()
  })
}

const q = (sel: string) => host.querySelector(sel)
const stateOf = () => q('[data-testid="mesh-state"]')?.getAttribute('data-state')

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('MeshPanel', () => {
  it('unjoined shows the join form and no overlay details', async () => {
    const c = fakeClient([envelope(status({}))])
    await render(c)
    expect(c.getJson).toHaveBeenCalledWith('/api/appliance/mesh')
    expect(stateOf()).toBe('unjoined')
    expect(q('[data-testid="mesh-token"]')).not.toBeNull()
    expect(host.textContent).not.toContain('Overlay IP')
  })

  it('pending (503 + exit 2) renders the CLI status, not an error, and offers retry', async () => {
    const c = fakeClient([envelope(status({ state: 'pending', detail: 'offline: connection refused' }), 503, 2)])
    await render(c)
    expect(stateOf()).toBe('pending')
    expect(host.textContent).toContain('offline: connection refused')
    const retry = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Retry now')!
    await act(async () => {
      retry.click()
    })
    expect(c.action).toHaveBeenCalledWith('mesh-retry', undefined)
  })

  it('joined shows overlay, peers and capabilities; unified memory is "shared"', async () => {
    const c = fakeClient([envelope(JOINED)])
    await render(c)
    expect(stateOf()).toBe('joined')
    const text = host.textContent ?? ''
    expect(text).toContain('10.77.42.1')
    expect(text).toContain('hub-1')
    expect(text).toContain('10.77.7.0/24, 10.77.9.0/24')
    expect(text).toContain('GPU node')
    expect(text).toContain('NVIDIA GB10')
    expect(text).toContain('shared')
    expect(q('[data-testid="mesh-token"]')).toBeNull()
  })

  it('refused (409) shows the reason and lets the operator join again', async () => {
    const c = fakeClient([envelope(status({ state: 'refused', detail: 'air gap is enabled' }), 409, 1)])
    await render(c)
    expect(stateOf()).toBe('refused')
    expect(q('[data-testid="mesh-detail"]')?.textContent).toContain('air gap is enabled')
    expect(q('[data-testid="mesh-token"]')).not.toBeNull()
  })

  it('501 maps to "mesh not installed"', async () => {
    const c = fakeClient([{ state: 'unavailable', status: 501, data: { available: false } }])
    await render(c)
    expect(q('[data-testid="mesh-not-installed"]')).not.toBeNull()
    expect(host.textContent).toContain('not installed')
  })

  it('an unreadable status is an explicit error, never an empty success', async () => {
    const c = fakeClient([{ state: 'unavailable', status: 503, data: null, detail: 'console unreachable' }])
    await render(c)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not be read')
  })

  it('join sends the token once and never renders it back', async () => {
    const c = fakeClient([envelope(status({})), envelope(JOINED)])
    await render(c)
    const input = q('[data-testid="mesh-token"]') as HTMLInputElement
    expect(input.type).toBe('password')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, TOKEN)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      ;(q('form') as HTMLFormElement).requestSubmit()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(c.action).toHaveBeenCalledTimes(1)
    expect(c.action).toHaveBeenCalledWith('mesh-join', { token: TOKEN })
    expect(host.innerHTML).not.toContain(TOKEN)
    expect(stateOf()).toBe('joined')
  })

  it('a malformed token is refused client-side with no request', async () => {
    const c = fakeClient([envelope(status({}))])
    await render(c)
    const input = q('[data-testid="mesh-token"]') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'short token')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      ;(q('form') as HTMLFormElement).requestSubmit()
    })
    expect(c.action).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('enroll token')
  })

  it('leave asks first, then calls mesh-leave', async () => {
    const c = fakeClient([envelope(JOINED), envelope(status({ state: 'left' }))])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await render(c)
    const leave = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Leave mesh')!
    await act(async () => {
      leave.click()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(confirm).toHaveBeenCalled()
    expect(c.action).toHaveBeenCalledWith('mesh-leave', undefined)
    expect(stateOf()).toBe('left')
    confirm.mockRestore()
  })

  it('prefers a dedicated getMesh() when the client has one', async () => {
    const getMesh = vi.fn(async () => ok(JOINED))
    const c = fakeClient([envelope(status({}))], { getMesh })
    await render(c)
    expect(getMesh).toHaveBeenCalled()
    expect(c.getJson).not.toHaveBeenCalled()
    expect(stateOf()).toBe('joined')
  })
})
