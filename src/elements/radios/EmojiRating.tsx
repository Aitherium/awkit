import { useId, useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'radios-emoji-rating',
  title: 'Emoji Rating',
  category: 'radios',
  tags: ['radio', 'rating', 'emoji', 'feedback'],
}

const FACES = [
  { value: 1, emoji: '😖', caption: 'Bad' },
  { value: 2, emoji: '😕', caption: 'Meh' },
  { value: 3, emoji: '😐', caption: 'Okay' },
  { value: 4, emoji: '🙂', caption: 'Good' },
  { value: 5, emoji: '😄', caption: 'Great' },
]

const css = `
.awk-el-radios-emoji-rating {
  box-sizing: border-box;
  width: 100%;
  max-width: 340px;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-radios-emoji-rating fieldset {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}

.awk-el-radios-emoji-rating legend {
  padding: 0;
  margin-bottom: 0.6rem;
  font-size: 0.72rem;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-radios-emoji-rating .faces {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.3rem;
}

.awk-el-radios-emoji-rating .face {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.28rem;
  padding: 0.1rem;
  cursor: pointer;
}

.awk-el-radios-emoji-rating .native {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}

.awk-el-radios-emoji-rating .pod {
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1;
  max-width: 52px;
  border: 1px solid var(--border-subtle, #4c5d75);
  border-radius: 14px;
  background: var(--bg-elevated, #1A2A40);
  font-size: 1.32rem;
  line-height: 1;
  filter: saturate(0.85);
  transition: transform 0.16s ease, background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
}

.awk-el-radios-emoji-rating .face:hover .pod {
  transform: translateY(-2px);
  border-color: var(--border-strong, #8fa3bd);
  filter: saturate(1);
}

.awk-el-radios-emoji-rating .native:checked + .pod {
  border-color: var(--accent-primary, #00E5FF);
  background: color-mix(in oklab, var(--accent-primary, #00E5FF) 15%, var(--bg-elevated, #1A2A40));
  box-shadow: 0 0 0 2px color-mix(in oklab, var(--accent-primary, #00E5FF) 22%, transparent);
  filter: saturate(1);
  transform: translateY(-3px) scale(1.04);
  animation: awk-el-radios-emoji-rating-1 0.28s cubic-bezier(0.2, 1.3, 0.4, 1);
}

.awk-el-radios-emoji-rating .native:focus-visible + .pod {
  outline: 2px solid var(--accent-primary, #00E5FF);
  outline-offset: 2px;
}

.awk-el-radios-emoji-rating .cap {
  font-size: 0.58rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-ghost, #7a8ba3);
  transition: color 0.18s ease;
}

.awk-el-radios-emoji-rating .native:checked ~ .cap {
  color: var(--accent-primary, #00E5FF);
}

.awk-el-radios-emoji-rating .summary {
  margin: 0.65rem 0 0;
  text-align: center;
  font-size: 0.72rem;
  color: var(--text-ghost, #7a8ba3);
  min-height: 1rem;
}

.awk-el-radios-emoji-rating .summary b {
  color: var(--text-secondary, #cdd8e5);
  font-weight: 600;
}

@keyframes awk-el-radios-emoji-rating-1 {
  0% { transform: translateY(-1px) scale(1.12); }
  60% { transform: translateY(-4px) scale(1.02); }
  100% { transform: translateY(-3px) scale(1.04); }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-radios-emoji-rating *,
  .awk-el-radios-emoji-rating *::before,
  .awk-el-radios-emoji-rating *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`

export default function EmojiRating(): JSX.Element {
  const group = useId()
  const [rating, setRating] = useState(4)
  const active = FACES.find(face => face.value === rating)

  return (
    <div className="awk-el-radios-emoji-rating">
      <style>{css}</style>
      <fieldset>
        <legend>How did the session go?</legend>
        <div className="faces">
          {FACES.map(face => (
            <label className="face" key={face.value}>
              <input
                className="native"
                type="radio"
                name={group}
                value={face.value}
                checked={rating === face.value}
                onChange={() => setRating(face.value)}
                aria-label={`Rate ${face.value} out of 5, ${face.caption}`}
              />
              <span className="pod" aria-hidden="true">{face.emoji}</span>
              <span className="cap">{face.caption}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="summary" aria-live="polite">
        {active ? <>You rated <b>{active.value}/5</b> — {active.caption}</> : 'Pick the face that fits'}
      </p>
    </div>
  )
}
