/**
 * KidAssignmentsCard: the child's "from your teacher" card on /learn.
 *
 * Genesis /api/v1/classroom/me/*: GET assignments (only work assigned to the
 * caller, published lessons only, no answer keys), POST assignments/{aid}/open,
 * POST quest/{qid}/rating {easy|ok|hard} (enum only, no free text). A Learn child
 * their family linked to a class (lib.classroom.family_link) did the quest in the
 * FAMILY's tutor, which that route cannot see (404): the same rating is then sent
 * to POST family/quest/{qid}/rating, which checks the quest at home.
 *
 * The card only LISTS work. "Start" records the open and hands the assignment
 * to the host (onOpen), which shows KidAssignmentView: the materials, the
 * questions and "I'm done" live there. A host that passes no onOpen has nowhere
 * to show the work, so the card offers no button at all: a child is never asked
 * to start or finish something they cannot see.
 *
 * Kid-legible: big type, icons, 64px targets, no scores, no timers. A child who
 * is not in a class (404) or a service that cannot be reached renders NOTHING,
 * so a family-only Learn kid sees the exact same home as before.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { C, FONT_MONO, FONT_UI, LEARN_CSS, learnVars, useLearnMode } from './learnTheme'
import { CLASSROOM_API, ClassroomHttpError, classroomFetch, cseg, send, type KidAssignment } from './classroomApi'

export interface KidAssignmentsCardProps {
  apiBase?: string
  /** The quest the child just finished: shows the easy / ok / hard chips for it. */
  questId?: string | null
  onRated?: (rating: 'easy' | 'ok' | 'hard') => void
  /** Show an assignment's work (KidAssignmentView); called after the open is recorded.
   *  Without it the rows carry no button. */
  onOpen?: (a: KidAssignment) => void
  extraHeaders?: Record<string, string>
}

const BIG: CSSProperties = {
  minHeight: 64, minWidth: 64, padding: '8px 18px', borderRadius: 20, cursor: 'pointer', touchAction: 'manipulation',
  border: `1px solid ${C.hairlineStrong}`, background: C.raise, color: C.ink, font: `600 22px/1.1 ${FONT_UI}`,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
}

const LABEL: CSSProperties = { fontFamily: FONT_MONO, fontSize: 12, letterSpacing: '.18em', textTransform: 'lowercase', color: C.faint }

const RATINGS: Array<{ v: 'easy' | 'ok' | 'hard'; icon: string; word: string }> = [
  { v: 'easy', icon: '😀', word: 'Easy' },
  { v: 'ok', icon: '🙂', word: 'OK' },
  { v: 'hard', icon: '😣', word: 'Hard' },
]

function dueWords(due?: string | null): string | null {
  if (!due) return null
  const d = new Date(due.length === 10 ? `${due}T12:00:00` : due)
  if (Number.isNaN(d.getTime())) return null
  return `by ${d.toLocaleDateString(undefined, { weekday: 'long' })}`
}

export default function KidAssignmentsCard({ apiBase = CLASSROOM_API, questId, onRated, onOpen, extraHeaders }: KidAssignmentsCardProps) {
  const { mode } = useLearnMode()
  const [rows, setRows] = useState<KidAssignment[] | null>(null)
  const [rated, setRated] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await classroomFetch<{ assignments: KidAssignment[] }>(apiBase, '/me/assignments', { extraHeaders })
      setRows(r?.assignments ?? [])
    } catch {
      setRows(null) // not in a class, or unreachable: the card is simply not there
    }
  }, [apiBase, extraHeaders])

  useEffect(() => { load() }, [load])
  useEffect(() => { setRated(null) }, [questId])

  const open = async (a: KidAssignment) => {
    if (!onOpen) return
    try {
      if (!a.opened_at) {
        const r = await send<{ opened_at?: string | null }>(apiBase, `/me/assignments/${cseg(a.assignment_id)}/open`, 'POST', {}, extraHeaders)
        setRows((list) => (list || []).map((x) => (x.assignment_id === a.assignment_id ? { ...x, opened_at: r?.opened_at ?? x.opened_at } : x)))
      }
      onOpen(a)
    } catch { /* stays as it was; the child can tap again */ }
  }

  const rate = async (v: 'easy' | 'ok' | 'hard') => {
    if (!questId) return
    try {
      try {
        await send(apiBase, `/me/quest/${cseg(questId)}/rating`, 'POST', { rating: v }, extraHeaders)
      } catch (e) {
        // Only "that quest is not in this school" falls through to the family route.
        if (!(e instanceof ClassroomHttpError) || e.status !== 404) throw e
        await send(apiBase, `/me/family/quest/${cseg(questId)}/rating`, 'POST', { rating: v }, extraHeaders)
      }
      setRated(v)
      onRated?.(v)
    } catch { /* no fake "thanks" */ }
  }

  if (rows === null) return null
  if (rows.length === 0 && !questId) return null

  return (
    <section aria-label="From your teacher" data-testid="kid-assignments" data-learn-theme={mode}
      style={{ ...learnVars(mode), display: 'flex', flexDirection: 'column', gap: 16, padding: 20, borderRadius: 24, background: C.surface, border: `1px solid ${C.hairline}`, color: C.ink, fontFamily: FONT_UI }}>
      <style>{LEARN_CSS}</style>

      {questId && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="kid-rating">
          <div style={{ fontSize: 26, fontWeight: 500, letterSpacing: '-0.02em' }}>{rated ? 'Thanks! Your teacher will see it.' : 'How did that feel?'}</div>
          {!rated && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {RATINGS.map((r) => (
                <button key={r.v} type="button" className="al-focus" style={BIG} onClick={() => rate(r.v)} aria-label={r.word}>
                  <span aria-hidden style={{ fontSize: 32 }}>{r.icon}</span>{r.word}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <span style={LABEL}>from your teacher</span>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rows.map((a) => {
              const done = !!a.done_at
              return (
                <li key={a.assignment_id} data-testid="kid-assignment" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '10px 0', borderTop: `1px solid ${C.hairline}` }}>
                  <span aria-hidden style={{ fontSize: 40, lineHeight: 1 }}>{done ? '✅' : a.has_skills ? '🧩' : '📘'}</span>
                  <span style={{ flex: '1 1 160px', minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 24, fontWeight: 500, letterSpacing: '-0.01em', color: done ? C.dim : C.ink }}>{a.title}</span>
                    {dueWords(a.due_at) && <span style={{ display: 'block', fontSize: 18, color: C.dim }}>{dueWords(a.due_at)}</span>}
                  </span>
                  {onOpen && (
                    done
                      ? <button type="button" className="al-focus" style={BIG} onClick={() => open(a)}>Look again</button>
                      : <button type="button" className="al-focus" style={{ ...BIG, background: C.accent, border: `1px solid ${C.accent}`, color: C.onAccent }} onClick={() => open(a)}>{a.opened_at ? 'Keep going' : 'Start'}</button>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
