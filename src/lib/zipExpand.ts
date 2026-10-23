/**
 * Open a picked .zip IN THE BROWSER and upload its members one by one.
 *
 * Measured live 2026-10-23 on a customer tenant: a 3.3 GB project zip went up as ONE resumable
 * upload at ~49 s per 32 MB piece (the customer's ~5.5 Mbit/s uplink through
 * Cloudflare) -- ~80 minutes with nothing indexed, then 281 files in a burst,
 * and every dropped connection re-sent a whole piece. Unpacked here, each member
 * goes up through the normal per-file routes and indexes as soon as it lands.
 *
 * No dependency: the zip's central directory is read with Blob.slice (random
 * access -- a 3 GB archive is never read front to back to find its members),
 * a STORED member is a zero-copy slice of the picked file, and a DEFLATED one
 * is inflated by the browser's own DecompressionStream('deflate-raw'). Zip64 is
 * read. Anything else (split archives, bzip2/lzma members, no
 * DecompressionStream) is `fallback`: the panel sends the whole zip as before
 * and the server unpacks it.
 *
 * The member rules MIRROR the backend's (`services/archive.py` expand_zip and
 * `routers/batch.py` _member_ok / accept_incoming) so a member skipped here is
 * one the server would have skipped with the same words. The server stays the
 * authority: every member is still type-checked, size-capped and duplicate-
 * checked by the route it is sent to.
 */

/** backend services/archive.py */
export const ZIP_MAX_MEMBERS = 2000
export const ZIP_MAX_RATIO = 200
const SKIP_DIRS = new Set(['__MACOSX', '.git', 'node_modules'])

export interface ZipEntry {
  /** Path inside the archive, `\` normalised to `/`. */
  inner: string
  /** The name the document is listed under (the last path segment). */
  name: string
  method: number
  flags: number
  compressedSize: number
  size: number
  crc32: number
  localOffset: number
  /** The member's DOS timestamp, as ms since the epoch (File.lastModified). */
  modified: number
  isDir: boolean
}

/** The archive cannot be read here; the caller falls back to the whole-zip upload. */
export class ZipUnreadable extends Error {}

// CP437 high half: what a zip WITHOUT the UTF-8 flag means by bytes 0x80-0xFF
// (Python's zipfile decodes the same way, so the names agree with the server).
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ '

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder('utf-8').decode(bytes)
  let s = ''
  for (const b of bytes) s += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80]
  return s
}

async function readBytes(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  const part = blob.slice(start, end)
  if (typeof part.arrayBuffer === 'function') return new Uint8Array(await part.arrayBuffer())
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer))
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(part)
  })
}

const u16 = (v: DataView, o: number) => v.getUint16(o, true)
const u32 = (v: DataView, o: number) => v.getUint32(o, true)
const u64 = (v: DataView, o: number) => v.getUint32(o, true) + v.getUint32(o + 4, true) * 0x100000000

function dosTime(time: number, date: number): number {
  const y = ((date >> 9) & 0x7f) + 1980
  const mo = Math.max(0, ((date >> 5) & 0x0f) - 1)
  const d = Math.max(1, date & 0x1f)
  const t = new Date(y, mo, d, (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2).getTime()
  return Number.isFinite(t) ? t : 0
}

/** Every entry of the zip's central directory (Zip64 included). */
export async function readZipDirectory(blob: Blob): Promise<ZipEntry[]> {
  const size = blob.size
  if (size < 22) throw new ZipUnreadable('not a zip (too short)')
  const tailStart = Math.max(0, size - (22 + 0xffff))
  const tail = await readBytes(blob, tailStart, size)
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tv, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new ZipUnreadable('no end-of-central-directory record')
  let disk = u16(tv, eocd + 4)
  let cdDisk = u16(tv, eocd + 6)
  let count = u16(tv, eocd + 10)
  let cdSize = u32(tv, eocd + 12)
  let cdOffset = u32(tv, eocd + 16)
  const zip64 = count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff
  if (zip64) {
    const loc = eocd - 20
    if (loc < 0 || u32(tv, loc) !== 0x07064b50) throw new ZipUnreadable('zip64 locator missing')
    const at = u64(tv, loc + 8)
    const rec = await readBytes(blob, at, at + 56)
    const rv = new DataView(rec.buffer, rec.byteOffset, rec.byteLength)
    if (rec.length < 56 || u32(rv, 0) !== 0x06064b50) throw new ZipUnreadable('zip64 record missing')
    disk = u32(rv, 16)
    cdDisk = u32(rv, 20)
    count = u64(rv, 32)
    cdSize = u64(rv, 40)
    cdOffset = u64(rv, 48)
  }
  if (disk !== 0 || cdDisk !== 0) throw new ZipUnreadable('split (multi-part) archive')
  if (cdOffset + cdSize > size || cdSize > 256 * 1024 * 1024) throw new ZipUnreadable('central directory out of range')
  const cd = await readBytes(blob, cdOffset, cdOffset + cdSize)
  const v = new DataView(cd.buffer, cd.byteOffset, cd.byteLength)
  const out: ZipEntry[] = []
  let p = 0
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.length || u32(v, p) !== 0x02014b50) throw new ZipUnreadable('central directory is damaged')
    const flags = u16(v, p + 8)
    const method = u16(v, p + 10)
    const modified = dosTime(u16(v, p + 12), u16(v, p + 14))
    const crc32 = u32(v, p + 16)
    let compressedSize = u32(v, p + 20)
    let usize = u32(v, p + 24)
    const nameLen = u16(v, p + 28)
    const extraLen = u16(v, p + 30)
    const commentLen = u16(v, p + 32)
    let localOffset = u32(v, p + 42)
    const raw = decodeName(cd.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0)
    // Zip64 extended information: only the fields whose 32-bit slot is saturated, in order.
    let e = p + 46 + nameLen
    const extraEnd = e + extraLen
    while (e + 4 <= extraEnd) {
      const id = u16(v, e)
      const len = u16(v, e + 2)
      if (id === 0x0001) {
        let q = e + 4
        if (usize === 0xffffffff && q + 8 <= e + 4 + len) { usize = u64(v, q); q += 8 }
        if (compressedSize === 0xffffffff && q + 8 <= e + 4 + len) { compressedSize = u64(v, q); q += 8 }
        if (localOffset === 0xffffffff && q + 8 <= e + 4 + len) { localOffset = u64(v, q); q += 8 }
      }
      e += 4 + len
    }
    const inner = raw.replace(/\\/g, '/')
    const segs = inner.split('/').filter(s => s !== '' && s !== '.')
    out.push({
      inner, name: segs[segs.length - 1] || '', method, flags, compressedSize, size: usize,
      crc32, localOffset, modified, isDir: raw.endsWith('/'),
    })
    p = extraEnd + commentLen
  }
  return out
}

/** Python's PurePosixPath(name).suffix, lowercased ("x." -> "", ".env" -> ""). */
export function pySuffix(name: string): string {
  const i = name.lastIndexOf('.')
  if (i <= 0 || i === name.length - 1) return ''
  return name.slice(i).toLowerCase()
}

/** backend archive._visible: OS metadata and hidden paths are not the customer's files. */
export function memberVisible(inner: string): boolean {
  const parts = inner.split('/').filter(s => s !== '' && s !== '.' && s !== '..')
  return parts.length > 0 && !parts.some(s => SKIP_DIRS.has(s) || s.startsWith('.'))
}

export interface ZipSkip {
  /** The row's name: the member's file name, or its path when it has none. */
  filename: string
  inner: string
  why: string
}

export type ZipPlan =
  | { kind: 'expand'; members: ZipEntry[]; skipped: ZipSkip[]; empty: boolean }
  | { kind: 'refused'; detail: string }
  | { kind: 'fallback'; reason: string }

export interface PlanOptions {
  /** The upload allow-list (lowercase ".pdf" ...), what /api/config/embed accepted_types says. */
  accepted: readonly string[]
  /** What one zip may expand to (backend chunked_max_upload_mb). */
  maxTotalBytes: number
  /** DecompressionStream('deflate-raw') is available (tests pass false/true). */
  canInflate?: boolean
}

export function canInflateInBrowser(): boolean {
  try {
    const DS = (globalThis as { DecompressionStream?: new (f: string) => unknown }).DecompressionStream
    if (!DS || typeof Response === 'undefined') return false
    new DS('deflate-raw')
    return true
  } catch { return false }
}

/**
 * Which members go up and which are named skips, in the server's own order
 * of checks and its own words (archive.expand_zip, then accept_incoming's
 * "two files named"). `fallback` = send the whole zip; `refused` = the server
 * would refuse the whole archive (more than 2000 files), say so without
 * uploading gigabytes to hear it.
 */
export function planZip(zipName: string, entries: readonly ZipEntry[], opts: PlanOptions): ZipPlan {
  const accepted = new Set(opts.accepted.map(t => t.toLowerCase()))
  const canInflate = opts.canInflate ?? canInflateInBrowser()
  const files = entries.filter(e => !e.isDir)
  if (files.length > ZIP_MAX_MEMBERS) {
    return {
      kind: 'refused',
      detail: `${zipName} holds ${files.length} files; the limit is ${ZIP_MAX_MEMBERS}. Split it into smaller zips.`,
    }
  }
  const members: ZipEntry[] = []
  const skipped: ZipSkip[] = []
  const skip = (e: ZipEntry, why: string) => skipped.push({ filename: e.name || e.inner, inner: e.inner, why })
  const seen = new Set<string>()
  let written = 0
  for (const e of files) {
    if (!memberVisible(e.inner)) continue
    const suffix = pySuffix(e.name)
    if (e.name.toLowerCase().endsWith('.zip')) { skip(e, 'a zip inside a zip: upload it on its own'); continue }
    if (!suffix || suffix === '.zip' || !accepted.has(suffix)) { skip(e, 'file type not supported'); continue }
    if (e.flags & 0x1) { skip(e, 'password-protected'); continue }
    if (e.compressedSize && e.size / Math.max(1, e.compressedSize) > ZIP_MAX_RATIO) {
      skip(e, 'compression ratio too high (zip bomb guard)'); continue
    }
    if (written + e.size > opts.maxTotalBytes) { skip(e, 'archive is over the upload size limit'); continue }
    if (e.method !== 0 && e.method !== 8) {
      return { kind: 'fallback', reason: `${e.inner} uses compression method ${e.method}` }
    }
    if (e.method === 8 && !canInflate) return { kind: 'fallback', reason: 'this browser cannot inflate zip members' }
    written += e.size
    if (seen.has(e.name)) { skip(e, `Two files named ${e.name} in ${zipName}`); continue }
    seen.add(e.name)
    members.push(e)
  }
  return { kind: 'expand', members, skipped, empty: members.length === 0 && skipped.length === 0 }
}

// ── member bytes ─────────────────────────────────────────────────────────────

let CRC_TABLE: Uint32Array | null = null
export function crc32Update(crc: number, data: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c >>> 0
    }
  }
  let c = ~crc >>> 0
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}

/**
 * The member as a File the upload routes can send. STORED = a slice of the
 * picked file (nothing is copied); DEFLATED = inflated by the browser, with a
 * running byte count that stops a member which lies about its size (the
 * server's bomb guard: declared + 1 KB) and a CRC-32 check at the end.
 */
export async function memberFile(zip: Blob, e: ZipEntry): Promise<File> {
  const head = await readBytes(zip, e.localOffset, e.localOffset + 30)
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength)
  if (head.length < 30 || u32(hv, 0) !== 0x04034b50) throw new ZipUnreadable(`${e.inner}: local header missing`)
  const start = e.localOffset + 30 + u16(hv, 26) + u16(hv, 28)
  const raw = zip.slice(start, start + e.compressedSize)
  const opts = { lastModified: e.modified || Date.now() }
  if (e.method === 0) {
    if (e.compressedSize !== e.size) throw new ZipUnreadable(`${e.inner}: stored size mismatch`)
    return new File([raw], e.name, opts)
  }
  if (e.method !== 8) throw new ZipUnreadable(`${e.inner}: compression method ${e.method}`)
  const DS = (globalThis as unknown as { DecompressionStream: new (f: string) => TransformStream<Uint8Array, Uint8Array> })
    .DecompressionStream
  let got = 0
  let crc = 0
  const guard = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      got += chunk.length
      if (got > e.size + 1024) { ctl.error(new ZipUnreadable(`${e.inner}: larger than declared`)); return }
      crc = crc32Update(crc, chunk)
      ctl.enqueue(chunk)
    },
  })
  const stream = (raw.stream() as unknown as ReadableStream<Uint8Array>).pipeThrough(new DS('deflate-raw')).pipeThrough(guard)
  const blob = await new Response(stream as unknown as BodyInit).blob()
  if (got !== e.size) throw new ZipUnreadable(`${e.inner}: ${got} bytes, the zip says ${e.size}`)
  if (crc !== e.crc32 >>> 0) throw new ZipUnreadable(`${e.inner}: checksum mismatch (damaged zip)`)
  return new File([blob], e.name, opts)
}

// ── the upload pool ──────────────────────────────────────────────────────────

class Gate {
  private waiters: (() => void)[] = []
  constructor(private free: number) {}
  async acquire(): Promise<void> {
    if (this.free > 0) { this.free--; return }
    await new Promise<void>(r => this.waiters.push(r))
  }
  release(): void {
    const next = this.waiters.shift()
    if (next) next()
    else this.free++
  }
}

export interface PoolOptions<M, R> {
  /** Members SENDING at once (the uplink is shared; 3 keeps it full without thrash). */
  concurrency?: number
  /** Members sent but not yet indexed at once (bounds server ingest load and polling). */
  maxPending?: number
  /**
   * Send one member and resolve with its final result (after it is indexed).
   * Call ``landed()`` the moment its bytes are on the server: that frees its
   * sending slot while it indexes. Never calling it frees the slot at the end.
   */
  upload: (member: M, landed: () => void) => Promise<R>
  /** A thrown upload becomes this result (a row, never a lost member). */
  onError: (member: M, err: unknown) => R
  onResult?: (member: M, result: R) => void
  /** Sending set changed (for the progress line). */
  onSending?: (sending: readonly M[]) => void
}

/** Upload ``members`` in order, ``concurrency`` sending at once; resolves with every result. */
export async function uploadPool<M, R>(members: readonly M[], opts: PoolOptions<M, R>): Promise<R[]> {
  const sendGate = new Gate(Math.max(1, opts.concurrency ?? 3))
  const pendGate = new Gate(Math.max(1, opts.maxPending ?? 6))
  const sending = new Set<M>()
  const results: R[] = new Array(members.length)
  const running: Promise<void>[] = []
  for (let i = 0; i < members.length; i++) {
    const m = members[i]
    await pendGate.acquire()
    await sendGate.acquire()
    sending.add(m)
    opts.onSending?.([...sending])
    let freed = false
    const landed = () => {
      if (freed) return
      freed = true
      sending.delete(m)
      opts.onSending?.([...sending])
      sendGate.release()
    }
    running.push((async () => {
      let r: R
      try { r = await opts.upload(m, landed) } catch (err) { r = opts.onError(m, err) }
      landed()
      pendGate.release()
      results[i] = r
      opts.onResult?.(m, r)
    })())
  }
  await Promise.all(running)
  return results
}

// ── the whole flow, for the panel ────────────────────────────────────────────

/** Sending at once: the customer's uplink is the bottleneck; 3 keeps it busy. */
export const ZIP_MEMBER_CONCURRENCY = 3
/** Sent but not yet indexed at once: bounds the server's ingest load and polling. */
export const ZIP_MEMBER_MAX_PENDING = 6

export type ZipRowStatus = 'skipped' | 'warning' | 'error'

export interface ExpandDeps<R> extends Omit<PlanOptions, 'canInflate'> {
  canInflate?: boolean
  /** Send one unpacked member through the normal per-file route; call landed() when its bytes are in. */
  upload: (file: File, landed: () => void) => Promise<R>
  /** A row that is not an upload: a named skip, an empty zip, a member that would not unpack. */
  row: (filename: string, status: ZipRowStatus, detail: string) => R
  onResult: (result: R) => void
  /** Members to send, known once the directory is read. */
  onPlan?: (members: number, skipped: number) => void
  /** Who is sending right now, and how many members have finished. */
  onSending?: (names: readonly string[], finished: number) => void
  concurrency?: number
  maxPending?: number
}

export type ExpandOutcome<R> =
  | { kind: 'fallback'; reason: string }
  | { kind: 'done'; results: R[] }

/**
 * Unpack ``zip`` here and upload its members. ``fallback`` = nothing was sent;
 * the caller uploads the whole zip as before and the server unpacks it.
 */
export async function expandZipUpload<R>(zip: File, deps: ExpandDeps<R>): Promise<ExpandOutcome<R>> {
  let entries: ZipEntry[]
  try {
    entries = await readZipDirectory(zip)
  } catch (e) {
    return { kind: 'fallback', reason: (e as Error)?.message || 'unreadable' }
  }
  const plan = planZip(zip.name, entries, deps)
  if (plan.kind === 'fallback') return plan
  const results: R[] = []
  const emit = (r: R) => { results.push(r); deps.onResult(r) }
  if (plan.kind === 'refused') {
    emit(deps.row(zip.name, 'error', plan.detail))
    return { kind: 'done', results }
  }
  deps.onPlan?.(plan.members.length, plan.skipped.length)
  for (const s of plan.skipped) emit(deps.row(s.filename, 'skipped', `Inside ${zip.name}: ${s.why}`))
  if (plan.empty) {
    emit(deps.row(zip.name, 'warning', 'The zip is empty.'))
    return { kind: 'done', results }
  }
  let finished = 0
  let names: string[] = []
  await uploadPool(plan.members, {
    concurrency: deps.concurrency ?? ZIP_MEMBER_CONCURRENCY,
    maxPending: deps.maxPending ?? ZIP_MEMBER_MAX_PENDING,
    upload: async (m, landed) => deps.upload(await memberFile(zip, m), landed),
    onError: (m, err) => deps.row(m.name, 'error',
      `Inside ${zip.name}: could not be read (${(err as Error)?.message || 'error'})`),
    onResult: (_m, r) => { finished++; emit(r); deps.onSending?.(names, finished) },
    onSending: sending => { names = sending.map(m => m.name); deps.onSending?.(names, finished) },
  })
  return { kind: 'done', results }
}
