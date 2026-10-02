/**
 * TutorFocusCard: the guardian steers the tutor for one child (Aither Learn).
 *
 * GET/PUT {apiBase}/family/learners/{lid}/focus (Genesis family_tutor router).
 * - Weekly focus: pick up to 6 skills from the skill graph, shown by their kid_title.
 *   About half of new-learning practice comes from the picked skills whose building
 *   blocks are already in place; reviews are unchanged. It lasts 7 days.
 * - Coach note (<= 280 characters): only flavours the tone of hints. The server strips
 *   links and contact details and ignores anything that tries to change rules or
 *   answers; the child never sees it.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { C, EASE, FONT_UI } from './learnTheme'
import { SheetHeading, Skel, fieldBox, help, labelText, mono, primary, quiet } from './learnParts'

export interface TutorFocusCardProps {
  apiBase: string
  lid: string
  alias?: string
  extraHeaders?: Record<string, string>
  onNote?: (message: string) => void
}

interface CatalogSkill {
  skill_id: string
  kid_title: string
  domain?: string
  grade?: number
  ready?: boolean
  state?: string | null
}

interface FocusView {
  skills?: Array<{ skill_id: string; kid_title?: string }>
  note?: string
  active?: boolean
  active_until?: string | null
}

export const MAX_FOCUS_SKILLS = 6
export const MAX_COACH_NOTE = 280

const DOMAIN_LABEL: Record<string, string> = { math: 'Numbers', reading: 'Words' }

const S: Record<string, CSSProperties> = {
  card: { display: 'flex', flexDirection: 'column', gap: 16, fontFamily: FONT_UI, color: C.ink },
  grid: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  chip: {
    display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, boxSizing: 'border-box', padding: '0 14px',
    border: `1px solid ${C.hairlineStrong}`, borderRadius: 999, font: `400 14px/1.2 ${FONT_UI}`, cursor: 'pointer',
    transition: `border-color .18s ${EASE}, background-color .18s ${EASE}`,
  },
  chipOn: { borderColor: C.accent, background: C.accentWash, color: C.ink },
  primary,
  btn: quiet,
  muted: help,
}

function fmtDay(v: string | null | undefined): string {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString()
}

export default function TutorFocusCard({ apiBase, lid, alias, extraHeaders = {}, onNote }: TutorFocusCardProps) {
  const [catalog, setCatalog] = useState<CatalogSkill[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [coach, setCoach] = useState('')
  const [current, setCurrent] = useState<FocusView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const headerKey = JSON.stringify(extraHeaders)
  // A ref, so an inline onNote from the host does not re-run the load effect.
  const noteRef = useRef(onNote)
  noteRef.current = onNote

  const url = `${apiBase}/family/learners/${encodeURIComponent(lid)}/focus`

  const apply = useCallback((f: FocusView | undefined) => {
    setCurrent(f || null)
    setPicked((f?.skills || []).map((s) => s.skill_id))
    setCoach(f?.note || '')
  }, [])

  useEffect(() => {
    let live = true
    setLoading(true)
    const headers = { 'Content-Type': 'application/json', ...(JSON.parse(headerKey) as Record<string, string>) }
    fetch(url, { method: 'GET', headers })
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => null) }))
      .then(({ ok, data }) => {
        if (!live) return
        if (ok && data) {
          setCatalog(Array.isArray(data.catalog) ? data.catalog : [])
          apply(data.focus)
        } else {
          noteRef.current?.('Could not load the focus.')
        }
      })
      .catch(() => { if (live) noteRef.current?.('Could not load the focus.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [url, headerKey, apply])

  const toggle = (sid: string) => {
    setPicked((p) => (p.includes(sid) ? p.filter((s) => s !== sid) : p.length >= MAX_FOCUS_SKILLS ? p : [...p, sid]))
  }

  const save = async (e: FormEvent, clear = false) => {
    e.preventDefault()
    setBusy(true)
    const body = clear ? { skills: [], note: '' } : { skills: picked, note: coach.slice(0, MAX_COACH_NOTE) }
    try {
      const r = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(JSON.parse(headerKey) as Record<string, string>) },
        body: JSON.stringify(body),
      })
      const data = await r.json().catch(() => null)
      if (r.ok && data) {
        apply(data.focus)
        noteRef.current?.(clear ? 'Focus cleared.' : 'Focus saved.')
      } else {
        noteRef.current?.('Could not save the focus.')
      }
    } catch {
      noteRef.current?.('Could not save the focus.')
    } finally {
      setBusy(false)
    }
  }

  const domains = Array.from(new Set(catalog.map((c) => c.domain || 'other')))

  return (
    <form style={S.card} onSubmit={(e) => save(e)} data-testid="focus-view">
      <SheetHeading label="weekly focus" title={`This week's focus${alias ? ` for ${alias}` : ''}`} />
      <div style={S.muted}>
        Pick up to {MAX_FOCUS_SKILLS} skills. About half of new practice will come from the ones
        {' '}{alias || 'your child'} is ready for; reviews stay the same. It lasts 7 days.
      </div>
      {current?.active && current.active_until && (
        <div style={S.muted} data-testid="focus-until">Active until {fmtDay(current.active_until)}.</div>
      )}
      {loading ? <div style={{ display: 'flex', gap: 8 }}><Skel w={120} h={44} r={999} /><Skel w={90} h={44} r={999} /><Skel w={140} h={44} r={999} /></div> : (
        domains.map((d) => (
          <fieldset key={d} style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend style={{ ...mono, padding: 0, marginBottom: 10 }}>{DOMAIN_LABEL[d] || d}</legend>
            <div style={S.grid}>
              {catalog.filter((c) => (c.domain || 'other') === d).map((c) => (
                <label key={c.skill_id} style={{ ...S.chip, ...(picked.includes(c.skill_id) ? S.chipOn : { color: C.dim }) }}>
                  <input type="checkbox" aria-label={c.kid_title} checked={picked.includes(c.skill_id)} className="al-focus"
                    style={{ width: 18, height: 18, margin: 0, accentColor: C.accent }}
                    disabled={!picked.includes(c.skill_id) && picked.length >= MAX_FOCUS_SKILLS}
                    onChange={() => toggle(c.skill_id)} />
                  {c.kid_title}
                  {!c.ready && <span style={S.muted}>(after its building blocks)</span>}
                </label>
              ))}
            </div>
          </fieldset>
        ))
      )}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={labelText}>Coach note (optional, tone only)</span>
        <textarea aria-label="coach note" value={coach} maxLength={MAX_COACH_NOTE} rows={3} className="al-field"
          style={{ ...fieldBox, resize: 'vertical' }}
          placeholder="Loves dinosaurs. Keep it playful and short."
          onChange={(e) => setCoach(e.target.value.slice(0, MAX_COACH_NOTE))} />
        <span style={S.muted}>
          {coach.length}/{MAX_COACH_NOTE}. Shapes how hints sound. It never changes answers or rules,
          links and contact details are removed, and your child does not see it.
        </span>
      </label>
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" className="al-primary al-focus" style={S.primary} disabled={busy || loading}>Save focus</button>
        <button type="button" className="al-quiet al-focus" style={S.btn} disabled={busy || loading} onClick={(e) => save(e as unknown as FormEvent, true)}>
          Clear
        </button>
      </div>
    </form>
  )
}
