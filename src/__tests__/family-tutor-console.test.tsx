/**
 * FamilyTutorConsolePanel (Aither Learn): the guardian console, rendered in jsdom
 * against a scripted fetch. Enroll needs both consent boxes and shows the pair
 * code once; the weekly report renders as observations; the transcript has no
 * delete control. Runs under AitherVeil's jest (its roots include awkit/src).
 */
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
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

const LEARNERS = [
  { lid: 'l-x', alias: 'X', grade: 2, age_band: '8-9', claimed: true, settings: { quest_minutes: 7 } },
]

const REPORT = {
  minutes: 42,
  sessions: 5,
  attempts: 88,
  breaks_used: 3,
  skills: {
    'math.add_within_20': { state: 'secure', kid_title: 'Adding to 20', score: 0.93 },
    'math.make_ten': { state: 'learning', kid_title: 'Make ten', score: 0.5 },
  },
  edge: ['Subtracting within 20'],
  at_risk_reviews: ['Number bonds to 10'],
  observations: ['Often took a break after about 4 items.', 'Used the redo on make-ten twice.'],
  notes: [],
}

describe('FamilyTutorConsolePanel', () => {
  it('enroll is disabled until both consent boxes are ticked, then shows the pair code once', async () => {
    const calls = installFetch((url, init) => {
      if (url.endsWith('/family/learners') && (!init?.method || init.method === 'GET')) return { status: 200, body: [] }
      if (url.endsWith('/family/learners') && init?.method === 'POST') {
        return { status: 200, body: { lid: 'l-d', pair_code: 'K7PQ42', expires_at: '2026-09-29T12:15:00Z' } }
      }
      return undefined
    })
    render(<FamilyTutorConsolePanel apiBase="/api/tutor" />)
    // Redesign: the empty state invites "Add a child"; the legacy pair-code path sits under Advanced.
    await screen.findByTestId('learners-empty')
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))
    fireEvent.change(screen.getByLabelText('nickname'), { target: { value: 'D' } })
    const enroll = screen.getByRole('button', { name: 'Enroll' }) as HTMLButtonElement
    expect(enroll.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('notice read'))
    expect(enroll.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('consent'))
    expect(enroll.disabled).toBe(false)
    await act(async () => { fireEvent.click(enroll) })
    expect((await screen.findByTestId('pair-code')).textContent).toBe('K7PQ42')

    const post = calls.find((c) => c.init?.method === 'POST')
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      alias: 'D', grade: 1, age_band: '6-7', guardian_consent: { notice_read: true, consent: true },
    })

    fireEvent.click(screen.getByRole('button', { name: /wrote it down/i }))
    expect(screen.queryByTestId('pair-code')).toBeNull()
  })

  it('renders the weekly report as observations and the transcript with no delete', async () => {
    installFetch((url) => {
      if (url.endsWith('/family/learners')) return { status: 200, body: LEARNERS }
      if (url.includes('/family/learners/l-x/report')) return { status: 200, body: REPORT }
      if (url.includes('/family/learners/l-x/transcript')) {
        return { status: 200, body: [{ ts: 1790000000, kind: 'say', say: 'What is 8 plus 5?' }, { ts: 1790000005, kind: 'answer', text: '13' }] }
      }
      return undefined
    })
    const { container } = render(<FamilyTutorConsolePanel apiBase="/api/tutor" />)
    await screen.findByText('X')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /weekly report/i })) })
    const report = await screen.findByTestId('report-view')
    expect(report.textContent).toContain('42')
    expect(report.textContent).toContain('What we noticed')
    expect(report.textContent).toContain('Often took a break after about 4 items.')
    expect(report.textContent).toContain('Adding to 20: Comfortable')
    expect(report.textContent).toContain('Subtracting within 20')
    // Observations, never diagnoses or grades.
    expect(report.textContent).not.toMatch(/adhd|ocd|diagnos|disorder|fail|wrong|incorrect/i)

    // Transcript moved under the tile's "More" disclosure.
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /transcript/i })) })
    const tx = await screen.findByTestId('transcript-view')
    expect(tx.textContent).toContain('What is 8 plus 5?')
    expect(container.textContent).not.toMatch(/delete/i)
  })

  it('saves settings with PATCH and assigns practice', async () => {
    const calls = installFetch((url, init) => {
      if (url.endsWith('/family/learners') && (!init?.method || init.method === 'GET')) return { status: 200, body: LEARNERS }
      if (url.endsWith('/family/learners/l-x') && init?.method === 'PATCH') return { status: 200, body: { ok: true } }
      if (url.endsWith('/family/learners/l-x/assign')) return { status: 200, body: { assignment_id: 'a1' } }
      return undefined
    })
    render(<FamilyTutorConsolePanel apiBase="/api/tutor" extraHeaders={{ Authorization: 'Bearer g' }} />)
    await screen.findByText('X')
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('button', { name: /^settings$/i }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /save settings/i })) })
    await screen.findByText('Settings saved.')
    const patch = calls.find((c) => c.init?.method === 'PATCH')
    expect(JSON.parse(String(patch?.init?.body)).settings).toMatchObject({ quest_minutes: 7, ask_enabled: false })
    expect((patch?.init?.headers as Record<string, string>).Authorization).toBe('Bearer g')

    fireEvent.click(screen.getByRole('button', { name: /assign practice/i }))
    fireEvent.change(screen.getByPlaceholderText('math.add_within_20'), { target: { value: 'math.make_ten' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Assign' })) })
    await screen.findByText('Practice assigned.')
  })

  it('a non-guardian sees a plain note, not learners', async () => {
    installFetch(() => ({ status: 403, body: { detail: 'forbidden' } }))
    render(<FamilyTutorConsolePanel apiBase="/api/tutor" />)
    await screen.findByText(/owner or admin/i)
  })
})

async function waitForText(testId: string, text: string) {
  for (let i = 0; i < 50; i++) {
    const el = screen.queryByTestId(testId)
    if (el && (el.textContent || '').includes(text)) return
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
  }
  throw new Error(`${testId} never showed ${text}: ${screen.queryByTestId(testId)?.textContent}`)
}

describe('FamilyTutorConsolePanel redesign', () => {
  afterEach(() => { jest.useRealTimers() })

  it('retries a failed load once after 3 s, then shows offline with Try again, which re-runs the load', async () => {
    jest.useFakeTimers()
    let up = false
    const calls = installFetch((url) => {
      if (url.endsWith('/family/learners')) return up ? { status: 200, body: LEARNERS } : { status: 502, body: null }
      return undefined
    })
    render(<FamilyTutorConsolePanel apiBase="/api/tutor" />)
    // Skeleton tiles, not a sentence, while the first read and its retry run.
    expect(screen.getByTestId('learners-loading')).toBeTruthy()
    const listCalls = () => calls.filter((c) => c.url.endsWith('/family/learners')).length
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(listCalls()).toBe(1)
    expect(screen.queryByTestId('learners-error')).toBeNull()
    await act(async () => { jest.advanceTimersByTime(3000) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(listCalls()).toBe(2)
    const err = screen.getByTestId('learners-error')
    expect(err.textContent).toMatch(/offline/i)
    expect(err.textContent).not.toMatch(/could not load learners/i)

    up = true
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(listCalls()).toBe(3)
    expect(screen.getByText('X')).toBeTruthy()
    expect(screen.queryByTestId('learners-error')).toBeNull()
  })

  it('shows each child with real numbers for the week, and offline when the report does not answer', async () => {
    installFetch((url) => {
      if (url.endsWith('/family/learners')) {
        return { status: 200, body: [...LEARNERS, { lid: 'l-y', alias: 'Y', grade: 0, age_band: '6-7', claimed: true }] }
      }
      if (url.includes('/family/learners/l-x/report')) return { status: 200, body: REPORT }
      if (url.includes('/family/learners/l-y/report')) return { status: 503, body: null }
      return undefined
    })
    render(<FamilyTutorConsolePanel apiBase="/api/tutor" />)
    await screen.findByText('X')
    await waitForText('glance-l-x', '42')
    expect(screen.getByTestId('glance-l-x').textContent).toContain('min this week')
    await waitForText('glance-l-y', 'offline')
    // No fake total while one child's week is offline.
    expect(screen.getByTestId('family-summary').textContent).toBe('2 children')
    expect(screen.getAllByRole('button', { name: 'Connect a phone' })).toHaveLength(2)
    expect(screen.queryByText(/new pair code/i)).toBeNull()
  })

  it('Connect a phone opens the QR sheet with the real countdown, and the link never reaches the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => {}))
    const url = 'https://aitherium.com/learn/connect#t=SECRET-TICKET'
    const calls = installFetch((u, init) => {
      if (u.endsWith('/family/learners')) {
        return { status: 200, body: [{ lid: 'l-a', alias: 'Athena', display_name: 'Athena Parkhurst', grade: 1, age_band: '6-7', claimed: true, user_id: 'u-a' }] }
      }
      if (u.endsWith('/family/learners/l-a/connect-link') && init?.method === 'POST') {
        return { status: 200, body: { connect: { url, expires_in: 900, qr_svg_data_uri: 'data:image/svg+xml;base64,PHN2Zy8+' } } }
      }
      return undefined
    })
    render(<FamilyTutorConsolePanel apiBase="/api/tutor" />)
    await screen.findByText('Athena')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Connect a phone' })) })
    const card = await screen.findByTestId('connect-phone-card')
    expect(screen.getByTestId('connect-countdown').textContent).toMatch(/scan with athena's phone · 1[45]:\d\d/)
    expect(screen.getByTestId('connect-url').textContent).toBe(url)
    expect(card.querySelector('img')?.getAttribute('src')).toContain('data:image/svg+xml')
    expect(card.textContent).not.toMatch(/pair code/i)

    // "New code" mints a fresh link with the same call.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'New code' })) })
    expect(calls.filter((c) => c.url.endsWith('/connect-link')).length).toBe(2)

    for (const s of spies) {
      for (const args of s.mock.calls) expect(JSON.stringify(args)).not.toContain('SECRET-TICKET')
      s.mockRestore()
    }
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('SECRET-TICKET')
  })

  it('Add a child is a guided sheet: name and email, grade, consent, then the QR', async () => {
    const calls = installFetch((url, init) => {
      if (url.endsWith('/family/learners') && (!init?.method || init.method === 'GET')) return { status: 200, body: [] }
      if (url.endsWith('/family/children')) {
        return { status: 201, body: { learner: { lid: 'l-n', alias: 'Nova', grade: 3, age_band: '8-9', claimed: true }, connect: { url: 'https://x/learn/connect#t=T', expires_in: 900 } } }
      }
      return undefined
    })
    render(<FamilyTutorConsolePanel apiBase="/api/tutor" />)
    await screen.findByTestId('learners-empty')
    fireEvent.click(screen.getByRole('button', { name: 'Add a child' }))
    const next = screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement
    expect(next.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('full name'), { target: { value: 'Nova Parkhurst' } })
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'nova@example.com' } })
    expect(next.disabled).toBe(false)
    fireEvent.click(next)
    expect(screen.queryByTestId('k2-only-note')).toBeNull() // default 1st grade: no note
    fireEvent.click(screen.getByRole('radio', { name: '3rd grade' }))
    // Content is K-2 today: an older child is told, not silently given 2nd-grade work.
    expect(screen.getByTestId('k2-only-note').textContent).toMatch(/kindergarten to 2nd grade/)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    const add = screen.getByRole('button', { name: 'Add child' }) as HTMLButtonElement
    expect(add.disabled).toBe(true) // consent required
    fireEvent.click(screen.getByLabelText('child consent'))
    expect(add.disabled).toBe(false)
    await act(async () => { fireEvent.click(add) })
    expect((await screen.findByTestId('connect-url')).textContent).toBe('https://x/learn/connect#t=T')
    const post = calls.find((c) => c.url.endsWith('/family/children'))
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      full_name: 'Nova Parkhurst', email: 'nova@example.com', grade: 3, guardian_consent: true,
    })
  })
})

describe('FamilyTutorConsolePanel co-guardians', () => {
  async function openSettings(role: 'primary' | 'co') {
    const calls = installFetch((url, init) => {
      if (url.endsWith('/family/learners') && (!init?.method || init.method === 'GET')) {
        return { status: 200, body: [{ ...LEARNERS[0], guardian_role: role }] }
      }
      if (url.endsWith('/sprite/parental')) return { status: 200, body: { chat_disabled: false, pin_set: true } }
      if (url.endsWith('/co-guardians')) {
        return { status: 200, body: { can_manage: role === 'primary', co_guardians: [], candidates: [] } }
      }
      return undefined
    })
    render(<FamilyTutorConsolePanel apiBase="/api/tutor" />)
    await screen.findByText('X')
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('button', { name: /^settings$/i }))
    await screen.findByTestId('sprite-chat-state')
    return calls
  }

  it('the guardian of record gets the share section and Remove', async () => {
    await openSettings('primary')
    expect(await screen.findByTestId('co-guardians')).toBeInTheDocument()
    expect(screen.getByTestId('remove-learner')).toBeInTheDocument()
  })

  it('a co-guardian gets neither the share section nor Remove', async () => {
    const calls = await openSettings('co')
    expect(screen.queryByTestId('co-guardians')).toBeNull()
    expect(screen.queryByTestId('remove-learner')).toBeNull()
    expect(calls.some((c) => c.url.endsWith('/co-guardians'))).toBe(false)
  })
})
