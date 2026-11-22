'use client'

/**
 * Run Button — a button that reports its own work. Idle shows a bolt; a click
 * enters a working state with a spinner and disables further clicks; a short
 * success beat follows before it resets. The live region announces each phase
 * to screen readers, and the fixed width stops the row from jumping.
 */

import { useEffect, useRef, useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'buttons-loading-action',
  title: 'Run Button',
  category: 'buttons',
  tags: ['loading', 'async', 'spinner', 'stateful', 'action'],
}

type Phase = 'idle' | 'loading' | 'done'

const css = `
.awk-el-buttons-loading-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-sans, 'Inter', -apple-system, sans-serif);
}

.awk-el-buttons-loading-action__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  min-width: 170px;
  height: 42px;
  padding: 0 1.25rem;
  border-radius: var(--radius-lg, 12px);
  border: 1px solid var(--border-default, #4a6074);
  background: var(--bg-elevated, #1a2a40);
  background: color-mix(in srgb, var(--accent-primary, #00e5ff) 14%, var(--bg-elevated, #1a2a40));
  border-color: color-mix(in srgb, var(--accent-primary, #00e5ff) 42%, var(--border-default, #4a6074));
  color: var(--text-primary, #e8f0f8);
  font: 600 0.85rem/1 var(--font-sans, 'Inter', -apple-system, sans-serif);
  transition:
    background 180ms ease,
    border-color 180ms ease,
    transform 120ms ease;
}

.awk-el-buttons-loading-action__btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent-primary, #00e5ff) 21%, var(--bg-elevated, #1a2a40));
  transform: translateY(-1px);
}

.awk-el-buttons-loading-action__btn:disabled {
  cursor: progress;
  opacity: 0.9;
}

.awk-el-buttons-loading-action__btn:focus-visible {
  outline: 2px solid var(--border-focus, #00e5ff);
  outline-offset: 3px;
}

.awk-el-buttons-loading-action__icon {
  display: block;
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
}

.awk-el-buttons-loading-action__spinner {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--accent-primary, #00e5ff) 28%, transparent);
  border-top-color: var(--accent-primary, #00e5ff);
  animation: awk-el-buttons-loading-action-1 0.7s linear infinite;
}

.awk-el-buttons-loading-action__done {
  color: var(--accent-green, #4ade80);
}

.awk-el-buttons-loading-action__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

@keyframes awk-el-buttons-loading-action-1 {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-buttons-loading-action__btn {
    transition: none;
  }
  .awk-el-buttons-loading-action__spinner {
    animation: none;
    border-right-color: var(--accent-primary, #00e5ff);
  }
}
`

export default function LoadingAction(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])

  useEffect(() => () => {
    timers.current.forEach(clearTimeout)
  }, [])

  const start = () => {
    if (phase !== 'idle') return
    setPhase('loading')
    timers.current.push(
      setTimeout(() => {
        setPhase('done')
        timers.current.push(setTimeout(() => setPhase('idle'), 1400))
      }, 1600),
    )
  }

  const label = phase === 'loading' ? 'Working…' : phase === 'done' ? 'Ready' : 'Generate'

  return (
    <div className="awk-el-buttons-loading-action">
      <button
        type="button"
        className="awk-el-buttons-loading-action__btn"
        onClick={start}
        disabled={phase === 'loading'}
        aria-busy={phase === 'loading'}
      >
        {phase === 'loading' && (
          <span className="awk-el-buttons-loading-action__spinner" aria-hidden="true" />
        )}
        {phase === 'done' && (
          <svg
            className="awk-el-buttons-loading-action__icon awk-el-buttons-loading-action__done"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m5 12 5 5L20 7" />
          </svg>
        )}
        {phase === 'idle' && (
          <svg
            className="awk-el-buttons-loading-action__icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l1-8Z" />
          </svg>
        )}
        {label}
      </button>
      <span className="awk-el-buttons-loading-action__sr" aria-live="polite">
        {phase === 'loading' ? 'Generating' : phase === 'done' ? 'Ready' : ''}
      </span>
      <style>{css}</style>
    </div>
  )
}
