/**
 * ClassroomNoticesBell (awkit): the bell a parent sees in the family panel.
 *  - nothing at all while the service has no notices route (404), a dim "offline"
 *    bell when the fetch is rejected, a count when something is unread;
 *  - opening the list marks it read and shows the caller's own child + class only;
 *  - the three choices (email / here only / off) are saved per class, and a failed
 *    save says so and keeps the earlier choice;
 *  - the copy says what an email carries (nothing about a child) and never a price;
 *  - it paints only through the Learn tokens, in dark and light.
 * Runs under AitherVeil's jest (roots include awkit/src).
 */
import React from 'react'
import fs from 'fs'
import path from 'path'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ClassroomNoticesBell, { noticeAge } from '../panels/ClassroomNoticesBell'
import ClassroomParentPanel from '../panels/ClassroomParentPanel'
import ClassroomConsolePanel from '../panels/ClassroomConsolePanel'
import { LEARN_TOKENS } from '../panels/learnTheme'

type Reply = { status: number; body: unknown }
type Call = { url: string; init?: RequestInit }

function installFetch(route: (url: string, init?: RequestInit) => Reply | undefined) {
  const calls: Call[] = []
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const r = route(url, init) ?? { status: 404, body: { detail: 'Not found' } }
    return { status: r.status, ok: r.status >= 200 && r.status < 300, statusText: '', json: async () => r.body } as unknown as Response
  })
  return calls
}

const ok = (body: unknown): Reply => ({ status: 200, body })

const NOTICES = {
  unread: 2,
  notices: [
    { id: 'ntc_1', event: 'work_assigned', audience: 'parent', text: 'New work was assigned.', class_id: 'cls_1', class_name: 'Room 4', alias: 'Ada', member_id: 'm_a', created_at: '2026-10-01T13:50:00+00:00', read: false },
    { id: 'ntc_2', event: 'announcement', audience: 'parent', text: 'The teacher posted an announcement.', class_id: 'cls_1', class_name: 'Room 4', alias: null, member_id: null, created_at: '2026-10-01T09:00:00+00:00', read: false },
    { id: 'ntc_3', event: 'weekly_ready', audience: 'parent', text: 'The weekly review is ready.', class_id: 'cls_1', class_name: 'Room 4', alias: 'Ada', member_id: 'm_a', created_at: '2026-09-26T16:00:00+00:00', read: true },
  ],
}
const PREFS = {
  classes: [{ class_id: 'cls_1', class_name: 'Room 4', audience: 'parent', mode: 'email', default: 'email' }],
  modes: ['email', 'in_app', 'off'],
  email_hint: 'm***@family.org',
}

function bellRoute(over: Partial<Record<'notices' | 'prefs' | 'put' | 'read', Reply>> = {}) {
  return (url: string, init?: RequestInit): Reply | undefined => {
    if (url.endsWith('/notify/notices')) return over.notices ?? ok(NOTICES)
    if (url.endsWith('/notify/notices/read')) return over.read ?? ok({ marked: 2, unread: 0 })
    if (url.endsWith('/notify/preferences') && init?.method === 'PUT') return over.put ?? ok({ class_id: 'cls_1', audience: 'parent', mode: JSON.parse(String(init.body)).mode })
    if (url.endsWith('/notify/preferences')) return over.prefs ?? ok(PREFS)
    return undefined
  }
}

const bell = () => <ClassroomNoticesBell mode="dark" host={null} pollMs={0} />

describe('ClassroomNoticesBell', () => {
  it('shows the unread count, opens the list, and marks it read', async () => {
    const calls = installFetch(bellRoute())
    render(bell())
    const btn = await screen.findByTestId('classroom-bell')
    expect(screen.getByTestId('classroom-bell-count').textContent).toBe('2 new')
    expect(btn.getAttribute('aria-label')).toBe('Notices, 2 new')
    await act(async () => { fireEvent.click(btn) })
    const list = await screen.findByTestId('notices-list')
    expect(list.textContent).toMatch(/New work was assigned\./)
    expect(list.textContent).toMatch(/Ada · Room 4/)
    expect(list.querySelectorAll('[data-unread]')).toHaveLength(2)
    const read = calls.find((c) => c.url.endsWith('/notify/notices/read'))
    expect(read?.init?.method).toBe('POST')
    // Reading is reading what was SHOWN: the unread ids on the list, never "everything".
    expect(JSON.parse(String(read?.init?.body))).toEqual({ ids: ['ntc_1', 'ntc_2'] })
    await waitFor(() => expect(screen.getByTestId('classroom-bell-count').textContent).toBe('notices'))
    // The sheet is a dialog with a close control; closing it removes the list.
    expect(screen.getByRole('dialog', { name: 'Notices' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('classroom-notices')).toBeNull()
  })

  it('saves a choice per class and says what an email carries', async () => {
    const calls = installFetch(bellRoute())
    render(bell())
    const btn = await screen.findByTestId('classroom-bell')
    await act(async () => { fireEvent.click(btn) })
    const email = await screen.findByTestId('pref-cls_1-email')
    expect(email.getAttribute('aria-pressed')).toBe('true')
    const note = screen.getByTestId('notice-mail-note').textContent || ''
    expect(note).toMatch(/m\*\*\*@family\.org/)
    expect(note).toMatch(/only says something is waiting/)
    expect(note).toMatch(/one-click link to stop it/)
    await act(async () => { fireEvent.click(screen.getByTestId('pref-cls_1-off')) })
    const put = calls.find((c) => c.init?.method === 'PUT')
    expect(JSON.parse(String(put?.init?.body))).toEqual({ class_id: 'cls_1', mode: 'off' })
    expect(screen.getByTestId('pref-cls_1-off').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('pref-cls_1-email').getAttribute('aria-pressed')).toBe('false')
    // Every choice is a 44px tap target.
    for (const m of ['email', 'in_app', 'off']) {
      expect((screen.getByTestId(`pref-cls_1-${m}`) as HTMLElement).style.minHeight).toBe('44px')
    }
  })

  it('a failed save keeps the earlier choice and says so', async () => {
    installFetch(bellRoute({ put: { status: 503, body: { detail: { notices: 'offline' } } } }))
    render(bell())
    const btn = await screen.findByTestId('classroom-bell')
    await act(async () => { fireEvent.click(btn) })
    await screen.findByTestId('pref-cls_1-email')
    await act(async () => { fireEvent.click(screen.getByTestId('pref-cls_1-in_app')) })
    expect(screen.getByRole('alert').textContent).toMatch(/Not saved/)
    expect(screen.getByTestId('pref-cls_1-email').getAttribute('aria-pressed')).toBe('true')
  })

  it('empty: says what will show here, and no address means here only', async () => {
    installFetch(bellRoute({ notices: ok({ notices: [], unread: 0 }), prefs: ok({ ...PREFS, email_hint: null }) }))
    render(bell())
    const btn = await screen.findByTestId('classroom-bell')
    expect(screen.getByTestId('classroom-bell-count').textContent).toBe('notices')
    await act(async () => { fireEvent.click(btn) })
    expect((await screen.findByTestId('notices-empty')).textContent).toMatch(/Nothing new/)
    await waitFor(() => expect(screen.getByTestId('notice-mail-note').textContent).toMatch(/notices show here only/))
  })

  it('no notices route (404): renders nothing at all', async () => {
    installFetch(() => undefined)
    const view = render(bell())
    await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.length).toBe(1))
    await act(async () => { await Promise.resolve() })
    expect(view.container.innerHTML).toBe('')
  })

  it('offline: a dim bell that retries, never a fake zero', async () => {
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => { throw new TypeError('Failed to fetch') })
    render(bell())
    const btn = await screen.findByTestId('classroom-bell')
    expect(screen.getByTestId('classroom-bell-count').textContent).toBe('offline')
    expect(btn.getAttribute('aria-label')).toBe('Notices, offline')
    installFetch(bellRoute())
    await act(async () => { fireEvent.click(btn) })
    await waitFor(() => expect(screen.getByTestId('classroom-bell-count').textContent).toBe('2 new'))
    expect(screen.queryByTestId('classroom-notices')).toBeNull() // a retry, not an open
  })

  it('the parent panel carries the bell beside the appearance switch', async () => {
    installFetch((url, init) => {
      if (url.endsWith('/parent/children')) return ok({ children: [] })
      return bellRoute()(url, init)
    })
    render(<ClassroomParentPanel live={false} />)
    await screen.findByTestId('parent-no-children')
    const btn = await screen.findByTestId('classroom-bell')
    expect(btn.closest('header')).toBeTruthy()
    expect(screen.getByTestId('learn-mode-switch').closest('header')).toBe(btn.closest('header'))
  })

  it('keeps the count the server answers when more is unread than the list shows', async () => {
    installFetch(bellRoute({ notices: ok({ ...NOTICES, unread: 40 }), read: ok({ marked: 2, unread: 38 }) }))
    render(bell())
    const btn = await screen.findByTestId('classroom-bell')
    expect(screen.getByTestId('classroom-bell-count').textContent).toBe('40 new')
    await act(async () => { fireEvent.click(btn) })
    await waitFor(() => expect(screen.getByTestId('classroom-bell-count').textContent).toBe('38 new'))
  })

  it('the teacher console carries the bell too (teacher notices are in-app by default)', async () => {
    const calls = installFetch((url, init) => {
      if (url.endsWith('/classes')) return ok({ classes: [] })
      return bellRoute({ notices: ok({ unread: 1, notices: [{ ...NOTICES.notices[0], id: 'ntc_t', audience: 'teacher', event: 'review_waiting', text: 'Work is waiting for your review.', alias: null, member_id: null }] }) })(url, init)
    })
    render(<ClassroomConsolePanel />)
    const btn = await screen.findByTestId('classroom-bell')
    expect(screen.getByTestId('learn-mode-switch').closest('header')).toBe(btn.closest('header'))
    expect(screen.getByTestId('classroom-bell-count').textContent).toBe('1 new')
    await act(async () => { fireEvent.click(btn) })
    expect((await screen.findByTestId('notices-list')).textContent).toMatch(/Work is waiting for your review\./)
    expect(calls.some((c) => c.url.endsWith('/notify/preferences'))).toBe(true)
  })

  it('noticeAge speaks plainly', () => {
    const now = Date.parse('2026-10-01T14:00:00Z')
    expect(noticeAge('2026-10-01T13:59:30Z', now)).toBe('just now')
    expect(noticeAge('2026-10-01T13:40:00Z', now)).toBe('20 min ago')
    expect(noticeAge('2026-10-01T09:00:00Z', now)).toBe('5 h ago')
    expect(noticeAge('2026-09-29T14:00:00Z', now)).toBe('2 d ago')
    expect(noticeAge('2026-09-01T14:00:00Z', now)).toBe('2026-09-01')
    expect(noticeAge('not a date', now)).toBe('')
  })
})

describe('ClassroomNoticesBell source', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'panels', 'ClassroomNoticesBell.tsx'), 'utf8')

  it('paints only through the Learn tokens (no literal colour)', () => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(code).not.toMatch(/rgba?\(/)
    for (const mode of ['dark', 'light'] as const) expect(LEARN_TOKENS[mode].accent).toBeTruthy()
  })

  it('states no price, no free tier and no capacity promise', () => {
    expect(src).not.toMatch(/\bfree\b|\$\d|per month|unlimited|pricing/i)
  })

  it('has an explicit awkit export (wildcards fail under Turbopack)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'))
    expect(pkg.exports['./panels/ClassroomNoticesBell'].import).toBe('./src/panels/ClassroomNoticesBell.tsx')
    expect(pkg.publishConfig.exports['./panels/ClassroomNoticesBell'].import).toBe('./dist/panels/ClassroomNoticesBell.js')
    const index = fs.readFileSync(path.join(__dirname, '..', 'panels', 'index.ts'), 'utf8')
    expect(index).toMatch(/export \{ default as ClassroomNoticesBell \} from '\.\/ClassroomNoticesBell'/)
  })
})
