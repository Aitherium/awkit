/**
 * KidNest (Aither Learn, kids suite S5): the child's daily hub, in jsdom against a scripted
 * fetch. Pins: My day renders from named fields only; "What's today?" puts the server's
 * read-back in the Sprite's bubble; a routine step tap posts the tick; a gift that arrives
 * while the Nest is open is announced on the next look (well inside 5 s); a tool the
 * guardian switched off has no bubble; no link and no streak/timer copy is ever rendered.
 * Runs under AitherVeil's jest (its roots include awkit/src).
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import KidNest, { asDay } from '../panels/KidNest'

type Reply = { status: number; body: unknown }

const DAY = {
  greeting: 'Good morning, Athena!',
  announce: '',
  remembered: 'Loves sharks',
  speak: 'Good morning, Athena! Your morning has 2 steps left. First: Brush teeth.',
  routine: {
    rid: 'r1', name: 'Morning', when: 'morning', done_count: 0, all_done: false,
    steps: [{ sid: 's1', text: 'Brush teeth', icon: 'teeth', done: false },
      { sid: 's2', text: 'Get dressed', icon: 'dress', done: false }],
  },
  mailbox: [{ id: 'ft_1', kind: 'task', title: 'Feed the cat' }],
  reminders: [],
  events: [{ id: 'ke_1', title: 'Swimming', time: '16:00', icon: 'star' }],
  tools: ['my_routine', 'read_with_me', 'tell_my_sprite', 'remind_me', 'ask_a_grownup'],
  tool_words: { read_with_me: 'Read with me', tell_my_sprite: 'Tell my Sprite', remind_me: 'Remind me', ask_a_grownup: 'Ask a grown-up' },
  reminder_presets: [{ id: 'feed_pet', text: 'Feed my pet', icon: 'pet' }],
  when_choices: [{ id: 'after_school', label: 'After school' }],
  ask_presets: ['Can you play with me?'],
  free_text: false,
  // A server bug must never reach the screen.
  secret_url: 'https://evil.example.com',
}

function installFetch(route: (url: string, init?: RequestInit) => Reply | undefined) {
  const calls: { url: string; init?: RequestInit }[] = []
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const r = /\/me\/say(\/stream)?$/.test(url) || /sprite-body$/.test(url)
      ? { status: 503, body: { detail: 'off' } }
      : route(url, init) ?? { status: 404, body: { detail: 'nope' } }
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body } as unknown as Response
  }) as unknown as typeof fetch
  return calls
}

function assertCalm(container: HTMLElement) {
  expect(container.querySelector('a[href]')).toBeNull()
  expect(container.innerHTML).not.toContain('evil.example.com')
  expect(container.textContent || '').not.toMatch(/streak|countdown|timer|seconds left|missed/i)
}

beforeEach(() => {
  ;(window as unknown as { speechSynthesis?: unknown }).speechSynthesis = undefined
})

describe('asDay', () => {
  it('reads named fields only and drops malformed rows', () => {
    const d = asDay({ ...DAY, mailbox: [{ id: 1, kind: 'gift' }, { id: 'g', kind: 'loot' }, ...DAY.mailbox] })!
    expect(d.mailbox.map((m) => m.id)).toEqual(['ft_1'])
    expect(asDay(null)).toBeNull()
    expect(JSON.stringify(d)).not.toContain('evil.example.com')
  })
})

describe('KidNest', () => {
  it('shows My day, reads it back, and ticks a routine step', async () => {
    const calls = installFetch((url, init) => {
      if (url.includes('/me/nest/day')) return { status: 200, body: DAY }
      if (url.includes('/me/nest/routines/r1/steps/s1') && init?.method === 'POST') {
        return { status: 200, body: { say: 'You did it!', routine: DAY.routine } }
      }
      return undefined
    })
    const { container } = render(<KidNest apiBase="/api/tutor" refreshMs={0} />)
    expect(await screen.findByTestId('kid-nest')).toBeTruthy()
    expect(screen.getByTestId('nest-bubble')).toHaveTextContent('I remember: Loves sharks')
    fireEvent.click(screen.getByTestId('nest-today'))
    expect(screen.getByTestId('nest-bubble')).toHaveTextContent('Your morning has 2 steps left')
    expect(screen.getByTestId('nest-mailbox')).toHaveTextContent('Feed the cat')
    expect(screen.getByTestId('nest-today-list')).toHaveTextContent('Swimming')
    await act(async () => { fireEvent.click(screen.getByTestId('routine-step-s1')) })
    await waitFor(() => expect(screen.getByTestId('nest-bubble')).toHaveTextContent('You did it!'))
    const tick = calls.find((c) => c.url.includes('/steps/s1'))!
    expect(JSON.parse(String(tick.init?.body))).toMatchObject({ done: true })
    expect(String(tick.url)).not.toMatch(/lid|learner/)
    assertCalm(container)
  })

  it("draws the child's own sprites-v2 Sprite by the bubble, never the old nest emoji", async () => {
    installFetch((url) => (url.includes('/me/nest/day') ? { status: 200, body: DAY } : undefined))
    const { container } = render(<KidNest apiBase="/api/tutor" refreshMs={0} sprite={{ species: 'fox' }} />)
    expect(await screen.findByTestId('kid-nest')).toBeTruthy()
    expect(screen.getByTestId('nest-sprite').querySelector('svg')).toBeTruthy()
    expect(container.textContent || '').not.toContain(String.fromCodePoint(0x1faba))
  })

  it('announces a gift that arrives while the Nest is open, then unwraps it', async () => {
    jest.useFakeTimers()
    let withGift = false
    installFetch((url, init) => {
      if (url.includes('/me/nest/day')) {
        return { status: 200, body: withGift
          ? { ...DAY, announce: 'Your grown-up left you something!', mailbox: [{ id: 'fg_1', kind: 'gift', title: 'A gift from your grown-up', gift_type: 'book' }, ...DAY.mailbox] }
          : DAY }
      }
      if (url.includes('/me/nest/gifts/fg_1/open') && init?.method === 'POST') {
        return { status: 200, body: { gift: { type: 'book', title: 'Seeds', text: 'A seed needs water.', say: 'A book for you: Seeds.' } } }
      }
      return undefined
    })
    render(<KidNest apiBase="/api/tutor" refreshMs={4000} />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { jest.advanceTimersByTime(10) })
    expect(await screen.findByTestId('kid-nest')).toBeTruthy()
    withGift = true
    await act(async () => { jest.advanceTimersByTime(4000) })
    await waitFor(() => expect(screen.getByTestId('nest-bubble')).toHaveTextContent('Your grown-up left you something!'))
    expect(screen.getByTestId('nest-gift-fg_1')).toBeTruthy()
    jest.useRealTimers()
    await act(async () => { fireEvent.click(screen.getByTestId('nest-gift-fg_1')) })
    expect(await screen.findByTestId('nest-gift')).toHaveTextContent('A seed needs water.')
  })

  it('offers only the tools the guardian switched on', async () => {
    installFetch((url) => (url.includes('/me/nest/day')
      ? { status: 200, body: { ...DAY, tools: ['tell_my_sprite'], routine: null } } : undefined))
    render(<KidNest apiBase="/api/tutor" refreshMs={0} />)
    expect(await screen.findByTestId('nest-tool-tell_my_sprite')).toBeTruthy()
    expect(screen.queryByTestId('nest-tool-remind_me')).toBeNull()
    expect(screen.queryByTestId('nest-tool-read_with_me')).toBeNull()
    expect(screen.queryByTestId('nest-routine')).toBeNull()
  })

  it('makes a picture reminder in two taps and repeats the server answer', async () => {
    const calls = installFetch((url, init) => {
      if (url.includes('/me/nest/day')) return { status: 200, body: DAY }
      if (url.endsWith('/me/nest/reminders') && init?.method === 'POST') {
        return { status: 201, body: { made: true, say: "It's quiet time then, so I'll remind you at 7:30 in the morning instead." } }
      }
      return undefined
    })
    render(<KidNest apiBase="/api/tutor" refreshMs={0} />)
    fireEvent.click(await screen.findByTestId('nest-tool-remind_me'))
    fireEvent.click(screen.getByTestId('remind-feed_pet'))
    await act(async () => { fireEvent.click(screen.getByTestId('when-after_school')) })
    await waitFor(() => expect(screen.getByTestId('nest-bubble')).toHaveTextContent('quiet time'))
    const post = calls.find((c) => c.url.endsWith('/me/nest/reminders'))!
    expect(JSON.parse(String(post.init?.body))).toMatchObject({ preset: 'feed_pet', when: 'after_school' })
  })

  it('renders nothing when the Nest is not there (not a learner, or not served)', async () => {
    installFetch(() => ({ status: 404, body: { detail: 'Not paired yet' } }))
    const { container } = render(<KidNest apiBase="/api/tutor" refreshMs={0} />)
    await act(async () => { await Promise.resolve() })
    expect(container.innerHTML).toBe('')
  })
})
