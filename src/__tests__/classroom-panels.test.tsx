/**
 * Aither Classroom panels (awkit): each surface renders in dark AND light with
 * every Learn token on its root, shows a dim "offline" state when its fetch is
 * rejected (never placeholders), paints only through the tokens, and keeps the
 * safety copy: cite chips under every observation, "Observations, not
 * diagnoses", no 0% for an untouched area, the AI-offline badge, a kid card that
 * stays invisible outside a class. Runs under AitherVeil's jest (roots include
 * awkit/src), like the other Learn panel tests.
 */
import React from 'react'
import fs from 'fs'
import path from 'path'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ClassroomConsolePanel from '../panels/ClassroomConsolePanel'
import ClassroomRosterSheet, { sheetIsPrintable } from '../panels/ClassroomRosterSheet'
import ClassroomStudioPanel from '../panels/ClassroomStudioPanel'
import ClassroomInsightsPanel from '../panels/ClassroomInsightsPanel'
import ClassroomRoomPanel from '../panels/ClassroomRoomPanel'
import ClassroomParentPanel from '../panels/ClassroomParentPanel'
import KidAssignmentsCard from '../panels/KidAssignmentsCard'
import KidAssignmentView from '../panels/KidAssignmentView'
import { describeCite } from '../panels/classroomApi'
import { LEARN_MODE_KEY, LEARN_TOKENS, LEARN_TOKEN_KEYS, learnVarName } from '../panels/learnTheme'

type Reply = { status: number; body: unknown }
type Route = (url: string, init?: RequestInit) => Reply | undefined

function installFetch(route: Route) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const r = route(url, init) ?? { status: 404, body: { detail: 'Not found' } }
    return { status: r.status, ok: r.status >= 200 && r.status < 300, statusText: '', json: async () => r.body } as unknown as Response
  })
  return calls
}

function rejectFetch() {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => { throw new TypeError('Failed to fetch') })
}

const ok = (body: unknown): Reply => ({ status: 200, body })

const CLASS = { class_id: 'cls_1', name: 'Room 4', grade_level: 'K-2', subject: 'Math', student_count: 3, consent: { consent_recorded: true, school_as_agent: true, banner: null } }
const ROSTER = {
  class_id: 'cls_1', teachers: [{ user_id: 't1', role: 'teacher' }],
  students: [
    { member_id: 'm_a', student_user_id: 'u_a', alias: 'Ada', parents: [{ student_user_id: 'u_a', parent_user_id: 'p1' }] },
    { member_id: 'm_b', student_user_id: 'u_b', alias: 'Ben', parents: [] },
  ],
}
const HARD = {
  window_days: 14, min_students: 3,
  rows: [
    { skill_id: 'math.add_within_20', title: 'Adding to 20', area: 'math', status: 'ok', attempts: 30, error_rate: 0.4, hints_per_attempt: 0.5, latency_ratio: 1.8, hard_share: 0.6, students: 5, students_affected: 3, cites: ['att:1'] },
    { skill_id: 'reading.cvc', title: 'CVC words', area: 'reading', status: 'too_few' },
  ],
}
const REVIEW = { responses: [{ response_id: 'rsp_1', student_id: 's1', alias: 'Ada', challenge_id: 'ch_1', challenge_title: 'Make 10', standard: null, status: 'submitted', answers: { q1: '7 + 3' }, answer_text: 'I counted on from seven, then checked it with my fingers, and then I wrote the whole number sentence out twice to be sure', auto_score: 0.75, review_score: null, review_status: 'provisional', flag: 'provisional', submitted_at: '2026-10-01T09:00:00Z' }] }
const ACADEMY = '/api/classroom-academy'
const INSIGHT = { observations: [{ text: 'Several students used hints on adding to 20.', cites: ['att:1', 'fb:2'] }], source: 'template', label: 'observation' }

const teacherRoute: Route = (url) => {
  if (url.endsWith('/api/classroom/classes')) return ok({ classes: [CLASS] })
  if (url.endsWith('/roster')) return ok(ROSTER)
  if (url.endsWith('/assignments')) return ok({ assignments: [{ id: 'asn_1', class_id: 'cls_1', title: 'Make ten', artifact_ids: [], skill_ids: [], due_at: '2026-10-09' }] })
  if (url.includes('/hard-now')) return ok(HARD)
  if (url.endsWith('/review-queue')) return ok(REVIEW)
  if (url.endsWith('/consent')) return ok({ consent_recorded: true, school_as_agent: true, policy_version: 'classroom-2026-10' })
  if (url.endsWith('/sheet')) return ok({ has_sheet: false, armed: false, printable: false, students: [] })
  if (url.endsWith('/insight')) return ok(INSIGHT)
  if (url.endsWith('/room/state')) return ok({
    role: 'teacher', class: { class_id: 'cls_1', name: 'Room 4' }, room: { workspace: 'x-cls-1', status: 'ok', nick: 'msk' },
    announcements: [{ id: 'ann_1', text: 'Library day Friday', created_at: '2026-10-01T09:00:00Z' }],
    materials: { status: 'ok', items: [{ id: 'art_1', title: 'Tier A practice', kind: 'document', tier: 'A', topic: 'Make ten', download_url: '/api/v1/classroom/classes/cls_1/room/materials/art_1/download' }] },
    threads: [{ member_id: 'm_a', alias: 'Ada', parents: 1 }],
    presence: { status: 'ok', people: [{ nick: 'msk', online: true, is_agent: false }] },
    agents: ['atlas'],
  })
  return undefined
}

const PROGRESS = {
  child: { member_id: 'm_a', alias: 'Ada' }, class_id: 'cls_1',
  areas: { math: { mastery: 0.62, skills: [], standards: 2 }, reading: { mastery: null, skills: [], standards: 0 } },
  timeline: [{ day: '2026-09-30', areas: { math: { attempts: 6, correct: 4, accuracy: 0.67 } } }],
}
const CHILD = { student_user_id: 'u_a', alias: 'Ada', class_id: 'cls_1', class_name: 'Room 4', subject: 'Math' }
const parentRoute: Route = (url) => {
  if (url.endsWith('/parent/children')) return ok({ children: [CHILD] })
  if (url.endsWith('/progress')) return ok(PROGRESS)
  if (url.endsWith('/weekly')) return ok({ observations: [{ text: 'Ada practised adding on four days.', cites: [] }], source: 'template' })
  if (url.endsWith('/room/state')) return ok({
    role: 'parent', class: { class_id: 'cls_1', name: 'Room 4' }, room: { workspace: 'x', status: 'ok' },
    announcements: [{ text: 'Library day Friday' }], threads: [{ member_id: 'm_a', alias: 'Ada', messages: [], status: 'ok' }],
    materials: { status: 'ok', items: [{ id: 'art_1', title: 'Tier A practice', topic: 'Make ten', download_url: '/api/v1/classroom/classes/cls_1/room/materials/art_1/download' }] },
  })
  return undefined
}

function expectThemed(testId: string, mode: 'dark' | 'light') {
  const root = screen.getByTestId(testId)
  expect(root.getAttribute('data-learn-theme')).toBe(mode)
  for (const k of LEARN_TOKEN_KEYS) expect(root.style.getPropertyValue(learnVarName(k))).toBe(LEARN_TOKENS[mode][k])
}

afterEach(() => { window.localStorage.removeItem(LEARN_MODE_KEY) })

describe.each(['dark', 'light'] as const)('Classroom panels in %s', (mode) => {
  beforeEach(() => { window.localStorage.setItem(LEARN_MODE_KEY, mode) })

  it('console: classes, roster, heatmap with suppression, review queue, one primary Assign', async () => {
    installFetch(teacherRoute)
    render(<ClassroomConsolePanel academyBase={ACADEMY} />)
    await screen.findByTestId('hard-now-heatmap')
    expectThemed('classroom-console', mode)
    expect(screen.getByText('Room 4')).toBeTruthy()
    expect(screen.getByTestId('classroom-roster').textContent).toMatch(/Ada.*1 parent linked.*Ben.*no parent yet/)
    expect(screen.getByTestId('hard-now-suppressed').textContent).toMatch(/fewer than 3 students/)
    expect(screen.getByTestId('review-score').textContent).toBe('provisional 75%')
    expect(screen.getByTestId('review-answer').textContent).toMatch(/wrote the whole number sentence out twice to be sure.*7 \+ 3/)
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getAllByRole('button', { name: 'Assign' })).toHaveLength(1)
  })

  it('roster sheet: students, consent recorded, parent code, print action', async () => {
    const calls = installFetch((url, init) => {
      if (url.endsWith('/parent-code') && init?.method === 'POST') return { status: 201, body: { code: 'ABCD-EFGH-JK', expires_at: '2026-10-08T10:00:00+00:00' } }
      return teacherRoute(url, init)
    })
    render(<ClassroomRosterSheet classId="cls_1" />)
    await screen.findByText('Ben')
    expectThemed('classroom-roster-sheet', mode)
    expect(screen.getByTestId('consent-state').textContent).toMatch(/recorded/)
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Parent code' })[0]) })
    expect(screen.getByTestId('parent-code').textContent).toMatch(/ABCD-EFGH-JK/)
    expect(calls.some((c) => c.url.endsWith('/classes/cls_1/students/m_a/parent-code'))).toBe(true)
    expect(screen.getByTestId('print-join-sheet')).toBeTruthy()
  })

  it('studio: AI offline badge on a template draft, three tiers side by side', async () => {
    installFetch((url) => {
      if (url.endsWith('/studio/draft')) return { status: 201, body: { ai: 'offline', reason: 'llm_off', lesson: { id: 'lsn_1', topic: 'Make ten', status: 'draft' }, plan: { title: 'Make ten', objective: 'Students can make ten.', steps: ['Model it', 'Practise'], check_for_understanding: ['Exit ticket'] } } }
      if (url.endsWith('/studio/differentiate')) return { status: 201, body: { ai: 'offline', tiers: { A: { label: 'Support', focus: 'f', activities: ['a1', 'a2'], check: 'c' }, B: { label: 'On track', focus: 'f', activities: ['b1', 'b2'], check: 'c' }, C: { label: 'Stretch', focus: 'f', activities: ['c1', 'c2'], check: 'c' } } } }
      return undefined
    })
    render(<ClassroomStudioPanel classId="cls_1" academyBase={ACADEMY} gradeLevel="K-2" />)
    expectThemed('classroom-studio', mode)
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'Make ten' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Draft lesson' })) })
    expect(screen.getByTestId('ai-offline').textContent).toMatch(/AI offline/)
    await act(async () => { fireEvent.click(screen.getByTestId('studio-tiers')) })
    expect(screen.getByTestId('studio-tier-grid').querySelectorAll('article')).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: 'Publish' })).toHaveLength(1)
  })

  it('insights: the label, observations, cite chips that expand', async () => {
    installFetch(teacherRoute)
    render(<ClassroomInsightsPanel classId="cls_1" live={false} />)
    await screen.findByTestId('observation')
    expectThemed('classroom-insights', mode)
    expect(screen.getByTestId('insight-label').textContent).toBe('Observations, not diagnoses')
    const chips = screen.getAllByTestId('cite-chip')
    // Chips read as words, never as raw ids like att:1.
    expect(chips.map((c) => c.textContent)).toEqual(['practice try 1', 'kid rating 2'])
    // A host that asked for no live stream shows no stream status at all.
    expect(screen.queryByTestId('stream-status')).toBeNull()
    fireEvent.click(chips[0])
    expect(screen.getByTestId('cite-detail').textContent).toBe(describeCite('att:1'))
  })

  it('insights: a long list of sources folds behind "+N more"', async () => {
    installFetch((url) => url.endsWith('/insight')
      ? ok({ observations: [{ text: 'Many signals.', cites: ['fb:1', 'fb:2', 'fb:3', 'fb:4', 'fb:5'] }], source: 'template', label: 'observation' })
      : teacherRoute(url))
    render(<ClassroomInsightsPanel classId="cls_1" live={false} />)
    await screen.findByTestId('observation')
    expect(screen.getAllByTestId('cite-chip')).toHaveLength(3)
    expect(screen.getByTestId('cite-more').textContent).toBe('+2 more')
    fireEvent.click(screen.getByTestId('cite-more'))
    expect(screen.getAllByTestId('cite-chip')).toHaveLength(5)
    expect(screen.queryByTestId('cite-more')).toBeNull()
  })

  it('room (teacher): announcements, materials tiles, threads, presence, agent', async () => {
    installFetch(teacherRoute)
    render(<ClassroomRoomPanel classId="cls_1" pollMs={0} />)
    await screen.findByText('Library day Friday')
    expectThemed('classroom-room', mode)
    expect(screen.getAllByTestId('material-tile')).toHaveLength(1)
    expect(screen.getByTestId('material-tile').getAttribute('href')).toBe('/api/classroom/classes/cls_1/room/materials/art_1/download')
    expect(screen.getByText('atlas')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Post' })).toHaveLength(1)
  })

  it('parent: bars where there is practice, "no practice yet" (never 0%) where none', async () => {
    installFetch(parentRoute)
    render(<ClassroomParentPanel live={false} />)
    await screen.findByTestId('area-bars')
    expectThemed('classroom-parent', mode)
    const bars = screen.getByTestId('area-bars').textContent || ''
    expect(bars).toMatch(/62% secure/)
    expect(bars).toMatch(/no practice yet/)
    expect(bars).not.toMatch(/\b0%/)
    expect(screen.getAllByRole('progressbar')).toHaveLength(1)
    await screen.findByTestId('weekly-review')
  })

  it('kid card: big assigned work, Start records an open', async () => {
    const calls = installFetch((url, init) => {
      if (url.endsWith('/me/assignments')) return ok({ assignments: [{ assignment_id: 'asn_1', class_id: 'cls_1', title: 'Make ten', has_skills: true }] })
      if (url.endsWith('/open') && init?.method === 'POST') return ok({ assignment_id: 'asn_1', opened_at: '2026-10-01T10:00:00Z', done_at: null })
      return undefined
    })
    const onOpen = jest.fn()
    render(<KidAssignmentsCard onOpen={onOpen} />)
    await screen.findByText('Make ten')
    expect(screen.getByTestId('kid-assignments').getAttribute('data-learn-theme')).toBe(mode)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start' })) })
    expect(calls.some((c) => c.url.endsWith('/me/assignments/asn_1/open'))).toBe(true)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ assignment_id: 'asn_1' }))
    // The card lists work; handing in belongs to the view that shows it.
    expect(screen.queryByRole('button', { name: /done/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Keep going' })).toBeTruthy()
  })

  it('kid card: a host with no view gets no Start (nothing to open, nothing to finish)', async () => {
    installFetch((url) => (url.endsWith('/me/assignments') ? ok({ assignments: [{ assignment_id: 'asn_1', class_id: 'cls_1', title: 'Make ten' }] }) : undefined))
    render(<KidAssignmentsCard />)
    await screen.findByText('Make ten')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('kid view: shows the files and questions, posts answers, repeats a refusal, hands in', async () => {
    const calls = installFetch((url, init) => {
      if (url.endsWith('/me/assignments/asn_1') && !init?.method) {
        return ok({
          assignment_id: 'asn_1', class_id: 'cls_1', title: 'Make ten', done_at: null,
          artifacts: [{ artifact_id: 'art_1', title: 'Ten frames', filename: 'frames.pdf' }],
          challenges: [{ id: 'ch_1', title: 'Check', questions: [{ prompt: '7 + ? = 10', type: 'multiple_choice', choices: ['2', '3'] }] }],
        })
      }
      if (url.endsWith('/responses')) return { status: 409, body: { detail: 'Your teacher already looked at this one' } }
      if (url.endsWith('/done')) return ok({ done_at: '2026-10-01T10:05:00Z' })
      return undefined
    })
    const onDone = jest.fn()
    render(<KidAssignmentView assignmentId="asn_1" onBack={() => {}} onDone={onDone} />)
    await screen.findByText('7 + ? = 10')
    expect(screen.getByTestId('kid-assignment-view').getAttribute('data-learn-theme')).toBe(mode)
    expect(screen.getByTestId('kid-material').getAttribute('href')).toBe('/api/classroom/me/assignments/asn_1/materials/art_1')
    expect((screen.getByRole('button', { name: 'Send my answers' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '3' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send my answers' })) })
    const post = calls.find((c) => c.url.endsWith('/me/assignments/asn_1/responses'))
    expect(JSON.parse(String(post?.init?.body))).toEqual({ challenge_id: 'ch_1', answers: { 0: '3' } })
    // The server's refusal is repeated, not replaced with a fake "sent".
    expect(screen.getByRole('status').textContent).toBe('Your teacher already looked at this one')
    expect(screen.queryByTestId('kid-handed-in')).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /I.m done/ })) })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('kid view: unreachable work says offline and has no hand-in', async () => {
    rejectFetch()
    const onBack = jest.fn()
    render(<KidAssignmentView assignmentId="asn_1" onBack={onBack} />)
    await screen.findByTestId('kid-assignment-offline')
    expect(screen.queryByRole('button', { name: /done/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('review fixes: what the teacher confirms, prints, deletes and shares is what the server said', () => {
  const HREF = '/api/classroom/classes/cls_1/room/materials/art_1/download'

  it('console: a provisional row with no machine score cannot be confirmed', async () => {
    installFetch((url, init) => {
      if (url.endsWith('/review-queue')) return ok({ responses: [{ ...REVIEW.responses[0], auto_score: null }] })
      return teacherRoute(url, init)
    })
    render(<ClassroomConsolePanel academyBase={ACADEMY} />)
    await screen.findByTestId('review-item')
    expect(screen.getByTestId('review-score').textContent).toBe('no machine score')
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('console: Assign reads lessons from the academyBase the host passed, nowhere else', async () => {
    const calls = installFetch((url, init) => {
      if (url === `${ACADEMY}/classes/cls_1/lessons`) return ok({ lessons: [{ id: 'lsn_1', topic: 'Make ten', status: 'published' }] })
      return teacherRoute(url, init)
    })
    render(<ClassroomConsolePanel academyBase={ACADEMY} />)
    await screen.findByTestId('hard-now-heatmap')
    await act(async () => { fireEvent.click(screen.getByTestId('classroom-assign')) })
    await screen.findByText('Make ten', { selector: 'option' })
    expect(calls.some((c) => c.url.includes('/api/v1/academy'))).toBe(false)
  })

  const sheetRoute = (reply: unknown): Route => (url, init) => {
    if (url.endsWith('/sheet/arm')) return ok({ secret: 'one-time-secret', armed_until: '2026-10-01T10:30:00+00:00' })
    if (url.endsWith('/sheet') && JSON.stringify(init?.headers ?? {}).includes('X-Classroom-Sheet-Secret')) return ok(reply)
    return teacherRoute(url, init)
  }

  it('roster: a sheet that comes back printable:false is never rendered or printed', async () => {
    const print = jest.fn()
    ;(window as unknown as { print: unknown }).print = print
    installFetch(sheetRoute({ has_sheet: true, armed: true, printable: false, students: [{ member_id: 'm_a', alias: 'Ada' }, { member_id: 'm_b', alias: 'Ben' }] }))
    render(<ClassroomRosterSheet classId="cls_1" />)
    await screen.findByText('Ben')
    await act(async () => { fireEvent.click(screen.getByTestId('print-join-sheet')) })
    await act(async () => { await new Promise((r) => setTimeout(r, 300)) })
    expect(screen.queryByTestId('printable-sheet')).toBeNull()
    expect(print).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toMatch(/nothing was printed/)
  })

  it('roster: a printable sheet with a QR per student renders and prints', async () => {
    const print = jest.fn()
    ;(window as unknown as { print: unknown }).print = print
    const qr = 'data:image/svg+xml;base64,PHN2Zy8+'
    installFetch(sheetRoute({ has_sheet: true, armed: true, printable: true, class_name: 'Room 4', students: [{ member_id: 'm_a', alias: 'Ada', qr_svg_data_uri: qr }, { member_id: 'm_b', alias: 'Ben', qr_svg_data_uri: qr }] }))
    render(<ClassroomRosterSheet classId="cls_1" />)
    await screen.findByText('Ben')
    await act(async () => { fireEvent.click(screen.getByTestId('print-join-sheet')) })
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('printable-sheet').querySelectorAll('img')).toHaveLength(2)
    expect(sheetIsPrintable({ has_sheet: true, armed: true, printable: true, students: [{ member_id: 'm_a', alias: 'Ada' }] })).toBe(false)
  })

  it('roster: a partial delete says what was not erased and keeps the sheet open', async () => {
    const onDeleted = jest.fn()
    let reply: unknown = { class_id: 'cls_1', deleted: 'partial', identity_children_retained: ['u_a'], errors: [{ part: 'relay', error: 'TimeoutError' }] }
    installFetch((url, init) => {
      if (init?.method === 'DELETE') return ok(reply)
      return teacherRoute(url, init)
    })
    render(<ClassroomRosterSheet classId="cls_1" onDeleted={onDeleted} />)
    await screen.findByText('Ben')
    fireEvent.click(screen.getByRole('button', { name: 'Delete class' }))
    fireEvent.change(screen.getByLabelText('Class id'), { target: { value: 'cls_1' } })
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Delete class' }).slice(-1)[0]) })
    expect(screen.getByTestId('delete-partial').textContent).toMatch(/could not be erased: relay/)
    expect(screen.queryByText('The class is gone')).toBeNull()
    expect(onDeleted).not.toHaveBeenCalled()
    reply = { class_id: 'cls_1', deleted: true, identity_children_retained: ['u_a'], errors: [] }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    expect(screen.getByText('The class is gone')).toBeTruthy()
  })

  it('room (parent): the shared materials shelf, linked through the host proxy', async () => {
    installFetch(parentRoute)
    render(<ClassroomRoomPanel classId="cls_1" pollMs={0} />)
    await screen.findByText('Library day Friday')
    expect(screen.getByTestId('room-materials').textContent).toMatch(/from the teacher/)
    expect(screen.getByTestId('material-tile').getAttribute('href')).toBe(HREF)
    expect(screen.queryByTestId('room-presence')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Post' })).toBeNull()
  })

  it('parent panel: the materials the teacher shared', async () => {
    installFetch(parentRoute)
    render(<ClassroomParentPanel live={false} />)
    const link = await screen.findByTestId('parent-material')
    expect(link.textContent).toBe('Tier A practice')
    expect(link.getAttribute('href')).toBe(HREF)
  })
})

describe('console before consent', () => {
  it('hard right now names the missing consent instead of "offline"', async () => {
    const noConsent = { ...CLASS, consent: { consent_recorded: false, school_as_agent: false, banner: 'Before students join, record consent for this class.' } }
    installFetch((url) => {
      if (url.endsWith('/api/classroom/classes')) return ok({ classes: [noConsent] })
      if (url.includes('/hard-now')) return { status: 403, body: { detail: { code: 'classroom_consent_required' } } }
      return teacherRoute(url)
    })
    render(<ClassroomConsolePanel academyBase={ACADEMY} />)
    const note = await screen.findByTestId('hard-now-needs-consent')
    expect(note.textContent).toMatch(/once the school's consent is recorded/)
    expect(screen.getByTestId('classroom-hard-now').textContent).not.toMatch(/offline/)
  })
})

describe('offline: a rejected fetch renders dim "offline", never placeholders', () => {
  it.each([
    ['console', () => <ClassroomConsolePanel academyBase={ACADEMY} />],
    ['roster', () => <ClassroomRosterSheet classId="cls_1" />],
    ['insights', () => <ClassroomInsightsPanel classId="cls_1" live={false} />],
    ['room', () => <ClassroomRoomPanel classId="cls_1" pollMs={0} />],
    ['parent', () => <ClassroomParentPanel live={false} />],
  ])('%s', async (_name, make) => {
    rejectFetch()
    render(make())
    const offline = await screen.findAllByTestId('classroom-offline')
    expect(offline[0].textContent).toMatch(/offline/)
  })

  it('studio: a draft that cannot reach the service says offline', async () => {
    rejectFetch()
    render(<ClassroomStudioPanel classId="cls_1" academyBase={ACADEMY} />)
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'Make ten' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Draft lesson' })) })
    expect(screen.getByTestId('studio-msg').textContent).toMatch(/^offline/)
  })

  it('kid card: not in a class (404) or unreachable renders nothing at all', async () => {
    installFetch(() => undefined)
    const a = render(<KidAssignmentsCard questId="q1" />)
    await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(0))
    expect(a.container.innerHTML).toBe('')
    a.unmount()
    rejectFetch()
    const b = render(<KidAssignmentsCard />)
    await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(0))
    expect(b.container.innerHTML).toBe('')
  })

  it('kid card: easy / ok / hard chips post the enum only', async () => {
    const calls = installFetch((url) => {
      if (url.endsWith('/me/assignments')) return ok({ assignments: [] })
      if (url.endsWith('/rating')) return { status: 201, body: { ok: true, rating: 'hard' } }
      return undefined
    })
    render(<KidAssignmentsCard questId="q_7" />)
    await screen.findByTestId('kid-rating')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Hard' })) })
    const post = calls.find((c) => c.url.endsWith('/me/quest/q_7/rating'))
    expect(JSON.parse(String(post?.init?.body))).toEqual({ rating: 'hard' })
    expect(screen.getByTestId('kid-rating').textContent).toMatch(/Thanks/)
  })
})

const PANELS = path.join(__dirname, '..', 'panels')
const NEW_FILES = [
  'classroomApi.ts', 'ClassroomConsolePanel.tsx', 'ClassroomRosterSheet.tsx', 'ClassroomStudioPanel.tsx',
  'ClassroomInsightsPanel.tsx', 'ClassroomRoomPanel.tsx', 'ClassroomParentPanel.tsx', 'KidAssignmentsCard.tsx', 'KidAssignmentView.tsx',
]

describe('source rules', () => {
  it('the classroom files paint only through the Learn tokens (no hex / rgb literal)', () => {
    const offenders: string[] = []
    for (const f of NEW_FILES) {
      fs.readFileSync(path.join(PANELS, f), 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
        if (/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('no classroom file names a diagnosis or a label', () => {
    const banned = /\b(adhd|dyslexi\w*|autis\w*|disorder|diagnos(?!es\b)\w*|deficit|lazy|behind grade)\b/i
    for (const f of NEW_FILES) {
      const src = fs.readFileSync(path.join(PANELS, f), 'utf8').replace(/not diagnoses|or diagnoses/gi, '')
      expect([f, banned.exec(src)?.[0] ?? null]).toEqual([f, null])
    }
  })

  it('every explicit ./panels/<Name> export (src and dist) names a real module', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'))
    const need = [
      'learnTheme', 'learnParts', 'KidQuestPanel', 'FamilyTutorConsolePanel', 'AcademyMirrorCard', 'AcademyAnalyticsPanel',
      'AcademyLessonStudioPanel', 'AcademyStudentProfilesPanel', 'AcademyLessonsPanel',
      ...NEW_FILES.map((f) => f.replace(/\.tsx?$/, '')),
    ]
    for (const name of need) {
      const src = pkg.exports[`./panels/${name}`]
      const dist = pkg.publishConfig.exports[`./panels/${name}`]
      expect([name, !!src, !!dist]).toEqual([name, true, true])
      expect(fs.existsSync(path.join(__dirname, '..', '..', src.import))).toBe(true)
      expect(src.types).toBe(src.import)
      expect(dist.import).toBe(`./dist/panels/${name}.js`)
    }
  })
})
