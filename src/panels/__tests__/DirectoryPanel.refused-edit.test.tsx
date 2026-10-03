/**
 * A refused Directory edit must not read as a saved one.
 *
 * The role, status and group writes ignored the answer: on a tenant site the
 * routes did not exist (405), and the select simply showed the new role. The
 * shared router also answers stored entities ({id, data: {...}}), which the
 * panel read as flat rows, so the PUT went to /members/undefined/role
 * (both measured on a hosted tenant app, 2026-10-02).
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import DirectoryPanel from '../DirectoryPanel'

const ENTITY_ID = 'b7c1e1aa-0000-4000-8000-000000000001'

function mockFetch(putStatus: number, putBody: unknown = {}) {
  const calls: string[] = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    calls.push(`${method} ${url}`)
    if (method === 'PUT') {
      return { ok: putStatus < 300, status: putStatus, json: async () => putBody }
    }
    if (String(url).endsWith('/members')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          members: [{
            id: ENTITY_ID, entity_type: 'directory_members', status: 'active',
            title: 'Ann Lee',
            data: { name: 'Ann Lee', email: 'ann@example.com', role: 'member', status: 'active' },
          }],
        }),
      }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
  return calls
}

async function changeRoleToViewer() {
  render(<DirectoryPanel />)
  fireEvent.click(await screen.findByText('Ann Lee'))
  fireEvent.change(screen.getByDisplayValue('Member'), { target: { value: 'viewer' } })
}

describe('DirectoryPanel role change', () => {
  it('says why when the server refuses the change, and keeps the old role', async () => {
    const calls = mockFetch(403, { detail: "role 'member' cannot admin" })
    await changeRoleToViewer()
    const alert = await screen.findByTestId('directory-action-error')
    expect(alert.textContent).toMatch(/Changing the role failed: only a workspace admin can do this/)
    expect(calls).toContain(`PUT /api/directory/members/${ENTITY_ID}/role`)
    expect((screen.getByDisplayValue('Member') as HTMLSelectElement).value).toBe('member')
  })

  it('names a missing route instead of pretending it saved', async () => {
    mockFetch(405, { detail: 'Method Not Allowed' })
    await changeRoleToViewer()
    const alert = await screen.findByTestId('directory-action-error')
    expect(alert.textContent).toMatch(/Method Not Allowed/)
  })

  it('addresses the stored row by its id and shows no error on success', async () => {
    const calls = mockFetch(200, { ok: true })
    await changeRoleToViewer()
    await waitFor(() => expect(calls).toContain(`PUT /api/directory/members/${ENTITY_ID}/role`))
    expect(calls.some(c => c.includes('/members/undefined/'))).toBe(false)
    expect(screen.queryByTestId('directory-action-error')).toBeNull()
  })
})
