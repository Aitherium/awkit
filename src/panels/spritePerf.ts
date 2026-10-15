/**
 * The Sprite's performance budget (kids suite S6): sustained >= 30 fps, frame p95 <= 33 ms on
 * the Pixel Tablet. The live 3D creature measures its first three seconds of frames; when the
 * p95 frame time is over 40 ms, the device has 4 GB of memory or less, or the child asked for
 * reduced motion, it drops to the snapshot PNG with a CSS breathe. Pure functions, so the rule
 * is tested, and the same rule runs in every host (Veil, awdesk, awconnect).
 */

/** How long the live creature is measured before the verdict. */
export const PERF_WINDOW_MS = 3000
/** The target: the Pixel Tablet must hold frame p95 at or under this. */
export const PERF_TARGET_P95_MS = 33
/** Over this p95 in the first window, the device drops to the snapshot. */
export const PERF_FALLBACK_P95_MS = 40
/** Devices with this much memory (GB, navigator.deviceMemory) or less never run the live creature. */
export const PERF_LOW_MEMORY_GB = 4
/** Fewer frames than this in the window is no measurement (a hidden tab): keep measuring. */
export const PERF_MIN_FRAMES = 20

export interface PerfEnv {
  deviceMemory?: number | null
  reducedMotion?: boolean
}

export type PerfMode = 'live' | 'snapshot' | 'measuring'

export interface PerfVerdict {
  mode: PerfMode
  p95: number | null
  reason: 'ok' | 'slow' | 'low-memory' | 'reduced-motion' | 'measuring'
}

/** The p-th percentile of a sample (nearest rank), or null when empty. Pure. */
export function percentile(samples: readonly number[], p: number): number | null {
  const xs = samples.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b)
  if (!xs.length) return null
  const rank = Math.min(xs.length - 1, Math.max(0, Math.ceil((p / 100) * xs.length) - 1))
  return xs[rank]
}

/** Before anything is drawn: may this device run the live creature at all? Pure. */
export function preflight(env: PerfEnv): PerfVerdict | null {
  if (env.reducedMotion) return { mode: 'snapshot', p95: null, reason: 'reduced-motion' }
  if (typeof env.deviceMemory === 'number' && env.deviceMemory > 0 && env.deviceMemory <= PERF_LOW_MEMORY_GB) {
    return { mode: 'snapshot', p95: null, reason: 'low-memory' }
  }
  return null
}

/** The verdict from frame times (ms) measured over `elapsedMs` of the first window. Pure. */
export function perfVerdict(frameMs: readonly number[], elapsedMs: number, env: PerfEnv = {}): PerfVerdict {
  const pre = preflight(env)
  if (pre) return pre
  const p95 = percentile(frameMs, 95)
  if (elapsedMs < PERF_WINDOW_MS || frameMs.length < PERF_MIN_FRAMES || p95 === null) {
    return { mode: 'measuring', p95, reason: 'measuring' }
  }
  return p95 > PERF_FALLBACK_P95_MS ? { mode: 'snapshot', p95, reason: 'slow' } : { mode: 'live', p95, reason: 'ok' }
}
