/**
 * Resumable chunked upload for files past Cloudflare's 100 MB request cap.
 *
 * Tenant backends sit behind Cloudflare, which refuses any request body over
 * 100 MB (measured on a tenant API host 2026-10-21: 99 MB reached the app, 101 MB got
 * Cloudflare's 413). A customer's animations and project zips run to 6+ GB, so
 * a file goes up as `chunk_bytes` pieces (32 MB) against the backend's
 * POST /api/documents/uploads, PUT .../chunks/{n}, POST .../complete:
 *
 * - every piece carries its sha256 (X-Chunk-Sha256); the backend counts a
 *   piece only once it verifies, and the whole file's sha256 goes with
 *   `complete`, hashed here incrementally while the pieces are read;
 * - a dropped connection retries the piece with backoff; a reload or a closed
 *   laptop resumes: the upload id is remembered per file (name, size, mtime),
 *   GET /uploads/{id} lists the pieces already in, and only the rest are sent;
 * - the file is read one piece at a time (File.slice), never whole.
 */

const RESUME_PREFIX = 'awkit.chunkedUpload:'

/** Incremental SHA-256 (FIPS 180-4). WebCrypto has no streaming digest, and a
 *  6 GB file cannot be handed to crypto.subtle.digest in one buffer. */
export class Sha256 {
  private h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  private buf = new Uint8Array(64)
  private bufLen = 0
  private bytes = 0
  private w = new Uint32Array(64)

  private static K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ])

  private block(p: Uint8Array, off: number) {
    const w = this.w
    const K = Sha256.K
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4
      w[i] = (p[j] << 24) | (p[j + 1] << 16) | (p[j + 2] << 8) | p[j + 3]
    }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2]
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
    }
    let [a, b, c, d, e, f, g, h] = this.h
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      h = g; g = f; f = e; e = (d + t1) | 0
      d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    const H = this.h
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h
  }

  update(data: Uint8Array): this {
    this.bytes += data.length
    let i = 0
    if (this.bufLen > 0) {
      const take = Math.min(64 - this.bufLen, data.length)
      this.buf.set(data.subarray(0, take), this.bufLen)
      this.bufLen += take
      i = take
      if (this.bufLen === 64) { this.block(this.buf, 0); this.bufLen = 0 }
    }
    for (; i + 64 <= data.length; i += 64) this.block(data, i)
    if (i < data.length) { this.buf.set(data.subarray(i), 0); this.bufLen = data.length - i }
    return this
  }

  hex(): string {
    const bits = this.bytes * 8
    const pad = new Uint8Array(((this.bufLen < 56 ? 56 : 120) - this.bufLen) + 8)
    pad[0] = 0x80
    const hi = Math.floor(bits / 0x100000000), lo = bits >>> 0
    const n = pad.length
    pad[n - 8] = hi >>> 24; pad[n - 7] = hi >>> 16; pad[n - 6] = hi >>> 8; pad[n - 5] = hi
    pad[n - 4] = lo >>> 24; pad[n - 3] = lo >>> 16; pad[n - 2] = lo >>> 8; pad[n - 1] = lo
    const saved = this.bytes
    this.update(pad)
    this.bytes = saved
    return Array.from(this.h, x => (x >>> 0).toString(16).padStart(8, '0')).join('')
  }
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle
  if (subtle) {
    const digest = await subtle.digest('SHA-256', data as unknown as BufferSource)
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
  }
  return new Sha256().update(data).hex()
}

export interface ChunkedOptions {
  apiBase: string
  project?: string
  onDuplicate?: string
  onProgress?: (sentBytes: number, totalBytes: number) => void
  /** Attempts per piece before the upload gives up (it stays resumable). */
  maxAttempts?: number
  sleep?: (ms: number) => Promise<void>
}

export type ChunkedOutcome =
  | { ok: true; jobId: string }
  | { ok: false; status: number; detail: string }

export const resumeKey = (base: string, f: File) =>
  `${RESUME_PREFIX}${base || 'same-origin'}:${f.name}:${f.size}:${f.lastModified}`

function remember(key: string, id: string | null) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    if (id) window.localStorage.setItem(key, id)
    else window.localStorage.removeItem(key)
  } catch { /* private mode: resumes within this page only */ }
}

function recall(key: string): string | null {
  try {
    return (typeof window !== 'undefined' && window.localStorage?.getItem(key)) || null
  } catch { return null }
}

async function detailOf(resp: Response, fallback: string): Promise<string> {
  const body = await resp.json().catch(() => ({} as Record<string, unknown>))
  const d = (body as { detail?: unknown }).detail
  return typeof d === 'string' && d ? d : `${fallback} (${resp.status})`
}

async function readPiece(file: File, start: number, end: number): Promise<Uint8Array> {
  const blob = file.slice(start, end)
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer())
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer))
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(blob)
  })
}

/** Upload ``file`` in verified pieces, resuming a previous attempt when one exists. */
export async function uploadChunked(file: File, opts: ChunkedOptions): Promise<ChunkedOutcome> {
  const base = opts.apiBase
  const sleep = opts.sleep || ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const maxAttempts = opts.maxAttempts ?? 8
  const key = resumeKey(base, file)
  let state: { upload_id: string; chunk_bytes: number; total_chunks: number; received: number[] } | null = null

  const known = recall(key)
  if (known) {
    try {
      const r = await fetch(`${base}/api/documents/uploads/${known}`)
      if (r.ok) state = await r.json()
    } catch { /* offline: open a new upload below */ }
  }
  if (!state) {
    const r = await fetch(`${base}/api/documents/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name, size: file.size, doc_type: 'other',
        project: opts.project || '', on_duplicate: opts.onDuplicate || 'ask',
      }),
    })
    if (!r.ok) return { ok: false, status: r.status, detail: await detailOf(r, 'Upload refused') }
    state = await r.json()
    remember(key, state!.upload_id)
  }
  const { upload_id: id, chunk_bytes: step, total_chunks: total } = state!
  const have = new Set(state!.received || [])
  const whole = new Sha256()
  let sent = 0
  for (let i = 0; i < total; i++) {
    const start = i * step
    const end = Math.min(file.size, start + step)
    const piece = await readPiece(file, start, end)
    whole.update(piece)
    if (!have.has(i)) {
      const digest = await sha256Hex(piece)
      let last = ''
      let okPiece = false
      for (let attempt = 0; attempt < maxAttempts && !okPiece; attempt++) {
        if (attempt > 0) await sleep(Math.min(30000, 1000 * 2 ** (attempt - 1)))
        try {
          const r = await fetch(`${base}/api/documents/uploads/${id}/chunks/${i}`, {
            method: 'PUT', headers: { 'X-Chunk-Sha256': digest }, body: piece as unknown as BodyInit,
          })
          if (r.ok) { okPiece = true; break }
          last = await detailOf(r, 'Piece refused')
          // 4xx other than a checksum miss or a timeout will not fix itself.
          if (r.status < 500 && r.status !== 408 && r.status !== 422 && r.status !== 429) {
            return { ok: false, status: r.status, detail: last }
          }
        } catch (e) {
          last = (e as Error)?.message || 'network error'
        }
      }
      if (!okPiece) {
        return {
          ok: false, status: 0,
          detail: `Upload paused at ${Math.round((100 * start) / file.size)}% (${last}). ` +
            'Choose the same file again to resume where it stopped.',
        }
      }
    }
    sent = end
    opts.onProgress?.(sent, file.size)
  }
  const r = await fetch(`${base}/api/documents/uploads/${id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha256: whole.hex() }),
  })
  if (!r.ok) return { ok: false, status: r.status, detail: await detailOf(r, 'Upload could not finish') }
  remember(key, null)
  const data = await r.json()
  return { ok: true, jobId: data.job_id }
}
