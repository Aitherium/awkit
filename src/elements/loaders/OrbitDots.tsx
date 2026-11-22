import type { CSSProperties } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'loaders-orbit-dots',
  title: 'Orbit Dots',
  category: 'loaders',
  tags: ['orbit', 'dots', 'rotating', 'subtle'],
}

const OUTER = [0, 1, 2, 3, 4, 5, 6, 7]
const INNER = [0, 1, 2]

const css = `
.awk-el-loaders-orbit-dots {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1.1rem;
  font-family: var(--font-sans, system-ui, sans-serif);
}

.awk-el-loaders-orbit-dots .stage {
  position: relative;
  width: 64px;
  height: 64px;
  display: grid;
  place-items: center;
}

.awk-el-loaders-orbit-dots .ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
}

.awk-el-loaders-orbit-dots .ring-outer {
  animation: awk-el-loaders-orbit-dots-1 3.4s linear infinite;
}

.awk-el-loaders-orbit-dots .ring-inner {
  animation: awk-el-loaders-orbit-dots-1 2.1s linear infinite reverse;
}

.awk-el-loaders-orbit-dots .dot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 6px;
  height: 6px;
  margin: -3px 0 0 -3px;
  border-radius: 50%;
  background: currentColor;
  color: var(--accent-primary, #00E5FF);
  transform: rotate(calc(var(--i) * 45deg)) translateY(-26px);
  animation: awk-el-loaders-orbit-dots-2 1.7s ease-in-out infinite;
  animation-delay: calc(var(--i) * 0.11s);
  will-change: opacity;
}

.awk-el-loaders-orbit-dots .ring-inner .dot {
  width: 5px;
  height: 5px;
  margin: -2.5px 0 0 -2.5px;
  color: var(--accent-secondary, #7C4DFF);
  transform: rotate(calc(var(--i) * 120deg)) translateY(-14px);
  animation-duration: 1.2s;
  animation-delay: calc(var(--i) * 0.16s);
}

.awk-el-loaders-orbit-dots .core {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent-primary, #00E5FF);
  box-shadow: 0 0 14px var(--accent-primary, #00E5FF);
  opacity: 0.9;
}

@keyframes awk-el-loaders-orbit-dots-1 {
  to { transform: rotate(360deg); }
}

@keyframes awk-el-loaders-orbit-dots-2 {
  0%, 100% { opacity: 0.25; box-shadow: none; }
  40% { opacity: 1; box-shadow: 0 0 8px currentColor; }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-loaders-orbit-dots .ring-outer,
  .awk-el-loaders-orbit-dots .ring-inner,
  .awk-el-loaders-orbit-dots .dot {
    animation: none;
  }
  .awk-el-loaders-orbit-dots .dot { opacity: 0.75; }
}
`

export default function OrbitDots(): JSX.Element {
  return (
    <div className="awk-el-loaders-orbit-dots" role="status" aria-label="Loading">
      <style>{css}</style>
      <div className="stage">
        <div className="ring ring-outer" aria-hidden="true">
          {OUTER.map(i => (
            <span key={i} className="dot" style={{ '--i': i } as CSSProperties} />
          ))}
        </div>
        <div className="ring ring-inner" aria-hidden="true">
          {INNER.map(i => (
            <span key={i} className="dot" style={{ '--i': i } as CSSProperties} />
          ))}
        </div>
        <span className="core" aria-hidden="true" />
      </div>
    </div>
  )
}
