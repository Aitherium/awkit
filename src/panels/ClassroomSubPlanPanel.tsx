/**
 * Substitute mode (awkit): the teacher writes the day's plan and shares a link that
 * expires; the substitute opens the link and sees that plan and nothing else.
 *
 * ClassroomSubPlanPanel  the teacher's builder: daily schedule, lesson instructions, a
 *                        seating chart (filled from the roster's first names), routines,
 *                        emergency procedures and who to call. "Share with a substitute"
 *                        mints a link for N hours (max from the server); the link is shown
 *                        ONCE, with its expiry; open links list their opens and revoke.
 * SubPlanView            the read-only plan (the substitute page and the teacher preview).
 * SubstituteView         the substitute's page body: reads the token from the URL fragment,
 *                        asks Hearth once, renders SubPlanView or "this link has ended".
 *
 * Spec: docs/plans/2026-10-17-classroom-support-suite.md (slice 2).
 */
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { C, FONT_MONO, FONT_UI, LEARN_CSS } from './learnTheme'
import { Field, fieldBox, help, mono, primary, quiet } from './learnParts'
import { CLASSROOM_CSS, cs, isNotFound } from './classroomApi'
import { SUPPORT_API, subLinkUrl, subTokenFromHash, supportApi, type SubPlan, type SubPlanBody, type SubView } from './classroomSupportApi'
import { LineList, SUPPORT_CSS, TileTitle, addBtn, dayLabel, timeLabel } from './supportParts'

export function blankPlan(names: string[] = []): SubPlanBody {
  const cols = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(names.length || 1))))
  const rows = Math.max(1, Math.ceil((names.length || 1) / cols))
  return {
    title: '', day: '', schedule: [], lessons: [], routines: [], emergency: [], contacts: [], notes: '',
    seating: { rows, cols, front: 'Board', seats: names.slice(0, rows * cols).map((name, i) => ({ r: Math.floor(i / cols), c: i % cols, name })) },
  }
}

const SMALL: CSSProperties = { font: `400 13px/1.45 ${FONT_UI}`, color: C.dim }

export function SeatingChart({ seating, onSeat }: { seating: SubPlanBody['seating']; onSeat?: (r: number, c: number, name: string) => void }) {
  const at = (r: number, c: number) => seating.seats.find((s) => s.r === r && s.c === c)?.name || ''
  if (!seating.rows || !seating.cols) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="sub-seating">
      <div style={{ textAlign: 'center', ...mono, padding: '6px 0', borderRadius: 8, background: C.raise }}>{(seating.front || 'Board').toLowerCase()}</div>
      <div role="grid" aria-label="Seating chart" style={{ display: 'grid', gridTemplateColumns: `repeat(${seating.cols}, minmax(0, 1fr))`, gap: 6 }}>
        {Array.from({ length: seating.rows }).map((_r, r) => Array.from({ length: seating.cols }).map((_c, c) => (
          <div key={`${r}-${c}`} role="gridcell" style={{ minHeight: 44, borderRadius: 10, border: `1px solid ${C.hairline}`, background: C.surface,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 4, minWidth: 0 }}>
            {onSeat ? (
              <input className="al-field" aria-label={`Seat row ${r + 1} column ${c + 1}`} value={at(r, c)} maxLength={40}
                onChange={(e) => onSeat(r, c, e.target.value)}
                style={{ width: '100%', minWidth: 0, border: 'none', background: 'transparent', color: C.ink, textAlign: 'center', font: `400 13px/1.2 ${FONT_UI}` }} />
            ) : (
              <span style={{ font: `400 13px/1.2 ${FONT_UI}`, color: at(r, c) ? C.ink : C.faint, overflowWrap: 'anywhere', textAlign: 'center' }}>{at(r, c) || '·'}</span>
            )}
          </div>
        )))}
      </div>
    </div>
  )
}

/** The plan, read-only: what a substitute needs, in the order they need it. */
export function SubPlanView({ plan, className, expiresAt }: { plan: SubPlanBody; className?: string; expiresAt?: string }) {
  const block = (title: string, children: ReactNode, testId?: string) => (
    <section style={cs.tile} data-testid={testId}><TileTitle>{title}</TileTitle>{children}</section>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} data-testid="sub-plan-view">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={mono}>{`substitute plan${className ? ` · ${className}` : ''}`}</span>
        <h1 style={cs.h1}>{plan.title || 'Today'}</h1>
        <p style={cs.sub}>{[plan.day && dayLabel(plan.day), expiresAt && `this page closes ${timeLabel(expiresAt)}`].filter(Boolean).join(' · ')}</p>
      </div>
      {plan.emergency.length > 0 && block('Emergency procedures', (
        <ul style={{ margin: 0, paddingLeft: 18, color: C.ink, font: `400 15px/1.5 ${FONT_UI}` }}>{plan.emergency.map((e, i) => <li key={i}>{e}</li>)}</ul>
      ), 'sub-emergency')}
      {plan.schedule.length > 0 && block('Schedule', (
        <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {plan.schedule.map((s, i) => (
            <li key={i} style={{ display: 'flex', gap: 14, padding: '8px 0', borderTop: `1px solid ${C.hairline}` }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: 13, color: C.dim, minWidth: 64 }}>{s.time}</span>
              <span style={{ color: C.ink, font: `400 15px/1.45 ${FONT_UI}` }}>{s.what}</span>
            </li>
          ))}
        </ol>
      ), 'sub-schedule')}
      {plan.lessons.map((l, i) => block(`${l.when ? `${l.when} · ` : ''}${l.title}`, (
        <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: C.ink, font: `400 15px/1.55 ${FONT_UI}` }}>{l.steps}</p>
      ), `sub-lesson-${i}`))}
      {plan.seating.rows > 0 && block('Seating chart', <SeatingChart seating={plan.seating} />)}
      {plan.routines.length > 0 && block('Routines', (
        <ul style={{ margin: 0, paddingLeft: 18, color: C.ink, font: `400 15px/1.5 ${FONT_UI}` }}>{plan.routines.map((e, i) => <li key={i}>{e}</li>)}</ul>
      ))}
      {plan.contacts.length > 0 && block('Who to call', (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {plan.contacts.map((c, i) => <li key={i} style={{ padding: '6px 0', borderTop: `1px solid ${C.hairline}`, color: C.ink, font: `400 15px/1.45 ${FONT_UI}` }}>{c.role}<span style={SMALL}>{c.how ? ` · ${c.how}` : ''}</span></li>)}
        </ul>
      ))}
      {plan.notes && block('Notes', <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: C.ink, font: `400 15px/1.55 ${FONT_UI}` }}>{plan.notes}</p>)}
    </div>
  )
}

function PairList({ items, onChange, a, b, aLabel, bLabel, long }: {
  items: Array<Record<string, string>>; onChange: (v: Array<Record<string, string>>) => void
  a: string; b: string; aLabel: string; bLabel: string; long?: boolean
}) {
  const [da, setDa] = useState('')
  const [db, setDb] = useState('')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', ...SMALL, color: C.ink, borderTop: `1px solid ${C.hairline}`, paddingTop: 6 }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 12, minWidth: 56, color: C.dim }}>{it[a]}</span>
          <span style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{it[b]}</span>
          <button type="button" className="al-quiet al-focus" style={{ ...quiet, minHeight: 28, color: C.faint }} onClick={() => onChange(items.filter((_x, j) => j !== i))}>remove</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <input className="al-field" style={{ ...fieldBox, minHeight: 44, width: 120 }} value={da} onChange={(e) => setDa(e.target.value)} placeholder={aLabel} aria-label={aLabel} maxLength={40} />
        {long ? (
          <textarea className="al-field" style={{ ...cs.textarea, minHeight: 64, flex: 1, minWidth: 180 }} value={db} onChange={(e) => setDb(e.target.value)} placeholder={bLabel} aria-label={bLabel} maxLength={2000} />
        ) : (
          <input className="al-field" style={{ ...fieldBox, minHeight: 44, flex: 1, minWidth: 180 }} value={db} onChange={(e) => setDb(e.target.value)} placeholder={bLabel} aria-label={bLabel} maxLength={200} />
        )}
        <button type="button" className="al-focus" style={addBtn} disabled={!db.trim()}
          onClick={() => { onChange([...items, { [a]: da.trim(), [b]: db.trim() }]); setDa(''); setDb('') }}>Add</button>
      </div>
    </div>
  )
}

export interface ClassroomSubPlanPanelProps { classId: string; apiBase?: string; extraHeaders?: Record<string, string>; origin?: string }

export default function ClassroomSubPlanPanel({ classId, apiBase = SUPPORT_API, extraHeaders, origin }: ClassroomSubPlanPanelProps) {
  const [plans, setPlans] = useState<SubPlan[] | null>(null)
  const [names, setNames] = useState<string[]>([])
  const [maxHours, setMaxHours] = useState(72)
  const [className, setClassName] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'offline'>('loading')
  const [editing, setEditing] = useState<{ id: string | null; plan: SubPlanBody } | null>(null)
  const [hours, setHours] = useState(10)
  const [fresh, setFresh] = useState<{ planId: string; url: string; expires: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await supportApi.subPlans(apiBase, classId, extraHeaders)
      setPlans(r.plans); setNames(r.roster_names); setMaxHours(r.max_hours); setClassName(r.class_name); setState('ready')
    } catch (e) { setState(isNotFound(e) ? 'missing' : 'offline') }
  }, [apiBase, classId, extraHeaders])
  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!editing || !editing.plan.title.trim()) return
    try {
      const r = await supportApi.saveSubPlan(apiBase, classId, editing.id, editing.plan, extraHeaders)
      setEditing(null); setErr(null); await load()
      return r
    } catch (e) { setErr(`The plan did not save: ${(e as Error).message}`); return undefined }
  }
  const mint = async (planId: string) => {
    try {
      const r = await supportApi.mintSubLink(apiBase, classId, planId, hours, extraHeaders)
      const base = origin || (typeof window !== 'undefined' ? window.location.origin : '')
      setFresh({ planId, url: subLinkUrl(base, r.token), expires: r.expires_at })
      load()
    } catch (e) { setErr((e as Error).message) }
  }

  const set = (patch: Partial<SubPlanBody>) => setEditing((cur) => (cur ? { ...cur, plan: { ...cur.plan, ...patch } } : cur))
  const seat = (r: number, c: number, name: string) => setEditing((cur) => {
    if (!cur) return cur
    const seats = cur.plan.seating.seats.filter((s) => !(s.r === r && s.c === c))
    if (name) seats.push({ r, c, name })
    return { ...cur, plan: { ...cur.plan, seating: { ...cur.plan.seating, seats } } }
  })

  return (
    <div className="cr-col" data-testid="classroom-sub-panel">
      <style>{LEARN_CSS + CLASSROOM_CSS + SUPPORT_CSS}</style>
      <div className="cr-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={mono}>{className ? `substitute · ${className}` : 'substitute'}</span>
          <h1 style={cs.h1}>Substitute plans</h1>
          <p style={cs.sub}>Write the day once. A substitute gets a link that shows only this plan, for the hours you choose. They never see your dashboard, the students&rsquo; records or family messages.</p>
        </div>
      </div>
      {state === 'loading' && <div style={cs.offline} role="status">Loading…</div>}
      {state === 'missing' && <div style={cs.offline} role="status">That class could not be found.</div>}
      {state === 'offline' && <div style={cs.offline} role="status">Plans could not be reached. <button type="button" className="al-quiet al-focus" style={quiet} onClick={load}>Retry</button></div>}
      {err && <p role="alert" style={{ margin: 0, color: C.amber, ...SMALL }}>{err}</p>}
      {state === 'ready' && !editing && (
        <>
          <div><button type="button" className="al-focus" style={primary} onClick={() => setEditing({ id: null, plan: blankPlan(names) })} data-testid="sub-new">New plan</button></div>
          {(plans || []).length === 0 && <p style={{ margin: 0, ...SMALL }}>No plans yet.</p>}
          <div className="cr-grid">
            {(plans || []).map((p) => {
              const live = p.links.filter((l) => l.live)
              return (
                <section key={p.id} style={cs.tile} data-testid="sub-plan">
                  <TileTitle eyebrow={p.plan.day ? dayLabel(p.plan.day) : 'any day'}>{p.plan.title}</TileTitle>
                  <span style={SMALL}>{`${p.plan.schedule.length} schedule rows · ${p.plan.lessons.length} lessons · ${p.plan.emergency.length} emergency steps`}</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <button type="button" className="al-focus" style={addBtn} onClick={() => setEditing({ id: p.id, plan: p.plan })}>Edit</button>
                    <label style={{ ...SMALL, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      for
                      <input type="number" min={1} max={maxHours} value={hours} aria-label="Hours the link stays open"
                        onChange={(e) => setHours(Math.max(1, Math.min(maxHours, Number(e.target.value) || 1)))}
                        className="al-field" style={{ ...fieldBox, minHeight: 40, width: 72, padding: '8px 10px' }} />
                      hours
                    </label>
                    <button type="button" className="al-focus" style={{ ...addBtn, background: C.accent, color: C.onAccent, border: 'none' }} onClick={() => mint(p.id)} data-testid="sub-share">Share with a substitute</button>
                  </div>
                  {fresh && fresh.planId === p.id && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderRadius: 12, background: C.accentWash }} data-testid="sub-fresh-link">
                      <span style={{ ...SMALL, color: C.ink }}>{`Send this link to the substitute. It opens this plan only, until ${timeLabel(fresh.expires)}. It is shown once.`}</span>
                      <input readOnly value={fresh.url} className="al-field" style={{ ...fieldBox, minHeight: 44, fontFamily: FONT_MONO, fontSize: 12 }} aria-label="Substitute link"
                        onFocus={(e) => e.currentTarget.select()} />
                      <div><button type="button" className="al-quiet al-focus" style={{ ...quiet, color: C.accent }}
                        onClick={() => { navigator.clipboard?.writeText(fresh.url).catch(() => undefined) }}>Copy link</button></div>
                    </div>
                  )}
                  {live.length > 0 && (
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                      {live.map((l) => (
                        <li key={l.id} style={{ display: 'flex', gap: 10, alignItems: 'center', borderTop: `1px solid ${C.hairline}`, paddingTop: 6, ...SMALL }}>
                          <span style={{ flex: 1 }}>{`open until ${timeLabel(l.expires_at)} · opened ${l.opens} time${l.opens === 1 ? '' : 's'}`}</span>
                          <button type="button" className="al-quiet al-focus" style={{ ...quiet, minHeight: 32, color: C.amber }} data-testid="sub-revoke"
                            onClick={async () => { await supportApi.revokeSubLink(apiBase, classId, p.id, l.id, extraHeaders).catch((e) => setErr((e as Error).message)); load() }}>end now</button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div><button type="button" className="al-quiet al-focus" style={{ ...quiet, color: C.faint }}
                    onClick={async () => { if (typeof window !== 'undefined' && !window.confirm('Delete this plan? Its links stop working.')) return
                      await supportApi.deleteSubPlan(apiBase, classId, p.id, extraHeaders).catch((e) => setErr((e as Error).message)); load() }}>delete plan</button></div>
                </section>
              )
            })}
          </div>
        </>
      )}
      {editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} data-testid="sub-editor">
          <section style={cs.tile}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <Field label="Plan name"><input className="al-field" style={fieldBox} value={editing.plan.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} data-testid="sub-title" /></Field>
              <Field label="Day (optional)"><input type="date" className="al-field" style={fieldBox} value={editing.plan.day || ''} onChange={(e) => set({ day: e.target.value })} aria-label="Day" /></Field>
            </div>
          </section>
          <section style={cs.tile}><TileTitle>Schedule</TileTitle>
            <PairList items={editing.plan.schedule} onChange={(v) => set({ schedule: v as SubPlanBody['schedule'] })} a="time" b="what" aLabel="Time" bLabel="What happens" />
          </section>
          <section style={cs.tile}><TileTitle>Lessons</TileTitle>
            {editing.plan.lessons.map((l, i) => (
              <div key={i} style={{ borderTop: `1px solid ${C.hairline}`, paddingTop: 8, ...SMALL, color: C.ink }}>
                <strong style={{ fontWeight: 500 }}>{`${l.when ? `${l.when} · ` : ''}${l.title}`}</strong>
                <div style={{ whiteSpace: 'pre-wrap' }}>{l.steps}</div>
                <button type="button" className="al-quiet al-focus" style={{ ...quiet, minHeight: 28, color: C.faint }} onClick={() => set({ lessons: editing.plan.lessons.filter((_x, j) => j !== i) })}>remove</button>
              </div>
            ))}
            <LessonForm onAdd={(l) => set({ lessons: [...editing.plan.lessons, l] })} />
          </section>
          <section style={cs.tile}><TileTitle>Seating chart</TileTitle>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {(['rows', 'cols'] as const).map((k) => (
                <label key={k} style={{ ...SMALL, display: 'inline-flex', alignItems: 'center', gap: 6 }}>{k === 'rows' ? 'Rows' : 'Columns'}
                  <input type="number" min={0} max={12} value={editing.plan.seating[k]} className="al-field" style={{ ...fieldBox, minHeight: 40, width: 72, padding: '8px 10px' }}
                    onChange={(e) => {
                      const n = Math.max(0, Math.min(12, Number(e.target.value) || 0))
                      const seating = { ...editing.plan.seating, [k]: n }
                      seating.seats = seating.seats.filter((s) => s.r < seating.rows && s.c < seating.cols)
                      set({ seating })
                    }} />
                </label>
              ))}
            </div>
            <span style={help}>Type a name in each seat. The chart starts from your roster&rsquo;s first names.</span>
            <SeatingChart seating={editing.plan.seating} onSeat={seat} />
          </section>
          <section style={cs.tile}><TileTitle>Routines</TileTitle>
            <LineList items={editing.plan.routines} onChange={(v) => set({ routines: v })} placeholder="e.g. Line up by the door after the bell" max={20} />
          </section>
          <section style={cs.tile}><TileTitle>Emergency procedures</TileTitle>
            <LineList items={editing.plan.emergency} onChange={(v) => set({ emergency: v })} placeholder="e.g. Fire: exit left, meet on the field" max={20} testId="sub-emergency-list" />
          </section>
          <section style={cs.tile}><TileTitle>Who to call</TileTitle>
            <PairList items={editing.plan.contacts} onChange={(v) => set({ contacts: v as SubPlanBody['contacts'] })} a="role" b="how" aLabel="Who" bLabel="How to reach them" />
          </section>
          <section style={cs.tile}><TileTitle>Notes</TileTitle>
            <textarea className="al-field" style={cs.textarea} maxLength={2000} value={editing.plan.notes || ''} onChange={(e) => set({ notes: e.target.value })} aria-label="Notes" />
          </section>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button type="button" className="al-focus" style={{ ...primary, opacity: editing.plan.title.trim() ? 1 : 0.5 }} disabled={!editing.plan.title.trim()} onClick={save} data-testid="sub-save">Save plan</button>
            <button type="button" className="al-quiet al-focus" style={quiet} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

function LessonForm({ onAdd }: { onAdd: (l: { when: string; title: string; steps: string }) => void }) {
  const [l, setL] = useState({ when: '', title: '', steps: '' })
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <input className="al-field" style={{ ...fieldBox, minHeight: 44, width: 120 }} value={l.when} maxLength={40} placeholder="When" aria-label="Lesson time" onChange={(e) => setL({ ...l, when: e.target.value })} />
      <input className="al-field" style={{ ...fieldBox, minHeight: 44, flex: 1, minWidth: 180 }} value={l.title} maxLength={120} placeholder="Lesson" aria-label="Lesson title" onChange={(e) => setL({ ...l, title: e.target.value })} />
      <textarea className="al-field" style={{ ...cs.textarea, minHeight: 72, width: '100%' }} value={l.steps} maxLength={2000} placeholder="Step by step instructions" aria-label="Lesson steps" onChange={(e) => setL({ ...l, steps: e.target.value })} />
      <button type="button" className="al-focus" style={addBtn} disabled={!l.title.trim()} onClick={() => { onAdd({ when: l.when.trim(), title: l.title.trim(), steps: l.steps.trim() }); setL({ when: '', title: '', steps: '' }) }}>Add lesson</button>
    </div>
  )
}

/** The substitute's page body. No session: the link token is the only key, read from the
 *  fragment and sent in a header. */
export function SubstituteView({ apiBase = SUPPORT_API, hash }: { apiBase?: string; hash?: string }) {
  const [view, setView] = useState<SubView | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'ended' | 'offline'>('loading')
  useEffect(() => {
    const token = subTokenFromHash(hash ?? (typeof window !== 'undefined' ? window.location.hash : ''))
    if (!token) { setState('ended'); return }
    supportApi.subView(apiBase, token).then((v) => { setView(v); setState('ready') })
      .catch((e) => setState(isNotFound(e) ? 'ended' : 'offline'))
  }, [apiBase, hash])
  return (
    <div className="cr-col" data-testid="substitute-view">
      <style>{LEARN_CSS + CLASSROOM_CSS + SUPPORT_CSS}</style>
      {state === 'loading' && <div style={cs.offline} role="status">Opening the plan…</div>}
      {state === 'ended' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} role="status" data-testid="substitute-ended">
          <span style={mono}>substitute plan</span>
          <h1 style={cs.h1}>This link has ended</h1>
          <p style={cs.sub}>Substitute links open one plan for a few hours. Ask the teacher or the front office for a new one.</p>
        </div>
      )}
      {state === 'offline' && <div style={cs.offline} role="status">The plan could not be reached. Check your connection and reload.</div>}
      {state === 'ready' && view && <SubPlanView plan={view.plan} className={view.class_name} expiresAt={view.expires_at} />}
    </div>
  )
}
