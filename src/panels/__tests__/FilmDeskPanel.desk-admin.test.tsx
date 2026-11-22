/**
 * FilmDeskPanel's desk controls on the surface a tenant actually sees (the Veil export
 * mounts this awkit panel, not the tenant's own Vite copy — #14585 only reached the latter).
 *
 * Pins: a workspace admin gets Approve/Reject/Rebuild/Build/Render and each POSTs to the
 * host route; a member gets the plain explanation and no admin buttons; open script
 * questions disable Approve with the reason; a 403 from the host is shown as its sentence.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import FilmDeskPanel from '../FilmDeskPanel'

type Reply = { status: number; body: unknown }
type Handler = (method: string, url: string, body: unknown) => Reply | undefined

function serve(handler: Handler) {
  const calls: Array<{ method: string; url: string; body: unknown }> = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    const r = handler(method, url, body) ?? { status: 404, body: { detail: 'Not Found' } }
    return { ok: r.status < 300, status: r.status, json: async () => r.body }
  })
  return calls
}

const ADMIN = { role: 'workspace_admin', enabled: true,
  can: { ask: true, decide: true, rebuild: true, build: true, render: true } }
const MEMBER = { role: 'member', enabled: true,
  can: { ask: true, decide: false, rebuild: false, build: false, render: false } }

function fleet(caps: unknown, steer: unknown, writes?: (url: string) => Reply | undefined) {
  return serve((method, url) => {
    if (method === 'POST') return writes?.(url) ?? { status: 200, body: { status: 'started' } }
    if (url === '/api/film/desk') return { status: 200, body: caps }
    if (url === '/api/film/projects') {
      return { status: 200, body: { projects: [{ name: 'union', title: 'Union Station' }] } }
    }
    if (url === '/api/film/projects/union') {
      return { status: 200, body: { project: 'union', title: 'Union Station', unit: 'u',
        outputs: {}, shots: [{ id: 'step01', chapter: 'Footings', start: 0, dur: 4 }] } }
    }
    if (url === '/api/film/projects/union/proposals') return { status: 200, body: { proposals: [] } }
    if (url === '/api/film/projects/union/steer') return { status: 200, body: { steer } }
    if (url.startsWith('/api/film/projects/union/looks')) return { status: 200, body: {} }
    return undefined
  })
}

const STEER = { pending: { id: 'p7', status: 'pending', version: 'v3', changed_steps: [1] },
  open_questions: 0, steps: { '1': { state: 'stale' } }, job: null }

describe('FilmDeskPanel desk controls', () => {
  it('gives an admin every verb and posts each to the host route', async () => {
    const calls = fleet(ADMIN, STEER)
    render(<FilmDeskPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST'
      && c.url === '/api/film/projects/union/proposals/p7/decide')).toBe(true))
    expect(calls.find((c) => c.url.endsWith('/p7/decide'))!.body).toEqual({ action: 'approve' })

    fireEvent.click(await screen.findByRole('button', { name: 'Rebuild' }))
    await waitFor(() => expect(calls.some((c) =>
      c.url === '/api/film/projects/union/shots/step01/rebuild')).toBe(true))
    fireEvent.click(await screen.findByRole('button', { name: 'Build the film' }))
    await waitFor(() => expect(calls.some((c) =>
      c.url === '/api/film/projects/union/build')).toBe(true))
    fireEvent.click(await screen.findByRole('button', { name: 'Render' }))
    await waitFor(() => expect(calls.find((c) =>
      c.url === '/api/film/projects/union/render')?.body).toEqual({ steps: 'stale' }))
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy()
  })

  it('shows a member the explanation and no admin buttons', async () => {
    fleet(MEMBER, STEER)
    render(<FilmDeskPanel />)
    expect(await screen.findByText(/need a workspace administrator/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Render' })).toBeNull()
  })

  it('blocks approval while script questions are open, with the reason', async () => {
    fleet(ADMIN, { ...STEER, open_questions: 2 })
    render(<FilmDeskPanel />)
    const approve = await screen.findByRole('button', { name: 'Approve' })
    expect((approve as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByText(/Answer the 2 open script questions first/).length).toBeGreaterThan(0)
  })

  it('shows the host refusal as its sentence', async () => {
    fleet(ADMIN, STEER, (url) => url.endsWith('/decide')
      ? { status: 403, body: { detail: 'Approving needs a workspace administrator.' } }
      : undefined)
    render(<FilmDeskPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect((await screen.findByRole('alert')).textContent)
      .toBe('Approving needs a workspace administrator.')
  })
})
