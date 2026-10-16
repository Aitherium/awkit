/**
 * KidEasel: the child's art studio in Aither Learn (kids' suite S7).
 *
 * The canvas is LOCAL. Drawings are kept on this device only (a small gallery in
 * localStorage) and never leave it unless the child taps "Show my family". That tap sends
 * the picture to Hearth (POST /me/easel) as a REQUEST: it waits for a grown-up, and only a
 * grown-up's yes puts it in the family room. The panel shows the request's state in plain
 * words ("Waiting for a grown-up", "Your family can see it!", "Not this time") and never
 * offers a way around it.
 *
 * Tools: 8 crayons, 3 brush sizes, an eraser, Undo, Start over, and sprite stickers (a
 * little friend, a star, a heart, a sun) stamped with a tap. No text input at all, no
 * links, no uploads from the device, no counts, no timers.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { C, EASE, FONT_UI, LEARN_CSS } from './learnTheme'

export interface KidEaselProps {
  /** Base of the tutor proxy, e.g. '/api/tutor'. */
  apiBase: string
  extraHeaders?: Record<string, string>
  onClose?: () => void
  /** The child's sprite colours (body, accent) for the sprite sticker. */
  spriteColors?: [string, string]
  /** Where the device-local gallery lives (one per signed-in child). */
  storageKey?: string
}

export const CRAYONS = ['#1d1d2b', '#e63946', '#fb8500', '#ffd166', '#06d6a0', '#118ab2', '#8338ec', '#ff8fab'] as const
export const SIZES = [6, 14, 28] as const
export const STICKERS = ['sprite', 'star', 'heart', 'sun'] as const
export type Sticker = (typeof STICKERS)[number]
export const GALLERY_MAX = 12
const W = 1024
const H = 720  // the canvas fits 62vh so the crayons stay in view on a landscape tablet

export interface ShareState { drawing_id: string; status: string; image?: string }

/** Plain words for a share request's state. Exported for tests. */
export function shareWords(status: string): string {
  if (status === 'asked') return 'Waiting for a grown-up'
  if (status === 'posted' || status === 'approved') return 'Your family can see it!'
  if (status === 'not_now') return 'Not this time. It is still yours!'
  return ''
}

type Stroke =
  | { kind: 'line'; color: string; size: number; erase: boolean; pts: Array<[number, number]> }
  | { kind: 'sticker'; sticker: Sticker; x: number; y: number }

/** Draw one sticker centred on (x, y). Pure canvas calls; exported for tests. */
export function drawSticker(ctx: CanvasRenderingContext2D, sticker: Sticker, x: number, y: number,
  colors: [string, string] = ['#5EC9CC', '#1E9EA2']): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.lineWidth = 4
  ctx.strokeStyle = '#1d1d2b'
  if (sticker === 'sprite') {
    ctx.fillStyle = colors[0]
    ctx.beginPath(); ctx.ellipse(0, 6, 44, 40, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.fillStyle = colors[1]
    ctx.beginPath(); ctx.ellipse(0, -36, 14, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#ffffff'
    for (const ex of [-15, 15]) { ctx.beginPath(); ctx.arc(ex, 0, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke() }
    ctx.fillStyle = '#1d1d2b'
    for (const ex of [-13, 17]) { ctx.beginPath(); ctx.arc(ex, 2, 5, 0, Math.PI * 2); ctx.fill() }
    ctx.beginPath(); ctx.arc(0, 18, 10, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke()
  } else if (sticker === 'star') {
    ctx.fillStyle = '#ffd166'
    ctx.beginPath()
    for (let i = 0; i < 10; i += 1) {
      const r = i % 2 ? 20 : 46
      const a = (Math.PI / 5) * i - Math.PI / 2
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    ctx.closePath(); ctx.fill(); ctx.stroke()
  } else if (sticker === 'heart') {
    ctx.fillStyle = '#ff5d8f'
    ctx.beginPath()
    ctx.moveTo(0, 36)
    ctx.bezierCurveTo(-56, -4, -26, -46, 0, -16)
    ctx.bezierCurveTo(26, -46, 56, -4, 0, 36)
    ctx.closePath(); ctx.fill(); ctx.stroke()
  } else {
    ctx.fillStyle = '#ffb703'
    for (let i = 0; i < 8; i += 1) {
      ctx.save(); ctx.rotate((Math.PI / 4) * i)
      ctx.beginPath(); ctx.roundRect?.(-5, -50, 10, 18, 5); ctx.fill(); ctx.restore()
    }
    ctx.beginPath(); ctx.arc(0, 0, 28, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  }
  ctx.restore()
}

function paint(ctx: CanvasRenderingContext2D, strokes: readonly Stroke[], colors?: [string, string]): void {
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  for (const s of strokes) {
    if (s.kind === 'sticker') { drawSticker(ctx, s.sticker, s.x, s.y, colors); continue }
    ctx.strokeStyle = s.erase ? '#ffffff' : s.color
    ctx.lineWidth = s.size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    s.pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
    if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] + 0.1, s.pts[0][1])
    ctx.stroke()
  }
}

function readGallery(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.startsWith('data:image/png;base64,')).slice(0, GALLERY_MAX) : []
  } catch { return [] }
}

function writeGallery(key: string, items: string[]): string[] {
  let keep = items.slice(0, GALLERY_MAX)
  for (;;) {
    try { localStorage.setItem(key, JSON.stringify(keep)); return keep } catch {
      if (keep.length <= 1) return keep  // storage full: keep what is on screen, say nothing
      keep = keep.slice(0, keep.length - 1)
    }
  }
}

const btn: CSSProperties = {
  minWidth: 64, minHeight: 64, borderRadius: 18, border: `2px solid ${C.hairlineStrong}`, background: C.raise,
  color: C.ink, cursor: 'pointer', font: `700 22px/1 ${FONT_UI}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}

export default function KidEasel({ apiBase, extraHeaders, onClose, spriteColors, storageKey = 'awkit_easel_gallery' }: KidEaselProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const headersRef = useRef(extraHeaders || {})
  headersRef.current = extraHeaders || {}
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const live = useRef<Stroke | null>(null)
  const [color, setColor] = useState<string>(CRAYONS[1])
  const [size, setSize] = useState<number>(SIZES[1])
  const [tool, setTool] = useState<'crayon' | 'eraser' | Sticker>('crayon')
  const [gallery, setGallery] = useState<string[]>([])
  const [shares, setShares] = useState<ShareState[]>([])
  const [say, setSay] = useState('')
  const [sending, setSending] = useState(false)

  const ctx = () => canvasRef.current?.getContext('2d') || null
  const redraw = useCallback((list: readonly Stroke[]) => { const c = ctx(); if (c) paint(c, list, spriteColors) }, [spriteColors])

  useEffect(() => { setGallery(readGallery(storageKey)) }, [storageKey])
  useEffect(() => { redraw(strokes) }, [strokes, redraw])

  const loadShares = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/me/easel`, { headers: { ...headersRef.current } })
      const data = (await r.json().catch(() => null)) as { drawings?: unknown } | null
      const list = Array.isArray(data?.drawings) ? data!.drawings : []
      setShares(list.map((d) => {
        const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>
        const image = typeof o.image === 'string' && o.image.startsWith('data:image/png;base64,') ? o.image : undefined
        return { drawing_id: String(o.drawing_id || ''), status: String(o.status || ''), image }
      }).filter((d) => d.drawing_id && shareWords(d.status)))
    } catch { /* offline: the local gallery still works */ }
  }, [apiBase])
  useEffect(() => { void loadShares() }, [loadShares])

  const at = (e: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect()
    const sx = r.width ? W / r.width : 1
    const sy = r.height ? H / r.height : 1
    return [Math.round((e.clientX - r.left) * sx), Math.round((e.clientY - r.top) * sy)]
  }

  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const [x, y] = at(e)
    if (tool !== 'crayon' && tool !== 'eraser') {
      setStrokes((s) => [...s, { kind: 'sticker', sticker: tool, x, y }])
      return
    }
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch { /* not supported */ }
    live.current = { kind: 'line', color, size: tool === 'eraser' ? size * 2 : size, erase: tool === 'eraser', pts: [[x, y]] }
    redraw([...strokes, live.current])
  }
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const s = live.current
    if (!s || s.kind !== 'line') return
    s.pts.push(at(e))
    redraw([...strokes, s])
  }
  const up = () => {
    const s = live.current
    live.current = null
    if (s) setStrokes((list) => [...list, s])
  }

  const exportPng = (): string | null => {
    const c = canvasRef.current
    if (!c) return null
    try {
      const url = c.toDataURL('image/png')
      return typeof url === 'string' && url.startsWith('data:image/png;base64,') ? url : null
    } catch { return null }
  }

  const keep = () => {
    const png = exportPng()
    if (!png || !strokes.length) return
    setGallery((g) => writeGallery(storageKey, [png, ...g.filter((x) => x !== png)]))
    setSay('Saved on this device!')
  }

  const share = async () => {
    const png = exportPng()
    if (!png || !strokes.length || sending) return
    setSending(true)
    try {
      const r = await fetch(`${apiBase}/me/easel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersRef.current },
        body: JSON.stringify({ image: png }),
      })
      const data = (await r.json().catch(() => null)) as { say?: unknown; detail?: { say?: unknown } } | null
      const line = typeof data?.say === 'string' ? data.say
        : typeof data?.detail?.say === 'string' ? data.detail.say : ''
      setSay(line || (r.ok ? shareWords('asked') : 'Let\'s try that again in a little while.'))
      if (r.ok) {
        setGallery((g) => writeGallery(storageKey, [png, ...g.filter((x) => x !== png)]))
        await loadShares()
      }
    } catch {
      setSay('Let\'s try that again in a little while.')
    } finally {
      setSending(false)
    }
  }

  const toolButton = (id: typeof tool, label: string, content: ReactNode, extra: CSSProperties = {}) => (
    <button type="button" aria-label={label} aria-pressed={tool === id} onClick={() => setTool(id)}
      style={{ ...btn, ...extra, ...(tool === id ? { borderColor: C.accent, boxShadow: `0 0 0 3px ${C.accentGlow}` } : {}) }}>{content}</button>
  )

  return (
    <div data-testid="kid-easel" style={{ font: `500 18px/1.4 ${FONT_UI}`, color: C.ink, display: 'flex', flexDirection: 'column', gap: 12, userSelect: 'none', WebkitUserSelect: 'none' }}>
      <style>{LEARN_CSS + `.ke-c{transition:transform .18s ${EASE}}.ke-c:active{transform:scale(.92)}`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {onClose && <button type="button" aria-label="Back to my classroom" onClick={onClose} style={btn}>◀</button>}
        <div style={{ font: `800 28px/1.2 ${FONT_UI}`, flex: 1 }}>My easel</div>
        <button type="button" aria-label="Undo" disabled={!strokes.length} onClick={() => setStrokes((s) => s.slice(0, -1))} style={{ ...btn, opacity: strokes.length ? 1 : 0.35 }}>↶</button>
        <button type="button" aria-label="Start over" disabled={!strokes.length} onClick={() => setStrokes([])} style={{ ...btn, opacity: strokes.length ? 1 : 0.35 }}>🧽</button>
      </div>
      <canvas ref={canvasRef} width={W} height={H} data-testid="kid-easel-canvas" data-strokes={strokes.length}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up}
        style={{ width: `min(100%, calc(62vh * ${W / H}))`, alignSelf: 'center', aspectRatio: `${W} / ${H}`, background: '#fff', borderRadius: 20, touchAction: 'none', boxShadow: '0 12px 32px -18px rgba(0,0,0,.6)' }} />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {CRAYONS.map((c) => (
          <button key={c} type="button" className="ke-c" aria-label={`Crayon ${c}`} aria-pressed={tool === 'crayon' && color === c}
            onClick={() => { setColor(c); setTool('crayon') }}
            style={{ width: 52, height: 52, borderRadius: 26, background: c, cursor: 'pointer',
              border: tool === 'crayon' && color === c ? `5px solid ${C.ink}` : `3px solid ${C.hairlineStrong}` }} />
        ))}
        {SIZES.map((s, i) => (
          <button key={s} type="button" aria-label={['Thin', 'Medium', 'Thick'][i]} aria-pressed={size === s} onClick={() => setSize(s)}
            style={{ ...btn, minWidth: 56, ...(size === s ? { borderColor: C.accent } : {}) }}>
            <span style={{ width: s, height: s, borderRadius: s, background: C.ink, display: 'block', maxWidth: 30, maxHeight: 30 }} />
          </button>
        ))}
        {toolButton('eraser', 'Eraser', '◻')}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {toolButton('sprite', 'Sprite sticker', <span style={{ width: 30, height: 26, borderRadius: '50%', background: spriteColors?.[0] || '#5EC9CC', border: '3px solid #1d1d2b', display: 'block' }} />)}
        {toolButton('star', 'Star sticker', '⭐')}
        {toolButton('heart', 'Heart sticker', '❤')}
        {toolButton('sun', 'Sun sticker', '☀')}
        <div style={{ flex: 1 }} />
        <button type="button" aria-label="Keep it" disabled={!strokes.length} onClick={keep} style={{ ...btn, padding: '0 18px', opacity: strokes.length ? 1 : 0.35 }}>Keep it</button>
        <button type="button" aria-label="Show my family" disabled={!strokes.length || sending} onClick={() => void share()} className="al-primary"
          style={{ ...btn, padding: '0 22px', background: C.accent, color: C.onAccent, borderColor: C.accent, opacity: strokes.length ? 1 : 0.35 }}>
          Show my family
        </button>
      </div>
      {say && <div role="status" data-testid="kid-easel-say" style={{ font: `700 20px/1.4 ${FONT_UI}`, textAlign: 'center' }}>{say}</div>}
      {shares.length > 0 && (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }} aria-label="Shared with my family">
          {shares.map((d) => (
            <div key={d.drawing_id} data-testid={`kid-easel-share-${d.status}`} style={{ flex: '0 0 auto', width: 128, textAlign: 'center' }}>
              {d.image ? <img src={d.image} alt="" style={{ width: 128, height: 90, objectFit: 'cover', borderRadius: 12, background: '#fff' }} />
                : <div style={{ width: 128, height: 90, borderRadius: 12, background: C.raise }} />}
              <div style={{ font: `600 13px/1.3 ${FONT_UI}`, color: C.dim, marginTop: 4 }}>{shareWords(d.status)}</div>
            </div>
          ))}
        </div>
      )}
      {gallery.length > 0 && (
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto' }} aria-label="My drawings on this device">
          {gallery.map((g, i) => <img key={i} src={g} alt="" style={{ width: 96, height: 68, objectFit: 'cover', borderRadius: 10, background: '#fff', border: `2px solid ${C.hairline}` }} />)}
        </div>
      )}
    </div>
  )
}
