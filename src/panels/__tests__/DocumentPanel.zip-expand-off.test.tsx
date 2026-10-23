/**
 * The feature-OFF half of DocumentPanel.zip-expand.test.tsx (useConfig caches
 * the config per module, so it needs its own file).
 *
 * A dropped .zip is unpacked in the browser and its members go up one by one
 * (2026-10-23): a customer's 3.3 GB zip was ~80 minutes with nothing indexed when sent
 * whole. Only when the backend advertises `browser_zip_expand` (its routes take
 * archive=<zip name>); otherwise the zip goes up whole exactly as before.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import DocumentPanel from '../DocumentPanel'
import { crc32Update } from '../../lib/zipExpand'

const enc = (s: string) => new TextEncoder().encode(s)

/** A STORED (no compression) zip: readable without DecompressionStream, which jsdom lacks. */
function storedZip(members: Record<string, string>): Uint8Array {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [name, text] of Object.entries(members)) {
    const n = enc(name)
    const data = enc(text)
    const crc = crc32Update(0, data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(6, 0x800, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, n.length, true)
    parts.push(new Uint8Array(local.buffer), n, data)
    const cd = new DataView(new ArrayBuffer(46))
    cd.setUint32(0, 0x02014b50, true)
    cd.setUint16(8, 0x800, true)
    cd.setUint32(16, crc, true)
    cd.setUint32(20, data.length, true)
    cd.setUint32(24, data.length, true)
    cd.setUint16(28, n.length, true)
    cd.setUint32(42, offset, true)
    central.push(new Uint8Array(cd.buffer), n)
    offset += 30 + n.length + data.length
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0)
  const eocd = new DataView(new ArrayBuffer(22))
  eocd.setUint32(0, 0x06054b50, true)
  eocd.setUint16(8, central.length / 2, true)
  eocd.setUint16(10, central.length / 2, true)
  eocd.setUint32(12, cdSize, true)
  eocd.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(eocd.buffer)]
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0))
  let at = 0
  for (const p of all) { out.set(p, at); at += p.length }
  return out
}

type Post = { url: string; names: string[]; archive: string | null }

function mockFetch(features: string[]) {
  const posts: Post[] = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    const u = String(url)
    const reply = (status: number, body: unknown) =>
      ({ ok: status >= 200 && status < 300, status, json: async () => body })
    if (u.endsWith('/api/config/embed')) {
      return reply(200, { accepted_types: ['.txt', '.md', '.zip'], features, max_upload_mb: 8192 })
    }
    if (u.endsWith('/api/documents') && method === 'GET') return reply(200, [])
    if (u.endsWith('/api/documents/uploads') && method === 'GET') return reply(200, { uploads: [] })
    if (method === 'POST' && (u.endsWith('/api/documents/upload') || u.endsWith('/api/documents/batch'))) {
      const form = init?.body as FormData
      const files = [...form.getAll('file'), ...form.getAll('files')] as File[]
      posts.push({ url: u, names: files.map(f => f.name), archive: form.get('archive') as string | null })
      if (u.endsWith('/batch')) return reply(200, { job_id: 'j1', status: 'processing' })
      return reply(200, { chunks_created: 2, filename: files[0].name })
    }
    if (u.endsWith('/api/documents/batch/j1')) {
      return reply(200, { job_id: 'j1', status: 'completed', total_files: 1, processed_files: 1,
        skipped_duplicates: 0, total_chunks: 2, files: [{ filename: 'notes.txt', status: 'done', chunks: 2 }] })
    }
    return reply(404, { detail: 'not mocked' })
  })
  return posts
}

const zipFile = () => new File([storedZip({
  'Site/notes.txt': 'Pole line relocation starts in March.',
  'Site/plan.md': '# plan',
  'Site/tool.exe': 'MZ',
  '__MACOSX/Site/._notes.txt': 'x',
}) as unknown as BlobPart], 'Site.zip')

async function renderReady() {
  render(<DocumentPanel />)
  await screen.findByText(/TXT, MD, ZIP/)
}

describe('DocumentPanel: zip expansion not advertised', () => {
  it('sends the zip whole, as before, when the backend does not advertise it', async () => {
    const posts = mockFetch(['upload', 'chunked_upload'])
    await renderReady()
    fireEvent.drop(screen.getByTestId('document-dropzone'), { dataTransfer: { files: [zipFile()] } })
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0].names).toEqual(['Site.zip'])
    expect(posts[0].archive).toBeNull()
  })

})
