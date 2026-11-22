/**
 * People -> a staff member -> Edit -> Save must save, and say so only when it did.
 *
 * Measured 2026-10-17 in a live customer appliance bundle: Save closed the form and toasted
 * "Staff updated (save pending backend PUT)" without sending anything. Add and
 * Remove likewise toasted success whatever the server answered.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import PeoplePanel from '../PeoplePanel'

type Call = { method: string; url: string; body?: any }

function mockFetch(writeStatus: number, writeBody: unknown = {}) {
  const calls: Call[] = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    calls.push({ method, url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (method !== 'GET') {
      return { ok: writeStatus < 300, status: writeStatus, json: async () => writeBody }
    }
    return {
      ok: true, status: 200,
      json: async () => ({
        workspace_users: [],
        company_staff: [{
          id: 's1', name: 'Ann Lee', title: 'PE', location: 'Austin',
          certifications: ['PE'], specialties: [], firms: [], years_experience: 10,
          source_doc_id: null,
        }],
        counts: { workspace_users: 0, company_staff: 1 },
      }),
    }
  })
  return calls
}

async function editLocationAndSave(value: string) {
  render(<PeoplePanel />)
  fireEvent.click(await screen.findByText('Ann Lee'))
  fireEvent.click(screen.getByText('Edit'))
  fireEvent.change(screen.getByDisplayValue('Austin'), { target: { value } })
  fireEvent.click(screen.getByText('Save'))
}

describe('PeoplePanel staff edit', () => {
  it('sends the edit to PUT /api/people/staff/<id> and confirms only after it lands', async () => {
    const calls = mockFetch(200, { status: 'updated', staff: { id: 's1' } })
    await editLocationAndSave('Dallas')
    await waitFor(() => expect(calls.some(c => c.method === 'PUT')).toBe(true))
    const put = calls.find(c => c.method === 'PUT')!
    expect(put.url).toBe('/api/people/staff/s1')
    expect(put.body.location).toBe('Dallas')
    expect(put.body.name).toBe('Ann Lee')
    expect(await screen.findByText('Saved')).toBeTruthy()
    expect(screen.queryByText(/pending backend/i)).toBeNull()
  })

  it('keeps the form open and says why when the server refuses', async () => {
    mockFetch(403, { detail: 'This needs a workspace administrator.' })
    await editLocationAndSave('Dallas')
    expect(await screen.findByText(/This needs a workspace administrator/)).toBeTruthy()
    expect(screen.queryByText('Saved')).toBeNull()
    expect(screen.getByDisplayValue('Dallas')).toBeTruthy()
  })

  it('does not report a removal that the server refused', async () => {
    mockFetch(403, { detail: 'This needs a workspace administrator.' })
    ;(global as any).confirm = () => true
    render(<PeoplePanel />)
    fireEvent.click(await screen.findByText('Ann Lee'))
    fireEvent.click(screen.getByText('Remove'))
    expect(await screen.findByText(/This needs a workspace administrator/)).toBeTruthy()
    expect(screen.queryByText('Staff member removed')).toBeNull()
  })
})

/**
 * (tenant ask), 2026-11-17: "the 'workspace user' can be included right into
 * here and not be separate tabs ... there is an additional one invite/add that can
 * be removed." The Staff tab is ONE roster; the invite/add tab is gone.
 */
describe('PeoplePanel roster', () => {
  function mockRoster() {
    ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method || 'GET') !== 'GET') {
        return { ok: true, status: 200, json: async () => ({}) }
      }
      return {
        ok: true, status: 200,
        json: async () => ({
          workspace_users: [{
            id: 'u1', username: 'jason', email: 'jason@example.test',
            role: 'workspace_admin', display_name: 'Jason Morse', last_active: '2026-11-17T10:00:00Z',
          }],
          company_staff: [{
            id: 's1', name: 'Ann Lee', title: 'PE', location: 'Austin',
            certifications: ['PE'], specialties: [], firms: [], years_experience: 10,
            source_doc_id: null,
          }],
          counts: { workspace_users: 1, company_staff: 1 },
          workspace_users_error: null,
        }),
      }
    })
  }

  it('lists workspace users in the same roster and offers no invite/add tab', async () => {
    mockRoster()
    render(<PeoplePanel />)
    expect(await screen.findByText('Ann Lee')).toBeTruthy()
    expect(await screen.findByText('Jason Morse')).toBeTruthy()
    expect(screen.getByText('Workspace users (1)')).toBeTruthy()
    expect(screen.queryByText('Invite / Add')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull()
    expect(screen.queryByLabelText('Email to invite')).toBeNull()
  })

  it('opens a workspace user as a profile, not an action list', async () => {
    mockRoster()
    render(<PeoplePanel />)
    fireEvent.click(await screen.findByText('Jason Morse'))
    expect(screen.getAllByText('jason@example.test').length).toBeGreaterThan(1)
    expect(screen.getAllByText('workspace_admin').length).toBeGreaterThan(0)
  })
})

