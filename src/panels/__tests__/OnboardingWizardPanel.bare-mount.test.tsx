/**
 * The Onboarding Wizard opened from a desktop launcher (Veil's PanelApp) is
 * mounted BARE: no `user`, no `onComplete`. Measured 2026-10-29 on
 * a tenant host: clicking its rocket made the window "This app hit an
 * error -- Cannot read properties of undefined (reading 'display_name')".
 * It must render, say when the workspace is already set up, and its exits
 * must land on the done card instead of calling an undefined function.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import OnboardingWizardPanel from '../OnboardingWizardPanel'

function mockFetch(docs: number, staff: number) {
  ;(global as any).fetch = jest.fn(async (url: string) => {
    const u = String(url)
    if (u.endsWith('/documents')) return { ok: true, status: 200, json: async () => ({ total: docs }) }
    if (u.endsWith('/people/stats')) return { ok: true, status: 200, json: async () => ({ company_staff: staff }) }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}

describe('OnboardingWizardPanel mounted bare (desktop window)', () => {
  it('renders without a user instead of throwing', async () => {
    mockFetch(0, 0)
    render(<OnboardingWizardPanel />)
    expect(await screen.findByText('Welcome')).toBeTruthy()
  })

  it('says the workspace is already set up instead of calling a missing onComplete', async () => {
    mockFetch(12, 3)
    render(<OnboardingWizardPanel />)
    const note = await screen.findByTestId('onboarding-already-set-up')
    expect(note.textContent).toContain('12 documents')
    expect(note.textContent).toContain('3 staff')
  })

  it('Skip lands on the done card, with no dead Start Chatting button', async () => {
    mockFetch(0, 0)
    render(<OnboardingWizardPanel />)
    fireEvent.click(await screen.findByText('Skip for now'))
    expect(await screen.findByText('You can close this window.')).toBeTruthy()
    expect(screen.queryByText('Start Chatting')).toBeNull()
  })

  it('still hands control back when a host passes onComplete', async () => {
    mockFetch(5, 0)
    const onComplete = jest.fn()
    render(<OnboardingWizardPanel user={{ display_name: 'Jason' }} onComplete={onComplete} />)
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
  })

  it('greets a named user', async () => {
    mockFetch(0, 0)
    render(<OnboardingWizardPanel user={{ display_name: 'Jason' }} onComplete={() => {}} />)
    expect(await screen.findByText('Welcome, Jason')).toBeTruthy()
  })
})
