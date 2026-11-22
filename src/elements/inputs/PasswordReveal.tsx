import { useId, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'inputs-password-reveal',
  title: 'Password with Reveal',
  category: 'inputs',
  tags: ['password', 'show hide', 'strength', 'form'],
}

const STRENGTH_LABELS = ['Too short', 'Weak', 'Fair', 'Good', 'Strong']
const STRENGTH_COLORS = [
  'var(--accent-coral, #f87171)',
  'var(--accent-coral, #f87171)',
  'var(--accent-warm, #f59e0b)',
  'var(--accent-sky, #38bdf8)',
  'var(--accent-green, #4ade80)',
]

function scoreOf(value: string): number {
  if (!value) return 0
  let score = 0
  if (value.length >= 8) score += 1
  if (value.length >= 12) score += 1
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1
  if (/\d/.test(value)) score += 1
  if (/[^\w\s]/.test(value)) score += 1
  return Math.min(4, score)
}

const css = `
.awk-el-inputs-password-reveal {
  box-sizing: border-box;
  width: 100%;
  max-width: 340px;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-inputs-password-reveal .label {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
  font-size: 0.72rem;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-inputs-password-reveal .label .meta {
  font-family: var(--font-mono, monospace);
  font-size: 0.64rem;
  color: var(--text-ghost, #7a8ba3);
}

.awk-el-inputs-password-reveal .field {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0 0.5rem 0 0.8rem;
  background: var(--bg-elevated, #1A2A40);
  border: 1px solid var(--border-default, #5d7594);
  border-radius: var(--radius-lg, 12px);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}

.awk-el-inputs-password-reveal .field:hover {
  border-color: var(--border-strong, #8fa3bd);
}

.awk-el-inputs-password-reveal .field:focus-within {
  border-color: var(--accent-primary, #00E5FF);
  background: var(--bg-surface, #0A1628);
  box-shadow: 0 0 0 3px rgba(0, 229, 255, 0.16);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent-primary, #00E5FF) 20%, transparent);
}

.awk-el-inputs-password-reveal .lock {
  flex: none;
  display: flex;
  color: var(--text-ghost, #7a8ba3);
  transition: color 0.2s ease;
}

.awk-el-inputs-password-reveal .field:focus-within .lock {
  color: var(--accent-primary, #00E5FF);
}

.awk-el-inputs-password-reveal .lock svg {
  width: 15px;
  height: 15px;
}

.awk-el-inputs-password-reveal input {
  flex: 1;
  min-width: 0;
  padding: 0.75rem 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.88rem;
  letter-spacing: 0.02em;
  outline: none;
  caret-color: var(--accent-primary, #00E5FF);
}

.awk-el-inputs-password-reveal input::placeholder {
  color: var(--text-ghost, #7a8ba3);
  letter-spacing: 0.12em;
}

.awk-el-inputs-password-reveal .reveal {
  flex: none;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted, #a8b6c8);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.awk-el-inputs-password-reveal .reveal:hover {
  background: var(--bg-hover, #1F3149);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-inputs-password-reveal .reveal:focus-visible {
  outline: 2px solid var(--accent-primary, #00E5FF);
  outline-offset: 1px;
}

.awk-el-inputs-password-reveal .reveal svg {
  width: 16px;
  height: 16px;
}

.awk-el-inputs-password-reveal .meter {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.25rem;
  margin-top: 0.55rem;
}

.awk-el-inputs-password-reveal .seg {
  height: 3px;
  border-radius: 2px;
  background: var(--border-subtle, #4c5d75);
  transition: background 0.25s ease, box-shadow 0.25s ease;
}

.awk-el-inputs-password-reveal .note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-height: 1rem;
  margin-top: 0.35rem;
  font-size: 0.68rem;
  color: var(--text-ghost, #7a8ba3);
}

.awk-el-inputs-password-reveal .note .strength {
  transition: color 0.2s ease;
}

.awk-el-inputs-password-reveal .caps {
  color: var(--accent-warm, #f59e0b);
  opacity: 0;
  transform: translateY(2px);
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.awk-el-inputs-password-reveal .caps.on {
  opacity: 1;
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-inputs-password-reveal *,
  .awk-el-inputs-password-reveal *::before,
  .awk-el-inputs-password-reveal *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`

export default function PasswordReveal(): JSX.Element {
  const id = useId()
  const [value, setValue] = useState('')
  const [shown, setShown] = useState(false)
  const [caps, setCaps] = useState(false)
  const score = scoreOf(value)
  const barStyle = (index: number): CSSProperties => (
    index < score
      ? { background: STRENGTH_COLORS[score], boxShadow: `0 0 6px ${STRENGTH_COLORS[score]}` }
      : {}
  )

  return (
    <div className="awk-el-inputs-password-reveal">
      <style>{css}</style>
      <label className="label" htmlFor={id}>
        <span>Password</span>
        <span className="meta" aria-hidden="true">at least 12 characters</span>
      </label>
      <div className="field">
        <span className="lock" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2" stroke="currentColor" strokeWidth="1.8" />
            <path d="M8.2 10.5V8a3.8 3.8 0 017.6 0v2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="12" cy="15.2" r="1.2" fill="currentColor" />
          </svg>
        </span>
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={event => setValue(event.target.value)}
          onKeyDown={event => setCaps(event.getModifierState?.('CapsLock') ?? false)}
          onKeyUp={event => setCaps(event.getModifierState?.('CapsLock') ?? false)}
          onBlur={() => setCaps(false)}
          placeholder="••••••••••••"
          autoComplete="new-password"
          aria-describedby={`${id}-strength`}
        />
        <button
          type="button"
          className="reveal"
          onClick={() => setShown(current => !current)}
          aria-pressed={shown}
          aria-label={shown ? 'Hide password' : 'Show password'}
        >
          {shown ? (
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M3.5 12s3.2-6 8.5-6 8.5 6 8.5 6-3.2 6-8.5 6-8.5-6-8.5-6z" stroke="currentColor" strokeWidth="1.7" />
              <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.7" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M3.5 12s3.2-6 8.5-6 8.5 6 8.5 6-3.2 6-8.5 6-8.5-6-8.5-6z" stroke="currentColor" strokeWidth="1.7" />
              <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.7" />
              <path d="M4 20L20 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>
      <div className="meter" aria-hidden="true">
        {[0, 1, 2, 3].map(index => (
          <span key={index} className="seg" style={barStyle(index)} />
        ))}
      </div>
      <div className="note">
        <span className="strength" id={`${id}-strength`} style={{ color: score ? STRENGTH_COLORS[score] : undefined }}>
          {value ? STRENGTH_LABELS[score] : 'Strength meter'}
        </span>
        <span className={caps ? 'caps on' : 'caps'} aria-live="polite">Caps Lock is on</span>
      </div>
    </div>
  )
}
