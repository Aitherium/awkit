import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'loaders-morphing-square',
  title: 'Morphing Square',
  category: 'loaders',
  tags: ['morph', 'square', 'rotation', 'geometric'],
}

const css = `
.awk-el-loaders-morphing-square {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1.1rem;
  font-family: var(--font-sans, system-ui, sans-serif);
}

.awk-el-loaders-morphing-square .stage {
  position: relative;
  width: 66px;
  height: 66px;
  display: grid;
  place-items: center;
}

.awk-el-loaders-morphing-square .track {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px dashed color-mix(in oklab, var(--border-default, oklch(0.62 0.02 250)) 45%, transparent);
}

.awk-el-loaders-morphing-square .shape {
  width: 26px;
  height: 26px;
  background: linear-gradient(135deg, var(--accent-secondary, #7C4DFF), var(--accent-primary, #00E5FF));
  box-shadow:
    0 0 16px color-mix(in oklab, var(--accent-secondary, #7C4DFF) 45%, transparent),
    inset 0 0 8px color-mix(in oklab, #ffffff 20%, transparent);
  animation: awk-el-loaders-morphing-square-1 3s cubic-bezier(0.65, 0.05, 0.35, 0.95) infinite;
  will-change: transform, border-radius;
}

@keyframes awk-el-loaders-morphing-square-1 {
  0% { border-radius: 7px; transform: rotate(0deg) scale(1); }
  25% { border-radius: 50%; transform: rotate(90deg) scale(0.82); }
  50% { border-radius: 7px; transform: rotate(180deg) scale(1); }
  75% { border-radius: 50%; transform: rotate(270deg) scale(0.82); }
  100% { border-radius: 7px; transform: rotate(360deg) scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-loaders-morphing-square .shape {
    animation: none;
    border-radius: 50%;
    transform: rotate(45deg) scale(0.9);
  }
}
`

export default function MorphingSquare(): JSX.Element {
  return (
    <div className="awk-el-loaders-morphing-square" role="status" aria-label="Processing">
      <style>{css}</style>
      <div className="stage" aria-hidden="true">
        <span className="track" />
        <span className="shape" />
      </div>
    </div>
  )
}
