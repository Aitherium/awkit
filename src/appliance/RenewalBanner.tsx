/**
 * RenewalBanner -- the console's license renewal reminder (aither-license-lifecycle(7)).
 *
 * Mounted above the console tabs (ApplianceConsole, console mode). It reads
 * GET /api/appliance/license through the appliance client and renders from its
 * `lifecycle` key. Every message says the appliance keeps running: expiry never stops
 * serving; only updates, private pulls and new licensed installs pause after the grace.
 *
 * Renders NOTHING when the endpoint is absent (501), unreachable (503), refused, carries
 * no lifecycle, or nothing is due -- a banner that can only appear on a real appliance
 * with a real reminder. awkit-vars tokens only (light and dark), wraps at 360 px, no
 * next/* imports.
 *
 *   import RenewalBanner, { bannerFor, type Lifecycle } from '@aitherium/awkit/appliance/RenewalBanner'
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { bannerFor, readLifecycle } from './renewal'
import type { Banner, BannerTone, Lifecycle } from './renewal'

export { bannerFor, readLifecycle, daysText, isoDay, LAPSED_BODY, RENEW_CTA, PHASES } from './renewal'
export type {
  Banner,
  BannerTone,
  ClockState,
  Lifecycle,
  LifecycleClock,
  LifecycleGates,
  Phase,
  Reminder,
} from './renewal'

/** The one method the banner needs; ApplianceClient satisfies it structurally. */
export interface RenewalLicenseSource {
  license(): Promise<{ state: string; status?: number; data: unknown }>
}

export interface RenewalBannerProps {
  client?: RenewalLicenseSource
  /** Render from a lifecycle already in hand (e.g. the License panel) instead of fetching. */
  lifecycle?: Lifecycle | null
  className?: string
}

const TONE_COLOR: Record<BannerTone, string> = {
  info: 'var(--accent-sky, var(--accent))',
  warn: 'var(--accent-warn)',
  danger: 'var(--accent-danger)',
}

function boxStyle(tone: BannerTone): CSSProperties {
  return {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px 16px',
    padding: '10px 16px',
    margin: 0,
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    borderBottom: '1px solid var(--border-subtle)',
    borderLeft: `4px solid ${TONE_COLOR[tone]}`,
    fontSize: 14,
    lineHeight: 1.45,
    boxSizing: 'border-box',
    maxWidth: '100%',
  }
}

const textStyle: CSSProperties = { flex: '1 1 220px', minWidth: 0, overflowWrap: 'anywhere' }
const hintStyle: CSSProperties = { display: 'block', marginTop: 2, color: 'var(--text-muted)', fontSize: 13 }
const ctaStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '6px 14px',
  borderRadius: 'var(--radius, 8px)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-primary)',
  textDecoration: 'none',
  fontWeight: 600,
}

export function RenewalBannerView({ banner, className }: { banner: Banner; className?: string }) {
  return (
    <div
      className={className}
      role={banner.tone === 'danger' ? 'alert' : 'status'}
      data-tone={banner.tone}
      data-testid="renewal-banner"
      style={boxStyle(banner.tone)}
    >
      <div style={textStyle}>
        <strong style={{ color: TONE_COLOR[banner.tone] }}>{banner.title}.</strong>{' '}
        <span>{banner.body}</span>
        {banner.hint ? (
          <small style={hintStyle} data-testid="renewal-clock-hint">
            {banner.hint}
          </small>
        ) : null}
      </div>
      {banner.cta ? (
        <a href={banner.cta.href} style={ctaStyle}>
          {banner.cta.label}
        </a>
      ) : null}
    </div>
  )
}

export default function RenewalBanner({ client, lifecycle, className }: RenewalBannerProps) {
  const [fetched, setFetched] = useState<Lifecycle | null>(null)
  const given = lifecycle !== undefined

  useEffect(() => {
    if (given || !client) return
    let live = true
    client
      .license()
      .then((res) => {
        if (!live) return
        // 501 (not an appliance), 503 (console down), refused, error: show nothing.
        setFetched(res && res.state === 'ok' ? readLifecycle(res.data) : null)
      })
      .catch(() => {
        if (live) setFetched(null)
      })
    return () => {
      live = false
    }
  }, [client, given])

  const banner = bannerFor(given ? lifecycle : fetched)
  if (!banner) return null
  return <RenewalBannerView banner={banner} className={className} />
}
