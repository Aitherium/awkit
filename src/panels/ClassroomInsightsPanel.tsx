/**
 * ClassroomInsightsPanel: what the class (or one student) is finding hard, as
 * observations with citations.
 *
 * Genesis /api/v1/classroom/classes/{id}/insight and
 * /classes/{id}/students/{sid}/insight. Every observation carries `cites`
 * (att:/fb:/tx: signal ids); a cite chip expands the underlying signal from the
 * class stream (/classes/{id}/stream) when it has arrived, and names the signal
 * kind otherwise. The server refuses labels, diagnoses and peer comparison and
 * falls back to a deterministic template; this panel says which one it got.
 */
import { useCallback, useEffect, useState } from 'react'
import { C, FONT_MONO, FONT_UI, LEARN_CSS, LearnModeSwitch } from './learnTheme'
import { SelectBox, Skel, help, mono, quiet } from './learnParts'
import {
  CLASSROOM_API, CLASSROOM_CSS, classroomFetch, cs, cseg, describeCite, describeEvent, openClassroomStream, useClassroomSurface,
  type ClassEvent, type Insight, type Roster, type StreamStatus,
} from './classroomApi'

export interface ClassroomInsightsPanelProps {
  classId: string
  apiBase?: string
  /** Start on one student (member id); empty = the whole class. */
  studentMemberId?: string
  extraHeaders?: Record<string, string>
  /** Turn the live stream off (tests, printing). */
  live?: boolean
}

export const INSIGHT_LABEL = 'Observations, not diagnoses'

/** The sources of one observation: the first few, and the rest behind "+N more", so a
 *  line with a dozen signals stays a sentence and not a wall of chips. */
export function CiteRow({ cites, events }: { cites: string[]; events: Record<string, ClassEvent> }) {
  const [all, setAll] = useState(false)
  const KEEP = 3
  const shown = all ? cites : cites.slice(0, KEEP)
  return (
    <>
      {shown.map((c) => <CiteChip key={c} cite={c} event={events[c]} />)}
      {!all && cites.length > KEEP && (
        <button type="button" className="al-focus" style={cs.chip} onClick={() => setAll(true)} data-testid="cite-more">
          {`+${cites.length - KEEP} more`}
        </button>
      )}
    </>
  )
}

export function CiteChip({ cite, event }: { cite: string; event?: ClassEvent }) {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, maxWidth: '100%' }}>
      <button type="button" className="al-focus" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="cite-chip"
        style={{ ...cs.chip, ...(open ? cs.chipOn : {}) }}>
        {describeCite(cite)}
      </button>
      {open && (
        <span role="note" data-testid="cite-detail" style={{ ...help, color: C.dim, paddingLeft: 4 }}>
          {event ? `${describeEvent(event)}${event.at ? ` · ${String(event.at).slice(0, 16).replace('T', ' ')}` : ''}` : describeCite(cite)}
        </span>
      )}
    </span>
  )
}

export default function ClassroomInsightsPanel({
  classId, apiBase = CLASSROOM_API, studentMemberId = '', extraHeaders, live = true,
}: ClassroomInsightsPanelProps) {
  const { mode, pref, setPref, rootRef, rootStyle } = useClassroomSurface(cs.root)
  const [who, setWho] = useState(studentMemberId)
  const [roster, setRoster] = useState<Roster | null>(null)
  const [insight, setInsight] = useState<Insight | 'loading' | 'offline'>('loading')
  const [stream, setStream] = useState<StreamStatus>('connecting')
  const [events, setEvents] = useState<Record<string, ClassEvent>>({})

  const load = useCallback(async () => {
    setInsight('loading')
    const path = who
      ? `/classes/${cseg(classId)}/students/${cseg(who)}/insight`
      : `/classes/${cseg(classId)}/insight`
    try {
      setInsight(await classroomFetch<Insight>(apiBase, path, { extraHeaders }))
    } catch { setInsight('offline') }
  }, [apiBase, classId, extraHeaders, who])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    classroomFetch<Roster>(apiBase, `/classes/${cseg(classId)}/roster`, { extraHeaders }).then(setRoster).catch(() => setRoster(null))
  }, [apiBase, classId, extraHeaders])

  useEffect(() => {
    if (!live) { setStream('offline'); return }
    const h = openClassroomStream(apiBase, `/classes/${cseg(classId)}/stream`, (ev) => {
      setEvents((cur) => {
        const next = { ...cur }
        for (const c of ev.cites ?? []) next[c] = ev
        return next
      })
    }, setStream)
    return () => h.close()
  }, [apiBase, classId, live])

  return (
    <div ref={rootRef} style={rootStyle} data-learn-theme={mode} data-testid="classroom-insights">
      <style>{LEARN_CSS + CLASSROOM_CSS}</style>
      <div className="cr-col">
        <header className="cr-head al-in">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={mono}>aither classroom · insight</span>
            <h1 style={cs.h1}>What is hard right now</h1>
            <span style={{ ...mono, color: C.dim, letterSpacing: '.12em' }} data-testid="insight-label">{INSIGHT_LABEL}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            {/* A host that asked for no live stream (live={false}) gets no stream status:
                "live offline" there read as a fault. */}
            {live && (
              <span style={{ ...mono, color: stream === 'live' ? C.accent : C.faint }} data-testid="stream-status">
                {stream === 'live' ? '● live' : stream === 'connecting' ? 'connecting' : stream === 'ended' ? 'stream closed' : 'live updates paused'}
              </span>
            )}
            <LearnModeSwitch pref={pref} onChange={setPref} />
          </div>
        </header>

        {roster && roster.students.length > 0 && (
          <div style={{ maxWidth: 320 }}>
            <SelectBox aria-label="Whose insight" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">The whole class</option>
              {roster.students.map((s) => <option key={s.member_id} value={s.member_id}>{s.alias}</option>)}
            </SelectBox>
          </div>
        )}

        <section style={cs.tile} aria-label="Observations" aria-busy={insight === 'loading'}>
          {insight === 'loading' && <><Skel w="80%" h={16} /><Skel w="60%" h={16} /></>}
          {insight === 'offline' && (
            <div style={cs.offline} data-testid="classroom-offline" role="status">
              <span style={mono}>offline</span>
              <span>Insight could not be reached just now.</span>
              <button type="button" className="al-quiet al-focus" style={quiet} onClick={load}>Try again</button>
            </div>
          )}
          {insight !== 'loading' && insight !== 'offline' && (
            <>
              <span style={{ ...mono, letterSpacing: '.08em' }}>{insight.source === 'ai' ? 'written by ai from the signals below · checked' : 'plain summary of the signals'}</span>
              {insight.observations.length === 0 && <p style={help}>Nothing to report yet.</p>}
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {insight.observations.map((o, i) => (
                  <li key={i} data-testid="observation" style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 14, borderTop: i ? `1px solid ${C.hairline}` : 'none' }}>
                    <p style={{ margin: 0, color: C.ink, font: `400 17px/1.5 ${FONT_UI}`, letterSpacing: '-0.01em' }}>{o.text}</p>
                    {o.cites.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontFamily: FONT_MONO }}>
                        <CiteRow cites={o.cites} events={events} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <p style={help}>These describe practice: tries, hints, breaks and how it felt. They are not grades, labels or diagnoses. You decide what they mean.</p>
      </div>
    </div>
  )
}
