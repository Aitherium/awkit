/**
 * OverviewPanel -- the machine at a glance: identity, license, updates, console.
 * Reads GET /api/appliance/overview (an aggregate of the status files each plane
 * owns). Every card shows its plane's own state; nothing here re-derives a verdict.
 */
import type { ReactNode } from 'react'
import { Badge, StateNotice, useApplianceCall } from './ApplianceConsole'
import type { AppliancePanelProps, Overview } from './types'

const LICENSE_TONE: Record<string, string> = {
  valid: 'ok',
  unlicensed: 'muted',
  offline: 'warn',
  expired: 'danger',
  invalid: 'danger',
  revoked: 'danger',
  refused: 'danger',
  unavailable: 'muted',
}

const UPDATE_TONE: Record<string, string> = {
  current: 'ok',
  staged: 'warn',
  'never-checked': 'muted',
  offline: 'warn',
  'no-credential': 'muted',
  unavailable: 'muted',
}

function shortDigest(d?: string | null): string {
  if (!d) return '—'
  const hex = d.replace(/^sha256:/, '')
  return `sha256:${hex.slice(0, 12)}`
}

function uptime(s: number | null): string {
  if (s == null) return '—'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="awx-row">
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  )
}

export function OverviewPanel({ client }: AppliancePanelProps) {
  const { result, loading, reload } = useApplianceCall(() => client.overview())
  if (!result) return <p className="awx-muted" aria-busy="true">Loading…</p>
  if (result.state !== 'ok' || !result.data) {
    return <StateNotice result={result} onRetry={() => void reload()} />
  }
  const o: Overview = result.data
  const lic = o.license
  const upd = o.updates
  const days = lic.days_left
  return (
    <section className="awx-grid" aria-busy={loading || undefined}>
      <article className="awx-card">
        <h2>Machine</h2>
        <dl className="awx-dl">
          <Row k="Name" v={o.hostname} />
          <Row k="Image" v={o.variant} />
          <Row k="Up" v={uptime(o.uptime_s)} />
        </dl>
      </article>
      <article className="awx-card">
        <h2>License</h2>
        <p>
          <Badge tone={LICENSE_TONE[lic.state] ?? 'muted'}>{lic.state}</Badge>
        </p>
        <dl className="awx-dl">
          <Row k="Plan" v={lic.sku ?? '—'} />
          <Row
            k="Expires"
            v={lic.exp === 0 ? 'never' : days == null ? '—' : days < 0 ? 'expired' : `in ${days} days`}
          />
          <Row k="Private images" v={lic.registry ?? '—'} />
        </dl>
        {lic.state === 'expired' || lic.state === 'revoked' ? (
          <p className="awx-muted">
            The product keeps running. Updates and private components stop until the
            license is renewed.
          </p>
        ) : null}
      </article>
      <article className="awx-card">
        <h2>Updates</h2>
        <p>
          <Badge tone={UPDATE_TONE[upd.state ?? ''] ?? 'danger'}>{upd.state ?? 'unknown'}</Badge>
        </p>
        <dl className="awx-dl">
          <Row k="Channel" v={upd.channel ?? '—'} />
          <Row k="Running" v={<code>{shortDigest(upd.booted_digest)}</code>} />
          <Row k="Last check" v={upd.checked_at ?? 'never'} />
        </dl>
        <p className="awx-muted">Nothing restarts this machine on its own.</p>
      </article>
      <article className="awx-card">
        <h2>This console</h2>
        <dl className="awx-dl">
          <Row k="Address" v={<code>{o.console.url}</code>} />
          <Row
            k="Certificate"
            v={<code>{o.console.fingerprint ? o.console.fingerprint.slice(0, 12) : '—'}</code>}
          />
        </dl>
        <p className="awx-muted">
          Your browser warns about this certificate because the machine made it itself.
          Check that the fingerprint matches the one on the machine’s screen.
        </p>
      </article>
    </section>
  )
}

export default OverviewPanel
