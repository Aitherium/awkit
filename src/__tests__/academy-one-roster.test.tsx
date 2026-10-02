/**
 * One roster, one way to Aither Classroom.
 *
 * The Academy record panels (Lesson Library, Learning Profiles, Mastery
 * Analytics) sit beside Aither Classroom. What a teacher reads in them has to be
 * true of the class in front of them:
 *
 *  - a class that IS in Classroom: no Enrol form and no roster import here (that
 *    would be a second roster with no account, no join code and no consent
 *    check), and a LINK to Classroom;
 *  - a class made on the Academy API: its own roster stays, and its teacher can
 *    move it to Classroom, which is otherwise unable to list it;
 *  - no class at all: a link to where a class is made, never bare words;
 *  - a retired panel id: a visible notice with a link, not a vanished tab.
 *
 * Runs under AitherVeil's jest (roots include awkit/src).
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AcademyStudentProfilesPanel from '../panels/AcademyStudentProfilesPanel'
import AcademyAnalyticsPanel from '../panels/AcademyAnalyticsPanel'
import AcademyLessonsPanel from '../panels/AcademyLessonsPanel'
import AcademyClassroomBridge from '../panels/AcademyClassroomBridge'
import RetiredPanelNotice from '../panels/RetiredPanelNotice'
import { CLASSROOM_PUBLIC_DOOR, classroomHref } from '../panels/academyApi'
import { getRetiredPanel } from '../panels/registry'

type Reply = { status: number; body: unknown }
type Call = { url: string; method: string }

function installFetch(route: (url: string, method: string) => Reply | undefined): Call[] {
  const calls: Call[] = []
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method || 'GET').toUpperCase()
    calls.push({ url, method })
    const r = route(url, method) ?? { status: 404, body: { detail: 'Not found' } }
    return { status: r.status, ok: r.status >= 200 && r.status < 300, statusText: '', json: async () => r.body } as unknown as Response
  })
  return calls
}

const API = '/api/v1/academy'
const cls = (classroom: boolean | undefined, id = 'cls_1') => ({ id, name: 'Period 3', classroom })

function serve(classes: unknown[], extra?: (url: string, method: string) => Reply | undefined) {
  return installFetch((url, method) => {
    const hit = extra?.(url, method)
    if (hit) return hit
    if (url === `${API}/classes`) return { status: 200, body: { classes } }
    if (url.endsWith('/students')) return { status: 200, body: { students: [] } }
    if (url.endsWith('/lessons')) return { status: 200, body: { lessons: [] } }
    return undefined
  })
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>)['__AITHER_APP_CONFIG__']
})

describe('Learning Profiles: one roster', () => {
  it('a Classroom class shows no Enrol form and no roster import, and links to Classroom', async () => {
    serve([cls(true)])
    render(<AcademyStudentProfilesPanel />)
    const bridge = await screen.findByTestId('classroom-bridge')
    expect(bridge.getAttribute('data-state')).toBe('in-classroom')
    expect(bridge.textContent).toContain('roster')
    expect(screen.getByTestId('open-classroom').getAttribute('href')).toBe(CLASSROOM_PUBLIC_DOOR)
    expect(screen.queryByTestId('academy-enroll')).toBeNull()
    expect(screen.queryByTestId('academy-import')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enroll' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
  })

  it('a class made on the Academy API keeps its roster here and offers the move', async () => {
    serve([cls(false)])
    render(<AcademyStudentProfilesPanel />)
    const bridge = await screen.findByTestId('classroom-bridge')
    expect(bridge.getAttribute('data-state')).toBe('not-in-classroom')
    expect(screen.getByTestId('academy-enroll')).toBeTruthy()
    expect(screen.getByTestId('academy-import')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Move this class to Aither Classroom' })).toBeTruthy()
  })

  it('never says the roster is elsewhere while offering to enrol here', async () => {
    for (const flag of [true, false, undefined]) {
      serve([cls(flag)])
      const { container, unmount } = render(<AcademyStudentProfilesPanel />)
      await waitFor(() => expect(container.querySelector('select[aria-label="Class"] option')).not.toBeNull())
      await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2))
      const saysElsewhere = /roster[^.]*(is|are) (in|there)|added on the Aither Classroom roster/i.test(container.textContent || '')
      const enrolsHere = container.querySelector('[data-testid="academy-enroll"]') !== null
      expect([flag, saysElsewhere && enrolsHere]).toEqual([flag, false])
      unmount()
    }
  })

  it('an older router (no classroom field) claims nothing and keeps the form', async () => {
    serve([cls(undefined)])
    render(<AcademyStudentProfilesPanel />)
    expect(await screen.findByTestId('academy-enroll')).toBeTruthy()
    expect(screen.queryByTestId('classroom-bridge')).toBeNull()
  })

  it('the move posts to the router, reloads the classes and then hides the enrol form', async () => {
    let moved = false
    const calls = serve([], (url, method) => {
      if (url === `${API}/classes`) return { status: 200, body: { classes: [cls(moved)] } }
      if (url === `${API}/classes/cls_1/move-to-classroom` && method === 'POST') {
        moved = true
        return { status: 200, body: { class_id: 'cls_1', classroom: true, adopted: true, record_only_students: 2 } }
      }
      return undefined
    })
    render(<AcademyStudentProfilesPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Move this class to Aither Classroom' }))
    await waitFor(() => expect(screen.getByTestId('classroom-bridge').getAttribute('data-state')).toBe('in-classroom'))
    expect(calls.filter(c => c.method === 'POST').map(c => c.url)).toEqual([`${API}/classes/cls_1/move-to-classroom`])
    expect(calls.filter(c => c.url === `${API}/classes`).length).toBe(2)
    expect(screen.getByTestId('record-only-note').textContent).toContain('2 student profiles')
    await waitFor(() => expect(screen.queryByTestId('academy-enroll')).toBeNull())
  })

  it('a refused move is shown, and the class stays where it was', async () => {
    serve([cls(false)], (url, method) =>
      method === 'POST' ? { status: 404, body: { detail: 'Class not found' } } : undefined)
    render(<AcademyStudentProfilesPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Move this class to Aither Classroom' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Class not found')
    expect(screen.getByTestId('classroom-bridge').getAttribute('data-state')).toBe('not-in-classroom')
  })
})

describe('the way to Aither Classroom is always a link', () => {
  it.each([
    ['Mastery Analytics', <AcademyAnalyticsPanel key="a" />],
    ['Learning Profiles', <AcademyStudentProfilesPanel key="p" />],
    ['Lesson Library', <AcademyLessonsPanel key="l" />],
  ])('%s with no class links to where a class is made', async (_name, panel) => {
    serve([])
    render(panel)
    const bridge = await screen.findByTestId('classroom-bridge')
    expect(bridge.getAttribute('data-state')).toBe('empty')
    const link = screen.getByTestId('open-classroom')
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe(CLASSROOM_PUBLIC_DOOR)
  })

  it('a failed class list is an error, not the empty state', async () => {
    installFetch(() => ({ status: 503, body: { detail: 'Classroom store unavailable' } }))
    const { container } = render(<AcademyAnalyticsPanel />)
    await waitFor(() => expect(container.textContent).toContain('Classroom store unavailable'))
    expect(screen.queryByTestId('classroom-bridge')).toBeNull()
  })

  it('the analytics subtitle says what the registry says the panel shows', async () => {
    serve([])
    const { container } = render(<AcademyAnalyticsPanel />)
    await screen.findByTestId('classroom-bridge')
    expect(container.textContent).toContain('Mastery per standard, submission rate and lesson scores by tier')
    expect(container.textContent).not.toContain('which lessons land')
  })

  it('a Home class of Aither Learn is never offered the move', () => {
    const { container } = render(<AcademyClassroomBridge apiBase={API} cls={cls(false, 'cls_home_abc')} />)
    expect(container.textContent).toBe('')
  })

  it('a host that serves Classroom itself is linked on that host', async () => {
    ;(window as unknown as Record<string, unknown>)['__AITHER_APP_CONFIG__'] = { classroom_url: '/classroom' }
    serve([cls(true)])
    render(<AcademyLessonsPanel />)
    await screen.findByTestId('classroom-bridge')
    expect(screen.getByTestId('open-classroom').getAttribute('href')).toBe('/classroom')
  })

  it('classroomHref takes a prop, then host config, then the public door, and only real links', () => {
    expect(classroomHref()).toBe(CLASSROOM_PUBLIC_DOOR)
    expect(classroomHref('/classroom')).toBe('/classroom')
    expect(classroomHref('https://school.example/classroom')).toBe('https://school.example/classroom')
    for (const bad of ['javascript:alert(1)', '//evil.example', 'classroom', '', '  ', 'data:text/html,x']) {
      expect([bad, classroomHref(bad)]).toEqual([bad, CLASSROOM_PUBLIC_DOOR])
    }
    ;(window as unknown as Record<string, unknown>)['__AITHER_APP_CONFIG__'] = { classroom_url: 'javascript:alert(1)' }
    expect(classroomHref()).toBe(CLASSROOM_PUBLIC_DOOR)
    ;(window as unknown as Record<string, unknown>)['__AITHER_APP_CONFIG__'] = { classroom_url: '/classroom' }
    expect(classroomHref()).toBe('/classroom')
    expect(classroomHref('/school/classroom')).toBe('/school/classroom')
  })
})

describe('Lesson Library: what only the retired studio could do', () => {
  const LESSON = { id: 'lsn_1', topic: 'Fractions', status: 'draft', grade_level: '6-8', tiers: ['A', 'B', 'C'] }

  it('deletes a lesson only after it is asked twice', async () => {
    let lessons = [LESSON]
    const calls = serve([cls(true)], (url, method) => {
      if (url === `${API}/classes/cls_1/lessons`) return { status: 200, body: { lessons } }
      if (url === `${API}/classes/cls_1/lessons/lsn_1` && method === 'DELETE') {
        lessons = []
        return { status: 204, body: null }
      }
      return undefined
    })
    render(<AcademyLessonsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(calls.filter(c => c.method === 'DELETE')).toEqual([])
    expect(screen.getByTestId('confirm-delete-lesson').textContent).toContain('Delete this lesson')
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(screen.queryByTestId('confirm-delete-lesson')).toBeNull()
    expect(calls.filter(c => c.method === 'DELETE')).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(screen.queryByText('Fractions')).toBeNull())
    expect(calls.filter(c => c.method === 'DELETE').map(c => c.url)).toEqual([`${API}/classes/cls_1/lessons/lsn_1`])
  })

  it('a refused delete is shown and the lesson stays', async () => {
    serve([cls(false)], (url, method) => {
      if (url === `${API}/classes/cls_1/lessons`) return { status: 200, body: { lessons: [LESSON] } }
      if (method === 'DELETE') return { status: 403, body: { detail: 'Requires a teaching plan' } }
      return undefined
    })
    const { container } = render(<AcademyLessonsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(container.textContent).toContain('Requires a teaching plan'))
    expect(screen.getByText('Fractions')).toBeTruthy()
  })
})

describe('a retired panel leaves a notice, not a hole', () => {
  const gone = getRetiredPanel('academy-lesson-studio')!

  it('names what moved and links to the successor', () => {
    render(<RetiredPanelNotice id="academy-lesson-studio" gone={gone} />)
    const notice = screen.getByTestId('retired-panel-notice')
    expect(notice.getAttribute('data-retired-id')).toBe('academy-lesson-studio')
    expect(notice.textContent).toContain('Lesson Studio is now part of Aither Classroom')
    expect(notice.textContent).toContain(gone.note)
    const link = screen.getByRole('link', { name: 'Open Aither Classroom' })
    expect(link.getAttribute('href')).toBe(gone.door)
  })

  it('links on the host when the host serves the successor', () => {
    render(<RetiredPanelNotice id="academy-lesson-studio" gone={gone} hostUrl="/classroom" />)
    expect(screen.getByRole('link', { name: 'Open Aither Classroom' }).getAttribute('href')).toBe('/classroom')
  })
})
