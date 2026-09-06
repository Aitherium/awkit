'use client'

/**
 * Tour — a first-run coachmark that walks a human through a surface.
 *
 * Unlike the onboarding WIZARD (which is about adding content), the tour is
 * about learning the room: each step highlights a real control via a CSS
 * selector and explains what it does. A step may open a room summons first
 * (`/space`, `/local`, `/hardware`) so the tour can highlight inside the panel
 * it teaches.
 *
 *   <Tour
 *     storageKey="gargbot_toured"
 *     steps={[
 *       { targetSel: '[data-tour="composer"]', title: 'Say something', body: '…' },
 *       { targetSel: '[data-tour="beadspace"]', title: 'The universe', body: '…', summon: 'bead-space' },
 *     ]}
 *     onSummon={(s) => roomRef.current?.summon(s)}
 *   />
 *
 * Completion is persisted under `storageKey` ("Don't show again" and finishing
 * both persist; Skip does not, so a skipped tour can return). Safe under SSR:
 * nothing reads the DOM or localStorage until after mount. `onSummon` is read
 * through a ref so an inline prop identity never re-arms the measurement loop.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'

export interface TourStep {
  /** CSS selector for the element to spotlight. */
  targetSel: string
  title: string
  body: string
  placement?: 'top' | 'bottom' | 'left' | 'right'
  /** If set, the host opens this room summons before the step is shown. */
  summon?: string
}

export interface TourProps {
  steps: TourStep[]
  /** localStorage key — set once the tour is completed or dismissed forever. */
  storageKey: string
  /** Host callback to open a room summons (e.g. 'bead-space' | 'on-device' | 'hardware'). */
  onSummon?: (summon: string) => void
  /** Fired when the tour closes by any path. */
  onDone?: () => void
}

const CARD_WIDTH = 340
const GAP = 14
const EDGE = 12

export default function Tour({ steps, storageKey, onSummon, onDone }: TourProps) {
  const [ready, setReady] = useState(false)
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null)

  const step = steps[index] ?? steps[0]

  // Stable across renders even when the host passes an inline arrow — the
  // measurement loop must not re-arm (and re-summon) on every render.
  const onSummonRef = useRef(onSummon)
  onSummonRef.current = onSummon

  const measure = useCallback(() => {
    if (!step || typeof document === 'undefined') return
    const el = document.querySelector(step.targetSel)
    if (!el) {
      setRect(null)
      return
    }
    const r = el.getBoundingClientRect()
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [step?.targetSel])

  // Nothing until mounted — SSR-safe (no window/localStorage on first render).
  useEffect(() => { setReady(true) }, [])

  // Open the summons this step targets (if any), then keep re-measuring while
  // the panel mounts and on any resize/scroll. `step` is a stable reference
  // while the prop array is stable, so this arms once per step.
  useEffect(() => {
    if (!step) return
    if (step.summon && onSummonRef.current) onSummonRef.current(step.summon)
    measure()
    const timer = window.setInterval(measure, 400)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [index, measure, step])

  if (!ready || !step) return null
  if (window.localStorage.getItem(storageKey)) return null

  const persist = () => { window.localStorage.setItem(storageKey, '1') }
  const finish = () => { persist(); onDone?.() }

  const last = index === steps.length - 1

  // ── Card placement: near the target, clamped into the viewport ───────────
  const placement = step.placement || 'bottom'
  let card: CSSProperties | null = null
  if (rect) {
    let top: number
    let left: number
    if (placement === 'bottom') {
      top = rect.top + rect.height + GAP
      left = rect.left + rect.width / 2 - CARD_WIDTH / 2
    } else if (placement === 'top') {
      top = rect.top - GAP - 190
      left = rect.left + rect.width / 2 - CARD_WIDTH / 2
    } else if (placement === 'right') {
      top = rect.top + rect.height / 2 - 90
      left = rect.left + rect.width + GAP
    } else {
      top = rect.top + rect.height / 2 - 90
      left = rect.left - GAP - CARD_WIDTH
    }
    top = Math.max(EDGE, Math.min(top, window.innerHeight - 200))
    left = Math.max(EDGE, Math.min(left, window.innerWidth - CARD_WIDTH - EDGE))
    card = { top, left }
  } else {
    // Target not found yet (panel still mounting, or a selector drifted) — hold
    // the card center-screen rather than over nothing.
    card = {
      top: Math.max(EDGE, window.innerHeight / 2 - 110),
      left: Math.max(EDGE, window.innerWidth / 2 - CARD_WIDTH / 2),
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Tour — ${step.title}`} style={{
      position: 'fixed', inset: 0, zIndex: 5000,
    }}>
      {/* Spotlight: a transparent hole over the target, dim everywhere else. */}
      {rect && (
        <div style={{
          position: 'fixed', top: rect.top - 4, left: rect.left - 4,
          width: rect.width + 8, height: rect.height + 8,
          borderRadius: 8, pointerEvents: 'none', transition: 'all 0.2s',
          boxShadow:
            '0 0 0 9999px oklch(0 0 0 / 0.45), 0 0 0 3px var(--accent-primary)',
        }} />
      )}
      {!rect && <div style={{ position: 'fixed', inset: 0, background: 'oklch(0 0 0 / 0.45)' }} />}

      {/* Click anywhere on the dimmed page to skip the tour for now. */}
      <div onClick={onDone} style={{ position: 'fixed', inset: 0, cursor: 'pointer' }} />

      {/* The step card. */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed', ...card, zIndex: 5001, width: CARD_WIDTH,
          maxWidth: 'calc(100vw - 2rem)', padding: '1.1rem 1.2rem',
          background: 'var(--bg-surface)', color: 'var(--text-primary)',
          border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-lg)',
          boxShadow: '0 16px 48px oklch(0 0 0 / 0.4)',
        }}
      >
        <div style={{
          fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.08em',
          color: 'var(--text-muted)', marginBottom: '0.35rem',
        }}>
          {index + 1} / {steps.length}
        </div>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.4rem' }}>{step.title}</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 1rem' }}>
          {step.body}
        </p>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            style={navBtn(false, index === 0)}
          >
            Back
          </button>
          {last ? (
            <button onClick={finish} style={navBtn(true, false)}>Done</button>
          ) : (
            <button onClick={() => setIndex((i) => i + 1)} style={navBtn(true, false)}>Next</button>
          )}
          <span style={{ flex: 1 }} />
          <button
            onClick={finish}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontSize: '0.72rem', color: 'var(--text-muted)' }}
          >
            Don't show again
          </button>
        </div>
      </div>
    </div>
  )
}

function navBtn(primary: boolean, disabled: boolean): CSSProperties {
  return {
    padding: primary ? '0.55rem 1.1rem' : '0.5rem 1rem',
    background: primary ? 'var(--accent-primary)' : 'var(--bg-elevated)',
    color: primary ? 'var(--bg-deep)' : 'var(--text-primary)',
    border: primary ? 'none' : '1px solid var(--glass-border)',
    borderRadius: 'var(--radius)',
    fontSize: '0.8rem',
    fontWeight: primary ? 600 : 500,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1,
  }
}
