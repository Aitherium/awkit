import { useId, useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'radios-card-options',
  title: 'Plan Card Radios',
  category: 'radios',
  tags: ['radio', 'cards', 'pricing', 'selection'],
}

const OPTIONS = [
  { value: 'solo', title: 'Solo', desc: 'One seat, everything local' },
  { value: 'studio', title: 'Studio', desc: 'Shared workspace and history' },
  { value: 'scale', title: 'Scale', desc: 'Pools, replicas, audit trail' },
]

const css = `
.awk-el-radios-card-options {
  box-sizing: border-box;
  width: 100%;
  max-width: 340px;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-radios-card-options fieldset {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}

.awk-el-radios-card-options legend {
  padding: 0;
  margin-bottom: 0.5rem;
  font-size: 0.68rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-radios-card-options .options {
  display: grid;
  gap: 0.45rem;
}

.awk-el-radios-card-options .opt {
  position: relative;
  display: block;
  cursor: pointer;
}

.awk-el-radios-card-options .native {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}

.awk-el-radios-card-options .option-card {
  position: relative;
  display: block;
  padding: 0.68rem 2.3rem 0.68rem 0.8rem;
  background: var(--bg-elevated, #1A2A40);
  border: 1px solid var(--border-default, #5d7594);
  border-radius: var(--radius-lg, 12px);
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.16s ease, box-shadow 0.22s ease;
}

.awk-el-radios-card-options .opt:hover .option-card {
  border-color: var(--border-strong, #8fa3bd);
  transform: translateY(-1px);
}

.awk-el-radios-card-options .native:checked + .option-card {
  border-color: var(--accent-primary, #00E5FF);
  background: color-mix(in oklab, var(--accent-primary, #00E5FF) 9%, var(--bg-elevated, #1A2A40));
  box-shadow: 0 0 0 1px var(--accent-primary, #00E5FF), 0 6px 20px color-mix(in oklab, var(--accent-primary, #00E5FF) 14%, transparent);
}

.awk-el-radios-card-options .native:focus-visible + .option-card {
  outline: 2px solid var(--accent-primary, #00E5FF);
  outline-offset: 2px;
}

.awk-el-radios-card-options .t {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.83rem;
  font-weight: 600;
  color: var(--text-primary, #E8F0F8);
}

.awk-el-radios-card-options .pill {
  padding: 0.06rem 0.32rem;
  border-radius: 999px;
  background: var(--accent-secondary, #7C4DFF);
  color: #fff;
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.awk-el-radios-card-options .d {
  display: block;
  margin-top: 0.1rem;
  font-size: 0.7rem;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-radios-card-options .pick {
  position: absolute;
  top: 0.68rem;
  right: 0.75rem;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 1.5px solid var(--border-strong, #8fa3bd);
  border-radius: 50%;
  color: var(--bg-deep, #060D1A);
  transition: background 0.2s ease, border-color 0.2s ease;
}

.awk-el-radios-card-options .pick svg {
  width: 10px;
  height: 10px;
}

.awk-el-radios-card-options .pick path {
  stroke-dasharray: 24;
  stroke-dashoffset: 24;
  transition: stroke-dashoffset 0.24s ease;
}

.awk-el-radios-card-options .native:checked + .option-card .pick {
  background: var(--accent-primary, #00E5FF);
  border-color: var(--accent-primary, #00E5FF);
}

.awk-el-radios-card-options .native:checked + .option-card .pick path {
  stroke-dashoffset: 0;
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-radios-card-options *,
  .awk-el-radios-card-options *::before,
  .awk-el-radios-card-options *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
  .awk-el-radios-card-options .pick path {
    stroke-dashoffset: 0;
  }
}
`

export default function CardOptions(): JSX.Element {
  const group = useId()
  const [value, setValue] = useState('studio')

  return (
    <div className="awk-el-radios-card-options">
      <style>{css}</style>
      <fieldset>
        <legend>Choose a plan</legend>
        <div className="options">
          {OPTIONS.map(option => (
            <label className="opt" key={option.value}>
              <input
                className="native"
                type="radio"
                name={group}
                value={option.value}
                checked={value === option.value}
                onChange={() => setValue(option.value)}
              />
              <span className="option-card">
                <span className="t">
                  {option.title}
                  {option.value === 'studio' && <span className="pill">Popular</span>}
                </span>
                <span className="d">{option.desc}</span>
                <span className="pick" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M5 12.5l4.2 4.2L19 7.6" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  )
}
