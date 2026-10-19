/**
 * Family Quest against a fake Hearth (docs/plans/2026-10-17-family-quest.md).
 *
 * Pins: only named fields of a reply are kept (a link, a score, a remote image never
 * reach the screen); a child sees the stories they were invited to and joins one; on
 * their turn the scene's words are tappable and the three choices post {choice: i}; no
 * countdown or score is ever drawn; a guardian sees the Game Master controls.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import FamilyQuestPanel from '../FamilyQuestPanel'
import { asCousins, asQuestView, sayFor, sceneWords, turnLine } from '../familyQuestApi'

const SID = 'fq_0123456789abcdef'
const VIEW = {
  sid: SID, version: 3, state: 'playing', title: 'The Lost Dragon Egg', art: 'dino', me: 'k_a', turn_pid: 'k_a',
  players: [
    { pid: 'g_host', kind: 'guardian', name: 'Dad', sprite: null, joined: true },
    { pid: 'k_a', kind: 'child', name: 'Athena', sprite: { name: 'Pip', snapshot: 'https://evil.example/x.png' }, joined: true },
  ],
  scene: { n: 2, text: 'You find a shiny, warm egg.', choices: ['Pick it up', 'Ask a bunny', 'Look around'] },
  log: [{ n: 2, kind: 'gm', pid: 'gm', text: 'You find a shiny, warm egg.' }],
  pending_roll: null, score: 99, link: 'https://evil.example',
}

describe('familyQuestApi', () => {
  it('keeps only expected fields', () => {
    const v = asQuestView(VIEW)!
    expect(v.sid).toBe(SID)
    expect(JSON.stringify(v)).not.toContain('evil.example')
    expect(JSON.stringify(v)).not.toContain('score')
    expect(v.players[1].sprite?.snapshot).toBeNull()
    expect(asQuestView({ sid: '../etc' })).toBeNull()
  })
  it('splits words for tapping and says whose turn it is without a timer', () => {
    expect(sceneWords('Hello, egg!').map((w) => w.say)).toEqual(['Hello', 'egg'])
    const v = asQuestView(VIEW)!
    expect(turnLine(v)).toBe('Your turn! What do you do?')
    expect(turnLine({ ...v, turnPid: 'g_host' })).toBe("It's Dad's turn.")
    expect(sayFor(409, { detail: { say: 'Wait a moment.' } })).toBe('Wait a moment.')
  })
})

function fakeServer(kid: boolean, extra: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; url: string; body: unknown }> = []
  const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data, headers: { get: () => 'application/json' } })
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.endsWith('/me/adventure')) return kid ? json({ sessions: [{ sid: SID, title: 'The Lost Dragon Egg', state: 'lobby', host: 'Dad', joined: false }] }) : json({ detail: 'Not paired yet' }, 404)
    if (url.endsWith('/family/adventure')) return json({ templates: [{ id: 'dragon_egg', title: 'The Lost Dragon Egg', art: 'dino', blurb: 'Help the egg.' }], kids: [{ lid: 'a', name: 'Athena' }], sessions: [], ...extra })
    if (url.includes('/voice')) return json({}, 503)
    if (method === 'POST' && url.endsWith('/sessions')) return json({ ...VIEW, me: 'g_host', host: true, state: 'lobby', alerts: [] }, 201)
    if (url.includes('?since=')) return new Promise(() => undefined) // a long poll that never answers in the test
    return json(VIEW)
  })
  return calls
}

describe('FamilyQuestPanel', () => {
  it('a child joins an invited story and taps a choice', async () => {
    const calls = fakeServer(true)
    render(<FamilyQuestPanel apiBase="/api/tutor" />)
    fireEvent.click(await screen.findByTestId('fq-invite'))
    await screen.findByTestId('fq-scene')
    expect(screen.getByText('shiny,')).toBeTruthy()
    expect(screen.getByTestId('fq-turn-line').textContent).toBe('Your turn! What do you do?')
    fireEvent.click(screen.getAllByTestId('fq-choice')[1])
    await waitFor(() => expect(calls.some((c) => c.url.endsWith(`/me/adventure/${SID}/turn`) && (c.body as { choice?: number })?.choice === 1)).toBe(true))
    expect(document.querySelectorAll('a').length).toBe(0)
    expect(screen.queryByTestId('fq-gm')).toBeNull()
    expect(document.body.textContent).not.toMatch(/score|streak|seconds left|hurry/i)
  })
  it('a guardian picks a story and gets the Game Master controls', async () => {
    const calls = fakeServer(false)
    render(<FamilyQuestPanel apiBase="/api/tutor" />)
    await screen.findByTestId('fq-template')
    fireEvent.click(screen.getByTestId('fq-create'))
    await screen.findByTestId('fq-gm')
    const made = calls.find((c) => c.method === 'POST' && c.url.endsWith('/family/adventure/sessions'))
    expect((made?.body as { players: string[] }).players).toEqual(['a'])
  })
  it('a host may add cousins a connected family shared, one family per story', async () => {
    const cousins = [{ connection: 'fc_1', family: 'The Brookes', kids: [{ kid: 'kr_b', name: 'Ben', lid: 'lrn_leak' }] }]
    expect(JSON.stringify(asCousins({ cousins }))).not.toContain('lrn_leak')
    const calls = fakeServer(false, { cousins })
    render(<FamilyQuestPanel apiBase="/api/tutor" />)
    const cousin = await screen.findByTestId('fq-cousin')
    expect(cousin.textContent).toContain('Ben')
    expect(cousin.textContent).toContain('The Brookes')
    fireEvent.click(cousin.querySelector('input') as HTMLInputElement)
    fireEvent.click(screen.getByTestId('fq-create'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/sessions'))).toBe(true))
    const body = calls.find((c) => c.method === 'POST' && c.url.endsWith('/sessions'))!.body as Record<string, unknown>
    expect(body.connection).toBe('fc_1')
    expect(body.guests).toEqual(['kr_b'])
    expect(body.players).toEqual(['a'])
  })
})
