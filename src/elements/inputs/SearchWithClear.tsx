import { useId, useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'inputs-search-with-clear',
  title: 'Search with Clear',
  category: 'inputs',
  tags: ['search', 'icon', 'clear button', 'shortcut'],
}

const SAMPLE = [
  'Aurora Button',
  'Orbit Toggle',
  'Signal Loader',
  'Nebula Card',
  'Comet Badge',
  'Drift Progress',
]

const css = `
.awk-el-inputs-search-with-clear {
  box-sizing: border-box;
  width: 100%;
  max-width: 340px;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-inputs-search-with-clear .bar {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0 0.6rem 0 0.85rem;
  min-height: 46px;
  background: var(--bg-elevated, #1A2A40);
  border: 1px solid var(--border-default, #5d7594);
  border-radius: 999px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}

.awk-el-inputs-search-with-clear .bar:hover {
  border-color: var(--border-strong, #8fa3bd);
}

.awk-el-inputs-search-with-clear .bar:focus-within {
  border-color: var(--accent-primary, #00E5FF);
  background: var(--bg-surface, #0A1628);
  box-shadow: 0 0 0 3px rgba(0, 229, 255, 0.16);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent-primary, #00E5FF) 20%, transparent);
}

.awk-el-inputs-search-with-clear .glass {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--text-ghost, #7a8ba3);
  transition: color 0.2s ease;
}

.awk-el-inputs-search-with-clear .bar:focus-within .glass {
  color: var(--accent-primary, #00E5FF);
}

.awk-el-inputs-search-with-clear input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.85rem;
  padding: 0.7rem 0;
  outline: none;
  caret-color: var(--accent-primary, #00E5FF);
}

.awk-el-inputs-search-with-clear input::placeholder {
  color: var(--text-ghost, #7a8ba3);
}

.awk-el-inputs-search-with-clear input::-webkit-search-cancel-button {
  display: none;
}

.awk-el-inputs-search-with-clear .clear {
  flex: none;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--bg-hover, #1F3149);
  color: var(--text-muted, #a8b6c8);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
}

.awk-el-inputs-search-with-clear .clear:hover {
  background: color-mix(in oklab, var(--accent-danger, #f87171) 18%, transparent);
  color: var(--accent-danger, #f87171);
}

.awk-el-inputs-search-with-clear .clear:active {
  transform: scale(0.9);
}

.awk-el-inputs-search-with-clear .clear:focus-visible {
  outline: 2px solid var(--accent-primary, #00E5FF);
  outline-offset: 2px;
}

.awk-el-inputs-search-with-clear .clear svg {
  width: 12px;
  height: 12px;
}

.awk-el-inputs-search-with-clear .kbd {
  flex: none;
  padding: 0.16rem 0.38rem;
  border: 1px solid var(--border-subtle, #4c5d75);
  border-bottom-width: 2px;
  border-radius: 5px;
  background: var(--bg-base, #0A1628);
  color: var(--text-ghost, #7a8ba3);
  font-family: var(--font-mono, monospace);
  font-size: 0.62rem;
  letter-spacing: 0.03em;
}

.awk-el-inputs-search-with-clear .results {
  margin: 0.55rem 0.2rem 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.awk-el-inputs-search-with-clear .results li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.34rem 0.45rem;
  border-radius: 8px;
  font-size: 0.76rem;
  color: var(--text-secondary, #cdd8e5);
  animation: awk-el-inputs-search-with-clear-1 0.18s ease both;
}

.awk-el-inputs-search-with-clear .results li::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent-primary, #00E5FF);
  opacity: 0.75;
}

.awk-el-inputs-search-with-clear .results mark {
  background: transparent;
  color: var(--accent-primary, #00E5FF);
  font-weight: 600;
}

.awk-el-inputs-search-with-clear .empty {
  margin: 0.55rem 0.2rem 0;
  font-size: 0.74rem;
  color: var(--text-ghost, #7a8ba3);
}

@keyframes awk-el-inputs-search-with-clear-1 {
  from { opacity: 0; transform: translateY(-3px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-inputs-search-with-clear *,
  .awk-el-inputs-search-with-clear *::before,
  .awk-el-inputs-search-with-clear *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`

export default function SearchWithClear(): JSX.Element {
  const id = useId()
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const matches = q ? SAMPLE.filter(name => name.toLowerCase().includes(q)) : []

  return (
    <div className="awk-el-inputs-search-with-clear">
      <style>{css}</style>
      <label htmlFor={id} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
        Search elements
      </label>
      <div className="bar">
        <svg className="glass" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.2" stroke="currentColor" strokeWidth="2" />
          <path d="M15.2 15.2L20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          id={id}
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search the gallery"
          autoComplete="off"
          spellCheck={false}
        />
        {query ? (
          <button type="button" className="clear" onClick={() => setQuery('')} aria-label="Clear search">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </button>
        ) : (
          <kbd className="kbd" aria-hidden="true">⌘K</kbd>
        )}
      </div>
      {q && matches.length > 0 && (
        <ul className="results" aria-label="Matching elements">
          {matches.slice(0, 3).map(name => {
            const at = name.toLowerCase().indexOf(q)
            return (
              <li key={name}>
                <span>
                  {name.slice(0, at)}
                  <mark>{name.slice(at, at + q.length)}</mark>
                  {name.slice(at + q.length)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {q && matches.length === 0 && <p className="empty">No elements match “{query.trim()}”.</p>}
    </div>
  )
}
