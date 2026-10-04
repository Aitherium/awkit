/**
 * TutorProgressCard: the guardian's view of the Aither Learn difficulty dial for one child.
 *
 * GET {apiBase}/family/learners/{lid}/progress and PUT .../adaptive (Genesis
 * family_tutor_adaptive router).
 * - Per skill: the level the dial is playing (gentle / core / stretch), the skill
 *   estimate as "expected right at the core level", this week's change, why the level
 *   last moved, and a "finding this hard" flag. Grouped Numbers / Words.
 * - What's next: the new step of the next lesson and why.
 * - Time: today against the daily goal, and this week.
 * - Knobs: pin a skill's level (or leave it on Auto) and set a daily goal.
 * Only this child's own numbers are shown; nothing compares children.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { C, FONT_UI } from './learnTheme'
import { SheetHeading, Skel, fieldBox, help, labelText, mono, primary, quiet } from './learnParts'
import TutorLevelCard from './TutorLevelCard'

export interface TutorProgressCardProps {
  apiBase: string
  lid: string
  alias?: string
  extraHeaders?: Record<string, string>
  onNote?: (message: string) => void
}

export interface ProgressSkill {
  skill_id: string
  kid_title: string
  domain?: string
  grade?: number
  state?: string
  level?: number
  level_name?: string
  pinned?: boolean
  percent?: number
  trend_7d?: number
  answers?: number
  recent_success?: number | null
  last_change?: string
  stuck?: boolean
}

export interface ProgressView {
  alias?: string
  today?: { minutes?: number; goal_minutes?: number | null; goal_met?: boolean }
  week_minutes?: number
  working_grade?: Record<string, number | null>
  skills?: ProgressSkill[]
  next?: Array<{ skill_id: string; kid_title: string; why?: string }>
  knobs?: { pins?: Record<string, number>; daily_goal_minutes?: number | null }
  lesson_minutes?: number
  how_it_works?: string
  /** Skills marked learned by placement and never practised: one collapsed line. */
  placed?: {
    count?: number
    summary?: string
    skills?: Array<{ skill_id: string; kid_title: string; domain?: string; grade?: number }>
  }
}

const DOMAIN_LABEL: Record<string, string> = { math: 'Numbers', reading: 'Words' }
const LEVEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: '-1', label: 'Gentle' },
  { value: '0', label: 'Core' },
  { value: '1', label: 'Stretch' },
]

function gradeWord(g: number | null | undefined): string {
  if (g === null || g === undefined) return 'just starting'
  return g === 0 ? 'kindergarten level' : `grade ${g} level`
}

function trendText(t: number | undefined): string {
  if (!t) return 'steady this week'
  return t > 0 ? `up ${Math.round(t)} pts this week` : `down ${Math.round(-t)} pts this week`
}

const S: Record<string, CSSProperties> = {
  card: { display: 'flex', flexDirection: 'column', gap: 18, fontFamily: FONT_UI, color: C.ink },
  row: {
    display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'center',
    padding: '12px 0', borderTop: `1px solid ${C.hairline}`,
  },
  bar: { height: 6, borderRadius: 3, background: C.hairline, overflow: 'hidden', marginTop: 6 },
  chip: {
    display: 'inline-flex', alignItems: 'center', padding: '2px 10px', borderRadius: 999,
    border: `1px solid ${C.hairlineStrong}`, font: `500 12px/1.6 ${FONT_UI}`, color: C.dim,
  },
}

export default function TutorProgressCard({ apiBase, lid, alias, extraHeaders = {}, onNote }: TutorProgressCardProps) {
  const [view, setView] = useState<ProgressView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [goal, setGoal] = useState('')
  const [showHow, setShowHow] = useState(false)
  const [showPlaced, setShowPlaced] = useState(false)
  const headerKey = JSON.stringify(extraHeaders)
  const noteRef = useRef(onNote)
  noteRef.current = onNote
  const base = `${apiBase}/family/learners/${encodeURIComponent(lid)}`

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const headers = { 'Content-Type': 'application/json', ...(JSON.parse(headerKey) as Record<string, string>) }
      const r = await fetch(`${base}/progress`, { method: 'GET', headers })
      const data = (await r.json().catch(() => null)) as ProgressView | null
      if (r.ok && data) {
        setView(data)
        setGoal(data.knobs?.daily_goal_minutes ? String(data.knobs.daily_goal_minutes) : '')
      } else {
        noteRef.current?.('Could not load progress.')
      }
    } catch {
      noteRef.current?.('Could not load progress.')
    } finally {
      setLoading(false)
    }
  }, [base, headerKey])

  useEffect(() => { load() }, [load])

  const put = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true)
    try {
      const r = await fetch(`${base}/adaptive`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(JSON.parse(headerKey) as Record<string, string>) },
        body: JSON.stringify(body),
      })
      if (r.ok) { noteRef.current?.(ok); await load() } else noteRef.current?.('Could not save that.')
    } catch {
      noteRef.current?.('Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  const pin = (sid: string, value: string) =>
    put({ pins: { [sid]: value === 'auto' ? 'auto' : Number(value) } }, value === 'auto' ? 'Back on Auto.' : 'Level pinned.')

  const saveGoal = () => {
    const n = Math.round(Number(goal))
    if (!Number.isFinite(n) || n < 1 || n > 60) { noteRef.current?.('A daily goal is 1 to 60 minutes.'); return }
    put({ daily_goal_minutes: n }, 'Daily goal saved.')
  }

  const who = alias || view?.alias || 'your child'
  const skills = view?.skills || []
  const domains = Array.from(new Set(skills.map((s) => s.domain || 'other')))
  const today = view?.today

  return (
    <div style={S.card} data-testid="progress-view">
      <SheetHeading label="learning dial" title={`How ${who} is doing`} />
      {loading && !view ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}><Skel w="70%" h={18} /><Skel w="90%" h={14} /><Skel w="80%" h={14} /></div>
      ) : view ? (
        <>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
            <div>
              <div style={mono}>today</div>
              <div style={{ fontSize: 22 }} data-testid="progress-today">
                {Math.round(today?.minutes ?? 0)} min{today?.goal_minutes ? ` of ${today.goal_minutes}` : ''}
                {today?.goal_met ? ' · goal met' : ''}
              </div>
            </div>
            <div>
              <div style={mono}>this week</div>
              <div style={{ fontSize: 22 }}>{Math.round(view.week_minutes ?? 0)} min</div>
            </div>
            {Object.entries(view.working_grade || {}).map(([d, g]) => (
              <div key={d}>
                <div style={mono}>{(DOMAIN_LABEL[d] || d).toLowerCase()}</div>
                <div style={{ fontSize: 22 }}>{gradeWord(g)}</div>
              </div>
            ))}
          </div>

          <TutorLevelCard apiBase={apiBase} lid={lid} alias={who} extraHeaders={extraHeaders}
            onNote={(m) => noteRef.current?.(m)} onChanged={load} />

          {view.placed && (view.placed.count ?? 0) > 0 && (
            <div data-testid="progress-placed">
              <button type="button" className="al-quiet al-focus" style={quiet} aria-expanded={showPlaced}
                onClick={() => setShowPlaced(!showPlaced)}>
                {view.placed.summary || `Placed out of ${view.placed.count} skills`}
              </button>
              {showPlaced && (
                <ul data-testid="progress-placed-list" style={{ margin: '6px 0 0', paddingLeft: 20, ...help }}>
                  {(view.placed.skills || []).map((p) => <li key={p.skill_id}>{p.kid_title}</li>)}
                </ul>
              )}
            </div>
          )}

          {view.next && view.next.length > 0 && (
            <div data-testid="progress-next">
              <div style={labelText}>What&apos;s next</div>
              <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                {view.next.map((n) => (
                  <li key={n.skill_id} style={{ margin: '4px 0' }}>{n.kid_title} <span style={help}>({n.why})</span></li>
                ))}
              </ul>
            </div>
          )}

          {domains.map((d) => (
            <section key={d} aria-label={DOMAIN_LABEL[d] || d}>
              <div style={{ ...mono, marginBottom: 4 }}>{DOMAIN_LABEL[d] || d}</div>
              {skills.filter((s) => (s.domain || 'other') === d).map((s) => {
                const pct = Math.max(0, Math.min(100, Number(s.percent ?? 0)))
                return (
                  <div key={s.skill_id} style={S.row} data-testid="progress-skill">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span>{s.kid_title}</span>
                        <span style={S.chip}>{s.level_name}{s.pinned ? ' · pinned' : ''}</span>
                        {s.state === 'secure' || s.state === 'fluent' || s.state === 'review_due'
                          ? <span style={{ ...S.chip, color: C.accent, borderColor: C.accent }}>learned</span> : null}
                        {s.stuck && <span style={{ ...S.chip, color: C.amber, borderColor: C.amber }}>finding this hard</span>}
                      </div>
                      <div style={S.bar} aria-label={`about ${pct} in 100 right at the core level`}>
                        <div style={{ width: `${pct}%`, height: '100%', background: C.accent }} />
                      </div>
                      <div style={{ ...help, marginTop: 4 }}>
                        ~{pct}% right at core · {trendText(s.trend_7d)} · {s.answers ?? 0} answers
                        {s.last_change ? ` · ${s.last_change}` : ''}
                      </div>
                    </div>
                    <select aria-label={`Level for ${s.kid_title}`} disabled={busy} className="al-field"
                      value={s.pinned ? String(s.level) : 'auto'} onChange={(e) => pin(s.skill_id, e.target.value)}
                      style={{ ...fieldBox, width: 'auto', minHeight: 44 }}>
                      {LEVEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                )
              })}
            </section>
          ))}

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labelText}>Daily goal (minutes)</span>
              <input aria-label="daily goal minutes" inputMode="numeric" value={goal} maxLength={2} className="al-field"
                onChange={(e) => setGoal(e.target.value.replace(/[^0-9]/g, ''))} style={{ ...fieldBox, width: 120 }} />
            </label>
            <button type="button" className="al-primary al-focus" style={primary} disabled={busy || !goal} onClick={saveGoal}>
              Save goal
            </button>
          </div>
          <div style={help}>
            Lessons run about {view.lesson_minutes ?? 10} minutes. {who} sees only encouragement:
            what they learned and whether today&apos;s learning is done, never these numbers.
          </div>
          <div>
            <button type="button" className="al-quiet al-focus" style={quiet} aria-expanded={showHow}
              onClick={() => setShowHow(!showHow)}>
              How the dial works
            </button>
            {showHow && <p style={{ ...help, marginTop: 8 }} data-testid="progress-how">{view.how_it_works}</p>}
          </div>
        </>
      ) : null}
    </div>
  )
}
