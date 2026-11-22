'use client'

/**
 * Neon Pulse — a dark, bracketed outline that breathes. The accent is used as
 * light: text glow, an inset haze and an outer bloom that pulses on a slow
 * ease. Corner brackets keep it technical. Colour comes from the accent token,
 * so it darkens with the theme instead of washing out on white.
 */

import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'buttons-neon-pulse',
  title: 'Neon Pulse',
  category: 'buttons',
  tags: ['neon', 'glow', 'outline', 'pulse', 'technical'],
}

const css = `
.awk-el-buttons-neon-pulse {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-sans, 'Inter', -apple-system, sans-serif);
}

.awk-el-buttons-neon-pulse__btn {
  position: relative;
  padding: 0.68rem 1.35rem;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--accent-primary, #00e5ff) 70%, transparent);
  background: rgba(0, 229, 255, 0.06);
  background: color-mix(in srgb, var(--accent-primary, #00e5ff) 7%, transparent);
  color: var(--accent-primary, #00e5ff);
  font: 700 0.78rem/1 var(--font-sans, 'Inter', -apple-system, sans-serif);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  text-shadow: 0 0 10px color-mix(in srgb, var(--accent-primary, #00e5ff) 55%, transparent);
  box-shadow:
    inset 0 0 14px color-mix(in srgb, var(--accent-primary, #00e5ff) 14%, transparent),
    0 0 18px color-mix(in srgb, var(--accent-primary, #00e5ff) 20%, transparent);
  animation: awk-el-buttons-neon-pulse-1 2.8s ease-in-out infinite;
}

.awk-el-buttons-neon-pulse__btn::before,
.awk-el-buttons-neon-pulse__btn::after {
  content: '';
  position: absolute;
  width: 8px;
  height: 8px;
  pointer-events: none;
  opacity: 0.75;
}

.awk-el-buttons-neon-pulse__btn::before {
  left: 5px;
  top: 5px;
  border-left: 2px solid currentColor;
  border-top: 2px solid currentColor;
}

.awk-el-buttons-neon-pulse__btn::after {
  right: 5px;
  bottom: 5px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
}

@keyframes awk-el-buttons-neon-pulse-1 {
  0%,
  100% {
    box-shadow:
      inset 0 0 10px color-mix(in srgb, var(--accent-primary, #00e5ff) 12%, transparent),
      0 0 10px color-mix(in srgb, var(--accent-primary, #00e5ff) 16%, transparent);
  }
  50% {
    box-shadow:
      inset 0 0 18px color-mix(in srgb, var(--accent-primary, #00e5ff) 24%, transparent),
      0 0 26px color-mix(in srgb, var(--accent-primary, #00e5ff) 36%, transparent);
  }
}

.awk-el-buttons-neon-pulse__btn:hover {
  background: color-mix(in srgb, var(--accent-primary, #00e5ff) 13%, transparent);
  text-shadow: 0 0 14px color-mix(in srgb, var(--accent-primary, #00e5ff) 80%, transparent);
}

.awk-el-buttons-neon-pulse__btn:focus-visible {
  outline: 2px solid var(--border-focus, #00e5ff);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-buttons-neon-pulse__btn {
    animation: none;
  }
}
`

export default function NeonPulse(): JSX.Element {
  return (
    <div className="awk-el-buttons-neon-pulse">
      <button type="button" className="awk-el-buttons-neon-pulse__btn">
        Connect
      </button>
      <style>{css}</style>
    </div>
  )
}
