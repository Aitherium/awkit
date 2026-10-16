/**
 * KidBookshelf against a fake Hearth shelf (kids' suite S7).
 *
 * Pins: the shelf shows only what the server says was placed; a grade-1 child opens a
 * read-aloud book, the words light up one at a time as it is read, a tapped word is
 * spoken alone, the arrows page through, and reaching the end calls /finish once and shows
 * "The End"; an empty shelf says a grown-up can add books; nothing on screen is a link;
 * an unexpected field (an http image, a link) is never rendered.
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import KidBookshelf, { asOpenBook, pageMs, wordAt } from '../KidBookshelf'

const words = (text: string) => {
  let t = 0
  let at = 0
  return text.split(' ').map((w) => {
    const start = text.indexOf(w, at)
    at = start + w.length
    const out = { w, say: w.replace(/[^\w']/g, '').toLowerCase(), start, end: at, t }
    t += 500
    return out
  })
}
const PAGES = ['Pip is a pup.', 'Pip can run.', 'Good job, Pip!'].map((text) => ({ text, words: words(text) }))
const BOOK = { id: 'pip_the_pup', kind: 'book', title: 'Pip the Pup', art: 'pup', page: 0, pages: PAGES,
  image: 'https://evil.example/x.png', link: 'https://evil.example' }

function fakeServer(shelf: unknown[]) {
  const calls: Array<{ method: string; url: string; body: unknown }> = []
  const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data })
    if (url.endsWith('/me/shelf')) return json({ books: shelf })
    if (url.endsWith('/me/shelf/pip_the_pup')) return json({ book: BOOK })
    if (url.endsWith('/page')) return json({ page: body?.page, pages: 3 })
    if (url.endsWith('/finish')) return json({ finished: true, title: 'Pip the Pup', say: 'You read the whole book! Pip the Pup is done.' })
    return json({}, 404)
  })
  ;(global as unknown as { fetch: unknown }).fetch = fetchMock
  return calls
}

afterEach(() => { jest.useRealTimers() })

test('word timing helpers', () => {
  const w = PAGES[0].words
  expect(wordAt(w, -1)).toBe(-1)
  expect(wordAt(w, 0)).toBe(0)
  expect(wordAt(w, 1100)).toBe(2)
  expect(pageMs(w)).toBeGreaterThan(w[w.length - 1].t)
})

test('an unexpected remote image or link is never kept', () => {
  const b = asOpenBook(BOOK)!
  expect(b.image).toBeUndefined()
  expect(Object.keys(b)).not.toContain('link')
})

test('an empty shelf says a grown-up can add books', async () => {
  fakeServer([])
  render(<KidBookshelf apiBase="/api/tutor" makeVoice={() => Object.assign(jest.fn(), {})} />)
  expect(await screen.findByTestId('kid-bookshelf-empty')).toBeTruthy()
  expect(screen.getByText(/A grown-up can put one here/)).toBeTruthy()
})

test('a grade-1 child opens a read-aloud book, follows the light, and finishes it', async () => {
  jest.useFakeTimers()
  const calls = fakeServer([{ id: 'pip_the_pup', kind: 'book', title: 'Pip the Pup', art: 'pup', pages: 3, page: 0, finished: false }])
  const spoken: string[] = []
  const voice = Object.assign((t: string | undefined) => { if (t) spoken.push(t) }, { prefetch: () => {} })
  const onFinished = jest.fn()
  const { container } = render(<KidBookshelf apiBase="/api/tutor" makeVoice={() => voice} onFinished={onFinished} />)

  const cover = await screen.findByTestId('kid-book-pip_the_pup')
  await act(async () => { fireEvent.click(cover) })
  await screen.findByTestId('kid-book')
  expect(spoken[0]).toBe('Pip is a pup.')

  // the words light up one at a time as the page is read
  const lit = () => Array.from(container.querySelectorAll('.kb-word')).findIndex((n) => n.getAttribute('data-on') === '1')
  act(() => { jest.advanceTimersByTime(120) })
  expect(lit()).toBe(0)
  act(() => { jest.advanceTimersByTime(1000) })
  expect(lit()).toBe(2)

  // tapping a word says just that word
  fireEvent.click(screen.getByText('pup.'))
  expect(spoken[spoken.length - 1]).toBe('pup')

  for (let i = 0; i < 2; i += 1) {
    await act(async () => { fireEvent.click(screen.getByLabelText('Next page')) })
  }
  expect(screen.getByTestId('kid-book-page').textContent).toContain('Good job, Pip!')
  await act(async () => { fireEvent.click(screen.getByLabelText('The end')) })
  expect(await screen.findByTestId('kid-book-end')).toBeTruthy()
  expect(screen.getByText('The End!')).toBeTruthy()
  expect(spoken[spoken.length - 1]).toContain('whole book')

  const finishes = calls.filter((c) => c.url.endsWith('/finish'))
  expect(finishes).toHaveLength(1)
  expect(calls.filter((c) => c.url.endsWith('/page')).map((c) => (c.body as { page: number }).page)).toEqual([1, 2])
  expect(onFinished).toHaveBeenCalledWith('pip_the_pup')
  expect(container.querySelectorAll('a[href]').length).toBe(0)
  expect(container.querySelector('img[src^="http"]')).toBeNull()
})

test('the shelf lists only what the server returned', async () => {
  fakeServer([{ id: 'dino_lunch', title: 'Dino Lunch', art: 'dino', pages: 7, page: 0, finished: true }])
  render(<KidBookshelf apiBase="/api/tutor" makeVoice={() => Object.assign(jest.fn(), {})} />)
  await waitFor(() => expect(screen.getByTestId('kid-book-dino_lunch')).toBeTruthy())
  expect(screen.queryByTestId('kid-book-pip_the_pup')).toBeNull()
  expect(screen.getByLabelText('read')).toBeTruthy()
})
