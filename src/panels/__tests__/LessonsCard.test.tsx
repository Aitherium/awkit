/**
 * LessonsCard: what the workspace's assistant has learned, in workspace Settings.
 *
 * Pins: the first line is the next action; five rows then "+N more" with the real
 * total; each row says what, learned from what, when and how often it was used, with
 * on/off and forget; two settings; the number of controls a person sees on first load
 * (two with nothing learned, thirteen with seven lessons); a member or a backend
 * without lessons sees nothing; the cert tracker's Audit tab still shows one drop box
 * and one button. Lessons are synthetic.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { Audit } from '../CertTrackPanel'
import LessonsCard from '../LessonsCard'

type Call = { method: string; url: string; body?: string }

const lesson = (n: number, status = 'active') => ({
  id: `ls_${n}`, kind: 'memory', status,
  what: `A spreadsheet with the columns 'Tech', 'Ticket ${n}' is filed as: Certifications`,
  from: { evidence: n % 2 ? 'confirmed_mapping' : 'user_correction', source_turn: 'x' },
  when: 1_794_000_000 + n, used: n,
})

function page(total: number, waiting = 0, limit = 5) {
  const all = Array.from({ length: total }, (_, i) => lesson(i + 1, i < waiting ? 'proposed' : 'active'))
  const items = all.slice(0, limit)
  return {
    next_action: waiting ? `${waiting} lessons waiting for your OK`
      : total ? `${total} lessons in use. Nothing needs your OK.`
        : 'Nothing learned yet. Confirm a mapping or correct an answer and it shows up here.',
    items, total, more: Math.max(0, total - items.length), waiting,
    settings: { mode: 'ask', consolidate: 'task' },
  }
}

function serve(total: number, waiting = 0, status = 200) {
  const calls: Call[] = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    calls.push({ method, url: String(url), body: init?.body as string | undefined })
    if (method !== 'GET') return { ok: true, status: 200, json: async () => ({}) }
    if (String(url).includes('/certtrack/')) {
      return { ok: true, status: 200, json: async () => ({ have: [], documents: 0 }) }
    }
    const limit = Number(new URL(String(url), 'http://x').searchParams.get('limit') || 5)
    return { ok: status < 300, status, json: async () => page(total, waiting, limit) }
  })
  return calls
}

/** Every control a person can operate: buttons, links, inputs, selects. */
const controls = (root: HTMLElement) =>
  root.querySelectorAll('button, a[href], input, select, textarea').length

describe('LessonsCard', () => {
  it('says what needs doing first, then five rows and the real total', async () => {
    serve(7, 2)
    render(<LessonsCard agentName="Acme" />)
    expect(await screen.findByText('What Acme has learned')).toBeTruthy()
    const card = screen.getByTestId('lessons-card')
    expect(screen.getByTestId('lessons-next-action').textContent).toBe('2 lessons waiting for your OK')
    // The next action is the first thing in the box, above every row.
    expect(card.querySelector('div > div')?.getAttribute('data-testid')).toBe('lessons-next-action')
    expect(card.querySelectorAll('[data-lesson]')).toHaveLength(5)
    expect(screen.getByText('+2 more')).toBeTruthy()
    expect(screen.getByText('(7 in all)')).toBeTruthy()
  })

  it('shows what, from what, when and how often for each lesson', async () => {
    serve(1)
    render(<LessonsCard />)
    const row = (await screen.findByTestId('lessons-card')).querySelector('[data-lesson="ls_1"]') as HTMLElement
    expect(row.textContent).toContain("'Tech', 'Ticket 1' is filed as: Certifications")
    expect(row.textContent).toContain('Learned from your answer about a dropped file')
    expect(row.textContent).toContain(new Date(1_794_000_001 * 1000).toLocaleDateString())
    expect(row.textContent).toContain('used 1 time')
    expect(within(row).getByRole('checkbox')).toHaveProperty('checked', true)
    expect(within(row).getByRole('button', { name: /^Forget/ })).toBeTruthy()
  })

  it('first load shows two controls with nothing learned and thirteen with seven lessons', async () => {
    serve(0)
    const empty = render(<LessonsCard />)
    await screen.findByText(/Nothing learned yet/)
    expect(controls(empty.container)).toBe(2) // how it learns, how often it re-checks
    empty.unmount()

    serve(7)
    const full = render(<LessonsCard />)
    await screen.findByText('+2 more')
    // 5 rows x (on/off + forget) + "+2 more" + the two settings
    expect(controls(full.container)).toBe(13)
  })

  it('switches a lesson off, approves a waiting one, and forgets only after a second yes', async () => {
    const calls = serve(3, 1)
    render(<LessonsCard />)
    const card = await screen.findByTestId('lessons-card')
    const waiting = card.querySelector('[data-lesson="ls_1"]') as HTMLElement
    expect(within(waiting).queryByRole('checkbox')).toBeNull() // approved or forgotten, never switched on
    fireEvent.click(within(waiting).getByRole('button', { name: 'OK' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/lessons/ls_1/approve'))).toBe(true))

    const active = card.querySelector('[data-lesson="ls_2"]') as HTMLElement
    fireEvent.click(within(active).getByRole('checkbox'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/lessons/ls_2/off'))).toBe(true))

    fireEvent.click(within(card.querySelector('[data-lesson="ls_3"]') as HTMLElement).getByRole('button', { name: /^Forget/ }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, forget' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/api/lessons/ls_3'))).toBe(true))
  })

  it('saves the two settings', async () => {
    const calls = serve(0)
    render(<LessonsCard />)
    fireEvent.change(await screen.findByLabelText('How it learns'), { target: { value: 'auto' } })
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.body === '{"mode":"auto"}')).toBe(true))
    fireEvent.change(screen.getByLabelText('How often it re-checks'), { target: { value: 'weekly' } })
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.body === '{"consolidate":"weekly"}')).toBe(true))
    expect(screen.getByLabelText('How it learns').querySelectorAll('option')).toHaveLength(3)
  })

  it('"+N more" loads the rest', async () => {
    const calls = serve(7)
    render(<LessonsCard />)
    fireEvent.click(await screen.findByText('+2 more'))
    await waitFor(() => expect(calls.some((c) => c.url.includes('limit=100'))).toBe(true))
    await waitFor(() => expect(screen.getByTestId('lessons-card').querySelectorAll('[data-lesson]')).toHaveLength(7))
  })

  it('shows nothing to a member or on a backend without lessons', async () => {
    const calls = serve(3, 0, 403)
    const { container } = render(<LessonsCard />)
    await waitFor(() => expect(calls.length).toBe(1))
    expect(container.textContent).toBe('')
    expect(controls(container)).toBe(0)
  })
})

describe('the cert tracker Audit tab after learning', () => {
  it('still shows one drop box and one button on first load', async () => {
    serve(0)
    const { container } = render(<Audit base="/api/certtrack" />)
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalled())
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1)
    expect(container.querySelectorAll('button')).toHaveLength(1)
    expect(screen.getByRole('button').textContent).toBe('Download audit')
    expect(container.querySelectorAll('select')).toHaveLength(0)
    expect(container.textContent).not.toMatch(/lesson|learn/i)
  })
})
