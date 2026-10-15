/**
 * The desktop Browser app (web-browser.tsx), 2026-10-14 live bug: a signed-in tenant
 * owner typed https://github.com into the Aither Browser window inside Aither Desk and
 * read "Could not open a browser session: HTTP 403".
 *
 *   1. A 403 names its cause in words. The Veil edge refuses with
 *      `{ error, message, required }`, not `{ detail }`, so reading only `detail`
 *      left the user a bare status code.
 *   2. Inside the desk (`data-aither-host="desk"`), a URL opens in the desk's NATIVE
 *      Aither Browser over aither-host/1 `desk-browse`; no remote session is opened.
 *   3. A desk that refuses (or an old desk that never answers) falls back to the
 *      remote session, so the URL is never silently dropped.
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('sonner', () => ({ toast: { info: jest.fn(), success: jest.fn() } }))

import { WebBrowser, openInDeskBrowser, refusalText } from '../web-browser'

type Call = { url: string; init?: RequestInit }

let calls: Call[]
let realFetch: typeof window.fetch
let realPost: typeof window.postMessage

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => body,
  } as unknown as Response
}

function stubFetch(answer: (url: string) => Response) {
  calls = []
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    return Promise.resolve(answer(url))
  }) as typeof window.fetch
}

function markDesk(on: boolean) {
  if (on) document.documentElement.setAttribute('data-aither-host', 'desk')
  else document.documentElement.removeAttribute('data-aither-host')
}

/** Play the desk preload: answer every desk-browse with `reply(url)`; record what was asked. */
function deskAnswers(reply: (url: string) => Record<string, unknown> | null) {
  const asked: Array<Record<string, unknown>> = []
  window.postMessage = ((data: Record<string, unknown>, target: string) => {
    if (data && data.__aither === 'desk-browse') {
      asked.push({ ...data, target })
      const r = reply(String(data.url))
      if (r) {
        setTimeout(() => {
          window.dispatchEvent(new MessageEvent('message', {
            data: { __aither: 'desk-browse-result', reqId: data.reqId, ...r },
            source: window,
            origin: window.location.origin,
          }))
        }, 0)
      }
    }
  }) as typeof window.postMessage
  return asked
}

function go(url: string) {
  const input = screen.getByLabelText('Address and search bar')
  fireEvent.change(input, { target: { value: url } })
  fireEvent.submit(input.closest('form') as HTMLFormElement)
}

beforeAll(() => {
  realFetch = window.fetch
  realPost = window.postMessage
})
afterEach(() => {
  window.fetch = realFetch
  window.postMessage = realPost
  markDesk(false)
  localStorage.clear()
})

describe('a 403 names its cause', () => {
  it('the edge RBAC refusal reads as a permission sentence, not "HTTP 403"', async () => {
    stubFetch(() => jsonResponse(403, {
      error: 'Forbidden',
      message: "You don't have permission to execute browser.",
      required: 'browser:execute',
      your_roles: ['registered'],
    }))
    render(<WebBrowser />)
    go('https://github.com')
    await waitFor(() => expect(screen.getByText(/not allowed to open an Aither Browser session/)).toBeTruthy())
    const banner = screen.getByText(/not allowed to open an Aither Browser session/).textContent || ''
    expect(banner).toContain('browser:execute')
    expect(banner).toContain("You don't have permission to execute browser.")
    expect(banner).not.toMatch(/HTTP 403/)
    expect(calls[0].url).toBe('/api/browser-session')
  })

  it('refusalText keeps a route detail and never prints a bare status', () => {
    const res = { status: 403, statusText: 'Forbidden' } as Response
    expect(refusalText({ detail: 'guest access refused' }, res)).toContain('"guest access refused"')
    const bare = refusalText(null, res)
    expect(bare).not.toMatch(/HTTP 403/)
    expect(bare).toMatch(/not allowed to open an Aither Browser session/)
  })

  it('a non-403 failure keeps its own message path', async () => {
    stubFetch(() => jsonResponse(502, { detail: 'AitherBrowser unreachable: boom' }))
    render(<WebBrowser />)
    go('https://github.com')
    await waitFor(() => expect(screen.getByText(/Could not open a browser session: AitherBrowser unreachable: boom/)).toBeTruthy())
  })
})

describe('inside the desk, a URL opens in the native Aither Browser', () => {
  it('posts desk-browse to its own window, pinned to its origin, and opens NO remote session', async () => {
    markDesk(true)
    stubFetch(() => jsonResponse(500, {}))
    const asked = deskAnswers((url) => ({ ok: true, url }))
    render(<WebBrowser />)
    go('https://github.com')
    await waitFor(() => expect(screen.getByText(/Opened github.com in Aither Browser/)).toBeTruthy())
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ __aither: 'desk-browse', url: 'https://github.com', target: window.location.origin })
    expect(typeof asked[0].reqId).toBe('string')
    expect(calls.filter((c) => c.url.startsWith('/api/browser-session'))).toHaveLength(0)
    expect(screen.getByText('opened in Desk’s Aither Browser')).toBeTruthy()
  })

  it('falls back to the remote session when the desk refuses', async () => {
    markDesk(true)
    stubFetch(() => jsonResponse(200, { sessionId: 'sid-1', url: 'https://github.com', title: 'GitHub', engine: 'chromium', screenshot: 'AAAA' }))
    const asked = deskAnswers(() => ({ ok: false, error: 'opening the Aither Browser needs a click or key press' }))
    render(<WebBrowser />)
    go('https://github.com')
    await waitFor(() => expect(calls.some((c) => c.url === '/api/browser-session')).toBe(true))
    expect(asked).toHaveLength(1)
    await waitFor(() => expect(screen.getByText(/session sid-1/)).toBeTruthy())
  })

  it('outside the desk the remote session is used directly, with no desk message', async () => {
    stubFetch(() => jsonResponse(200, { sessionId: 'sid-2', url: 'https://github.com', title: 'GitHub', engine: 'chromium', screenshot: 'AAAA' }))
    const asked = deskAnswers(() => ({ ok: true }))
    render(<WebBrowser />)
    go('https://github.com')
    await waitFor(() => expect(screen.getByText(/session sid-2/)).toBeTruthy())
    expect(asked).toHaveLength(0)
  })
})

describe('openInDeskBrowser', () => {
  it('times out to {ok:false} when an old desk never answers', async () => {
    markDesk(true)
    deskAnswers(() => null)
    jest.useFakeTimers()
    try {
      const p = openInDeskBrowser('https://github.com', 50)
      await act(async () => { jest.advanceTimersByTime(60) })
      await expect(p).resolves.toEqual({ ok: false, error: 'the desk did not answer' })
    } finally {
      jest.useRealTimers()
    }
  })

  it('ignores an answer from another origin or for another request', async () => {
    markDesk(true)
    window.postMessage = (() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __aither: 'desk-browse-result', reqId: 'someone-else', ok: true }, source: window, origin: window.location.origin,
      }))
      window.dispatchEvent(new MessageEvent('message', {
        data: { __aither: 'desk-browse-result', ok: true }, source: window, origin: 'https://evil.test',
      }))
    }) as typeof window.postMessage
    await expect(openInDeskBrowser('https://github.com', 30)).resolves.toEqual({ ok: false, error: 'the desk did not answer' })
  })

  it('is a no-op refusal outside the desk', async () => {
    await expect(openInDeskBrowser('https://github.com')).resolves.toEqual({ ok: false, error: 'not running inside the desk' })
  })
})
