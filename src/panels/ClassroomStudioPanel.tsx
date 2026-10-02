/**
 * ClassroomStudioPanel: draft a lesson, see it in three tiers side by side, edit,
 * save the draft, publish.
 *
 * Genesis /api/v1/classroom: POST /classes/{id}/studio/draft and
 * POST /lessons/{lid}/studio/differentiate (MicroScheduler behind pinned prompts;
 * a deterministic template when the model is off, returned as ai='offline').
 * Saving and publishing go through Academy (academyBase): PATCH the lesson, then
 * PATCH status=approved + POST .../publish. Nothing publishes by itself: a draft
 * stays a draft until the teacher presses Publish.
 */
import { useState, type FormEvent } from 'react'
import { C, FONT_MONO, FONT_UI, LEARN_CSS, LearnModeSwitch } from './learnTheme'
import { Field, SelectBox, fieldBox, help, mono, primary, quiet } from './learnParts'
import {
  CLASSROOM_API, CLASSROOM_CSS, ClassroomHttpError, cs, cseg, send, useClassroomSurface,
  type Lesson, type StudioPlan, type StudioTier,
} from './classroomApi'

export interface ClassroomStudioPanelProps {
  classId: string
  apiBase?: string
  /** Academy base for Save draft / Publish. Required: the host names the authenticated Academy proxy it serves. */
  academyBase: string
  /** Default grade band (the class's). */
  gradeLevel?: string | null
  extraHeaders?: Record<string, string>
  /** After a publish (host may refresh assignables). */
  onPublished?: (lessonId: string) => void
}

const GRADES = ['K-2', '3-5', '6-8', '9-12']
const TIERS = ['A', 'B', 'C'] as const

interface DraftResult { ai: string; reason?: string; lesson: Lesson; plan: StudioPlan }
interface TierResult { ai: string; tiers: Record<'A' | 'B' | 'C', StudioTier> }

function AiBadge({ ai }: { ai: string }) {
  if (ai !== 'offline') return <span style={{ ...mono, color: C.accent }} data-testid="ai-on">ai draft · check it</span>
  return (
    <span data-testid="ai-offline" style={{ ...mono, color: C.amber, border: `1px solid ${C.amber}`, borderRadius: 999, padding: '4px 10px' }}>
      AI offline · template
    </span>
  )
}

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items || !items.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={mono}>{title}</span>
      <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4, color: C.ink, font: `400 15px/1.5 ${FONT_UI}` }}>
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </ol>
    </div>
  )
}

export default function ClassroomStudioPanel({
  classId, apiBase = CLASSROOM_API, academyBase, gradeLevel, extraHeaders, onPublished,
}: ClassroomStudioPanelProps) {
  const { mode, pref, setPref, rootRef, rootStyle } = useClassroomSurface(cs.root)
  const [topic, setTopic] = useState('')
  const [grade, setGrade] = useState(gradeLevel && GRADES.includes(gradeLevel) ? gradeLevel : 'K-2')
  const [minutes, setMinutes] = useState(45)
  const [standards, setStandards] = useState('')
  const [draft, setDraft] = useState<DraftResult | null>(null)
  const [tiers, setTiers] = useState<TierResult | null>(null)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [published, setPublished] = useState(false)

  // An HTTP answer carries the router's reason; anything else (no network, proxy down) is offline.
  const fail = (e: unknown, fallback: string) => setMsg(e instanceof ClassroomHttpError ? e.message : `offline · ${fallback}`)

  const makeDraft = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('draft'); setMsg(null); setTiers(null); setPublished(false)
    try {
      const r = await send<DraftResult>(apiBase, `/classes/${cseg(classId)}/studio/draft`, 'POST', {
        topic: topic.trim(), grade_level: grade, minutes,
        standards: standards.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6),
      }, extraHeaders)
      setDraft(r)
      setTitle(r.lesson?.topic || r.plan?.title || topic)
    } catch (ex) { fail(ex, 'The studio could not be reached.') } finally { setBusy(null) }
  }

  const differentiate = async () => {
    if (!draft) return
    setBusy('tiers'); setMsg(null)
    try {
      setTiers(await send<TierResult>(apiBase, `/lessons/${cseg(draft.lesson.id)}/studio/differentiate`, 'POST', {}, extraHeaders))
    } catch (ex) { fail(ex, 'Tiers could not be made right now.') } finally { setBusy(null) }
  }

  const lessonPath = () => `/classes/${cseg(classId)}/lessons/${cseg(draft ? draft.lesson.id : '')}`

  const save = async () => {
    if (!draft) return
    setBusy('save'); setMsg(null)
    try {
      await send(academyBase, lessonPath(), 'PATCH', {
        topic: title.trim() || draft.lesson.topic, duration_minutes: minutes, research_context: notes.trim() || null,
      }, extraHeaders)
      setMsg('Draft saved. Only you can see it.')
    } catch (ex) { fail(ex, 'Not saved.') } finally { setBusy(null) }
  }

  const publish = async () => {
    if (!draft) return
    setBusy('publish'); setMsg(null)
    try {
      await send(academyBase, lessonPath(), 'PATCH', { topic: title.trim() || draft.lesson.topic, status: 'approved' }, extraHeaders)
      await send(academyBase, `${lessonPath()}/publish`, 'POST', {}, extraHeaders)
      setPublished(true)
      setMsg('Published. You can assign it now.')
      onPublished?.(draft.lesson.id)
    } catch (ex) { fail(ex, 'Not published.') } finally { setBusy(null) }
  }

  return (
    <div ref={rootRef} style={rootStyle} data-learn-theme={mode} data-testid="classroom-studio">
      <style>{LEARN_CSS + CLASSROOM_CSS}</style>
      <div className="cr-col">
        <header className="cr-head al-in">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={mono}>aither classroom · lesson studio</span>
            <h1 style={cs.h1}>{draft ? title || 'Draft' : 'Plan a lesson'}</h1>
            {draft && <AiBadge ai={tiers?.ai === 'offline' ? 'offline' : draft.ai} />}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            {draft && !published && (
              <>
                <button type="button" className="al-quiet al-focus" style={quiet} disabled={!!busy} onClick={save}>Save draft</button>
                <button type="button" className="al-primary al-focus" style={primary} disabled={!!busy} onClick={publish} data-testid="studio-publish">Publish</button>
              </>
            )}
            <LearnModeSwitch pref={pref} onChange={setPref} />
          </div>
        </header>
        {msg && <div role="status" data-testid="studio-msg" style={msg.startsWith('offline') ? cs.offline : cs.amberNote}>{msg}</div>}

        {!draft && (
          <form onSubmit={makeDraft} style={{ ...cs.tile, gap: 18 }} className="al-in" data-testid="studio-form">
            <Field label="Topic"><input className="al-field" style={fieldBox} value={topic} maxLength={200} onChange={(e) => setTopic(e.target.value)} required /></Field>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
              <Field label="Grade band">
                <SelectBox value={grade} onChange={(e) => setGrade(e.target.value)}>{GRADES.map((g) => <option key={g} value={g}>{g}</option>)}</SelectBox>
              </Field>
              <Field label="Minutes">
                <input type="number" min={15} max={180} className="al-field" style={fieldBox} value={minutes}
                  onChange={(e) => setMinutes(Math.max(15, Math.min(180, Number(e.target.value) || 45)))} />
              </Field>
              <Field label="Standards (optional)" hint="Comma separated, e.g. 1.OA.6">
                <input className="al-field" style={fieldBox} value={standards} onChange={(e) => setStandards(e.target.value)} />
              </Field>
            </div>
            <p style={help}>The draft is a starting point. You edit, you decide, you publish.</p>
            <div><button type="submit" className="al-primary al-focus" style={primary} disabled={busy === 'draft' || !topic.trim()}>Draft lesson</button></div>
          </form>
        )}

        {draft && (
          <>
            <section style={cs.tile} aria-label="Lesson plan" data-testid="studio-plan">
              <Field label="Title"><input className="al-field" style={fieldBox} value={title} maxLength={500} disabled={published} onChange={(e) => setTitle(e.target.value)} /></Field>
              {draft.plan.objective && <p style={{ ...cs.sub, color: C.ink }}>{draft.plan.objective}</p>}
              {draft.plan.warm_up && <List title="warm up" items={[draft.plan.warm_up]} />}
              <List title="steps" items={draft.plan.steps} />
              <List title="check for understanding" items={draft.plan.check_for_understanding} />
              <List title="materials" items={draft.plan.materials} />
              <Field label="Your notes" hint="Saved with the draft.">
                <textarea className="al-field" style={cs.textarea} value={notes} maxLength={8000} disabled={published} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </section>

            <section aria-label="Three tiers" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span style={mono}>three tiers</span>
                {!published && (
                  <button type="button" className="al-quiet al-focus" style={{ ...quiet, color: C.accent }} disabled={!!busy} onClick={differentiate} data-testid="studio-tiers">
                    {tiers ? 'Redo tiers' : 'Make tiers A · B · C'}
                  </button>
                )}
              </div>
              {tiers ? (
                <div className="cr-tiers" data-testid="studio-tier-grid">
                  {TIERS.map((t) => {
                    const tier = tiers.tiers[t]
                    return (
                      <article key={t} style={cs.tile}>
                        <span style={{ font: `500 13px/1 ${FONT_MONO}`, letterSpacing: '.18em', color: C.accent }}>tier {t.toLowerCase()} · {tier?.label}</span>
                        <p style={{ margin: 0, color: C.ink, font: `400 15px/1.5 ${FONT_UI}` }}>{tier?.focus}</p>
                        <List title="activities" items={tier?.activities} />
                        {tier?.check && <p style={help}>Check: {tier.check}</p>}
                      </article>
                    )
                  })}
                </div>
              ) : <p style={help}>Tiers adapt the same lesson for students who need more support, are on track, or are ready for more.</p>}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
