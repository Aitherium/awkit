/**
 * Enroll this computer in one step: the card a person sees at sign-in.
 *
 * - prompt:    shown only when the host says to ask; one sentence, an OS picker
 *              that defaults to the browser's platform, ONE copy button, the five
 *              steps, "Not now". No command is minted until the button is pressed.
 * - running:   the checklist follows the setup script's step reports, re-read
 *              from GET /devices on a timer.
 * - failed:    the stopped step shows the script's detail and the one thing to
 *              do next.
 * - connected: the machine's heartbeat landed.
 * A host without the onboarding route renders the card's children unchanged.
 *
 * Collected by AitherVeil's jest (roots include ../packages/awkit/src).
 * Run: cd AitherOS/apps/AitherVeil && npx jest ../packages/awkit/src/panels/__tests__/DeviceSetupCard.test.tsx
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import DeviceSetupCard, {
  SETUP_STEPS, detectSetupOS, isConnected, stepStates,
} from '../DeviceSetupCard'

const CODE = 'c'.repeat(43)
const ONE_LINER = {
  windows: `irm "https://acme-api.example.test/api/devices/setup/${CODE}.ps1" | iex`,
  macos: `curl -fsSL "https://acme-api.example.test/api/devices/setup/${CODE}.sh" | sh`,
  linux: `curl -fsSL "https://acme-api.example.test/api/devices/setup/${CODE}.sh" | sh`,
}
const MANUAL = {
  windows: 'python -m pip install awdk\npython -m adk login',
  macos: 'pip install awdk\nadk login',
  linux: 'pip install awdk\nadk login',
}
const DEVICE = {
  id: 'dev-1', node_id: 'my-windows-pc-ab12cd34', name: 'My Windows PC', os: 'windows',
  status: 'enrolling', progress: null as null | { step: number; state: string; detail?: string },
}
const ENROLLED = {
  device: DEVICE, device_secret: 'not-shown-by-the-card', commands: MANUAL,
  one_liner: ONE_LINER, setup_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
}

interface Host {
  onboarding: unknown | null
  devices: Array<Record<string, unknown>>
  enroll: unknown
  calls: Array<{ url: string; method: string; body?: unknown }>
}

function mockHost(over: Partial<Host> = {}): Host {
  const host: Host = {
    onboarding: { prompt: true, reason: 'no_device', device: null },
    devices: [],
    enroll: ENROLLED,
    calls: [],
    ...over,
  }
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    const method = (init?.method || 'GET').toUpperCase()
    host.calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
    if (u.endsWith('/devices/onboarding') && method === 'GET') {
      return host.onboarding ? ok(host.onboarding) : { ok: false, status: 404, json: async () => ({}) }
    }
    if (u.endsWith('/devices/onboarding/dismiss') && method === 'POST') return ok({ ok: true })
    if (u.endsWith('/devices/enroll') && method === 'POST') return ok(host.enroll)
    if (u.endsWith('/devices') && method === 'GET') return ok({ devices: host.devices })
    if (method === 'DELETE') return ok({ ok: true })
    return { ok: false, status: 404, json: async () => ({}) }
  })
  return host
}

const writeText = jest.fn(async (_text: string) => undefined)

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
}

beforeEach(() => {
  window.sessionStorage.clear()
  writeText.mockClear()
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
  setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
})

const stepStatesOnScreen = () =>
  screen.getAllByTestId('setup-step').map((el) => el.getAttribute('data-state'))

describe('DeviceSetupCard: the sign-in prompt', () => {
  it('shows one sentence, the OS picker on this platform, one copy button, five steps and "Not now"', async () => {
    const host = mockHost()
    render(<DeviceSetupCard productName="Acme Assistant" />)
    const cardEl = await screen.findByTestId('device-setup-card')

    const explain = screen.getByTestId('setup-explain').textContent || ''
    expect(explain).toContain('Connect this computer to Acme Assistant')
    expect(explain).toContain('Windows PowerShell')
    expect(explain.trim().split('. ').length).toBe(1) // one sentence

    expect(screen.getByTestId('setup-os-windows').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('setup-os-macos').getAttribute('aria-checked')).toBe('false')
    expect(screen.getAllByTestId('setup-copy')).toHaveLength(1)
    expect(screen.getByTestId('setup-copy').textContent).toBe('Copy the setup command')
    expect(screen.getAllByTestId('setup-step').map((el) => el.textContent)).toEqual(
      SETUP_STEPS.map((label, i) => `${i + 1}. ${label}`))
    expect(stepStatesOnScreen()).toEqual(['pending', 'pending', 'pending', 'pending', 'pending'])
    expect(screen.getByTestId('setup-not-now')).toBeTruthy()
    // The old separate commands are still there, behind a closed disclosure.
    const manual = screen.getByTestId('setup-manual') as HTMLDetailsElement
    expect(manual.tagName).toBe('DETAILS')
    expect(manual.open).toBe(false)
    expect(manual.querySelector('summary')!.textContent).toBe('Show the individual steps')

    // Showing the card mints nothing: no row is left behind for someone who ignores it.
    expect(host.calls.filter((c) => c.method !== 'GET')).toEqual([])
    expect(screen.queryByTestId('setup-command')).toBeNull()
    // No emoji anywhere on the card.
    expect(cardEl.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it('defaults the picker to the browser platform', async () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    mockHost()
    render(<DeviceSetupCard />)
    await screen.findByTestId('device-setup-card')
    expect(screen.getByTestId('setup-os-macos').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('setup-explain').textContent).toContain('a terminal')
  })

  it('the button gets the one command for the picked OS, copies it, and shows it', async () => {
    const host = mockHost()
    render(<DeviceSetupCard />)
    fireEvent.click(await screen.findByTestId('setup-copy'))
    const shown = await screen.findByTestId('setup-command')
    expect(shown.textContent).toBe(ONE_LINER.windows)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ONE_LINER.windows))

    // The host decides who: the card sends the OS, a default name, and `resume`
    // (re-issue my unfinished enrollment instead of adding a row) -- nothing else.
    const enroll = host.calls.find((c) => c.url.endsWith('/devices/enroll'))!
    expect(enroll.body).toEqual({ name: 'My Windows PC', os: 'windows', resume: true })

    // Picking another OS shows that OS's command without asking the host again.
    fireEvent.click(screen.getByTestId('setup-os-macos'))
    expect(screen.getByTestId('setup-command').textContent).toBe(ONE_LINER.macos)
    expect(host.calls.filter((c) => c.url.endsWith('/devices/enroll'))).toHaveLength(1)
    // Still exactly one copy button; the device secret is never on screen.
    expect(screen.getAllByTestId('setup-copy')).toHaveLength(1)
    expect(screen.getByTestId('device-setup-card').textContent).not.toContain('not-shown-by-the-card')
    // The separate commands for the same enrollment sit behind the disclosure.
    expect(screen.getByTestId('setup-manual-commands').textContent).toBe(MANUAL.macos)
  })

  it('renders nothing when the host says not to ask', async () => {
    for (const reason of ['enrolled', 'dismissed', 'identity_unavailable']) {
      const host = mockHost({ onboarding: { prompt: false, reason, device: null } })
      const { container, unmount } = render(<DeviceSetupCard />)
      await waitFor(() => expect(host.calls.some((c) => c.url.endsWith('/devices/onboarding'))).toBe(true))
      await act(async () => { await Promise.resolve() })
      expect(container.innerHTML).toBe('')
      unmount()
    }
  })

  it('"Not now" records the dismissal with no payload and hides the card', async () => {
    const host = mockHost()
    const { container } = render(<DeviceSetupCard />)
    fireEvent.click(await screen.findByTestId('setup-not-now'))
    expect(container.innerHTML).toBe('')
    const dismiss = host.calls.find((c) => c.url.endsWith('/devices/onboarding/dismiss'))!
    expect(dismiss.method).toBe('POST')
    expect(dismiss.body).toBeUndefined()
    // Nothing was minted, so there is nothing to take back.
    expect(host.calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it('"Not now" after getting a command that never ran takes the unused row back', async () => {
    const host = mockHost()
    render(<DeviceSetupCard />)
    fireEvent.click(await screen.findByTestId('setup-copy'))
    await screen.findByTestId('setup-command')
    fireEvent.click(screen.getByTestId('setup-not-now'))
    await waitFor(() => expect(host.calls.some(
      (c) => c.method === 'DELETE' && c.url.endsWith('/devices/dev-1'))).toBe(true))
  })
})

describe('DeviceSetupCard: running', () => {
  it('ticks the steps from the reports it re-reads on a timer', async () => {
    const host = mockHost()
    render(<DeviceSetupCard pollMs={20} />)
    fireEvent.click(await screen.findByTestId('setup-copy'))
    await screen.findByTestId('setup-command')

    host.devices = [{ ...DEVICE, progress: { step: 1, state: 'running', detail: '' } }]
    await waitFor(() => expect(stepStatesOnScreen()).toEqual(
      ['running', 'pending', 'pending', 'pending', 'pending']))

    host.devices = [{ ...DEVICE, progress: {
      step: 2, state: 'running', detail: 'Waiting for you to approve in the browser' } }]
    await waitFor(() => expect(stepStatesOnScreen()).toEqual(
      ['ok', 'running', 'pending', 'pending', 'pending']))
    expect(screen.getByTestId('setup-step-detail').textContent)
      .toBe('Waiting for you to approve in the browser')

    host.devices = [{ ...DEVICE, progress: { step: 4, state: 'ok', detail: '' } }]
    await waitFor(() => expect(stepStatesOnScreen()).toEqual(
      ['ok', 'ok', 'ok', 'ok', 'pending']))
    expect(screen.queryByTestId('setup-failed')).toBeNull()
    expect(screen.queryByTestId('setup-connected')).toBeNull()
    // It reads the person's own device list, never a per-device route.
    expect(host.calls.some((c) => c.method === 'GET' && c.url.endsWith('/devices'))).toBe(true)
  })

  it('picks an enrollment in progress back up after a reload, without a new command', async () => {
    const host = mockHost({
      onboarding: { prompt: false, reason: 'enrolling',
        device: { ...DEVICE, progress: { step: 3, state: 'running', detail: '' } } },
    })
    render(<DeviceSetupCard />)
    await screen.findByTestId('device-setup-card')
    expect(stepStatesOnScreen()).toEqual(['ok', 'ok', 'running', 'pending', 'pending'])
    // A running script holds the command's secret: nothing offers to replace it
    // by accident, and nothing was minted by showing the card.
    expect(screen.queryByTestId('setup-copy')).toBeNull()
    expect(screen.getByTestId('setup-running-note')).toBeTruthy()
    expect(screen.getByTestId('setup-restart').textContent).toBe('Start over with a new command')
    expect(host.calls.some((c) => c.url.endsWith('/devices/enroll'))).toBe(false)
  })
})

describe('DeviceSetupCard: failed', () => {
  const DETAIL = 'Sign-in did not finish (exit code 1). Run the same command again and approve '
    + 'the sign-in in the browser window that opens.'

  it('shows which step stopped, the script\'s own detail, and the one thing to do next', async () => {
    const host = mockHost()
    render(<DeviceSetupCard pollMs={20} />)
    fireEvent.click(await screen.findByTestId('setup-copy'))
    await screen.findByTestId('setup-command')
    host.devices = [{ ...DEVICE, progress: { step: 2, state: 'failed', detail: DETAIL } }]

    const failed = await screen.findByTestId('setup-failed')
    expect(stepStatesOnScreen()).toEqual(['ok', 'failed', 'pending', 'pending', 'pending'])
    expect(failed.textContent).toContain('Step 2 stopped: Sign in')
    expect(screen.getByTestId('setup-failed-detail').textContent).toBe(DETAIL)
    expect(screen.getByTestId('setup-failed-next').textContent)
      .toBe('Next: once that is sorted, paste the same command again.')
    // The command is still there to paste again.
    expect(screen.getByTestId('setup-command').textContent).toBe(ONE_LINER.windows)
    expect(screen.queryByTestId('setup-connected')).toBeNull()
  })

  it('after a reload (the command is gone) the next thing is a new command', async () => {
    mockHost({
      onboarding: { prompt: false, reason: 'enrolling',
        device: { ...DEVICE, progress: { step: 1, state: 'failed', detail: '' } } },
    })
    render(<DeviceSetupCard />)
    await screen.findByTestId('setup-failed')
    expect(screen.getByTestId('setup-failed-detail').textContent)
      .toBe('The setup stopped at this step and did not say why.')
    expect(screen.getByTestId('setup-failed-next').textContent)
      .toBe('Next: press the button above for a new command, then paste it.')
    expect(screen.getByTestId('setup-copy')).toBeTruthy()
  })
})

describe('DeviceSetupCard: connected', () => {
  it('says Connected when the heartbeat lands, and stops asking', async () => {
    const host = mockHost()
    render(<DeviceSetupCard pollMs={20} productName="Acme Assistant" />)
    fireEvent.click(await screen.findByTestId('setup-copy'))
    await screen.findByTestId('setup-command')
    host.devices = [{ ...DEVICE, status: 'online', progress: { step: 5, state: 'ok', detail: '' } }]

    const connected = await screen.findByTestId('setup-connected')
    expect(connected.textContent).toBe('Connected')
    expect(screen.getByTestId('device-setup-card').textContent)
      .toContain('My Windows PC is enrolled. Acme Assistant can now run on it.')
    expect(stepStatesOnScreen()).toEqual(['ok', 'ok', 'ok', 'ok', 'ok'])
    // Nothing left to copy, dismiss or expand; one way to close it.
    expect(screen.queryByTestId('setup-copy')).toBeNull()
    expect(screen.queryByTestId('setup-command')).toBeNull()
    expect(screen.queryByTestId('setup-not-now')).toBeNull()
    expect(screen.queryByTestId('setup-manual')).toBeNull()
    fireEvent.click(screen.getByTestId('setup-done'))
    expect(screen.queryByTestId('device-setup-card')).toBeNull()
    // Closing a finished setup is not a dismissal.
    expect(host.calls.some((c) => c.url.endsWith('/dismiss'))).toBe(false)
  })
})

describe('DeviceSetupCard: inside My Hardware (mode="panel")', () => {
  it('is always offered, has no "Not now", and keeps the host\'s manual steps behind the disclosure', async () => {
    mockHost({ onboarding: { prompt: false, reason: 'dismissed', device: null } })
    render(
      <DeviceSetupCard mode="panel">
        <button>Enroll this machine</button>
      </DeviceSetupCard>,
    )
    await screen.findByTestId('device-setup-card')
    expect(screen.getByTestId('setup-copy')).toBeTruthy()
    expect(screen.queryByTestId('setup-not-now')).toBeNull()
    const manual = screen.getByTestId('setup-manual') as HTMLDetailsElement
    expect(manual.open).toBe(false)
    expect(manual.contains(screen.getByText('Enroll this machine'))).toBe(true)
  })

  it('a host with no one-step setup gets its manual steps exactly as before', async () => {
    mockHost({ onboarding: null })
    render(
      <DeviceSetupCard mode="panel">
        <button>Enroll this machine</button>
      </DeviceSetupCard>,
    )
    await screen.findByText('Enroll this machine')
    expect(screen.queryByTestId('device-setup-card')).toBeNull()
    expect(screen.queryByTestId('setup-manual')).toBeNull()
  })
})

describe('step and platform helpers', () => {
  it('stepStates: before the reported step is done, after it waits', () => {
    expect(stepStates(null)).toEqual(['pending', 'pending', 'pending', 'pending', 'pending'])
    expect(stepStates({ ...DEVICE, progress: { step: 3, state: 'failed' } }))
      .toEqual(['ok', 'ok', 'failed', 'pending', 'pending'])
    expect(stepStates({ ...DEVICE, progress: { step: 2, state: 'something-new' } }))
      .toEqual(['ok', 'pending', 'pending', 'pending', 'pending'])
  })

  it('isConnected: the heartbeat, or the last step reported ok', () => {
    expect(isConnected(null)).toBe(false)
    expect(isConnected({ ...DEVICE, progress: { step: 5, state: 'running' } })).toBe(false)
    expect(isConnected({ ...DEVICE, progress: { step: 5, state: 'ok' } })).toBe(true)
    expect(isConnected({ ...DEVICE, status: 'online' })).toBe(true)
  })

  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'macos'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 'linux'],
    ['SomethingElse/1.0', 'windows'],
  ])('detectSetupOS(%s) -> %s', (ua, want) => {
    expect(detectSetupOS(ua)).toBe(want)
  })
})
