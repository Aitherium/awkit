/**
 * Google Play's payments policy inside the Aither app, for awkit panels.
 *
 * The same rule as AitherVeil's lib/aither-shell.ts (awkit cannot import Veil): the Play
 * build of the app ends its user agent with " AitherAndroid/<version> Play", and a panel
 * that sends the user to a checkout page does it through openCheckout, which refuses
 * there. A panel that offers a purchase also hides that control when usePlayShell() is
 * true, so the Play app shows nothing to buy. The message names no other place to pay
 * (that would be steering).
 */
import { useEffect, useState } from 'react'

export const AITHER_PLAY_UA = /AitherAndroid\/\S+ Play\b/

export const PLAY_NO_PURCHASE = "Purchases aren't available in the Google Play version of Aither."

export function isPlayShell(ua?: string): boolean {
  const s = ua ?? (typeof navigator !== 'undefined' ? navigator.userAgent || '' : '')
  return AITHER_PLAY_UA.test(s)
}

/** Navigate to a checkout page; false (and nothing opened) in the Play shell. */
export function openCheckout(url: string, opts: { newTab?: boolean; ua?: string } = {}): boolean {
  if (isPlayShell(opts.ua) || typeof window === 'undefined') return false
  if (opts.newTab) window.open(url, '_blank')
  else window.location.assign(url)
  return true
}

/** isPlayShell() for a component: false on the server and the first render, then the
 *  real answer (no hydration mismatch). */
export function usePlayShell(): boolean {
  const [inPlay, setInPlay] = useState(false)
  useEffect(() => setInPlay(isPlayShell()), [])
  return inPlay
}
