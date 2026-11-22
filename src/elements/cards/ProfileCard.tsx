import { useState } from 'react'
import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: 'cards-profile-card',
  title: 'Profile Card',
  category: 'cards',
  tags: ['profile', 'avatar', 'follow', 'team'],
}

const css = `
.awk-el-cards-profile-card {
  --awk-pc-accent: var(--accent-primary, #00E5FF);
  --awk-pc-violet: var(--accent-secondary, #7C4DFF);
  position: relative;
  isolation: isolate;
  width: 100%;
  max-width: 320px;
  padding: 1.3rem;
  overflow: hidden;
  border: 1px solid var(--border-subtle, #2b3f5c);
  border-radius: var(--radius-xl, 16px);
  background: var(--bg-surface, #0A1628);
  box-shadow: var(--shadow, 0 4px 24px rgba(0, 0, 0, 0.3));
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--text-primary, #E8F0F8);
}

.awk-el-cards-profile-card *,
.awk-el-cards-profile-card *::before,
.awk-el-cards-profile-card *::after {
  box-sizing: border-box;
}

.awk-el-cards-profile-card::before {
  content: '';
  position: absolute;
  inset: -60% -30% auto auto;
  width: 260px;
  height: 260px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(124, 77, 255, 0.28), transparent 68%);
  background: radial-gradient(circle,
    color-mix(in oklab, var(--awk-pc-violet) 26%, transparent), transparent 68%);
  pointer-events: none;
  z-index: -1;
}

.awk-el-cards-profile-card .p-head {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}

.awk-el-cards-profile-card .p-avatar {
  position: relative;
  flex: 0 0 auto;
  width: 60px;
  height: 60px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--bg-deep, #060D1A);
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--text-primary, #E8F0F8);
}

.awk-el-cards-profile-card .p-avatar::before {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  padding: 2px;
  background: conic-gradient(from 140deg, var(--awk-pc-accent), var(--awk-pc-violet), var(--awk-pc-accent));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
}

.awk-el-cards-profile-card .p-presence {
  position: absolute;
  right: 1px;
  bottom: 1px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--accent-green, #4ade80);
  border: 2px solid var(--bg-surface, #0A1628);
}

.awk-el-cards-profile-card .p-name {
  margin: 0;
  font-size: 1.02rem;
  font-weight: 650;
  letter-spacing: -0.01em;
  line-height: 1.25;
}

.awk-el-cards-profile-card .p-handle {
  margin: 0.15rem 0 0;
  font-family: var(--font-mono, monospace);
  font-size: 0.7rem;
  letter-spacing: 0.02em;
  color: var(--text-muted, #a8b6c8);
}

.awk-el-cards-profile-card .p-bio {
  margin: 0.9rem 0 0;
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--text-secondary, #c8d3df);
}

.awk-el-cards-profile-card .p-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.4rem;
  margin: 1rem 0 0;
  padding: 0.75rem 0 0;
  border-top: 1px solid var(--border-subtle, #2b3f5c);
  list-style: none;
}

.awk-el-cards-profile-card .p-stat {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}

.awk-el-cards-profile-card .p-stat b {
  font-family: var(--font-mono, monospace);
  font-size: 0.92rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.awk-el-cards-profile-card .p-stat span {
  font-size: 0.62rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-ghost, #7a8ba3);
}

.awk-el-cards-profile-card .p-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}

.awk-el-cards-profile-card .p-follow {
  flex: 1;
  min-height: 36px;
  padding: 0.5rem 0.9rem;
  border: 1px solid transparent;
  border-radius: var(--radius, 8px);
  background: var(--awk-pc-accent);
  color: var(--bg-deep, #060D1A);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 650;
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.2s ease, background 0.2s ease, color 0.2s ease;
}

.awk-el-cards-profile-card .p-follow:hover {
  box-shadow: 0 6px 18px rgba(0, 229, 255, 0.25);
  box-shadow: 0 6px 18px color-mix(in oklab, var(--awk-pc-accent) 30%, transparent);
}

.awk-el-cards-profile-card .p-follow:active {
  transform: scale(0.975);
}

.awk-el-cards-profile-card .p-follow[data-following='true'] {
  background: transparent;
  border-color: var(--awk-pc-accent);
  color: var(--awk-pc-accent);
  box-shadow: none;
}

.awk-el-cards-profile-card .p-icon {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border-default, #5d7594);
  border-radius: var(--radius, 8px);
  background: transparent;
  color: var(--text-secondary, #c8d3df);
  cursor: pointer;
  transition: border-color 0.18s ease, color 0.18s ease, background 0.18s ease;
}

.awk-el-cards-profile-card .p-icon:hover {
  border-color: var(--awk-pc-accent);
  color: var(--awk-pc-accent);
  background: rgba(0, 229, 255, 0.08);
  background: color-mix(in oklab, var(--awk-pc-accent) 10%, transparent);
}

.awk-el-cards-profile-card .p-icon svg {
  width: 16px;
  height: 16px;
}

.awk-el-cards-profile-card :is(button, a):focus-visible {
  outline: 2px solid var(--border-focus, var(--awk-pc-accent));
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .awk-el-cards-profile-card *,
  .awk-el-cards-profile-card *::before,
  .awk-el-cards-profile-card *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`

export default function ProfileCard(): JSX.Element {
  const [following, setFollowing] = useState(false)

  return (
    <article className="awk-el-cards-profile-card">
      <style>{css}</style>
      <div className="p-head">
        <div className="p-avatar" aria-hidden="true">
          NV
          <span className="p-presence" />
        </div>
        <div>
          <h3 className="p-name">Nyra Voss</h3>
          <p className="p-handle">@nyra · systems cartographer</p>
        </div>
      </div>

      <p className="p-bio">
        Maps agent fleets for a living. Builds quiet tools that hold up under load.
      </p>

      <ul className="p-stats">
        <li className="p-stat">
          <b>128</b>
          <span>Missions</span>
        </li>
        <li className="p-stat">
          <b>4.9</b>
          <span>Rating</span>
        </li>
        <li className="p-stat">
          <b>37</b>
          <span>Agents</span>
        </li>
      </ul>

      <div className="p-actions">
        <button
          type="button"
          className="p-follow"
          data-following={following}
          aria-pressed={following}
          onClick={() => setFollowing(value => !value)}
        >
          {following ? 'Following' : 'Follow'}
        </button>
        <button type="button" className="p-icon" aria-label="Send Nyra a message">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H9l-4.2 3.2A.6.6 0 0 1 4 19.7V6.5Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </article>
  )
}
