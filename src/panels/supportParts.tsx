/**
 * Building blocks the Classroom support surfaces share: plain SVG charts with a text
 * equivalent, the sharing switch, a one-line list editor and the Quick Tally tile
 * (Option A in docs/plans/2026-10-17-classroom-support-suite.md: a large "+1" target,
 * today's count readable at arm's length, a 7-day sparkline, undo for 8 seconds).
 *
 * Colours come ONLY from learnTheme (`C`), so every piece works in dark and light.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { C, EASE, FONT_MONO, FONT_UI } from './learnTheme'
import { fieldBox, mono, quiet } from './learnParts'
import type { Counter, DaySeries } from './classroomSupportApi'

export const SUPPORT_CSS = `
.sp-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.sp-two{display:grid;grid-template-columns:1fr;gap:16px}
.sp-list{display:grid;grid-template-columns:1fr;gap:12px}
@media (min-width:760px){
  .sp-tiles{grid-template-columns:repeat(4,minmax(0,1fr))}
  .sp-two{grid-template-columns:minmax(260px,320px) minmax(0,1fr)}
  .sp-list{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@keyframes sp-pop{0%{transform:scale(1)}40%{transform:scale(1.12)}100%{transform:scale(1)}}
.sp-pop{animation:sp-pop .32s ${EASE}}
@media (prefers-reduced-motion:reduce){.sp-pop{animation:none}}
`

/** Short weekday + day number, in the viewer's locale and time zone. */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00`)
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })
}

export function timeLabel(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

/** Daily bars, 14 days by default. The SVG is decorative; the table beside it is the data. */
export function DayBars({ series, label, height = 96 }: { series: DaySeries[]; label: string; height?: number }) {
  const max = Math.max(1, ...series.map((s) => s.count))
  const w = 100 / Math.max(1, series.length)
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="sp-daybars">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" width="100%" height={height} aria-hidden focusable="false">
        {series.map((s, i) => {
          const h = s.count ? Math.max(3, (s.count / max) * (height - 6)) : 1.5
          return <rect key={s.day} x={i * w + w * 0.15} y={height - h} width={w * 0.7} height={h} rx={1.2}
            fill={s.count ? C.accent : C.hairlineStrong} />
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', ...mono, fontSize: 10 }} aria-hidden>
        <span>{series[0] ? dayLabel(series[0].day) : ''}</span>
        <span>{series.length ? dayLabel(series[series.length - 1].day) : ''}</span>
      </div>
      <figcaption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {`${label}: ${series.map((s) => `${dayLabel(s.day)} ${s.count}`).join(', ')}`}
      </figcaption>
    </figure>
  )
}

export function Sparkline({ series }: { series: DaySeries[] }) {
  const max = Math.max(1, ...series.map((s) => s.count))
  const w = 100 / Math.max(1, series.length)
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" width="100%" height={24} aria-hidden focusable="false">
      {series.map((s, i) => {
        const h = s.count ? Math.max(2, (s.count / max) * 22) : 1
        return <rect key={s.day} x={i * w + w * 0.2} y={24 - h} width={w * 0.6} height={h} rx={1}
          fill={i === series.length - 1 ? C.accent : C.hairlineStrong} />
      })}
    </svg>
  )
}

/** A labelled on/off switch (a real checkbox, 44px tall). */
export function ShareSwitch({ label, checked, disabled, onChange, testId }: {
  label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; testId?: string
}) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, cursor: disabled ? 'default' : 'pointer',
      color: disabled ? C.faint : C.dim, font: `400 13px/1.2 ${FONT_UI}` }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}
        data-testid={testId} className="al-focus" style={{ width: 18, height: 18, margin: 0, accentColor: C.accent }} />
      {label}
    </label>
  )
}

/** Add / remove lines of text (strengths, interests, what works ...). */
export function LineList({ items, onChange, placeholder, testId, max = 30 }: {
  items: string[]; onChange: (next: string[]) => void; placeholder: string; testId?: string; max?: number
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (!v || items.length >= max) return
    onChange([...items, v])
    setDraft('')
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid={testId}>
      {items.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.map((it, i) => (
            <li key={`${i}-${it}`} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, color: C.ink, font: `400 15px/1.4 ${FONT_UI}` }}>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{it}</span>
              <button type="button" className="al-quiet al-focus" style={{ ...quiet, minHeight: 36, color: C.faint }}
                aria-label={`Remove ${it}`} onClick={() => onChange(items.filter((_x, j) => j !== i))}>remove</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(e) => { e.preventDefault(); add() }} style={{ display: 'flex', gap: 8 }}>
        <input className="al-field" style={{ ...fieldBox, minHeight: 44, flex: 1 }} value={draft} maxLength={300}
          onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
        <button type="submit" className="al-focus" style={{ ...addBtn }} disabled={!draft.trim()}>Add</button>
      </form>
    </div>
  )
}

export const addBtn: CSSProperties = {
  minHeight: 44, padding: '0 16px', borderRadius: 12, border: `1px solid ${C.hairlineStrong}`, background: C.raise,
  color: C.ink, cursor: 'pointer', font: `500 14px/1 ${FONT_UI}`, flexShrink: 0,
}

export const tileHead: CSSProperties = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }

export function TileTitle({ children, eyebrow }: { children: ReactNode; eyebrow?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      {eyebrow && <span style={mono}>{eyebrow}</span>}
      <h3 style={{ margin: 0, font: `400 18px/1.25 ${FONT_UI}`, color: C.ink, letterSpacing: '-0.01em' }}>{children}</h3>
    </div>
  )
}

/** Option A: one pinned counter. The whole right half is the "+1" target. */
export function TallyTile({ counter, name, onTap, onUndo, busy }: {
  counter: Counter
  name?: string
  onTap: () => Promise<number | null>
  onUndo: (markId: number) => Promise<void>
  busy?: boolean
}) {
  const [undoId, setUndoId] = useState<number | null>(null)
  const [pop, setPop] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const tap = async () => {
    const id = await onTap()
    if (id === null) return
    setPop((p) => p + 1)
    setUndoId(id)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setUndoId(null), 8000)
  }
  return (
    <div data-testid="sp-tally-tile" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 16, minWidth: 0,
      background: C.surface, border: `1px solid ${C.hairline}`, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 10, minHeight: 72 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 2 }}>
          {name && <span style={{ ...mono, color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>}
          <span style={{ font: `500 14px/1.25 ${FONT_UI}`, color: C.ink, overflowWrap: 'anywhere' }}>{counter.label}</span>
          <span key={pop} className={pop ? 'sp-pop' : undefined} aria-live="polite" data-testid="sp-tally-today"
            style={{ font: `300 30px/1 ${FONT_UI}`, color: C.ink, letterSpacing: '-0.02em' }}>
            {counter.today}<span style={{ ...mono, marginLeft: 6 }}>today</span>
          </span>
        </div>
        <button type="button" onClick={tap} disabled={busy} className="al-focus" data-testid="sp-tally-plus"
          aria-label={`Add one: ${name ? `${name}, ` : ''}${counter.label}`}
          style={{ width: 72, minWidth: 64, borderRadius: 14, border: 'none', cursor: 'pointer', background: C.accent, color: C.onAccent,
            font: `400 26px/1 ${FONT_UI}`, flexShrink: 0, opacity: busy ? 0.6 : 1, touchAction: 'manipulation' }}>
          +1
        </button>
      </div>
      <Sparkline series={counter.series.slice(-7)} />
      <div style={{ minHeight: 24, display: 'flex', alignItems: 'center' }}>
        {undoId !== null && (
          <button type="button" className="al-quiet al-focus" data-testid="sp-tally-undo"
            style={{ ...quiet, minHeight: 28, color: C.accent, font: `500 12px/1 ${FONT_MONO}`, letterSpacing: '.08em' }}
            onClick={async () => { const id = undoId; setUndoId(null); await onUndo(id) }}>
            undo last tap
          </button>
        )}
      </div>
    </div>
  )
}
