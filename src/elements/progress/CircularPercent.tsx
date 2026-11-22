import { useEffect, useId, useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'progress-circular-percent',
  title: 'Circular Percent Ring',
  category: 'progress',
  tags: ['circular', 'percent', 'ring', 'upload'],
}

const TICK_MS = 110
const RADIUS = 44
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const css = `
.awk-el-progress-circular-percent {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  font-family: var(--font-sans, system-ui, sans-serif);
}

.awk-el-progress-circular-percent .stage {
  position: relative;
  width: 116px;
  height: 116px;
  display: grid;
  place-items: center;
}

.awk-el-progress-circular-percent svg.ring {
  width: 116px;
  height: 116px;
  display: block;
}

.awk-el-progress-circular-percent .ring circle {
  fill: none;
}

.awk-el-progress-circular-percent .ring .track {
  stroke: color-mix(in oklab, var(--border-default, oklch(0.62 0.02 250)) 32%, transparent);
  stroke-width: 8;
}

.awk-el-progress-circular-percent .ring .value {
  stroke-width: 8;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.16s linear;
  filter: drop-shadow(0 0 5px color-mix(in oklab, var(--accent-primary, #00E5FF) 60%, transparent));
}

.awk-el-progress-circular-percent .center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  pointer-events: none;
}

.awk-el-progress-circular-percent .num {
  font-family: var(--font-mono, monospace);
  font-size: 1.42rem;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.03em;
  color: var(--text-primary, #E8F0F8);
  font-variant-numeric: tabular-nums;
}

.awk-el-progress-circular-percent .capt {
  font-size: 0.56rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-ghost, oklch(0.56 0.02 250));
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-progress-circular-percent .ring .value { transition: none; }
}
`

export default function CircularPercent(): JSX.Element {
  const [value, setValue] = useState(8)
  const rawId = useId()
  const gradientId = `awk-el-progress-circular-percent-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setValue(68)
      return
    }
    const id = window.setInterval(() => {
      setValue(previous => (previous >= 100 ? 0 : Math.min(100, previous + 2)))
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  const offset = CIRCUMFERENCE * (1 - value / 100)

  return (
    <div className="awk-el-progress-circular-percent">
      <style>{css}</style>
      <div className="stage">
        <svg
          className="ring"
          viewBox="0 0 104 104"
          role="progressbar"
          aria-label="Upload progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
        >
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#00E5FF" />
              <stop offset="100%" stopColor="#7C4DFF" />
            </linearGradient>
          </defs>
          <circle className="track" cx="52" cy="52" r={RADIUS} />
          <circle
            className="value"
            cx="52"
            cy="52"
            r={RADIUS}
            stroke={`url(#${gradientId})`}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            transform="rotate(-90 52 52)"
          />
        </svg>
        <div className="center" aria-hidden="true">
          <span className="num">{value}%</span>
          <span className="capt">uploaded</span>
        </div>
      </div>
    </div>
  )
}
