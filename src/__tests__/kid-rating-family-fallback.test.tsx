/**
 * KidAssignmentsCard: "how did that feel?" for a Learn child their family linked
 * to a class.
 *
 * That child's quest lives in the FAMILY's tutor, so the class route
 * POST /me/quest/{qid}/rating answers 404. The card then sends the same rating to
 * POST /me/family/quest/{qid}/rating (which checks the quest at home). Without the
 * fallback the consent screen's "how it felt" share never receives anything.
 *
 * Pinned here: the fallback fires on 404 and ONLY on 404, carries the same enum and
 * nothing else, and the card never says "Thanks" for a rating nobody stored.
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import KidAssignmentsCard from '../panels/KidAssignmentsCard'

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

const CLASS_ROUTE = '/api/classroom/me/quest/q_9/rating'
const FAMILY_ROUTE = '/api/classroom/me/family/quest/q_9/rating'
const LIST: Reply = { status: 200, body: { assignments: [] } }

async function tap(word: string) {
  const chip = await screen.findByRole('button', { name: word })
  await act(async () => { fireEvent.click(chip) })
}

const posts = (calls: Call[]) => calls.filter((c) => c.init?.method === 'POST').map((c) => c.url)

describe('kid rating: a child linked from home', () => {
  it('falls back to the family route when the class route does not know the quest', async () => {
    const calls = installFetch((url) => {
      if (url.endsWith('/me/assignments')) return LIST
      if (url === FAMILY_ROUTE) return { status: 201, body: { ok: true, rating: 'hard' } }
      return undefined // the class route: 404
    })
    const onRated = jest.fn()
    render(<KidAssignmentsCard questId="q_9" onRated={onRated} />)
    await tap('Hard')
    await waitFor(() => expect(screen.getByTestId('kid-rating').textContent).toMatch(/Thanks!/))
    expect(posts(calls)).toEqual([CLASS_ROUTE, FAMILY_ROUTE])
    for (const c of calls.filter((x) => x.init?.method === 'POST')) expect(JSON.parse(String(c.init?.body))).toEqual({ rating: 'hard' })
    expect(onRated).toHaveBeenCalledWith('hard')
  })

  it('a class child never touches the family route', async () => {
    const calls = installFetch((url) => {
      if (url.endsWith('/me/assignments')) return LIST
      if (url === CLASS_ROUTE) return { status: 201, body: { ok: true } }
      return undefined
    })
    render(<KidAssignmentsCard questId="q_9" />)
    await tap('Easy')
    await waitFor(() => expect(screen.getByTestId('kid-rating').textContent).toMatch(/Thanks!/))
    expect(posts(calls)).toEqual([CLASS_ROUTE])
  })

  it('only a 404 falls through: a refusal or an outage is not retried elsewhere', async () => {
    const calls = installFetch((url) => {
      if (url.endsWith('/me/assignments')) return LIST
      if (url === CLASS_ROUTE) return { status: 503, body: { detail: 'busy' } }
      if (url === FAMILY_ROUTE) return { status: 201, body: { ok: true } }
      return undefined
    })
    const onRated = jest.fn()
    render(<KidAssignmentsCard questId="q_9" onRated={onRated} />)
    await tap('OK')
    await waitFor(() => expect(posts(calls)).toEqual([CLASS_ROUTE]))
    expect(screen.getByTestId('kid-rating').textContent).toMatch(/How did that feel\?/)
    expect(onRated).not.toHaveBeenCalled()
  })

  it('no fake thanks when neither route stored the rating', async () => {
    const calls = installFetch((url) => (url.endsWith('/me/assignments') ? LIST : undefined))
    const onRated = jest.fn()
    render(<KidAssignmentsCard questId="q_9" onRated={onRated} />)
    await tap('Easy')
    await waitFor(() => expect(posts(calls)).toEqual([CLASS_ROUTE, FAMILY_ROUTE]))
    expect(screen.getByTestId('kid-rating').textContent).toMatch(/How did that feel\?/)
    expect(onRated).not.toHaveBeenCalled()
  })
})
