/**
 * The briefing says what is true about the reader's day (a tenant host, 2026-11-16).
 *
 * The owner opened Decisions > Briefing at 08:49 PM and read "Good morning", then a
 * NEXT MEETING card reading "Invalid Date - Invalid Date" with a "Now" pill and a Prepare
 * button, beside "Meetings 0" and "No meetings today". Three defects:
 *   - the heading printed the server's greeting, computed from its UTC hour;
 *   - an empty workspace's payload carried a zeroed next_meeting object, and the card
 *     rendered any object;
 *   - formatTime turned '' into the literal text "Invalid Date" (new Date('') does not throw).
 */
import React from 'react'
import { render, screen } from '@testing-library/react'

import ExecutiveBriefingPanel, { formatTime, upcomingMeeting } from '../ExecutiveBriefingPanel'

/** What /api/executive/briefing answered for the empty tenant workspace before the fix. */
const EMPTY_DAY = {
  data: {
    date: '2026-11-17', greeting: 'Good morning',
    next_meeting: { event_id: '', title: '', start_time: '', end_time: '', attendees: [], minutes_until: 0 },
    priority_items: [], events: [],
    emails: { vip: 0, urgent: 0, approval: 0, fyi: 0, total_unread: 0 },
    tasks_due: 0, mode: 'empty',
  },
}

function serve(briefing: unknown) {
  ;(global as any).fetch = jest.fn(async (url: string) => {
    if (String(url).endsWith('/briefing/schedule')) {
      return { ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) }
    }
    return { ok: true, status: 200, json: async () => briefing }
  })
}

afterEach(() => jest.restoreAllMocks())

describe('ExecutiveBriefingPanel tells the truth about the day', () => {
  it('greets by the reader\'s local hour, not the server\'s', async () => {
    // 20:49 on the reader's clock; the server (UTC, 04:49 next day) said "Good morning".
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(20)
    serve(EMPTY_DAY)
    render(<ExecutiveBriefingPanel />)
    const heading = await screen.findByTestId('briefing-greeting')
    expect(heading.textContent).toBe('Good evening')
    expect(screen.queryByText('Good morning')).toBeNull()
  })

  it('draws no next-meeting card for a blank meeting object', async () => {
    serve(EMPTY_DAY)
    render(<ExecutiveBriefingPanel />)
    await screen.findByTestId('briefing-greeting')
    expect(screen.queryByTestId('next-meeting')).toBeNull()
    expect(screen.queryByText(/NEXT MEETING/)).toBeNull()
    expect(screen.queryByText(/Invalid Date/)).toBeNull()
    expect(screen.queryByText('Prepare')).toBeNull()
    expect(screen.queryByText('Now')).toBeNull()
    expect(screen.getByText('No meetings today.')).toBeInTheDocument()
    // The predicate behind it: a title AND a start that is a date, or nothing.
    expect(upcomingMeeting(EMPTY_DAY.data.next_meeting)).toBeNull()
    expect(upcomingMeeting({ ...EMPTY_DAY.data.next_meeting, title: 'Site walk' })).toBeNull()
    expect(upcomingMeeting(null)).toBeNull()
    const real = { ...EMPTY_DAY.data.next_meeting, title: 'Site walk', start_time: '2026-11-17T17:00:00Z' }
    expect(upcomingMeeting(real)).toBe(real)
  })

  it('formatTime returns empty text for a value that is not a date', () => {
    expect(formatTime('')).toBe('')
    expect(formatTime('not a date')).toBe('')
    expect(formatTime(null)).toBe('')
    expect(formatTime(undefined)).toBe('')
    expect(formatTime('2026-11-17T17:00:00Z')).not.toBe('')
    expect(formatTime('2026-11-17T17:00:00Z')).not.toMatch(/Invalid/)
  })
})
