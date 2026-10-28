/**
 * Folders (customer ask 2026-10-28: "File Explorer structure ... create
 * additional folders to put 'scripts', 'references' ... apply tags to full
 * folders ... nest folders ... edit folder names").
 *
 * - a document_folders backend shows a folder tree (nested, collapsible)
 *   instead of the flat project chips;
 * - clicking a folder filters the list to it and makes it the upload target;
 * - "New folder" creates inside the open folder (POST /folders);
 * - "Rename" renames the open folder (POST /folders/rename) and the list follows;
 * - "Tag folder" tags everything inside (POST /folders/tags);
 * - the bulk "Move to" offers nested folders, empty ones too.
 * Separate file so useConfig's module-level cache holds document_folders.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import DocumentPanel, { cleanFolderPath, inFolder, parentFolder } from '../DocumentPanel'

const FEATURES = ['upload', 'chat', 'document_projects', 'document_versions', 'document_edit', 'document_folders']

type Doc = { id: string; filename: string; doc_type: string; uploaded_at: null; chunk_count: number;
  project?: string | null; tags?: string[] }

function treeOf(docs: Doc[], empty: string[]) {
  const paths = new Set<string>()
  for (const p of [...docs.map(d => d.project).filter((p): p is string => !!p), ...empty]) {
    const parts = p.split('/')
    parts.forEach((_, i) => paths.add(parts.slice(0, i + 1).join('/')))
  }
  return Array.from(paths).sort().map(path => ({
    path, name: path.split('/').pop(), parent: parentFolder(path) || null, depth: path.split('/').length - 1,
    doc_count: docs.filter(d => d.project === path).length,
    total_count: docs.filter(d => inFolder(d.project, path)).length,
  }))
}

function mockFetch(initial: Doc[]) {
  let docs: Doc[] = initial.map(d => ({ ...d }))
  let empty: string[] = []
  const calls: { url: string; method: string; body: any }[] = []
  const uploads: { file: string; project: string | null }[] = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    const u = String(url)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    if (u.includes('/folders') || u.endsWith('/bulk')) calls.push({ url: u, method, body })
    const reply = (status: number, b: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => b })
    if (u.endsWith('/api/config/embed')) return reply(200, { accepted_types: ['.pdf', '.txt'], features: FEATURES })
    if (u.endsWith('/api/documents') && method === 'GET') return reply(200, docs)
    if (u.endsWith('/api/documents/folders') && method === 'GET') return reply(200, { folders: treeOf(docs, empty), unfiled: 0 })
    if (u.endsWith('/api/documents/folders') && method === 'POST') {
      empty = [...empty, body.path]
      return reply(200, { path: body.path, name: body.path.split('/').pop(), parent: parentFolder(body.path) || null })
    }
    if (u.endsWith('/api/documents/folders/rename')) {
      const move = (p: string) => body.new_path + p.slice(body.path.length)
      const updated = docs.filter(d => inFolder(d.project, body.path)).map(d => ({ id: d.id, filename: d.filename,
        project: move(d.project as string), tags: d.tags || [] }))
      docs = docs.map(d => (inFolder(d.project, body.path) ? { ...d, project: move(d.project as string) } : d))
      empty = empty.map(p => (inFolder(p, body.path) ? move(p) : p))
      return reply(200, { path: body.path, new_path: body.new_path, updated, failed: [] })
    }
    if (u.endsWith('/api/documents/folders/tags')) {
      docs = docs.map(d => (inFolder(d.project, body.path) ? { ...d, tags: [...(d.tags || []), ...body.add_tags] } : d))
      const updated = docs.filter(d => inFolder(d.project, body.path)).map(d => ({ id: d.id, filename: d.filename,
        project: d.project, tags: d.tags }))
      return reply(200, { path: body.path, updated, failed: [] })
    }
    if (u.endsWith('/api/documents/bulk')) {
      docs = docs.map(d => (body.ids.includes(d.id) ? { ...d, project: body.project } : d))
      const updated = docs.filter(d => body.ids.includes(d.id)).map(d => ({ id: d.id, filename: d.filename,
        project: d.project, tags: d.tags || [] }))
      return reply(200, { updated, failed: [], missing: [] })
    }
    if (u.endsWith('/api/documents/upload')) {
      const form = init?.body as FormData
      uploads.push({ file: (form.get('file') as File).name, project: form.get('project') as string | null })
      return reply(200, { doc_id: `u${uploads.length}`, filename: 'x', chunks_created: 1 })
    }
    return reply(404, { detail: 'not mocked' })
  })
  return { calls, uploads }
}

const script: Doc = { id: 's1', filename: 'Scene 4.txt', doc_type: 'other', uploaded_at: null, chunk_count: 1,
  project: 'Rail Yard Animation/Scripts' }
const board: Doc = { id: 'b1', filename: 'Board.pdf', doc_type: 'other', uploaded_at: null, chunk_count: 1,
  project: 'Rail Yard Animation' }
const loose: Doc = { id: 'l1', filename: 'Budget.pdf', doc_type: 'other', uploaded_at: null, chunk_count: 1 }

async function renderReady() {
  render(<DocumentPanel />)
  await screen.findByTestId('document-folder-tree')
  await screen.findByTestId('folder-row-Rail Yard Animation/Scripts')
}

beforeEach(() => window.localStorage.clear())

describe('folder tree', () => {
  it('shows nested folders instead of project chips; a click filters and sets the upload target', async () => {
    const { uploads } = mockFetch([script, board, loose])
    await renderReady()
    expect(screen.queryByTestId('document-project-filter')).toBeNull()
    expect(screen.getByTestId('folder-row-Rail Yard Animation').textContent).toMatch(/Rail Yard Animation\s*2/)

    fireEvent.click(screen.getByTestId('folder-row-Rail Yard Animation/Scripts'))
    await waitFor(() => expect(screen.queryByText('Budget.pdf')).toBeNull())
    expect(screen.queryByText('Board.pdf')).toBeNull()
    expect(screen.getByText('Scene 4.txt')).toBeTruthy()
    expect(screen.getByTestId('document-upload-target').textContent).toMatch(/go to Rail Yard Animation\/Scripts/)

    fireEvent.drop(screen.getByTestId('document-dropzone'), { dataTransfer: { files: [new File(['x'], 'Scene 5.txt')] } })
    await waitFor(() => expect(uploads).toHaveLength(1))
    expect(uploads[0].project).toBe('Rail Yard Animation/Scripts')

    // collapsing the parent hides the child
    fireEvent.click(screen.getByLabelText('Collapse Rail Yard Animation'))
    expect(screen.queryByTestId('folder-row-Rail Yard Animation/Scripts')).toBeNull()
  })

  it('New folder is created inside the open folder', async () => {
    const { calls } = mockFetch([script, board])
    await renderReady()
    fireEvent.click(screen.getByTestId('folder-row-Rail Yard Animation'))
    fireEvent.click(screen.getByTestId('folder-new'))
    fireEvent.change(screen.getByTestId('folder-input'), { target: { value: '  References ' } })
    fireEvent.click(screen.getByTestId('folder-input-ok'))
    await screen.findByTestId('folder-row-Rail Yard Animation/References')
    expect(calls.find(c => c.method === 'POST' && c.url.endsWith('/folders'))?.body)
      .toEqual({ path: 'Rail Yard Animation/References' })
    // the new (empty) folder is now open and offers Delete, not Tag
    await waitFor(() => expect(screen.getByTestId('folder-row-Rail Yard Animation/References').getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByTestId('folder-delete')).toBeTruthy()
    expect(screen.queryByTestId('folder-tag')).toBeNull()
  })

  it('Rename renames the open folder and its subfolders; the list follows', async () => {
    const { calls } = mockFetch([script, board])
    await renderReady()
    fireEvent.click(screen.getByTestId('folder-row-Rail Yard Animation'))
    fireEvent.click(screen.getByTestId('folder-rename'))
    expect((screen.getByTestId('folder-input') as HTMLInputElement).value).toBe('Rail Yard Animation')
    fireEvent.change(screen.getByTestId('folder-input'), { target: { value: 'Union Station' } })
    fireEvent.click(screen.getByTestId('folder-input-ok'))
    await screen.findByTestId('folder-row-Union Station/Scripts')
    expect(calls.find(c => c.url.endsWith('/folders/rename'))?.body)
      .toEqual({ path: 'Rail Yard Animation', new_path: 'Union Station' })
    expect(screen.queryByTestId('folder-row-Rail Yard Animation')).toBeNull()
    // the open folder followed the rename, so its document is still listed
    expect(screen.getByTestId('folder-row-Union Station').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Board.pdf')).toBeTruthy()
  })

  it('Tag folder tags every document inside, subfolders included', async () => {
    const { calls } = mockFetch([script, board, loose])
    await renderReady()
    fireEvent.click(screen.getByTestId('folder-row-Rail Yard Animation'))
    fireEvent.click(screen.getByTestId('folder-tag'))
    fireEvent.change(screen.getByTestId('folder-input'), { target: { value: 'reference' } })
    fireEvent.click(screen.getByTestId('folder-input-ok'))
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/folders/tags'))).toBe(true))
    expect(calls.find(c => c.url.endsWith('/folders/tags'))?.body)
      .toEqual({ path: 'Rail Yard Animation', add_tags: ['reference'], recursive: true })
    // the returned labels land on the open folder's row without a reload
    await waitFor(() => expect(screen.getByTestId('document-row-b1').textContent).toContain('#reference'))
  })

  it('bulk Move to offers nested and empty folders', async () => {
    const { calls } = mockFetch([script, board, loose])
    await renderReady()
    fireEvent.click(screen.getByTestId('folder-new'))
    fireEvent.change(screen.getByTestId('folder-input'), { target: { value: 'Archive/2026' } })
    fireEvent.click(screen.getByTestId('folder-input-ok'))
    await screen.findByTestId('folder-row-Archive/2026')
    fireEvent.click(screen.getByTestId('folder-row-all'))
    fireEvent.click(await screen.findByTestId('document-select-l1'))
    const move = within(screen.getByTestId('document-bulk-bar')).getByTestId('document-bulk-move') as HTMLSelectElement
    expect(Array.from(move.options).map(o => o.value)).toEqual(expect.arrayContaining(['Archive/2026', 'Rail Yard Animation/Scripts']))
    fireEvent.change(move, { target: { value: 'Archive/2026' } })
    await waitFor(() => expect(calls.find(c => c.url.endsWith('/bulk'))?.body).toEqual({ ids: ['l1'], project: 'Archive/2026' }))
  })
})

describe('folder path helpers', () => {
  it('cleanFolderPath matches the backend clean_project', () => {
    expect(cleanFolderPath('  Rail   Yard ')).toBe('Rail Yard')
    expect(cleanFolderPath(' A / / B/ ')).toBe('A/B')
    expect(parentFolder('A/B/C')).toBe('A/B')
    expect(parentFolder('A')).toBe('')
    expect(inFolder('A/B', 'A')).toBe(true)
    expect(inFolder('AB', 'A')).toBe(false)
  })
})
