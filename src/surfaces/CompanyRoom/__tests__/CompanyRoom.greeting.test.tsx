/**
 * The room greets, takes dropped files and speaks (tenant UX audit 2026-10-13).
 *
 * - an empty room with a `greeting` renders the assistant's message and its
 *   chips in place of "Nothing said yet"; a chip SAYs its prompt;
 * - a file dropped on the room reaches `onDropFiles`; a room without it is not
 *   a drop target;
 * - with `voice` enabled, an agent reply that ARRIVES is spoken, the backlog
 *   present at first load is not, and a person's message never is.
 *
 * Run: cd AitherOS/apps/AitherVeil && npx jest ../packages/awkit/src/surfaces/CompanyRoom/__tests__/CompanyRoom.greeting.test.tsx
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { RoomMessage } from '../useRoom'

const roomState = {
  channel: '#company',
  loading: false,
  degraded: false,
  unauthenticated: false,
  justCreated: false,
  messages: [] as RoomMessage[],
  people: [],
  agents: [{ nick: 'Ada' }],
  ambient: { enabled: false, cooldown_seconds: 8 },
  pins: [],
  events: [],
  listening: false,
  say: jest.fn(async () => {}),
  inviteAgent: jest.fn(),
  dismissAgent: jest.fn(),
  refresh: jest.fn(),
}

jest.mock('../useRoom', () => {
  const actual = jest.requireActual('../useRoom')
  return { ...actual, useRoom: () => roomState }
})

const speak = jest.fn(async (_text: string) => {})
// Counts mounts of the speech hook: it cancels window.speechSynthesis on unmount,
// so a room with voice off must never mount it (closing the room would cut off a
// chat panel's speech elsewhere on the page).
const speechHookCalls = jest.fn()
jest.mock('../../../voice/useSpeechOutput', () => ({
  useSpeechOutput: () => {
    speechHookCalls()
    return { speak, speakSentence: speak, stop: () => {}, isSpeaking: false, availableVoices: [], browserTTSAvailable: true }
  },
}))

// Summons surfaces are not under test; their module graphs (bead-space -> d3 ESM)
// are not loadable under jest.
jest.mock('../../../panels/BeadSpacePanel', () => () => null)
jest.mock('../../../panels/OnDevicePanel', () => () => null)
jest.mock('../../../panels/MyHardwarePanel', () => () => null)
jest.mock('../PillarLanes', () => () => null)
jest.mock('../../Mail/MailSurface', () => () => null)
jest.mock('../../Fleet/FleetSurface', () => () => null)
jest.mock('../../Notes/NotesSurface', () => () => null)

// eslint-disable-next-line import/first
import CompanyRoom from '../CompanyRoom'

const GREETING = {
  message: "Hi — I'm Ada. Upload resumes and proposals, then ask me anything.",
  chips: [
    { label: 'Summarize our 12 documents', prompt: 'Summarize what is in our 12 documents.' },
    { label: 'Who are our 4 staff?', prompt: 'List our staff and their roles.' },
    { label: 'Compare our 3 projects', prompt: 'Compare our 3 projects.' },
  ],
}

beforeEach(() => {
  roomState.messages = []
  roomState.loading = false
  roomState.say.mockClear()
  speak.mockClear()
  speechHookCalls.mockClear()
})

describe('CompanyRoom greeting', () => {
  it('an empty room renders the welcome and its 3 chips instead of "Nothing said yet"', () => {
    render(<CompanyRoom appName="Ada" greeting={GREETING} />)
    expect(screen.getByText(GREETING.message)).toBeInTheDocument()
    expect(screen.queryByText('Nothing said yet')).toBeNull()
    const chips = document.querySelectorAll('.room-greeting-chip')
    expect(chips).toHaveLength(3)
    expect(Array.from(chips).map((c) => c.textContent)).toEqual(GREETING.chips.map((c) => c.label))
  })

  it('a chip SAYs its prompt (to the host when it took the composer)', () => {
    const onSay = jest.fn()
    render(<CompanyRoom appName="Ada" greeting={GREETING} onSay={onSay} />)
    fireEvent.click(screen.getByText('Who are our 4 staff?'))
    expect(onSay).toHaveBeenCalledWith('List our staff and their roles.')
    expect(roomState.say).not.toHaveBeenCalled()
  })

  it('a blank greeting message falls back to the generic lede, never an empty line', () => {
    render(<CompanyRoom appName="Ada" greeting={{ message: '  ', chips: GREETING.chips }} />)
    expect(screen.getByText('This is where your team and its agents work in the open.')).toBeInTheDocument()
  })

  it('without a greeting the generic blank copy stays', () => {
    render(<CompanyRoom appName="Ada" />)
    expect(screen.getByText('Nothing said yet')).toBeInTheDocument()
  })
})

describe('CompanyRoom file drop', () => {
  const dropOn = (el: Element, files: File[]) => {
    fireEvent.dragOver(el, { dataTransfer: { types: ['Files'], files } })
    fireEvent.drop(el, { dataTransfer: { types: ['Files'], files } })
  }

  it('hands dropped files to onDropFiles', () => {
    const onDropFiles = jest.fn()
    const { container } = render(<CompanyRoom greeting={GREETING} onDropFiles={onDropFiles} />)
    const file = new File(['hello'], 'resume.pdf', { type: 'application/pdf' })
    dropOn(container.querySelector('.room')!, [file])
    expect(onDropFiles).toHaveBeenCalledTimes(1)
    expect(onDropFiles.mock.calls[0][0].map((f: File) => f.name)).toEqual(['resume.pdf'])
  })

  it('marks the room while a file is dragged over it', () => {
    const { container } = render(<CompanyRoom onDropFiles={jest.fn()} />)
    const room = container.querySelector('.room')!
    fireEvent.dragOver(room, { dataTransfer: { types: ['Files'], files: [] } })
    expect(room.getAttribute('data-dropping')).toBe('true')
  })

  it('shows the outcome the host returns for a drop', async () => {
    const onDropFiles = jest.fn(async () => 'Could not add dup.pdf: it is already in the knowledge base.')
    const { container } = render(<CompanyRoom onDropFiles={onDropFiles} />)
    dropOn(container.querySelector('.room')!, [new File(['x'], 'dup.pdf')])
    expect(screen.getByRole('status').textContent).toBe('Adding dup.pdf…')
    await waitFor(() => expect(screen.getByRole('status').textContent)
      .toBe('Could not add dup.pdf: it is already in the knowledge base.'))
  })

  it('a failed upload is never silent', async () => {
    const onDropFiles = jest.fn(async () => { throw new Error('network') })
    const { container } = render(<CompanyRoom onDropFiles={onDropFiles} />)
    dropOn(container.querySelector('.room')!, [new File(['a'], 'a.pdf'), new File(['b'], 'b.pdf')])
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Could not add those 2 files.'))
  })

  it('a room without onDropFiles is not a drop target', () => {
    const { container } = render(<CompanyRoom />)
    const room = container.querySelector('.room')!
    fireEvent.dragOver(room, { dataTransfer: { types: ['Files'], files: [] } })
    expect(room.getAttribute('data-dropping')).toBeNull()
  })
})

describe('CompanyRoom voice', () => {
  const backlog: RoomMessage = { id: 'm1', nick: 'Ada', content: 'Earlier answer.' }

  it('speaks a NEW agent reply, never the backlog or a person', () => {
    roomState.messages = [backlog]
    const voice = { enabled: true }
    const { rerender } = render(<CompanyRoom voice={voice} />)
    expect(speak).not.toHaveBeenCalled()

    roomState.messages = [
      backlog,
      { id: 'm2', nick: 'dana', content: 'Who knows Revit?' },
      { id: 'm3', nick: 'Ada', content: 'Priya and Tom list Revit.' },
    ]
    act(() => { rerender(<CompanyRoom voice={voice} />) })
    expect(speak.mock.calls.map((c) => c[0])).toEqual(['Priya and Tom list Revit.'])
  })

  it('several replies landing together are spoken as ONE utterance', () => {
    // The browser tier cancels before each speak(); one call per reply would
    // leave only the last one audible.
    roomState.messages = [backlog]
    const voice = { enabled: true }
    const { rerender } = render(<CompanyRoom voice={voice} />)
    roomState.messages = [
      backlog,
      { id: 'm4', nick: 'Ada', content: 'First.' },
      { id: 'm5', nick: 'Ada', content: 'Second.' },
    ]
    act(() => { rerender(<CompanyRoom voice={voice} />) })
    expect(speak).toHaveBeenCalledTimes(1)
    expect(speak.mock.calls[0][0]).toBe('First.\n\nSecond.')
  })

  it('stays silent when voice is disabled', () => {
    roomState.messages = [backlog]
    const voice = { enabled: false }
    const { rerender } = render(<CompanyRoom voice={voice} />)
    roomState.messages = [backlog, { id: 'm3', nick: 'Ada', content: 'New.' }]
    act(() => { rerender(<CompanyRoom voice={voice} />) })
    expect(speak).not.toHaveBeenCalled()
  })

  it('does not mount the speech hook at all unless voice is on', () => {
    const { rerender, unmount } = render(<CompanyRoom />)
    rerender(<CompanyRoom voice={{ enabled: false }} />)
    rerender(<CompanyRoom voice={{ enabled: true, autoSpeak: false }} />)
    expect(speechHookCalls).not.toHaveBeenCalled()
    rerender(<CompanyRoom voice={{ enabled: true }} />)
    expect(speechHookCalls).toHaveBeenCalled()
    unmount()
  })
})
