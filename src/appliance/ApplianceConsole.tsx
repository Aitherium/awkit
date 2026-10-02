/**
 * ApplianceConsole -- the shell of the on-box appliance console (and of the tenant
 * product's Appliance panel, which passes the same tabs minus setup).
 *
 *   <ApplianceConsole apiBase="" tabs={tabs} brand="Acme" />
 *
 * 1. Probes GET /api/session.
 * 2. Not signed in -> the code screen. In setup mode the code is on the machine's
 *    screen / serial console; in console mode it is `sudo awnix console code`.
 * 3. Setup mode renders ONLY the 'setup' tab. Console mode renders every tab.
 * 4. Hash routing: #/setup #/overview #/license #/updates #/components #/endpoints
 *    #/surfaces #/guide. The tab list itself is composed by the app (awnix-web
 *    src/tabs.ts, awkit panels/AppliancePanel.tsx), never here.
 *
 * Vite-safe: plain React, no next/*. Colours come from awkit-vars.css tokens only, so
 * light and dark both work; the layout holds at 360 px.
 */
import RenewalBanner from './RenewalBanner'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { createApplianceClient } from './client'
import type { ApplianceClient } from './client'
import type { ApiResult, ApiState, ApplianceTab, Session } from './types'
import './appliance.css'

export interface ApplianceConsoleProps {
  /** '' on the box; the tenant backend's origin when proxied. */
  apiBase: string
  tabs: ApplianceTab[]
  /** Fallback brand when the session does not name one. */
  brand?: string
  /** Injected in tests or by a host that already built one. */
  client?: ApplianceClient
}

// ── shared bits the feature panels reuse ───────────────────────────────────

const STATE_COPY: Record<Exclude<ApiState, 'ok'>, { title: string; tone: string }> = {
  refused: { title: 'Refused', tone: 'warn' },
  unavailable: { title: 'Not available right now', tone: 'muted' },
  'not-entitled': { title: 'Not included in your license', tone: 'warn' },
  locked: { title: 'Locked', tone: 'danger' },
  'not-an-appliance': { title: 'Not running on an appliance', tone: 'muted' },
  error: { title: 'Something went wrong', tone: 'danger' },
}

/** Renders any non-ok ApiResult honestly. Returns null for 'ok'. */
export function StateNotice({
  result,
  onRetry,
  children,
}: {
  result: Pick<ApiResult<unknown>, 'state' | 'detail' | 'status' | 'exit'>
  onRetry?: () => void
  children?: ReactNode
}) {
  if (result.state === 'ok') return null
  const copy = STATE_COPY[result.state]
  return (
    <div className={`awx-notice awx-tone-${copy.tone}`} role="status" data-state={result.state}>
      <strong>{copy.title}</strong>
      {result.detail ? <p className="awx-notice-detail">{result.detail}</p> : null}
      {children}
      {onRetry ? (
        <button type="button" className="awx-btn awx-btn-quiet" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  )
}

export function Badge({ tone = 'muted', children }: { tone?: string; children: ReactNode }) {
  return <span className={`awx-badge awx-tone-${tone}`}>{children}</span>
}

/** Load a resource once and on demand; keeps the last result while reloading. */
export function useApplianceCall<T>(fn: () => Promise<ApiResult<T>>) {
  const [result, setResult] = useState<ApiResult<T> | null>(null)
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const reload = useCallback(async () => {
    setLoading(true)
    const r = await fnRef.current()
    if (alive.current) {
      setResult(r)
      setLoading(false)
    }
    return r
  }, [])
  useEffect(() => {
    alive.current = true
    void reload()
    return () => {
      alive.current = false
    }
  }, [reload])
  return { result, loading, reload }
}

// ── theme ──────────────────────────────────────────────────────────────────

function useSystemTheme() {
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return
    const root = document.documentElement
    if (root.hasAttribute('data-theme') && !root.hasAttribute('data-awx-theme')) return
    const mq = window.matchMedia?.('(prefers-color-scheme: light)')
    const apply = () => {
      root.setAttribute('data-theme', mq?.matches ? 'light' : 'dark')
      root.setAttribute('data-awx-theme', 'system')
    }
    apply()
    mq?.addEventListener?.('change', apply)
    return () => mq?.removeEventListener?.('change', apply)
  }, [])
}

// ── hash routing ───────────────────────────────────────────────────────────

function readHash(): string {
  if (typeof window === 'undefined') return ''
  const m = /^#\/([a-z0-9-]+)/.exec(window.location.hash)
  return m ? m[1] : ''
}

function useHashTab(): [string, (id: string) => void] {
  const [id, setId] = useState(readHash)
  useEffect(() => {
    const on = () => setId(readHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const go = useCallback((next: string) => {
    if (typeof window !== 'undefined') window.location.hash = `#/${next}`
    setId(next)
  }, [])
  return [id, go]
}

// ── login ──────────────────────────────────────────────────────────────────

function LoginScreen({
  client,
  session,
  brand,
  onSignedIn,
}: {
  client: ApplianceClient
  session: Session
  brand: string
  onSignedIn: () => void
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: string; text: string } | null>(null)
  const setup = session.mode === 'setup'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!code.trim()) return
    setBusy(true)
    setMsg(null)
    const r = await client.login(code)
    setBusy(false)
    if (r.state === 'ok') {
      setCode('')
      onSignedIn()
      return
    }
    if (r.state === 'locked') {
      setMsg({
        tone: 'danger',
        text: `Too many wrong codes. Sign-in is locked for ${r.retryAfter ?? 60} seconds.`,
      })
    } else if (r.status === 401) {
      setMsg({ tone: 'warn', text: 'That code is not right. Check it and try again.' })
    } else {
      setMsg({ tone: 'muted', text: r.detail ?? 'The console did not accept the sign-in.' })
    }
  }

  return (
    <div className="awx-login">
      <form className="awx-card awx-login-card" onSubmit={submit} aria-label="Sign in">
        <h1 className="awx-login-title">{brand}</h1>
        <p className="awx-muted">
          {setup
            ? 'Welcome. Enter the setup code shown on this machine’s screen or serial console.'
            : 'Enter the console code. On the machine, run: sudo awnix console code'}
        </p>
        <label className="awx-field">
          <span>{setup ? 'Setup code' : 'Console code'}</span>
          <input
            className="awx-input awx-code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            maxLength={32}
            aria-invalid={msg?.tone === 'warn' || undefined}
            autoFocus
          />
        </label>
        {msg ? (
          <p className={`awx-inline-msg awx-tone-${msg.tone}`} role="alert">
            {msg.text}
          </p>
        ) : null}
        <button type="submit" className="awx-btn awx-btn-primary" disabled={busy || !code.trim()}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

// ── the shell ──────────────────────────────────────────────────────────────

export function ApplianceConsole({ apiBase, tabs, brand, client: injected }: ApplianceConsoleProps) {
  useSystemTheme()
  const [session, setSession] = useState<ApiResult<Session> | null>(null)
  const sessionRef = useRef<() => void>(() => undefined)
  const client = useMemo(
    () =>
      injected ??
      createApplianceClient(apiBase, { onUnauthorized: () => sessionRef.current() }),
    [apiBase, injected],
  )
  const probe = useCallback(async () => {
    setSession(await client.session())
  }, [client])
  sessionRef.current = () => {
    void probe()
  }
  useEffect(() => {
    void probe()
  }, [probe])

  const [hashId, go] = useHashTab()
  const s = session?.data ?? null
  const visible = useMemo(
    () => (s?.mode === 'setup' ? tabs.filter((t) => t.id === 'setup') : tabs),
    [s?.mode, tabs],
  )
  const active = visible.find((t) => t.id === hashId) ?? visible[0]
  const title = s?.brand && s.brand !== 'awnix' ? s.brand : brand ?? s?.brand ?? 'awnix'

  useEffect(() => {
    if (s?.authenticated && active && hashId !== active.id) go(active.id)
  }, [s?.authenticated, active, hashId, go])

  if (!session) {
    return (
      <div className="awx-root">
        <p className="awx-muted awx-pad" aria-busy="true">
          Connecting to the console…
        </p>
      </div>
    )
  }
  if (session.state !== 'ok' || !s) {
    return (
      <div className="awx-root awx-pad">
        <StateNotice result={session} onRetry={() => void probe()} />
      </div>
    )
  }
  if (!s.authenticated) {
    return (
      <div className="awx-root">
        <LoginScreen client={client} session={s} brand={title} onSignedIn={() => void probe()} />
      </div>
    )
  }

  const logout = async () => {
    await client.logout()
    void probe()
  }
  const Active = active?.Component

  return (
    <div className="awx-root">
      <header className="awx-header">
        <div className="awx-brand">
          <span className="awx-brand-name">{title}</span>
          <Badge tone={s.mode === 'setup' ? 'warn' : 'ok'}>
            {s.mode === 'setup' ? 'Setup' : 'Console'}
          </Badge>
        </div>
        <button type="button" className="awx-btn awx-btn-quiet" onClick={() => void logout()}>
          Sign out
        </button>
      </header>
      {visible.length > 1 ? (
        <nav className="awx-tabs" aria-label="Console sections">
          {visible.map((t) => (
            <a
              key={t.id}
              href={`#/${t.id}`}
              className={`awx-tab${t.id === active?.id ? ' awx-tab-active' : ''}`}
              aria-current={t.id === active?.id ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault()
                go(t.id)
              }}
            >
              {t.label}
            </a>
          ))}
        </nav>
      ) : null}
      {s.mode !== 'setup' ? <RenewalBanner client={client} /> : null}
      <main className="awx-main">
        {Active ? (
          <Active client={client} />
        ) : (
          <StateNotice
            result={{
              state: 'unavailable',
              status: 0,
              detail:
                s.mode === 'setup'
                  ? 'This machine is in setup mode, but the setup screen is not part of this build.'
                  : 'No console sections are available in this build.',
            }}
          />
        )}
      </main>
    </div>
  )
}

export default ApplianceConsole
