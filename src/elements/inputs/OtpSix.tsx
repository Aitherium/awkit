import { useId, useRef, useState } from 'react'
import type { ClipboardEvent, KeyboardEvent } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'inputs-otp-six',
  title: 'Six-Box One-Time Code',
  category: 'inputs',
  tags: ['otp', 'code', 'verification', 'keyboard'],
}

const LENGTH = 6

const css = `
.awk-el-inputs-otp-six {
  box-sizing: border-box;
  width: 100%;
  max-width: 340px;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-inputs-otp-six fieldset {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}

.awk-el-inputs-otp-six legend {
  padding: 0;
  margin-bottom: 0.55rem;
  font-size: 0.68rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-inputs-otp-six .boxes {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0.4rem;
}

.awk-el-inputs-otp-six .box {
  width: 100%;
  box-sizing: border-box;
  min-height: 50px;
  padding: 0;
  text-align: center;
  font-family: var(--font-mono, monospace);
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--text-primary, #E8F0F8);
  background: var(--bg-elevated, #1A2A40);
  border: 1px solid var(--border-default, #5d7594);
  border-radius: var(--radius-lg, 12px);
  outline: none;
  caret-color: var(--accent-primary, #00E5FF);
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease, background 0.18s ease;
}

.awk-el-inputs-otp-six .box:hover {
  border-color: var(--border-strong, #8fa3bd);
}

.awk-el-inputs-otp-six .box:focus {
  border-color: var(--accent-primary, #00E5FF);
  background: var(--bg-surface, #0A1628);
  box-shadow: 0 0 0 3px rgba(0, 229, 255, 0.16);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent-primary, #00E5FF) 20%, transparent);
  transform: translateY(-2px);
}

.awk-el-inputs-otp-six .box.filled {
  border-color: color-mix(in oklab, var(--accent-primary, #00E5FF) 55%, var(--border-default, #5d7594));
  animation: awk-el-inputs-otp-six-1 0.2s ease;
}

.awk-el-inputs-otp-six .box.filled:focus {
  border-color: var(--accent-primary, #00E5FF);
}

.awk-el-inputs-otp-six .foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.65rem;
  font-size: 0.72rem;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-inputs-otp-six .foot button {
  padding: 0.15rem 0.25rem;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--accent-primary, #00E5FF);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.awk-el-inputs-otp-six .foot button:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.awk-el-inputs-otp-six .foot button:focus-visible {
  outline: 2px solid var(--accent-primary, #00E5FF);
  outline-offset: 2px;
}

.awk-el-inputs-otp-six .status {
  font-family: var(--font-mono, monospace);
  font-size: 0.66rem;
  color: var(--text-ghost, #7a8ba3);
}

@keyframes awk-el-inputs-otp-six-1 {
  0% { transform: scale(0.92); }
  60% { transform: scale(1.04); }
  100% { transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-inputs-otp-six *,
  .awk-el-inputs-otp-six *::before,
  .awk-el-inputs-otp-six *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`

export default function OtpSix(): JSX.Element {
  const groupId = useId()
  const statusId = useId()
  const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(''))
  const inputs = useRef<Array<HTMLInputElement | null>>([])

  const focusAt = (index: number) => {
    const clamped = Math.max(0, Math.min(LENGTH - 1, index))
    inputs.current[clamped]?.focus()
    inputs.current[clamped]?.select()
  }

  const setDigit = (index: number, raw: string) => {
    const next = [...digits]
    next[index] = raw.replace(/\D/g, '').slice(-1)
    setDigits(next)
    if (next[index]) focusAt(index + 1)
  }

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      event.preventDefault()
      const next = [...digits]
      next[index - 1] = ''
      setDigits(next)
      focusAt(index - 1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusAt(index - 1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusAt(index + 1)
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, LENGTH)
    if (!pasted) return
    event.preventDefault()
    const next = Array(LENGTH).fill('')
    for (let i = 0; i < pasted.length; i += 1) next[i] = pasted[i]
    setDigits(next)
    focusAt(pasted.length >= LENGTH ? LENGTH - 1 : pasted.length)
  }

  return (
    <div className="awk-el-inputs-otp-six">
      <style>{css}</style>
      <fieldset aria-describedby={statusId}>
        <legend>Verification code</legend>
        <div className="boxes">
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={element => { inputs.current[index] = element }}
              className={digit ? 'box filled' : 'box'}
              type="text"
              inputMode="numeric"
              autoComplete={index === 0 ? 'one-time-code' : 'off'}
              maxLength={1}
              value={digit}
              aria-label={`Digit ${index + 1} of ${LENGTH}`}
              onChange={event => setDigit(index, event.target.value)}
              onKeyDown={event => onKeyDown(index, event)}
              onPaste={onPaste}
              onFocus={event => event.currentTarget.select()}
            />
          ))}
        </div>
      </fieldset>
      <div className="foot">
        <button type="button">Resend code</button>
        <span className="status" id={statusId}>{digits.filter(Boolean).length}/{LENGTH} entered</span>
      </div>
    </div>
  )
}
