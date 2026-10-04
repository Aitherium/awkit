/**
 * "Start my lesson" (Aither Learn): KidQuestPanel over POST /me/lesson/start.
 * Pins: the segment opener comes first and is read aloud, the new step opens with a
 * "watch me" card, items show their segment, "I'm not sure" sends idk:true and gets
 * the kind worked steps, the home card is encouragement only, and TutorProgressCard
 * shows the parent the dial and saves a pin. Runs under AitherVeil's jest.
 */
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import KidQuestPanel from '../panels/KidQuestPanel'
import TutorProgressCard from '../panels/TutorProgressCard'

type Reply = { status: number; body: unknown }
type Route = (url: string, init?: RequestInit) => Reply | undefined

function installFetch(route: Route) {
  const calls: { url: string; init?: RequestInit }[] = []
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const r = url.endsWith('/me/say')
      ? { status: 503, body: {} }
      : route(url, init) ?? { status: 404, body: { detail: 'nope' } }
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body } as unknown as Response
  })
  return calls
}

const body = (init?: RequestInit) => (init?.body ? JSON.parse(String(init.body)) : {})

const WARM = { item_id: 'w1', skill_id: 'math.add_within_10', prompt_text: '3 + 4 = ?', tts_text: 'What is 3 plus 4?', input: 'number', answer_key: 'SECRET-7' }
const NEW = { item_id: 'n1', skill_id: 'math.sub_within_10', prompt_text: '7 - 2 = ?', tts_text: 'What is 7 take away 2?', input: 'number' }

const LESSON = {
  segment: 'warmup',
  segments: [
    { id: 'warmup', label: 'Warm-up', items: 2 }, { id: 'new', label: 'New!', items: 3 },
    { id: 'practice', label: 'Practice', items: 4 }, { id: 'finish', label: 'Fun finish', items: 1 },
  ],
  lines: {
    warmup: 'Warm-up time! Let’s start with something you know.',
    new: 'Blast off! Something new today: I can take away!',
    practice: 'Now let’s practice!',
    finish: 'Last one! Let’s finish strong.',
  },
  teach: {
    kid_title: 'I can take away within 10!', prompt_text: '4 - 1 = ?', tts_text: 'What is 4 take away 1?',
    steps: ['Show 4 fingers.', 'Fold down 1. How many are still up?'], answer_label: '3',
  },
}

function lessonRoutes(answers: Record<string, unknown>[]): Route {
  let n = 0
  return (url, init) => {
    if (url.endsWith('/me')) return { status: 200, body: { alias: 'Tess', grade: 1, choices: ['space', 'ocean'] } }
    if (url.endsWith('/me/progress')) {
      return { status: 200, body: { learned: ['I know my letter sounds!'], learned_count: 1, growing: ['I can add within 10!'], today: { goal_met: false, goal_minutes: 10, minutes: 3 } } }
    }
    if (url.endsWith('/me/lesson/start')) return { status: 200, body: { quest_id: 'L1', items_total: 10, item: WARM, progress: { done: 0, total: 10 }, lesson: LESSON } }
    if (url.endsWith('/me/quest/L1/answer')) {
      answers.push(body(init))
      n += 1
      const b = body(init)
      if (b.idk) {
        return { status: 200, body: { feedback: 'lets_look', say: 'Let’s look together.', hint_steps: ['Show 7 fingers.'], next_item: { ...NEW, item_id: 'n1-sib' }, break: false, done: false, progress: { done: 2, total: 10 }, segment: 'new' } }
      }
      if (n === 1) return { status: 200, body: { feedback: 'yay', say: 'Yes! You got it.', next_item: { ...WARM, item_id: 'w2' }, done: false, progress: { done: 1, total: 10 }, segment: 'warmup' } }
      return { status: 200, body: { feedback: 'yay', say: 'Nice thinking!', next_item: NEW, done: false, progress: { done: 2, total: 10 }, segment: 'new' } }
    }
    return undefined
  }
}

async function typeAnswer(value: string) {
  for (const ch of value) fireEvent.click(screen.getByRole('button', { name: ch }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'go' })) })
}

describe('Start my lesson', () => {
  it('opens each segment, teaches the new step, and keeps the screen calm', async () => {
    const answers: Record<string, unknown>[] = []
    const calls = installFetch(lessonRoutes(answers))
    const { container } = render(<KidQuestPanel apiBase="/api/tutor" />)
    await screen.findByTestId('home-screen')
    // Encouragement only on home.
    const card = await screen.findByTestId('kid-progress')
    expect(card.textContent).toContain('I know my letter sounds!')
    expect(card.textContent).not.toMatch(/%|score|level|rank/i)

    await act(async () => { fireEvent.click(screen.getByTestId('start-lesson')) })
    const start = calls.find((c) => c.url.endsWith('/me/lesson/start'))
    expect(body(start?.init)).toEqual({ theme: 'space' })
    // Warm-up opener first, then the item with its segment chip.
    await screen.findByTestId('segment-card')
    expect(container.textContent).toContain('Warm-up time!')
    expect(screen.queryByTestId('teach-card')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /let.s go/i }))
    await screen.findByTestId('item-screen')
    expect(screen.getByTestId('segment-chip').textContent).toBe('warm-up')
    await typeAnswer('7')
    await screen.findByTestId('yay-card')
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    // Same segment: straight to the next item.
    await screen.findByTestId('item-screen')
    await typeAnswer('7')
    await screen.findByTestId('yay-card')
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    // New segment: the opener and the worked "watch me" example.
    await screen.findByTestId('segment-card')
    const teach = screen.getByTestId('teach-card')
    expect(teach.textContent).toContain('watch me')
    expect(teach.textContent).toContain('Fold down 1')
    expect(container.textContent).toContain('Something new today')
    fireEvent.click(screen.getByRole('button', { name: /my turn/i }))
    await screen.findByTestId('item-screen')
    expect(screen.getByTestId('segment-chip').textContent).toBe('something new')
    expect(container.textContent).not.toContain('SECRET-7')
    expect(container.textContent).not.toMatch(/\bwrong\b|incorrect|timer|score/i)
    expect(answers.every((a) => a.idk === false)).toBe(true)
  })

  it('"I\'m not sure" sends idk and gets the kind worked steps', async () => {
    const answers: Record<string, unknown>[] = []
    installFetch(lessonRoutes(answers))
    const { container } = render(<KidQuestPanel apiBase="/api/tutor" />)
    await screen.findByTestId('home-screen')
    await act(async () => { fireEvent.click(screen.getByTestId('start-lesson')) })
    await screen.findByTestId('segment-card')
    fireEvent.click(screen.getByRole('button', { name: /let.s go/i }))
    await screen.findByTestId('item-screen')
    await act(async () => { fireEvent.click(screen.getByTestId('not-sure')) })
    await screen.findByTestId('look-card')
    expect(answers[0]).toMatchObject({ item_id: 'w1', answer: '', idk: true, redo: false })
    expect(container.textContent).toContain('Show 7 fingers.')
    expect(container.textContent).not.toMatch(/\bwrong\b|incorrect/i)
  })
})

describe('TutorProgressCard', () => {
  const VIEW = {
    alias: 'Tess',
    today: { minutes: 6, goal_minutes: 10, goal_met: false },
    week_minutes: 31,
    working_grade: { math: 0, reading: null },
    skills: [
      { skill_id: 'math.add_within_10', kid_title: 'I can add within 10!', domain: 'math', state: 'learning', level: 0, level_name: 'core', pinned: false, percent: 78, trend_7d: 12, answers: 40, last_change: 'stepped up: 5 of 6 clean', stuck: false },
      { skill_id: 'read.phx.cvc', kid_title: 'I can read words like cat!', domain: 'reading', state: 'learning', level: -1, level_name: 'gentle', pinned: false, percent: 30, trend_7d: -4, answers: 12, last_change: 'stepped down: 2 misses in a row', stuck: true },
    ],
    next: [{ skill_id: 'math.sub_within_10', kid_title: 'I can take away within 10!', why: 'the new step in the next lesson' }],
    knobs: { pins: {}, daily_goal_minutes: 10 },
    lesson_minutes: 8,
    how_it_works: 'Each skill has a level: gentle, core or stretch.',
  }

  it('shows the dial per skill and saves a pin and a goal', async () => {
    const calls = installFetch((url, init) => {
      if (url.endsWith('/family/learners/l1/progress')) return { status: 200, body: VIEW }
      if (url.endsWith('/family/learners/l1/adaptive') && init?.method === 'PUT') return { status: 200, body: { knobs: {} } }
      return undefined
    })
    const notes: string[] = []
    render(<TutorProgressCard apiBase="/api/tutor" lid="l1" alias="Tess" onNote={(m) => notes.push(m)} />)
    const rows = await screen.findAllByTestId('progress-skill')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('core')
    expect(rows[0].textContent).toContain('up 12 pts this week')
    expect(rows[1].textContent).toContain('finding this hard')
    expect(screen.getByTestId('progress-next').textContent).toContain('I can take away within 10!')
    expect(screen.getByTestId('progress-today').textContent).toContain('6 min of 10')

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Level for I can read words like cat!'), { target: { value: '-1' } })
    })
    const put = calls.filter((c) => c.init?.method === 'PUT')
    expect(body(put[0].init)).toEqual({ pins: { 'read.phx.cvc': -1 } })

    fireEvent.change(screen.getByLabelText('daily goal minutes'), { target: { value: '15' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save goal/i })) })
    const puts = calls.filter((c) => c.init?.method === 'PUT')
    expect(body(puts[puts.length - 1].init)).toEqual({ daily_goal_minutes: 15 })
    expect(notes).toContain('Daily goal saved.')
  })
})
