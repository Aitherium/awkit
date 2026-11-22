import { useId, useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'checkboxes-switch-style',
  title: 'Switch-Style Checkbox',
  category: 'checkboxes',
  tags: ['checkbox', 'switch', 'toggle', 'setting'],
}

const css = `
.awk-el-checkboxes-switch-style {
  box-sizing: border-box;
  width: 100%;
  max-width: 340px;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-checkboxes-switch-style .row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.8rem 0.85rem;
  background: var(--bg-elevated, #1A2A40);
  border: 1px solid var(--border-default, #5d7594);
  border-radius: var(--radius-lg, 12px);
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.awk-el-checkboxes-switch-style .row:hover {
  border-color: var(--border-strong, #8fa3bd);
}

.awk-el-checkboxes-switch-style .row:focus-within {
  border-color: var(--accent-primary, #00E5FF);
  box-shadow: 0 0 0 3px rgba(0, 229, 255, 0.14);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent-primary, #00E5FF) 18%, transparent);
}

.awk-el-checkboxes-switch-style .native {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}

.awk-el-checkboxes-switch-style .copy {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  min-width: 0;
}

.awk-el-checkboxes-switch-style .name {
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--text-primary, #E8F0F8);
}

.awk-el-checkboxes-switch-style .sub {
  font-size: 0.7rem;
  color: var(--text-muted, #a8b6c8);
  transition: color 0.2s ease;
}

.awk-el-checkboxes-switch-style .track {
  position: relative;
  flex: none;
  width: 48px;
  height: 27px;
  margin-left: auto;
  border: 1px solid var(--border-default, #5d7594);
  border-radius: 999px;
  background: var(--bg-deep, #060D1A);
  transition: background 0.24s ease, border-color 0.24s ease;
}

.awk-el-checkboxes-switch-style .knob {
  position: absolute;
  top: 2px;
  left: 2px;
  display: grid;
  place-items: center;
  width: 21px;
  height: 21px;
  border-radius: 50%;
  background: var(--text-muted, #a8b6c8);
  color: var(--bg-deep, #060D1A);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
  transition: transform 0.24s cubic-bezier(0.2, 0.9, 0.3, 1), background 0.24s ease;
}

.awk-el-checkboxes-switch-style .knob svg {
  width: 11px;
  height: 11px;
  opacity: 0;
  transform: scale(0.5);
  transition: opacity 0.16s ease, transform 0.2s cubic-bezier(0.2, 1.4, 0.4, 1);
}

.awk-el-checkboxes-switch-style .native:checked ~ .track {
  background: linear-gradient(100deg, var(--accent-primary, #00E5FF), var(--accent-secondary, #7C4DFF));
  border-color: transparent;
}

.awk-el-checkboxes-switch-style .native:checked ~ .track .knob {
  transform: translateX(21px);
  background: var(--bg-deep, #060D1A);
  color: var(--accent-primary, #00E5FF);
}

.awk-el-checkboxes-switch-style .native:checked ~ .track .knob svg {
  opacity: 1;
  transform: scale(1);
}

.awk-el-checkboxes-switch-style .native:focus-visible ~ .track {
  outline: 2px solid var(--accent-primary, #00E5FF);
  outline-offset: 3px;
}

.awk-el-checkboxes-switch-style .state {
  margin-top: 0.5rem;
  padding-left: 0.15rem;
  font-family: var(--font-mono, monospace);
  font-size: 0.64rem;
  letter-spacing: 0.04em;
  color: var(--text-ghost, #7a8ba3);
  transition: color 0.2s ease;
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-checkboxes-switch-style *,
  .awk-el-checkboxes-switch-style *::before,
  .awk-el-checkboxes-switch-style *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`

export default function SwitchCheckbox(): JSX.Element {
  const id = useId()
  const [on, setOn] = useState(true)

  return (
    <div className="awk-el-checkboxes-switch-style">
      <style>{css}</style>
      <label className="row" htmlFor={id}>
        <input
          id={id}
          className="native"
          type="checkbox"
          checked={on}
          onChange={event => setOn(event.target.checked)}
        />
        <span className="copy">
          <span className="name">Cross-device sync</span>
          <span className="sub" aria-live="polite">{on ? 'Syncing to 3 devices' : 'Sync is paused'}</span>
        </span>
        <span className="track" aria-hidden="true">
          <span className="knob">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M5 12.5l4.4 4.4L19 7.4" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </span>
      </label>
      <div className="state">{on ? 'checked = true' : 'checked = false'}</div>
    </div>
  )
}
