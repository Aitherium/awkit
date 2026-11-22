/**
 * The time-of-day greeting, from the READER'S clock.
 *
 * One answer for every surface that greets: the Living Desktop's Home window and the
 * executive briefing panel. The briefing used to print the backend's `greeting`, which
 * the server derives from `datetime.utcnow()`: measured 2026-11-16 on a tenant host,
 * the panel said "Good morning" at 08:49 PM Pacific (04:49 UTC). A server cannot know
 * the reader's hour; the browser always does.
 *
 * Call it AFTER mount (or from client-only data): on a static export a render-time
 * hour is evaluated at build time and React tears the tree down on hydration (#418).
 */
export function greetingForHour(hour: number): string {
  if (!Number.isFinite(hour)) return 'Hello'
  if (hour < 5) return 'Working late'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}
