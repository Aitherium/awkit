/**
 * Comms used to await `r.json()` before checking the status, so a 404 HTML page threw the
 * parser's own wording ("Unexpected token <") and callers printed `Send failed: ${e.message}`.
 * The status is read first and every failure is one plain sentence.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CommsPanel from '../CommsPanel'

let realFetch: typeof window.fetch
beforeAll(() => { realFetch = window.fetch })
afterEach(() => { window.fetch = realFetch })

async function openInviteAndCopy() {
  render(<CommsPanel apiBase="/api/platform" />)
  fireEvent.click(await screen.findByRole('button', { name: 'People' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Invite' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Copy Invite Link' }))
}

describe('CommsPanel failures', () => {
  it('a non-JSON 404 never shows parser wording or a status code', async () => {
    window.fetch = (async () => ({
      ok: false, status: 404,
      json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0') },
    })) as unknown as typeof window.fetch
    await openInviteAndCopy()
    await waitFor(() => expect(screen.getByText(/not available right now/)).toBeTruthy())
    expect(document.body.textContent).not.toMatch(/Unexpected token|JSON|HTTP|\b404\b|position/)
  })

  it('a 200 with an unreadable body is said as such', async () => {
    window.fetch = (async () => ({
      ok: true, status: 200,
      json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0') },
    })) as unknown as typeof window.fetch
    await openInviteAndCopy()
    await waitFor(() => expect(screen.getByText(/something unexpected/)).toBeTruthy())
    expect(document.body.textContent).not.toMatch(/Unexpected token|JSON|position/)
  })

  it('a dropped connection reads as a connection problem', async () => {
    window.fetch = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof window.fetch
    await openInviteAndCopy()
    await waitFor(() => expect(screen.getByText(/Check your connection/)).toBeTruthy())
    expect(document.body.textContent).not.toMatch(/Failed to fetch/)
  })
})
