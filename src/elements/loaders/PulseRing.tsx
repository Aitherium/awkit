import type { CSSProperties } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'loaders-pulse-ring',
  title: 'Pulse Ring',
  category: 'loaders',
  tags: ['pulse', 'radar', 'rings', 'connecting'],
}

const RINGS = [0, 1, 2]

const css = `
.awk-el-loaders-pulse-ring {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1.1rem;
  font-family: var(--font-sans, system-ui, sans-serif);
}

.awk-el-loaders-pulse-ring .stage {
  position: relative;
  width: 62px;
  height: 62px;
  display: grid;
  place-items: center;
}

.awk-el-loaders-pulse-ring .ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid var(--accent-primary, #00E5FF);
  opacity: 0;
  transform: scale(0.35);
  animation: awk-el-loaders-pulse-ring-1 2.1s cubic-bezier(0.2, 0.6, 0.3, 1) infinite;
  animation-delay: calc(var(--i) * 0.7s);
}

.awk-el-loaders-pulse-ring .ring:nth-child(2) {
  border-color: var(--accent-cyan, #40C4FF);
}

.awk-el-loaders-pulse-ring .ring:nth-child(3) {
  border-color: var(--accent-secondary, #7C4DFF);
}

.awk-el-loaders-pulse-ring .guide {
  position: absolute;
  inset: 6px;
  border-radius: 50%;
  border: 1px dashed color-mix(in oklab, var(--accent-primary, #00E5FF) 30%, transparent);
}

.awk-el-loaders-pulse-ring .core {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, var(--accent-primary, #00E5FF), var(--accent-bridge, #536DFE));
  box-shadow:
    0 0 0 4px color-mix(in oklab, var(--accent-primary, #00E5FF) 14%, transparent),
    0 0 18px color-mix(in oklab, var(--accent-primary, #00E5FF) 55%, transparent);
  animation: awk-el-loaders-pulse-ring-2 1.4s ease-in-out infinite;
}

@keyframes awk-el-loaders-pulse-ring-1 {
  0% { opacity: 0.75; transform: scale(0.35); }
  100% { opacity: 0; transform: scale(1.55); }
}

@keyframes awk-el-loaders-pulse-ring-2 {
  0%, 100% { transform: scale(0.9); }
  50% { transform: scale(1.08); }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-loaders-pulse-ring .ring {
    animation: none;
    opacity: 0.35;
    transform: scale(0.75);
  }
  .awk-el-loaders-pulse-ring .ring:nth-child(2) { transform: scale(1); }
  .awk-el-loaders-pulse-ring .ring:nth-child(3) { transform: scale(1.25); }
  .awk-el-loaders-pulse-ring .core { animation: none; }
}
`

export default function PulseRing(): JSX.Element {
  return (
    <div className="awk-el-loaders-pulse-ring" role="status" aria-label="Connecting">
      <style>{css}</style>
      <div className="stage">
        <span className="guide" aria-hidden="true" />
        {RINGS.map(i => (
          <span key={i} className="ring" style={{ '--i': i } as CSSProperties} aria-hidden="true" />
        ))}
        <span className="core" aria-hidden="true" />
      </div>
    </div>
  )
}
