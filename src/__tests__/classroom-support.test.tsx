/**
 * The Classroom support suite panels (awkit): Quick Tally pins, the teacher's Support
 * Passport, the substitute's view, the Family Support Portal and the workload page.
 *
 * Proved against a fake proxy: a tap is ONE POST and the count moves; undo is a DELETE of
 * that mark; a non-teacher (404) sees no tiles at all; staff notes carry no sharing
 * switch; the substitute's token rides a header and never the URL, and an ended link
 * says so without a retry loop; a family sees the meeting's purpose, questions and only
 * the listed documents; the glossary search narrows the list. Every new file paints only
 * through the Learn tokens.
 */
import React from 'react'
import fs from 'fs'
import path from 'path'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ClassroomTallyPins from '../panels/ClassroomTallyPins'
import ClassroomSupportPanel from '../panels/ClassroomSupportPanel'
import { SubstituteView } from '../panels/ClassroomSubPlanPanel'
import ClassroomFamilySupportPanel from '../panels/ClassroomFamilySupportPanel'
import ClassroomWellnessPanel from '../panels/ClassroomWellnessPanel'
import { subLinkUrl, subTokenFromHash } from '../panels/classroomSupportApi'

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

const ok = (body: unknown): Reply => ({ status: 200, body })
const days = (n: number, last = 0) => Array.from({ length: n }, (_x, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, count: i === n - 1 ? last : 0 }))
const TILE = { id: 'tly_1', label: 'Call-outs', member_id: 'mbr_a', alias: 'Ana', today: 2, series: days(7, 2), total_14d: 2 }
const TOKEN = 'sub_' + 'Q'.repeat(32)

describe('ClassroomTallyPins', () => {
  it('one tap is one POST and the count moves; undo deletes that mark', async () => {
    const calls = installFetch((url, init) => {
      if (url.includes('/pins')) return ok({ tiles: [TILE] })
      if (url.includes('/marks/') && init?.method === 'DELETE') return ok({ counter: { ...TILE, today: 2 } })
      if (url.includes('/marks') && init?.method === 'POST') return ok({ mark_id: 41, at: 'x', counter: { ...TILE, today: 3 } })
      return undefined
    })
    render(<ClassroomTallyPins classId="cls_1" supportHref="/classroom/cls_1/support" />)
    expect(await screen.findByText('Call-outs')).toBeTruthy()
    expect(screen.getByText('Ana')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByTestId('sp-tally-plus')) })
    await waitFor(() => expect(screen.getByTestId('sp-tally-today').textContent).toContain('3'))
    const posts = calls.filter((c) => c.init?.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0].url).toMatch(/^\/api\/classroom-support\/classes\/cls_1\/tallies\/tly_1\/marks\?tz=-?\d+$/)
    await act(async () => { fireEvent.click(screen.getByTestId('sp-tally-undo')) })
    await waitFor(() => expect(screen.getByTestId('sp-tally-today').textContent).toContain('2'))
    expect(calls.some((c) => c.init?.method === 'DELETE' && c.url.includes('/marks/41'))).toBe(true)
  })

  it('a caller who is not the teacher (404) sees nothing at all', async () => {
    installFetch(() => undefined)
    const { container } = render(<ClassroomTallyPins classId="cls_1" />)
    await waitFor(() => expect(container.querySelector('[data-testid="classroom-tally-pins"]')).toBeNull())
  })

  it('no pins yet says how to pin', async () => {
    installFetch((url) => (url.includes('/pins') ? ok({ tiles: [] }) : undefined))
    render(<ClassroomTallyPins classId="cls_1" />)
    expect(await screen.findByTestId('classroom-tally-pins-empty')).toBeTruthy()
  })
})

const SECTIONS = [
  ['strengths', 'Strengths', true, true], ['interests', 'Interests', true, true],
  ['learning_preferences', 'How they learn best', true, true], ['strategies', 'Strategies and interventions tried', true, false],
  ['goals', 'Goals and progress', true, true], ['accommodations', 'Accommodations and who does what', true, false],
  ['what_works', 'What works', true, false], ['reviews', 'Upcoming reviews and open actions', true, false],
  ['data', 'Data collection', false, false], ['staff_notes', 'Staff notes', false, false],
].map(([section, title, fam, stuOk]) => ({
  section, title, share_family: fam, share_student: false, student_may_see: stuOk, never_shared: section === 'staff_notes',
  updated_at: null,
  body: section === 'reviews' ? { upcoming: [], actions: [] } : section === 'staff_notes' ? { text: '' } : section === 'data' ? {} : { items: section === 'strengths' ? ['Kind'] : [] },
}))

describe('ClassroomSupportPanel', () => {
  it('lists the class, opens a passport, never offers to share staff notes, and saves a line', async () => {
    const calls = installFetch((url, init) => {
      if (url.endsWith('/classes/cls_1/students')) return ok({ class_id: 'cls_1', class_name: 'Room 4', pinned: [], students: [
        { member_id: 'mbr_a', alias: 'Ana', sections_filled: 1, sections_total: 9, next_review: '2026-11-02', open_actions: 1, counters: 0 }] })
      if (url.includes('/passport?')) return ok({ student: { member_id: 'mbr_a', alias: 'Ana' }, sections: SECTIONS, counters: [], pinned: [] })
      if (url.includes('/tallies?')) return ok({ counters: [], log: [], pinned: [] })
      if (url.includes('/meetings')) return ok({ meetings: [], kinds: {} })
      if (url.includes('/passport/interests') && init?.method === 'PUT') {
        return ok({ section: 'interests', body: JSON.parse(String(init.body)).body, share_family: true, share_student: true, updated_at: 'now' })
      }
      if (url.includes('/sharing/strengths')) return ok({ section: 'strengths', share_family: false, share_student: false })
      return undefined
    })
    render(<ClassroomSupportPanel classId="cls_1" />)
    fireEvent.click(await screen.findByText('Ana'))
    expect(await screen.findByTestId('sp-passport')).toBeTruthy()
    const notes = screen.getByTestId('sp-section-staff_notes')
    expect(notes.querySelector('input[type="checkbox"]')).toBeNull()
    expect(screen.getByTestId('sp-never-shared')).toBeTruthy()
    expect(screen.queryByTestId('sp-share-student-strategies')).toBeNull()
    expect(screen.getByTestId('sp-share-student-strengths')).toBeTruthy()

    const lines = screen.getByTestId('sp-lines-interests')
    fireEvent.change(lines.querySelector('input')!, { target: { value: 'Dinosaurs' } })
    await act(async () => { fireEvent.submit(lines.querySelector('form')!) })
    const put = calls.find((c) => c.url.includes('/passport/interests'))
    expect(put && JSON.parse(String(put.init?.body))).toEqual({ body: { items: ['Dinosaurs'] } })

    await act(async () => { fireEvent.click(screen.getByTestId('sp-share-family-strengths')) })
    const share = calls.find((c) => c.url.includes('/sharing/strengths'))
    expect(share && JSON.parse(String(share.init?.body))).toEqual({ share_family: false })
  })

  it('a class that is not yours reads as not found', async () => {
    installFetch(() => undefined)
    render(<ClassroomSupportPanel classId="cls_x" />)
    expect(await screen.findByTestId('sp-missing')).toBeTruthy()
  })
})

describe('SubstituteView', () => {
  it('sends the token in X-Sub-Pass, never in the URL', async () => {
    const calls = installFetch((url) => (url === '/api/classroom-support/sub/plan' ? ok({
      class_name: 'Room 4', expires_at: '2026-10-19T23:00:00+00:00',
      plan: { title: 'Monday', day: '2026-10-19', schedule: [{ time: '8:30', what: 'Morning meeting' }], lessons: [],
        seating: { rows: 1, cols: 2, seats: [{ r: 0, c: 0, name: 'Ana' }] }, routines: [], emergency: ['Fire: exit left'], contacts: [] },
    }) : undefined))
    render(<SubstituteView hash={`#t=${TOKEN}`} />)
    expect(await screen.findByText('Monday')).toBeTruthy()
    expect(screen.getByText('Fire: exit left')).toBeTruthy()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).not.toContain(TOKEN)
    expect((calls[0].init?.headers as Record<string, string>)['X-Sub-Pass']).toBe(TOKEN)
  })

  it('an ended link says so; no token never calls anything', async () => {
    installFetch(() => undefined)
    render(<SubstituteView hash={`#t=${TOKEN}`} />)
    expect(await screen.findByTestId('substitute-ended')).toBeTruthy()
    const calls = installFetch(() => undefined)
    render(<SubstituteView hash="#t=not-a-token" />)
    expect((await screen.findAllByTestId('substitute-ended')).length).toBeGreaterThan(0)
    expect(calls).toHaveLength(0)
  })

  it('the shared link keeps the token in the fragment', () => {
    expect(subLinkUrl('https://app.aitherium.com/', TOKEN)).toBe(`https://app.aitherium.com/classroom/sub#t=${TOKEN}`)
    expect(subTokenFromHash(`#t=${TOKEN}`)).toBe(TOKEN)
    for (const bad of ['', '#t=', '#t=abc', `#x=${TOKEN}`]) expect(subTokenFromHash(bad)).toBeNull()
  })
})

describe('ClassroomFamilySupportPanel', () => {
  it('shows the meeting purpose, questions and only the listed documents, and searches the glossary', async () => {
    installFetch((url) => {
      if (url === '/api/classroom-support/family/children') return ok({ children: [{ class_id: 'cls_1', member_id: 'mbr_a', alias: 'Ana', class_name: 'Room 4', teacher_hours: null }] })
      if (url === '/api/classroom-support/family/glossary') return ok({ note: 'US terms.', terms: [
        { term: 'PLAAFP', full: 'Present Levels', plain: 'Where your child is now.' },
        { term: 'MTSS', full: 'Multi-Tiered System of Supports', plain: 'How a school organises help.' }] })
      if (url.includes('/passport?')) return ok({ student: { member_id: 'mbr_a', alias: 'Ana' }, data: null,
        sections: [{ section: 'strengths', title: 'Strengths', body: { items: ['Kind'] }, updated_at: null }] })
      if (url.includes('/meetings')) return ok({ meetings: [{ id: 'm1', title: 'Annual IEP', kind: 'iep_annual', kind_title: 'Annual IEP meeting',
        at: '2026-11-02T15:30:00+00:00', where: 'Room 4', purpose: 'Review the goals', teacher_questions: ['Can we keep the timer?'],
        suggested_questions: ['What is going well?'], documents: [{ title: 'Goals so far', section: 'goals' }], past: false }] })
      return undefined
    })
    render(<ClassroomFamilySupportPanel />)
    expect(await screen.findByText('Review the goals')).toBeTruthy()
    expect(screen.getByText('Can we keep the timer?')).toBeTruthy()
    expect(screen.getByText('Goals so far')).toBeTruthy()
    expect(screen.getByText('Kind')).toBeTruthy()
    expect(screen.getAllByTestId('glossary-term')).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('Look up a word'), { target: { value: 'plaafp' } })
    expect(screen.getAllByTestId('glossary-term')).toHaveLength(1)
  })
})

describe('ClassroomWellnessPanel', () => {
  it('ranks the do-first list and logs time in one tap', async () => {
    const view = {
      days: 14, total_minutes: 90, categories: [{ category: 'paperwork', title: 'IEP / 504 paperwork', minutes: 90, share: 1 }],
      per_day: days(14).map((d) => ({ day: d.day, minutes: 0 })), entries: [],
      tasks: [{ id: 't1', text: 'Overdue report', category: 'paperwork', due: '2026-10-10', minutes: null, done: false, bucket: 'overdue' }],
      do_first: [], done_recently: 0, category_titles: { paperwork: 'IEP / 504 paperwork', other: 'Other' },
      prefs: { quiet_start: '17:00', quiet_end: '07:30', quiet_weekends: true, auto_reply: '', reply_within_hours: 48, share_hours_with_families: false },
    }
    const calls = installFetch((url, init) => {
      if (url === '/api/classroom-support/wellness') return ok(view)
      if (url === '/api/classroom-support/wellness/time' && init?.method === 'POST') return { status: 201, body: { id: 'w1' } }
      return undefined
    })
    render(<ClassroomWellnessPanel />)
    expect(await screen.findByText('Overdue report')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByTestId('wellness-log-15')) })
    const post = calls.find((c) => c.url.endsWith('/wellness/time'))
    expect(post && JSON.parse(String(post.init?.body))).toEqual({ category: 'paperwork', minutes: 15 })
  })
})

describe('the support files paint only through the tokens', () => {
  it('has no literal colour', () => {
    const dir = path.join(__dirname, '..', 'panels')
    const files = ['supportParts.tsx', 'ClassroomTallyPins.tsx', 'ClassroomSupportPanel.tsx', 'ClassroomSubPlanPanel.tsx',
      'ClassroomFamilySupportPanel.tsx', 'ClassroomWellnessPanel.tsx']
    const offenders: string[] = []
    for (const f of files) {
      fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
        if (/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(line)) offenders.push(`${f}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
