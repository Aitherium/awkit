/**
 * UpdatesPanel -- the appliance console's Updates tab (#/updates).
 *
 * Shows what `awnix update status --json` knows: the channel, the booted / available /
 * staged digests, who signed the staged image (or that an unsigned one was refused),
 * and why a check stopped (license refused, no credential, offline). Actions go through
 * the console's fixed argv allowlist (POST /api/appliance/actions/update-*):
 *
 *   Check now          update-check
 *   Restart to update  update-apply      (confirm: the machine reboots)
 *   Roll back          update-rollback   (confirm: the machine reboots)
 *   Channel            update-channel {channel: stable|beta}   (beta asks first)
 *   Automatic restart  update-auto-apply {value: on|off}
 *
 * While an action runs the panel re-reads status every 30 s, so a staged update or a
 * reboot shows up without a manual refresh.
 *
 * Vite-safe on purpose: no next/* import, tokens from awkit-vars.css only, works at
 * 360 px and in both themes. The contract types come from ./types (console-owned) and
 * the client is the console's createApplianceClient: the panel needs only its
 * `updates()` read and `action()` call, so tests can hand it a two-method fake.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { ApplianceClient } from './client'
import type { ApiResult, ApiState, UpdateChannel, UpdateStatus } from './types'

export type { ApiResult, ApiState, UpdateChannel, UpdateStatus }

/**
 * awnix-update keeps `state` inside the contract enum (UpdateStateName) and puts the
 * finer verdict in an additive `reason` field: rolled-back (state staged),
 * staged-unverified (state unsigned-refused), channel-unpublished (state offline).
 * The panel prefers `reason` when it is one of these, so older readers stay correct.
 */
export type UpdateReason = 'rolled-back' | 'channel-unpublished' | 'staged-unverified'

const REASONS: readonly string[] = ['rolled-back', 'channel-unpublished', 'staged-unverified']

/** The verdict to render: the finer `reason` when awnix-update gave one, else `state`. */
export function verdictOf(s: UpdateStatus): string {
  const reason = (s as UpdateStatus & { reason?: unknown }).reason
  return typeof reason === 'string' && REASONS.includes(reason) ? reason : s.state
}

export type UpdateVerb =
  | 'update-check'
  | 'update-apply'
  | 'update-rollback'
  | 'update-channel'
  | 'update-auto-apply'

/** The slice of ApplianceClient this panel calls. */
export type UpdatesPanelClient = Pick<ApplianceClient, 'updates' | 'action'>

export interface UpdatesPanelProps {
  client: UpdatesPanelClient
  /** Injected for tests and embedders; defaults to window.confirm. */
  confirm?: (message: string) => boolean
  /** Poll interval while an action runs (ms). */
  pollMs?: number
  /** First paint before the first GET answers (server render, embedding). */
  initial?: UpdateStatus
}

// ── pure logic (tested without a DOM) ─────────────────────────────────────────────
export const CHANNELS: readonly UpdateChannel[] = ['stable', 'beta']
export const POLL_MS = 30_000
export const POLL_WINDOW_MS = 15 * 60_000

export function isChannel(v: unknown): v is UpdateChannel {
  return v === 'stable' || v === 'beta'
}

export function shortDigest(d: string | null | undefined): string {
  if (!d) return '—'
  const hex = d.startsWith('sha256:') ? d.slice(7) : d
  return `sha256:${hex.slice(0, 12)}`
}

export type Tone = 'ok' | 'info' | 'warn' | 'danger'

export function describeUpdate(s: UpdateStatus): { tone: Tone; headline: string; body: string } {
  const detail = s.detail || ''
  const state = verdictOf(s)
  switch (state) {
    case 'current':
      return { tone: 'ok', headline: 'Up to date', body: detail }
    case 'staged':
      return { tone: 'info', headline: 'An update is ready', body: 'It was verified and downloaded. It takes effect when the machine restarts.' }
    case 'unsigned-refused':
      return { tone: 'danger', headline: 'Update refused: unsigned', body: `An image without a valid signature was offered and refused. Nothing was installed. ${detail}` }
    case 'license-refused':
      return { tone: 'warn', headline: 'Updates paused: license', body: detail || 'The license was refused. The product keeps running; updates resume once the license is valid.' }
    case 'auth-refused':
      return { tone: 'warn', headline: 'Registry refused this machine', body: detail }
    case 'no-credential':
      return { tone: 'warn', headline: 'No update credential', body: detail || 'Activate a license to receive updates for this image.' }
    case 'offline':
      return { tone: 'warn', headline: 'Could not reach the update server', body: detail }
    case 'rolled-back':
      return { tone: 'info', headline: 'Rolling back', body: detail }
    case 'channel-unpublished':
      return { tone: 'info', headline: 'No release on this channel yet', body: detail || 'Nothing has been published to this channel yet. The machine keeps running what it has and checks again later.' }
    case 'staged-unverified':
      return { tone: 'danger', headline: 'Staged update refused: not verified', body: `Something staged an image this machine did not verify. It will not restart into it. ${detail}` }
    case 'never-checked':
      return { tone: 'info', headline: 'Not checked yet', body: 'The first check runs about ten minutes after boot, or press Check now.' }
    default:
      return { tone: 'danger', headline: 'Update check failed', body: detail }
  }
}

export function signatureLabel(s: UpdateStatus): string {
  const state = verdictOf(s)
  if (state === 'unsigned-refused' || state === 'staged-unverified') return 'unsigned — refused'
  if (s.signer_identity) return s.signer_identity
  return '—'
}

export function autoApplyOn(s: UpdateStatus): boolean {
  return s.auto_apply === true
}

export const CONFIRM_TEXT: Record<'apply' | 'rollback' | 'beta', string> = {
  apply: 'Restart now to finish the update? The machine reboots and is unavailable for a few minutes.',
  rollback: 'Roll back to the previous version? The machine reboots into it and is unavailable for a few minutes.',
  beta: 'Switch to beta? Beta receives every build before it has passed the upgrade and rollback proof. Recommended only for test machines.',
}

export type PanelAction =
  | { kind: 'check' }
  | { kind: 'apply' }
  | { kind: 'rollback' }
  | { kind: 'channel'; channel: string }
  | { kind: 'auto-apply'; on: boolean }

export type RunOutcome =
  | { outcome: 'cancelled' }
  | { outcome: 'invalid'; message: string }
  | { outcome: 'done'; response: ApiResult<unknown> }

/** One place that decides what needs a confirmation and what the console receives. */
export async function runUpdateAction(
  client: UpdatesPanelClient,
  action: PanelAction,
  confirm: (message: string) => boolean,
): Promise<RunOutcome> {
  switch (action.kind) {
    case 'check':
      return { outcome: 'done', response: await client.action('update-check') }
    case 'apply':
      if (!confirm(CONFIRM_TEXT.apply)) return { outcome: 'cancelled' }
      return { outcome: 'done', response: await client.action('update-apply') }
    case 'rollback':
      if (!confirm(CONFIRM_TEXT.rollback)) return { outcome: 'cancelled' }
      return { outcome: 'done', response: await client.action('update-rollback') }
    case 'channel':
      if (!isChannel(action.channel)) return { outcome: 'invalid', message: 'channel must be stable or beta' }
      if (action.channel === 'beta' && !confirm(CONFIRM_TEXT.beta)) return { outcome: 'cancelled' }
      return { outcome: 'done', response: await client.action('update-channel', { channel: action.channel }) }
    case 'auto-apply':
      return { outcome: 'done', response: await client.action('update-auto-apply', { value: action.on ? 'on' : 'off' }) }
  }
}

export function apiStateMessage(state: ApiState, detail?: string): string | null {
  switch (state) {
    case 'ok':
      return null
    case 'refused':
      return detail || 'The request was refused.'
    case 'unavailable':
      return 'The update service did not answer. Try again in a minute.'
    case 'not-an-appliance':
      return 'This machine has no update plane (it is not an awnix appliance).'
    case 'locked':
      return 'Too many attempts. Wait a minute and sign in again.'
    case 'not-entitled':
      return 'This license does not include updates for this image.'
    default:
      return detail || 'Something went wrong.'
  }
}

// ── view ──────────────────────────────────────────────────────────────────────────
const TONE_COLOR: Record<Tone, string> = {
  ok: 'var(--accent-success, var(--accent-green))',
  info: 'var(--accent-primary, var(--accent))',
  warn: 'var(--accent-warn, var(--accent-warm))',
  danger: 'var(--accent-danger, var(--accent-red))',
}

const S: Record<string, CSSProperties> = {
  root: { display: 'grid', gap: 16, maxWidth: 880, width: '100%', color: 'var(--text-primary, var(--fg))', fontFamily: 'var(--font-sans)' },
  card: { background: 'var(--bg-surface, var(--card))', border: '1px solid var(--border-subtle, var(--border))', borderRadius: 'var(--radius-lg, 12px)', padding: 16, minWidth: 0 },
  row: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(96px, max-content) minmax(0, 1fr)', gap: '6px 12px', fontSize: 14 },
  label: { color: 'var(--text-secondary, var(--fg-muted))' },
  mono: { fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' },
  btn: { padding: '8px 14px', minHeight: 44, borderRadius: 'var(--radius, 8px)', border: '1px solid var(--border-default, var(--border))', background: 'var(--bg-elevated, var(--card))', color: 'inherit', cursor: 'pointer', font: 'inherit' },
  primary: { background: 'var(--accent-primary, var(--accent))', color: 'var(--bg-base, #fff)', borderColor: 'transparent' },
  muted: { color: 'var(--text-secondary, var(--fg-muted))', fontSize: 13, margin: 0 },
}

export default function UpdatesPanel({ client, confirm, pollMs = POLL_MS, initial }: UpdatesPanelProps): ReactElement {
  const [status, setStatus] = useState<UpdateStatus | null>(initial ?? null)
  const [apiState, setApiState] = useState<ApiState>('ok')
  const [apiDetail, setApiDetail] = useState<string | undefined>()
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const pollUntil = useRef(0)
  const ask = confirm ?? ((m: string) => (typeof window !== 'undefined' ? window.confirm(m) : false))

  const load = useCallback(async () => {
    const r = await client.updates()
    setApiState(r.state)
    setApiDetail(r.detail)
    if (r.state === 'ok' && r.data) setStatus(r.data)
  }, [client])

  useEffect(() => {
    void load()
  }, [load])

  // Re-read every pollMs while an action is in flight or just finished (a reboot, a
  // stage), for at most POLL_WINDOW_MS.
  useEffect(() => {
    if (!busy && Date.now() > pollUntil.current) return undefined
    const t = setInterval(() => {
      if (Date.now() > pollUntil.current && !busy) {
        clearInterval(t)
        return
      }
      void load()
    }, pollMs)
    return () => clearInterval(t)
  }, [busy, load, pollMs])

  const run = async (label: string, action: PanelAction) => {
    setNote(null)
    setBusy(label)
    pollUntil.current = Date.now() + POLL_WINDOW_MS
    try {
      const r = await runUpdateAction(client, action, ask)
      if (r.outcome === 'invalid') setNote(r.message)
      if (r.outcome === 'done') {
        const msg = apiStateMessage(r.response.state, r.response.stdoutTail || r.response.detail)
        setNote(msg ?? (action.kind === 'apply' || action.kind === 'rollback' ? 'Restarting in a few seconds…' : null))
      }
      await load()
    } finally {
      setBusy(null)
    }
  }

  const blocked = apiStateMessage(apiState, apiDetail)
  if (!status) {
    return (
      <section style={S.root} aria-label="Updates">
        <div style={S.card}>{blocked ?? 'Loading update status…'}</div>
      </section>
    )
  }

  const d = describeUpdate(status)
  const staged = Boolean(status.staged_digest)
  return (
    <section style={S.root} aria-label="Updates">
      <div style={{ ...S.card, borderLeft: `4px solid ${TONE_COLOR[d.tone]}` }} role="status" data-state={status.state}>
        <strong style={{ display: 'block', marginBottom: 4 }}>{d.headline}</strong>
        {d.body && <p style={S.muted}>{d.body}</p>}
        {blocked && <p style={{ ...S.muted, color: TONE_COLOR.warn }}>{blocked}</p>}
      </div>

      <div style={S.card}>
        <div style={S.grid}>
          <span style={S.label}>Channel</span>
          <span>{status.channel}</span>
          <span style={S.label}>Running</span>
          <span style={S.mono}>{shortDigest(status.booted_digest)}</span>
          <span style={S.label}>Available</span>
          <span style={S.mono}>{shortDigest(status.available_digest)}</span>
          <span style={S.label}>Staged</span>
          <span style={S.mono}>{shortDigest(status.staged_digest)}</span>
          <span style={S.label}>Signed by</span>
          <span style={S.mono} data-testid="signer">{signatureLabel(status)}</span>
          <span style={S.label}>Last check</span>
          <span>{status.checked_at ?? 'never'}</span>
        </div>
      </div>

      <div style={{ ...S.card, ...S.row }}>
        <button type="button" style={S.btn} disabled={!!busy} onClick={() => void run('check', { kind: 'check' })}>
          {busy === 'check' ? 'Checking…' : 'Check now'}
        </button>
        <button type="button" style={{ ...S.btn, ...(staged ? S.primary : {}) }} disabled={!!busy || !staged}
          onClick={() => void run('apply', { kind: 'apply' })}>
          Restart to update
        </button>
        <button type="button" style={S.btn} disabled={!!busy || !status.rollback_available}
          onClick={() => void run('rollback', { kind: 'rollback' })}>
          Roll back
        </button>
      </div>

      <div style={{ ...S.card, display: 'grid', gap: 12 }}>
        <label style={S.row}>
          <span style={S.label}>Update channel</span>
          <select value={isChannel(status.channel) ? status.channel : 'stable'} disabled={!!busy}
            onChange={(e) => void run('channel', { kind: 'channel', channel: e.target.value })}
            style={{ ...S.btn, padding: '6px 10px' }}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>{c === 'stable' ? 'Stable (recommended)' : 'Beta (unproven builds)'}</option>
            ))}
          </select>
        </label>
        {status.channel === 'beta' && (
          <p style={{ ...S.muted, color: TONE_COLOR.warn }}>{CONFIRM_TEXT.beta}</p>
        )}
        <label style={S.row}>
          <input type="checkbox" checked={autoApplyOn(status)} disabled={!!busy}
            onChange={(e) => void run('auto-apply', { kind: 'auto-apply', on: e.target.checked })} />
          <span>Restart automatically when a verified update is ready</span>
        </label>
      </div>

      {note && <p style={S.muted} role="alert">{note}</p>}
    </section>
  )
}
