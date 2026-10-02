// @vitest-environment jsdom
/**
 * AgreementStep: the first-boot licence step. Rendered for real (react-dom in jsdom)
 * against a fake client that has the ApplianceClient.applySetupStep shape, with the step
 * shaped exactly as the wave-1 setup API serves it ({text, options[]}).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { AgreementStep } from '../appliance/AgreementStep'
import type { AgreementClient, AgreementResult, AgreementStepData } from '../appliance/AgreementStep'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SHA = 'b4a81029d3d8c5e91274be89c08047228b50e5ce9913449e173b1eadd05ebf13'
const TEXT = 'TERMS\nline two\n'

/** The fake digest: TEXT hashes to SHA, anything else to zeros. */
const digest = vi.fn(async (t: string) => (t === TEXT ? SHA : '0'.repeat(64)))

function step(over: Partial<AgreementStepData> = {}): AgreementStepData {
  return {
    id: 'eula',
    title: 'AcmeBot Appliance End User Licence Agreement',
    why: 'Accept the terms to start the product.',
    text: TEXT,
    options: [
      { value: `accept:${SHA}`, label: 'I accept AcmeBot EULA (version 0.1.0-draft)', detail: `sha256 ${SHA.slice(0, 12)}` },
      { value: 'decline', label: 'I do not accept' },
    ],
    ...over,
  }
}

function client(res: AgreementResult): AgreementClient & { applySetupStep: ReturnType<typeof vi.fn> } {
  return { applySetupStep: vi.fn(async () => res) }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null

async function render(el: JSX.Element) {
  await act(async () => {
    root.render(el)
  })
}

async function click(id: string) {
  await act(async () => {
    q(id)!.click()
  })
}

describe('AgreementStep', () => {
  it('shows the text, the version from the option label and a 12-char sha', async () => {
    await render(<AgreementStep step={step()} client={client({ state: 'ok', status: 200, data: { ok: true } })} digest={digest} />)
    expect(q('agreement-text')!.textContent).toContain('line two')
    expect(host.textContent).toContain('version 0.1.0-draft')
    expect(q('agreement-sha')!.textContent).toBe(`sha256 ${SHA.slice(0, 12)}`)
  })

  it('keeps Accept disabled until the checkbox is ticked', async () => {
    const c = client({ state: 'ok', status: 200, data: { ok: true } })
    await render(<AgreementStep step={step()} client={c} digest={digest} />)
    const accept = q('agreement-accept') as HTMLButtonElement
    expect(accept.disabled).toBe(true)
    await click('agreement-accept')
    expect(c.applySetupStep).not.toHaveBeenCalled()
    await click('agreement-check')
    expect((q('agreement-accept') as HTMLButtonElement).disabled).toBe(false)
  })

  it('posts the accept option value (exact sha) and calls onDone', async () => {
    const c = client({ state: 'ok', status: 200, data: { ok: true } })
    const onDone = vi.fn()
    await render(<AgreementStep step={step()} client={c} onDone={onDone} digest={digest} />)
    await click('agreement-check')
    await click('agreement-accept')
    expect(c.applySetupStep).toHaveBeenCalledTimes(1)
    expect(c.applySetupStep).toHaveBeenCalledWith('eula', `accept:${SHA}`)
    expect(onDone).toHaveBeenCalledWith('accepted')
    expect(q('agreement-accepted')).not.toBeNull()
  })

  it('refuses to offer Accept when the shown text does not hash to the offered sha', async () => {
    const c = client({ state: 'ok', status: 200, data: { ok: true } })
    await render(<AgreementStep step={step({ text: 'OTHER TERMS\n' })} client={c} digest={digest} />)
    expect(q('agreement-accept')).toBeNull()
    expect(q('agreement-missing')!.textContent).toContain('does not match')
  })

  it('shows the wave-1 409 {error} text when the sha was refused', async () => {
    const c = client({ state: 'refused', status: 409, data: { error: 'aither-eula: refused: sha is not the installed licence text' } })
    await render(<AgreementStep step={step()} client={c} digest={digest} />)
    await click('agreement-check')
    await click('agreement-accept')
    expect(q('agreement-error')!.textContent).toContain('not the installed licence text')
  })

  it('decline posts decline and leaves setup pending', async () => {
    const c = client({ state: 'refused', status: 409, data: { error: 'declined' } })
    const onDone = vi.fn()
    await render(<AgreementStep step={step()} client={c} onDone={onDone} digest={digest} />)
    await click('agreement-decline')
    expect(c.applySetupStep).toHaveBeenCalledWith('eula', 'decline')
    expect(onDone).not.toHaveBeenCalled()
    expect(q('agreement-declined')!.textContent).toContain('Setup stays pending')
    expect((q('agreement-accept') as HTMLButtonElement).disabled).toBe(true)
  })

  it('never offers Accept when the text or the accept option is missing or malformed', async () => {
    const c = client({ state: 'ok', status: 200, data: { ok: true } })
    await render(<AgreementStep step={step({ text: null })} client={c} digest={digest} />)
    expect(q('agreement-accept')).toBeNull()
    expect(q('agreement-missing')).not.toBeNull()
    await render(<AgreementStep step={step({ options: [{ value: 'accept:abc' }] })} client={c} digest={digest} />)
    expect(q('agreement-accept')).toBeNull()
  })

  it('reports an unreachable console instead of pretending success', async () => {
    const c = client({ state: 'unavailable', status: 0, data: null })
    const onDone = vi.fn()
    await render(<AgreementStep step={step()} client={c} onDone={onDone} digest={digest} />)
    await click('agreement-check')
    await click('agreement-accept')
    expect(q('agreement-error')).not.toBeNull()
    expect(onDone).not.toHaveBeenCalled()
  })
})
