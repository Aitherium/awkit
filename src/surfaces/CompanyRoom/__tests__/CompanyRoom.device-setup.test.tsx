/**
 * The room is what a person lands on at sign-in, so that is where the
 * enroll-this-computer prompt is mounted -- only for a host that opted in to
 * self-service hardware, and not on top of My Hardware, which carries the same
 * card itself.
 *
 * Run: cd AitherOS/apps/AitherVeil && npx jest ../packages/awkit/src/surfaces/CompanyRoom/__tests__/CompanyRoom.device-setup.test.tsx
 */
import React from 'react'
import { act, render, screen } from '@testing-library/react'

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

jest.mock('../../../voice/useSpeechOutput', () => ({
  useSpeechOutput: () => ({ speak: async () => {}, speakSentence: async () => {}, stop: () => {},
    isSpeaking: false, availableVoices: [], browserTTSAvailable: true }),
}))

// Summons surfaces are not under test; their module graphs (bead-space -> d3 ESM)
// are not loadable under jest.
jest.mock('../../../panels/BeadSpacePanel', () => () => null)
jest.mock('../../../panels/OnDevicePanel', () => () => null)
jest.mock('../../../panels/MyHardwarePanel', () => () => <div data-testid="my-hardware" />)
jest.mock('../PillarLanes', () => () => null)
jest.mock('../../Mail/MailSurface', () => () => null)
jest.mock('../../Fleet/FleetSurface', () => () => null)
jest.mock('../../Notes/NotesSurface', () => () => null)
jest.mock('../../../panels/DeviceSetupCard', () => (props: Record<string, unknown>) => (
  <div data-testid="device-setup-prompt" data-mode={String(props.mode)}
    data-product={String(props.productName)} data-api={String(props.apiBase)} />
))

// eslint-disable-next-line import/first
import CompanyRoom, { type CompanyRoomHandle } from '../CompanyRoom'

describe('CompanyRoom enroll-this-computer prompt', () => {
  it('mounts the prompt, inside the sheet, for a host that opted in to hardware', () => {
    const { container } = render(<CompanyRoom appName="Ada" enableHardware />)
    const prompt = screen.getByTestId('device-setup-prompt')
    expect(prompt.getAttribute('data-mode')).toBe('prompt')
    expect(prompt.getAttribute('data-product')).toBe('Ada')
    // The devices API, not the room's own API base.
    expect(prompt.getAttribute('data-api')).toBe('undefined')
    // The room is a grid of named areas: the card lives in the sheet's flow.
    expect(container.querySelector('.room-sheet')!.contains(prompt)).toBe(true)
  })

  it('does not mount it for a host that did not opt in', () => {
    render(<CompanyRoom appName="Ada" />)
    expect(screen.queryByTestId('device-setup-prompt')).toBeNull()
  })

  it('steps aside while My Hardware is open, which carries the same card', () => {
    const ref = React.createRef<CompanyRoomHandle>()
    render(<CompanyRoom ref={ref} appName="Ada" enableHardware />)
    expect(screen.getByTestId('device-setup-prompt')).toBeTruthy()
    act(() => { ref.current!.summon('hardware') })
    expect(screen.getByTestId('my-hardware')).toBeTruthy()
    expect(screen.queryByTestId('device-setup-prompt')).toBeNull()
  })
})
