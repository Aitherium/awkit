/**
 * ClassroomRosterSheet: the teacher's roster tools for one class.
 *
 * Genesis /api/v1/classroom/classes/{id}/*: roster, students (bulk add, first
 * names only), consent (school-as-agent, required before any join or parent
 * code), sheet (arm / disarm / revoke / printable QR grid), parent-code, export,
 * and DELETE with a typed confirm (the class id).
 *
 * The printable sheet needs the one-time `secret` the FIRST arm returns; it lives
 * in component state only and is sent back as X-Classroom-Sheet-Secret. Reloading
 * the page loses it, by design: "New sheet" rotates it (old printouts stop working).
 * Primary action: "Print join sheet".
 *
 * Under the students sits ClassroomSpriteStrip: each student's sprite name and stage,
 * and the class garden. It loads after the roster and never blocks it.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { C, FONT_MONO, FONT_UI, LEARN_CSS, LearnModeSwitch } from './learnTheme'
import { CheckRow, Field, Sheet, SheetHeading, Skel, fieldBox, help, mono, primary, quiet } from './learnParts'
import {
  CLASSROOM_API, CLASSROOM_CSS, classroomFetch, cs, cseg, send, useClassroomSurface,
  type ConsentView, type DeleteResult, type Roster, type SheetStatus,
} from './classroomApi'
import ClassroomSpriteStrip from './ClassroomSpriteStrip'

export interface ClassroomRosterSheetProps {
  classId: string
  apiBase?: string
  extraHeaders?: Record<string, string>
  /** Called after the class was deleted (host navigates away). */
  onDeleted?: () => void
}

type Load<T> = T | 'loading' | 'offline'

function Offline({ what, onRetry }: { what: string; onRetry?: () => void }) {
  return (
    <div style={cs.offline} data-testid="classroom-offline" role="status">
      <span style={mono}>offline</span>
      <span>{what} could not be reached just now.</span>
      {onRetry && <button type="button" className="al-quiet al-focus" style={quiet} onClick={onRetry}>Try again</button>}
    </div>
  )
}

/** A sheet is printable only when the server said so AND every student carries a QR. Anything else (a proxy that
 *  dropped the secret header, a stale secret) must not reach the printer as a page of blank cards. */
export function sheetIsPrintable(s: SheetStatus | null | undefined): s is SheetStatus {
  return !!s && s.printable === true && s.students.length > 0 && s.students.every((x) => !!x.qr_svg_data_uri)
}

const NOT_PRINTABLE = 'The join codes did not come back, so nothing was printed. Choose "New sheet" to make a fresh one.'

export function namesFromText(text: string): string[] {
  return text.split(/[\n,]/).map((n) => n.trim()).filter(Boolean).slice(0, 60)
}

export default function ClassroomRosterSheet({ classId, apiBase = CLASSROOM_API, extraHeaders, onDeleted }: ClassroomRosterSheetProps) {
  const { mode, pref, setPref, rootRef, sheetHost, rootStyle } = useClassroomSurface(cs.root)
  const base = `/classes/${cseg(classId)}`
  const [roster, setRoster] = useState<Load<Roster>>('loading')
  const [consent, setConsent] = useState<Load<ConsentView>>('loading')
  const [sheet, setSheet] = useState<Load<SheetStatus>>('loading')
  const [secret, setSecret] = useState<string | null>(null)
  const [printable, setPrintable] = useState<SheetStatus | null>(null)
  const [codes, setCodes] = useState<Record<string, { code: string; expires_at: string }>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [delOpen, setDelOpen] = useState(false)

  const get = useCallback(<T,>(p: string, headers?: Record<string, string>) =>
    classroomFetch<T>(apiBase, p, { extraHeaders: { ...(extraHeaders || {}), ...(headers || {}) } }), [apiBase, extraHeaders])

  const load = useCallback(async () => {
    setRoster('loading'); setConsent('loading'); setSheet('loading')
    const [r, c, s] = await Promise.allSettled([
      get<Roster>(`${base}/roster`), get<ConsentView>(`${base}/consent`), get<SheetStatus>(`${base}/sheet`),
    ])
    setRoster(r.status === 'fulfilled' ? r.value : 'offline')
    setConsent(c.status === 'fulfilled' ? c.value : 'offline')
    setSheet(s.status === 'fulfilled' ? s.value : 'offline')
  }, [base, get])

  useEffect(() => { load() }, [load])

  const fail = (e: unknown, fallback: string) => setMsg(e instanceof Error && e.message ? e.message : fallback)

  const printSheet = async () => {
    setBusy(true); setMsg(null)
    try {
      const armed = await send<{ secret?: string; armed_until: string }>(apiBase, `${base}/sheet/arm`, 'POST', { minutes: 30 }, extraHeaders)
      const s = armed.secret || secret
      if (armed.secret) setSecret(armed.secret)
      if (!s) {
        setMsg('This sheet was printed earlier. Its QR codes work again for 30 minutes. To print a fresh copy, choose "New sheet".')
        setSheet(await get<SheetStatus>(`${base}/sheet`))
        return
      }
      const full = await get<SheetStatus>(`${base}/sheet`, { 'X-Classroom-Sheet-Secret': s })
      setSheet(full)
      if (!sheetIsPrintable(full)) { setPrintable(null); setMsg(NOT_PRINTABLE); return }
      setPrintable(full)
      setTimeout(() => { try { window.print() } catch { /* no print dialog (tests, kiosks) */ } }, 120)
    } catch (e) { fail(e, 'The sheet could not be armed.') } finally { setBusy(false) }
  }

  const rotate = async () => {
    setBusy(true); setMsg(null)
    try {
      const armed = await send<{ secret?: string }>(apiBase, `${base}/sheet/arm`, 'POST', { minutes: 30, rotate: true }, extraHeaders)
      if (armed.secret) {
        setSecret(armed.secret)
        const full = await get<SheetStatus>(`${base}/sheet`, { 'X-Classroom-Sheet-Secret': armed.secret })
        if (sheetIsPrintable(full)) setPrintable(full)
        else { setPrintable(null); setMsg('The new join codes did not come back. Old printouts no longer work; try "New sheet" again.') }
      } else {
        setPrintable(null)
      }
      setSheet(await get<SheetStatus>(`${base}/sheet`))
    } catch (e) { fail(e, 'A new sheet could not be made.') } finally { setBusy(false) }
  }

  const disarm = async () => {
    try { await send(apiBase, `${base}/sheet/disarm`, 'POST', {}, extraHeaders); setSheet(await get<SheetStatus>(`${base}/sheet`)) } catch (e) { fail(e, 'Could not close the sheet.') }
  }

  const parentCode = async (memberId: string) => {
    try {
      const r = await send<{ code: string; expires_at: string }>(apiBase, `${base}/students/${cseg(memberId)}/parent-code`, 'POST', {}, extraHeaders)
      setCodes((c) => ({ ...c, [memberId]: r }))
    } catch (e) { fail(e, 'No parent code right now.') }
  }

  const exportClass = async () => {
    try {
      const bundle = await get<unknown>(`${base}/export`)
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `classroom-${classId}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { fail(e, 'Export failed.') }
  }

  const students = roster !== 'loading' && roster !== 'offline' ? roster.students : []
  const consentOk = consent !== 'loading' && consent !== 'offline' && consent.consent_recorded

  return (
    <div ref={rootRef} style={rootStyle} data-learn-theme={mode} data-testid="classroom-roster-sheet">
      <style>{LEARN_CSS + CLASSROOM_CSS}</style>
      <div className="cr-col">
        <header className="cr-head cr-noprint al-in">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={mono}>aither classroom · roster</span>
            <h1 style={cs.h1}>Students and families</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <button type="button" className="al-primary al-focus" style={primary} disabled={busy || !consentOk || students.length === 0}
              onClick={printSheet} data-testid="print-join-sheet">
              Print join sheet
            </button>
            <LearnModeSwitch pref={pref} onChange={setPref} />
          </div>
        </header>
        {msg && <div role="status" className="cr-noprint" style={cs.amberNote}>{msg}</div>}

        <div className="cr-split cr-noprint">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <section style={cs.tile} aria-label="Students" data-testid="roster-students">
              <span style={mono}>students</span>
              {roster === 'loading' && <Skel w="100%" h={90} r={12} />}
              {roster === 'offline' && <Offline what="The roster" onRetry={load} />}
              {roster !== 'loading' && roster !== 'offline' && (
                <>
                  {students.length === 0 && <p style={help}>No students yet.</p>}
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                    {students.map((s) => (
                      <li key={s.member_id} style={{ ...cs.row, flexWrap: 'wrap' }}>
                        <span style={{ flex: '1 1 120px', color: C.ink }}>{s.alias}</span>
                        <span style={{ ...mono, letterSpacing: '.08em' }}>{(s.parents?.length ?? 0) ? 'parent linked' : 'no parent yet'}</span>
                        {codes[s.member_id] ? (
                          <span data-testid="parent-code" style={{ font: `500 15px/1 ${FONT_MONO}`, letterSpacing: '.12em', color: C.ink }}>
                            {codes[s.member_id].code}
                            <span style={{ ...help, display: 'block', letterSpacing: 0 }}>until {codes[s.member_id].expires_at.slice(0, 16).replace('T', ' ')}</span>
                          </span>
                        ) : (
                          <button type="button" className="al-quiet al-focus" style={quiet} disabled={!consentOk} onClick={() => parentCode(s.member_id)}>Parent code</button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <AddStudents apiBase={apiBase} base={base} extraHeaders={extraHeaders} onAdded={load} />
                </>
              )}
            </section>
            {/* Every student grows a sprite, like a family child does.
                The strip shows its name and stage only. */}
            {roster !== 'loading' && roster !== 'offline' && (
              <ClassroomSpriteStrip
                classId={classId}
                apiBase={apiBase}
                extraHeaders={extraHeaders}
                consentOk={!!consentOk}
                refreshKey={students.map((s) => s.member_id).join(',')}
              />
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <section style={cs.tile} aria-label="Consent" data-testid="roster-consent">
              <span style={mono}>consent</span>
              {consent === 'loading' && <Skel w="100%" h={52} r={12} />}
              {consent === 'offline' && <Offline what="Consent" />}
              {consent !== 'loading' && consent !== 'offline' && (
                <ConsentForm apiBase={apiBase} base={base} view={consent} extraHeaders={extraHeaders} onSaved={(v) => setConsent(v)} />
              )}
            </section>

            <section style={cs.tile} aria-label="Join sheet" data-testid="roster-sheet-status">
              <span style={mono}>join sheet</span>
              {sheet === 'loading' && <Skel w="60%" h={14} />}
              {sheet === 'offline' && <Offline what="The join sheet" />}
              {sheet !== 'loading' && sheet !== 'offline' && (
                <>
                  <p style={{ ...cs.sub, color: sheet.armed ? C.ink : C.dim }}>
                    {sheet.armed && sheet.armed_until
                      ? `Open until ${sheet.armed_until.slice(11, 16)}. Students scan their own code to sign in.`
                      : sheet.has_sheet ? 'Closed. Printed codes do nothing until you open it again.' : 'No sheet printed yet.'}
                  </p>
                  <p style={help}>Open it only while the class is in the room: each scan signs one student in, for up to 30 minutes.</p>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {sheet.armed && <button type="button" className="al-quiet al-focus" style={quiet} onClick={disarm}>Close sheet</button>}
                    {sheet.has_sheet && <button type="button" className="al-quiet al-focus" style={quiet} disabled={busy || !consentOk} onClick={rotate}>New sheet</button>}
                  </div>
                </>
              )}
            </section>

            <section style={cs.tile} aria-label="Class data">
              <span style={mono}>class data</span>
              <p style={help}>Export everything this class holds, or delete it for good. Student accounts stay in Aither ID; you get the list.</p>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <button type="button" className="al-quiet al-focus" style={quiet} onClick={exportClass} data-testid="export-class">Export</button>
                <button type="button" className="al-quiet al-focus" style={{ ...quiet, color: C.amber }} onClick={() => setDelOpen(true)}>Delete class</button>
              </div>
            </section>
          </div>
        </div>

        {sheetIsPrintable(printable) && (
          <section aria-label="Printable join sheet" data-testid="printable-sheet">
            <span className="cr-noprint" style={mono}>printable · {printable.class_name || ''}</span>
            <div className="cr-grid cr-print" data-three="" style={{ marginTop: 12 }}>
              {printable.students.map((s) => (
                <figure key={s.member_id} className="cr-print-card" style={{ ...cs.tile, margin: 0, alignItems: 'center', textAlign: 'center', background: C.qrPaper }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a server-rendered QR data URI; awkit has no next/image */}
                  <img src={s.qr_svg_data_uri} alt={`Join code for ${s.alias}`} width={168} height={168} style={{ display: 'block' }} />
                  <figcaption style={{ font: `500 22px/1.2 ${FONT_UI}`, color: C.qrField }}>{s.alias}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}
      </div>

      {delOpen && (
        <Sheet mode={mode} host={sheetHost} label="Delete class" onClose={() => setDelOpen(false)}>
          <DeleteForm apiBase={apiBase} classId={classId} extraHeaders={extraHeaders} onDeleted={() => { setDelOpen(false); onDeleted?.() }} />
        </Sheet>
      )}
    </div>
  )
}

function AddStudents({ apiBase, base, extraHeaders, onAdded }: { apiBase: string; base: string; extraHeaders?: Record<string, string>; onAdded: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState<string | null>(null)
  const names = namesFromText(text)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setOut(null)
    try {
      const r = await send<{ added: number; failed: number }>(apiBase, `${base}/students`, 'POST', { students: names.map((name) => ({ name })) }, extraHeaders)
      setOut(`${r.added} added${r.failed ? `, ${r.failed} not added` : ''}.`)
      setText('')
      onAdded()
    } catch (ex) {
      setOut(ex instanceof Error ? ex.message : 'Could not add students.')
    } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8 }}>
      <Field label="Add students" hint="First names or aliases, one per line. No surnames, emails or birthdays.">
        <textarea className="al-field" aria-label="Student first names" value={text} onChange={(e) => setText(e.target.value)} style={cs.textarea} />
      </Field>
      {out && <span role="status" style={help}>{out}</span>}
      <div><button type="submit" className="al-quiet al-focus" style={{ ...quiet, color: C.accent }} disabled={busy || names.length === 0}>Add {names.length || ''} {names.length === 1 ? 'student' : 'students'}</button></div>
    </form>
  )
}

function ConsentForm({ apiBase, base, view, extraHeaders, onSaved }: {
  apiBase: string; base: string; view: ConsentView; extraHeaders?: Record<string, string>; onSaved: (v: ConsentView) => void
}) {
  const [agent, setAgent] = useState(view.school_as_agent)
  const [sent, setSent] = useState(view.notice_sent_at || '')
  const [err, setErr] = useState<string | null>(null)
  const save = async (school_as_agent: boolean, notice: string) => {
    setErr(null)
    try {
      onSaved(await send<ConsentView>(apiBase, `${base}/consent`, 'PUT', { school_as_agent, notice_sent_at: notice || null }, extraHeaders))
    } catch (e) { setErr(e instanceof Error ? e.message : 'Not saved.') }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {view.banner && <p style={help}>{view.banner}</p>}
      <CheckRow checked={agent} ariaLabel="School acts for parents" onChange={(v) => { setAgent(v); save(v, sent) }}>
        The school acts for parents for this class, for an educational purpose only.
      </CheckRow>
      <Field label="Parent notice sent on">
        <input type="date" className="al-field" style={fieldBox} value={sent} onChange={(e) => { setSent(e.target.value); save(agent, e.target.value) }} />
      </Field>
      <span style={{ ...mono, letterSpacing: '.08em', color: view.consent_recorded ? C.accent : C.faint }} data-testid="consent-state">
        {view.consent_recorded ? `recorded · ${view.policy_version || ''}` : 'not recorded'}
      </span>
      {err && <span role="alert" style={{ ...help, color: C.amber }}>{err}</span>}
    </div>
  )
}

function DeleteForm({ apiBase, classId, extraHeaders, onDeleted }: { apiBase: string; classId: string; extraHeaders?: Record<string, string>; onDeleted: () => void }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<DeleteResult | null>(null)
  const [partial, setPartial] = useState<string[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const go = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null); setPartial(null)
    try {
      const r = await classroomFetch<DeleteResult>(apiBase, `/classes/${cseg(classId)}?confirm=${encodeURIComponent(typed)}`, { method: 'DELETE', extraHeaders })
      // Only an explicit `deleted: true` with no errors is a finished erase. 'partial' (or errors) means student data
      // is still held somewhere: say which parts, keep the sheet open, let the teacher run it again.
      const parts = (r?.errors ?? []).map((x) => x.part).filter(Boolean)
      if (r?.deleted === true && parts.length === 0) setRes(r)
      else setPartial(parts.length ? parts : ['some class data'])
    } catch (ex) { setErr(ex instanceof Error ? ex.message : 'Not deleted.') } finally { setBusy(false) }
  }
  if (res) {
    const kept = res.identity_children_retained ?? []
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SheetHeading label="deleted" title="The class is gone" />
        <p style={help}>{kept.length} student {kept.length === 1 ? 'account stays' : 'accounts stay'} in Aither ID. Ask the school admin to close them if they are no longer needed.</p>
        <div><button type="button" className="al-primary al-focus" style={primary} onClick={onDeleted}>Done</button></div>
      </div>
    )
  }
  return (
    <form onSubmit={go} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SheetHeading label="delete" title="Delete this class for good" />
      <p style={help}>Lessons, assignments, feedback, parent links and threads are erased. This cannot be undone. Export first if you need a copy.</p>
      <Field label={`Type the class id to confirm: ${classId}`}>
        <input className="al-field" style={fieldBox} value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Class id" autoComplete="off" />
      </Field>
      {partial && (
        <div role="alert" style={cs.amberNote} data-testid="delete-partial">
          Some data could not be erased: {partial.join(', ')}. The class is not fully deleted yet. Try again.
        </div>
      )}
      {err && <span role="alert" style={{ ...help, color: C.amber }}>{err}</span>}
      <div><button type="submit" className="al-primary al-focus" style={primary} disabled={busy || typed !== classId}>{partial ? 'Try again' : 'Delete class'}</button></div>
    </form>
  )
}
