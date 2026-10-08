'use client'

/**
 * ImageStudioPanel — the customer Image Studio (crafts.yaml `image-studio`, lead agent Iris).
 *
 * Craft brick B4: a library on the left (folders, your media, characters), a canvas in the
 * middle (pick an image, paint a mask), and one run box on the right (inpaint the mask, edit
 * by instruction, remove the background, or start from a new image). The price of the run is
 * on screen before the Run button is pressed.
 *
 * Every call goes through creative/craft-client.ts to the host's `/api/iris/craft/*` — the
 * hosted customer lane (allowlist, territory gate, credits, the caller's own account). The
 * panel never talks to media-forge. Media is tenant-scoped on the SERVER (Iris
 * /craft/library reads the authenticated account's ledger only); nothing here filters by
 * account, on purpose — a UI filter is not a boundary.
 *
 * A refusal or failure is shown in the server's own words, followed by what happened to the
 * credits ("Nothing was charged." when the server reports 0).
 *
 * Touch and pen (awkit/drawing): a pen draws with pressure; once a pen has been seen,
 * fingers only pan and pinch-zoom (palm rejection), unless "Finger draws" is turned on.
 * Before any pen, one finger paints and two fingers pinch. A two-finger tap undoes, a
 * three-finger tap redoes. Under 768 px of panel width the library and run box become
 * sheets over a full-height canvas with a bottom tool bar of 44 px targets.
 *
 * The mask contract with /craft is unchanged: the mask canvas is the image's natural size,
 * and maskDataUrl() still sends alphaToMask() of it (any painted alpha -> white). Pressure
 * changes the brush SIZE only, never the opacity, so it cannot change what counts as painted.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  brushFor, CanvasHistory, clientToCanvas, growRect, stampsAlong, useDrawingSurface,
  type Rect, type Stamp, type StrokeSample,
} from '../drawing'
import {
  STUDIO_ACTIONS, alphaToMask, buildActionParams, costLine, createCharacter, createFolder,
  deleteFolder, estimate, getLibrary, listCraftOps, maskCoverage, mediaInFolder, mediaSrc,
  moveMedia, outcomeText, runCraftOp,
  type CraftCatalogue, type CraftEstimate, type CraftLibrary, type StudioAction,
} from './creative/craft-client'

export interface ImageStudioPanelProps {
  /** '' for same-origin (the host serves /api/iris/craft/*). */
  apiBase?: string
  className?: string
}

const EMPTY_LIBRARY: CraftLibrary = { media: [], folders: [], characters: [] }
const UNFILED = '__unfiled__'
/** Same breakpoint as the desktop's own mobile mode (window-fit.ts MOBILE_MAX_WIDTH). */
const COMPACT_MAX_WIDTH = 768
const COMPACT_MAX_HEIGHT = 500
/** The mask is drawn opaque and shown at this opacity, so overlapping dabs look even. */
const MASK_RGB = 'rgb(255, 70, 90)'
const MASK_SHOW_OPACITY = 0.55
const MASK = 'mask'
/** Touch targets: Apple HIG / WCAG 2.5.5 minimum. */
const TARGET = 44

type Sheet = 'library' | 'run' | null
type Size = { w: number; h: number }

function useBoxSize(ref: React.RefObject<HTMLElement | null>, key?: unknown): Size {
  const [box, setBox] = useState<Size>({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect
      if (r) setBox(b => (b.w === Math.round(r.width) && b.h === Math.round(r.height) ? b : { w: Math.round(r.width), h: Math.round(r.height) }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, key])
  return box
}

export default function ImageStudioPanel({ apiBase = '', className = '' }: ImageStudioPanelProps) {
  const opts = useMemo(() => ({ apiBase }), [apiBase])

  const [catalogue, setCatalogue] = useState<CraftCatalogue | null>(null)
  const [library, setLibrary] = useState<CraftLibrary>(EMPTY_LIBRARY)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [folder, setFolder] = useState<string>(UNFILED)
  const [selected, setSelected] = useState<number | null>(null)
  const [action, setAction] = useState<StudioAction>('inpaint')
  const [text, setText] = useState('')
  const [brush, setBrush] = useState(32)
  const [erasing, setErasing] = useState(false)
  const [pressureOn, setPressureOn] = useState(true)
  const [hasMask, setHasMask] = useState(false)
  const [quote, setQuote] = useState<CraftEstimate | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [newFolder, setNewFolder] = useState('')
  const [newCharacter, setNewCharacter] = useState('')
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [sheet, setSheet] = useState<Sheet>(null)

  const root = useRef<HTMLDivElement | null>(null)
  const viewport = useRef<HTMLDivElement | null>(null)
  const content = useRef<HTMLDivElement | null>(null)
  const overlay = useRef<HTMLCanvasElement | null>(null)
  const preview = useRef<HTMLCanvasElement | null>(null)
  const history = useMemo(() => new CanvasHistory({ maxEntries: 40 }), [])
  const stroke = useRef<{ last: Stamp | null; carry: number; dirty: Rect | null }>({ last: null, carry: 0, dirty: null })

  const box = useBoxSize(root)
  // A width of 0 means "not measured" (first paint, jsdom): keep the wide layout. A phone
  // on its side (844 x 390) is still a phone: short panels count as compact too.
  const compact = box.w > 0 && (box.w < COMPACT_MAX_WIDTH || box.h < COMPACT_MAX_HEIGHT)
  const landscape = box.w > box.h
  const vp = useBoxSize(viewport, compact)

  useEffect(() => { if (!compact) setSheet(null) }, [compact])

  useEffect(() => history.subscribe(() => { setCanUndo(history.canUndo); setCanRedo(history.canRedo) }), [history])

  const refresh = useCallback(async () => {
    try {
      setLibrary(await getLibrary(opts))
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [opts])

  useEffect(() => {
    let alive = true
    listCraftOps(opts, 'image-studio')
      .then(c => { if (alive) setCatalogue(c) })
      .catch(e => { if (alive) setLoadError(e instanceof Error ? e.message : String(e)) })
    void refresh()
    return () => { alive = false }
  }, [opts, refresh])

  const selectedMedia = library.media.find(m => m.id === selected) ?? null
  const actionMeta = STUDIO_ACTIONS.find(a => a.id === action)!
  const served = catalogue ? catalogue.shell_ops[action] !== false : true
  const spec = catalogue?.ops.find(o => o.name === action) ?? null
  const listPrice = spec?.credits ?? null
  const shown = folder === UNFILED ? mediaInFolder(library, null)
    : folder === '' ? library.media : mediaInFolder(library, folder)
  const imgSrc = selectedMedia ? mediaSrc(opts, selectedMedia) : null

  // ── the mask ─────────────────────────────────────────────────────────────
  const recountMask = useCallback(() => {
    const c = overlay.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx || c.width === 0) { setHasMask(false); return }
    setHasMask(maskCoverage(ctx.getImageData(0, 0, c.width, c.height).data) > 0)
  }, [])

  const clearMask = useCallback(() => {
    const c = overlay.current
    const ctx = c?.getContext('2d')
    if (c && ctx) {
      ctx.clearRect(0, 0, c.width, c.height)
      history.commit(MASK)
    }
    setHasMask(false)
  }, [history])

  const maskDataUrl = useCallback((): string | null => {
    const c = overlay.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx || c.width === 0) return null
    const data = ctx.getImageData(0, 0, c.width, c.height)
    if (maskCoverage(data.data) === 0) return null
    const out = document.createElement('canvas')
    out.width = c.width
    out.height = c.height
    const octx = out.getContext('2d')
    if (!octx) return null
    octx.putImageData(new ImageData(alphaToMask(data.data), c.width, c.height), 0, 0)
    return out.toDataURL('image/png')
  }, [])

  const undo = useCallback(() => { if (history.undo()) recountMask() }, [history, recountMask])
  const redo = useCallback(() => { if (history.redo()) recountMask() }, [history, recountMask])

  /** Brush radius in mask pixels. `brush` is a size on SCREEN: zoomed in, it covers fewer image pixels. */
  const radiusAt = (pressure: number, maskPerCss: number) =>
    brushFor({ pressure, tiltX: 0, tiltY: 0, pointerType: 'pen' }, brush * maskPerCss, 1, { pressure: pressureOn, size: [0.25, 1] }).radius

  /** A client-space sample -> mask pixels. */
  const toMask = (s: StrokeSample): (Stamp & { k: number }) | null => {
    const c = overlay.current
    if (!c) return null
    const rect = c.getBoundingClientRect()
    const p = clientToCanvas(s, rect, c)
    if (!p) return null
    return { x: p.x, y: p.y, pressure: s.pressure, k: c.width / rect.width }
  }

  const dab = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number) => {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  const paintTo = (s: StrokeSample) => {
    const c = overlay.current
    const ctx = c?.getContext('2d')
    const p = toMask(s)
    if (!c || !ctx || !p) return
    const st = stroke.current
    ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'
    ctx.fillStyle = MASK_RGB
    const r = radiusAt(p.pressure, p.k)
    if (!st.last) {
      dab(ctx, p.x, p.y, r)
      st.dirty = growRect(st.dirty, p.x, p.y, r, c)
    } else {
      // Even spacing along the segment: a fast stroke is a line, not a row of dots.
      const { stamps, carry } = stampsAlong(st.last, p, Math.max(0.5, r * 0.3), st.carry)
      st.carry = carry
      for (const q of stamps) {
        const rq = radiusAt(q.pressure, p.k)
        dab(ctx, q.x, q.y, rq)
        st.dirty = growRect(st.dirty, q.x, q.y, rq, c)
      }
    }
    st.last = { x: p.x, y: p.y, pressure: p.pressure }
    ctx.globalCompositeOperation = 'source-over'
  }

  const clearPreview = () => {
    const pc = preview.current
    pc?.getContext('2d')?.clearRect(0, 0, pc.width, pc.height)
  }

  const surface = useDrawingSurface(viewport, content, {
    enabled: !!imgSrc && !busy,
    onStrokeStart: first => {
      viewport.current?.focus({ preventScroll: true })
      stroke.current = { last: null, carry: 0, dirty: null }
      paintTo(first)
    },
    onStrokeSamples: samples => { for (const s of samples) paintTo(s) },
    // Predicted samples only ever touch the throwaway preview layer, cleared every frame.
    onStrokePreview: predicted => {
      clearPreview()
      const pc = preview.current
      const ctx = pc?.getContext('2d')
      const last = stroke.current.last
      if (!pc || !ctx || !last || erasing || predicted.length === 0) return
      ctx.fillStyle = MASK_RGB
      let from = last
      for (const s of predicted) {
        const p = toMask(s)
        if (!p) continue
        const r = radiusAt(p.pressure, p.k)
        for (const q of stampsAlong(from, p, Math.max(0.5, r * 0.3)).stamps) dab(ctx, q.x, q.y, r)
        from = p
      }
    },
    onStrokeEnd: () => {
      clearPreview()
      history.commit(MASK, stroke.current.dirty)
      stroke.current = { last: null, carry: 0, dirty: null }
      if (erasing) recountMask()
      else setHasMask(true)
    },
    onStrokeCancel: () => {
      clearPreview()
      history.rollback(MASK, stroke.current.dirty)
      stroke.current = { last: null, carry: 0, dirty: null }
    },
    onUndo: undo,
    onRedo: redo,
  })

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
    else if (mod && k === 'y') { e.preventDefault(); redo() }
    else if (mod) return
    else if (k === 'e') setErasing(true)
    else if (k === 'b') setErasing(false)
    else if (k === '0') surface.resetView()
    else if (k === '+' || k === '=') surface.zoomBy(1.25)
    else if (k === '-') surface.zoomBy(0.8)
    else if (k === '[') setBrush(b => Math.max(4, Math.round(b * 0.8)))
    else if (k === ']') setBrush(b => Math.min(160, Math.round(b * 1.25)))
  }

  // ── the price, before the run ────────────────────────────────────────────
  useEffect(() => {
    setQuote(null)
    if (!served) return
    const built = buildActionParams(action, {
      imageId: selected, text: text || 'x', maskDataUrl: hasMask ? 'data:image/png;base64,' : null,
    }, spec)
    if ('refusal' in built) return
    const params = { ...built.params }
    delete params.mask   // the mask never changes the price; do not ship it on every keystroke
    const t = setTimeout(() => {
      estimate(opts, action, params).then(setQuote).catch(() => setQuote(null))
    }, 350)
    return () => clearTimeout(t)
  }, [opts, action, selected, hasMask, served, spec, text])

  // ── run ──────────────────────────────────────────────────────────────────
  const run = async () => {
    setNotice(null)
    const built = buildActionParams(action, {
      imageId: selected, text, maskDataUrl: actionMeta.needsMask ? maskDataUrl() : null,
    }, spec)
    if ('refusal' in built) {
      setNotice({ tone: 'error', text: built.refusal })
      return
    }
    setBusy(true)
    try {
      const target = folder === UNFILED || folder === '' ? null : folder
      const result = await runCraftOp(opts, action, built.params, target)
      setNotice({ tone: result.ok ? 'ok' : 'error', text: outcomeText(result) })
      if (result.ok) {
        await refresh()
        const made = result.media[0]
        if (made) setSelected(made.id)
        clearMask()
      }
    } finally {
      setBusy(false)
    }
  }

  const libraryAction = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await refresh()
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) })
    }
  }

  const pick = (id: number | null) => {
    setSelected(id)
    clearMask()
    surface.resetView()
    if (compact) setSheet(null)
  }

  const big = compact ? { minHeight: TARGET } : undefined
  const bigField = compact ? { minHeight: TARGET, fontSize: 16 } : undefined   // 16 px: iOS does not zoom on focus

  // ── sections ─────────────────────────────────────────────────────────────
  const librarySection = (
    <>
      <h3 className="font-mono text-xs text-slate-400">01 / Library</h3>
      <nav className="flex flex-col gap-1 text-sm" aria-label="Folders">
        <FolderButton label="Unfiled" active={folder === UNFILED} onClick={() => setFolder(UNFILED)} compact={compact} />
        <FolderButton label="Everything" active={folder === ''} onClick={() => setFolder('')} compact={compact} />
        {library.folders.map(f => (
          <div key={f.id} className="flex items-center gap-1">
            <FolderButton label={f.name} active={folder === f.id} onClick={() => setFolder(f.id)} compact={compact} />
            <button type="button" aria-label={`Delete folder ${f.name}`} className="text-xs text-slate-500 hover:text-red-300"
              style={compact ? { minWidth: TARGET, minHeight: TARGET } : undefined}
              onClick={() => libraryAction(async () => { await deleteFolder(opts, f.id); if (folder === f.id) setFolder(UNFILED) })}>×</button>
          </div>
        ))}
      </nav>
      <form className="flex gap-1" onSubmit={e => { e.preventDefault(); const n = newFolder; setNewFolder(''); void libraryAction(() => createFolder(opts, n)) }}>
        <input aria-label="New folder name" value={newFolder} onChange={e => setNewFolder(e.target.value)} placeholder="New folder"
          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs" style={bigField} />
        <button type="submit" disabled={!newFolder.trim()} className="rounded border border-slate-700 px-2 text-xs disabled:opacity-40"
          style={compact ? { minHeight: TARGET, minWidth: TARGET } : undefined}>Add</button>
      </form>

      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${compact ? 4 : 3}, minmax(0, 1fr))` }} role="list" aria-label="Media">
        {shown.length === 0 && <p className="text-xs text-slate-500" style={{ gridColumn: '1 / -1' }}>Nothing here yet. Make a new image to start.</p>}
        {shown.map(m => {
          const src = mediaSrc(opts, m)
          return (
            <button key={m.id} type="button" role="listitem" aria-pressed={selected === m.id} title={`${m.op} #${m.id}`}
              onClick={() => pick(m.id)}
              className={`aspect-square overflow-hidden rounded border ${selected === m.id ? 'border-cyan-400' : 'border-slate-800'}`}>
              {src ? <img src={src} alt={`${m.op} #${m.id}`} className="h-full w-full object-cover" loading="lazy" />
                : <span className="text-[10px] text-slate-500">no preview</span>}
            </button>
          )
        })}
      </div>

      {selectedMedia && (
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Move selected to
          <select aria-label="Move selected to folder" value={selectedMedia.folder_id ?? ''}
            onChange={e => { const to = e.target.value || null; void libraryAction(() => moveMedia(opts, selectedMedia.id, to)) }}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100" style={bigField}>
            <option value="">Unfiled</option>
            {library.folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
      )}

      <h3 className="font-mono text-xs text-slate-400">Characters</h3>
      <ul className="flex flex-col gap-1 text-xs" aria-label="Characters">
        {library.characters.length === 0 && <li className="text-slate-500">No characters yet.</li>}
        {library.characters.map(c => (
          <li key={c.id}>
            <button type="button" className="text-left hover:text-cyan-300" style={big} onClick={() => pick(c.media_ids[0] ?? null)}>
              {c.name} <span className="text-slate-500">({c.media_ids.length} ref{c.media_ids.length === 1 ? '' : 's'})</span>
            </button>
          </li>
        ))}
      </ul>
      <form className="flex gap-1" onSubmit={e => { e.preventDefault(); if (selected == null) return; const n = newCharacter; setNewCharacter(''); void libraryAction(() => createCharacter(opts, n, [selected])) }}>
        <input aria-label="New character name" value={newCharacter} onChange={e => setNewCharacter(e.target.value)} placeholder="Character from selected"
          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs" style={bigField} />
        <button type="submit" disabled={!newCharacter.trim() || selected == null} className="rounded border border-slate-700 px-2 text-xs disabled:opacity-40"
          style={compact ? { minHeight: TARGET, minWidth: TARGET } : undefined}>Add</button>
      </form>
    </>
  )

  const runSection = (
    <>
      <h3 className="font-mono text-xs text-slate-400">03 / Run</h3>
      <div className="flex flex-col gap-1" role="radiogroup" aria-label="What to do">
        {STUDIO_ACTIONS.map(a => {
          const live = catalogue ? catalogue.shell_ops[a.id] !== false : true
          return (
            <label key={a.id} className={`flex items-center gap-2 text-sm ${live ? '' : 'text-slate-500'}`} style={big}>
              <input type="radio" name="studio-action" value={a.id} checked={action === a.id} onChange={() => setAction(a.id)} />
              {a.label}{!live && <span className="text-[10px]">(not served yet)</span>}
            </label>
          )
        })}
      </div>
      {actionMeta.needsText && (
        <textarea aria-label={action === 'edit_instruct' ? 'Instruction' : 'Prompt'} value={text} onChange={e => setText(e.target.value)}
          placeholder={action === 'edit_instruct' ? 'Make the jacket red' : action === 'inpaint' ? 'What goes in the painted area' : 'Describe the new image'}
          className="min-h-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" style={compact ? { fontSize: 16 } : undefined} />
      )}
      <p data-testid="cost-line" className="text-xs text-slate-300">
        {served ? costLine(quote, listPrice) : 'The studio engine does not serve this yet.'}
      </p>
      <button type="button" onClick={run} disabled={busy || !served}
        className="rounded bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950 disabled:bg-slate-700 disabled:text-slate-400" style={big}>
        {busy ? 'Running… (heavy edits take a minute)' : 'Run'}
      </button>
      {notice && (
        <p role={notice.tone === 'error' ? 'alert' : 'status'} data-testid="run-outcome"
          className={`text-xs ${notice.tone === 'error' ? 'text-red-300' : 'text-emerald-300'}`}>{notice.text}</p>
      )}
    </>
  )

  // Shown once a pen has been used: the palm-rejection switch and the pressure switch.
  const penToggles = surface.penSeen && (
    <>
      <ToolButton compact={compact} pressed={pressureOn} onClick={() => setPressureOn(v => !v)} label="Pen pressure changes brush size" short="Pressure" />
      <ToolButton compact={compact} pressed={surface.fingerDraws} onClick={() => surface.setFingerDraws(!surface.fingerDraws)} label="Finger draws (off: fingers pan and zoom)" short="Finger" />
    </>
  )

  const zoomPct = Math.round(surface.view.scale * 100)
  const imgMax = vp.w > 0 ? { maxWidth: vp.w - 8, maxHeight: vp.h - 8 } : { maxWidth: '100%', maxHeight: '70vh' }

  const canvasArea = (
    <div ref={viewport} tabIndex={-1} data-testid="studio-viewport" data-zoom={surface.view.scale.toFixed(3)}
      data-pen-seen={surface.penSeen ? 'true' : 'false'} aria-label="Canvas area"
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded border border-slate-800 bg-slate-900 outline-none"
      style={{ cursor: imgSrc ? 'crosshair' : 'default' }}>
      {imgSrc ? (
        <div ref={content} className="relative" style={{ willChange: 'transform' }}>
          <img src={imgSrc} alt="Image being edited" className="block select-none" draggable={false}
            style={{ ...imgMax, pointerEvents: 'none' }}
            onLoad={e => {
              const c = overlay.current
              if (!c) return
              c.width = e.currentTarget.naturalWidth
              c.height = e.currentTarget.naturalHeight
              const pc = preview.current
              if (pc) { pc.width = c.width; pc.height = c.height }
              history.track(MASK, c)
              setHasMask(false)
              surface.resetView()
            }} />
          <canvas ref={overlay} data-testid="mask-canvas" aria-label="Mask: paint the area to change"
            className="absolute inset-0 h-full w-full touch-none" style={{ opacity: MASK_SHOW_OPACITY, pointerEvents: 'none' }} />
          <canvas ref={preview} data-testid="mask-preview" aria-hidden="true"
            className="absolute inset-0 h-full w-full" style={{ opacity: MASK_SHOW_OPACITY * 0.8, pointerEvents: 'none' }} />
        </div>
      ) : selectedMedia ? (
        <p className="text-sm text-slate-500">This item has no preview.</p>
      ) : (
        <p className="p-4 text-center text-sm text-slate-500">Pick an image from your library, or make a new one.</p>
      )}
      {imgSrc && zoomPct !== 100 && (
        <span className="pointer-events-none absolute left-2 top-2 rounded bg-slate-950/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">{zoomPct}%</span>
      )}
    </div>
  )

  const brushSlider = (
    <label className="flex items-center gap-2 text-xs text-slate-400" style={compact ? { minHeight: TARGET, flex: 1 } : undefined}>
      Brush
      <input aria-label="Brush size" type="range" min={4} max={160} value={brush} onChange={e => setBrush(Number(e.target.value))}
        style={compact ? { flex: 1, minHeight: TARGET } : undefined} />
      <span className="font-mono text-[10px] text-slate-500" style={{ minWidth: 24 }}>{brush}</span>
    </label>
  )

  // ── layout ───────────────────────────────────────────────────────────────
  // ONE element tree for both layouts, so rotating a phone or resizing a desk window never
  // remounts the canvas (and never loses the mask or its undo history).
  const sheetStyle = (which: 'library' | 'run'): React.CSSProperties => landscape
    ? { position: 'absolute', top: 0, bottom: 0, [which === 'library' ? 'left' : 'right']: 0, width: 'min(340px, 85%)', zIndex: 20 }
    : { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '72%', zIndex: 20, borderTopLeftRadius: 12, borderTopRightRadius: 12 }
  const sheetHeader = (
    <div className="flex items-center justify-between">
      <span className="mx-auto h-1 w-10 rounded bg-slate-700" aria-hidden="true" />
      <button type="button" onClick={() => setSheet(null)} aria-label="Close" className="text-slate-400"
        style={{ minWidth: TARGET, minHeight: TARGET }}>✕</button>
    </div>
  )
  const sheetClass = 'flex flex-col gap-3 overflow-auto border border-slate-800 bg-slate-950 p-3 shadow-2xl'

  return (
    <div ref={root} data-testid="image-studio" data-layout={compact ? (landscape ? 'compact-landscape' : 'compact-portrait') : 'wide'} onKeyDown={onKeyDown}
      className={`relative flex h-full min-h-0 flex-col bg-slate-950 text-slate-100 ${className}`}>
      <header className={`flex items-center border-b border-slate-800 ${compact ? 'gap-2 px-3 py-1.5' : 'gap-3 px-4 py-2'}`}>
        <h2 className="truncate font-mono text-sm tracking-wide">{catalogue?.craft.name ?? 'Image Studio'}</h2>
        {!compact && <span className="text-xs text-slate-500">your images, edited on the hosted studio, paid with credits</span>}
        {catalogue?.buy_url && (
          <a className="ml-auto text-xs text-cyan-300 underline" href={catalogue.buy_url} target="_blank" rel="noreferrer">Buy credits</a>
        )}
      </header>

      {loadError && (
        <div role="alert" className="border-b border-red-900 bg-red-950/40 px-4 py-2 text-xs text-red-200">{loadError}</div>
      )}
      {compact && notice && sheet !== 'run' && (
        <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`px-3 py-1 text-xs ${notice.tone === 'error' ? 'text-red-300' : 'text-emerald-300'}`}>{notice.text}</p>
      )}

      <div className={`relative flex min-h-0 flex-1 ${compact ? 'flex-col' : 'flex-row'}`}>
        {/* 01 — library (a sheet on a phone) */}
        {(!compact || sheet === 'library') && (
          <aside aria-label="Library" data-testid={compact ? 'sheet-library' : undefined}
            className={compact ? sheetClass : 'flex shrink-0 flex-col gap-3 overflow-auto border-r border-slate-800 p-3'}
            style={compact ? sheetStyle('library') : { width: 256 }}>
            {compact && sheetHeader}
            {librarySection}
          </aside>
        )}

        {/* 02 — canvas */}
        <main className={`flex min-h-0 min-w-0 flex-1 flex-col ${compact ? 'p-1.5' : 'gap-2 p-3'}`} aria-label="Canvas">
          {!compact && (
            <div role="toolbar" aria-label="Studio tools" className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <h3 className="font-mono">02 / Canvas</h3>
              {brushSlider}
              <button type="button" aria-pressed={erasing} onClick={() => setErasing(v => !v)} className="rounded border border-slate-700 px-2 py-0.5">
                {erasing ? 'Erasing' : 'Painting'}
              </button>
              <ToolButton disabled={!canUndo} onClick={undo} label="Undo (Ctrl+Z)" short="Undo" />
              <ToolButton disabled={!canRedo} onClick={redo} label="Redo (Ctrl+Shift+Z)" short="Redo" />
              <ToolButton onClick={() => surface.zoomBy(0.8)} label="Zoom out (-)" short="−" />
              <ToolButton onClick={() => surface.zoomBy(1.25)} label="Zoom in (+)" short="+" />
              <ToolButton onClick={surface.resetView} label="Fit (0)" short="Fit" />
              <button type="button" onClick={clearMask} className="rounded border border-slate-700 px-2 py-0.5">Clear mask</button>
              {penToggles}
            </div>
          )}
          {canvasArea}
        </main>

        {/* 03 — run (a sheet on a phone) */}
        {(!compact || sheet === 'run') && (
          <section aria-label="Run" data-testid={compact ? 'sheet-run' : undefined}
            className={compact ? sheetClass : 'flex shrink-0 flex-col gap-3 overflow-auto border-l border-slate-800 p-3'}
            style={compact ? sheetStyle('run') : { width: 288 }}>
            {compact && sheetHeader}
            {runSection}
          </section>
        )}

        {compact && sheet && (
          <button type="button" aria-label="Close panel" className="absolute inset-0 bg-black/40" style={{ zIndex: 10 }} onClick={() => setSheet(null)} />
        )}
      </div>

      {compact && (
        <div role="toolbar" aria-label="Studio tools" data-testid="studio-toolbar"
          className="flex flex-col gap-1 border-t border-slate-800 bg-slate-950 px-2 pt-1"
          style={{ paddingBottom: 'max(6px, env(safe-area-inset-bottom))' }}>
          <div className="flex items-center gap-2">
            {brushSlider}
            {penToggles}
          </div>
          <div className="flex items-center justify-between gap-1">
            <ToolButton compact pressed={sheet === 'library'} onClick={() => setSheet(s => s === 'library' ? null : 'library')} label="Library" short="Library" glyph="▤" />
            <ToolButton compact pressed={erasing} onClick={() => setErasing(v => !v)} label={erasing ? 'Erasing (tap to paint)' : 'Painting (tap to erase)'} short={erasing ? 'Erase' : 'Paint'} glyph={erasing ? '⌫' : '✎'} />
            <ToolButton compact disabled={!canUndo} onClick={undo} label="Undo" short="Undo" glyph="↶" />
            <ToolButton compact disabled={!canRedo} onClick={redo} label="Redo" short="Redo" glyph="↷" />
            <ToolButton compact onClick={surface.resetView} label="Fit to screen" short="Fit" glyph="⤢" />
            <ToolButton compact disabled={!hasMask} onClick={clearMask} label="Clear mask" short="Clear" glyph="⊘" />
            <ToolButton compact pressed={sheet === 'run'} onClick={() => setSheet(s => s === 'run' ? null : 'run')} label="Run panel" short="Run" glyph="▶" accent />
          </div>
        </div>
      )}
    </div>
  )
}

function FolderButton({ label, active, onClick, compact }: { label: string; active: boolean; onClick: () => void; compact?: boolean }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} style={compact ? { minHeight: TARGET } : undefined}
      className={`flex-1 truncate rounded px-2 py-1 text-left ${active ? 'bg-slate-800 text-cyan-300' : 'text-slate-300 hover:bg-slate-900'}`}>
      {label}
    </button>
  )
}

function ToolButton({ label, short, glyph, onClick, pressed, disabled, compact, accent }: {
  label: string; short: string; glyph?: string; onClick: () => void; pressed?: boolean; disabled?: boolean; compact?: boolean; accent?: boolean
}) {
  if (!compact) {
    return (
      <button type="button" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}
        className={`rounded border border-slate-700 px-2 py-0.5 disabled:opacity-40 ${pressed ? 'text-cyan-300' : ''}`}>
        {short}
      </button>
    )
  }
  const tone = accent ? 'bg-cyan-500 text-slate-950' : pressed ? 'bg-slate-800 text-cyan-300' : 'text-slate-200'
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}
      className={`flex flex-col items-center justify-center rounded-lg leading-none disabled:opacity-30 ${tone}`}
      style={{ minWidth: TARGET, minHeight: TARGET, padding: '2px 4px' }}>
      {glyph && <span aria-hidden="true" style={{ fontSize: 18 }}>{glyph}</span>}
      <span style={{ fontSize: 10, marginTop: glyph ? 2 : 0 }}>{short}</span>
    </button>
  )
}
