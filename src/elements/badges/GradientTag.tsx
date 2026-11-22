import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'badges-gradient-tag',
  title: 'Gradient Tag',
  category: 'badges',
  tags: ['tag', 'gradient', 'label', 'ai'],
}

const css = `
.awk-el-badges-gradient-tag {
  --awk-gt-accent: var(--accent-primary, #00E5FF);
  --awk-gt-violet: var(--accent-secondary, #7C4DFF);
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.55rem;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-badges-gradient-tag * {
  box-sizing: border-box;
}

.awk-el-badges-gradient-tag .gt-tag {
  position: relative;
  isolation: isolate;
  display: inline-flex;
  align-items: center;
  gap: 0.38rem;
  padding: 0.3rem 0.62rem 0.3rem 0.5rem;
  overflow: hidden;
  border-radius: 999px;
  background: linear-gradient(120deg,
    color-mix(in oklab, var(--awk-gt-accent) 18%, transparent),
    color-mix(in oklab, var(--awk-gt-violet) 20%, transparent));
  color: var(--text-primary, #E8F0F8);
  font-family: var(--font-mono, monospace);
  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  white-space: nowrap;
}

.awk-el-badges-gradient-tag .gt-tag::before {
  content: '';
  position: absolute;
  inset: 0;
  padding: 1px;
  border-radius: inherit;
  background: linear-gradient(120deg, var(--awk-gt-accent), var(--awk-gt-violet));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  pointer-events: none;
  z-index: -1;
}

.awk-el-badges-gradient-tag .gt-tag::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -60%;
  width: 40%;
  transform: skewX(-18deg);
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.28), transparent);
  opacity: 0;
  pointer-events: none;
}

.awk-el-badges-gradient-tag .gt-tag:hover::after {
  animation: awk-el-badges-gradient-tag-1 0.8s ease;
}

.awk-el-badges-gradient-tag .gt-tag svg {
  width: 12px;
  height: 12px;
  color: var(--awk-gt-accent);
}

.awk-el-badges-gradient-tag .gt-note {
  margin: 0;
  font-size: 0.62rem;
  color: var(--text-ghost, #7a8ba3);
}

@keyframes awk-el-badges-gradient-tag-1 {
  0% { left: -60%; opacity: 0; }
  25% { opacity: 1; }
  100% { left: 130%; opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-badges-gradient-tag *,
  .awk-el-badges-gradient-tag *::after {
    transition-duration: 0.01ms !important;
    animation: none !important;
  }
}
`

export default function GradientTag(): JSX.Element {
  return (
    <div className="awk-el-badges-gradient-tag">
      <style>{css}</style>
      <span className="gt-tag">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3.2l1.9 5.3 5.3 1.9-5.3 1.9-1.9 5.3-1.9-5.3-5.3-1.9 5.3-1.9 1.9-5.3Z"
            fill="currentColor"
            fillOpacity="0.9"
          />
        </svg>
        AI-generated
      </span>
      <p className="gt-note">Gradient border · hovers sweep a shine</p>
    </div>
  )
}
