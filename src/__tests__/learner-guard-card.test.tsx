/**
 * LearnerGuardCard (Aither Learn): the guardian locks the child's sprite chat behind
 * their own PIN and can remove the child from Learn after a typed confirmation.
 */
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
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

const P = '/family/learners/l-x'

describe('LearnerGuardCard', () => {
  it('sets a PIN and turns chat off, then reports a wrong PIN', async () => {
    let state = { chat_disabled: false, pin_set: false }
    const { call, calls } = makeCall((path, method, body) => {
      if (path === `${P}/sprite/parental` && method === 'GET') return reply(200, state)
      if (path === `${P}/sprite/parental` && method === 'PUT') {
        const b = body as { chat_disabled: boolean; pin: string }
        if (state.pin_set && b.pin !== '1234') return reply(403, { detail: 'no' })
        state = { chat_disabled: b.chat_disabled, pin_set: true }
        return reply(200, state)
      }
      return reply(404, {})
    })
    const notes: string[] = []
    render(<LearnerGuardCard call={call} lid="l-x" alias="Mia" onNote={(m) => notes.push(m)} />)
    expect(await screen.findByTestId('sprite-chat-state')).toHaveTextContent('Chat is on for Mia')
    const toggle = screen.getByTestId('sprite-chat-toggle')
    expect(toggle).toBeDisabled()
    fireEvent.change(screen.getByTestId('sprite-pin'), { target: { value: '1234' } })
    await act(async () => { fireEvent.click(toggle) })
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ chat_disabled: true, pin: '1234' })
    expect(screen.getByTestId('sprite-chat-state')).toHaveTextContent('Chat is off for Mia')
    expect(notes.pop()).toBe('Sprite chat is off for Mia.')

    fireEvent.change(screen.getByTestId('sprite-pin'), { target: { value: '9999' } })
    await act(async () => { fireEvent.click(screen.getByTestId('sprite-chat-toggle')) })
    expect(notes.pop()).toBe('That PIN is not right.')
    expect(screen.getByTestId('sprite-chat-state')).toHaveTextContent('Chat is off for Mia')
  })

  it('removes only after typing remove', async () => {
    const { call, calls } = makeCall((path, method) => {
      if (path === `${P}/sprite/parental`) return reply(200, { chat_disabled: false, pin_set: false })
      if (path === `${P}/remove` && method === 'POST') return reply(200, { lid: 'l-x', removed: true })
      return reply(404, {})
    })
    const onRemoved = jest.fn()
    render(<LearnerGuardCard call={call} lid="l-x" alias="Mia" onRemoved={onRemoved} />)
    const btn = await screen.findByTestId('remove-learner-btn')
    expect(btn).toBeDisabled()
    fireEvent.change(screen.getByTestId('remove-confirm'), { target: { value: 'Remove' } })
    await act(async () => { fireEvent.click(btn) })
    expect(calls.some((c) => c.path === `${P}/remove` && c.method === 'POST')).toBe(true)
    expect(onRemoved).toHaveBeenCalled()
  })

  it('says unavailable when the sprite store is down', async () => {
    const { call } = makeCall(() => reply(503, {}))
    render(<LearnerGuardCard call={call} lid="l-x" />)
    expect(await screen.findByText('Sprite settings are unavailable right now.')).toBeInTheDocument()
  })
})
