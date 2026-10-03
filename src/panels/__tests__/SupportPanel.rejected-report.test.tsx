/**
 * A rejected bug report must not read as a sent one.
 *
 * `fetch` resolves on a 4xx, and the panel showed "Bug report submitted!" without
 * reading the status. On a hosted tenant app the route answered 422 for months and every report
 * was dropped behind a success message (measured 2026-10-02).
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import SupportPanel from '../SupportPanel'

function mockFetch(feedbackStatus: number) {
  const calls: string[] = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method || 'GET'} ${url}`)
    if (init?.method === 'POST' && String(url).endsWith('/api/feedback')) {
      return { ok: feedbackStatus < 300, status: feedbackStatus, json: async () => ({}) }
    }
    return { ok: true, status: 200, json: async () => ({ tickets: [] }) }
  })
  return calls
}

async function submitBug() {
  render(<SupportPanel showChat={false} />)
  fireEvent.click(screen.getByText('Bug Report'))
  fireEvent.change(screen.getByPlaceholderText('Brief summary of the issue'), { target: { value: 'it broke' } })
  fireEvent.change(screen.getByPlaceholderText('What happened? What did you expect to happen?'), {
    target: { value: 'details' },
  })
  // The button reads 'Submitting...' while the ticket list is still loading.
  fireEvent.click(await screen.findByText('Submit Bug Report'))
}

describe('SupportPanel bug report', () => {
  it('says it failed when the server rejects the report', async () => {
    const calls = mockFetch(422)
    await submitBug()
    await waitFor(() => expect(screen.getByText('Failed to submit. Please try again.')).toBeTruthy())
    expect(screen.queryByText(/Bug report submitted/)).toBeNull()
    expect(calls).toContain('POST /api/feedback')
  })

  it('says it was submitted when the server accepts it', async () => {
    mockFetch(200)
    await submitBug()
    await waitFor(() => expect(screen.getByText(/Bug report submitted/)).toBeTruthy())
  })
})
