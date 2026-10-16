/**
 * KidEasel against a fake Hearth easel (kids' suite S7).
 *
 * Pins: drawing is local; "Show my family" sends ONE request to /me/easel and nothing to
 * the family room; the child then sees "Waiting for a grown-up"; a refusal shows the
 * server's own kind line; nothing can be shared before something is drawn; there is no
 * text input and no link anywhere on the easel.
 */
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'

import KidEasel, { shareWords } from '../KidEasel'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function fakeCanvas() {
  const ctx: Record<string, unknown> = {}
  for (const m of ['fillRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'arc', 'ellipse', 'save',
    'restore', 'translate', 'rotate', 'closePath', 'bezierCurveTo', 'roundRect']) ctx[m] = jest.fn()
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  jest.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(PNG)
  jest.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(
    { left: 0, top: 0, width: 1024, height: 720, right: 1024, bottom: 720, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
  return ctx
}

function fakeServer(postReply: { status: number; body: unknown }) {
  const calls: Array<{ method: string; url: string; body: unknown }> = []
  let shares: unknown[] = []
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    if (method === 'POST' && url.endsWith('/me/easel')) {
      if (postReply.status < 400) shares = [{ drawing_id: 'dr_1', status: 'asked', image: PNG }]
      return { ok: postReply.status < 400, status: postReply.status, json: async () => postReply.body }
    }
    if (url.endsWith('/me/easel')) return { ok: true, status: 200, json: async () => ({ drawings: shares }) }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  return calls
}

beforeEach(() => { localStorage.clear(); fakeCanvas() })
afterEach(() => { jest.restoreAllMocks() })

const draw = (canvas: HTMLElement) => {
  fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, pointerId: 1 })
  fireEvent.pointerMove(canvas, { clientX: 200, clientY: 140, pointerId: 1 })
  fireEvent.pointerUp(canvas, { pointerId: 1 })
}

test('share words are plain and kind', () => {
  expect(shareWords('asked')).toBe('Waiting for a grown-up')
  expect(shareWords('posted')).toMatch(/family can see/)
  expect(shareWords('not_now')).toMatch(/still yours/)
  expect(shareWords('withdrawn')).toBe('')
})

test('show my family sends a request that waits for a grown-up, never a room post', async () => {
  const calls = fakeServer({ status: 201, body: { drawing: { drawing_id: 'dr_1', status: 'asked' }, say: "I sent it to your grown-up. They'll take a look!" } })
  const { container } = render(<KidEasel apiBase="/api/tutor" />)
  const share = screen.getByLabelText('Show my family') as HTMLButtonElement
  expect(share.disabled).toBe(true)  // nothing drawn yet
  draw(screen.getByTestId('kid-easel-canvas'))
  expect(share.disabled).toBe(false)
  await act(async () => { fireEvent.click(share) })

  const posts = calls.filter((c) => c.method === 'POST')
  expect(posts).toHaveLength(1)
  expect(posts[0].url).toBe('/api/tutor/me/easel')
  expect(posts[0].body).toEqual({ image: PNG })
  expect(calls.some((c) => c.url.includes('/room'))).toBe(false)
  expect(screen.getByTestId('kid-easel-say').textContent).toMatch(/grown-up/)
  expect(await screen.findByTestId('kid-easel-share-asked')).toBeTruthy()
  expect(screen.getByText('Waiting for a grown-up')).toBeTruthy()
  expect(container.querySelectorAll('input, textarea, a[href]').length).toBe(0)
})

test('a refusal shows the server line and keeps the drawing', async () => {
  fakeServer({ status: 429, body: { detail: { code: 'waiting', say: 'Your grown-up has some drawings to look at first!' } } })
  render(<KidEasel apiBase="/api/tutor" />)
  draw(screen.getByTestId('kid-easel-canvas'))
  await act(async () => { fireEvent.click(screen.getByLabelText('Show my family')) })
  expect(screen.getByTestId('kid-easel-say').textContent).toBe('Your grown-up has some drawings to look at first!')
  expect(screen.queryByTestId('kid-easel-share-asked')).toBeNull()
})

test('keep it saves on this device only', async () => {
  const calls = fakeServer({ status: 201, body: {} })
  render(<KidEasel apiBase="/api/tutor" storageKey="t_gallery" />)
  draw(screen.getByTestId('kid-easel-canvas'))
  fireEvent.click(screen.getByLabelText('Keep it'))
  expect(JSON.parse(localStorage.getItem('t_gallery') || '[]')).toEqual([PNG])
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
})
