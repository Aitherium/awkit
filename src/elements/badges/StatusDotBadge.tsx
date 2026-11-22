import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'badges-status-dot',
  title: 'Status Dot Badge',
  category: 'badges',
  tags: ['status', 'dot', 'live', 'pill'],
}

const css = `
.awk-el-badges-status-dot {
  --awk-sd-green: var(--accent-green, #4ade80);
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-badges-status-dot * {
  box-sizing: border-box;
}

.awk-el-badges-status-dot .sd-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.34rem 0.7rem 0.34rem 0.56rem;
  border: 1px solid rgba(74, 222, 128, 0.3);
  border-color: color-mix(in oklab, var(--awk-sd-green) 32%, transparent);
  border-radius: 999px;
  background: rgba(74, 222, 128, 0.1);
  background: color-mix(in oklab, var(--awk-sd-green) 11%, transparent);
  color: var(--awk-sd-green);
  font-size: 0.66rem;
  font-weight: 650;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.awk-el-badges-status-dot .sd-dot {
  position: relative;
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--awk-sd-green);
  box-shadow: 0 0 10px rgba(74, 222, 128, 0.7);
  box-shadow: 0 0 10px color-mix(in oklab, var(--awk-sd-green) 70%, transparent);
}

.awk-el-badges-status-dot .sd-dot::before,
.awk-el-badges-status-dot .sd-dot::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 1px solid currentColor;
  opacity: 0;
}

.awk-el-badges-status-dot .sd-dot::before {
  animation: awk-el-badges-status-dot-1 2.4s ease-out infinite;
}

.awk-el-badges-status-dot .sd-dot::after {
  animation: awk-el-badges-status-dot-1 2.4s ease-out 0.45s infinite;
}

.awk-el-badges-status-dot .sd-meta {
  margin: 0;
  padding-left: 0.1rem;
  font-family: var(--font-mono, monospace);
  font-size: 0.6rem;
  letter-spacing: 0.02em;
  color: var(--text-ghost, #7a8ba3);
}

@keyframes awk-el-badges-status-dot-1 {
  0% { transform: scale(0.7); opacity: 0.7; }
  75% { transform: scale(2.1); opacity: 0; }
  100% { transform: scale(2.1); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-badges-status-dot .sd-dot::before,
  .awk-el-badges-status-dot .sd-dot::after {
    animation: none !important;
  }
  .awk-el-badges-status-dot * {
    transition-duration: 0.01ms !important;
  }
}
`

export default function StatusDotBadge(): JSX.Element {
  return (
    <div className="awk-el-badges-status-dot">
      <style>{css}</style>
      <span className="sd-pill" role="status">
        <span className="sd-dot" aria-hidden="true" />
        Operational
      </span>
      <p className="sd-meta">14 / 14 services healthy</p>
    </div>
  )
}
