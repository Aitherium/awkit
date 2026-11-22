import { useId } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'checkboxes-animated-check',
  title: 'Drawn Check',
  category: 'checkboxes',
  tags: ['checkbox', 'animated', 'stroke', 'notification'],
}

const css = `
.awk-el-checkboxes-animated-check {
  box-sizing: border-box;
  width: 100%;
  max-width: 340px;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-checkboxes-animated-check .title {
  margin: 0 0 0.45rem;
  font-size: 0.68rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-checkboxes-animated-check .row {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  padding: 0.5rem 0.6rem;
  border-radius: var(--radius, 8px);
  cursor: pointer;
  transition: background 0.15s ease;
}

.awk-el-checkboxes-animated-check .row:hover {
  background: var(--card-hover, rgba(232, 240, 248, 0.06));
}

.awk-el-checkboxes-animated-check .row:active .box {
  transform: scale(0.94);
}

.awk-el-checkboxes-animated-check .native {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}

.awk-el-checkboxes-animated-check .box {
  position: relative;
  flex: none;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  margin-top: 1px;
  border: 1.5px solid var(--border-strong, #8fa3bd);
  border-radius: 7px;
  background: var(--bg-elevated, #1A2A40);
  color: var(--bg-deep, #060D1A);
  transition: background 0.2s ease, border-color 0.2s ease, transform 0.14s ease;
}

.awk-el-checkboxes-animated-check .box svg {
  width: 14px;
  height: 14px;
}

.awk-el-checkboxes-animated-check .box path {
  stroke-dasharray: 24;
  stroke-dashoffset: 24;
  transition: stroke-dashoffset 0.26s cubic-bezier(0.4, 0, 0.2, 1) 0.04s;
}

.awk-el-checkboxes-animated-check .native:checked + .box {
  background: var(--accent-primary, #00E5FF);
  border-color: var(--accent-primary, #00E5FF);
  animation: awk-el-checkboxes-animated-check-1 0.3s cubic-bezier(0.2, 1.4, 0.4, 1);
}

.awk-el-checkboxes-animated-check .native:checked + .box path {
  stroke-dashoffset: 0;
}

.awk-el-checkboxes-animated-check .native:focus-visible + .box {
  outline: 2px solid var(--accent-primary, #00E5FF);
  outline-offset: 3px;
}

.awk-el-checkboxes-animated-check .copy {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding-top: 0.05rem;
}

.awk-el-checkboxes-animated-check .name {
  font-size: 0.84rem;
  line-height: 1.35;
  color: var(--text-secondary, #cdd8e5);
  transition: color 0.2s ease;
}

.awk-el-checkboxes-animated-check .native:checked ~ .copy .name {
  color: var(--text-primary, #E8F0F8);
}

.awk-el-checkboxes-animated-check .caption {
  font-size: 0.7rem;
  color: var(--text-ghost, #7a8ba3);
}

@keyframes awk-el-checkboxes-animated-check-1 {
  0% { transform: scale(0.82); }
  55% { transform: scale(1.08); }
  100% { transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-checkboxes-animated-check *,
  .awk-el-checkboxes-animated-check *::before,
  .awk-el-checkboxes-animated-check *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
  .awk-el-checkboxes-animated-check .box path {
    stroke-dashoffset: 0;
  }
}
`

export default function AnimatedCheck(): JSX.Element {
  const group = useId()

  return (
    <div className="awk-el-checkboxes-animated-check">
      <style>{css}</style>
      <p className="title" id={group}>Notify me about</p>
      <div role="group" aria-labelledby={group}>
        <label className="row">
          <input className="native" type="checkbox" name={`${group}-digest`} />
          <span className="box" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M5 12.5l4.4 4.4L19 7.4" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="copy">
            <span className="name">Weekly digest</span>
            <span className="caption">A short summary every Friday</span>
          </span>
        </label>
        <label className="row">
          <input className="native" type="checkbox" name={`${group}-security`} defaultChecked />
          <span className="box" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M5 12.5l4.4 4.4L19 7.4" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="copy">
            <span className="name">Security alerts</span>
            <span className="caption">Sign-ins from new devices, immediate</span>
          </span>
        </label>
      </div>
    </div>
  )
}
