// @vitest-environment jsdom
/**
 * MemoryStackCard: the one-click "Memory & search (self-hosted)" switch.
 * Rendered for real (react-dom in jsdom) against a fake ApplianceClient. Runner-neutral
 * like appliance-components.test.tsx (collected by AitherVeil's jest, where `vi` is
 * undefined): calls are recorded by a local spy, and polling is off (pollMs 0).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import ComponentsPanel from '../appliance/ComponentsPanel'
import MemoryStackCard, { describeStartFailure, progressLine } from '../appliance/MemoryStackCard'
import type { ApplianceClient } from '../appliance/client'
import type { ApiResult, ComponentProgress, ComponentResult, ComponentsResult } from '../appliance/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function row(over: Partial<ComponentResult>): ComponentResult {
  return {
    id: 'memory-stack',
    kind: 'bundle',
    state: 'available',
    version: '1',
    pin: null,
    previous_pin: null,
    reason: '',
    log_tail: '',
    ...over,
  }
}

function prog(over: Partial<ComponentProgress>): ComponentProgress {
  return {
    op: 'install',
    step: 3,
    steps: 9,
    current: 'memory-nexus',
    message: 'Starting vector memory',
    updated_at: '2026-10-29T00:00:00Z',
    done: false,
    ok: null,
    error: '',
    ...over,
  }
}

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

function fakeClient(
  actionResult: ApiResult<unknown> = ok({ scheduled: true }),
  list: ComponentResult[] = [],
): ApplianceClient {
  const unavailable = async () => ({ state: 'unavailable' as const, status: 503, data: null })
  return {
    apiBase: '',
    session: unavailable,
    login: unavailable,
    logout: unavailable,
    overview: unavailable,
    license: unavailable,
    updates: unavailable,
    components: spy(async () => ok<ComponentsResult>({ ok: true, op: 'list', results: list })),
    endpoints: unavailable,
    surfaces: unavailable,
    setupStatus: unavailable,
    setupSteps: unavailable,
    setupState: unavailable,
    applySetupStep: unavailable,
    finishSetup: unavailable,
    action: spy(async (_op: string, _body?: unknown) => actionResult),
    getJson: unavailable,
  } as unknown as ApplianceClient
}

let host: HTMLDivElement
let root: Root
let reloads: number

async function renderCard(client: ApplianceClient, r: ComponentResult, members: ComponentResult[] = []) {
  await act(async () => {
    root.render(
      <MemoryStackCard
        client={client}
        row={r}
        members={members}
        reload={async () => {
          reloads += 1
        }}
        pollMs={0}
      />,
    )
  })
}

const card = () => host.querySelector('[data-testid="memory-stack-card"]')
const q = (sel: string) => host.querySelector(sel)
const btn = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as
    | HTMLButtonElement
    | undefined
async function click(label: string) {
  const b = btn(label)
  if (!b) throw new Error(`no button ${label}`)
  await act(async () => {
    b.click()
  })
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  reloads = 0
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('MemoryStackCard', () => {
  it('titles the card and explains it in one sentence', async () => {
    await renderCard(fakeClient(), row({}))
    expect(card()?.textContent).toContain('Memory & search (self-hosted)')
    expect(card()?.textContent).toContain('nothing leaves the box')
  })

  it('available -> one click posts component-install-start {id: memory-stack}', async () => {
    const client = fakeClient()
    await renderCard(client, row({}))
    await click('Install')
    expect(callsOf(client.action)).toEqual([['component-install-start', { id: 'memory-stack' }]])
    expect(reloads).toBe(1)
    // scheduled, progress not seen yet: buttons disabled, a plain "Starting" line shows
    expect(q('[data-testid="memory-progress"]')?.textContent).toContain('Starting')
    expect(btn('Install')?.disabled).toBe(true)
  })

  it('a running op renders "Step 3 of 9: ..." and disables the buttons', async () => {
    await renderCard(fakeClient(), row({ progress: prog({}) }))
    expect(q('[data-testid="memory-progress"]')?.textContent).toContain(
      'Step 3 of 9: Starting vector memory',
    )
    expect(btn('Install')?.disabled).toBe(true)
  })

  it('a failed op shows the error in plain words and offers Try again', async () => {
    await renderCard(
      fakeClient(),
      row({
        state: 'failed',
        progress: prog({ done: true, ok: false, error: 'Could not download the search service image.' }),
      }),
    )
    expect(q('[data-testid="memory-progress"]')).toBeNull()
    expect(q('[data-testid="memory-error"]')?.textContent).toContain(
      'Could not download the search service image.',
    )
    expect(btn('Try again')?.disabled).toBe(false)
  })

  it('installed shows the app switch line, member status, and Remove behind a confirm', async () => {
    const client = fakeClient()
    await renderCard(
      client,
      row({
        state: 'installed',
        endpoints: { RETRIEVAL_URL: 'http://127.0.0.1:8171', NEXUS_URL: 'http://127.0.0.1:8122' },
      }),
      [row({ id: 'memory-nexus', kind: 'container', state: 'installed' }),
       row({ id: 'memory-retrieval', kind: 'container', state: 'installed' })],
    )
    expect(q('[data-testid="memory-endpoints"]')?.textContent).toContain(
      'This assistant now uses this machine for memory and search',
    )
    expect(q('[data-testid="memory-endpoints"]')?.textContent).toContain('http://127.0.0.1:8171')
    expect(q('[data-testid="memory-members"]')?.textContent).toBe('2 of 2 services running')
    expect(btn('Install')).toBeUndefined()
    await click('Remove')
    expect(callsOf(client.action)).toEqual([])
    await click('Confirm')
    expect(callsOf(client.action)).toEqual([['component-remove-start', { id: 'memory-stack' }]])
  })

  it('needs-license shows the reason and no button', async () => {
    await renderCard(
      fakeClient(),
      row({ state: 'needs-license', reason: 'license does not include the assistant' }),
    )
    expect(q('[data-testid="memory-reason"]')?.textContent).toBe('license does not include the assistant')
    expect(host.querySelectorAll('button')).toHaveLength(0)
  })

  it('a refused start (402) says the license does not include it', async () => {
    const client = fakeClient({ state: 'not-entitled', status: 402, data: null, detail: 'x' })
    await renderCard(client, row({}))
    await click('Install')
    expect(q('[data-testid="memory-start-error"]')?.textContent).toBe(
      'Your license does not include the self-hosted memory stack.',
    )
    expect(q('[data-testid="memory-progress"]')).toBeNull()
  })

  it('maps every non-ok start to plain words', () => {
    expect(describeStartFailure(ok({}))).toBeNull()
    expect(describeStartFailure({ state: 'refused', status: 409, data: null, detail: 'busy' })).toBe(
      'The appliance refused: busy',
    )
    expect(
      describeStartFailure({ state: 'unavailable', status: 503, data: null, detail: 'no podman' }),
    ).toBe('This box cannot run it right now: no podman')
    expect(progressLine(prog({ steps: 0, message: 'Pulling' }))).toBe('Pulling')
  })
})

describe('ComponentsPanel mounts the card', () => {
  it('only when the lock offers memory-stack', async () => {
    const client = fakeClient(ok({}), [
      row({}),
      row({ id: 'memory-nexus', kind: 'container', state: 'available' }),
      row({ id: 'awdk', kind: 'pypi', state: 'available' }),
    ])
    await act(async () => {
      root.render(<ComponentsPanel client={client} />)
    })
    expect(card()).not.toBeNull()
    expect(q('[data-testid="memory-members"]')?.textContent).toBe('0 of 1 services running')
    act(() => root.unmount())
    root = createRoot(host)
    const plain = fakeClient(ok({}), [row({ id: 'awdk', kind: 'pypi' })])
    await act(async () => {
      root.render(<ComponentsPanel client={plain} />)
    })
    expect(card()).toBeNull()
  })
})
