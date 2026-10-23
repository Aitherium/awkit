/**
 * A big upload is visible the whole way (customer report 2026-10-22).
 *
 * A 6.6 GB zip took 20+ minutes to go up in 32 MB pieces, and the documents
 * list (finished documents only) showed nothing: it "seemed like it worked"
 * and then was not there. These pin:
 *
 * - an upload in flight is a row at the top of the list with % and bytes;
 * - this tab's own upload says to keep the tab open, and closing it warns;
 * - a stalled one offers Resume; processing names its step; a failure its reason.
 */
import React from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'

import DocumentPanel from '../DocumentPanel'
import {
  InFlightUploadRow, STALL_SECONDS, describeUpload, formatPair, mergeLive, type InFlightUpload,
} from '../InFlightUploads'

const GB = 1024 ** 3
const MB = 1024 ** 2

const uploading = (over: Partial<InFlightUpload> = {}): InFlightUpload => ({
  id: 'upload:b8987884', upload_id: 'b8987884', job_id: null, filename: 'Project #1.zip',
  state: 'uploading', detail: '', size: 6.6 * GB, received_bytes: 1.716 * GB,
  received_chunks: 51, total_chunks: 199, idle_seconds: 3, ...over,
})

describe('describeUpload', () => {
  it('this tab sending it: percent, both sizes in GB, keep this tab open', () => {
    const v = describeUpload(uploading(), true)
    expect(v.title).toBe('Uploading Project #1.zip')
    expect(v.line).toMatch(/^26% \(1\.7 of 6\.6 GB\) · keep this tab open/)
    expect(v.pct).toBe(26)
    expect(v.action).toBeNull()
  })

  it('idle past the stall window and not sent from here: paused, with Resume', () => {
    const v = describeUpload(uploading({ idle_seconds: STALL_SECONDS + 1 }))
    expect(v.title).toBe('Paused: Project #1.zip')
    expect(v.line).toMatch(/Stopped at 26% \(1\.7 of 6\.6 GB\)\. Choose the same file again to resume/)
    expect(v.action).toBe('resume')
  })

  it('processing names its step; failed shows the reason and can be dismissed', () => {
    const p = describeUpload({ ...uploading(), state: 'processing', detail: 'unpacking files' })
    expect(p.line).toMatch(/^Processing — unpacking files\./)
    const f = describeUpload({ ...uploading(), state: 'failed', detail: 'The zip could not be opened.' })
    expect(f).toMatchObject({ tone: 'error', action: 'dismiss', line: 'The zip could not be opened.' })
  })

  it('formats small totals in MB', () => {
    expect(formatPair(50 * MB, 200 * MB)).toBe('50 of 200 MB')
  })

  it('mergeLive puts this tab\'s fresher bytes on the server row, or adds one', () => {
    const live = { uploadId: 'b8987884', filename: 'Project #1.zip', sent: 2 * GB, total: 6.6 * GB }
    const [row] = mergeLive([uploading({ idle_seconds: 500 })], live)
    expect(row).toMatchObject({ received_bytes: 2 * GB, idle_seconds: 0, live: true })
    const [only] = mergeLive([], { ...live, uploadId: null, sent: 0 })
    expect(only).toMatchObject({ id: 'live:Project #1.zip', state: 'uploading', live: true })
  })
})

describe('InFlightUploadRow', () => {
  it('renders the line, a bar at the percent, and Resume calls back', () => {
    const onResume = jest.fn()
    render(<InFlightUploadRow upload={uploading({ idle_seconds: 600 })} onResume={onResume} />)
    const row = screen.getByTestId('inflight-upload-upload:b8987884')
    expect(row.getAttribute('data-tone')).toBe('paused')
    expect(within(row).getByTestId('inflight-upload-bar').style.width).toBe('26%')
    fireEvent.click(within(row).getByText('Resume'))
    expect(onResume).toHaveBeenCalledTimes(1)
  })
})

type Reply = { status: number; body: unknown }

function mockBackend(uploads: InFlightUpload[], onPut?: () => Promise<Reply>) {
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    const u = String(url)
    const reply = (status: number, body: unknown) =>
      ({ ok: status >= 200 && status < 300, status, json: async () => body })
    if (u.endsWith('/api/config/embed')) {
      return reply(200, { accepted_types: ['.zip', '.pdf'], features: ['chunked_upload'], max_upload_mb: 8192 })
    }
    if (u.endsWith('/api/documents') && method === 'GET') return reply(200, [])
    if (u.endsWith('/api/documents/uploads') && method === 'GET') return reply(200, { uploads })
    if (u.endsWith('/api/documents/uploads') && method === 'POST') {
      return reply(200, { upload_id: 'u1', chunk_bytes: 32 * MB, total_chunks: 200, received: [] })
    }
    if (method === 'PUT' && onPut) { const r = await onPut(); return reply(r.status, r.body) }
    return reply(404, { detail: 'not mocked' })
  })
}

describe('DocumentPanel in-flight uploads', () => {
  afterEach(() => { try { window.localStorage.clear() } catch { /* jsdom */ } })

  it('lists the server\'s uploads at the top: paused with Resume, processing with its step', async () => {
    mockBackend([
      uploading({ idle_seconds: 600 }),
      { id: 'job:j1', upload_id: 'c1', job_id: 'j1', filename: 'Site photos.zip',
        state: 'processing', detail: 'unpacking files' },
    ])
    render(<DocumentPanel />)
    const list = await screen.findByTestId('inflight-uploads')
    expect(within(list).getByText('Paused: Project #1.zip')).toBeTruthy()
    expect(within(list).getByText('Resume')).toBeTruthy()
    expect(within(list).getByText(/Processing — unpacking files/)).toBeTruthy()
    // An upload in flight is not "No documents yet".
    expect(screen.queryByText('No documents yet')).toBeNull()
  })

  it('a dropped big file says it is uploading at once, and closing the tab warns', async () => {
    mockBackend([], () => new Promise<Reply>(() => { /* the piece is still on the wire */ }))
    render(<DocumentPanel />)
    await screen.findByText(/up to 8 GB per file/)
    const zip = new File(['x'], 'Project #1.zip')
    Object.defineProperty(zip, 'size', { value: 6.6 * GB })
    fireEvent.drop(screen.getByTestId('document-dropzone'), { dataTransfer: { files: [zip] } })
    const row = await screen.findByText('Uploading Project #1.zip')
    const line = within(row.parentElement as HTMLElement).getByTestId('inflight-upload-line')
    expect(line.textContent).toMatch(/^0% \(0\.0 of 6\.6 GB\) · keep this tab open/)
    expect(screen.queryByText(/Added|ingested/)).toBeNull()

    const ev = new Event('beforeunload', { cancelable: true })
    act(() => { window.dispatchEvent(ev) })
    expect(ev.defaultPrevented).toBe(true)
  })
})
