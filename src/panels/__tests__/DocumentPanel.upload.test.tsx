/**
 * The document upload panel tells the truth (UX audit 2026-10-13, T2).
 *
 * - accept= and the hint come from /api/config/embed accepted_types;
 * - a dropped file with an unsupported extension is refused on the client and
 *   never reaches the network (drag-and-drop ignores the input's accept);
 * - a 409 shows the backend's detail next to the filename;
 * - a file over the 90 MB tunnel-safe cap is refused on the client;
 * - a zero-chunk upload is a warning, not a success.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import DocumentPanel, {
  LEGACY_ACCEPTED_TYPES, MAX_UPLOAD_BYTES, partitionUploads, resolveAcceptedTypes, splitBatches,
  uploadLimits,
} from '../DocumentPanel'

const ACCEPTED = ['.pdf', '.docx', '.txt', '.md']

type Call = { method: string; url: string }

function mockFetch(upload: (name: string) => { status: number; body: unknown }) {
  const calls: Call[] = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    const u = String(url)
    calls.push({ method, url: u })
    const reply = (status: number, body: unknown) =>
      ({ ok: status >= 200 && status < 300, status, json: async () => body })
    if (u.endsWith('/api/config/embed')) return reply(200, { accepted_types: ACCEPTED })
    if (u.endsWith('/api/documents') && method === 'GET') return reply(200, [])
    if (u.endsWith('/api/documents/upload')) {
      const file = (init?.body as FormData).get('file') as File
      const r = upload(file.name)
      return reply(r.status, r.body)
    }
    return reply(404, { detail: 'not mocked' })
  })
  return calls
}

const uploads = (calls: Call[]) => calls.filter(c => c.method === 'POST')

function bigFile(name: string, bytes: number) {
  const f = new File(['x'], name, { type: 'application/pdf' })
  Object.defineProperty(f, 'size', { value: bytes })
  return f
}

async function renderReady() {
  render(<DocumentPanel />)
  // Wait for the backend's accepted types to drive the hint.
  await screen.findByText(/PDF, DOCX, TXT, MD, up to 90 MB per file/)
}

function drop(files: File[]) {
  fireEvent.drop(screen.getByTestId('document-dropzone'), { dataTransfer: { files } })
}

describe('DocumentPanel upload truthfulness', () => {
  it('builds accept= from /api/config/embed accepted_types', async () => {
    mockFetch(() => ({ status: 200, body: {} }))
    await renderReady()
    expect(screen.getByTestId('document-file-input').getAttribute('accept')).toBe(ACCEPTED.join(','))
  })

  it('refuses a dropped .psd with "not supported" and makes no upload call', async () => {
    const calls = mockFetch(() => ({ status: 200, body: { chunks_created: 3 } }))
    await renderReady()
    drop([new File(['x'], 'a.psd')])
    const results = await screen.findByTestId('upload-results')
    expect(within(results).getByText('a.psd')).toBeTruthy()
    expect(within(results).getByText(/not supported/)).toBeTruthy()
    expect(uploads(calls)).toHaveLength(0)
  })

  it('shows the backend 409 detail next to the filename', async () => {
    const detail = 'Document report.pdf already exists. Delete the existing one first or rename this file.'
    const calls = mockFetch(() => ({ status: 409, body: { detail } }))
    await renderReady()
    drop([new File(['x'], 'report.pdf')])
    const results = await screen.findByTestId('upload-results')
    await waitFor(() => expect(within(results).getByText(detail)).toBeTruthy())
    const row = within(results).getByText('report.pdf').parentElement as HTMLElement
    expect(row.getAttribute('data-status')).toBe('error')
    expect(within(row).getByText(detail)).toBeTruthy()
    expect(uploads(calls)).toHaveLength(1)
  })

  it('refuses a 120 MB file on the client', async () => {
    const calls = mockFetch(() => ({ status: 200, body: { chunks_created: 3 } }))
    await renderReady()
    drop([bigFile('huge.pdf', 120 * 1024 * 1024)])
    const results = await screen.findByTestId('upload-results')
    expect(within(results).getByText('huge.pdf')).toBeTruthy()
    expect(within(results).getByText(/upload limit is 90 MB/)).toBeTruthy()
    expect(uploads(calls)).toHaveLength(0)
  })

  it('marks a zero-chunk upload as a warning', async () => {
    mockFetch(() => ({ status: 200, body: { chunks_created: 0 } }))
    await renderReady()
    drop([new File(['x'], 'scan.pdf')])
    const results = await screen.findByTestId('upload-results')
    await waitFor(() => expect(within(results).getByText(/0 chunks/)).toBeTruthy())
    const row = within(results).getByText('scan.pdf').parentElement as HTMLElement
    expect(row.getAttribute('data-status')).toBe('warning')
  })
})

describe('upload helpers', () => {
  it('splits batches so no request exceeds the cap', () => {
    const mb = 1024 * 1024
    const files = [bigFile('a.pdf', 50 * mb), bigFile('b.pdf', 30 * mb), bigFile('c.pdf', 20 * mb), bigFile('d.pdf', 5 * mb)]
    const groups = splitBatches(files)
    expect(groups.map(g => g.map(f => f.name))).toEqual([['a.pdf', 'b.pdf'], ['c.pdf', 'd.pdf']])
    for (const g of groups) expect(g.reduce((s, f) => s + f.size, 0)).toBeLessThanOrEqual(MAX_UPLOAD_BYTES)
  })

  it('enforces accepted_types only when every entry is a real extension', () => {
    expect(resolveAcceptedTypes(['.PDF', 'md'])).toEqual({ types: ['.pdf', '.md'], enforced: true })
    // awkit-backend packs emit doc_type ids, not extensions.
    for (const pack of [['.document', '.other'], ['.pricing', '.contract', '.pdf']]) {
      expect(resolveAcceptedTypes(pack)).toEqual({ types: LEGACY_ACCEPTED_TYPES, enforced: false })
    }
  })

  it('falls back to the legacy list before load, when empty, or on the hook default', () => {
    const legacy = { types: LEGACY_ACCEPTED_TYPES, enforced: false }
    expect(resolveAcceptedTypes(['.pdf'], false)).toEqual(legacy)
    expect(resolveAcceptedTypes([])).toEqual(legacy)
    expect(resolveAcceptedTypes(undefined)).toEqual(legacy)
    expect(resolveAcceptedTypes(['.pdf', '.docx', '.doc', '.xlsx', '.txt'])).toEqual(legacy)
    expect(LEGACY_ACCEPTED_TYPES).toEqual(expect.arrayContaining(['.md', '.csv']))
  })

  it('does not filter by type when the list is not enforced', () => {
    const { ok } = partitionUploads([new File(['x'], 'notes.md'), new File(['x'], 'deck.pptx')], [])
    expect(ok.map(f => f.name)).toEqual(['notes.md', 'deck.pptx'])
  })

  it('partitions by extension case-insensitively', () => {
    const { ok, rejected } = partitionUploads([new File(['x'], 'A.PDF'), new File(['x'], 'clip.mp4')], ['.pdf'])
    expect(ok.map(f => f.name)).toEqual(['A.PDF'])
    expect(rejected[0].detail).toMatch(/MP4 is not supported/)
  })

  // 2026-10-21, a customer tenant: the picker hid .zip/.mp4 and refused anything over 90 MB.
  it('lets zips, drone clips and their .SRT sidecars through, case-insensitively', () => {
    const { types, enforced } = resolveAcceptedTypes(['.pdf', '.zip', '.mp4', '.mov', '.srt'])
    expect(enforced).toBe(true)
    const files = ['Site.ZIP', 'DJI_0004.MP4', 'DJI_0004.SRT', 'Flyover.mov'].map(n => new File(['x'], n))
    expect(partitionUploads(files, types).ok.map(f => f.name)).toEqual(files.map(f => f.name))
    expect(LEGACY_ACCEPTED_TYPES).toEqual(expect.arrayContaining(['.zip', '.mp4', '.mov', '.srt']))
  })

  it('takes multi-GB files when the backend advertises chunked_upload', () => {
    const chunked = uploadLimits({ loaded: true, features: ['chunked_upload'], max_upload_mb: 8192 })
    expect(chunked).toEqual({ chunked: true, single: MAX_UPLOAD_BYTES, perFile: 8192 * 1024 * 1024 })
    const clip = bigFile('animation.mp4', Math.round(6.2 * 1024 ** 3))
    expect(partitionUploads([clip], ['.mp4'], chunked.perFile).ok).toHaveLength(1)
    // A backend without it keeps the single-request cap (Cloudflare's 100 MB).
    expect(uploadLimits({ loaded: true, features: [] }).perFile).toBe(MAX_UPLOAD_BYTES)
    expect(uploadLimits({ loaded: false, features: ['chunked_upload'] }).chunked).toBe(false)
  })
})
