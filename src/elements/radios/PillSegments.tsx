import { useId, useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'radios-pill-segments',
  title: 'Segmented Pills',
  category: 'radios',
  tags: ['radio', 'segmented', 'sliding', 'filter'],
}

const OPTIONS = ['Day', 'Week', 'Month', 'Year']

const css = `
.awk-el-radios-pill-segments {
  box-sizing: border-box;
  width: 100%;
  max-width: 340px;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-radios-pill-segments fieldset {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}

.awk-el-radios-pill-segments legend {
  padding: 0;
  margin-bottom: 0.5rem;
  font-size: 0.68rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-radios-pill-segments .seg {
  position: relative;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  padding: 4px;
  background: var(--bg-elevated, #1A2A40);
  border: 1px solid var(--border-default, #5d7594);
  border-radius: 999px;
}

.awk-el-radios-pill-segments .thumb {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 4px;
  width: calc((100% - 8px) / 4);
  border-radius: 999px;
  background: var(--accent-primary, #00E5FF);
  box-shadow: 0 2px 10px rgba(0, 229, 255, 0.28);
  box-shadow: 0 2px 10px color-mix(in oklab, var(--accent-primary, #00E5FF) 34%, transparent);
  transition: transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.awk-el-radios-pill-segments .opt {
  position: relative;
  display: block;
  cursor: pointer;
}

.awk-el-radios-pill-segments .native {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}

.awk-el-radios-pill-segments .txt {
  position: relative;
  z-index: 1;
  display: block;
  padding: 0.42rem 0;
  border-radius: 999px;
  text-align: center;
  font-size: 0.73rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-muted, #a8b6c8);
  transition: color 0.2s ease;
}

.awk-el-radios-pill-segments .opt:hover .txt {
  color: var(--text-primary, #E8F0F8);
}

.awk-el-radios-pill-segments .native:checked + .txt {
  color: var(--bg-deep, #060D1A);
}

.awk-el-radios-pill-segments .native:focus-visible + .txt {
  outline: 2px solid var(--accent-primary, #00E5FF);
  outline-offset: 1px;
}

.awk-el-radios-pill-segments .caption {
  margin: 0.55rem 0 0;
  text-align: center;
  font-size: 0.71rem;
  color: var(--text-ghost, #7a8ba3);
}

.awk-el-radios-pill-segments .caption b {
  color: var(--text-secondary, #cdd8e5);
  font-weight: 600;
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-radios-pill-segments *,
  .awk-el-radios-pill-segments *::before,
  .awk-el-radios-pill-segments *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`

export default function PillSegments(): JSX.Element {
  const group = useId()
  const [index, setIndex] = useState(1)

  return (
    <div className="awk-el-radios-pill-segments">
      <style>{css}</style>
      <fieldset>
        <legend>Range</legend>
        <div className="seg">
          <span className="thumb" style={{ transform: `translateX(${index * 100}%)` }} aria-hidden="true" />
          {OPTIONS.map((label, i) => (
            <label className="opt" key={label}>
              <input
                className="native"
                type="radio"
                name={group}
                value={label}
                checked={index === i}
                onChange={() => setIndex(i)}
              />
              <span className="txt">{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="caption">Showing data by <b>{OPTIONS[index].toLowerCase()}</b></p>
    </div>
  )
}
