/**
 * KidSupportCard: the student's OWN support plan, on their Aither Learn home (the Nest).
 *
 * Backed by Hearth GET /api/v1/tutor/me/support-passport and POST /me/support-checkin
 * through the tutor proxy (apiBase, '/api/tutor'). The server resolves "me" from the
 * child's own session (lib/classroom/scope.require_student_self): no request carries a
 * student, class-of-another or teacher id. The child lockdown allowlists exactly
 * /api/tutor/me/* for a child; nothing here calls any other path.
 *
 * Child-safe rules this card keeps (asserted by awkit __tests__/kid-support-card.test.tsx):
 * - Only what the teacher chose to share with the student: what they are great at, what
 *   they love, how they learn best, their calm-down plan and (if turned on) their goals.
 *   Staff notes, strategies, accommodations, data and meetings never reach this endpoint.
 * - FAILS CLOSED: loading, any error, a 403/404 or an empty answer renders nothing at all,
 *   never a half card, a retry loop or an error that names a class.
 * - No links out, no images from anywhere, no purchases, no counts, streaks, points,
 *   badges or history. Teacher text renders as plain text (React escapes it).
 * - The check-in is five fixed picture buttons (never free typing). The child sees only
 *   their latest tap, and an honest line: the teacher sees it next time they look, and a
 *   grown-up nearby is who to tell if they need help now.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { C, FONT_UI } from './learnTheme'
import { STUDENT_SUPPORT_API, supportApi, type StudentSupportClass } from './classroomSupportApi'

export interface KidSupportCardProps {
  /** Base of the tutor proxy, e.g. '/api/tutor'. */
  apiBase?: string
  /** Headers the host app adds (its bearer). Never user identity fields. */
  extraHeaders?: Record<string, string>
}

/** One picture per fixed feeling. An unknown feeling from the server is not drawn. */
export const FEELING_FACES: Readonly<Record<string, string>> = {
  great: '😄', okay: '🙂', tired: '😴', worried: '😟', upset: '😢',
}

const CARD: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 14, padding: '20px 18px', borderRadius: 24,
  border: `1px solid ${C.hairline}`, background: C.raise, color: C.ink, fontFamily: FONT_UI,
}
const H: CSSProperties = { margin: 0, fontSize: 22, fontWeight: 600, lineHeight: 1.3 }
const LI: CSSProperties = { fontSize: 20, lineHeight: 1.45 }
const FACE: CSSProperties = {
  minHeight: 72, minWidth: 72, borderRadius: 20, border: `1px solid ${C.hairlineStrong}`,
  background: C.surface, color: C.ink, cursor: 'pointer', padding: '6px 10px', touchAction: 'manipulation',
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, fontFamily: FONT_UI,
}

/** Keep only the shapes this card knows; drop anything else the server might send. */
export function safeClasses(raw: unknown): StudentSupportClass[] {
  const list = raw && typeof raw === 'object' ? (raw as { classes?: unknown }).classes : null
  if (!Array.isArray(list)) return []
  const out: StudentSupportClass[] = []
  for (const c of list.slice(0, 6)) {
    if (!c || typeof c !== 'object') continue
    const r = c as Record<string, unknown>
    if (typeof r.class_id !== 'string') continue
    const sections = (Array.isArray(r.sections) ? r.sections : []).flatMap((s) => {
      if (!s || typeof s !== 'object') return []
      const o = s as Record<string, unknown>
      if (typeof o.section !== 'string' || typeof o.title !== 'string' || !Array.isArray(o.items)) return []
      type Item = StudentSupportClass['sections'][number]['items'][number]
      const items = o.items.slice(0, 12).flatMap((it: unknown): Item[] => {
        if (typeof it === 'string') return [it]
        if (it && typeof it === 'object' && typeof (it as { goal?: unknown }).goal === 'string') {
          const g = it as { goal: string; target?: unknown }
          return [{ goal: g.goal, target: typeof g.target === 'string' ? g.target : '' }]
        }
        return []
      })
      return items.length ? [{ section: o.section, title: o.title, items }] : []
    })
    const ck = (r.checkin && typeof r.checkin === 'object' ? r.checkin : {}) as Record<string, unknown>
    const feelings = (Array.isArray(ck.feelings) ? ck.feelings : []).flatMap((f) => {
      const o = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>
      return typeof o.feeling === 'string' && typeof o.title === 'string' && FEELING_FACES[o.feeling]
        ? [{ feeling: o.feeling, title: o.title }] : []
    })
    const l = ck.latest && typeof ck.latest === 'object' ? (ck.latest as Record<string, unknown>) : null
    const latest = l && typeof l.feeling === 'string' && typeof l.title === 'string' ? { feeling: l.feeling, title: l.title } : null
    if (!sections.length) continue
    out.push({ class_id: r.class_id, class_name: typeof r.class_name === 'string' ? r.class_name : null, sections, checkin: { feelings, latest } })
  }
  return out
}

export default function KidSupportCard({ apiBase = STUDENT_SUPPORT_API, extraHeaders }: KidSupportCardProps) {
  const headersRef = useRef(extraHeaders)
  headersRef.current = extraHeaders
  const [classes, setClasses] = useState<StudentSupportClass[]>([])
  const [told, setTold] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setClasses(safeClasses(await supportApi.studentView(apiBase, headersRef.current)))
    } catch {
      setClasses([]) // fail closed: nothing on screen
    }
  }, [apiBase])
  useEffect(() => { load() }, [load])

  const checkin = async (classId: string, feeling: string) => {
    if (busy) return
    setBusy(true)
    try {
      await supportApi.studentCheckin(apiBase, classId, feeling, headersRef.current)
      setTold((t) => ({ ...t, [classId]: feeling }))
    } catch {
      setTold((t) => ({ ...t, [classId]: '' }))
    } finally { setBusy(false) }
  }

  if (!classes.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} data-testid="kid-support">
      {classes.map((c) => {
        const mine = told[c.class_id] ?? c.checkin.latest?.feeling ?? null
        const mineTitle = c.checkin.feelings.find((f) => f.feeling === mine)?.title
        return (
          <section key={c.class_id} style={CARD} aria-label="My plan from my teacher" data-testid="kid-support-class">
            <h2 style={H}>My plan from my teacher</h2>
            {c.sections.map((s) => (
              <div key={s.section} data-testid={`kid-support-${s.section}`}>
                <h3 style={{ ...H, fontSize: 19, opacity: 0.85, marginBottom: 6 }}>{s.title}</h3>
                <ul style={{ margin: 0, paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {s.items.map((it, i) => (
                    <li key={i} style={LI}>{typeof it === 'string' ? it : it.goal}</li>
                  ))}
                </ul>
              </div>
            ))}
            {c.checkin.feelings.length > 0 && (
              <div data-testid="kid-support-checkin">
                <h3 style={{ ...H, fontSize: 19, marginBottom: 8 }}>How are you feeling?</h3>
                <div role="group" aria-label="How are you feeling?" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {c.checkin.feelings.map((f) => (
                    <button key={f.feeling} type="button" style={{ ...FACE, outline: mine === f.feeling ? `3px solid ${C.accent}` : 'none' }}
                      aria-pressed={mine === f.feeling} disabled={busy} onClick={() => checkin(c.class_id, f.feeling)}
                      data-testid={`kid-feeling-${f.feeling}`}>
                      <span aria-hidden="true" style={{ fontSize: 32 }}>{FEELING_FACES[f.feeling]}</span>
                      <span style={{ fontSize: 16 }}>{f.title}</span>
                    </button>
                  ))}
                </div>
                {told[c.class_id] === '' && <p role="status" style={{ margin: '8px 0 0', fontSize: 18 }}>That did not go through. You can tell a grown-up near you.</p>}
                {mine && mineTitle && (
                  <p role="status" style={{ margin: '8px 0 0', fontSize: 18, opacity: 0.85 }} data-testid="kid-support-told">
                    {`You told your teacher: ${mineTitle}. They will see it next time they look. If you need help now, tell a grown-up near you.`}
                  </p>
                )}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
