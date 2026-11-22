'use client'

/**
 * Shimmer Pill — a fully rounded button with a slow band of accent light
 * travelling across it, like a metal edge catching a light source. The band
 * runs on a long cycle so the tile never feels restless; reduced motion stops
 * it dead. A lit accent dot anchors the label.
 */

import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'buttons-shimmer-pill',
  title: 'Shimmer Pill',
  category: 'buttons',
  tags: ['pill', 'shimmer', 'rounded', 'animated', 'secondary'],
}

const css = `
.awk-el-buttons-shimmer-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-sans, 'Inter', -apple-system, sans-serif);
}

.awk-el-buttons-shimmer-pill__btn {
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.7rem 1.5rem;
  border-radius: 999px;
  border: 1px solid var(--border-default, #4a6074);
  background: linear-gradient(180deg, var(--bg-elevated, #1a2a40), var(--bg-surface, #0a1628));
  color: var(--text-primary, #e8f0f8);
  font: 600 0.85rem/1 var(--font-sans, 'Inter', -apple-system, sans-serif);
  letter-spacing: 0.01em;
  box-shadow:
    0 1px 0 oklch(1 0 0 / 0.07) inset,
    0 4px 14px oklch(0 0 0 / 0.2);
  transition:
    border-color 200ms ease,
    box-shadow 200ms ease;
}

.awk-el-buttons-shimmer-pill__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: var(--accent-primary, #00e5ff);
  box-shadow: 0 0 8px var(--accent-primary, #00e5ff);
}

.awk-el-buttons-shimmer-pill__btn::after {
  content: '';
  position: absolute;
  top: -20%;
  bottom: -20%;
  left: -40%;
  width: 35%;
  pointer-events: none;
  transform: skewX(-20deg);
  background: linear-gradient(90deg, transparent, rgba(0, 229, 255, 0.24), transparent);
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--accent-primary, #00e5ff) 30%, transparent),
    transparent
  );
  animation: awk-el-buttons-shimmer-pill-1 3.6s ease-in-out infinite;
}

@keyframes awk-el-buttons-shimmer-pill-1 {
  0%,
  55% {
    left: -40%;
  }
  100% {
    left: 130%;
  }
}

.awk-el-buttons-shimmer-pill__btn:hover {
  border-color: color-mix(in srgb, var(--accent-primary, #00e5ff) 55%, var(--border-default, #4a6074));
  box-shadow:
    0 1px 0 oklch(1 0 0 / 0.09) inset,
    0 6px 20px oklch(0 0 0 / 0.26);
}

.awk-el-buttons-shimmer-pill__btn:focus-visible {
  outline: 2px solid var(--border-focus, #00e5ff);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-buttons-shimmer-pill__btn {
    transition: none;
  }
  .awk-el-buttons-shimmer-pill__btn::after {
    animation: none;
    left: -100%;
  }
}
`

export default function ShimmerPill(): JSX.Element {
  return (
    <div className="awk-el-buttons-shimmer-pill">
      <button type="button" className="awk-el-buttons-shimmer-pill__btn">
        <span className="awk-el-buttons-shimmer-pill__dot" aria-hidden="true" />
        Generate image
      </button>
      <style>{css}</style>
    </div>
  )
}
