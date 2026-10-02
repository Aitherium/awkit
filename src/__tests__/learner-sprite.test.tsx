/**
 * Aither Learn gap 6: the child's sprite on /learn home and the guardian's
 * "Hatch a sprite" action. Runs under AitherVeil's jest (roots include awkit/src).
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import KidQuestPanel from '../panels/KidQuestPanel'
import FamilyTutorConsolePanel from '../panels/FamilyTutorConsolePanel'
import { KidSpriteCard, LearnerSpriteButton } from '../panels/LearnerSprite'

type Reply = { status: number; body: unknown }

function installFetch(route: (url: string, init?: RequestInit) => Reply | undefined) {
  const calls: { url: string; init?: RequestInit }[] = []
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const r = route(url, init) ?? { status: 404, body: { detail: 'nope' } }
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body } as unknown as Response
  })
  return calls
}

const SPRITE = {
  name: "Athena's Buddy", species: 'owl', stage: 'baby', stage_word: 'Baby', level: 2,
  knowledge_count: 1, latest_learned: 'Make a ten!',
}
const GUILT = /miss(ed)? you|forgotten|lonely|\bsad\b|hungry|sulk|streak/i

describe('KidSpriteCard', () => {
  it('shows name, level and the latest learned thing, with no guilt copy', () => {
    const { container } = render(<KidSpriteCard sprite={SPRITE} />)
    expect(screen.getByText("Athena's Buddy")).toBeTruthy()
    expect(screen.getByTestId('kid-sprite-level').textContent).toContain('Level 2')
    expect(screen.getByTestId('kid-sprite-latest').textContent).toContain('Make a ten!')
    expect(container.textContent || '').not.toMatch(GUILT)
  })

  it('renders nothing without a sprite', () => {
    const { container } = render(<KidSpriteCard sprite={null} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('KidQuestPanel home', () => {
  it('mounts the sprite card from /me', async () => {
    installFetch((url) => (url.endsWith('/me')
      ? { status: 200, body: { alias: 'Athena', grade: 1, today_minutes_left: 15, sprite: SPRITE, choices: {} } }
      : undefined))
    render(<KidQuestPanel apiBase="/api/tutor" />)
    await waitFor(() => expect(screen.getByTestId('kid-sprite-card')).toBeTruthy())
    expect(screen.getByTestId('kid-sprite-latest').textContent).toContain('Make a ten!')
  })

  it('shows no sprite card when the child has none', async () => {
    installFetch((url) => (url.endsWith('/me')
      ? { status: 200, body: { alias: 'Alexander', grade: 2, sprite: null } } : undefined))
    render(<KidQuestPanel apiBase="/api/tutor" />)
    await waitFor(() => expect(screen.getByTestId('home-screen')).toBeTruthy())
    expect(screen.queryByTestId('kid-sprite-card')).toBeNull()
  })
})

describe('LearnerSpriteButton', () => {
  it('POSTs the idempotent hatch and then shows the sprite', async () => {
    const calls: string[] = []
    const call = jest.fn(async (path: string, method?: string) => {
      calls.push(`${method} ${path}`)
      return { status: 201, ok: true, data: { sprite: SPRITE, created: true } }
    })
    render(<LearnerSpriteButton call={call} lid="lrn_1" />)
    fireEvent.click(screen.getByTestId('hatch-sprite-lrn_1'))
    await waitFor(() => expect(screen.getByTestId('sprite-of-lrn_1')).toBeTruthy())
    expect(calls).toEqual(['POST /family/learners/lrn_1/sprite'])
    expect(screen.getByTestId('sprite-of-lrn_1').textContent).toContain("Athena's Buddy")
  })

  it('offers to convert a sprite the child already had into a learning buddy', async () => {
    const calls: string[] = []
    const call = jest.fn(async (path: string, method?: string) => {
      calls.push(`${method} ${path}`)
      return { status: 200, ok: true, data: { sprite: { ...SPRITE, name: 'Pip', learner_mode: true }, created: false } }
    })
    render(<LearnerSpriteButton call={call} lid="lrn_3" sprite={{ ...SPRITE, name: 'Pip', learner_mode: false }} />)
    expect(screen.getByTestId('sprite-of-lrn_3').textContent).toContain('Pip')
    fireEvent.click(screen.getByTestId('convert-sprite-lrn_3'))
    await waitFor(() => expect(screen.queryByTestId('convert-sprite-lrn_3')).toBeNull())
    expect(calls).toEqual(['POST /family/learners/lrn_3/sprite'])
    expect(screen.getByTestId('sprite-of-lrn_3').textContent).toContain('Pip')
  })

  it('shows no convert button for a learner-mode sprite', () => {
    const call = jest.fn()
    render(<LearnerSpriteButton call={call} lid="lrn_4" sprite={{ ...SPRITE, learner_mode: true }} />)
    expect(screen.getByTestId('sprite-of-lrn_4')).toBeTruthy()
    expect(screen.queryByTestId('convert-sprite-lrn_4')).toBeNull()
    expect(screen.queryByTestId('hatch-sprite-lrn_4')).toBeNull()
  })

  it('says pair first on 409', async () => {
    const call = jest.fn(async () => ({ status: 409, ok: false, data: { detail: 'x' } }))
    render(<LearnerSpriteButton call={call} lid="lrn_2" />)
    fireEvent.click(screen.getByTestId('hatch-sprite-lrn_2'))
    await waitFor(() => expect(screen.getByText('Pair or connect first')).toBeTruthy())
  })
})

describe('FamilyTutorConsolePanel', () => {
  it('offers a sprite per learner row and after add-child', async () => {
    const calls = installFetch((url, init) => {
      if (url.endsWith('/family/learners') && (!init || init.method === 'GET')) {
        return { status: 200, body: [
          { lid: 'lrn_a', alias: 'Athena', grade: 1, age_band: '6-7', claimed: true, sprite: null },
          { lid: 'lrn_x', alias: 'Alexander', grade: 2, age_band: '8-9', claimed: true, sprite: { ...SPRITE, name: 'Zap' } },
        ] }
      }
      if (url.endsWith('/family/children')) {
        return { status: 201, body: {
          learner: { lid: 'lrn_n', alias: 'Nova', grade: 1, age_band: '6-7', claimed: true },
          connect: { url: 'https://x/l', expires_in: 900 }, sprite_offer: true,
        } }
      }
      return undefined
    })
    render(<FamilyTutorConsolePanel apiBase="/api/tutor" />)
    await waitFor(() => expect(screen.getByTestId('hatch-sprite-lrn_a')).toBeTruthy())
    expect(screen.getByTestId('sprite-of-lrn_x').textContent).toContain('Zap')

    // Redesign: "Add a child" is a guided sheet (name + email, grade, consent).
    fireEvent.click(screen.getByRole('button', { name: 'Add a child' }))
    fireEvent.change(screen.getByLabelText('full name'), { target: { value: 'Nova Parkhurst' } })
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'nova@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByLabelText('child consent'))
    fireEvent.submit(screen.getByTestId('add-child-form'))
    await waitFor(() => expect(screen.getByTestId('sprite-offer')).toBeTruthy())
    expect(screen.getByTestId('hatch-sprite-lrn_n')).toBeTruthy()
    expect(calls.some((c) => c.url.endsWith('/family/children'))).toBe(true)
  })
})
