/**
 * ClassroomSpriteStrip: the class's sprites on the teacher's roster.
 *
 * Genesis /api/v1/classroom/classes/{id}/sprites (routers/classroom_sprite.py):
 *   GET  -> each student's sprite NAME, LOOK and STAGE, plus the class garden
 *           (how many sprites grew in the last seven days, one number).
 *   POST -> hatch a learner-mode sprite for every student who has none (idempotent).
 *
 * A class student grows the same Aither Sprite a family child does. The server sends
 * the teacher a name and a stage only: what a sprite learned stays with the student,
 * and this strip never asks for it.
 *
 * A student the teacher just added has no sprite yet, so the strip hatches the missing
 * ones by itself, once per roster, when the class consent is recorded. If that did not
 * work, a quiet "Hatch sprites" link is left to try again. There is no primary action.
 *
 * States: loading (skeleton), offline (fetch rejected), unknown (the sprite store did
 * not answer: no stages and no garden number, never a zero), empty (no students), and
 * nothing at all when the route is not there (an older Genesis answers 404). That last
 * case is said once on the console, so a Genesis that never registered the sprite router
 * leaves a trace instead of a silently missing strip.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { C, FONT_MONO, FONT_UI } from './learnTheme'
import { Skel, help, mono, quiet } from './learnParts'
import { CLASSROOM_API, classroomFetch, cs, cseg, isNotFound, send } from './classroomApi'
import { spriteEmoji } from './LearnerSprite'

/** What a teacher may see of one sprite (lib/classroom/sprites.py TEACHER_CARD_KEYS). */
export interface ClassSpriteCard {
  name?: string | null
  species?: string | null
  stage?: string | null
  stage_word?: string | null
  level?: number | null
}

export interface ClassSpriteStudent { member_id: string; alias?: string | null; sprite: ClassSpriteCard | null }

export interface ClassSprites {
  class_id: string
  /** false = the sprite store did not answer: every sprite is null and the garden is unknown. */
  available: boolean
  students: ClassSpriteStudent[]
  garden: { window_days: number; students: number; sprites: number; grew_this_week: number } | null
  hatch?: { hatched: number; already: number; failed: number }
}

export interface ClassroomSpriteStripProps {
  classId: string
  apiBase?: string
  extraHeaders?: Record<string, string>
  /** The class consent is recorded: only then may the strip hatch missing sprites. */
  consentOk?: boolean
  /** Changes when the roster changes (a student was added or removed): the strip reloads. */
  refreshKey?: string | number
}

type Load = ClassSprites | 'loading' | 'offline' | 'absent'

const LINE = 'A sprite grows when its student finishes class work or secures a skill. What it learned stays with the student.'
const UNKNOWN = 'The sprites could not be read just now, so no stages are shown. Nothing is lost.'
const NEEDS_CONSENT = "Sprites hatch once the school's consent is recorded."
const EMPTY = 'Each student gets a sprite here once they are on the roster.'
const NOT_HATCHED = 'Some sprites did not hatch.'

const number: CSSProperties = { font: `300 44px/1 ${FONT_UI}`, letterSpacing: '-0.02em', color: C.ink }
const glyph: CSSProperties = {
  width: 40, height: 40, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 22, lineHeight: 1, background: C.accentWash, border: `1px solid ${C.hairline}`,
}
/** One console line per page load when the sprite route answers 404 (router not registered). */
let warnedAbsent = false
function warnAbsent(path: string) {
  if (warnedAbsent) return
  warnedAbsent = true
  console.warn(`[classroom] sprites route answered 404 (${path}): the strip is hidden. Is routers.classroom_sprite registered on Genesis?`)
}
/** Tests only: let the next 404 warn again. */
export function resetAbsentWarning() { warnedAbsent = false }

const stageText: CSSProperties = { font: `500 11px/1.4 ${FONT_MONO}`, letterSpacing: '.08em', textTransform: 'lowercase', color: C.dim }

/** "little · level 3", or null without a sprite. Words only: a stage is not a grade. */
export function stageLine(sprite: ClassSpriteCard | null | undefined): string | null {
  if (!sprite) return null
  const level = Math.max(1, Number(sprite.level ?? 1))
  return `${sprite.stage_word || 'Little'} · level ${level}`
}

/** The garden as one sentence around one number. */
export function gardenLine(g: NonNullable<ClassSprites['garden']>): string {
  const of = g.sprites === 1 ? 'of 1 sprite' : `of ${g.sprites} sprites`
  return `${of} grew in the last ${g.window_days} days`
}

export function missingSprites(data: ClassSprites): string[] {
  return data.available ? data.students.filter((s) => !s.sprite).map((s) => s.member_id) : []
}

export default function ClassroomSpriteStrip({ classId, apiBase = CLASSROOM_API, extraHeaders, consentOk = false, refreshKey }: ClassroomSpriteStripProps) {
  const path = `/classes/${cseg(classId)}/sprites`
  const [data, setData] = useState<Load>('loading')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  /** The set of sprite-less students the strip already tried to hatch for (one automatic try per roster). */
  const tried = useRef<string>('')

  const load = useCallback(async () => {
    setData('loading'); setNote(null)
    try {
      setData(await classroomFetch<ClassSprites>(apiBase, path, { extraHeaders }))
    } catch (e) {
      if (isNotFound(e)) { warnAbsent(path); setData('absent') } else setData('offline')
    }
  }, [apiBase, path, extraHeaders])

  useEffect(() => { load() }, [load, refreshKey])

  const hatch = useCallback(async () => {
    setBusy(true); setNote(null)
    try {
      const next = await send<ClassSprites>(apiBase, path, 'POST', {}, extraHeaders)
      setData(next)
      if ((next.hatch?.failed ?? 0) > 0 || missingSprites(next).length > 0) setNote(NOT_HATCHED)
    } catch {
      setNote(NOT_HATCHED)
    } finally { setBusy(false) }
  }, [apiBase, path, extraHeaders])

  const loaded = data !== 'loading' && data !== 'offline' && data !== 'absent' ? data : null
  const missing = loaded ? missingSprites(loaded) : []
  const missingKey = missing.join(',')

  useEffect(() => {
    if (!consentOk || !missingKey || tried.current === missingKey) return
    tried.current = missingKey
    hatch()
  }, [consentOk, missingKey, hatch])

  if (data === 'absent') return null

  return (
    <section style={cs.tile} aria-label="Sprites" data-testid="classroom-sprite-strip">
      <span style={mono}>sprites</span>
      {data === 'loading' && <Skel w="100%" h={72} r={12} />}
      {data === 'offline' && (
        <div style={cs.offline} data-testid="classroom-offline" role="status">
          <span style={mono}>offline</span>
          <span>The sprites could not be reached just now.</span>
          <button type="button" className="al-quiet al-focus" style={quiet} onClick={load}>Try again</button>
        </div>
      )}
      {loaded && !loaded.available && (
        <div style={cs.offline} data-testid="sprites-unknown" role="status">
          <span style={mono}>offline</span>
          <span>{UNKNOWN}</span>
          <button type="button" className="al-quiet al-focus" style={quiet} onClick={load}>Try again</button>
        </div>
      )}
      {loaded && loaded.available && loaded.students.length === 0 && <p style={help} data-testid="sprites-empty">{EMPTY}</p>}
      {loaded && loaded.available && loaded.students.length > 0 && (
        <>
          {loaded.garden && loaded.garden.sprites > 0 && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }} data-testid="sprite-garden">
              <span style={number} data-testid="sprite-garden-count">{loaded.garden.grew_this_week}</span>
              <span style={cs.sub}>{gardenLine(loaded.garden)}</span>
            </div>
          )}
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {loaded.students.map((s) => {
              const line = stageLine(s.sprite)
              return (
                <li key={s.member_id} style={{ ...cs.row, flexWrap: 'wrap' }} data-testid={`sprite-of-${s.member_id}`}>
                  <span aria-hidden style={{ ...glyph, opacity: s.sprite ? 1 : 0.4 }}>{spriteEmoji(s.sprite ? { species: s.sprite.species ?? undefined, stage: s.sprite.stage ?? undefined } : null)}</span>
                  <span style={{ flex: '1 1 120px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ color: s.sprite ? C.ink : C.faint, font: `400 15px/1.3 ${FONT_UI}`, overflowWrap: 'anywhere' }}>
                      {s.sprite ? s.sprite.name || 'Buddy' : 'No sprite yet'}
                    </span>
                    <span style={{ ...help, overflowWrap: 'anywhere' }}>{s.alias || 'Student'}</span>
                  </span>
                  {line && <span style={stageText}>{line}</span>}
                </li>
              )
            })}
          </ul>
          <p style={help}>{LINE}</p>
          {missing.length > 0 && !consentOk && <p style={help} data-testid="sprites-need-consent">{NEEDS_CONSENT}</p>}
          {busy && <span style={mono} role="status">hatching</span>}
          {note && !busy && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span role="status" style={{ ...help, color: C.amber }}>{note}</span>
              {consentOk && <button type="button" className="al-quiet al-focus" style={quiet} onClick={hatch} data-testid="hatch-sprites">Hatch sprites</button>}
            </div>
          )}
        </>
      )}
    </section>
  )
}
