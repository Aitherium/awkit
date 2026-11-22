'use client'

/**
 * Layered Press — a chunky violet key with a solid lower edge. Hovering
 * brightens it; pressing drives it down onto that edge and collapses the
 * shadow, so the button physically moves rather than just tinting. The edge
 * colour is fixed violet so it reads the same on either preview theme.
 */

import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'buttons-press-3d',
  title: 'Layered Press',
  category: 'buttons',
  tags: ['3d', 'tactile', 'press', 'bold', 'primary'],
}

const css = `
.awk-el-buttons-press-3d {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-sans, 'Inter', -apple-system, sans-serif);
}

.awk-el-buttons-press-3d__btn {
  padding: 0.72rem 1.4rem;
  border-radius: 10px;
  color: #ffffff;
  background: linear-gradient(180deg, #8a5cff, #6b3ae8);
  font: 700 0.8rem/1 var(--font-sans, 'Inter', -apple-system, sans-serif);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  box-shadow:
    0 5px 0 #42258f,
    0 9px 20px oklch(0 0 0 / 0.35),
    0 1px 0 oklch(1 0 0 / 0.28) inset;
  transform: translateY(0);
  transition:
    transform 80ms ease,
    box-shadow 80ms ease,
    filter 150ms ease;
}

.awk-el-buttons-press-3d__btn:hover {
  filter: brightness(1.08);
}

.awk-el-buttons-press-3d__btn:active {
  transform: translateY(5px);
  box-shadow:
    0 0 0 #42258f,
    0 2px 6px oklch(0 0 0 / 0.3),
    0 1px 0 oklch(1 0 0 / 0.2) inset;
}

.awk-el-buttons-press-3d__btn:focus-visible {
  outline: 2px solid var(--border-focus, #00e5ff);
  outline-offset: 4px;
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-buttons-press-3d__btn {
    transition: none;
  }
}
`

export default function Press3D(): JSX.Element {
  return (
    <div className="awk-el-buttons-press-3d">
      <button type="button" className="awk-el-buttons-press-3d__btn">
        Ship it
      </button>
      <style>{css}</style>
    </div>
  )
}
