/**
 * The demo class in the teacher's console (ClassroomConsolePanel): the quiet offer
 * where the console has nothing to show, the "demo" mark a demo class always
 * wears (header, class picker, strip), refresh and remove, and the honest states
 * (building, failed, offline). Runs under AitherVeil's jest, like the other
 * Classroom panel tests.
 */
import React from 'react'
import fs from 'fs'
import path from 'path'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ClassroomConsolePanel from '../panels/ClassroomConsolePanel'
import { LEARN_MODE_KEY, LEARN_TOKENS, LEARN_TOKEN_KEYS, learnVarName } from '../panels/learnTheme'

type Reply = { status: number; body: unknown }
type Call = { url: string; method: string; body: unknown }

const ok = (body: unknown): Reply => ({ status: 200, body })
const ACADEMY = '/api/classroom-academy'
const MARK = { label: 'demo', statement: 'Demo class. Every student and parent in it is fictional.' }
const CONSENT = { consent_recorded: true, school_as_agent: true, banner: null, policy_version: 'classroom-demo-no-real-students' }
const DEMO_CLASS = { class_id: 'cls_demo', name: 'Demo class (fictional students)', grade_level: 'K-2', subject: 'Reading and math', student_count: 8, consent: CONSENT }
const REAL_CLASS = { class_id: 'cls_real', name: 'Room 4', grade_level: 'K-2', subject: 'Math', student_count: 0, consent: { consent_recorded: true, school_as_agent: true, banner: null } }
const VIEW = {
  demo: true, class_id: 'cls_demo', name: DEMO_CLASS.name, seeded_at: '2026-10-01T14:00:00+00:00', stale: false, mark: MARK,
  counts: { students: 8 }, parent_view: { student_user_id: 'demo_stu_1', member_id: 'mbr_1', alias: 'Ari' },
}
const ROSTER = { class_id: 'cls_demo', teachers: [], students: [{ member_id: 'mbr_1', student_user_id: 'demo_stu_1', alias: 'Ari', parents: [{ student_user_id: 'demo_stu_1', parent_user_id: 't' }] }] }

/** A tiny stand-in for the classroom routes; `world` is what the server holds. */
function install(world: { classes: unknown[]; demo: unknown; seed?: Reply; remove?: Reply; demoDown?: boolean; retry?: Reply }) {
  const calls: Call[] = []
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    let r: Reply = { status: 404, body: { detail: 'Not found' } }
    if (url.endsWith('/api/classroom/demo') && method === 'GET') {
      if (world.demoDown) throw new TypeError('Failed to fetch')
      r = ok({ demo: world.demo, class_ids: world.demo ? ['cls_demo'] : [], mark: MARK })
    } else if (url.endsWith('/demo/seed') && method === 'POST') r = world.seed ?? { status: 201, body: { ...VIEW, created: true, refreshed: false, class: { ...DEMO_CLASS, demo: true } } }
    else if (url.endsWith('/api/classroom/demo') && method === 'DELETE') r = world.remove ?? ok({ deleted: true, class_id: 'cls_demo', errors: [], retained: [{ what: 'class_audit', rows: 9, why: 'append-only' }, { what: 'tutor_transcript_markers', rows: 40, why: 'append-only' }] })
    else if (url.endsWith('/room/teardowns/retry') && method === 'POST') r = world.retry ?? ok({ done: [{ class_id: 'cls_demo', channel: null }], pending: 0 })
    else if (url.endsWith('/api/classroom/classes')) r = ok({ classes: world.classes })
    else if (url.endsWith('/roster')) r = ok(url.includes('cls_real') ? { class_id: 'cls_real', teachers: [], students: [] } : ROSTER)
    else if (url.endsWith('/assignments')) r = ok({ assignments: [] })
    else if (url.includes('/hard-now')) r = ok({ window_days: 14, min_students: 3, rows: [] })
    else if (url.endsWith('/review-queue')) r = ok({ responses: [] })
    return { status: r.status, ok: r.status >= 200 && r.status < 300, statusText: '', json: async () => r.body } as unknown as Response
  })
  return calls
}

afterEach(() => { window.localStorage.removeItem(LEARN_MODE_KEY) })

describe.each(['dark', 'light'] as const)('the demo class in the console, %s', (mode) => {
  beforeEach(() => { window.localStorage.setItem(LEARN_MODE_KEY, mode) })

  it('offers a demo on the empty console and opens it, marked, when asked', async () => {
    const calls = install({ classes: [], demo: null })
    const onActive = jest.fn()
    render(<ClassroomConsolePanel academyBase={ACADEMY} onActiveClass={onActive} />)
    const offer = await screen.findByTestId('demo-offer')
    expect(offer.textContent).toMatch(/fictional students/)
    expect(offer.textContent).toMatch(/Nothing is sent to anyone/)
    expect(screen.queryByTestId('demo-mark')).toBeNull()
    // The offer is a quiet link: "Create class" stays the one primary action.
    expect(screen.getByTestId('demo-seed').className).toMatch(/al-quiet/)

    await act(async () => { fireEvent.click(screen.getByTestId('demo-seed')) })
    await screen.findByTestId('demo-strip')
    const seed = calls.find((c) => c.url.endsWith('/api/classroom/demo/seed'))
    expect(seed).toMatchObject({ method: 'POST', body: { refresh: false } })
    expect(screen.getByTestId('demo-mark').textContent).toBe('demo')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Demo class (fictional students)')
    expect(screen.getByTestId('demo-strip').textContent).toMatch(/Every student and parent in this class is fictional/)
    expect(screen.getByTestId('demo-strip').textContent).toMatch(/demo parent of Ari/)
    expect(screen.queryByTestId('demo-offer')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Assign' })).toHaveLength(1)
    // The host that follows the selection gets the flag on the class itself.
    await waitFor(() => expect(onActive).toHaveBeenLastCalledWith(expect.objectContaining({ class_id: 'cls_demo', demo: true })))

    const root = screen.getByTestId('classroom-console')
    expect(root.getAttribute('data-learn-theme')).toBe(mode)
    for (const k of LEARN_TOKEN_KEYS) expect(root.style.getPropertyValue(learnVarName(k))).toBe(LEARN_TOKENS[mode][k])
  })

  it('marks only the demo class, in the header and in the class picker', async () => {
    install({ classes: [REAL_CLASS, DEMO_CLASS], demo: VIEW })
    const onActive = jest.fn()
    render(<ClassroomConsolePanel academyBase={ACADEMY} onActiveClass={onActive} />)
    await screen.findByText('Room 4', { selector: 'h1' })
    // The real class is showing: no mark, no strip, and no second demo is offered.
    await waitFor(() => expect(screen.getByRole('button', { name: /Demo class/ }).textContent).toMatch(/demo$/))
    expect(screen.queryByTestId('demo-mark')).toBeNull()
    expect(screen.queryByTestId('demo-strip')).toBeNull()
    expect(screen.queryByTestId('demo-offer')).toBeNull()
    expect(screen.getByRole('button', { name: 'Room 4' }).textContent).toBe('Room 4')
    expect(onActive).toHaveBeenLastCalledWith(expect.not.objectContaining({ demo: true }))

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Demo class/ })) })
    expect(await screen.findByTestId('demo-mark')).toBeTruthy()
    expect(screen.getByTestId('demo-strip')).toBeTruthy()
  })

  it('a real class with nobody in it also offers the demo', async () => {
    install({ classes: [REAL_CLASS], demo: null })
    render(<ClassroomConsolePanel academyBase={ACADEMY} />)
    const offer = await screen.findByTestId('demo-offer')
    expect(screen.getByTestId('classroom-roster').contains(offer)).toBe(true)
    expect(screen.queryByTestId('demo-mark')).toBeNull()
  })

  it('never fakes a demo: a failed build says so and shows no class', async () => {
    install({ classes: [], demo: null, seed: { status: 503, body: { detail: { classroom_demo: 'unavailable' } } } })
    render(<ClassroomConsolePanel academyBase={ACADEMY} />)
    const seed = await screen.findByTestId('demo-seed')
    await act(async () => { fireEvent.click(seed) })
    expect((await screen.findByTestId('demo-failed')).textContent).toMatch(/could not be built just now. Nothing was created/)
    expect(screen.queryByTestId('demo-mark')).toBeNull()
    expect(screen.queryByTestId('demo-strip')).toBeNull()
    expect(screen.getByTestId('classroom-empty')).toBeTruthy()
  })

  it('refresh rebuilds, remove asks first and says what stays', async () => {
    const calls = install({ classes: [DEMO_CLASS], demo: { ...VIEW, stale: true } })
    render(<ClassroomConsolePanel academyBase={ACADEMY} />)
    const strip = await screen.findByTestId('demo-strip')
    expect(strip.textContent).toMatch(/a few days old/)

    await act(async () => { fireEvent.click(screen.getByTestId('demo-refresh')) })
    expect(calls.find((c) => c.url.endsWith('/demo/seed'))).toMatchObject({ body: { refresh: true } })
    await waitFor(() => expect(screen.getByTestId('demo-strip').textContent).not.toMatch(/a few days old/))

    // One click never removes: the strip asks, and "Keep it" backs out.
    fireEvent.click(screen.getByTestId('demo-remove'))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    fireEvent.click(screen.getByTestId('demo-remove'))
    await act(async () => { fireEvent.click(screen.getByTestId('demo-remove-confirm')) })
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual(['/api/classroom/demo'])
    await waitFor(() => expect(screen.queryByTestId('demo-strip')).toBeNull())
    expect(screen.getByRole('status').textContent).toMatch(/The demo class is removed.*9 class audit rows and 40 tutor transcript markers rows.*names no student/)
    expect(screen.getByTestId('classroom-empty')).toBeTruthy()
  })

  it('a removal that did not confirm, or did not happen, is said plainly', async () => {
    install({ classes: [DEMO_CLASS], demo: VIEW, remove: { status: 503, body: { detail: 'down' } } })
    render(<ClassroomConsolePanel academyBase={ACADEMY} />)
    fireEvent.click(await screen.findByTestId('demo-remove'))
    await act(async () => { fireEvent.click(screen.getByTestId('demo-remove-confirm')) })
    expect(screen.getByRole('status').textContent).toMatch(/could not be removed just now. It is still here/)
    expect(screen.getByTestId('demo-strip')).toBeTruthy()
  })

  it('without an answer about the demo, no class is marked, none is offered and the console still works', async () => {
    install({ classes: [REAL_CLASS], demo: null, demoDown: true })
    render(<ClassroomConsolePanel academyBase={ACADEMY} />)
    await screen.findByTestId('classroom-roster')
    expect(screen.queryByTestId('demo-mark')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Room 4')
    // Unknown is not "none": a second demo is never offered on a failed GET /demo.
    expect(screen.queryByTestId('demo-offer')).toBeNull()
  })

  it('no answer about the demo on an empty console offers nothing either', async () => {
    install({ classes: [], demo: null, demoDown: true })
    render(<ClassroomConsolePanel academyBase={ACADEMY} />)
    await screen.findByTestId('classroom-empty')
    expect(screen.queryByTestId('demo-offer')).toBeNull()
  })

  it('the mark rides the class payload: GET /demo failing cannot unmark a demo class', async () => {
    install({ classes: [{ ...DEMO_CLASS, demo: true }, REAL_CLASS], demo: VIEW, demoDown: true })
    const onActive = jest.fn()
    render(<ClassroomConsolePanel academyBase={ACADEMY} onActiveClass={onActive} />)
    expect((await screen.findByTestId('demo-mark')).textContent).toBe('demo')
    expect(screen.getByTestId('demo-strip').textContent).toMatch(/Every student and parent in this class is fictional/)
    expect(screen.getByRole('button', { name: /Demo class/ }).textContent).toMatch(/demo$/)
    expect(screen.getByRole('button', { name: 'Room 4' }).textContent).toBe('Room 4')
    expect(screen.queryByTestId('demo-offer')).toBeNull()
    await waitFor(() => expect(onActive).toHaveBeenLastCalledWith(expect.objectContaining({ class_id: 'cls_demo', demo: true })))
  })

  it('a class room that did not confirm its removal is queued, and the console can finish it', async () => {
    const partial = ok({ deleted: 'partial', class_id: 'cls_demo', errors: [{ part: 'room', error: 'ClassroomError' }], retained: [] })
    const calls = install({ classes: [DEMO_CLASS], demo: VIEW, remove: partial })
    render(<ClassroomConsolePanel academyBase={ACADEMY} />)
    fireEvent.click(await screen.findByTestId('demo-remove'))
    await act(async () => { fireEvent.click(screen.getByTestId('demo-remove-confirm')) })
    expect(screen.getByRole('status').textContent).toMatch(/class room did not confirm that it is gone, so that removal is queued/)
    expect(screen.getByRole('status').textContent).not.toMatch(/Open the class room/)
    await act(async () => { fireEvent.click(screen.getByTestId('demo-finish-removal')) })
    expect(calls.filter((c) => c.url.endsWith('/room/teardowns/retry')).map((c) => c.method)).toEqual(['POST'])
    expect(screen.getByRole('status').textContent).toMatch(/fully removed/)
    expect(screen.queryByTestId('demo-finish-removal')).toBeNull()
  })

  it('a retry that still does not confirm says so and keeps the way to retry', async () => {
    const partial = ok({ deleted: 'partial', class_id: 'cls_demo', errors: [{ part: 'room' }], retained: [] })
    install({ classes: [DEMO_CLASS], demo: VIEW, remove: partial, retry: ok({ done: [], pending: 1 }) })
    render(<ClassroomConsolePanel academyBase={ACADEMY} />)
    fireEvent.click(await screen.findByTestId('demo-remove'))
    await act(async () => { fireEvent.click(screen.getByTestId('demo-remove-confirm')) })
    await act(async () => { fireEvent.click(screen.getByTestId('demo-finish-removal')) })
    expect(screen.getByRole('status').textContent).toMatch(/still did not confirm/)
    expect(screen.getByTestId('demo-finish-removal')).toBeTruthy()
  })

  it('a part that did not confirm and has no retry is named, with no promise', async () => {
    const partial = ok({ deleted: 'partial', class_id: 'cls_demo', errors: [{ part: 'academy' }], retained: [] })
    install({ classes: [DEMO_CLASS], demo: VIEW, remove: partial })
    render(<ClassroomConsolePanel academyBase={ACADEMY} />)
    fireEvent.click(await screen.findByTestId('demo-remove'))
    await act(async () => { fireEvent.click(screen.getByTestId('demo-remove-confirm')) })
    expect(screen.getByRole('status').textContent).toMatch(/a part of it did not confirm \(academy\)\./)
    expect(screen.queryByTestId('demo-finish-removal')).toBeNull()
  })
})

describe('the demo copy and paint', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'panels', 'ClassroomConsolePanel.tsx'), 'utf8')
  const api = fs.readFileSync(path.join(__dirname, '..', 'panels', 'classroomApi.ts'), 'utf8')

  it('paints the mark and the strip through the tokens only', () => {
    const block = api.slice(api.indexOf('demoMark:'), api.indexOf('textarea:'))
    expect(block).toMatch(/C\.amber/)
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
    expect(src).not.toMatch(/#[0-9a-fA-F]{6}\b/)
  })

  it('states no price, no free tier and no capacity promise', () => {
    const demoCopy = src.slice(src.indexOf('function DemoOffer'), src.indexOf('function Offline'))
    expect(demoCopy).not.toMatch(/\bfree\b|\$\d|\bprice|\bunlimited|per month|\btrial\b/i)
  })
})
