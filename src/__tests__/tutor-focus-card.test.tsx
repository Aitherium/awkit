/**
 * TutorFocusCard (Aither Learn): the guardian's weekly focus picker + coach note.
 * Renders skills by kid_title from GET .../focus, caps the pick at 6 and the note at
 * 280 characters, PUTs {skills, note}, and is reachable from the parent console.
 */
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import TutorFocusCard from '../panels/TutorFocusCard'
import FamilyTutorConsolePanel from '../panels/FamilyTutorConsolePanel'

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

const CATALOG = [
  { skill_id: 'math.number_bonds_10', kid_title: 'Pairs that make 10', domain: 'math', ready: true },
  { skill_id: 'math.make_ten_strategy', kid_title: 'Make a ten', domain: 'math', ready: true },
  { skill_id: 'math.add_within_20', kid_title: 'Adding to 20', domain: 'math', ready: false },
  { skill_id: 'read.phx.cvc', kid_title: 'Reading short words', domain: 'reading', ready: false },
  { skill_id: 'read.a', kid_title: 'A', domain: 'reading', ready: true },
  { skill_id: 'read.b', kid_title: 'B', domain: 'reading', ready: true },
  { skill_id: 'read.c', kid_title: 'C', domain: 'reading', ready: true },
]

const FOCUS_URL = '/api/tutor/family/learners/l-x/focus'

describe('TutorFocusCard', () => {
  it('shows skills by kid_title, preselects the current focus and saves skills + note', async () => {
    const calls = installFetch((url, init) => {
      if (url === FOCUS_URL && (!init?.method || init.method === 'GET')) {
        return { status: 200, body: { lid: 'l-x', catalog: CATALOG,
          focus: { skills: [{ skill_id: 'math.make_ten_strategy', kid_title: 'Make a ten' }], note: 'be gentle',
            active: true, active_until: '2026-10-05T15:00:00+00:00' } } }
      }
      if (url === FOCUS_URL && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body))
        return { status: 200, body: { lid: 'l-x', focus: { skills: body.skills.map((s: string) => ({ skill_id: s })), note: body.note, active: true } } }
      }
      return undefined
    })
    const notes: string[] = []
    render(<TutorFocusCard apiBase="/api/tutor" lid="l-x" alias="X" onNote={(m) => notes.push(m)} />)
    const make10 = (await screen.findByLabelText('Make a ten')) as HTMLInputElement
    expect(make10.checked).toBe(true)
    expect(screen.getByText('Numbers')).toBeTruthy()
    expect(screen.getByText('Words')).toBeTruthy()
    expect((screen.getByLabelText('coach note') as HTMLTextAreaElement).value).toBe('be gentle')
    expect(screen.getByTestId('focus-until')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Adding to 20'))
    fireEvent.change(screen.getByLabelText('coach note'), { target: { value: 'Loves space. ' + 'z'.repeat(400) } })
    expect((screen.getByLabelText('coach note') as HTMLTextAreaElement).value.length).toBe(280)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save focus' })) })
    const put = calls.find((c) => c.init?.method === 'PUT')!
    const body = JSON.parse(String(put.init!.body))
    expect(body.skills).toEqual(['math.make_ten_strategy', 'math.add_within_20'])
    expect(body.note.length).toBe(280)
    expect(Object.keys(body).sort()).toEqual(['note', 'skills'])
    expect(notes).toContain('Focus saved.')
  })

  it('caps the pick at 6 and Clear sends an empty focus', async () => {
    const calls = installFetch((url, init) => {
      if (url === FOCUS_URL && init?.method === 'PUT') return { status: 200, body: { focus: {} } }
      if (url === FOCUS_URL) return { status: 200, body: { catalog: CATALOG, focus: {} } }
      return undefined
    })
    render(<TutorFocusCard apiBase="/api/tutor" lid="l-x" />)
    await screen.findByLabelText('Make a ten')
    for (const t of ['Pairs that make 10', 'Make a ten', 'Adding to 20', 'Reading short words', 'A', 'B']) {
      fireEvent.click(screen.getByLabelText(t))
    }
    const c = screen.getByLabelText('C') as HTMLInputElement
    expect(c.disabled).toBe(true)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear' })) })
    const put = calls.find((x) => x.init?.method === 'PUT')!
    expect(JSON.parse(String(put.init!.body))).toEqual({ skills: [], note: '' })
  })

  it('is reachable from the parent console', async () => {
    installFetch((url) => {
      if (url.endsWith('/family/learners')) {
        return { status: 200, body: [{ lid: 'l-x', alias: 'X', grade: 2, age_band: '8-9', claimed: true }] }
      }
      if (url === FOCUS_URL) return { status: 200, body: { catalog: CATALOG, focus: {} } }
      return undefined
    })
    render(<FamilyTutorConsolePanel apiBase="/api/tutor" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Weekly focus' }))
    expect(await screen.findByTestId('focus-view')).toBeTruthy()
    expect(await screen.findByLabelText('Make a ten')).toBeTruthy()
  })
})
