import { useState, useEffect, useCallback } from 'react'
import { getApiBase } from '../lib/apiBase'

export interface UserInfo {
  user_id: string
  tenant_id: string
  role: string
  display_name: string
  email?: string
  name?: string
  avatar_url?: string
  onboarding_complete?: boolean
  integrations?: Record<string, boolean>
  [key: string]: unknown
}

export interface AuthState {
  authenticated: boolean
  user: UserInfo | null
  loading: boolean
  /**
   * True when a backend actually answered `/api/auth/me` — including a 401/404.
   * Only a NETWORK failure (or no configured API base on a static host) sets it
   * false, which is the signal for standalone/offline mode: Bonsai runs
   * in-browser and no login is possible, so the app must not show a login loop.
   */
  backendReachable: boolean
  /**
   * True when the backend's BRAIN can answer — not merely that the process is
   * alive. `backendReachable` only ever meant "a socket answered", so the one
   * state it cannot describe is a healthy server whose LLM/platform is refused.
   * That state is common (the tenant's node restarting, a platform outage) and
   * it is precisely when the in-browser model should take over, so it needs its
   * own signal rather than being folded into reachability.
   *
   * Optimistic until proven otherwise: a backend with no `brain_reachable` key
   * (an older deployment) reads as true, because falsely downgrading a working
   * tenant to a weaker local model is the worse error.
   */
  brainReachable: boolean
  /** Available auth methods (fetched from /api/auth/config) */
  authMethods: string[]
  /** Redirect to login (OAuth / SSO flow) */
  login: () => void
  /** Dev/test login — creates a dev session */
  devLogin: () => Promise<void>
  /** Username + password login */
  credentialLogin: (email: string, password: string) => Promise<void>
  /** LDAP / Active Directory login */
  ldapLogin: (username: string, password: string) => Promise<void>
  /** Self-service registration */
  register: (email: string, password: string, name: string, agentPackId?: string) => Promise<void>
  /** Demo mode login */
  demoLogin: () => Promise<void>
  /** Sign out */
  logout: () => Promise<void>
  /** Refresh user data from the server */
  refreshUser: () => Promise<void>
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<UserInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [backendReachable, setBackendReachable] = useState(true)
  const [brainReachable, setBrainReachable] = useState(true)
  const [authMethods, setAuthMethods] = useState<string[]>(['oidc'])

  /**
   * Poll the brain signal. Separate from `refreshUser` because it must keep
   * running for a SIGNED-IN user: a brain that dies mid-session is the whole
   * reason this exists, and an auth-time-only probe would miss it entirely.
   */
  const refreshBrain = useCallback(async () => {
    try {
      const base = getApiBase()
      const res = await fetch(
        `${base}/api/health`,
        base ? { credentials: 'include' } : undefined,
      )
      if (!res.ok) {
        // A backend answering non-200 on its own health route cannot vouch for
        // its brain. Treat it as down so the local model takes over.
        setBrainReachable(false)
        return
      }
      const data = await res.json()
      setBrainReachable(data?.brain_reachable !== false)
    } catch {
      // Network failure — `backendReachable` already covers this and drives the
      // full standalone shell, so do not also flip the brain flag here.
    }
  }, [])

  const refreshUser = useCallback(async () => {
    try {
      // Prefix the probe with the configured API base ('' on same-origin) so
      // this stays correct even if the identity-fetch wrapper is not installed.
      const base = getApiBase()
      const res = await fetch(`${base}/api/auth/me`, base ? { credentials: 'include' } : undefined)
      // Any HTTP response — including 401/404 — means a backend answered, so a
      // login is possible. Only a network failure means there is no backend at
      // all (static-host standalone / the tenant's node is offline).
      setBackendReachable(true)
      if (res.ok) {
        const data = await res.json()
        if (data.authenticated !== false) setUser(data)
        else setUser(null)
      } else {
        setUser(null)
      }
    } catch {
      setBackendReachable(false)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    refreshUser().then(() => { if (cancelled) { /* already set */ } })
    refreshBrain()
    // Fetch available auth methods (ldap, oidc, local)
    const base = getApiBase()
    fetch(base ? `${base}/api/auth/config` : '/api/auth/config').then(r => r.ok ? r.json() : null).then(data => {
      if (!cancelled && data?.methods) setAuthMethods(data.methods)
    }).catch(() => {})
    // Keep watching: the brain can die (or recover) long after sign-in, and a
    // one-shot probe would strand the user on whichever state they loaded in.
    const timer = setInterval(() => { if (!cancelled) refreshBrain() }, 30_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [refreshUser, refreshBrain])

  const login = useCallback(() => {
    // Static-hosted build: the login redirect must reach the configured
    // absolute backend origin. `window.location.href` is a browser NAVIGATION,
    // invisible to the fetch-rewrite wrapper, so it must be base-aware here.
    const base = getApiBase()
    window.location.href = base ? `${base}/api/auth/login` : '/api/auth/login'
  }, [])

  const devLogin = useCallback(async () => {
    try {
      const base = getApiBase()
      const res = await fetch(base ? `${base}/api/auth/dev-login` : '/api/auth/dev-login', { method: 'POST', ...(base ? { credentials: 'include' as const } : {}) })
      if (res.ok) {
        await refreshUser()
      }
    } catch { /* stay unauthenticated */ }
  }, [refreshUser])

  const credentialLogin = useCallback(async (email: string, password: string) => {
    const base = getApiBase()
    const res = await fetch(base ? `${base}/api/auth/login` : '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      ...(base ? { credentials: 'include' as const } : {}),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Login failed')
    }
    await refreshUser()
  }, [refreshUser])

  const register = useCallback(async (email: string, password: string, name: string, agentPackId?: string) => {
    const body: Record<string, unknown> = { email, password, name }
    if (agentPackId) {
      body.agent_pack_id = agentPackId
    }
    const base = getApiBase()
    const res = await fetch(base ? `${base}/api/auth/register` : '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(base ? { credentials: 'include' as const } : {}),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Registration failed')
    }
    await refreshUser()
  }, [refreshUser])

  const demoLogin = useCallback(async () => {
    const base = getApiBase()
    const res = await fetch(base ? `${base}/api/auth/demo-login` : '/api/auth/demo-login', { method: 'POST', ...(base ? { credentials: 'include' as const } : {}) })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Demo login failed')
    }
    await refreshUser()
  }, [refreshUser])

  const logout = useCallback(async () => {
    try {
      const base = getApiBase()
      await fetch(base ? `${base}/api/auth/logout` : '/api/auth/logout', { method: 'POST', ...(base ? { credentials: 'include' as const } : {}) })
    }
    finally { setUser(null) }
  }, [])

  const ldapLogin = useCallback(async (username: string, password: string) => {
    const base = getApiBase()
    const res = await fetch(base ? `${base}/api/auth/ldap/login` : '/api/auth/ldap/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      ...(base ? { credentials: 'include' as const } : {}),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'LDAP login failed')
    }
    await refreshUser()
  }, [refreshUser])

  return {
    authenticated: user !== null,
    user, loading, backendReachable, brainReachable, authMethods, login, devLogin,
    credentialLogin, ldapLogin, register, demoLogin,
    logout, refreshUser,
  }
}
