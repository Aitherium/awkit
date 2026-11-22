'use client'

/**
 * Classic Switch — the standard track and thumb, done properly: the checkbox
 * is a real focusable input laid invisibly over the whole row, so clicking the
 * label works and the keyboard ring lands on the track. The state caption is
 * visual only; assistive tech reads the checkbox state instead.
 */

import { useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'toggles-classic-switch',
  title: 'Classic Switch',
  category: 'toggles',
  tags: ['switch', 'toggle', 'settings', 'on off', 'classic'],
}

const css = `
.awk-el-toggles-classic-switch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-sans, 'Inter', -apple-system, sans-serif);
}

.awk-el-toggles-classic-switch__row {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
  cursor: pointer;
  user-select: none;
}

.awk-el-toggles-classic-switch__input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.awk-el-toggles-classic-switch__track {
  position: relative;
  flex: 0 0 auto;
  width: 46px;
  height: 26px;
  border-radius: 999px;
  border: 1px solid var(--border-default, #4a6074);
  background: var(--bg-overlay, #22344e);
  transition:
    background 200ms ease,
    border-color 200ms ease;
}

.awk-el-toggles-classic-switch__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 3px oklch(0 0 0 / 0.35);
  transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
}

.awk-el-toggles-classic-switch__input:checked + .awk-el-toggles-classic-switch__track {
  background: var(--accent-primary, #00e5ff);
  border-color: var(--accent-primary, #00e5ff);
}

.awk-el-toggles-classic-switch__input:checked
  + .awk-el-toggles-classic-switch__track
  .awk-el-toggles-classic-switch__thumb {
  transform: translateX(20px);
}

.awk-el-toggles-classic-switch__input:focus-visible
  + .awk-el-toggles-classic-switch__track {
  outline: 2px solid var(--border-focus, #00e5ff);
  outline-offset: 3px;
}

.awk-el-toggles-classic-switch__text {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  font: 600 0.84rem/1.1 var(--font-sans, 'Inter', -apple-system, sans-serif);
  color: var(--text-primary, #e8f0f8);
}

.awk-el-toggles-classic-switch__state {
  font: 500 0.66rem/1 var(--font-sans, 'Inter', -apple-system, sans-serif);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted, #a9baca);
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-toggles-classic-switch__track,
  .awk-el-toggles-classic-switch__thumb {
    transition: none;
  }
}
`

export default function ClassicSwitch(): JSX.Element {
  const [on, setOn] = useState(true)

  return (
    <div className="awk-el-toggles-classic-switch">
      <label className="awk-el-toggles-classic-switch__row">
        <input
          type="checkbox"
          className="awk-el-toggles-classic-switch__input"
          checked={on}
          onChange={(event) => setOn(event.target.checked)}
        />
        <span className="awk-el-toggles-classic-switch__track" aria-hidden="true">
          <span className="awk-el-toggles-classic-switch__thumb" />
        </span>
        <span className="awk-el-toggles-classic-switch__text">
          Sync
          <span className="awk-el-toggles-classic-switch__state" aria-hidden="true">
            {on ? 'On' : 'Off'}
          </span>
        </span>
      </label>
      <style>{css}</style>
    </div>
  )
}
