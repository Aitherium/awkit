export interface QuickAction {
  label: string
  prompt: string
}

export interface QuickActionsPanelProps {
  onAction: (text: string) => void
  actions?: QuickAction[]
}

export default function QuickActionsPanel({ onAction, actions = [] }: QuickActionsPanelProps) {
  if (actions.length === 0) return null

  return (
    <div style={{ padding: '0.75rem' }}>
      <h3 style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
        Quick Actions
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        {actions.map(a => (
          <button
            key={a.label}
            onClick={() => onAction(a.prompt)}
            style={{
              padding: '0.4rem 0.6rem',
              background: 'var(--bg-surface)',
              color: 'var(--text-secondary)',
              borderRadius: 6,
              fontSize: '0.75rem',
              textAlign: 'left',
              border: '1px solid var(--glass-border)',
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}
