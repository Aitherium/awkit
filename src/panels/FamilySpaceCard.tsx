/**
 * FamilySpaceCard: a child's family-only Aither Space (Aither Learn).
 *
 * Two modes over the host app's tutor proxy (apiBase):
 * - guardian: "Make Space" for one learner (POST /family/learners/{lid}/space),
 *   then shows the Space the way the child sees it.
 * - kid: a "My Space" button on the home screen (GET /me/space). Opens to the
 *   child's first name, their sprite, "Things I learned" and favourite colours
 *   and animals picked from fixed lists (POST /me/space/favorites), plus "My
 *   page": HTML + CSS the child writes (POST /me/space/page). The server rebuilds
 *   it from an allowlist; this card only ever frames SERVER output (the preview
 *   too, via /me/space/page/preview) in <iframe sandbox=""> under PAGE_CSP.
 *   There is no publish or share control anywhere: the Space stays in the
 *   family (the server locks it; this card never offers otherwise).
 * - guardian: also sees every version of My page and can bring one back or
 *   clear it (POST /family/learners/{lid}/space/page/restore).
 *
 * Kid rules: warm and short, no scores, no timers, no streaks, no red. Only
 * named, expected fields are rendered; ids and labels come from the server's
 * fixed lists.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { C, FONT_MONO, FONT_UI } from './learnTheme'

export interface FamilySpaceCardProps {
  apiBase: string
  extraHeaders?: Record<string, string>
  mode: 'guardian' | 'kid'
  /** guardian mode: the learner to make the Space for. */
  lid?: string
  /** guardian mode: the child's name for the heading. */
  name?: string
  onClose?: () => void
}

interface Pick { id: string; label: string; hex?: string; emoji?: string }
interface PageRev { html?: string; css?: string; rev?: number; at?: string; by?: string }
interface SpaceView {
  display_name?: string
  avatar?: { kind?: string; stage?: string | null; knowledge_count?: number } | null
  learned?: string[]
  favorites?: { colors?: Pick[]; animals?: Pick[] }
  page?: PageRev | null
  /** guardian view only: every kept version, newest first. */
  page_history?: PageRev[]
}
interface Choices { colors?: Pick[]; animals?: Pick[]; max?: number }

/** Same policy as lib/tutor/family_space.py PAGE_CSP: nothing loads from anywhere. */
export const PAGE_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; " +
  "form-action 'none'; base-uri 'none'; frame-src 'none'; connect-src 'none'"

/** The frame document. The server already rebuilt html/css from an allowlist;
 *  the sandbox (no scripts, forms, popups, same-origin) and the CSP are the
 *  second and third walls. A '<' never reaches the style element. */
export function pageDocument(page: PageRev | null | undefined): string {
  const css = String(page?.css ?? '').replace(/</g, '')
  return '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">`
    + '<meta name="referrer" content="no-referrer">'
    + '<style>body{margin:0;padding:12px;font-family:system-ui,sans-serif;word-wrap:break-word}img{max-width:100%}</style>'
    + `<style>${css}</style></head><body>${String(page?.html ?? '')}</body></html>`
}

export function PageFrame({ page, height = 320, title = 'My page' }: { page: PageRev | null | undefined; height?: number; title?: string }) {
  return (
    <iframe
      data-testid="space-page-frame"
      title={title}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={pageDocument(page)}
      style={{ width: '100%', height, border: `1px solid ${C.hairline}`, borderRadius: 16, background: C.pagePaper }}
    />
  )
}

/** Starters a 6-year-old can tap instead of typing tags. */
const STARTERS: { label: string; html: string }[] = [
  { label: 'Big title', html: '<h1>My Page</h1>\n' },
  { label: 'Rainbow words', html: '<p><span style="color: red">Hello</span> <span style="color: orange">from</span> <span style="color: green">my</span> <span style="color: blue">page</span>!</p>\n' },
  { label: 'My list', html: '<ul>\n  <li>I like</li>\n  <li>I like</li>\n</ul>\n' },
  { label: 'Box', html: '<div style="border: 4px dashed purple; padding: 12px; border-radius: 12px">Inside my box</div>\n' },
]

const S: Record<string, CSSProperties> = {
  card: {
    border: `1px solid ${C.hairline}`, borderRadius: 20, padding: 18, background: C.surface, color: C.ink,
    display: 'flex', flexDirection: 'column', gap: 14, fontFamily: FONT_UI, textAlign: 'left',
  },
  btn: {
    minHeight: 44, padding: '0 14px', borderRadius: 999, border: `1px solid ${C.hairline}`, background: 'transparent',
    color: C.dim, cursor: 'pointer', fontFamily: FONT_UI, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6,
  },
  primary: {
    minHeight: 44, padding: '0 18px', borderRadius: 999, border: 'none', background: C.accent, color: C.onAccent,
    cursor: 'pointer', fontFamily: FONT_UI, fontSize: 19, fontWeight: 700, // 19px bold: large text, so the light accent passes 3:1
  },
  big: {
    minHeight: 64, minWidth: 64, padding: '8px 16px', borderRadius: 20, border: `1px solid ${C.hairlineStrong}`,
    background: C.raise, color: C.ink, cursor: 'pointer', fontSize: 20, fontFamily: FONT_UI,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  chip: {
    minHeight: 36, padding: '4px 12px', borderRadius: 999, border: `1px solid ${C.hairline}`, color: C.ink,
    display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'inherit',
  },
  muted: { color: C.dim, fontSize: 'inherit' },
  label: { fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '.18em', textTransform: 'lowercase', color: C.faint },
  chips: { display: 'flex', gap: 8, flexWrap: 'wrap' },
}

function SpaceBody({ space }: { space: SpaceView }) {
  const learned = Array.isArray(space.learned) ? space.learned : []
  const colors = space.favorites?.colors ?? []
  const animals = space.favorites?.animals ?? []
  return (
    <>
      <div style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em' }}>Hi, I&apos;m {space.display_name || 'me'}!</div>
      {space.avatar?.stage && (
        <div data-testid="space-sprite">My sprite is a {space.avatar.stage}.</div>
      )}
      <section>
        <div style={S.label}>things i learned</div>
        {learned.length === 0
          ? <div style={S.muted}>New things will show up here as you learn them.</div>
          : <ul data-testid="space-learned" style={{ margin: '6px 0', paddingLeft: 20, maxHeight: 220, overflowY: 'auto' }}>
              {learned.map((t, i) => <li key={`${t}-${i}`}>{t}</li>)}
            </ul>}
      </section>
      {(colors.length > 0 || animals.length > 0) && (
        <section data-testid="space-favorites">
          <div style={S.label}>my favorites</div>
          <div style={S.chips}>
            {colors.map((c) => (
              <span key={c.id} style={{ ...S.chip, borderColor: c.hex }}>
                <span aria-hidden style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 6, background: c.hex, marginRight: 6 }} />
                {c.label}
              </span>
            ))}
            {animals.map((a) => (
              <span key={a.id} style={S.chip}>
                <span aria-hidden>{a.emoji}</span> {a.label}
              </span>
            ))}
          </div>
        </section>
      )}
      {space.page && (
        <section data-testid="space-page">
          <div style={S.label}>my page</div>
          <PageFrame page={space.page} />
        </section>
      )}
      <div style={S.muted}>Only your family can see this page.</div>
    </>
  )
}

export default function FamilySpaceCard({ apiBase, extraHeaders = {}, mode, lid, name, onClose }: FamilySpaceCardProps) {
  const headersRef = useRef(extraHeaders)
  headersRef.current = extraHeaders
  const [space, setSpace] = useState<SpaceView | null>(null)
  const [choices, setChoices] = useState<Choices | null>(null)
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState<{ colors: string[]; animals: string[] } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ html: string; css: string } | null>(null)
  // What the server says the edit will look like (sanitized). The raw text in
  // the boxes is never put in a frame: a link in it could lead the frame away.
  const [preview, setPreview] = useState<PageRev | null>(null)

  const call = useCallback(async (path: string, method = 'GET', body?: object) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headersRef.current } }
    if (body) init.body = JSON.stringify(body)
    const r = await fetch(`${apiBase}${path}`, init)
    const data = await r.json().catch(() => null)
    return { status: r.status, ok: r.ok, data }
  }, [apiBase])

  const take = (data: unknown) => {
    const d = (data || {}) as { space?: SpaceView; choices?: Choices }
    if (d.space) setSpace(d.space)
    if (d.choices) setChoices(d.choices)
  }

  // kid: find out whether a Space exists (no Space = render nothing at all).
  useEffect(() => {
    if (mode !== 'kid') return
    let live = true
    call('/me/space').then((r) => { if (live && r.ok) take(r.data) }).catch(() => {})
    return () => { live = false }
  }, [mode, call])

  const make = async () => {
    if (!lid) return
    setBusy(true); setNote(null)
    const r = await call(`/family/learners/${encodeURIComponent(lid)}/space`, 'POST', {}).catch(() => null)
    setBusy(false)
    if (r?.ok) { take(r.data); setNote((r.data as { created?: boolean })?.created ? 'Space made. Only your family can see it.' : 'Space refreshed.') }
    else if (r?.status === 409) setNote('This child needs their own account first (Add a child).')
    else setNote('Could not make the Space. Try again in a moment.')
  }

  // guardian: the console's "Make Space" button mounts this card, which makes
  // (or refreshes) the Space once. The route is idempotent.
  const made = useRef(false)
  useEffect(() => {
    if (mode !== 'guardian' || made.current) return
    made.current = true
    make()
  }, [mode, lid])

  const save = async () => {
    if (!picking) return
    setBusy(true)
    const r = await call('/me/space/favorites', 'POST', picking).catch(() => null)
    setBusy(false)
    if (r?.ok) { take(r.data); setPicking(null) }
    else setNote('Let’s try that again in a moment.')
  }

  const showPreview = async () => {
    if (!editing) return
    setNote(null)
    const r = await call('/me/space/page/preview', 'POST', editing).catch(() => null)
    if (r?.ok) setPreview(((r.data || {}) as { page?: PageRev }).page ?? null)
    else if (r?.status === 422) {
      const d = (r.data || {}) as { detail?: unknown }
      setNote(typeof d.detail === 'string' ? d.detail : 'Some of that can’t go on your page. Try something else.')
    } else setNote('Let’s try that again in a moment.')
  }

  const savePage = async () => {
    if (!editing) return
    setBusy(true); setNote(null)
    const r = await call('/me/space/page', 'POST', editing).catch(() => null)
    setBusy(false)
    if (r?.ok) { take(r.data); setEditing(null); setPreview(null); setNote('Saved! Only your family can see it.') }
    else if (r?.status === 422) {
      const d = (r.data || {}) as { detail?: unknown }
      setNote(typeof d.detail === 'string' ? d.detail : 'Some of that can’t go on your page. Try something else.')
    } else setNote('Let’s try that again in a moment.')
  }

  // guardian: bring an older version back, or clear the page.
  const restore = async (body: { rev: number } | { clear: true }) => {
    if (!lid) return
    setBusy(true); setNote(null)
    const r = await call(`/family/learners/${encodeURIComponent(lid)}/space/page/restore`, 'POST', body).catch(() => null)
    setBusy(false)
    if (r?.ok) { take(r.data); setNote('rev' in body ? `Version ${body.rev} is back.` : 'Page cleared.') }
    else setNote('Could not change the page. Try again in a moment.')
  }

  const toggle = (kind: 'colors' | 'animals', id: string) => {
    if (!picking) return
    const max = choices?.max ?? 3
    const have = picking[kind]
    const next = have.includes(id) ? have.filter((x) => x !== id) : (have.length < max ? [...have, id] : have)
    setPicking({ ...picking, [kind]: next })
  }

  if (mode === 'kid') {
    if (!space) return null
    if (!open) {
      return (
        <button type="button" className="al-tile al-focus" style={{ ...S.big, alignSelf: 'center', minWidth: 200 }} onClick={() => setOpen(true)}>
          <span aria-hidden>🏠</span> My Space
        </button>
      )
    }
    if (editing) {
      const area: CSSProperties = {
        width: '100%', boxSizing: 'border-box', minHeight: 140, borderRadius: 16, padding: 12,
        border: `1px solid ${C.hairlineStrong}`, background: C.raise, color: C.ink, fontFamily: FONT_MONO, fontSize: 15,
      }
      return (
        <div style={{ ...S.card, fontSize: 20 }} className="al-in" data-testid="space-page-editor">
          <div style={{ fontWeight: 500 }}>Make my page</div>
          <div style={S.chips}>
            {STARTERS.map((st) => (
              <button key={st.label} type="button" className="al-focus" style={S.big}
                onClick={() => setEditing({ ...editing, html: editing.html + st.html })}>+ {st.label}</button>
            ))}
          </div>
          <label style={S.label} htmlFor="space-page-html">my page (html)</label>
          <textarea id="space-page-html" data-testid="space-page-html" spellCheck={false} style={area}
            value={editing.html} maxLength={20000} onChange={(e) => setEditing({ ...editing, html: e.target.value })} />
          <label style={S.label} htmlFor="space-page-css">colors and styles (css)</label>
          <textarea id="space-page-css" data-testid="space-page-css" spellCheck={false} style={{ ...area, minHeight: 80 }}
            value={editing.css} maxLength={8000} onChange={(e) => setEditing({ ...editing, css: e.target.value })} />
          {preview && (
            <>
              <div style={S.label}>preview</div>
              <PageFrame page={preview} height={260} title="Preview of my page" />
            </>
          )}
          <div style={S.chips}>
            <button type="button" className="al-focus" style={S.big} disabled={busy} onClick={showPreview}>Look</button>
            <button type="button" className="al-primary al-focus" style={{ ...S.big, background: C.accent, borderColor: C.accent, color: C.onAccent }}
              disabled={busy} onClick={savePage}>Save</button>
            <button type="button" className="al-focus" style={S.big} onClick={() => { setEditing(null); setPreview(null); setNote(null) }}>Back</button>
          </div>
          {note && <div role="status" style={S.muted}>{note}</div>}
          <div style={S.muted}>Only your family can see this page. A grown-up can see every version.</div>
        </div>
      )
    }
    return (
      <div style={{ ...S.card, fontSize: 20 }} className="al-in" data-testid="family-space">
        <SpaceBody space={space} />
        {picking ? (
          <div data-testid="space-picker" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontWeight: 500 }}>Pick colors you like</div>
            <div style={S.chips}>
              {(choices?.colors ?? []).map((c) => (
                <button key={c.id} type="button" aria-pressed={picking.colors.includes(c.id)}
                  className="al-focus" style={{ ...S.big, borderColor: picking.colors.includes(c.id) ? c.hex : C.hairlineStrong, borderWidth: picking.colors.includes(c.id) ? 3 : 1 }}
                  onClick={() => toggle('colors', c.id)}>
                  <span aria-hidden style={{ display: 'inline-block', width: 16, height: 16, borderRadius: 8, background: c.hex, marginRight: 6 }} />
                  {c.label}
                </button>
              ))}
            </div>
            <div style={{ fontWeight: 500 }}>Pick animals you like</div>
            <div style={S.chips}>
              {(choices?.animals ?? []).map((a) => (
                <button key={a.id} type="button" aria-pressed={picking.animals.includes(a.id)}
                  className="al-focus" style={{ ...S.big, borderColor: picking.animals.includes(a.id) ? C.accent : C.hairlineStrong, borderWidth: picking.animals.includes(a.id) ? 3 : 1 }}
                  onClick={() => toggle('animals', a.id)}>
                  <span aria-hidden>{a.emoji}</span> {a.label}
                </button>
              ))}
            </div>
            <button type="button" className="al-primary al-focus" style={{ ...S.big, fontSize: 24, background: C.accent, borderColor: C.accent, color: C.onAccent }} disabled={busy} onClick={save}>Save</button>
          </div>
        ) : (
          <div style={S.chips}>
            <button type="button" className="al-focus" style={S.big} onClick={() => setPicking({
              colors: (space.favorites?.colors ?? []).map((c) => c.id),
              animals: (space.favorites?.animals ?? []).map((a) => a.id),
            })}>Pick favorites</button>
            <button type="button" className="al-focus" style={S.big} onClick={() => {
              setNote(null)
              setEditing({ html: space.page?.html ?? '', css: space.page?.css ?? '' })
              setPreview(space.page ?? null)
            }}>{space.page ? 'Change my page' : 'Make my page'}</button>
            <button type="button" className="al-focus" style={S.big} onClick={() => setOpen(false)}>Back</button>
          </div>
        )}
        {note && <div role="status" style={S.muted}>{note}</div>}
      </div>
    )
  }

  // guardian
  return (
    <section style={{ ...S.card, fontSize: 15 }} data-testid="family-space-guardian">
      <h3 style={{ margin: 0, fontSize: 20, fontWeight: 500, letterSpacing: '-0.02em' }}>{name ? `${name}'s Space` : 'Family Space'}</h3>
      <div style={S.muted}>
        A family-only page: first name, sprite, things learned, favorites from fixed lists and
        a page your child can write in HTML. It is never public, has no guestbook and cannot be
        shared outside the family.
      </div>
      {!space && busy && <div style={S.muted}>Making the Space…</div>}
      {!space && !busy && note && (
        <div><button type="button" className="al-primary al-focus" style={S.primary} onClick={make}>Try again</button></div>
      )}
      {space && <SpaceBody space={space} />}
      {space && <div style={S.chips}><button type="button" className="al-quiet al-focus" style={S.btn} disabled={busy} onClick={make}>Refresh</button></div>}
      {space && (space.page || (space.page_history ?? []).length > 0) && (
        <section data-testid="space-page-versions" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={S.label}>my page: every version</div>
          <div style={S.muted}>
            The page your child wrote, cleaned on the server and shown in a locked frame
            (no scripts, links, forms or anything from the internet).
          </div>
          {space.page && (
            <div style={S.chips}>
              <button type="button" className="al-quiet al-focus" style={S.btn} disabled={busy} onClick={() => restore({ clear: true })}>Clear page</button>
            </div>
          )}
          {(space.page_history ?? []).map((h) => (
            <details key={h.rev} data-testid="space-page-version">
              <summary style={{ cursor: 'pointer' }}>
                Version {h.rev} · {h.by === 'guardian' ? 'you' : 'your child'}{h.at ? ` · ${h.at.slice(0, 16).replace('T', ' ')}` : ''}
              </summary>
              <PageFrame page={h} height={200} title={`Version ${h.rev}`} />
              <div style={S.chips}>
                <button type="button" className="al-quiet al-focus" style={S.btn} disabled={busy} onClick={() => restore({ rev: Number(h.rev) })}>Bring this back</button>
              </div>
            </details>
          ))}
        </section>
      )}
      {note && <div role="status" style={S.muted}>{note}</div>}
      {onClose && <div><button type="button" className="al-quiet al-focus" style={S.btn} onClick={onClose}>Done</button></div>}
    </section>
  )
}
