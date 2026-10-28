/**
 * Both tab counts are real on first paint. Live on a tenant desktop 2026-10-27 the
 * Database window read "Staff (0) Projects (0)" and only showed "Projects (33)" after
 * the tab was clicked: the panel fetched the selected tab's list and nothing else.
 * Runs under AitherVeil's jest (roots include awkit/src).
 */
import React from 'react'
import { act, render, screen } from '@testing-library/react'
import DatabasePanel from '../panels/DatabasePanel'

const PROJECTS = Array.from({ length: 33 }, (_, i) => ({
  id: `p${i}`, name: `Project ${i}`, client: null, location: null, value: null,
  year_completed: null, services: [], key_staff: [],
}))
const STAFF = [{
  id: 's1', name: 'Ada', location: null, school: null, degree: null,
  years_experience: null, certifications: [], specialties: [],
}]

describe('DatabasePanel counts', () => {
  it('loads both counts on mount, before any tab is clicked', async () => {
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
      const body = String(url).includes('/projects') ? PROJECTS : STAFF
      return { ok: true, status: 200, json: async () => body } as unknown as Response
    })
    await act(async () => { render(<DatabasePanel />) })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(screen.getByText('Staff (1)')).toBeTruthy()
    expect(screen.getByText('Projects (33)')).toBeTruthy()
  })
})
