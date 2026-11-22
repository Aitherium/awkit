import { useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'badges-removable-chip',
  title: 'Removable Chip',
  category: 'badges',
  tags: ['chip', 'removable', 'filter', 'tag'],
}

const css = `
.awk-el-badges-removable-chip {
  --awk-rc-accent: var(--accent-primary, #00E5FF);
  --awk-rc-violet: var(--accent-secondary, #7C4DFF);
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.6rem;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-badges-removable-chip * {
  box-sizing: border-box;
}

.awk-el-badges-removable-chip .rc-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 30px;
  padding: 0.28rem 0.3rem 0.28rem 0.6rem;
  border: 1px solid var(--border-default, #5d7594);
  border-radius: 999px;
  background: var(--bg-elevated, #1A2A40);
  color: var(--text-secondary, #c8d3df);
  font-size: 0.72rem;
  font-weight: 550;
  transition: border-color 0.16s ease, background 0.16s ease;
  animation: awk-el-badges-removable-chip-1 0.24s ease;
}

.awk-el-badges-removable-chip .rc-chip:hover {
  border-color: var(--awk-rc-violet);
  background: var(--bg-overlay, #22344E);
}

.awk-el-badges-removable-chip .rc-swatch {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--awk-rc-violet);
  box-shadow: 0 0 8px rgba(124, 77, 255, 0.6);
}

.awk-el-badges-removable-chip .rc-label {
  white-space: nowrap;
}

.awk-el-badges-removable-chip .rc-remove {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted, #a8b6c8);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.awk-el-badges-removable-chip .rc-remove:hover {
  background: rgba(236, 72, 153, 0.18);
  color: var(--accent-rose, #ec4899);
}

.awk-el-badges-removable-chip .rc-remove:focus-visible {
  outline: 2px solid var(--border-focus, var(--awk-rc-accent));
  outline-offset: 1px;
}

.awk-el-badges-removable-chip .rc-remove svg {
  width: 11px;
  height: 11px;
}

.awk-el-badges-removable-chip .rc-add {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 30px;
  padding: 0.28rem 0.7rem;
  border: 1px dashed var(--border-default, #5d7594);
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted, #a8b6c8);
  font: inherit;
  font-size: 0.7rem;
  font-weight: 550;
  cursor: pointer;
  transition: border-color 0.16s ease, color 0.16s ease;
}

.awk-el-badges-removable-chip .rc-add:hover {
  border-color: var(--awk-rc-accent);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-badges-removable-chip .rc-add:focus-visible {
  outline: 2px solid var(--border-focus, var(--awk-rc-accent));
  outline-offset: 2px;
}

.awk-el-badges-removable-chip .rc-note {
  margin: 0;
  font-size: 0.62rem;
  color: var(--text-ghost, #7a8ba3);
}

@keyframes awk-el-badges-removable-chip-1 {
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-badges-removable-chip * {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`

export default function RemovableChip(): JSX.Element {
  const [visible, setVisible] = useState(true)

  return (
    <div className="awk-el-badges-removable-chip">
      <style>{css}</style>
      {visible ? (
        <span className="rc-chip">
          <span className="rc-swatch" aria-hidden="true" />
          <span className="rc-label">Design systems</span>
          <button
            type="button"
            className="rc-remove"
            aria-label="Remove Design systems"
            onClick={() => setVisible(false)}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </span>
      ) : (
        <button type="button" className="rc-add" onClick={() => setVisible(true)}>
          + Add topic
        </button>
      )}
      <p className="rc-note" aria-live="polite">
        {visible ? 'Filter active · remove to clear' : 'Filter cleared'}
      </p>
    </div>
  )
}
