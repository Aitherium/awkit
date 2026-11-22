'use client'

/**
 * Rocker Switch — the hardware kind. A tall housing with four corner screws
 * holds a single rocker paddle that tilts in perspective and lights its active
 * "I" or "O" mark. It is a real button with role="switch", so Space/Enter and
 * the exposed checked state both work.
 */

import { useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'toggles-rocker-switch',
  title: 'Tactile Rocker',
  category: 'toggles',
  tags: ['rocker', 'hardware', 'tactile', 'power', '3d'],
}

const css = `
.awk-el-toggles-rocker-switch {
  display: inline-flex;
  align-items: center;
  gap: 0.8rem;
  font-family: var(--font-sans, 'Inter', -apple-system, sans-serif);
}

.awk-el-toggles-rocker-switch__rock {
  padding: 0;
  border: 0;
  background: none;
  border-radius: 12px;
  cursor: pointer;
}

.awk-el-toggles-rocker-switch__rock:focus-visible {
  outline: 2px solid var(--border-focus, #00e5ff);
  outline-offset: 4px;
}

.awk-el-toggles-rocker-switch__housing {
  position: relative;
  display: block;
  width: 54px;
  height: 76px;
  border-radius: 11px;
  border: 1px solid var(--border-strong, #7d8fa3);
  background: linear-gradient(180deg, var(--bg-overlay, #22344e), var(--bg-surface, #0a1628));
  box-shadow:
    inset 0 2px 6px oklch(0 0 0 / 0.35),
    0 3px 10px oklch(0 0 0 / 0.3);
  overflow: hidden;
}

.awk-el-toggles-rocker-switch__housing::before,
.awk-el-toggles-rocker-switch__housing::after {
  content: '';
  position: absolute;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--text-ghost, #8a9bab);
  opacity: 0.45;
  z-index: 3;
}

.awk-el-toggles-rocker-switch__housing::before {
  top: 4px;
  left: 4px;
}

.awk-el-toggles-rocker-switch__housing::after {
  bottom: 4px;
  right: 4px;
}

.awk-el-toggles-rocker-switch__paddle {
  position: absolute;
  top: 6px;
  left: 5px;
  right: 5px;
  bottom: 6px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-radius: 8px;
  border: 1px solid var(--border-strong, #7d8fa3);
  background-image:
    repeating-linear-gradient(180deg, transparent 0 6px, oklch(0 0 0 / 0.14) 6px 7px),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--bg-elevated, #1a2a40) 88%, white),
      var(--bg-elevated, #1a2a40)
    );
  box-shadow:
    0 2px 0 oklch(0 0 0 / 0.35),
    0 1px 0 oklch(1 0 0 / 0.22) inset;
  transform: perspective(140px) rotateX(-8deg);
  transition:
    transform 180ms ease,
    box-shadow 180ms ease;
}

.awk-el-toggles-rocker-switch__rock[aria-checked='true']
  .awk-el-toggles-rocker-switch__paddle {
  transform: perspective(140px) rotateX(8deg);
  box-shadow:
    0 2px 0 oklch(0 0 0 / 0.35),
    0 1px 0 oklch(1 0 0 / 0.22) inset,
    0 0 0 1px color-mix(in srgb, var(--accent-primary, #00e5ff) 42%, transparent);
}

.awk-el-toggles-rocker-switch__mark {
  font: 800 10px/1 var(--font-mono, 'JetBrains Mono', monospace);
  letter-spacing: 0.08em;
  color: var(--text-ghost, #8a9bab);
  transition:
    color 180ms ease,
    text-shadow 180ms ease;
}

.awk-el-toggles-rocker-switch__rock[aria-checked='true']
  .awk-el-toggles-rocker-switch__mark--on {
  color: var(--accent-primary, #00e5ff);
  text-shadow: 0 0 8px color-mix(in srgb, var(--accent-primary, #00e5ff) 65%, transparent);
}

.awk-el-toggles-rocker-switch__rock[aria-checked='false']
  .awk-el-toggles-rocker-switch__mark--off {
  color: var(--text-secondary, #c3d2e2);
}

.awk-el-toggles-rocker-switch__text {
  font: 600 0.84rem/1.1 var(--font-sans, 'Inter', -apple-system, sans-serif);
  color: var(--text-primary, #e8f0f8);
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-toggles-rocker-switch__paddle,
  .awk-el-toggles-rocker-switch__mark {
    transition: none;
  }
}
`

export default function RockerSwitch(): JSX.Element {
  const [on, setOn] = useState(false)

  return (
    <div className="awk-el-toggles-rocker-switch">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Power"
        className="awk-el-toggles-rocker-switch__rock"
        onClick={() => setOn((value) => !value)}
      >
        <span className="awk-el-toggles-rocker-switch__housing" aria-hidden="true">
          <span className="awk-el-toggles-rocker-switch__paddle">
            <span className="awk-el-toggles-rocker-switch__mark awk-el-toggles-rocker-switch__mark--on">I</span>
            <span className="awk-el-toggles-rocker-switch__mark awk-el-toggles-rocker-switch__mark--off">O</span>
          </span>
        </span>
      </button>
      <span className="awk-el-toggles-rocker-switch__text">Power</span>
      <style>{css}</style>
    </div>
  )
}
