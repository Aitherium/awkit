import type { CSSProperties } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'loaders-bar-equalizer',
  title: 'Bar Equalizer',
  category: 'loaders',
  tags: ['bars', 'audio', 'equalizer', 'rhythm'],
}

const BARS = [0, 1, 2, 3, 4, 5]

const css = `
.awk-el-loaders-bar-equalizer {
  display: inline-flex;
  padding: 0.5rem;
  font-family: var(--font-sans, system-ui, sans-serif);
}

.awk-el-loaders-bar-equalizer .pill {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 58px;
  padding: 0.6rem 0.85rem;
  border-radius: 12px;
  border: 1px solid var(--border-subtle, oklch(0.42 0.02 250));
  background: color-mix(in oklab, var(--bg-elevated, #1A2A40) 42%, transparent);
  backdrop-filter: blur(6px);
  box-shadow: inset 0 1px 0 color-mix(in oklab, var(--text-primary, #E8F0F8) 6%, transparent);
}

.awk-el-loaders-bar-equalizer .bar {
  width: 5px;
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(180deg, var(--accent-secondary, #7C4DFF), var(--accent-primary, #00E5FF));
  transform-origin: bottom center;
  transform: scaleY(0.3);
  animation: awk-el-loaders-bar-equalizer-1 1.05s ease-in-out infinite;
  animation-delay: calc(var(--i) * -0.17s);
  will-change: transform;
}

.awk-el-loaders-bar-equalizer .bar:nth-child(2n) {
  background: linear-gradient(180deg, var(--accent-primary, #00E5FF), var(--accent-cyan, #40C4FF));
}

.awk-el-loaders-bar-equalizer .bar:nth-child(3n) {
  background: linear-gradient(180deg, var(--accent-bridge, #536DFE), var(--accent-secondary, #7C4DFF));
}

@keyframes awk-el-loaders-bar-equalizer-1 {
  0%, 100% { transform: scaleY(0.28); }
  25% { transform: scaleY(0.95); }
  45% { transform: scaleY(0.52); }
  65% { transform: scaleY(1); }
  82% { transform: scaleY(0.4); }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-loaders-bar-equalizer .bar {
    animation: none;
    transform: scaleY(0.55);
  }
}
`

export default function BarEqualizer(): JSX.Element {
  return (
    <div className="awk-el-loaders-bar-equalizer" role="status" aria-label="Loading audio">
      <style>{css}</style>
      <div className="pill">
        {BARS.map(i => (
          <span key={i} className="bar" style={{ '--i': i } as CSSProperties} aria-hidden="true" />
        ))}
      </div>
    </div>
  )
}
