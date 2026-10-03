/**
 * Activity feed on a static tenant site. Measured on a tenant site 2026-10-03:
 * EventSource is not routed by the fetch wrapper, so the relative `/api/activity/stream`
 * hit the CDN and 404'd on every page; the panel never loaded history, and its retry
 * opened a stream with no handlers. It must load history, stream from the API base with
 * credentials, and reconnect with handlers attached.
 */
import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'

import ActivityFeedPanel from '../ActivityFeedPanel'
import { setApiBase } from '../../lib/apiBase'

class FakeES {
  static all: FakeES[] = []
  url: string
  init: any
  onmessage: ((m: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  constructor(url: string, init?: any) { this.url = url; this.init = init; FakeES.all.push(this) }
  close() { this.closed = true }
}

beforeEach(() => {
  FakeES.all = []
  ;(global as any).EventSource = FakeES
  ;(global as any).fetch = jest.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ activity: [
      { id: 'a1', user_id: 'u', user_name: 'Dana', action: 'upload', subject: 'bridge.pdf',
        detail: {}, created_at: new Date().toISOString() },
    ] }),
  }))
  setApiBase('https://tenant-api.example.test')
})

afterEach(() => { setApiBase(null); jest.useRealTimers() })

test('loads recent history and streams from the API base with credentials', async () => {
  render(<ActivityFeedPanel />)
  await waitFor(() => expect(screen.getByText('Dana')).toBeTruthy())
  expect(FakeES.all[0].url).toBe('https://tenant-api.example.test/api/activity/stream')
  expect(FakeES.all[0].init).toEqual({ withCredentials: true })
})

test('a dropped stream reconnects with its message handler attached', async () => {
  jest.useFakeTimers()
  render(<ActivityFeedPanel />)
  act(() => { FakeES.all[0].onerror!() })
  act(() => { jest.advanceTimersByTime(5000) })
  expect(FakeES.all.length).toBe(2)
  expect(FakeES.all[1].onmessage).toBeInstanceOf(Function)
  act(() => {
    FakeES.all[1].onmessage!({ data: JSON.stringify({
      id: 'a2', user_id: 'u', user_name: 'Lee', action: 'query', subject: 'NJDOT',
      detail: {}, created_at: new Date().toISOString() }) })
  })
  expect(screen.getByText('Lee')).toBeTruthy()
})
