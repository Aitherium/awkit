/**
 * ClassroomSupportPanel (awkit): the teacher's Support Passports for one class.
 *
 * Phone first: the class list, then one student's passport (a back link returns to the
 * list); from 760px the list sits beside the passport. A passport is ten sections as
 * tiles: strengths, interests, how they learn best, strategies tried (and how each
 * went), goals with progress, accommodations and who owns each, what works, upcoming
 * reviews and open actions, data collection (Quick Tally counters: tap, 14-day chart,
 * time log, pin to the class dashboard) and staff notes. Each tile carries who it is
 * shared with; staff notes never are. Meetings for the Family Support Portal are
 * prepared at the foot of the passport.
 *
 * AI drafting (a family update, a meeting-prep summary) is a SUGGESTION in an editable box
 * with a Copy button: there is no send button, and Hearth never sends it. The model runs
 * on the school's own local models through MicroScheduler (lib/classroom/support_drafts.py).
 * The student's own check-ins (fixed feelings they tapped on their Learn home) show here.
 *
 * Every change saves at once and says so. Hearth (lib/hearth/classroom_support_router.py)
 * answers 404 to anyone who is not a teacher of record; the panel then says the class
 * could not be found and shows nothing else.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { C, FONT_MONO, FONT_UI, LEARN_CSS } from './learnTheme'
import { Field, SelectBox, fieldBox, help, mono, primary, quiet } from './learnParts'
import { CLASSROOM_CSS, cs, isNotFound } from './classroomApi'
import {
  OUTCOME_WORDS, SUPPORT_API, SUPPORT_KIND_WORDS, supportApi,
  type Counter, type Goal, type MarkLog, type Meeting, type PassportSection, type RosterLine,
  type Draft, type SectionKey, type StaffPassport,
} from './classroomSupportApi'
import { DayBars, LineList, SUPPORT_CSS, ShareSwitch, TallyTile, TileTitle, addBtn, dayLabel, tileHead, timeLabel } from './supportParts'

export interface ClassroomSupportPanelProps {
  classId: string
  apiBase?: string
  extraHeaders?: Record<string, string>
  /** Open on this student (member id), e.g. from a dashboard tile. */
  initialMember?: string
}

type FieldSpec = { key: string; label: string; kind?: 'text' | 'date' | 'select' | 'long'; options?: Record<string, string>; required?: boolean; max?: number }

const STRATEGY_FIELDS: FieldSpec[] = [
  { key: 'strategy', label: 'Strategy or intervention', required: true, max: 200 },
  { key: 'started', label: 'Started', kind: 'date' },
  { key: 'outcome', label: 'How it went', kind: 'select', options: OUTCOME_WORDS },
  { key: 'note', label: 'Note', kind: 'long', max: 500 },
]
const SUPPORT_FIELDS: FieldSpec[] = [
  { key: 'support', label: 'Support', required: true, max: 200 },
  { key: 'kind', label: 'Kind', kind: 'select', options: SUPPORT_KIND_WORDS },
  { key: 'owner', label: 'Who is responsible', max: 120 },
  { key: 'when', label: 'When / how often', max: 160 },
]
const GOAL_FIELDS: FieldSpec[] = [
  { key: 'goal', label: 'Goal', required: true, max: 300 },
  { key: 'measure', label: 'How it is measured', max: 200 },
  { key: 'baseline', label: 'Baseline', max: 100 },
  { key: 'target', label: 'Target', max: 100 },
  { key: 'status', label: 'Status', kind: 'select', options: { active: 'active', met: 'met', paused: 'paused' } },
]
const REVIEW_KINDS: Record<string, string> = {
  iep_annual: 'Annual IEP', iep_review: 'IEP review', '504_review': '504 review', mtss_check: 'MTSS / RTI check',
  conference: 'Conference', other: 'Other',
}
const REVIEW_FIELDS: FieldSpec[] = [
  { key: 'title', label: 'Review', required: true, max: 200 },
  { key: 'date', label: 'Date', kind: 'date' },
  { key: 'kind', label: 'Kind', kind: 'select', options: REVIEW_KINDS },
]
const ACTION_FIELDS: FieldSpec[] = [
  { key: 'text', label: 'Action', required: true, max: 300 },
  { key: 'owner', label: 'Owner', max: 120 },
  { key: 'due', label: 'Due', kind: 'date' },
]
const LINE_HINTS: Partial<Record<SectionKey, string>> = {
  strengths: 'Add a strength, e.g. kind to classmates',
  interests: 'Add an interest, e.g. dinosaurs',
  learning_preferences: 'Add how they learn best, e.g. pictures before words',
  calm_plan: 'Add a calm-down step the student can use, e.g. squeeze the stress ball',
  what_works: 'Add what works, e.g. a quiet start after lunch',
}

const ROW: CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderTop: `1px solid ${C.hairline}`, minWidth: 0 }
const SMALL: CSSProperties = { font: `400 13px/1.45 ${FONT_UI}`, color: C.dim }

function cleanItem(spec: FieldSpec[], draft: Record<string, string>): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const f of spec) {
    const v = (draft[f.key] || '').trim()
    if (f.required && !v) return null
    if (v) out[f.key] = v
  }
  return out
}

/** A small form for one item of a structured section. */
function ItemForm({ spec, onAdd, label }: { spec: FieldSpec[]; onAdd: (item: Record<string, string>) => void; label: string }) {
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [open, setOpen] = useState(false)
  if (!open) {
    return <button type="button" className="al-quiet al-focus" style={{ ...quiet, color: C.accent }} onClick={() => setOpen(true)}>{`+ ${label}`}</button>
  }
  const item = cleanItem(spec, draft)
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (item) { onAdd(item); setDraft({}); setOpen(false) } }}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: 12, borderRadius: 12, background: C.raise }}>
      {spec.map((f) => (
        <Field key={f.key} label={f.label}>
          {f.kind === 'select' ? (
            <SelectBox value={draft[f.key] || ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} aria-label={f.label}>
              {Object.entries(f.options || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </SelectBox>
          ) : f.kind === 'long' ? (
            <textarea className="al-field" style={{ ...cs.textarea, minHeight: 64 }} maxLength={f.max} value={draft[f.key] || ''}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} aria-label={f.label} />
          ) : (
            <input className="al-field" style={{ ...fieldBox, minHeight: 44 }} type={f.kind === 'date' ? 'date' : 'text'} maxLength={f.max}
              value={draft[f.key] || ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} aria-label={f.label} />
          )}
        </Field>
      ))}
      <div style={{ display: 'flex', gap: 12, width: '100%', alignItems: 'center' }}>
        <button type="submit" className="al-focus" style={{ ...addBtn, opacity: item ? 1 : 0.5 }} disabled={!item}>Add</button>
        <button type="button" className="al-quiet al-focus" style={quiet} onClick={() => { setDraft({}); setOpen(false) }}>Cancel</button>
      </div>
    </form>
  )
}

function Tile({ section, children, onShare, saving }: {
  section: PassportSection; children: ReactNode; saving: boolean
  onShare: (v: { share_family?: boolean; share_student?: boolean }) => void
}) {
  return (
    <section style={cs.tile} data-testid={`sp-section-${section.section}`} aria-labelledby={`sp-h-${section.section}`}>
      <div style={tileHead}>
        <div id={`sp-h-${section.section}`}><TileTitle>{section.title}</TileTitle></div>
        <span style={{ ...mono, color: saving ? C.accent : C.faint }} aria-live="polite">{saving ? 'saving' : section.updated_at ? 'saved' : ''}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 18px', marginTop: -6 }}>
        {section.never_shared ? (
          <span style={{ ...SMALL, color: C.faint, minHeight: 32, display: 'inline-flex', alignItems: 'center' }} data-testid="sp-never-shared">
            Only staff of this class ever see this.
          </span>
        ) : (
          <>
            <ShareSwitch label="Family can see" checked={section.share_family} onChange={(v) => onShare({ share_family: v })}
              testId={`sp-share-family-${section.section}`} />
            {section.student_may_see && (
              <ShareSwitch label="Student can see" checked={section.share_student} onChange={(v) => onShare({ share_student: v })}
                testId={`sp-share-student-${section.section}`} />
            )}
          </>
        )}
      </div>
      {children}
    </section>
  )
}

function ItemRows<T extends Record<string, unknown>>({ items, render, onRemove }: { items: T[]; render: (it: T) => ReactNode; onRemove: (i: number) => void }) {
  if (!items.length) return null
  return (
    <div>
      {items.map((it, i) => (
        <div key={String(it.id ?? i)} style={ROW}>
          <div style={{ flex: 1, minWidth: 0 }}>{render(it)}</div>
          <button type="button" className="al-quiet al-focus" style={{ ...quiet, minHeight: 32, color: C.faint }} onClick={() => onRemove(i)} aria-label="Remove">
            remove
          </button>
        </div>
      ))}
    </div>
  )
}

function GoalProgress({ goal, onAdd }: { goal: Goal; onAdd: (at: string, value: string) => void }) {
  const [at, setAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [value, setValue] = useState('')
  const pts = goal.progress || []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      {pts.length > 0 && (
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }} aria-label="Progress">
          {pts.map((p, i) => (
            <li key={`${p.at}-${i}`} style={{ ...SMALL, fontFamily: FONT_MONO, fontSize: 12 }}>{`${dayLabel(p.at)}: ${p.value}`}</li>
          ))}
        </ol>
      )}
      <form onSubmit={(e) => { e.preventDefault(); if (value.trim() && at) { onAdd(at, value.trim()); setValue('') } }}
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input type="date" className="al-field" style={{ ...fieldBox, minHeight: 40, width: 160 }} value={at} onChange={(e) => setAt(e.target.value)} aria-label="Progress date" />
        <input className="al-field" style={{ ...fieldBox, minHeight: 40, flex: 1, minWidth: 100 }} value={value} maxLength={100}
          onChange={(e) => setValue(e.target.value)} placeholder="Measured value" aria-label="Progress value" />
        <button type="submit" className="al-focus" style={{ ...addBtn, minHeight: 40 }} disabled={!value.trim()}>Log</button>
      </form>
    </div>
  )
}

function DataSection({ classId, memberId, apiBase, h, counters, pinned, goals, onChanged }: {
  classId: string; memberId: string; apiBase: string; h?: Record<string, string>
  counters: Counter[]; pinned: string[]; goals: Goal[]; onChanged: () => void
}) {
  const [label, setLabel] = useState('')
  const [goalId, setGoalId] = useState('')
  const [log, setLog] = useState<MarkLog[] | null>(null)
  const [list, setList] = useState<Counter[]>(counters)
  const [pins, setPins] = useState<string[]>(pinned)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setList(counters) }, [counters])
  useEffect(() => { setPins(pinned) }, [pinned])
  const loadLog = useCallback(async () => {
    try { setLog((await supportApi.tallies(apiBase, classId, memberId, h)).log) } catch { setLog(null) }
  }, [apiBase, classId, memberId, h])
  useEffect(() => { loadLog() }, [loadLog])
  const replace = (c: Counter) => setList((cur) => cur.map((x) => (x.id === c.id ? c : x)))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {err && <p role="alert" style={{ margin: 0, color: C.amber, ...SMALL }}>{err}</p>}
      {list.length === 0 && <p style={{ margin: 0, ...SMALL }}>No counters yet. Add one for anything you count during class.</p>}
      {list.map((c) => (
        <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10, borderTop: `1px solid ${C.hairline}` }} data-testid="sp-counter">
          <div className="sp-two" style={{ alignItems: 'start' }}>
            <TallyTile counter={c}
              onTap={async () => {
                try { const r = await supportApi.mark(apiBase, classId, c.id, h); replace(r.counter); loadLog(); return r.mark_id } catch (e) {
                  setErr(`That tap did not save (${(e as Error).message}).`); return null
                }
              }}
              onUndo={async (id) => { try { replace((await supportApi.undo(apiBase, classId, c.id, id, h)).counter); loadLog() } catch (e) { setErr((e as Error).message) } }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <span style={mono}>{`last 14 days · ${c.total_14d} marks`}</span>
              <DayBars series={c.series} label={c.label} />
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 18px', alignItems: 'center' }}>
            <ShareSwitch label="Pinned to my class dashboard" checked={pins.includes(c.id)} testId={`sp-pin-${c.id}`}
              onChange={async (v) => {
                try { await supportApi.pin(apiBase, classId, c.id, v, h); setPins((p) => (v ? [...p, c.id] : p.filter((x) => x !== c.id))) } catch (e) { setErr((e as Error).message) }
              }} />
            {c.goal_id && <span style={SMALL}>{`for goal: ${goals.find((g) => g.id === c.goal_id)?.goal || c.goal_id}`}</span>}
            <button type="button" className="al-quiet al-focus" style={{ ...quiet, color: C.faint }}
              onClick={async () => { if (typeof window !== 'undefined' && !window.confirm(`Stop counting "${c.label}"? Its marks stay in the record.`)) return
                try { await supportApi.archiveCounter(apiBase, classId, c.id, h); onChanged() } catch (e) { setErr((e as Error).message) } }}>
              stop counting
            </button>
          </div>
        </div>
      ))}
      <form onSubmit={async (e) => {
        e.preventDefault()
        if (!label.trim()) return
        try { await supportApi.addCounter(apiBase, classId, memberId, label.trim(), goalId || null, h); setLabel(''); setGoalId(''); onChanged() } catch (er) { setErr((er as Error).message) }
      }} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
        <Field label="New counter"><input className="al-field" style={{ ...fieldBox, minHeight: 44 }} value={label} maxLength={60}
          onChange={(e) => setLabel(e.target.value)} placeholder="e.g. On-task checks" data-testid="sp-counter-label" /></Field>
        {goals.length > 0 && (
          <Field label="For goal (optional)">
            <SelectBox value={goalId} onChange={(e) => setGoalId(e.target.value)} aria-label="For goal">
              <option value="">none</option>
              {goals.map((g) => <option key={g.id} value={g.id}>{g.goal}</option>)}
            </SelectBox>
          </Field>
        )}
        <button type="submit" className="al-focus" style={addBtn} disabled={!label.trim()} data-testid="sp-counter-add">Add counter</button>
      </form>
      {log && log.length > 0 && (
        <details>
          <summary style={{ ...quiet, cursor: 'pointer', color: C.dim }}>{`Time log (${log.length})`}</summary>
          <ol style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', maxHeight: 260, overflowY: 'auto' }} data-testid="sp-time-log">
            {log.map((m) => (
              <li key={m.mark_id} style={{ display: 'flex', gap: 12, padding: '6px 0', borderTop: `1px solid ${C.hairline}`, ...SMALL,
                textDecoration: m.voided ? 'line-through' : 'none', color: m.voided ? C.faint : C.dim }}>
                <span style={{ fontFamily: FONT_MONO, fontSize: 12, minWidth: 130 }}>{timeLabel(m.at)}</span>
                <span style={{ flex: 1 }}>{m.label}</span>
                <span style={{ color: C.faint }}>{m.voided ? 'undone' : m.by_you ? 'you' : 'co-teacher'}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  )
}

/** datetime-local text (the viewer's clock) <-> an ISO instant with its offset. */
export function localInputToIso(v: string): string {
  if (!v || /Z$|[+-]\d{2}:\d{2}$/.test(v)) return v
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toISOString()
}
export function isoToLocalInput(v: string): string {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v.slice(0, 16)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const MEETING_BLANK: Meeting = { title: '', kind: 'conference', at: '', purpose: '', questions: [], documents: [], shared: true }

function Meetings({ classId, memberId, apiBase, h, sections }: { classId: string; memberId: string; apiBase: string; h?: Record<string, string>; sections: PassportSection[] }) {
  const [list, setList] = useState<Meeting[] | null>(null)
  const [draft, setDraft] = useState<Meeting | null>(null)
  const [prep, setPrep] = useState<string | null>(null)
  const [doc, setDoc] = useState({ title: '', section: '' })
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { setList((await supportApi.meetings(apiBase, classId, memberId, h)).meetings) } catch { setList([]) }
  }, [apiBase, classId, memberId, h])
  useEffect(() => { load() }, [load])
  const shareable = sections.filter((s) => !s.never_shared)
  const save = async () => {
    if (!draft || !draft.title.trim() || !draft.at) return
    try { await supportApi.saveMeeting(apiBase, classId, memberId, { ...draft, at: localInputToIso(draft.at) }, h); setDraft(null); setErr(null); load() } catch (e) { setErr((e as Error).message) }
  }
  return (
    <section style={cs.tile} data-testid="sp-meetings" aria-labelledby="sp-h-meetings">
      <div id="sp-h-meetings"><TileTitle eyebrow="family support portal">Meetings and what families can prepare</TileTitle></div>
      <p style={{ margin: 0, ...SMALL }}>A shared meeting appears on the family&rsquo;s page with its purpose, your questions, suggested questions and the documents you list. A document tied to a section shows only while that section is shared with the family.</p>
      {err && <p role="alert" style={{ margin: 0, color: C.amber, ...SMALL }}>{err}</p>}
      {(list || []).map((m) => (
        <div key={m.id} style={ROW}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: C.ink, font: `500 15px/1.35 ${FONT_UI}` }}>{m.title}</div>
            <div style={SMALL}>{`${timeLabel(m.at)} · ${m.shared ? 'shared with family' : 'staff only'}${m.documents?.length ? ` · ${m.documents.length} documents` : ''}`}</div>
          </div>
          <button type="button" className="al-quiet al-focus" style={{ ...quiet, minHeight: 32, color: C.accent }} onClick={() => setPrep(prep === m.id ? null : (m.id || null))} data-testid="sp-meeting-prep">prep</button>
          <button type="button" className="al-quiet al-focus" style={{ ...quiet, minHeight: 32 }} onClick={() => setDraft({ ...m, at: isoToLocalInput(m.at), questions: m.questions || [], documents: m.documents || [] })}>edit</button>
          <button type="button" className="al-quiet al-focus" style={{ ...quiet, minHeight: 32, color: C.faint }}
            onClick={async () => { if (m.id) { await supportApi.deleteMeeting(apiBase, classId, memberId, m.id, h).catch(() => undefined); load() } }}>remove</button>
        </div>
      ))}
      {prep && (
        <DraftBox key={prep} title="Meeting prep summary" eyebrow="ai draft · for you only" testId="sp-draft-prep" auto
          hint="Your private prep notes: the passport (never staff notes) and this meeting's plan."
          run={() => supportApi.draftMeetingPrep(apiBase, classId, memberId, prep, h)} />
      )}
      {!draft && <button type="button" className="al-quiet al-focus" style={{ ...quiet, color: C.accent }} onClick={() => setDraft({ ...MEETING_BLANK })} data-testid="sp-meeting-new">+ Plan a meeting</button>}
      {draft && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12, borderRadius: 12, background: C.raise }} data-testid="sp-meeting-form">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <Field label="Meeting"><input className="al-field" style={fieldBox} value={draft.title} maxLength={120} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="Meeting title" /></Field>
            <Field label="Kind">
              <SelectBox value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} aria-label="Meeting kind">
                {Object.entries(REVIEW_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </SelectBox>
            </Field>
            <Field label="When"><input type="datetime-local" className="al-field" style={fieldBox} value={draft.at}
              onChange={(e) => setDraft({ ...draft, at: e.target.value })} aria-label="When" /></Field>
          </div>
          <Field label="Purpose, in plain words" hint="What the meeting is for and what will be decided.">
            <textarea className="al-field" style={{ ...cs.textarea, minHeight: 72 }} maxLength={1000} value={draft.purpose || ''}
              onChange={(e) => setDraft({ ...draft, purpose: e.target.value })} aria-label="Purpose" />
          </Field>
          <div><span style={{ ...help, display: 'block', marginBottom: 6 }}>Questions you suggest the family ask</span>
            <LineList items={draft.questions || []} onChange={(q) => setDraft({ ...draft, questions: q })} placeholder="Add a question" max={20} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={help}>Documents the family may review</span>
            {(draft.documents || []).map((d, i) => (
              <div key={`${d.title}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'center', ...SMALL }}>
                <span style={{ flex: 1 }}>{d.title}{d.section ? ` (from: ${sections.find((s) => s.section === d.section)?.title || d.section})` : ''}</span>
                <button type="button" className="al-quiet al-focus" style={{ ...quiet, minHeight: 32, color: C.faint }} onClick={() => setDraft({ ...draft, documents: (draft.documents || []).filter((_x, j) => j !== i) })}>remove</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input className="al-field" style={{ ...fieldBox, minHeight: 44, flex: 2, minWidth: 160 }} value={doc.title} maxLength={120} placeholder="Document title" aria-label="Document title"
                onChange={(e) => setDoc({ ...doc, title: e.target.value })} />
              <span style={{ flex: 1, minWidth: 160 }}>
                <SelectBox value={doc.section} onChange={(e) => setDoc({ ...doc, section: e.target.value })} aria-label="From passport section">
                  <option value="">not from the passport</option>
                  {shareable.map((s) => <option key={s.section} value={s.section}>{s.title}</option>)}
                </SelectBox>
              </span>
              <button type="button" className="al-focus" style={addBtn} disabled={!doc.title.trim()}
                onClick={() => { setDraft({ ...draft, documents: [...(draft.documents || []), { title: doc.title.trim(), section: doc.section || null }] }); setDoc({ title: '', section: '' }) }}>Add</button>
            </div>
          </div>
          <ShareSwitch label="Share with the family" checked={!!draft.shared} onChange={(v) => setDraft({ ...draft, shared: v })} testId="sp-meeting-shared" />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button type="button" className="al-focus" style={{ ...primary, opacity: draft.title.trim() && draft.at ? 1 : 0.5 }} onClick={save} disabled={!draft.title.trim() || !draft.at} data-testid="sp-meeting-save">Save meeting</button>
            <button type="button" className="al-quiet al-focus" style={quiet} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  )
}

function Passport({ classId, memberId, apiBase, h, onBack }: { classId: string; memberId: string; apiBase: string; h?: Record<string, string>; onBack: () => void }) {
  const [pp, setPp] = useState<StaffPassport | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'offline'>('loading')
  const [saving, setSaving] = useState<SectionKey | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [notes, setNotes] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await supportApi.passport(apiBase, classId, memberId, h)
      setPp(r); setState('ready')
      setNotes(r.sections.find((s) => s.section === 'staff_notes')?.body?.text || '')
    } catch (e) { setState(isNotFound(e) ? 'missing' : 'offline') }
  }, [apiBase, classId, memberId, h])
  useEffect(() => { setState('loading'); load() }, [load])

  const sec = (k: SectionKey) => pp?.sections.find((s) => s.section === k)
  const put = (s: PassportSection) => setPp((cur) => (cur ? { ...cur, sections: cur.sections.map((x) => (x.section === s.section ? s : x)) } : cur))

  const save = async (k: SectionKey, body: unknown) => {
    const cur = sec(k)
    if (!cur) return
    setSaving(k); setErr(null)
    put({ ...cur, body })
    try {
      const r = await supportApi.saveSection(apiBase, classId, memberId, k, body, h)
      put({ ...cur, body: r.body, updated_at: r.updated_at, share_family: r.share_family, share_student: r.share_student })
    } catch (e) { setErr(`${cur.title} did not save: ${(e as Error).message}`); load() } finally { setSaving(null) }
  }
  const share = async (k: SectionKey, v: { share_family?: boolean; share_student?: boolean }) => {
    const cur = sec(k)
    if (!cur) return
    try { const r = await supportApi.share(apiBase, classId, memberId, k, v, h); put({ ...cur, ...r }) } catch (e) { setErr((e as Error).message) }
  }

  if (state === 'loading') return <div style={cs.offline} role="status">Opening the passport…</div>
  if (state === 'missing') return <div style={cs.offline} role="status">That student could not be found in this class.</div>
  if (state === 'offline' || !pp) return <div style={cs.offline} role="status">The passport could not be reached. <button type="button" className="al-quiet al-focus" style={quiet} onClick={load}>Retry</button></div>

  const items = (k: SectionKey) => ((sec(k)?.body?.items || []) as Array<Record<string, any>>) // eslint-disable-line @typescript-eslint/no-explicit-any
  const goals = items('goals') as Goal[]
  const reviews = sec('reviews')?.body || { upcoming: [], actions: [] }
  const tile = (k: SectionKey, body: ReactNode) => {
    const s = sec(k)
    return s ? <Tile key={k} section={s} saving={saving === k} onShare={(v) => share(k, v)}>{body}</Tile> : null
  }
  const lines = (k: SectionKey) => tile(k, <LineList items={items(k) as unknown as string[]} onChange={(next) => save(k, { items: next })}
    placeholder={LINE_HINTS[k] || 'Add'} testId={`sp-lines-${k}`} />)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }} data-testid="sp-passport">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={mono}>support passport</span>
          <h2 style={cs.h2}>{pp.student.alias}</h2>
        </div>
        <button type="button" className="al-quiet al-focus sp-back" style={quiet} onClick={onBack}>← All students</button>
      </div>
      {err && <p role="alert" style={{ margin: 0, color: C.amber, ...SMALL }}>{err}</p>}
      <div className="sp-list">
        {lines('strengths')}
        {lines('interests')}
        {lines('learning_preferences')}
        {lines('calm_plan')}
        {lines('what_works')}
      </div>
      {(pp.checkins || []).length > 0 && (
        <section style={cs.tile} data-testid="sp-checkins" aria-labelledby="sp-h-checkins">
          <div id="sp-h-checkins"><TileTitle eyebrow="the student told you">How they said they feel</TileTitle></div>
          <p style={{ margin: 0, ...SMALL }}>Taps from the student&rsquo;s own Learn home (five fixed feelings, never typed). Families do not see these.</p>
          {(pp.checkins || []).slice(0, 8).map((c) => (
            <div key={c.at} style={{ ...ROW, ...SMALL }}><span style={{ color: C.ink, minWidth: 72 }}>{c.title}</span><span>{timeLabel(c.at)}</span></div>
          ))}
        </section>
      )}
      <DraftBox title="Draft a family update" eyebrow="ai draft · you edit and send" testId="sp-draft-family"
        hint="Built only from the sections you share with this family. Nothing is sent: copy it into your message."
        withFocus run={(v) => supportApi.draftFamilyUpdate(apiBase, classId, memberId, v, h)} />
      {tile('goals', (
        <div>
          <ItemRows items={goals as unknown as Array<Record<string, unknown>>} onRemove={(i) => save('goals', { items: goals.filter((_g, j) => j !== i) })}
            render={(g) => {
              const goal = g as unknown as Goal
              return (
                <div>
                  <div style={{ color: C.ink, font: `500 15px/1.4 ${FONT_UI}` }}>{goal.goal}</div>
                  <div style={SMALL}>{[goal.measure, goal.baseline && `baseline ${goal.baseline}`, goal.target && `target ${goal.target}`, goal.status].filter(Boolean).join(' · ')}</div>
                  <GoalProgress goal={goal} onAdd={(at, value) => save('goals', { items: goals.map((x) => (x.id === goal.id ? { ...x, progress: [...(x.progress || []), { at, value }] } : x)) })} />
                </div>
              )
            }} />
          <ItemForm spec={GOAL_FIELDS} label="Add a goal" onAdd={(it) => save('goals', { items: [...goals, it] })} />
        </div>
      ))}
      {tile('strategies', (
        <div>
          <ItemRows items={items('strategies')} onRemove={(i) => save('strategies', { items: items('strategies').filter((_x, j) => j !== i) })}
            render={(s) => (
              <div>
                <div style={{ color: C.ink, font: `500 15px/1.4 ${FONT_UI}` }}>{String(s.strategy)}</div>
                <div style={SMALL}>{[s.started && `since ${dayLabel(String(s.started))}`, OUTCOME_WORDS[String(s.outcome || '')], s.note].filter(Boolean).join(' · ')}</div>
              </div>
            )} />
          <ItemForm spec={STRATEGY_FIELDS} label="Add a strategy" onAdd={(it) => save('strategies', { items: [...items('strategies'), it] })} />
        </div>
      ))}
      {tile('accommodations', (
        <div>
          <ItemRows items={items('accommodations')} onRemove={(i) => save('accommodations', { items: items('accommodations').filter((_x, j) => j !== i) })}
            render={(s) => (
              <div>
                <div style={{ color: C.ink, font: `500 15px/1.4 ${FONT_UI}` }}>{String(s.support)}</div>
                <div style={SMALL}>{[SUPPORT_KIND_WORDS[String(s.kind || 'accommodation')], s.owner && `by ${s.owner}`, s.when].filter(Boolean).join(' · ')}</div>
              </div>
            )} />
          <ItemForm spec={SUPPORT_FIELDS} label="Add a support" onAdd={(it) => save('accommodations', { items: [...items('accommodations'), it] })} />
        </div>
      ))}
      {tile('reviews', (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={mono}>upcoming</span>
          <ItemRows items={reviews.upcoming} onRemove={(i) => save('reviews', { ...reviews, upcoming: reviews.upcoming.filter((_x: unknown, j: number) => j !== i) })}
            render={(r) => <div style={{ color: C.ink, font: `400 15px/1.4 ${FONT_UI}` }}>{`${r.date ? `${dayLabel(String(r.date))} · ` : ''}${r.title}`}<span style={SMALL}>{` · ${REVIEW_KINDS[String(r.kind || 'other')]}`}</span></div>} />
          <ItemForm spec={REVIEW_FIELDS} label="Add a review" onAdd={(it) => save('reviews', { ...reviews, upcoming: [...reviews.upcoming, it] })} />
          <span style={mono}>open actions</span>
          <ItemRows items={reviews.actions} onRemove={(i) => save('reviews', { ...reviews, actions: reviews.actions.filter((_x: unknown, j: number) => j !== i) })}
            render={(a) => (
              <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!a.done} style={{ width: 18, height: 18, marginTop: 2, accentColor: C.accent }}
                  onChange={(e) => save('reviews', { ...reviews, actions: reviews.actions.map((x: Record<string, unknown>) => (x === a ? { ...x, done: e.target.checked } : x)) })} />
                <span style={{ color: a.done ? C.faint : C.ink, textDecoration: a.done ? 'line-through' : 'none', font: `400 15px/1.4 ${FONT_UI}` }}>
                  {String(a.text)}<span style={SMALL}>{[a.owner && ` · ${a.owner}`, a.due && ` · due ${dayLabel(String(a.due))}`].filter(Boolean).join('')}</span>
                </span>
              </label>
            )} />
          <ItemForm spec={ACTION_FIELDS} label="Add an action" onAdd={(it) => save('reviews', { ...reviews, actions: [...reviews.actions, { ...it, done: false }] })} />
        </div>
      ))}
      {tile('data', (
        <DataSection classId={classId} memberId={memberId} apiBase={apiBase} h={h} counters={pp.counters} pinned={pp.pinned} goals={goals} onChanged={load} />
      ))}
      {tile('staff_notes', (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea className="al-field" style={cs.textarea} maxLength={8000} value={notes} onChange={(e) => setNotes(e.target.value)}
            aria-label="Staff notes" data-testid="sp-staff-notes" placeholder="Notes for staff only." />
          <div><button type="button" className="al-focus" style={addBtn} onClick={() => save('staff_notes', { text: notes })} data-testid="sp-staff-notes-save">Save notes</button></div>
        </div>
      ))}
      <Meetings classId={classId} memberId={memberId} apiBase={apiBase} h={h} sections={pp.sections} />
    </div>
  )
}

/** An AI draft the teacher edits and copies. There is deliberately no send button. */
function DraftBox({ title, eyebrow, hint, testId, run, withFocus, auto }: {
  title: string; eyebrow: string; hint: string; testId: string
  run: (v: { focus?: string; tone?: string }) => Promise<Draft>; withFocus?: boolean; auto?: boolean
}) {
  const [focus, setFocus] = useState('')
  const [tone, setTone] = useState('warm')
  const [d, setD] = useState<Draft | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const go = useCallback(async () => {
    setBusy(true); setErr(null); setCopied(false)
    try { const r = await run({ focus: focus.trim() || undefined, tone }); setD(r); setText(r.draft) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }, [run, focus, tone])
  useEffect(() => { if (auto) go() }, [auto]) // eslint-disable-line react-hooks/exhaustive-deps
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true) } catch { setErr('Copy did not work here: select the text and copy it.') }
  }
  return (
    <section style={cs.tile} data-testid={testId}>
      <TileTitle eyebrow={eyebrow}>{title}</TileTitle>
      <p style={{ margin: 0, ...SMALL }}>{hint}</p>
      {withFocus && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
          <Field label="Anything to mention (optional)">
            <input className="al-field" style={{ ...fieldBox, minWidth: 220 }} value={focus} maxLength={300} onChange={(e) => setFocus(e.target.value)} aria-label="Anything to mention" />
          </Field>
          <Field label="Tone">
            <SelectBox value={tone} onChange={(e) => setTone(e.target.value)} aria-label="Tone">
              <option value="warm">warm</option><option value="brief">brief</option><option value="formal">formal</option>
            </SelectBox>
          </Field>
          <button type="button" className="al-focus" style={addBtn} onClick={go} disabled={busy} data-testid={`${testId}-go`}>{busy ? 'Drafting…' : d ? 'Draft again' : 'Draft it'}</button>
        </div>
      )}
      {!withFocus && busy && <p role="status" style={{ margin: 0, ...SMALL }}>Drafting on your school&rsquo;s own model…</p>}
      {err && <p role="alert" style={{ margin: 0, color: C.amber, ...SMALL }}>{err}</p>}
      {d && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea className="al-field" style={{ ...cs.textarea, minHeight: 160 }} value={text} onChange={(e) => setText(e.target.value)}
            aria-label={`${title}: edit before you send`} data-testid={`${testId}-text`} />
          {d.source === 'template' && <p style={{ margin: 0, ...SMALL }} data-testid={`${testId}-template`}>The AI model was not available{d.reason ? ` (${d.reason.replace(/_/g, ' ')})` : ''}, so this is a plain starting point built from the passport.</p>}
          {d.warnings.map((w) => <p key={w} role="note" style={{ margin: 0, color: C.amber, ...SMALL }}>{w}</p>)}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="al-focus" style={addBtn} onClick={copy} data-testid={`${testId}-copy`}>{copied ? 'Copied' : 'Copy'}</button>
            <span style={SMALL}>{d.note}</span>
          </div>
        </div>
      )}
    </section>
  )
}

const PANEL_CSS = `
.sp-shell{display:grid;grid-template-columns:1fr;gap:20px}
.sp-roster{display:flex;flex-direction:column}
.sp-shell[data-open] .sp-roster{display:none}
@media (min-width:760px){
  .sp-shell{grid-template-columns:minmax(240px,300px) minmax(0,1fr)}
  .sp-shell[data-open] .sp-roster{display:flex}
  .sp-back{display:none!important}
}
`

export default function ClassroomSupportPanel({ classId, apiBase = SUPPORT_API, extraHeaders, initialMember }: ClassroomSupportPanelProps) {
  const [roster, setRoster] = useState<RosterLine[] | null>(null)
  const [name, setName] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'offline'>('loading')
  const [open, setOpen] = useState<string | null>(initialMember || null)

  const load = useCallback(async () => {
    try {
      const r = await supportApi.roster(apiBase, classId, extraHeaders)
      setRoster(r.students); setName(r.class_name); setState('ready')
    } catch (e) { setState(isNotFound(e) ? 'missing' : 'offline') }
  }, [apiBase, classId, extraHeaders])
  useEffect(() => { load() }, [load])

  const sorted = useMemo(() => [...(roster || [])].sort((a, b) => (a.alias || '').localeCompare(b.alias || '')), [roster])

  return (
    <div className="cr-col" data-testid="classroom-support-panel">
      <style>{LEARN_CSS + CLASSROOM_CSS + SUPPORT_CSS + PANEL_CSS}</style>
      <div className="cr-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={mono}>{name ? `support · ${name}` : 'support'}</span>
          <h1 style={cs.h1}>Support passports</h1>
          <p style={cs.sub}>What helps each student, in one place: strengths, what was tried, goals and progress, supports and who owns them, and what is due next.</p>
        </div>
      </div>
      {state === 'loading' && <div style={cs.offline} role="status">Loading the class…</div>}
      {state === 'missing' && <div style={cs.offline} role="status" data-testid="sp-missing">That class could not be found.</div>}
      {state === 'offline' && <div style={cs.offline} role="status">The class could not be reached. <button type="button" className="al-quiet al-focus" style={quiet} onClick={load}>Retry</button></div>}
      {state === 'ready' && (
        <div className="sp-shell" data-open={open ? '' : undefined}>
          <nav className="sp-roster" aria-label="Students" style={{ minWidth: 0 }}>
            {sorted.length === 0 && <p style={{ margin: 0, ...SMALL }}>No students on the roster yet.</p>}
            {sorted.map((s) => (
              <button key={s.member_id} type="button" className="al-focus" onClick={() => setOpen(s.member_id)} aria-current={open === s.member_id ? 'true' : undefined}
                data-testid="sp-roster-row"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, minHeight: 60, padding: '10px 12px', textAlign: 'left',
                  border: 'none', borderTop: `1px solid ${C.hairline}`, cursor: 'pointer', borderRadius: 0,
                  background: open === s.member_id ? C.accentWash : 'transparent', color: C.ink }}>
                <span style={{ font: `500 16px/1.25 ${FONT_UI}` }}>{s.alias}</span>
                <span style={SMALL}>
                  {[`${s.sections_filled} of ${s.sections_total} sections`, s.next_review && `review ${dayLabel(s.next_review)}`,
                    s.open_actions ? `${s.open_actions} open action${s.open_actions === 1 ? '' : 's'}` : '', s.counters ? `${s.counters} counter${s.counters === 1 ? '' : 's'}` : '']
                    .filter(Boolean).join(' · ')}
                </span>
              </button>
            ))}
          </nav>
          <div style={{ minWidth: 0 }}>
            {open ? (
              <Passport key={open} classId={classId} memberId={open} apiBase={apiBase} h={extraHeaders} onBack={() => { setOpen(null); load() }} />
            ) : (
              <div style={{ ...cs.offline, paddingTop: 8 }}>Choose a student to open their passport.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
