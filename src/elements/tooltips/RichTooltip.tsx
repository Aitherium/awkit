import { useEffect, useId, useRef, useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'tooltips-rich-content',
  title: 'Rich Content Tooltip',
  category: 'tooltips',
  tags: ['tooltip', 'rich', 'permissions', 'info'],
}

const ROLES = [
  { scope: 'read', label: 'Vault objects', tone: 'ok' },
  { scope: 'write', label: 'Agent memory', tone: 'ok' },
  { scope: 'admin', label: 'Key rotation', tone: 'off' },
]

const css = `
.awk-el-tooltips-rich-content {
  --awk-rt-accent: var(--accent-primary, #00E5FF);
  --awk-rt-green: var(--accent-green, #4ade80);
  position: relative;
  display: inline-flex;
  padding: 3rem 0.5rem 0.75rem;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-tooltips-rich-content * {
  box-sizing: border-box;
}

.awk-el-tooltips-rich-content .rt-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 30px;
  padding: 0.3rem 0.65rem;
  border: 1px solid var(--border-default, #5d7594);
  border-radius: var(--radius, 8px);
  background: var(--bg-elevated, #1A2A40);
  color: var(--text-secondary, #c8d3df);
  font: inherit;
  font-size: 0.72rem;
  font-weight: 550;
  cursor: help;
  transition: border-color 0.16s ease, color 0.16s ease;
}

.awk-el-tooltips-rich-content .rt-trigger svg {
  width: 13px;
  height: 13px;
  color: var(--awk-rt-accent);
}

.awk-el-tooltips-rich-content .rt-trigger:hover,
.awk-el-tooltips-rich-content .rt-trigger[aria-expanded='true'] {
  border-color: var(--awk-rt-accent);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-tooltips-rich-content .rt-trigger:focus-visible {
  outline: 2px solid var(--border-focus, var(--awk-rt-accent));
  outline-offset: 2px;
}

.awk-el-tooltips-rich-content .rt-bubble {
  position: absolute;
  bottom: calc(100% - 1.9rem);
  left: 50%;
  z-index: 30;
  width: 246px;
  padding: 0.8rem 0.85rem;
  transform: translate(-50%, 5px);
  border: 1px solid var(--border-strong, #8fa3bd);
  border-radius: var(--radius-lg, 12px);
  background: var(--bg-overlay, #22344E);
  box-shadow: var(--shadow-window, 0 16px 48px rgba(0, 0, 0, 0.55));
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.17s ease, transform 0.17s ease, visibility 0.17s;
}

.awk-el-tooltips-rich-content .rt-bubble[data-open='true'] {
  opacity: 1;
  visibility: visible;
  transform: translate(-50%, 0);
}

.awk-el-tooltips-rich-content .rt-bubble::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  width: 9px;
  height: 9px;
  transform: translate(-50%, -50%) rotate(45deg);
  border-right: 1px solid var(--border-strong, #8fa3bd);
  border-bottom: 1px solid var(--border-strong, #8fa3bd);
  background: var(--bg-overlay, #22344E);
}

.awk-el-tooltips-rich-content .rt-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0;
  font-size: 0.76rem;
  font-weight: 650;
  letter-spacing: -0.005em;
}

.awk-el-tooltips-rich-content .rt-scope {
  font-family: var(--font-mono, monospace);
  font-size: 0.55rem;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-ghost, #7a8ba3);
}

.awk-el-tooltips-rich-content .rt-desc {
  margin: 0.3rem 0 0.65rem;
  font-size: 0.68rem;
  line-height: 1.5;
  color: var(--text-secondary, #c8d3df);
}

.awk-el-tooltips-rich-content .rt-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin: 0;
  padding: 0.6rem 0 0;
  border-top: 1px solid var(--border-subtle, #2b3f5c);
  list-style: none;
}

.awk-el-tooltips-rich-content .rt-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.66rem;
  color: var(--text-secondary, #c8d3df);
}

.awk-el-tooltips-rich-content .rt-key {
  flex: 0 0 auto;
  width: 44px;
  font-family: var(--font-mono, monospace);
  font-size: 0.58rem;
  letter-spacing: 0.02em;
  color: var(--text-ghost, #7a8ba3);
}

.awk-el-tooltips-rich-content .rt-val {
  flex: 1;
}

.awk-el-tooltips-rich-content .rt-mark {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-size: 0.55rem;
  font-weight: 700;
}

.awk-el-tooltips-rich-content .rt-mark[data-tone='ok'] {
  background: rgba(74, 222, 128, 0.16);
  background: color-mix(in oklab, var(--awk-rt-green) 16%, transparent);
  color: var(--awk-rt-green);
}

.awk-el-tooltips-rich-content .rt-mark[data-tone='off'] {
  background: rgba(168, 182, 200, 0.14);
  color: var(--text-ghost, #7a8ba3);
}

.awk-el-tooltips-rich-content .rt-foot {
  margin: 0.6rem 0 0;
  font-size: 0.6rem;
  color: var(--text-ghost, #7a8ba3);
}

.awk-el-tooltips-rich-content .rt-foot kbd {
  padding: 0.05rem 0.28rem;
  border: 1px solid var(--border-subtle, #2b3f5c);
  border-radius: 4px;
  font-family: var(--font-mono, monospace);
  font-size: 0.55rem;
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-tooltips-rich-content * {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`

export default function RichContentTooltip(): JSX.Element {
  const [open, setOpen] = useState(false)
  const id = useId()
  const root = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div
      className="awk-el-tooltips-rich-content"
      ref={root}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <style>{css}</style>
      <button
        type="button"
        className="rt-trigger"
        aria-expanded={open}
        aria-describedby={id}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(value => !value)}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
          <path d="M12 11v5.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          <circle cx="12" cy="7.9" r="1.1" fill="currentColor" />
        </svg>
        Workspace roles
      </button>

      <span className="rt-bubble" id={id} role="tooltip" data-open={open}>
        <span className="rt-title">
          Role grants
          <span className="rt-scope">vault · shared</span>
        </span>
        <span className="rt-desc">
          Scopes come from the authenticated caller. Payload ids never widen access.
        </span>
        <ul className="rt-list">
          {ROLES.map(role => (
            <li className="rt-row" key={role.scope}>
              <span className="rt-key">{role.scope}</span>
              <span className="rt-val">{role.label}</span>
              <span className="rt-mark" data-tone={role.tone} aria-hidden="true">
                {role.tone === 'ok' ? '✓' : '·'}
              </span>
            </li>
          ))}
        </ul>
        <p className="rt-foot">
          Press <kbd>Esc</kbd> to close · click to pin
        </p>
      </span>
    </div>
  )
}
