'use client'

/**
 * Day / Night — the switch as a small scene. Off is a pale sky; on is deep
 * night with stars behind the thumb. The thumb carries both glyphs and swaps
 * sun for moon as it slides. Colours are fixed so the scene reads the same on
 * a light or dark preview tile.
 */

import { useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'toggles-day-night',
  title: 'Day / Night',
  category: 'toggles',
  tags: ['theme', 'switch', 'day night', 'sun moon', 'scene'],
}

const css = `
.awk-el-toggles-day-night {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-sans, 'Inter', -apple-system, sans-serif);
}

.awk-el-toggles-day-night__row {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
  cursor: pointer;
  user-select: none;
}

.awk-el-toggles-day-night__input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.awk-el-toggles-day-night__track {
  position: relative;
  flex: 0 0 auto;
  width: 68px;
  height: 34px;
  border-radius: 999px;
  border: 1px solid var(--border-default, #4a6074);
  overflow: hidden;
  background: linear-gradient(135deg, #e0f2fe, #7dd3fc);
  transition: background 260ms ease;
}

.awk-el-toggles-day-night__stars {
  position: absolute;
  inset: 0;
  opacity: 0;
  background-image:
    radial-gradient(circle, #ffffff 1px, transparent 1.5px),
    radial-gradient(circle, #ffffff 1px, transparent 1.5px),
    radial-gradient(circle, #ffffff 1px, transparent 1.5px);
  background-repeat: no-repeat;
  background-position: 9px 8px, 17px 20px, 27px 11px;
  transition: opacity 260ms ease;
}

.awk-el-toggles-day-night__input:checked + .awk-el-toggles-day-night__track {
  background: linear-gradient(135deg, #141a3d, #2a2560);
}

.awk-el-toggles-day-night__input:checked
  + .awk-el-toggles-day-night__track
  .awk-el-toggles-day-night__stars {
  opacity: 0.85;
}

.awk-el-toggles-day-night__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 4px oklch(0 0 0 / 0.3);
  transition: transform 260ms cubic-bezier(0.4, 0, 0.2, 1);
}

.awk-el-toggles-day-night__input:checked
  + .awk-el-toggles-day-night__track
  .awk-el-toggles-day-night__thumb {
  transform: translateX(34px);
}

.awk-el-toggles-day-night__glyph {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  transition: opacity 200ms ease;
}

.awk-el-toggles-day-night__glyph svg {
  display: block;
  width: 15px;
  height: 15px;
}

.awk-el-toggles-day-night__glyph--sun {
  color: #f59e0b;
  opacity: 1;
}

.awk-el-toggles-day-night__glyph--moon {
  color: #4338ca;
  opacity: 0;
}

.awk-el-toggles-day-night__input:checked
  + .awk-el-toggles-day-night__track
  .awk-el-toggles-day-night__glyph--sun {
  opacity: 0;
}

.awk-el-toggles-day-night__input:checked
  + .awk-el-toggles-day-night__track
  .awk-el-toggles-day-night__glyph--moon {
  opacity: 1;
}

.awk-el-toggles-day-night__input:focus-visible + .awk-el-toggles-day-night__track {
  outline: 2px solid var(--border-focus, #00e5ff);
  outline-offset: 3px;
}

.awk-el-toggles-day-night__text {
  font: 600 0.84rem/1.1 var(--font-sans, 'Inter', -apple-system, sans-serif);
  color: var(--text-primary, #e8f0f8);
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-toggles-day-night__track,
  .awk-el-toggles-day-night__stars,
  .awk-el-toggles-day-night__thumb,
  .awk-el-toggles-day-night__glyph {
    transition: none;
  }
}
`

export default function DayNight(): JSX.Element {
  const [night, setNight] = useState(true)

  return (
    <div className="awk-el-toggles-day-night">
      <label className="awk-el-toggles-day-night__row">
        <input
          type="checkbox"
          className="awk-el-toggles-day-night__input"
          checked={night}
          onChange={(event) => setNight(event.target.checked)}
        />
        <span className="awk-el-toggles-day-night__track" aria-hidden="true">
          <span className="awk-el-toggles-day-night__stars" />
          <span className="awk-el-toggles-day-night__thumb">
            <span className="awk-el-toggles-day-night__glyph awk-el-toggles-day-night__glyph--sun">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="4.5" />
                <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
              </svg>
            </span>
            <span className="awk-el-toggles-day-night__glyph awk-el-toggles-day-night__glyph--moon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
              </svg>
            </span>
          </span>
        </span>
        <span className="awk-el-toggles-day-night__text">Night mode</span>
      </label>
      <style>{css}</style>
    </div>
  )
}
