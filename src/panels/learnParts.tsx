/**
 * Aither Learn guardian building blocks: fields, buttons, the in-window sheet.
 * Colours come ONLY from learnTheme (`C`), so every piece works in both modes.
 */
import { useEffect, useRef, type CSSProperties, type ReactNode, type SelectHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { C, EASE, FONT_MONO, FONT_UI, learnVars, type LearnMode } from './learnTheme'

/** Lowercase mono system label (small caps, .18em). */
export const mono: CSSProperties = {
  font: `500 11px/1.4 ${FONT_MONO}`, letterSpacing: '.18em', textTransform: 'lowercase', color: C.faint,
}

export const primary: CSSProperties = {
  minHeight: 48, padding: '0 22px', borderRadius: 999, border: 'none', cursor: 'pointer',
  background: C.accent, color: C.onAccent, font: `500 15px/1 ${FONT_UI}`, letterSpacing: '-0.01em',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
}

/** A secondary action: a quiet text link, still a 44px tap target. */
export const quiet: CSSProperties = {
  minHeight: 44, padding: '0 2px', border: 'none', background: 'none', cursor: 'pointer',
  color: C.dim, font: `400 14px/1 ${FONT_UI}`, display: 'inline-flex', alignItems: 'center', gap: 6,
}

export const fieldBox: CSSProperties = {
  width: '100%', boxSizing: 'border-box', minHeight: 48, padding: '12px 14px', borderRadius: 12,
  border: `1px solid ${C.hairlineStrong}`, background: C.surface, color: C.ink,
  font: `400 16px/1.3 ${FONT_UI}`,
}

export const labelText: CSSProperties = { font: `500 13px/1.3 ${FONT_UI}`, color: C.dim }

export const help: CSSProperties = { font: `400 13px/1.5 ${FONT_UI}`, color: C.faint }

/** Label above a full-width field. In a wrapping row, fields share the line and wrap below 220px each.
 *  The 220px is a min-width, not a flex-basis: a basis is measured along the container's MAIN axis, so
 *  in a column (a form tile) it made every field 220px TALL and left a hole under the input. */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 'min(220px, 100%)', flex: '1 1 0' }}>
      <span style={labelText}>{label}</span>
      {children}
      {hint && <span style={help}>{hint}</span>}
    </label>
  )
}

/** A select with the family chevron (native control, restyled). */
export function SelectBox({ children, style, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span style={{ position: 'relative', display: 'block' }}>
      <select {...rest} className="al-field" style={{ ...fieldBox, appearance: 'none', WebkitAppearance: 'none', paddingRight: 40, cursor: 'pointer', ...style }}>
        {children}
      </select>
      <span aria-hidden style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', color: C.dim, pointerEvents: 'none', fontSize: 12 }}>▾</span>
    </span>
  )
}

/** A consent / option checkbox as a full-width tappable row. */
export function CheckRow({ checked, onChange, ariaLabel, children }: {
  checked: boolean
  onChange: (v: boolean) => void
  ariaLabel?: string
  children: ReactNode
}) {
  return (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: 14, minHeight: 52, boxSizing: 'border-box', padding: '14px 16px',
      borderRadius: 12, cursor: 'pointer', border: `1px solid ${checked ? C.accent : C.hairlineStrong}`,
      background: checked ? C.accentWash : 'transparent', color: C.ink, font: `400 15px/1.45 ${FONT_UI}`,
      transition: `border-color .18s ${EASE}, background-color .18s ${EASE}`,
    }}>
      <input type="checkbox" aria-label={ariaLabel} checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="al-focus" style={{ width: 20, height: 20, margin: '1px 0 0', flexShrink: 0, accentColor: C.accent, cursor: 'pointer' }} />
      <span>{children}</span>
    </label>
  )
}

/** Mono small-caps label + a light display heading. */
export function SheetHeading({ label, title }: { label: string; title: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={mono}>{label}</span>
      <h2 style={{ margin: 0, font: `400 26px/1.15 ${FONT_UI}`, letterSpacing: '-0.02em', color: C.ink }}>{title}</h2>
    </div>
  )
}

const SHEET_CSS = `
.al-sheet-wrap{position:fixed;inset:0;z-index:80;display:flex;align-items:flex-end;justify-content:center}
.al-sheet-panel{position:relative;width:100%;max-height:92vh;overflow-y:auto;overscroll-behavior:contain;box-sizing:border-box;
  border-radius:20px 20px 0 0;padding:22px 20px calc(24px + env(safe-area-inset-bottom,0px))}
@media (min-width:640px){
  .al-sheet-wrap{align-items:center;padding:24px}
  .al-sheet-panel{width:min(560px,100%);max-height:calc(100vh - 96px);border-radius:16px;padding:28px 32px 32px}
  .al-sheet-panel[data-wide]{width:min(760px,100%)}
}
`

/**
 * The in-window sheet. Rendered into the OS frame root when there is one, so it
 * sits above the frame's menubar and dock; inline otherwise. It carries the Learn
 * variables itself because a portal leaves the console's themed root.
 */
export function Sheet({ mode, host, label, onClose, wide, testId, children }: {
  mode: LearnMode
  host: Element | null
  label: string
  onClose: () => void
  wide?: boolean
  testId?: string
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    window.addEventListener('keydown', onKey)
    const t = setTimeout(() => panelRef.current?.focus(), 30)
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(t) }
  }, [])

  const node = (
    <div className="al-sheet-wrap" style={{ ...learnVars(mode), fontFamily: FONT_UI }} data-learn-theme={mode}>
      <style>{SHEET_CSS}</style>
      <div className="al-fade" aria-hidden onClick={onClose} style={{ position: 'absolute', inset: 0, background: C.scrim }} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} data-testid={testId}
        data-wide={wide ? '' : undefined} className="al-sheet-panel al-sheet"
        style={{ background: C.surface, color: C.ink, border: `1px solid ${C.hairline}`, boxShadow: C.shadow, outline: 'none' }}>
        <button type="button" onClick={onClose} aria-label="Close" className="al-quiet al-focus"
          style={{ ...quiet, position: 'absolute', top: 10, right: 12, minWidth: 44, justifyContent: 'center', ...mono, fontSize: 11 }}>
          close
        </button>
        {children}
      </div>
    </div>
  )
  return host ? createPortal(node, host) : node
}

/** A skeleton bar (no shimmer gradient: a soft opacity pulse). */
export function Skel({ w, h = 12, r = 6 }: { w: number | string; h?: number; r?: number }) {
  return <span className="al-skel" aria-hidden style={{ display: 'block', width: w, height: h, borderRadius: r, background: C.skeleton }} />
}
