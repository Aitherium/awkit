/**
 * Agent -> person assignment in the Agents panel. Before this, a hosted tenant's Agents panel
 * listed fleet agents with nothing saying whose an agent was and no way to say it.
 * An admin must see the owner on every card, assign from the workspace's people and
 * unassign; a member must see owners but get no assign control.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import AgentsPanel, { detailMessage, mergePeople } from '../AgentsPanel'

type Call = { url: string; method: string; body?: any }

function mockFetch(opts: { canManage: boolean; assigned?: boolean; putError?: any }) {
  const calls: Call[] = []
  let assigned = opts.assigned ?? false
  const json = (d: any, status = 200) =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(d) })
  ;(global as any).fetch = jest.fn((url: string, init: any = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined })
    if (url === '/api/platform/fleet') {
      return json({ agents: [{ agent_id: 'atlas', name: 'Atlas', status: 'active' }] })
    }
    if (url === '/api/agents/assignments') {
      return json({
        can_manage: opts.canManage,
        assignments: assigned
          ? [{ agent_id: 'atlas', assignee_id: 'dir-1', assignee_name: 'Dana Acme', assignee_email: 'dana@acme.test' }]
          : [],
      })
    }
    if (url === '/api/directory/members') {
      return json({ members: [{ id: 'dir-1', title: 'Dana Acme', data: { name: 'Dana Acme', email: 'dana@acme.test' } }] })
    }
    if (url === '/api/workspace/members') {
      return json({ members: [{ user_id: 'u_lee', display_name: 'Lee', email: 'lee@acme.test' }] })
    }
    if (url === '/api/agents/assignments/atlas' && method === 'PUT') {
      if (opts.putError) return json({ detail: opts.putError }, 422)
      assigned = true; return json({ assignment: {} })
    }
    if (url === '/api/agents/assignments/atlas' && method === 'DELETE') { assigned = false; return json({ deleted: true }) }
    return json({}, 404)
  })
  return calls
}

describe('AgentsPanel assignments', () => {
  it('shows who owns each agent', async () => {
    mockFetch({ canManage: false, assigned: true })
    render(<AgentsPanel />)
    expect(await screen.findByTestId('assigned-to-atlas')).toHaveTextContent('Assigned to: Dana Acme')
  })

  it('an admin assigns an agent to a person, then unassigns it', async () => {
    const calls = mockFetch({ canManage: true })
    render(<AgentsPanel />)
    expect(await screen.findByTestId('assigned-to-atlas')).toHaveTextContent('Unassigned')
    fireEvent.click(screen.getByText('Atlas'))

    const select = await screen.findByLabelText('Assign to person')
    await waitFor(() => expect(select.querySelectorAll('option').length).toBe(3))
    fireEvent.change(select, { target: { value: 'dir-1' } })
    fireEvent.click(screen.getByText('Assign'))

    await waitFor(() =>
      expect(screen.getByTestId('assigned-to-atlas')).toHaveTextContent('Assigned to: Dana Acme'))
    const put = calls.find(c => c.method === 'PUT')!
    expect(put.url).toBe('/api/agents/assignments/atlas')
    expect(put.body).toEqual({ assignee_id: 'dir-1', agent_name: 'Atlas' })

    fireEvent.click(screen.getByText('Unassign'))
    await waitFor(() => expect(screen.getByTestId('assigned-to-atlas')).toHaveTextContent('Unassigned'))
    expect(calls.some(c => c.method === 'DELETE' && c.url === '/api/agents/assignments/atlas')).toBe(true)
  })

  it('a member gets no assign control', async () => {
    const calls = mockFetch({ canManage: false, assigned: true })
    render(<AgentsPanel />)
    await screen.findByTestId('assigned-to-atlas')
    fireEvent.click(screen.getByText('Atlas'))
    expect(screen.queryByLabelText('Assign to person')).toBeNull()
    expect(screen.queryByText('Unassign')).toBeNull()
    // Nor does it pull the people list it cannot use.
    expect(calls.some(c => c.url === '/api/directory/members')).toBe(false)
  })

  it('shows the messages of a 422 detail array, not [object Object]', async () => {
    mockFetch({ canManage: true, putError: [
      { loc: ['body', 'assignee_id'], msg: 'Field required', type: 'missing' },
      { loc: ['body', 'agent_name'], msg: 'Input should be a valid string' },
    ] })
    render(<AgentsPanel />)
    await screen.findByTestId('assigned-to-atlas')
    fireEvent.click(screen.getByText('Atlas'))
    const select = await screen.findByLabelText('Assign to person')
    await waitFor(() => expect(select.querySelectorAll('option').length).toBe(3))
    fireEvent.change(select, { target: { value: 'dir-1' } })
    fireEvent.click(screen.getByText('Assign'))
    expect(await screen.findByText('Failed: Field required; Input should be a valid string')).toBeInTheDocument()
    expect(screen.queryByText(/object Object/)).toBeNull()
  })

  it('detailMessage reads a string, an object, an array and an empty body', () => {
    expect(detailMessage('assignee is not a member of this workspace', 422))
      .toBe('assignee is not a member of this workspace')
    expect(detailMessage({ message: 'nope' }, 400)).toBe('nope')
    expect(detailMessage([{ msg: 'a' }, 'b'], 422)).toBe('a; b')
    expect(detailMessage(undefined, 500)).toBe('500')
  })

  it('merges directory employees and workspace users, de-duplicated by email', () => {
    const people = mergePeople(
      { members: [{ id: 'dir-1', data: { name: 'Dana', email: 'Dana@acme.test' } }] },
      { members: [{ user_id: 'u_dana', display_name: 'Dana', email: 'dana@acme.test' },
                  { user_id: 'u_lee', display_name: 'Lee', email: 'lee@acme.test' }] },
    )
    expect(people.map(p => p.id)).toEqual(['dir-1', 'u_lee'])
  })
})
