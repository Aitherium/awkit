/**
 * Notes failures read as one plain sentence: no status code, no parser wording, no doubled
 * full stop from a wrapper sentence around a sentence, and no "room" wording.
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import NotesSurface from '../NotesSurface'

let realFetch: typeof window.fetch
beforeAll(() => { realFetch = window.fetch })
afterEach(() => { window.fetch = realFetch })

function answer(res: unknown) {
  window.fetch = (() => Promise.resolve(res)) as unknown as typeof window.fetch
}

describe('NotesSurface failures', () => {
  it('a 404 is one sentence with no wrapper, no "..", no HTTP', async () => {
    answer({ ok: false, status: 404, json: async () => { throw new SyntaxError('Unexpected token < in JSON') } })
    render(<NotesSurface onClose={() => {}} onCite={() => {}} />)
    await waitFor(() => expect(screen.getByText(/not available right now/)).toBeTruthy())
    const t = screen.getByText(/not available right now/).textContent || ''
    expect(t.trim()).toBe('This is not available right now. If you expected it here, tell Support.')
    expect(t).not.toMatch(/\.\.|HTTP|room is still live|Could not reach/i)
  })

  it('an unreadable answer is said as such, not as parser wording', async () => {
    answer({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0') } })
    render(<NotesSurface onClose={() => {}} onCite={() => {}} />)
    await waitFor(() => expect(screen.getByText(/something unexpected/)).toBeTruthy())
    expect(screen.getByText(/something unexpected/).textContent).not.toMatch(/token|JSON|position/i)
  })

  it('a raw server error string is replaced by a plain sentence', async () => {
    answer({ ok: true, status: 200, json: async () => ({ error: 'Internal Server Error' }) })
    render(<NotesSurface onClose={() => {}} onCite={() => {}} />)
    await waitFor(() => expect(screen.getByText(/Could not load your notes/)).toBeTruthy())
  })
})
