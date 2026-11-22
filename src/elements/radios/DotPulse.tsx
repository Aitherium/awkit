import { useId, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'radios-dot-pulse',
  title: 'Pulsing Dot Radios',
  category: 'radios',
  tags: ['radio', 'pulse', 'priority', 'status'],
}

const OPTIONS = [
  { value: 'low', label: 'Low', meta: 'digest', color: 'var(--accent-green, #4ade80)' },
  { value: 'normal', label: 'Normal', meta: 'inbox', color: 'var(--accent-warm, #f59e0b)' },
  { value: 'high', label: 'High', meta: 'page now', color: 'var(--accent-coral, #f87171)' },
]

const css = `
.awk-el-radios-dot-pulse {
  box-sizing: border-box;
  width: 100%;
  max-width: 340px;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-radios-dot-pulse fieldset {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}

.awk-el-radios-dot-pulse legend {
  padding: 0;
  margin-bottom: 0.45rem;
  font-size: 0.68rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-radios-dot-pulse .list {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
}

.awk-el-radios-dot-pulse .row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.5rem 0.6rem;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.awk-el-radios-dot-pulse .row:hover {
  background: var(--card-hover, rgba(232, 240, 248, 0.06));
}

.awk-el-radios-dot-pulse .native {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}

.awk-el-radios-dot-pulse .dot {
  position: relative;
  flex: none;
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
}

.awk-el-radios-dot-pulse .dot::before {
  content: '';
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--dot, var(--accent-primary, #00E5FF));
  opacity: 0.42;
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.awk-el-radios-dot-pulse .dot::after {
  content: '';
  position: absolute;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid var(--dot, var(--accent-primary, #00E5FF));
  opacity: 0;
}

.awk-el-radios-dot-pulse .native:checked + .dot::before {
  opacity: 1;
  transform: scale(1.12);
}

.awk-el-radios-dot-pulse .native:checked + .dot::after {
  animation: awk-el-radios-dot-pulse-1 1.9s ease-out infinite;
}

.awk-el-radios-dot-pulse .native:focus-visible + .dot {
  border-radius: 50%;
  outline: 2px solid var(--dot, var(--accent-primary, #00E5FF));
  outline-offset: 3px;
}

.awk-el-radios-dot-pulse .name {
  font-size: 0.83rem;
  color: var(--text-secondary, #cdd8e5);
  transition: color 0.18s ease, font-weight 0.18s ease;
}

.awk-el-radios-dot-pulse .native:checked ~ .name {
  color: var(--text-primary, #E8F0F8);
  font-weight: 600;
}

.awk-el-radios-dot-pulse .meta {
  margin-left: auto;
  font-family: var(--font-mono, monospace);
  font-size: 0.62rem;
  color: var(--text-ghost, #7a8ba3);
  transition: color 0.2s ease;
}

.awk-el-radios-dot-pulse .native:checked ~ .meta {
  color: var(--dot, var(--accent-primary, #00E5FF));
}

.awk-el-radios-dot-pulse .summary {
  margin: 0.5rem 0 0;
  padding-left: 0.6rem;
  font-size: 0.71rem;
  color: var(--text-ghost, #7a8ba3);
}

.awk-el-radios-dot-pulse .summary b {
  color: var(--text-muted, #a8b6c8);
  font-weight: 600;
}

@keyframes awk-el-radios-dot-pulse-1 {
  0% { transform: scale(1); opacity: 0.7; }
  70% { transform: scale(2.7); opacity: 0; }
  100% { transform: scale(2.7); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-radios-dot-pulse *,
  .awk-el-radios-dot-pulse *::before,
  .awk-el-radios-dot-pulse *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
  .awk-el-radios-dot-pulse .native:checked + .dot::after {
    animation: none;
  }
}
`

export default function DotPulse(): JSX.Element {
  const group = useId()
  const [value, setValue] = useState('normal')
  const active = OPTIONS.find(option => option.value === value) ?? OPTIONS[1]

  return (
    <div className="awk-el-radios-dot-pulse">
      <style>{css}</style>
      <fieldset>
        <legend>Alert priority</legend>
        <div className="list">
          {OPTIONS.map(option => (
            <label
              className="row"
              key={option.value}
              style={{ '--dot': option.color } as CSSProperties}
            >
              <input
                className="native"
                type="radio"
                name={group}
                value={option.value}
                checked={value === option.value}
                onChange={() => setValue(option.value)}
              />
              <span className="dot" aria-hidden="true" />
              <span className="name">{option.label}</span>
              <span className="meta">{option.meta}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="summary">Routes to <b>{active.meta}</b></p>
    </div>
  )
}
