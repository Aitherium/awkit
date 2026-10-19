/**
 * AgentSessionsPanel + lib/agentSessions: the owner's running agents on every machine.
 *
 * Pins the glance rules (needs-you first, one-line rows, no invented rows), the start
 * body (no unknown harness, no prompt field the daemon lacks), and the TAP PATHS for the
 * three jobs, counted on the real component against a scripted transport:
 *   (a) read + talk: tap row, type, Send          -> 2 taps after the app is open
 *   (b) start:       Start, (machine), Start       -> 2 taps with one machine, 3 with several
 *   (c) answer:      tap the needs-you row, "Yes"  -> 2 taps
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import AgentSessionsPanel from '../panels/AgentSessionsPanel'
import {
  agentStatus, foldEvents, glanceOrder, lastLine, mergeLines, needsYouCount, sessionName, startBody,
  defaultMachine,
  type AgentListResult, type AgentSession, type AgentSessionsTransport,
} from '../lib/agentSessions'

const NOW = Math.floor(Date.now() / 1000)

function row(over: Partial<AgentSession>): AgentSession {
  return { id: 's', nodeId: 'n1', machine: 'desk', canMessage: true, status: 'idle', ...over }
}

describe('lib/agentSessions', () => {
  it('sorts needs-you first, then working, idle, ended; newest first inside each', () => {
    const out = glanceOrder([
      row({ id: 'ended', status: 'exited', last_activity_at: NOW }),
      row({ id: 'idle', status: 'idle', last_activity_at: NOW }),
      row({ id: 'work-old', status: 'working', last_activity_at: NOW - 100 }),
      row({ id: 'work-new', status: 'working', last_activity_at: NOW }),
      row({ id: 'ask', status: 'waiting-permission', last_activity_at: NOW - 9999 }),
    ])
    expect(out.map((s) => s.id)).toEqual(['ask', 'work-new', 'work-old', 'idle', 'ended'])
  })

  it('never folds a waiting session into "working"', () => {
    expect(agentStatus('waiting-input').label).toBe('needs you')
    expect(agentStatus('blocked?').tone).toBe('attention')
    expect(agentStatus('working').label).toBe('working')
    expect(agentStatus(undefined).label).toBe('idle')
    expect(needsYouCount([row({ status: 'waiting-input' }), row({ status: 'working' })])).toBe(1)
  })

  it('names a row and gives it ONE capped line', () => {
    expect(sessionName({ name: '', title: '  fix   login ', harness: 'claude' })).toBe('fix login')
    expect(sessionName({})).toBe('session')
    expect(lastLine({ last_activity_summary: 'a\n b', last_prompt: 'x' })).toBe('a b')
    expect(lastLine({ last_prompt: 'y'.repeat(200) }, 10)).toHaveLength(10)
  })

  it('preselects a machine only when there is exactly one', () => {
    const m = (id: string, canStart: boolean) => ({ nodeId: id, label: id, online: true, canStart })
    expect(defaultMachine([m('a', true), m('b', false)])).toBe('a')
    expect(defaultMachine([m('a', true), m('b', true)])).toBe('')
  })

  it('builds the daemon body and refuses a harness the picker does not offer', () => {
    expect(startBody({ nodeId: 'n', harness: 'claude', cwd: ' C:/x ', prompt: 'go' }))
      .toEqual({ harness: 'claude', cwd: 'C:/x', permission_mode: 'acceptEdits' })
    expect(startBody({ nodeId: 'n', harness: 'codex' })).toEqual({ harness: 'codex', cwd: '' })
    expect(() => startBody({ nodeId: 'n', harness: 'terminal' })).toThrow(/unknown harness/)
  })

  it('folds events in order and merges a delta split across reads', () => {
    const a = foldEvents([], [
      { kind: 'turn.started', seq: 1, text: 'hi' },
      { kind: 'text.delta', seq: 2, text: 'Hel' },
      { kind: 'usage', seq: 3 },
    ])
    expect(a).toEqual([{ seq: 1, role: 'you', text: 'hi' }, { seq: 2, role: 'agent', text: 'Hel' }])
    const b = mergeLines(a, foldEvents([], [{ kind: 'text.delta', seq: 4, text: 'lo' }]))
    expect(b[1]).toEqual({ seq: 4, role: 'agent', text: 'Hello' })
  })
})

function fakeTransport(list: AgentListResult) {
  const sent: Array<{ id: string; text: string }> = []
  const started: unknown[] = []
  const t: AgentSessionsTransport = {
    list: jest.fn(async () => list),
    read: jest.fn(async () => ({ lines: [{ seq: 1, role: 'agent' as const, text: 'May I run the tests?' }], cursor: 1 })),
    send: jest.fn(async (s, text) => { sent.push({ id: s.id, text }); return { ok: true, detail: 'Sent.' } }),
    start: jest.fn(async (req) => {
      started.push(req)
      return { ok: true, detail: '', session: row({ id: 'new', nodeId: req.nodeId, machine: 'desk', status: 'working' }) }
    }),
  }
  return { t, sent, started }
}

const LIST: AgentListResult = {
  sessions: [
    row({ id: 'busy', name: 'refactor auth', status: 'working', last_activity_summary: 'editing lib/auth.ts', last_activity_at: NOW }),
    row({ id: 'ask', name: 'deploy veil', status: 'waiting-input', last_activity_summary: 'wants to run fleet-deploy', last_activity_at: NOW - 60 }),
  ],
  machines: [{ nodeId: 'n1', label: 'desk', online: true, canStart: true }],
  errors: [{ machine: 'laptop', detail: 'node_unreachable' }],
}

async function mount(list = LIST) {
  const f = fakeTransport(list)
  render(<AgentSessionsPanel transport={f.t} listEveryMs={60_000} readEveryMs={60_000} />)
  await screen.findByText('1 needs you')
  return f
}

describe('AgentSessionsPanel', () => {
  it('lists every machine\u2019s sessions, needs-you first, with status and last line; shows a failed machine', async () => {
    await mount()
    const rows = Array.from(screen.getByLabelText('Sessions').querySelectorAll('[data-session]'))
    expect(rows[0]).toHaveTextContent('deploy veil')
    expect(rows[0]).toHaveTextContent('needs you')
    expect(rows[0]).toHaveTextContent('wants to run fleet-deploy')
    expect(rows[1]).toHaveTextContent('working')
    expect(screen.getByText('laptop: node_unreachable')).toBeTruthy()
  })

  it('job (a): read and talk in 2 taps', async () => {
    const f = await mount()
    let taps = 0
    fireEvent.click(screen.getByText('refactor auth').closest('button')!); taps++
    expect(await screen.findByText('May I run the tests?')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'use the fake clock' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' })); taps++
    await waitFor(() => expect(f.sent).toEqual([{ id: 'busy', text: 'use the fake clock' }]))
    expect(taps).toBe(2)
  })

  it('job (c): answer a waiting agent in 2 taps with a quick reply', async () => {
    const f = await mount()
    let taps = 0
    fireEvent.click(screen.getByText('deploy veil').closest('button')!); taps++
    fireEvent.click(await screen.findByRole('button', { name: 'Yes' })); taps++
    await waitFor(() => expect(f.sent).toEqual([{ id: 'ask', text: 'yes' }]))
    expect(taps).toBe(2)
  })

  it('job (b): start an agent in 2 taps when one machine can, then lands in it', async () => {
    const f = await mount()
    let taps = 0
    fireEvent.click(screen.getByRole('button', { name: 'Start' })); taps++
    expect(screen.getByRole('button', { name: 'desk' })).toHaveAttribute('aria-pressed', 'true')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start' })); taps++ })
    await waitFor(() => expect(f.started).toEqual([{ nodeId: 'n1', harness: 'claude', cwd: '', prompt: '' }]))
    expect(taps).toBe(2)
    expect(document.querySelector('[data-view="session"]')).toBeTruthy()
  })

  it('a session that takes no message says why instead of offering a box', async () => {
    const f = fakeTransport({
      ...LIST,
      sessions: [row({ id: 'x', name: 'locked', status: 'waiting-input', canMessage: false, whyNot: 'Focus reopens it.' })],
    })
    render(<AgentSessionsPanel transport={f.t} listEveryMs={60_000} readEveryMs={60_000} />)
    fireEvent.click((await screen.findByText('locked')).closest('button')!)
    expect(await screen.findByText('Focus reopens it.')).toBeTruthy()
    expect(screen.queryByLabelText('Message')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Yes' })).toBeNull()
  })

  it('a failed list is a sentence, not an empty screen; no machines says how to add one', async () => {
    const bad: AgentSessionsTransport = { ...fakeTransport(LIST).t, list: jest.fn(async () => { throw new Error('HTTP 401') }) }
    const { unmount } = render(<AgentSessionsPanel transport={bad} listEveryMs={60_000} />)
    expect(await screen.findByText('HTTP 401')).toBeTruthy()
    unmount()
    render(<AgentSessionsPanel transport={fakeTransport({ sessions: [], machines: [], errors: [] }).t} listEveryMs={60_000} />)
    expect(await screen.findByText(/Run `awsh rc` on a computer/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
  })

  it('a permission prompt gets the composer, not a typed Yes; a failed first read says "Could not look"', async () => {
    const f = fakeTransport({ ...LIST, sessions: [row({ id: 'p', name: 'perm', status: 'waiting-permission' })] })
    const { unmount } = render(<AgentSessionsPanel transport={f.t} listEveryMs={60_000} readEveryMs={60_000} />)
    fireEvent.click((await screen.findByText('perm')).closest('button')!)
    expect(await screen.findByLabelText('Message')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Yes' })).toBeNull()
    unmount()
    const bad: AgentSessionsTransport = { ...fakeTransport(LIST).t, list: jest.fn(async () => { throw new Error('HTTP 502') }) }
    render(<AgentSessionsPanel transport={bad} listEveryMs={60_000} />)
    expect(await screen.findByText('Could not look')).toBeTruthy()
  })

  it('job (c) in 1 tap after opening: a decision card is answered in place, most urgent first', async () => {
    const answered: Array<[string, string]> = []
    const f = fakeTransport({
      ...LIST,
      decisions: [
        { id: 'd-low', nodeId: 'n1', machine: 'desk', title: 'Rename the branch?', urgency: 'low', options: [{ key: 'y', label: 'Rename' }] },
        { id: 'd-hi', nodeId: 'n1', machine: 'desk', title: 'Deploy veil now?', urgency: 'high', age_seconds: 300,
          options: [{ key: 'go', label: 'Deploy', recommended: true }, { key: 'wait', label: 'Wait' }] },
      ],
    })
    f.t.answer = jest.fn(async (d, key) => { answered.push([d.id, key]); return { ok: true, detail: '' } })
    render(<AgentSessionsPanel transport={f.t} listEveryMs={60_000} readEveryMs={60_000} />)
    const cards = within(await screen.findByLabelText('Waiting on you')).getAllByRole('listitem')
    expect(cards[0]).toHaveTextContent('Deploy veil now?')
    expect(screen.getByText('3 need you')).toBeTruthy()
    let taps = 0
    fireEvent.click(within(cards[0]).getByRole('button', { name: 'Deploy' })); taps++
    await waitFor(() => expect(answered).toEqual([['d-hi', 'go']]))
    expect(taps).toBe(1)
    await waitFor(() => expect(screen.queryByText('Deploy veil now?')).toBeNull())
  })

  it('job (c) for a session waiting for input: Yes on the row itself, 1 tap after opening', async () => {
    const f = await mount()
    const row = screen.getByText('deploy veil').closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(f.sent).toEqual([{ id: 'ask', text: 'yes' }]))
    expect(document.querySelector('[data-view="list"]')).toBeTruthy()
  })
})
