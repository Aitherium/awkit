'use client'

/**
 * State Switch — a rectangular switch with its state written inside the
 * track. The word sits on the side the thumb is not: "ON" left when on, "OFF"
 * right when off, so the label and the knob tell the same story. The words
 * are decorative; the checkbox carries the accessible state.
 */

import { useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'toggles-state-switch',
  title: 'State Switch',
  category: 'toggles',
  tags: ['switch', 'labeled', 'on off', 'worded', 'settings'],
}

const css = `
.awk-el-toggles-state-switch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-sans, 'Inter', -apple-system, sans-serif);
}

.awk-el-toggles-state-switch__row {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
  cursor: pointer;
  user-select: none;
}

.awk-el-toggles-state-switch__input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.awk-el-toggles-state-switch__track {
  position: relative;
  flex: 0 0 auto;
  width: 62px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid var(--border-default, #4a6074);
  background: var(--bg-overlay, #22344e);
  transition:
    background 200ms ease,
    border-color 200ms ease;
}

.awk-el-toggles-state-switch__on,
.awk-el-toggles-state-switch__off {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  font: 800 9px/1 var(--font-sans, 'Inter', -apple-system, sans-serif);
  letter-spacing: 0.1em;
  transition: opacity 160ms ease;
  pointer-events: none;
}

.awk-el-toggles-state-switch__on {
  left: 9px;
  color: var(--bg-deep, #060d1a);
  opacity: 0;
}

.awk-el-toggles-state-switch__off {
  right: 9px;
  color: var(--text-muted, #a9baca);
  opacity: 1;
}

.awk-el-toggles-state-switch__thumb {
  position: absolute;
  top: 2px;
  left: 3px;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: #ffffff;
  box-shadow:
    0 1px 3px oklch(0 0 0 / 0.3),
    0 0 0 1px oklch(0 0 0 / 0.06);
  transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
}

.awk-el-toggles-state-switch__input:checked + .awk-el-toggles-state-switch__track {
  background: var(--accent-primary, #00e5ff);
  border-color: var(--accent-primary, #00e5ff);
}

.awk-el-toggles-state-switch__input:checked
  + .awk-el-toggles-state-switch__track
  .awk-el-toggles-state-switch__thumb {
  transform: translateX(30px);
}

.awk-el-toggles-state-switch__input:checked
  + .awk-el-toggles-state-switch__track
  .awk-el-toggles-state-switch__on {
  opacity: 1;
}

.awk-el-toggles-state-switch__input:checked
  + .awk-el-toggles-state-switch__track
  .awk-el-toggles-state-switch__off {
  opacity: 0;
}

.awk-el-toggles-state-switch__input:focus-visible + .awk-el-toggles-state-switch__track {
  outline: 2px solid var(--border-focus, #00e5ff);
  outline-offset: 3px;
}

.awk-el-toggles-state-switch__text {
  font: 600 0.84rem/1.1 var(--font-sans, 'Inter', -apple-system, sans-serif);
  color: var(--text-primary, #e8f0f8);
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-toggles-state-switch__track,
  .awk-el-toggles-state-switch__on,
  .awk-el-toggles-state-switch__off,
  .awk-el-toggles-state-switch__thumb {
    transition: none;
  }
}
`

export default function StateSwitch(): JSX.Element {
  const [on, setOn] = useState(true)

  return (
    <div className="awk-el-toggles-state-switch">
      <label className="awk-el-toggles-state-switch__row">
        <input
          type="checkbox"
          className="awk-el-toggles-state-switch__input"
          checked={on}
          onChange={(event) => setOn(event.target.checked)}
        />
        <span className="awk-el-toggles-state-switch__track" aria-hidden="true">
          <span className="awk-el-toggles-state-switch__on">ON</span>
          <span className="awk-el-toggles-state-switch__off">OFF</span>
          <span className="awk-el-toggles-state-switch__thumb" />
        </span>
        <span className="awk-el-toggles-state-switch__text">Auto-publish</span>
      </label>
      <style>{css}</style>
    </div>
  )
}
