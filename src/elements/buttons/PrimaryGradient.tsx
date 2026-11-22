'use client'

/**
 * Aurora Primary — the headline call to action. The Aitherium signature runs
 * cyan to violet across a filled gradient; a soft top sheen and a 1px lift on
 * hover give it depth without animation. White type holds on both themes.
 */

import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'buttons-primary-gradient',
  title: 'Aurora Primary',
  category: 'buttons',
  tags: ['primary', 'gradient', 'cta', 'glow', 'solid'],
}

const css = `
.awk-el-buttons-primary-gradient {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-sans, 'Inter', -apple-system, sans-serif);
}

.awk-el-buttons-primary-gradient__btn {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  padding: 0.72rem 1.5rem;
  border-radius: var(--radius-lg, 12px);
  color: #ffffff;
  background: linear-gradient(120deg, #0b7fa8 0%, #4457d8 52%, #7c4dff 100%);
  background-size: 160% 160%;
  background-position: 0% 50%;
  font: 600 0.9rem/1 var(--font-sans, 'Inter', -apple-system, sans-serif);
  letter-spacing: 0.01em;
  box-shadow:
    0 1px 0 oklch(1 0 0 / 0.25) inset,
    0 6px 20px oklch(0.42 0.18 285 / 0.35);
  transition:
    background-position 320ms ease,
    box-shadow 220ms ease,
    transform 140ms ease;
}

.awk-el-buttons-primary-gradient__btn::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background: linear-gradient(180deg, oklch(1 0 0 / 0.22), transparent 55%);
  pointer-events: none;
}

.awk-el-buttons-primary-gradient__btn:hover {
  background-position: 100% 50%;
  box-shadow:
    0 1px 0 oklch(1 0 0 / 0.3) inset,
    0 10px 28px oklch(0.45 0.2 285 / 0.45);
  transform: translateY(-1px);
}

.awk-el-buttons-primary-gradient__btn:active {
  transform: translateY(0) scale(0.985);
}

.awk-el-buttons-primary-gradient__btn:focus-visible {
  outline: 2px solid var(--border-focus, #00e5ff);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-buttons-primary-gradient__btn {
    transition: none;
  }
}
`

export default function PrimaryGradient(): JSX.Element {
  return (
    <div className="awk-el-buttons-primary-gradient">
      <button type="button" className="awk-el-buttons-primary-gradient__btn">
        Start building
      </button>
      <style>{css}</style>
    </div>
  )
}
