// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// © 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation — WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
//   - Q8_0 quant ..................... ggml/src/ggml-quants.c (quantize_row_q8_0, QK8_0=32)
//
// Activation quantizer. One workgroup per 32-element block. Contract (matches
// reference.ts quantizeQ8Block):  d = max(|x|)/127 ;  qs[j] = round(x[j]/d) clamped
// [-127,127] ;  d==0 -> qs=0.  d is emitted as f16 bits so the matmul reads exactly the
// value the CPU reference rounds to.
//
// Output layout per block (kept 4-byte aligned): one u32 for the f16 d (low 16 bits),
// then 8 u32 packing the 32 signed int8 qs (4 per u32, little-endian byte order).

const QK8_0 : u32 = 32u;

@group(0) @binding(0) var<storage, read>        activations : array<f32>;   // n_blocks * 32
@group(0) @binding(1) var<storage, read_write>  out_d       : array<u32>;    // n_blocks (f16 in low 16)
@group(0) @binding(2) var<storage, read_write>  out_qs      : array<u32>;    // n_blocks * 8

var<workgroup> shared_amax : array<f32, 32>;
// Quantized int8 values are exchanged as INTEGERS (low 8 bits used). They must NOT be
// round-tripped through f32 workgroup memory: a negative int8's bit pattern is a NaN as
// f32, and the GPU canonicalizes NaN on store/load, corrupting every negative activation
// to 0x7FC00000 (≈2.1e9) — which then blows the matmul up ~160,000×. Use a u32 scratch.
var<workgroup> shared_q : array<u32, 32>;

@compute @workgroup_size(32)
fn main(@builtin(workgroup_id) wg : vec3<u32>, @builtin(local_invocation_id) lid : vec3<u32>,
        @builtin(num_workgroups) nwg : vec3<u32>) {
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension
  // limit. When it does not — the common case — num_workgroups.y is 1 and this reduces to
  // EXACTLY the old expression, so the working 27B numerics are untouched.
  let block = wg.x + wg.y * nwg.x;
  let lane  = lid.x;
  let base  = block * QK8_0;

  // per-lane load + abs
  let x = activations[base + lane];
  shared_amax[lane] = abs(x);
  workgroupBarrier();

  // tree reduce max-abs across 32 lanes
  var stride : u32 = 16u;
  loop {
    if (stride == 0u) { break; }
    if (lane < stride) {
      shared_amax[lane] = max(shared_amax[lane], shared_amax[lane + stride]);
    }
    workgroupBarrier();
    stride = stride >> 1u;
  }

  let amax = shared_amax[0];
  // round d through f16 exactly (pack/unpack) so quantization uses the stored scale
  let d_f16 = pack2x16float(vec2<f32>(amax / 127.0, 0.0)) & 0xffffu;
  let d     = unpack2x16float(d_f16).x;
  let id    = select(0.0, 1.0 / d, d != 0.0);

  // quantize this lane's value; keep the low 8 bits (two's-complement int8) in a u32
  var q : i32 = i32(round(x * id));
  q = clamp(q, -127, 127);

  // Exchange the 32 quantized bytes via the INTEGER scratch (no f32/NaN round-trip).
  shared_q[lane] = u32(q) & 0xffu;
  workgroupBarrier();

  if (lane == 0u) {
    out_d[block] = d_f16;
    for (var w : u32 = 0u; w < 8u; w = w + 1u) {
      let o = w * 4u;
      out_qs[block * 8u + w] =
          shared_q[o + 0u]
        | (shared_q[o + 1u] << 8u)
        | (shared_q[o + 2u] << 16u)
        | (shared_q[o + 3u] << 24u);
    }
  }
}
