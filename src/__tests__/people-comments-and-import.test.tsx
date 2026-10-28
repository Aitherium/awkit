/**
 * Comments on a person, and a project list import, as the customer drives them.
 * A customer review, 2026-10-27: "There is no comments on people", and his
 * next task was "upload resumes, upload a list of all projects (current & past)".
 * Runs under AitherVeil's jest (roots include awkit/src).
 */
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import PeopleStaffNotes from '../panels/PeopleStaffNotes'
import DatabasePanel from '../panels/DatabasePanel'

type Call = { url: string; method: string; body?: unknown }

function json(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

async function settle() {
  await act(async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)) })
}

describe('PeopleStaffNotes', () => {
  it('lists, posts and deletes comments on the person', async () => {
    const calls: Call[] = []
    let comments = [{ id: 'c1', author: 'Ann', body: 'Strong on bridges', created_at: '2026-10-27T10:00:00' }]
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method || 'GET'
      calls.push({ url: String(url), method, body: init?.body })
      if (method === 'POST') {
        const c = { id: 'c2', author: 'Pat', body: JSON.parse(String(init!.body)).body, created_at: null }
        comments = [...comments, c]
        return json({ status: 'added', comment: c })
      }
      if (method === 'DELETE') return json({ status: 'deleted' })
      return json({ comments })
    })

    await act(async () => {
      render(<PeopleStaffNotes apiBase="/api/people" staffId="s1" resumeDocId={null} />)
    })
    await settle()
    expect(screen.getByText('Strong on bridges')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('New comment'), { target: { value: 'Lead for Rail Yard' } })
    await act(async () => { fireEvent.click(screen.getByText('Comment')) })
    await settle()
    expect(screen.getAllByTestId('people-staff-comment')).toHaveLength(2)
    expect(calls.find(c => c.method === 'POST')?.url).toBe('/api/people/staff/s1/comments')

    await act(async () => { fireEvent.click(screen.getAllByLabelText('Delete comment')[0]) })
    await settle()
    expect(calls.find(c => c.method === 'DELETE')?.url).toBe('/api/people/staff/s1/comments/c1')
    expect(screen.queryByText('Strong on bridges')).toBeNull()
  })

  it('uploads a resume as a document, then links it to the person', async () => {
    const calls: Call[] = []
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method || 'GET'
      calls.push({ url: String(url), method })
      if (String(url).endsWith('/upload')) return json({ doc_id: 'd9', filename: 'ann.pdf' })
      if (String(url).endsWith('/resume')) return json({ status: 'updated' })
      return json({ comments: [] })
    })
    const linked: Array<string | null> = []
    await act(async () => {
      render(<PeopleStaffNotes apiBase="/api/people" staffId="s1" resumeDocId={null}
        onResumeLinked={d => linked.push(d)} />)
    })
    const file = new File(['%PDF'], 'ann.pdf', { type: 'application/pdf' })
    await act(async () => { fireEvent.change(screen.getByLabelText('Resume file'), { target: { files: [file] } }) })
    await settle()
    expect(calls.map(c => `${c.method} ${c.url}`)).toEqual(expect.arrayContaining([
      'POST /api/documents/upload', 'PUT /api/people/staff/s1/resume',
    ]))
    expect(linked).toEqual(['d9'])
    expect(screen.getByText('ann.pdf attached.')).toBeTruthy()
  })
})

describe('DatabasePanel project list import', () => {
  it('posts the file and reloads the projects', async () => {
    const calls: Call[] = []
    let projects: object[] = []
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method || 'GET'
      calls.push({ url: String(url), method })
      if (String(url).endsWith('/projects/import')) {
        projects = [{ id: 'p1', name: 'Dock Bridge', client: null, location: null, value: null,
          year_completed: null, services: [], key_staff: [] }]
        return json({ created: 1, updated: 0, skipped_rows: [] })
      }
      return json(String(url).includes('/projects') ? projects : [])
    })
    await act(async () => { render(<DatabasePanel />) })
    await settle()
    expect(screen.getByText('Projects (0)')).toBeTruthy()
    const file = new File(['Project\nDock Bridge\n'], 'projects.csv', { type: 'text/csv' })
    await act(async () => { fireEvent.change(screen.getByLabelText('Project list file'), { target: { files: [file] } }) })
    await settle()
    expect(calls.some(c => c.method === 'POST' && c.url === '/api/data/projects/import')).toBe(true)
    expect(screen.getByText('Projects (1)')).toBeTruthy()
    expect(screen.getByText('Imported projects.csv: 1 added, 0 updated.')).toBeTruthy()
  })
})
