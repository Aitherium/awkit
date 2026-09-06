/**
 * RegisterPage — Self-service account creation page.
 *
 * Shows a split layout with feature highlights on the left
 * and the registration form on the right. Products customize
 * via props (features list, app name, brand icon).
 */

import { useState } from 'react'

export interface RegisterPageProps {
  /** Called with (email, password, name) on form submit */
  onRegister: (email: string, password: string, name: string) => Promise<void>
  /** App name displayed in the header */
  appName?: string
  /** Feature bullets displayed on the left panel */
  features?: string[]
  /** Label for the login link */
  loginHref?: string
  /** Called when "sign in" is clicked instead of navigating */
  onLoginClick?: () => void
}

export default function RegisterPage({
  onRegister,
  appName = 'Portal',
  features = [
    'AI-powered chat assistant',
    'Document management & RAG',
    'Team collaboration',
    'Integration marketplace',
  ],
  loginHref = '/login',
  onLoginClick,
}: RegisterPageProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    try {
      await onRegister(email, password, name)
    } catch (err: any) {
      setError(err.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px',
    background: 'var(--bg-surface)', color: 'var(--text-primary)',
    border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)',
    fontSize: '0.9rem',
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-deep)' }}>
      {/* Left: Features */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '48px 64px',
        background: 'linear-gradient(135deg, var(--bg-base), var(--bg-surface))',
        borderRight: '1px solid var(--glass-border)',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: 'var(--accent-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 24, fontSize: '1.2rem', fontWeight: 700, color: 'var(--bg-deep)',
        }}>
          {appName.charAt(0).toUpperCase()}
        </div>
        <h2 style={{ fontSize: '1.8rem', fontWeight: 600, marginBottom: 8 }}>
          Meet {appName}
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', marginBottom: 32, lineHeight: 1.5 }}>
          Your AI-powered business assistant. Get started in minutes.
        </p>
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {features.map((f, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              <span style={{ color: 'var(--accent-primary)' }}>&#10003;</span>
              {f}
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 48, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Powered by <a href="https://portal.aitherium.com" target="_blank" rel="noopener" style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>Aitherium</a>
        </div>
      </div>

      {/* Right: Form */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 600, marginBottom: 4 }}>Create your account</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 28 }}>
            Get started with {appName} in under 2 minutes
          </p>

          {error && (
            <div style={{
              background: 'rgba(220, 60, 60, 0.1)', border: '1px solid rgba(220, 60, 60, 0.3)',
              borderRadius: 'var(--radius)', padding: '10px 14px',
              fontSize: '0.8rem', color: '#e85555', marginBottom: 16,
            }}>{error}</div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 500 }}>Your name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" required style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 500 }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 500 }}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" required style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 500 }}>Confirm password</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat password" required style={inputStyle} />
            </div>
            <button type="submit" disabled={loading} style={{
              width: '100%', padding: '12px', background: 'var(--accent-primary)', color: 'white',
              borderRadius: 'var(--radius)', fontSize: '0.9rem', fontWeight: 500,
              opacity: loading ? 0.6 : 1, marginTop: 8, cursor: 'pointer',
            }}>
              {loading ? 'Creating account...' : 'Get Started'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: 20, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Already have an account?{' '}
            {onLoginClick
              ? <button onClick={onLoginClick} style={{ background: 'none', color: 'var(--accent-primary)', fontWeight: 500, cursor: 'pointer' }}>Sign in</button>
              : <a href={loginHref} style={{ color: 'var(--accent-primary)', fontWeight: 500, textDecoration: 'none' }}>Sign in</a>
            }
          </p>
        </div>
      </div>
    </div>
  )
}
