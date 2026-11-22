import { useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'inputs-tag-entry',
  title: 'Tag Entry Field',
  category: 'inputs',
  tags: ['tags', 'chips', 'keyboard', 'multi value'],
}

const css = `
.awk-el-inputs-tag-entry {
  box-sizing: border-box;
  width: 100%;
  max-width: 340px;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-inputs-tag-entry .label {
  display: block;
  margin-bottom: 0.4rem;
  font-size: 0.72rem;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-inputs-tag-entry .zone {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.5rem;
  background: var(--bg-elevated, #1A2A40);
  border: 1px solid var(--border-default, #5d7594);
  border-radius: var(--radius-lg, 12px);
  cursor: text;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}

.awk-el-inputs-tag-entry .zone:hover {
  border-color: var(--border-strong, #8fa3bd);
}

.awk-el-inputs-tag-entry .zone:focus-within {
  border-color: var(--accent-primary, #00E5FF);
  background: var(--bg-surface, #0A1628);
  box-shadow: 0 0 0 3px rgba(0, 229, 255, 0.16);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent-primary, #00E5FF) 20%, transparent);
}

.awk-el-inputs-tag-entry .chip {
  display: inline-flex;
  align-items: center;
  gap: 0.18rem;
  max-width: 100%;
  padding: 0.18rem 0.24rem 0.18rem 0.55rem;
  border-radius: 999px;
  background: rgba(0, 229, 255, 0.12);
  background: color-mix(in oklab, var(--accent-primary, #00E5FF) 14%, transparent);
  border: 1px solid rgba(0, 229, 255, 0.28);
  border-color: color-mix(in oklab, var(--accent-primary, #00E5FF) 36%, transparent);
  color: var(--accent-primary, #00E5FF);
  font-size: 0.71rem;
  font-weight: 500;
  line-height: 1.5;
  animation: awk-el-inputs-tag-entry-1 0.18s cubic-bezier(0.2, 1.2, 0.4, 1);
}

.awk-el-inputs-tag-entry .chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.awk-el-inputs-tag-entry .chip button {
  flex: none;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 0.8rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0.72;
  transition: background 0.14s ease, opacity 0.14s ease;
}

.awk-el-inputs-tag-entry .chip button:hover {
  background: color-mix(in oklab, var(--accent-primary, #00E5FF) 26%, transparent);
  opacity: 1;
}

.awk-el-inputs-tag-entry .chip button:focus-visible {
  outline: 2px solid var(--accent-primary, #00E5FF);
  outline-offset: 1px;
}

.awk-el-inputs-tag-entry input {
  flex: 1 1 84px;
  min-width: 76px;
  padding: 0.28rem 0.15rem;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.8rem;
  outline: none;
  caret-color: var(--accent-primary, #00E5FF);
}

.awk-el-inputs-tag-entry input::placeholder {
  color: var(--text-ghost, #7a8ba3);
}

.awk-el-inputs-tag-entry .hint {
  margin: 0.4rem 0 0;
  font-size: 0.68rem;
  color: var(--text-ghost, #7a8ba3);
}

.awk-el-inputs-tag-entry .hint kbd {
  padding: 0.05rem 0.28rem;
  border: 1px solid var(--border-subtle, #4c5d75);
  border-radius: 4px;
  background: var(--bg-base, #0A1628);
  font-family: var(--font-mono, monospace);
  font-size: 0.6rem;
}

@keyframes awk-el-inputs-tag-entry-1 {
  from { opacity: 0; transform: scale(0.82); }
  to { opacity: 1; transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-inputs-tag-entry *,
  .awk-el-inputs-tag-entry *::before,
  .awk-el-inputs-tag-entry *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`

export default function TagEntry(): JSX.Element {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [tags, setTags] = useState<string[]>(['design', 'motion'])
  const [draft, setDraft] = useState('')

  const addTag = () => {
    const next = draft.trim().replace(/^#/, '')
    if (!next) return
    if (!tags.some(tag => tag.toLowerCase() === next.toLowerCase())) setTags(current => [...current, next])
    setDraft('')
  }

  const removeTag = (index: number) => {
    setTags(current => current.filter((_, i) => i !== index))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addTag()
    } else if (event.key === 'Backspace' && !draft && tags.length > 0) {
      event.preventDefault()
      removeTag(tags.length - 1)
    }
  }

  return (
    <div className="awk-el-inputs-tag-entry">
      <style>{css}</style>
      <label className="label" htmlFor={id}>Topics</label>
      <div className="zone" onClick={() => inputRef.current?.focus()}>
        {tags.map((tag, index) => (
          <span className="chip" key={tag}>
            <span>{tag}</span>
            <button type="button" onClick={() => removeTag(index)} aria-label={`Remove tag ${tag}`}>×</button>
          </span>
        ))}
        <input
          id={id}
          ref={inputRef}
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={addTag}
          placeholder={tags.length ? 'Add another…' : 'Add a tag…'}
          autoComplete="off"
        />
      </div>
      <p className="hint"><kbd>Enter</kbd> or <kbd>,</kbd> to add · <kbd>⌫</kbd> removes the last</p>
    </div>
  )
}
