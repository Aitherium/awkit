/**
 * FamilyTutorConsolePanel terminal card (Aither Learn gap 12): the steps are the
 * verified phone-terminal path (Pixel Linux terminal, pip install awdk, adk login,
 * adk learn play), it makes no untested Termux promise, and approving a code posts
 * to approve-device for the chosen child.
 */
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import FamilyTutorConsolePanel from '../panels/FamilyTutorConsolePanel'

type Reply = { status: number; body: unknown }

function installFetch(route: (url: string, init?: RequestInit) => Reply | undefined) {
  const calls: { url: string; init?: RequestInit }[] = []
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const r = route(url, init) ?? { status: 404, body: { detail: 'Not found' } }
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body } as unknown as Response
  })
  return calls
}

const LEARNERS = [
  { lid: 'l-a', alias: 'A', display_name: 'Ace', grade: 1, age_band: '6-7', claimed: true, user_id: 'u-a', settings: {} },
]

describe('FamilyTutorConsolePanel terminal card', () => {
  it('shows the verified steps and approves a code for the chosen child', async () => {
    const calls = installFetch((url, init) => {
      if (url.endsWith('/family/learners') && (!init?.method || init.method === 'GET')) return { status: 200, body: LEARNERS }
      if (url.includes('/approve-device')) return { status: 200, body: { approved: true } }
      return { status: 200, body: {} }
    })
    render(<FamilyTutorConsolePanel apiBase="/api/tutor" />)
    // Redesign: the terminal lives under the collapsed "Advanced" section.
    fireEvent.click(await screen.findByRole('button', { name: /Advanced/ }))
    const card = await screen.findByTestId('terminal-card')
    fireEvent.click(screen.getByRole('button', { name: /Terminal \(optional\)/ }))

    const text = card.textContent || ''
    expect(text).toContain('~/aw/bin/pip install awdk')
    expect(text).toContain('~/aw/bin/adk login')
    expect(text).toContain('~/aw/bin/adk learn play')
    expect(text).not.toMatch(/Termux also works/)
    expect(text).not.toMatch(/approve it on their signed-in phone/)

    fireEvent.change(screen.getByLabelText('terminal learner'), { target: { value: 'l-a' } })
    fireEvent.change(screen.getByLabelText('code shown on the phone'), { target: { value: 'ABCD-1234' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve' })) })
    const post = calls.find((c) => c.url.includes('/family/learners/l-a/approve-device'))
    expect(post?.init?.method).toBe('POST')
    expect(JSON.parse(String(post?.init?.body))).toEqual({ user_code: 'ABCD-1234' })
  })
})
