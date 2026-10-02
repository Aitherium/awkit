/**
 * ClassroomSpriteStrip (awkit): the class's sprites on the teacher's roster. Name and
 * stage only, one garden number, the missing sprites hatched once per roster and only
 * with consent, "unknown" never drawn as zero, offline said as offline, nothing at all
 * on a Genesis without the route. Runs under AitherVeil's jest (roots include awkit/src).
 */
import React from 'react'
import fs from 'fs'
import path from 'path'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ClassroomSpriteStrip, { gardenLine, missingSprites, resetAbsentWarning, stageLine, type ClassSprites } from '../panels/ClassroomSpriteStrip'
import ClassroomRosterSheet from '../panels/ClassroomRosterSheet'

type Reply = { status: number; body: unknown }
type Route = (url: string, init?: RequestInit) => Reply | undefined
type Call = { url: string; init?: RequestInit }

function installFetch(route: Route) {
  const calls: Call[] = []
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const r = route(url, init) ?? { status: 404, body: { detail: 'Not found' } }
    return { status: r.status, ok: r.status >= 200 && r.status < 300, statusText: '', json: async () => r.body } as unknown as Response
  })
  return calls
}

const ok = (body: unknown): Reply => ({ status: 200, body })
const posts = (calls: Call[]) => calls.filter((c) => c.init?.method === 'POST' && c.url.endsWith('/sprites'))

const ADA_BUDDY = "Ada's Buddy"
const BEN_BUDDY = "Ben's Buddy"
const ADA = { member_id: 'm_a', alias: 'Ada', sprite: { name: ADA_BUDDY, species: 'owl', stage: 'child', stage_word: 'Little', level: 3 } }
const BEN = { member_id: 'm_b', alias: 'Ben', sprite: { name: BEN_BUDDY, species: 'sprout', stage: 'egg', stage_word: 'Egg', level: 1 } }
const FULL: ClassSprites = {
  class_id: 'cls_1', available: true, students: [ADA, BEN],
  garden: { window_days: 7, students: 2, sprites: 2, grew_this_week: 1 },
}
const HALF: ClassSprites = {
  class_id: 'cls_1', available: true, students: [ADA, { member_id: 'm_b', alias: 'Ben', sprite: null }],
  garden: { window_days: 7, students: 2, sprites: 1, grew_this_week: 0 },
}
const HATCHED = { ...FULL, hatch: { hatched: 1, already: 1, failed: 0 } }

describe('ClassroomSpriteStrip', () => {
  it('shows each sprite by name and stage, and the garden as one number', async () => {
    const calls = installFetch((url) => (url.endsWith('/classes/cls_1/sprites') ? ok(FULL) : undefined))
    render(<ClassroomSpriteStrip classId="cls_1" consentOk />)
    const ada = await screen.findByTestId('sprite-of-m_a')
    expect(ada.textContent).toContain(ADA_BUDDY)
    expect(ada.textContent).toContain('Little · level 3')
    expect(screen.getByTestId('sprite-of-m_b').textContent).toContain('Egg · level 1')
    expect(screen.getByTestId('sprite-garden-count').textContent).toBe('1')
    expect(screen.getByTestId('sprite-garden').textContent).toMatch(/of 2 sprites grew in the last 7 days/)
    expect(posts(calls)).toHaveLength(0) // every student has one: nothing to hatch
  })

  it('never draws what a sprite learned, even if a server sent it', async () => {
    const leaky = { ...FULL, students: [{ ...ADA, sprite: { ...ADA.sprite, latest_learned: 'SECRET-DIARY-LINE', knowledge_count: 9 } }] }
    installFetch((url) => (url.endsWith('/sprites') ? ok(leaky) : undefined))
    const { container } = render(<ClassroomSpriteStrip classId="cls_1" consentOk />)
    await screen.findByTestId('sprite-of-m_a')
    expect(container.textContent).not.toMatch(/SECRET-DIARY-LINE|Just learned/)
  })

  it('hatches the missing sprites once, by itself, when consent is recorded', async () => {
    const calls = installFetch((url, init) => {
      if (!url.endsWith('/sprites')) return undefined
      return ok(init?.method === 'POST' ? HATCHED : HALF)
    })
    const view = render(<ClassroomSpriteStrip classId="cls_1" consentOk refreshKey="m_a,m_b" />)
    await waitFor(() => expect(screen.getByTestId('sprite-of-m_b').textContent).toContain(BEN_BUDDY))
    expect(posts(calls)).toHaveLength(1)
    view.rerender(<ClassroomSpriteStrip classId="cls_1" consentOk refreshKey="m_a,m_b" />)
    expect(posts(calls)).toHaveLength(1)
    expect(screen.queryByTestId('hatch-sprites')).toBeNull()
  })

  it('does not hatch without consent, and says why a sprite is missing', async () => {
    const calls = installFetch((url) => (url.endsWith('/sprites') ? ok(HALF) : undefined))
    render(<ClassroomSpriteStrip classId="cls_1" consentOk={false} />)
    expect((await screen.findByTestId('sprite-of-m_b')).textContent).toContain('No sprite yet')
    expect(screen.getByTestId('sprites-need-consent').textContent).toMatch(/once the school's consent is recorded/)
    expect(posts(calls)).toHaveLength(0)
  })

  it('a hatch that did not work leaves a quiet link to try again', async () => {
    let fail = true
    const calls = installFetch((url, init) => {
      if (!url.endsWith('/sprites')) return undefined
      if (init?.method !== 'POST') return ok(HALF)
      return fail ? { status: 503, body: { detail: 'unavailable' } } : ok(HATCHED)
    })
    render(<ClassroomSpriteStrip classId="cls_1" consentOk />)
    const again = await screen.findByTestId('hatch-sprites')
    expect(posts(calls)).toHaveLength(1)
    fail = false
    await act(async () => { fireEvent.click(again) })
    await waitFor(() => expect(screen.getByTestId('sprite-of-m_b').textContent).toContain(BEN_BUDDY))
    expect(screen.queryByTestId('hatch-sprites')).toBeNull()
  })

  it('an unreachable sprite store is unknown: no stages, no garden number, never a zero', async () => {
    const unknown: ClassSprites = { class_id: 'cls_1', available: false, garden: null, students: [{ member_id: 'm_a', alias: 'Ada', sprite: null }] }
    const calls = installFetch((url) => (url.endsWith('/sprites') ? ok(unknown) : undefined))
    render(<ClassroomSpriteStrip classId="cls_1" consentOk />)
    expect((await screen.findByTestId('sprites-unknown')).textContent).toMatch(/offline/)
    expect(screen.queryByTestId('sprite-garden-count')).toBeNull()
    expect(screen.queryByTestId('sprite-of-m_a')).toBeNull()
    expect(posts(calls)).toHaveLength(0)
  })

  it('a class with sprites but no growth yet shows 0; a class with no sprites shows no number', async () => {
    installFetch((url) => (url.endsWith('/sprites') ? ok({ ...FULL, garden: { ...FULL.garden, grew_this_week: 0 } }) : undefined))
    const a = render(<ClassroomSpriteStrip classId="cls_1" consentOk />)
    expect((await screen.findByTestId('sprite-garden-count')).textContent).toBe('0')
    a.unmount()
    const none: ClassSprites = { class_id: 'cls_1', available: true, students: [{ member_id: 'm_b', alias: 'Ben', sprite: null }], garden: { window_days: 7, students: 1, sprites: 0, grew_this_week: 0 } }
    installFetch((url) => (url.endsWith('/sprites') ? ok(none) : undefined))
    render(<ClassroomSpriteStrip classId="cls_1" />)
    await screen.findByTestId('sprite-of-m_b')
    expect(screen.queryByTestId('sprite-garden')).toBeNull()
  })

  it('empty roster, rejected fetch and a missing route each have their own state', async () => {
    const empty = { class_id: 'cls_1', available: true, students: [], garden: { window_days: 7, students: 0, sprites: 0, grew_this_week: 0 } }
    installFetch((url) => (url.endsWith('/sprites') ? ok(empty) : undefined))
    const a = render(<ClassroomSpriteStrip classId="cls_1" consentOk />)
    expect((await screen.findByTestId('sprites-empty')).textContent).toMatch(/once they are on the roster/)
    a.unmount()

    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => { throw new TypeError('Failed to fetch') })
    const b = render(<ClassroomSpriteStrip classId="cls_1" consentOk />)
    expect((await screen.findByTestId('classroom-offline')).textContent).toMatch(/offline/)
    b.unmount()

    installFetch(() => undefined)
    const c = render(<ClassroomSpriteStrip classId="cls_1" consentOk />)
    await waitFor(() => expect(c.container.innerHTML).toBe(''))
  })

  it('a missing route is said once on the console, never silently', async () => {
    resetAbsentWarning()
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      installFetch(() => undefined)
      const a = render(<ClassroomSpriteStrip classId="cls_1" consentOk />)
      await waitFor(() => expect(warn).toHaveBeenCalledTimes(1))
      expect(String(warn.mock.calls[0][0])).toMatch(/classroom_sprite/)
      a.unmount()
      const b = render(<ClassroomSpriteStrip classId="cls_2" consentOk />)
      await waitFor(() => expect(b.container.innerHTML).toBe(''))
      expect(warn).toHaveBeenCalledTimes(1)

      ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => { throw new TypeError('Failed to fetch') })
      resetAbsentWarning()
      warn.mockClear()
      render(<ClassroomSpriteStrip classId="cls_1" consentOk />)
      await screen.findByTestId('classroom-offline')
      expect(warn).not.toHaveBeenCalled()
    } finally { warn.mockRestore() }
  })

  it('pure helpers', () => {
    expect(stageLine(null)).toBeNull()
    expect(stageLine({ stage_word: 'Wise', level: 6 })).toBe('Wise · level 6')
    expect(stageLine({})).toBe('Little · level 1')
    expect(gardenLine({ window_days: 7, students: 1, sprites: 1, grew_this_week: 1 })).toBe('of 1 sprite grew in the last 7 days')
    expect(missingSprites(HALF)).toEqual(['m_b'])
    expect(missingSprites({ ...HALF, available: false })).toEqual([])
  })
})

describe('the roster sheet mounts the strip', () => {
  const ROSTER = {
    class_id: 'cls_1', teachers: [],
    students: [{ member_id: 'm_a', student_user_id: 'u_a', alias: 'Ada', parents: [] }, { member_id: 'm_b', student_user_id: 'u_b', alias: 'Ben', parents: [] }],
  }
  const route = (consent: boolean): Route => (url, init) => {
    if (url.endsWith('/roster')) return ok(ROSTER)
    if (url.endsWith('/consent')) return ok({ consent_recorded: consent, school_as_agent: consent })
    if (url.endsWith('/sheet')) return ok({ has_sheet: false, armed: false, printable: false, students: [] })
    if (url.endsWith('/sprites')) return ok(init?.method === 'POST' ? HATCHED : HALF)
    return undefined
  }

  it('under the students, and hatches for the class once consent is recorded', async () => {
    const calls = installFetch(route(true))
    render(<ClassroomRosterSheet classId="cls_1" />)
    await waitFor(() => expect(screen.getByTestId('sprite-of-m_b').textContent).toContain(BEN_BUDDY))
    expect(screen.getByTestId('classroom-roster-sheet').contains(screen.getByTestId('classroom-sprite-strip'))).toBe(true)
    expect(posts(calls)).toHaveLength(1)
  })

  it('without consent the roster still loads and nothing is hatched', async () => {
    const calls = installFetch(route(false))
    render(<ClassroomRosterSheet classId="cls_1" />)
    await screen.findByTestId('sprites-need-consent')
    expect(screen.getByTestId('roster-students').textContent).toContain('Ben')
    expect(posts(calls)).toHaveLength(0)
  })
})

describe('source rules', () => {
  const PANELS = path.join(__dirname, '..', 'panels')
  const src = fs.readFileSync(path.join(PANELS, 'ClassroomSpriteStrip.tsx'), 'utf8')

  it('paints only through the Learn tokens (no hex / rgb literal)', () => {
    const offenders = src.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(line))
    expect(offenders).toEqual([])
  })

  it('names no grade, diagnosis, price or guilt', () => {
    expect(src).not.toMatch(/\b(adhd|dyslexi\w*|disorder|diagnos\w*|deficit|lazy|behind grade|free tier|hungry|sulk|miss(ed)? you)\b/i)
  })

  it('has an explicit awkit export (wildcards fail under Turbopack) and an index export', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PANELS, '..', '..', 'package.json'), 'utf8'))
    expect(pkg.exports['./panels/ClassroomSpriteStrip'].import).toBe('./src/panels/ClassroomSpriteStrip.tsx')
    expect(pkg.publishConfig.exports['./panels/ClassroomSpriteStrip'].import).toBe('./dist/panels/ClassroomSpriteStrip.js')
    expect(fs.readFileSync(path.join(PANELS, 'index.ts'), 'utf8')).toContain('export { default as ClassroomSpriteStrip } from')
  })
})
