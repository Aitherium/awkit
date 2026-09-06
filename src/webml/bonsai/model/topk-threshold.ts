// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * Choosing the gather threshold from the GPU histogram — the one decision in GPU-side top-k
 * that can be wrong, so it lives here, pure, and is tested exhaustively without a GPU.
 *
 * kernels/wgsl/logit_topk.wgsl bins every logit into NBINS bins over a fixed range, bin 0
 * being the TOP of the range. Walking bins in ascending order therefore walks logits in
 * descending order. We need the smallest prefix of bins whose combined count is at least K:
 * the lower edge of that bin is a threshold T with the property that AT LEAST K logits are
 * >= T, which is what makes the subsequent gather a guaranteed superset of the true top-K.
 *
 * The failure this exists to prevent is silent. Pick T too high and the gather returns fewer
 * than K candidates — the sampler then draws from a truncated distribution and the model
 * simply seems worse, with no error anywhere. Pick it too low and the gather overflows,
 * which IS detected (the kernel counts past capacity) and costs a fallback readback.
 */

export interface ThresholdChoice {
  /** Keep logits >= this. */
  threshold: number;
  /** How many logits are known to clear it (the histogram's own count, exact). */
  expected: number;
  /** True when `expected` exceeds what the gather buffers can hold — caller must fall back. */
  overflow: boolean;
  reason: string;
}

/**
 * @param hist    counts per bin, bin 0 = highest logits
 * @param lo/hi   the fixed logit range the kernel binned over
 * @param k       how many candidates the sampler needs
 * @param capacity how many (idx, val) pairs the gather output can hold
 */
export function chooseThreshold(
  hist: Uint32Array | number[],
  lo: number,
  hi: number,
  k: number,
  capacity: number,
): ThresholdChoice {
  const nBins = hist.length;
  const span = Math.max(hi - lo, 1e-6);
  let acc = 0;
  for (let b = 0; b < nBins; b++) {
    acc += hist[b];
    if (acc >= k) {
      // Bin b covers logits in [hi - (b+1)/nBins*span, hi - b/nBins*span). Its LOWER edge is
      // the threshold: everything counted so far is >= it.
      const threshold = hi - ((b + 1) / nBins) * span;
      return {
        threshold,
        expected: acc,
        overflow: acc > capacity,
        reason: acc > capacity
          ? `bin ${b} of ${nBins} holds ${acc} candidates, over the ${capacity} the gather can hold`
          : `bin ${b} of ${nBins} reaches ${acc} candidates for k=${k}`,
      };
    }
  }
  // Fewer than k logits in the whole histogram is impossible when vocab >= k — every logit
  // is binned (out-of-range values CLAMP into the end bins rather than being dropped). If it
  // happens anyway the histogram is not describing this row, so refuse rather than invent a
  // threshold: `overflow` routes the caller to the full readback.
  return {
    threshold: lo,
    expected: acc,
    overflow: true,
    reason: `histogram holds only ${acc} counts, fewer than k=${k} — refusing to threshold`,
  };
}

/**
 * The binning range.
 *
 * Fixed rather than derived from a max-reduction pass, which would cost an extra dispatch and
 * an extra readback round-trip to save nothing: the kernel CLAMPS out-of-range values into
 * the end bins, so a range that is too narrow costs precision in the threshold, never
 * correctness. Bonsai's logits sit well inside this after the final norm; the width is chosen
 * so that even a badly-scaled row still resolves its top-k into distinguishable bins.
 */
export const LOGIT_RANGE_LO = -50;
export const LOGIT_RANGE_HI = 50;
export const LOGIT_HIST_BINS = 1024;

/**
 * How many candidates the gather may return.
 *
 * Sized so the readback stays trivial (2048 pairs = 16 KB, against the 993 KB row it
 * replaces) while being far above any plausible count of logits within one bin's width of
 * the maximum. Overflow is detected and falls back, so this is a performance knob, not a
 * correctness one.
 */
export const TOPK_GATHER_CAPACITY = 2048;
