// @vitest-environment jsdom
/**
 * SetupWizard: driven by /api/setup/steps, secrets write-only, reveal-once with a
 * required "I saved it", a 401 back to the code screen. Each rule is asserted in the
 * direction that would catch its regression.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SetupWizard, { SKIP, type SetupWizardClient, type WizardStep } from '../appliance/SetupWizard'

afterEach(() => cleanup())

const STEPS: WizardStep[] = [
  { id: 'hostname', title: 'Name this machine', why: 'network name', kind: 'text', builtin: true, current: 'awnix' },
  { id: 'license', title: 'License', why: 'unlocks updates', kind: 'secret' },
  { id: 'acme-model', title: 'Choose the AcmeBot model', why: 'size vs speed', kind: 'choice',
    options: [{ value: '4B', label: '4B', active: true }, { value: '8B', label: '8B', detail: 'needs 8 GB' }] },
  { id: 'auto', title: 'Automatic updates', why: 'stay current', kind: 'toggle' },
  { id: 'admin-pw', title: 'Platform admin password', why: 'shown once', kind: 'reveal' },
  { id: 'acme-open', title: 'Open AcmeBot', why: 'it is running', kind: 'info', text: 'Open http://10.0.0.5:8900' },
]

function makeClient(over: Partial<SetupWizardClient> = {}) {
  const applied: Array<[string, unknown]> = []
  const client: SetupWizardClient = {
    setupSteps: vi.fn(async () => ({ state: 'ok', status: 200, data: { steps: STEPS } })),
    applySetupStep: vi.fn(async (id: string, value: unknown) => {
      applied.push([id, value])
      if (id === 'admin-pw') return { state: 'ok', status: 200, data: { ok: true, reveal: 'S3cr3t-Once-Only' } }
      return { state: 'ok', status: 200, data: { ok: true } }
    }),
    finishSetup: vi.fn(async () => ({ state: 'ok', status: 200, data: { ok: true } })),
    ...over,
  }
  return { client, applied }
}

const next = () => fireEvent.click(screen.getByTestId('setup-next'))

describe('SetupWizard', () => {
  it('renders each step by its kind, in the order the server gave', async () => {
    const { client } = makeClient()
    render(<SetupWizard client={client} />)
    const first = await screen.findByTestId('setup-step-hostname')
    expect(first.getAttribute('data-kind')).toBe('text')
    expect(screen.getByText('Step 1 of 6')).toBeTruthy()
    fireEvent.click(screen.getByTestId('setup-skip'))
    const lic = await screen.findByTestId('setup-step-license')
    expect(lic.getAttribute('data-kind')).toBe('secret')
    expect((screen.getByTestId('secret-input') as HTMLInputElement).type).toBe('password')
  })

  it('a secret is sent once and never reflected back into the DOM', async () => {
    const { client, applied } = makeClient()
    render(<SetupWizard client={client} />)
    await screen.findByTestId('setup-step-hostname')
    fireEvent.click(screen.getByTestId('setup-skip'))
    await screen.findByTestId('setup-step-license')
    const secret = 'AITHER1.cGF5bG9hZC1zZWNyZXQ.c2ln'
    fireEvent.change(screen.getByTestId('secret-input'), { target: { value: secret } })
    await act(async () => { next() })
    await screen.findByTestId('setup-step-acme-model')
    expect(applied).toContainEqual(['license', secret])
    expect(document.body.textContent).not.toContain(secret)
    for (const el of Array.from(document.querySelectorAll('input,textarea'))) {
      expect((el as HTMLInputElement).value).not.toBe(secret)
    }
    // Going Back must not resurrect it either.
    fireEvent.click(screen.getByText('Back'))
    await screen.findByTestId('setup-step-license')
    expect((screen.getByTestId('secret-input') as HTMLInputElement).value).toBe('')
  })

  it('a choice applies the picked value; skip sends the skip sentinel', async () => {
    const { client, applied } = makeClient()
    render(<SetupWizard client={client} />)
    await screen.findByTestId('setup-step-hostname')
    fireEvent.click(screen.getByTestId('setup-skip'))
    await screen.findByTestId('setup-step-license')
    await act(async () => { fireEvent.click(screen.getByTestId('setup-skip')) })
    expect(applied).toContainEqual(['license', SKIP])
    await screen.findByTestId('setup-step-acme-model')
    fireEvent.click(screen.getByLabelText('8B'))
    await act(async () => { next() })
    expect(applied).toContainEqual(['acme-model', '8B'])
    const toggle = await screen.findByTestId('setup-step-auto')
    expect(toggle.getAttribute('data-kind')).toBe('toggle')
  })

  it('reveal shows once, offers a download, and requires "I saved it"', async () => {
    const { client } = makeClient({
      setupSteps: vi.fn(async () => ({ state: 'ok', status: 200, data: { steps: [STEPS[4], STEPS[5]] } })),
    })
    render(<SetupWizard client={client} />)
    await screen.findByTestId('setup-step-admin-pw')
    await act(async () => { next() })          // "Show"
    expect((await screen.findByTestId('reveal-output')).textContent).toBe('S3cr3t-Once-Only')
    expect(screen.getByTestId('reveal-download').getAttribute('download')).toBe('admin-pw.txt')
    expect((screen.getByTestId('setup-next') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('I saved it'))
    expect((screen.getByTestId('setup-next') as HTMLButtonElement).disabled).toBe(false)
    await act(async () => { next() })
    await screen.findByTestId('setup-step-acme-open')
    expect(document.body.textContent).not.toContain('S3cr3t-Once-Only')
    expect(client.applySetupStep).toHaveBeenCalledTimes(1)
  })

  it('Back cannot throw away a shown reveal before "I saved it"', async () => {
    const { client } = makeClient({
      setupSteps: vi.fn(async () => ({ state: 'ok', status: 200, data: { steps: [STEPS[0], STEPS[4]] } })),
    })
    render(<SetupWizard client={client} />)
    await screen.findByTestId('setup-step-hostname')
    await act(async () => { fireEvent.click(screen.getByTestId('setup-skip')) })
    await screen.findByTestId('setup-step-admin-pw')
    expect((screen.getByTestId('setup-back') as HTMLButtonElement).disabled).toBe(false)
    await act(async () => { next() })          // "Show"
    await screen.findByTestId('reveal-output')
    expect((screen.getByTestId('setup-back') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByTestId('setup-skip')).toBeNull()
    fireEvent.click(screen.getByLabelText('I saved it'))
    expect((screen.getByTestId('setup-back') as HTMLButtonElement).disabled).toBe(false)
  })

  it('a 401 goes back to the code screen and tells the shell', async () => {
    const onUnauthorized = vi.fn()
    const { client } = makeClient({
      applySetupStep: vi.fn(async () => ({ state: 'error', status: 401 })),
      login: vi.fn(async () => ({ state: 'ok', status: 200 })),
    })
    render(<SetupWizard client={client} onUnauthorized={onUnauthorized} />)
    await screen.findByTestId('setup-step-hostname')
    fireEvent.change(screen.getByLabelText('Name this machine'), { target: { value: 'acme-01' } })
    await act(async () => { next() })
    expect(await screen.findByTestId('setup-code-screen')).toBeTruthy()
    expect(onUnauthorized).toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Setup code'), { target: { value: 'ABCDEFGHJK' } })
    await act(async () => { fireEvent.click(screen.getByText('Continue')) })
    expect(client.login).toHaveBeenCalledWith('ABCDEFGHJK')
    await waitFor(() => expect(screen.getByTestId('setup-step-hostname')).toBeTruthy())
  })

  it('a 401 on the first load is the code screen, not a blank page', async () => {
    const { client } = makeClient({ setupSteps: vi.fn(async () => ({ state: 'error', status: 401 })) })
    render(<SetupWizard client={client} />)
    expect(await screen.findByTestId('setup-code-screen')).toBeTruthy()
  })

  it('finishes from the summary, and a finished box says so', async () => {
    const onFinished = vi.fn()
    const { client } = makeClient({
      setupSteps: vi.fn(async () => ({ state: 'ok', status: 200, data: { steps: [STEPS[5]] } })),
    })
    render(<SetupWizard client={client} onFinished={onFinished} />)
    await screen.findByTestId('setup-step-acme-open')
    await act(async () => { next() })
    await screen.findByTestId('setup-summary')
    await act(async () => { fireEvent.click(screen.getByTestId('setup-finish')) })
    expect(await screen.findByTestId('setup-complete')).toBeTruthy()
    expect(onFinished).toHaveBeenCalled()
  })

  it('an already-complete box (410) renders complete, not an error', async () => {
    const { client } = makeClient({ setupSteps: vi.fn(async () => ({ state: 'refused', status: 410 })) })
    render(<SetupWizard client={client} />)
    expect(await screen.findByTestId('setup-complete')).toBeTruthy()
  })

  it('bare-string options (the console SetupStep shape) render and apply as their value', async () => {
    const step = { id: 'channel', title: 'Update channel', why: 'how fast', kind: 'choice' as const,
      options: ['stable', 'beta'], current: 'stable' }
    const { client, applied } = makeClient({
      setupSteps: vi.fn(async () => ({ state: 'ok', status: 200, data: { steps: [step] } })),
    })
    render(<SetupWizard client={client} />)
    await screen.findByTestId('setup-step-channel')
    fireEvent.click(screen.getByLabelText('beta'))
    await act(async () => { next() })
    expect(applied).toContainEqual(['channel', 'beta'])
  })

  it('has no next/* import (Vite-safe appliance subpath)', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(resolve(__dirname, '../appliance/SetupWizard.tsx'), 'utf-8')
    expect(src).not.toMatch(/from ['"]next\//)
  })
})
