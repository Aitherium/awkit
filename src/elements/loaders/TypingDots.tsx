import type { CSSProperties } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'loaders-typing-dots',
  title: 'Typing Dots',
  category: 'loaders',
  tags: ['typing', 'chat', 'assistant', 'bubble'],
}

const DOTS = [0, 1, 2]

const css = `
.awk-el-loaders-typing-dots {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  padding: 1rem;
  font-family: var(--font-sans, system-ui, sans-serif);
}

.awk-el-loaders-typing-dots .bubble {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 13px;
  border-radius: 14px 14px 14px 4px;
  background: var(--bg-elevated, #1A2A40);
  border: 1px solid var(--border-subtle, oklch(0.42 0.02 250));
  box-shadow: 0 6px 18px color-mix(in oklab, var(--bg-deep, #060D1A) 55%, transparent);
}

.awk-el-loaders-typing-dots .bubble::after {
  content: "";
  position: absolute;
  left: -1px;
  bottom: -1px;
  width: 7px;
  height: 7px;
  background: inherit;
  border-right: 1px solid var(--border-subtle, oklch(0.42 0.02 250));
  border-bottom: 1px solid var(--border-subtle, oklch(0.42 0.02 250));
  border-bottom-right-radius: 3px;
  transform: skewX(-28deg);
}

.awk-el-loaders-typing-dots .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-primary, #00E5FF);
  opacity: 0.45;
  animation: awk-el-loaders-typing-dots-1 1.2s ease-in-out infinite;
  animation-delay: calc(var(--i) * 0.16s);
  will-change: transform, opacity;
}

.awk-el-loaders-typing-dots .dot:nth-child(2) { background: var(--accent-cyan, #40C4FF); }
.awk-el-loaders-typing-dots .dot:nth-child(3) { background: var(--accent-bridge, #536DFE); }

.awk-el-loaders-typing-dots .caption {
  font-size: 0.7rem;
  letter-spacing: 0.03em;
  color: var(--text-ghost, oklch(0.56 0.02 250));
}

@keyframes awk-el-loaders-typing-dots-1 {
  0%, 60%, 100% { opacity: 0.35; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-4px); }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-loaders-typing-dots .dot {
    animation: none;
    opacity: 0.8;
  }
}
`

export default function TypingDots(): JSX.Element {
  return (
    <div className="awk-el-loaders-typing-dots">
      <style>{css}</style>
      <div className="bubble" role="status" aria-label="Assistant is typing">
        {DOTS.map(i => (
          <span key={i} className="dot" style={{ '--i': i } as CSSProperties} aria-hidden="true" />
        ))}
      </div>
      <span className="caption">Aither is typing</span>
    </div>
  )
}
