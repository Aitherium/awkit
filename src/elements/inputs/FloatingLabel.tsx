import { useId, useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'inputs-floating-label',
  title: 'Floating Label Field',
  category: 'inputs',
  tags: ['text field', 'floating label', 'form', 'focus'],
}

const css = `
.awk-el-inputs-floating-label {
  box-sizing: border-box;
  --awk-fl-accent: var(--accent-primary, #00E5FF);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  width: 100%;
  max-width: 340px;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-inputs-floating-label .field {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--bg-elevated, #1A2A40);
  border: 1px solid var(--border-default, #5d7594);
  border-radius: var(--radius-lg, 12px);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}

.awk-el-inputs-floating-label .field:hover {
  border-color: var(--border-strong, #8fa3bd);
}

.awk-el-inputs-floating-label .field:focus-within {
  border-color: var(--awk-fl-accent);
  background: var(--bg-surface, #0A1628);
  box-shadow: 0 0 0 3px rgba(0, 229, 255, 0.16);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--awk-fl-accent) 22%, transparent);
}

.awk-el-inputs-floating-label input {
  width: 100%;
  box-sizing: border-box;
  padding: 1.4rem 3rem 0.55rem 0.95rem;
  border: 0;
  border-radius: inherit;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.95rem;
  letter-spacing: 0.01em;
  outline: none;
  caret-color: var(--awk-fl-accent);
}

.awk-el-inputs-floating-label input::placeholder {
  color: transparent;
}

.awk-el-inputs-floating-label label {
  position: absolute;
  left: 0.95rem;
  top: 50%;
  transform: translateY(-50%);
  transform-origin: left center;
  padding: 0 0.32rem;
  margin-left: -0.12rem;
  background: inherit;
  color: var(--text-muted, #a8b6c8);
  font-size: 0.9rem;
  letter-spacing: 0.01em;
  pointer-events: none;
  transition: top 0.17s ease, transform 0.17s cubic-bezier(0.2, 0.8, 0.2, 1), color 0.17s ease, letter-spacing 0.17s ease;
}

.awk-el-inputs-floating-label input:not(:placeholder-shown) + label {
  top: 0;
  transform: translateY(-50%) scale(0.76);
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-inputs-floating-label input:focus + label {
  color: var(--awk-fl-accent);
}

.awk-el-inputs-floating-label .tick {
  position: absolute;
  right: 0.8rem;
  top: 50%;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--awk-fl-accent);
  color: var(--bg-deep, #060D1A);
  opacity: 0;
  transform: translateY(-50%) scale(0.5);
  transition: opacity 0.18s ease, transform 0.2s cubic-bezier(0.2, 1.4, 0.4, 1);
  pointer-events: none;
}

.awk-el-inputs-floating-label .tick.on {
  opacity: 1;
  transform: translateY(-50%) scale(1);
  animation: awk-el-inputs-floating-label-1 0.24s ease;
}

.awk-el-inputs-floating-label .tick svg {
  width: 12px;
  height: 12px;
}

.awk-el-inputs-floating-label .hint {
  margin: 0;
  padding-left: 0.15rem;
  font-size: 0.72rem;
  color: var(--text-ghost, #7a8ba3);
  line-height: 1.4;
}

@keyframes awk-el-inputs-floating-label-1 {
  0% { transform: translateY(-50%) scale(0.55); }
  65% { transform: translateY(-50%) scale(1.14); }
  100% { transform: translateY(-50%) scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-inputs-floating-label *,
  .awk-el-inputs-floating-label *::before,
  .awk-el-inputs-floating-label *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`

export default function FloatingLabel(): JSX.Element {
  const id = useId()
  const hintId = useId()
  const [value, setValue] = useState('')

  return (
    <div className="awk-el-inputs-floating-label">
      <style>{css}</style>
      <div className="field">
        <input
          id={id}
          type="text"
          value={value}
          onChange={event => setValue(event.target.value)}
          placeholder=" "
          autoComplete="off"
          spellCheck={false}
          aria-describedby={hintId}
        />
        <label htmlFor={id}>Workspace name</label>
        <span className={value.trim() ? 'tick on' : 'tick'} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M5 12.5l4.4 4.4L19 7.4" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
      <p className="hint" id={hintId}>Visible to workspace admins only. Rename any time.</p>
    </div>
  )
}
