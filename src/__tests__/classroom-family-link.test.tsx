/**
 * ClassroomFamilyLinkPanel (awkit): a child who already learns at home joins a class.
 *
 * Guardian: the empty state has ONE primary action; the join flow sends the code,
 * shows the class and what is shared BEFORE anything is redeemed, and cannot be
 * submitted without a child and the guardian's agreement; the server's refusals
 * are repeated in plain words and nothing is faked when it is unreachable; a
 * joined class shows what the class sees (an untouched area is "no practice yet",
 * never 0%) and "Stop sharing" asks first. Teacher: a code is shown once, open
 * codes never carry the code, a seat opens its summary. Both render in dark AND
 * light on the Learn tokens only.
 */
import React from 'react'
import fs from 'fs'
import path from 'path'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ClassroomFamilyLinkPanel, {
  ClassroomFamilySeatsPanel, SharedSummary, codeProblem, formatFamilyCode, isCompleteFamilyCode,
} from '../panels/ClassroomFamilyLinkPanel'
import { ClassroomHttpError } from '../panels/classroomApi'
import { LEARN_MODE_KEY, LEARN_TOKENS, LEARN_TOKEN_KEYS, learnVarName } from '../panels/learnTheme'

type Reply = { status: number; body: unknown }
type Call = { url: string; init?: RequestInit }
type Route = (url: string, init?: RequestInit) => Reply | undefined

function installFetch(route: Route): Call[] {
  const calls: Call[] = []
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const r = route(url, init) ?? { status: 404, body: { detail: 'Not found' } }
    return { status: r.status, ok: r.status >= 200 && r.status < 300, statusText: '', json: async () => r.body } as unknown as Response
  })
  return calls
}

function rejectFetch(): void {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => { throw new TypeError('Failed to fetch') })
}

const ok = (body: unknown): Reply => ({ status: 200, body })

const TERMS = {
  version: 'family-link-2026-10b',
  shared: [
    { key: 'area_mastery', title: 'How secure each area is', text: 'One number per area.' },
    { key: 'hard_now', title: 'What is hard right now', text: 'Per skill, over two weeks.' },
    { key: 'assigned_work', title: 'Work the teacher assigned', text: 'Opened and finished.' },
    { key: 'feel_ratings', title: 'How it felt', text: 'Easy, ok or hard.' },
  ],
  never_shared: ['What your child typed or said to the tutor, and what the tutor said back.', 'Their Sprite, its memory and anything they told it.'],
  comes_home: ['Skills the teacher assigns show up in the quests at home.'],
  control: 'You can stop sharing at any time.',
}
const CLASS = { class_id: 'cls_1', name: 'Room 4', subject: 'Reading', grade_level: 'K-2' }
const LINK = { link_id: 'fln_1', learner_id: 'lrn_a', alias: 'Athena', class: CLASS, linked_at: '2026-10-01T14:00:00+00:00', shares: TERMS.shared.map((s) => s.key) }
const SUMMARY = {
  member: { member_id: 'mbr_1', alias: 'Athena' }, class_id: 'cls_1', linked_at: LINK.linked_at, summary_at: '2026-10-01T15:00:00+00:00',
  fresh: true, window_days: 14,
  areas: { reading: { mastery: 0.62, skills: 3, secure: 1 }, math: { mastery: null, skills: 0, secure: 0 } },
  standards: { 'RF.1.3': 0.7, 'RF.K.3': 0.55 },
  hard_now: [{ skill_id: 'read.phx.letter_sounds', title: 'I know letter sounds!', area: 'reading', attempts: 6, error_rate: 0.5, hints_per_attempt: 1, median_latency_s: 4 }],
  practice: { attempts: 6, days: 1 },
  assigned_work: { assigned: 3, opened: 2, done: 1 },
  feel: { easy: 2, ok: 1, hard: 1, hard_flags: 1, window_days: 14 },
}
const LEARNERS = [
  { lid: 'lrn_a', alias: 'Athena', guardian_role: 'primary' },
  { lid: 'lrn_b', alias: 'Alexander', guardian_role: 'primary' },
  { lid: 'lrn_c', alias: 'Cousin', guardian_role: 'co' },
]

function expectThemed(testId: string, mode: 'dark' | 'light') {
  const root = screen.getByTestId(testId)
  expect(root.getAttribute('data-learn-theme')).toBe(mode)
  for (const k of LEARN_TOKEN_KEYS) expect(root.style.getPropertyValue(learnVarName(k))).toBe(LEARN_TOKENS[mode][k])
}

async function openJoin() {
  const start = await screen.findByTestId('family-start')
  await act(async () => { fireEvent.click(start) })
}

async function typeCode(value: string) {
  fireEvent.change(screen.getByLabelText('Family code'), { target: { value } })
  await act(async () => { fireEvent.click(screen.getByTestId('family-find')) })
}

afterEach(() => { window.localStorage.removeItem(LEARN_MODE_KEY) })

describe('pure helpers', () => {
  it('groups a typed code and knows when it is complete', () => {
    expect(formatFamilyCode('abcd efgh 2345')).toBe('ABCD-EFGH-2345')
    expect(formatFamilyCode('ab-cd1890!e')).toBe('ABCD-E') // 0, 1, 8, 9 are not base32
    expect(isCompleteFamilyCode('ABCD-EFGH-2345')).toBe(true)
    expect(isCompleteFamilyCode('ABCD-EFGH')).toBe(false)
  })

  it('says a refusal in plain words and never claims success', () => {
    expect(codeProblem(new ClassroomHttpError(404, 'x'))).toMatch(/not found/)
    expect(codeProblem(new ClassroomHttpError(410, 'x'))).toMatch(/already used or has expired/)
    expect(codeProblem(new ClassroomHttpError(429, 'x'))).toMatch(/Too many tries/)
    expect(codeProblem(new ClassroomHttpError(409, 'This child is already in that class.'))).toBe('This child is already in that class.')
    expect(codeProblem(new TypeError('Failed to fetch'))).toMatch(/Nothing was shared/)
  })
})

describe.each(['dark', 'light'] as const)('guardian panel in %s', (mode) => {
  beforeEach(() => { window.localStorage.setItem(LEARN_MODE_KEY, mode) })

  it('empty: one primary action and no fake rows', async () => {
    installFetch((url) => (url === '/api/classroom/family/links' ? ok({ links: [], terms: TERMS }) : undefined))
    render(<ClassroomFamilyLinkPanel />)
    await screen.findByTestId('family-empty')
    expectThemed('classroom-family-link', mode)
    expect(screen.getAllByTestId('family-start')).toHaveLength(1)
    expect(screen.queryByTestId('family-link')).toBeNull()
  })

  it('the join flow: code -> the class and what is shared -> agreed -> joined', async () => {
    let links: unknown[] = []
    const calls = installFetch((url, init) => {
      if (url === '/api/classroom/family/links') return ok({ links, terms: TERMS })
      if (url === '/api/classroom/family/preview') return ok({ class: CLASS, seat_label: 'Athena', ready: true, terms: TERMS })
      if (url === '/api/tutor/family/learners') return ok(LEARNERS)
      if (url === '/api/classroom/family/redeem' && init?.method === 'POST') { links = [LINK]; return { status: 201, body: { linked: true, link: LINK } } }
      return undefined
    })
    const onChanged = jest.fn()
    render(<ClassroomFamilyLinkPanel onChanged={onChanged} />)
    await openJoin()
    expect((screen.getByTestId('family-find') as HTMLButtonElement).disabled).toBe(true)
    await typeCode('abcd efgh 2345')
    await screen.findByTestId('family-step-consent')
    expect(JSON.parse(String(calls.find((c) => c.url.endsWith('/family/preview'))?.init?.body))).toEqual({ code: 'ABCD-EFGH-2345' })

    // The class and the terms are on screen before anything is redeemed.
    expect(screen.getByRole('heading', { name: 'Room 4' })).toBeTruthy()
    const terms = screen.getByTestId('family-terms').textContent || ''
    for (const t of TERMS.shared) expect(terms).toContain(t.title)
    expect(terms).toMatch(/Their Sprite, its memory/)
    // What travels the other way is said too, before anything is agreed.
    expect(screen.getByTestId('family-comes-home').textContent).toMatch(/quests at home/)
    // Only children the caller is the guardian of record of.
    await screen.findByLabelText('Athena')
    expect(screen.queryByLabelText('Cousin')).toBeNull()

    const join = screen.getByTestId('family-join') as HTMLButtonElement
    expect(join.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Athena'))
    expect(join.disabled).toBe(true) // a child alone is not consent
    fireEvent.click(screen.getByLabelText('I agree to share these summaries'))
    expect(join.disabled).toBe(false)
    expect(calls.some((c) => c.url.endsWith('/family/redeem'))).toBe(false)

    await act(async () => { fireEvent.click(join) })
    await screen.findByTestId('family-step-done')
    const sent = JSON.parse(String(calls.find((c) => c.url.endsWith('/family/redeem'))?.init?.body))
    expect(sent).toEqual({ code: 'ABCD-EFGH-2345', learner_id: 'lrn_a', agree: true, terms_version: TERMS.version })
    expect(screen.getByTestId('family-step-done').textContent).toMatch(/Athena is in Room 4/)
    expect(onChanged).toHaveBeenCalledTimes(1)
    await act(async () => { fireEvent.click(screen.getByTestId('family-done')) })
    await screen.findByTestId('family-link')
    expect(screen.queryByTestId('family-join-sheet')).toBeNull()
  })

  it('a joined class: what the class sees, then stop sharing asks first', async () => {
    let links: unknown[] = [LINK]
    const calls = installFetch((url, init) => {
      if (url === '/api/classroom/family/links' && (!init?.method || init.method === 'GET')) return ok({ links, terms: TERMS })
      if (url === '/api/classroom/family/links/fln_1/shared') return ok(SUMMARY)
      if (url === '/api/classroom/family/links/fln_1' && init?.method === 'DELETE') { links = []; return ok({ unlinked: true }) }
      return undefined
    })
    render(<ClassroomFamilyLinkPanel />)
    const card = await screen.findByTestId('family-link')
    expectThemed('classroom-family-link', mode)
    expect(card.textContent).toMatch(/Athena · Room 4/)
    expect(card.textContent).toMatch(/sharing/)

    await act(async () => { fireEvent.click(screen.getByTestId('family-look')) })
    const shared = (await screen.findByTestId('family-shared')).textContent || ''
    expect(shared).toMatch(/62% secure/)
    expect(shared).toMatch(/no practice yet/)
    expect(shared).not.toMatch(/\b0%/)
    expect(screen.getAllByRole('progressbar')).toHaveLength(1)
    // Every number the class holds is drawn: hints, answer time, practice, standards.
    expect(screen.getByTestId('family-hard-row').textContent).toMatch(/I know letter sounds!.*6 tries · 3 not yet right · 1 hint a try · 4s an answer/)
    expect(screen.getByTestId('family-practice').textContent).toBe('6 tries on 1 day')
    expect(screen.getByTestId('family-standards').textContent).toMatch(/by standard · 2.*RF\.1\.3 70%.*RF\.K\.3 55%/)
    expect(screen.getByTestId('family-assigned').textContent).toBe('1 of 3 finished')
    expect(screen.getByTestId('family-feel').textContent).toBe('easy 2 · ok 1 · hard 1')
    expect(screen.getByTestId('family-shared-source').textContent).toMatch(/an observation, not a grade/)

    await act(async () => { fireEvent.click(screen.getByTestId('family-stop')) })
    expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(false) // asked first
    expect(screen.getByTestId('family-stop-confirm').textContent).toMatch(/nothing more is sent/)
    await act(async () => { fireEvent.click(screen.getByTestId('family-stop-yes')) })
    await screen.findByTestId('family-empty')
    expect(calls.some((c) => c.url === '/api/classroom/family/links/fln_1' && c.init?.method === 'DELETE')).toBe(true)
  })
})

describe('refusals and unreachable services', () => {
  it.each([
    [404, /not found/],
    [410, /already used or has expired/],
    [429, /Too many tries/],
  ])('a %s on the code stays on step 1 and says why', async (status, words) => {
    installFetch((url) => {
      if (url === '/api/classroom/family/links') return ok({ links: [], terms: TERMS })
      if (url === '/api/classroom/family/preview') return { status: status as number, body: { detail: 'x' } }
      return undefined
    })
    render(<ClassroomFamilyLinkPanel />)
    await openJoin()
    await typeCode('ABCDEFGH2345')
    expect((await screen.findByTestId('family-error')).textContent).toMatch(words as RegExp)
    expect(screen.getByTestId('family-step-code')).toBeTruthy()
    expect(screen.queryByTestId('family-step-consent')).toBeNull()
  })

  it('a class that is not ready cannot be joined', async () => {
    installFetch((url) => {
      if (url === '/api/classroom/family/links') return ok({ links: [], terms: TERMS })
      if (url === '/api/classroom/family/preview') return ok({ class: CLASS, ready: false, terms: TERMS })
      if (url === '/api/tutor/family/learners') return ok(LEARNERS)
      return undefined
    })
    render(<ClassroomFamilyLinkPanel />)
    await openJoin()
    await typeCode('ABCDEFGH2345')
    await screen.findByTestId('family-not-ready')
    fireEvent.click(await screen.findByLabelText('Athena'))
    fireEvent.click(screen.getByLabelText('I agree to share these summaries'))
    expect((screen.getByTestId('family-join') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a child already in that class cannot be picked again', async () => {
    installFetch((url) => {
      if (url === '/api/classroom/family/links') return ok({ links: [LINK], terms: TERMS })
      if (url === '/api/classroom/family/preview') return ok({ class: CLASS, ready: true, terms: TERMS })
      if (url === '/api/tutor/family/learners') return ok(LEARNERS)
      return undefined
    })
    render(<ClassroomFamilyLinkPanel />)
    await openJoin()
    await typeCode('ABCDEFGH2345')
    expect(((await screen.findByLabelText(/Athena/)) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Alexander') as HTMLInputElement).disabled).toBe(false)
  })

  it('a failed redeem says nothing was shared and stays on the consent step', async () => {
    installFetch((url) => {
      if (url === '/api/classroom/family/links') return ok({ links: [], terms: TERMS })
      if (url === '/api/classroom/family/preview') return ok({ class: CLASS, ready: true, terms: TERMS })
      if (url === '/api/tutor/family/learners') return ok(LEARNERS)
      if (url === '/api/classroom/family/redeem') return { status: 502, body: { detail: 'bad gateway' } }
      return undefined
    })
    render(<ClassroomFamilyLinkPanel />)
    await openJoin()
    await typeCode('ABCDEFGH2345')
    fireEvent.click(await screen.findByLabelText('Athena'))
    fireEvent.click(screen.getByLabelText('I agree to share these summaries'))
    await act(async () => { fireEvent.click(screen.getByTestId('family-join')) })
    expect((await screen.findByTestId('family-error')).textContent).toMatch(/Nothing was shared/)
    expect(screen.queryByTestId('family-step-done')).toBeNull()
  })

  it('offline: a dim state with a retry, never an empty "no class yet"', async () => {
    rejectFetch()
    render(<ClassroomFamilyLinkPanel />)
    expect((await screen.findByTestId('family-link-offline')).textContent).toMatch(/offline/)
    expect(screen.queryByTestId('family-empty')).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('a stop that fails says sharing is still on', async () => {
    installFetch((url, init) => {
      if (url === '/api/classroom/family/links' && init?.method !== 'DELETE') return ok({ links: [LINK], terms: TERMS })
      return { status: 503, body: { detail: 'down' } }
    })
    render(<ClassroomFamilyLinkPanel />)
    const stop = await screen.findByTestId('family-stop')
    await act(async () => { fireEvent.click(stop) })
    await act(async () => { fireEvent.click(screen.getByTestId('family-stop-yes')) })
    expect(screen.getByTestId('family-stop-confirm').textContent).toMatch(/It is still on/)
    expect(screen.getByTestId('family-link')).toBeTruthy()
  })

  it('a stale summary says so instead of looking current', () => {
    render(<SharedSummary summary={{ ...SUMMARY, fresh: false }} />)
    expect(screen.getByTestId('family-shared-source').textContent).toMatch(/home could not be reached/)
  })
})

describe.each(['dark', 'light'] as const)('teacher seats panel in %s', (mode) => {
  beforeEach(() => { window.localStorage.setItem(LEARN_MODE_KEY, mode) })

  it('makes a code shown once, lists open codes without the code, opens a seat summary', async () => {
    let open: unknown[] = []
    const calls = installFetch((url, init) => {
      if (url === '/api/classroom/classes/cls_1/family-links') return ok({ class_id: 'cls_1', open_codes: open, seats: [{ member_id: 'mbr_1', alias: 'Athena', linked_at: LINK.linked_at }], terms: TERMS })
      if (url === '/api/classroom/classes/cls_1/family-codes' && init?.method === 'POST') {
        open = [{ code_id: 'fcd_1', label: 'Ben', expires_at: '2026-10-15T14:00:00+00:00' }]
        return { status: 201, body: { code: 'ABCD-EFGH-2345', code_id: 'fcd_1', label: 'Ben' } }
      }
      if (url === '/api/classroom/classes/cls_1/family-links/mbr_1/summary') return ok(SUMMARY)
      return undefined
    })
    render(<ClassroomFamilySeatsPanel classId="cls_1" />)
    await screen.findByTestId('family-seat')
    expectThemed('classroom-family-seats', mode)
    fireEvent.change(screen.getByLabelText('Seat for'), { target: { value: 'Ben' } })
    await act(async () => { fireEvent.click(screen.getByTestId('family-issue')) })
    expect((await screen.findByTestId('family-fresh-code')).textContent).toMatch(/shown once.*ABCD-EFGH-2345/)
    expect(JSON.parse(String(calls.find((c) => c.init?.method === 'POST')?.init?.body))).toEqual({ label: 'Ben' })
    const row = await screen.findByTestId('family-open-code')
    expect(row.textContent).toMatch(/Ben/)
    expect(row.textContent).not.toMatch(/ABCD/)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Summary from home' })) })
    await waitFor(() => expect(screen.getByTestId('family-shared').textContent).toMatch(/62% secure/))
  })

  it('renders nothing at all for someone who is not a teacher of the class', async () => {
    const calls = installFetch(() => undefined) // every route answers 404
    const { container } = render(<ClassroomFamilySeatsPanel classId="cls_1" />)
    await waitFor(() => expect(calls).toHaveLength(1))
    await waitFor(() => expect(container.innerHTML).toBe(''))
    expect(screen.queryByTestId('family-link-offline')).toBeNull()
  })

  it('offline says offline', async () => {
    rejectFetch()
    render(<ClassroomFamilySeatsPanel classId="cls_1" />)
    expect((await screen.findByTestId('family-link-offline')).textContent).toMatch(/offline/)
    expect(screen.queryByTestId('family-seats-empty')).toBeNull()
  })
})

describe('source rules', () => {
  const FILE = path.join(__dirname, '..', 'panels', 'ClassroomFamilyLinkPanel.tsx')
  const src = fs.readFileSync(FILE, 'utf8')

  it('paints only through the Learn tokens (no hex / rgb literal)', () => {
    const offenders = src.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(line))
    expect(offenders).toEqual([])
  })

  it('names no diagnosis, label, grade, price or tier', () => {
    expect(/\b(adhd|dyslexi\w*|autis\w*|disorder|diagnos\w*|deficit|lazy|behind grade)\b/i.exec(src)?.[0] ?? null).toBeNull()
    expect(/(\$\d|\bfree\b|\bpricing\b|\bper month\b|\bfree tier\b)/i.exec(src)?.[0] ?? null).toBeNull()
  })

  it('has an explicit awkit export (src and dist) and a barrel export', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'))
    const name = './panels/ClassroomFamilyLinkPanel'
    expect(pkg.exports[name]).toEqual({ types: './src/panels/ClassroomFamilyLinkPanel.tsx', import: './src/panels/ClassroomFamilyLinkPanel.tsx' })
    expect(pkg.publishConfig.exports[name].import).toBe('./dist/panels/ClassroomFamilyLinkPanel.js')
    const barrel = fs.readFileSync(path.join(__dirname, '..', 'panels', 'index.ts'), 'utf8')
    expect(barrel).toMatch(/export \{ default as ClassroomFamilyLinkPanel, ClassroomFamilySeatsPanel \} from '\.\/ClassroomFamilyLinkPanel'/)
  })
})
