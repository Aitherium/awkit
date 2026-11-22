'use client'

/**
 * ElementGallery — the uiverse-style gallery for awkit UI elements.
 *
 * Left: categories with counts. Top: search + preview-background switch.
 * Main: a responsive grid of square-ish tiles, each rendering one element LIVE.
 * "Code" opens a side drawer with the element's exact source, a Copy button and
 * its id. `?element=<id>` is read on mount and written on open, so a tile is
 * shareable.
 *
 * The elements are original Aitherium work (src/elements/*); this file only
 * supplies the gallery FORMAT. `ELEMENTS` comes from the generated registry —
 * a plain static module, because Next.js/webpack consumes awkit source directly
 * (no import.meta.glob, no ?raw imports).
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ELEMENTS } from '../elements/registry.generated'
import type { ElementCategory, ElementEntry } from '../elements/types'

export interface ElementGalleryProps {
  /**
   * Override the generated registry. Hosts and tests use it to render a known
   * set; the default is every element on disk.
   */
  elements?: ElementEntry[]
}

const CATEGORY_ORDER: ElementCategory[] = [
  'buttons',
  'toggles',
  'loaders',
  'cards',
  'inputs',
  'checkboxes',
  'radios',
  'tooltips',
  'badges',
  'progress',
]

const CATEGORY_LABELS: Record<ElementCategory, string> = {
  buttons: 'Buttons',
  toggles: 'Toggles',
  loaders: 'Loaders',
  cards: 'Cards',
  inputs: 'Inputs',
  checkboxes: 'Checkboxes',
  radios: 'Radios',
  tooltips: 'Tooltips',
  badges: 'Badges',
  progress: 'Progress',
}

type Preview = 'dark' | 'light' | 'accent'

const PREVIEWS: { id: Preview; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'accent', label: 'Accent' },
]

type CopyState = 'idle' | 'copied' | 'failed'

/** `?element=<id>` from the current location (never during SSR). */
function readElementParam(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return new URLSearchParams(window.location.search).get('element')
  } catch {
    return null
  }
}

/** Set or clear `?element=` without pulling in the Next router. */
function writeElementParam(id: string | null, mode: 'push' | 'replace'): void {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('element', id)
    else url.searchParams.delete('element')
    const next = `${url.pathname}${url.search}${url.hash}`
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` === next) return
    if (mode === 'push') window.history.pushState({}, '', next)
    else window.history.replaceState({}, '', next)
  } catch {
    // A host with an opaque history (file://, some embeds) still works — the
    // drawer just cannot be deep-linked.
  }
}

/**
 * Copy with a fallback for browsers/hosts where the async clipboard API is
 * unavailable or denied. Returns whether the text reached the clipboard.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the textarea path
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    area.setSelectionRange(0, text.length)
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

const css = `
.awk-gallery {
  display: grid;
  grid-template-columns: 208px minmax(0, 1fr);
  min-height: 100%;
  height: 100%;
  box-sizing: border-box;
  background: var(--bg-base, #0A1628);
  color: var(--text-primary, #E8F0F8);
  font-family: var(--font-sans, system-ui, sans-serif);
}

/* ── Category rail ─────────────────────────────────────────────── */
.awk-gallery .awk-gallery-side {
  position: sticky;
  top: 0;
  align-self: start;
  max-height: 100vh;
  overflow: auto;
  box-sizing: border-box;
  padding: 1rem 0.7rem 1.5rem;
  border-right: 1px solid var(--border-subtle, oklch(0.42 0.02 250));
  background: linear-gradient(180deg, var(--bg-surface, #0A1628), var(--bg-base, #0A1628));
}

.awk-gallery .awk-gallery-side h2 {
  margin: 0 0 0.15rem;
  font-size: 1.02rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--text-primary, #E8F0F8);
}

.awk-gallery .awk-gallery-side-sub {
  margin: 0 0 0.9rem;
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-ghost, oklch(0.56 0.02 250));
}

.awk-gallery .awk-gallery-side ul {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.awk-gallery .awk-gallery-cat {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  width: 100%;
  padding: 0.42rem 0.55rem;
  box-sizing: border-box;
  font: inherit;
  font-size: 0.8rem;
  color: var(--text-secondary, oklch(0.84 0.02 250));
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius, 8px);
  cursor: pointer;
  text-align: left;
}

.awk-gallery .awk-gallery-cat:hover {
  background: var(--card-hover, rgba(232, 240, 248, 0.06));
  color: var(--text-primary, #E8F0F8);
}

.awk-gallery .awk-gallery-cat[aria-pressed="true"] {
  background: color-mix(in oklab, var(--accent-primary, #00E5FF) 12%, transparent);
  border-color: color-mix(in oklab, var(--accent-primary, #00E5FF) 38%, transparent);
  color: var(--text-primary, #E8F0F8);
  font-weight: 600;
}

.awk-gallery .awk-gallery-cat:focus-visible,
.awk-gallery .awk-gallery-code:focus-visible,
.awk-gallery .awk-gallery-top button:focus-visible,
.awk-gallery .awk-gallery-drawer button:focus-visible,
.awk-gallery .awk-gallery-empty button:focus-visible,
.awk-gallery .awk-gallery-search input:focus-visible,
.awk-gallery .awk-gallery-source:focus-visible {
  outline: 2px solid var(--border-focus, var(--accent-primary, #00E5FF));
  outline-offset: 2px;
}

.awk-gallery .awk-gallery-count {
  font-family: var(--font-mono, monospace);
  font-size: 0.66rem;
  line-height: 1;
  padding: 0.2rem 0.38rem;
  border-radius: 999px;
  background: var(--bg-elevated, #1A2A40);
  color: var(--text-muted, oklch(0.74 0.02 250));
  font-variant-numeric: tabular-nums;
}

/* ── Main column ───────────────────────────────────────────────── */
.awk-gallery .awk-gallery-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 1rem;
  box-sizing: border-box;
}

.awk-gallery .awk-gallery-top {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.8rem;
  margin-bottom: 1rem;
}

.awk-gallery .awk-gallery-search {
  flex: 1 1 260px;
  min-width: 0;
}

.awk-gallery .awk-gallery-search label {
  display: block;
  margin-bottom: 0.35rem;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted, oklch(0.74 0.02 250));
}

.awk-gallery .awk-gallery-search-box {
  position: relative;
  display: flex;
  align-items: center;
}

.awk-gallery .awk-gallery-search-box .glyph {
  position: absolute;
  left: 0.7rem;
  width: 15px;
  height: 15px;
  color: var(--text-ghost, oklch(0.56 0.02 250));
  pointer-events: none;
}

.awk-gallery .awk-gallery-search input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.55rem 2.2rem 0.55rem 2.1rem;
  font: inherit;
  font-size: 0.82rem;
  color: var(--text-primary, #E8F0F8);
  background: var(--bg-surface, #0A1628);
  border: 1px solid var(--border-default, oklch(0.62 0.02 250));
  border-radius: var(--radius, 8px);
  outline: none;
}

.awk-gallery .awk-gallery-search input::placeholder {
  color: var(--text-ghost, oklch(0.56 0.02 250));
}

.awk-gallery .awk-gallery-search input:focus {
  border-color: var(--accent-primary, #00E5FF);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent-primary, #00E5FF) 18%, transparent);
}

.awk-gallery .awk-gallery-search .clear {
  position: absolute;
  right: 0.35rem;
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  font: inherit;
  font-size: 1rem;
  line-height: 1;
  color: var(--text-muted, oklch(0.74 0.02 250));
  background: transparent;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}

.awk-gallery .awk-gallery-search .clear:hover {
  color: var(--text-primary, #E8F0F8);
  background: var(--card-hover, rgba(232, 240, 248, 0.06));
}

.awk-gallery .awk-gallery-preview-switch {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  border: 1px solid var(--border-subtle, oklch(0.42 0.02 250));
  border-radius: 999px;
  background: var(--bg-surface, #0A1628);
}

.awk-gallery .awk-gallery-preview-switch button {
  padding: 0.35rem 0.72rem;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--text-muted, oklch(0.74 0.02 250));
  background: transparent;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
}

.awk-gallery .awk-gallery-preview-switch button:hover {
  color: var(--text-primary, #E8F0F8);
}

.awk-gallery .awk-gallery-preview-switch button[aria-pressed="true"] {
  color: var(--bg-deep, #060D1A);
  background: var(--accent-primary, #00E5FF);
  font-weight: 700;
}

/* ── Tile grid ─────────────────────────────────────────────────── */
.awk-gallery .awk-gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 0.85rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.awk-gallery .awk-gallery-tile {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-surface, #0A1628);
  border: 1px solid var(--border-subtle, oklch(0.42 0.02 250));
  border-radius: var(--radius-lg, 12px);
  transition: border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease;
}

.awk-gallery .awk-gallery-tile:hover {
  border-color: color-mix(in oklab, var(--accent-primary, #00E5FF) 42%, var(--border-default, oklch(0.62 0.02 250)));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  transform: translateY(-2px);
}

.awk-gallery .awk-gallery-stage {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 1 / 1;
  min-height: 190px;
  padding: 0.85rem;
  box-sizing: border-box;
  overflow: auto;
  background:
    radial-gradient(circle at 28% 18%, color-mix(in oklab, var(--accent-primary, #00E5FF) 8%, transparent), transparent 62%),
    var(--stage-bg, var(--bg-deep, #060D1A));
}

.awk-gallery .awk-gallery-live {
  display: grid;
  place-items: center;
  width: 100%;
  min-width: 0;
}

.awk-gallery .awk-gallery-live > * {
  max-width: 100%;
}

/* Preview backgrounds. Light also flips the tokens the elements read, so an
   element designed for a dark page is still legible on the light stage. */
.awk-gallery[data-preview="light"] .awk-gallery-stage {
  --stage-bg: #eef2f7;
  --bg-deep: #eef2f7;
  --bg-base: #eef2f7;
  --bg-surface: #ffffff;
  --bg-elevated: #ffffff;
  --bg-overlay: #ffffff;
  --bg-hover: #e2e8f0;
  --text-primary: #0A1628;
  --text-secondary: #1e293b;
  --text-muted: #334155;
  --text-ghost: #64748b;
  --text-tertiary: #64748b;
  --border-subtle: #cbd5e1;
  --border-default: #94a3b8;
  --border-strong: #475569;
  --glass-border: #94a3b8;
  --accent-primary: #00788f;
  --accent-cyan: #0284c7;
  --accent-secondary: #6d28d9;
  --accent-green: #15803d;
  --accent-danger: #b91c1c;
  --accent-warm: #b45309;
  --accent-coral: #b91c1c;
  --accent-rose: #be185d;
  --accent-sky: #0369a1;
  --accent-bridge: #4338ca;
  /* --border-focus and --card-hover are defined on :root with var() aliases;
     a custom property inherits its COMPUTED value, so redefining
     --accent-primary here does not reach them. Override them explicitly or the
     focus ring stays neon cyan on the light stage (~1.35:1). */
  --border-focus: #00788f;
  --card-hover: #e2e8f0;
}

.awk-gallery[data-preview="accent"] .awk-gallery-stage {
  --stage-bg: transparent;
  background:
    radial-gradient(circle at 78% 22%, rgba(0, 229, 255, 0.28), transparent 55%),
    linear-gradient(135deg, #0b1224 0%, #3b1d8f 52%, #0e7490 100%);
}

.awk-gallery .awk-gallery-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.6rem 0.7rem;
  border-top: 1px solid var(--border-subtle, oklch(0.42 0.02 250));
  background: var(--bg-surface, #0A1628);
}

.awk-gallery .awk-gallery-meta-text {
  min-width: 0;
}

.awk-gallery .awk-gallery-meta h3 {
  margin: 0 0 0.12rem;
  font-size: 0.8rem;
  font-weight: 600;
  line-height: 1.25;
  color: var(--text-primary, #E8F0F8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.awk-gallery .awk-gallery-meta code {
  display: block;
  font-family: var(--font-mono, monospace);
  font-size: 0.63rem;
  color: var(--text-ghost, oklch(0.56 0.02 250));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.awk-gallery .awk-gallery-code {
  flex: none;
  padding: 0.36rem 0.68rem;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--accent-primary, #00E5FF);
  background: color-mix(in oklab, var(--accent-primary, #00E5FF) 10%, transparent);
  border: 1px solid color-mix(in oklab, var(--accent-primary, #00E5FF) 35%, transparent);
  border-radius: var(--radius, 8px);
  cursor: pointer;
}

.awk-gallery .awk-gallery-code:hover {
  background: color-mix(in oklab, var(--accent-primary, #00E5FF) 18%, transparent);
}

/* ── Empty state ───────────────────────────────────────────────── */
.awk-gallery .awk-gallery-empty {
  display: grid;
  place-items: center;
  gap: 0.8rem;
  min-height: 240px;
  padding: 2rem;
  text-align: center;
  color: var(--text-muted, oklch(0.74 0.02 250));
  border: 1px dashed var(--border-default, oklch(0.62 0.02 250));
  border-radius: var(--radius-lg, 12px);
}

.awk-gallery .awk-gallery-empty p {
  margin: 0;
  font-size: 0.86rem;
}

.awk-gallery .awk-gallery-empty button {
  padding: 0.45rem 0.9rem;
  font: inherit;
  font-size: 0.78rem;
  color: var(--text-primary, #E8F0F8);
  background: var(--bg-elevated, #1A2A40);
  border: 1px solid var(--border-default, oklch(0.62 0.02 250));
  border-radius: var(--radius, 8px);
  cursor: pointer;
}

/* ── Code drawer ───────────────────────────────────────────────── */
.awk-gallery .awk-gallery-drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
  background: rgba(2, 8, 18, 0.62);
  backdrop-filter: blur(2px);
}

.awk-gallery .awk-gallery-drawer {
  display: flex;
  flex-direction: column;
  width: min(620px, 92vw);
  height: 100%;
  box-sizing: border-box;
  background: var(--bg-base, #0A1628);
  border-left: 1px solid var(--border-default, oklch(0.62 0.02 250));
  box-shadow: var(--shadow-window, 0 16px 48px rgba(0, 0, 0, 0.55));
  animation: awk-gallery-slide-in 180ms ease-out;
}

.awk-gallery .awk-gallery-drawer header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1rem 0.7rem;
}

.awk-gallery .awk-gallery-drawer h2 {
  margin: 0 0 0.2rem;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary, #E8F0F8);
}

.awk-gallery .awk-gallery-drawer header code {
  font-family: var(--font-mono, monospace);
  font-size: 0.7rem;
  color: var(--text-muted, oklch(0.74 0.02 250));
}

.awk-gallery .awk-gallery-close {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.9rem;
  height: 1.9rem;
  padding: 0;
  font: inherit;
  font-size: 1.1rem;
  line-height: 1;
  color: var(--text-muted, oklch(0.74 0.02 250));
  background: var(--bg-elevated, #1A2A40);
  border: 1px solid var(--border-subtle, oklch(0.42 0.02 250));
  border-radius: 50%;
  cursor: pointer;
}

.awk-gallery .awk-gallery-close:hover {
  color: var(--text-primary, #E8F0F8);
  border-color: var(--border-strong, oklch(0.74 0.02 250));
}

.awk-gallery .awk-gallery-drawer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 0 1rem 0.6rem;
  font-size: 0.68rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-ghost, oklch(0.56 0.02 250));
}

.awk-gallery .awk-gallery-drawer-bar button {
  padding: 0.4rem 0.85rem;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-transform: none;
  color: var(--bg-deep, #060D1A);
  background: var(--accent-primary, #00E5FF);
  border: 1px solid var(--accent-primary, #00E5FF);
  border-radius: var(--radius, 8px);
  cursor: pointer;
}

.awk-gallery .awk-gallery-drawer-bar button:hover {
  filter: brightness(1.08);
}

.awk-gallery .awk-gallery-source {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0 1rem;
  padding: 0.85rem;
  overflow: auto;
  box-sizing: border-box;
  font-family: var(--font-mono, monospace);
  font-size: 0.72rem;
  line-height: 1.55;
  color: var(--text-secondary, oklch(0.84 0.02 250));
  background: var(--bg-deep, #060D1A);
  border: 1px solid var(--border-subtle, oklch(0.42 0.02 250));
  border-radius: var(--radius, 8px);
  tab-size: 2;
  white-space: pre;
}

.awk-gallery .awk-gallery-source code {
  font: inherit;
  color: inherit;
}

.awk-gallery .awk-gallery-status {
  margin: 0;
  padding: 0.45rem 1rem 0.7rem;
  min-height: 1.9rem;
  box-sizing: border-box;
  font-size: 0.72rem;
  color: var(--accent-green, #4ade80);
}

@keyframes awk-gallery-slide-in {
  from { transform: translateX(24px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .awk-gallery .awk-gallery-tile,
  .awk-gallery .awk-gallery-cat {
    transition: none;
  }
  .awk-gallery .awk-gallery-tile:hover {
    transform: none;
  }
  .awk-gallery .awk-gallery-drawer {
    animation: none;
  }
}

@media (max-width: 760px) {
  .awk-gallery {
    grid-template-columns: 1fr;
  }
  .awk-gallery .awk-gallery-side {
    position: static;
    max-height: none;
    border-right: 0;
    border-bottom: 1px solid var(--border-subtle, oklch(0.42 0.02 250));
    padding-bottom: 0.8rem;
  }
  .awk-gallery .awk-gallery-side ul {
    flex-direction: row;
    flex-wrap: wrap;
  }
  .awk-gallery .awk-gallery-cat {
    width: auto;
    gap: 0.35rem;
  }
  .awk-gallery .awk-gallery-grid {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  }
}
`

export default function ElementGallery({ elements = ELEMENTS }: ElementGalleryProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ElementCategory | 'all'>('all')
  const [preview, setPreview] = useState<Preview>('dark')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const searchId = useId()
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const counts = useMemo(() => {
    const map = new Map<ElementCategory, number>()
    for (const el of elements) map.set(el.category, (map.get(el.category) ?? 0) + 1)
    return map
  }, [elements])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return elements.filter((el) => {
      if (category !== 'all' && el.category !== category) return false
      if (!q) return true
      return `${el.title} ${el.id} ${el.tags.join(' ')}`.toLowerCase().includes(q)
    })
  }, [elements, category, query])

  const selected = useMemo(
    () => (selectedId ? elements.find((el) => el.id === selectedId) ?? null : null),
    [elements, selectedId],
  )

  // Deep link + back/forward. Runs after mount, never during SSR.
  useEffect(() => {
    const sync = () => {
      const id = readElementParam()
      setSelectedId(id && elements.some((el) => el.id === id) ? id : null)
    }
    sync()
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [elements])

  // Reset transient copy feedback whenever the open element changes.
  useEffect(() => {
    setCopyState('idle')
  }, [selectedId])

  const closeCode = useCallback(() => {
    setSelectedId(null)
    writeElementParam(null, 'replace')
  }, [])

  const openCode = useCallback((entry: ElementEntry) => {
    returnFocusRef.current = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
    setSelectedId(entry.id)
    writeElementParam(entry.id, 'push')
  }, [])

  // Escape closes; focus moves into the dialog on open and back to the tile on close.
  useEffect(() => {
    if (!selectedId) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeCode()
        return
      }
      if (event.key !== 'Tab') return
      // Keep Tab inside the dialog while it is open.
      const drawer = closeRef.current?.closest('[role="dialog"]')
      if (!(drawer instanceof HTMLElement)) return
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled'))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !drawer.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !drawer.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const frame = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(() => closeRef.current?.focus())
      : (closeRef.current?.focus(), 0)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame as number)
      const previous = returnFocusRef.current
      returnFocusRef.current = null
      if (previous && typeof previous.focus === 'function') previous.focus()
    }
  }, [selectedId, closeCode])

  const onCopy = useCallback(async () => {
    if (!selected) return
    const ok = await copyToClipboard(selected.code)
    setCopyState(ok ? 'copied' : 'failed')
  }, [selected])

  return (
    <div className="awk-gallery" data-preview={preview} data-testid="awk-gallery">
      <style>{css}</style>

      <nav className="awk-gallery-side" aria-label="Element categories">
        <h2>Elements</h2>
        <p className="awk-gallery-side-sub">
          {elements.length} copy-ready {elements.length === 1 ? 'element' : 'elements'}
        </p>
        <ul>
          <li>
            <button
              type="button"
              className="awk-gallery-cat"
              aria-pressed={category === 'all'}
              data-testid="awk-gallery-cat-all"
              onClick={() => setCategory('all')}
            >
              <span>All</span>
              <span className="awk-gallery-count">{elements.length}</span>
            </button>
          </li>
          {CATEGORY_ORDER.map((cat) => (
            <li key={cat}>
              <button
                type="button"
                className="awk-gallery-cat"
                aria-pressed={category === cat}
                data-testid={`awk-gallery-cat-${cat}`}
                onClick={() => setCategory(cat)}
              >
                <span>{CATEGORY_LABELS[cat]}</span>
                <span className="awk-gallery-count">{counts.get(cat) ?? 0}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main className="awk-gallery-main">
        <header className="awk-gallery-top">
          <div className="awk-gallery-search">
            <label htmlFor={searchId}>Search elements</label>
            <div className="awk-gallery-search-box">
              <svg className="glyph" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
                <path d="m13.4 13.4 3.2 3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <input
                id={searchId}
                type="search"
                value={query}
                placeholder="Search title, tag or id"
                data-testid="awk-gallery-search"
                onChange={(event) => setQuery(event.target.value)}
              />
              {query !== '' && (
                <button
                  type="button"
                  className="clear"
                  aria-label="Clear search"
                  onClick={() => setQuery('')}
                >
                  ×
                </button>
              )}
            </div>
          </div>

          <div className="awk-gallery-preview-switch" role="group" aria-label="Preview background">
            {PREVIEWS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={preview === p.id}
                data-testid={`awk-gallery-preview-${p.id}`}
                onClick={() => setPreview(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </header>

        {filtered.length === 0 ? (
          <div className="awk-gallery-empty" data-testid="awk-gallery-empty">
            <p>
              {query.trim()
                ? `No elements match “${query.trim()}”.`
                : 'No elements in this category yet.'}
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setCategory('all')
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <ul className="awk-gallery-grid" data-testid="awk-gallery-grid">
            {filtered.map((entry) => {
              const Live = entry.Component
              return (
                <li key={entry.id}>
                  <article className="awk-gallery-tile" data-testid="awk-gallery-tile">
                    <div className="awk-gallery-stage">
                      <div className="awk-gallery-live">
                        <Live />
                      </div>
                    </div>
                    <div className="awk-gallery-meta">
                      <div className="awk-gallery-meta-text">
                        <h3>{entry.title}</h3>
                        <code>{entry.id}</code>
                      </div>
                      <button
                        type="button"
                        className="awk-gallery-code"
                        aria-haspopup="dialog"
                        data-testid={`awk-gallery-code-${entry.id}`}
                        onClick={() => openCode(entry)}
                      >
                        Code
                      </button>
                    </div>
                  </article>
                </li>
              )
            })}
          </ul>
        )}
      </main>

      {selected && (
        <div
          className="awk-gallery-drawer-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCode()
          }}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="awk-gallery-drawer-title"
            className="awk-gallery-drawer"
            data-testid="awk-gallery-drawer"
          >
            <header>
              <div>
                <h2 id="awk-gallery-drawer-title">{selected.title}</h2>
                <code>{selected.id}</code>
              </div>
              <button
                ref={closeRef}
                type="button"
                className="awk-gallery-close"
                aria-label="Close code panel"
                data-testid="awk-gallery-close"
                onClick={closeCode}
              >
                ×
              </button>
            </header>
            <div className="awk-gallery-drawer-bar">
              <span>{selected.category}</span>
              <button type="button" data-testid="awk-gallery-copy" onClick={onCopy}>
                {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
              </button>
            </div>
            <pre className="awk-gallery-source" data-testid="awk-gallery-source" tabIndex={0}><code>{selected.code}</code></pre>
            <p className="awk-gallery-status" role="status" aria-live="polite">
              {copyState === 'copied'
                ? 'Source copied to clipboard.'
                : copyState === 'failed'
                  ? 'Could not copy. Select the code and press Ctrl+C.'
                  : ''}
            </p>
          </aside>
        </div>
      )}
    </div>
  )
}
