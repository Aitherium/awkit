'use client'

/**
 * Split Action — a primary action fused to a menu trigger. The halves share a
 * single frame so they read as one control, but each is its own real button
 * with its own hover and focus ring. A live status dot sits before the label.
 */

import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'buttons-split-action',
  title: 'Split Action',
  category: 'buttons',
  tags: ['split', 'menu', 'composite', 'action', 'status'],
}

const css = `
.awk-el-buttons-split-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-sans, 'Inter', -apple-system, sans-serif);
}

.awk-el-buttons-split-action__group {
  display: inline-flex;
  overflow: hidden;
  border-radius: 10px;
  border: 1px solid var(--border-default, #4a6074);
  box-shadow: 0 4px 14px oklch(0 0 0 / 0.2);
}

.awk-el-buttons-split-action__main,
.awk-el-buttons-split-action__more {
  background: var(--bg-elevated, #1a2a40);
  color: var(--text-primary, #e8f0f8);
  font: 600 0.85rem/1 var(--font-sans, 'Inter', -apple-system, sans-serif);
  transition: background 160ms ease;
}

.awk-el-buttons-split-action__main {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.68rem 1.1rem;
}

.awk-el-buttons-split-action__status {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: var(--accent-green, #4ade80);
  box-shadow: 0 0 8px var(--accent-green, #4ade80);
}

.awk-el-buttons-split-action__more {
  display: grid;
  place-items: center;
  width: 42px;
  border-left: 1px solid var(--border-subtle, #3d4f63);
}

.awk-el-buttons-split-action__more svg {
  display: block;
  width: 14px;
  height: 14px;
  transition: transform 160ms ease;
}

.awk-el-buttons-split-action__main:hover,
.awk-el-buttons-split-action__more:hover {
  background: color-mix(in srgb, var(--text-primary, #e8f0f8) 8%, var(--bg-elevated, #1a2a40));
}

.awk-el-buttons-split-action__more:hover svg {
  transform: translateY(1px);
}

.awk-el-buttons-split-action__main:active,
.awk-el-buttons-split-action__more:active {
  background: color-mix(in srgb, var(--text-primary, #e8f0f8) 14%, var(--bg-elevated, #1a2a40));
}

.awk-el-buttons-split-action__main:focus-visible,
.awk-el-buttons-split-action__more:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--border-focus, #00e5ff);
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-buttons-split-action__main,
  .awk-el-buttons-split-action__more,
  .awk-el-buttons-split-action__more svg {
    transition: none;
  }
}
`

export default function SplitAction(): JSX.Element {
  return (
    <div className="awk-el-buttons-split-action">
      <div className="awk-el-buttons-split-action__group">
        <button type="button" className="awk-el-buttons-split-action__main">
          <span className="awk-el-buttons-split-action__status" aria-hidden="true" />
          Deploy
        </button>
        <button type="button" className="awk-el-buttons-split-action__more" aria-label="More deploy options">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>
      <style>{css}</style>
    </div>
  )
}
