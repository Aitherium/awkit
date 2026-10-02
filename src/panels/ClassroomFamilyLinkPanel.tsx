/**
 * ClassroomFamilyLinkPanel: a child who already learns at home joins a class.
 *
 * Genesis /api/v1/classroom (routers/classroom_family.py). Two surfaces, one file:
 *
 * - default export (the GUARDIAN, on /learn/parent): the classes this family
 *   joined, what each class sees, "Stop sharing", and the join flow as an
 *   in-window sheet: the teacher's code -> the class it opens, the child, and
 *   what is shared in plain words -> done. /family/links, /family/preview,
 *   /family/redeem, /family/links/{id}/shared, DELETE /family/links/{id}; the
 *   child list is the tutor's own GET /family/learners.
 * - ClassroomFamilySeatsPanel (the TEACHER, in a class): issue a one-time family
 *   code for an open seat, see the seats families linked and the summary each
 *   one shares. /classes/{id}/family-codes, /family-links, .../summary.
 *
 * The server decides everything: who the guardian is, whose learner it is, which
 * class a code opens. This file sends a code, a learner id the server re-checks,
 * and the guardian's explicit agreement. What a class receives is a summary
 * (numbers per area, per standard and per skill, and how much practice), and
 * SharedSummary draws every number of it for the guardian and the teacher alike;
 * an area with no practice says so and is never drawn as 0%.
 *
 * The teacher panel answers 404 for anyone who is not a teacher of that class
 * (a linked parent opens the same room page): it then renders nothing at all.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { C, FONT_MONO, FONT_UI, LEARN_CSS, LearnModeSwitch } from './learnTheme'
import { CheckRow, Sheet, SheetHeading, Skel, fieldBox, help, labelText, mono, primary, quiet } from './learnParts'
import {
  CLASSROOM_API, CLASSROOM_CSS, ClassroomHttpError, classroomFetch, cs, cseg, pct, send, useClassroomSurface,
} from './classroomApi'

// ---------------------------------------------------------------------------
// Shapes (the router's own field names)
// ---------------------------------------------------------------------------

export interface FamilyTerm { key: string; title: string; text: string }
export interface FamilyTerms { version: string; shared: FamilyTerm[]; never_shared: string[]; comes_home?: string[]; control: string }
export interface FamilyClassCard { class_id: string; name?: string | null; subject?: string | null; grade_level?: string | null }
export interface FamilyLink {
  link_id: string
  learner_id: string
  alias?: string | null
  class: FamilyClassCard
  linked_at: string
  shares: string[]
}
export interface FamilyPreview { class: FamilyClassCard; seat_label?: string | null; expires_at?: string; ready: boolean; terms: FamilyTerms }
export interface FamilyArea { mastery: number | null; skills: number; secure: number }
export interface FamilyHardRow { skill_id: string; title?: string | null; area?: string | null; attempts: number; error_rate: number; hints_per_attempt: number; median_latency_s?: number | null }
export interface FamilySummary {
  member: { member_id: string; alias?: string | null }
  class_id: string
  linked_at?: string
  summary_at?: string | null
  fresh: boolean
  window_days?: number | null
  areas: Record<string, FamilyArea>
  /** Per-standard mastery, 0..1, keyed by the standard's code. */
  standards?: Record<string, number> | null
  hard_now: FamilyHardRow[]
  practice?: { attempts: number; days: number } | null
  assigned_work: { assigned: number; opened: number; done: number }
  feel: { easy: number; ok: number; hard: number; hard_flags: number; window_days: number }
}
export interface FamilySeat { member_id: string; alias?: string | null; linked_at?: string; summary_at?: string | null }
export interface FamilyOpenCode { code_id: string; label?: string | null; expires_at?: string }
interface Learner { lid: string; alias: string; guardian_role?: string }

const AREA_WORD: Record<string, string> = { math: 'Math', reading: 'Reading', writing: 'Writing', language: 'Language' }

const FAMILY_CSS = `
.fl-code{font-family:${FONT_MONO};letter-spacing:.14em;text-transform:uppercase}
.fl-pick{display:flex;align-items:center;gap:14px;min-height:52px;padding:10px 16px;border-radius:12px;cursor:pointer;box-sizing:border-box}
.fl-steps{display:flex;gap:6px}
.fl-steps span{flex:1;height:2px;border-radius:2px}
`

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** XXXX-XXXX-XXXX as the guardian types: base32 only, upper-case, grouped. */
export function formatFamilyCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z2-7]/g, '').slice(0, 12)
  return (s.match(/.{1,4}/g) || []).join('-')
}

export function isCompleteFamilyCode(code: string): boolean {
  return code.replace(/-/g, '').length === 12
}

function day(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "1.5 hints a try · 4s an answer": the two struggle numbers the class also holds. */
export function effortWords(h: FamilyHardRow): string {
  const hints = Math.round((h.hints_per_attempt || 0) * 10) / 10
  const parts = [`${hints} ${hints === 1 ? 'hint' : 'hints'} a try`]
  if (h.median_latency_s != null) parts.push(`${Math.round(h.median_latency_s)}s an answer`)
  return parts.join(' · ')
}

function classTitle(c: FamilyClassCard): string {
  return c.name || 'A class'
}

/** Plain words for a refused code; the status is the server's, the words are ours. */
export function codeProblem(e: unknown): string {
  const status = e instanceof ClassroomHttpError ? e.status : 0
  if (status === 404) return 'That code was not found. Check it with the teacher.'
  if (status === 410) return 'That code was already used or has expired. Ask the teacher for a new one.'
  if (status === 429) return 'Too many tries. Wait a few minutes, then try again.'
  if (status === 409 || status === 403) return e instanceof Error ? e.message : 'That did not work.'
  return 'The class could not be reached just now. Nothing was shared.'
}

function Offline({ what, onRetry }: { what: string; onRetry?: () => void }) {
  return (
    <div style={cs.offline} data-testid="family-link-offline" role="status">
      <span style={mono}>offline</span>
      <span>{`${what} could not be reached just now.`}</span>
      {onRetry && <button type="button" className="al-quiet al-focus" style={quiet} onClick={onRetry}>Try again</button>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// What the class sees (the same view for the guardian and the teacher)
// ---------------------------------------------------------------------------

export function SharedSummary({ summary }: { summary: FamilySummary }) {
  const areas = Object.entries(summary.areas || {})
  const w = summary.assigned_work
  const f = summary.feel
  const rated = f.easy + f.ok + f.hard
  const windowDays = summary.window_days || f.window_days
  const standards = Object.entries(summary.standards || {}).sort(([a], [b]) => a.localeCompare(b))
  const p = summary.practice
  return (
    <div data-testid="family-shared" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <section aria-label="Progress by area" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={mono}>progress by area</span>
        {areas.length === 0 && <p style={{ ...help, margin: 0 }}>No practice yet.</p>}
        {areas.map(([area, a]) => (
          <div key={area} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: C.ink, font: `500 15px/1.2 ${FONT_UI}` }}>{AREA_WORD[area] || area}</span>
              <span style={{ ...mono, letterSpacing: '.08em', color: a.mastery == null ? C.faint : C.dim }}>
                {a.mastery == null ? 'no practice yet' : `${pct(a.mastery)} secure`}
              </span>
            </div>
            {a.mastery != null && (
              <div style={cs.bar} role="progressbar" aria-label={`${AREA_WORD[area] || area} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(a.mastery * 100)}>
                <span className="al-grow" style={{ position: 'absolute', inset: 0, width: `${Math.round(a.mastery * 100)}%`, background: C.accent, borderRadius: 999, transformOrigin: 'left' }} />
              </div>
            )}
          </div>
        ))}
        {standards.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="family-standards">
            <span style={mono}>{`by standard · ${standards.length}`}</span>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
              {standards.map(([code, v]) => (
                <li key={code} style={{ color: C.dim, font: `400 12px/1.6 ${FONT_MONO}`, overflowWrap: 'anywhere' }}>{`${code} ${pct(v)}`}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-label="Hard right now" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={mono}>{`hard right now · last ${windowDays} days`}</span>
        {summary.hard_now.length === 0 ? <p style={{ ...help, margin: 0 }}>Nothing stands out.</p> : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {summary.hard_now.map((h) => {
              const wrong = Math.round(h.error_rate * h.attempts)
              return (
                <li key={h.skill_id} style={{ ...cs.row, flexWrap: 'wrap', justifyContent: 'space-between' }} data-testid="family-hard-row">
                  <span style={{ color: C.ink, font: `400 15px/1.3 ${FONT_UI}`, minWidth: 0 }}>{h.title || h.skill_id}</span>
                  <span style={{ ...mono, letterSpacing: '.06em' }}>{`${h.attempts} tries · ${wrong} not yet right · ${effortWords(h)}`}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className="cr-grid">
        <section aria-label="Practice at home" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={mono}>{`practice at home · last ${windowDays} days`}</span>
          <span style={{ color: p && p.attempts ? C.ink : C.faint, font: `400 15px/1.4 ${FONT_UI}` }} data-testid="family-practice">
            {p && p.attempts ? `${p.attempts} tries on ${p.days} ${p.days === 1 ? 'day' : 'days'}` : 'No practice in this time.'}
          </span>
        </section>
        <section aria-label="Assigned work" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={mono}>assigned work</span>
          <span style={{ color: w.assigned ? C.ink : C.faint, font: `400 15px/1.4 ${FONT_UI}` }} data-testid="family-assigned">
            {w.assigned ? `${w.done} of ${w.assigned} finished` : 'Nothing assigned yet.'}
          </span>
        </section>
        <section aria-label="How it felt" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={mono}>how it felt</span>
          <span style={{ color: rated ? C.ink : C.faint, font: `400 15px/1.4 ${FONT_UI}` }} data-testid="family-feel">
            {rated ? `easy ${f.easy} · ok ${f.ok} · hard ${f.hard}` : 'No ratings yet.'}
          </span>
        </section>
      </div>

      <span style={{ ...mono, letterSpacing: '.08em' }} data-testid="family-shared-source">
        {summary.fresh
          ? `an observation, not a grade · from aither learn at home${summary.summary_at ? ` · ${day(summary.summary_at)}` : ''}`
          : summary.summary_at
            ? `home could not be reached · showing the summary from ${day(summary.summary_at)}`
            : 'no summary yet'}
      </span>
    </div>
  )
}

function Terms({ terms }: { terms: FamilyTerms }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} data-testid="family-terms">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={mono}>the class will see</span>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {terms.shared.map((t) => (
            <li key={t.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ color: C.ink, font: `500 15px/1.3 ${FONT_UI}` }}>{t.title}</span>
              <span style={help}>{t.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={mono}>stays at home</span>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, color: C.dim, font: `400 14px/1.5 ${FONT_UI}` }}>
          {terms.never_shared.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </div>
      {(terms.comes_home || []).length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="family-comes-home">
          <span style={mono}>comes home from the class</span>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, color: C.dim, font: `400 14px/1.5 ${FONT_UI}` }}>
            {(terms.comes_home || []).map((t) => <li key={t}>{t}</li>)}
          </ul>
        </div>
      )}
      <p style={{ ...help, margin: 0 }}>{terms.control}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The join flow (an in-window sheet)
// ---------------------------------------------------------------------------

type Step = 'code' | 'consent' | 'done'

function JoinSheet({ apiBase, tutorApiBase, extraHeaders, surface, taken, onClose, onJoined }: {
  apiBase: string
  tutorApiBase: string
  extraHeaders?: Record<string, string>
  surface: { mode: 'dark' | 'light'; sheetHost: Element | null }
  /** learner id -> class ids that child already sits in. */
  taken: Record<string, string[]>
  onClose: () => void
  onJoined: (link: FamilyLink) => void
}) {
  const [step, setStep] = useState<Step>('code')
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState<FamilyPreview | null>(null)
  const [learners, setLearners] = useState<Learner[] | 'loading' | 'offline'>('loading')
  const [lid, setLid] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [joined, setJoined] = useState<FamilyLink | null>(null)

  const find = async (e: FormEvent) => {
    e.preventDefault()
    if (!isCompleteFamilyCode(code) || busy) return
    setBusy(true); setErr(null)
    try {
      setPreview(await send<FamilyPreview>(apiBase, '/family/preview', 'POST', { code }, extraHeaders))
      setStep('consent')
      setLearners('loading')
      try {
        const rows = await classroomFetch<Learner[]>(tutorApiBase, '/family/learners', { extraHeaders })
        // Only the guardian of record can share a child with a class.
        setLearners((Array.isArray(rows) ? rows : []).filter((l) => l.guardian_role !== 'co'))
      } catch { setLearners('offline') }
    } catch (ex) { setErr(codeProblem(ex)) } finally { setBusy(false) }
  }

  const join = async (e: FormEvent) => {
    e.preventDefault()
    if (!preview || !lid || !agree || busy) return
    setBusy(true); setErr(null)
    try {
      const r = await send<{ linked: boolean; link: FamilyLink }>(apiBase, '/family/redeem', 'POST',
        { code, learner_id: lid, agree: true, terms_version: preview.terms.version }, extraHeaders)
      setJoined(r.link)
      setStep('done')
      onJoined(r.link)
    } catch (ex) { setErr(codeProblem(ex)) } finally { setBusy(false) }
  }

  const n = step === 'code' ? 1 : step === 'consent' ? 2 : 3
  const picked = Array.isArray(learners) ? learners.find((l) => l.lid === lid) : undefined
  const cls = preview?.class

  return (
    <Sheet mode={surface.mode} host={surface.sheetHost} label="Join a class" onClose={onClose} testId="family-join-sheet">
      <style>{LEARN_CSS + FAMILY_CSS}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div className="fl-steps" aria-hidden style={{ marginRight: 56 }}>
          {[1, 2, 3].map((i) => <span key={i} style={{ background: i <= n ? C.accent : C.hairlineStrong }} />)}
        </div>

        {step === 'code' && (
          <form onSubmit={find} style={{ display: 'flex', flexDirection: 'column', gap: 18 }} data-testid="family-step-code">
            <SheetHeading label="step 1 of 3 · the code" title="Enter the family code" />
            <p style={{ ...help, margin: 0 }}>The teacher gives each family a one-time code. It opens one seat in one class.</p>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={labelText}>Family code</span>
              <input aria-label="Family code" className="al-field fl-code" autoComplete="off" autoCapitalize="characters" spellCheck={false}
                inputMode="text" placeholder="XXXX-XXXX-XXXX" value={code} maxLength={14}
                onChange={(e) => { setCode(formatFamilyCode(e.target.value)); setErr(null) }}
                style={{ ...fieldBox, fontFamily: FONT_MONO, fontSize: 20, minHeight: 56 }} />
            </label>
            {err && <span role="alert" style={{ ...help, color: C.amber }} data-testid="family-error">{err}</span>}
            <div>
              <button type="submit" className="al-primary al-focus" style={primary} disabled={!isCompleteFamilyCode(code) || busy} data-testid="family-find">
                {busy ? 'Looking…' : 'Find the class'}
              </button>
            </div>
          </form>
        )}

        {step === 'consent' && preview && cls && (
          <form onSubmit={join} style={{ display: 'flex', flexDirection: 'column', gap: 20 }} data-testid="family-step-consent">
            <SheetHeading label="step 2 of 3 · your say" title={classTitle(cls)} />
            <span style={{ ...mono, letterSpacing: '.08em' }}>
              {[cls.subject, cls.grade_level, preview.seat_label ? `seat for ${preview.seat_label}` : null].filter(Boolean).join(' · ') || 'a class on aither classroom'}
            </span>

            {!preview.ready && (
              <div style={cs.amberNote} role="status" data-testid="family-not-ready">
                This class is not ready for students yet. Ask the teacher, then come back with the same code.
              </div>
            )}

            <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <legend style={{ ...labelText, padding: 0, marginBottom: 8 }}>Who is joining?</legend>
              {learners === 'loading' && <Skel w="100%" h={52} r={12} />}
              {learners === 'offline' && <span style={{ ...help, color: C.amber }}>Your children could not be loaded just now.</span>}
              {Array.isArray(learners) && learners.length === 0 && (
                <span style={help} data-testid="family-no-learners">Add a child in Aither Learn first, then come back with the code.</span>
              )}
              {Array.isArray(learners) && learners.map((l) => {
                const already = (taken[l.lid] || []).includes(cls.class_id)
                const on = lid === l.lid
                return (
                  <label key={l.lid} className="fl-pick" style={{
                    border: `1px solid ${on ? C.accent : C.hairlineStrong}`, background: on ? C.accentWash : 'transparent',
                    color: already ? C.faint : C.ink, font: `400 16px/1.3 ${FONT_UI}`, cursor: already ? 'default' : 'pointer',
                  }}>
                    <input type="radio" name="family-learner" className="al-focus" checked={on} disabled={already}
                      onChange={() => setLid(l.lid)} style={{ width: 20, height: 20, margin: 0, accentColor: C.accent }} />
                    <span style={{ flex: 1, minWidth: 0 }}>{l.alias}</span>
                    {already && <span style={{ ...mono, letterSpacing: '.08em' }}>already in this class</span>}
                  </label>
                )
              })}
            </fieldset>

            <Terms terms={preview.terms} />

            <CheckRow checked={agree} onChange={setAgree} ariaLabel="I agree to share these summaries">
              {`I am ${picked ? picked.alias : 'this child'}'s parent or guardian. Share these summaries with this class until I stop it.`}
            </CheckRow>

            {err && <span role="alert" style={{ ...help, color: C.amber }} data-testid="family-error">{err}</span>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
              <button type="submit" className="al-primary al-focus" style={primary} disabled={!preview.ready || !lid || !agree || busy} data-testid="family-join">
                {busy ? 'Joining…' : 'Join the class'}
              </button>
              <button type="button" className="al-quiet al-focus" style={quiet} onClick={() => { setStep('code'); setErr(null); setAgree(false) }}>Use another code</button>
            </div>
          </form>
        )}

        {step === 'done' && joined && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }} data-testid="family-step-done">
            <SheetHeading label="step 3 of 3 · joined" title={`${joined.alias || 'Your child'} is in ${classTitle(joined.class)}`} />
            <p style={{ margin: 0, color: C.dim, font: `400 15px/1.55 ${FONT_UI}` }}>
              {`Work the teacher assigns now shows on ${joined.alias || 'your child'}'s Learn home, next to their own quests. Their Sprite and everything they have done stay where they are.`}
            </p>
            <p style={{ ...help, margin: 0 }}>You can see what the class sees, and stop sharing, from this page at any time.</p>
            <div><button type="button" className="al-primary al-focus" style={primary} onClick={onClose} data-testid="family-done">Done</button></div>
          </div>
        )}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// One joined class (guardian)
// ---------------------------------------------------------------------------

function LinkCard({ link, apiBase, extraHeaders, onStopped }: {
  link: FamilyLink
  apiBase: string
  extraHeaders?: Record<string, string>
  onStopped: () => void
}) {
  const [shared, setShared] = useState<FamilySummary | 'loading' | 'offline' | null>(null)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const look = async () => {
    if (shared && shared !== 'offline') { setShared(null); return }
    setShared('loading')
    try { setShared(await classroomFetch<FamilySummary>(apiBase, `/family/links/${cseg(link.link_id)}/shared`, { extraHeaders })) } catch { setShared('offline') }
  }

  const stop = async () => {
    setBusy(true); setErr(null)
    try {
      await send(apiBase, `/family/links/${cseg(link.link_id)}`, 'DELETE', undefined, extraHeaders)
      onStopped()
    } catch { setErr('Sharing could not be stopped just now. It is still on. Try again.') } finally { setBusy(false) }
  }

  const name = link.alias || 'Your child'
  return (
    <article style={cs.tile} className="al-tile" data-testid="family-link">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ ...cs.h2, fontSize: 22, fontWeight: 300, letterSpacing: '-0.02em' }}>{`${name} · ${classTitle(link.class)}`}</h2>
        <span style={{ ...mono, letterSpacing: '.08em' }}>
          <span style={{ color: C.accent }}>● sharing</span>{link.linked_at ? ` · since ${day(link.linked_at)}` : ''}
        </span>
      </div>
      <p style={{ ...help, margin: 0 }}>
        {`The class sees a summary of ${name}'s practice at home. What ${name} types, their Sprite and their answers stay at home.`}
      </p>

      {shared === 'loading' && <Skel w="100%" h={96} r={12} />}
      {shared === 'offline' && <Offline what="What the class sees" onRetry={look} />}
      {shared && shared !== 'loading' && shared !== 'offline' && <SharedSummary summary={shared} />}

      {asking ? (
        <div style={{ ...cs.amberNote, display: 'flex', flexDirection: 'column', gap: 12 }} role="alertdialog" aria-label="Stop sharing" data-testid="family-stop-confirm">
          <span>{`Stop sharing with ${classTitle(link.class)}? ${name}'s seat is removed, what was shared is cleared from the class, and nothing more is sent. Practice the teacher set that is not finished leaves the quests at home. Everything else at home stays.`}</span>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <button type="button" className="al-quiet al-focus" style={{ ...quiet, color: C.amber }} disabled={busy} onClick={stop} data-testid="family-stop-yes">{busy ? 'Stopping…' : 'Stop sharing'}</button>
            <button type="button" className="al-quiet al-focus" style={quiet} disabled={busy} onClick={() => setAsking(false)}>Keep sharing</button>
          </div>
          {err && <span role="alert" style={{ ...help, color: C.amber }}>{err}</span>}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
          <button type="button" className="al-quiet al-focus" style={{ ...quiet, color: C.accent }} onClick={look} data-testid="family-look" aria-expanded={!!shared && shared !== 'offline'}>
            {shared && shared !== 'offline' && shared !== 'loading' ? 'Hide' : 'See what the class sees'}
          </button>
          <button type="button" className="al-quiet al-focus" style={quiet} onClick={() => setAsking(true)} data-testid="family-stop">Stop sharing</button>
        </div>
      )}
    </article>
  )
}

// ---------------------------------------------------------------------------
// Guardian panel
// ---------------------------------------------------------------------------

export interface ClassroomFamilyLinkPanelProps {
  apiBase?: string
  /** The family tutor proxy (the child list comes from its GET /family/learners). */
  tutorApiBase?: string
  extraHeaders?: Record<string, string>
  /** A class was joined or left (the host may refresh its "At school" section). */
  onChanged?: () => void
}

export default function ClassroomFamilyLinkPanel({ apiBase = CLASSROOM_API, tutorApiBase = '/api/tutor', extraHeaders, onChanged }: ClassroomFamilyLinkPanelProps) {
  const { mode, pref, setPref, rootRef, sheetHost, rootStyle } = useClassroomSurface(cs.root)
  const [links, setLinks] = useState<FamilyLink[] | 'loading' | 'offline'>('loading')
  const [joining, setJoining] = useState(false)

  const load = useCallback(async (quietly = false) => {
    if (!quietly) setLinks('loading')
    try {
      const r = await classroomFetch<{ links: FamilyLink[] }>(apiBase, '/family/links', { extraHeaders })
      setLinks(Array.isArray(r?.links) ? r.links : [])
    } catch { setLinks('offline') }
  }, [apiBase, extraHeaders])

  useEffect(() => { load() }, [load])

  const changed = () => { load(true); onChanged?.() }
  const list = Array.isArray(links) ? links : []
  const taken: Record<string, string[]> = {}
  for (const l of list) (taken[l.learner_id] = taken[l.learner_id] || []).push(l.class.class_id)

  return (
    <div ref={rootRef} style={rootStyle} data-learn-theme={mode} data-testid="classroom-family-link">
      <style>{LEARN_CSS + CLASSROOM_CSS + FAMILY_CSS}</style>
      <div className="cr-col">
        <header className="cr-head al-in">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640 }}>
            <span style={mono}>aither learn · in a class</span>
            <h1 style={cs.h1}>Join a class</h1>
            <p style={cs.sub}>
              {"A child who learns here at home can sit in a teacher's class as themself: same Sprite, same quests, same history. You decide, class by class, and the class gets a summary only."}
            </p>
          </div>
          <LearnModeSwitch pref={pref} onChange={setPref} />
        </header>

        {links === 'loading' && <Skel w="100%" h={140} r={16} />}
        {links === 'offline' && <Offline what="Your classes" onRetry={() => load()} />}

        {Array.isArray(links) && links.length === 0 && (
          <section style={{ ...cs.tile, alignItems: 'flex-start' }} className="al-in" data-testid="family-empty">
            <span style={mono}>no class yet</span>
            <p style={{ margin: 0, color: C.ink, font: `300 22px/1.3 ${FONT_UI}`, letterSpacing: '-0.01em', maxWidth: 520 }}>
              Ask the teacher for a family code. It opens one seat for your child.
            </p>
            <p style={{ ...help, margin: 0, maxWidth: 520 }}>You will see the class and exactly what it would be shown before anything is shared.</p>
            <button type="button" className="al-primary al-focus" style={primary} onClick={() => setJoining(true)} data-testid="family-start">Join with a code</button>
          </section>
        )}

        {list.length > 0 && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {list.map((l) => <LinkCard key={l.link_id} link={l} apiBase={apiBase} extraHeaders={extraHeaders} onStopped={changed} />)}
            </div>
            <div>
              <button type="button" className="al-quiet al-focus" style={quiet} onClick={() => setJoining(true)} data-testid="family-start">Join another class with a code →</button>
            </div>
          </>
        )}
      </div>

      {joining && (
        <JoinSheet apiBase={apiBase} tutorApiBase={tutorApiBase} extraHeaders={extraHeaders} surface={{ mode, sheetHost }} taken={taken}
          onClose={() => setJoining(false)} onJoined={changed} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Teacher panel: family seats in one class
// ---------------------------------------------------------------------------

export interface ClassroomFamilySeatsPanelProps {
  classId: string
  apiBase?: string
  extraHeaders?: Record<string, string>
}

interface SeatsState { open_codes: FamilyOpenCode[]; seats: FamilySeat[] }

export function ClassroomFamilySeatsPanel({ classId, apiBase = CLASSROOM_API, extraHeaders }: ClassroomFamilySeatsPanelProps) {
  const { mode, rootRef, rootStyle } = useClassroomSurface({ color: C.ink, fontFamily: FONT_UI })
  const base = `/classes/${cseg(classId)}`
  const [state, setState] = useState<SeatsState | 'loading' | 'offline' | 'consent' | 'hidden'>('loading')
  const [label, setLabel] = useState('')
  const [fresh, setFresh] = useState<{ code: string; label?: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, FamilySummary | 'loading' | 'offline'>>({})

  const load = useCallback(async (quietly = false) => {
    if (!quietly) setState('loading')
    try {
      setState(await classroomFetch<SeatsState>(apiBase, `${base}/family-links`, { extraHeaders }))
    } catch (ex) {
      // Not a teacher of this class (a linked parent on the same page): no panel at all.
      setState(ex instanceof ClassroomHttpError && (ex.status === 404 || ex.status === 403) ? 'hidden' : 'offline')
    }
  }, [apiBase, base, extraHeaders])

  useEffect(() => { load() }, [load])

  const issue = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null); setFresh(null)
    try {
      const r = await send<{ code: string; label?: string | null }>(apiBase, `${base}/family-codes`, 'POST', label.trim() ? { label: label.trim() } : {}, extraHeaders)
      setFresh(r); setLabel(''); load(true)
    } catch (ex) {
      if (ex instanceof ClassroomHttpError && ex.status === 403) setState('consent')
      else setErr(ex instanceof ClassroomHttpError && ex.status === 409 ? ex.message : 'The code could not be made just now.')
    } finally { setBusy(false) }
  }

  const revoke = async (id: string) => {
    try { await send(apiBase, `${base}/family-codes/${cseg(id)}`, 'DELETE', undefined, extraHeaders); load(true) } catch { setErr('That code could not be revoked just now.') }
  }

  const look = async (memberId: string) => {
    if (open[memberId] && open[memberId] !== 'offline') { setOpen((o) => { const n = { ...o }; delete n[memberId]; return n }); return }
    setOpen((o) => ({ ...o, [memberId]: 'loading' }))
    try {
      const s = await classroomFetch<FamilySummary>(apiBase, `${base}/family-links/${cseg(memberId)}/summary`, { extraHeaders })
      setOpen((o) => ({ ...o, [memberId]: s }))
    } catch { setOpen((o) => ({ ...o, [memberId]: 'offline' })) }
  }

  if (state === 'hidden') return null
  return (
    <div ref={rootRef} style={rootStyle} data-learn-theme={mode} data-testid="classroom-family-seats">
      <style>{LEARN_CSS + CLASSROOM_CSS + FAMILY_CSS}</style>
      <section style={cs.tile} aria-label="Family seats">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={mono}>family seats</span>
          <h2 style={cs.h2}>A child who already uses Aither Learn at home</h2>
          <p style={{ ...help, margin: 0 }}>Give the family a one-time code. Their parent links the child, and you get a summary of practice at home: a first name, progress per area and standard, what is hard right now, how much practice, assigned work and how it felt. The skills you assign show up in their quests at home. An observation with its source, never a grade.</p>
        </div>

        {state === 'loading' && <Skel w="100%" h={56} r={12} />}
        {state === 'offline' && <Offline what="Family seats" onRetry={() => load()} />}
        {state === 'consent' && <div style={cs.amberNote} role="status">Record consent for this class first, then make a family code.</div>}

        {typeof state === 'object' && (
          <>
            <form onSubmit={issue} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: '1 1 200px', minWidth: 0 }}>
                <span style={labelText}>Seat for (optional)</span>
                <input aria-label="Seat for" className="al-field" value={label} maxLength={24} onChange={(e) => setLabel(e.target.value)} placeholder="A first name" style={fieldBox} />
              </label>
              <button type="submit" className="al-primary al-focus" style={primary} disabled={busy} data-testid="family-issue">{busy ? 'Making…' : 'Make a family code'}</button>
            </form>
            {err && <span role="alert" style={{ ...help, color: C.amber }}>{err}</span>}

            {fresh && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 16px', borderRadius: 12, border: `1px solid ${C.accent}`, background: C.accentWash }} data-testid="family-fresh-code" role="status">
                <span style={mono}>{`shown once${fresh.label ? ` · seat for ${fresh.label}` : ''}`}</span>
                <span className="fl-code" style={{ fontSize: 24, color: C.ink, userSelect: 'all', overflowWrap: 'anywhere' }}>{fresh.code}</span>
                <span style={help}>Give it to the family. It works once and expires in 14 days.</span>
              </div>
            )}

            {state.open_codes.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={mono}>{`open codes · ${state.open_codes.length}`}</span>
                {state.open_codes.map((c) => (
                  <div key={c.code_id} style={{ ...cs.row, justifyContent: 'space-between', flexWrap: 'wrap' }} data-testid="family-open-code">
                    <span style={{ color: C.dim, font: `400 15px/1.3 ${FONT_UI}` }}>{`${c.label || 'An open seat'} · until ${day(c.expires_at)}`}</span>
                    <button type="button" className="al-quiet al-focus" style={quiet} onClick={() => revoke(c.code_id)}>Revoke</button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={mono}>{`linked from home · ${state.seats.length}`}</span>
              {state.seats.length === 0 && <p style={{ ...help, margin: '8px 0 0' }} data-testid="family-seats-empty">No family has linked a child yet.</p>}
              {state.seats.map((s) => {
                const view = open[s.member_id]
                return (
                  <div key={s.member_id} style={{ borderTop: `1px solid ${C.hairline}`, padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="family-seat">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', minHeight: 44 }}>
                      <span style={{ color: C.ink, font: `500 16px/1.3 ${FONT_UI}` }}>{s.alias || 'A child'}</span>
                      <button type="button" className="al-quiet al-focus" style={{ ...quiet, color: C.accent }} onClick={() => look(s.member_id)} aria-expanded={!!view && view !== 'offline'}>
                        {view && view !== 'offline' && view !== 'loading' ? 'Hide' : 'Summary from home'}
                      </button>
                    </div>
                    {view === 'loading' && <Skel w="100%" h={80} r={12} />}
                    {view === 'offline' && <Offline what="The summary" onRetry={() => look(s.member_id)} />}
                    {view && view !== 'loading' && view !== 'offline' && <SharedSummary summary={view} />}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
