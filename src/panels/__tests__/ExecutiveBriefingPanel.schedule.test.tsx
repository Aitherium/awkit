/**
 * aw-stack-gaps-04: the briefing panel says when the next daily briefing runs.
 *
 * The backend answers GET `${apiBase}/briefing/schedule` with the caller's stored
 * daily briefing (what the scheduled run wrote) and the next run time. The panel
 * shows that briefing, so the "next" line promises something it will display.
 * An app without the endpoint answers 404, and the panel then stays silent; an
 * app whose scheduler is off never shows the operator's reason to a customer.
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

import ExecutiveBriefingPanel, { nextBriefingLabel } from '../ExecutiveBriefingPanel'

const BRIEFING = {
  data: {
    date: '2026-10-14', greeting: 'Good morning', next_meeting: null,
    priority_items: [], events: [],
    emails: { vip: 0, urgent: 0, approval: 0, fyi: 0, total_unread: 0 },
    tasks_due: 0, mode: 'live',
  },
}

function mockFetch(schedule: unknown, status = 200) {
  ;(global as any).fetch = jest.fn(async (url: string) => {
    if (String(url).endsWith('/briefing/schedule')) {
      return { ok: status === 200, status, json: async () => schedule }
    }
    return { ok: true, status: 200, json: async () => BRIEFING }
  })
}

describe('ExecutiveBriefingPanel next briefing', () => {
  it('shows the next scheduled briefing', async () => {
    mockFetch({ enabled: true, next_run: '2026-10-15T08:15:00+00:00', latest: null })
    render(<ExecutiveBriefingPanel />)
    const line = await screen.findByTestId('next-briefing')
    expect(line.textContent).toMatch(/^Next daily briefing: /)
    expect((global as any).fetch).toHaveBeenCalledWith('/api/executive/briefing/schedule')
    expect(screen.queryByTestId('daily-briefing')).toBeNull()
  })

  it('shows the stored briefing the scheduler wrote', async () => {
    mockFetch({
      enabled: true, next_run: '2026-10-15T08:15:00+00:00',
      latest: { content: 'Two site visits; the Hayes RFI is due.', generated_at: '2026-10-14T08:15:10+00:00' },
    })
    render(<ExecutiveBriefingPanel />)
    const card = await screen.findByTestId('daily-briefing')
    expect(card.textContent).toContain('Two site visits; the Hayes RFI is due.')
    expect(card.textContent).toContain('Prepared ')
  })

  it('never shows operator detail when the scheduler is off', async () => {
    mockFetch({
      enabled: false, next_run: null,
      // An older backend still sends its internal reason; it must not render.
      reason: 'disabled by HOST_BRIEFING_SCHEDULER',
      latest: null,
    })
    render(<ExecutiveBriefingPanel />)
    await screen.findByText('Good morning')
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('next-briefing')).toBeNull()
    expect(screen.queryByText(/HOST_BRIEFING_SCHEDULER/)).toBeNull()
  })

  it('shows nothing when the app has no scheduler endpoint', async () => {
    mockFetch({ detail: 'Not Found' }, 404)
    render(<ExecutiveBriefingPanel />)
    await screen.findByText('Good morning')
    await waitFor(() => expect((global as any).fetch).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('next-briefing')).toBeNull()
  })

  it('formats the label without inventing a time', () => {
    expect(nextBriefingLabel(null)).toBeNull()
    expect(nextBriefingLabel({ enabled: true, next_run: 'garbage' })).toBeNull()
    expect(nextBriefingLabel({ enabled: true, next_run: '2026-10-15T08:15:00Z' })).toMatch(/^Next daily briefing: /)
    expect(nextBriefingLabel({ enabled: false, next_run: '2026-10-15T08:15:00Z' })).toBeNull()
  })
})
