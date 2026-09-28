// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * THE CONTEXT CEILING IS OWNED BY THE CODE THAT KNOWS WHY IT EXISTS (D-1498).
 *
 * Every dense Bonsai declares `rope.scaling.type=yarn`, `factor=4`,
 * `original_context_length=8192`. metadata.ts resolves those keys, but the full-attention
 * block calls `ropeImrope(...)` without a scale and no YaRN ramp is applied anywhere — plain
 * RoPE is used at every position. Below the original context that is negligible; PAST it,
 * plain RoPE extrapolation silently degrades attention with no error.
 *
 * Before this module the runtime only stayed out of that regime because an UNRELATED
 * constant (KV_CEILING = 8192 in bonsai-worker-core.ts) happened to equal the original
 * context. Raising that constant would have silently enabled the bug. This clamps the
 * ceiling to `original_context_length` whenever the model declares a RoPE scaling this
 * runtime does not implement, so the guard is the rope code's knowledge, not an accident.
 *
 * Pure and GPU-free on purpose, so it is the part worth testing.
 */

/** RoPE scaling types the full-attention kernels actually implement. */
export const IMPLEMENTED_ROPE_SCALING: ReadonlySet<string> = new Set(["none", ""]);

export interface RopeScalingInfo {
  ropeScalingType?: string;
  /** `rope.scaling.original_context_length`, when the model declares it. */
  ropeScalingOriginalContext?: number;
}

export interface RopeCeiling {
  ceiling: number;
  /** Non-empty when the ceiling was lowered, so the clamp is logged, never silent. */
  reason: string;
}

/**
 * The largest context this runtime may run the model at without silently wrong attention.
 *
 * - no scaling declared (or one we implement) -> the requested ceiling, unchanged;
 * - an unimplemented scaling WITH an original context -> min(ceiling, original context);
 * - an unimplemented scaling WITHOUT one -> the requested ceiling, with a reason logged,
 *   because there is no number to clamp to and inventing one would be a guess.
 */
export function ropeSafeCeiling(ceiling: number, cfg: RopeScalingInfo): RopeCeiling {
  const type = (cfg.ropeScalingType ?? "none").toLowerCase();
  if (IMPLEMENTED_ROPE_SCALING.has(type)) return { ceiling, reason: "" };
  const orig = cfg.ropeScalingOriginalContext;
  if (typeof orig !== "number" || !Number.isFinite(orig) || orig <= 0) {
    return {
      ceiling,
      reason:
        `rope scaling '${type}' is declared but not implemented and the model gives no ` +
        `original_context_length — positions past the training context are unverified`,
    };
  }
  if (orig >= ceiling) return { ceiling, reason: "" };
  return {
    ceiling: Math.floor(orig),
    reason:
      `rope scaling '${type}' is declared but not implemented — context clamped from ` +
      `${ceiling} to the model's original_context_length ${Math.floor(orig)}`,
  };
}
