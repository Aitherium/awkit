import { useId } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'tooltips-animated-arrow',
  title: 'Animated Arrow Tooltip',
  category: 'tooltips',
  tags: ['tooltip', 'arrow', 'animation', 'hover'],
}

const css = `
.awk-el-tooltips-animated-arrow {
  --awk-aa-accent: var(--accent-primary, #00E5FF);
  --awk-aa-violet: var(--accent-secondary, #7C4DFF);
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  padding: 2.9rem 0.75rem 0.6rem;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-tooltips-animated-arrow * {
  box-sizing: border-box;
}

.awk-el-tooltips-animated-arrow .aa-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 34px;
  padding: 0.4rem 0.9rem;
  border: 1px solid transparent;
  border-radius: var(--radius, 8px);
  background: var(--gradient-creation, linear-gradient(135deg, #00E5FF, #536DFE, #7C4DFF));
  color: var(--bg-deep, #060D1A);
  font: inherit;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: filter 0.16s ease, transform 0.12s ease;
}

.awk-el-tooltips-animated-arrow .aa-trigger:hover {
  filter: brightness(1.06);
}

.awk-el-tooltips-animated-arrow .aa-trigger:active {
  transform: scale(0.98);
}

.awk-el-tooltips-animated-arrow .aa-trigger:focus-visible {
  outline: 2px solid var(--border-focus, var(--awk-aa-accent));
  outline-offset: 3px;
}

.awk-el-tooltips-animated-arrow .aa-bubble {
  position: absolute;
  bottom: calc(100% - 1.9rem);
  left: 50%;
  z-index: 20;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  width: max-content;
  max-width: 250px;
  padding: 0.45rem 0.7rem;
  border-radius: var(--radius, 8px);
  background: var(--bg-deep, #060D1A);
  border: 1px solid rgba(0, 229, 255, 0.35);
  border-color: color-mix(in oklab, var(--awk-aa-accent) 38%, transparent);
  box-shadow: 0 0 0 1px rgba(6, 13, 26, 0.5), 0 12px 28px rgba(0, 0, 0, 0.4),
    0 0 22px rgba(0, 229, 255, 0.1);
  color: var(--text-primary, #E8F0F8);
  font-size: 0.68rem;
  line-height: 1.4;
  opacity: 0;
  visibility: hidden;
  transform: translate(-50%, 8px) scale(0.94);
  transform-origin: 50% 100%;
  transition: opacity 0.2s cubic-bezier(0.2, 0.9, 0.2, 1), transform 0.24s cubic-bezier(0.2, 0.9, 0.2, 1.2), visibility 0.2s;
  pointer-events: none;
}

.awk-el-tooltips-animated-arrow .aa-bubble::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  width: 9px;
  height: 9px;
  margin-top: -5px;
  transform: translateX(-50%) rotate(45deg);
  background: var(--bg-deep, #060D1A);
  border-right: 1px solid rgba(0, 229, 255, 0.35);
  border-bottom: 1px solid rgba(0, 229, 255, 0.35);
  animation: awk-el-tooltips-animated-arrow-1 1.8s ease-in-out infinite;
}

.awk-el-tooltips-animated-arrow .aa-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--awk-aa-accent);
  box-shadow: 0 0 8px var(--awk-aa-accent);
}

.awk-el-tooltips-animated-arrow .aa-trigger:hover + .aa-bubble,
.awk-el-tooltips-animated-arrow .aa-trigger:focus-visible + .aa-bubble {
  opacity: 1;
  visibility: visible;
  transform: translate(-50%, 0) scale(1);
}

@keyframes awk-el-tooltips-animated-arrow-1 {
  0%, 100% { margin-top: -5px; }
  50% { margin-top: -2px; }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-tooltips-animated-arrow *,
  .awk-el-tooltips-animated-arrow *::after {
    transition-duration: 0.01ms !important;
    animation: none !important;
  }
}
`

export default function ArrowTooltip(): JSX.Element {
  const id = useId()

  return (
    <div className="awk-el-tooltips-animated-arrow">
      <style>{css}</style>
      <button type="button" className="aa-trigger" aria-describedby={id}>
        Run pipeline
      </button>
      <span className="aa-bubble" id={id} role="tooltip">
        <span className="aa-dot" aria-hidden="true" />
        Queues 3 stages on the MicroScheduler lane.
      </span>
    </div>
  )
}
