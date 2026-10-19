/**
 * ClassroomTallyPins (awkit): the teacher's pinned Quick Tally counters for one class, on
 * the class dashboard. One tap = one timestamped mark (Option A tiles, supportParts.tsx).
 *
 * Pins are the caller's OWN (a co-teacher pins their own). Hearth answers 404 to anyone
 * who is not a teacher of record, and then nothing renders.
 */
import { useCallback, useEffect, useState } from 'react'
import { C, FONT_UI } from './learnTheme'
import { mono, quiet } from './learnParts'
import { isNotFound } from './classroomApi'
import { SUPPORT_API, supportApi, type Counter } from './classroomSupportApi'
import { SUPPORT_CSS, TallyTile } from './supportParts'

export interface ClassroomTallyPinsProps {
  classId: string
  apiBase?: string
  extraHeaders?: Record<string, string>
  /** Where "open the passports" goes (the host app's support page for this class). */
  supportHref?: string
}

export default function ClassroomTallyPins({ classId, apiBase = SUPPORT_API, extraHeaders, supportHref }: ClassroomTallyPinsProps) {
  const [tiles, setTiles] = useState<Counter[] | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'hidden' | 'offline'>('loading')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await supportApi.pins(apiBase, classId, extraHeaders)
      setTiles(r.tiles)
      setState('ready')
    } catch (e) {
      setState(isNotFound(e) ? 'hidden' : 'offline')
    }
  }, [apiBase, classId, extraHeaders])

  useEffect(() => { setState('loading'); load() }, [load])

  const replace = (c: Counter) => setTiles((cur) => (cur || []).map((t) => (t.id === c.id ? { ...c, alias: t.alias } : t)))

  if (state === 'hidden') return null
  return (
    <section data-testid="classroom-tally-pins" aria-label="Pinned tallies"
      style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <style>{SUPPORT_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={mono}>quick tally · pinned</span>
        {supportHref && (
          <a href={supportHref} className="al-quiet al-focus" style={{ ...quiet, minHeight: 32, color: C.dim, textDecoration: 'none' }}
            data-testid="classroom-tally-pins-open">
            Support passports →
          </a>
        )}
      </div>
      {state === 'offline' && <p role="status" style={{ margin: 0, color: C.faint, font: `400 14px/1.5 ${FONT_UI}` }}>Tallies could not be reached. They will be here when the class is back online.</p>}
      {state === 'ready' && tiles && tiles.length === 0 && (
        <p style={{ margin: 0, color: C.faint, font: `400 14px/1.5 ${FONT_UI}` }} data-testid="classroom-tally-pins-empty">
          Pin a counter from a student&rsquo;s Support Passport and it shows here, one tap per mark.
        </p>
      )}
      {err && <p role="alert" style={{ margin: 0, color: C.amber, font: `400 14px/1.5 ${FONT_UI}` }}>{err}</p>}
      {tiles && tiles.length > 0 && (
        <div className="sp-tiles">
          {tiles.map((t) => (
            <TallyTile key={t.id} counter={t} name={t.alias} busy={busy === t.id}
              onTap={async () => {
                setBusy(t.id); setErr(null)
                try {
                  const r = await supportApi.mark(apiBase, classId, t.id, extraHeaders)
                  replace(r.counter)
                  return r.mark_id
                } catch (e) {
                  setErr(`That tap did not save (${(e as Error).message}). Try again.`)
                  return null
                } finally { setBusy(null) }
              }}
              onUndo={async (markId) => {
                try { replace((await supportApi.undo(apiBase, classId, t.id, markId, extraHeaders)).counter) } catch (e) {
                  setErr(`Undo did not save (${(e as Error).message}).`)
                }
              }} />
          ))}
        </div>
      )}
    </section>
  )
}
