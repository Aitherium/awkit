// @vitest-environment jsdom
/**
 * LicensePanel (#/license), driven through the REAL console client
 * (createApplianceClient) over a stubbed fetch that speaks the awnix-console envelope
 * {verb, exit, state, result, stdout_tail}. Every state renders from the status enum, the
 * refused detail is shown VERBATIM, a 501 is "not an appliance", and an unreadable state
 * is an explicit notice -- never an empty success. Both directions are pinned: a panel
 * that rendered nothing would fail the positive assertions.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import LicensePanel, { envelopeShapeError, isLicenseStatus, outcomeFor } from '../appliance/LicensePanel'
import { createApplianceClient } from '../appliance/client'
import type { LicenseState, LicenseStatus } from '../appliance/types'

// Rendered for real (react-dom in jsdom), like appliance-console.test.tsx: awnix-web's
// vitest has react + jsdom and nothing else, so no testing-library.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function render(el: ReactElement) {
  await act(async () => {
    root.render(el)
  })
}

async function waitFor<T>(fn: () => T, ms = 3000): Promise<T> {
  const t0 = Date.now()
  for (;;) {
    try {
      return fn()
    } catch (e) {
      if (Date.now() - t0 > ms) throw e
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10))
      })
    }
  }
}

const query = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`)
function get(id: string): HTMLElement {
  const el = query(id)
  if (!el) throw new Error(`no [data-testid=${id}]`)
  return el
}
const find = (id: string) => waitFor(() => get(id))
function button(name: string): HTMLButtonElement {
  const b = [...container.querySelectorAll('button')].find((x) => x.textContent === name)
  if (!b) throw new Error(`no button ${name}`)
  return b
}
async function click(el: HTMLElement) {
  await act(async () => {
    el.click()
  })
}
async function type(value: string) {
  const ta = await waitFor(() => {
    const t = container.querySelector('textarea')
    if (!t) throw new Error('no textarea')
    return t
  })
  // Sanity: the field is labelled as the tests and screen readers expect.
  expect(ta.closest('label')?.textContent).toContain('License envelope')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(ta, value)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const ENVELOPE = 'AITHER1.eyJsaWNfaWQiOiJsaWNfeCJ9.c2lnbmF0dXJl'
const EXIT_HTTP: Record<number, number> = { 0: 200, 1: 409, 2: 503 }

function status(state: LicenseState, over: Partial<LicenseStatus> = {}): LicenseStatus {
  const none = state === 'unlicensed'
  return {
    schema: 1,
    state,
    lic_id: none ? null : 'lic_abc',
    sku: none ? null : 'acme-appliance-pro',
    tier: none ? null : 'sovereign',
    exp: 0,
    checked_at: '2026-09-27T12:00:00Z',
    detail: state === 'valid' ? 'registry armed' : `detail for ${state}`,
    entitlements: { appliance_tier: 'acme', images: ['ghcr.io/aitherium/acme-appliance'], packs: ['acme'] },
    registry: {
      state: state === 'valid' ? 'armed' : 'unconfigured',
      expires_at: state === 'valid' ? '2026-09-27T13:00:00Z' : null,
      images: 1,
    },
    ...over,
  }
}

/** A console reply: the CLI exit code maps to HTTP exactly like awnix_console/actions.py. */
function cli(verb: string, exit: number, result: unknown) {
  return { http: EXIT_HTTP[exit], body: { verb, exit, state: exit ? 'refused' : 'ok', result, stdout_tail: '' } }
}

type Reply = { http: number; body: unknown }

/** A box: GET /api/appliance/license returns `state`; actions call `onAction`. */
function box(read: () => Reply, onAction?: (verb: string, body: unknown) => Reply) {
  const calls: Array<[string, unknown]> = []
  const headers: Array<Record<string, string>> = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = new URL(url, 'https://box:9443').pathname
    let reply: Reply
    if (path === '/api/appliance/license') {
      reply = read()
    } else if (path.startsWith('/api/appliance/actions/')) {
      const verb = path.slice('/api/appliance/actions/'.length)
      const body = JSON.parse(String(init?.body ?? '{}'))
      calls.push([verb, body])
      headers.push((init?.headers ?? {}) as Record<string, string>)
      reply = onAction ? onAction(verb, body) : cli(verb, 0, status('valid'))
    } else {
      reply = { http: 404, body: { detail: 'no route' } }
    }
    return new Response(JSON.stringify(reply.body), { status: reply.http })
  }) as unknown as typeof fetch
  return { client: createApplianceClient('https://box:9443', { fetch: fetchImpl }), calls, headers }
}

describe('LicensePanel states', () => {
  const states: LicenseState[] = ['unlicensed', 'valid', 'expired', 'invalid', 'revoked', 'refused', 'offline']
  for (const st of states) {
    it(`renders the ${st} badge from the enum (CLI exit -> HTTP as the console maps it)`, async () => {
      const exit = st === 'valid' || st === 'unlicensed' ? 0 : st === 'offline' ? 2 : 1
      const b = box(() => cli('license', exit, status(st)))
      await render(<LicensePanel client={b.client} />)
      const badge = await find('license-badge')
      expect(badge.getAttribute('data-state')).toBe(st)
      expect(query('license-error')).toBeNull()
      if (st === 'valid') {
        expect(query('license-detail')).toBeNull()
        expect(get('license-registry').getAttribute('data-state')).toBe('armed')
        expect(container.textContent).toContain('lic_abc')
      } else {
        expect(get('license-detail').textContent).toBe(`detail for ${st}`)
      }
    })
  }

  it('renders the legacy-token registry state', async () => {
    const b = box(() =>
      cli('license', 0, status('unlicensed', { registry: { state: 'legacy-token', expires_at: null, images: 0 } })),
    )
    await render(<LicensePanel client={b.client} />)
    expect((await find('license-registry')).getAttribute('data-state')).toBe('legacy-token')
  })

  it('501 renders "not an appliance", not an empty panel', async () => {
    const b = box(() => ({ http: 501, body: { available: false, detail: 'aitheros is not installed' } }))
    await render(<LicensePanel client={b.client} />)
    expect(await find('license-not-appliance')).toBeTruthy()
    expect(container.textContent).toContain('Not an appliance')
    expect(query('license-badge')).toBeNull()
  })

  it('503 without a status is an explicit notice, never a success', async () => {
    const b = box(() => ({ http: 503, body: { detail: 'console unreachable' } }))
    await render(<LicensePanel client={b.client} />)
    const err = await find('license-error')
    expect(err.getAttribute('data-http')).toBe('503')
    expect(err.textContent).toContain('console unreachable')
    expect(query('license-badge')).toBeNull()
  })

  it('a 200 with no status is an error notice, not an empty success', async () => {
    const b = box(() => ({ http: 200, body: { verb: 'license', exit: 0, state: 'ok', result: { nope: 1 }, stdout_tail: '' } }))
    await render(<LicensePanel client={b.client} />)
    const err = await find('license-error')
    expect(err.textContent).toContain('no license status')
    expect(query('license-badge')).toBeNull()
  })

  it('401 is a notice (the shell shows the code screen), not a badge', async () => {
    const b = box(() => ({ http: 401, body: { detail: 'sign in' } }))
    await render(<LicensePanel client={b.client} />)
    expect((await find('license-error')).getAttribute('data-http')).toBe('401')
    expect(query('license-badge')).toBeNull()
  })
})

describe('LicensePanel actions', () => {
  it('paste -> license-import with {license} + console header; refused detail verbatim', async () => {
    const refused = 'license revoked'
    let current = status('unlicensed')
    const b = box(
      () => cli('license', current.state === 'unlicensed' ? 0 : 1, current),
      () => {
        current = status('revoked', { detail: refused })
        return cli('license-import', 1, current)
      },
    )
    await render(<LicensePanel client={b.client} />)
    await type(`  ${ENVELOPE}\n`)
    await click(button('Activate'))
    const out = await find('license-outcome')
    expect(out.textContent).toBe(refused)
    expect(out.getAttribute('data-ok')).toBe('0')
    expect(b.calls).toEqual([['license-import', { license: ENVELOPE }]])
    expect(b.headers[0]['X-Awnix-Console']).toBe('1')
    await waitFor(() => expect(get('license-badge').getAttribute('data-state')).toBe('revoked'))
  })

  it('a successful import re-reads status.json and shows valid', async () => {
    let current = status('unlicensed')
    const b = box(
      () => cli('license', 0, current),
      () => {
        current = status('valid')
        // `license import -` prints human text: result is null, the re-read carries the state
        return { http: 200, body: { verb: 'license-import', exit: 0, state: 'ok', result: null, stdout_tail: 'license: valid' } }
      },
    )
    await render(<LicensePanel client={b.client} />)
    await type(ENVELOPE)
    await click(button('Activate'))
    const out = await find('license-outcome')
    expect(out.getAttribute('data-ok')).toBe('1')
    await waitFor(() => expect(get('license-badge').getAttribute('data-state')).toBe('valid'))
  })

  it('a malformed paste is blocked client-side and never sent', async () => {
    const b = box(() => cli('license', 0, status('unlicensed')))
    await render(<LicensePanel client={b.client} />)
    await type('hello')
    expect(get('license-shape-error')).toBeTruthy()
    expect(button('Activate').disabled).toBe(true)
    expect(b.calls).toEqual([])
  })

  it('Check now -> license-refresh; an offline result is not reported as success', async () => {
    const b = box(
      () => cli('license', 0, status('valid')),
      () => cli('license-refresh', 2, status('offline', { detail: 'exchange unreachable: timed out' })),
    )
    await render(<LicensePanel client={b.client} />)
    await click(await waitFor(() => button('Check now')))
    const out = await find('license-outcome')
    expect(out.getAttribute('data-ok')).toBe('0')
    expect(out.textContent).toBe('exchange unreachable: timed out')
    expect(b.calls).toEqual([['license-refresh', {}]])
  })

  it('an action answering 501 flips to not-an-appliance', async () => {
    const b = box(
      () => cli('license', 0, status('unlicensed')),
      () => ({ http: 501, body: { available: false } }),
    )
    await render(<LicensePanel client={b.client} />)
    await click(await waitFor(() => button('Check now')))
    expect(await find('license-not-appliance')).toBeTruthy()
  })
})

describe('helpers', () => {
  it('envelopeShapeError', () => {
    expect(envelopeShapeError(ENVELOPE)).toBeNull()
    expect(envelopeShapeError('AITHER2.a.b')).not.toBeNull()
    expect(envelopeShapeError(`AITHER1.${'a'.repeat(17000)}.b`)).toContain('16 KiB')
  })

  it('isLicenseStatus rejects an action envelope and void enums', () => {
    expect(isLicenseStatus(status('valid'))).toBe(true)
    expect(isLicenseStatus({ verb: 'x', state: 'refused', result: status('expired') })).toBe(false)
    expect(isLicenseStatus({ ...status('valid'), state: 'licensed' })).toBe(false)
    expect(isLicenseStatus(null)).toBe(false)
  })

  it('outcomeFor never calls a non-valid status a success', () => {
    expect(outcomeFor('license-refresh', { state: 'ok', status: 200, data: status('expired') }).ok).toBe(false)
    expect(outcomeFor('license-refresh', { state: 'unavailable', status: 0, data: null, detail: 'x' })).toEqual({
      ok: false,
      message: 'x',
    })
    expect(outcomeFor('license-import', { state: 'ok', status: 200, data: status('valid') }).ok).toBe(true)
  })
})
