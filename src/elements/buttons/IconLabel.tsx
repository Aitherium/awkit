'use client'

/**
 * Signal Action — an icon chip and a label in one control. The chip carries
 * the accent at rest and inverts when the button is hovered, so the whole
 * thing responds as a unit. The trailing arrow nudges forward on hover.
 */

import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'buttons-icon-label',
  title: 'Signal Action',
  category: 'buttons',
  tags: ['icon', 'label', 'chip', 'action', 'secondary'],
}

const css = `
.awk-el-buttons-icon-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-sans, 'Inter', -apple-system, sans-serif);
}

.awk-el-buttons-icon-label__btn {
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.45rem 0.95rem 0.45rem 0.45rem;
  border-radius: var(--radius-lg, 12px);
  border: 1px solid var(--border-subtle, #3d4f63);
  background: var(--bg-elevated, #1a2a40);
  color: var(--text-primary, #e8f0f8);
  font: 600 0.85rem/1 var(--font-sans, 'Inter', -apple-system, sans-serif);
  box-shadow:
    0 1px 0 oklch(1 0 0 / 0.06) inset,
    0 2px 8px oklch(0 0 0 / 0.16);
  transition:
    border-color 180ms ease,
    transform 120ms ease,
    box-shadow 200ms ease;
}

.awk-el-buttons-icon-label__chip {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent-primary, #00e5ff) 16%, transparent);
  color: var(--accent-primary, #00e5ff);
  transition:
    background 180ms ease,
    color 180ms ease;
}

.awk-el-buttons-icon-label__chip svg {
  display: block;
  width: 15px;
  height: 15px;
}

.awk-el-buttons-icon-label__arrow {
  width: 14px;
  height: 14px;
  opacity: 0.55;
  transition:
    transform 180ms ease,
    opacity 180ms ease;
}

.awk-el-buttons-icon-label__btn:hover {
  border-color: color-mix(in srgb, var(--accent-primary, #00e5ff) 45%, var(--border-subtle, #3d4f63));
  transform: translateY(-1px);
  box-shadow:
    0 1px 0 oklch(1 0 0 / 0.08) inset,
    0 6px 16px oklch(0 0 0 / 0.22);
}

.awk-el-buttons-icon-label__btn:hover .awk-el-buttons-icon-label__chip {
  background: var(--accent-primary, #00e5ff);
  color: var(--bg-deep, #060d1a);
}

.awk-el-buttons-icon-label__btn:hover .awk-el-buttons-icon-label__arrow {
  transform: translateX(3px);
  opacity: 1;
}

.awk-el-buttons-icon-label__btn:active {
  transform: translateY(0);
}

.awk-el-buttons-icon-label__btn:focus-visible {
  outline: 2px solid var(--border-focus, #00e5ff);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-buttons-icon-label__btn,
  .awk-el-buttons-icon-label__chip,
  .awk-el-buttons-icon-label__arrow {
    transition: none;
  }
}
`

export default function IconLabel(): JSX.Element {
  return (
    <div className="awk-el-buttons-icon-label">
      <button type="button" className="awk-el-buttons-icon-label__btn">
        <span className="awk-el-buttons-icon-label__chip" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l1-8Z" />
          </svg>
        </span>
        Run workflow
        <svg
          className="awk-el-buttons-icon-label__arrow"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>
      <style>{css}</style>
    </div>
  )
}
