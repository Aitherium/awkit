/**
 * @jest-environment node
 *
 * Browser-side zip expansion (2026-10-23): a picked .zip is opened here and its
 * members go up one by one, so indexing starts with the first file instead of
 * after an ~80 minute whole-archive upload. Pinned: the central-directory reader
 * (incl. Zip64 and CP437 names), the member rules mirrored from the backend's
 * archive.expand_zip, member bytes (stored slice, inflate, CRC and size guards),
 * and the upload pool's concurrency / landed / pending limits.
 */
import { deflateRawSync } from 'zlib'

import {
  ZipUnreadable,
  crc32Update,
  expandZipUpload,
  memberFile,
  memberVisible,
  planZip,
  pySuffix,
  readZipDirectory,
  uploadPool,
  type ZipEntry,
} from './zipExpand'

const enc = (s: string) => new TextEncoder().encode(s)

interface Spec {
  name: string | Uint8Array
  data: Uint8Array
  method?: 0 | 8 | 12
  flags?: number
  /** Declared uncompressed size override (a lying header). */
  declare?: number
  crc?: number
}

/** A minimal zip writer: local headers, central directory, EOCD (optionally Zip64). */
function buildZip(specs: Spec[], opts: { zip64?: boolean } = {}): Uint8Array {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const s of specs) {
    const nameBytes = typeof s.name === 'string' ? enc(s.name) : s.name
    const method = s.method ?? 8
    const body = method === 8 ? new Uint8Array(deflateRawSync(s.data)) : s.data
    const crc = s.crc ?? crc32Update(0, s.data)
    const usize = s.declare ?? s.data.length
    const flags = (s.flags ?? 0) | (typeof s.name === 'string' ? 0x800 : 0)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, flags, true)
    local.setUint16(8, method, true)
    local.setUint16(10, 0, true)
    local.setUint16(12, (2024 - 1980) << 9 | 3 << 5 | 7, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, body.length, true)
    local.setUint32(22, usize, true)
    local.setUint16(26, nameBytes.length, true)
    local.setUint16(28, 0, true)
    parts.push(new Uint8Array(local.buffer), nameBytes, body)
    const extra = opts.zip64 ? new DataView(new ArrayBuffer(28)) : null
    if (extra) {
      extra.setUint16(0, 0x0001, true)
      extra.setUint16(2, 24, true)
      extra.setUint32(4, usize, true)
      extra.setUint32(12, body.length, true)
      extra.setUint32(20, offset, true)
    }
    const cd = new DataView(new ArrayBuffer(46))
    cd.setUint32(0, 0x02014b50, true)
    cd.setUint16(4, 20, true)
    cd.setUint16(6, 20, true)
    cd.setUint16(8, flags, true)
    cd.setUint16(10, method, true)
    cd.setUint16(14, (2024 - 1980) << 9 | 3 << 5 | 7, true)
    cd.setUint32(16, crc, true)
    cd.setUint32(20, extra ? 0xffffffff : body.length, true)
    cd.setUint32(24, extra ? 0xffffffff : usize, true)
    cd.setUint16(28, nameBytes.length, true)
    cd.setUint16(30, extra ? 28 : 0, true)
    cd.setUint32(42, extra ? 0xffffffff : offset, true)
    central.push(new Uint8Array(cd.buffer), nameBytes)
    if (extra) central.push(new Uint8Array(extra.buffer))
    offset += 30 + nameBytes.length + body.length
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0)
  const cdOffset = offset
  const tail: Uint8Array[] = []
  if (opts.zip64) {
    const rec = new DataView(new ArrayBuffer(56))
    rec.setUint32(0, 0x06064b50, true)
    rec.setUint32(4, 44, true)
    rec.setUint32(32, specs.length, true)
    rec.setUint32(24, specs.length, true)
    rec.setUint32(40, cdSize, true)
    rec.setUint32(48, cdOffset, true)
    const loc = new DataView(new ArrayBuffer(20))
    loc.setUint32(0, 0x07064b50, true)
    loc.setUint32(8, cdOffset + cdSize, true)
    loc.setUint32(16, 1, true)
    tail.push(new Uint8Array(rec.buffer), new Uint8Array(loc.buffer))
  }
  const eocd = new DataView(new ArrayBuffer(22))
  eocd.setUint32(0, 0x06054b50, true)
  eocd.setUint16(8, opts.zip64 ? 0xffff : specs.length, true)
  eocd.setUint16(10, opts.zip64 ? 0xffff : specs.length, true)
  eocd.setUint32(12, opts.zip64 ? 0xffffffff : cdSize, true)
  eocd.setUint32(16, opts.zip64 ? 0xffffffff : cdOffset, true)
  tail.push(new Uint8Array(eocd.buffer))
  const all = [...parts, ...central, ...tail]
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of all) { out.set(p, at); at += p.length }
  return out
}

const blobOf = (b: Uint8Array) => new Blob([b as unknown as BlobPart])
const ACCEPTED = ['.pdf', '.docx', '.txt', '.md', '.csv', '.png', '.jpg', '.mp4', '.srt', '.zip']
const entry = (over: Partial<ZipEntry>): ZipEntry => ({
  inner: 'a.txt', name: 'a.txt', method: 8, flags: 0, compressedSize: 10, size: 20,
  crc32: 0, localOffset: 0, modified: 0, isDir: false, ...over,
})

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32Update(0, enc('123456789'))).toBe(0xcbf43926)
    const h = crc32Update(crc32Update(0, enc('1234')), enc('56789'))
    expect(h).toBe(0xcbf43926)
  })
})

describe('readZipDirectory', () => {
  it('lists members with names, sizes, dirs and DOS times', async () => {
    const zip = buildZip([
      { name: 'Rail Yard/', data: new Uint8Array(), method: 0 },
      { name: 'Rail Yard/notes.txt', data: enc('Pole line relocation starts in March.') },
      { name: 'Rail Yard\\win.txt', data: enc('backslash path'), method: 0 },
    ])
    const entries = await readZipDirectory(blobOf(zip))
    expect(entries.map(e => [e.inner, e.name, e.isDir])).toEqual([
      ['Rail Yard/', 'Rail Yard', true],
      ['Rail Yard/notes.txt', 'notes.txt', false],
      ['Rail Yard/win.txt', 'win.txt', false],
    ])
    expect(entries[1].size).toBe(37)
    expect(new Date(entries[1].modified).getFullYear()).toBe(2024)
  })

  it('reads Zip64 records and extra fields', async () => {
    const zip = buildZip([{ name: 'big.txt', data: enc('zip64 member body') }], { zip64: true })
    const [e] = await readZipDirectory(blobOf(zip))
    expect(e.name).toBe('big.txt')
    expect(e.size).toBe(17)
    const f = await memberFile(blobOf(zip), e)
    expect(await f.text()).toBe('zip64 member body')
  })

  it('decodes a name without the UTF-8 flag as CP437, like Python zipfile', async () => {
    const zip = buildZip([{ name: new Uint8Array([0x43, 0x61, 0x66, 0x82, 0x2e, 0x74, 0x78, 0x74]), data: enc('x') }])
    const [e] = await readZipDirectory(blobOf(zip))
    expect(e.name).toBe('Café.txt')
  })

  it('refuses what is not a zip, so the panel falls back to the whole-file upload', async () => {
    await expect(readZipDirectory(blobOf(enc('definitely not a zip archive at all')))).rejects.toBeInstanceOf(ZipUnreadable)
    await expect(readZipDirectory(blobOf(new Uint8Array(4)))).rejects.toBeInstanceOf(ZipUnreadable)
  })
})

describe('member rules mirror backend archive.expand_zip', () => {
  it('pySuffix and memberVisible behave like PurePosixPath and _visible', () => {
    expect(pySuffix('Scope.DOCX')).toBe('.docx')
    expect(pySuffix('x.')).toBe('')
    expect(pySuffix('.env')).toBe('')
    expect(pySuffix('a.tar.gz')).toBe('.gz')
    expect(memberVisible('Rail Yard/notes.txt')).toBe(true)
    expect(memberVisible('../../etc/notes.txt')).toBe(true) // written under a fresh name server-side
    expect(memberVisible('__MACOSX/Rail Yard/._notes.txt')).toBe(false)
    expect(memberVisible('.DS_Store')).toBe(false)
    expect(memberVisible('proj/.git/config.txt')).toBe(false)
    expect(memberVisible('web/node_modules/x.md')).toBe(false)
    expect(memberVisible('..')).toBe(false)
  })

  it('skips with the server\'s words, in the server\'s order', () => {
    const plan = planZip('Rail Yard.zip', [
      entry({ inner: 'Rail Yard/', name: 'Rail Yard', isDir: true }),
      entry({ inner: 'Rail Yard/notes.txt', name: 'notes.txt' }),
      entry({ inner: 'Rail Yard/tool.exe', name: 'tool.exe' }),
      entry({ inner: 'Rail Yard/inner.zip', name: 'inner.zip' }),
      entry({ inner: '__MACOSX/Rail Yard/._notes.txt', name: '._notes.txt' }),
      entry({ inner: '.DS_Store', name: '.DS_Store' }),
      entry({ inner: 'secret.pdf', name: 'secret.pdf', flags: 1, method: 99 }),
      entry({ inner: 'bomb.txt', name: 'bomb.txt', compressedSize: 10, size: 2001 }),
      entry({ inner: 'other/notes.txt', name: 'notes.txt' }),
      entry({ inner: 'README', name: 'README' }),
    ], { accepted: ACCEPTED, maxTotalBytes: 1e9, canInflate: true })
    expect(plan.kind).toBe('expand')
    if (plan.kind !== 'expand') return
    expect(plan.members.map(m => m.inner)).toEqual(['Rail Yard/notes.txt'])
    expect(plan.skipped.map(s => [s.filename, s.why])).toEqual([
      ['tool.exe', 'file type not supported'],
      ['inner.zip', 'a zip inside a zip: upload it on its own'],
      ['secret.pdf', 'password-protected'],
      ['bomb.txt', 'compression ratio too high (zip bomb guard)'],
      ['notes.txt', 'Two files named notes.txt in Rail Yard.zip'],
      ['README', 'file type not supported'],
    ])
  })

  it('caps what one zip may expand to, skipping (never truncating) the rest', () => {
    const plan = planZip('z.zip', [
      entry({ inner: 'a.txt', name: 'a.txt', size: 60, compressedSize: 60 }),
      entry({ inner: 'b.txt', name: 'b.txt', size: 60, compressedSize: 60 }),
      entry({ inner: 'c.txt', name: 'c.txt', size: 40, compressedSize: 40 }),
    ], { accepted: ACCEPTED, maxTotalBytes: 100, canInflate: true })
    if (plan.kind !== 'expand') throw new Error(plan.kind)
    expect(plan.members.map(m => m.name)).toEqual(['a.txt', 'c.txt'])
    expect(plan.skipped).toEqual([{ filename: 'b.txt', inner: 'b.txt', why: 'archive is over the upload size limit' }])
  })

  it('refuses more than 2000 files the way the server does, before any upload', () => {
    const many = Array.from({ length: 2001 }, (_, i) => entry({ inner: `f${i}.txt`, name: `f${i}.txt` }))
    const plan = planZip('huge.zip', many, { accepted: ACCEPTED, maxTotalBytes: 1e12, canInflate: true })
    expect(plan).toEqual({ kind: 'refused', detail: 'huge.zip holds 2001 files; the limit is 2000. Split it into smaller zips.' })
  })

  it('falls back to the whole-zip upload for what the browser cannot read', () => {
    const bz = planZip('z.zip', [entry({ method: 12 })], { accepted: ACCEPTED, maxTotalBytes: 1e9, canInflate: true })
    expect(bz.kind).toBe('fallback')
    const noInflate = planZip('z.zip', [entry({ method: 8 })], { accepted: ACCEPTED, maxTotalBytes: 1e9, canInflate: false })
    expect(noInflate.kind).toBe('fallback')
    const storedOnly = planZip('z.zip', [entry({ method: 0, size: 10 })], { accepted: ACCEPTED, maxTotalBytes: 1e9, canInflate: false })
    expect(storedOnly.kind).toBe('expand')
  })

  it('an empty zip says so', () => {
    const plan = planZip('empty.zip', [entry({ inner: 'd/', name: 'd', isDir: true })], {
      accepted: ACCEPTED, maxTotalBytes: 1e9, canInflate: true,
    })
    expect(plan).toEqual({ kind: 'expand', members: [], skipped: [], empty: true })
  })
})

describe('memberFile', () => {
  const body = enc('Union Station canopy scope of work. '.repeat(50))

  it('returns stored and deflated members byte-for-byte, named by their basename', async () => {
    const zip = blobOf(buildZip([
      { name: 'docs/Scope.txt', data: body },
      { name: 'docs/raw.txt', data: body, method: 0 },
    ]))
    const [a, b] = await readZipDirectory(zip)
    const fa = await memberFile(zip, a)
    const fb = await memberFile(zip, b)
    expect(fa.name).toBe('Scope.txt')
    expect(fb.name).toBe('raw.txt')
    expect(new Uint8Array(await fa.arrayBuffer())).toEqual(body)
    expect(new Uint8Array(await fb.arrayBuffer())).toEqual(body)
    expect(fa.lastModified).toBe(a.modified)
  })

  it('refuses a damaged member (CRC) and one larger than its header says', async () => {
    const zip = blobOf(buildZip([
      { name: 'bad-crc.txt', data: body, crc: 1234 },
      { name: 'liar.txt', data: body, declare: 100 },
    ]))
    const [crc, liar] = await readZipDirectory(zip)
    await expect(memberFile(zip, crc)).rejects.toThrow(/checksum/)
    await expect(memberFile(zip, liar)).rejects.toThrow(/larger than declared/)
  })
})

describe('expandZipUpload', () => {
  type Row = { filename: string; status: string; detail: string }
  const deps = (sent: File[]) => ({
    accepted: ACCEPTED, maxTotalBytes: 1e9, canInflate: true,
    upload: async (f: File, landed: () => void): Promise<Row> => {
      sent.push(f); landed(); return { filename: f.name, status: 'done', detail: await f.text() }
    },
    row: (filename: string, status: string, detail: string): Row => ({ filename, status, detail }),
    onResult: () => {},
  })

  it('sends each readable member as its own file and names every skip', async () => {
    const zip = new File([buildZip([
      { name: 'Rail Yard/notes.txt', data: enc('Pole line relocation starts in March.') },
      { name: 'Rail Yard/plan.md', data: enc('# plan'), method: 0 },
      { name: 'Rail Yard/tool.exe', data: enc('MZ') },
      { name: '__MACOSX/Rail Yard/._notes.txt', data: enc('\x00\x05') },
    ]) as unknown as BlobPart], 'Rail Yard.zip')
    const sent: File[] = []
    const out = await expandZipUpload(zip, deps(sent))
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(sent.map(f => f.name).sort()).toEqual(['notes.txt', 'plan.md'])
    expect(out.results).toContainEqual({ filename: 'tool.exe', status: 'skipped', detail: 'Inside Rail Yard.zip: file type not supported' })
    expect(out.results).toContainEqual({ filename: 'notes.txt', status: 'done', detail: 'Pole line relocation starts in March.' })
    expect(out.results.some(r => r.filename === '._notes.txt')).toBe(false)
  })

  it('falls back (sends nothing) when the file is not a zip it can read', async () => {
    const sent: File[] = []
    const out = await expandZipUpload(new File(['not a zip'], 'x.zip'), deps(sent))
    expect(out.kind).toBe('fallback')
    expect(sent).toEqual([])
    const bz = new File([buildZip([{ name: 'a.txt', data: enc('x'), method: 12 }]) as unknown as BlobPart], 'b.zip')
    expect((await expandZipUpload(bz, deps(sent))).kind).toBe('fallback')
    expect(sent).toEqual([])
  })

  it('a member that will not unpack is an error row, the rest still go up', async () => {
    const zip = new File([buildZip([
      { name: 'bad.txt', data: enc('damaged body here'), crc: 7 },
      { name: 'good.txt', data: enc('fine') },
    ]) as unknown as BlobPart], 'mixed.zip')
    const sent: File[] = []
    const out = await expandZipUpload(zip, deps(sent))
    if (out.kind !== 'done') throw new Error(out.kind)
    expect(sent.map(f => f.name)).toEqual(['good.txt'])
    const bad = out.results.find(r => r.filename === 'bad.txt')!
    expect(bad.status).toBe('error')
    expect(bad.detail).toMatch(/^Inside mixed.zip: could not be read \(.*checksum/)
  })
})

describe('uploadPool', () => {
  const tick = () => new Promise<void>(r => setTimeout(r, 0))

  it('keeps at most `concurrency` sending and frees a slot when a member lands', async () => {
    let sending = 0
    let peak = 0
    const landers: (() => void)[] = []
    const finishers: (() => void)[] = []
    const done = uploadPool([1, 2, 3, 4, 5], {
      concurrency: 3, maxPending: 10,
      upload: (m, landed) => new Promise<number>(resolve => {
        sending++
        peak = Math.max(peak, sending)
        landers.push(() => { sending--; landed() })
        finishers.push(() => resolve(m * 10))
      }),
      onError: () => -1,
    })
    await tick()
    expect(landers.length).toBe(3) // 3 started, 2 waiting for a slot
    landers[0]() // its bytes landed: it indexes, member 4 starts sending
    await tick()
    expect(landers.length).toBe(4)
    landers[1](); landers[2](); landers[3]()
    await tick()
    expect(landers.length).toBe(5)
    landers[4]()
    finishers.forEach(f => f())
    expect(await done).toEqual([10, 20, 30, 40, 50])
    expect(peak).toBe(3)
  })

  it('bounds members landed but not yet indexed (maxPending)', async () => {
    const finishers: (() => void)[] = []
    const done = uploadPool([1, 2, 3, 4], {
      concurrency: 3, maxPending: 2,
      upload: (m, landed) => { landed(); return new Promise<number>(r => finishers.push(() => r(m))) },
      onError: () => -1,
    })
    await tick()
    expect(finishers.length).toBe(2)
    finishers[0]()
    await tick()
    expect(finishers.length).toBe(3)
    finishers[1](); finishers[2]()
    await tick()
    finishers[3]()
    expect(await done).toEqual([1, 2, 3, 4])
  })

  it('a throwing member becomes a result row and frees its slot', async () => {
    const seen: string[] = []
    const out = await uploadPool(['ok', 'boom', 'ok2'], {
      concurrency: 1,
      upload: async m => { if (m === 'boom') throw new Error('network'); return m },
      onError: (m, e) => `${m}:${(e as Error).message}`,
      onResult: (_m, r) => seen.push(r),
    })
    expect(out).toEqual(['ok', 'boom:network', 'ok2'])
    expect(seen).toEqual(['ok', 'boom:network', 'ok2'])
  })
})
