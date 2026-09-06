/**
 * DashboardPanel — Data-driven business dashboard with stat cards and quick actions.
 *
 * Product portals pass their stat cards and quick actions as props.
 * The dashboard layout, greeting, and styling are shared.
 */

import { type ReactNode } from 'react'

export interface StatCard {
  title: string
  subtitle?: string
  value: string | number
  label: string
  color?: string
  /** Navigation target when clicked */
  onClick?: () => void
}

export interface QuickAction {
  label: string
  description: string
  onClick: () => void
}

export interface DashboardPanelProps {
  /** User's first name for the greeting */
  userName?: string
  /** Subtitle below the greeting */
  subtitle?: string
  /** Stat cards to display in a grid */
  stats: StatCard[]
  /** Quick action buttons */
  quickActions?: QuickAction[]
  /** Extra content below the quick actions */
  children?: ReactNode
}

function getTimeGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

export default function DashboardPanel({
  userName,
  subtitle = "Here's what's happening with your business today.",
  stats,
  quickActions,
  children,
}: DashboardPanelProps) {
  const greeting = userName ? `Good ${getTimeGreeting()}, ${userName}` : `Good ${getTimeGreeting()}`

  return (
    <div style={{ padding: 32, maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 600, marginBottom: 4 }}>{greeting}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{subtitle}</p>
      </div>

      {/* Stats grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 16, marginBottom: 32,
      }}>
        {stats.map((card, i) => (
          <div key={i} onClick={card.onClick}
            style={{
              background: 'var(--bg-base)', border: '1px solid var(--glass-border)',
              borderRadius: 'var(--radius)', padding: 20,
              cursor: card.onClick ? 'pointer' : 'default',
              transition: 'border-color 0.15s ease',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: `${card.color || 'var(--accent-primary)'}15`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.9rem', fontWeight: 700, color: card.color || 'var(--accent-primary)',
              }}>
                {card.title.charAt(0)}
              </div>
              {card.onClick && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>&rarr;</span>
              )}
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: 2 }}>{card.value}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{card.label}</div>
            {card.subtitle && (
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>{card.subtitle}</div>
            )}
          </div>
        ))}
      </div>

      {/* Quick actions */}
      {quickActions && quickActions.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 12, color: 'var(--text-secondary)' }}>
            Quick Actions
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {quickActions.map((action, i) => (
              <button key={i} onClick={action.onClick} style={{
                background: 'var(--bg-surface)', border: '1px solid var(--glass-border)',
                borderRadius: 'var(--radius)', padding: '14px 16px',
                textAlign: 'left', cursor: 'pointer', width: '100%',
              }}>
                <div style={{ fontWeight: 500, fontSize: '0.85rem', marginBottom: 2 }}>{action.label}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{action.description}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {children}
    </div>
  )
}
