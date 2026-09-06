// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// © 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation — WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
//   - Q2_0 dequant ................... ggml/src/ggml-quants.c ~450 (QK2_0=128)
//
// Standalone Q2_0 dequant for verification (Milestone 2 round-trip) and any non-hot-path
// wholesale dequant of small tensors. Contract (matches reference.ts dequantQ2Block):
//   block = { f16 d ; u8 qs[32] } = 34 bytes, 128 weights.
//   2-bit order LSB-first: weight j uses byte qs[j>>2], bits at ((j&3)<<1).
//   bit pattern (00,01,10,11) -> (−1,0,+1,+2) -> (−d,0,+d,+2d) via formula: (q−1)·d.
//
// Input packing: each 34-byte block is laid out as 9 u32 (padded) — word0 low16 = f16 d,
// bytes 2..33 = the 32 packed 2-bit bytes. We pass blocks as array<u32> with 9 words per block
// (last word partially used) to stay 4-byte aligned. One thread per 128-weight block.

const QK2_0 : u32 = 128u;
const WORDS_PER_BLOCK : u32 = 9u;   // 36 bytes reserved per block (34 used + 2 pad)

@group(0) @binding(0) var<storage, read>       blocks : array<u32>;   // n_blocks * 9
@group(0) @binding(1) var<storage, read_write> out_w  : array<f32>;   // n_blocks * 128
@group(0) @binding(2) var<uniform>             n_blocks : u32;

fn byte_at(block_base: u32, byte_index: u32) -> u32 {
  // byte_index is 0..33 within the block; word = byte_index/4, shift = (byte_index%4)*8
  let word = blocks[block_base + (byte_index >> 2u)];
  let sh   = (byte_index & 3u) * 8u;
  return (word >> sh) & 0xffu;
}

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg_ : vec3<u32>,
        @builtin(local_invocation_id) lid_ : vec3<u32>,
        @builtin(num_workgroups) nwg_ : vec3<u32>) {
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension
  // limit. When it does not — the common case — num_workgroups.y is 1 and this reduces to
  // EXACTLY the old expression, so the working 27B numerics are untouched.
  let block = (wg_.x + wg_.y * nwg_.x) * 64u + lid_.x;
  if (block >= n_blocks) { return; }
  let bb = block * WORDS_PER_BLOCK;

  // f16 d in the low 16 bits of word 0
  let d = unpack2x16float(blocks[bb] & 0xffffu).x;

  let out_base = block * QK2_0;
  for (var j : u32 = 0u; j < QK2_0; j = j + 1u) {
    // 2-bit bytes start at byte offset 2 within the block; 4 values per byte
    let byte_index = 2u + (j >> 2u);
    let byte = byte_at(bb, byte_index);
    // LSB-first: 2 bits at offset ((j & 3) << 1)
    let bit_offset = (j & 3u) << 1u;
    let q = (byte >> bit_offset) & 3u;
    // Dequant formula: (q - 1) * d; q ∈ {0,1,2,3} -> {-1,0,1,2} * d
    out_w[out_base + j] = f32(i32(q) - 1) * d;
  }
}
