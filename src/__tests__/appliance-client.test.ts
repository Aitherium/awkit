/**
 * createApplianceClient against REAL console responses.
 *
 * fixtures/appliance-console.json is written by
 *   python .DEPLOYMENT/standalone/bootc/awnix-console.py --dump-fixtures <file>
 * which runs the actual server with stubbed CLIs, so these tests pin the client to
 * what the server really sends, not to what someone remembers it sending. Regenerate
 * the file whenever the console's envelope changes.
 *
 * The contract: every HTTP outcome becomes an explicit ApiState, and nothing is ever an
 * empty success.
 */
import { describe, expect, it, vi as vitestVi } from 'vitest'
// These suites run under vitest AND under AitherVeil's jest (its roots include awkit/src,
// with `vitest` mapped to jest.vitest-shim.ts, whose `vi` is undefined because jest's
// `jest` object is module-scoped, not global). Take whichever mock namespace exists.
declare const jest: typeof vitestVi | undefined
const vi: typeof vitestVi = typeof jest !== 'undefined' && jest ? jest : vitestVi
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createApplianceClient, stateForStatus } from '../appliance/client'
import type { ApiState, LicenseState } from '../appliance/types'

type Fixture = { status: number; body: unknown }
const FX = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/appliance-console.json'), 'utf-8'),
) as Record<string, Fixture>

function fetchReturning(fx: Fixture, headers: Record<string, string> = {}) {
  return vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(fx.body == null ? '' : JSON.stringify(fx.body), {
      status: fx.status,
      headers: { 'Content-Type': 'application/json', ...headers },
    }),
  )
}

function client(fx: Fixture, extra: { onUnauthorized?: () => void; headers?: Record<string, string> } = {}) {
  const f = fetchReturning(fx, extra.headers)
  return { f, c: createApplianceClient('', { fetch: f as unknown as typeof fetch, onUnauthorized: extra.onUnauthorized }) }
}

describe('license: every state the activation contract defines', () => {
  const expected: Record<LicenseState, ApiState> = {
    valid: 'ok',
    unlicensed: 'refused',
    expired: 'refused',
    invalid: 'refused',
    revoked: 'refused',
    refused: 'refused',
    offline: 'unavailable',
  }
  for (const [lic, api] of Object.entries(expected)) {
    it(`${lic} -> ${api}, and the status document is still in data`, async () => {
      const { c } = client(FX[`license_${lic}`])
      const r = await c.license()
      expect(r.state).toBe(api)
      expect(r.data?.state).toBe(lic)
      expect(r.data?.schema).toBe(1)
    })
  }
})

describe('HTTP mapping', () => {
  it('423 lockout is "locked" with retryAfter from the body', async () => {
    const { c } = client(FX.login_locked)
    const r = await c.login('WRONGWRONG')
    expect(r.state).toBe('locked')
    expect(r.retryAfter).toBe(60)
  })

  it('401 is refused and fires onUnauthorized', async () => {
    const onUnauthorized = vi.fn()
    const { c } = client(FX.unauthorized, { onUnauthorized })
    const r = await c.license()
    expect(r.state).toBe('refused')
    expect(r.status).toBe(401)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('501 from the console (binary absent) is unavailable, never ok', async () => {
    const { c } = client(FX.action_unavailable)
    const r = await c.action('endpoints-probe')
    expect(r.state).toBe('unavailable')
    expect(r.data).toBeNull()
  })

  it('501 from the tenant proxy off-appliance is not-an-appliance', async () => {
    const { c } = client({ status: 501, body: { state: 'not-an-appliance', available: false } })
    expect((await c.overview()).state).toBe('not-an-appliance')
  })

  it('402 is not-entitled; 409 refused; 503 unavailable -- each keeps the CLI JSON', async () => {
    const ne = await client(FX.action_not_entitled).c.action('component-install', { id: 'awdesk' })
    expect(ne.state).toBe('not-entitled')
    expect(ne.exit).toBe(3)
    const rf = await client(FX.action_refused).c.action('update-check')
    expect(rf.state).toBe('refused')
    expect((rf.data as { state: string }).state).toBe('unsigned-refused')
    const off = await client(FX.action_offline).c.action('update-check')
    expect(off.state).toBe('unavailable')
    expect(off.exit).toBe(2)
  })

  it('422 validation and 404 unknown verb are errors', async () => {
    expect((await client(FX.action_invalid).c.action('update-channel', { channel: 'beta' })).state).toBe('error')
    expect((await client(FX.action_unknown).c.action('update-check')).state).toBe('error')
  })

  it('a network failure is unavailable with status 0', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const c = createApplianceClient('', { fetch: f as unknown as typeof fetch })
    const r = await c.updates()
    expect(r).toMatchObject({ state: 'unavailable', status: 0, data: null })
  })

  it('a 200 read with no result is an error, not an empty success', async () => {
    const { c } = client({ status: 200, body: { verb: 'updates-status', exit: 0, state: 'ok', result: null, stdout_tail: '' } })
    const r = await c.updates()
    expect(r.state).toBe('error')
  })

  it('a 200 that is not JSON is an error', async () => {
    const f = vi.fn(async () => new Response('<html>proxy error</html>', { status: 200 }))
    const c = createApplianceClient('', { fetch: f as unknown as typeof fetch })
    expect((await c.session()).state).toBe('error')
  })

  it('stateForStatus covers every contract code', () => {
    expect(stateForStatus(200, {})).toBe('ok')
    expect(stateForStatus(402, {})).toBe('not-entitled')
    expect(stateForStatus(409, {})).toBe('refused')
    expect(stateForStatus(423, {})).toBe('locked')
    expect(stateForStatus(501, {})).toBe('unavailable')
    expect(stateForStatus(503, {})).toBe('unavailable')
    expect(stateForStatus(500, {})).toBe('error')
  })
})

describe('reads and requests', () => {
  it('updates/components/surfaces unwrap the envelope result', async () => {
    expect((await client(FX.updates).c.updates()).data?.channel).toBe('stable')
    expect((await client(FX.components).c.components()).data?.results.length).toBe(2)
    const s = await client(FX.surfaces_tenant).c.surfaces()
    expect(s.state).toBe('ok')
    const acme = s.data?.surfaces.find((x) => x.id === 'acme_ui')
    expect(acme?.url).toBe('https://127.0.0.1:8900')
    for (const id of ['living_desktop', 'aol', 'veil']) {
      expect(s.data?.surfaces.find((x) => x.id === id)?.delivery).toBe('link')
    }
  })

  it('session is read as a plain document (setup mode, not signed in)', async () => {
    const r = await client(FX.session_setup).c.session()
    expect(r.state).toBe('ok')
    expect(r.data).toMatchObject({ mode: 'setup', authenticated: false, brand: 'AcmeBot' })
  })

  it('POSTs carry X-Awnix-Console, JSON and same-origin credentials; GETs do not', async () => {
    const { f, c } = client(FX.action_ok)
    await c.action('update-channel', { channel: 'beta' })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('/api/appliance/actions/update-channel')
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('same-origin')
    expect((init?.headers as Record<string, string>)['X-Awnix-Console']).toBe('1')
    expect(JSON.parse(String(init?.body))).toEqual({ channel: 'beta' })

    const g = client(FX.updates)
    await g.c.updates()
    const ginit = g.f.mock.calls[0][1]
    expect(ginit?.method).toBe('GET')
    expect((ginit?.headers as Record<string, string>)['X-Awnix-Console']).toBeUndefined()
    expect(ginit?.body).toBeUndefined()
  })

  it('apiBase is prefixed without a double slash (tenant proxy use)', async () => {
    const f = fetchReturning(FX.updates)
    const c = createApplianceClient('https://acme.example.com/', { fetch: f as unknown as typeof fetch })
    await c.updates()
    expect(f.mock.calls[0][0]).toBe('https://acme.example.com/api/appliance/updates')
  })

  it('the login code is trimmed and sent in the body, never the URL', async () => {
    const { f, c } = client(FX.session_console)
    await c.login('  ABCDE23456 ')
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('/api/login')
    expect(JSON.parse(String(init?.body))).toEqual({ code: 'ABCDE23456' })
  })
})
