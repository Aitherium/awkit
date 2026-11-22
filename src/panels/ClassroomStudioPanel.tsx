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
 *
 * Also on the same router: the draft can be grounded in the teacher's own pasted
 * material (`sources`, up to 5); a saved plan is edited in place with
 * GET/PATCH /lessons/{lid}/studio/plan (the PATCH quotes the sha256 the GET
 * returned, so a stale copy is a 409 and the editor re-reads instead of
 * overwriting); POST .../studio/quiz drafts a multiple-choice check quiz and
 * POST .../studio/deck a narrated .pptx deck, both saved on the unpublished
 * lesson and both null with a `reason` when the model is off. The deck downloads
 * through Academy's artifact route (the teacher reads their own drafts there).
 */
import { useState, type FormEvent, type ReactNode } from 'react'
import { C, FONT_MONO, FONT_UI, LEARN_CSS, LearnModeSwitch } from './learnTheme'
import { Field, SelectBox, fieldBox, help, mono, primary, quiet } from './learnParts'
import {
  CLASSROOM_API, CLASSROOM_CSS, ClassroomHttpError, MAX_PLAN_OPS, classroomFetch, cs, cseg, planEditOps, send,
  useClassroomSurface, type Lesson, type StudioPlan, type StudioTier,
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

/** The server's limits on the teacher's own material (lesson_studio.MAX_SOURCES / _NAME / _CHARS). */
const MAX_SOURCES = 5
const MAX_SOURCE_NAME = 120
const MAX_SOURCE_CHARS = 50000
/** One plan field or list item (PlanOp value max_length). */
const MAX_PLAN_TEXT = 400
/** A model call (draft, quiz, deck) can outlast the default 25 s fetch verdict. */
const MODEL_TIMEOUT_MS = 120000

interface Source { name: string; text: string }
interface SourceUsed { name: string; chars?: number; used?: number }
interface DraftResult {
  ai: string; reason?: string; lesson: Lesson; plan: StudioPlan
  sources?: SourceUsed[]; sources_truncated?: boolean
}
interface TierResult { ai: string; tiers: Record<'A' | 'B' | 'C', StudioTier> }
interface PlanRead { lesson_id: string; status: string; artifact_id: string; sha256: string; plan: StudioPlan }
interface PlanSaved { lesson: Lesson; plan: StudioPlan; sha256: string; tiers_dropped: number }
interface QuizQuestion { prompt: string; type?: string; choices?: string[] | null; answer?: string | null }
interface QuizResult { ai: string; reason?: string | null; challenge: { id: string; title?: string; questions?: QuizQuestion[] } | null }
interface DeckSlide { title: string; bullets?: string[]; narration?: string }
interface DeckResult { ai: string; reason?: string | null; deck: { slides?: DeckSlide[] } | null; artifact_id: string | null }
interface Editing { sha: string; base: StudioPlan; form: StudioPlan }

const LIST_FIELDS = [
  { key: 'steps', title: 'steps', add: 'Add a step' },
  { key: 'check_for_understanding', title: 'check for understanding', add: 'Add a check' },
  { key: 'materials', title: 'materials', add: 'Add a material' },
] as const

/** The Academy route that serves a lesson's own file to its teacher (the proxy relays it as an attachment). */
export function lessonFileHref(academyBase: string, artifactId: string): string {
  return `${academyBase}/artifacts/${cseg(artifactId)}/download`
}

/** A 422 from the plan editor carries {error, op_index}; anything else is shown as the server said it. */
function planRefusal(e: ClassroomHttpError): string {
  try {
    const d = JSON.parse(e.message) as { error?: string }
    if (d && typeof d.error === 'string') return `That edit was not saved: ${d.error}.`
  } catch { /* a plain-text detail */ }
  return `That edit was not saved: ${e.message}`
}

function modelPost<T>(apiBase: string, path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  return classroomFetch<T>(apiBase, path, { method: 'POST', body: JSON.stringify(body), extraHeaders, timeoutMs: MODEL_TIMEOUT_MS })
}

function Nothing({ ai, what, reason, testId }: { ai: string; what: string; reason?: string | null; testId: string }) {
  return (
    <p style={{ ...help, color: C.amber }} data-testid={testId}>
      {ai === 'offline' ? `AI offline · no ${what} made.` : `No ${what} made this time.`}
      {reason ? ` (${reason})` : ''} Nothing was saved.
    </p>
  )
}

function Tile({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <article style={cs.tile} data-testid={testId}>
      <span style={mono}>{label}</span>
      {children}
    </article>
  )
}

const LIST_TEXT = { margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 10, color: C.ink, font: `400 15px/1.5 ${FONT_UI}` } as const

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
  const [sources, setSources] = useState<Source[]>([])
  const [editing, setEditing] = useState<Editing | null>(null)
  const [quiz, setQuiz] = useState<QuizResult | null>(null)
  const [deck, setDeck] = useState<DeckResult | null>(null)

  // An HTTP answer carries the router's reason; anything else (no network, proxy down) is offline.
  const fail = (e: unknown, fallback: string) => setMsg(e instanceof ClassroomHttpError ? e.message : `offline · ${fallback}`)

  const makeDraft = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('draft'); setMsg(null); setTiers(null); setPublished(false); setEditing(null); setQuiz(null); setDeck(null)
    // A source needs both halves on the server; an unnamed paste gets a plain name rather than being dropped.
    const mine = sources
      .map((s, i) => ({ name: s.name.trim() || `Material ${i + 1}`, text: s.text.trim() }))
      .filter((s) => s.text)
    try {
      const r = await modelPost<DraftResult>(apiBase, `/classes/${cseg(classId)}/studio/draft`, {
        topic: topic.trim(), grade_level: grade, minutes,
        standards: standards.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6),
        ...(mine.length ? { sources: mine } : {}),
      }, extraHeaders)
      setDraft(r)
      setTitle(r.lesson?.topic || r.plan?.title || topic)
      if (r.sources_truncated) setMsg('Some of your material was too long, so the draft used the first part of it.')
    } catch (ex) { fail(ex, 'The studio could not be reached.') } finally { setBusy(null) }
  }

  const setSource = (i: number, patch: Partial<Source>) =>
    setSources((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  const planPath = () => `/lessons/${cseg(draft ? draft.lesson.id : '')}/studio/plan`

  const readPlan = () => classroomFetch<PlanRead>(apiBase, planPath(), { extraHeaders })

  const startEdit = async () => {
    if (!draft) return
    setBusy('read'); setMsg(null)
    try {
      const r = await readPlan()
      setEditing({ sha: r.sha256, base: r.plan, form: r.plan })
    } catch (ex) { fail(ex, 'The plan could not be read.') } finally { setBusy(null) }
  }

  const setForm = (patch: Partial<StudioPlan>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e))

  const savePlan = async () => {
    if (!draft || !editing) return
    // The header's Title is the plan's title too: an edit there rides the same PATCH.
    const ops = planEditOps(editing.base, { ...editing.form, title: title.trim() || editing.base.title })
    if (ops.length === 0) { setEditing(null); setMsg('Nothing changed.'); return }
    if (ops.length > MAX_PLAN_OPS) { setMsg(`That is more than ${MAX_PLAN_OPS} changes at once. Save part of it first.`); return }
    setBusy('plan'); setMsg(null)
    try {
      const r = await send<PlanSaved>(apiBase, planPath(), 'PATCH', { expected_sha256: editing.sha, ops }, extraHeaders)
      setDraft((d) => (d ? { ...d, lesson: r.lesson ?? d.lesson, plan: r.plan } : d))
      setTitle(r.plan.title)
      setEditing(null)
      if (r.tiers_dropped > 0) {
        setTiers(null)
        setMsg('Plan saved. The tiers were made from the old plan, so they were removed. Make them again when you are ready.')
      } else setMsg('Plan saved. Only you can see it.')
    } catch (ex) {
      if (ex instanceof ClassroomHttpError && ex.status === 409) {
        // Stale copy or a published lesson: never overwrite, re-read what is there now.
        try {
          const r = await readPlan()
          setDraft((d) => (d ? { ...d, plan: r.plan } : d))
          setTitle(r.plan.title)
          if (r.status === 'published') {
            setEditing(null); setPublished(true)
            setMsg('This lesson is published, so its plan cannot change.')
          } else {
            setEditing({ sha: r.sha256, base: r.plan, form: r.plan })
            setMsg('The plan changed since you opened it. The newest version is loaded; make your edit again.')
          }
        } catch (again) { fail(again, 'The plan changed and could not be read again.') }
      } else if (ex instanceof ClassroomHttpError && ex.status === 422) {
        setMsg(planRefusal(ex))
      } else fail(ex, 'The plan was not saved.')
    } finally { setBusy(null) }
  }

  const makeQuiz = async () => {
    if (!draft) return
    setBusy('quiz'); setMsg(null)
    try {
      setQuiz(await modelPost<QuizResult>(apiBase, `/lessons/${cseg(draft.lesson.id)}/studio/quiz`, {}, extraHeaders))
    } catch (ex) { fail(ex, 'No quiz was made.') } finally { setBusy(null) }
  }

  const makeDeck = async () => {
    if (!draft) return
    setBusy('deck'); setMsg(null)
    try {
      setDeck(await modelPost<DeckResult>(apiBase, `/lessons/${cseg(draft.lesson.id)}/studio/deck`, {}, extraHeaders))
    } catch (ex) { fail(ex, 'No slides were made.') } finally { setBusy(null) }
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
            <section aria-label="Your material" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="studio-sources">
              <span style={mono}>your material (optional)</span>
              <p style={help}>Paste your own text (a reading, notes, a worksheet) and the draft is built from it. Up to {MAX_SOURCES}.</p>
              {sources.map((s, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="studio-source">
                  <input className="al-field" style={fieldBox} aria-label={`Material ${i + 1} name`} placeholder="Name, e.g. Chapter 3 reading"
                    value={s.name} maxLength={MAX_SOURCE_NAME} onChange={(e) => setSource(i, { name: e.target.value })} />
                  <textarea className="al-field" style={cs.textarea} aria-label={`Material ${i + 1} text`} placeholder="Paste the text here"
                    value={s.text} maxLength={MAX_SOURCE_CHARS} onChange={(e) => setSource(i, { text: e.target.value })} />
                  <div>
                    <button type="button" className="al-quiet al-focus" style={quiet} aria-label={`Remove material ${i + 1}`}
                      onClick={() => setSources((all) => all.filter((_, j) => j !== i))}>Remove</button>
                  </div>
                </div>
              ))}
              {sources.length < MAX_SOURCES && (
                <div>
                  <button type="button" className="al-quiet al-focus" style={{ ...quiet, color: C.accent }} data-testid="studio-add-source"
                    onClick={() => setSources((all) => [...all, { name: '', text: '' }])}>{sources.length ? 'Add more material' : 'Add your material'}</button>
                </div>
              )}
            </section>
            <p style={help}>The draft is a starting point. You edit, you decide, you publish.</p>
            <div><button type="submit" className="al-primary al-focus" style={primary} disabled={busy === 'draft' || !topic.trim()}>Draft lesson</button></div>
          </form>
        )}

        {draft && (
          <>
            <section style={cs.tile} aria-label="Lesson plan" data-testid="studio-plan">
              <Field label="Title"><input className="al-field" style={fieldBox} value={title} maxLength={500} disabled={published} onChange={(e) => setTitle(e.target.value)} /></Field>
              {draft.sources && draft.sources.length > 0 && (
                <p style={help} data-testid="studio-sources-used">Built from your material: {draft.sources.map((s) => s.name).join(', ')}</p>
              )}
              {editing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-testid="studio-plan-editor">
                  <Field label="Objective">
                    <textarea className="al-field" style={cs.textarea} value={editing.form.objective ?? ''} maxLength={MAX_PLAN_TEXT} onChange={(e) => setForm({ objective: e.target.value })} />
                  </Field>
                  <Field label="Warm up">
                    <input className="al-field" style={fieldBox} value={editing.form.warm_up ?? ''} maxLength={MAX_PLAN_TEXT} onChange={(e) => setForm({ warm_up: e.target.value })} />
                  </Field>
                  {LIST_FIELDS.filter((f) => Array.isArray(editing.base[f.key])).map((f) => {
                    const items = editing.form[f.key] ?? []
                    const put = (next: string[]) => setForm({ [f.key]: next } as Partial<StudioPlan>)
                    return (
                      <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <span style={mono}>{f.title}</span>
                        {items.map((t, i) => (
                          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <input className="al-field" style={{ ...fieldBox, flex: '1 1 auto' }} aria-label={`${f.title} ${i + 1}`} value={t} maxLength={MAX_PLAN_TEXT}
                              onChange={(e) => put(items.map((x, j) => (j === i ? e.target.value : x)))} />
                            <button type="button" className="al-quiet al-focus" style={quiet} aria-label={`Remove ${f.title} ${i + 1}`}
                              onClick={() => put(items.filter((_, j) => j !== i))}>Remove</button>
                          </div>
                        ))}
                        <div><button type="button" className="al-quiet al-focus" style={quiet} onClick={() => put([...items, ''])}>{f.add}</button></div>
                      </div>
                    )
                  })}
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <button type="button" className="al-quiet al-focus" style={{ ...quiet, color: C.accent }} disabled={!!busy} onClick={savePlan} data-testid="studio-plan-save">Save plan</button>
                    <button type="button" className="al-quiet al-focus" style={quiet} disabled={!!busy} onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  {draft.plan.objective && <p style={{ ...cs.sub, color: C.ink }}>{draft.plan.objective}</p>}
                  {draft.plan.warm_up && <List title="warm up" items={[draft.plan.warm_up]} />}
                  <List title="steps" items={draft.plan.steps} />
                  <List title="check for understanding" items={draft.plan.check_for_understanding} />
                  <List title="materials" items={draft.plan.materials} />
                  {!published && (
                    <div>
                      <button type="button" className="al-quiet al-focus" style={{ ...quiet, color: C.accent }} disabled={!!busy} onClick={startEdit} data-testid="studio-plan-edit">Edit plan</button>
                    </div>
                  )}
                </>
              )}
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

            <section aria-label="Check quiz and slides" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="studio-extras">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span style={mono}>check quiz · slides</span>
                {!published && (
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <button type="button" className="al-quiet al-focus" style={{ ...quiet, color: C.accent }} disabled={!!busy} onClick={makeQuiz} data-testid="studio-quiz-make">Draft a check quiz</button>
                    <button type="button" className="al-quiet al-focus" style={{ ...quiet, color: C.accent }} disabled={!!busy} onClick={makeDeck} data-testid="studio-deck-make">Make narrated slides</button>
                  </div>
                )}
              </div>
              {!quiz && !deck && <p style={help}>Both are saved with this lesson. Students get them, without any answers, only once you publish and assign it.</p>}
              {quiz && (
                quiz.challenge ? (
                  <Tile label={`${quiz.challenge.title || 'check quiz'} · answer key for you only`} testId="studio-quiz">
                    <ol style={LIST_TEXT}>
                      {(quiz.challenge.questions || []).map((q, i) => (
                        <li key={i}>
                          <div>{q.prompt}</div>
                          {q.choices && q.choices.length > 0 && (
                            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                              {q.choices.map((c) => (
                                <li key={c} style={c === q.answer ? { color: C.accent, fontWeight: 600 } : undefined}>
                                  {c}{c === q.answer ? ' · answer' : ''}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ol>
                    <p style={help}>Saved with the lesson. Check it before you publish.</p>
                  </Tile>
                ) : <Nothing ai={quiz.ai} what="quiz was" reason={quiz.reason} testId="studio-quiz-none" />
              )}
              {deck && (
                deck.deck ? (
                  <Tile label="narrated slides" testId="studio-deck">
                    <ol style={LIST_TEXT}>
                      {(deck.deck.slides || []).map((sl, i) => (
                        <li key={i}>
                          <div style={{ fontWeight: 600 }}>{sl.title}</div>
                          {sl.bullets && sl.bullets.length > 0 && <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{sl.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>}
                          {sl.narration && <p style={{ ...help, margin: '4px 0 0' }}>Narration: {sl.narration}</p>}
                        </li>
                      ))}
                    </ol>
                    {deck.artifact_id ? (
                      <a className="al-quiet al-focus" style={{ ...quiet, color: C.accent, alignSelf: 'flex-start', textDecoration: 'none' }} download
                        href={lessonFileHref(academyBase, deck.artifact_id)} data-testid="studio-deck-download">Download slides (.pptx)</a>
                    ) : <p style={help}>The slides were not saved as a file.</p>}
                    <p style={help}>The narration is in the speaker notes. A new deck replaces this one.</p>
                  </Tile>
                ) : <Nothing ai={deck.ai} what="slides were" reason={deck.reason} testId="studio-deck-none" />
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
