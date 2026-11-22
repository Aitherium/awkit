import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'loaders-spinner-arc',
  title: 'Spinner Arc',
  category: 'loaders',
  tags: ['spinner', 'arc', 'saving', 'gradient'],
}

const css = `
.awk-el-loaders-spinner-arc {
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
  padding: 1rem;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-muted, oklch(0.74 0.02 250));
}

.awk-el-loaders-spinner-arc .wheel {
  position: relative;
  width: 46px;
  height: 46px;
  flex: none;
}

.awk-el-loaders-spinner-arc .track {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 3px solid color-mix(in oklab, var(--border-default, oklch(0.62 0.02 250)) 42%, transparent);
}

.awk-el-loaders-spinner-arc .arc {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    transparent 0deg,
    color-mix(in oklab, var(--accent-primary, #00E5FF) 18%, transparent) 55deg,
    var(--accent-primary, #00E5FF) 300deg,
    var(--accent-cyan, #40C4FF) 360deg
  );
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px));
  animation: awk-el-loaders-spinner-arc-1 0.85s linear infinite;
  will-change: transform;
}

.awk-el-loaders-spinner-arc .halo {
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in oklab, var(--accent-primary, #00E5FF) 30%, transparent), transparent 70%);
  filter: blur(5px);
  animation: awk-el-loaders-spinner-arc-2 1.7s ease-in-out infinite;
}

.awk-el-loaders-spinner-arc .label {
  font-size: 0.78rem;
  letter-spacing: 0.02em;
}

.awk-el-loaders-spinner-arc .label strong {
  display: block;
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--text-primary, #E8F0F8);
}

@keyframes awk-el-loaders-spinner-arc-1 {
  to { transform: rotate(360deg); }
}

@keyframes awk-el-loaders-spinner-arc-2 {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 0.8; }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-loaders-spinner-arc .arc { animation-duration: 2.6s; }
  .awk-el-loaders-spinner-arc .halo { animation: none; opacity: 0.45; }
}
`

export default function SpinnerArc(): JSX.Element {
  return (
    <div className="awk-el-loaders-spinner-arc" role="status" aria-label="Saving changes">
      <style>{css}</style>
      <div className="wheel" aria-hidden="true">
        <span className="halo" />
        <span className="track" />
        <span className="arc" />
      </div>
      <span className="label">
        <strong>Saving</strong>
        Syncing changes…
      </span>
    </div>
  )
}
