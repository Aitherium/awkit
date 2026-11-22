'use client'

/**
 * Enroll this computer in ONE step, with a checklist that shows it worked.
 *
 * Enrollment used to be a page a person had to go and find, which handed them six
 * separate commands; a customer admin's own PC was never enrolled. This card is
 * the same enrollment as one command: the host's `POST /devices/enroll` returns
 * a `one_liner` per OS, the person pastes it, and the setup script it downloads
 * reports each of its five steps back to the host. The card polls the person's
 * devices every 3 seconds and ticks the steps off; when the machine checks in it
 * says "Connected".
 *
 * Two places render it:
 *   mode="prompt"  at sign-in (the company room mounts it when the host opted in
 *                  to self-service hardware). It shows only when the host says to
 *                  ask (`GET /devices/onboarding` -> `prompt: true`) or an
 *                  enrollment is already in progress, and offers "Not now".
 *   mode="panel"   inside My Hardware, as the way to enroll. Always offered there.
 *
 * The host decides everything about WHO: the card sends no user or tenant, only
 * the OS and a default name. A host without the onboarding route (an older
 * backend) makes the card render its `children` as they are and nothing else, so
 * the manual steps a host passes in are never lost.
 *
 * No command is minted until the person presses the button: a card that is
 * merely shown must not leave an "enrolling" row behind for everyone who signs in.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

export type SetupOS = 'windows' | 'macos' | 'linux'
export type SetupStepState = 'pending' | 'running' | 'ok' | 'failed'

/** The setup script's latest step report, as the host stores it. */
export interface SetupProgress {
  step: number
  state: string
  detail?: string
  steps?: number
}

export interface SetupDevice {
  id: string
  name: string
  status: string
  node_id?: string
  os?: string
  progress?: SetupProgress | null
}

interface Onboarding {
  prompt: boolean
  reason: string
  device: SetupDevice | null
}

interface SetupCommand {
  deviceId: string
  oneLiner: Partial<Record<SetupOS, string>>
  expiresAt?: string
  /** The same enrollment as separate commands. Carries the device secret, so it
   *  is kept in memory only and never cached. */
  manual?: Partial<Record<SetupOS, string>>
}

export interface DeviceSetupCardProps {
  apiBase?: string
  /** The host product's name in the copy ("Connect this computer to <name>"). */
  productName?: string
  mode?: 'prompt' | 'panel'
  /** How often the checklist re-reads the person's devices. */
  pollMs?: number
  style?: CSSProperties
  /** The host's own manual enrollment UI. Shown behind "Show the individual
   *  steps", or as it is when the host has no one-step setup. */
  children?: ReactNode
}

/** The five things the setup script does, in the order it reports them. */
export const SETUP_STEPS = [
  'Install the tools',
  'Sign in',
  'Download your company setup',
  'Start the assistant',
  'Connect',
] as const

const OS_LABEL: Record<SetupOS, string> = { windows: 'Windows', macos: 'Mac', linux: 'Linux' }
const DEFAULT_NAME: Record<SetupOS, string> = {
  windows: 'My Windows PC', macos: 'My Mac', linux: 'My Linux PC',
}
const WHERE_TO_PASTE: Record<SetupOS, string> = {
  windows: 'Open Windows PowerShell (press the Start button and type PowerShell), paste the command, and press Enter.',
  macos: 'Open Terminal (press Command and Space, type Terminal), paste the command, and press Return.',
  linux: 'Open a terminal, paste the command, and press Enter.',
}

const CACHE_KEY = 'aw.deviceSetup.v1'

/** The OS picker's default: the browser's platform (Windows when it cannot tell). */
export function detectSetupOS(
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): SetupOS {
  const ua = userAgent.toLowerCase()
  if (ua.includes('windows')) return 'windows'
  if (ua.includes('mac')) return 'macos'
  if (ua.includes('linux') || ua.includes('x11')) return 'linux'
  return 'windows'
}

/** Has the machine checked in? Its heartbeat landed, or the last step reported ok. */
export function isConnected(device: SetupDevice | null): boolean {
  if (!device) return false
  if (device.status === 'online') return true
  const p = device.progress
  return Boolean(p && p.step >= SETUP_STEPS.length && p.state === 'ok')
}

/** Each step's state from the one report the host keeps: everything before the
 *  reported step is done, the reported step is what it says, the rest wait. */
export function stepStates(device: SetupDevice | null): SetupStepState[] {
  if (isConnected(device)) return SETUP_STEPS.map(() => 'ok')
  const p = device?.progress
  return SETUP_STEPS.map((_, i) => {
    const n = i + 1
    if (!p || n > p.step) return 'pending'
    if (n < p.step) return 'ok'
    return p.state === 'ok' || p.state === 'failed' || p.state === 'running' ? p.state : 'pending'
  })
}

function readCache(deviceId: string | undefined): SetupCommand | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as SetupCommand
    if (!c || typeof c.deviceId !== 'string' || !c.oneLiner) return null
    if (deviceId !== undefined && c.deviceId !== deviceId) return null
    return { deviceId: c.deviceId, oneLiner: c.oneLiner, expiresAt: c.expiresAt }
  } catch {
    return null
  }
}

function writeCache(c: SetupCommand | null): void {
  try {
    if (!c) window.sessionStorage.removeItem(CACHE_KEY)
    else {
      window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(
        { deviceId: c.deviceId, oneLiner: c.oneLiner, expiresAt: c.expiresAt }))
    }
  } catch {
    /* storage unavailable (private mode): the command simply is not remembered */
  }
}

const card: CSSProperties = {
  padding: '0.9rem 1rem',
  border: '1px solid var(--accent-primary)',
  borderRadius: 'var(--radius, 8px)',
  marginBottom: '0.6rem',
  fontSize: '0.82rem',
  color: 'var(--text-primary)',
  background: 'var(--bg-surface, var(--bg-elevated))',
  boxSizing: 'border-box',
  width: '100%',
}

const primaryBtn: CSSProperties = {
  padding: '0.6rem 1rem',
  background: 'var(--accent-primary)',
  color: 'var(--bg-deep)',
  borderRadius: 'var(--radius, 8px)',
  fontSize: '0.82rem',
  fontWeight: 600,
  border: 'none',
  cursor: 'pointer',
}

const quietBtn: CSSProperties = {
  padding: '0.45rem 0.8rem',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  borderRadius: 'var(--radius, 8px)',
  fontSize: '0.78rem',
  border: '1px solid var(--glass-border)',
  cursor: 'pointer',
}

// A command must WRAP, never clip: this card also renders in a narrow rail.
const commandBox: CSSProperties = {
  display: 'block',
  fontSize: '0.78rem',
  padding: '0.5rem 0.6rem',
  margin: '0.6rem 0 0',
  background: 'var(--bg-elevated)',
  borderRadius: 'var(--radius, 8px)',
  border: '1px solid var(--glass-border)',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
}

const STATE_WORD: Record<SetupStepState, string> = {
  pending: '', running: 'Working', ok: 'Done', failed: 'Stopped',
}

function stateColor(state: SetupStepState): string {
  switch (state) {
    case 'ok': return 'var(--accent-green, #34d399)'
    case 'failed': return 'var(--accent-coral, #f87171)'
    case 'running': return 'var(--accent-primary)'
    default: return 'var(--text-muted)'
  }
}

export default function DeviceSetupCard({
  apiBase = '/api',
  productName = 'your assistant',
  mode = 'prompt',
  pollMs = 3000,
  style,
  children,
}: DeviceSetupCardProps) {
  // null = not asked yet; false = the host has no one-step setup.
  const [onboarding, setOnboarding] = useState<Onboarding | null | false>(null)
  const [device, setDevice] = useState<SetupDevice | null>(null)
  const [command, setCommand] = useState<SetupCommand | null>(null)
  const [os, setOs] = useState<SetupOS>(() => detectSetupOS())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [started, setStarted] = useState(false)
  // Re-rendered by the poll, so "expired" turns true on its own.
  const [now, setNow] = useState(() => Date.now())
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Should the card show, and is something already in progress? ──────────
  useEffect(() => {
    let cancelled = false
    fetch(`${apiBase}/devices/onboarding`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((ob: Onboarding) => {
        if (cancelled) return
        if (!ob || typeof ob.prompt !== 'boolean') { setOnboarding(false); return }
        setOnboarding(ob)
        if (ob.device) {
          setDevice(ob.device)
          setCommand(readCache(ob.device.id))
        }
      })
      .catch(() => { if (!cancelled) setOnboarding(false) })
    return () => { cancelled = true }
  }, [apiBase])

  const connected = isConnected(device)
  const deviceId = device?.id

  // ── The live checklist: re-read the person's devices while one is tracked ─
  useEffect(() => {
    if (!deviceId || connected || hidden) return
    let cancelled = false
    const tick = () => {
      setNow(Date.now())
      fetch(`${apiBase}/devices`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d) => {
          if (cancelled) return
          const list: SetupDevice[] = Array.isArray(d) ? d : d?.devices ?? []
          const found = list.find((x) => x.id === deviceId)
          if (found) setDevice(found)
        })
        .catch(() => undefined) // a missed poll is not an error; the next one corrects it
    }
    const timer = setInterval(tick, pollMs)
    return () => { cancelled = true; clearInterval(timer) }
  }, [apiBase, deviceId, connected, hidden, pollMs])

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  const copy = useCallback((text: string) => {
    const done = () => {
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1600)
    }
    try {
      const p = navigator.clipboard?.writeText(text)
      if (p) p.then(done).catch(() => undefined)
    } catch {
      /* no clipboard here: the command is on screen to select by hand */
    }
  }, [])

  // ── Get the one command (and copy it). `resume` re-issues the person's own
  //    unfinished enrollment instead of adding a row each time. ─────────────
  const getCommand = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${apiBase}/devices/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: DEFAULT_NAME[os], os, resume: true }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data?.device?.id) throw new Error('no device')
      const next: SetupCommand = {
        deviceId: data.device.id,
        oneLiner: data.one_liner ?? {},
        expiresAt: data.setup_expires_at,
        manual: data.commands,
      }
      setDevice({ ...data.device, progress: null })
      setCommand(next)
      setStarted(true)
      setNow(Date.now())
      writeCache(next)
      const line = next.oneLiner[os]
      if (line) copy(line)
      else setError('This server could not make a one-step command. Use the individual steps below.')
    } catch {
      setError('The setup command could not be made just now. Check your connection and press the button again.')
    } finally {
      setBusy(false)
    }
  }, [apiBase, os, copy])

  const dismiss = useCallback(() => {
    setHidden(true)
    fetch(`${apiBase}/devices/onboarding/dismiss`, { method: 'POST', credentials: 'include' })
      .catch(() => undefined)
    // A command that was made here and never run would sit in My Hardware as
    // "enrolling" for ever: take it back.
    if (started && device?.id && !device.progress) {
      fetch(`${apiBase}/devices/${device.id}`, { method: 'DELETE', credentials: 'include' })
        .catch(() => undefined)
      writeCache(null)
    }
  }, [apiBase, started, device])

  if (onboarding === null) return null
  if (onboarding === false) return children ? <>{children}</> : null
  if (hidden) return null
  if (mode === 'prompt' && !(onboarding.prompt || onboarding.reason === 'enrolling' || started)) {
    return null
  }

  const states = stepStates(device)
  const progress = device?.progress ?? null
  const failedAt = states.indexOf('failed')
  const running = !connected && progress?.state === 'running'
  const line = command?.oneLiner[os] ?? ''
  const expired = Boolean(command?.expiresAt) && now > Date.parse(command!.expiresAt!)
  const shell = os === 'windows' ? 'Windows PowerShell' : 'a terminal'

  let buttonLabel = 'Copy the setup command'
  if (busy) buttonLabel = 'Getting your command'
  else if (!command || expired) buttonLabel = command ? 'Get a new command' : 'Copy the setup command'
  else if (copied) buttonLabel = 'Copied'
  // A script that is running holds the command's secret: a new command would cut
  // it off, so while one runs the button only ever copies, and starting over is a
  // separate, deliberate button.
  const canCopy = Boolean(command) && !expired
  const showPrimary = !connected && (running ? canCopy : true)
  const offerRestart = !connected && running && !canCopy

  return (
    <div data-testid="device-setup-card" data-mode={mode} role="region"
      aria-label="Set up this computer" style={{ ...card, ...style }}>
      {connected ? (
        <>
          <div data-testid="setup-connected" role="status"
            style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--accent-green, #34d399)' }}>
            Connected
          </div>
          <p style={{ margin: '0.3rem 0 0.6rem', color: 'var(--text-secondary)' }}>
            {device?.name || 'This computer'} is enrolled. {productName} can now run on it.
          </p>
        </>
      ) : (
        <>
          <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Set up this computer</div>
          <p data-testid="setup-explain" style={{ margin: '0.3rem 0 0.7rem', color: 'var(--text-secondary)' }}>
            Connect this computer to {productName}: copy one command, paste it into {shell},
            and the five steps below tick off as it works.
          </p>
          <div role="radiogroup" aria-label="This computer runs"
            style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
            {(Object.keys(OS_LABEL) as SetupOS[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={os === k}
                data-testid={`setup-os-${k}`}
                onClick={() => { setOs(k); setCopied(false) }}
                style={{ ...quietBtn, ...(os === k
                  ? { border: '1px solid var(--accent-primary)', fontWeight: 700 } : {}) }}>
                {OS_LABEL[k]}
              </button>
            ))}
          </div>
          {showPrimary && (
            <button type="button" data-testid="setup-copy" style={primaryBtn} disabled={busy}
              onClick={() => { if (!command || expired) void getCommand(); else if (line) copy(line) }}>
              {buttonLabel}
            </button>
          )}
          {!showPrimary && (
            <p data-testid="setup-running-note" style={{ margin: 0, color: 'var(--text-secondary)' }}>
              Setup is running on your computer. The steps below follow it.
            </p>
          )}
          {line && !expired && (
            <>
              <code data-testid="setup-command" style={commandBox}>{line}</code>
              <p style={{ margin: '0.4rem 0 0', color: 'var(--text-secondary)' }}>{WHERE_TO_PASTE[os]}</p>
            </>
          )}
          {command && expired && !running && (
            <p data-testid="setup-expired" style={{ margin: '0.5rem 0 0', color: 'var(--accent-coral, #f87171)' }}>
              That command has expired. Press the button for a new one.
            </p>
          )}
          {error && (
            <p data-testid="setup-error" role="alert" style={{ margin: '0.5rem 0 0', color: 'var(--accent-coral, #f87171)' }}>
              {error}
            </p>
          )}
        </>
      )}

      <ol data-testid="setup-steps" style={{ listStyle: 'none', margin: '0.8rem 0 0', padding: 0 }}>
        {SETUP_STEPS.map((label, i) => {
          const state = states[i]
          const detail = progress && progress.step === i + 1 ? (progress.detail || '') : ''
          return (
            <li key={label} data-testid="setup-step" data-state={state}
              style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', padding: '0.2rem 0' }}>
              <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                alignSelf: 'center', background: state === 'pending' ? 'transparent' : stateColor(state),
                border: `1px solid ${stateColor(state)}` }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ color: state === 'pending' ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                  {i + 1}. {label}
                </span>
                {state === 'running' && detail && (
                  <span data-testid="setup-step-detail"
                    style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {detail}
                  </span>
                )}
              </span>
              {STATE_WORD[state] && (
                <span style={{ fontSize: '0.72rem', color: stateColor(state), flexShrink: 0 }}>
                  {STATE_WORD[state]}
                </span>
              )}
            </li>
          )
        })}
      </ol>

      {!connected && failedAt >= 0 && (
        <div data-testid="setup-failed" role="alert"
          style={{ marginTop: '0.6rem', padding: '0.5rem 0.6rem', borderRadius: 'var(--radius, 8px)',
            border: '1px solid var(--accent-coral, #f87171)' }}>
          <div style={{ fontWeight: 600 }}>
            Step {failedAt + 1} stopped: {SETUP_STEPS[failedAt]}
          </div>
          <div data-testid="setup-failed-detail" style={{ marginTop: '0.25rem' }}>
            {progress?.detail || 'The setup stopped at this step and did not say why.'}
          </div>
          <div data-testid="setup-failed-next" style={{ marginTop: '0.25rem', color: 'var(--text-secondary)' }}>
            {!command || expired
              ? 'Next: press the button above for a new command, then paste it.'
              : 'Next: once that is sorted, paste the same command again.'}
          </div>
        </div>
      )}

      {!connected && (
        <details data-testid="setup-manual" style={{ marginTop: '0.7rem' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>
            Show the individual steps
          </summary>
          <div style={{ marginTop: '0.5rem' }}>
            {children ?? (command?.manual?.[os] ? (
              <>
                <pre data-testid="setup-manual-commands" style={{ ...commandBox, margin: 0 }}>
                  {command.manual[os]}
                </pre>
                <p style={{ margin: '0.4rem 0 0', color: 'var(--accent-coral, #f87171)', fontSize: '0.74rem' }}>
                  The last line holds this computer's secret. Anyone holding it can report this
                  computer as live, so treat it like a password.
                </p>
              </>
            ) : (
              <p style={{ margin: 0, color: 'var(--text-muted)' }}>
                Press the button above first. The same setup is then listed here as separate
                commands you can run one at a time.
              </p>
            ))}
          </div>
        </details>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.8rem' }}>
        {offerRestart && (
          <button type="button" data-testid="setup-restart" style={quietBtn} disabled={busy}
            onClick={() => { void getCommand() }}>
            Start over with a new command
          </button>
        )}
        {mode === 'prompt' && !connected && (
          <button type="button" data-testid="setup-not-now" style={quietBtn} onClick={dismiss}>
            Not now
          </button>
        )}
        {mode === 'prompt' && connected && (
          <button type="button" data-testid="setup-done" style={quietBtn} onClick={() => setHidden(true)}>
            Done
          </button>
        )}
      </div>
    </div>
  )
}
