/**
 * TutorLevelCard: the guardian's starting-level control for one Aither Learn child.
 *
 * GET / PUT {apiBase}/family/learners/{lid}/level and POST .../placement (Genesis
 * family_tutor_placement router).
 * - Shows the placement check's result (where each strand was placed) and what the
 *   child works on next.
 * - Set the school grade, and a starting grade for Numbers and Words: skills below
 *   it are marked learned. It only ever raises -- nothing the child already learned
 *   or practised is reset.
 * - "Check again": the next time the child presses start, they get the short
 *   placement check instead of a lesson.
 * Renders nothing when the server has no level route (an older Genesis).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { C } from './learnTheme'
import { fieldBox, help, labelText, mono, primary, quiet } from './learnParts'

export interface TutorLevelCardProps {
  apiBase: string
  lid: string
  alias?: string
  extraHeaders?: Record<string, string>
  onNote?: (message: string) => void
  /** Called after a change, so the host can reload its own view. */
  onChanged?: () => void
}

export interface LevelView {
  grade?: number
  placement?: { status?: string; requested?: boolean; at?: string | null; placed?: Record<string, number> }
  working_grade?: Record<string, number>
  next?: Record<string, Array<{ skill_id: string; kid_title: string; grade?: number }>>
  grades?: number[]
}

const STRANDS: Array<{ id: 'math' | 'reading'; label: string }> = [
  { id: 'math', label: 'Numbers' }, { id: 'reading', label: 'Words' },
]

export function gradeName(g: number | null | undefined): string {
  if (g === null || g === undefined || g < 0) return 'not placed yet'
  return g === 0 ? 'Kindergarten' : `Grade ${g}`
}

export default function TutorLevelCard({ apiBase, lid, alias, extraHeaders = {}, onNote, onChanged }: TutorLevelCardProps) {
  const [view, setView] = useState<LevelView | null>(null)
  const [busy, setBusy] = useState(false)
  const [grade, setGrade] = useState('')
  const [starts, setStarts] = useState<Record<string, string>>({ math: '', reading: '' })
  const headerKey = JSON.stringify(extraHeaders)
  const noteRef = useRef(onNote)
  noteRef.current = onNote
  const base = `${apiBase}/family/learners/${encodeURIComponent(lid)}`
  const headers = useCallback(
    () => ({ 'Content-Type': 'application/json', ...(JSON.parse(headerKey) as Record<string, string>) }),
    [headerKey],
  )

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${base}/level`, { method: 'GET', headers: headers() })
      const data = (await r.json().catch(() => null)) as LevelView | null
      if (r.ok && data) {
        setView(data)
        setGrade(String(data.grade ?? ''))
      }
    } catch { /* no level control on this server: render nothing */ }
  }, [base, headers])

  useEffect(() => { load() }, [load])

  const send = async (method: 'PUT' | 'POST', path: string, payload: Record<string, unknown> | null, ok: string) => {
    setBusy(true)
    try {
      const r = await fetch(`${base}${path}`, {
        method, headers: headers(), body: payload ? JSON.stringify(payload) : undefined,
      })
      if (r.ok) {
        noteRef.current?.(ok)
        setStarts({ math: '', reading: '' })
        await load()
        onChanged?.()
      } else noteRef.current?.('Could not save that.')
    } catch {
      noteRef.current?.('Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  if (!view) return null
  const who = alias || 'your child'
  const grades = view.grades && view.grades.length ? view.grades : [0, 1, 2, 3, 4, 5]
  const placed = view.placement?.placed || {}
  const status = view.placement?.status

  const save = () => {
    const body: Record<string, unknown> = {}
    if (grade !== '' && Number(grade) !== view.grade) body.grade = Number(grade)
    for (const s of STRANDS) if (starts[s.id] !== '') body[`${s.id}_start`] = Number(starts[s.id])
    if (!Object.keys(body).length) { noteRef.current?.('Nothing to change.'); return }
    send('PUT', '/level', body, 'Starting level saved.')
  }

  return (
    <section data-testid="level-card" aria-label="Starting level" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={labelText}>Starting level</div>
      <div style={help} data-testid="level-status">
        {status === 'done' && Object.keys(placed).length
          ? `Placement check: ${STRANDS.map((s) => `${s.label} ${gradeName(placed[s.id]).toLowerCase()}`).join(', ')}.`
          : status === 'requested' || view.placement?.requested
            ? `${who} gets the placement check the next time they press start.`
            : `${who} gets a short placement check before their first lesson.`}
      </div>
      {STRANDS.map((s) => {
        const nxt = (view.next?.[s.id] || []).slice(0, 2)
        const owned = view.working_grade?.[s.id] ?? -1
        const at = nxt[0]?.grade ?? Math.max(0, owned)
        return (
          <div key={s.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'center' }}>
            <div style={{ minWidth: 0 }}>
              <div style={mono}>{s.label.toLowerCase()}</div>
              <div style={{ fontSize: 16 }}>
                Working at {gradeName(at).toLowerCase()}
                {nxt.length ? <span style={help}> · next: {nxt.map((n) => n.kid_title).join(' · ')}</span> : null}
              </div>
            </div>
            <select aria-label={`Start ${s.label} at`} disabled={busy} className="al-field"
              value={starts[s.id]} onChange={(e) => setStarts({ ...starts, [s.id]: e.target.value })}
              style={{ ...fieldBox, width: 'auto', minHeight: 44 }}>
              <option value="">Keep</option>
              {grades.map((g) => <option key={g} value={String(g)}>Start at {gradeName(g)}</option>)}
            </select>
          </div>
        )
      })}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelText}>School grade</span>
          <select aria-label="School grade" disabled={busy} className="al-field" value={grade}
            onChange={(e) => setGrade(e.target.value)} style={{ ...fieldBox, width: 'auto', minHeight: 44 }}>
            {[...grades, 6].map((g) => <option key={g} value={String(g)}>{gradeName(g)}</option>)}
          </select>
        </label>
        <button type="button" className="al-primary al-focus" style={primary} disabled={busy} onClick={save}>
          Save level
        </button>
        <button type="button" className="al-quiet al-focus" style={quiet} disabled={busy}
          onClick={() => send('POST', '/placement', null, 'Placement check is ready for the next start.')}>
          Check again
        </button>
      </div>
      <div style={{ ...help, color: C.dim }}>
        Starting higher marks the skills below as learned; they still come back now and then
        as quick reviews. Nothing {who} already learned is reset.
      </div>
    </section>
  )
}
