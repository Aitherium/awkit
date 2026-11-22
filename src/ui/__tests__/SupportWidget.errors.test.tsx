/**
 * "My Tickets" on a host with no support route used to say `Couldn't load your tickets
 * (HTTP 404).` (owner screenshots 2026-11-16). It is one plain sentence now, never a code.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SupportWidget from '../SupportWidget'

let realFetch: typeof window.fetch
beforeAll(() => { realFetch = window.fetch })
afterEach(() => { window.fetch = realFetch })

function answer(fn: () => Promise<unknown>) {
  window.fetch = (() => fn()) as unknown as typeof window.fetch
}

async function openTickets() {
  const { container } = render(<SupportWidget apiBase="" appName="Test" />)
  // The closed widget is a single floating button.
  fireEvent.click(container.querySelector('button') as HTMLElement)
  fireEvent.click(await screen.findByText('View My Tickets'))
}

describe('SupportWidget tickets failures', () => {
  it('a 404 with a non-JSON body is one plain sentence with no status code', async () => {
    answer(async () => ({ ok: false, status: 404, json: async () => { throw new SyntaxError('Unexpected token < in JSON') } }))
    await openTickets()
    await waitFor(() => expect(screen.getByText(/Could not load your tickets|not available right now/)).toBeTruthy())
    const text = document.body.textContent || ''
    expect(text).not.toMatch(/HTTP|\b404\b|Couldn't load your tickets \(/)
    expect(text).toContain('This is not available right now. If you expected it here, tell Support.')
  })

  it('a dropped connection says so in words, not "Failed to fetch"', async () => {
    answer(async () => { throw new TypeError('Failed to fetch') })
    await openTickets()
    await waitFor(() => expect(screen.getByText(/Check your connection/)).toBeTruthy())
    expect(document.body.textContent).not.toMatch(/Failed to fetch|TypeError/)
  })
})
