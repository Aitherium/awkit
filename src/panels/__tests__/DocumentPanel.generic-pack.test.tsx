/**
 * A tenant on the shared awkit-backend gets accepted_types built from pack
 * doc_types ids (".document", ".other"), not file extensions. The panel must not
 * treat that as an allowlist: real files still upload and the picker still
 * offers the legacy types. Separate file so useConfig's module-level cache
 * starts empty.
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import DocumentPanel, { LEGACY_ACCEPTED_TYPES } from '../DocumentPanel'

type Call = { method: string; url: string }

function mockFetch(embed: unknown) {
  const calls: Call[] = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    const u = String(url)
    calls.push({ method, url: u })
    const reply = (status: number, body: unknown) =>
      ({ ok: status >= 200 && status < 300, status, json: async () => body })
    if (u.endsWith('/api/config/embed')) return reply(200, embed)
    if (u.endsWith('/api/documents') && method === 'GET') return reply(200, [])
    if (u.endsWith('/api/documents/upload')) return reply(200, { chunks_created: 4 })
    // Batch: b.pdf was dropped as a duplicate before the job was created.
    if (u.endsWith('/api/documents/batch')) return reply(200, { job_id: 'j1', status: 'processing' })
    if (u.endsWith('/api/documents/batch/j1')) {
      return reply(200, {
        job_id: 'j1', status: 'completed', total_files: 1, processed_files: 1, skipped_duplicates: 1,
        total_chunks: 2, files: [{ filename: 'a.pdf', status: 'done', chunks: 2 }],
      })
    }
    return reply(404, { detail: 'not mocked' })
  })
  return calls
}

describe('DocumentPanel on a doc_types pack', () => {
  it('keeps the legacy accept list and uploads a PDF', async () => {
    const calls = mockFetch({ accepted_types: ['.document', '.other'] })
    render(<DocumentPanel />)
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/api/config/embed'))).toBe(true))
    // Let the config promise resolve and re-render with the backend's list.
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(screen.getByText(/PDF, DOCX, TXT, XLSX, MD, CSV, images, or ZIP archives, up to 90 MB per file/)).toBeTruthy()
    expect(screen.queryByText(/DOCUMENT, OTHER/)).toBeNull()
    expect(screen.getByTestId('document-file-input').getAttribute('accept')).toBe(LEGACY_ACCEPTED_TYPES.join(','))

    fireEvent.drop(screen.getByTestId('document-dropzone'), { dataTransfer: { files: [new File(['x'], 'report.pdf')] } })
    const results = await screen.findByTestId('upload-results')
    await waitFor(() => expect(within(results).getByText(/4 chunks ingested/)).toBeTruthy())
    expect(within(results).queryByText(/not supported/)).toBeNull()
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1)
  })

  it('gives a duplicate the batch endpoint dropped its own result row', async () => {
    const calls = mockFetch({ accepted_types: ['.document', '.other'] })
    render(<DocumentPanel />)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    fireEvent.drop(screen.getByTestId('document-dropzone'), {
      dataTransfer: { files: [new File(['x'], 'a.pdf'), new File(['x'], 'b.pdf')] },
    })
    const results = await screen.findByTestId('upload-results')
    await waitFor(() => expect(within(results).getByText(/2 chunks ingested/)).toBeTruthy())
    const row = within(results).getByText('b.pdf').parentElement as HTMLElement
    expect(row.getAttribute('data-status')).toBe('skipped')
    expect(within(row).getByText(/duplicate/)).toBeTruthy()
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1)
  })
})
