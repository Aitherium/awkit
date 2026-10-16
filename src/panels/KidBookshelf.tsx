/**
 * KidBookshelf: the child's Bookshelf in Aither Learn (kids' suite S7).
 *
 * Backed by Hearth /api/v1/tutor/me/shelf/* through the host app's tutor proxy (apiBase).
 * The shelf shows ONLY books a grown-up placed (the server decides; this panel never asks
 * for anything else). Opening a book is a full-screen read-aloud: the Sprite's voice reads
 * each page while the words light up one by one, a tap on any word says just that word,
 * and big arrows turn the page. Reaching the end shows "The End" and tells the server the
 * book was read (it refuses a "finish" before the last page, so a finished book is one the
 * child actually paged through).
 *
 * Child-first rules this component keeps:
 * - One thing per screen, 64px+ tap targets, almost nothing to read except the book itself.
 * - No links, no store, no timers, no counts of days, nothing that says "hurry".
 * - Highlight follows the real voice when there is audio (scaled to its duration); when the
 *   voice is off or down, it follows a gentle reading-pace estimate so the child can read
 *   along silently. Speech is a nicety: every failure is silence, never an error on screen.
 * - Only named, expected fields of a server reply are ever rendered.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { C, EASE, FONT_UI, LEARN_CSS } from './learnTheme'
import { createLearnVoice, type LearnSpeak, type SpeakingSource } from './learnVoice'

export interface KidBookshelfProps {
  /** Base of the tutor proxy, e.g. '/api/tutor'. */
  apiBase: string
  /** Headers the host app adds (its bearer). Never user identity fields. */
  extraHeaders?: Record<string, string>
  /** Back to the classroom. Omitted: no back button (the host owns navigation). */
  onClose?: () => void
  /** Called once when the child finishes a book (the host may cheer or update a glow). */
  onFinished?: (bookId: string) => void
  /** Test seam / host override: build the voice. Default: the Learn voice for apiBase. */
  makeVoice?: (onSpeaking: (src: SpeakingSource) => void) => LearnSpeak
}

export interface ShelfBook { id: string; kind: string; title: string; art: string; pages: number; page: number; finished: boolean }
export interface BookWord { w: string; say: string; start: number; end: number; t: number }
export interface BookPage { text: string; words: BookWord[] }
export interface OpenBook { id: string; kind: string; title: string; art: string; page: number; pages: BookPage[]; image?: string }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** Only the expected fields of one shelf entry. Exported for tests. */
export function asShelfBook(raw: unknown): ShelfBook | null {
  const o = obj(raw)
  const id = str(o.id)
  if (!id) return null
  return { id, kind: str(o.kind, 'book'), title: str(o.title, 'A book'), art: str(o.art, 'book'),
    pages: num(o.pages), page: num(o.page), finished: o.finished === true }
}

/** Only the expected fields of an opened book; a data: image only (never a remote URL). */
export function asOpenBook(raw: unknown): OpenBook | null {
  const o = obj(raw)
  const id = str(o.id)
  const pages = (Array.isArray(o.pages) ? o.pages : []).map((p) => {
    const q = obj(p)
    const words = (Array.isArray(q.words) ? q.words : []).map((w) => {
      const x = obj(w)
      return { w: str(x.w), say: str(x.say), start: num(x.start), end: num(x.end), t: num(x.t) }
    }).filter((w) => w.w)
    return { text: str(q.text), words }
  }).filter((p) => p.text)
  if (!id || !pages.length) return null
  const image = str(o.image)
  return { id, kind: str(o.kind, 'book'), title: str(o.title, 'A book'), art: str(o.art, 'book'),
    page: Math.min(num(o.page), pages.length - 1), pages,
    ...(image.startsWith('data:image/') ? { image } : {}) }
}

/** Index of the word being read at `ms` into the page (-1 before the first). Exported for tests. */
export function wordAt(words: readonly BookWord[], ms: number): number {
  let idx = -1
  for (let i = 0; i < words.length; i += 1) {
    if (words[i].t <= ms) idx = i
    else break
  }
  return idx
}

/** The estimated length of a page read aloud (last word start + one word). */
export function pageMs(words: readonly BookWord[]): number {
  if (!words.length) return 0
  const last = words[words.length - 1].t
  const per = words.length > 1 ? last / (words.length - 1) : 550
  return last + Math.max(400, per)
}

// --------------------------------------------------------------------------- covers

const COVERS: Record<string, [string, string]> = {
  pup: ['#F7B267', '#F4845F'], bus: ['#F25F5C', '#FFE066'], sun: ['#FFD166', '#EF8354'],
  rocket: ['#3D5A80', '#98C1D9'], dino: ['#7FB069', '#E6AA68'], paint: ['#C77DFF', '#FF8FAB'],
  fish: ['#48CAE4', '#0077B6'], drum: ['#FF7B54', '#FFB26B'], ball: ['#06D6A0', '#118AB2'],
  mitten: ['#E63946', '#A8DADC'], space: ['#22223B', '#9A8C98'], animals: ['#F7B267', '#7FB069'],
  ocean: ['#48CAE4', '#0077B6'], dinosaurs: ['#7FB069', '#E6AA68'], art: ['#C77DFF', '#FF8FAB'],
  music: ['#FF7B54', '#FFB26B'], sports: ['#06D6A0', '#118AB2'], nature: ['#95D5B2', '#FFD166'],
  things_that_go: ['#F25F5C', '#FFE066'], friendship: ['#FF8FAB', '#FFD166'], book: ['#5EC9CC', '#1E9EA2'],
}

/** A simple, friendly picture for a cover key: shapes only, no text, no images. */
export function CoverArt({ art, size = 120 }: { art: string; size?: number }) {
  const ink = '#1d1d2b'
  const shapes: Record<string, ReactNode> = {
    pup: <g><ellipse cx="50" cy="58" rx="24" ry="20" fill="#fff6e8" /><ellipse cx="30" cy="44" rx="8" ry="14" fill="#8b5e3c" /><ellipse cx="70" cy="44" rx="8" ry="14" fill="#8b5e3c" /><circle cx="42" cy="54" r="3.5" fill={ink} /><circle cx="58" cy="54" r="3.5" fill={ink} /><ellipse cx="50" cy="64" rx="5" ry="3.5" fill={ink} /></g>,
    bus: <g><rect x="18" y="34" width="64" height="36" rx="8" fill="#e63946" /><rect x="24" y="40" width="14" height="12" rx="2" fill="#dff6ff" /><rect x="43" y="40" width="14" height="12" rx="2" fill="#dff6ff" /><rect x="62" y="40" width="14" height="12" rx="2" fill="#dff6ff" /><circle cx="32" cy="72" r="7" fill={ink} /><circle cx="68" cy="72" r="7" fill={ink} /></g>,
    sun: <g>{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <rect key={a} x="48" y="14" width="4" height="14" rx="2" fill="#fff3b0" transform={`rotate(${a} 50 50)`} />)}<circle cx="50" cy="50" r="18" fill="#fff3b0" /><circle cx="44" cy="48" r="2.5" fill={ink} /><circle cx="56" cy="48" r="2.5" fill={ink} /><path d="M43 55 Q50 61 57 55" stroke={ink} strokeWidth="2.5" fill="none" strokeLinecap="round" /></g>,
    rocket: <g><circle cx="20" cy="22" r="1.6" fill="#fff" /><circle cx="78" cy="30" r="1.6" fill="#fff" /><circle cx="70" cy="76" r="1.4" fill="#fff" /><path d="M50 14 C64 28 64 52 58 66 H42 C36 52 36 28 50 14 Z" fill="#f1faee" /><circle cx="50" cy="38" r="7" fill="#98c1d9" stroke={ink} strokeWidth="2" /><path d="M42 66 L34 76 L42 72 Z M58 66 L66 76 L58 72 Z" fill="#e63946" /><path d="M45 68 Q50 86 55 68 Z" fill="#ffb703" /></g>,
    dino: <g><ellipse cx="50" cy="60" rx="26" ry="16" fill="#52b788" /><path d="M66 54 Q80 34 74 22 Q86 28 80 46 Z" fill="#52b788" /><circle cx="76" cy="30" r="2.5" fill={ink} /><path d="M30 50 l4-8 4 8 4-8 4 8 4-8 4 8" stroke="#2d6a4f" strokeWidth="3" fill="none" strokeLinejoin="round" /><rect x="34" y="70" width="7" height="10" rx="3" fill="#40916c" /><rect x="58" y="70" width="7" height="10" rx="3" fill="#40916c" /></g>,
    paint: <g><path d="M22 70 Q20 30 50 26 Q82 24 80 50 Q78 64 62 60 Q52 58 54 70 Q56 82 40 80 Q24 80 22 70 Z" fill="#fff6e8" /><circle cx="38" cy="40" r="6" fill="#e63946" /><circle cx="56" cy="36" r="6" fill="#ffb703" /><circle cx="70" cy="48" r="6" fill="#219ebc" /><circle cx="34" cy="60" r="6" fill="#8338ec" /></g>,
    fish: <g><ellipse cx="46" cy="52" rx="24" ry="15" fill="#ffb703" /><path d="M68 52 L84 40 L84 64 Z" fill="#fb8500" /><circle cx="36" cy="48" r="3.5" fill={ink} /><circle cx="24" cy="26" r="4" fill="none" stroke="#fff" strokeWidth="2" /><circle cx="32" cy="18" r="2.5" fill="none" stroke="#fff" strokeWidth="2" /></g>,
    drum: <g><ellipse cx="50" cy="40" rx="26" ry="9" fill="#fff6e8" /><path d="M24 40 V64 Q50 80 76 64 V40 Q50 56 24 40 Z" fill="#e63946" /><path d="M24 46 L76 62 M24 62 L76 46" stroke="#ffb703" strokeWidth="3" /><rect x="58" y="16" width="5" height="26" rx="2.5" fill="#8b5e3c" transform="rotate(30 60 30)" /></g>,
    ball: <g><circle cx="50" cy="52" r="24" fill="#fff" stroke={ink} strokeWidth="2" /><path d="M50 40 L61 48 L57 61 H43 L39 48 Z" fill={ink} /></g>,
    mitten: <g><path d="M34 76 V40 Q34 22 52 22 Q68 22 68 40 V52 Q78 46 80 56 Q76 66 66 70 V76 Z" fill="#e63946" /><rect x="32" y="70" width="38" height="10" rx="4" fill="#f1faee" /></g>,
  }
  const [a, b] = COVERS[art] || COVERS.book
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`cv-${art}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="100" height="100" rx="14" fill={`url(#cv-${art})`} />
      {shapes[art] || <g><rect x="28" y="24" width="44" height="54" rx="4" fill="#fff6e8" /><rect x="34" y="34" width="32" height="4" rx="2" fill={a} /><rect x="34" y="44" width="24" height="4" rx="2" fill={b} /></g>}
    </svg>
  )
}

// --------------------------------------------------------------------------- the panel

const big: CSSProperties = {
  minWidth: 72, minHeight: 72, borderRadius: 999, border: 'none', cursor: 'pointer',
  background: C.accent, color: C.onAccent, font: `800 30px/1 ${FONT_UI}`,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
const soft: CSSProperties = { ...big, background: C.raise, color: C.ink, border: `2px solid ${C.hairlineStrong}` }

type View = { kind: 'shelf' } | { kind: 'book'; book: OpenBook; page: number } | { kind: 'end'; book: OpenBook; say: string }

const CSS = `
.kb-word{border-radius:10px;padding:0 4px;transition:background .18s ${EASE},color .18s ${EASE};cursor:pointer}
.kb-word.on{background:var(--al-accent,#5EC9CC);color:var(--al-on-accent,#050507)}
.kb-book{transition:transform .22s ${EASE}}
.kb-book:active{transform:scale(.96)}
.kb-star{position:absolute;font-size:28px;animation:kb-float 2.4s ease-in-out infinite}
@keyframes kb-float{50%{transform:translateY(-14px) rotate(12deg)}}
@media (prefers-reduced-motion:reduce){.kb-star{animation:none}.kb-word{transition:none}}
`

export default function KidBookshelf({ apiBase, extraHeaders, onClose, onFinished, makeVoice }: KidBookshelfProps) {
  const headersRef = useRef(extraHeaders || {})
  headersRef.current = extraHeaders || {}
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const voice = useMemo<LearnSpeak>(() => {
    const onSpeaking = (src: SpeakingSource) => { audioRef.current = src instanceof HTMLAudioElement ? src : null }
    return makeVoice ? makeVoice(onSpeaking) : createLearnVoice(apiBase, () => headersRef.current, { onSpeaking })
  }, [apiBase, makeVoice])
  const [books, setBooks] = useState<ShelfBook[] | null>(null)
  const [view, setView] = useState<View>({ kind: 'shelf' })
  const [lit, setLit] = useState(-1)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const call = useCallback(async (path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: unknown }> => {
    try {
      const r = await fetch(`${apiBase}${path}`, body === undefined
        ? { headers: { ...headersRef.current } }
        : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headersRef.current }, body: JSON.stringify(body) })
      return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) }
    } catch {
      return { ok: false, status: 0, data: null }
    }
  }, [apiBase])

  const loadShelf = useCallback(async () => {
    const r = await call('/me/shelf')
    const list = (Array.isArray(obj(r.data).books) ? (obj(r.data).books as unknown[]) : []).map(asShelfBook)
    setBooks(list.filter(Boolean) as ShelfBook[])
  }, [call])

  useEffect(() => { void loadShelf() }, [loadShelf])
  useEffect(() => () => { if (timer.current) clearInterval(timer.current) }, [])

  const stopFollow = () => { if (timer.current) { clearInterval(timer.current); timer.current = null } }

  /** Read one page aloud and light each word as it is said. */
  const readPage = useCallback((page: BookPage) => {
    stopFollow()
    audioRef.current = null
    setLit(-1)
    voice(page.text)
    const total = pageMs(page.words)
    const started = Date.now()
    timer.current = setInterval(() => {
      const a = audioRef.current
      let ms = Date.now() - started
      if (a && Number.isFinite(a.duration) && a.duration > 0) ms = (a.currentTime / a.duration) * total
      if (ms > total + 600) { stopFollow(); setLit(-1); return }
      setLit(wordAt(page.words, ms))
    }, 60)
  }, [voice])

  const open = async (id: string) => {
    if (busy) return
    setBusy(true)
    const r = await call(`/me/shelf/${encodeURIComponent(id)}`)
    setBusy(false)
    const book = asOpenBook(obj(r.data).book)
    if (!book) { voice('That book is resting. Let\'s pick another one!'); return }
    setView({ kind: 'book', book, page: 0 })
    readPage(book.pages[0])
  }

  const turn = async (book: OpenBook, to: number) => {
    stopFollow()
    if (to >= book.pages.length) {
      const r = await call(`/me/shelf/${encodeURIComponent(book.id)}/finish`, {})
      const say = str(obj(r.data).say, 'The end! What a great story.')
      setView({ kind: 'end', book, say })
      voice(say)
      if (r.ok) onFinished?.(book.id)
      return
    }
    const page = Math.max(0, to)
    setView({ kind: 'book', book, page })
    if (page > 0) void call(`/me/shelf/${encodeURIComponent(book.id)}/page`, { page })
    readPage(book.pages[page])
  }

  const back = () => { stopFollow(); setLit(-1); setView({ kind: 'shelf' }); void loadShelf() }

  const root: CSSProperties = { font: `500 18px/1.4 ${FONT_UI}`, color: C.ink, minHeight: 420, position: 'relative' }

  if (view.kind === 'book') {
    const { book, page } = view
    const p = book.pages[page]
    return (
      <div style={root} data-testid="kid-book">
        <style>{LEARN_CSS + CSS}</style>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <button type="button" aria-label="Back to my shelf" onClick={back} style={{ ...soft, minWidth: 56, minHeight: 56, fontSize: 24 }}>✕</button>
          <div style={{ flex: 1, display: 'flex', gap: 6, justifyContent: 'center' }} aria-hidden="true">
            {book.pages.map((_, i) => <span key={i} style={{ width: 14, height: 14, borderRadius: 7, background: i <= page ? C.accent : C.hairlineStrong }} />)}
          </div>
          <button type="button" aria-label="Read it again" onClick={() => readPage(p)} style={{ ...soft, minWidth: 56, minHeight: 56, fontSize: 24 }}>🔊</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, padding: '8px 4px' }}>
          {page === 0 && (book.image
            ? <img src={book.image} alt="" style={{ width: 'min(70vw, 320px)', borderRadius: 18 }} />
            : <CoverArt art={book.art} size={150} />)}
          <p data-testid="kid-book-page" style={{ font: `700 clamp(30px, 6vw, 44px)/1.5 ${FONT_UI}`, textAlign: 'center', margin: 0, maxWidth: 760 }}>
            {p.words.map((w, i) => (
              <span key={i}>
                <span role="button" tabIndex={0} className={`kb-word${i === lit ? ' on' : ''}`} data-on={i === lit ? '1' : '0'}
                  onClick={() => { stopFollow(); setLit(i); voice(w.say || w.w) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { setLit(i); voice(w.say || w.w) } }}>{w.w}</span>{' '}
              </span>
            ))}
          </p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '20px 4px 4px' }}>
          <button type="button" aria-label="Page back" disabled={page === 0} onClick={() => void turn(book, page - 1)}
            style={{ ...soft, opacity: page === 0 ? 0.3 : 1 }}>◀</button>
          <button type="button" aria-label={page === book.pages.length - 1 ? 'The end' : 'Next page'} className="al-glow"
            onClick={() => void turn(book, page + 1)} style={big}>▶</button>
        </div>
      </div>
    )
  }

  if (view.kind === 'end') {
    return (
      <div style={{ ...root, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, textAlign: 'center' }} data-testid="kid-book-end">
        <style>{LEARN_CSS + CSS}</style>
        {[8, 22, 70, 86].map((x, i) => <span key={x} className="kb-star" aria-hidden="true" style={{ left: `${x}%`, top: `${12 + (i % 2) * 18}%`, animationDelay: `${i * 0.3}s` }}>⭐</span>)}
        <CoverArt art={view.book.art} size={160} />
        <div style={{ font: `800 40px/1.2 ${FONT_UI}` }}>The End!</div>
        <div style={{ font: `600 22px/1.4 ${FONT_UI}`, color: C.dim, maxWidth: 520 }}>{view.say}</div>
        <div style={{ display: 'flex', gap: 18 }}>
          <button type="button" aria-label="Read it again" onClick={() => void turn(view.book, 0)} style={soft}>↺</button>
          <button type="button" aria-label="Back to my shelf" onClick={back} style={big}>📚</button>
        </div>
      </div>
    )
  }

  return (
    <div style={root} data-testid="kid-bookshelf">
      <style>{LEARN_CSS + CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {onClose && <button type="button" aria-label="Back to my classroom" onClick={onClose} style={{ ...soft, minWidth: 56, minHeight: 56, fontSize: 24 }}>◀</button>}
        <div style={{ font: `800 28px/1.2 ${FONT_UI}` }}>My books</div>
      </div>
      {books === null && <div className="al-skel" style={{ height: 180, borderRadius: 20, background: C.skeleton }} />}
      {books !== null && books.length === 0 && (
        <div data-testid="kid-bookshelf-empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
          <CoverArt art="book" size={110} />
          <div style={{ font: `700 22px/1.4 ${FONT_UI}` }}>Your shelf is waiting for books!</div>
          <div style={{ color: C.dim }}>A grown-up can put one here for you.</div>
        </div>
      )}
      {books !== null && books.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 18 }}>
          {books.map((b) => (
            <button type="button" key={b.id} className="kb-book al-focus" data-testid={`kid-book-${b.id}`} aria-label={b.title}
              onClick={() => void open(b.id)} onPointerEnter={() => voice.prefetch?.(b.title)}
              style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: C.ink, textAlign: 'center', position: 'relative' }}>
              <div style={{ borderRadius: 16, boxShadow: '0 10px 24px -12px rgba(0,0,0,.6)', overflow: 'hidden', width: 'fit-content', margin: '0 auto' }}>
                <CoverArt art={b.art} size={132} />
              </div>
              <div style={{ font: `700 17px/1.3 ${FONT_UI}`, marginTop: 8 }}>{b.title}</div>
              {b.finished && <span aria-label="read" style={{ position: 'absolute', top: -6, right: 6, fontSize: 26 }}>⭐</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
