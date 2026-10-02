/**
 * AgreementStep -- the web half of the first-boot licence step (setup step `eula`,
 * steps.d 05-eula.json from setup-steps/<product>/) on the proprietary awnix
 * images (a tenant appliance, aitheros, aitheros-cloud).
 *
 * It consumes the step exactly as the wave-1 setup API (awnix_setup.api, steps contract
 * v1) serves it, so it needs no server change:
 *   step.text     the licence text (static in the step file; check_eula_firstboot EUL003
 *                 pins it byte-equal to the shipped licence file)
 *   step.options  from `aither-eula options --json`: `accept:<sha256>` and `decline`
 * Before Accept is offered it hashes the displayed text (Web Crypto) and requires it to
 * equal the sha in the accept option, so this page can only accept the text it shows.
 * The CLI then refuses any sha but the installed text's.
 *
 * Accept stays disabled until the checkbox is ticked, then posts
 * /api/setup/steps/eula {value: 'accept:<sha256>'} through the appliance client (which
 * sends X-Awnix-Console: 1). Decline posts 'decline'; the API answers 409 {error} because
 * the CLI exits 1, setup stays pending and onDone is NOT called.
 *
 * It adds no route and no listener, so the air-gap profile's loopback bind is unchanged
 * (zero open ports). Types are structural: the wave-1 setup step view satisfies
 * AgreementStepData. Vite-safe: no next/*. awkit-vars tokens only. Holds at 360 px.
 * Mounting it (index.ts export, SetupWizard rendering it for step id `eula`) belongs to
 * the wave-1 owners of those files.
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

export interface AgreementOption {
  value: string
  label?: string
  detail?: string
}

/** The subset of the wave-1 setup step view this component reads. */
export interface AgreementStepData {
  id: string
  title: string
  why?: string
  text?: string | null
  options?: AgreementOption[] | null
  status?: string | null
}

/** The subset of ApiResult this step reads. */
export interface AgreementResult {
  state: string
  /** HTTP status; absent when the request never reached the box (network error). */
  status?: number
  data?: unknown
  detail?: string
}

export interface AgreementClient {
  applySetupStep(id: string, value: unknown): Promise<AgreementResult>
}

export type AgreementOutcome = 'accepted'

export interface AgreementStepProps {
  step: AgreementStepData
  client: AgreementClient
  onDone?: (outcome: AgreementOutcome) => void
  /** Test seam: sha256 hex of a UTF-8 string, or null when it cannot be computed. */
  digest?: (text: string) => Promise<string | null>
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'accepted' }
  | { kind: 'declined' }
  | { kind: 'error'; message: string }

type Check = 'pending' | 'match' | 'mismatch' | 'unverifiable'

const ACCEPT_RE = /^accept:([0-9a-f]{64})$/
const VERSION_RE = /\(version ([^)]+)\)/

export async function webCryptoSha256(text: string): Promise<string | null> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle
  if (!subtle) return null
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

function acceptOption(step: AgreementStepData): { value: string; sha: string; label: string } | null {
  for (const o of step.options ?? []) {
    const m = ACCEPT_RE.exec(o?.value ?? '')
    if (m) return { value: o.value, sha: m[1], label: o.label ?? '' }
  }
  return null
}

function failureText(res: AgreementResult): string {
  if (res.state === 'unavailable') {
    return res.detail ?? 'The appliance console did not answer. Try again in a moment.'
  }
  if (res.state === 'locked') return 'The console is locked for a minute after failed codes.'
  const err =
    res.data && typeof res.data === 'object' ? (res.data as { error?: unknown }).error : undefined
  if (typeof err === 'string' && err) return err
  return res.detail ?? `The appliance refused the answer (HTTP ${res.status ?? 'no response'}).`
}

const s = {
  card: {
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg, 12px)',
    padding: 16,
    maxWidth: '100%',
    boxSizing: 'border-box',
  } as CSSProperties,
  title: { margin: '0 0 4px', fontSize: 18, fontWeight: 600 } as CSSProperties,
  muted: { color: 'var(--text-muted)', fontSize: 13, margin: '0 0 12px' } as CSSProperties,
  meta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px 12px',
    fontSize: 13,
    color: 'var(--text-secondary)',
    margin: '0 0 8px',
  } as CSSProperties,
  mono: { fontFamily: 'var(--font-mono, ui-monospace, monospace)' } as CSSProperties,
  doc: {
    background: 'var(--bg-base)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-default, var(--border-subtle))',
    borderRadius: 'var(--radius, 8px)',
    padding: 12,
    maxHeight: '50vh',
    overflowY: 'auto',
    overflowX: 'hidden',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    fontSize: 13,
    lineHeight: 1.5,
    margin: '0 0 12px',
  } as CSSProperties,
  check: { display: 'flex', gap: 8, alignItems: 'flex-start', margin: '0 0 12px' } as CSSProperties,
  row: { display: 'flex', flexWrap: 'wrap', gap: 8 } as CSSProperties,
  primary: {
    background: 'var(--accent-primary, var(--accent))',
    color: 'var(--bg-base)',
    border: '1px solid var(--accent-primary, var(--accent))',
    borderRadius: 'var(--radius, 8px)',
    padding: '8px 16px',
    fontWeight: 600,
    cursor: 'pointer',
  } as CSSProperties,
  secondary: {
    background: 'transparent',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-strong, var(--border-subtle))',
    borderRadius: 'var(--radius, 8px)',
    padding: '8px 16px',
    cursor: 'pointer',
  } as CSSProperties,
  disabled: { opacity: 0.5, cursor: 'not-allowed' } as CSSProperties,
  ok: { color: 'var(--accent-success, var(--accent-green))', margin: '12px 0 0' } as CSSProperties,
  warn: { color: 'var(--accent-warn)', margin: '12px 0 0' } as CSSProperties,
  bad: { color: 'var(--text-danger, var(--accent-danger))', margin: '12px 0 0' } as CSSProperties,
}

export function AgreementStep({ step, client, onDone, digest = webCryptoSha256 }: AgreementStepProps) {
  const text = typeof step.text === 'string' && step.text ? step.text : null
  const opt = acceptOption(step)
  const sha = opt?.sha ?? null
  const version = VERSION_RE.exec(opt?.label ?? '')?.[1] ?? null
  const [check, setCheck] = useState<Check>('pending')
  const [agreed, setAgreed] = useState(false)
  const [phase, setPhase] = useState<Phase>(
    step.status === 'done' ? { kind: 'accepted' } : { kind: 'idle' },
  )
  const busy = phase.kind === 'busy'
  const done = phase.kind === 'accepted'

  useEffect(() => {
    let live = true
    if (!text || !sha) return undefined
    setCheck('pending')
    digest(text)
      .then((got) => {
        if (live) setCheck(got === null ? 'unverifiable' : got === sha ? 'match' : 'mismatch')
      })
      .catch(() => {
        if (live) setCheck('unverifiable')
      })
    return () => {
      live = false
    }
  }, [text, sha, digest])

  const shown = !!text && !!opt && check !== 'mismatch'

  async function submit(value: string) {
    setPhase({ kind: 'busy' })
    let res: AgreementResult
    try {
      res = await client.applySetupStep(step.id, value)
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      return
    }
    if (value === 'decline') {
      // The CLI exits 1 on a decline (the step must not read as done), so the API's 409
      // is the expected answer here. Anything else that is not ok is a real failure.
      if (res.state === 'ok' || res.status === 409) setPhase({ kind: 'declined' })
      else setPhase({ kind: 'error', message: failureText(res) })
      return
    }
    if (res.state === 'ok') {
      setPhase({ kind: 'accepted' })
      onDone?.('accepted')
      return
    }
    setPhase({ kind: 'error', message: failureText(res) })
  }

  const acceptDisabled = !shown || check === 'pending' || !agreed || busy || done

  return (
    <section style={s.card} aria-labelledby={`awx-agree-${step.id}`} data-testid="agreement-step">
      <h2 id={`awx-agree-${step.id}`} style={s.title}>{step.title}</h2>
      {step.why ? <p style={s.muted}>{step.why}</p> : null}

      {shown && text && opt ? (
        <>
          <div style={s.meta}>
            {version ? <span>version {version}</span> : null}
            <span style={s.mono} title={opt.sha} data-testid="agreement-sha">
              sha256 {opt.sha.slice(0, 12)}
            </span>
            {check === 'unverifiable' ? (
              <span data-testid="agreement-unverified">
                (this browser cannot hash the text; the appliance still checks the sha)
              </span>
            ) : null}
          </div>
          <div
            style={s.doc}
            role="document"
            tabIndex={0}
            aria-label={step.title}
            data-testid="agreement-text"
          >
            {text}
          </div>
          <label style={s.check}>
            <input
              type="checkbox"
              checked={agreed}
              disabled={busy || done}
              onChange={(e) => setAgreed(e.currentTarget.checked)}
              data-testid="agreement-check"
            />
            <span>I have read these terms and accept them on behalf of the organisation operating this appliance.</span>
          </label>
          <div style={s.row}>
            <button
              type="button"
              style={{ ...s.primary, ...(acceptDisabled ? s.disabled : {}) }}
              disabled={acceptDisabled}
              onClick={() => void submit(opt.value)}
              data-testid="agreement-accept"
            >
              {busy ? 'Recording...' : 'Accept'}
            </button>
            <button
              type="button"
              style={{ ...s.secondary, ...(busy || done ? s.disabled : {}) }}
              disabled={busy || done}
              onClick={() => void submit('decline')}
              data-testid="agreement-decline"
            >
              Decline
            </button>
          </div>
        </>
      ) : (
        <p style={s.bad} role="alert" data-testid="agreement-missing">
          {check === 'mismatch'
            ? 'The licence text shown here does not match the one installed on the appliance, so it cannot be accepted here.'
            : 'The licence text could not be loaded, so it cannot be accepted here.'}{' '}
          At the appliance, run <span style={s.mono}>aither-eula show</span> to read it, then
          <span style={s.mono}> aither-eula accept accept:&lt;sha256&gt;</span> to accept it.
        </p>
      )}

      <div aria-live="polite">
        {phase.kind === 'accepted' ? (
          <p style={s.ok} data-testid="agreement-accepted">
            Accepted. The acceptance is recorded with this text&apos;s sha256 and the time, and
            the product is starting.
          </p>
        ) : null}
        {phase.kind === 'declined' ? (
          <p style={s.warn} data-testid="agreement-declined">
            Declined. The appliance keeps running, but the product will not start until
            the terms are accepted. Setup stays pending.
          </p>
        ) : null}
        {phase.kind === 'error' ? (
          <p style={s.bad} role="alert" data-testid="agreement-error">{phase.message}</p>
        ) : null}
      </div>
    </section>
  )
}

export default AgreementStep
