/**
 * A subtle banner shown when the current user is in demo mode.
 * Product portals can customize the message and description.
 */

interface DemoBannerProps {
  /** Short label, e.g. "Portfolio Demo" */
  label?: string
  /** Description of what the demo shows */
  description?: string
}

export default function DemoBanner({
  label = 'Demo Mode',
  description = 'This workspace is running with sample data.',
}: DemoBannerProps) {
  return (
    <div style={{
      background: 'linear-gradient(90deg, rgba(168, 85, 247, 0.12), rgba(236, 72, 153, 0.08))',
      borderBottom: '1px solid rgba(168, 85, 247, 0.2)',
      padding: '8px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: '0.75rem',
      color: 'var(--text-secondary)',
    }}>
      <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{label}</span>
      <span>&mdash; {description}</span>
    </div>
  )
}
