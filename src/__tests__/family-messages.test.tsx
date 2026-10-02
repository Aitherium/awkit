/**
 * Aither Learn family notes (gap g8): the child's KidInboxCard and the guardian's
 * FamilyMessagesSection, in jsdom against a scripted fetch.
 *
 * Pins: the kid card sends only the offered reactions/phrases (no lid, no channel),
 * shows free typing only when the server offers it, marks the note read, never uses
 * shaming/timer copy; the guardian section posts text (+ optional skill id) to the
 * learner's own route and labels held messages.
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import KidInboxCard from '../panels/KidInboxCard'
import FamilyMessagesSection from '../panels/FamilyMessagesSection'
import KidQuestPanel from '../panels/KidQuestPanel'

type Reply = { status: number; body: unknown }
type Route = (url: string, init?: RequestInit) => Reply | undefined

function installFetch(route: Route) {
  const calls: { url: string; init?: RequestInit }[] = []
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const r = route(url, init) ?? { status: 404, body: { detail: 'nope' } }
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body } as unknown as Response
  })
  return calls
}

const body = (init?: RequestInit) => (init?.body ? JSON.parse(String(init.body)) : {})

const OPTS_YOUNG = { reactions: ['❤️', '👍'], phrases: ['I love you!', 'OK!'], free_text_max: 0 }
const NOTE = {
  msg_id: 'fm_0123456789abcdef', from: 'grown_up', kind: 'practice', text: 'Proud of you!', read: false,
  practice: { skill_id: 'math.add_within_20', title: 'Adding to 20' }, sender_user_id: 'SHOULD-NOT-SHOW',
}

describe('KidInboxCard', () => {
  it('shows the note, marks it read, and sends a reaction with no lid or channel', async () => {
    const calls = installFetch((url, init) => {
      if (url.startsWith('/api/tutor/me/messages?')) return { status: 200, body: { messages: [NOTE], unread: 1, reply_options: OPTS_YOUNG } }
      if (url.endsWith('/read')) return { status: 200, body: { ok: true } }
      if (url === '/api/tutor/me/messages' && init?.method === 'POST') return { status: 201, body: { sent: true } }
      return undefined
    })
    const { container } = render(<KidInboxCard apiBase="/api/tutor" />)
    await screen.findByTestId('kid-inbox-card')
    expect(screen.getByText('Proud of you!')).toBeTruthy()
    expect(screen.getByTestId('practice-card').textContent).toContain('Adding to 20')
    expect(container.textContent).not.toContain('SHOULD-NOT-SHOW')
    expect(screen.queryByLabelText('write a note back')).toBeNull()
    await waitFor(() => expect(calls.some((c) => c.url.endsWith(`/me/messages/${NOTE.msg_id}/read`))).toBe(true))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'send ❤️' })) })
    const post = calls.find((c) => c.url === '/api/tutor/me/messages' && c.init?.method === 'POST')
    expect(body(post?.init)).toEqual({ reply_to: NOTE.msg_id, reaction: '❤️' })
    expect(Object.keys(body(post?.init))).not.toContain('lid')
    expect((await screen.findByTestId('inbox-said')).textContent).toContain('Sent')
    expect(container.textContent || '').not.toMatch(/\bwrong\b|incorrect|timer|streak|hurry/i)
  })

  it('offers free typing only when the server allows it, and a held note is a gentle nudge', async () => {
    installFetch((url, init) => {
      if (url.startsWith('/api/tutor/me/messages?')) return { status: 200, body: { messages: [{ ...NOTE, read: true }], reply_options: { ...OPTS_YOUNG, free_text_max: 140 } } }
      if (url === '/api/tutor/me/messages' && init?.method === 'POST') return { status: 201, body: { sent: false, say: 'Let’s send a picture instead!' } }
      return undefined
    })
    render(<KidInboxCard apiBase="/api/tutor" />)
    const input = (await screen.findByLabelText('write a note back')) as HTMLInputElement
    expect(input.maxLength).toBe(140)
    fireEvent.change(input, { target: { value: 'hello there' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })) })
    expect((await screen.findByTestId('inbox-said')).textContent).toContain('picture')
  })

  it('renders nothing when there is no note', async () => {
    const calls = installFetch(() => ({ status: 200, body: { messages: [], reply_options: OPTS_YOUNG } }))
    const { container } = render(<KidInboxCard apiBase="/api/tutor" />)
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(container.innerHTML).toBe('')
  })
})

describe('FamilyMessagesSection', () => {
  it('lists the thread (held labelled) and posts to the learner route', async () => {
    const calls = installFetch((url, init) => {
      if (url.startsWith('/api/tutor/family/learners/lrn_1/messages?')) {
        return { status: 200, body: { messages: [
          { msg_id: 'fm_a', direction: 'to_kid', kind: 'note', text: 'Hi love', read: true },
          { msg_id: 'fm_b', direction: 'from_kid', kind: 'text', text: 'psst', held: true },
        ] } }
      }
      if (url === '/api/tutor/family/learners/lrn_1/messages' && init?.method === 'POST') return { status: 201, body: { message: {} } }
      return undefined
    })
    render(<FamilyMessagesSection apiBase="/api/tutor" lid="lrn_1" name="Athena" />)
    await screen.findByText('Hi love')
    expect(screen.getByText(/Held by the safety check/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'Practice time!' } })
    fireEvent.change(screen.getByLabelText(/Practice this/), { target: { value: 'math.add_within_20' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send note' })) })
    const post = calls.find((c) => c.init?.method === 'POST')
    expect(body(post?.init)).toEqual({ text: 'Practice time!', skill_id: 'math.add_within_20' })
  })
})

describe('KidQuestPanel homeExtra', () => {
  it('shows the inbox slot on the home screen only', async () => {
    installFetch((url) => (url === '/api/tutor/me' ? { status: 200, body: { alias: 'Athena', choices: { themes: ['space', 'ocean'] } } } : undefined))
    render(<KidQuestPanel apiBase="/api/tutor" homeExtra={<div data-testid="home-extra">note</div>} />)
    await screen.findByTestId('home-screen')
    expect(screen.getByTestId('home-extra')).toBeTruthy()
  })
})
