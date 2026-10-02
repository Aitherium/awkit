/**
 * ClassroomAiPanel ("AI your way"): where one class's AI runs.
 *
 *  - renders in dark AND light with every Learn token on its root, from the SERVER's
 *    option copy, and says what is on record and whether it is ready;
 *  - an outside provider cannot be saved without who approved, their role and the day;
 *    the PUT body carries the approval and never a key;
 *  - a key goes ONCE to the existing tenant key endpoint, leaves the page when stored,
 *    and only "ending in <last four>" is ever displayed;
 *  - the connection test runs the choice on record (disabled while there are unsaved
 *    changes) and repeats the server's plain reason when it is not available;
 *  - offline / not-found / read-only (co-teacher) states are real states, not a form;
 *  - the private-cloud option links the existing self-host docs;
 *  - the file paints only through the tokens, states no price, and is an explicit
 *    awkit export (src and dist).
 */
import React from 'react'
import fs from 'fs'
import path from 'path'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ClassroomAiPanel, { AI_HEADING, bodyOf, nowLine, todayUtc, type AiView } from '../panels/ClassroomAiPanel'
import { LEARN_MODE_KEY, LEARN_TOKENS, LEARN_TOKEN_KEYS, learnVarName } from '../panels/learnTheme'

type Reply = { status: number; body: unknown }
type Call = { url: string; init?: RequestInit }

function installFetch(route: (url: string, init?: RequestInit) => Reply | undefined): Call[] {
  const calls: Call[] = []
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const r = route(url, init) ?? { status: 404, body: { detail: 'Not found' } }
    return { status: r.status, ok: r.status >= 200 && r.status < 300, statusText: '', json: async () => r.body } as unknown as Response
  })
  return calls
}

const GUARD = 'Before anything leaves this classroom, every student alias, account id, email and phone number is replaced.'
const OPTIONS = [
  { mode: 'device', title: 'On the server this classroom runs on', where: 'No outside AI provider. A model on the server that hosts this classroom answers.', student_data: 'This class sends nothing to an outside AI provider.', providers: [], needs_approval: false },
  { mode: 'school_key', title: 'Your school’s own OpenAI or Claude account', where: 'Requests go to that provider under your school’s key and its terms.', student_data: GUARD, providers: ['openai', 'anthropic'], needs_approval: true },
  { mode: 'open_api', title: 'Another open-model API', where: 'OpenRouter, DeepSeek, or any OpenAI-compatible endpoint your school names.', student_data: GUARD, providers: ['openrouter', 'deepseek', 'custom'], needs_approval: true },
  { mode: 'private_cloud', title: 'Your school’s private AI cloud', where: 'An AitherOS your school runs itself.', student_data: GUARD, providers: ['custom'], needs_approval: true },
]
const KEYS = [
  { provider: 'anthropic', label: 'Claude (Anthropic)', key_set: false, key_last4: '' },
  { provider: 'custom', label: 'OpenAI-compatible endpoint', key_set: false, key_last4: '' },
  { provider: 'deepseek', label: 'DeepSeek', key_set: false, key_last4: '' },
  { provider: 'openai', label: 'OpenAI', key_set: true, key_last4: '7f3Q' },
  { provider: 'openrouter', label: 'OpenRouter', key_set: false, key_last4: '' },
]
const DEVICE_CHOICE = {
  class_id: 'cls_1', configured: false, mode: 'device', provider: '', provider_label: '', base_url: '', endpoint_host: '', model: '',
  share_notes: false, approval: null, recorded_at: null, student_data: 'stays_here',
}
const APPROVAL = { approved_by: 'Dana Okafor', approved_role: 'IT director', approved_on: '2026-09-30' }
const OPENAI_CHOICE = {
  ...DEVICE_CHOICE, configured: true, mode: 'school_key', provider: 'openai', provider_label: 'OpenAI', endpoint_host: 'api.openai.com',
  approval: APPROVAL, recorded_at: '2026-10-01T14:00:00+00:00', student_data: 'deidentified',
}
const view = (over: Partial<AiView> = {}): AiView => ({
  class_id: 'cls_1', choice: DEVICE_CHOICE, options: OPTIONS, providers: KEYS, status: { ready: true, code: '', detail: '' },
  can_edit: true, self_host_docs: '/docs/awnix', unavailable_message: 'this class’s AI choice is not available yet', ...over,
} as AiView)

const AI = '/api/classroom/classes/cls_1/ai'
const SECRET = 'made-up-test-value-9zzz'

function expectThemed(mode: 'dark' | 'light') {
  const root = screen.getByTestId('classroom-ai')
  expect(root.getAttribute('data-learn-theme')).toBe(mode)
  for (const k of LEARN_TOKEN_KEYS) expect(root.style.getPropertyValue(learnVarName(k))).toBe(LEARN_TOKENS[mode][k])
}

/** Wait for the element OUTSIDE act (a findBy inside act never settles), then click it. */
async function clickWhenThere(testId: string) {
  const el = await screen.findByTestId(testId)
  await act(async () => { fireEvent.click(el) })
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

afterEach(() => { window.localStorage.removeItem(LEARN_MODE_KEY) })

describe.each(['dark', 'light'] as const)('ClassroomAiPanel in %s', (mode) => {
  beforeEach(() => { window.localStorage.setItem(LEARN_MODE_KEY, mode) })

  it('shows the four options from the server and what is on record', async () => {
    installFetch((url) => (url === AI ? { status: 200, body: view() } : undefined))
    render(<ClassroomAiPanel classId="cls_1" className="Room 4" />)
    await screen.findByTestId('ai-option-device')
    expectThemed(mode)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(AI_HEADING)
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect(screen.getByTestId('ai-option-device').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('ai-option-device').textContent).toMatch(/01 · default · on record.*student data · stays here/)
    expect(screen.getByTestId('ai-option-school_key').textContent).toContain(GUARD)
    expect(screen.getByTestId('ai-now').textContent).toMatch(/now · on the server this classroom runs on.*· ready/)
    // The default is already on record: nothing to save, no approval asked for.
    expect((screen.getByTestId('ai-save') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByLabelText('Approved by')).toBeNull()
    expect(screen.getByTestId('classroom-ai').textContent).not.toMatch(/\bfree\b|\bprice|\$|per month|unlimited/i)
    // The default runs on the server: the page never says it runs on a teacher's machine.
    expect(screen.getByTestId('classroom-ai').textContent).not.toMatch(/teacher’s (own )?device|your own computer|teacher agent/i)
    expect(screen.queryByTestId('ai-needs-admin')).toBeNull()
  })

  it('an account that may not manage keys keeps the server choice and is told who can change it', async () => {
    installFetch((url) => (url === AI ? { status: 200, body: view({ can_choose_outside: false } as Partial<AiView>) } : undefined))
    render(<ClassroomAiPanel classId="cls_1" />)
    expect((await screen.findByTestId('ai-needs-admin')).textContent).toMatch(/Ask a workspace admin/)
    expect((screen.getByTestId('ai-option-device') as HTMLButtonElement).disabled).toBe(false)
    for (const m of ['school_key', 'open_api', 'private_cloud']) {
      expect((screen.getByTestId(`ai-option-${m}`) as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('says where a stored key lives: this server’s vault, not one the school runs', async () => {
    installFetch((url) => (url === AI ? { status: 200, body: view() } : undefined))
    render(<ClassroomAiPanel classId="cls_1" />)
    await clickWhenThere('ai-option-school_key')
    const text = screen.getByTestId('classroom-ai').textContent ?? ''
    expect(text).toContain('Stored in this server’s secrets vault under your workspace and never shown again.')
    expect(text).not.toMatch(/your school’s vault/)
  })

  it('an outside provider needs the approval, and the saved body never carries a key', async () => {
    const calls = installFetch((url, init) => {
      if (url === AI && init?.method === 'PUT') return { status: 200, body: view({ choice: OPENAI_CHOICE } as Partial<AiView>) }
      if (url === AI) return { status: 200, body: view() }
      return undefined
    })
    render(<ClassroomAiPanel classId="cls_1" />)
    await clickWhenThere('ai-option-school_key')
    const save = screen.getByTestId('ai-save') as HTMLButtonElement
    expect(screen.getByTestId('ai-dirty').textContent).toBe('not saved yet')
    expect(save.disabled).toBe(true) // no approval yet
    expect((screen.getByTestId('ai-test') as HTMLButtonElement).disabled).toBe(true) // unsaved changes
    expect(screen.getByTestId('ai-key-status').textContent).toBe('OpenAI: a key is stored, ending in 7f3Q.')

    fill('Approved by', 'Dana Okafor')
    expect(save.disabled).toBe(true)
    fill('Their role', 'IT director')
    fill('Approved on', '2026-09-30')
    expect(save.disabled).toBe(false)
    await act(async () => { fireEvent.click(save) })

    const put = calls.find((c) => c.init?.method === 'PUT')
    expect(put?.url).toBe(AI)
    expect(JSON.parse(String(put?.init?.body))).toEqual({ mode: 'school_key', provider: 'openai', share_notes: false, approval: APPROVAL })
    await screen.findByTestId('ai-saved')
    expect(screen.getByTestId('ai-on-record').textContent).toMatch(/OpenAI at api\.openai\.com\. Approved by Dana Okafor \(IT director\) on 2026-09-30\..*Adult notes are not sent\./)
    expect(screen.getByTestId('ai-now').textContent).toMatch(/now · OpenAI · api\.openai\.com · key ····7f3Q/)
    expect(screen.queryByTestId('ai-dirty')).toBeNull()
  })

  it('repeats the server’s refusal and changes nothing', async () => {
    installFetch((url, init) => {
      if (url === AI && init?.method === 'PUT') return { status: 422, body: { detail: 'approval day: not in the future' } }
      if (url === AI) return { status: 200, body: view() }
      return undefined
    })
    render(<ClassroomAiPanel classId="cls_1" />)
    await clickWhenThere('ai-option-school_key')
    fill('Approved by', 'Dana Okafor')
    fill('Their role', 'IT director')
    await act(async () => { fireEvent.click(screen.getByTestId('ai-save')) })
    expect((await screen.findByTestId('ai-save-error')).textContent).toBe('approval day: not in the future')
    expect(screen.getByTestId('ai-option-device').textContent).toContain('on record')
  })

  it('stores a key once through the tenant key endpoint and never shows it again', async () => {
    let stored = false
    const calls = installFetch((url, init) => {
      if (url === '/keys/key' && init?.method === 'POST') { stored = true; return { status: 200, body: { success: true } } }
      if (url === AI) {
        const keys = KEYS.map((k) => (k.provider === 'anthropic' && stored ? { ...k, key_set: true, key_last4: '9zzz' } : k))
        return { status: 200, body: view({ providers: keys }) }
      }
      return undefined
    })
    render(<ClassroomAiPanel classId="cls_1" keysBase="/keys" extraHeaders={{ Authorization: 'Bearer tok' }} />)
    await clickWhenThere('ai-option-school_key')
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Claude (Anthropic)' })) })
    expect(screen.getByTestId('ai-key-status').textContent).toBe('Claude (Anthropic): no key is stored yet.')
    const input = screen.getByTestId('ai-key-input') as HTMLInputElement
    expect(input.type).toBe('password')
    fireEvent.change(input, { target: { value: SECRET } })
    await act(async () => { fireEvent.click(screen.getByTestId('ai-key-store')) })

    const post = calls.find((c) => c.url === '/keys/key')
    expect(JSON.parse(String(post?.init?.body))).toEqual({ provider: 'anthropic', value: SECRET, scope: 'tenant' })
    expect((post?.init?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    await waitFor(() => expect(screen.getByTestId('ai-key-status').textContent).toBe('Claude (Anthropic): a key is stored, ending in 9zzz.'))
    expect(input.value).toBe('')
    expect(document.body.innerHTML).not.toContain(SECRET)
    // The key went to the key endpoint and nowhere else.
    for (const c of calls) if (c.url !== '/keys/key') expect(String(c.init?.body ?? '')).not.toContain(SECRET)
    // The unsaved choice survived the reload.
    expect(screen.getByTestId('ai-option-school_key').getAttribute('aria-checked')).toBe('true')
  })

  it('says so when this account may not store a key', async () => {
    installFetch((url, init) => {
      if (url.endsWith('/key') && init?.method === 'POST') return { status: 403, body: { detail: 'Insufficient permissions' } }
      if (url === AI) return { status: 200, body: view() }
      return undefined
    })
    render(<ClassroomAiPanel classId="cls_1" />)
    await clickWhenThere('ai-option-school_key')
    fireEvent.change(screen.getByTestId('ai-key-input'), { target: { value: SECRET } })
    await act(async () => { fireEvent.click(screen.getByTestId('ai-key-store')) })
    expect((await screen.findByTestId('ai-key-error')).textContent).toMatch(/Ask a workspace admin/)
  })

  it('tests the choice on record and repeats why it is not available', async () => {
    let ok = true
    const calls = installFetch((url, init) => {
      if (url === `${AI}/test` && init?.method === 'POST') {
        return { status: 200, body: ok
          ? { ok: true, mode: 'school_key', provider: 'openai', model: 'gpt-4o', latency_ms: 420, code: '', detail: 'answered' }
          : { ok: false, mode: 'school_key', provider: 'openai', model: '', latency_ms: null, code: 'no_key', detail: 'no key is stored for this provider yet' } }
      }
      if (url === AI) return { status: 200, body: view({ choice: OPENAI_CHOICE } as Partial<AiView>) }
      return undefined
    })
    render(<ClassroomAiPanel classId="cls_1" />)
    await clickWhenThere('ai-test')
    expect((await screen.findByTestId('ai-test-result')).textContent).toBe('answered · openai · gpt-4o · 420 ms')
    expect(calls.filter((c) => c.url === `${AI}/test`)).toHaveLength(1)
    ok = false
    await act(async () => { fireEvent.click(screen.getByTestId('ai-test')) })
    await waitFor(() => expect(screen.getByTestId('ai-test-result').textContent).toBe('not available yet · no key is stored for this provider yet'))
  })

  it('shows a class that is not ready as not available yet, never as working', async () => {
    installFetch((url) => (url === AI
      ? { status: 200, body: view({ choice: OPENAI_CHOICE, status: { ready: false, code: 'no_key', detail: 'no key is stored for this provider yet' } } as Partial<AiView>) }
      : undefined))
    render(<ClassroomAiPanel classId="cls_1" />)
    expect((await screen.findByTestId('ai-ready')).textContent).toBe('· not available yet: no key is stored for this provider yet')
  })

  it('a co-teacher reads it and cannot change it', async () => {
    installFetch((url) => (url === AI ? { status: 200, body: view({ choice: OPENAI_CHOICE, can_edit: false } as Partial<AiView>) } : undefined))
    render(<ClassroomAiPanel classId="cls_1" />)
    expect((await screen.findByTestId('ai-read-only')).textContent).toMatch(/Only the teacher of record/)
    for (const r of screen.getAllByRole('radio')) expect((r as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('ai-save') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Approved by') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByTestId('ai-test') as HTMLButtonElement).disabled).toBe(false)
  })

  it('the private cloud asks for the school’s endpoint and links the self-host docs', async () => {
    const calls = installFetch((url, init) => {
      if (url === AI && init?.method === 'PUT') return { status: 200, body: view() }
      if (url === AI) return { status: 200, body: view() }
      return undefined
    })
    render(<ClassroomAiPanel classId="cls_1" />)
    await clickWhenThere('ai-option-private_cloud')
    expect(screen.getByTestId('ai-self-host').getAttribute('href')).toBe('/docs/awnix')
    fill('Approved by', 'Dana Okafor')
    fill('Their role', 'IT director')
    const save = screen.getByTestId('ai-save') as HTMLButtonElement
    expect(save.disabled).toBe(true) // no endpoint
    fill('Endpoint address', 'http://ai.school.example/v1')
    expect(save.disabled).toBe(true) // not https
    fill('Endpoint address', 'https://ai.school.example/v1')
    expect(save.disabled).toBe(false)
    await act(async () => { fireEvent.click(save) })
    const body = JSON.parse(String(calls.find((c) => c.init?.method === 'PUT')?.init?.body))
    expect(body).toMatchObject({ mode: 'private_cloud', provider: 'custom', base_url: 'https://ai.school.example/v1' })
  })

  it('offline is a dim state with a retry, and nothing is invented', async () => {
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => { throw new TypeError('Failed to fetch') })
    render(<ClassroomAiPanel classId="cls_1" />)
    expect((await screen.findByTestId('classroom-offline')).textContent).toMatch(/could not be reached/)
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    installFetch((url) => (url === AI ? { status: 200, body: view() } : undefined))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    expect(await screen.findByTestId('ai-option-device')).toBeTruthy()
  })

  it('a class that is not yours is "not found", not an empty form', async () => {
    installFetch(() => ({ status: 404, body: { detail: 'Not found' } }))
    render(<ClassroomAiPanel classId="cls_x" />)
    expect((await screen.findByTestId('classroom-ai-missing')).textContent).toMatch(/not yours to set up/)
    expect(screen.queryByTestId('ai-save')).toBeNull()
  })
})

describe('helpers', () => {
  it('bodyOf sends only what the mode needs', () => {
    const base = { provider: 'openai', baseUrl: 'https://x.example', model: ' gpt-4o ', shareNotes: true, approvedBy: ' Dana ', approvedRole: 'Head', approvedOn: '2026-09-30' }
    expect(bodyOf({ ...base, mode: 'device' })).toEqual({ mode: 'device' })
    expect(bodyOf({ ...base, mode: 'school_key' })).toEqual({
      mode: 'school_key', provider: 'openai', share_notes: true, model: 'gpt-4o',
      approval: { approved_by: 'Dana', approved_role: 'Head', approved_on: '2026-09-30' },
    })
    expect(bodyOf({ ...base, mode: 'open_api', provider: 'custom' }).base_url).toBe('https://x.example')
  })

  it('nowLine never claims a key that is not stored', () => {
    expect(nowLine(view({ choice: { ...OPENAI_CHOICE, provider: 'anthropic', provider_label: 'Claude (Anthropic)', endpoint_host: 'api.anthropic.com' } } as Partial<AiView>)))
      .toBe('now · Claude (Anthropic) · api.anthropic.com · no key yet')
    expect(todayUtc(new Date('2026-10-01T23:30:00Z'))).toBe('2026-10-01')
  })
})

describe('source rules', () => {
  const FILE = path.join(__dirname, '..', 'panels', 'ClassroomAiPanel.tsx')
  const src = fs.readFileSync(FILE, 'utf8')

  it('paints only through the Learn tokens (no hex / rgb literal)', () => {
    const offenders: string[] = []
    src.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
      if (/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(line)) offenders.push(`${i + 1}: ${line.trim()}`)
    })
    expect(offenders).toEqual([])
  })

  it('states no price, no free tier and no hosted-capacity promise', () => {
    expect(/\bfree\b|\bpric(e|ing)\b|\$\d|per month|unlimited|we host|hosted by/i.exec(src)?.[0] ?? null).toBeNull()
  })

  it('is an explicit awkit export (src and dist) and in the panels index', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'))
    const srcExp = pkg.exports['./panels/ClassroomAiPanel']
    const dist = pkg.publishConfig.exports['./panels/ClassroomAiPanel']
    expect(srcExp.import).toBe('./src/panels/ClassroomAiPanel.tsx')
    expect(srcExp.types).toBe(srcExp.import)
    expect(dist.import).toBe('./dist/panels/ClassroomAiPanel.js')
    const index = fs.readFileSync(path.join(__dirname, '..', 'panels', 'index.ts'), 'utf8')
    expect(index).toContain("export { default as ClassroomAiPanel } from './ClassroomAiPanel'")
  })
})
