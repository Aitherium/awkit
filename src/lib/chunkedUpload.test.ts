/**
 * Chunked upload (2026-10-21): files past Cloudflare's 100 MB request cap
 * go up as verified pieces and resume after a drop or a reload.
 */
import { createHash } from 'crypto'

import { Sha256, resumeKey, uploadChunked } from './chunkedUpload'

const hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

describe('Sha256 (incremental)', () => {
  it('matches the FIPS vectors and node crypto across odd update boundaries', () => {
    expect(new Sha256().update(new Uint8Array()).hex())
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(new Sha256().update(new TextEncoder().encode('abc')).hex())
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    const data = new Uint8Array(1000).map((_, i) => (i * 31) & 0xff)
    for (const cut of [1, 55, 56, 63, 64, 65, 333]) {
      const h = new Sha256()
      for (let i = 0; i < data.length; i += cut) h.update(data.subarray(i, i + cut))
      expect(h.hex()).toBe(hex(data))
    }
  })
})

type Call = { method: string; url: string; headers?: Record<string, string>; body?: unknown }

function file(bytes: Uint8Array, name = 'flyover.mp4') {
  return new File([bytes], name, { lastModified: 1700000000000 })
}

function server(opts: { received?: number[]; failFirstPut?: boolean } = {}) {
  const calls: Call[] = []
  const pieces = new Map<number, Uint8Array>()
  let failed = false
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    const headers = (init?.headers || {}) as Record<string, string>
    calls.push({ method, url, headers, body: init?.body })
    const reply = (status: number, body: unknown) =>
      ({ ok: status >= 200 && status < 300, status, json: async () => body })
    if (method === 'GET' && /\/uploads\/u1$/.test(url)) {
      return reply(200, { upload_id: 'u1', chunk_bytes: 4, total_chunks: 3, received: opts.received || [] })
    }
    if (method === 'POST' && url.endsWith('/api/documents/uploads')) {
      return reply(200, { upload_id: 'u1', chunk_bytes: 4, total_chunks: 3, received: [] })
    }
    const put = url.match(/\/chunks\/(\d+)$/)
    if (method === 'PUT' && put) {
      if (opts.failFirstPut && !failed) { failed = true; throw new TypeError('Failed to fetch') }
      const body = init?.body as Uint8Array
      if (hex(body) !== headers['X-Chunk-Sha256']) return reply(422, { detail: 'mismatch' })
      pieces.set(Number(put[1]), body)
      return reply(200, {})
    }
    if (method === 'POST' && url.endsWith('/complete')) return reply(202, { job_id: 'j1' })
    return reply(404, {})
  })
  return { calls, pieces }
}

const DATA = new TextEncoder().encode('0123456789')  // 3 pieces of 4, 4, 2

describe('uploadChunked', () => {
  beforeEach(() => window.localStorage.clear())

  it('sends every piece with its sha256, retries a dropped one, then completes with the whole sha', async () => {
    const { calls, pieces } = server({ failFirstPut: true })
    const progress: number[] = []
    const out = await uploadChunked(file(DATA), {
      apiBase: '', sleep: async () => {}, onProgress: sent => progress.push(sent),
    })
    expect(out).toEqual({ ok: true, jobId: 'j1' })
    expect([...pieces.keys()].sort()).toEqual([0, 1, 2])
    const complete = calls.find(c => c.url.endsWith('/complete'))!
    expect(JSON.parse(complete.body as string)).toEqual({ sha256: hex(DATA) })
    expect(progress).toEqual([4, 8, 10])
    expect(window.localStorage.getItem(resumeKey('', file(DATA)))).toBeNull()
  })

  it('resumes a remembered upload and sends only the missing pieces', async () => {
    window.localStorage.setItem(resumeKey('', file(DATA)), 'u1')
    const { calls } = server({ received: [0, 2] })
    const out = await uploadChunked(file(DATA), { apiBase: '', sleep: async () => {} })
    expect(out.ok).toBe(true)
    const puts = calls.filter(c => c.method === 'PUT').map(c => c.url.split('/').pop())
    expect(puts).toEqual(['1'])
    expect(calls.some(c => c.method === 'POST' && c.url.endsWith('/uploads'))).toBe(false)
    const complete = calls.find(c => c.url.endsWith('/complete'))!
    expect(JSON.parse(complete.body as string).sha256).toBe(hex(DATA))  // all pieces hashed
  })

  it('pauses (resumable) when the network stays down', async () => {
    server()
    ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method || 'GET') === 'POST' && url.endsWith('/uploads')) {
        return { ok: true, status: 200, json: async () => ({ upload_id: 'u1', chunk_bytes: 4, total_chunks: 3, received: [] }) }
      }
      throw new TypeError('Failed to fetch')
    })
    const out = await uploadChunked(file(DATA), { apiBase: '', sleep: async () => {}, maxAttempts: 2 })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.detail).toMatch(/Choose the same file again to resume/)
    expect(window.localStorage.getItem(resumeKey('', file(DATA)))).toBe('u1')
  })
})
