import { useEffect, useState } from 'react'
import type { AuthState } from '../hooks/useAuth'
import { useConfig } from '../hooks/useConfig'

interface LoginPageProps {
  auth: AuthState
  appName?: string
  onRegisterClick?: () => void
  /**
   * Identity provider to NAME in the sign-in affordances.
   *
   * Only used when this app is not tenant-branded. A tenant portal drops the
   * mention entirely rather than substituting its own name into it -- see the
   * note on `whiteLabel` below.
   */
  platformName?: string
  /**
   * Force the "Powered by" footer on or off. Defaults to showing it only on
   * UNBRANDED (platform) surfaces.
   */
  showPoweredBy?: boolean
}

/**
 * The tenant-app login card.
 *
 * For a pure-OIDC app (the common case: a tenant app whose only way to
 * authenticate is AitherIdentity) this card is deliberately a STRAIGHT-THROUGH
 * redirect, not a "manually rolled login". Before this change it rendered its
 * own card that then redirected, so a tenant-portal customer saw TWO
 * unrelated sign-in screens back to back — and the second one (AitherIdentity's
 * own page) did not look like the portal. The IdP now renders the portal's page
 * (`awkit/auth`), so the two screens have collapsed into one:
 * this card forwards straight there.
 *
 * LDAP stays a real form here because it is a genuine tenant-LOCAL method with
 * no IdP hop — rendering it inline is not a duplication, it IS the method.
 */
export default function LoginPage({
  auth,
  appName = 'Knowledge Brain',
  onRegisterClick,
  platformName = 'Aitherium',
  showPoweredBy,
}: LoginPageProps) {
  const initial = appName.charAt(0).toUpperCase()
  // A configured company_name IS the tenant-branded signal. DEFAULT_CONFIG
  // leaves it '', so the platform's own surfaces keep every string byte-identical
  // to what they rendered before this change.
  const cfg = useConfig()
  const whiteLabel = Boolean(cfg.company_name)
  const poweredBy = showPoweredBy ?? !whiteLabel
  const methods = auth.authMethods || []
  const hasLdap = methods.includes('ldap')
  const hasOidc = methods.includes('oidc')
  const hasLocal = methods.includes('local')
  const hasCredential = methods.includes('credential')

  const [ldapUser, setLdapUser] = useState('')
  const [ldapPass, setLdapPass] = useState('')
  const [ldapError, setLdapError] = useState('')
  const [ldapLoading, setLdapLoading] = useState(false)

  // ── OIDC-only collapse ────────────────────────────────────────────────────
  // No tenant-local methods to offer — go straight to the (now portal-styled)
  // IdP page. Auto-redirect after a beat so the app can paint first; the manual
  // "Continue" button is the fallback so a blocked/slow redirect never strands
  // a user on a card that looks like it did nothing.
  const oidcOnly = hasOidc && !hasLdap && !hasLocal && !hasCredential
  const [redirecting, setRedirecting] = useState(oidcOnly)

  useEffect(() => {
    if (!oidcOnly || !redirecting) return
    const t = setTimeout(() => {
      try { auth.login() } catch { /* stay on the button */ }
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oidcOnly, redirecting])

  if (oidcOnly) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flex: 1, width: '100%', minHeight: '100vh',
        padding: 'clamp(1rem, 4vw, 2rem)', background: 'var(--bg-deep)',
      }}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem',
          padding: 'clamp(1.5rem, 6vw, 3rem)', background: 'var(--bg-surface)',
          border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-lg)',
          width: '100%', maxWidth: 420, textAlign: 'center',
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%', background: 'var(--accent-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 1rem', fontSize: '1.8rem', fontWeight: 700, color: 'var(--bg-deep)',
          }}>{initial}</div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>{appName}</h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            {redirecting
              ? (whiteLabel
                  ? 'Taking you to sign-in…'
                  : `Connecting you to ${platformName} sign-in…`)
              : 'Sign in to continue to ' + appName + '.'}
          </p>
          <button
            type="button"
            onClick={() => { setRedirecting(false); auth.login() }}
            style={{
              width: '100%', padding: '0.85rem 1.5rem', background: 'var(--accent-primary)',
              color: 'var(--bg-deep)', borderRadius: 'var(--radius)', fontSize: '0.9rem',
              fontWeight: 600, cursor: 'pointer', border: 'none',
            }}
          >
            {whiteLabel ? 'Continue' : `Continue with ${platformName}`}
          </button>
          {onRegisterClick && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
              Don&apos;t have an account?{' '}
              <button type="button" onClick={onRegisterClick} style={{
                color: 'var(--accent-primary)', fontWeight: 500, background: 'none',
                border: 'none', padding: 0, cursor: 'pointer', font: 'inherit',
              }}>Create one now</button>
            </p>
          )}
          {poweredBy && (
            <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', opacity: 0.7 }}>
              Powered by {platformName}
            </p>
          )}
        </div>
      </div>
    )
  }

  const handleLdapLogin = async () => {
    if (!ldapUser || !ldapPass) return
    setLdapError('')
    setLdapLoading(true)
    try {
      await auth.ldapLogin(ldapUser, ldapPass)
    } catch (e: any) {
      setLdapError(e.message || 'Login failed')
    } finally {
      setLdapLoading(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '0.7rem 0.85rem',
    background: 'var(--bg-elevated)', color: 'var(--text-primary)',
    border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)',
    fontSize: '0.85rem', outline: 'none',
  }

  return (
    // `flex: 1` / `width: 100%` are LOAD-BEARING, not decoration. awkit-base.css
    // sets `#root { display: flex }`, which makes this wrapper a row-direction flex
    // ITEM — and a flex item sizes to its CONTENT, not its parent. Without a width it
    // collapses to the card's own width, so `justifyContent: center` centers the card
    // inside a box exactly as wide as the card and the whole login hugs the left edge.
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flex: 1, width: '100%', minHeight: '100vh',
      padding: 'clamp(1rem, 4vw, 2rem)', background: 'var(--bg-deep)',
    }}>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem',
        padding: 'clamp(1.5rem, 6vw, 3rem)', background: 'var(--bg-surface)',
        border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-lg)',
        width: '100%', maxWidth: 420,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%', background: 'var(--accent-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 1rem', fontSize: '1.8rem', fontWeight: 700, color: 'var(--bg-deep)',
          }}>{initial}</div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>{appName}</h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            Your AI knowledge assistant
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%' }}>
          {/* LDAP / Active Directory login form */}
          {hasLdap && (
            <>
              <input
                type="text" placeholder="Username (AD account)"
                value={ldapUser} onChange={e => setLdapUser(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLdapLogin()}
                style={inputStyle} autoFocus
              />
              <input
                type="password" placeholder="Password"
                value={ldapPass} onChange={e => setLdapPass(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLdapLogin()}
                style={inputStyle}
              />
              {ldapError && (
                <p style={{ fontSize: '0.8rem', color: '#ef4444', margin: 0 }}>{ldapError}</p>
              )}
              <button onClick={handleLdapLogin} disabled={ldapLoading || !ldapUser || !ldapPass} style={{
                width: '100%', padding: '0.85rem 1.5rem', background: 'var(--accent-primary)',
                color: 'var(--bg-deep)', borderRadius: 'var(--radius)', fontSize: '0.9rem',
                fontWeight: 600, opacity: ldapLoading ? 0.6 : 1, cursor: ldapLoading ? 'wait' : 'pointer',
              }}>
                {ldapLoading ? 'Signing in...' : 'Sign in with Active Directory'}
              </button>
              {hasOidc && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  margin: '0.25rem 0', color: 'var(--text-muted)', fontSize: '0.75rem',
                }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--glass-border)' }} />
                  <span>or</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--glass-border)' }} />
                </div>
              )}
            </>
          )}

          {/* OIDC login */}
          {hasOidc && (
            <button onClick={auth.login} style={{
              width: '100%', padding: '0.85rem 1.5rem',
              background: hasLdap ? 'var(--bg-elevated)' : 'var(--accent-primary)',
              color: hasLdap ? 'var(--text-primary)' : 'var(--bg-deep)',
              borderRadius: 'var(--radius)', fontSize: '0.9rem',
              fontWeight: hasLdap ? 500 : 600,
              border: hasLdap ? '1px solid var(--glass-border)' : 'none',
            }}>
              {whiteLabel ? 'Sign in' : `Sign in with ${platformName}`}
            </button>
          )}

          {/* Dev login (local/standalone only) */}
          {hasLocal && (
            <button onClick={auth.devLogin} style={{
              width: '100%', padding: '0.85rem 1.5rem', background: 'var(--bg-elevated)',
              color: 'var(--text-primary)', borderRadius: 'var(--radius)', fontSize: '0.9rem',
              fontWeight: 500, border: '1px solid var(--glass-border)',
            }}>
              Continue as Developer
            </button>
          )}
        </div>

        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
          Don&apos;t have an account?{' '}
          {onRegisterClick ? (
            <button type="button" onClick={onRegisterClick} style={{
              color: 'var(--accent-primary)', fontWeight: 500, background: 'none',
              border: 'none', padding: 0, cursor: 'pointer', font: 'inherit',
            }}>Create one now</button>
          ) : (
            <a href="https://portal.aitherium.com/register" target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--accent-primary)', fontWeight: 500, textDecoration: 'none' }}>
              {whiteLabel ? 'Create an account' : `Sign up on ${platformName}`}
            </a>
          )}
        </p>
        {poweredBy && (
          <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', opacity: 0.7 }}>
            Powered by {platformName}
          </p>
        )}
      </div>
    </div>
  )
}
