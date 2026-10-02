/**
 * License expiry and renewal lifecycle -- the types and the pure banner logic.
 *
 * Contract: aither-license-lifecycle(7). `awnix-renewal evaluate` writes
 * /var/lib/aither/license/lifecycle.json; `aitheros status --json` merges it read-only
 * as `lifecycle`, so GET /api/appliance/license carries it. The rule every string here
 * keeps: an expired or lapsed license NEVER stops the appliance serving. Only updates,
 * private pulls and new licensed installs pause, and only after the grace period.
 *
 * These types are owned here (not in ./types.ts) so this file has no dependency on the
 * console's contract module; RenewalBanner.tsx re-exports them.
 */

export type Phase =
  | 'perpetual'
  | 'active'
  | 'renew-soon'
  | 'grace'
  | 'lapsed'
  | 'revoked'
  | 'unlicensed'
  | 'invalid'
  | 'unknown'

export type Reminder = 'none' | 'info' | 'warn' | 'urgent' | 'grace' | 'lapsed'

export type ClockState = 'ok' | 'unsynced' | 'rolled-back' | 'behind-build'

export interface LifecycleClock {
  state: ClockState
  /** The trusted time the phase was judged at (unix seconds). */
  trusted_now: number
  wall_now: number
  detail?: string
}

export interface LifecycleGates {
  updates: boolean | null
  'private-pulls': boolean | null
  'component-install': boolean | null
  packs?: boolean | null
}

/** /var/lib/aither/license/lifecycle.json, schema 1. */
export interface Lifecycle {
  schema: 1
  phase: Phase
  /** The activation `state` from status.json, copied and never changed. */
  state: string | null
  /** Expiry, unix seconds; 0 or null = no expiry. */
  exp: number | null
  days_to_expiry: number | null
  grace_until: number | null
  reminder: Reminder
  reminder_due?: boolean
  detail?: string
  clock: LifecycleClock
  gates: LifecycleGates
  keeps_serving?: string[]
  computed_at?: string | null
}

export type BannerTone = 'info' | 'warn' | 'danger'

export interface Banner {
  tone: BannerTone
  title: string
  body: string
  /** Where "Renew" goes: the console's License tab. */
  cta: { label: string; href: string } | null
  /** Set when the clock is not trusted: explains why the dates may not match the wall clock. */
  hint?: string
}

export const PHASES: ReadonlyArray<Phase> = [
  'perpetual', 'active', 'renew-soon', 'grace', 'lapsed', 'revoked', 'unlicensed', 'invalid',
  'unknown',
]

/** The lapsed copy the contract pins, word for word. */
export const LAPSED_BODY = 'Your appliance keeps running. Updates paused until you renew.'

export const RENEW_CTA = { label: 'Renew', href: '#/license' } as const

const DAY = 86400

/** YYYY-MM-DD in UTC, or '' when the timestamp is missing. */
export function isoDay(ts: number | null | undefined): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return ''
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

/** "in 12 days" / "tomorrow" / "today". */
export function daysText(days: number | null | undefined): string {
  if (typeof days !== 'number' || !Number.isFinite(days)) return ''
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

function clockHint(lc: Lifecycle): string | undefined {
  const st = lc.clock?.state
  if (!st || st === 'ok') return undefined
  if (st === 'rolled-back') {
    return 'The appliance clock is behind the last trusted time, so dates are judged from the trusted time.'
  }
  if (st === 'behind-build') {
    return 'The appliance clock reads earlier than this image was built, so dates are judged from the build time.'
  }
  return 'The appliance clock is not synchronised; dates are judged from the last trusted time.'
}

/**
 * Pull the lifecycle out of whatever the license endpoint returned: the status document
 * with a `lifecycle` key (the contract), or a bare lifecycle document. Anything that is
 * not recognisably a schema-1 lifecycle gives null (and so no banner), never a guess.
 */
export function readLifecycle(data: unknown): Lifecycle | null {
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  const cand = (obj.lifecycle && typeof obj.lifecycle === 'object' ? obj.lifecycle : obj) as Record<string, unknown>
  if (typeof cand.phase !== 'string' || !(PHASES as string[]).includes(cand.phase)) return null
  if (!cand.clock || typeof cand.clock !== 'object') return null
  return cand as unknown as Lifecycle
}

/**
 * The banner for a lifecycle, or null when nothing is due. Pure: no dates are read from
 * the browser clock -- the box's trusted clock already decided the phase and the days.
 *
 *   perpetual, unlicensed, unknown, active with reminder 'none'  -> null
 *   active with reminder 'info' (60..31 days)                    -> info
 *   renew-soon                                                   -> warn (danger at <= 7 days)
 *   grace                                                        -> warn
 *   lapsed, revoked, invalid                                     -> danger
 */
export function bannerFor(lc: Lifecycle | null | undefined): Banner | null {
  if (!lc || typeof lc !== 'object') return null
  const hint = clockHint(lc)
  const withHint = (b: Banner): Banner => (hint ? { ...b, hint } : b)
  const expDay = isoDay(lc.exp)
  const graceDay = isoDay(lc.grace_until)
  switch (lc.phase) {
    case 'perpetual':
    case 'unlicensed':
    case 'unknown':
      return null
    case 'active':
    case 'renew-soon': {
      if (lc.reminder === 'none' && lc.phase === 'active') return null
      const days = lc.days_to_expiry
      const urgent = lc.reminder === 'urgent' || (typeof days === 'number' && days <= 7)
      const when = daysText(days)
      return withHint({
        tone: urgent ? 'danger' : lc.phase === 'renew-soon' ? 'warn' : 'info',
        title: when ? `License expires ${when}` : 'License expires soon',
        body:
          `Your license expires${expDay ? ` on ${expDay}` : ''}. Everything keeps running after that; ` +
          `renew to keep receiving updates.`,
        cta: RENEW_CTA,
      })
    }
    case 'grace': {
      const now = lc.clock?.trusted_now
      const left =
        typeof lc.grace_until === 'number' && typeof now === 'number'
          ? Math.max(0, Math.ceil((lc.grace_until - now) / DAY))
          : null
      return withHint({
        tone: 'warn',
        title: 'License expired: grace period',
        body:
          `Your license expired${expDay ? ` on ${expDay}` : ''}. Your appliance keeps running. ` +
          `Updates, private pulls and new licensed installs pause` +
          `${graceDay ? ` on ${graceDay}` : ' when the grace period ends'}` +
          `${left !== null ? ` (${left} ${left === 1 ? 'day' : 'days'} left)` : ''}.`,
        cta: RENEW_CTA,
      })
    }
    case 'lapsed':
      return withHint({
        tone: 'danger',
        title: 'License lapsed',
        body: LAPSED_BODY,
        cta: RENEW_CTA,
      })
    case 'revoked':
      return withHint({
        tone: 'danger',
        title: 'License revoked',
        body: 'Your appliance keeps running. Updates, private pulls and new licensed installs are stopped.',
        cta: RENEW_CTA,
      })
    case 'invalid':
      return withHint({
        tone: 'danger',
        title: 'License not accepted',
        body:
          'Your appliance keeps running. Updates and private pulls are stopped until a valid license is imported.',
        cta: RENEW_CTA,
      })
    default:
      return null
  }
}
