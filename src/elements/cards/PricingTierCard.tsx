import { useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'cards-pricing-tier',
  title: 'Pricing Tier Card',
  category: 'cards',
  tags: ['pricing', 'plan', 'subscription', 'feature list'],
}

const FEATURES = [
  '4 concurrent agent lanes',
  'Unlimited workspace history',
  'Shared memory graph',
  'Priority MicroScheduler queue',
]

const css = `
.awk-el-cards-pricing-tier {
  --awk-pt-accent: var(--accent-primary, #00E5FF);
  --awk-pt-violet: var(--accent-secondary, #7C4DFF);
  position: relative;
  width: 100%;
  max-width: 320px;
  padding: 1.4rem;
  border: 1px solid var(--border-subtle, #2b3f5c);
  border-radius: var(--radius-xl, 16px);
  background: var(--bg-surface, #0A1628);
  box-shadow: var(--shadow, 0 4px 24px rgba(0, 0, 0, 0.3));
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.awk-el-cards-pricing-tier *,
.awk-el-cards-pricing-tier *::before,
.awk-el-cards-pricing-tier *::after {
  box-sizing: border-box;
}

.awk-el-cards-pricing-tier:hover,
.awk-el-cards-pricing-tier:focus-within {
  transform: translateY(-3px);
  border-color: var(--awk-pt-accent);
  box-shadow: var(--shadow-window, 0 16px 48px rgba(0, 0, 0, 0.55));
}

.awk-el-cards-pricing-tier .pt-flag {
  position: absolute;
  top: -11px;
  right: 1.2rem;
  padding: 0.24rem 0.6rem;
  border-radius: 999px;
  background: var(--gradient-creation, linear-gradient(135deg, #00E5FF, #536DFE, #7C4DFF));
  color: var(--bg-deep, #060D1A);
  font-size: 0.6rem;
  font-weight: 750;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  box-shadow: 0 4px 14px rgba(0, 229, 255, 0.28);
}

.awk-el-cards-pricing-tier .pt-tier {
  margin: 0;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-cards-pricing-tier .pt-price {
  display: flex;
  align-items: flex-start;
  gap: 0.18rem;
  margin: 0.5rem 0 0;
  line-height: 1;
}

.awk-el-cards-pricing-tier .pt-currency {
  margin-top: 0.55rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-secondary, #c8d3df);
}

.awk-el-cards-pricing-tier .pt-amount {
  font-size: 2.9rem;
  font-weight: 720;
  letter-spacing: -0.04em;
  background: linear-gradient(140deg, var(--text-primary, #E8F0F8) 30%, var(--awk-pt-accent));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.awk-el-cards-pricing-tier .pt-period {
  align-self: flex-end;
  margin-bottom: 0.42rem;
  font-family: var(--font-mono, monospace);
  font-size: 0.68rem;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-cards-pricing-tier .pt-note {
  margin: 0.55rem 0 0;
  font-size: 0.72rem;
  color: var(--text-ghost, #7a8ba3);
}

.awk-el-cards-pricing-tier .pt-rule {
  height: 1px;
  margin: 1rem 0;
  background: linear-gradient(90deg, var(--border-subtle, #2b3f5c), transparent);
}

.awk-el-cards-pricing-tier .pt-list {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.awk-el-cards-pricing-tier .pt-list li {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  font-size: 0.78rem;
  line-height: 1.35;
  color: var(--text-secondary, #c8d3df);
}

.awk-el-cards-pricing-tier .pt-check {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  margin-top: 0.05rem;
  border-radius: 50%;
  background: rgba(0, 229, 255, 0.14);
  background: color-mix(in oklab, var(--awk-pt-accent) 16%, transparent);
  color: var(--awk-pt-accent);
}

.awk-el-cards-pricing-tier .pt-check svg {
  width: 10px;
  height: 10px;
}

.awk-el-cards-pricing-tier .pt-cta {
  width: 100%;
  min-height: 40px;
  margin-top: 1.15rem;
  padding: 0.6rem 1rem;
  border: 1px solid var(--awk-pt-accent);
  border-radius: var(--radius, 8px);
  background: transparent;
  color: var(--awk-pt-accent);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 650;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, transform 0.12s ease;
}

.awk-el-cards-pricing-tier .pt-cta:hover {
  background: rgba(0, 229, 255, 0.1);
  background: color-mix(in oklab, var(--awk-pt-accent) 12%, transparent);
}

.awk-el-cards-pricing-tier .pt-cta:active {
  transform: scale(0.985);
}

.awk-el-cards-pricing-tier .pt-cta[data-selected='true'] {
  background: var(--awk-pt-accent);
  color: var(--bg-deep, #060D1A);
}

.awk-el-cards-pricing-tier .pt-cta:focus-visible {
  outline: 2px solid var(--border-focus, var(--awk-pt-accent));
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-cards-pricing-tier,
  .awk-el-cards-pricing-tier * {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`

export default function PricingTierCard(): JSX.Element {
  const [selected, setSelected] = useState(false)

  return (
    <section className="awk-el-cards-pricing-tier" aria-label="Operator pricing tier">
      <style>{css}</style>
      <span className="pt-flag">Most popular</span>

      <p className="pt-tier">Operator</p>
      <p className="pt-price">
        <span className="pt-currency" aria-hidden="true">$</span>
        <span className="pt-amount">24</span>
        <span className="pt-period">/ mo</span>
      </p>
      <p className="pt-note">Billed yearly at $288. Cancel any time.</p>

      <div className="pt-rule" aria-hidden="true" />

      <ul className="pt-list">
        {FEATURES.map(feature => (
          <li key={feature}>
            <span className="pt-check" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 12.5l4.3 4.3L19 7"
                  stroke="currentColor"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            {feature}
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="pt-cta"
        data-selected={selected}
        aria-pressed={selected}
        onClick={() => setSelected(value => !value)}
      >
        {selected ? 'Selected — Operator' : 'Choose Operator'}
      </button>
    </section>
  )
}
