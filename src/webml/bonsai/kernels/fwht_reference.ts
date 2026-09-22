// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 * Original Aitherium WebGPU implementation — WGSL kernels ported from the PrismML
 * llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
 * NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
 * Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
 *   - rotation matrix ................ src/llama-model.cpp:2012-2021
 *                                      H[r][c] = (-1)^popcount(r&c) / sqrt(N), natural-order Sylvester
 *   - butterfly (what actually runs) . ggml/src/ggml-cpu/ops.cpp:11890-11984 (ggml_compute_forward_fwht):
 *                                      pre-scale 1/sqrt(n), then len = 1,2,..,n/2: low = u+v, high = u-v
 *                                      ggml/src/ggml-cuda/fwht.cu:16-130 (same order; sign fused before)
 *   - forward op order ............... src/llama-graph.cpp:1504-1538 (build_lora_mm):
 *                                      [perm (ssm_out only)] -> x ⊙ signs -> blockwise WHT -> mul_mat(w)
 *   - inverse op order ............... src/llama-graph.cpp:2384-2395 (token_embd lookup): WHT -> ⊙ signs
 *   - gdn_v_grouped permutation ...... src/llama-model.cpp:2080-2090 + llama-graph.cpp:1521-1527
 *   - sign lookup by input width ..... src/llama-model.cpp:2034-2040; fwht.cu:36 (signs + (r % n_blk)*N)
 *
 * PURPOSE. Pure-TypeScript scalar reference for the Bonsai 2 Hadamard activation transform.
 * A folded weight W' = W·S·H (per 1024-wide input block) reproduces y = W·x when it is fed
 * x' = H(s ⊙ x). H is the normalized Sylvester Walsh–Hadamard matrix, symmetric and
 * orthonormal (H·H = I), so the inverse of H·S is S·H — which is why the embedding table
 * (rows stored as z = H·S·h) is undone by h = s ⊙ (H z), the REVERSE op order.
 *
 * All arithmetic is done on Float32Array storage so every stage rounds to f32 like the
 * fork's CPU path; the WGSL kernel that ports this must keep the same stage order.
 */

/** The fork's rotation: H[r][c] = (-1)^popcount(r & c) / sqrt(n). Reference only (O(n^2)). */
export function sylvesterHadamardEntry(r: number, c: number, n: number): number {
  let parity = r & c;
  parity ^= parity >> 16;
  parity ^= parity >> 8;
  parity ^= parity >> 4;
  parity ^= parity >> 2;
  parity ^= parity >> 1;
  const scale = 1 / Math.sqrt(n);
  return parity & 1 ? -scale : scale;
}

function assertPow2(n: number, where: string): void {
  if (!Number.isInteger(n) || n <= 0 || (n & (n - 1)) !== 0) {
    throw new Error(`${where}: block size ${n} must be a power of two`);
  }
}

/**
 * In-place normalized WHT of `data[off .. off+n)` — the fork's butterfly verbatim
 * (ops.cpp:11924-11947): every element is pre-scaled by 1/sqrt(n) (an exact 1/32 for
 * n = 1024), then for len = 1, 2, 4, …, n/2 each pair (i+j, i+len+j) becomes (u+v, u−v).
 * No bit reversal — this ordering IS the natural-order Sylvester matrix.
 */
export function fwhtInPlace(data: Float32Array, off: number, n: number): void {
  assertPow2(n, "fwhtInPlace");
  if (off < 0 || off + n > data.length) throw new Error(`fwhtInPlace: [${off}, ${off + n}) out of range`);
  const scale = Math.fround(1 / Math.sqrt(n));
  for (let j = 0; j < n; j++) data[off + j] = data[off + j] * scale;
  for (let len = 1; len < n; len <<= 1) {
    for (let i = 0; i < n; i += 2 * len) {
      for (let j = 0; j < len; j++) {
        const u = data[off + i + j];
        const v = data[off + i + len + j];
        data[off + i + j] = u + v;
        data[off + i + len + j] = u - v;
      }
    }
  }
}

/**
 * FORWARD activation transform of one 1024-block: x' = H(s ⊙ x). Signs (±1, length 1024)
 * are applied BEFORE the butterfly, as build_lora_mm does (ggml_mul then the FWHT hint).
 * Returns a new Float32Array; `x` is not modified. `signs` omitted = identity sign mode.
 */
export function fwhtNormalized1024(x: Float32Array, signs?: Int8Array | Float32Array): Float32Array {
  return fwhtForwardBlock(x, 0, 1024, signs, 0);
}

/** Forward transform of a general power-of-two block (sign first, then WHT). */
export function fwhtForwardBlock(
  x: Float32Array,
  off: number,
  n: number,
  signs?: Int8Array | Float32Array,
  signsOff = 0,
): Float32Array {
  assertPow2(n, "fwhtForwardBlock");
  if (off + n > x.length) throw new Error(`fwhtForwardBlock: block [${off}, ${off + n}) exceeds input ${x.length}`);
  const out = new Float32Array(n);
  if (signs) {
    if (signsOff + n > signs.length) throw new Error(`fwhtForwardBlock: signs too short (${signs.length})`);
    for (let j = 0; j < n; j++) out[j] = x[off + j] * signs[signsOff + j];
  } else {
    for (let j = 0; j < n; j++) out[j] = x[off + j];
  }
  fwhtInPlace(out, 0, n);
  return out;
}

/**
 * INVERSE transform of one block (the embedding-lookup path): h = s ⊙ (H z). WHT first,
 * signs AFTER — the reverse of the forward order (llama-graph.cpp:2390-2393).
 */
export function fwhtInverseBlock(
  z: Float32Array,
  off: number,
  n: number,
  signs?: Int8Array | Float32Array,
  signsOff = 0,
): Float32Array {
  assertPow2(n, "fwhtInverseBlock");
  if (off + n > z.length) throw new Error(`fwhtInverseBlock: block [${off}, ${off + n}) exceeds input ${z.length}`);
  const out = new Float32Array(n);
  for (let j = 0; j < n; j++) out[j] = z[off + j];
  fwhtInPlace(out, 0, n);
  if (signs) {
    if (signsOff + n > signs.length) throw new Error(`fwhtInverseBlock: signs too short (${signs.length})`);
    for (let j = 0; j < n; j++) out[j] = out[j] * signs[signsOff + j];
  }
  return out;
}

/** The subset of HadamardSpec the row walker needs (gguf/metadata.ts HadamardSpec satisfies it). */
export interface FwhtRowSpec {
  blockSize: number;
  signMode: "identity" | "explicit";
  /** Sign vector per INPUT width (fork hadamard_sign_data[width]). */
  signsByWidth: Map<number, Int8Array>;
}

/** Resolve the sign vector for an input width, or undefined in identity mode. Throws like the fork if missing. */
export function signsForWidth(spec: FwhtRowSpec, width: number): Int8Array | undefined {
  if (spec.signMode === "identity") return undefined;
  const s = spec.signsByWidth.get(width);
  if (!s) throw new Error(`fwht: prism.hadamard has no sign vector for width ${width}`);
  if (s.length !== width) throw new Error(`fwht: sign vector for width ${width} has length ${s.length}`);
  return s;
}

/**
 * FORWARD transform of ONE activation row of length `width` (the weight's input dim,
 * ne[0]): walks the row in consecutive `blockSize` blocks, block b using
 * signs[b*blockSize .. +blockSize) of the width's sign vector (fwht.cu:36
 * `signs + (r % n_blk) * N`), and applies sign -> WHT to each. `x[off .. off+width)`.
 * Throws when width is not a multiple of the block size (fork llama-model.cpp:1969-1973).
 */
export function fwhtApplyRow(x: Float32Array, width: number, spec: FwhtRowSpec, off = 0): Float32Array {
  const { blockSize } = spec;
  if (width % blockSize !== 0) {
    throw new Error(`fwhtApplyRow: width ${width} is not a multiple of block size ${blockSize}`);
  }
  if (off + width > x.length) throw new Error(`fwhtApplyRow: row [${off}, ${off + width}) exceeds input ${x.length}`);
  const signs = signsForWidth(spec, width);
  const out = new Float32Array(width);
  for (let b = 0; b * blockSize < width; b++) {
    const blk = fwhtForwardBlock(x, off + b * blockSize, blockSize, signs, b * blockSize);
    out.set(blk, b * blockSize);
  }
  return out;
}

/**
 * INVERSE transform of one latent row (token_embd lookup result) of length `width`:
 * per block WHT then ⊙ signs, same per-block sign slicing as the forward walk.
 */
export function fwhtInverseRow(z: Float32Array, width: number, spec: FwhtRowSpec, off = 0): Float32Array {
  const { blockSize } = spec;
  if (width % blockSize !== 0) {
    throw new Error(`fwhtInverseRow: width ${width} is not a multiple of block size ${blockSize}`);
  }
  if (off + width > z.length) throw new Error(`fwhtInverseRow: row [${off}, ${off + width}) exceeds input ${z.length}`);
  const signs = signsForWidth(spec, width);
  const out = new Float32Array(width);
  for (let b = 0; b * blockSize < width; b++) {
    const blk = fwhtInverseBlock(z, off + b * blockSize, blockSize, signs, b * blockSize);
    out.set(blk, b * blockSize);
  }
  return out;
}

/**
 * gdn_v_grouped permutation of the ssm_out INPUT (llama-graph.cpp:1521-1527): the DeltaNet
 * output arrives in tiled v-head order [hd, nk, rep] (v-head h = nk + nk_count*rep, i.e.
 * k-head = h % nk_count) and the folded ssm_out columns are in grouped order [hd, rep, nk]:
 *   grouped[hd + HD*(rep + REP*nk)] = tiled[hd + HD*(nk + NK*rep)]
 * Applied per token row BEFORE signs and WHT. Bonsai 2: HD=128, NK=16, REP=3 (6144 wide).
 */
export function gdnVGroupedPermuteRow(
  tiled: Float32Array,
  hd: number,
  nk: number,
  rep: number,
  off = 0,
): Float32Array {
  const width = hd * nk * rep;
  if (off + width > tiled.length) throw new Error(`gdnVGroupedPermuteRow: row [${off}, ${off + width}) exceeds input ${tiled.length}`);
  const out = new Float32Array(width);
  for (let r = 0; r < rep; r++) {
    for (let k = 0; k < nk; k++) {
      const src = off + hd * (k + nk * r);
      const dst = hd * (r + rep * k);
      for (let i = 0; i < hd; i++) out[dst + i] = tiled[src + i];
    }
  }
  return out;
}
