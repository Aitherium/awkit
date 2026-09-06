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
 *   - Q1_0 dequant/quant ............. ggml/src/ggml-quants.c:40-71, 419-437
 *   - q1_0·q8_0 dot .................. ggml/src/ggml-cpu/quants.c:127-175 (ggml_vec_dot_q1_0_q8_0)
 *   - Q8_0 quant ..................... ggml/src/ggml-quants.c (quantize_row_q8_0)
 *
 * PURPOSE. This module is the pure-TypeScript SCALAR REFERENCE for every numerically
 * critical kernel. It exists so the two riskiest kernels (Q1_0 dequant and the
 * q1_0·q8_0 dot) can be verified byte-for-byte in Node — no GPU required — and so the
 * WGSL shaders have one authoritative contract to match. The golden-vector self-tests
 * (scripts + the in-page panel) compare WGSL output against these functions.
 *
 * The identities below are the load/inference-critical ones and are transcribed exactly
 * from the fork. Where a formula is only needed to *construct* synthetic test blocks
 * (never on the real load path — real weights arrive pre-quantized in the GGUF) it is
 * clearly labelled as such.
 */

import { QK1_0, QK2_0, QK8_0, Q1_0_BYTES, Q2_0_BYTES, Q8_0_BYTES } from "../gguf/types";

// ---------------------------------------------------------------------------
// f16 <-> f32. WGSL stores the Q1_0 per-128 scale (d0) and Q8_0 per-32 scale (d1)
// as f16. To match GPU output bit-for-bit the reference must round scales through
// f16 exactly the same way, so we implement an IEEE-754 half round-trip here.
// ---------------------------------------------------------------------------

const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);

/** IEEE-754 half (u16 bits) -> f32. Handles subnormals, inf, NaN. */
export function f16ToF32(h: number): number {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) {
    // subnormal / zero
    return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  }
  if (e === 0x1f) {
    return f ? NaN : (s ? -Infinity : Infinity);
  }
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

/** f32 -> IEEE-754 half (u16 bits), round-to-nearest-even, matching WGSL f16 store. */
export function f32ToF16(value: number): number {
  _f32[0] = value;
  const x = _u32[0];
  const sign = (x >> 16) & 0x8000;
  let exp = ((x >> 23) & 0xff) - 127 + 15;
  const mant = x & 0x7fffff;

  if (((x >> 23) & 0xff) === 0xff) {
    // inf / nan
    return sign | 0x7c00 | (mant ? 0x0200 : 0);
  }
  if (exp >= 0x1f) return sign | 0x7c00; // overflow -> inf
  if (exp <= 0) {
    // subnormal or underflow to zero
    if (exp < -10) return sign;
    const m = (mant | 0x800000) >> (1 - exp);
    // round to nearest even
    let half = m >> 13;
    const rem = m & 0x1fff;
    if (rem > 0x1000 || (rem === 0x1000 && (half & 1))) half += 1;
    return sign | half;
  }
  let half = (exp << 10) | (mant >> 13);
  const rem = mant & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (half & 1))) half += 1; // round-to-even; may carry into exp
  return sign | half;
}

/** Round an f32 through f16 storage (identity WGSL applies when a scale is stored as f16). */
export function roundF16(value: number): number {
  return f16ToF32(f32ToF16(value));
}

// ---------------------------------------------------------------------------
// Q8_0 activation quantizer (fork QK8_0 = 32).
//   d      = max(|x|) / 127
//   qs[j]  = round(x[j] / d) clamped to [-127, 127]
//   d == 0 -> qs all zero
// d is stored as f16 (roundF16) so the dot product sees exactly what the GPU sees.
// ---------------------------------------------------------------------------

export interface Q8Block {
  d: number; // f16-rounded scale
  qs: Int8Array; // length 32
}

export function quantizeQ8Block(x: Float32Array | number[], off = 0): Q8Block {
  let amax = 0;
  for (let j = 0; j < QK8_0; j++) {
    const a = Math.abs(x[off + j]);
    if (a > amax) amax = a;
  }
  const qs = new Int8Array(QK8_0);
  if (amax === 0) return { d: 0, qs };
  const d = roundF16(amax / 127);
  const id = d !== 0 ? 1 / d : 0;
  for (let j = 0; j < QK8_0; j++) {
    let q = Math.round(x[off + j] * id);
    if (q > 127) q = 127;
    if (q < -127) q = -127;
    qs[j] = q;
  }
  return { d, qs };
}

/** Quantize a full row (length multiple of 32) into consecutive Q8_0 blocks. */
export function quantizeQ8Row(x: Float32Array | number[]): Q8Block[] {
  const n = x.length;
  if (n % QK8_0 !== 0) throw new Error(`quantizeQ8Row: length ${n} not multiple of ${QK8_0}`);
  const out: Q8Block[] = [];
  for (let b = 0; b < n / QK8_0; b++) out.push(quantizeQ8Block(x, b * QK8_0));
  return out;
}

// ---------------------------------------------------------------------------
// Q1_0 block layout (fork block_q1_0): { f16 d; u8 qs[16] } = 18 bytes, 128 weights.
// Bit order is LSB-first: weight j uses byte qs[j>>3], bit (j & 7).
// bit == 1 -> +d ; bit == 0 -> -d  (pure binary {-1,+1}; NOT ternary TQ1_0 — no zero).
// ---------------------------------------------------------------------------

export interface Q1Block {
  d: number; // f16-rounded scale
  qs: Uint8Array; // 16 packed sign bytes
}

/** Read a Q1_0 block from 18 raw little-endian bytes. */
export function readQ1Block(bytes: Uint8Array, off = 0): Q1Block {
  if (bytes.length - off < Q1_0_BYTES) throw new Error("readQ1Block: need 18 bytes");
  const dBits = bytes[off] | (bytes[off + 1] << 8); // f16 little-endian
  const qs = bytes.subarray(off + 2, off + 2 + 16);
  return { d: f16ToF32(dBits), qs: new Uint8Array(qs) };
}

/** Extract the sign bit for weight index j (LSB-first). */
export function q1Bit(qs: Uint8Array, j: number): number {
  return (qs[j >> 3] >> (j & 7)) & 1;
}

/** Dequantize a Q1_0 block to 128 f32 weights: w[j] = bit ? +d : -d. */
export function dequantQ1Block(block: Q1Block): Float32Array {
  const out = new Float32Array(QK1_0);
  for (let j = 0; j < QK1_0; j++) out[j] = q1Bit(block.qs, j) ? block.d : -block.d;
  return out;
}

/** Dequant straight from raw 18 bytes (Milestone 2 round-trip). */
export function dequantQ1Bytes(bytes: Uint8Array, off = 0): Float32Array {
  return dequantQ1Block(readQ1Block(bytes, off));
}

/**
 * Build a Q1_0 block (18 bytes) from a scale + 128 sign flags. SYNTHETIC-TEST ONLY —
 * the real load path never quantizes weights (they arrive pre-quantized). `signs[j]`
 * truthy => bit 1 => +d.
 */
export function packQ1Block(d: number, signs: ArrayLike<number | boolean>): Uint8Array {
  const bytes = new Uint8Array(Q1_0_BYTES);
  const h = f32ToF16(d);
  bytes[0] = h & 0xff;
  bytes[1] = (h >> 8) & 0xff;
  for (let j = 0; j < QK1_0; j++) {
    if (signs[j]) bytes[2 + (j >> 3)] |= 1 << (j & 7);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Q2_0 block layout (fork block_q2_0): { f16 d; u8 qs[32] } = 34 bytes, 128 weights.
// Bit order is LSB-first, 2 bits per weight: weights j, j+1 use byte qs[byte_index],
// bits at offsets (j % 4)*2 (LSB-first within the byte).
// Bit pattern -> Quantized int -> Dequantized value:
//   00 -> -1 -> -d
//   01 ->  0 ->  0
//   10 -> +1 -> +d
//   11 -> +2 -> +2d
// Formula: ((int)q - 1) * d, where q ∈ {0,1,2,3} is the 2-bit value.
// ---------------------------------------------------------------------------

export interface Q2Block {
  d: number; // f16-rounded scale
  qs: Uint8Array; // 32 packed 2-bit bytes
}

/** Read a Q2_0 block from 34 raw little-endian bytes. */
export function readQ2Block(bytes: Uint8Array, off = 0): Q2Block {
  if (bytes.length - off < Q2_0_BYTES) throw new Error("readQ2Block: need 34 bytes");
  const dBits = bytes[off] | (bytes[off + 1] << 8); // f16 little-endian
  const qs = bytes.subarray(off + 2, off + 2 + 32);
  return { d: f16ToF32(dBits), qs: new Uint8Array(qs) };
}

/** Extract the 2-bit value for weight index j (LSB-first, 2 bits per weight). */
export function q2Bits(qs: Uint8Array, j: number): number {
  const byteIndex = j >> 2; // 4 weights per byte
  const bitOffset = (j & 3) << 1; // 2 bits per weight, LSB-first
  return (qs[byteIndex] >> bitOffset) & 0x3;
}

/** Dequantize a Q2_0 block to 128 f32 weights: w[j] = ((q - 1) * d). */
export function dequantQ2Block(block: Q2Block): Float32Array {
  const out = new Float32Array(QK2_0);
  for (let j = 0; j < QK2_0; j++) {
    const q = q2Bits(block.qs, j);
    out[j] = (q - 1) * block.d;
  }
  return out;
}

/** Dequant straight from raw 34 bytes. */
export function dequantQ2Bytes(bytes: Uint8Array, off = 0): Float32Array {
  return dequantQ2Block(readQ2Block(bytes, off));
}

/**
 * Build a Q2_0 block (34 bytes) from a scale + 128 2-bit values. SYNTHETIC-TEST ONLY —
 * the real load path never quantizes weights (they arrive pre-quantized). `values[j]`
 * encodes a 2-bit pattern (0-3) which is dequantized as (v - 1) * d.
 */
export function packQ2Block(d: number, values: ArrayLike<number>): Uint8Array {
  const bytes = new Uint8Array(Q2_0_BYTES);
  const h = f32ToF16(d);
  bytes[0] = h & 0xff;
  bytes[1] = (h >> 8) & 0xff;
  for (let j = 0; j < QK2_0; j++) {
    const q = values[j] & 0x3; // mask to 2 bits
    const byteIndex = j >> 2;
    const bitOffset = (j & 3) << 1;
    bytes[2 + byteIndex] |= q << bitOffset;
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// THE core kernel: ggml_vec_dot_q2_0_q8_0. Two-level scaling + INTEGER accumulation.
// One Q2_0 block (128 weights) pairs with 4 consecutive Q8_0 blocks (4 x 32 = 128).
// Identical structure to q1_0·q8_0 but with 2-bit dequant (4 values/byte vs 1 value/bit).
//
// Non-negotiable ordering:
//   for each of the 4 q8 sub-blocks k:
//       acc(i32) = sum over 32 lanes of ( (q2bit[lane]-1) * q8[lane] )
//       blockSum += d1_k * acc
//   result += d0 * blockSum
// ---------------------------------------------------------------------------

/** Dot one Q2_0 block against its 4 paired Q8_0 blocks. */
export function q2q8DotBlock(w: Q2Block, a: [Q8Block, Q8Block, Q8Block, Q8Block]): number {
  const d0 = w.d;
  let blockSum = 0;
  for (let k = 0; k < 4; k++) {
    const d1 = a[k].d;
    let acc = 0; // integer accumulation
    const qs8 = a[k].qs;
    for (let lane = 0; lane < 32; lane++) {
      const j = k * 32 + lane;
      const q2 = q2Bits(w.qs, j);
      const q8 = qs8[lane]; // already signed int8 via Int8Array
      acc += (q2 - 1) * q8; // formula: (q - 1) * d
    }
    blockSum += d1 * acc;
  }
  return d0 * blockSum;
}

/**
 * Full q2_0 · q8_0 dot over K weights (K a multiple of 128). `wBytes` is the raw weight
 * row (K/128 * 34 bytes); `aBlocks` is the activation row already quantized to Q8_0
 * (K/32 blocks). Returns a single f32 dot value — the inner product of one output
 * feature. This mirrors what `q2_0_q8_0_matmul.wgsl` computes per output element.
 */
export function q2q8DotRow(wBytes: Uint8Array, aBlocks: Q8Block[], K: number): number {
  if (K % QK2_0 !== 0) throw new Error(`q2q8DotRow: K=${K} not multiple of ${QK2_0}`);
  const nQ2 = K / QK2_0;
  if (aBlocks.length < nQ2 * 4) throw new Error("q2q8DotRow: not enough Q8 blocks");
  let sum = 0;
  for (let i = 0; i < nQ2; i++) {
    const w = readQ2Block(wBytes, i * Q2_0_BYTES);
    const quad: [Q8Block, Q8Block, Q8Block, Q8Block] = [
      aBlocks[i * 4],
      aBlocks[i * 4 + 1],
      aBlocks[i * 4 + 2],
      aBlocks[i * 4 + 3],
    ];
    sum += q2q8DotBlock(w, quad);
  }
  return sum;
}

// ---------------------------------------------------------------------------
// THE core kernel: ggml_vec_dot_q1_0_q8_0 (fork quants.c:127-175).
// Two-level scaling + INTEGER accumulation. One Q1_0 block (128 weights) pairs with
// 4 consecutive Q8_0 blocks (4 x 32 = 128).
//
// Non-negotiable ordering (do NOT fold d0/d1 into the inner loop — the exact integer
// identity is what keeps the port from drifting):
//   for each of the 4 q8 sub-blocks k:
//       acc(i32) = sum over 32 lanes of ( bit ? +q8 : -q8 )
//       blockSum += d1_k * acc
//   result += d0 * blockSum
// ---------------------------------------------------------------------------

/** Dot one Q1_0 block against its 4 paired Q8_0 blocks. */
export function q1q8DotBlock(w: Q1Block, a: [Q8Block, Q8Block, Q8Block, Q8Block]): number {
  const d0 = w.d;
  let blockSum = 0;
  for (let k = 0; k < 4; k++) {
    const d1 = a[k].d;
    let acc = 0; // integer accumulation
    const qs8 = a[k].qs;
    for (let lane = 0; lane < 32; lane++) {
      const j = k * 32 + lane;
      const bit = q1Bit(w.qs, j);
      const q8 = qs8[lane]; // already signed int8 via Int8Array
      acc += bit === 1 ? q8 : -q8;
    }
    blockSum += d1 * acc;
  }
  return d0 * blockSum;
}

/**
 * Full q1_0 · q8_0 dot over K weights (K a multiple of 128). `wBytes` is the raw weight
 * row (K/128 * 18 bytes); `aBlocks` is the activation row already quantized to Q8_0
 * (K/32 blocks). Returns a single f32 dot value — the inner product of one output
 * feature. This mirrors what `q1_0_q8_0_matmul.wgsl` computes per output element.
 */
export function q1q8DotRow(wBytes: Uint8Array, aBlocks: Q8Block[], K: number): number {
  if (K % QK1_0 !== 0) throw new Error(`q1q8DotRow: K=${K} not multiple of ${QK1_0}`);
  const nQ1 = K / QK1_0;
  if (aBlocks.length < nQ1 * 4) throw new Error("q1q8DotRow: not enough Q8 blocks");
  let sum = 0;
  for (let i = 0; i < nQ1; i++) {
    const w = readQ1Block(wBytes, i * Q1_0_BYTES);
    const quad: [Q8Block, Q8Block, Q8Block, Q8Block] = [
      aBlocks[i * 4],
      aBlocks[i * 4 + 1],
      aBlocks[i * 4 + 2],
      aBlocks[i * 4 + 3],
    ];
    sum += q1q8DotBlock(w, quad);
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Standard-precision reference kernels (RMSNorm, SiLU/SwiGLU) — f32 accumulation.
// ---------------------------------------------------------------------------

/** y = x / sqrt(mean(x^2) + eps) * weight. eps comes from GGUF at runtime. */
export function rmsnorm(x: Float32Array, weight: Float32Array, eps: number): Float32Array {
  const n = x.length;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += x[i] * x[i];
  const scale = 1 / Math.sqrt(ss / n + eps);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = x[i] * scale * weight[i];
  return out;
}

export function silu(z: number): number {
  return z / (1 + Math.exp(-z));
}

/** SwiGLU element-wise stage: silu(gate) * up. Projections happen via the Q1_0 matmul. */
export function swigluMul(gate: Float32Array, up: Float32Array): Float32Array {
  const n = gate.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = silu(gate[i]) * up[i];
  return out;
}

// ---------------------------------------------------------------------------
// 4-bit KV cache (kv_quant_4bit.wgsl / softmax_attn_batched.wgsl mode==1).
//   scale = roundF16(max_abs / 7)          — f16 bits stored as u32 low 16
//   raw   = clamp(roundAwayFromZero(x / scaleStored) + 8, 0, 15)   — a 0..15 nibble
//   packed row = head_dim nibbles, 8 per u32, LSB-first (word 0 holds elements 0..7)
//   dequant = (raw - 8) * scaleStored
// raw 0 is UNREACHABLE (|x|/amax <= 1 so |x/scale| <= 7/1 after the f16 round); raw 15
// is the saturating ceiling for the largest magnitudes. This mirrors Q8_0's
// [-127,127] clamp with the +8 offset folding the sign into the nibble value.
// ---------------------------------------------------------------------------

/** WGSL `round()` rounds HALF AWAY FROM ZERO. Math.round rounds ties UP. The reference
 *  must match the kernel, so use sign-aware rounding — a plain Math.round here would
 *  disagree on exact .5 boundaries and silently flip a nibble. */
export function roundAwayFromZero(v: number): number {
  return v < 0 ? -Math.round(Math.abs(v)) : Math.round(Math.abs(v));
}

/** Words (u32) needed to hold one head_dim-element row of 4-bit nibbles. */
export function kv4WordsPerRow(headDim: number): number {
  return Math.ceil(headDim / 8);
}

/** Quantize one f32 row (length headDim) into { scale, packed }. Contract for
 *  kv_quant_4bit.wgsl — see the header comment there. Requires headDim % 8 == 0 on the
 *  real kernel path (the attention kernel's flat element -> word mapping is row-local only
 *  when a row is a whole number of words); the reference tolerates any headDim. */
export function packKvRow4bit(x: Float32Array | number[], headDim = x.length): {
  scale: number;
  packed: Uint32Array;
} {
  let amax = 0;
  for (let j = 0; j < headDim; j++) {
    const a = Math.abs(x[j]);
    if (a > amax) amax = a;
  }
  const scale = roundF16(amax / 7);
  const id = scale !== 0 ? 1 / scale : 0;
  const words = kv4WordsPerRow(headDim);
  const packed = new Uint32Array(words);
  for (let j = 0; j < headDim; j++) {
    let raw = roundAwayFromZero(x[j] * id) + 8;
    if (raw < 0) raw = 0;
    if (raw > 15) raw = 15;
    packed[j >> 3] |= raw << ((j & 7) * 4);
  }
  return { scale, packed };
}

/** Dequantize one 4-bit row back to f32: out[j] = (raw - 8) * scale. */
export function dequantKvRow4bit(packed: Uint32Array, scale: number, headDim: number): Float32Array {
  const out = new Float32Array(headDim);
  for (let j = 0; j < headDim; j++) {
    const raw = (packed[j >> 3] >> ((j & 7) * 4)) & 0xf;
    out[j] = (raw - 8) * scale;
  }
  return out;
}

/**
 * Batched causal GQA softmax attention over a 4-bit PACKED KV cache — the exact algebra of
 * softmax_attn_batched.wgsl mode==1, run scalar-side for GPU-free verification of the
 * quantize/dequant contract.
 *
 *   q        : [nTokens · nHeads · headDim] f32 (post-RoPE)
 *   kPacked  : [kvLen · nHeadsKv · wordsPerRow] u32  — 4-bit keys
 *   vPacked  : [kvLen · nHeadsKv · wordsPerRow] u32  — 4-bit values
 *   kScales  : [kvLen · nHeadsKv] f32 (already f16-rounded) per-row scales
 *   vScales  : [kvLen · nHeadsKv] f32
 *   posBase  : absolute position of q's first token; query (posBase+t) attends to [0, posBase+t]
 *   attnScale: 1/sqrt(headDim)
 * Returns out [nTokens · nHeads · headDim]. Row r of a cache is
 * (pos*nHeadsKv + kvHead), matching the kernel's k_scale_buf indexing.
 */
export function refKv4SoftmaxAttn(
  q: Float32Array,
  kPacked: Uint32Array,
  vPacked: Uint32Array,
  kScales: Float32Array,
  vScales: Float32Array,
  nTokens: number,
  nHeads: number,
  nHeadsKv: number,
  headDim: number,
  posBase: number,
  attnScale: number,
): Float32Array {
  const words = kv4WordsPerRow(headDim);
  const out = new Float32Array(nTokens * nHeads * headDim);
  const gqaRatio = nHeads / nHeadsKv;
  for (let t = 0; t < nTokens; t++) {
    for (let h = 0; h < nHeads; h++) {
      const kvHead = Math.floor(h / gqaRatio);
      const last = posBase + t;
      let m = -3.0e38;
      let l = 0;
      const acc = new Float32Array(headDim);
      for (let pos = 0; pos <= last; pos++) {
        const rowBase = (pos * nHeadsKv + kvHead) * words;
        const kRow = dequantKvRow4bit(kPacked.subarray(rowBase, rowBase + words), kScales[pos * nHeadsKv + kvHead], headDim);
        const vRow = dequantKvRow4bit(vPacked.subarray(rowBase, rowBase + words), vScales[pos * nHeadsKv + kvHead], headDim);
        let part = 0;
        const qOff = (t * nHeads + h) * headDim;
        for (let d = 0; d < headDim; d++) part += q[qOff + d] * kRow[d];
        const s = part * attnScale;
        const mNew = Math.max(m, s);
        const corr = Math.exp(m - mNew);
        const w = Math.exp(s - mNew);
        l = l * corr + w;
        for (let d = 0; d < headDim; d++) acc[d] = acc[d] * corr + w * vRow[d];
        m = mNew;
      }
      const inv = l > 0 ? 1 / l : 0;
      const oOff = (t * nHeads + h) * headDim;
      for (let d = 0; d < headDim; d++) out[oOff + d] = acc[d] * inv;
    }
  }
  return out;
}

/* ════════════════════════════════════════════════════════════════════════════
   CHUNKED ATTENTION — the algebra that lets KV live in host RAM

   The KV cache is the binding memory constraint for in-browser context: at 28
   layers / 128 head-dim, f32 KV costs ~224 KB per token, so a 2,787-token prompt
   is ~600 MB of KV on a browser GPU budget. RAM offload (model/ram_kv_offload.ts,
   D-1855) exists to lift that ceiling by keeping the master cache in a host
   ArrayBuffer and streaming a WINDOW of positions to VRAM.

   That is only possible if attention can be computed a window at a time, and it
   can — because `refKv4SoftmaxAttn` above (and softmax_attn_batched.wgsl, which
   it mirrors) uses ONLINE (flash-style) softmax. The whole per-(token,head)
   state is `(m, l, acc)`: running max, running denominator, running weighted V.
   Nothing else from earlier positions is consulted.

   So a chunk boundary is not an approximation. Carrying `(m, l, acc)` UNNORMALISED
   across the boundary leaves the sequence of floating-point operations completely
   unchanged — the same adds, the same multiplies, in the same order. The result
   is therefore BIT-IDENTICAL to the single-pass version, not merely close, and
   `__tests__/attn-chunked-equivalence.test.ts` asserts exactly that rather than a
   tolerance. A tolerance would hide the one bug that matters here: a boundary
   that silently drops or double-counts a position.

   NORMALISE ONLY ONCE, AT THE END. Dividing by `l` at a chunk boundary and then
   continuing is the obvious-looking mistake, and it is wrong in a way that looks
   right — the first chunk's output is correct, so a one-chunk test passes.
   ════════════════════════════════════════════════════════════════════════════ */

/** Per-(token,head) online-softmax state, carried across chunk boundaries. */
export interface AttnCarry {
  /** Running max score. -3e38 is the kernel's own sentinel for "nothing yet". */
  m: number;
  /** Running softmax denominator. */
  l: number;
  /** Running weighted sum of V, UNNORMALISED (never divided by l mid-stream). */
  acc: Float32Array;
}

export function newAttnCarry(headDim: number): AttnCarry {
  return { m: -3.0e38, l: 0, acc: new Float32Array(headDim) };
}

/**
 * Fold ONE window of cache positions into the carry, for a single (token, head).
 *
 * `[posLo, posHi)` is the window; positions past `last` are skipped, which is how
 * causality survives windowing (a window may straddle the causal edge).
 *
 * Deliberately takes the same packed 4-bit inputs as `refKv4SoftmaxAttn`, so the
 * two share a dequant path and cannot drift into disagreeing about the format.
 */
export function refKv4AttnChunk(
  carry: AttnCarry,
  q: Float32Array,
  qOff: number,
  kPacked: Uint32Array,
  vPacked: Uint32Array,
  kScales: Float32Array,
  vScales: Float32Array,
  nHeadsKv: number,
  kvHead: number,
  headDim: number,
  posLo: number,
  posHi: number,
  last: number,
  attnScale: number,
): void {
  const words = kv4WordsPerRow(headDim);
  const hi = Math.min(posHi, last + 1);
  for (let pos = posLo; pos < hi; pos++) {
    const rowBase = (pos * nHeadsKv + kvHead) * words;
    const sIdx = pos * nHeadsKv + kvHead;
    const kRow = dequantKvRow4bit(kPacked.subarray(rowBase, rowBase + words), kScales[sIdx], headDim);
    const vRow = dequantKvRow4bit(vPacked.subarray(rowBase, rowBase + words), vScales[sIdx], headDim);
    let part = 0;
    for (let d = 0; d < headDim; d++) part += q[qOff + d] * kRow[d];
    const s = part * attnScale;
    const mNew = Math.max(carry.m, s);
    const corr = Math.exp(carry.m - mNew);
    const w = Math.exp(s - mNew);
    carry.l = carry.l * corr + w;
    for (let d = 0; d < headDim; d++) carry.acc[d] = carry.acc[d] * corr + w * vRow[d];
    carry.m = mNew;
  }
}

/** Normalise a finished carry into the output row. The ONLY division by `l`. */
export function finishAttnCarry(carry: AttnCarry, out: Float32Array, outOff: number, headDim: number): void {
  const inv = carry.l > 0 ? 1 / carry.l : 0;
  for (let d = 0; d < headDim; d++) out[outOff + d] = carry.acc[d] * inv;
}

/**
 * The same attention as `refKv4SoftmaxAttn`, computed one WINDOW of cache
 * positions at a time — the CPU model of the RAM-offload streaming path.
 *
 * `windowSize` is how many cache positions are resident in VRAM at once. The
 * result does not depend on it; that independence is the property the streaming
 * design rests on, and the equivalence test sweeps window sizes to prove it.
 */
export function refKv4SoftmaxAttnChunked(
  q: Float32Array,
  kPacked: Uint32Array,
  vPacked: Uint32Array,
  kScales: Float32Array,
  vScales: Float32Array,
  nTokens: number,
  nHeads: number,
  nHeadsKv: number,
  headDim: number,
  posBase: number,
  attnScale: number,
  windowSize: number,
): Float32Array {
  if (!Number.isInteger(windowSize) || windowSize < 1) {
    throw new Error(`refKv4SoftmaxAttnChunked: windowSize must be a positive integer (got ${windowSize})`);
  }
  const out = new Float32Array(nTokens * nHeads * headDim);
  const gqaRatio = nHeads / nHeadsKv;
  for (let t = 0; t < nTokens; t++) {
    for (let h = 0; h < nHeads; h++) {
      const kvHead = Math.floor(h / gqaRatio);
      const last = posBase + t;
      const qOff = (t * nHeads + h) * headDim;
      const carry = newAttnCarry(headDim);
      for (let lo = 0; lo <= last; lo += windowSize) {
        refKv4AttnChunk(
          carry, q, qOff, kPacked, vPacked, kScales, vScales,
          nHeadsKv, kvHead, headDim, lo, lo + windowSize, last, attnScale,
        );
      }
      finishAttnCarry(carry, out, qOff, headDim);
    }
  }
  return out;
}

export const REF_BLOCKS = { QK1_0, QK2_0, QK8_0, Q1_0_BYTES, Q2_0_BYTES, Q8_0_BYTES } as const;
