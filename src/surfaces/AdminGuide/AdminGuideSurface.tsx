'use client'

/**
 * AdminGuideSurface — the awnix admin guide and man pages, from guide.json.
 *
 * One component, three homes: the appliance console's #/guide tab (source
 * '/guide.json', variant from /api/session), the public Veil route /docs/awnix
 * (the committed --public render) and, later, a tenant portal's /admin/guide.
 * No next/* imports, so it is safe in the Vite-built console.
 *
 * Navigation ids are the chapter id ('06-updates-rollback-channels') or
 * 'man/<name>.<section>'. With `onNavigate` the host owns routing (Veil maps them
 * to its slug); with a `basePath` starting with '#' the surface keeps the hash
 * (`#/guide/<id>`) itself; otherwise it navigates in memory.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  manDocId, sanitizeGuideHtml, searchGuide, useAdminGuide, viewForVariant,
  type GuideJson,
} from './useAdminGuide'

export interface AdminGuideSurfaceProps {
  /** A URL to fetch guide.json from, or the parsed guide itself. */
  source: string | GuideJson
  /** The variant this box runs; the picker starts here. 'all' shows everything. */
  variant?: string
  /** '#/guide' keeps navigation in the hash; any other value is a prefix for links. */
  basePath?: string
  /** The document to open first ('01-install', 'man/awnix.8'). */
  docId?: string
  /** Host-owned routing. Called with the doc id and optional anchor. */
  onNavigate?: (docId: string, anchor?: string) => void
  /** Hide the variant picker, e.g. on an appliance that is exactly one variant. */
  lockVariant?: boolean
}

const S = {
  shell: {
    display: 'flex', flexWrap: 'wrap', gap: 16, color: 'var(--text-primary, var(--fg))',
    background: 'var(--bg-base)', fontFamily: 'var(--font-sans, system-ui, sans-serif)', minHeight: 0,
  } as CSSProperties,
  nav: {
    flex: '1 1 220px', maxWidth: '100%', borderRight: '1px solid var(--border-subtle, var(--border))',
    padding: 12, background: 'var(--sidebar-bg, var(--bg-surface))', boxSizing: 'border-box',
  } as CSSProperties,
  main: { flex: '999 1 320px', minWidth: 0, padding: '12px 16px', boxSizing: 'border-box' } as CSSProperties,
  label: { fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', margin: '12px 0 4px' } as CSSProperties,
  input: {
    width: '100%', boxSizing: 'border-box', padding: '6px 8px', background: 'var(--bg-elevated)',
    color: 'inherit', border: '1px solid var(--border-default, var(--border))', borderRadius: 'var(--radius, 6px)',
  } as CSSProperties,
  link: (active: boolean): CSSProperties => ({
    display: 'block', width: '100%', textAlign: 'left', padding: '4px 8px', border: 0, cursor: 'pointer',
    borderRadius: 'var(--radius, 6px)', color: 'inherit', font: 'inherit',
    background: active ? 'var(--sidebar-row-active-bg, var(--bg-active))' : 'transparent',
  }),
  error: {
    padding: 16, border: '1px solid var(--accent-danger, #c33)', borderRadius: 'var(--radius, 6px)',
    color: 'var(--text-danger, var(--text-primary))', background: 'var(--bg-surface)',
  } as CSSProperties,
}

const CONTENT_CSS = `
.awkit-admin-guide pre{background:var(--bg-elevated);padding:10px 12px;overflow-x:auto;border-radius:var(--radius,6px);position:relative}
.awkit-admin-guide code{font-family:var(--font-mono,ui-monospace,monospace);font-size:.92em}
.awkit-admin-guide dt{font-weight:600;margin-top:8px}
.awkit-admin-guide dd{margin:2px 0 6px 16px;color:var(--text-secondary,var(--text-primary))}
.awkit-admin-guide .awman-note,.awkit-admin-guide .awman-pending{border-left:3px solid var(--accent-warn,#c77d00);padding:4px 12px;background:var(--bg-surface)}
.awkit-admin-guide a{color:var(--accent-primary,var(--accent))}
.awkit-admin-guide .awkit-guide-man{font-family:var(--font-mono,ui-monospace,monospace);font-size:.95em}
.awkit-admin-guide .awkit-copy{position:absolute;top:6px;right:6px;font-size:12px;padding:2px 8px;cursor:pointer;background:var(--bg-overlay);color:inherit;border:1px solid var(--border-default,var(--border));border-radius:var(--radius,6px)}
`

function readHash(basePath?: string): { doc?: string; anchor?: string } {
  if (!basePath?.startsWith('#') || typeof window === 'undefined') return {}
  const h = window.location.hash
  if (!h.startsWith(basePath + '/')) return {}
  const rest = decodeURIComponent(h.slice(basePath.length + 1))
  const [doc, anchor] = rest.split('#')
  return { doc: doc || undefined, anchor: anchor || undefined }
}

export default function AdminGuideSurface({
  source, variant = 'all', basePath, docId, onNavigate, lockVariant = false,
}: AdminGuideSurfaceProps) {
  const state = useAdminGuide(source)
  const [picked, setPicked] = useState(variant)
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState<{ doc?: string; anchor?: string }>(
    () => (docId ? { doc: docId } : readHash(basePath)))
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => setPicked(variant), [variant])
  useEffect(() => { if (docId) setCurrent({ doc: docId }) }, [docId])
  useEffect(() => {
    if (!basePath?.startsWith('#') || onNavigate) return
    const on = () => setCurrent(readHash(basePath))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [basePath, onNavigate])

  const guide = state.status === 'ready' ? state.guide : null
  const view = useMemo(() => (guide ? viewForVariant(guide, picked) : null), [guide, picked])
  const hits = useMemo(() => (view ? searchGuide(view, query) : []), [view, query])

  const doc = useMemo(() => {
    if (!view) return null
    const id = current.doc
    const man = id?.startsWith('man/') ? view.man.find((m) => manDocId(m) === id) : undefined
    if (man) return { id: manDocId(man), title: `${man.name}(${man.section})`, html: man.html, isMan: true }
    const ch = view.chapters.find((c) => c.id === id) ?? view.chapters[0]
    if (ch) return { id: ch.id, title: ch.title, html: ch.html, isMan: false }
    const m0 = view.man[0]
    return m0 ? { id: manDocId(m0), title: `${m0.name}(${m0.section})`, html: m0.html, isMan: true } : null
  }, [view, current.doc])

  const safeHtml = useMemo(() => (doc ? sanitizeGuideHtml(doc.html) : ''), [doc])

  const go = useCallback((id: string, anchor?: string) => {
    setQuery('')
    if (onNavigate) onNavigate(id, anchor)
    else if (basePath?.startsWith('#') && typeof window !== 'undefined') {
      window.location.hash = `${basePath}/${id}${anchor ? '#' + anchor : ''}`
    }
    setCurrent({ doc: id, anchor })
  }, [basePath, onNavigate])

  // Copy buttons on code blocks, and scroll to the requested anchor.
  useEffect(() => {
    const root = bodyRef.current
    if (!root) return
    root.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector('.awkit-copy')) return
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'awkit-copy'
      b.textContent = 'Copy'
      b.addEventListener('click', () => {
        const text = pre.querySelector('code')?.textContent ?? ''
        void navigator.clipboard?.writeText(text).then(() => { b.textContent = 'Copied' }, () => { b.textContent = 'Copy failed' })
      })
      pre.appendChild(b)
    })
    if (current.anchor) root.querySelector(`#${CSS.escape(current.anchor)}`)?.scrollIntoView()
  }, [safeHtml, current.anchor])

  if (state.status === 'loading') return <div style={S.main} role="status">Loading the admin guide…</div>
  if (state.status === 'error') {
    return (
      <div style={S.error} role="alert">
        <strong>The admin guide could not be shown.</strong>
        <div>{state.error}</div>
        <div>On the box, the same pages are available offline: <code>man awnix</code>.</div>
      </div>
    )
  }
  if (!guide || !view) return null
  const variants = guide.variants

  return (
    <div className="awkit-admin-guide" style={S.shell}>
      <style>{CONTENT_CSS}</style>
      <nav style={S.nav} aria-label="Admin guide">
        <input
          style={S.input} type="search" placeholder="Search the guide" aria-label="Search the guide"
          value={query} onChange={(e) => setQuery(e.target.value)}
        />
        {!lockVariant && variants.length > 1 && (
          <>
            <div style={S.label}>Variant</div>
            <select style={S.input} aria-label="Variant" value={picked} onChange={(e) => setPicked(e.target.value)}>
              <option value="all">All variants</option>
              {variants.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </>
        )}
        {query.trim() ? (
          <>
            <div style={S.label}>{hits.length} result{hits.length === 1 ? '' : 's'}</div>
            {hits.map((h) => (
              <button key={`${h.doc}#${h.anchor ?? ''}`} type="button" style={S.link(false)} onClick={() => go(h.doc, h.anchor)}>
                {h.label}
              </button>
            ))}
          </>
        ) : (
          <>
            <div style={S.label}>Guide</div>
            {view.chapters.map((c) => (
              <button key={c.id} type="button" style={S.link(doc?.id === c.id)} onClick={() => go(c.id)}>{c.title}</button>
            ))}
            <div style={S.label}>Manual pages</div>
            {view.man.map((m) => (
              <button key={manDocId(m)} type="button" style={S.link(doc?.id === manDocId(m))} onClick={() => go(manDocId(m))}
                title={m.summary}>
                {m.name}({m.section}){m.status === 'pending-cli' ? ' · soon' : ''}
              </button>
            ))}
          </>
        )}
      </nav>
      <main style={S.main}>
        {doc ? (
          <article>
            <h1 style={{ marginTop: 0 }}>{doc.title}</h1>
            <div
              ref={bodyRef}
              className={doc.isMan ? 'awkit-guide-man' : undefined}
              // Sanitized by an allowlist above; the source is awman output, never user input.
              dangerouslySetInnerHTML={{ __html: safeHtml }}
            />
          </article>
        ) : (
          <p>No pages apply to this variant.</p>
        )}
      </main>
    </div>
  )
}
