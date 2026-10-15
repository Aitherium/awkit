/**
 * @jest-environment jsdom
 *
 * The workspace error reporter: an uncaught error / unhandled rejection reaches the
 * tenant backend's support intake once, scrubbed, without query strings, honouring the
 * per-browser opt-out, and going quiet when the host has no intake.
 */
import { installErrorReporter, reportCaughtError, scrubClientText, setAutoErrorReports } from './errorReporter'

function fakeFetch(status = 200) {
  const calls: { url: string; init: RequestInit }[] = []
  const fn = ((url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve({ status } as Response)
  }) as unknown as typeof fetch
  return { fn, calls }
}

function fireError(message: string, stack: string) {
  const err = new Error(message)
  err.stack = stack
  window.dispatchEvent(new ErrorEvent('error', { error: err, message }))
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('installErrorReporter', () => {
  let uninstall: () => void = () => {}
  afterEach(() => {
    uninstall()
    setAutoErrorReports(true)
  })

  it('sends a distinct uncaught error once to the support intake, scrubbed', async () => {
    window.history.pushState({}, '', '/chat?token=abc123#x')
    const f = fakeFetch()
    uninstall = installErrorReporter({ apiBase: 'https://api.example', appName: 'acme', fetchImpl: f.fn })
    const stack = 'Error: boom ghp_secretTOKEN1\n    at render (https://x/app.js:10:5)'
    fireError('boom ghp_secretTOKEN1', stack)
    fireError('boom ghp_secretTOKEN1', stack)
    await flush()
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0].url).toBe('https://api.example/api/support/reports')
    expect(f.calls[0].init.credentials).toBe('include')
    const body = JSON.parse(String(f.calls[0].init.body))
    expect(body.kind).toBe('error')
    expect(body.source).toBe('web')
    expect(body.page.endsWith('/chat')).toBe(true)
    expect(JSON.stringify(body)).not.toContain('ghp_secretTOKEN1')
    expect(JSON.stringify(body)).not.toContain('abc123')
    expect(body.tenant_id).toBeUndefined()
  })

  it('reports unhandled promise rejections', async () => {
    const f = fakeFetch()
    uninstall = installErrorReporter({ fetchImpl: f.fn })
    const ev = new Event('unhandledrejection') as PromiseRejectionEvent
    Object.defineProperty(ev, 'reason', { value: new TypeError('x is undefined') })
    window.dispatchEvent(ev)
    await flush()
    expect(f.calls).toHaveLength(1)
    expect(JSON.parse(String(f.calls[0].init.body)).title).toMatch(/Unhandled rejection: TypeError: x is undefined/)
  })

  it('honours the per-browser opt-out', async () => {
    setAutoErrorReports(false)
    const f = fakeFetch()
    uninstall = installErrorReporter({ fetchImpl: f.fn })
    fireError('boom', 'Error: boom\n    at a (x.js:1:1)')
    await flush()
    expect(f.calls).toHaveLength(0)
  })

  it('goes quiet after the host answers 404 (no intake)', async () => {
    const f = fakeFetch(404)
    uninstall = installErrorReporter({ fetchImpl: f.fn })
    fireError('one', 'Error: one\n    at a (x.js:1:1)')
    await flush()
    fireError('two', 'Error: two\n    at b (x.js:2:1)')
    await flush()
    expect(f.calls).toHaveLength(1)
  })

  it('reports what an error boundary caught, only once installed', async () => {
    const f = fakeFetch()
    reportCaughtError(new Error('before install'))
    uninstall = installErrorReporter({ fetchImpl: f.fn })
    reportCaughtError(new Error('render broke'), '    in Panel')
    await flush()
    expect(f.calls).toHaveLength(1)
    const body = JSON.parse(String(f.calls[0].init.body))
    expect(body.title).toBe('Render error: Error: render broke')
    expect(body.stack).toContain('in Panel')
  })

  it('caps reports per page', async () => {
    const f = fakeFetch()
    uninstall = installErrorReporter({ fetchImpl: f.fn })
    for (let i = 0; i < 10; i++) fireError(`e${i}`, `Error: e${i}\n    at f${i} (x.js:${i}:1)`)
    await flush()
    expect(f.calls).toHaveLength(5)
  })
})

describe('scrubClientText', () => {
  it('removes keys, bearer tokens, query secrets and e-mail', () => {
    const out = scrubClientText('Bearer eyJabc.def.ghi password=hunter2 https://x/cb?code=zz1 a@b.co sk-ant-123')
    for (const leak of ['eyJabc', 'hunter2', 'zz1', 'a@b.co', 'sk-ant-123']) expect(out).not.toContain(leak)
  })
})
