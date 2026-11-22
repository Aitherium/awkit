import { useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'cards-agent-status',
  title: 'Agent Status Card',
  category: 'cards',
  tags: ['agent', 'status', 'live', 'telemetry'],
}

const css = `
.awk-el-cards-agent-status {
  --awk-as-accent: var(--accent-primary, #00E5FF);
  --awk-as-violet: var(--accent-secondary, #7C4DFF);
  --awk-as-green: var(--accent-green, #4ade80);
  width: 100%;
  max-width: 340px;
  padding: 1.15rem 1.2rem;
  border: 1px solid var(--border-subtle, #2b3f5c);
  border-radius: var(--radius-xl, 16px);
  background:
    linear-gradient(160deg, rgba(0, 229, 255, 0.05), transparent 42%),
    var(--bg-surface, #0A1628);
  box-shadow: var(--shadow, 0 4px 24px rgba(0, 0, 0, 0.3));
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-cards-agent-status *,
.awk-el-cards-agent-status *::before,
.awk-el-cards-agent-status *::after {
  box-sizing: border-box;
}

.awk-el-cards-agent-status .as-head {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}

.awk-el-cards-agent-status .as-glyph {
  position: relative;
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-lg, 12px);
  background: rgba(0, 229, 255, 0.1);
  background: color-mix(in oklab, var(--awk-as-accent) 12%, transparent);
  border: 1px solid rgba(0, 229, 255, 0.28);
  border-color: color-mix(in oklab, var(--awk-as-accent) 30%, transparent);
  color: var(--awk-as-accent);
}

.awk-el-cards-agent-status .as-glyph svg {
  width: 20px;
  height: 20px;
}

.awk-el-cards-agent-status .as-id {
  min-width: 0;
  flex: 1;
}

.awk-el-cards-agent-status .as-name {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 650;
  letter-spacing: -0.01em;
  line-height: 1.25;
}

.awk-el-cards-agent-status .as-model {
  margin: 0.1rem 0 0;
  font-family: var(--font-mono, monospace);
  font-size: 0.62rem;
  letter-spacing: 0.03em;
  color: var(--text-muted, #a8b6c8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.awk-el-cards-agent-status .as-state {
  display: inline-flex;
  align-items: center;
  gap: 0.38rem;
  flex: 0 0 auto;
  padding: 0.24rem 0.55rem;
  border-radius: 999px;
  background: rgba(74, 222, 128, 0.12);
  background: color-mix(in oklab, var(--awk-as-green) 14%, transparent);
  color: var(--awk-as-green);
  font-size: 0.62rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.awk-el-cards-agent-status .as-dot {
  position: relative;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}

.awk-el-cards-agent-status .as-dot::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 1px solid currentColor;
  opacity: 0.5;
  animation: awk-el-cards-agent-status-1 2s ease-out infinite;
}

.awk-el-cards-agent-status[data-paused='true'] .as-state {
  background: rgba(168, 182, 200, 0.12);
  background: color-mix(in oklab, var(--text-muted, #a8b6c8) 14%, transparent);
  color: var(--text-muted, #a8b6c8);
}

.awk-el-cards-agent-status[data-paused='true'] .as-dot::after {
  animation: none;
  opacity: 0;
}

.awk-el-cards-agent-status .as-task {
  margin: 1rem 0 0;
  padding: 0.55rem 0.7rem;
  border-left: 2px solid var(--awk-as-violet);
  border-radius: 0 var(--radius, 8px) var(--radius, 8px) 0;
  background: rgba(124, 77, 255, 0.08);
  background: color-mix(in oklab, var(--awk-as-violet) 9%, transparent);
  font-size: 0.74rem;
  line-height: 1.45;
  color: var(--text-secondary, #c8d3df);
}

.awk-el-cards-agent-status .as-task b {
  font-weight: 600;
  color: var(--text-primary, #E8F0F8);
}

.awk-el-cards-agent-status .as-progress {
  margin-top: 0.9rem;
}

.awk-el-cards-agent-status .as-progress-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
  font-size: 0.64rem;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-cards-agent-status .as-progress-top b {
  font-family: var(--font-mono, monospace);
  color: var(--text-secondary, #c8d3df);
}

.awk-el-cards-agent-status .as-track {
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--bg-elevated, #1A2A40);
}

.awk-el-cards-agent-status .as-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--awk-as-accent), var(--awk-as-violet));
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.awk-el-cards-agent-status .as-metrics {
  display: flex;
  gap: 1rem;
  margin: 0.85rem 0 0;
  padding-top: 0.7rem;
  border-top: 1px solid var(--border-subtle, #2b3f5c);
}

.awk-el-cards-agent-status .as-metric {
  display: flex;
  flex-direction: column;
  gap: 0.08rem;
}

.awk-el-cards-agent-status .as-metric dt {
  font-size: 0.58rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text-ghost, #7a8ba3);
}

.awk-el-cards-agent-status .as-metric dd {
  margin: 0;
  font-family: var(--font-mono, monospace);
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary, #c8d3df);
}

.awk-el-cards-agent-status .as-btn {
  min-height: 30px;
  margin-left: auto;
  align-self: center;
  padding: 0.32rem 0.68rem;
  border: 1px solid var(--border-default, #5d7594);
  border-radius: var(--radius, 8px);
  background: transparent;
  color: var(--text-secondary, #c8d3df);
  font: inherit;
  font-size: 0.64rem;
  font-weight: 650;
  cursor: pointer;
  transition: border-color 0.18s ease, color 0.18s ease, background 0.18s ease;
}

.awk-el-cards-agent-status .as-btn:hover {
  border-color: var(--awk-as-accent);
  color: var(--awk-as-accent);
  background: rgba(0, 229, 255, 0.08);
  background: color-mix(in oklab, var(--awk-as-accent) 9%, transparent);
}

.awk-el-cards-agent-status .as-btn:focus-visible {
  outline: 2px solid var(--border-focus, var(--awk-as-accent));
  outline-offset: 2px;
}

@keyframes awk-el-cards-agent-status-1 {
  0% { transform: scale(0.6); opacity: 0.55; }
  70% { transform: scale(1.7); opacity: 0; }
  100% { transform: scale(1.7); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-cards-agent-status *,
  .awk-el-cards-agent-status *::before,
  .awk-el-cards-agent-status *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`

export default function AgentStatusCard(): JSX.Element {
  const [paused, setPaused] = useState(false)

  return (
    <article className="awk-el-cards-agent-status" data-paused={paused} aria-label="Agent Lyra status">
      <style>{css}</style>
      <div className="as-head">
        <span className="as-glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3v3m0 12v3M3 12h3m12 0h3M6.3 6.3l2.1 2.1m7.2 7.2 2.1 2.1m0-11.4-2.1 2.1m-7.2 7.2-2.1 2.1"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
            <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.7" />
          </svg>
        </span>
        <div className="as-id">
          <h3 className="as-name">Lyra</h3>
          <p className="as-model">atlas-3 · lane 04</p>
        </div>
        <span className="as-state" aria-live="polite">
          <span className="as-dot" aria-hidden="true" />
          {paused ? 'Paused' : 'Running'}
        </span>
      </div>

      <p className="as-task">
        <b>Current task:</b> indexing the workspace graph and reconciling 12 drifted nodes.
      </p>

      <div className="as-progress">
        <div className="as-progress-top">
          <span>Task progress</span>
          <b>64%</b>
        </div>
        <div
          className="as-track"
          role="progressbar"
          aria-label="Task progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={64}
        >
          <span className="as-fill" style={{ width: '64%' }} />
        </div>
      </div>

      <dl className="as-metrics">
        <div className="as-metric">
          <dt>Latency</dt>
          <dd>412 ms</dd>
        </div>
        <div className="as-metric">
          <dt>Tokens</dt>
          <dd>18.2k</dd>
        </div>
        <div className="as-metric">
          <dt>Uptime</dt>
          <dd>6h 12m</dd>
        </div>
        <button
          type="button"
          className="as-btn"
          aria-pressed={paused}
          onClick={() => setPaused(value => !value)}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
      </dl>
    </article>
  )
}
