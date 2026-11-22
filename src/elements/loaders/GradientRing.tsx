import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'loaders-gradient-ring',
  title: 'Gradient Ring',
  category: 'loaders',
  tags: ['gradient', 'ring', 'glow', 'spectrum'],
}

const SPECTRUM = 'conic-gradient(from 0turn, #00E5FF, #536DFE, #7C4DFF, #EC4899, #00E5FF)'

const css = `
.awk-el-loaders-gradient-ring {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1.2rem;
  font-family: var(--font-sans, system-ui, sans-serif);
}

.awk-el-loaders-gradient-ring .stage {
  position: relative;
  width: 74px;
  height: 74px;
  display: grid;
  place-items: center;
}

.awk-el-loaders-gradient-ring .halo {
  position: absolute;
  inset: 10px;
  border-radius: 50%;
  background: ${SPECTRUM};
  filter: blur(11px);
  opacity: 0.45;
  animation: awk-el-loaders-gradient-ring-1 3.4s linear infinite reverse;
}

.awk-el-loaders-gradient-ring .ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: ${SPECTRUM};
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 9px), #000 calc(100% - 8px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 9px), #000 calc(100% - 8px));
  animation: awk-el-loaders-gradient-ring-1 1.6s linear infinite;
  will-change: transform;
}

.awk-el-loaders-gradient-ring .hole {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: color-mix(in oklab, var(--bg-deep, #060D1A) 78%, transparent);
  border: 1px solid color-mix(in oklab, var(--border-subtle, oklch(0.42 0.02 250)) 70%, transparent);
}

@keyframes awk-el-loaders-gradient-ring-1 {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-loaders-gradient-ring .ring { animation-duration: 5s; }
  .awk-el-loaders-gradient-ring .halo { animation: none; opacity: 0.35; }
}
`

export default function GradientRing(): JSX.Element {
  return (
    <div className="awk-el-loaders-gradient-ring" role="status" aria-label="Loading">
      <style>{css}</style>
      <div className="stage" aria-hidden="true">
        <span className="halo" />
        <span className="ring" />
        <span className="hole" />
      </div>
    </div>
  )
}
