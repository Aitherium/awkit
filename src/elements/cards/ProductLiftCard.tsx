import { useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'cards-product-lift',
  title: 'Hover-Lift Product Card',
  category: 'cards',
  tags: ['product', 'hover', 'ecommerce', 'add to cart'],
}

const css = `
.awk-el-cards-product-lift {
  --awk-pl-accent: var(--accent-primary, #00E5FF);
  --awk-pl-violet: var(--accent-secondary, #7C4DFF);
  width: 100%;
  max-width: 250px;
  overflow: hidden;
  border: 1px solid var(--border-subtle, #2b3f5c);
  border-radius: var(--radius-xl, 16px);
  background: var(--bg-surface, #0A1628);
  box-shadow: var(--shadow, 0 4px 24px rgba(0, 0, 0, 0.3));
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
  transition: transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.24s ease, border-color 0.24s ease;
}

.awk-el-cards-product-lift *,
.awk-el-cards-product-lift *::before,
.awk-el-cards-product-lift *::after {
  box-sizing: border-box;
}

.awk-el-cards-product-lift:hover,
.awk-el-cards-product-lift:focus-within {
  transform: translateY(-6px);
  border-color: var(--border-strong, #8fa3bd);
  box-shadow: var(--shadow-window, 0 16px 48px rgba(0, 0, 0, 0.55));
}

.awk-el-cards-product-lift .pl-visual {
  position: relative;
  height: 132px;
  display: grid;
  place-items: center;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 120%, rgba(124, 77, 255, 0.35), transparent 65%),
    linear-gradient(160deg, var(--bg-elevated, #1A2A40), var(--bg-deep, #060D1A));
}

.awk-el-cards-product-lift .pl-visual::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(232, 240, 248, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(232, 240, 248, 0.05) 1px, transparent 1px);
  background-size: 18px 18px;
  mask-image: radial-gradient(circle at 50% 55%, #000 20%, transparent 78%);
  -webkit-mask-image: radial-gradient(circle at 50% 55%, #000 20%, transparent 78%);
  pointer-events: none;
}

.awk-el-cards-product-lift .pl-orb {
  position: relative;
  width: 68px;
  height: 68px;
  border-radius: 50%;
  background: radial-gradient(circle at 34% 30%, #b7f4ff, var(--awk-pl-accent) 42%, var(--awk-pl-violet) 88%);
  box-shadow: 0 14px 30px rgba(0, 229, 255, 0.25), inset -6px -8px 18px rgba(6, 13, 26, 0.35);
  transition: transform 0.35s cubic-bezier(0.2, 0.9, 0.2, 1.25);
}

.awk-el-cards-product-lift:hover .pl-orb,
.awk-el-cards-product-lift:focus-within .pl-orb {
  transform: scale(1.07) rotate(-3deg);
}

.awk-el-cards-product-lift .pl-tag {
  position: absolute;
  top: 0.65rem;
  left: 0.65rem;
  z-index: 1;
  padding: 0.18rem 0.45rem;
  border-radius: 4px;
  background: rgba(6, 13, 26, 0.6);
  border: 1px solid rgba(232, 240, 248, 0.14);
  color: var(--text-secondary, #c8d3df);
  font-family: var(--font-mono, monospace);
  font-size: 0.56rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.awk-el-cards-product-lift .pl-body {
  padding: 0.9rem 0.95rem 1rem;
}

.awk-el-cards-product-lift .pl-name {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.awk-el-cards-product-lift .pl-desc {
  margin: 0.25rem 0 0;
  font-size: 0.7rem;
  line-height: 1.45;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-cards-product-lift .pl-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.8rem;
}

.awk-el-cards-product-lift .pl-price {
  font-family: var(--font-mono, monospace);
  font-size: 0.88rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.awk-el-cards-product-lift .pl-add {
  min-height: 32px;
  padding: 0.4rem 0.7rem;
  border: 0;
  border-radius: var(--radius, 8px);
  background: var(--bg-elevated, #1A2A40);
  color: var(--text-primary, #E8F0F8);
  font: inherit;
  font-size: 0.68rem;
  font-weight: 650;
  cursor: pointer;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.22s ease, transform 0.22s ease, background 0.18s ease, color 0.18s ease;
}

.awk-el-cards-product-lift:hover .pl-add,
.awk-el-cards-product-lift:focus-within .pl-add,
.awk-el-cards-product-lift .pl-add[data-added='true'] {
  opacity: 1;
  transform: translateY(0);
}

.awk-el-cards-product-lift .pl-add:hover {
  background: var(--awk-pl-accent);
  color: var(--bg-deep, #060D1A);
}

.awk-el-cards-product-lift .pl-add[data-added='true'] {
  background: var(--accent-green, #4ade80);
  color: var(--bg-deep, #060D1A);
}

@media (hover: none) {
  .awk-el-cards-product-lift .pl-add {
    opacity: 1;
    transform: none;
  }
}

.awk-el-cards-product-lift .pl-add:focus-visible {
  outline: 2px solid var(--border-focus, var(--awk-pl-accent));
  outline-offset: 2px;
  opacity: 1;
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-cards-product-lift,
  .awk-el-cards-product-lift * {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`

export default function ProductLiftCard(): JSX.Element {
  const [added, setAdded] = useState(false)

  return (
    <article className="awk-el-cards-product-lift">
      <style>{css}</style>
      <div className="pl-visual">
        <span className="pl-tag">New</span>
        <div className="pl-orb" aria-hidden="true" />
      </div>
      <div className="pl-body">
        <h3 className="pl-name">Halo Dock</h3>
        <p className="pl-desc">Magnetic desk dock with a machined aluminium spine.</p>
        <div className="pl-foot">
          <span className="pl-price">$149</span>
          <button
            type="button"
            className="pl-add"
            data-added={added}
            aria-pressed={added}
            onClick={() => setAdded(value => !value)}
          >
            {added ? 'Added ✓' : 'Add to bag'}
          </button>
        </div>
      </div>
    </article>
  )
}
