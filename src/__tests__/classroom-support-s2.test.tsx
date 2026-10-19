/**
 * Classroom support suite, second pass: the student's own child-safe card, AI drafts the
 * teacher edits (never sends), quiet hours on the Wellness page and the family's
 * auto-reply after writing during quiet hours.
 *
 * Proved against a fake proxy:
 * - KidSupportCard calls ONLY /api/tutor/me/* (the child allowlist), FAILS CLOSED (an
 *   error, a 403/404 or an empty answer renders nothing), renders no link, image, price,
 *   streak or count, drops fields it does not know, and a check-in is a fixed choice;
 * - a draft lands in an editable box with Copy and NO send button, and says when it is
 *   only the template;
 * - saving boundaries sends the device's time zone and the hold switch;
 * - a parent who writes in quiet hours sees the teacher's auto-reply.
 */
import React from 'react'
import fs from 'fs'
import path from 'path'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import KidSupportCard, { safeClasses } from '../panels/KidSupportCard'
import ClassroomSupportPanel from '../panels/ClassroomSupportPanel'
import ClassroomWellnessPanel from '../panels/ClassroomWellnessPanel'
import ClassroomParentPanel from '../panels/ClassroomParentPanel'

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

const FEELINGS = [['great', 'Great'], ['okay', 'Okay'], ['tired', 'Tired'], ['worried', 'Worried'], ['upset', 'Upset']]
  .map(([feeling, title]) => ({ feeling, title }))
const VIEW = {
  classes: [{
    class_id: 'cls_1',
    class_name: 'Room 4',
    sections: [
      { section: 'strengths', title: 'What you are great at', items: ['Kind to classmates'] },
      { section: 'calm_plan', title: 'When you need a calm moment', items: ['Squeeze the stress ball', '<img src=x onerror=alert(1)>'] },
      { section: 'goals', title: 'Your goals', items: [{ goal: 'Read 60 words a minute', target: '60', progress: [{ at: '2026-10-01', value: '48' }] }] },
    ],
    checkin: { feelings: FEELINGS, latest: null },
    // fields a careless server might add: never rendered
    staff_notes: 'SECRET-STAFF-NOTE', streak: 7, store_url: 'https://shop.example/buy',
  }],
}

describe('KidSupportCard (the student view)', () => {
  it('shows only shared supports, calls only the child door, and a check-in is one fixed tap', async () => {
    const calls = installFetch((url, init) => {
      if (url === '/api/tutor/me/support-passport') return ok(VIEW)
      if (url === '/api/tutor/me/support-checkin' && init?.method === 'POST') return { status: 201, body: { feeling: 'okay', title: 'Okay', at: 'now' } }
      return undefined
    })
    const { container } = render(<KidSupportCard />)
    expect(await screen.findByTestId('kid-support')).toBeTruthy()
    expect(screen.getByText('Squeeze the stress ball')).toBeTruthy()
    expect(screen.getByText('Read 60 words a minute')).toBeTruthy()
    // teacher text is text, never markup
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy()
    // no links out, nothing to buy, no streaks or counts
    expect(container.querySelector('a')).toBeNull()
    const text = container.textContent || ''
    for (const w of ['SECRET-STAFF-NOTE', 'streak', 'shop.example', '48', 'Room 4']) expect(text).not.toContain(w)
    // no free text anywhere
    expect(container.querySelector('input, textarea')).toBeNull()
    await act(async () => { fireEvent.click(screen.getByTestId('kid-feeling-okay')) })
    await waitFor(() => expect(screen.getByTestId('kid-support-told').textContent).toContain('Okay'))
    expect(screen.getByTestId('kid-support-told').textContent).toContain('tell a grown-up near you')
    const post = calls.find((c) => c.init?.method === 'POST')
    expect(post && JSON.parse(String(post.init?.body))).toEqual({ class_id: 'cls_1', feeling: 'okay' })
    expect(calls.every((c) => c.url.startsWith('/api/tutor/me/'))).toBe(true)
  })

  it.each([
    ['a 403', { status: 403, body: { detail: 'Forbidden' } }],
    ['a 404', { status: 404, body: { detail: 'Not found' } }],
    ['a 500', { status: 500, body: null }],
    ['nothing shared', { status: 200, body: { classes: [] } }],
    ['a malformed answer', { status: 200, body: { classes: 'oops' } }],
  ])('fails closed on %s: renders nothing at all', async (_name, reply) => {
    installFetch(() => reply as Reply)
    const { container } = render(<KidSupportCard />)
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(container.innerHTML).toBe('')
  })

  it('drops unknown feelings and section shapes', () => {
    const out = safeClasses({ classes: [{ class_id: 'c', sections: [{ section: 's', title: 'T', items: [{ html: '<b>' }, 'ok'] }],
      checkin: { feelings: [{ feeling: 'buy_gems', title: 'Buy gems' }, { feeling: 'okay', title: 'Okay' }], latest: null } }] })
    expect(out[0].sections[0].items).toEqual(['ok'])
    expect(out[0].checkin.feelings.map((f) => f.feeling)).toEqual(['okay'])
  })

  it('the card file paints through tokens and holds no link or purchase code', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'panels', 'KidSupportCard.tsx'), 'utf8')
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
    expect(code).not.toMatch(/<a\b|href=|window\.open|dangerouslySetInnerHTML|<img\b|checkout|purchase/i)
  })
})

const SECTIONS = ['strengths', 'interests', 'learning_preferences', 'calm_plan', 'strategies', 'goals', 'accommodations',
  'what_works', 'reviews', 'data', 'staff_notes'].map((section) => ({
  section, title: section, share_family: section !== 'staff_notes' && section !== 'data', share_student: false,
  student_may_see: ['strengths', 'interests', 'learning_preferences', 'calm_plan', 'goals'].includes(section),
  never_shared: section === 'staff_notes', updated_at: null,
  body: section === 'reviews' ? { upcoming: [], actions: [] } : section === 'staff_notes' ? { text: '' } : section === 'data' ? {} : { items: [] },
}))

describe('AI drafts in the teacher passport', () => {
  it('drafts into an editable box with Copy and no send button', async () => {
    const calls = installFetch((url, init) => {
      if (url.endsWith('/classes/cls_1/students')) return ok({ class_id: 'cls_1', class_name: 'Room 4', pinned: [], students: [
        { member_id: 'mbr_a', alias: 'Ana', sections_filled: 1, sections_total: 10, next_review: null, open_actions: 0, counters: 0 }] })
      if (url.includes('/passport?')) return ok({ student: { member_id: 'mbr_a', alias: 'Ana' }, sections: SECTIONS, counters: [], pinned: [],
        checkins: [{ at: '2026-10-14T15:00:00+00:00', feeling: 'worried', title: 'Worried' }] })
      if (url.includes('/tallies?')) return ok({ counters: [], log: [], pinned: [] })
      if (url.includes('/meetings')) return ok({ meetings: [], kinds: {} })
      if (url.includes('/drafts/family-update') && init?.method === 'POST') return ok({
        kind: 'family_update', draft: 'Ana had a strong week.', source: 'template', reason: 'ai_off', warnings: [],
        used_sections: ['strengths'], auto_send: false, note: 'A suggestion only. Read it, change anything, then send it yourself.' })
      return undefined
    })
    render(<ClassroomSupportPanel classId="cls_1" initialMember="mbr_a" />)
    expect(await screen.findByTestId('sp-passport')).toBeTruthy()
    expect(screen.getByTestId('sp-checkins').textContent).toContain('Worried')
    expect(screen.getByTestId('sp-lines-calm_plan')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByTestId('sp-draft-family-go')) })
    const box = await screen.findByTestId('sp-draft-family-text') as HTMLTextAreaElement
    expect(box.value).toBe('Ana had a strong week.')
    fireEvent.change(box, { target: { value: 'Edited by me' } })
    expect((screen.getByTestId('sp-draft-family-text') as HTMLTextAreaElement).value).toBe('Edited by me')
    expect(screen.getByTestId('sp-draft-family-template')).toBeTruthy()
    const tile = screen.getByTestId('sp-draft-family')
    const buttons = Array.from(tile.querySelectorAll('button')).map((b) => (b.textContent || '').toLowerCase())
    expect(buttons.some((b) => b.includes('send'))).toBe(false)
    expect(buttons.some((b) => b.includes('copy'))).toBe(true)
    const post = calls.find((c) => c.url.includes('/drafts/family-update'))
    expect(post?.url).toBe('/api/classroom-support/classes/cls_1/students/mbr_a/drafts/family-update')
  })
})

describe('ClassroomWellnessPanel quiet hours', () => {
  it('saves the device time zone and the hold switch', async () => {
    const view = {
      days: 14, total_minutes: 0, categories: [], per_day: [], entries: [], tasks: [], do_first: [], done_recently: 0,
      category_titles: { other: 'Other' },
      prefs: { quiet_start: '17:00', quiet_end: '07:30', quiet_weekends: true, auto_reply: '', reply_within_hours: 48,
        share_hours_with_families: false, tz: '', hold_family_messages: true },
    }
    const calls = installFetch((url, init) => {
      if (url === '/api/classroom-support/wellness') return ok(view)
      if (url === '/api/classroom-support/wellness/prefs' && init?.method === 'PUT') return ok(JSON.parse(String(init.body)))
      return undefined
    })
    render(<ClassroomWellnessPanel />)
    expect(await screen.findByTestId('wellness-hold')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByTestId('wellness-save-prefs')) })
    const put = calls.find((c) => c.url.endsWith('/wellness/prefs'))
    const body = put && JSON.parse(String(put.init?.body))
    expect(body.hold_family_messages).toBe(true)
    expect(body.tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })
})

describe('ClassroomParentPanel quiet hours', () => {
  it('a parent who writes in quiet hours sees the teacher auto-reply', async () => {
    const CHILD = { student_user_id: 'u_a', alias: 'Ada', class_id: 'cls_1', class_name: 'Room 4', subject: 'Math' }
    installFetch((url, init) => {
      if (url.endsWith('/parent/children')) return ok({ children: [CHILD] })
      if (url.endsWith('/progress')) return ok({ areas: {}, timeline: [] })
      if (url.endsWith('/weekly')) return ok({ observations: [], source: 'template' })
      if (url.endsWith('/room/state')) return ok({
        role: 'parent', class: { class_id: 'cls_1', name: 'Room 4' }, room: { workspace: 'x', status: 'ok' },
        announcements: [], threads: [{ member_id: 'm_a', alias: 'Ada', messages: [], status: 'ok' }], materials: { status: 'ok', items: [] },
      })
      if (url.endsWith('/threads/m_a/messages') && init?.method === 'POST') {
        return { status: 201, body: { sent: true, member_id: 'm_a', id: 'x', quiet: { held: true, auto_reply: 'I answer messages on school days by 4pm.' } } }
      }
      return undefined
    })
    render(<ClassroomParentPanel live={false} />)
    const box = await screen.findByLabelText('Message the teacher')
    fireEvent.change(box, { target: { value: 'Question about homework' } })
    await act(async () => { fireEvent.submit(box.closest('form')!) })
    expect((await screen.findByTestId('parent-quiet-reply')).textContent).toContain('I answer messages on school days by 4pm.')
  })
})
