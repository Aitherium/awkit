/**
 * AcademyMirrorCard (Aither Learn -> Academy): off until the guardian turns it on,
 * POSTs the guardian-only mirror, then shows first names and a standards count.
 */
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import AcademyMirrorCard from '../panels/AcademyMirrorCard'

function makeCall(enabledAfterPost: boolean) {
  let enabled = false
  const calls: Array<[string, string]> = []
  const call = jest.fn(async (path: string, method = 'GET') => {
    calls.push([path, method])
    if (method === 'POST') {
      enabled = enabledAfterPost
      return { status: 200, ok: true, data: { class_id: 'cls_home_x', students: [] } }
    }
    return {
      status: 200,
      ok: true,
      data: enabled
        ? { enabled: true, class_id: 'cls_home_x', students: [
          { student_id: 'lrn_a', name: 'Athena', mastery_per_standard: { 'RF.1.3b': 0.9 } },
          { student_id: 'lrn_b', name: 'Alexander', mastery_per_standard: { 'RF.K.3a': 0.4, 'RF.K.3b': 0.4 } },
        ] }
        : { enabled: false, class_id: 'cls_home_x', students: [] },
    }
  })
  return { call, calls }
}

test('starts off, turns on with one POST, then lists first names only', async () => {
  const { call, calls } = makeCall(true)
  await act(async () => { render(<AcademyMirrorCard call={call} />) })
  expect(screen.getByTestId('academy-mirror-sync').textContent).toBe('Show in Academy')
  expect(screen.queryByTestId('academy-mirror-students')).toBeNull()

  await act(async () => { fireEvent.click(screen.getByTestId('academy-mirror-sync')) })
  expect(calls.filter(([, m]) => m === 'POST')).toEqual([['/family/academy-mirror', 'POST']])
  const list = screen.getByTestId('academy-mirror-students').textContent || ''
  expect(list).toContain('Athena: 1 standards tracked')
  expect(list).toContain('Alexander: 2 standards tracked')
  expect(screen.getByTestId('academy-mirror-sync').textContent).toBe('Update now')
})

test('a refused mirror stays off with a calm note', async () => {
  const call = jest.fn(async (_p: string, method = 'GET') => (
    method === 'POST' ? { status: 403, ok: false, data: null } : { status: 403, ok: false, data: null }))
  await act(async () => { render(<AcademyMirrorCard call={call} />) })
  await act(async () => { fireEvent.click(screen.getByTestId('academy-mirror-sync')) })
  expect(screen.getByRole('status').textContent).toBe('Could not update Academy right now.')
  expect(screen.getByTestId('academy-mirror-sync').textContent).toBe('Show in Academy')
})
