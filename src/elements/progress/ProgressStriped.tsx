import { useEffect, useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'progress-striped',
  title: 'Striped Animated Bar',
  category: 'progress',
  tags: ['striped', 'animated', 'build', 'indeterminate'],
}

const TICK_MS = 90

const css = `
.awk-el-progress-striped {
  width: 100%;
  max-width: 320px;
  padding: 1rem;
  box-sizing: border-box;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-progress-striped .caption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.45rem;
  font-size: 0.74rem;
}

.awk-el-progress-striped .caption .state {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: var(--font-mono, monospace);
  font-size: 0.66rem;
  color: var(--text-ghost, oklch(0.56 0.02 250));
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.awk-el-progress-striped .caption .state::before {
  content: "";
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent-warm, #f59e0b);
  box-shadow: 0 0 6px var(--accent-warm, #f59e0b);
}

.awk-el-progress-striped .track {
  position: relative;
  height: 14px;
  border-radius: 8px;
  overflow: hidden;
  background: color-mix(in oklab, var(--bg-elevated, #1A2A40) 85%, transparent);
  border: 1px solid var(--border-subtle, oklch(0.42 0.02 250));
}

.awk-el-progress-striped .fill {
  position: relative;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent-secondary, #7C4DFF), var(--accent-primary, #00E5FF));
  transition: width 0.12s linear;
  overflow: hidden;
}

.awk-el-progress-striped .fill::after {
  content: "";
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
    -45deg,
    color-mix(in oklab, #ffffff 26%, transparent) 0 7px,
    transparent 7px 14px
  );
  animation: awk-el-progress-striped-1 0.85s linear infinite;
  will-change: background-position;
}

.awk-el-progress-striped .foot {
  display: flex;
  justify-content: space-between;
  margin-top: 0.4rem;
  font-family: var(--font-mono, monospace);
  font-size: 0.64rem;
  color: var(--text-ghost, oklch(0.56 0.02 250));
}

@keyframes awk-el-progress-striped-1 {
  from { background-position: 0 0; }
  to { background-position: 19.8px 0; }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-progress-striped .fill { transition: none; }
  .awk-el-progress-striped .fill::after { animation: none; }
}
`

export default function ProgressStriped(): JSX.Element {
  const [value, setValue] = useState(12)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setValue(64)
      return
    }
    const id = window.setInterval(() => {
      setValue(previous => (previous >= 100 ? 8 : Math.min(100, previous + 1.6)))
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  const shown = Math.round(value)

  return (
    <div className="awk-el-progress-striped">
      <style>{css}</style>
      <div className="caption">
        <span>Packaging assets</span>
        <span className="state">working</span>
      </div>
      <div
        className="track"
        role="progressbar"
        aria-label="Packaging assets"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={shown}
      >
        <div className="fill" style={{ width: `${value}%` }} />
      </div>
      <div className="foot">
        <span>build-9f21c</span>
        <span aria-hidden="true">{shown}%</span>
      </div>
    </div>
  )
}
