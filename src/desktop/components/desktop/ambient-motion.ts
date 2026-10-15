'use client'

/* Animated desktop backgrounds are OPT-IN (owner 2026-10-14).

   The Living Desktop's "Animated background" switch persists to the key below
   (AitherVeil components/os/universe/universe-settings.ts). This shell honours
   the SAME stored choice so one switch governs both desktops, without awkit
   importing Veil. Default OFF; prefers-reduced-motion forces OFF. */

import { useEffect, useState } from 'react'

/** Same key and change event as Veil's universe-settings.ts — keep in step. */
export const AMBIENT_SETTINGS_KEY = 'aitheros:universe-settings:v1'
export const AMBIENT_SETTINGS_CHANGED = 'aitheros:universe-settings-changed'

/** True only when the user turned the animated background ON and the device
 *  does not ask for reduced motion. Never throws; false on the server. */
export function animatedBackgroundAllowed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
    const raw = window.localStorage.getItem(AMBIENT_SETTINGS_KEY)
    if (!raw) return false
    return (JSON.parse(raw) as { animated?: unknown })?.animated === true
  } catch {
    return false
  }
}

/** Live view of animatedBackgroundAllowed(); false on first render. */
export function useAnimatedBackgroundAllowed(): boolean {
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    const read = () => setAllowed(animatedBackgroundAllowed())
    read()
    window.addEventListener(AMBIENT_SETTINGS_CHANGED, read)
    window.addEventListener('storage', read)
    return () => {
      window.removeEventListener(AMBIENT_SETTINGS_CHANGED, read)
      window.removeEventListener('storage', read)
    }
  }, [])
  return allowed
}
