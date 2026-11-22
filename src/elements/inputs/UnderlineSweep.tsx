import { useId, useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'inputs-underline-sweep',
  title: 'Underline Focus Sweep',
  category: 'inputs',
  tags: ['text field', 'underline', 'gradient', 'minimal'],
}

const css = `
.awk-el-inputs-underline-sweep {
  box-sizing: border-box;
  width: 100%;
  max-width: 340px;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-inputs-underline-sweep .head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.15rem;
}

.awk-el-inputs-underline-sweep label {
  font-size: 0.68rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text-muted, #a8b6c8);
  transition: color 0.2s ease;
}

.awk-el-inputs-underline-sweep .count {
  font-family: var(--font-mono, monospace);
  font-size: 0.64rem;
  color: var(--text-ghost, #7a8ba3);
  font-variant-numeric: tabular-nums;
}

.awk-el-inputs-underline-sweep .field {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.2rem 0 0.7rem;
}

.awk-el-inputs-underline-sweep .prefix {
  flex: none;
  font-family: var(--font-mono, monospace);
  font-size: 0.95rem;
  color: var(--text-ghost, #7a8ba3);
  transition: color 0.2s ease;
}

.awk-el-inputs-underline-sweep input {
  flex: 1;
  min-width: 0;
  padding: 0.35rem 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 1rem;
  letter-spacing: 0.01em;
  outline: none;
  caret-color: var(--accent-primary, #00E5FF);
}

.awk-el-inputs-underline-sweep input::placeholder {
  color: var(--text-ghost, #7a8ba3);
  opacity: 0.85;
}

.awk-el-inputs-underline-sweep .bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  border-radius: 2px;
  background: var(--border-subtle, #4c5d75);
  overflow: hidden;
}

.awk-el-inputs-underline-sweep .bar::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, var(--accent-primary, #00E5FF), var(--accent-secondary, #7C4DFF));
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform 0.36s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.awk-el-inputs-underline-sweep .field:focus-within {
  border-radius: var(--radius, 8px);
  box-shadow:
    0 0 0 1px var(--border-focus, var(--accent-primary, #00E5FF)),
    0 0 0 4px color-mix(in oklab, var(--border-focus, var(--accent-primary, #00E5FF)) 24%, transparent);
}

.awk-el-inputs-underline-sweep .field:focus-within .bar::after {
  transform: scaleX(1);
}

.awk-el-inputs-underline-sweep .field:focus-within .prefix,
.awk-el-inputs-underline-sweep .field:focus-within label {
  color: var(--accent-primary, #00E5FF);
}

.awk-el-inputs-underline-sweep .hint {
  margin: 0.45rem 0 0;
  font-size: 0.71rem;
  color: var(--text-ghost, #7a8ba3);
  opacity: 0.6;
  transition: opacity 0.22s ease, color 0.22s ease;
}

.awk-el-inputs-underline-sweep:focus-within .hint {
  opacity: 1;
  color: var(--text-muted, #a8b6c8);
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-inputs-underline-sweep *,
  .awk-el-inputs-underline-sweep *::before,
  .awk-el-inputs-underline-sweep *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`

export default function UnderlineSweep(): JSX.Element {
  const id = useId()
  const [value, setValue] = useState('')

  return (
    <div className="awk-el-inputs-underline-sweep">
      <style>{css}</style>
      <div className="head">
        <label htmlFor={id}>Contact email</label>
        <span className="count">{value.length}/64</span>
      </div>
      <div className="field">
        <span className="prefix" aria-hidden="true">@</span>
        <input
          id={id}
          type="email"
          value={value}
          maxLength={64}
          onChange={event => setValue(event.target.value)}
          placeholder="you@studio.io"
          autoComplete="email"
          spellCheck={false}
        />
        <span className="bar" aria-hidden="true" />
      </div>
      <p className="hint">We use this for receipts and nothing else.</p>
    </div>
  )
}
