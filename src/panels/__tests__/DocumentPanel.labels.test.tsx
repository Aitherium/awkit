/**
 * Projects that stick, moving, tagging and images (customer report 2026-10-19:
 * "made a new folder, the first document went in, the rest went to default;
 * no way to move documents or add tags"; PNG/JPG showed "0 chunks" and
 * "No text content available").
 *
 * - every upload after the first keeps the project: single files one after
 *   another, a batch, and after the panel is closed and reopened (remembered);
 * - opening a project chip makes it the upload target (a project is a folder);
 * - "+ New project..." creates the target from the picker;
 * - the viewer moves a document (PATCH project) and adds / removes tags;
 *   rows show tags and a tag chip filters the list;
 * - select several rows and move them in one POST /bulk;
 * - an image shows its picture and an honest "not yet described" line.
 * Separate file so useConfig's module-level cache holds document_edit.
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import DocumentPanel, { cleanLabel, tagsOf, uploadProjectKey } from '../DocumentPanel'

const FEATURES = ['upload', 'chat', 'document_projects', 'document_versions', 'document_edit', 'image_preview']

type Doc = { id: string; filename: string; doc_type: string; uploaded_at: null; chunk_count: number;
  project?: string | null; tags?: string[] }

function mockFetch(initial: Doc[] = []) {
  let docs: Doc[] = initial.map(d => ({ ...d }))
  const uploads: { file: string; project: string | null }[] = []
  const batches: { files: string[]; project: string | null }[] = []
  const patches: { id: string; body: any }[] = []
  const bulks: any[] = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    const u = String(url)
    const reply = (status: number, body: unknown) => ({
      ok: status >= 200 && status < 300, status, json: async () => body,
      blob: async () => new Blob(['png-bytes'], { type: 'image/png' }),
    })
    if (u.endsWith('/api/config/embed')) {
      return reply(200, { accepted_types: ['.pdf', '.txt', '.png', '.jpg'], features: FEATURES })
    }
    if (u.endsWith('/api/documents') && method === 'GET') return reply(200, docs)
    if (u.endsWith('/api/documents/upload')) {
      const form = init?.body as FormData
      const file = (form.get('file') as File).name
      const project = form.get('project') as string | null
      uploads.push({ file, project })
      docs = [...docs, { id: `u${uploads.length}`, filename: file, doc_type: 'other', uploaded_at: null, chunk_count: 1, project }]
      return reply(200, { doc_id: `u${uploads.length}`, filename: file, chunks_created: 1 })
    }
    if (u.endsWith('/api/documents/batch') && method === 'POST') {
      const form = init?.body as FormData
      batches.push({ files: (form.getAll('files') as File[]).map(f => f.name), project: form.get('project') as string | null })
      return reply(200, { job_id: 'job-1', status: 'processing' })
    }
    if (u.endsWith('/api/documents/batch/job-1')) {
      const names = batches[batches.length - 1].files
      return reply(200, { job_id: 'job-1', status: 'completed', total_files: names.length, processed_files: names.length,
        skipped_duplicates: 0, total_chunks: names.length, files: names.map(filename => ({ filename, status: 'done', chunks: 1 })) })
    }
    if (u.endsWith('/api/documents/bulk') && method === 'POST') {
      const body = JSON.parse(String(init?.body))
      bulks.push(body)
      const updated = docs.filter(d => body.ids.includes(d.id)).map(d => ({
        id: d.id, filename: d.filename,
        project: body.project === undefined ? d.project ?? null : (body.project || null),
        tags: [...(d.tags || []), ...(body.add_tags || [])],
      }))
      return reply(200, { updated, failed: [], missing: [] })
    }
    const one = u.match(/\/api\/documents\/([^/]+)(\/[a-z]+)?$/)
    if (one) {
      const [, id, sub] = one
      const doc = docs.find(d => d.id === id)
      if (method === 'PATCH') {
        const body = JSON.parse(String(init?.body))
        patches.push({ id, body })
        return reply(200, {
          id, filename: doc?.filename,
          project: body.project === undefined ? doc?.project ?? null : (body.project || null),
          tags: body.tags ?? doc?.tags ?? [],
        })
      }
      if (sub === '/content') {
        if (doc?.filename.endsWith('.png')) {
          return reply(200, { id, filename: doc.filename, doc_type: 'other', chunk_count: 1, kind: 'image', described: false,
            text: '[Image not yet described]\nImage file: yard.png', preview_url: `/api/documents/${id}/preview` })
        }
        return reply(200, { id, filename: doc?.filename, doc_type: 'other', text: 'Meeting notes body', chunk_count: 1 })
      }
      if (sub === '/chunks') return reply(200, { chunks: [{ text: 'chunk' }] })
      if (sub === '/preview') return reply(200, {})
    }
    return reply(404, { detail: 'not mocked' })
  })
  return { uploads, batches, patches, bulks }
}

const drop = (files: File[]) =>
  fireEvent.drop(screen.getByTestId('document-dropzone'), { dataTransfer: { files } })

async function renderReady() {
  render(<DocumentPanel />)
  await screen.findByText(/PDF, TXT, PNG, JPG, up to 90 MB per file/)
}

const yard: Doc = { id: 'n1', filename: 'Meeting Notes.docx', doc_type: 'other', uploaded_at: null, chunk_count: 3, project: 'Rail Yard Animation' }
const loose: Doc = { id: 'n2', filename: 'Budget.pdf', doc_type: 'other', uploaded_at: null, chunk_count: 2, tags: ['finance'] }
const pic: Doc = { id: 'p1', filename: 'yard.png', doc_type: 'other', uploaded_at: null, chunk_count: 1 }

beforeEach(() => window.localStorage.clear())

describe('upload project sticks', () => {
  it('every later upload -- one by one, a batch, after reopening -- keeps the project', async () => {
    const { uploads, batches } = mockFetch()
    await renderReady()
    fireEvent.change(screen.getByTestId('document-project-input'), { target: { value: 'Rail Yard Animation' } })

    drop([new File(['a'], 'Notes 1.txt')])
    await waitFor(() => expect(uploads).toHaveLength(1))
    drop([new File(['b'], 'Notes 2.txt')])
    await waitFor(() => expect(uploads).toHaveLength(2))
    drop([new File(['c'], 'Ref 3.txt'), new File(['d'], 'Ref 4.txt')])
    await waitFor(() => expect(batches).toHaveLength(1))
    expect(uploads.map(u => u.project)).toEqual(['Rail Yard Animation', 'Rail Yard Animation'])
    expect(batches[0].project).toBe('Rail Yard Animation')

    // Close the window and open it again: the choice is remembered.
    cleanup()
    await renderReady()
    await screen.findByText('Notes 2.txt')
    expect((screen.getByTestId('document-project-select') as HTMLSelectElement).value).toBe('Rail Yard Animation')
    expect(screen.getByTestId('document-upload-target').textContent).toMatch(/go to Rail Yard Animation/)
    drop([new File(['e'], 'Notes 5.txt')])
    await waitFor(() => expect(uploads).toHaveLength(3))
    expect(uploads[2].project).toBe('Rail Yard Animation')
    expect(window.localStorage.getItem(uploadProjectKey(''))).toBe('Rail Yard Animation')
  })

  it('opening a project chip makes it the upload target', async () => {
    const { uploads } = mockFetch([yard, loose])
    await renderReady()
    await screen.findByText('Budget.pdf')
    expect(screen.getByTestId('document-upload-target').textContent).toMatch(/go to no project/)
    fireEvent.click(within(screen.getByTestId('document-project-filter')).getByText('Rail Yard Animation'))
    drop([new File(['x'], 'Shot list.txt')])
    await waitFor(() => expect(uploads).toHaveLength(1))
    expect(uploads[0].project).toBe('Rail Yard Animation')
  })

  it('"+ New project..." creates the target from the picker', async () => {
    const { uploads } = mockFetch([yard])
    await renderReady()
    await screen.findByText('Meeting Notes.docx')
    fireEvent.change(screen.getByTestId('document-project-select'), { target: { value: '__new__' } })
    fireEvent.change(screen.getByTestId('document-project-input'), { target: { value: '  Depot   Pilot ' } })
    drop([new File(['x'], 'Pitch.txt')])
    await waitFor(() => expect(uploads).toHaveLength(1))
    expect(uploads[0].project).toBe('Depot Pilot')
  })
})

describe('move and tag', () => {
  it('the viewer moves a document and adds / removes tags', async () => {
    const { patches } = mockFetch([yard, loose])
    await renderReady()
    fireEvent.click(await screen.findByText('Budget.pdf'))
    const editor = await screen.findByTestId('document-labels-editor')

    fireEvent.change(within(editor).getByTestId('document-move-select'), { target: { value: 'Rail Yard Animation' } })
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]).toEqual({ id: 'n2', body: { project: 'Rail Yard Animation' } })
    await waitFor(() => expect(screen.getByTestId('document-row-n2').textContent).toMatch(/Rail Yard Animation/))

    fireEvent.change(within(editor).getByTestId('document-tag-input'), { target: { value: ' storyboard ' } })
    fireEvent.click(within(editor).getByTestId('document-tag-add'))
    await waitFor(() => expect(patches).toHaveLength(2))
    expect(patches[1].body).toEqual({ tags: ['finance', 'storyboard'] })
    await waitFor(() => expect(screen.getByTestId('document-row-n2').textContent).toMatch(/#storyboard/))

    fireEvent.click(within(screen.getByTestId('document-labels-editor')).getByLabelText('Remove tag finance'))
    await waitFor(() => expect(patches).toHaveLength(3))
    expect(patches[2].body).toEqual({ tags: ['storyboard'] })
  })

  it('moves a document into a brand-new project from the viewer', async () => {
    const { patches } = mockFetch([yard, loose])
    await renderReady()
    fireEvent.click(await screen.findByText('Budget.pdf'))
    const editor = await screen.findByTestId('document-labels-editor')
    fireEvent.change(within(editor).getByTestId('document-move-select'), { target: { value: '__new__' } })
    fireEvent.change(within(editor).getByTestId('document-move-input'), { target: { value: 'Finance Q4' } })
    fireEvent.click(within(editor).getByTestId('document-move-input-create'))
    await waitFor(() => expect(patches).toEqual([{ id: 'n2', body: { project: 'Finance Q4' } }]))
  })

  it('a tag chip filters the list', async () => {
    mockFetch([yard, loose])
    await renderReady()
    await screen.findByText('Budget.pdf')
    fireEvent.click(within(screen.getByTestId('document-tag-filter')).getByText('#finance'))
    expect(screen.queryByText('Meeting Notes.docx')).toBeNull()
    expect(screen.getByText('Budget.pdf')).toBeTruthy()
  })

  it('bulk: select rows, move them and tag them in one request each', async () => {
    const { bulks } = mockFetch([yard, loose, pic])
    await renderReady()
    await screen.findByText('Budget.pdf')
    fireEvent.click(screen.getByTestId('document-select-n2'))
    fireEvent.click(screen.getByTestId('document-select-p1'))
    const bar = screen.getByTestId('document-bulk-bar')
    expect(bar.textContent).toMatch(/2 selected/)
    fireEvent.change(within(bar).getByTestId('document-bulk-tag'), { target: { value: 'yard' } })
    fireEvent.click(within(bar).getByTestId('document-bulk-tag-add'))
    await waitFor(() => expect(bulks).toHaveLength(1))
    expect(bulks[0]).toEqual({ ids: ['n2', 'p1'], add_tags: ['yard'] })

    fireEvent.click(screen.getByTestId('document-select-n2'))
    fireEvent.click(screen.getByTestId('document-select-p1'))
    fireEvent.change(within(screen.getByTestId('document-bulk-bar')).getByTestId('document-bulk-move'),
      { target: { value: 'Rail Yard Animation' } })
    await waitFor(() => expect(bulks).toHaveLength(2))
    expect(bulks[1]).toEqual({ ids: ['n2', 'p1'], project: 'Rail Yard Animation' })
    await waitFor(() => expect(screen.getByTestId('document-row-p1').textContent).toMatch(/Rail Yard Animation/))
    expect(screen.getByTestId('document-bulk-bar').textContent).not.toMatch(/selected/)
  })

  it('tagsOf and cleanLabel match what the backend stores', () => {
    expect(tagsOf([{ tags: ['b', 'A'] }, { tags: ['a', 'c'] }, {}])).toEqual(['A', 'b', 'c'])
    expect(cleanLabel('  Rail   Yard  ')).toBe('Rail Yard')
  })
})

describe('images', () => {
  const realCreate = URL.createObjectURL
  const realRevoke = URL.revokeObjectURL
  beforeEach(() => {
    ;(URL as any).createObjectURL = jest.fn(() => 'blob:preview-1')
    ;(URL as any).revokeObjectURL = jest.fn()
  })
  afterEach(() => {
    ;(URL as any).createObjectURL = realCreate
    ;(URL as any).revokeObjectURL = realRevoke
  })

  it('shows the picture and says honestly it is not yet described', async () => {
    mockFetch([pic])
    await renderReady()
    await act(async () => { fireEvent.click(await screen.findByText('yard.png')) })
    const img = await screen.findByTestId('document-image-preview')
    expect(img.getAttribute('src')).toBe('blob:preview-1')
    expect(screen.getByTestId('document-image-undescribed').textContent).toMatch(/Not yet described/)
    expect(screen.queryByText(/No text content available/)).toBeNull()
    const calls = ((global as any).fetch as jest.Mock).mock.calls.map(c => String(c[0]))
    expect(calls.some(u => u.endsWith('/api/documents/p1/preview'))).toBe(true)
  })
})
