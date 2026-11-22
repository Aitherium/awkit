import { useId, useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'checkboxes-todo-strike',
  title: 'Struck Todo List',
  category: 'checkboxes',
  tags: ['checkbox', 'todo', 'strike through', 'checklist'],
}

const ITEMS = [
  { id: 'post', label: 'Draft the launch post', done: true },
  { id: 'preview', label: 'Send a preview to the crew', done: false },
  { id: 'schedule', label: 'Schedule the release', done: false },
  { id: 'feedback', label: 'Collect first feedback', done: false },
]

const css = `
.awk-el-checkboxes-todo-strike {
  width: 100%;
  max-width: 320px;
  padding: 0.85rem 0.9rem 0.95rem;
  box-sizing: border-box;
  background: var(--bg-surface, #0A1628);
  border: 1px solid var(--border-subtle, #4c5d75);
  border-radius: var(--radius-xl, 16px);
  box-shadow: var(--shadow, 0 4px 24px rgba(0, 0, 0, 0.3));
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-checkboxes-todo-strike .head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.45rem;
  padding: 0 0.25rem;
}

.awk-el-checkboxes-todo-strike .title {
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.awk-el-checkboxes-todo-strike .count {
  font-family: var(--font-mono, monospace);
  font-size: 0.64rem;
  color: var(--text-ghost, #7a8ba3);
  font-variant-numeric: tabular-nums;
}

.awk-el-checkboxes-todo-strike .todo {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.38rem 0.25rem;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.awk-el-checkboxes-todo-strike .todo:hover {
  background: var(--card-hover, rgba(232, 240, 248, 0.06));
}

.awk-el-checkboxes-todo-strike .native {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}

.awk-el-checkboxes-todo-strike .mark {
  position: relative;
  flex: none;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 1.5px solid var(--border-strong, #8fa3bd);
  border-radius: 5px;
  background: var(--bg-elevated, #1A2A40);
  color: var(--bg-deep, #060D1A);
  transition: background 0.2s ease, border-color 0.2s ease;
}

.awk-el-checkboxes-todo-strike .mark svg {
  width: 12px;
  height: 12px;
}

.awk-el-checkboxes-todo-strike .mark path {
  stroke-dasharray: 24;
  stroke-dashoffset: 24;
  transition: stroke-dashoffset 0.24s ease 0.05s;
}

.awk-el-checkboxes-todo-strike .native:checked + .mark {
  background: linear-gradient(135deg, var(--accent-green, #4ade80), var(--accent-primary, #00E5FF));
  border-color: transparent;
}

.awk-el-checkboxes-todo-strike .native:checked + .mark path {
  stroke-dashoffset: 0;
}

.awk-el-checkboxes-todo-strike .native:focus-visible + .mark {
  outline: 2px solid var(--accent-primary, #00E5FF);
  outline-offset: 3px;
}

.awk-el-checkboxes-todo-strike .text {
  position: relative;
  font-size: 0.81rem;
  line-height: 1.4;
  color: var(--text-secondary, #cdd8e5);
  transition: color 0.25s ease, opacity 0.25s ease;
}

.awk-el-checkboxes-todo-strike .text::after {
  content: '';
  position: absolute;
  left: -2px;
  right: -2px;
  top: 50%;
  height: 1.5px;
  border-radius: 2px;
  background: var(--accent-green, #4ade80);
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.awk-el-checkboxes-todo-strike .native:checked ~ .text {
  color: var(--text-ghost, #7a8ba3);
  opacity: 0.72;
}

.awk-el-checkboxes-todo-strike .native:checked ~ .text::after {
  transform: scaleX(1);
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-checkboxes-todo-strike *,
  .awk-el-checkboxes-todo-strike *::before,
  .awk-el-checkboxes-todo-strike *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
  .awk-el-checkboxes-todo-strike .mark path {
    stroke-dashoffset: 0;
  }
}
`

export default function TodoStrike(): JSX.Element {
  const group = useId()
  const [done, setDone] = useState<Record<string, boolean>>(
    Object.fromEntries(ITEMS.map(item => [item.id, item.done])),
  )
  const complete = ITEMS.filter(item => done[item.id]).length

  return (
    <div className="awk-el-checkboxes-todo-strike">
      <style>{css}</style>
      <div className="head">
        <span className="title" id={group}>Launch checklist</span>
        <span className="count">{complete}/{ITEMS.length} done</span>
      </div>
      <div role="group" aria-labelledby={group}>
        {ITEMS.map(item => (
          <label className="todo" key={item.id}>
            <input
              className="native"
              type="checkbox"
              checked={Boolean(done[item.id])}
              onChange={event => setDone(current => ({ ...current, [item.id]: event.target.checked }))}
            />
            <span className="mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M5 12.5l4.2 4.2L19 7.6" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="text">{item.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
