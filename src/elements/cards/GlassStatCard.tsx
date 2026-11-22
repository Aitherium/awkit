import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'cards-glass-stat',
  title: 'Glass Stat Card',
  category: 'cards',
  tags: ['stat', 'metric', 'glassmorphism', 'dashboard'],
}

const SPARK = '0,30 12,26 24,27 36,19 48,22 60,14 72,16 84,9 96,11 108,5 120,7'

const css = `
.awk-el-cards-glass-stat {
  --awk-gs-accent: var(--accent-cyan, #40C4FF);
  --awk-gs-violet: var(--accent-secondary, #7C4DFF);
  position: relative;
  isolation: isolate;
  width: 100%;
  max-width: 300px;
  padding: 1.25rem 1.3rem 1.1rem;
  overflow: hidden;
  border: 1px solid var(--border-subtle, #2b3f5c);
  border-radius: var(--radius-xl, 16px);
  background: rgba(26, 42, 64, 0.42);
  background: color-mix(in oklab, var(--bg-elevated, #1A2A40) 42%, transparent);
  backdrop-filter: blur(14px) saturate(1.25);
  -webkit-backdrop-filter: blur(14px) saturate(1.25);
  box-shadow: inset 0 1px 0 var(--border-subtle, #2b3f5c),
    0 12px 32px rgba(0, 0, 0, 0.18);
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-cards-glass-stat *,
.awk-el-cards-glass-stat *::before,
.awk-el-cards-glass-stat *::after {
  box-sizing: border-box;
}

.awk-el-cards-glass-stat::before {
  content: '';
  position: absolute;
  inset: -45% 45% 55% -20%;
  border-radius: 50%;
  background: radial-gradient(circle,
    color-mix(in oklab, var(--awk-gs-accent) 26%, transparent), transparent 70%);
  pointer-events: none;
  z-index: -1;
}

.awk-el-cards-glass-stat::after {
  content: '';
  position: absolute;
  inset: -20% -35% 60% 55%;
  border-radius: 50%;
  background: radial-gradient(circle,
    color-mix(in oklab, var(--awk-gs-violet) 22%, transparent), transparent 70%);
  pointer-events: none;
  z-index: -1;
}

.awk-el-cards-glass-stat .gs-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.awk-el-cards-glass-stat .gs-label {
  margin: 0;
  font-size: 0.64rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-cards-glass-stat .gs-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  padding: 0.2rem 0.45rem;
  border-radius: 999px;
  background: rgba(74, 222, 128, 0.14);
  background: color-mix(in oklab, var(--accent-green, #4ade80) 16%, transparent);
  color: var(--accent-green, #4ade80);
  font-family: var(--font-mono, monospace);
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.awk-el-cards-glass-stat .gs-chip svg {
  width: 10px;
  height: 10px;
}

.awk-el-cards-glass-stat .gs-value {
  display: flex;
  align-items: baseline;
  gap: 0.3rem;
  margin: 0.75rem 0 0;
  font-size: 2.35rem;
  font-weight: 720;
  letter-spacing: -0.045em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.awk-el-cards-glass-stat .gs-unit {
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-cards-glass-stat .gs-caption {
  margin: 0.45rem 0 0;
  font-size: 0.7rem;
  color: var(--text-ghost, #7a8ba3);
}

.awk-el-cards-glass-stat .gs-spark {
  display: block;
  width: 100%;
  height: 46px;
  margin-top: 0.85rem;
  overflow: visible;
}

.awk-el-cards-glass-stat .gs-line {
  fill: none;
  stroke: var(--awk-gs-accent);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 260;
  stroke-dashoffset: 260;
  animation: awk-el-cards-glass-stat-1 1.6s ease forwards;
}

.awk-el-cards-glass-stat .gs-area {
  fill: var(--awk-gs-accent);
  opacity: 0.12;
}

.awk-el-cards-glass-stat .gs-dot {
  fill: var(--awk-gs-accent);
}

@keyframes awk-el-cards-glass-stat-1 {
  to { stroke-dashoffset: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-cards-glass-stat *,
  .awk-el-cards-glass-stat *::before,
  .awk-el-cards-glass-stat *::after {
    transition-duration: 0.01ms !important;
    animation: none !important;
  }
  .awk-el-cards-glass-stat .gs-line { stroke-dashoffset: 0; }
}
`

export default function GlassStatCard(): JSX.Element {
  return (
    <article className="awk-el-cards-glass-stat" aria-label="Agent uptime 98.4 percent">
      <style>{css}</style>
      <div className="gs-top">
        <p className="gs-label">Agent uptime</p>
        <span className="gs-chip">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 19V5m0 0-5.5 5.5M12 5l5.5 5.5"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          2.1%
        </span>
      </div>

      <p className="gs-value">
        98.4<span className="gs-unit">%</span>
      </p>
      <p className="gs-caption">Rolling 7-day window · 14 services</p>

      <svg className="gs-spark" viewBox="0 0 120 36" role="img" aria-label="Uptime trending upward over seven days">
        <polygon className="gs-area" points={`0,36 ${SPARK} 120,36`} />
        <polyline className="gs-line" points={SPARK} />
        <circle className="gs-dot" cx="120" cy="7" r="2.6" />
      </svg>
    </article>
  )
}
