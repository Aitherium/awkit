/**
 * KidQuestPanel (Aither Learn): the child's quest screen, rendered in jsdom
 * against a scripted fetch. Pins the child-first rules from the plan:
 * no answer key in the DOM, no "wrong"/"incorrect" copy after a miss, a break
 * card on break:true, "Saved" on done, and no timer or countdown anywhere.
 * Runs under AitherVeil's jest (its roots include awkit/src).
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import KidQuestPanel from '../panels/KidQuestPanel'

type Reply = { status: number; body: unknown }
type Route = (url: string, init?: RequestInit) => Reply | undefined

const ITEM = {
  item_id: 'it-1',
  skill_id: 'math.add_within_20',
  tts_text: 'What is 8 plus 5?',
  prompt_text: '8 + 5 = ?',
  visual: { kind: 'ten_frame', frames: [8, 5] },
  input: 'number',
  // A server bug must never reach the screen: the panel reads named fields only.
  answer_key: 'SECRET-ANSWER-13',
}

const ITEM2 = { ...ITEM, item_id: 'it-2', prompt_text: '9 + 4 = ?', tts_text: 'What is 9 plus 4?' }

function installFetch(route: Route) {
  const calls: { url: string; init?: RequestInit }[] = []
  const impl = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    // Read-aloud (learnVoice) is not under test here: the plane is "down", so the panel
    // falls back to the device voice and a scripted route never sees a /me/say call.
    const r = /\/me\/say(\/stream)?$/.test(url)
      ? { status: 503, body: { detail: 'Voice unavailable' } }
      : route(url, init) ?? { status: 404, body: { detail: 'nope' } }
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      json: async () => r.body,
    } as unknown as Response
  })
  ;(global as unknown as { fetch: unknown }).fetch = impl
  return calls
}

function body(init?: RequestInit): Record<string, unknown> {
  return init?.body ? JSON.parse(String(init.body)) : {}
}

const FORBIDDEN_TIMER = /timer|countdown|seconds left/i

function assertCalm(container: HTMLElement) {
  const html = container.innerHTML
  const text = container.textContent || ''
  expect(html).not.toContain('answer_key')
  expect(text).not.toContain('SECRET-ANSWER-13')
  expect(text).not.toMatch(/\bwrong\b|incorrect/i)
  expect(html).not.toMatch(FORBIDDEN_TIMER)
  expect(text).not.toMatch(/latency|streak|score/i)
}

async function typeAnswer(value: string) {
  for (const ch of value) fireEvent.click(screen.getByRole('button', { name: ch }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'go' })) })
}

async function startQuest(index = 0) {
  await screen.findByTestId('home-screen')
  // The world tiles ("Start space"); "Start my lesson" above them has its own suite.
  await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^start (?!my lesson)/i })[index]) })
}

describe('KidQuestPanel', () => {
  it('asks for the pair code when /me is 404 and claims it with the bearer only', async () => {
    let claimed = false
    const calls = installFetch((url, init) => {
      if (url.endsWith('/me')) {
        return claimed ? { status: 200, body: { alias: 'X', grade: 2 } } : { status: 404, body: {} }
      }
      if (url.endsWith('/me/claim') && init?.method === 'POST') {
        claimed = true
        return { status: 200, body: { lid: 'l1', alias: 'X' } }
      }
      return undefined
    })
    const { container } = render(<KidQuestPanel apiBase="/api/tutor" extraHeaders={{ Authorization: 'Bearer t' }} />)
    await screen.findByTestId('pair-screen')
    fireEvent.change(screen.getByLabelText('pair code'), { target: { value: 'abc123' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /let.s go/i })) })
    await screen.findByTestId('home-screen')
    const claim = calls.find((c) => c.url.endsWith('/me/claim'))
    expect(body(claim?.init)).toEqual({ code: 'ABC123' })
    expect((claim?.init?.headers as Record<string, string>).Authorization).toBe('Bearer t')
    assertCalm(container)
  })

  it('a used-up code gets a gentle line, not an error', async () => {
    installFetch((url) => {
      if (url.endsWith('/me')) return { status: 404, body: {} }
      if (url.endsWith('/me/claim')) return { status: 410, body: { detail: 'expired' } }
      return undefined
    })
    const { container } = render(<KidQuestPanel apiBase="/api/tutor" />)
    await screen.findByTestId('pair-screen')
    fireEvent.change(screen.getByLabelText('pair code'), { target: { value: 'OLD1' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /let.s go/i })) })
    await screen.findByText(/used up/i)
    assertCalm(container)
  })

  it('runs a quest: a miss is neutral, a break card on break:true, ends on Saved', async () => {
    const answers: Record<string, unknown>[] = []
    let n = 0
    const calls = installFetch((url, init) => {
      if (url.endsWith('/me')) return { status: 200, body: { alias: 'X', grade: 2, choices: ['space', 'ocean'] } }
      if (url.endsWith('/me/quest/start')) return { status: 200, body: { quest_id: 'q1', items_total: 4, item: ITEM } }
      if (url.endsWith('/me/quest/q1/answer')) {
        answers.push(body(init))
        n += 1
        if (n === 1) {
          return {
            status: 200,
            body: {
              feedback: 'lets_look', say: "Let's look together",
              hint_steps: ['8 needs 2 more to make 10.', '10 and 3 more is 13.'],
              next_item: null, break: false, done: false, progress: { done: 0, total: 4 },
            },
          }
        }
        if (n === 2) {
          return {
            status: 200,
            body: {
              feedback: 'yay', say: 'Yay!', next_item: ITEM2, break: true, done: false,
              progress: { done: 1, total: 4 }, sprite_event: { say: 'Your sprite learned make-ten!' },
            },
          }
        }
        return {
          status: 200,
          body: { feedback: 'yay', say: 'Yay!', next_item: null, break: false, done: true, progress: { done: 4, total: 4 } },
        }
      }
      if (url.endsWith('/me/quest/q1/end')) return { status: 200, body: { saved: true, say: 'Saved, all done!' } }
      return undefined
    })

    const { container } = render(<KidQuestPanel apiBase="/api/tutor" />)
    await screen.findByTestId('home-screen')
    expect(screen.getAllByRole('button', { name: /^start (?!my lesson)/i })).toHaveLength(2)
    expect(screen.getByTestId('start-lesson')).toBeTruthy()
    await startQuest(0)
    await screen.findByTestId('item-screen')
    expect(screen.getAllByTestId('ten-frame')).toHaveLength(2)
    expect(screen.getByRole('button', { name: /hear it again/i })).toBeTruthy()
    assertCalm(container)

    // A miss: neutral wording plus the worked steps, then the same item as a redo.
    await typeAnswer('12')
    await screen.findByTestId('look-card')
    expect(container.textContent).toContain("Let's look together")
    expect(container.textContent).toContain('8 needs 2 more to make 10.')
    assertCalm(container)
    fireEvent.click(screen.getByRole('button', { name: /try this one/i }))
    await screen.findByTestId('item-screen')

    await typeAnswer('13')
    await screen.findByTestId('break-card')
    assertCalm(container)
    fireEvent.click(screen.getByRole('button', { name: /ready/i }))
    await screen.findByTestId('item-screen')
    expect(container.textContent).toContain('9 + 4 = ?')

    await typeAnswer('13')
    await waitFor(() => expect(screen.getByTestId('saved-card')).toBeTruthy())
    expect(container.textContent).toContain('Saved')
    expect(screen.getByTestId('sprite-event').textContent).toContain('make-ten')
    assertCalm(container)

    expect(answers[0]).toMatchObject({ item_id: 'it-1', answer: '12', redo: false })
    expect(answers[1]).toMatchObject({ item_id: 'it-1', answer: '13', redo: true })
    expect(typeof answers[0].latency_ms).toBe('number')
    expect(calls.some((c) => c.url.endsWith('/me/quest/q1/end'))).toBe(true)
  })

  it('homeLead sits above the quest tiles on home only, and onQuestEnd names the finished quest', async () => {
    installFetch((url) => {
      if (url.endsWith('/me')) return { status: 200, body: { alias: 'X', grade: 2, choices: ['space'] } }
      if (url.endsWith('/me/quest/start')) return { status: 200, body: { quest_id: 'q1', items_total: 1, item: ITEM } }
      if (url.endsWith('/me/quest/q1/answer')) {
        return { status: 200, body: { feedback: 'yay', say: 'Yay!', next_item: null, break: false, done: true, progress: { done: 1, total: 1 } } }
      }
      if (url.endsWith('/me/quest/q1/end')) return { status: 200, body: { saved: true } }
      return undefined
    })
    const ended: string[] = []
    render(
      <KidQuestPanel apiBase="/api/tutor" homeLead={<div data-testid="lead">from your teacher</div>} onQuestEnd={(q) => ended.push(q)} />,
    )
    await screen.findByTestId('home-screen')
    const lead = screen.getByTestId('lead')
    const firstTile = screen.getAllByRole('button', { name: /start/i })[0]
    expect(lead.compareDocumentPosition(firstTile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await startQuest(0)
    await screen.findByTestId('item-screen')
    expect(screen.queryByTestId('lead')).toBeNull()
    expect(ended).toEqual([])

    await typeAnswer('13')
    await waitFor(() => expect(screen.getByTestId('saved-card')).toBeTruthy())
    expect(ended).toEqual(['q1'])
  })

  it('a miss that also earns a break keeps its worked steps and still redoes after the break', async () => {
    const answers: Record<string, unknown>[] = []
    let n = 0
    const calls = installFetch((url, init) => {
      if (url.endsWith('/me')) return { status: 200, body: { alias: 'X', grade: 2 } }
      if (url.endsWith('/me/quest/start')) return { status: 200, body: { quest_id: 'q1', items_total: 4, item: ITEM } }
      if (url.endsWith('/me/quest/q1/answer')) {
        answers.push(body(init))
        n += 1
        if (n === 1) {
          return {
            status: 200,
            body: {
              feedback: 'lets_look', say: "Let's look together",
              hint_steps: ['8 needs 2 more to make 10.', '10 and 3 more is 13.'],
              next_item: null, break: true, done: false, progress: { done: 0, total: 4 },
            },
          }
        }
        return {
          status: 200,
          body: { feedback: 'yay', say: 'Yay!', next_item: null, break: false, done: true, progress: { done: 4, total: 4 } },
        }
      }
      if (url.endsWith('/me/quest/q1/end')) return { status: 200, body: { saved: true } }
      return undefined
    })
    const ended = () => calls.some((c) => c.url.endsWith('/me/quest/q1/end'))

    const { container } = render(<KidQuestPanel apiBase="/api/tutor" />)
    await startQuest(0)
    await screen.findByTestId('item-screen')
    await typeAnswer('12')

    // The worked steps come first, even though the server also asked for a break.
    await screen.findByTestId('look-card')
    expect(container.textContent).toContain('8 needs 2 more to make 10.')
    expect(ended()).toBe(false)
    assertCalm(container)
    fireEvent.click(screen.getByRole('button', { name: /next/i }))

    await screen.findByTestId('break-card')
    expect(ended()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /ready/i }))

    // After the break the missed item comes back as a redo; the quest did not end.
    await screen.findByTestId('item-screen')
    expect(container.textContent).toContain('8 + 5 = ?')
    expect(ended()).toBe(false)

    await typeAnswer('13')
    await screen.findByTestId('saved-card')
    expect(answers[1]).toMatchObject({ item_id: 'it-1', answer: '13', redo: true })
    expect(ended()).toBe(true)
    assertCalm(container)
  })

  it('picture choices for a reader item, and the progress path never shrinks', async () => {
    let n = 0
    installFetch((url) => {
      if (url.endsWith('/me')) return { status: 200, body: { alias: 'D', grade: 1 } }
      if (url.endsWith('/me/quest/start')) {
        return {
          status: 200,
          body: {
            quest_id: 'q2', items_total: 4,
            item: {
              item_id: 'c1', tts_text: 'Which one is c-a-t?', prompt_text: 'Which one is cat?', input: 'tap',
              choices: [{ value: 'cat', emoji: '🐱' }, { value: 'dog', emoji: '🐶' }, { value: 'sun', emoji: '☀️' }],
            },
          },
        }
      }
      if (url.endsWith('/me/space')) return { status: 404, body: {} } // FamilySpaceCard probe
      if (url.endsWith('/me/progress')) return { status: 404, body: {} } // home encouragement card
      n += 1
      // The server reporting a smaller "done" later must not step a stone back.
      const done = n === 1 ? 1 : 0
      return {
        status: 200,
        body: {
          feedback: 'yay', say: 'Yay!', break: false, done: false, progress: { done, total: 4 },
          next_item: {
            item_id: `c${n + 1}`, prompt_text: 'Which one is sun?', input: 'tap',
            choices: [{ value: 'sun', label: 'sun', emoji: '☀️' }, { value: 'hat', label: 'hat', emoji: '🎩' }],
          },
        },
      }
    })
    const { container } = render(<KidQuestPanel apiBase="/api/tutor" />)
    await startQuest(1)
    await screen.findByTestId('item-screen')
    const pics = screen.getAllByRole('button').filter((b) => ['🐱', '🐶', '☀️'].includes(b.textContent || ''))
    expect(pics).toHaveLength(3)
    await act(async () => { fireEvent.click(pics[0]) })
    await screen.findByTestId('yay-card')
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await screen.findByTestId('item-screen')
    const filled = () => screen.getByTestId('progress-path').querySelectorAll('[data-filled="yes"]').length
    expect(filled()).toBe(1)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'sun' })) })
    await screen.findByTestId('yay-card')
    expect(filled()).toBe(1)
    assertCalm(container)
  })

  it('shows a rest card at the daily cap (429)', async () => {
    installFetch((url) => {
      if (url.endsWith('/me')) return { status: 200, body: { alias: 'X' } }
      if (url.endsWith('/me/quest/start')) return { status: 429, body: { reason: 'rest_time', say: 'Rest time! See you tomorrow.' } }
      return undefined
    })
    const { container } = render(<KidQuestPanel apiBase="/api/tutor" />)
    await startQuest(0)
    await screen.findByTestId('rest-card')
    expect(container.textContent).toContain('Rest time! See you tomorrow.')
    assertCalm(container)
  })

  it('says "3 more then done" when three items remain, with 64px tap targets', async () => {
    installFetch((url) => {
      if (url.endsWith('/me')) return { status: 200, body: { alias: 'X' } }
      if (url.endsWith('/me/quest/start')) return { status: 200, body: { quest_id: 'q3', items_total: 3, item: ITEM } }
      return undefined
    })
    const { container } = render(<KidQuestPanel apiBase="/api/tutor" />)
    await startQuest(0)
    await screen.findByTestId('three-more')
    expect(container.querySelector('[data-testid*="timer"], [data-testid*="countdown"], [class*="timer"], [id*="timer"]')).toBeNull()
    for (const b of screen.getAllByRole('button')) {
      expect(parseInt(b.style.minHeight, 10)).toBeGreaterThanOrEqual(64)
      expect(parseInt(b.style.minWidth, 10)).toBeGreaterThanOrEqual(64)
    }
  })
})

describe('KidQuestPanel for a grown-up', () => {
  // Measured 2026-10-01: the owner opened /learn on their own account and got the
  // child's "type the code from your grown-up" screen. A guardian goes to the console.
  it('a guardian (no learner, has learners) is sent to the parent page, not the code screen', async () => {
    installFetch((url) => {
      if (url.endsWith('/me')) return { status: 404, body: {} }
      if (url.endsWith('/family/learners')) return { status: 200, body: [{ lid: 'lrn_x', alias: 'A' }] }
      return undefined
    })
    const onGuardian = jest.fn()
    render(<KidQuestPanel apiBase="/api/tutor" onGuardian={onGuardian} />)
    await screen.findByTestId('grownup-screen')
    expect(onGuardian).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('pair-screen')).toBeNull()
    expect(screen.getByText('Open the parent page').getAttribute('href')).toBe('/learn/parent')
  })

  it('a child with no learner yet is told to ask a grown-up to connect the phone', async () => {
    installFetch((url) => (url.endsWith('/me') ? { status: 404, body: {} } : undefined))
    render(<KidQuestPanel apiBase="/api/tutor" />)
    await screen.findByTestId('pair-screen')
    expect(screen.getByText('Ask your grown-up to connect this phone.')).toBeTruthy()
  })
})
