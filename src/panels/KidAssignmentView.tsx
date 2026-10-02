/**
 * KidAssignmentView: one piece of assigned work, opened from the "from your
 * teacher" card on /learn. This is where the child actually sees what was
 * handed out and answers it.
 *
 * Genesis /api/v1/classroom/me/assignments/{aid}: the lesson summary, the files
 * handed to THIS student (their own tier, chosen server-side, never named here)
 * and the challenges WITHOUT answer keys. Files download from
 * /me/assignments/{aid}/materials/{artifact_id}; answers go to
 * POST /me/assignments/{aid}/responses (the server takes the student from the
 * caller, never from the body); POST /me/assignments/{aid}/done hands it in.
 *
 * Kid-legible: big type, 64px targets, no scores, no timers. What the child
 * sees after handing in is "your teacher will look", never a machine score.
 * A load that fails says "offline" and offers only the way back: no "I'm done"
 * for work the child could not see.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { C, FONT_MONO, FONT_UI, LEARN_CSS, learnVars, useLearnMode } from './learnTheme'
import { CLASSROOM_API, ClassroomHttpError, classroomFetch, cseg, send, type KidAssignment } from './classroomApi'

export interface KidQuestion { prompt: string; type?: 'multiple_choice' | 'short_answer' | 'essay' | string; choices?: string[] | null }
export interface KidChallenge { id: string; title?: string; questions?: KidQuestion[] }
export interface KidArtifact { artifact_id: string; kind?: string; title?: string | null; filename?: string | null }
export interface KidAssignmentDetail extends KidAssignment {
  lesson?: { lesson_id: string; topic?: string | null } | null
  artifacts?: KidArtifact[]
  challenges?: KidChallenge[]
  skill_ids?: string[]
}

export interface KidAssignmentViewProps {
  assignmentId: string
  apiBase?: string
  /** Back to the child's home, nothing recorded. */
  onBack: () => void
  /** Called after the server recorded "done". */
  onDone?: () => void
  extraHeaders?: Record<string, string>
}

/** The server caps one answer at 2000 characters. */
const MAX_ANSWER = 2000

const BIG: CSSProperties = {
  minHeight: 64, minWidth: 64, padding: '8px 18px', borderRadius: 20, cursor: 'pointer', touchAction: 'manipulation',
  border: `1px solid ${C.hairlineStrong}`, background: C.raise, color: C.ink, font: `600 22px/1.2 ${FONT_UI}`,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10, textDecoration: 'none', boxSizing: 'border-box',
}
const PRIMARY: CSSProperties = { ...BIG, background: C.accent, border: `1px solid ${C.accent}`, color: C.onAccent }
const CHOSEN: CSSProperties = { ...BIG, border: `2px solid ${C.accent}`, background: C.accentWash }
const LABEL: CSSProperties = { fontFamily: FONT_MONO, fontSize: 12, letterSpacing: '.18em', textTransform: 'lowercase', color: C.faint }
const CARD: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 16, padding: 20, borderRadius: 24, background: C.surface,
  border: `1px solid ${C.hairline}`,
}

type Handed = 'sending' | 'in' | string // a string other than these is the server's refusal, shown as-is

export function assignmentMaterialHref(apiBase: string, assignmentId: string, artifactId: string): string {
  return `${apiBase}/me/assignments/${cseg(assignmentId)}/materials/${cseg(artifactId)}`
}

export default function KidAssignmentView({ assignmentId, apiBase = CLASSROOM_API, onBack, onDone, extraHeaders }: KidAssignmentViewProps) {
  const { mode } = useLearnMode()
  const [state, setState] = useState<'loading' | 'ready' | 'offline'>('loading')
  const [work, setWork] = useState<KidAssignmentDetail | null>(null)
  // challenge id -> question index (as the server keys it) -> answer
  const [answers, setAnswers] = useState<Record<string, Record<string, string>>>({})
  const [handed, setHanded] = useState<Record<string, Handed>>({})
  const [finishing, setFinishing] = useState(false)
  const [finishNote, setFinishNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState('loading')
    try {
      const r = await classroomFetch<KidAssignmentDetail>(apiBase, `/me/assignments/${cseg(assignmentId)}`, { extraHeaders })
      setWork(r)
      setState(r ? 'ready' : 'offline')
    } catch {
      setWork(null)
      setState('offline')
    }
  }, [apiBase, assignmentId, extraHeaders])

  useEffect(() => { load() }, [load])

  const setAnswer = (cid: string, qi: number, value: string) => {
    setAnswers((all) => ({ ...all, [cid]: { ...(all[cid] || {}), [String(qi)]: value } }))
    // An edited answer can be handed in again (the server replaces unreviewed work in place).
    setHanded((h) => (h[cid] && h[cid] !== 'sending' ? { ...h, [cid]: '' } : h))
  }

  const handIn = async (ch: KidChallenge) => {
    const mine = Object.fromEntries(Object.entries(answers[ch.id] || {}).filter(([, v]) => v.trim() !== ''))
    if (Object.keys(mine).length === 0) return
    const written = (ch.questions || [])
      .map((q, i) => (q.type && q.type !== 'multiple_choice' ? mine[String(i)] : ''))
      .filter(Boolean).join('\n\n').slice(0, MAX_ANSWER)
    setHanded((h) => ({ ...h, [ch.id]: 'sending' }))
    try {
      await send(apiBase, `/me/assignments/${cseg(assignmentId)}/responses`, 'POST',
        { challenge_id: ch.id, answers: mine, ...(written ? { answer_text: written } : {}) }, extraHeaders)
      setHanded((h) => ({ ...h, [ch.id]: 'in' }))
    } catch (e) {
      const said = e instanceof ClassroomHttpError && e.status === 409 ? e.message : 'That did not send. Try again.'
      setHanded((h) => ({ ...h, [ch.id]: said }))
    }
  }

  const finish = async () => {
    setFinishing(true)
    setFinishNote(null)
    try {
      await send(apiBase, `/me/assignments/${cseg(assignmentId)}/done`, 'POST', {}, extraHeaders)
      onDone?.()
    } catch {
      setFinishNote('That did not send. Try again.')
    } finally {
      setFinishing(false)
    }
  }

  const shell: CSSProperties = {
    ...learnVars(mode), background: C.ground, color: C.ink, minHeight: '100%', padding: '20px 16px 40px', boxSizing: 'border-box',
    fontFamily: FONT_UI, fontSize: 22, lineHeight: 1.4, letterSpacing: '-0.01em',
    display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 600, margin: '0 auto', width: '100%',
  }
  const back = (
    <button type="button" className="al-focus" style={{ ...BIG, alignSelf: 'flex-start' }} onClick={onBack}>
      <span aria-hidden>←</span>Back
    </button>
  )

  if (state !== 'ready' || !work) {
    return (
      <div style={shell} data-testid="kid-assignment-view" data-state={state} data-learn-theme={mode}>
        <style>{LEARN_CSS}</style>
        {back}
        {state === 'loading'
          ? <div style={{ color: C.dim }}>Getting ready…</div>
          : <div data-testid="kid-assignment-offline" style={{ ...LABEL, fontSize: 14 }}>offline</div>}
      </div>
    )
  }

  const artifacts = work.artifacts || []
  const challenges = (work.challenges || []).filter((c) => (c.questions || []).length > 0)
  const done = !!work.done_at
  const empty = artifacts.length === 0 && challenges.length === 0

  return (
    <div style={shell} data-testid="kid-assignment-view" data-state="ready" data-learn-theme={mode}>
      <style>{LEARN_CSS}</style>
      {back}
      <div>
        <span style={LABEL}>from your teacher</span>
        <h1 style={{ margin: '6px 0 0', fontSize: 32, fontWeight: 500, letterSpacing: '-0.02em' }}>{work.title}</h1>
        {work.lesson?.topic && work.lesson.topic !== work.title && <div style={{ color: C.dim }}>{work.lesson.topic}</div>}
      </div>

      {artifacts.length > 0 && (
        <section style={CARD} aria-label="Things to look at" data-testid="kid-materials">
          <span style={LABEL}>things to look at</span>
          {artifacts.map((m) => (
            <a key={m.artifact_id} className="al-focus" data-testid="kid-material" download
              href={assignmentMaterialHref(apiBase, assignmentId, m.artifact_id)}
              style={{ ...BIG, justifyContent: 'flex-start', textAlign: 'left' }}>
              <span aria-hidden style={{ fontSize: 32 }}>📄</span>
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{m.title || m.filename || 'Open'}</span>
            </a>
          ))}
        </section>
      )}

      {challenges.map((ch) => {
        const mine = answers[ch.id] || {}
        const h = handed[ch.id] || ''
        const any = Object.values(mine).some((v) => v.trim() !== '')
        return (
          <section key={ch.id} style={CARD} aria-label={ch.title || 'Questions'} data-testid="kid-challenge">
            {ch.title && <div style={{ fontSize: 26, fontWeight: 500, letterSpacing: '-0.01em' }}>{ch.title}</div>}
            {(ch.questions || []).map((q, qi) => {
              const key = `${ch.id}-${qi}`
              const choices = q.type === 'multiple_choice' || !q.type ? (q.choices || []) : []
              return (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 12, borderTop: `1px solid ${C.hairline}` }}>
                  <div id={`q-${key}`} style={{ fontSize: 24 }}>{q.prompt}</div>
                  {choices.length > 0 ? (
                    <div role="group" aria-labelledby={`q-${key}`} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {choices.map((choice) => {
                        const on = mine[String(qi)] === choice
                        return (
                          <button key={choice} type="button" className="al-focus" aria-pressed={on} disabled={done}
                            style={{ ...(on ? CHOSEN : BIG), justifyContent: 'flex-start', textAlign: 'left' }}
                            onClick={() => setAnswer(ch.id, qi, choice)}>{choice}</button>
                        )
                      })}
                    </div>
                  ) : (
                    <textarea className="al-field" aria-labelledby={`q-${key}`} rows={q.type === 'essay' ? 6 : 3} maxLength={MAX_ANSWER}
                      disabled={done} value={mine[String(qi)] || ''} onChange={(e) => setAnswer(ch.id, qi, e.target.value)}
                      style={{
                        width: '100%', boxSizing: 'border-box', padding: 14, borderRadius: 16, resize: 'vertical',
                        border: `1px solid ${C.hairlineStrong}`, background: C.ground, color: C.ink, font: `400 22px/1.4 ${FONT_UI}`,
                      }} />
                  )}
                </div>
              )
            })}
            {h === 'in'
              ? <div data-testid="kid-handed-in" style={{ color: C.dim }}>Sent. Your teacher will look at it.</div>
              : !done && (
                <>
                  {h && h !== 'sending' && <div role="status" style={{ color: C.amber }}>{h}</div>}
                  <button type="button" className="al-focus" style={{ ...BIG, alignSelf: 'flex-start', opacity: any ? 1 : 0.42 }}
                    disabled={!any || h === 'sending'} onClick={() => handIn(ch)}>Send my answers</button>
                </>
              )}
          </section>
        )
      })}

      {empty && (
        <section style={CARD} data-testid="kid-assignment-practice">
          <div>{work.has_skills ? 'Your teacher picked this for you to practise. Play a quest, then come back and tell them you are done.' : 'Your teacher did not add anything to open for this one.'}</div>
        </section>
      )}

      {done
        ? <div data-testid="kid-assignment-done" style={{ color: C.dim }}>✅ You handed this in.</div>
        : (
          <>
            {finishNote && <div role="status" style={{ color: C.amber }}>{finishNote}</div>}
            <button type="button" className="al-primary al-focus" style={PRIMARY} disabled={finishing} onClick={finish}>I&apos;m done</button>
          </>
        )}
    </div>
  )
}
