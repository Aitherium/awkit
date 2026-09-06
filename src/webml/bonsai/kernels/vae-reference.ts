// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * SCALAR CPU REFERENCE for the three VAE decoder ops — the contract `vae_ops.wgsl` must match.
 *
 * This exists for the same reason `kernels/reference.ts` exists for the transformer ops: a
 * WGSL kernel that is subtly wrong does not crash. It produces a plausible image. Every
 * numerics defect this codebase has paid for — the Q1_0 dot, the conv-history leak, the KV
 * ordering — presented as fluent, confident, wrong output, and each was found by diffing
 * against a scalar implementation small enough to read and be sure of.
 *
 * Written to be OBVIOUSLY correct rather than fast: loops in the order the formula is
 * written, no blocking, no accumulation tricks. If this and the GPU disagree, the GPU is
 * wrong until proven otherwise.
 *
 * Layout is NCHW f32, batch 1, matching the kernel.
 */

export interface ConvSpec {
  inC: number;
  outC: number;
  h: number;
  w: number;
  k: number;
  pad: number;
  stride: number;
}

export function convOutH(s: ConvSpec): number {
  return Math.floor((s.h + 2 * s.pad - s.k) / s.stride) + 1;
}
export function convOutW(s: ConvSpec): number {
  return Math.floor((s.w + 2 * s.pad - s.k) / s.stride) + 1;
}

/**
 * 2-D convolution, zero-padded, NCHW.
 *
 * `x`      [inC * h * w]
 * `weight` [outC * inC * k * k]
 * `bias`   [outC]
 */
export function conv2dRef(
  x: Float32Array,
  weight: Float32Array,
  bias: Float32Array,
  s: ConvSpec,
): Float32Array {
  const oh = convOutH(s);
  const ow = convOutW(s);
  const y = new Float32Array(s.outC * oh * ow);
  for (let oc = 0; oc < s.outC; oc++) {
    for (let oy = 0; oy < oh; oy++) {
      for (let ox = 0; ox < ow; ox++) {
        let acc = bias[oc];
        for (let ic = 0; ic < s.inC; ic++) {
          for (let ky = 0; ky < s.k; ky++) {
            const iy = oy * s.stride + ky - s.pad;
            // Skipped, not clamped. Zero padding means the tap contributes NOTHING; clamping
            // to the edge would duplicate the border pixel, which is a different (and
            // plausible-looking) convolution.
            if (iy < 0 || iy >= s.h) continue;
            for (let kx = 0; kx < s.k; kx++) {
              const ix = ox * s.stride + kx - s.pad;
              if (ix < 0 || ix >= s.w) continue;
              acc += x[ic * s.h * s.w + iy * s.w + ix]
                * weight[((oc * s.inC) + ic) * s.k * s.k + ky * s.k + kx];
            }
          }
        }
        y[oc * oh * ow + oy * ow + ox] = acc;
      }
    }
  }
  return y;
}

/**
 * GroupNorm with per-CHANNEL affine.
 *
 * Statistics are taken over a GROUP — that is, over (c/groups) channels AND their full
 * spatial planes together — while gamma/beta are indexed per channel. Mixing those two up
 * (per-group affine, or per-channel statistics) is the classic implementation error and it
 * produces an image that looks like an image.
 */
export function groupNormRef(
  x: Float32Array,
  gamma: Float32Array,
  beta: Float32Array,
  c: number,
  h: number,
  w: number,
  groups: number,
  eps = 1e-6,
): Float32Array {
  const y = new Float32Array(x.length);
  const cpg = c / groups;
  const plane = h * w;
  const slab = cpg * plane;
  for (let g = 0; g < groups; g++) {
    const base = g * slab;
    let mean = 0;
    for (let i = 0; i < slab; i++) mean += x[base + i];
    mean /= slab;
    let varr = 0;
    for (let i = 0; i < slab; i++) {
      const d = x[base + i] - mean;
      varr += d * d;
    }
    varr /= slab;
    const invStd = 1 / Math.sqrt(varr + eps);
    for (let i = 0; i < slab; i++) {
      const ch = g * cpg + Math.floor(i / plane);
      y[base + i] = (x[base + i] - mean) * invStd * gamma[ch] + beta[ch];
    }
  }
  return y;
}

/** Nearest-neighbour upsample by an integer factor, NCHW. */
export function upsampleNearestRef(
  x: Float32Array,
  c: number,
  h: number,
  w: number,
  scale: number,
): Float32Array {
  const oh = h * scale;
  const ow = w * scale;
  const y = new Float32Array(c * oh * ow);
  for (let ch = 0; ch < c; ch++) {
    for (let oy = 0; oy < oh; oy++) {
      for (let ox = 0; ox < ow; ox++) {
        const sy = Math.floor(oy / scale);
        const sx = Math.floor(ox / scale);
        y[ch * oh * ow + oy * ow + ox] = x[ch * h * w + sy * w + sx];
      }
    }
  }
  return y;
}

/** SiLU, the VAE's activation (`act_fn: silu` in its config). */
export function siluRef(x: Float32Array): Float32Array {
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] / (1 + Math.exp(-x[i]));
  return y;
}
