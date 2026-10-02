import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ═══════════════════════════════════════════════════════════════════════════
// Demo mode detection + easter egg unlock system
// ═══════════════════════════════════════════════════════════════════════════

const UNLOCK_STORAGE_KEY = 'aitheros-mode-override'
// Obfuscated verification — not plaintext in source
// The passphrase hash is computed at check time via simple FNV-1a
const UNLOCK_HASH_A = 0xb277_f5c1  // primary
const UNLOCK_HASH_B = 0x76aa_a343  // secondary

function fnv1a(str: string): number {
  let h = 0x811c_9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x0100_0193)
  }
  return h >>> 0
}

/** Check if a passphrase matches the unlock code */
export function verifyPassphrase(input: string): boolean {
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
  const hash = fnv1a(normalized)
  return hash === UNLOCK_HASH_A || hash === UNLOCK_HASH_B
}

/** Exit demo mode (unlock the site) */
export function exitDemoMode(): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(UNLOCK_STORAGE_KEY, 'ascended')
  // Dispatch event so components can react without reload
  window.dispatchEvent(new CustomEvent('aitheros-mode-change', { detail: { demo: false } }))
}

/** Re-enter demo mode (lock the site) */
export function enterDemoMode(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(UNLOCK_STORAGE_KEY)
  window.dispatchEvent(new CustomEvent('aitheros-mode-change', { detail: { demo: true } }))
}

/** Check if the site has been unlocked via easter egg */
export function isUnlocked(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(UNLOCK_STORAGE_KEY) === 'ascended'
}

// ═══════════════════════════════════════════════════════════════════════════
// Guided Tour easter egg — triggered from Genesis companion chat
// ═══════════════════════════════════════════════════════════════════════════

const TOUR_HASH_A = 0x62de_0710  // primary trigger phrase
const TOUR_HASH_B = 0xf22c_8a47  // secondary trigger phrase
const TOUR_HASH_C = 0x9686_8d19  // genesis

/** Check if a chat message is the guided tour trigger */
export function isTourTrigger(input: string): boolean {
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
  const hash = fnv1a(normalized)
  return hash === TOUR_HASH_A || hash === TOUR_HASH_B || hash === TOUR_HASH_C
}

/** Emit the guided tour activation event (listened by demo page) */
export function emitTourActivation(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('aitheros-guided-tour', { detail: { activate: true } }))
}

export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false

  // Easter egg: if unlocked via passphrase, demo mode is OFF
  if (isUnlocked()) return false

  // Authenticated users are NEVER in demo mode — they have real access.
  // Auth state is persisted in localStorage by AuthProvider.
  try {
    const token = localStorage.getItem('aither_auth_token')
    const user = localStorage.getItem('aither_auth_user')
    if (token && user) return false
  } catch (_e) { /* localStorage blocked — fall through to demo checks */ }

  // Check build-time env var (baked in during CI)
  if (process.env.NEXT_PUBLIC_IS_STATIC_EXPORT === 'true') return true
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return true
  
  // Runtime detection: Check hostname for known static deployments
  const hostname = window.location.hostname
  
  // GitHub Pages: Always demo mode (static export, no API routes)
  if (hostname.endsWith('.github.io')) return true
  
  // aitherium.com: This is the GitHub Pages custom domain - demo mode
  if (hostname === 'aitherium.com' || hostname === 'www.aitherium.com') return true
  
  // demo.aitherium.com is the LIVE instance — NOT demo mode.
  // Unauthenticated users land on /dashboard → middleware redirects to /login
  // (full auth surface: CF SSO, password, WebAuthn, etc.)
  
  // saga.aitherium.com: Public Saga storytelling demo
  if (hostname === 'saga.aitherium.com') return true
  
  return false
}

export function getAppLaunchHref(): string {
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_IS_STATIC_EXPORT === 'true' || process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
      ? '/gate'
      : '/dashboard'
  }

  return isDemoMode() ? '/gate' : '/dashboard'
}

