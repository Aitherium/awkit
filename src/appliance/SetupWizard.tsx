/**
 * SetupWizard -- the appliance's first-boot setup, in a browser.
 *
 * Rendered by ApplianceConsole on the `#/setup` tab while the box is in SETUP mode
 * (/etc/awnix/setup.json absent). It is a stepper driven ENTIRELY by
 * GET /api/setup/steps, so a new step (a product model tier, license, update channel) is a
 * steps.d JSON file on the image, never a UI change. The server (awnix-console mounting
 * awnix_setup.api) is the judge of every value; this component only collects and shows.
 *
 * Rules this file keeps (appliance-setup.test.tsx pins them):
 *   - secrets are WRITE-ONLY: a secret value is sent once, cleared from state and never
 *     rendered back, not even masked;
 *   - a `reveal` step shows its output ONCE, offers a download, and will not move on
 *     until the admin ticks "I saved it";
 *   - a 401 anywhere drops back to the code screen (the session expired or the code was
 *     rotated), never to a blank page;
 *   - it works at phone width (an admin on the LAN with only a phone).
 *
 * Vite-safe: no next/* import (AWS004). Colours and radii are awkit-vars tokens only.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import Tooltip from '../ui/Tooltip'
import { AgreementStep, type AgreementStepData } from './AgreementStep'

// ── the contract with the client (structural; createApplianceClient satisfies it) ──────

export type WizardStepKind = 'choice' | 'text' | 'secret' | 'toggle' | 'info' | 'reveal'

export interface WizardOption {
  value: string
  label?: string
  detail?: string
  active?: boolean
}

export interface WizardField {
  name: string
  label: string
  kind: 'text' | 'secret'
  multiline?: boolean
}

export interface WizardStep {
  id: string
  title: string
  why: string
  kind: WizardStepKind
  builtin?: boolean
  multi?: boolean
  /** awnix_setup.api fills these from options_cmd; a bare string is its own label. */
  options?: Array<WizardOption | string>
  fields?: WizardField[]
  current?: string | boolean | null
  text?: string
  url?: string
  status?: 'pending' | 'done' | 'skipped' | 'failed' | null
  required?: boolean
}

/** What every client call resolves to. `state` is the console's ApiState. */
export interface SetupCallResult<T> {
  state: string
  status?: number
  data?: T | null
  detail?: string
}

export interface SetupWizardClient {
  setupSteps(): Promise<SetupCallResult<{ variant?: string; steps: WizardStep[] }>>
  applySetupStep(id: string, value: unknown): Promise<SetupCallResult<Record<string, unknown>>>
  finishSetup(): Promise<SetupCallResult<Record<string, unknown>>>
  /** Optional: lets the wizard re-login inline after a 401. */
  login?(code: string): Promise<SetupCallResult<unknown>>
}

export interface SetupWizardProps {
  client: SetupWizardClient
  /** Called on a 401 so the console shell can show its own code screen. */
  onUnauthorized?: () => void
  /** Called after POST /api/setup/finish succeeds (the box is now in console mode). */
  onFinished?: (state: Record<string, unknown> | null | undefined) => void
}

/** The skip sentinel awnix_setup.api understands for steps.d steps. */
export const SKIP = '__skip__'

const isUnauthorized = (r: { state: string; status?: number }) =>
  r.status === 401 || r.state === 'unauthenticated'

// ── styles: awkit-vars tokens only ──────────────────────────────────────────────────────

const S: Record<string, CSSProperties> = {
  wrap: { width: '100%', maxWidth: 640, margin: '0 auto', padding: '1rem', boxSizing: 'border-box',
    color: 'var(--text-primary)', fontFamily: 'inherit' },
  card: { background: 'var(--bg-elevated)', border: '1px solid var(--glass-border)',
    borderRadius: 'var(--radius)', padding: '1rem', boxSizing: 'border-box', width: '100%' },
  muted: { color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.45 },
  input: { width: '100%', boxSizing: 'border-box', padding: '0.6rem 0.7rem', fontSize: '1rem',
    background: 'var(--bg-surface)', color: 'var(--text-primary)',
    border: '1px solid var(--glass-border)', borderRadius: 6 },
  row: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem' },
  btn: { padding: '0.6rem 1rem', minHeight: 44, borderRadius: 6, fontSize: '0.95rem',
    border: '1px solid var(--glass-border)', background: 'var(--bg-surface)',
    color: 'var(--text-primary)', cursor: 'pointer' },
  primary: { background: 'var(--accent-primary)', color: 'var(--bg-deep)',
    border: '1px solid var(--accent-primary)' },
  option: { display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.6rem',
    border: '1px solid var(--glass-border)', borderRadius: 6, cursor: 'pointer',
    background: 'var(--bg-surface)', minHeight: 44, boxSizing: 'border-box' },
  error: { color: 'var(--color-error, var(--accent-danger, #c0392b))', marginTop: '0.75rem',
    fontSize: '0.9rem' },
  pre: { whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'var(--bg-deep)',
    color: 'var(--text-primary)', padding: '0.75rem', borderRadius: 6, fontSize: '0.85rem',
    maxHeight: 280, overflow: 'auto' },
}

function Button(props: { onClick?: () => void; primary?: boolean; disabled?: boolean;
  children: ReactNode; type?: 'button' | 'submit'; testId?: string }) {
  return (
    <button type={props.type ?? 'button'} onClick={props.onClick} disabled={props.disabled}
      data-testid={props.testId}
      style={{ ...S.btn, ...(props.primary ? S.primary : {}), opacity: props.disabled ? 0.55 : 1 }}>
      {props.children}
    </button>
  )
}

/** Options arrive as objects or bare strings (contract awkit-appliance-ui SetupStep). */
function normalizeOptions(opts: WizardStep['options']): WizardOption[] {
  return (opts ?? []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
}

// ── the code screen (shown after a 401) ─────────────────────────────────────────────────

function CodeScreen({ client, onDone }: { client: SetupWizardClient; onDone: () => void }) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const submit = async () => {
    if (!client.login) return
    const r = await client.login(code.trim())
    if (r.state === 'ok') { setCode(''); onDone() } else {
      setErr(r.state === 'locked' ? 'Too many tries -- wait a minute, then try again.'
        : 'That code did not work. It is shown on the machine\'s screen.')
    }
  }
  return (
    <div style={S.card} data-testid="setup-code-screen">
      <h2 style={{ marginTop: 0 }}>Enter the setup code</h2>
      <p style={S.muted}>Your session ended. The setup code is printed on the machine's
        screen (tty1 and the serial console), next to this page's address.</p>
      {client.login ? (
        <form onSubmit={(e) => { e.preventDefault(); void submit() }}>
          <input aria-label="Setup code" style={S.input} value={code} autoComplete="one-time-code"
            onChange={(e) => setCode(e.target.value)} />
          <div style={S.row}><Button type="submit" primary disabled={!code.trim()}>Continue</Button></div>
        </form>
      ) : <p style={S.muted}>Reload this page to enter it.</p>}
      {err && <p role="alert" style={S.error}>{err}</p>}
    </div>
  )
}

// ── one step's input, by kind ───────────────────────────────────────────────────────────

type Draft = Record<string, unknown>

function StepBody({ step, draft, setDraft, linkInfo, reveal, savedIt, setSavedIt }: {
  step: WizardStep
  draft: Draft
  setDraft: (d: Draft) => void
  linkInfo: { uri?: string; code?: string; linked?: boolean } | null
  reveal: string | null
  savedIt: boolean
  setSavedIt: (b: boolean) => void
}) {
  const set = (k: string, v: unknown) => setDraft({ ...draft, [k]: v })
  if (step.fields && step.fields.length) {
    return (
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {typeof step.current === 'string' && step.current && <p style={S.muted}>An administrator already exists: <b>{step.current}</b>.
          You can add another or skip.</p>}
        {step.fields.map((f) => (
          <label key={f.name} style={{ display: 'grid', gap: '0.3rem' }}>
            <span style={S.muted}>{f.label}</span>
            {f.multiline ? (
              <textarea aria-label={f.label} rows={3} style={S.input}
                value={String(draft[f.name] ?? '')} onChange={(e) => set(f.name, e.target.value)} />
            ) : (
              <input aria-label={f.label} style={S.input}
                type={f.kind === 'secret' ? 'password' : 'text'}
                autoComplete={f.kind === 'secret' ? 'new-password' : 'off'}
                value={String(draft[f.name] ?? '')} onChange={(e) => set(f.name, e.target.value)} />
            )}
          </label>
        ))}
      </div>
    )
  }
  switch (step.kind) {
    case 'text':
      return <input aria-label={step.title} style={S.input} placeholder={typeof step.current === 'string' ? step.current : ''}
        value={String(draft.value ?? '')} onChange={(e) => set('value', e.target.value)} />
    case 'secret':
      return (
        <div>
          <input aria-label={step.title} style={S.input} type="password" autoComplete="off"
            data-testid="secret-input"
            value={String(draft.value ?? '')} onChange={(e) => set('value', e.target.value)} />
          <p style={S.muted}>Write-only: it is stored on the machine and never shown again.</p>
        </div>
      )
    case 'choice': {
      const opts = normalizeOptions(step.options)
      const multi = !!step.multi
      const picked: string[] = Array.isArray(draft.value) ? (draft.value as string[])
        : draft.value != null ? [String(draft.value)] : []
      if (!opts.length) return <p style={S.muted}>Nothing to choose from right now.</p>
      return (
        <div role={multi ? 'group' : 'radiogroup'} aria-label={step.title}
          style={{ display: 'grid', gap: '0.5rem' }}>
          {opts.map((o) => {
            const on = picked.includes(o.value)
            return (
              <label key={o.value} style={{ ...S.option,
                borderColor: on ? 'var(--accent-primary)' : 'var(--glass-border)' }}>
                <input type={multi ? 'checkbox' : 'radio'} name={step.id} checked={on}
                  aria-label={o.label ?? o.value}
                  onChange={() => set('value', multi
                    ? (on ? picked.filter((p) => p !== o.value) : [...picked, o.value])
                    : o.value)} />
                <span style={{ display: 'grid' }}>
                  <span>{o.label ?? o.value}{o.active ? ' (current)' : ''}</span>
                  {o.detail && <span style={S.muted}>{o.detail}</span>}
                </span>
              </label>
            )
          })}
        </div>
      )
    }
    case 'toggle':
      return (
        <div>
          <label style={S.option}>
            <input type="checkbox" role="switch" aria-label={step.title}
              checked={!!draft.value} onChange={(e) => set('value', e.target.checked)} />
            <span>{draft.value ? 'On' : 'Off'}</span>
          </label>
          {linkInfo && !linkInfo.linked && linkInfo.code && (
            <div style={{ ...S.card, marginTop: '0.75rem' }} data-testid="link-code">
              <p style={S.muted}>On any device, open</p>
              <p><a href={linkInfo.uri} target="_blank" rel="noreferrer">{linkInfo.uri}</a></p>
              <p style={S.muted}>and enter</p>
              <p style={{ fontSize: '1.4rem', letterSpacing: '0.15em' }}>{linkInfo.code}</p>
              <p style={S.muted}>Waiting for approval...</p>
            </div>
          )}
          {linkInfo?.linked && <p data-testid="linked">Linked.</p>}
        </div>
      )
    case 'info':
      return (
        <div>
          {step.text && <p>{step.text}</p>}
          {step.url && <p><a href={step.url} target="_blank" rel="noreferrer">{step.url}</a></p>}
        </div>
      )
    case 'reveal':
      return reveal == null ? (
        <p style={S.muted}>This is shown ONCE. Have somewhere safe ready (a password manager),
          then press Show.</p>
      ) : (
        <div>
          <pre style={S.pre} data-testid="reveal-output">{reveal}</pre>
          <div style={S.row}>
            <a style={{ ...S.btn, textDecoration: 'none' }} data-testid="reveal-download"
              download={`${step.id}.txt`}
              href={`data:text/plain;charset=utf-8,${encodeURIComponent(reveal)}`}>Download</a>
          </div>
          <label style={{ ...S.option, marginTop: '0.75rem' }}>
            <input type="checkbox" aria-label="I saved it" checked={savedIt}
              onChange={(e) => setSavedIt(e.target.checked)} />
            <span>I saved it. I understand it will not be shown again.</span>
          </label>
        </div>
      )
    default:
      return null
  }
}

// ── the wizard ──────────────────────────────────────────────────────────────────────────

export default function SetupWizard({ client, onUnauthorized, onFinished }: SetupWizardProps) {
  const [steps, setSteps] = useState<WizardStep[] | null>(null)
  const [idx, setIdx] = useState(0)
  const [draft, setDraft] = useState<Draft>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [needCode, setNeedCode] = useState(false)
  const [loadState, setLoadState] = useState<string>('loading')
  const [status, setStatus] = useState<Record<string, string>>({})
  const [linkInfo, setLinkInfo] = useState<{ uri?: string; code?: string; device?: string;
    interval?: number; linked?: boolean } | null>(null)
  const [reveal, setReveal] = useState<string | null>(null)
  const [savedIt, setSavedIt] = useState(false)
  const [finished, setFinished] = useState(false)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const unauthorized = useCallback(() => {
    setNeedCode(true)
    onUnauthorized?.()
  }, [onUnauthorized])

  const load = useCallback(async () => {
    const r = await client.setupSteps()
    if (isUnauthorized(r)) { unauthorized(); return }
    if (r.state !== 'ok' || !r.data) {
      // 410 (setup API), 403 (its SetupComplete via the console) and the console's own
      // 409 'setup is complete' all mean the same thing: this box is in console mode.
      setLoadState(r.status === 410 || r.status === 403 || r.status === 409
        ? 'complete' : r.state || 'error')
      setErr(r.detail ?? '')
      return
    }
    setSteps(r.data.steps)
    setStatus(Object.fromEntries(r.data.steps.map((s) => [s.id, s.status ?? 'pending'])))
    setLoadState('ok')
  }, [client, unauthorized])

  useEffect(() => { void load() }, [load])
  useEffect(() => () => { if (pollTimer.current) clearTimeout(pollTimer.current) }, [])

  const step = steps?.[idx]
  const total = steps?.length ?? 0

  const advance = useCallback((id: string, st: string) => {
    setStatus((s) => ({ ...s, [id]: st }))
    setDraft({})            // a secret leaves memory here, before anything re-renders
    setReveal(null)
    setSavedIt(false)
    setLinkInfo(null)
    setErr('')
    setIdx((i) => i + 1)
  }, [])

  const apply = useCallback(async (value: unknown) => {
    if (!step) return
    setBusy(true)
    setErr('')
    try {
      const r = await client.applySetupStep(step.id, value)
      if (isUnauthorized(r)) { unauthorized(); return }
      if (r.state !== 'ok') {
        setErr(r.detail || 'That did not apply. Nothing else was changed.')
        if (step.kind === 'secret' || step.fields) setDraft({})  // never keep a secret around a failure
        return
      }
      if (step.kind === 'reveal' && typeof r.data?.reveal === 'string') {
        setReveal(r.data.reveal)
        return
      }
      advance(step.id, value === SKIP ? 'skipped' : 'done')
    } finally {
      setBusy(false)
    }
  }, [client, step, unauthorized, advance])

  const pollLink = useCallback((device: string, interval: number) => {
    pollTimer.current = setTimeout(async () => {
      const r = await client.applySetupStep('link', { action: 'poll', device_code: device })
      if (isUnauthorized(r)) { unauthorized(); return }
      if (r.state !== 'ok') { setErr(r.detail || 'The link was declined or expired.'); return }
      if (r.data?.linked) {
        setLinkInfo((l) => ({ ...(l ?? {}), linked: true }))
        return
      }
      pollLink(device, r.data?.slow_down ? interval + 5 : interval)
    }, Math.max(1, interval) * 1000)
  }, [client, unauthorized])

  const onNext = useCallback(async () => {
    if (!step) return
    if (step.id === 'link' && step.builtin) {
      if (linkInfo?.linked) { advance('link', 'done'); return }
      if (!draft.value) { await apply(false); return }
      setBusy(true)
      const r = await client.applySetupStep('link', { action: 'start' })
      setBusy(false)
      if (isUnauthorized(r)) { unauthorized(); return }
      if (r.state !== 'ok') { setErr(r.detail || 'Could not start the link.'); return }
      const d = r.data ?? {}
      const info = { uri: String(d.verification_uri ?? ''), code: String(d.user_code ?? ''),
        device: String(d.device_code ?? ''), interval: Number(d.interval ?? 5) }
      setLinkInfo(info)
      pollLink(info.device, info.interval)
      return
    }
    if (step.kind === 'reveal') {
      if (reveal == null) { await apply(null); return }
      if (savedIt) advance(step.id, 'done')
      return
    }
    if (step.kind === 'info') { await apply(null); return }
    if (step.fields) { await apply({ ...draft }); return }
    if (step.kind === 'toggle') { await apply(!!draft.value); return }
    if (step.kind === 'choice' && step.multi) {
      await apply(Array.isArray(draft.value) ? draft.value : [])
      return
    }
    await apply(draft.value)
  }, [step, draft, linkInfo, reveal, savedIt, client, apply, advance, pollLink, unauthorized])

  const onSkip = useCallback(async () => {
    if (!step) return
    if (step.builtin) {
      if (step.id === 'link') { await apply(false); return }
      if (step.id === 'components') { await apply([]); return }
      advance(step.id, 'skipped')           // hostname/admin: skipping changes nothing
      return
    }
    await apply(SKIP)
  }, [step, apply, advance])

  const finish = useCallback(async () => {
    setBusy(true)
    const r = await client.finishSetup()
    setBusy(false)
    if (isUnauthorized(r)) { unauthorized(); return }
    if (r.state !== 'ok') { setErr(r.detail || 'Could not finish setup.'); return }
    setFinished(true)
    onFinished?.(r.data)
  }, [client, unauthorized, onFinished])

  const nextDisabled = useMemo(() => {
    if (!step || busy) return true
    if (step.kind === 'reveal' && reveal != null) return !savedIt
    if (step.kind === 'text' && !step.fields) return !String(draft.value ?? '').trim()
    if (step.kind === 'secret') return !String(draft.value ?? '').trim()
    if (step.kind === 'choice' && !step.multi) return draft.value == null
    return false
  }, [step, busy, reveal, savedIt, draft])

  if (needCode) {
    return (
      <div style={S.wrap}>
        <CodeScreen client={client} onDone={() => { setNeedCode(false); void load() }} />
      </div>
    )
  }
  if (loadState === 'complete' || finished) {
    return (
      <div style={S.wrap}>
        <div style={S.card} data-testid="setup-complete">
          <h2 style={{ marginTop: 0 }}>Setup is complete</h2>
          <p style={S.muted}>This page is now the appliance console. From here on, sign in
            with the console code (`sudo awnix console code` on the machine).</p>
        </div>
      </div>
    )
  }
  if (loadState !== 'ok' || !steps) {
    return (
      <div style={S.wrap}>
        <div style={S.card} data-testid="setup-loading">
          {loadState === 'loading' ? <p style={S.muted}>Loading setup...</p>
            : <p role="alert" style={S.error}>Setup is not available ({loadState}). {err}</p>}
        </div>
      </div>
    )
  }
  if (idx >= total) {
    return (
      <div style={S.wrap}>
        <div style={S.card} data-testid="setup-summary">
          <h2 style={{ marginTop: 0 }}>Ready to finish</h2>
          <ul style={{ paddingLeft: '1.1rem' }}>
            {steps.map((s) => (
              <li key={s.id}><span>{s.title}</span>{' '}
                <span style={S.muted}>-- {status[s.id] ?? 'pending'}</span></li>
            ))}
          </ul>
          <p style={S.muted}>Nothing here is required. Finishing switches this page to the
            appliance console; you can re-run setup later with `awnix setup --reset --yes`.</p>
          <div style={S.row}>
            <Button onClick={() => setIdx(Math.max(0, total - 1))} disabled={busy}>Back</Button>
            <Button primary onClick={() => void finish()} disabled={busy} testId="setup-finish">Finish</Button>
          </div>
          {err && <p role="alert" style={S.error}>{err}</p>}
        </div>
      </div>
    )
  }
  const cur = step as WizardStep
  // The licence step (`eula`, a gate on the product units) has its own screen: the full
  // text, a digest check of what is shown, then accept or decline -- never a plain choice.
  if (cur.id === 'eula') {
    return (
      <div style={S.wrap}>
        <p style={S.muted} aria-live="polite">Step {idx + 1} of {total}</p>
        <AgreementStep step={cur as unknown as AgreementStepData} client={client}
          onDone={() => { setStatus((s) => ({ ...s, [cur.id]: 'done' })); setIdx(idx + 1) }} />
      </div>
    )
  }
  return (
    <div style={S.wrap}>
      <p style={S.muted} aria-live="polite">Step {idx + 1} of {total}</p>
      <div style={S.card} data-testid={`setup-step-${cur.id}`} data-kind={cur.kind}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{cur.title}</h2>
          <Tooltip label={cur.why}>
            <span aria-label="Why this step" tabIndex={0}
              style={{ ...S.muted, border: '1px solid var(--glass-border)', borderRadius: 999,
                width: 22, height: 22, display: 'inline-flex', alignItems: 'center',
                justifyContent: 'center' }}>?</span>
          </Tooltip>
        </div>
        <p style={S.muted}>{cur.why}</p>
        <StepBody step={cur} draft={draft} setDraft={setDraft} linkInfo={linkInfo}
          reveal={reveal} savedIt={savedIt} setSavedIt={setSavedIt} />
        {err && <p role="alert" style={S.error}>{err}</p>}
        <div style={S.row}>
          {/* A shown reveal is gone for good once we leave it (the server marked the step
              done and a well-made reveal_cmd refuses a second run), so Back is locked
              until "I saved it", exactly like Next and Skip. */}
          <Button onClick={() => { setDraft({}); setReveal(null); setIdx(Math.max(0, idx - 1)) }}
            disabled={busy || idx === 0 || (cur.kind === 'reveal' && reveal != null && !savedIt)}
            testId="setup-back">Back</Button>
          {!(cur.kind === 'reveal' && reveal != null) && (
            <Button onClick={() => void onSkip()} disabled={busy} testId="setup-skip">Skip</Button>
          )}
          <Button primary onClick={() => void onNext()} disabled={nextDisabled} testId="setup-next">
            {cur.kind === 'reveal' && reveal == null ? 'Show' : cur.kind === 'info' ? 'Continue' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  )
}
