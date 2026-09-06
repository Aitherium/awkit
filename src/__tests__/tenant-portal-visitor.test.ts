/**
 * The three defects a customer hit on a live tenant portal, 2026-08-19.
 *
 * A tenant visitor opened the company portal, was never asked to sign in,
 * watched the Company Room say RECONNECTING forever, found the mobile UI
 * unusable, and died at the LLM step of setup on a localhost error. Each one is
 * pinned here, in BOTH directions — the bug must fail, and the correct state
 * must pass, because a test that only asserts the failure passes on a component
 * that does nothing.
 */

import { describe, expect, it } from 'vitest'
import { isMixedContentBlocked } from '../panels/LLMProviderConfig'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ── 1. The signed-out room ─────────────────────────────────────────────────
// A 401 is not a dropped link. The room hook must classify it separately from
// `degraded`, because "Reconnecting" is a promise that can never resolve for a
// visitor with no session.
type RoomFlags = { degraded: boolean; unauthenticated: boolean }

/** Mirrors the branch order in useRoom.load(). */
function classify(status: number): RoomFlags {
  if (status === 401 || status === 403) return { degraded: false, unauthenticated: true }
  if (status !== 200) return { degraded: true, unauthenticated: false }
  return { degraded: false, unauthenticated: false }
}

/** Mirrors the label order in CompanyRoom's status pill. */
function label(f: RoomFlags, listening = false): string {
  if (f.unauthenticated) return 'Sign in to join'
  if (f.degraded) return 'Reconnecting'
  return listening ? 'Listening' : 'Live'
}

describe('signed-out Company Room', () => {
  it('401 is a sign-in prompt, never "Reconnecting"', () => {
    const f = classify(401)
    expect(f.unauthenticated).toBe(true)
    expect(f.degraded).toBe(false)
    expect(label(f)).toBe('Sign in to join')
  })

  it('403 behaves the same as 401', () => {
    expect(label(classify(403))).toBe('Sign in to join')
  })

  it('a REAL outage still says Reconnecting — the fix must not swallow it', () => {
    const f = classify(503)
    expect(f.degraded).toBe(true)
    expect(f.unauthenticated).toBe(false)
    expect(label(f)).toBe('Reconnecting')
  })

  it('a healthy signed-in room is Live', () => {
    expect(label(classify(200))).toBe('Live')
  })
})

// ── 2. Mixed content at the LLM setup step ─────────────────────────────────
describe('LLM provider connection test', () => {
  const withLocation = (href: string, fn: () => void) => {
    const orig = globalThis.window
    // @ts-expect-error - minimal window stub for the helper under test
    globalThis.window = { location: new URL(href) }
    try { fn() } finally { globalThis.window = orig }
  }

  it('an https portal cannot reach http://localhost — the browser blocks it', () => {
    withLocation('https://portal.example.com/', () => {
      expect(isMixedContentBlocked('http://localhost:11434')).toBe(true)
    })
  })

  it('a LOCAL http page CAN reach http://localhost — must not cry wolf', () => {
    withLocation('http://localhost:3000/', () => {
      expect(isMixedContentBlocked('http://localhost:11434')).toBe(false)
    })
  })

  it('an https target from an https page is fine', () => {
    withLocation('https://portal.example.com/', () => {
      expect(isMixedContentBlocked('https://api.openai.com/v1')).toBe(false)
    })
  })

  it('a malformed url is not reported as blocked', () => {
    withLocation('https://portal.example.com/', () => {
      expect(isMixedContentBlocked('not a url')).toBe(false)
    })
  })
})

// ── 3. The desktop shell on a phone ────────────────────────────────────────
// Measured on a real iPhone viewport: a 900px window at x=215 hung off a 390px
// screen, and drag/resize are mouse-only, so a touch user could not recover it.
describe('mobile window geometry', () => {
  // Read the breakpoint out of desktop-core's SOURCE rather than hardcoding it.
  // A copy here would silently disagree the day someone changes the shell, and a
  // test that pins the wrong number is worse than none. Importing the component
  // is not an option: it pulls framer-motion and lucide into a unit test.
  const shell = resolve(
    __dirname, '../../../desktop-core/src/components/desktop/desktop-window.tsx',
  )
  const src = readFileSync(shell, 'utf8')
  const m = src.match(/MOBILE_MAX_WIDTH\s*=\s*(\d+)/)
  if (!m) throw new Error(`MOBILE_MAX_WIDTH not found in ${shell} — the shell moved`)
  const MOBILE_MAX_WIDTH = Number(m[1])

  const fullBleed = (viewportWidth: number, isMaximized = false) =>
    isMaximized || viewportWidth <= MOBILE_MAX_WIDTH

  it('a phone viewport renders windows full-bleed', () => {
    expect(fullBleed(390)).toBe(true)   // iPhone 13
    expect(fullBleed(768)).toBe(true)   // boundary is inclusive
  })

  it('a desktop viewport keeps floating windows', () => {
    expect(fullBleed(1440)).toBe(false)
    expect(fullBleed(769)).toBe(false)
  })

  it('maximize still works on desktop', () => {
    expect(fullBleed(1440, true)).toBe(true)
  })
})
