/**
 * Animation docs in the panel (UX audit 2026-10-13, L7).
 *
 * - a same-name upload (409) offers Replace and Keep both; each resends the
 *   file with on_duplicate and swaps the row for the result;
 * - the project typed above the list is sent with the upload;
 * - project chips filter the document list;
 * - (without the advertised features: DocumentPanel.no-document-features.test.tsx);
 * - a same-name row in a batch (several files, or a video) offers the same
 *   choice, and the batch carries the project;
 * - a PDF or video goes up with background=true (202 + job).
 */
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import DocumentPanel, { documentFeatures, projectsOf } from '../DocumentPanel'

type Sent = { file: string; onDuplicate: string | null; project: string | null; background: string | null }
type Batch = { files: string[]; project: string | null }

const HOST_FEATURES = ['upload', 'chat', 'document_projects', 'document_versions']

function mockFetch(docs: unknown[] = [], features: string[] = HOST_FEATURES) {
  const sent: Sent[] = []
  const batches: Batch[] = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    const u = String(url)
    const reply = (status: number, body: unknown) =>
      ({ ok: status >= 200 && status < 300, status, json: async () => body })
    if (u.endsWith('/api/config/embed')) {
      return reply(200, { accepted_types: ['.pdf', '.txt', '.mp4'], features })
    }
    if (u.endsWith('/api/documents') && method === 'GET') return reply(200, docs)
    if (u.endsWith('/api/documents/upload')) {
      const form = init?.body as FormData
      const file = (form.get('file') as File).name
      const onDuplicate = form.get('on_duplicate') as string | null
      sent.push({ file, onDuplicate, project: form.get('project') as string | null,
        background: form.get('background') as string | null })
      if (!onDuplicate) return reply(409, { detail: `Document '${file}' already exists. Replace it with this version, or keep both.` })
      if (form.get('background')) return reply(202, { job_id: `job-${file}`, status: 'processing' })
      const filename = onDuplicate === 'keep_both' ? 'Script (v2).pdf' : file
      return reply(200, { doc_id: 'new', filename, chunks_created: 4 })
    }
    if (u.endsWith('/api/documents/batch') && method === 'POST') {
      const form = init?.body as FormData
      const files = (form.getAll('files') as File[]).map(f => f.name)
      batches.push({ files, project: form.get('project') as string | null })
      return reply(200, { job_id: 'job-batch', status: 'processing' })
    }
    const job = u.match(/\/api\/documents\/batch\/(job-.+)$/)
    if (job) {
      if (job[1] === 'job-batch') {
        const names = batches[batches.length - 1].files
        return reply(200, { job_id: job[1], status: 'completed', total_files: names.length,
          processed_files: names.length, skipped_duplicates: 1, total_chunks: 2,
          files: names.map((filename, i) => i === 0
            ? { filename, status: 'duplicate', chunks: 0, error: 'Already uploaded. Replace it with this version, or keep both.' }
            : { filename, status: 'done', chunks: 2 }) })
      }
      const filename = job[1].slice(4)
      return reply(200, { job_id: job[1], status: 'completed', total_files: 1, processed_files: 1,
        skipped_duplicates: 0, total_chunks: 3,
        files: [{ filename, status: 'done', chunks: 3, replaced_doc_id: 'old' }] })
    }
    return reply(404, { detail: 'not mocked' })
  })
  return { sent, batches }
}

// The upload project is remembered in localStorage; each test starts clean.
beforeEach(() => window.localStorage.clear())

async function renderReady() {
  render(<DocumentPanel />)
  await screen.findByText(/PDF, TXT, MP4, up to 90 MB per file/)
}

function drop(files: File[]) {
  fireEvent.drop(screen.getByTestId('document-dropzone'), { dataTransfer: { files } })
}

async function duplicateRow() {
  drop([new File(['v2'], 'Script.txt')])
  const results = await screen.findByTestId('upload-results')
  await screen.findByText('Replace')
  return results
}

describe('DocumentPanel same-name upload', () => {
  it('offers Replace and Keep both on a 409', async () => {
    mockFetch()
    await renderReady()
    const results = await duplicateRow()
    expect(within(results).getByText('Replace')).toBeTruthy()
    expect(within(results).getByText('Keep both')).toBeTruthy()
  })

  it('Replace resends with on_duplicate=replace and shows the result', async () => {
    const { sent } = mockFetch()
    await renderReady()
    const results = await duplicateRow()
    fireEvent.click(within(results).getByText('Replace'))
    await waitFor(() => expect(within(results).getByText(/Replaced; 4 chunks ingested/)).toBeTruthy())
    expect(sent.map(s => s.onDuplicate)).toEqual([null, 'replace'])
    expect(within(results).queryByText('Keep both')).toBeNull()
  })

  it('Keep both resends with on_duplicate=keep_both and names the new copy', async () => {
    const { sent } = mockFetch()
    await renderReady()
    const results = await duplicateRow()
    fireEvent.click(within(results).getByText('Keep both'))
    await waitFor(() => expect(within(results).getByText(/as Script \(v2\)\.pdf/)).toBeTruthy())
    expect(sent.map(s => s.onDuplicate)).toEqual([null, 'keep_both'])
  })

  it('a same-name row in a batch offers Replace, resent as a background upload', async () => {
    const { sent, batches } = mockFetch()
    await renderReady()
    drop([new File(['a'], 'Ep1.mp4'), new File(['b'], 'Ep2.txt')])
    const results = await screen.findByTestId('upload-results')
    await within(results).findByText('Replace')
    expect(batches[0].files).toEqual(['Ep1.mp4', 'Ep2.txt'])
    fireEvent.click(within(results).getByText('Replace'))
    await waitFor(() => expect(within(results).getByText(/Replaced; 3 chunks ingested/)).toBeTruthy())
    expect(sent).toEqual([{ file: 'Ep1.mp4', onDuplicate: 'replace', project: null, background: 'true' }])
  })

  it('asks for background ingest for a PDF, not for a small text file', async () => {
    const { sent } = mockFetch()
    await renderReady()
    drop([new File(['x'], 'Scan.pdf')])
    await screen.findByText('Replace')
    drop([new File(['x'], 'Note.txt')])
    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent.map(s => s.background)).toEqual(['true', null])
  })
})

describe('DocumentPanel projects', () => {
  const docs = [
    { id: '1', filename: 'Ep3 script.pdf', doc_type: 'script', uploaded_at: null, chunk_count: 3, project: 'Acme S1' },
    { id: '2', filename: 'Pitch.pdf', doc_type: 'other', uploaded_at: null, chunk_count: 2, project: 'Pilot' },
    { id: '3', filename: 'Invoice.pdf', doc_type: 'other', uploaded_at: null, chunk_count: 1 },
  ]

  it('sends the typed project with the upload', async () => {
    const { sent } = mockFetch()
    await renderReady()
    fireEvent.change(screen.getByTestId('document-project-input'), { target: { value: ' Acme S1 ' } })
    drop([new File(['x'], 'Script.pdf')])
    await screen.findByText('Replace')
    expect(sent[0].project).toBe('Acme S1')
  })

  it('sends the project with a batch', async () => {
    const { batches } = mockFetch()
    await renderReady()
    fireEvent.change(screen.getByTestId('document-project-input'), { target: { value: 'Acme S1' } })
    drop([new File(['a'], 'Ep1.txt'), new File(['b'], 'Ep2.txt')])
    await screen.findByText('Replace')
    expect(batches[0].project).toBe('Acme S1')
  })

  it('keeps the project on a lone video and on a mixed media drop', async () => {
    const { sent, batches } = mockFetch()
    await renderReady()
    fireEvent.change(screen.getByTestId('document-project-input'), { target: { value: 'Pilot' } })
    drop([new File(['v'], 'Animatic.mp4')])
    await waitFor(() => expect(batches).toHaveLength(1))
    drop([new File(['v'], 'Cut2.mp4'), new File(['t'], 'Notes.txt')])
    await waitFor(() => expect(batches).toHaveLength(2))
    expect(sent).toEqual([])
    expect(batches.map(b => [b.files, b.project])).toEqual([
      [['Animatic.mp4'], 'Pilot'],
      [['Cut2.mp4', 'Notes.txt'], 'Pilot'],
    ])
  })

  it('documentFeatures reads the advertised flags only once config loaded', () => {
    expect(documentFeatures(HOST_FEATURES)).toEqual({ projects: true, versions: true, edit: false })
    expect(documentFeatures([...HOST_FEATURES, 'document_edit'])).toEqual({ projects: true, versions: true, edit: true })
    expect(documentFeatures(HOST_FEATURES, false)).toEqual({ projects: false, versions: false, edit: false })
    expect(documentFeatures(undefined)).toEqual({ projects: false, versions: false, edit: false })
  })

  it('filters the list by project chip', async () => {
    mockFetch(docs)
    await renderReady()
    await screen.findByText('Invoice.pdf')
    const chips = screen.getByTestId('document-project-filter')
    fireEvent.click(within(chips).getByText('Acme S1'))
    expect(screen.getByText('Ep3 script.pdf')).toBeTruthy()
    expect(screen.queryByText('Pitch.pdf')).toBeNull()
    expect(screen.queryByText('Invoice.pdf')).toBeNull()
    fireEvent.click(within(chips).getByText('All projects'))
    expect(screen.getByText('Invoice.pdf')).toBeTruthy()
  })

  it('projectsOf lists distinct tags, sorted, skipping untagged docs', () => {
    expect(projectsOf(docs)).toEqual(['Acme S1', 'Pilot'])
  })
})
