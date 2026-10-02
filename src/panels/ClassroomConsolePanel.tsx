/**
 * ClassroomConsolePanel: the teacher's home in Aither Classroom.
 *
 * Backed by Genesis /api/v1/classroom/* through the host's proxy (apiBase):
 * GET /classes, /classes/{id}/roster, /assignments, /hard-now, /review-queue;
 * POST /classes, /classes/{id}/assignments, /classes/{id}/responses/{rid}/review.
 * The router answers 404 to anyone who is not the teacher of record, so this
 * panel holds no authorization logic.
 *
 * One primary action: "Assign". Everything else is a quiet link. The heatmap is
 * an observation of practice (error rate, hints, felt-hard), never a label; rows
 * with fewer than three students are suppressed by the server and say so here.
 * A machine score is provisional until the teacher confirms or overrides it.
 *
 * The demo class (GET /demo, POST /demo/seed, DELETE /demo): a teacher with nothing
 * to look at yet can ask for one class of FICTIONAL students. It wears a "demo"
 * mark in the header, in the class picker and in a strip above the tiles, so it can
 * never read as a real class; the strip refreshes or removes it. Building it is
 * never faked: the offer says "building", then shows the class or says it failed.
 * The mark comes from the class payload itself (`demo: true` on GET /classes), so a
 * failed GET /demo cannot unmark a demo class; while GET /demo has no answer the
 * console does not know whether the teacher has a demo, and offers none.
 * A removal whose class room Relay did not confirm is queued by the server
 * (POST /room/teardowns/retry); the console says so and offers to finish it.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import ClassroomNoticesBell from './ClassroomNoticesBell'
import { C, FONT_MONO, FONT_UI, LEARN_CSS, LearnModeSwitch } from './learnTheme'
import { Field, SelectBox, Sheet, SheetHeading, Skel, fieldBox, help, mono, primary, quiet } from './learnParts'
import {
  CLASSROOM_API, CLASSROOM_CSS, classroomFetch, cs, cseg, heatLayer, loadStateOf, pct, send,
  useClassroomSurface,
  type Assignment, type ClassroomClass, type DemoRemoveResult, type DemoSeedResult, type DemoStatus, type DemoView,
  type HardNow, type HardNowRow, type Lesson, type LoadState, type ReviewItem, type Roster,
} from './classroomApi'

export interface ClassroomConsolePanelProps {
  /** Classroom proxy base, default '/api/classroom'. */
  apiBase?: string
  /** Academy base for the lesson list (assignable = published lessons). Required: the host must serve an
   *  authenticated Academy proxy and name it here, or Assign has no lessons to offer. */
  academyBase: string
  /** Open this class first. */
  classId?: string
  /** Host navigation to the class room (e.g. /classroom/{id}). */
  onOpenRoom?: (classId: string) => void
  /** The class now showing (null = none yet), once the class list has loaded. Lets a host that puts
   *  other class panels beside this one (roster, studio, insights) follow the teacher's selection. */
  onActiveClass?: (cls: ClassroomClass | null) => void
  extraHeaders?: Record<string, string>
}

const GRADES = ['K-2', '3-5', '6-8', '9-12'] as const

interface ClassData {
  roster: Roster | null
  assignments: Assignment[] | null
  hard: HardNow | null
  review: ReviewItem[] | null
  failed: string[]
}

type DemoBusy = 'building' | 'removing' | null

/** The quiet door to the demo class, shown wherever the console has nothing to show yet. */
function DemoOffer({ busy, failed, onSeed }: { busy: DemoBusy; failed: boolean; onSeed: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start', borderTop: `1px solid ${C.hairline}`, paddingTop: 14 }} data-testid="demo-offer">
      <span style={mono}>or look around first</span>
      <p style={{ ...help, margin: 0 }}>
        {"A demo class of fictional students fills every view: roster, assigned work, what is hard right now, work to review, the class room and a parent's page. Nothing is sent to anyone, and one step removes it."}
      </p>
      {busy === 'building'
        ? <span style={{ ...mono, minHeight: 44, display: 'inline-flex', alignItems: 'center' }} role="status" data-testid="demo-building">building the demo class</span>
        : <button type="button" className="al-quiet al-focus" style={{ ...quiet, color: C.accent }} onClick={onSeed} disabled={busy !== null} data-testid="demo-seed">See it with a demo class</button>}
      {failed && <span role="status" style={{ ...help, color: C.amber }} data-testid="demo-failed">The demo class could not be built just now. Nothing was created.</span>}
    </div>
  )
}

/** Above the tiles of a demo class: what it is, and the two things a teacher can do with it. */
function DemoStrip({ view, busy, onRefresh, onRemove }: { view: DemoView | null; busy: DemoBusy; onRefresh: () => void; onRemove: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const alias = view?.parent_view?.alias
  return (
    <div style={cs.demoStrip} role="note" data-testid="demo-strip">
      <span style={{ flex: '1 1 260px', minWidth: 0 }}>
        <span style={{ ...cs.demoMark, marginRight: 10 }}>demo</span>
        Every student and parent in this class is fictional. Nothing here is sent to anyone.
        {view?.stale && ' This practice is a few days old: refresh to bring it up to date.'}
        {alias && <span style={{ ...help, display: 'block', color: C.dim }}>{`You are linked as a demo parent of ${alias}, so the parent page shows this class too.`}</span>}
      </span>
      {busy !== null && <span style={mono} role="status">{busy === 'building' ? 'rebuilding' : 'removing'}</span>}
      {busy === null && !confirm && (
        <>
          <button type="button" className="al-quiet al-focus" style={quiet} onClick={onRefresh} data-testid="demo-refresh">Refresh demo</button>
          <button type="button" className="al-quiet al-focus" style={quiet} onClick={() => setConfirm(true)} data-testid="demo-remove">Remove demo</button>
        </>
      )}
      {busy === null && confirm && (
        <>
          <button type="button" className="al-quiet al-focus" style={{ ...quiet, color: C.amber }} onClick={() => { setConfirm(false); onRemove() }} data-testid="demo-remove-confirm">Yes, remove it</button>
          <button type="button" className="al-quiet al-focus" style={quiet} onClick={() => setConfirm(false)}>Keep it</button>
        </>
      )}
    </div>
  )
}

function Offline({ what, onRetry }: { what: string; onRetry?: () => void }) {
  return (
    <div style={cs.offline} data-testid="classroom-offline" role="status">
      <span style={mono}>offline</span>
      <span>{what} could not be reached just now.</span>
      {onRetry && <button type="button" className="al-quiet al-focus" style={quiet} onClick={onRetry}>Try again</button>}
    </div>
  )
}

const HEAT_COLS: Array<{ key: string; label: string; of: (r: HardNowRow) => number | null | undefined }> = [
  { key: 'err', label: 'missed', of: (r) => r.error_rate },
  { key: 'hint', label: 'hints/try', of: (r) => (r.hints_per_attempt == null ? null : Math.min(1, r.hints_per_attempt)) },
  { key: 'slow', label: 'pace', of: (r) => (r.latency_ratio == null ? null : Math.max(0, Math.min(1, (r.latency_ratio - 1) / 2))) },
  { key: 'hard', label: 'felt hard', of: (r) => r.hard_share },
]

function Heatmap({ data }: { data: HardNow }) {
  const full = data.rows.filter((r) => r.status === 'ok')
  const few = data.rows.filter((r) => r.status === 'too_few')
  if (!data.rows.length) return <p style={help}>No practice in the last {data.window_days} days yet.</p>
  return (
    <div className="cr-scroll" data-testid="hard-now-heatmap">
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 4, font: `400 14px/1.3 ${FONT_UI}`, minWidth: 360 }}>
        <thead>
          <tr>
            <th style={{ ...mono, textAlign: 'left', fontWeight: 500 }}>skill</th>
            {HEAT_COLS.map((c) => <th key={c.key} style={{ ...mono, textAlign: 'center', fontWeight: 500 }}>{c.label}</th>)}
            <th style={{ ...mono, textAlign: 'right', fontWeight: 500 }}>kids</th>
          </tr>
        </thead>
        <tbody>
          {full.map((r) => (
            <tr key={r.skill_id}>
              <td style={{ color: C.ink, padding: '6px 4px 6px 0' }}>
                {r.title}
                {r.area && <span style={{ ...mono, display: 'block', letterSpacing: '.08em' }}>{r.area}</span>}
              </td>
              {HEAT_COLS.map((c) => {
                const v = c.of(r)
                return (
                  <td key={c.key} style={{ position: 'relative', textAlign: 'center', padding: '10px 6px', color: C.ink, fontFamily: FONT_MONO, fontSize: 12 }}>
                    <span aria-hidden style={heatLayer(v)} />
                    <span style={{ position: 'relative' }}>{c.key === 'hint' ? (r.hints_per_attempt ?? '—') : c.key === 'slow' ? (r.latency_ratio == null ? '—' : `${r.latency_ratio}x`) : pct(v)}</span>
                  </td>
                )
              })}
              <td style={{ textAlign: 'right', color: C.dim, fontFamily: FONT_MONO, fontSize: 12 }}>{r.students_affected ?? 0}/{r.students ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {few.length > 0 && (
        <p style={{ ...help, marginTop: 8 }} data-testid="hard-now-suppressed">
          {few.length} {few.length === 1 ? 'skill' : 'skills'} hidden: fewer than {data.min_students} students practised {few.length === 1 ? 'it' : 'them'}.
        </p>
      )}
      <p style={{ ...mono, marginTop: 8, letterSpacing: '.08em' }}>observations of practice, last {data.window_days} days · not a grade</p>
    </div>
  )
}

export default function ClassroomConsolePanel({
  apiBase = CLASSROOM_API, academyBase, classId, onOpenRoom, onActiveClass, extraHeaders,
}: ClassroomConsolePanelProps) {
  const { mode, pref, setPref, rootRef, sheetHost, rootStyle } = useClassroomSurface(cs.root)
  const [classes, setClasses] = useState<ClassroomClass[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [active, setActive] = useState<string | null>(classId ?? null)
  const [data, setData] = useState<ClassData | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  // undefined = GET /demo has not answered (or failed): unknown, which is not the same as "no demo".
  const [demo, setDemo] = useState<DemoView | null | undefined>(undefined)
  const [demoBusy, setDemoBusy] = useState<DemoBusy>(null)
  const [demoFailed, setDemoFailed] = useState(false)
  // The removed demo's class room is still owed a teardown the server has queued.
  const [roomOwed, setRoomOwed] = useState(false)

  const get = useCallback(<T,>(path: string) => classroomFetch<T>(apiBase, path, { extraHeaders }), [apiBase, extraHeaders])

  // The demo's own view (stale, the linked demo parent). Without an answer what is known stays as it was:
  // a class is still marked by its own `demo` flag, and no second demo is offered on a guess.
  const loadDemo = useCallback(async () => {
    try { setDemo((await get<DemoStatus>('/demo'))?.demo ?? null) } catch { /* unknown stays unknown */ }
  }, [get])

  const loadClasses = useCallback(async () => {
    setState('loading')
    try {
      const r = await get<{ classes: ClassroomClass[] }>('/classes')
      const list = r?.classes ?? []
      setClasses(list)
      setActive((cur) => (cur && list.some((c) => c.class_id === cur) ? cur : list[0]?.class_id ?? null))
      setState('ready')
    } catch (e) {
      setState(loadStateOf(e) === 'missing' ? 'ready' : 'offline')
    }
  }, [get])

  const loadClass = useCallback(async (cid: string) => {
    setData(null)
    const id = cseg(cid)
    const failed: string[] = []
    const grab = async <T,>(path: string, label: string): Promise<T | null> => {
      try { return await get<T>(path) } catch { failed.push(label); return null }
    }
    const [roster, asn, hard, review] = await Promise.all([
      grab<Roster>(`/classes/${id}/roster`, 'roster'),
      grab<{ assignments: Assignment[] }>(`/classes/${id}/assignments`, 'assignments'),
      grab<HardNow>(`/classes/${id}/hard-now`, 'hard-now'),
      grab<{ responses: ReviewItem[] }>(`/classes/${id}/review-queue`, 'review'),
    ])
    setData({ roster, assignments: asn?.assignments ?? null, hard, review: review?.responses ?? null, failed })
  }, [get])

  useEffect(() => { loadClasses(); loadDemo() }, [loadClasses, loadDemo])
  useEffect(() => { if (active) loadClass(active) }, [active, loadClass])

  const isDemo = useCallback((c: ClassroomClass) => c.demo === true || demo?.class_id === c.class_id, [demo])
  // The flag rides the class itself, so a host that follows the selection (onActiveClass) can mark its own views.
  const cls = useMemo(() => {
    const found = classes.find((c) => c.class_id === active) ?? null
    return found && isDemo(found) ? { ...found, demo: true } : found
  }, [classes, active, isDemo])
  // Offer a demo only when the server SAID there is none; an unanswered GET /demo offers nothing.
  const hasDemo = demo !== null || classes.some((c) => c.demo === true)

  const seedDemo = async (refresh: boolean) => {
    setDemoBusy('building'); setDemoFailed(false); setNote(null); setRoomOwed(false)
    try {
      const res = await send<DemoSeedResult>(apiBase, '/demo/seed', 'POST', { refresh }, extraHeaders)
      setDemo(res)
      setClasses((l) => (l.some((c) => c.class_id === res.class_id)
        ? l.map((c) => (c.class_id === res.class_id ? { ...c, ...res.class, demo: true } : c))
        : [...l, { ...res.class, demo: true }]))
      if (active === res.class_id) loadClass(res.class_id)
      else setActive(res.class_id)
    } catch {
      if (refresh) setNote('The demo class could not be rebuilt just now. The one you have is unchanged.')
      else setDemoFailed(true)
    } finally { setDemoBusy(null) }
  }

  const removeDemo = async () => {
    setDemoBusy('removing'); setNote(null)
    try {
      const res = await send<DemoRemoveResult>(apiBase, '/demo', 'DELETE', undefined, extraHeaders)
      const kept = (res.retained ?? []).map((k) => `${k.rows} ${k.what.replace(/_/g, ' ')} rows`).join(' and ')
      const rest = classes.filter((c) => c.class_id !== res.class_id)
      setDemo(null)
      setData(null)
      setClasses(rest)
      setActive(rest[0]?.class_id ?? null)
      const parts = (res.errors ?? []).map((e) => e.part)
      if (res.deleted === true) {
        setNote(`The demo class is removed.${kept ? ` What stays is its append-only record (${kept}); it names no student.` : ''}`)
      } else if (parts.includes('room')) {
        setRoomOwed(true)
        setNote('The demo class is removed. Its class room did not confirm that it is gone, so that removal is queued.')
      } else {
        setNote(`The demo class is removed, but a part of it did not confirm${parts.length ? ` (${parts.join(', ')})` : ''}.`)
      }
    } catch {
      setNote('The demo class could not be removed just now. It is still here.')
    } finally { setDemoBusy(null) }
  }

  const finishRemoval = async () => {
    setDemoBusy('removing')
    try {
      const res = await send<{ pending?: number }>(apiBase, '/room/teardowns/retry', 'POST', undefined, extraHeaders)
      if ((res?.pending ?? 0) === 0) {
        setRoomOwed(false)
        setNote('The class room is gone too. The demo class is fully removed.')
      } else setNote('The class room still did not confirm. Its removal stays queued; try again in a moment.')
    } catch {
      setNote('The class room could not be reached. Its removal stays queued; try again in a moment.')
    } finally { setDemoBusy(null) }
  }
  // Only after the list has loaded: a loading or offline console says nothing about the selection.
  useEffect(() => { if (state === 'ready') onActiveClass?.(cls) }, [state, cls, onActiveClass])

  const review = async (item: ReviewItem, action: 'confirm' | 'override', score?: number) => {
    if (!active) return
    try {
      await send(apiBase, `/classes/${cseg(active)}/responses/${cseg(item.response_id)}/review`, 'POST',
        action === 'confirm' ? { action } : { action, score }, extraHeaders)
      setData((d) => (d && d.review ? { ...d, review: d.review.filter((r) => r.response_id !== item.response_id) } : d))
    } catch {
      setNote('That review did not save. Try again in a moment.')
    }
  }

  return (
    <div ref={rootRef} style={rootStyle} data-learn-theme={mode} data-testid="classroom-console">
      <style>{LEARN_CSS + CLASSROOM_CSS}</style>
      <div className="cr-col">
        <header className="cr-head al-in">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={mono}>aither classroom · teacher</span>
              {cls?.demo && <span style={cs.demoMark} data-testid="demo-mark">demo</span>}
            </span>
            <h1 style={cs.h1}>{cls?.name || 'Your classes'}</h1>
            {cls && (
              <span style={{ ...mono, color: C.dim, letterSpacing: '.08em' }}>
                {[cls.grade_level, cls.subject, `${cls.student_count ?? 0} students`].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            {state === 'ready' && <button type="button" className="al-quiet al-focus" style={quiet} onClick={() => setCreateOpen(true)}>New class</button>}
            {cls && onOpenRoom && <button type="button" className="al-quiet al-focus" style={quiet} onClick={() => onOpenRoom(cls.class_id)}>Class room</button>}
            {cls && (
              <button type="button" className="al-primary al-focus" style={primary} onClick={() => setAssignOpen(true)} data-testid="classroom-assign">
                Assign
              </button>
            )}
            <ClassroomNoticesBell apiBase={apiBase} extraHeaders={extraHeaders} mode={mode} host={sheetHost} />
            <LearnModeSwitch pref={pref} onChange={setPref} />
          </div>
        </header>

        {state === 'loading' && <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-busy><Skel w="40%" h={18} /><Skel w="100%" h={120} r={16} /></div>}
        {state === 'offline' && <Offline what="Your classes" onRetry={loadClasses} />}

        {state === 'ready' && classes.length === 0 && (
          <section style={cs.tile} className="al-in" data-testid="classroom-empty">
            <h2 style={cs.h2}>No classes yet</h2>
            <p style={cs.sub}>Make a class, add first names, print the join sheet. Students sign in by scanning their own code.</p>
            <CreateClass apiBase={apiBase} extraHeaders={extraHeaders} onDone={(c) => { setClasses([c]); setActive(c.class_id) }} />
            {!hasDemo && <DemoOffer busy={demoBusy} failed={demoFailed} onSeed={() => seedDemo(false)} />}
          </section>
        )}

        {classes.length > 1 && (
          <nav className="cr-tabs" aria-label="Classes">
            {classes.map((c) => (
              <button key={c.class_id} type="button" className="al-focus" aria-pressed={c.class_id === active}
                style={{ ...cs.tab, ...(c.class_id === active ? cs.tabOn : {}) }} onClick={() => setActive(c.class_id)}>
                {c.name || c.class_id}
                {isDemo(c) && <span style={{ ...cs.demoMark, marginLeft: 8 }}>demo</span>}
              </button>
            ))}
          </nav>
        )}

        {cls?.demo && <DemoStrip view={demo ?? null} busy={demoBusy} onRefresh={() => seedDemo(true)} onRemove={removeDemo} />}
        {cls?.consent?.banner && <div style={cs.amberNote} data-testid="consent-banner">{cls.consent.banner}</div>}
        {note && <div role="status" style={help}>{note}</div>}
        {roomOwed && (
          <div>
            <button type="button" className="al-quiet al-focus" style={{ ...quiet, color: C.accent }} onClick={finishRemoval}
              disabled={demoBusy !== null} data-testid="demo-finish-removal">Finish removing it</button>
          </div>
        )}

        {cls && !data && <div className="cr-grid"><Skel w="100%" h={160} r={16} /><Skel w="100%" h={160} r={16} /></div>}
        {cls && data && (
          <div className="cr-grid">
            <section style={cs.tile} aria-label="Roster" data-testid="classroom-roster">
              <span style={mono}>roster</span>
              {data.roster ? (
                data.roster.students.length === 0 ? (
                  <>
                    <p style={help}>No students yet. Add first names in the roster sheet.</p>
                    {!hasDemo && <DemoOffer busy={demoBusy} failed={demoFailed} onSeed={() => seedDemo(false)} />}
                  </>
                ) : (
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                    {data.roster.students.map((s) => (
                      <li key={s.member_id} style={cs.row}>
                        <span style={{ flex: 1, minWidth: 0, color: C.ink }}>{s.alias}</span>
                        <span style={{ ...mono, letterSpacing: '.08em' }}>{(s.parents?.length ?? 0) > 0 ? `${s.parents?.length} parent linked` : 'no parent yet'}</span>
                      </li>
                    ))}
                  </ul>
                )
              ) : <Offline what="The roster" />}
            </section>

            <section style={cs.tile} aria-label="Assignments" data-testid="classroom-assignments">
              <span style={mono}>assigned work</span>
              {data.assignments ? (
                data.assignments.length === 0 ? <p style={help}>Nothing assigned yet. Publish a lesson, then Assign.</p> : (
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                    {data.assignments.map((a) => (
                      <AssignmentRow key={a.id} a={a} apiBase={apiBase} classId={cls.class_id} extraHeaders={extraHeaders} />
                    ))}
                  </ul>
                )
              ) : <Offline what="Assignments" />}
            </section>

            <section style={cs.tile} aria-label="What is hard right now" data-testid="classroom-hard-now">
              <span style={mono}>hard right now</span>
              {data.hard ? <Heatmap data={data.hard} />
                : cls?.consent && !cls.consent.consent_recorded
                  ? <p style={{ ...help, marginTop: 8 }} data-testid="hard-now-needs-consent">{"Practice signals appear here once the school's consent is recorded for this class."}</p>
                  : <Offline what="Practice signals" />}
            </section>

            <section style={cs.tile} aria-label="Review queue" data-testid="classroom-review">
              <span style={mono}>to review</span>
              {data.review ? (
                data.review.length === 0 ? <p style={help}>Nothing waiting. Machine scores appear here as provisional until you confirm them.</p> : (
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                    {data.review.map((r) => <ReviewRow key={r.response_id} r={r} onReview={review} />)}
                  </ul>
                )
              ) : <Offline what="The review queue" />}
            </section>
          </div>
        )}
      </div>

      {assignOpen && cls && data && (
        <Sheet mode={mode} host={sheetHost} label="Assign" onClose={() => setAssignOpen(false)} testId="assign-sheet">
          <AssignForm apiBase={apiBase} academyBase={academyBase} cls={cls} roster={data.roster} extraHeaders={extraHeaders}
            onDone={() => { setAssignOpen(false); loadClass(cls.class_id) }} />
        </Sheet>
      )}
      {createOpen && (
        <Sheet mode={mode} host={sheetHost} label="New class" onClose={() => setCreateOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <SheetHeading label="new class" title="Make a class" />
            <CreateClass apiBase={apiBase} extraHeaders={extraHeaders}
              onDone={(c) => { setClasses((l) => [...l, c]); setActive(c.class_id); setCreateOpen(false) }} />
          </div>
        </Sheet>
      )}
    </div>
  )
}

function AssignmentRow({ a, apiBase, classId, extraHeaders }: { a: Assignment; apiBase: string; classId: string; extraHeaders?: Record<string, string> }) {
  const [status, setStatus] = useState<{ opened: number; done: number; students: unknown[] } | 'offline' | null>(null)
  const open = async () => {
    try {
      setStatus(await classroomFetch(apiBase, `/classes/${cseg(classId)}/assignments/${cseg(a.id)}/status`, { extraHeaders }))
    } catch { setStatus('offline') }
  }
  return (
    <li style={{ ...cs.row, flexWrap: 'wrap' }}>
      <span style={{ flex: '1 1 160px', minWidth: 0, color: C.ink }}>{a.title || 'Lesson practice'}</span>
      {a.due_at && <span style={{ ...mono, letterSpacing: '.08em' }}>due {a.due_at.slice(0, 10)}</span>}
      {status === null && <button type="button" className="al-quiet al-focus" style={quiet} onClick={open}>Who opened it</button>}
      {status === 'offline' && <span style={{ ...mono }}>offline</span>}
      {status && status !== 'offline' && (
        <span style={{ ...mono, letterSpacing: '.08em', color: C.dim }}>{status.opened}/{status.students.length} opened · {status.done} done</span>
      )}
    </li>
  )
}

function ReviewRow({ r, onReview }: { r: ReviewItem; onReview: (r: ReviewItem, a: 'confirm' | 'override', score?: number) => void }) {
  const [score, setScore] = useState('')
  const n = Number(score)
  const valid = score !== '' && n >= 0 && n <= 100
  // The score the teacher is asked to confirm. Without it there is nothing to confirm: Confirm stays disabled.
  const machine = typeof r.auto_score === 'number' ? r.auto_score : null
  const answers = Object.entries(r.answers ?? {}).map(([q, a]) => [q, typeof a === 'string' ? a : JSON.stringify(a)] as const)
  return (
    <li style={{ ...cs.row, flexWrap: 'wrap', alignItems: 'center' }} data-testid="review-item">
      <span style={{ flex: '1 1 180px', minWidth: 0 }}>
        <span style={{ color: C.ink }}>{r.alias || 'Student'}</span>
        <span style={{ ...help, display: 'block' }}>{r.challenge_title || 'Challenge'}</span>
      </span>
      <span style={{ ...mono, letterSpacing: '.08em', color: C.amber }} data-testid="review-score">
        {r.flag !== 'provisional' ? 'needs a score' : machine == null ? 'no machine score' : `provisional ${pct(machine)}`}
      </span>
      <div style={{ flexBasis: '100%', display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="review-answer">
        <span style={{ ...mono, letterSpacing: '.08em' }}>their answer</span>
        {!r.answer_text && answers.length === 0 && <span style={help}>No answer was recorded.</span>}
        {r.answer_text && <span style={{ color: C.ink, font: `400 15px/1.45 ${FONT_UI}`, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.answer_text}</span>}
        {answers.length > 0 && (
          <ol style={{ margin: 0, paddingLeft: 20, color: C.ink, font: `400 15px/1.45 ${FONT_UI}`, overflowWrap: 'anywhere' }}>
            {answers.map(([q, a]) => <li key={q}>{a}</li>)}
          </ol>
        )}
      </div>
      {r.flag === 'provisional' && (
        <button type="button" className="al-quiet al-focus" style={{ ...quiet, color: C.accent }} disabled={machine == null}
          onClick={() => onReview(r, 'confirm')}>Confirm</button>
      )}
      <input aria-label="Your score, 0 to 100" inputMode="numeric" value={score} onChange={(e) => setScore(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
        className="al-field" placeholder="0-100" style={{ ...fieldBox, width: 84, minHeight: 40, padding: '8px 10px' }} />
      <button type="button" className="al-quiet al-focus" style={quiet} disabled={!valid} onClick={() => onReview(r, 'override', n / 100)}>Set score</button>
    </li>
  )
}

function CreateClass({ apiBase, extraHeaders, onDone }: { apiBase: string; extraHeaders?: Record<string, string>; onDone: (c: ClassroomClass) => void }) {
  const [name, setName] = useState('')
  const [grade, setGrade] = useState<string>('K-2')
  const [subject, setSubject] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      const c = await send<ClassroomClass>(apiBase, '/classes', 'POST', { name: name.trim(), grade_level: grade, subject: subject.trim() || undefined }, extraHeaders)
      onDone(c)
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Could not create the class.')
    } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        <Field label="Class name"><input className="al-field" style={fieldBox} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="Grade band">
          <SelectBox value={grade} onChange={(e) => setGrade(e.target.value)}>{GRADES.map((g) => <option key={g} value={g}>{g}</option>)}</SelectBox>
        </Field>
        <Field label="Subject (optional)"><input className="al-field" style={fieldBox} value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} /></Field>
      </div>
      {err && <span role="alert" style={{ ...help, color: C.amber }}>{err}</span>}
      <div><button type="submit" className="al-primary al-focus" style={primary} disabled={busy || !name.trim()}>Create class</button></div>
    </form>
  )
}

function AssignForm({ apiBase, academyBase, cls, roster, extraHeaders, onDone }: {
  apiBase: string; academyBase: string; cls: ClassroomClass; roster: Roster | null
  extraHeaders?: Record<string, string>; onDone: () => void
}) {
  const [lessons, setLessons] = useState<Lesson[] | 'offline' | null>(null)
  const [lessonId, setLessonId] = useState('')
  const [who, setWho] = useState('')
  const [due, setDue] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    classroomFetch<{ lessons: Lesson[] }>(academyBase, `/classes/${cseg(cls.class_id)}/lessons`, { extraHeaders })
      .then((r) => {
        if (!live) return
        const pub = (r?.lessons ?? []).filter((l) => l.status === 'published')
        setLessons(pub)
        if (pub[0]) setLessonId(pub[0].id)
      })
      .catch(() => { if (live) setLessons('offline') })
    return () => { live = false }
  }, [academyBase, cls.class_id, extraHeaders])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await send(apiBase, `/classes/${cseg(cls.class_id)}/assignments`, 'POST', {
        lesson_id: lessonId,
        student_member_id: who || undefined,
        due_at: due || undefined,
        title: title.trim() || undefined,
      }, extraHeaders)
      onDone()
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Could not assign.')
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <SheetHeading label={cls.name || 'class'} title="Assign a lesson" />
      {lessons === null && <Skel w="100%" h={48} r={12} />}
      {lessons === 'offline' && <Offline what="Your lessons" />}
      {Array.isArray(lessons) && lessons.length === 0 && <p style={help}>No published lessons yet. Draft one in the studio, then publish it.</p>}
      {Array.isArray(lessons) && lessons.length > 0 && (
        <>
          <Field label="Lesson">
            <SelectBox value={lessonId} onChange={(e) => setLessonId(e.target.value)}>
              {lessons.map((l) => <option key={l.id} value={l.id}>{l.topic}</option>)}
            </SelectBox>
          </Field>
          <Field label="Who">
            <SelectBox value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">The whole class</option>
              {(roster?.students ?? []).map((s) => <option key={s.member_id} value={s.member_id}>{s.alias}</option>)}
            </SelectBox>
          </Field>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <Field label="Title (optional)"><input className="al-field" style={fieldBox} value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Due (optional)"><input type="date" className="al-field" style={fieldBox} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          </div>
          {err && <span role="alert" style={{ ...help, color: C.amber }}>{err}</span>}
          <div><button type="submit" className="al-primary al-focus" style={primary} disabled={busy || !lessonId}>Assign</button></div>
        </>
      )}
    </form>
  )
}
