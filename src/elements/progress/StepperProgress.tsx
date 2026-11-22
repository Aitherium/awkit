import { useEffect, useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'progress-stepper',
  title: 'Stepper Progress',
  category: 'progress',
  tags: ['stepper', 'steps', 'onboarding', 'wizard'],
}

const STEPS = [
  { label: 'Account', hint: 'Verified' },
  { label: 'Workspace', hint: 'Provisioned' },
  { label: 'Model', hint: 'Routing' },
  { label: 'Launch', hint: 'Ready' },
]

const TICK_MS = 1500

const css = `
.awk-el-progress-stepper {
  width: 100%;
  max-width: 400px;
  padding: 1rem;
  box-sizing: border-box;
  font-family: var(--font-sans, system-ui, sans-serif);
}

.awk-el-progress-stepper .rail {
  position: relative;
  height: 2px;
  margin: 13px 12.5% -13px;
  border-radius: 2px;
  overflow: hidden;
  background: color-mix(in oklab, var(--border-default, oklch(0.62 0.02 250)) 35%, transparent);
}

.awk-el-progress-stepper .rail-fill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--accent-primary, #00E5FF), var(--accent-secondary, #7C4DFF));
  transition: width 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}

.awk-el-progress-stepper .steps {
  position: relative;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  margin: 0;
  padding: 0;
  list-style: none;
}

.awk-el-progress-stepper .step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.42rem;
  text-align: center;
}

.awk-el-progress-stepper .node {
  position: relative;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  box-sizing: border-box;
  border-radius: 50%;
  border: 2px solid var(--border-default, oklch(0.62 0.02 250));
  background: var(--bg-elevated, #1A2A40);
  color: var(--text-muted, oklch(0.74 0.02 250));
  font-family: var(--font-mono, monospace);
  font-size: 0.68rem;
  font-weight: 600;
  transition: border-color 0.25s ease, background 0.25s ease, color 0.25s ease, box-shadow 0.25s ease;
}

.awk-el-progress-stepper .step[data-state="done"] .node {
  border-color: transparent;
  background: linear-gradient(135deg, var(--accent-primary, #00E5FF), var(--accent-cyan, #40C4FF));
  color: var(--bg-deep, #060D1A);
  box-shadow: 0 0 10px color-mix(in oklab, var(--accent-primary, #00E5FF) 35%, transparent);
}

.awk-el-progress-stepper .step[data-state="active"] .node {
  border-color: var(--accent-primary, #00E5FF);
  background: color-mix(in oklab, var(--bg-elevated, #1A2A40) 72%, transparent);
  color: var(--accent-primary, #00E5FF);
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--accent-primary, #00E5FF) 14%, transparent);
}

.awk-el-progress-stepper .step[data-state="active"] .node::after {
  content: "";
  position: absolute;
  inset: -7px;
  border-radius: 50%;
  border: 1px solid color-mix(in oklab, var(--accent-primary, #00E5FF) 45%, transparent);
  animation: awk-el-progress-stepper-1 1.6s ease-out infinite;
}

.awk-el-progress-stepper .title {
  font-size: 0.66rem;
  letter-spacing: 0.02em;
  color: var(--text-muted, oklch(0.74 0.02 250));
  transition: color 0.25s ease;
}

.awk-el-progress-stepper .step[data-state="done"] .title,
.awk-el-progress-stepper .step[data-state="active"] .title {
  color: var(--text-primary, #E8F0F8);
}

.awk-el-progress-stepper .caption {
  margin-top: 0.9rem;
  font-family: var(--font-mono, monospace);
  font-size: 0.68rem;
  color: var(--text-ghost, oklch(0.56 0.02 250));
}

.awk-el-progress-stepper .caption .hint {
  color: var(--accent-primary, #00E5FF);
}

@keyframes awk-el-progress-stepper-1 {
  0% { opacity: 0.8; transform: scale(0.85); }
  100% { opacity: 0; transform: scale(1.35); }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-progress-stepper .rail-fill { transition: none; }
  .awk-el-progress-stepper .step[data-state="active"] .node::after { animation: none; opacity: 0.4; }
}
`

export default function StepperProgress(): JSX.Element {
  const [step, setStep] = useState(0)
  const total = STEPS.length
  const railPct = (Math.min(step, total - 1) / (total - 1)) * 100
  const activeIndex = Math.min(step, total - 1)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setStep(2)
      return
    }
    const id = window.setInterval(() => {
      setStep(previous => (previous + 1) % (total + 1))
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [total])

  return (
    <div className="awk-el-progress-stepper">
      <style>{css}</style>
      <div className="rail" aria-hidden="true">
        <span className="rail-fill" style={{ width: `${railPct}%` }} />
      </div>
      <ol className="steps" aria-label="Onboarding progress">
        {STEPS.map((item, index) => {
          const state = index < step ? 'done' : index === step ? 'active' : 'todo'
          return (
            <li
              key={item.label}
              className="step"
              data-state={state}
              aria-current={state === 'active' ? 'step' : undefined}
            >
              <span className="node" aria-hidden="true">
                {state === 'done' ? (
                  <svg viewBox="0 0 12 12" width="12" height="12">
                    <path
                      d="M2.4 6.1 4.9 8.6 9.6 3.4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span className="title">{item.label}</span>
            </li>
          )
        })}
      </ol>
      <div className="caption">
        {step >= total ? (
          <>All steps complete · <span className="hint">Ready to launch</span></>
        ) : (
          <>Step {activeIndex + 1} of {total} · <span className="hint">{STEPS[activeIndex].hint}</span></>
        )}
      </div>
    </div>
  )
}
