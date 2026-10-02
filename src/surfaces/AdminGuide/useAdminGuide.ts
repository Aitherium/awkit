/**
 * useAdminGuide — load, validate, filter and search the awnix admin guide.
 *
 * guide.json is rendered by `.DEPLOYMENT/standalone/bootc/docs/awman.py` (schema v1).
 * The public Veil copy is a committed file; on an appliance the console serves the
 * image's own /usr/share/doc/awnix/guide.json at /guide.json. The HTML inside is
 * repo-authored, but an appliance-local file is still a file on someone else's disk,
 * so every fragment goes through `sanitizeGuideHtml` before it reaches the DOM.
 *
 * Everything except the hook itself is a pure function, so it is testable without a
 * DOM and usable from a server component.
 */

import { useEffect, useMemo, useState } from 'react'

export const GUIDE_SCHEMA_VERSION = 1

export interface GuideHeading {
  id: string
  text: string
  level: number
  /** Variants this heading's section is scoped to; empty = every variant. */
  variants: string[]
}

export interface GuideChapter {
  id: string
  title: string
  applies_to: string[]
  html: string
  headings: GuideHeading[]
}

export interface GuideManPage {
  name: string
  section: string
  summary: string
  applies_to: string[]
  status: 'live' | 'pending-cli' | string
  html: string
  verbs: string[]
}

export interface GuideJson {
  version: number
  source_sha256?: string
  public?: boolean
  variants: string[]
  chapters: GuideChapter[]
  man: GuideManPage[]
}

export type GuideValidation =
  | { ok: true; guide: GuideJson }
  | { ok: false; error: string }

/** Reject anything that is not a schema-v1 guide. An unknown version is an error state, never a blank page. */
export function validateGuide(data: unknown): GuideValidation {
  if (!data || typeof data !== 'object') return { ok: false, error: 'guide.json is not an object' }
  const g = data as Partial<GuideJson>
  if (g.version !== GUIDE_SCHEMA_VERSION) {
    return { ok: false, error: `unsupported guide.json version ${String(g.version)} (this viewer reads version ${GUIDE_SCHEMA_VERSION})` }
  }
  if (!Array.isArray(g.variants) || !Array.isArray(g.chapters) || !Array.isArray(g.man)) {
    return { ok: false, error: 'guide.json is missing variants, chapters or man' }
  }
  for (const c of g.chapters) {
    if (!c || typeof c.id !== 'string' || typeof c.html !== 'string' || !Array.isArray(c.applies_to)) {
      return { ok: false, error: 'guide.json has a malformed chapter' }
    }
  }
  for (const m of g.man) {
    if (!m || typeof m.name !== 'string' || typeof m.html !== 'string' || !Array.isArray(m.applies_to)) {
      return { ok: false, error: 'guide.json has a malformed man page' }
    }
  }
  return { ok: true, guide: g as GuideJson }
}

// ── sanitizer ──────────────────────────────────────────────────────────────────────

const ALLOWED_TAGS: Record<string, string[]> = {
  p: ['class'], h2: ['id'], h3: ['id'], section: ['data-variants'], aside: ['class'],
  pre: [], code: [], strong: [], em: [], a: ['href'], ul: [], ol: [], li: [],
  dl: [], dt: [], dd: [], br: [],
}
/** Elements whose CONTENT is dropped too, not just the tags. */
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math'])
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g
const ATTR_RE = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function safeHref(v: string): string | null {
  const t = v.trim()
  if (/^https:\/\//i.test(t) || t.startsWith('#') || (t.startsWith('/') && !t.startsWith('//'))) return t
  return null
}

/** Strip a text run of anything that could still open markup. */
function escapeText(t: string): string {
  return t.replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Allowlist sanitizer: known tags with known attributes survive, rebuilt from scratch;
 * everything else is dropped, and script-like elements lose their content as well.
 * `on*` handlers, `style`, `javascript:` URLs and unknown attributes never survive.
 */
export function sanitizeGuideHtml(input: string): string {
  let out = ''
  let pos = 0
  let dropDepth = 0
  let dropTag = ''
  TAG_RE.lastIndex = 0
  for (let m = TAG_RE.exec(input); m; m = TAG_RE.exec(input)) {
    const text = input.slice(pos, m.index)
    if (!dropDepth) out += escapeText(text)
    pos = m.index + m[0].length
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    if (dropDepth) {
      if (tag === dropTag) dropDepth += closing ? -1 : 1
      continue
    }
    if (DROP_WITH_CONTENT.has(tag)) {
      if (!closing && !/\/\s*$/.test(m[3])) { dropDepth = 1; dropTag = tag }
      continue
    }
    const allowed = ALLOWED_TAGS[tag]
    if (!allowed) continue
    if (closing) { out += `</${tag}>`; continue }
    let attrs = ''
    ATTR_RE.lastIndex = 0
    for (let a = ATTR_RE.exec(m[3]); a; a = ATTR_RE.exec(m[3])) {
      const name = a[1].toLowerCase()
      const value = a[2] ?? a[3] ?? a[4] ?? ''
      if (!allowed.includes(name)) continue
      if (name === 'href') {
        const h = safeHref(value)
        if (h === null) continue
        attrs += ` href="${escapeAttr(h)}"`
        continue
      }
      attrs += ` ${name}="${escapeAttr(value)}"`
    }
    out += `<${tag}${attrs}>`
  }
  if (!dropDepth) out += escapeText(input.slice(pos))
  return out
}

// ── variant filtering and search ───────────────────────────────────────────────────

const SCOPED_SECTION_RE = /<section data-variants="([^"]*)">([\s\S]*?)<\/section>/g

/** Drop sections scoped to other variants. `variant` 'all' keeps everything. */
export function filterHtmlForVariant(html: string, variant: string): string {
  if (variant === 'all') return html
  return html.replace(SCOPED_SECTION_RE, (whole, list: string) =>
    list.split(/\s+/).includes(variant) ? whole : '')
}

export function appliesTo(applies: string[], variant: string): boolean {
  return variant === 'all' || applies.includes(variant) || applies.includes('*')
}

export interface GuideView {
  chapters: GuideChapter[]
  man: GuideManPage[]
}

/** The chapters and pages a variant's admin should see, with foreign sections removed. */
export function viewForVariant(guide: GuideJson, variant: string): GuideView {
  const keepHeading = (h: GuideHeading) => variant === 'all' || !h.variants?.length || h.variants.includes(variant)
  return {
    chapters: guide.chapters
      .filter((c) => appliesTo(c.applies_to, variant))
      .map((c) => ({ ...c, html: filterHtmlForVariant(c.html, variant), headings: c.headings.filter(keepHeading) })),
    man: guide.man
      .filter((m) => appliesTo(m.applies_to, variant))
      .map((m) => ({ ...m, html: filterHtmlForVariant(m.html, variant) })),
  }
}

export interface GuideHit {
  /** 'chapter id' or 'man/<name>.<section>' — the same ids the surface navigates by. */
  doc: string
  anchor?: string
  label: string
}

export function manDocId(m: Pick<GuideManPage, 'name' | 'section'>): string {
  return `man/${m.name}.${m.section}`
}

export function searchGuide(view: GuideView, query: string): GuideHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: GuideHit[] = []
  for (const c of view.chapters) {
    if (c.title.toLowerCase().includes(q)) hits.push({ doc: c.id, label: c.title })
    for (const h of c.headings) {
      if (h.text.toLowerCase().includes(q)) hits.push({ doc: c.id, anchor: h.id, label: `${c.title} › ${h.text}` })
    }
  }
  for (const m of view.man) {
    const hay = `${m.name} ${m.summary} ${m.verbs.join(' ')}`.toLowerCase()
    if (hay.includes(q)) hits.push({ doc: manDocId(m), label: `${m.name}(${m.section}) — ${m.summary}` })
  }
  return hits.slice(0, 50)
}

// ── the hook ───────────────────────────────────────────────────────────────────────

export type GuideState =
  | { status: 'loading' }
  | { status: 'ready'; guide: GuideJson }
  | { status: 'error'; error: string }

export function useAdminGuide(source: string | GuideJson): GuideState {
  const inline = typeof source === 'string' ? null : source
  const initial = useMemo<GuideState>(() => {
    if (!inline) return { status: 'loading' }
    const v = validateGuide(inline)
    return v.ok ? { status: 'ready', guide: v.guide } : { status: 'error', error: v.error }
  }, [inline])
  const [state, setState] = useState<GuideState>(initial)

  useEffect(() => {
    if (typeof source !== 'string') { setState(initial); return }
    let cancelled = false
    setState({ status: 'loading' })
    fetch(source, { credentials: 'same-origin' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} loading ${source}`)
        return r.json()
      })
      .then((data) => {
        if (cancelled) return
        const v = validateGuide(data)
        setState(v.ok ? { status: 'ready', guide: v.guide } : { status: 'error', error: v.error })
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: 'error', error: e instanceof Error ? e.message : String(e) })
      })
    return () => { cancelled = true }
  }, [source, initial])

  return state
}
