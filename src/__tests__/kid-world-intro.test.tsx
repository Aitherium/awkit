/**
 * KidWorldIntro ("the light comes on", kids' suite S3): the step machine and the panel.
 *
 * Pins: seven taps from the egg to the first adventure; a tap that does not belong to the
 * current step changes nothing; every step resumes after a reload (device copy, and the
 * server's copy when it is further on); no text field ever exists; the hatch line says
 * the Sprite is not a person; the server's name refusal keeps the child on the name step;
 * and KidQuestPanel shows the intro only when /me says intro.needed, then starts the
 * first adventure as a lesson in the world the child picked, with the bridge story.
 * Runs under AitherVeil's jest (its roots include awkit/src).
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import KidWorldIntro, {
  FRESH_INTRO, INTRO_DONE_BODY, INTRO_STEPS, cleanIntroState, introMoveBody, introReducer, introStorageKey,
  nameIdeasFor, resumeIntro,
  type IntroAction, type IntroState,
} from '../panels/KidWorldIntro'
import KidQuestPanel from '../panels/KidQuestPanel'

type Reply = { status: number; body: unknown }
type Route = (url: string, init?: RequestInit) => Reply | undefined

function installFetch(route: Route) {
  const calls: { url: string; init?: RequestInit }[] = []
  const impl = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const r = /\/me\/say(\/stream)?$/.test(url)
      ? { status: 503, body: { detail: 'Voice unavailable' } }
      : route(url, init) ?? { status: 404, body: { detail: 'nope' } }
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body } as unknown as Response
  })
  ;(global as unknown as { fetch: unknown }).fetch = impl
  return calls
}

const body = (init?: RequestInit): Record<string, unknown> => (init?.body ? JSON.parse(String(init.body)) : {})

/** The seven taps, as actions, in order. */
const WALK: IntroAction[] = [
  { type: 'tapEgg' },
  { type: 'pickEgg', egg: 'owl' },
  { type: 'greet' },
  { type: 'name', name: 'Pip' },
  { type: 'paint', paint: 'lagoon' },
  { type: 'love', love: 'space' },
  { type: 'sticker', sticker: 'star' },
]

const quiet = Object.assign(() => {}, { prefetch: () => {} })

beforeEach(() => { window.localStorage.clear() })

describe('the step machine', () => {
  it('walks the seven steps in seven taps', () => {
    let s: IntroState = FRESH_INTRO
    const seen: number[] = [s.step]
    for (const a of WALK) { s = introReducer(s, a); seen.push(s.step) }
    expect(seen).toEqual([1, 2, 2, 3, 4, 5, 6, 7])
    expect(INTRO_STEPS[s.step - 1]).toBe('adventure')
    expect(s.picks).toEqual({ egg: 'owl', name: 'Pip', paint: 'lagoon', love: 'space', sticker: 'star' })
  })

  it('ignores a tap that belongs to another step (no skipping, no double hatch)', () => {
    expect(introReducer(FRESH_INTRO, { type: 'name', name: 'Pip' })).toBe(FRESH_INTRO)
    expect(introReducer(FRESH_INTRO, { type: 'greet' })).toBe(FRESH_INTRO)
    const two = introReducer(FRESH_INTRO, { type: 'tapEgg' })
    expect(introReducer(two, { type: 'greet' })).toBe(two) // must hatch first
    const hatched = introReducer(two, { type: 'pickEgg', egg: 'fox' })
    expect(introReducer(hatched, { type: 'pickEgg', egg: 'dragon' }).picks.egg).toBe('fox')
  })

  it('resumes at every step from the device copy, and the further copy wins', () => {
    let s: IntroState = FRESH_INTRO
    for (let i = 0; i < WALK.length; i++) {
      s = introReducer(s, WALK[i])
      const back = resumeIntro(null, JSON.parse(JSON.stringify(s)))
      expect(back.step).toBe(s.step)
      expect(back.picks).toEqual(s.picks)
    }
    const four = { step: 4, picks: { egg: 'fox', name: 'Pip' } }
    const six = { step: 6, picks: { egg: 'fox', name: 'Pip', paint: 'sky', love: 'farm' } }
    expect(resumeIntro(four, six).step).toBe(6)
    expect(resumeIntro(six, four).step).toBe(6)
  })

  it('never resumes past a missing pick, and junk is a fresh start', () => {
    expect(cleanIntroState({ step: 6, picks: { egg: 'fox' } })?.step).toBe(3)
    expect(cleanIntroState({ step: 99, picks: { egg: 'fox', name: 'Pip', paint: 'sky', love: 'farm', sticker: 'star' } })?.step).toBe(7)
    expect(resumeIntro('nope', { step: -2 })).toEqual(FRESH_INTRO)
  })

  it('speaks the server contract: string step ids, no picks, done without a step', () => {
    // lib/tutor/kid_intro.py STEPS; kid_world_router.IntroMove is extra=forbid {step: str, done}
    expect([...INTRO_STEPS]).toEqual(['egg', 'hatch', 'name', 'paint', 'loves', 'wall', 'adventure'])
    let s: IntroState = FRESH_INTRO
    const bodies = [introMoveBody(s)]
    for (const a of WALK) { s = introReducer(s, a); bodies.push(introMoveBody(s)) }
    expect(bodies.map((b) => b.step)).toEqual(['egg', 'hatch', 'hatch', 'name', 'paint', 'loves', 'wall', 'adventure'])
    for (const b of bodies) expect(Object.keys(b)).toEqual(['step'])
    expect(INTRO_DONE_BODY).toEqual({ done: true })
  })

  it('resumes from the server copy, whose step is a string id and carries no picks', () => {
    // /me.intro as kid_intro.view() returns it; Number('paint') was NaN -> a restart
    const view = (step: string) => ({ version: 1, needed: true, step, steps: [...INTRO_STEPS], done_at: null, offer: { bodies: [] } })
    INTRO_STEPS.forEach((id, i) => expect(cleanIntroState(view(id))?.step).toBe(i + 1))
    expect(cleanIntroState(view('fly'))).toBeNull()
    expect(resumeIntro(view('wall'), null).step).toBe(6)
    // a device copy at the same step keeps its picks; a further server step wins
    const dev = { step: 4, picks: { egg: 'fox', name: 'Pip' } }
    expect(resumeIntro(view('paint'), dev).picks.name).toBe('Pip')
    expect(resumeIntro(view('wall'), dev).step).toBe(6)
  })

  it('never offers the child their own name', () => {
    expect(nameIdeasFor('Pip Nova')).not.toEqual(expect.arrayContaining(['Pip']))
    expect(nameIdeasFor('Pip Nova')).not.toContain('Nova')
    expect(nameIdeasFor('Robin')).toHaveLength(6)
  })
})

describe('KidWorldIntro', () => {
  function mount(props: Partial<React.ComponentProps<typeof KidWorldIntro>> = {}) {
    const onDone = jest.fn()
    const utils = render(
      <KidWorldIntro apiBase="/api/tutor" alias="Robin" speak={quiet} onDone={onDone} {...props} />,
    )
    return { ...utils, onDone }
  }
  const stepOf = () => Number(screen.getByTestId('kid-world-intro').getAttribute('data-step'))

  it('reaches the first adventure in seven taps with no text field, saving each step', async () => {
    const calls = installFetch(() => ({ status: 200, body: {} }))
    const { container, onDone } = mount()
    const tap = async (id: string, n = 0) => {
      expect(container.querySelectorAll('input, textarea, [contenteditable="true"]')).toHaveLength(0)
      await act(async () => { fireEvent.click(screen.getAllByTestId(id)[n]) })
    }
    await tap('intro-egg')
    await tap('intro-pick-egg', 1)
    expect(screen.getByTestId('honest-line').textContent).toMatch(/made by a computer.*not a person/i)
    await tap('intro-greet')
    await tap('intro-name')
    await tap('intro-paint')
    await tap('intro-love', 2)
    await tap('intro-sticker')
    expect(stepOf()).toBe(7)
    expect(screen.getByTestId('intro-adventure')).toBeTruthy()
    const puts = calls.filter((c) => c.url.endsWith('/me/intro'))
    expect(puts.map((c) => body(c.init))).toEqual(
      ['hatch', 'hatch', 'name', 'paint', 'loves', 'wall', 'adventure'].map((step) => ({ step })))
    const names = calls.filter((c) => c.url.endsWith('/me/sprite-design')).map((c) => (body(c.init).design as { name?: string }).name)
    expect(names[0]).toBe('Pip')
    await act(async () => { fireEvent.click(screen.getByTestId('intro-go')) })
    expect(onDone).toHaveBeenCalledWith({ theme: 'space', spriteName: 'Pip' })
    expect(body(calls[calls.length - 1].init)).toEqual({ done: true })
    await waitFor(() => expect(window.localStorage.getItem(introStorageKey('Robin'))).toBeNull())
    // no streaks, scores or timers anywhere in the first run
    expect(container.textContent || '').not.toMatch(/streak|score|timer|countdown|hurry/i)
  })

  it('keeps the device copy when the server did not record "done", so the next open retries at step 7', async () => {
    const calls = installFetch((url, init) => (url.endsWith('/me/intro') && body(init).done
      ? { status: 422, body: { detail: 'Unknown step' } }
      : { status: 200, body: {} }))
    const first = mount({ saved: { needed: true, step: 'wall' } })
    await act(async () => { fireEvent.click(screen.getAllByTestId('intro-sticker')[0]) })
    expect(stepOf()).toBe(7)
    await act(async () => { fireEvent.click(screen.getByTestId('intro-go')) })
    expect(first.onDone).toHaveBeenCalled()
    expect(calls.filter((c) => c.url.endsWith('/me/intro')).map((c) => body(c.init))).toEqual([{ step: 'adventure' }, { done: true }])
    expect(window.localStorage.getItem(introStorageKey('Robin'))).not.toBeNull()
    first.unmount()
    mount({ saved: { needed: true, step: 'adventure' } })
    expect(stepOf()).toBe(7)
  })

  it('a reload at step 4 resumes at step 4', async () => {
    installFetch(() => ({ status: 200, body: {} }))
    const first = mount()
    for (const id of ['intro-egg', 'intro-pick-egg', 'intro-greet', 'intro-name']) {
      await act(async () => { fireEvent.click(screen.getAllByTestId(id)[0]) })
    }
    expect(stepOf()).toBe(4)
    first.unmount()
    mount()
    expect(stepOf()).toBe(4)
    expect(screen.getAllByTestId('intro-paint').length).toBe(8)
  })

  it('resumes from the server copy on a new device', () => {
    installFetch(() => ({ status: 200, body: {} }))
    mount({ saved: { needed: true, step: 'loves' } })
    expect(stepOf()).toBe(5)
    expect(screen.getAllByTestId('intro-love')).toHaveLength(6)
  })

  it('stays on the name step when the server refuses a name, and drops it', async () => {
    installFetch((url, init) => (url.endsWith('/me/sprite-design') && (body(init).design as { name?: string }).name === 'Pip'
      ? { status: 422, body: { detail: "Let's pick a different name." } }
      : { status: 200, body: {} }))
    mount({ saved: { needed: true, step: 'name' } })
    expect(stepOf()).toBe(3)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Pip' })) })
    expect(stepOf()).toBe(3)
    expect(screen.queryByRole('button', { name: 'Pip' })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Luma' })) })
    expect(stepOf()).toBe(4)
  })

  it('wakes the Sprite a grown-up already hatched instead of offering three eggs', async () => {
    installFetch(() => ({ status: 200, body: {} }))
    mount({ sprite: { species: 'otter', stage: 'baby', name: "Robin's Buddy" }, saved: { needed: true, step: 'hatch' } })
    expect(screen.getAllByTestId('intro-pick-egg')).toHaveLength(1)
    await act(async () => { fireEvent.click(screen.getByTestId('intro-pick-egg')) })
    expect(screen.getByTestId('intro-creature').getAttribute('data-species')).toBe('otter')
  })
})

describe('KidQuestPanel first run', () => {
  const ME = { alias: 'Robin', grade: 2, sprite: { name: 'Pip', species: 'fox', stage: 'baby' } }
  const ITEM = { item_id: 'p1', skill_id: 'add_within_100', tts_text: 'What is 23 plus 14?', prompt_text: '23 + 14 = ?', input: 'number' }

  it('shows the intro when /me says intro.needed, then starts the first adventure on the bridge', async () => {
    const calls = installFetch((url) => {
      if (url.endsWith('/me')) return { status: 200, body: { ...ME, intro: { version: 1, needed: true, step: 'adventure', done_at: null } } }
      if (url.endsWith('/me/lesson/start')) {
        return { status: 200, body: { quest_id: 'q1', items_total: 10, item: ITEM, progress: { done: 0, total: 10 },
          story: { scene: 'bridge', say: 'Help Pip fix the bridge!', planks: 0, total: 10, done: false } } }
      }
      return { status: 200, body: {} }
    })
    // this device walked the intro (its copy holds the picks); the server holds the step
    window.localStorage.setItem(introStorageKey('Robin'), JSON.stringify(
      { v: 1, step: 7, hatched: true, picks: { egg: 'fox', name: 'Pip', paint: 'sky', love: 'ocean', sticker: 'moon' } }))
    const onIntroChange = jest.fn()
    render(<KidQuestPanel apiBase="/api/tutor" onIntroChange={onIntroChange} />)
    await screen.findByTestId('kid-world-intro')
    expect(screen.queryByTestId('home-screen')).toBeNull()
    expect(onIntroChange).toHaveBeenLastCalledWith(true)
    await act(async () => { fireEvent.click(screen.getByTestId('intro-go')) })
    await screen.findByTestId('item-screen')
    expect(screen.getByTestId('bridge-strip').getAttribute('data-planks')).toBe('0')
    expect(screen.queryByTestId('progress-path')).toBeNull()
    expect(onIntroChange).toHaveBeenLastCalledWith(false)
    const start = calls.find((c) => c.url.endsWith('/me/lesson/start'))
    expect(body(start?.init)).toEqual({ theme: 'ocean' })
    const done = calls.filter((c) => c.url.endsWith('/me/intro'))
    expect(done.map((c) => body(c.init))).toEqual([{ done: true }])
  })

  it('goes straight home when the intro is not needed', async () => {
    installFetch((url) => (url.endsWith('/me') ? { status: 200, body: { ...ME, intro: { needed: false } } } : { status: 200, body: {} }))
    render(<KidQuestPanel apiBase="/api/tutor" />)
    await screen.findByTestId('home-screen')
    await waitFor(() => expect(screen.queryByTestId('kid-world-intro')).toBeNull())
  })
})
