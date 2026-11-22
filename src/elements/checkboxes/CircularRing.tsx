import { useId } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'checkboxes-circular-ring',
  title: 'Circular Ring Checks',
  category: 'checkboxes',
  tags: ['checkbox', 'circular', 'ring', 'settings'],
}

const css = `
.awk-el-checkboxes-circular-ring {
  box-sizing: border-box;
  width: 100%;
  max-width: 340px;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-checkboxes-circular-ring .title {
  margin: 0 0 0.35rem;
  font-size: 0.68rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-checkboxes-circular-ring .list {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
}

.awk-el-checkboxes-circular-ring .row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.48rem 0.55rem;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.awk-el-checkboxes-circular-ring .row:hover {
  background: var(--card-hover, rgba(232, 240, 248, 0.06));
}

.awk-el-checkboxes-circular-ring .native {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}

.awk-el-checkboxes-circular-ring .dot {
  position: relative;
  flex: none;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-strong, #8fa3bd);
  border-radius: 50%;
  background: transparent;
  transition: border-color 0.2s ease, box-shadow 0.25s ease;
}

.awk-el-checkboxes-circular-ring .dot::after {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-primary, #00E5FF);
  transform: scale(0);
  transition: transform 0.2s cubic-bezier(0.2, 1.35, 0.4, 1);
}

.awk-el-checkboxes-circular-ring .native:checked + .dot {
  border-color: var(--accent-primary, #00E5FF);
  box-shadow: 0 0 0 4px rgba(0, 229, 255, 0.12);
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--accent-primary, #00E5FF) 16%, transparent);
}

.awk-el-checkboxes-circular-ring .native:checked + .dot::after {
  transform: scale(1);
}

.awk-el-checkboxes-circular-ring .row:hover .dot {
  border-color: var(--accent-primary, #00E5FF);
}

.awk-el-checkboxes-circular-ring .native:focus-visible + .dot {
  outline: 2px solid var(--accent-primary, #00E5FF);
  outline-offset: 3px;
}

.awk-el-checkboxes-circular-ring .name {
  font-size: 0.83rem;
  color: var(--text-secondary, #cdd8e5);
  transition: color 0.18s ease;
}

.awk-el-checkboxes-circular-ring .native:checked ~ .name {
  color: var(--text-primary, #E8F0F8);
}

.awk-el-checkboxes-circular-ring .state {
  margin-left: auto;
  font-family: var(--font-mono, monospace);
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  color: var(--text-ghost, #7a8ba3);
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity 0.2s ease, transform 0.2s ease, color 0.2s ease;
}

.awk-el-checkboxes-circular-ring .native:checked ~ .state {
  opacity: 1;
  transform: translateX(0);
  color: var(--accent-primary, #00E5FF);
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-checkboxes-circular-ring *,
  .awk-el-checkboxes-circular-ring *::before,
  .awk-el-checkboxes-circular-ring *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`

export default function CircularRing(): JSX.Element {
  const group = useId()

  return (
    <div className="awk-el-checkboxes-circular-ring">
      <style>{css}</style>
      <p className="title" id={group}>Sync &amp; storage</p>
      <div className="list" role="group" aria-labelledby={group}>
        <label className="row">
          <input className="native" type="checkbox" name={`${group}-sync`} defaultChecked />
          <span className="dot" aria-hidden="true" />
          <span className="name">Auto-sync changes</span>
          <span className="state" aria-hidden="true">ON</span>
        </label>
        <label className="row">
          <input className="native" type="checkbox" name={`${group}-focus`} />
          <span className="dot" aria-hidden="true" />
          <span className="name">Focus mode</span>
          <span className="state" aria-hidden="true">ON</span>
        </label>
        <label className="row">
          <input className="native" type="checkbox" name={`${group}-offline`} />
          <span className="dot" aria-hidden="true" />
          <span className="name">Offline cache</span>
          <span className="state" aria-hidden="true">ON</span>
        </label>
      </div>
    </div>
  )
}
