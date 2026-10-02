/**
 * FamilySpaceCard (Aither Learn family Spaces): guardian "Make Space" posts once
 * and renders the Space; the kid card renders nothing without a Space, opens to
 * first name + learned + favorites, and saves picks from the fixed lists only.
 * No publish/share/public control ever renders.
 */
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import FamilySpaceCard from '../panels/FamilySpaceCard'

type Reply = { status: number; body: unknown }

function installFetch(route: (url: string, init?: RequestInit) => Reply | undefined) {
  const calls: { url: string; init?: RequestInit }[] = []
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const r = route(url, init) ?? { status: 404, body: { detail: 'Not found' } }
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body } as unknown as Response
  })
  return calls
}

const CHOICES = {
  colors: [{ id: 'blue', label: 'Blue', hex: '#3e63dd' }, { id: 'pink', label: 'Pink', hex: '#e93d82' }],
  animals: [{ id: 'owl', label: 'Owl', emoji: '🦉' }, { id: 'cat', label: 'Cat', emoji: '🐱' }],
  max: 3,
}
const SPACE = {
  display_name: 'Athena',
  avatar: { kind: 'sprite', stage: 'sprout', knowledge_count: 2 },
  learned: ['Adding to 20'],
  favorites: { colors: [CHOICES.colors[1]], animals: [] },
  visibility: 'family',
}

function noPublicControls() {
  for (const word of [/publish/i, /make public/i, /share/i, /guestbook/i]) {
    expect(screen.queryByRole('button', { name: word })).toBeNull()
  }
}

describe('FamilySpaceCard', () => {
  it('guardian: mounting makes the Space once and shows it', async () => {
    const calls = installFetch((url, init) => {
      if (url.endsWith('/family/learners/l-a/space') && init?.method === 'POST') {
        return { status: 201, body: { created: true, space: SPACE, choices: CHOICES } }
      }
      return undefined
    })
    await act(async () => {
      render(<FamilySpaceCard mode="guardian" apiBase="/api/tutor" lid="l-a" name="Athena" />)
    })
    await screen.findByText(/Hi, I'm Athena!/)
    expect(calls.filter((c) => c.init?.method === 'POST')).toHaveLength(1)
    expect(screen.getByText('Adding to 20')).toBeTruthy()
    expect(screen.getByText(/only your family can see it/i)).toBeTruthy()
    noPublicControls()
  })

  it('guardian: a learner with no account gets a plain note', async () => {
    installFetch(() => ({ status: 409, body: { detail: 'This learner needs an account first' } }))
    await act(async () => {
      render(<FamilySpaceCard mode="guardian" apiBase="/api/tutor" lid="l-b" />)
    })
    await screen.findByText(/needs their own account first/i)
  })

  it('kid: renders nothing when there is no Space yet', async () => {
    installFetch(() => undefined)
    let container: HTMLElement | null = null
    await act(async () => {
      container = render(<FamilySpaceCard mode="kid" apiBase="/api/tutor" />).container
    })
    expect(container!.textContent).toBe('')
  })

  it('kid: opens, shows the Space, and saves favorites from the fixed lists', async () => {
    const calls = installFetch((url, init) => {
      if (url.endsWith('/me/space') && (!init?.method || init.method === 'GET')) {
        return { status: 200, body: { space: SPACE, choices: CHOICES } }
      }
      if (url.endsWith('/me/space/favorites') && init?.method === 'POST') {
        const picked = JSON.parse(String(init.body))
        return { status: 200, body: { space: { ...SPACE, favorites: {
          colors: CHOICES.colors.filter((c) => picked.colors.includes(c.id)),
          animals: CHOICES.animals.filter((a) => picked.animals.includes(a.id)),
        } } } }
      }
      return undefined
    })
    await act(async () => { render(<FamilySpaceCard mode="kid" apiBase="/api/tutor" />) })
    fireEvent.click(await screen.findByRole('button', { name: /my space/i }))
    expect(screen.getByText(/Hi, I'm Athena!/)).toBeTruthy()
    expect(screen.getByTestId('space-sprite').textContent).toMatch(/sprout/)
    noPublicControls()
    fireEvent.click(screen.getByRole('button', { name: /pick favorites/i }))
    fireEvent.click(screen.getByRole('button', { name: /Owl/ }))
    fireEvent.click(screen.getByRole('button', { name: /Blue/ }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    const post = calls.find((c) => c.url.endsWith('/me/space/favorites'))
    expect(JSON.parse(String(post!.init!.body))).toEqual({ colors: ['pink', 'blue'], animals: ['owl'] })
    expect(Object.keys(JSON.parse(String(post!.init!.body))).sort()).toEqual(['animals', 'colors'])
    await screen.findByTestId('space-favorites')
    expect(screen.getByTestId('space-favorites').textContent).toMatch(/Owl/)
  })
})
