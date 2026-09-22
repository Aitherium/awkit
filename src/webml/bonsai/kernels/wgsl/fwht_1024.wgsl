// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// © 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation — WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
//   @ 5d80cff0b8cb9f2bf823cfc4e71e3abb97f290d6
//   - rotation matrix definition ..... src/llama-model.cpp:2012-2021
//                                      H[r][c] = (-1)^popcount(r&c) / sqrt(N)  (natural-order Sylvester)
//   - butterfly that actually runs ... ggml/src/ggml-cpu/ops.cpp:11890-11984 (ggml_compute_forward_fwht)
//                                      ggml/src/ggml-cuda/fwht.cu:86-130 (smem variant), :296-329 (dispatch)
//   - sign vector semantics .......... src/llama-model.cpp:2034-2072 (one F32 vector per INPUT width,
//                                      element i multiplies activation feature i)
//   - forward insertion (activation) . src/llama-graph.cpp:1504-1538  x' = H(s ⊙ x) per 1024-block
//   - inverse (token_embd lookup) .... src/llama-graph.cpp:2384-2395  h  = s ⊙ (H z) per 1024-block
//
// Blockwise normalized Sylvester Walsh–Hadamard transform with a per-feature sign vector,
// N = 1024 (prism.hadamard.block_size). ONE WORKGROUP PER 1024-BLOCK: the block is staged in
// workgroup shared memory, transformed in place there through the log2(1024) = 10 butterfly
// stages (barrier between stages), and written out.
//
// Contract (matches the fork bit-for-bit up to f32 rounding order):
//   forward (inverse = 0):  s[i] = x[i] * sign[i] * (1/sqrt(N));  butterfly;  out[i] = s[i]
//   inverse (inverse = 1):  s[i] = x[i] * (1/sqrt(N));  butterfly;  out[i] = s[i] * sign[i]
//   butterfly: for len = 1, 2, 4, ..., N/2:  for each pair (j, j+len) with (j / len) even:
//              (u, v) = (s[j], s[j+len]);  s[j] = u + v;  s[j+len] = u - v      (NO bit reversal)
//   1/sqrt(1024) = 1/32 is exact in f32, so the pre-scale is exact and matches the fork's
//   placement (ops.cpp:11924-11926, fwht.cu:39) rather than a post-scale; the sign multiply is
//   exact too. Since H is symmetric and H·H = I, the inverse of (H·S) is (S·H) — hence the
//   reversed order in inverse mode, exactly as llama-graph.cpp:2384-2395 does it.
//
// Buffers:
//   x     : array<f32>  — [n_rows * K] row-major activations (read)
//   signs : array<f32>  — ±1.0 entries; feature i of the row uses signs[sign_offset + i], so the
//                         whole concatenated prism.hadamard.sign_values can be bound once with
//                         sign_offset = offset(K) (5120 -> 0, 6144 -> 5120, 17408 -> 11264), or a
//                         per-width slice with sign_offset = 0. Sign is indexed by FEATURE, i.e.
//                         block b of the row uses signs[sign_offset + b*N .. +N)  (fwht.cu:36, :311-320)
//   out   : array<f32>  — [n_rows * K] transformed activations (read_write). NOT the same
//                         buffer as x: WebGPU forbids binding one buffer as read and read_write
//                         in one dispatch. The untransformed x is still needed by the BF16
//                         ssm_alpha / ssm_beta projections, so out-of-place is what the caller
//                         wants anyway.
//   dims  : uniform { K, n_rows, sign_offset, inverse }   K must be a multiple of 1024 — the
//           caller validates and THROWS otherwise (the fork does too, llama-model.cpp:1969-1973).
//
// Dispatch: n_rows * (K / 1024) workgroups of 256 threads. workgroup wg -> row = wg / n_blk,
// b = wg % n_blk. Each thread loads/stores 4 elements and folds 2 butterfly pairs per stage.

const N : u32 = 1024u;           // prism.hadamard.block_size
const HALF : u32 = 512u;         // butterfly pairs per stage
const WG : u32 = 256u;           // threads per workgroup
const ELEMS_PER_THREAD : u32 = 4u;   // N / WG
const PAIRS_PER_THREAD : u32 = 2u;   // HALF / WG
const INV_SQRT_N : f32 = 0.03125;    // 1 / sqrt(1024) = 1/32, exact in f32

struct Dims { K : u32, n_rows : u32, sign_offset : u32, inverse : u32 };

@group(0) @binding(0) var<storage, read>       x     : array<f32>;
@group(0) @binding(1) var<storage, read>       signs : array<f32>;
@group(0) @binding(2) var<storage, read_write> out   : array<f32>;
@group(0) @binding(3) var<uniform>             dims  : Dims;

var<workgroup> s : array<f32, 1024>;

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid : vec3<u32>,
        @builtin(workgroup_id) wid : vec3<u32>,
        @builtin(num_workgroups) nwg : vec3<u32>) {
  let local = lid.x;                 // 0..255
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension
  // limit. When it does not — the common case — num_workgroups.y is 1 and this reduces to
  // the plain 1-D expression.
  let wg = wid.x + wid.y * nwg.x;
  let n_blk = dims.K / N;            // 1024-blocks per row (uniform)
  let row = wg / n_blk;              // uniform across the workgroup
  if (row >= dims.n_rows) { return; } // uniform: whole workgroup returns or none
  let b = wg % n_blk;
  let base  = row * dims.K + b * N;  // first element of this block in x / out
  let sbase = dims.sign_offset + b * N;
  let fwd = dims.inverse == 0u;      // uniform

  // Stage the block: pre-scale by 1/sqrt(N) (fork placement), sign FIRST in forward mode.
  for (var j : u32 = 0u; j < ELEMS_PER_THREAD; j = j + 1u) {
    let i = local + j * WG;
    var v = x[base + i] * INV_SQRT_N;
    if (fwd) { v = v * signs[sbase + i]; }
    s[i] = v;
  }
  workgroupBarrier();

  // Sylvester butterfly, len = 1, 2, 4, ..., 512 — the low element of a pair takes u + v,
  // the high one u - v (ops.cpp:11938-11947, fwht.cu:104-105). 10 stages, barrier each.
  var len : u32 = 1u;
  loop {
    if (len >= N) { break; }
    for (var q : u32 = 0u; q < PAIRS_PER_THREAD; q = q + 1u) {
      let p = local + q * WG;                     // pair index 0..511
      let j = (p / len) * (len * 2u) + (p % len); // low element of the pair
      let u = s[j];
      let v = s[j + len];
      s[j] = u + v;
      s[j + len] = u - v;
    }
    workgroupBarrier();
    len = len * 2u;
  }

  // Write out; sign AFTER the transform in inverse mode (token_embd: h = s ⊙ (H z)).
  for (var j : u32 = 0u; j < ELEMS_PER_THREAD; j = j + 1u) {
    let i = local + j * WG;
    var v = s[i];
    if (!fwd) { v = v * signs[sbase + i]; }
    out[base + i] = v;
  }
}
