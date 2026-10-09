/**
 * IrisPanel on a browser-only deployment (a tenant subdomain, 2026-10-08).
 *
 * Pins: a video brief where no Iris / GPU media backend answers is refused BEFORE any
 * plan is requested, with the reason and what works instead; a run whose results carry
 * no output says "produced nothing" with the reason, never "finished"; the button
 * spinner stops in every case.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import IrisPanel from '../IrisPanel'

type Handler = (method: string, url: string) => { status: number; body: unknown } | undefined

function serve(handler: Handler) {
  const calls: Array<{ method: string; url: string }> = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    calls.push({ method, url })
    const r = handler(method, url) ?? { status: 404, body: { detail: 'Not Found' } }
    return { ok: r.status < 300, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) }
  })
  return calls
}

function typeBrief(text: string) {
  fireEvent.change(screen.getByPlaceholderText(/concept art/i), { target: { value: text } })
}

describe('IrisPanel capability preflight', () => {
  it('refuses a video up front on a static portal and never asks for a plan', async () => {
    const calls = serve(() => undefined) // every /api/* is a 404: nothing creative here
    render(<IrisPanel />)
    typeBrief('make a video of 12 Main St, Springfield')
    fireEvent.click(screen.getByText('Generate Pipeline'))

    const gap = await screen.findByTestId('iris-capability-gap')
    expect(gap.textContent).toMatch(/Video generation needs a GPU media backend/)
    expect(gap.textContent).toMatch(/storyboard/i)
    expect(calls.some(c => c.url.includes('/api/iris/preview'))).toBe(false)
    // The spinner is gone: the button reads its idle label again and is enabled.
    await waitFor(() => expect((screen.getByText('Generate Pipeline').closest('button') as HTMLButtonElement).disabled).toBe(false))
  })

  it('a run with no output says it produced nothing, with the reason', async () => {
    serve((method, url) => {
      if (url === '/api/iris/pipeline' && method === 'GET') return { status: 200, body: { status: 'ok' } }
      if (url === '/api/studio/health') return { status: 200, body: { ok: true } }
      if (url === '/api/iris/preview') {
        return { status: 200, body: { assets: [{ type: 'video', prompt: 'fly over', backend: 'wan' }] } }
      }
      if (url === '/api/iris/pipeline' && method === 'POST') {
        return { status: 200, body: { success: true, results: [{ error: 'no video backend available' }] } }
      }
      return undefined
    })
    render(<IrisPanel />)
    typeBrief('make a video of the harbour')
    fireEvent.click(screen.getByText('Generate Pipeline'))
    fireEvent.click(await screen.findByText('Run pipeline'))

    const outcome = await screen.findByTestId('iris-outcome')
    expect(outcome.textContent).toMatch(/produced nothing/)
    expect(outcome.textContent).toMatch(/no video backend available/)
    await waitFor(() => expect((screen.getByText('Run pipeline').closest('button') as HTMLButtonElement).disabled).toBe(false))
  })
})
