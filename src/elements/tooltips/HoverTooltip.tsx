import { useId } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'tooltips-hover-top',
  title: 'Hover Top Tooltip',
  category: 'tooltips',
  tags: ['tooltip', 'hover', 'hint', 'top'],
}

const css = `
.awk-el-tooltips-hover-top {
  --awk-ht-accent: var(--accent-primary, #00E5FF);
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2.4rem 0 0.6rem;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-tooltips-hover-top * {
  box-sizing: border-box;
}

.awk-el-tooltips-hover-top .ht-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 34px;
  padding: 0.42rem 0.8rem;
  border: 1px solid var(--border-default, #5d7594);
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary, #c8d3df);
  font: inherit;
  font-size: 0.74rem;
  font-weight: 550;
  cursor: help;
  transition: border-color 0.18s ease, color 0.18s ease, background 0.18s ease;
}

.awk-el-tooltips-hover-top .ht-trigger svg {
  width: 13px;
  height: 13px;
  color: var(--awk-ht-accent);
}

.awk-el-tooltips-hover-top .ht-trigger:hover,
.awk-el-tooltips-hover-top .ht-trigger:focus-visible {
  border-color: var(--awk-ht-accent);
  color: var(--text-primary, #E8F0F8);
  background: rgba(0, 229, 255, 0.07);
  background: color-mix(in oklab, var(--awk-ht-accent) 8%, transparent);
}

.awk-el-tooltips-hover-top .ht-trigger:focus-visible {
  outline: 2px solid var(--border-focus, var(--awk-ht-accent));
  outline-offset: 2px;
}

.awk-el-tooltips-hover-top .ht-bubble {
  position: absolute;
  bottom: calc(100% - 1.5rem);
  left: 50%;
  z-index: 20;
  width: max-content;
  max-width: 230px;
  padding: 0.45rem 0.65rem;
  transform: translate(-50%, 4px);
  border: 1px solid var(--border-strong, #8fa3bd);
  border-radius: var(--radius, 8px);
  background: var(--bg-overlay, #22344E);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
  color: var(--text-primary, #E8F0F8);
  font-size: 0.7rem;
  line-height: 1.45;
  text-align: center;
  white-space: normal;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.16s ease, transform 0.16s ease, visibility 0.16s;
}

.awk-el-tooltips-hover-top .ht-bubble::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  width: 8px;
  height: 8px;
  transform: translate(-50%, -50%) rotate(45deg);
  border-right: 1px solid var(--border-strong, #8fa3bd);
  border-bottom: 1px solid var(--border-strong, #8fa3bd);
  background: var(--bg-overlay, #22344E);
}

.awk-el-tooltips-hover-top .ht-trigger:hover + .ht-bubble,
.awk-el-tooltips-hover-top .ht-trigger:focus-visible + .ht-bubble {
  opacity: 1;
  visibility: visible;
  transform: translate(-50%, 0);
}

.awk-el-tooltips-hover-top .ht-hint {
  margin: 0;
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-ghost, #7a8ba3);
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-tooltips-hover-top * {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`

export default function HoverTopTooltip(): JSX.Element {
  const id = useId()

  return (
    <div className="awk-el-tooltips-hover-top">
      <style>{css}</style>
      <button type="button" className="ht-trigger" aria-describedby={id}>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3 4.5 6.2v5.1c0 4.4 3.1 8.2 7.5 9.7 4.4-1.5 7.5-5.3 7.5-9.7V6.2L12 3Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
        Shared memory
      </button>
      <span className="ht-bubble" id={id} role="tooltip">
        Your agents can read this memory, never write to it.
      </span>
      <p className="ht-hint">Hover or focus</p>
    </div>
  )
}
