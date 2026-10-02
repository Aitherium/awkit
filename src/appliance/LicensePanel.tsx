/**
 * LicensePanel -- the appliance's Activation tab (#/license).
 *
 * Reads the ONE activation state the box keeps, /var/lib/aither/license/status.json,
 * through the :9443 console (GET /api/appliance/license = `aitheros status --json`), and
 * drives exactly two console actions: `license-import` (paste or upload an AITHER1
 * envelope; the console pipes it to `aitheros license import -` as root) and
 * `license-refresh` (`aitheros license refresh --json`). It never re-derives the state:
 * the badge is the status enum, and a refused/invalid detail is shown verbatim.
 *
 * Every non-success is an explicit state, never an empty success:
 *   501 -> "not an appliance" (no /usr/libexec/awnix on this host)
 *   409 -> the CLI said no (exit 1); its status JSON is still rendered
 *   503 -> could not judge (offline); the status is still rendered when present
 *   401/423 -> a notice (the shell's login screen takes over on 401)
 *
 * Contract types and the client come from ./types and ./client (console-surfaces);
 * this file declares no contract shape of its own. Vite-safe (no next/*),
 * appliance.css (awkit-vars tokens) only, light and dark, usable at 360 px.
 */
import { useCallback, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { Badge, StateNotice, useApplianceCall } from './ApplianceConsole'
import type {
  ApiResult,
  AppliancePanelProps,
  LicenseState,
  LicenseStatus,
  RegistryState,
} from './types'

export const MAX_LICENSE_BYTES = 16 * 1024
const ENVELOPE_RE = /^AITHER1\.[A-Za-z0-9_-]+={0,2}\.[A-Za-z0-9_-]+={0,2}$/
const STATES: LicenseState[] = [
  'unlicensed', 'valid', 'expired', 'invalid', 'revoked', 'refused', 'offline',
]

/** Shape check only; the box verifies the signature as root. */
export function envelopeShapeError(text: string): string | null {
  const t = text.trim()
  if (!t) return 'Paste the license (it starts with AITHER1.).'
  if (new TextEncoder().encode(t).length > MAX_LICENSE_BYTES) {
    return 'That is larger than 16 KiB; it is not a license.'
  }
  if (!ENVELOPE_RE.test(t)) {
    return 'That does not look like a license: expected AITHER1.<payload>.<signature>.'
  }
  return null
}

/** A status.json document, and not an action envelope that merely carries `state`. */
export function isLicenseStatus(x: unknown): x is LicenseStatus {
  if (!x || typeof x !== 'object') return false
  const o = x as LicenseStatus
  return (
    o.schema === 1 && STATES.includes(o.state) && !!o.registry && typeof o.registry === 'object'
  )
}

type Verb = 'license-import' | 'license-refresh'
export type Outcome = { ok: boolean; message: string }

/** What an action result means for the person who pressed the button. */
export function outcomeFor(verb: Verb, r: ApiResult<unknown>): Outcome {
  if (r.status === 501) return { ok: false, message: 'This machine is not an appliance.' }
  const st = isLicenseStatus(r.data) ? r.data : null
  if (r.state === 'ok' && (!st || st.state === 'valid')) {
    return {
      ok: true,
      message: verb === 'license-import' ? 'License activated.' : 'Checked just now.',
    }
  }
  // A refusal is shown verbatim: the CLI's detail, else the console's, else the code.
  return {
    ok: false,
    message: st?.detail || r.detail || r.stdoutTail || `HTTP ${r.status || 'no answer'}`,
  }
}

// ── presentation ────────────────────────────────────────────────────────────

const BADGE: Record<LicenseState, { label: string; tone: string }> = {
  valid: { label: 'Active', tone: 'ok' },
  unlicensed: { label: 'Not activated', tone: 'muted' },
  offline: { label: 'Offline — could not check', tone: 'warn' },
  expired: { label: 'Expired', tone: 'danger' },
  invalid: { label: 'Invalid', tone: 'danger' },
  revoked: { label: 'Revoked', tone: 'danger' },
  refused: { label: 'Refused', tone: 'danger' },
}

const REGISTRY_LABEL: Record<RegistryState, string> = {
  armed: 'Private images and updates can be pulled',
  refused: 'Registry access refused',
  offline: 'Registry not reachable right now',
  unconfigured: 'No registry access',
  'legacy-token': 'Using a pre-license update token',
}

function fmtExp(exp: number | null): string {
  if (!exp) return 'Never (perpetual)'
  const d = new Date(exp * 1000)
  const days = Math.round((exp * 1000 - Date.now()) / 86400000)
  const rel =
    days >= 0
      ? `in ${days} day${days === 1 ? '' : 's'}`
      : `${-days} day${days === -1 ? '' : 's'} ago`
  return `${d.toISOString().slice(0, 10)} (${rel})`
}

function fmtIso(v: string | null): string {
  if (!v) return '—'
  const t = Date.parse(v)
  if (Number.isNaN(t)) return v
  return `${new Date(t).toISOString().replace('T', ' ').slice(0, 16)} UTC`
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="awx-row">
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export default function LicensePanel({ client }: AppliancePanelProps) {
  const { result, loading, reload } = useApplianceCall(() => client.license())
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'' | 'import' | 'refresh'>('')
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [actionStatus, setActionStatus] = useState<LicenseStatus | null>(null)
  const [notAppliance, setNotAppliance] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const run = useCallback(
    async (verb: Verb) => {
      setBusy(verb === 'license-import' ? 'import' : 'refresh')
      setOutcome(null)
      try {
        const r =
          verb === 'license-import'
            ? await client.action('license-import', { license: text.trim() })
            : await client.action('license-refresh', {})
        if (r.status === 501) {
          setNotAppliance(true)
          return
        }
        const o = outcomeFor(verb, r)
        setOutcome(o)
        setActionStatus(isLicenseStatus(r.data) ? r.data : null)
        if (o.ok && verb === 'license-import') setText('')
        // status.json is the source of truth: re-read it whatever the action printed.
        const fresh = await reload()
        if (isLicenseStatus(fresh.data)) setActionStatus(null)
      } finally {
        setBusy('')
      }
    },
    [client, reload, text],
  )

  const onFile = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > MAX_LICENSE_BYTES) {
      setOutcome({ ok: false, message: 'That file is larger than 16 KiB; it is not a license.' })
      return
    }
    setText((await f.text()).trim())
  }, [])

  if (!result) {
    return (
      <p className="awx-muted" aria-busy="true">
        Loading activation state…
      </p>
    )
  }
  if (notAppliance || result.status === 501 || result.state === 'not-an-appliance') {
    return (
      <section className="awx-card" data-testid="license-not-appliance">
        <h2>Not an appliance</h2>
        <p className="awx-muted">
          This host has no appliance activation plane (aitheros is not installed), so there
          is no license to show here.
        </p>
      </section>
    )
  }

  // The CLI's status is rendered whatever the HTTP verdict was (409 revoked, 503
  // offline): the verdict IS the status. With no status at all, the notice is the view.
  const status: LicenseStatus | null = isLicenseStatus(result.data) ? result.data : actionStatus
  const shapeErr = text ? envelopeShapeError(text) : null
  const notice = status
    ? null
    : result.state !== 'ok'
      ? result
      : { state: 'error' as const, status: result.status, detail: 'the console returned no license status' }

  return (
    <section className="awx-grid" data-testid="license-panel" aria-busy={loading || undefined}>
      <article className="awx-card" aria-labelledby="lic-h">
        <div className="awx-card-head">
          <h2 id="lic-h">License</h2>
          {status ? (
            <span data-testid="license-badge" data-state={status.state}>
              <Badge tone={BADGE[status.state].tone}>{BADGE[status.state].label}</Badge>
            </span>
          ) : null}
        </div>
        {notice ? (
          <div data-testid="license-error" data-http={notice.status}>
            <StateNotice result={notice} onRetry={() => void reload()} />
          </div>
        ) : null}
        {status ? (
          <>
            <dl className="awx-dl">
              {status.sku ? <Row k="Product">{status.sku}</Row> : null}
              {status.tier ? (
                <Row k="Tier">
                  {status.entitlements?.appliance_tier
                    ? `${status.tier} / ${status.entitlements.appliance_tier}`
                    : status.tier}
                </Row>
              ) : null}
              {status.lic_id ? (
                <Row k="License ID">
                  <code>{status.lic_id}</code>
                </Row>
              ) : null}
              {status.lic_id ? <Row k="Expires">{fmtExp(status.exp)}</Row> : null}
              <Row k="Registry">
                <span data-testid="license-registry" data-state={status.registry.state}>
                  {REGISTRY_LABEL[status.registry.state] ?? status.registry.state}
                  {status.registry.expires_at
                    ? ` — token until ${fmtIso(status.registry.expires_at)}`
                    : ''}
                </span>
              </Row>
              {status.entitlements?.images?.length ? (
                <Row k="Private images">{status.entitlements.images.length}</Row>
              ) : null}
              <Row k="Checked">{fmtIso(status.checked_at)}</Row>
            </dl>
            {status.detail && status.state !== 'valid' ? (
              <pre className="awx-command" data-testid="license-detail">
                {status.detail}
              </pre>
            ) : null}
            {status.state === 'expired' || status.state === 'revoked' ? (
              <p className="awx-muted">
                The product keeps running. Updates and private components stop until the
                license is renewed.
              </p>
            ) : null}
          </>
        ) : null}
        <p>
          <button
            type="button"
            className="awx-btn awx-btn-quiet"
            disabled={!!busy}
            onClick={() => void run('license-refresh')}
          >
            {busy === 'refresh' ? 'Checking…' : 'Check now'}
          </button>
        </p>
      </article>

      <article className="awx-card" aria-labelledby="lic-import-h">
        <h2 id="lic-import-h">{status?.state === 'valid' ? 'Replace the license' : 'Activate'}</h2>
        <p className="awx-muted">
          Paste the license from your purchase email, or upload license.lic. It is verified
          on this machine and sent nowhere except the license exchange. From a shell:{' '}
          <code>sudo aitheros login --license @license.lic</code>
        </p>
        <label className="awx-field">
          <span>License envelope</span>
          <textarea
            className="awx-input"
            rows={4}
            spellCheck={false}
            autoComplete="off"
            placeholder="AITHER1.…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        {shapeErr ? (
          <p className="awx-inline-msg awx-tone-danger" data-testid="license-shape-error">
            {shapeErr}
          </p>
        ) : null}
        <p>
          <button
            type="button"
            className="awx-btn awx-btn-primary"
            disabled={!!busy || !text || !!shapeErr}
            onClick={() => void run('license-import')}
          >
            {busy === 'import' ? 'Activating…' : 'Activate'}
          </button>{' '}
          <button
            type="button"
            className="awx-btn awx-btn-quiet"
            disabled={!!busy}
            onClick={() => fileRef.current?.click()}
          >
            Upload license.lic
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".lic,text/plain"
            hidden
            data-testid="license-file"
            onChange={(e) => void onFile(e)}
          />
        </p>
        {outcome ? (
          <p
            role={outcome.ok ? 'status' : 'alert'}
            data-testid="license-outcome"
            data-ok={outcome.ok ? '1' : '0'}
            className={`awx-inline-msg awx-tone-${outcome.ok ? 'ok' : 'danger'}`}
          >
            {outcome.message}
          </p>
        ) : null}
      </article>
    </section>
  )
}
