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
 *   - bf16 -> f32 .................... ggml/src/ggml-impl.h:594-601 (ggml_compute_bf16_to_fp32)
 *   - f32 -> bf16 .................... ggml/src/ggml-impl.h:610-624 (ggml_compute_fp32_to_bf16)
 *
 * bfloat16 is the TOP half of an IEEE-754 binary32: same sign + 8-bit exponent, 7 mantissa
 * bits. Widening is therefore a pure bit shift (`u32 = u16 << 16`) with no rounding — the
 * f32 you get is exactly the value the checkpoint stores. Bonsai 2 ships
 * `blk.*.ssm_alpha.weight` / `blk.*.ssm_beta.weight` as BF16 (GGML_TYPE_BF16 = 30).
 */

const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);

/** bf16 bits (u16) -> f32. Exact: the 16 bits become the high half of the f32 word. */
export function bf16ToF32(bits: number): number {
  _u32[0] = (bits & 0xffff) << 16;
  return _f32[0];
}

/**
 * f32 -> bf16 bits (u16), round-to-nearest-even, NaN forced quiet — the fork's
 * `ggml_compute_fp32_to_bf16`. SYNTHETIC-TEST ONLY on the load path (weights arrive as
 * BF16 already); the fork's CPU BF16 mul_mat rounds ACTIVATIONS this way (§5 of the spec).
 */
export function f32ToBf16(value: number): number {
  _f32[0] = value;
  const u = _u32[0];
  if ((u & 0x7fffffff) > 0x7f800000) {
    // nan -> quiet nan
    return ((u >>> 16) | 64) & 0xffff;
  }
  // (u + (0x7fff + ((u >> 16) & 1))) >> 16, computed in u32 arithmetic.
  const rounded = (u + (0x7fff + ((u >>> 16) & 1))) >>> 0;
  return (rounded >>> 16) & 0xffff;
}

/** Round an f32 through bf16 storage (what the fork's CPU path does to activations). */
export function roundBf16(value: number): number {
  return bf16ToF32(f32ToBf16(value));
}

/**
 * Widen `n` little-endian bf16 values starting at byte `off` into a fresh Float32Array.
 * Mirrors the F16 read in image/gguf-weights.ts; used wherever a BF16 tensor is read on
 * the CPU. Throws on a short buffer rather than zero-filling the tail.
 */
export function bf16BytesToF32(bytes: Uint8Array, off: number, n: number): Float32Array {
  if (off < 0 || off + n * 2 > bytes.length) {
    throw new Error(
      `bf16BytesToF32: need ${n * 2} bytes at offset ${off}, buffer has ${bytes.length}`,
    );
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lo = bytes[off + i * 2];
    const hi = bytes[off + i * 2 + 1];
    out[i] = bf16ToF32(lo | (hi << 8));
  }
  return out;
}
