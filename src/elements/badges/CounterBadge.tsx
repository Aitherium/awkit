import { useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'badges-counter',
  title: 'Counter Badge',
  category: 'badges',
  tags: ['counter', 'notification', 'bell', 'count'],
}

const css = `
.awk-el-badges-counter {
  --awk-cb-accent: var(--accent-primary, #00E5FF);
  --awk-cb-rose: var(--accent-rose, #ec4899);
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-badges-counter * {
  box-sizing: border-box;
}

.awk-el-badges-counter .cb-bell {
  position: relative;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border-default, #5d7594);
  border-radius: var(--radius-lg, 12px);
  background: var(--bg-elevated, #1A2A40);
  color: var(--text-secondary, #c8d3df);
  cursor: pointer;
  transition: border-color 0.16s ease, color 0.16s ease, transform 0.12s ease;
}

.awk-el-badges-counter .cb-bell:hover {
  border-color: var(--awk-cb-accent);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-badges-counter .cb-bell:active {
  transform: scale(0.95);
}

.awk-el-badges-counter .cb-bell:focus-visible {
  outline: 2px solid var(--border-focus, var(--awk-cb-accent));
  outline-offset: 2px;
}

.awk-el-badges-counter .cb-bell svg {
  width: 19px;
  height: 19px;
}

.awk-el-badges-counter .cb-count {
  position: absolute;
  top: -7px;
  right: -8px;
  min-width: 19px;
  height: 19px;
  padding: 0 0.28rem;
  display: grid;
  place-items: center;
  border-radius: 999px;
  border: 2px solid var(--bg-surface, #0A1628);
  background: linear-gradient(135deg, var(--awk-cb-rose), var(--accent-secondary, #7C4DFF));
  color: #fff;
  font-family: var(--font-mono, monospace);
  font-size: 0.6rem;
  font-weight: 700;
  line-height: 1;
  animation: awk-el-badges-counter-1 0.32s cubic-bezier(0.2, 1.4, 0.4, 1);
}

.awk-el-badges-counter .cb-note {
  margin: 0;
  max-width: 160px;
  font-size: 0.66rem;
  line-height: 1.45;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-badges-counter .cb-note b {
  font-family: var(--font-mono, monospace);
  font-weight: 600;
  color: var(--text-primary, #E8F0F8);
}

@keyframes awk-el-badges-counter-1 {
  0% { transform: scale(0.4); opacity: 0.4; }
  65% { transform: scale(1.22); opacity: 1; }
  100% { transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-badges-counter * {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`

export default function CounterBadge(): JSX.Element {
  const [count, setCount] = useState(7)

  return (
    <div className="awk-el-badges-counter">
      <style>{css}</style>
      <button
        type="button"
        className="cb-bell"
        aria-label={`Notifications: ${count} unread`}
        onClick={() => setCount(value => (value >= 9 ? 0 : value + 1))}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6.4 9.5a5.6 5.6 0 0 1 11.2 0c0 4.3 1.6 5.7 1.6 5.7H4.8s1.6-1.4 1.6-5.7Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M10 18.2a2.1 2.1 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {count > 0 && (
          <span className="cb-count" key={count}>
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      <p className="cb-note">
        <b>{count}</b> unread · click the bell to add one
      </p>
    </div>
  )
}
