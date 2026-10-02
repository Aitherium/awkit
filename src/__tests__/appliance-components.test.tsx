// @vitest-environment jsdom
/**
 * ComponentsPanel: rendered for real (react-dom in jsdom) against a fake ApplianceClient.
 * Pins both directions: the read-only/refusal states must render, and the happy path
 * must reach client.action with exactly {id} -- a panel that does nothing fails here.
 *
 * Runner-neutral on purpose: awkit has no runner of its own and these files are collected
 * by AitherVeil's JEST (roots include ../packages/awkit/src), where 'vitest' is mapped to
 * jest.vitest-shim.ts and `vi` is undefined (`jest` is module-scoped, not a global). So
 * no `vi.*` here: calls are recorded by the local `spy()` and asserted on `.calls`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import ComponentsPanel, { describeOutcome, rowActions, shortPin } from '../appliance/ComponentsPanel'
import type { ApplianceClient } from '../appliance/client'
import type { ApiResult, ComponentResult, ComponentsResult } from '../appliance/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PIN = 'sha256:' + '1'.repeat(64)
const PREV = 'sha256:' + '2'.repeat(64)

function row(over: Partial<ComponentResult>): ComponentResult {
  return {
    id: 'x',
    kind: 'pypi',
    state: 'available',
    version: '1.0',
    pin: PIN,
    previous_pin: null,
    reason: '',
    log_tail: '',
    ...over,
  }
}

const LIST: ComponentResult[] = [
  row({ id: 'acmebot-backend', kind: 'baked', state: 'baked', pin: null, reason: 'baked into this image' }),
  row({ id: 'awdk', state: 'available' }),
  row({ id: 'awrun', state: 'installed', previous_pin: PREV }),
  row({ id: 'awplanned', state: 'unavailable', pin: null, reason: 'catalogue: status: planned' }),
  row({ id: 'aitherbrain', kind: 'container', state: 'needs-license', reason: 'no valid license (state=unlicensed)' }),
]

/** A call-recording stub that needs neither vi nor jest globals. */
type Spy<A extends unknown[], R> = ((...args: A) => R) & { calls: A[] }
function spy<A extends unknown[], R>(impl: (...args: A) => R): Spy<A, R> {
  const f = ((...args: A) => {
    f.calls.push(args)
    return impl(...args)
  }) as Spy<A, R>
  f.calls = []
  return f
}
const callsOf = (f: unknown): unknown[][] => (f as { calls: unknown[][] }).calls

const ok = <T,>(data: T): ApiResult<T> => ({ state: 'ok', status: 200, data })
const listResult = (rows = LIST): ApiResult<ComponentsResult> => ok({ ok: true, op: 'list', results: rows })

function fakeClient(over: Partial<ApplianceClient> = {}): ApplianceClient {
  const unavailable = async () => ({ state: 'unavailable' as const, status: 503, data: null })
  return {
    apiBase: '',
    session: unavailable,
    login: unavailable,
    logout: unavailable,
    overview: unavailable,
    license: unavailable,
    updates: unavailable,
    components: spy(async () => listResult()),
    endpoints: unavailable,
    surfaces: unavailable,
    setupStatus: unavailable,
    setupSteps: unavailable,
    setupState: unavailable,
    applySetupStep: unavailable,
    finishSetup: unavailable,
    action: spy(async (_op: string, _body?: unknown) => ok({ ok: true, op: 'install', results: [] })),
    getJson: unavailable,
    ...over,
  } as ApplianceClient
}

let host: HTMLDivElement
let root: Root

async function render(client: ApplianceClient) {
  await act(async () => {
    root.render(<ComponentsPanel client={client} />)
  })
}

const q = (sel: string) => host.querySelector(sel)
const buttons = (scope: Element | null) =>
  Array.from(scope?.querySelectorAll('button') ?? []).map((b) => b.textContent?.trim())

async function click(label: string, scope: Element | null = host) {
  const b = Array.from(scope?.querySelectorAll('button') ?? []).find(
    (x) => x.textContent?.trim() === label,
  )
  if (!b) throw new Error(`no button ${label}`)
  await act(async () => {
    ;(b as HTMLButtonElement).click()
  })
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('ComponentsPanel', () => {
  it('shows baked rows read-only, with no Remove button', async () => {
    await render(fakeClient())
    const baked = q('[data-testid="row-acmebot-backend"]')
    expect(baked?.getAttribute('data-state')).toBe('baked')
    expect(buttons(baked)).toEqual([])
    expect(baked?.textContent).toContain('Part of this appliance')
    expect(baked?.textContent).toContain('Built in')
  })

  it('offers Install on available, Remove + Roll back on installed-with-history', async () => {
    await render(fakeClient())
    expect(buttons(q('[data-testid="row-awdk"]'))).toEqual(['Install'])
    expect(buttons(q('[data-testid="row-awrun"]'))).toEqual(['Remove', 'Roll back'])
    expect(buttons(q('[data-testid="row-aitherbrain"]'))).toEqual([])
    expect(q('[data-testid="row-aitherbrain"]')?.textContent).toContain('Needs license')
  })

  it('hides unavailable rows until asked, then shows the reason', async () => {
    await render(fakeClient())
    expect(q('[data-testid="row-awplanned"]')).toBeNull()
    const box = host.querySelector('input[type="checkbox"]') as HTMLInputElement
    await act(async () => {
      box.click()
    })
    expect(q('[data-testid="reason-awplanned"]')?.textContent).toBe('catalogue: status: planned')
  })

  it('confirms before acting and sends exactly {id} to component-install', async () => {
    const client = fakeClient()
    await render(client)
    await click('Install', q('[data-testid="row-awdk"]'))
    expect(callsOf(client.action)).toEqual([])
    await click('Confirm', q('[data-testid="row-awdk"]'))
    expect(callsOf(client.action)).toEqual([['component-install', { id: 'awdk' }]])
    expect(q('[data-testid="outcome"]')?.textContent).toContain('awdk installed')
    expect(callsOf(client.components)).toHaveLength(2)
  })

  it('cancel does nothing', async () => {
    const client = fakeClient()
    await render(client)
    await click('Remove', q('[data-testid="row-awrun"]'))
    await click('Cancel', q('[data-testid="row-awrun"]'))
    expect(callsOf(client.action)).toEqual([])
    expect(buttons(q('[data-testid="row-awrun"]'))).toEqual(['Remove', 'Roll back'])
  })

  it('rollback goes through component-rollback', async () => {
    const client = fakeClient()
    await render(client)
    await click('Roll back', q('[data-testid="row-awrun"]'))
    await click('Confirm', q('[data-testid="row-awrun"]'))
    expect(callsOf(client.action)).toEqual([['component-rollback', { id: 'awrun' }]])
  })

  it('renders a 402 from the action as needs a license', async () => {
    const client = fakeClient({
      action: spy(async () => ({ state: 'not-entitled' as const, status: 402, data: null })),
    })
    await render(client)
    await click('Install', q('[data-testid="row-awdk"]'))
    await click('Confirm', q('[data-testid="row-awdk"]'))
    expect(q('[data-testid="outcome"]')?.textContent).toContain('needs a license')
  })

  it('renders a 409 with the CLI reason and log tail, never as success', async () => {
    const failed = row({ id: 'awdk', state: 'failed', reason: 'pip install failed; nothing changed', log_tail: 'ERROR: hash mismatch' })
    const client = fakeClient({
      action: spy(async () => ({
        state: 'refused' as const, status: 409, exit: 1,
        data: { ok: false, op: 'install', results: [failed] },
      })),
    })
    await render(client)
    await click('Install', q('[data-testid="row-awdk"]'))
    await click('Confirm', q('[data-testid="row-awdk"]'))
    const out = q('[data-testid="outcome"]')?.textContent ?? ''
    expect(out).toContain('failed -- nothing changed')
    expect(out).toContain('ERROR: hash mismatch')
    expect(out).not.toContain('installed (')
  })

  it('renders 501 on the list as not an awnix appliance', async () => {
    const client = fakeClient({
      components: spy(async () => ({ state: 'unavailable' as const, status: 501, data: null })),
    })
    await render(client)
    expect(q('[data-testid="not-an-appliance"]')?.textContent).toContain('Not running on an awnix appliance')
    expect(host.querySelector('table')).toBeNull()
  })

  it('renders 503 as unavailable with a retry, never an empty table', async () => {
    const client = fakeClient({
      components: spy(async () => ({ state: 'unavailable' as const, status: 503, data: null })),
    })
    await render(client)
    expect(host.querySelector('table')).toBeNull()
    expect(host.textContent).toContain('Not available right now')
    expect(buttons(host)).toContain('Try again')
  })
})

describe('pure helpers', () => {
  it('rowActions never offers anything on baked, unavailable or needs-license', () => {
    for (const s of ['baked', 'unavailable', 'needs-license'] as const) {
      expect(rowActions(row({ state: s }))).toEqual([])
    }
    expect(rowActions(row({ state: 'installed' }))).toEqual(['remove'])
  })

  it('shortPin strips sha256: and keeps 12', () => {
    expect(shortPin(PIN)).toBe('111111111111')
    expect(shortPin('a'.repeat(40))).toBe('aaaaaaaaaaaa')
    expect(shortPin(null)).toBe('')
  })

  it('describeOutcome maps 501 to not-an-appliance', () => {
    const d = describeOutcome({ id: 'x', op: 'install', result: { state: 'unavailable', status: 501, data: null } })
    expect(d.title).toBe('Not running on an awnix appliance')
  })
})
