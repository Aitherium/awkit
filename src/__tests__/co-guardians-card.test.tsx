/**
 * CoGuardiansCard (Aither Learn): the guardian of record shares a child with another
 * adult on the same workspace roster, and stops sharing. A co-guardian sees nothing here.
 */
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import CoGuardiansCard from '../panels/CoGuardiansCard'
import LearnerGuardCard from '../panels/LearnerGuardCard'

type Reply = { status: number; ok: boolean; data: unknown }
const reply = (status: number, data: unknown): Reply => ({ status, ok: status >= 200 && status < 300, data })

function makeCall(route: (path: string, method: string, body?: object) => Reply) {
  const calls: { path: string; method: string; body?: object }[] = []
  const call = jest.fn(async (path: string, method = 'GET', body?: object) => {
    calls.push({ path, method, body })
    return route(path, method, body)
  })
  return { call, calls }
}

const P = '/family/learners/l-x/co-guardians'

describe('CoGuardiansCard', () => {
  it('shares with a roster member picked by name, then stops sharing', async () => {
    let shared: { user_id: string; display_name: string }[] = []
    const { call, calls } = makeCall((path, method, body) => {
      if (path === P && method === 'GET') {
        return reply(200, { can_manage: true, co_guardians: shared, candidates: [{ user_id: 'u-sam', display_name: 'Sam' }] })
      }
      if (path === P && method === 'POST') {
        shared = [{ user_id: (body as { member_user_id: string }).member_user_id, display_name: 'Sam' }]
        return reply(201, { lid: 'l-x', co_guardians: shared })
      }
      if (path === `${P}/remove` && method === 'POST') { shared = []; return reply(200, { lid: 'l-x', co_guardians: [] }) }
      return reply(404, {})
    })
    const notes: string[] = []
    render(<CoGuardiansCard call={call} lid="l-x" alias="Mia" onNote={(m) => notes.push(m)} />)
    expect(await screen.findByTestId('co-guardians-empty')).toHaveTextContent('just you')
    const add = screen.getByTestId('co-guardian-add')
    expect(add).toBeDisabled()
    fireEvent.change(screen.getByTestId('co-guardian-input'), { target: { value: 'sam' } })
    await act(async () => { fireEvent.click(add) })
    // The typed display name resolves to the roster user id; nothing else is sent.
    expect(calls.find((c) => c.path === P && c.method === 'POST')?.body).toEqual({ member_user_id: 'u-sam' })
    expect(screen.getByTestId('co-guardians-list')).toHaveTextContent('Sam')
    expect(notes.pop()).toBe('Sam can now see and help with Mia.')

    await act(async () => { fireEvent.click(screen.getByTestId('co-guardian-remove-u-sam')) })
    expect(calls.find((c) => c.path === `${P}/remove`)?.body).toEqual({ member_user_id: 'u-sam' })
    expect(screen.getByTestId('co-guardians-empty')).toBeInTheDocument()
    expect(notes.pop()).toBe('Sam no longer sees Mia.')
  })

  it('explains a refusal for someone outside the workspace', async () => {
    const { call } = makeCall((path, method) => {
      if (method === 'GET') return reply(200, { can_manage: true, co_guardians: [], candidates: [] })
      return reply(422, { detail: 'not_a_roster_member' })
    })
    const notes: string[] = []
    render(<CoGuardiansCard call={call} lid="l-x" alias="Mia" onNote={(m) => notes.push(m)} />)
    fireEvent.change(await screen.findByTestId('co-guardian-input'), { target: { value: 'stranger' } })
    await act(async () => { fireEvent.click(screen.getByTestId('co-guardian-add')) })
    expect(notes.pop()).toBe('Only people already in your workspace can be added.')
  })

  it('renders nothing for a co-guardian (no can_manage)', async () => {
    const { call } = makeCall(() => reply(200, { can_manage: false, co_guardians: [{ user_id: 'u-sam' }] }))
    const { container } = render(<CoGuardiansCard call={call} lid="l-x" />)
    await act(async () => { await Promise.resolve() })
    expect(call).toHaveBeenCalledWith(P)
    expect(container).toBeEmptyDOMElement()
  })

  it('LearnerGuardCard hides Remove for a co-guardian', async () => {
    const { call } = makeCall(() => reply(200, { chat_disabled: false, pin_set: true }))
    render(<LearnerGuardCard call={call} lid="l-x" alias="Mia" canRemove={false} />)
    expect(await screen.findByTestId('sprite-chat-state')).toBeInTheDocument()
    expect(screen.queryByTestId('remove-learner')).toBeNull()
  })
})
