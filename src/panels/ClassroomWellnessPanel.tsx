/**
 * ClassroomWellnessPanel (awkit): the teacher's own workload and boundaries.
 *
 * Private to the teacher (Hearth stores it under their own user id; nobody else reads
 * it). Three things, phone first:
 *   * Do first: open tasks ranked overdue, due today, due within three days, quick wins
 *     under ten minutes, then the rest.
 *   * Where the time goes: log minutes by admin category in two taps; two weeks of
 *     totals by category (largest first) and per day.
 *   * Boundaries: quiet hours, an auto-reply line and a reply window, optionally shown to
 *     families on their portal.
 *
 * Spec: docs/plans/2026-10-17-classroom-support-suite.md (slice 4).
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { C, FONT_MONO, FONT_UI, LEARN_CSS } from './learnTheme'
import { Field, SelectBox, fieldBox, mono, primary, quiet } from './learnParts'
import { CLASSROOM_CSS, cs } from './classroomApi'
import { SUPPORT_API, browserZone, supportApi, type WellnessView } from './classroomSupportApi'
import { DayBars, SUPPORT_CSS, ShareSwitch, TileTitle, addBtn, dayLabel } from './supportParts'

const SMALL: CSSProperties = { font: `400 13px/1.45 ${FONT_UI}`, color: C.dim }
const QUICK_MINUTES = [10, 15, 30, 60]
const BUCKET_WORDS: Record<string, string> = { overdue: 'overdue', today: 'due today', soon: 'due soon', quick: 'quick win', later: 'later' }

export function hoursMinutes(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`
}

export interface ClassroomWellnessPanelProps { apiBase?: string; extraHeaders?: Record<string, string> }

export default function ClassroomWellnessPanel({ apiBase = SUPPORT_API, extraHeaders }: ClassroomWellnessPanelProps) {
  const [v, setV] = useState<WellnessView | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'offline' | 'refused'>('loading')
  const [cat, setCat] = useState('paperwork')
  const [task, setTask] = useState({ text: '', due: '', minutes: '' })
  const [prefs, setPrefs] = useState<WellnessView['prefs'] | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { const r = await supportApi.wellness(apiBase, extraHeaders); setV(r); setPrefs(r.prefs); setState('ready') } catch (e) {
      setState((e as { status?: number }).status === 403 ? 'refused' : 'offline')
    }
  }, [apiBase, extraHeaders])
  useEffect(() => { load() }, [load])

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setErr(null)
    try { await fn(); if (ok) setSaved(ok); await load() } catch (e) { setErr((e as Error).message) }
  }

  return (
    <div className="cr-col" data-testid="classroom-wellness-panel">
      <style>{LEARN_CSS + CLASSROOM_CSS + SUPPORT_CSS}</style>
      <div className="cr-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={mono}>just for you</span>
          <h1 style={cs.h1}>Your workload</h1>
          <p style={cs.sub}>Where the time goes, what to do first, and when you are off. Only you see this page.</p>
        </div>
      </div>
      {state === 'loading' && <div style={cs.offline} role="status">Loading…</div>}
      {state === 'refused' && <div style={cs.offline} role="status">This page is for teachers.</div>}
      {state === 'offline' && <div style={cs.offline} role="status">This page could not be reached. <button type="button" className="al-quiet al-focus" style={quiet} onClick={load}>Retry</button></div>}
      {err && <p role="alert" style={{ margin: 0, color: C.amber, ...SMALL }}>{err}</p>}
      {saved && <p role="status" style={{ margin: 0, color: C.accent, ...SMALL }}>{saved}</p>}
      {state === 'ready' && v && (
        <div className="cr-split">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <section style={{ ...cs.tile, alignSelf: 'stretch' }} data-testid="wellness-do-first">
              <TileTitle eyebrow="do first">{v.tasks.length ? 'Start here' : 'Nothing waiting'}</TileTitle>
              {v.tasks.map((t, i) => (
                <div key={t.id} style={{ display: 'flex', gap: 10, alignItems: 'center', borderTop: `1px solid ${C.hairline}`, paddingTop: 8, opacity: i < 3 ? 1 : 0.8 }}>
                  <input type="checkbox" aria-label={`Done: ${t.text}`} style={{ width: 20, height: 20, accentColor: C.accent }}
                    onChange={() => run(() => supportApi.saveTask(apiBase, t.id, { text: t.text, category: t.category, due: t.due, minutes: t.minutes, done: true }, extraHeaders), 'Done. One less thing.')} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: C.ink, font: `${i < 3 ? 500 : 400} 15px/1.35 ${FONT_UI}` }}>{t.text}</div>
                    <div style={SMALL}>{[BUCKET_WORDS[t.bucket], t.due && dayLabel(t.due), t.minutes && hoursMinutes(t.minutes)].filter(Boolean).join(' · ')}</div>
                  </div>
                  <button type="button" className="al-quiet al-focus" style={{ ...quiet, minHeight: 32, color: C.faint }} onClick={() => run(() => supportApi.deleteTask(apiBase, t.id, extraHeaders))}>remove</button>
                </div>
              ))}
              <form onSubmit={(e) => { e.preventDefault(); if (!task.text.trim()) return
                run(() => supportApi.saveTask(apiBase, null, { text: task.text.trim(), due: task.due || null, minutes: task.minutes ? Number(task.minutes) : null, category: cat }, extraHeaders))
                setTask({ text: '', due: '', minutes: '' }) }}
                style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <input className="al-field" style={{ ...fieldBox, minHeight: 44, flex: 2, minWidth: 180 }} value={task.text} maxLength={200} placeholder="Add a task" aria-label="Add a task"
                  onChange={(e) => setTask({ ...task, text: e.target.value })} data-testid="wellness-task-text" />
                <input type="date" className="al-field" style={{ ...fieldBox, minHeight: 44, width: 160 }} value={task.due} aria-label="Due" onChange={(e) => setTask({ ...task, due: e.target.value })} />
                <input type="number" min={1} max={720} className="al-field" style={{ ...fieldBox, minHeight: 44, width: 96 }} value={task.minutes} placeholder="min" aria-label="Minutes it takes"
                  onChange={(e) => setTask({ ...task, minutes: e.target.value })} />
                <button type="submit" className="al-focus" style={addBtn} disabled={!task.text.trim()}>Add</button>
              </form>
            </section>
            <section style={cs.tile} data-testid="wellness-time">
              <TileTitle eyebrow={`last ${v.days} days · ${hoursMinutes(v.total_minutes)}`}>Where the time goes</TileTitle>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
                <Field label="Log time on">
                  <SelectBox value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
                    {Object.entries(v.category_titles).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                  </SelectBox>
                </Field>
                {QUICK_MINUTES.map((m) => (
                  <button key={m} type="button" className="al-focus" style={addBtn} data-testid={`wellness-log-${m}`}
                    onClick={() => run(() => supportApi.logTime(apiBase, { category: cat, minutes: m }, extraHeaders), `Logged ${hoursMinutes(m)}.`)}>{`+${m}`}</button>
                ))}
              </div>
              {v.categories.length === 0 && <p style={{ margin: 0, ...SMALL }}>Log a few days of admin time and the biggest drains show up here.</p>}
              {v.categories.map((c, i) => (
                <div key={c.category} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: C.ink, font: `${i === 0 ? 500 : 400} 14px/1.3 ${FONT_UI}` }}>
                    <span>{c.title}</span><span style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.dim }}>{hoursMinutes(c.minutes)}</span>
                  </div>
                  <div style={cs.bar}><div style={{ position: 'absolute', inset: 0, width: `${Math.round(c.share * 100)}%`, background: i === 0 ? C.accent : C.hairlineStrong }} /></div>
                </div>
              ))}
              {v.total_minutes > 0 && <DayBars series={v.per_day.map((d) => ({ day: d.day, count: d.minutes }))} label="Minutes per day" height={64} />}
            </section>
          </div>
          {prefs && (
            <section style={{ ...cs.tile, alignSelf: 'start' }} data-testid="wellness-boundaries">
              <TileTitle eyebrow="boundaries">When you are off</TileTitle>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <Field label="Quiet from"><input type="time" className="al-field" style={fieldBox} value={prefs.quiet_start} onChange={(e) => setPrefs({ ...prefs, quiet_start: e.target.value })} aria-label="Quiet from" /></Field>
                <Field label="Until"><input type="time" className="al-field" style={fieldBox} value={prefs.quiet_end} onChange={(e) => setPrefs({ ...prefs, quiet_end: e.target.value })} aria-label="Quiet until" /></Field>
              </div>
              <ShareSwitch label="Weekends are quiet too" checked={prefs.quiet_weekends} onChange={(b) => setPrefs({ ...prefs, quiet_weekends: b })} />
              <Field label="Reply within (hours)">
                <input type="number" min={1} max={168} className="al-field" style={{ ...fieldBox, width: 120 }} value={prefs.reply_within_hours}
                  onChange={(e) => setPrefs({ ...prefs, reply_within_hours: Math.max(1, Math.min(168, Number(e.target.value) || 1)) })} aria-label="Reply within hours" />
              </Field>
              <Field label="Auto-reply" hint="What families read when they write during quiet hours.">
                <textarea className="al-field" style={{ ...cs.textarea, minHeight: 72 }} maxLength={500} value={prefs.auto_reply}
                  onChange={(e) => setPrefs({ ...prefs, auto_reply: e.target.value })} aria-label="Auto-reply" />
              </Field>
              <ShareSwitch label="Hold family messages until quiet hours end (urgent or safety messages always reach you)"
                checked={prefs.hold_family_messages !== false} onChange={(b) => setPrefs({ ...prefs, hold_family_messages: b })} testId="wellness-hold" />
              <p style={{ margin: 0, ...SMALL }} data-testid="wellness-zone">{`Your time zone: ${browserZone() || 'unknown'}${prefs.tz && prefs.tz !== browserZone() ? ` (saved: ${prefs.tz})` : ''}. Saving uses this device's zone.`}</p>
              <ShareSwitch label="Show these hours to families on their portal" checked={prefs.share_hours_with_families}
                onChange={(b) => setPrefs({ ...prefs, share_hours_with_families: b })} testId="wellness-share-hours" />
              <div><button type="button" className="al-focus" style={primary} data-testid="wellness-save-prefs"
                onClick={() => run(() => supportApi.savePrefs(apiBase, { ...prefs, tz: browserZone() || prefs.tz || '' }, extraHeaders), 'Boundaries saved.')}>Save boundaries</button></div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
