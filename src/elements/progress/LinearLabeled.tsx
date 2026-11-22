import { useEffect, useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'progress-linear-labeled',
  title: 'Labeled Linear Progress',
  category: 'progress',
  tags: ['linear', 'determinate', 'label', 'deploy'],
}

const TICK_MS = 130
const STEP = 4

const css = `
.awk-el-progress-linear-labeled {
  width: 100%;
  max-width: 340px;
  padding: 1rem;
  box-sizing: border-box;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-progress-linear-labeled .row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.awk-el-progress-linear-labeled .label {
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.awk-el-progress-linear-labeled .pct {
  font-family: var(--font-mono, monospace);
  font-size: 0.72rem;
  color: var(--accent-primary, #00E5FF);
  font-variant-numeric: tabular-nums;
}

.awk-el-progress-linear-labeled .track {
  position: relative;
  height: 9px;
  border-radius: 999px;
  overflow: hidden;
  background: color-mix(in oklab, var(--border-default, oklch(0.62 0.02 250)) 35%, transparent);
  box-shadow: inset 0 1px 2px color-mix(in oklab, var(--bg-deep, #060D1A) 45%, transparent);
}

.awk-el-progress-linear-labeled .fill {
  position: relative;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent-bridge, #536DFE), var(--accent-primary, #00E5FF));
  box-shadow: 0 0 10px color-mix(in oklab, var(--accent-primary, #00E5FF) 55%, transparent);
  transition: width 0.14s linear;
}

.awk-el-progress-linear-labeled .glint {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  width: 26px;
  background: linear-gradient(90deg, transparent, color-mix(in oklab, #ffffff 55%, transparent));
  animation: awk-el-progress-linear-labeled-1 1.3s ease-in-out infinite;
}

.awk-el-progress-linear-labeled .meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.5rem;
  font-size: 0.68rem;
  color: var(--text-ghost, oklch(0.56 0.02 250));
}

.awk-el-progress-linear-labeled .meta .dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent-green, #4ade80);
  box-shadow: 0 0 6px var(--accent-green, #4ade80);
  animation: awk-el-progress-linear-labeled-2 1.4s ease-in-out infinite;
}

@keyframes awk-el-progress-linear-labeled-1 {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.9; }
}

@keyframes awk-el-progress-linear-labeled-2 {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-progress-linear-labeled .fill { transition: none; }
  .awk-el-progress-linear-labeled .glint,
  .awk-el-progress-linear-labeled .meta .dot { animation: none; }
}
`

export default function LinearLabeled(): JSX.Element {
  const [value, setValue] = useState(6)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setValue(72)
      return
    }
    const id = window.setInterval(() => {
      setValue(previous => (previous >= 100 ? 0 : Math.min(100, previous + STEP)))
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="awk-el-progress-linear-labeled">
      <style>{css}</style>
      <div className="row">
        <span className="label">Deploying release</span>
        <span className="pct" aria-hidden="true">{value}%</span>
      </div>
      <div
        className="track"
        role="progressbar"
        aria-label="Deploying release"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
      >
        <div className="fill" style={{ width: `${value}%` }}>
          <span className="glint" aria-hidden="true" />
        </div>
      </div>
      <div className="meta">
        <span className="dot" aria-hidden="true" />
        us-east · 3 of 5 nodes
      </div>
    </div>
  )
}
