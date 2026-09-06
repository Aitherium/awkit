// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * KV WINDOW PLANNING — which slices of a host-resident KV cache get streamed to
 * VRAM, in what order, for one attention call.
 *
 * Part of RAM-KV offload (D-1855). The master cache lives in host memory; only a
 * window of positions is resident on the GPU at a time. `refKv4SoftmaxAttnChunked`
 * (kernels/reference.ts) proved the ALGEBRA is safe — online softmax makes a
 * window boundary bit-exact, not approximate. This module owns the other half:
 * deciding the windows.
 *
 * IT IS SEPARATED FROM THE KERNEL ON PURPOSE. The failure modes of streaming are
 * not numerical, they are bookkeeping — a window that skips a position, one that
 * overlaps its neighbour, a causal edge computed against the wrong token, an
 * off-by-one on the last partial window. Every one of those produces plausible
 * output rather than a crash, and none of them needs a GPU to find. Keeping the
 * plan as pure data means it can be asserted exhaustively (see
 * `__tests__/kv-window-plan.test.ts`, which checks EXACT coverage of [0, last]
 * for thousands of shapes) and the kernel becomes a transcription of a plan that
 * is already known to be right.
 */

/** One streamed slice: cache positions `[lo, hi)`, absolute. */
export interface KvWindow {
  /** First cache position in this window (absolute, inclusive). */
  lo: number;
  /** One past the last cache position (absolute, exclusive). */
  hi: number;
  /** True for the first window of a query — the kernel INITIALISES its carry. */
  first: boolean;
  /**
   * True for the last window of a query — the kernel NORMALISES and writes out.
   * Normalising anywhere else is the boundary bug that looks correct, because a
   * single-window query is unaffected by it.
   */
  last: boolean;
}

/**
 * Plan the windows for ONE query token.
 *
 * @param lastPos  the causal limit — this query attends to `[0, lastPos]`
 *                 INCLUSIVE, i.e. `posBase + t` for token `t` of the batch.
 * @param windowSize how many cache positions fit in the VRAM window buffer.
 *
 * Returns windows covering exactly `[0, lastPos]`, in ascending order, each at
 * most `windowSize` wide and the final one possibly short. A query at position 0
 * still gets ONE window (covering `[0,1)`), never zero — attending to nothing
 * would silently produce a zero row, which reads as a plausible embedding rather
 * than as an error.
 */
export function planKvWindows(lastPos: number, windowSize: number): KvWindow[] {
  if (!Number.isInteger(lastPos) || lastPos < 0) {
    throw new Error(`planKvWindows: lastPos must be a non-negative integer (got ${lastPos})`);
  }
  if (!Number.isInteger(windowSize) || windowSize < 1) {
    throw new Error(`planKvWindows: windowSize must be a positive integer (got ${windowSize})`);
  }
  const total = lastPos + 1; // inclusive causal limit
  const out: KvWindow[] = [];
  for (let lo = 0; lo < total; lo += windowSize) {
    const hi = Math.min(lo + windowSize, total);
    out.push({ lo, hi, first: lo === 0, last: hi === total });
  }
  return out;
}

/**
 * How many positions the VRAM window should hold, given a byte budget.
 *
 * Returned as a POSITION count because that is the unit everything downstream
 * (causality, plan boundaries, the kernel's loop) is expressed in; converting
 * once here keeps byte arithmetic out of the bookkeeping, which is where the
 * bugs are.
 *
 * Clamped to at least 1: a budget too small for even one position is a
 * configuration error, and returning 0 would produce a plan that covers nothing
 * while looking like a valid empty list.
 */
export function windowSizeForBudget(budgetBytes: number, bytesPerPosition: number): number {
  if (!(bytesPerPosition > 0)) {
    throw new Error(`windowSizeForBudget: bytesPerPosition must be > 0 (got ${bytesPerPosition})`);
  }
  if (!(budgetBytes > 0)) {
    throw new Error(`windowSizeForBudget: budgetBytes must be > 0 (got ${budgetBytes})`);
  }
  return Math.max(1, Math.floor(budgetBytes / bytesPerPosition));
}

/**
 * Bytes one cache position occupies, for ONE layer, in the 4-bit packed format.
 *
 * Mirrors `KvCache`'s allocation in model/kvcache.ts: `wordsPerRow` u32 of packed
 * nibbles per (position, kv-head), plus one u32 of f16 scale per (position,
 * kv-head). Kept next to the planner so a capacity decision and the buffer it
 * sizes cannot disagree about the format — that disagreement is how a cache ends
 * up half the size it needs, which this codebase has already shipped once
 * (ram_kv_offload's K-only allocation).
 */
export function packed4bitBytesPerPosition(headCountKv: number, headDim: number): number {
  const wordsPerRow = Math.ceil(headDim / 8);
  const packed = wordsPerRow * headCountKv * 4; // K (or V) nibbles
  const scales = headCountKv * 4;               // one f16-in-u32 per row
  return (packed + scales) * 2;                 // ×2: K and V
}
