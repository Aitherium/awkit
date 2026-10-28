/**
 * FormsPanel reads what /api/forms answers, ends a hung load, and uses the OS frame's
 * tokens. A customer review, 2026-10-27: "Forms is kind of goofy" -- the window
 * sat on "Loading forms...", and the panel read `data.data.forms` / `form.form_id`
 * while the router answers `{forms: [{id, title, status, data: {fields}}]}`.
 * Runs under AitherVeil's jest (roots include awkit/src).
 */
import React from 'react'
import { readFileSync } from 'fs'
import { join } from 'path'
import { act, render, screen } from '@testing-library/react'
import FormsPanel, { formsFrom } from '../panels/FormsPanel'

const ENTITY = {
  id: 'f1', entity_type: 'forms', title: 'Site intake', status: 'draft',
  data: { title: 'Site intake', description: '', fields: [{ field_type: 'text', label: 'Name', required: true }] },
  created_at: '2026-10-27T10:00:00',
}

async function settle() {
  await act(async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)) })
}

describe('FormsPanel', () => {
  it('lists the forms the router returns', async () => {
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () =>
      ({ ok: true, status: 200, json: async () => ({ forms: [ENTITY], total: 1 }) }) as unknown as Response)
    await act(async () => { render(<FormsPanel />) })
    await settle()
    expect(screen.getByText('Site intake')).toBeTruthy()
    expect(screen.getByText('1 field')).toBeTruthy()
    expect(screen.queryByText('No forms yet. Create your first form above.')).toBeNull()
  })

  it('reads both payload shapes', () => {
    expect(formsFrom({ forms: [ENTITY] })[0]).toMatchObject({ form_id: 'f1', published: false })
    expect(formsFrom({ data: { forms: [{ form_id: 'x', title: 'T', fields: [], published: true }] } })[0])
      .toMatchObject({ form_id: 'x', published: true })
    expect(formsFrom(null)).toEqual([])
  })

  it('a load that never answers ends in an error with Retry, not Loading forever', async () => {
    jest.useFakeTimers()
    try {
      ;(global as unknown as { fetch: unknown }).fetch = jest.fn((_u: string, init?: RequestInit) =>
        new Promise((_res, rej) => {
          init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
        }))
      await act(async () => { render(<FormsPanel />) })
      expect(screen.getByText('Loading forms...')).toBeTruthy()
      await act(async () => { jest.advanceTimersByTime(16_000) })
      await act(async () => { await Promise.resolve() })
      expect(screen.getByRole('alert').textContent).toContain('did not answer')
      expect(screen.getByText('Retry')).toBeTruthy()
    } finally {
      jest.useRealTimers()
    }
  })

  it('uses only OS frame tokens (no --accent / --text / hard white)', () => {
    const src = readFileSync(join(__dirname, '..', 'panels', 'FormsPanel.tsx'), 'utf8')
    expect(src).not.toMatch(/var\(--accent\)/)
    expect(src).not.toMatch(/var\(--text\)/)
    expect(src).not.toContain("'#fff'")
  })
})
