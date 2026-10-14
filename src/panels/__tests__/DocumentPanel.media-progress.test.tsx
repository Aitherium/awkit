/**
 * A video/audio upload does not hold one /upload request open for minutes
 * (L8): it goes through the batch job, and the job row's live step
 * ("processing media (frames/transcript) 0/1", "reading scanned pages 12/40")
 * is shown while it runs.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import DocumentPanel, { isMediaUpload } from '../DocumentPanel'

const ACCEPTED = ['.pdf', '.txt', '.mp4', '.m4a']

type Call = { method: string; url: string }

function mockFetch(polls: unknown[]) {
  const calls: Call[] = []
  let poll = 0
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    const u = String(url)
    calls.push({ method, url: u })
    const reply = (status: number, body: unknown) =>
      ({ ok: status >= 200 && status < 300, status, json: async () => body })
    if (u.endsWith('/api/config/embed')) return reply(200, { accepted_types: ACCEPTED })
    if (u.endsWith('/api/documents') && method === 'GET') return reply(200, [])
    if (u.endsWith('/api/documents/batch') && method === 'POST') {
      return reply(200, { job_id: 'j1', total_files: 1, status: 'processing' })
    }
    if (u.endsWith('/api/documents/batch/j1')) {
      return reply(200, polls[Math.min(poll++, polls.length - 1)])
    }
    if (u.endsWith('/api/documents/upload')) return reply(200, { chunks_created: 1 })
    return reply(404, { detail: 'not mocked' })
  })
  return calls
}

const job = (file: Record<string, unknown>, status = 'processing') => ({
  job_id: 'j1', status, total_files: 1, processed_files: status === 'completed' ? 1 : 0,
  skipped_duplicates: 0, total_chunks: (file.chunks as number) || 0, files: [file],
})

describe('DocumentPanel media upload', () => {
  beforeEach(() => jest.useRealTimers())

  it('sends a single video through the batch job and shows its live step', async () => {
    const calls = mockFetch([
      job({ filename: 'animatic.mp4', status: 'chunking', chunks: 0,
        progress: 'processing media (frames/transcript) 0/1' }),
      job({ filename: 'animatic.mp4', status: 'done', chunks: 7 }, 'completed'),
    ])
    render(<DocumentPanel />)
    await screen.findByText(/PDF, TXT, MP4, M4A, up to 90 MB per file/)
    fireEvent.drop(screen.getByTestId('document-dropzone'),
      { dataTransfer: { files: [new File(['x'], 'animatic.mp4')] } })
    await screen.findByText('processing media (frames/transcript) 0/1')
    const results = await screen.findByTestId('upload-results', {}, { timeout: 4000 })
    await waitFor(() => expect(within(results).getByText(/7 chunks ingested/)).toBeTruthy())
    const posts = calls.filter(c => c.method === 'POST').map(c => c.url)
    expect(posts.some(u => u.endsWith('/api/documents/batch'))).toBe(true)
    expect(posts.some(u => u.endsWith('/api/documents/upload'))).toBe(false)
  })

  it('keeps a single document on the direct /upload path', async () => {
    const calls = mockFetch([])
    render(<DocumentPanel />)
    await screen.findByText(/PDF, TXT, MP4, M4A, up to 90 MB per file/)
    fireEvent.drop(screen.getByTestId('document-dropzone'),
      { dataTransfer: { files: [new File(['x'], 'notes.txt')] } })
    await screen.findByTestId('upload-results')
    const posts = calls.filter(c => c.method === 'POST').map(c => c.url)
    expect(posts).toEqual([expect.stringMatching(/\/api\/documents\/upload$/)])
  })

  it('lets the picker select video/audio when the backend advertises them', async () => {
    mockFetch([])
    render(<DocumentPanel />)
    await screen.findByText(/PDF, TXT, MP4, M4A, up to 90 MB per file/)
    expect(screen.getByTestId('document-file-input').getAttribute('accept')).toBe(ACCEPTED.join(','))
  })

  it('classifies media by extension', () => {
    for (const n of ['a.MP4', 'b.mov', 'call.m4a', 'vo.wav']) expect(isMediaUpload(n)).toBe(true)
    for (const n of ['board.pdf', 'deck.pptx', 'notes.txt', 'mp4']) expect(isMediaUpload(n)).toBe(false)
  })
})
