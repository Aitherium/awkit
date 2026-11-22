import { useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'cards-notification',
  title: 'Notification Card',
  category: 'cards',
  tags: ['notification', 'toast', 'alert', 'dismiss'],
}

const css = `
.awk-el-cards-notification {
  --awk-nt-accent: var(--accent-cyan, #40C4FF);
  --awk-nt-green: var(--accent-green, #4ade80);
  width: 100%;
  max-width: 330px;
  padding: 0.95rem 1rem;
  border: 1px solid var(--border-subtle, #2b3f5c);
  border-left: 3px solid var(--awk-nt-accent);
  border-radius: var(--radius-lg, 12px);
  background: var(--bg-surface, #0A1628);
  box-shadow: var(--shadow, 0 4px 24px rgba(0, 0, 0, 0.3));
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
  animation: awk-el-cards-notification-1 0.32s cubic-bezier(0.2, 0.9, 0.2, 1);
}

.awk-el-cards-notification *,
.awk-el-cards-notification *::before,
.awk-el-cards-notification *::after {
  box-sizing: border-box;
}

.awk-el-cards-notification .nt-row {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
}

.awk-el-cards-notification .nt-icon {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: var(--radius, 8px);
  background: rgba(64, 196, 255, 0.12);
  background: color-mix(in oklab, var(--awk-nt-accent) 14%, transparent);
  color: var(--awk-nt-accent);
}

.awk-el-cards-notification .nt-icon svg {
  width: 17px;
  height: 17px;
}

.awk-el-cards-notification .nt-copy {
  flex: 1;
  min-width: 0;
}

.awk-el-cards-notification .nt-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0;
  font-size: 0.82rem;
  font-weight: 650;
  letter-spacing: -0.005em;
}

.awk-el-cards-notification .nt-time {
  flex: 0 0 auto;
  font-family: var(--font-mono, monospace);
  font-size: 0.58rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: var(--text-ghost, #7a8ba3);
}

.awk-el-cards-notification .nt-body {
  margin: 0.28rem 0 0;
  font-size: 0.73rem;
  line-height: 1.5;
  color: var(--text-secondary, #c8d3df);
}

.awk-el-cards-notification .nt-body code {
  padding: 0.05rem 0.28rem;
  border-radius: 4px;
  background: var(--bg-elevated, #1A2A40);
  font-family: var(--font-mono, monospace);
  font-size: 0.66rem;
  color: var(--text-primary, #E8F0F8);
}

.awk-el-cards-notification .nt-actions {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-top: 0.7rem;
  padding-left: 2.55rem;
}

.awk-el-cards-notification .nt-link,
.awk-el-cards-notification .nt-dismiss {
  min-height: 28px;
  padding: 0.3rem 0.62rem;
  border-radius: var(--radius, 8px);
  font: inherit;
  font-size: 0.66rem;
  font-weight: 650;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease, border-color 0.16s ease;
}

.awk-el-cards-notification .nt-link {
  border: 1px solid transparent;
  background: var(--awk-nt-accent);
  color: var(--bg-deep, #060D1A);
}

.awk-el-cards-notification .nt-link:hover {
  box-shadow: 0 4px 14px rgba(64, 196, 255, 0.28);
  box-shadow: 0 4px 14px color-mix(in oklab, var(--awk-nt-accent) 30%, transparent);
}

.awk-el-cards-notification .nt-dismiss {
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-cards-notification .nt-dismiss:hover {
  border-color: var(--border-default, #5d7594);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-cards-notification :is(button):focus-visible {
  outline: 2px solid var(--border-focus, var(--awk-nt-accent));
  outline-offset: 2px;
}

.awk-el-cards-notification .nt-closed {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.74rem;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-cards-notification .nt-undo {
  min-height: 28px;
  padding: 0.3rem 0.62rem;
  border: 1px solid var(--border-default, #5d7594);
  border-radius: var(--radius, 8px);
  background: transparent;
  color: var(--text-secondary, #c8d3df);
  font: inherit;
  font-size: 0.66rem;
  font-weight: 650;
  cursor: pointer;
}

.awk-el-cards-notification .nt-undo:hover {
  border-color: var(--awk-nt-accent);
  color: var(--awk-nt-accent);
}

@keyframes awk-el-cards-notification-1 {
  from { opacity: 0; transform: translateY(-8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-cards-notification {
    animation: none !important;
  }
  .awk-el-cards-notification * {
    transition-duration: 0.01ms !important;
  }
}
`

export default function NotificationCard(): JSX.Element {
  const [dismissed, setDismissed] = useState(false)

  return (
    <article
      className="awk-el-cards-notification"
      aria-label="Notification: deploy finished"
      aria-live="polite"
    >
      <style>{css}</style>

      {dismissed ? (
        <div className="nt-closed">
          <span>Notification dismissed</span>
          <button type="button" className="nt-undo" onClick={() => setDismissed(false)}>
            Undo
          </button>
        </div>
      ) : (
        <>
          <div className="nt-row">
            <span className="nt-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 12.5l4.3 4.3L19 7"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <div className="nt-copy">
              <h3 className="nt-title">
                Deploy finished
                <span className="nt-time">2m ago</span>
              </h3>
              <p className="nt-body">
                <code>veil-web</code> shipped to production. 14 services healthy, 0 rollbacks.
              </p>
            </div>
          </div>
          <div className="nt-actions">
            <button type="button" className="nt-link">
              View release
            </button>
            <button type="button" className="nt-dismiss" onClick={() => setDismissed(true)}>
              Dismiss
            </button>
          </div>
        </>
      )}
    </article>
  )
}
