'use client'

/**
 * Ghost Sweep — a quiet outline button whose only ornament is a slanted band
 * of accent light that crosses it on hover. Uppercase and tracked, so it reads
 * as a secondary action rather than a competing primary.
 */

import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'buttons-ghost-sweep',
  title: 'Ghost Sweep',
  category: 'buttons',
  tags: ['ghost', 'outline', 'sweep', 'secondary', 'minimal'],
}

const css = `
.awk-el-buttons-ghost-sweep {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-sans, 'Inter', -apple-system, sans-serif);
}

.awk-el-buttons-ghost-sweep__btn {
  position: relative;
  overflow: hidden;
  padding: 0.7rem 1.45rem;
  border-radius: var(--radius, 8px);
  border: 1px solid var(--border-default, #4a6074);
  background: transparent;
  color: var(--text-secondary, #c3d2e2);
  font: 600 0.82rem/1 var(--font-sans, 'Inter', -apple-system, sans-serif);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  transition:
    color 200ms ease,
    border-color 200ms ease,
    box-shadow 200ms ease;
}

.awk-el-buttons-ghost-sweep__btn::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -60%;
  width: 45%;
  pointer-events: none;
  background: linear-gradient(100deg, transparent, rgba(0, 229, 255, 0.26), transparent);
  background: linear-gradient(
    100deg,
    transparent,
    color-mix(in srgb, var(--accent-primary, #00e5ff) 28%, transparent),
    transparent
  );
  transform: skewX(-18deg);
  transition: left 450ms ease;
}

.awk-el-buttons-ghost-sweep__btn:hover {
  color: var(--text-primary, #e8f0f8);
  border-color: color-mix(in srgb, var(--accent-primary, #00e5ff) 62%, var(--border-default, #4a6074));
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--accent-primary, #00e5ff) 22%, transparent),
    0 6px 18px oklch(0 0 0 / 0.18);
}

.awk-el-buttons-ghost-sweep__btn:hover::before {
  left: 115%;
}

.awk-el-buttons-ghost-sweep__btn:active {
  transform: translateY(1px);
}

.awk-el-buttons-ghost-sweep__btn:focus-visible {
  outline: 2px solid var(--border-focus, #00e5ff);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-buttons-ghost-sweep__btn,
  .awk-el-buttons-ghost-sweep__btn::before {
    transition: none;
  }
}
`

export default function GhostSweep(): JSX.Element {
  return (
    <div className="awk-el-buttons-ghost-sweep">
      <button type="button" className="awk-el-buttons-ghost-sweep__btn">
        View details
      </button>
      <style>{css}</style>
    </div>
  )
}
