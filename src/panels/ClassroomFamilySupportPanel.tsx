/**
 * ClassroomFamilySupportPanel (awkit): the Family Support Portal.
 *
 * For a guardian: each child at school (from a claimed parent code or a family link,
 * re-checked by Hearth on every call), then for the chosen child
 *   * the next meeting first: what it is for, the teacher's questions plus suggested
 *     ones families often want to ask, and ONLY the documents the family is
 *     authorized to review;
 *   * the Support Passport sections the school shares (never staff notes);
 *   * the teacher's messaging hours, when the teacher chose to show them;
 * and, for everyone, the plain-language glossary (PLAAFP, MTSS, RTI, accommodations vs
 * modifications, related services ...), searchable.
 *
 * Spec: docs/plans/2026-10-17-classroom-support-suite.md (slice 3).
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { C, FONT_UI, LEARN_CSS } from './learnTheme'
import { fieldBox, mono, quiet } from './learnParts'
import { CLASSROOM_CSS, cs, isNotFound } from './classroomApi'
import {
  OUTCOME_WORDS, SUPPORT_API, SUPPORT_KIND_WORDS, supportApi,
  type FamilyChild, type FamilyMeeting, type FamilyPassport, type GlossaryTerm,
} from './classroomSupportApi'
import { DayBars, SUPPORT_CSS, TileTitle, dayLabel, timeLabel } from './supportParts'

const SMALL: CSSProperties = { font: `400 14px/1.5 ${FONT_UI}`, color: C.dim }
const BODY: CSSProperties = { font: `400 16px/1.55 ${FONT_UI}`, color: C.ink }

export function Glossary({ terms, note }: { terms: GlossaryTerm[]; note?: string }) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? terms.filter((t) => `${t.term} ${t.full} ${t.plain}`.toLowerCase().includes(s)) : terms
  }, [q, terms])
  return (
    <section style={cs.tile} data-testid="family-glossary" aria-labelledby="fs-glossary">
      <div id="fs-glossary"><TileTitle eyebrow="plain words">What the school words mean</TileTitle></div>
      {note && <p style={{ margin: 0, ...SMALL }}>{note}</p>}
      <input className="al-field" style={{ ...fieldBox, minHeight: 44 }} value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Look up a word, e.g. PLAAFP" aria-label="Look up a word" />
      <dl style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
        {shown.map((t) => (
          <div key={t.term} style={{ padding: '12px 0', borderTop: `1px solid ${C.hairline}` }} data-testid="glossary-term">
            <dt style={{ color: C.ink, font: `500 16px/1.3 ${FONT_UI}` }}>{t.term}{t.full && <span style={{ ...SMALL, fontWeight: 400 }}>{` · ${t.full}`}</span>}</dt>
            <dd style={{ margin: '4px 0 0', ...BODY, fontSize: 15 }}>{t.plain}</dd>
          </div>
        ))}
        {shown.length === 0 && <p style={{ margin: 0, ...SMALL }}>No word matches. Ask the teacher: there are no silly questions.</p>}
      </dl>
    </section>
  )
}

function MeetingCard({ m }: { m: FamilyMeeting }) {
  return (
    <section style={{ ...cs.tile, borderColor: m.past ? C.hairline : C.accent }} data-testid="family-meeting">
      <TileTitle eyebrow={m.past ? `past · ${m.kind_title}` : m.kind_title}>{m.title}</TileTitle>
      <p style={{ margin: 0, ...SMALL }}>{[timeLabel(m.at), m.where].filter(Boolean).join(' · ')}</p>
      {m.purpose && (
        <div><span style={mono}>what it is for</span><p style={{ margin: '4px 0 0', ...BODY }}>{m.purpose}</p></div>
      )}
      {(m.teacher_questions.length > 0 || m.suggested_questions.length > 0) && (
        <div>
          <span style={mono}>questions you may want to ask</span>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20, ...BODY, fontSize: 15 }}>
            {m.teacher_questions.map((q) => <li key={`t-${q}`}>{q}</li>)}
            {m.suggested_questions.map((q) => <li key={`s-${q}`} style={{ color: C.dim }}>{q}</li>)}
          </ul>
        </div>
      )}
      <div>
        <span style={mono}>documents you can review</span>
        {m.documents.length === 0 ? (
          <p style={{ margin: '4px 0 0', ...SMALL }}>None listed yet. You can always ask to see your child&rsquo;s records before a meeting.</p>
        ) : (
          <ul style={{ margin: '6px 0 0', paddingLeft: 20, ...BODY, fontSize: 15 }}>
            {m.documents.map((d) => (
              <li key={d.title}>{d.section ? <a href={`#fs-${d.section}`} style={{ color: C.accent }}>{d.title}</a> : d.title}{d.note ? <span style={SMALL}>{` · ${d.note}`}</span> : null}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function Section({ s }: { s: FamilyPassport['sections'][number] }) {
  const body = s.body || {}
  const items: Array<Record<string, unknown> | string> = body.items || []
  return (
    <section style={cs.tile} id={`fs-${s.section}`} data-testid={`family-section-${s.section}`}>
      <TileTitle>{s.title}</TileTitle>
      {s.section === 'reviews' ? (
        <>
          {(body.upcoming || []).map((r: Record<string, string>) => <p key={r.id || r.title} style={{ margin: 0, ...BODY }}>{`${r.date ? `${dayLabel(r.date)} · ` : ''}${r.title}`}</p>)}
          {(body.actions || []).filter((a: Record<string, unknown>) => !a.done).map((a: Record<string, string>) => (
            <p key={a.id || a.text} style={{ margin: 0, ...SMALL }}>{`To do: ${a.text}${a.owner ? ` (${a.owner})` : ''}${a.due ? `, by ${dayLabel(a.due)}` : ''}`}</p>
          ))}
        </>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {items.map((it, i) => {
            if (typeof it === 'string') return <li key={i} style={{ padding: '6px 0', borderTop: i ? `1px solid ${C.hairline}` : 'none', ...BODY }}>{it}</li>
            const main = String(it.goal || it.strategy || it.support || '')
            const sub = s.section === 'goals'
              ? [it.target && `target ${it.target}`, ...((it.progress as Array<Record<string, string>> | undefined) || []).slice(-3).map((p) => `${dayLabel(p.at)}: ${p.value}`)]
              : s.section === 'strategies'
                ? [OUTCOME_WORDS[String(it.outcome || '')], it.note]
                : [SUPPORT_KIND_WORDS[String(it.kind || 'accommodation')], it.owner && `by ${it.owner}`, it.when]
            return (
              <li key={i} style={{ padding: '8px 0', borderTop: i ? `1px solid ${C.hairline}` : 'none' }}>
                <div style={BODY}>{main}</div>
                <div style={SMALL}>{sub.filter(Boolean).join(' · ')}</div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export interface ClassroomFamilySupportPanelProps { apiBase?: string; extraHeaders?: Record<string, string> }

export default function ClassroomFamilySupportPanel({ apiBase = SUPPORT_API, extraHeaders }: ClassroomFamilySupportPanelProps) {
  const [kids, setKids] = useState<FamilyChild[] | null>(null)
  const [pick, setPick] = useState<FamilyChild | null>(null)
  const [pp, setPp] = useState<FamilyPassport | null>(null)
  const [meetings, setMeetings] = useState<FamilyMeeting[] | null>(null)
  const [terms, setTerms] = useState<{ terms: GlossaryTerm[]; note: string } | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'offline'>('loading')

  const load = useCallback(async () => {
    try {
      const [k, g] = await Promise.all([supportApi.familyChildren(apiBase, extraHeaders), supportApi.glossary(apiBase, extraHeaders)])
      setKids(k.children); setTerms(g); setState('ready')
      setPick((cur) => cur || k.children[0] || null)
    } catch { setState('offline') }
  }, [apiBase, extraHeaders])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!pick) return
    setPp(null); setMeetings(null)
    supportApi.familyPassport(apiBase, pick.class_id, pick.member_id, extraHeaders).then(setPp).catch((e) => { if (isNotFound(e)) setPp(null) })
    supportApi.familyMeetings(apiBase, pick.class_id, pick.member_id, extraHeaders).then((r) => setMeetings(r.meetings)).catch(() => setMeetings([]))
  }, [apiBase, extraHeaders, pick])

  const upcoming = (meetings || []).filter((m) => !m.past)
  const past = (meetings || []).filter((m) => m.past)

  return (
    <div className="cr-col" data-testid="family-support-panel">
      <style>{LEARN_CSS + CLASSROOM_CSS + SUPPORT_CSS}</style>
      <div className="cr-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={mono}>family support</span>
          <h1 style={cs.h1}>Your child at school</h1>
          <p style={cs.sub}>What the school shares about how your child is supported, what the next meeting is for, and what the words mean.</p>
        </div>
      </div>
      {state === 'loading' && <div style={cs.offline} role="status">Loading…</div>}
      {state === 'offline' && <div style={cs.offline} role="status">This page could not be reached. <button type="button" className="al-quiet al-focus" style={quiet} onClick={load}>Retry</button></div>}
      {state === 'ready' && kids && kids.length === 0 && (
        <p style={{ margin: 0, ...SMALL }} data-testid="family-no-children">No child is linked to a class yet. A teacher gives you a code; enter it on the Classroom join page.</p>
      )}
      {kids && kids.length > 1 && (
        <nav className="cr-tabs" aria-label="Your children">
          {kids.map((k) => (
            <button key={`${k.class_id}-${k.member_id}`} type="button" className="al-focus" aria-pressed={pick?.member_id === k.member_id && pick?.class_id === k.class_id}
              style={pick?.member_id === k.member_id && pick?.class_id === k.class_id ? { ...cs.tab, ...cs.tabOn } : cs.tab} onClick={() => setPick(k)}>
              {`${k.alias}${k.class_name ? ` · ${k.class_name}` : ''}`}
            </button>
          ))}
        </nav>
      )}
      {pick && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 style={cs.h2} data-testid="family-child-name">{pick.alias}</h2>
            {pick.class_name && <span style={SMALL}>{pick.class_name}</span>}
          </div>
          {pick.teacher_hours && (
            <p style={{ ...cs.amberNote, margin: 0 }} data-testid="family-teacher-hours">
              {`The teacher reads messages outside ${pick.teacher_hours.quiet_start}–${pick.teacher_hours.quiet_end}${pick.teacher_hours.quiet_weekends ? ' on school days' : ''} and replies within ${pick.teacher_hours.reply_within_hours} hours.`}
              {pick.teacher_hours.auto_reply ? ` ${pick.teacher_hours.auto_reply}` : ''}
            </p>
          )}
          {upcoming.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span style={mono}>getting ready for a meeting</span>
              {upcoming.map((m) => <MeetingCard key={m.id} m={m} />)}
            </div>
          )}
          {pp && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span style={mono}>support passport · what the school shares</span>
              {pp.sections.length === 0 && !pp.data && <p style={{ margin: 0, ...SMALL }}>Nothing is shared yet.</p>}
              <div className="cr-grid">{pp.sections.map((s) => <Section key={s.section} s={s} />)}</div>
              {pp.data && pp.data.length > 0 && (
                <section style={cs.tile} data-testid="family-data">
                  <TileTitle>What the class is counting</TileTitle>
                  {pp.data.map((d) => (
                    <div key={d.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${C.hairline}`, paddingTop: 8 }}>
                      <span style={BODY}>{d.label}<span style={SMALL}>{` · ${d.total_14d} in the last two weeks`}</span></span>
                      <DayBars series={d.series} label={d.label} height={64} />
                    </div>
                  ))}
                </section>
              )}
            </div>
          )}
          {past.length > 0 && (
            <details><summary style={{ ...quiet, cursor: 'pointer' }}>{`Past meetings (${past.length})`}</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>{past.map((m) => <MeetingCard key={m.id} m={m} />)}</div>
            </details>
          )}
        </>
      )}
      {terms && <Glossary terms={terms.terms} note={terms.note} />}
    </div>
  )
}
