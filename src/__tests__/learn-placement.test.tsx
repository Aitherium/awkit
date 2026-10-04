/**
 * Aither Learn placement + grade 3-5 content in the child panel, and the guardian's
 * starting-level control. Pins: "Start my lesson" that returns a placement run shows
 * the item straight away (no lesson opener), a reading passage renders as text, the
 * number pad takes six digits, a finished placement shows the server's closing line,
 * and TutorLevelCard saves a starting grade (PUT /level) and asks for a fresh check
 * (POST /placement). Runs under AitherVeil's jest.
 */
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import KidQuestPanel from '../panels/KidQuestPanel'
import TutorLevelCard from '../panels/TutorLevelCard'

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

const PASSAGE = {
  item_id: 'p1', skill_id: 'read.comp.passage_g3', prompt_text: 'What did Maya use to measure?',
  tts_text: 'Read the story. Then answer: What did Maya use to measure?', input: 'tap',
  visual: { kind: 'passage', title: 'The Science Fair', text: 'Maya wanted to know which ball bounced highest. She measured each bounce with a meter stick.' },
  choices: [
    { value: 'a', label: 'a meter stick' }, { value: 'b', label: 'a scale' }, { value: 'c', label: 'a clock' },
  ],
}
const BIG_MATH = { item_id: 'm1', skill_id: 'math.mult_multidigit', prompt_text: '4,512 × 47 = ?', tts_text: 'What is 4,512 times 47?', input: 'number' }

function placementRoutes(answers: Record<string, unknown>[]): Route {
  return (url, init) => {
    if (url.endsWith('/me')) return { status: 200, body: { alias: 'Tess', grade: 2, choices: ['space', 'ocean'] } }
    if (url.endsWith('/me/lesson/start')) {
      return { status: 200, body: { quest_id: 'P1', items_total: 12, item: PASSAGE, progress: { done: 0, total: 12 }, placement: { say: 'A quick warm-up.' } } }
    }
    if (url.endsWith('/me/quest/P1/answer')) {
      answers.push(body(init))
      if (answers.length === 1) {
        return { status: 200, body: { feedback: 'yay', say: 'Yes! You got it.', hint_steps: [], next_item: BIG_MATH, break: false, done: false, progress: { done: 1, total: 12 } } }
      }
      return { status: 200, body: { feedback: 'yay', say: 'All done! Now I know just where to start. Saved!', hint_steps: [], next_item: null, break: false, done: true, progress: { done: 2, total: 2 } } }
    }
    if (url.endsWith('/me/quest/P1/end')) return { status: 200, body: { saved: true, say: 'All done! Now I know just where to start. Saved!' } }
    return undefined
  }
}

describe('placement and grade 3-5 items in KidQuestPanel', () => {
  it('shows a passage, takes a six-digit answer and ends on the placement line', async () => {
    const answers: Record<string, unknown>[] = []
    installFetch(placementRoutes(answers))
    const { container } = render(<KidQuestPanel apiBase="/api/tutor" />)
    await screen.findByTestId('home-screen')
    await act(async () => { fireEvent.click(screen.getByTestId('start-lesson')) })
    // No lesson opener for a placement run: the item comes first.
    await screen.findByTestId('item-screen')
    expect(screen.queryByTestId('segment-card')).toBeNull()
    const passage = screen.getByTestId('reading-passage')
    expect(passage.textContent).toContain('The Science Fair')
    expect(passage.textContent).toContain('meter stick')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'a meter stick' })) })
    expect(answers[0]).toMatchObject({ item_id: 'p1', answer: 'a' })
    await screen.findByTestId('yay-card')
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await screen.findByTestId('item-screen')
    for (const ch of '212064') fireEvent.click(screen.getByRole('button', { name: ch }))
    expect(screen.getByTestId('number-display').textContent).toBe('212064')
    fireEvent.click(screen.getByRole('button', { name: '9' })) // a seventh digit is ignored
    expect(screen.getByTestId('number-display').textContent).toBe('212064')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'go' })) })
    expect(answers[1]).toMatchObject({ item_id: 'm1', answer: '212064' })
    await screen.findByTestId('saved-card')
    expect(container.textContent).toContain('Now I know just where to start')
    expect(container.textContent).not.toMatch(/\bwrong\b|incorrect|score|grade \d/i)
  })
})

describe('TutorLevelCard', () => {
  const LEVEL = {
    lid: 'l1', grade: 2,
    placement: { status: 'done', requested: false, placed: { math: 5, reading: 4 } },
    working_grade: { math: 4, reading: 3 },
    next: {
      math: [{ skill_id: 'math.long_division', kid_title: 'I can do long division!', grade: 5 }],
      reading: [{ skill_id: 'read.comp.passage_g4', kid_title: 'I can find the main idea and theme!', grade: 4 }],
    },
    grades: [0, 1, 2, 3, 4, 5],
  }

  it('shows the placement result, saves a starting grade and requests a new check', async () => {
    const calls = installFetch((url, init) => {
      if (url.endsWith('/family/learners/l1/level') && (!init?.method || init.method === 'GET')) return { status: 200, body: LEVEL }
      if (url.endsWith('/family/learners/l1/level') && init?.method === 'PUT') return { status: 200, body: LEVEL }
      if (url.endsWith('/family/learners/l1/placement') && init?.method === 'POST') return { status: 200, body: { ...LEVEL, placement: { status: 'done', requested: true } } }
      return undefined
    })
    const notes: string[] = []
    render(<TutorLevelCard apiBase="/api/tutor" lid="l1" alias="Tess" onNote={(m) => notes.push(m)} />)
    const status = await screen.findByTestId('level-status')
    expect(status.textContent).toContain('Numbers grade 5')
    expect(status.textContent).toContain('Words grade 4')
    expect(screen.getByTestId('level-card').textContent).toContain('I can do long division!')

    fireEvent.change(screen.getByLabelText('Start Numbers at'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('School grade'), { target: { value: '3' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save level/i })) })
    const put = calls.find((c) => c.init?.method === 'PUT')
    expect(body(put?.init)).toEqual({ grade: 3, math_start: 5 })
    expect(notes).toContain('Starting level saved.')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /check again/i })) })
    expect(calls.some((c) => c.url.endsWith('/placement') && c.init?.method === 'POST')).toBe(true)
  })

  it('renders nothing when the server has no level route', async () => {
    installFetch(() => undefined)
    const { container } = render(<TutorLevelCard apiBase="/api/tutor" lid="l1" />)
    await act(async () => { await Promise.resolve() })
    expect(container.textContent).toBe('')
  })
})
