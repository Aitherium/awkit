/**
 * Documents as a file explorer (tenant ask, 2026-11-16).
 *
 * The host advertises `document_drives`; DocumentPanel then renders the explorer. These pin
 * what a Windows-Explorer user does: open a folder, drag a file onto a folder to move it,
 * F2 to rename, Delete to the Recycle Bin and Restore, read a file's history and what the
 * system still remembers from it after a rename, save an edit as a version, and a drive's
 * restricted state. Separate file so useConfig's module-level cache holds `document_drives`.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import DocumentPanel from '../DocumentPanel'
import { breadcrumbs, driveIsOpen, entriesIn, movedFolderPath, DOC_MIME, FOLDER_MIME } from '../DocumentExplorer'
import type { ExDoc, ExFolder } from '../DocumentExplorer'

const FEATURES = ['upload', 'document_projects', 'document_edit', 'document_folders', 'document_drives', 'document_pipeline', 'shoebox', 'chunked_upload']

type Call = { method: string; url: string; body: any }

const recipes: any[] = []
const PROPOSAL = {
  name: 'Certificates to CertTrack', instruction: 'x', application: 'certtrack', kind: 'certificate',
  mapping: [{ from: 'expiration date', to: 'expires (ISO date)' }], cleaning: ['dates normalised'], audits: ['Audit 1: a person approves what was read'],
}
function shoeboxStatus(nRecipes: number) {
  return {
    stage: 'organizing',
    dumped: { documents: 3, last_dropped_at: null, types: { pdf: 3 } },
    organized: { in_folders: 2, not_in_a_folder: 1, top_level_folders: ['Inbox'], drives: [], searchable: 3, not_searchable: 0 },
    awaiting_review: { count: 1, items: [{ doc_id: 'a', filename: 'Vale NICET.pdf', next: 'audit1', next_label: 'Audit 1: check the reading' }] },
    applications: [{ app: 'CertTrack', files_read: 1, live_files: 0, records_confirmed: 0, records_unconfirmed: 1 }],
    recipes: recipes.slice(0, nRecipes), next_steps: ['1 file(s) are not in a folder yet: sort them with the agent.'],
    not_yet_read_by_a_recipe: 2,
  }
}
const pipe = { state: 'waiting' }
function pipeView(state: string) {
  const ids = ['feed', 'audit1', 'database', 'audit2', 'useful', 'audit3', 'application']
  return {
    next: state === 'approved' ? 'audit2' : 'audit1', log: [],
    read: { records: 1 },
    stages: ids.map(id => ({
      id, label: id, detail: '', status: id === 'feed' ? 'done' : id === 'audit1' ? state : 'locked',
      entries: id === 'audit1' && state !== 'waiting'
        ? [{ id: 'r1', cert_name: 'NICET Level II', number: '123', issued: '', expires: '2027-01-01', status: 'extracted', state: 'active' }] : [],
    })),
  }
}

function mock(opts: { docs: ExDoc[]; folders: ExFolder[]; drives?: any[]; trash?: any[]; editStatus?: number }) {
  let docs = opts.docs.map(d => ({ ...d }))
  let trash = [...(opts.trash || [])]
  const calls: Call[] = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    const u = String(url)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body
    calls.push({ method, url: u, body })
    const reply = (status: number, b: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => b, blob: async () => new Blob(['x']) })
    if (u.endsWith('/api/config/embed')) return reply(200, { accepted_types: ['.txt'], features: FEATURES })
    if (u.endsWith('/api/documents') && method === 'GET') return reply(200, docs)
    if (u.endsWith('/api/documents/folders') && method === 'GET') return reply(200, { folders: opts.folders, unfiled: 0 })
    if (u.endsWith('/api/documents/drives')) return reply(200, { drives: opts.drives || [], is_admin: true })
    if (u.endsWith('/api/documents/trash')) return reply(200, { items: trash, keep_days: 30 })
    if (u.endsWith('/api/documents/bulk')) {
      docs = docs.map(d => (body.ids.includes(d.id) ? { ...d, project: body.project } : d))
      return reply(200, { updated: body.ids.map((id: string) => ({ id })), failed: [], missing: [] })
    }
    if (u.endsWith('/api/shoebox/status')) return reply(200, shoeboxStatus(recipes.length))
    if (u.endsWith('/api/shoebox/recipes/propose')) return reply(200, PROPOSAL)
    if (u.endsWith('/api/shoebox/recipes') && method === 'POST') {
      recipes.push({ id: 'r1', name: 'Certificates to CertTrack', application: 'certtrack', runs: 0, last_run_at: null, auto_approve_clean: !!body.auto_approve_clean })
      return reply(200, recipes[0])
    }
    if (u.match(/\/api\/shoebox\/recipes\/r1\/run$/)) return reply(200, { read: 2, waiting_for_a_person: 2, files: 2, skipped: 0, results: [] })
    let m = u.match(/\/api\/pipeline\/docs\/([^/]+)(?:\/(read|audit\/\d))?$/)
    if (m) {
      if (m[2] === 'read') pipe.state = 'needs_review'
      if (m[2]?.startsWith('audit')) pipe.state = 'approved'
      return reply(200, pipeView(pipe.state))
    }
    m = u.match(/\/api\/documents\/([^/]+)\/rename$/)
    if (m) {
      docs = docs.map(d => (d.id === m![1] ? { ...d, filename: body.filename } : d))
      return reply(200, { id: m[1], filename: body.filename, changed: true, previous: 'old' })
    }
    m = u.match(/\/api\/documents\/([^/]+)\/trash$/)
    if (m) {
      const gone = docs.find(d => d.id === m![1])!
      docs = docs.filter(d => d.id !== m![1])
      trash = [...trash, { id: gone.id, filename: gone.filename, trashed_at: null, trashed_by: 'u', original_folder: gone.project || null }]
      return reply(200, { id: gone.id, trashed: true })
    }
    m = u.match(/\/api\/documents\/([^/]+)\/restore$/)
    if (m) {
      const back = trash.find(t => t.id === m![1])
      trash = trash.filter(t => t.id !== m![1])
      docs = [...docs, { id: back.id, filename: back.filename, doc_type: 'other', uploaded_at: null, chunk_count: 1, project: back.original_folder }]
      return reply(200, { id: back.id, filename: back.filename, project: back.original_folder, renamed_on_restore: false })
    }
    m = u.match(/\/api\/documents\/([^/]+)\/content$/)
    if (m && method === 'GET') {
      const d = docs.find(x => x.id === m![1])!
      return reply(200, { id: d.id, filename: d.filename, text: 'hello world', chunk_count: 1 })
    }
    if (m && method === 'PUT') {
      if (opts.editStatus === 409) return reply(409, { detail: { detail: 'Someone saved this document after you opened it. Reload to see it.', current_version: 3 } })
      return reply(200, { id: m[1], version: 2, changed: true, chunks: 1 })
    }
    m = u.match(/\/api\/documents\/([^/]+)\/history$/)
    if (m) {
      return reply(200, {
        doc_id: m[1], filename: 'Smith licence.txt', folder: 'HR', former_names: ['scan0042.txt'], former_folders: ['Inbox'],
        events: [
          { id: 'e2', event: 'renamed', at: '2026-11-16T10:00:00Z', old_filename: 'scan0042.txt', new_filename: 'Smith licence.txt', old_folder: null, new_folder: null, version: null, by: 'Jason' },
          { id: 'e1', event: 'moved', at: '2026-11-16T09:00:00Z', old_filename: null, new_filename: null, old_folder: 'Inbox', new_folder: 'HR', version: null, by: 'Jason' },
        ],
        versions: [{ version: 2, at: null, by: 'u', summary: 'fix' }, { version: 1, at: null, by: 'u', summary: 'Original upload' }],
      })
    }
    m = u.match(/\/api\/documents\/([^/]+)\/memory$/)
    if (m) {
      return reply(200, {
        search: { chunks: 4, chunk_filenames: ['Smith licence.txt'], chunk_folders: ['HR'], in_sync: true },
        records: { staff_rows: 0, project_rows: 0, certtrack_entries: 2, chat_turns_that_read_it: 1 },
      })
    }
    return reply(404, { detail: 'not mocked' })
  })
  return { calls, getDocs: () => docs }
}

const doc = (id: string, filename: string, project?: string): ExDoc => ({
  id, filename, doc_type: 'other', uploaded_at: '2026-11-16T08:00:00Z', chunk_count: 1, project: project ?? null,
})
const folder = (path: string, total = 1): ExFolder => ({
  path, name: path.split('/').pop()!, parent: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null,
  depth: path.split('/').length - 1, doc_count: total, total_count: total,
})
const dt = (data: Record<string, string>) => ({ dataTransfer: { getData: (k: string) => data[k] || '', setData: jest.fn(), files: [], dropEffect: '', effectAllowed: '' } })

async function ready() {
  render(<DocumentPanel />)
  await screen.findByTestId('document-explorer')
  // the first listing has landed once the root shows a row
  await waitFor(() => expect(document.querySelector('[data-testid^="ex-row-"]')).not.toBeNull())
}

describe('pure helpers', () => {
  it('breadcrumbs, folder contents and folder drops', () => {
    expect(breadcrumbs('')).toEqual([])
    expect(breadcrumbs('HR/Licences')).toEqual([{ label: 'HR', path: 'HR' }, { label: 'Licences', path: 'HR/Licences' }])
    const e = entriesIn('HR', [doc('a', 'b.txt', 'HR'), doc('c', 'A.txt', 'HR'), doc('d', 'x.txt')], [folder('HR/Sub'), folder('HR'), folder('Other')])
    expect(e.docs.map(d => d.filename)).toEqual(['A.txt', 'b.txt'])
    expect(e.folders.map(f => f.path)).toEqual(['HR/Sub'])
    expect(entriesIn('', [doc('d', 'x.txt')], [folder('HR'), folder('HR/Sub')]).folders.map(f => f.path)).toEqual(['HR'])
    expect(movedFolderPath('HR/Sub', 'Archive')).toBe('Archive/Sub')
    expect(movedFolderPath('HR/Sub', '')).toBe('Sub')
    expect(movedFolderPath('HR', 'HR/Sub')).toBeNull() // into itself
    expect(movedFolderPath('HR', 'HR')).toBeNull()
    expect(movedFolderPath('HR/Sub', 'HR')).toBeNull() // already there
    expect(driveIsOpen({ read_roles: ['admin', 'member', 'viewer'], user_ids: [] } as any)).toBe(true)
    expect(driveIsOpen({ read_roles: ['admin'], user_ids: [] } as any)).toBe(false)
  })
})

describe('explorer', () => {
  it('shows folders and files, opens a folder on double click, Backspace goes up', async () => {
    mock({ docs: [doc('a', 'Handbook.txt', 'Company'), doc('b', 'Loose.txt')], folders: [folder('Company')] })
    await ready()
    expect(screen.getByTestId('ex-row-doc-b')).toBeTruthy()
    expect(screen.queryByTestId('ex-row-doc-a')).toBeNull()
    fireEvent.doubleClick(screen.getByTestId('ex-row-folder-Company'))
    await screen.findByTestId('ex-row-doc-a')
    expect(screen.getByTestId('ex-crumb-Company')).toBeTruthy()
    fireEvent.keyDown(screen.getByTestId('ex-list'), { key: 'Backspace' })
    await screen.findByTestId('ex-row-doc-b')
  })

  it('dragging a file onto a folder moves it (POST /bulk), keeping it selected as one move', async () => {
    const { calls } = mock({ docs: [doc('a', 'Cert.txt'), doc('b', 'Other.txt')], folders: [folder('HR', 0)] })
    await ready()
    fireEvent.click(screen.getByTestId('ex-row-doc-a'))
    fireEvent.dragStart(screen.getByTestId('ex-row-doc-a'), dt({}))
    fireEvent.drop(screen.getByTestId('ex-row-folder-HR'), dt({ [DOC_MIME]: JSON.stringify(['a']) }))
    await waitFor(() => expect(calls.find(c => c.url.endsWith('/bulk'))).toBeTruthy())
    expect(calls.find(c => c.url.endsWith('/bulk'))!.body).toEqual({ ids: ['a'], project: 'HR' })
    await waitFor(() => expect(screen.queryByTestId('ex-row-doc-a')).toBeNull())
  })

  it('dropping a file on the "This workspace" crumb moves it to the top level; a folder into itself is refused', async () => {
    const { calls } = mock({ docs: [doc('a', 'Cert.txt', 'HR')], folders: [folder('HR')] })
    await ready()
    fireEvent.doubleClick(screen.getByTestId('ex-row-folder-HR'))
    await screen.findByTestId('ex-row-doc-a')
    fireEvent.drop(screen.getByTestId('ex-crumb-root'), dt({ [DOC_MIME]: JSON.stringify(['a']) }))
    await waitFor(() => expect(calls.find(c => c.url.endsWith('/bulk'))?.body).toEqual({ ids: ['a'], project: '' }))
    fireEvent.drop(screen.getByTestId('ex-crumb-HR'), dt({ [FOLDER_MIME]: 'HR' }))
    await screen.findByText(/cannot be moved into itself/)
  })

  it('F2 renames the selected file inline', async () => {
    const { calls } = mock({ docs: [doc('a', 'scan0042.txt')], folders: [] })
    await ready()
    fireEvent.click(screen.getByTestId('ex-row-doc-a'))
    fireEvent.keyDown(screen.getByTestId('ex-list'), { key: 'F2' })
    const box = await screen.findByTestId('ex-rename-input')
    expect((box as HTMLInputElement).value).toBe('scan0042.txt')
    fireEvent.change(box, { target: { value: 'Smith licence.txt' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(calls.find(c => c.url.endsWith('/a/rename'))?.body).toEqual({ filename: 'Smith licence.txt' }))
    await screen.findByText('Smith licence.txt')
  })

  it('Delete sends to the Recycle Bin, and Restore brings it back', async () => {
    const { calls } = mock({ docs: [doc('a', 'Policy.txt', 'HR')], folders: [folder('HR')] })
    await ready()
    fireEvent.doubleClick(screen.getByTestId('ex-row-folder-HR'))
    fireEvent.click(await screen.findByTestId('ex-row-doc-a'))
    fireEvent.keyDown(screen.getByTestId('ex-list'), { key: 'Delete' })
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/a/trash'))).toBe(true))
    await waitFor(() => expect(screen.queryByTestId('ex-row-doc-a')).toBeNull())
    fireEvent.click(screen.getByTestId('ex-trash'))
    const row = await screen.findByTestId('ex-trash-a')
    fireEvent.click(within(row).getByText('Restore'))
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/a/restore'))).toBe(true))
    await screen.findByText(/Restored Policy.txt/)
  })

  it('History tab shows the old name and folder; the memory tab reads the index', async () => {
    mock({ docs: [doc('a', 'Smith licence.txt', 'HR')], folders: [folder('HR')] })
    await ready()
    fireEvent.doubleClick(screen.getByTestId('ex-row-folder-HR'))
    fireEvent.doubleClick(await screen.findByTestId('ex-row-doc-a'))
    await screen.findByTestId('ex-detail')
    fireEvent.click(screen.getByTestId('ex-tab-history'))
    const former = await screen.findByTestId('ex-former')
    expect(former.textContent).toMatch(/scan0042\.txt/)
    expect(former.textContent).toMatch(/Inbox/)
    expect(screen.getAllByTestId('ex-event')[0].textContent).toMatch(/Renamed from "scan0042.txt" to "Smith licence.txt"/)
    fireEvent.click(screen.getByTestId('ex-tab-memory'))
    const mem = await screen.findByTestId('ex-memory')
    expect(mem.textContent).toMatch(/Search passages: 4/)
    expect(mem.textContent).toMatch(/CertTrack entries from this file: 2/)
  })

  it('Edit saves a version with the version it opened; a 409 is shown, not swallowed', async () => {
    const { calls } = mock({ docs: [doc('a', 'Notes.md')], folders: [], editStatus: 409 })
    await ready()
    fireEvent.doubleClick(screen.getByTestId('ex-row-doc-a'))
    fireEvent.click(await screen.findByTestId('ex-edit'))
    fireEvent.change(screen.getByTestId('ex-editor'), { target: { value: 'changed' } })
    fireEvent.click(screen.getByTestId('ex-save'))
    await screen.findByText(/Someone saved this document after you opened it/)
    const put = calls.find(c => c.method === 'PUT')!
    expect(put.body).toEqual({ text: 'changed', base_version: 2 })
  })

  it('a restricted drive says chat still reads the workspace; admins can open its access editor', async () => {
    mock({
      docs: [doc('a', 'Pay.txt', 'HR')], folders: [folder('HR')],
      drives: [{ id: 'd1', name: 'HR', description: '', read_roles: ['admin'], write_roles: ['admin'], user_ids: [], documents: 1, can_write: true, chat_scoped: false }],
    })
    await ready()
    fireEvent.doubleClick(screen.getByTestId('ex-row-folder-HR'))
    await screen.findByTestId('ex-chat-scope-note')
    fireEvent.click(screen.getByTestId('ex-access'))
    expect(await screen.findByTestId('ex-access-editor')).toBeTruthy()
  })

  it('Stages: read a file as a certificate, then approve Audit 1 (an administrator)', async () => {
    pipe.state = 'waiting'
    const { calls } = mock({ docs: [doc('a', 'Vale NICET.pdf')], folders: [] })
    await ready()
    fireEvent.doubleClick(screen.getByTestId('ex-row-doc-a'))
    fireEvent.click(await screen.findByTestId('ex-tab-pipeline'))
    const stages = await screen.findByTestId('ex-pipeline')
    expect(within(stages).getByTestId('ex-stage-feed').getAttribute('data-status')).toBe('done')
    expect(within(stages).getByTestId('ex-stage-application').getAttribute('data-status')).toBe('locked')
    fireEvent.click(screen.getByTestId('ex-read-cert'))
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/api/pipeline/docs/a/read'))).toBe(true))
    await waitFor(() => expect(screen.getByTestId('ex-stage-audit1').getAttribute('data-status')).toBe('needs_review'))
    expect(screen.getByTestId('ex-stage-audit1').textContent).toMatch(/NICET Level II/)
    fireEvent.click(screen.getByTestId('ex-approve-1'))
    await waitFor(() => expect(calls.find(c => c.url.endsWith('/audit/1'))?.body).toEqual({ decision: 'approved', note: '' }))
    await waitFor(() => expect(screen.getByTestId('ex-stage-audit1').getAttribute('data-status')).toBe('approved'))
  })

  it('Onboarding: status tiles, next steps, propose a recipe in plain words, approve it, run it', async () => {
    recipes.length = 0
    const { calls } = mock({ docs: [doc('a', 'Vale NICET.pdf')], folders: [] })
    await ready()
    fireEvent.click(screen.getByTestId('ex-onboarding'))
    const view = await screen.findByTestId('ex-onboarding-view')
    expect(within(view).getByTestId('ex-tile-dumped').textContent).toMatch(/3.*3 pdf/)
    expect(within(view).getByTestId('ex-tile-organized').textContent).toMatch(/2\/3/)
    expect(within(view).getByTestId('ex-tile-review').textContent).toMatch(/1/)
    expect(within(view).getByTestId('ex-next-steps').textContent).toMatch(/not in a folder/)
    expect(within(view).getByTestId('ex-review-list').textContent).toMatch(/Vale NICET.pdf/)
    fireEvent.change(within(view).getByTestId('ex-propose-input'), { target: { value: 'put the certificates into CertTrack' } })
    fireEvent.click(within(view).getByTestId('ex-propose-go'))
    const prop = await screen.findByTestId('ex-proposal')
    expect(prop.textContent).toMatch(/expiration date becomes expires/)
    fireEvent.click(screen.getByTestId('ex-proposal-approve'))
    await waitFor(() => expect(calls.find(c => c.url.endsWith('/api/shoebox/recipes') && c.method === 'POST')?.body)
      .toMatchObject({ auto_approve_clean: false }))
    const run = await screen.findByTestId('ex-run-r1')
    fireEvent.click(run)
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/recipes/r1/run'))).toBe(true))
    await screen.findByText(/Read 2 file\(s\); 2 wait for a person/)
  })
})
