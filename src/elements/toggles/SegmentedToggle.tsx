'use client'

/**
 * Segmented Toggle — two mutually exclusive choices in one pill. Real radio
 * inputs give arrow-key cycling and a single tab stop; a sliding accent
 * indicator is the only decoration. The name comes from useId so several
 * instances on a page never interfere.
 */

import { useId, useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'toggles-segmented-toggle',
  title: 'Segmented Toggle',
  category: 'toggles',
  tags: ['segmented', 'radio', 'two state', 'slider', 'choices'],
}

type Mode = 'manual' | 'auto'

const css = `
.awk-el-toggles-segmented-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-sans, 'Inter', -apple-system, sans-serif);
}

.awk-el-toggles-segmented-toggle__seg {
  position: relative;
  display: inline-flex;
  padding: 3px;
  border-radius: 999px;
  border: 1px solid var(--border-default, #4a6074);
  background: var(--bg-elevated, #1a2a40);
}

.awk-el-toggles-segmented-toggle__ind {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 3px;
  width: calc(50% - 3px);
  border-radius: 999px;
  background: var(--accent-primary, #00e5ff);
  z-index: 0;
  transition: transform 220ms cubic-bezier(0.4, 0, 0.2, 1);
}

.awk-el-toggles-segmented-toggle__seg[data-mode='auto']
  .awk-el-toggles-segmented-toggle__ind {
  transform: translateX(100%);
}

.awk-el-toggles-segmented-toggle__opt {
  position: relative;
  z-index: 1;
  flex: 1 1 0;
  min-width: 74px;
  cursor: pointer;
}

.awk-el-toggles-segmented-toggle__inp {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}

.awk-el-toggles-segmented-toggle__opt span {
  display: block;
  padding: 0.45rem 0.95rem;
  border-radius: 999px;
  text-align: center;
  font: 600 0.8rem/1 var(--font-sans, 'Inter', -apple-system, sans-serif);
  color: var(--text-muted, #a9baca);
  transition: color 180ms ease;
}

.awk-el-toggles-segmented-toggle__inp:checked + span {
  color: var(--bg-deep, #060d1a);
}

.awk-el-toggles-segmented-toggle__inp:focus-visible + span {
  outline: 2px solid var(--border-focus, #00e5ff);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-toggles-segmented-toggle__ind,
  .awk-el-toggles-segmented-toggle__opt span {
    transition: none;
  }
}
`

export default function SegmentedToggle(): JSX.Element {
  const [mode, setMode] = useState<Mode>('manual')
  const name = useId()

  return (
    <div className="awk-el-toggles-segmented-toggle">
      <div
        className="awk-el-toggles-segmented-toggle__seg"
        data-mode={mode}
        role="group"
        aria-label="Dispatch mode"
      >
        <span className="awk-el-toggles-segmented-toggle__ind" aria-hidden="true" />
        <label className="awk-el-toggles-segmented-toggle__opt">
          <input
            type="radio"
            name={name}
            value="manual"
            className="awk-el-toggles-segmented-toggle__inp"
            checked={mode === 'manual'}
            onChange={() => setMode('manual')}
          />
          <span>Manual</span>
        </label>
        <label className="awk-el-toggles-segmented-toggle__opt">
          <input
            type="radio"
            name={name}
            value="auto"
            className="awk-el-toggles-segmented-toggle__inp"
            checked={mode === 'auto'}
            onChange={() => setMode('auto')}
          />
          <span>Auto</span>
        </label>
      </div>
      <style>{css}</style>
    </div>
  )
}
