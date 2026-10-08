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
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
  const [hasMask, setHasMask] = useState(false)
  const [quote, setQuote] = useState<CraftEstimate | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [newFolder, setNewFolder] = useState('')
  const [newCharacter, setNewCharacter] = useState('')

  const overlay = useRef<HTMLCanvasElement | null>(null)
  const painting = useRef(false)

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

  // ── the mask ─────────────────────────────────────────────────────────────
  const clearMask = useCallback(() => {
    const c = overlay.current
    const ctx = c?.getContext('2d')
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height)
    setHasMask(false)
  }, [])

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

  const paintAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = overlay.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const rect = c.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const x = ((e.clientX - rect.left) * c.width) / rect.width
    const y = ((e.clientY - rect.top) * c.height) / rect.height
    const r = (brush * c.width) / rect.width / 2
    ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'
    ctx.fillStyle = 'rgba(255, 70, 90, 0.55)'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    if (!erasing) setHasMask(true)
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

  const imgSrc = selectedMedia ? mediaSrc(opts, selectedMedia) : null

  return (
    <div data-testid="image-studio" className={`flex h-full min-h-0 flex-col bg-slate-950 text-slate-100 ${className}`}>
      <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-2">
        <h2 className="font-mono text-sm tracking-wide">{catalogue?.craft.name ?? 'Image Studio'}</h2>
        <span className="text-xs text-slate-500">your images, edited on the hosted studio, paid with credits</span>
        {catalogue?.buy_url && (
          <a className="ml-auto text-xs text-cyan-300 underline" href={catalogue.buy_url} target="_blank" rel="noreferrer">Buy credits</a>
        )}
      </header>

      {loadError && (
        <div role="alert" className="border-b border-red-900 bg-red-950/40 px-4 py-2 text-xs text-red-200">{loadError}</div>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* 01 — library */}
        <aside className="flex w-full flex-col gap-3 overflow-auto border-slate-800 p-3 md:w-64 md:border-r" aria-label="Library">
          <h3 className="font-mono text-xs text-slate-400">01 / Library</h3>
          <nav className="flex flex-col gap-1 text-sm" aria-label="Folders">
            <FolderButton label="Unfiled" active={folder === UNFILED} onClick={() => setFolder(UNFILED)} />
            <FolderButton label="Everything" active={folder === ''} onClick={() => setFolder('')} />
            {library.folders.map(f => (
              <div key={f.id} className="flex items-center gap-1">
                <FolderButton label={f.name} active={folder === f.id} onClick={() => setFolder(f.id)} />
                <button type="button" aria-label={`Delete folder ${f.name}`} className="text-xs text-slate-500 hover:text-red-300"
                  onClick={() => libraryAction(async () => { await deleteFolder(opts, f.id); if (folder === f.id) setFolder(UNFILED) })}>×</button>
              </div>
            ))}
          </nav>
          <form className="flex gap-1" onSubmit={e => { e.preventDefault(); const n = newFolder; setNewFolder(''); void libraryAction(() => createFolder(opts, n)) }}>
            <input aria-label="New folder name" value={newFolder} onChange={e => setNewFolder(e.target.value)} placeholder="New folder"
              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs" />
            <button type="submit" disabled={!newFolder.trim()} className="rounded border border-slate-700 px-2 text-xs disabled:opacity-40">Add</button>
          </form>

          <div className="grid grid-cols-3 gap-1" role="list" aria-label="Media">
            {shown.length === 0 && <p className="col-span-3 text-xs text-slate-500">Nothing here yet. Make a new image to start.</p>}
            {shown.map(m => {
              const src = mediaSrc(opts, m)
              return (
                <button key={m.id} type="button" role="listitem" aria-pressed={selected === m.id} title={`${m.op} #${m.id}`}
                  onClick={() => { setSelected(m.id); clearMask() }}
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
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100">
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
                <button type="button" className="text-left hover:text-cyan-300" onClick={() => { setSelected(c.media_ids[0] ?? null); clearMask() }}>
                  {c.name} <span className="text-slate-500">({c.media_ids.length} ref{c.media_ids.length === 1 ? '' : 's'})</span>
                </button>
              </li>
            ))}
          </ul>
          <form className="flex gap-1" onSubmit={e => { e.preventDefault(); if (selected == null) return; const n = newCharacter; setNewCharacter(''); void libraryAction(() => createCharacter(opts, n, [selected])) }}>
            <input aria-label="New character name" value={newCharacter} onChange={e => setNewCharacter(e.target.value)} placeholder="Character from selected"
              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs" />
            <button type="submit" disabled={!newCharacter.trim() || selected == null} className="rounded border border-slate-700 px-2 text-xs disabled:opacity-40">Add</button>
          </form>
        </aside>

        {/* 02 — canvas */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-3" aria-label="Canvas">
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <h3 className="font-mono">02 / Canvas</h3>
            <label className="flex items-center gap-1">Brush
              <input aria-label="Brush size" type="range" min={4} max={160} value={brush} onChange={e => setBrush(Number(e.target.value))} />
            </label>
            <button type="button" aria-pressed={erasing} onClick={() => setErasing(v => !v)} className="rounded border border-slate-700 px-2 py-0.5">
              {erasing ? 'Erasing' : 'Painting'}
            </button>
            <button type="button" onClick={clearMask} className="rounded border border-slate-700 px-2 py-0.5">Clear mask</button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto rounded border border-slate-800 bg-slate-900">
            {imgSrc ? (
              <div className="relative max-h-full max-w-full">
                <img src={imgSrc} alt="Image being edited" className="block max-h-[70vh] max-w-full select-none" draggable={false}
                  onLoad={e => {
                    const c = overlay.current
                    if (!c) return
                    c.width = e.currentTarget.naturalWidth
                    c.height = e.currentTarget.naturalHeight
                    setHasMask(false)
                  }} />
                <canvas ref={overlay} data-testid="mask-canvas" aria-label="Mask: paint the area to change"
                  className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
                  onPointerDown={e => { painting.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); paintAt(e) }}
                  onPointerMove={e => { if (painting.current) paintAt(e) }}
                  onPointerUp={() => { painting.current = false }}
                  onPointerLeave={() => { painting.current = false }} />
              </div>
            ) : selectedMedia ? (
              <p className="text-sm text-slate-500">This item has no preview.</p>
            ) : (
              <p className="text-sm text-slate-500">Pick an image from your library, or make a new one.</p>
            )}
          </div>
        </main>

        {/* 03 — run */}
        <section className="flex w-full flex-col gap-3 border-slate-800 p-3 md:w-72 md:border-l" aria-label="Run">
          <h3 className="font-mono text-xs text-slate-400">03 / Run</h3>
          <div className="flex flex-col gap-1" role="radiogroup" aria-label="What to do">
            {STUDIO_ACTIONS.map(a => {
              const live = catalogue ? catalogue.shell_ops[a.id] !== false : true
              return (
                <label key={a.id} className={`flex items-center gap-2 text-sm ${live ? '' : 'text-slate-500'}`}>
                  <input type="radio" name="studio-action" value={a.id} checked={action === a.id} onChange={() => setAction(a.id)} />
                  {a.label}{!live && <span className="text-[10px]">(not served yet)</span>}
                </label>
              )
            })}
          </div>
          {actionMeta.needsText && (
            <textarea aria-label={action === 'edit_instruct' ? 'Instruction' : 'Prompt'} value={text} onChange={e => setText(e.target.value)}
              placeholder={action === 'edit_instruct' ? 'Make the jacket red' : action === 'inpaint' ? 'What goes in the painted area' : 'Describe the new image'}
              className="min-h-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" />
          )}
          <p data-testid="cost-line" className="text-xs text-slate-300">
            {served ? costLine(quote, listPrice) : 'The studio engine does not serve this yet.'}
          </p>
          <button type="button" onClick={run} disabled={busy || !served}
            className="rounded bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950 disabled:bg-slate-700 disabled:text-slate-400">
            {busy ? 'Running… (heavy edits take a minute)' : 'Run'}
          </button>
          {notice && (
            <p role={notice.tone === 'error' ? 'alert' : 'status'} data-testid="run-outcome"
              className={`text-xs ${notice.tone === 'error' ? 'text-red-300' : 'text-emerald-300'}`}>{notice.text}</p>
          )}
        </section>
      </div>
    </div>
  )
}

function FolderButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={`flex-1 truncate rounded px-2 py-1 text-left ${active ? 'bg-slate-800 text-cyan-300' : 'text-slate-300 hover:bg-slate-900'}`}>
      {label}
    </button>
  )
}
