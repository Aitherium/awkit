'use client'

export default function StorefrontShellPanel() {
  return (
    <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
      <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>
        Storefront
      </h2>
      <p style={{ fontSize: '0.85rem', marginBottom: 16 }}>
        The storefront is available at the main site.
      </p>
      <a href="/" target="_blank" rel="noopener" style={{
        display: 'inline-block', padding: '10px 20px', borderRadius: 8,
        background: 'var(--accent-primary)', color: 'var(--bg-deep)',
        textDecoration: 'none', fontSize: '0.85rem', fontWeight: 600,
      }}>
        Open Storefront
      </a>
    </div>
  )
}
