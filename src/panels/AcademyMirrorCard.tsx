/**
 * AcademyMirrorCard: the guardian's "Show progress in Academy" switch (Aither Learn).
 *
 * Backed by Genesis GET/POST /api/v1/tutor/family/academy-mirror. POST turns the
 * one-way mirror on (or refreshes it): a private "Home" class in Aither Academy
 * with one first-name-only student per child and per-standard mastery. After
 * that it re-syncs by itself whenever a skill becomes secure. Only the guardian
 * can call it and only the guardian can see the Home class; the tutor stays the
 * source of truth.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { C, FONT_UI } from './learnTheme'
import { help, mono, quiet } from './learnParts'

type Call = (path: string, method?: string, body?: object) =>
  Promise<{ status: number; ok: boolean; data: unknown }>

interface MirrorStudent {
  student_id: string
  name?: string
  mastery_per_standard?: Record<string, number>
}

interface MirrorStatus {
  enabled: boolean
  class_id: string
  students: MirrorStudent[]
}

const S: Record<string, CSSProperties> = {
  card: {
    display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 0', fontFamily: FONT_UI, color: C.ink,
    borderTop: `1px solid ${C.hairline}`, borderBottom: `1px solid ${C.hairline}`,
  },
  row: { display: 'flex', columnGap: 14, rowGap: 0, flexWrap: 'wrap', alignItems: 'center' },
  btn: { ...quiet, color: C.accent },
  muted: help,
}

export default function AcademyMirrorCard({ call }: { call: Call }) {
  const [status, setStatus] = useState<MirrorStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await call('/family/academy-mirror')
      if (r.ok && r.data && typeof r.data === 'object') setStatus(r.data as MirrorStatus)
    } catch { /* the card simply stays in its "off" state */ }
  }, [call])

  useEffect(() => { load() }, [load])

  const sync = async () => {
    setBusy(true)
    setNote(null)
    try {
      const r = await call('/family/academy-mirror', 'POST', {})
      setNote(r.ok ? 'Progress is in your private Home class in Academy.' : 'Could not update Academy right now.')
      if (r.ok) await load()
    } catch {
      setNote('Could not reach the learning service.')
    } finally {
      setBusy(false)
    }
  }

  const on = !!status?.enabled
  return (
    <section style={S.card} data-testid="academy-mirror-card" aria-label="Aither Academy">
      <div style={S.row}>
        <span style={mono}>academy</span>
        <span style={{ flex: '1 1 220px', color: C.dim, font: `400 14px/1.45 ${FONT_UI}` }}>
          {on
            ? 'Progress also appears in your private Home class in Aither Academy.'
            : 'Progress can also appear in Aither Academy. Only you see the Home class.'}
        </span>
        <button type="button" className="al-quiet al-focus" style={S.btn} disabled={busy} onClick={sync} data-testid="academy-mirror-sync">
          {on ? 'Update now' : 'Show in Academy'}
        </button>
      </div>
      {on && status && status.students.length > 0 && (
        <ul data-testid="academy-mirror-students" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 14, ...mono, letterSpacing: '.08em' }}>
          {status.students.map((s) => (
            <li key={s.student_id}>
              {s.name || 'Learner'}: {Object.keys(s.mastery_per_standard || {}).length} standards tracked
            </li>
          ))}
        </ul>
      )}
      {note && <span role="status" style={S.muted}>{note}</span>}
    </section>
  )
}
