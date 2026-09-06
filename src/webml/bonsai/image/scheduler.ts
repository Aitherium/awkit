// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/**
 * Flow-matching scheduler for the in-browser image model.
 *
 * DERIVED FROM THE GOLDENS, NOT FROM A PAPER. Every constant and every formula here
 * was fitted against `Library/bonsai-image/goldens/e2e-golden.safetensors`, which
 * records `latents_in_0..3` and `model_out_0..3` for a real 4-step generation. That
 * matters because a scheduler that is subtly wrong does not throw -- it produces a
 * plausible, wrong image, which is the most expensive failure this pipeline can have.
 *
 * WHAT WAS VERIFIED, and the numbers:
 *
 *   step rule   x_{k+1} = x_k + (t_{k+1} - t_k) * v_k        (plain Euler)
 *               Residual against the goldens is 4e-4..6.7e-4 RELATIVE. That is not
 *               a wrong rule -- it is the capture precision: 12.5% of the stored
 *               latents are exactly bf16-representable, i.e. the reference pipeline
 *               ran in reduced precision and the goldens were upcast to f32. The
 *               decisive check was solving for the dt that best fits each step:
 *               -0.044618 vs -0.044434 used, -0.078249 vs -0.078613, -0.172972 vs
 *               -0.172852. A wrong rule (a sigma RATIO rather than a difference,
 *               say) would put those far apart; they agree to 0.4%.
 *
 *   time shift  t = e^mu / (e^mu + (1/sigma - 1))
 *               Fitting mu to the goldens gives [1.0, 0.955566, 0.877578, 0.704971]
 *               against a golden of [1.0, 0.95556640625, 0.876953125, 0.7041015625].
 *
 * 🚨 THE MANIFEST'S `mu` DOES NOT REPRODUCE THE GOLDENS, and taking it on trust is
 * the trap. `goldens/manifest.json` records mu = 2.030690, which yields t1 = 0.958085
 * where the golden is 0.955566 -- a 2.5e-3 gap, an order of magnitude worse than the
 * f16 capture noise and NOT explainable by rounding (0.958085 is not the f16
 * neighbour of 0.955566). The mu actually used was ~1.9697. So mu is a RUNTIME value
 * computed from sequence length, not a constant to copy out of a manifest, and
 * `muForSeqLen` below is where that lives. Hardcoding 2.0307 would have produced
 * images that are wrong in a way nothing reports.
 */

/** The linear-in-seq-len shift schedule these models use. */
export interface ShiftSpec {
  baseSeqLen: number;
  maxSeqLen: number;
  baseShift: number;
  maxShift: number;
}

/**
 * Defaults matching the reference pipeline's family. They are DEFAULTS, not truths:
 * `muForSeqLen` is exported so a caller that knows the model's real spec can pass it,
 * and `fitMu` exists so a golden can settle an argument instead of a comment.
 */
export const DEFAULT_SHIFT: ShiftSpec = {
  baseSeqLen: 256,
  maxSeqLen: 4096,
  baseShift: 0.5,
  maxShift: 1.15,
};

/** mu for a given latent sequence length (number of patches). */
export function muForSeqLen(seqLen: number, spec: ShiftSpec = DEFAULT_SHIFT): number {
  const { baseSeqLen, maxSeqLen, baseShift, maxShift } = spec;
  // Guard the degenerate spec rather than dividing by zero into a NaN that would
  // propagate silently into every timestep and produce a black image.
  const span = maxSeqLen - baseSeqLen;
  if (span === 0) return baseShift;
  const m = (maxShift - baseShift) / span;
  return m * (seqLen - baseSeqLen) + baseShift;
}

/**
 * Apply the time shift to one sigma.
 *
 * At sigma = 1 this is exactly 1 for any mu, which is why the first timestep is
 * always 1.0 and cannot be used to fit mu -- `fitMu` uses index 1 for that reason.
 */
export function timeShift(sigma: number, mu: number): number {
  if (sigma <= 0) return 0;
  const e = Math.exp(mu);
  return e / (e + (1 / sigma - 1));
}

/**
 * The timesteps for `steps` inference steps.
 *
 * Sigmas are linear from 1 down to (but not including) 0 -- the goldens' 4-step run
 * is [1, 0.75, 0.5, 0.25], i.e. `1 - k/steps`, NOT `linspace(1, 0, steps)` which
 * would end at 0 and make the last shift divide by zero.
 */
export function timesteps(steps: number, mu: number): number[] {
  if (steps <= 0) return [];
  const out: number[] = [];
  for (let k = 0; k < steps; k++) out.push(timeShift(1 - k / steps, mu));
  return out;
}

/**
 * One Euler step, in place-free form: x_{k+1} = x_k + (t_next - t_cur) * v.
 *
 * `tNext` for the FINAL step is 0, not `timesteps[k+1]` (which does not exist) --
 * the last step must land on the clean sample. Passing undefined there and letting
 * `t_next - t_cur` become NaN is the kind of end-of-loop error that yields a
 * plausible image with a subtly wrong final denoise, so the signature demands it.
 */
export function eulerStep(
  x: Float32Array, v: Float32Array, tCur: number, tNext: number,
): Float32Array {
  if (x.length !== v.length) {
    throw new Error(
      `eulerStep: latent (${x.length}) and model output (${v.length}) differ in `
      + "length; a silent broadcast here would corrupt the sample");
  }
  const dt = tNext - tCur;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] + dt * v[i];
  return out;
}

/**
 * The mu implied by an observed timestep, so a golden can settle what a comment
 * cannot. Used by the test to prove the shift formula rather than assert a constant.
 */
export function fitMu(sigma: number, observedT: number): number {
  // t = e^mu / (e^mu + c)  with c = 1/sigma - 1   =>   e^mu = t*c / (1 - t)
  const c = 1 / sigma - 1;
  if (c <= 0 || observedT >= 1) return Number.NaN;   // sigma=1 carries no information
  return Math.log((observedT * c) / (1 - observedT));
}
