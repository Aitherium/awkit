import { useId } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'tooltips-keyboard-focus',
  title: 'Keyboard Focus Tooltip',
  category: 'tooltips',
  tags: ['tooltip', 'keyboard', 'focus', 'accessibility'],
}

const css = `
.awk-el-tooltips-keyboard-focus {
  --awk-kf-accent: var(--accent-primary, #00E5FF);
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.7rem;
  padding: 3rem 0.5rem 0.75rem;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-tooltips-keyboard-focus * {
  box-sizing: border-box;
}

.awk-el-tooltips-keyboard-focus .kf-label {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text-ghost, #7a8ba3);
}

.awk-el-tooltips-keyboard-focus .kf-label kbd {
  padding: 0.06rem 0.32rem;
  border: 1px solid var(--border-default, #5d7594);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--bg-elevated, #1A2A40);
  color: var(--text-secondary, #c8d3df);
  font-family: var(--font-mono, monospace);
  font-size: 0.56rem;
  letter-spacing: 0.02em;
}

.awk-el-tooltips-keyboard-focus .kf-anchor {
  position: relative;
  display: inline-flex;
}

.awk-el-tooltips-keyboard-focus .kf-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border: 1px solid var(--border-default, #5d7594);
  border-bottom-width: 3px;
  border-radius: var(--radius, 8px);
  background: var(--bg-elevated, #1A2A40);
  color: var(--text-secondary, #c8d3df);
  font: inherit;
  font-size: 0.72rem;
  font-weight: 650;
  cursor: pointer;
  transition: transform 0.1s ease, border-color 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
}

.awk-el-tooltips-keyboard-focus .kf-key:hover {
  border-color: var(--border-strong, #8fa3bd);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-tooltips-keyboard-focus .kf-key:active {
  transform: translateY(1px);
  border-bottom-width: 1px;
}

.awk-el-tooltips-keyboard-focus .kf-key:focus-visible {
  outline: 2px solid var(--border-focus, var(--awk-kf-accent));
  outline-offset: 2px;
  border-color: var(--awk-kf-accent);
  color: var(--awk-kf-accent);
  box-shadow: 0 0 0 5px rgba(0, 229, 255, 0.12);
  box-shadow: 0 0 0 5px color-mix(in oklab, var(--awk-kf-accent) 14%, transparent);
}

.awk-el-tooltips-keyboard-focus .kf-key svg {
  width: 18px;
  height: 18px;
}

.awk-el-tooltips-keyboard-focus .kf-bubble {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 20;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  width: max-content;
  padding: 0.42rem 0.6rem;
  transform: translateY(4px);
  border: 1px solid var(--border-strong, #8fa3bd);
  border-radius: var(--radius, 8px);
  background: var(--bg-overlay, #22344E);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.35);
  color: var(--text-primary, #E8F0F8);
  font-size: 0.68rem;
  line-height: 1.3;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.14s ease, transform 0.14s ease, visibility 0.14s;
}

.awk-el-tooltips-keyboard-focus .kf-bubble::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 22px;
  width: 8px;
  height: 8px;
  transform: translate(-50%, -50%) rotate(45deg);
  border-right: 1px solid var(--border-strong, #8fa3bd);
  border-bottom: 1px solid var(--border-strong, #8fa3bd);
  background: var(--bg-overlay, #22344E);
}

.awk-el-tooltips-keyboard-focus .kf-bubble kbd {
  padding: 0.04rem 0.25rem;
  border-radius: 3px;
  background: var(--bg-elevated, #1A2A40);
  color: var(--awk-kf-accent);
  font-family: var(--font-mono, monospace);
  font-size: 0.58rem;
}

.awk-el-tooltips-keyboard-focus .kf-key:focus-visible + .kf-bubble {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}

.awk-el-tooltips-keyboard-focus .kf-note {
  margin: 0;
  max-width: 210px;
  font-size: 0.64rem;
  line-height: 1.5;
  color: var(--text-ghost, #7a8ba3);
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-tooltips-keyboard-focus * {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`

export default function FocusTooltip(): JSX.Element {
  const id = useId()

  return (
    <div className="awk-el-tooltips-keyboard-focus">
      <style>{css}</style>
      <span className="kf-label">
        <kbd>Tab</kbd> to reveal
      </span>
      <span className="kf-anchor">
        <button type="button" className="kf-key" aria-label="Open command palette" aria-describedby={id}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3.5" y="5" width="17" height="13" rx="2.2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M6.8 9.2h.01M10.2 9.2h.01M13.6 9.2h.01M17 9.2h.01M8 12.6h8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
        </button>
        <span className="kf-bubble" id={id} role="tooltip">
          Open command palette <kbd>⌘K</kbd>
        </span>
      </span>
      <p className="kf-note">
        Tooltips on focus serve keyboard users; the focus ring stays visible.
      </p>
    </div>
  )
}
