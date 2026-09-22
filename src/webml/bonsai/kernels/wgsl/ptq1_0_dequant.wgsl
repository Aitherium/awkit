// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// © 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation — WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
//   @ 5d80cff0b8cb9f2bf823cfc4e71e3abb97f290d6
//   - PTQ1_0 block layout ............ ggml/src/ggml-common.h:209-220 (QK_PTQ1_0=128, block_ptq1_0)
//   - PTQ1_0 dequant ................. ggml/src/ggml-quants.c:2255-2285 (dequantize_row_ptq1_0)
//   - per-element trit accessor ...... ggml/src/ggml-cuda/common.cuh:995-1015 (proven equal to the
//                                      CPU traversal by tests/test-ptq1_0-element-map.cpp)
//
// Standalone PTQ1_0 dequant for verification (Milestone 2 round-trip) and any non-hot-path
// wholesale dequant of small tensors. Contract (matches the CPU reference dequantPTQ1Block):
//   block = { u8 qs[24] ; u8 qh[2] ; f16 d } = 28 bytes, 128 ternary weights (1.75 bpw).
//   THE SCALE IS LAST (bytes 26..27) — unlike Q1_0 / Q2_0 / PQ2_0 where it is first.
//
// Trits are NOT positional. Element e -> (byte, n) with n = trit index, 0 = MOST significant:
//   e <  80 :  byte = qs[e & 15]          n = e >> 4        (chunk A: 16 bytes x 5 trits)
//   e < 120 :  t = e-80;  byte = qs[16 + (t & 7)]   n = t >> 3   (chunk B:  8 bytes x 5 trits)
//   e < 128 :  t = e-120; byte = qh[t & 1]          n = t >> 1   (qh: 2 bytes x 4 trits, 5th slot 0)
// Byte encoding is "ceil-scaled base-3": byte = ceil(code * 256 / 243). Decoding digit n:
//   v = byte; repeat n times: v = (v * 3) & 0xFF;   trit = (v * 3) >> 8   in {0,1,2}
//   value = (trit - 1) * d
//
// Input packing: 28 bytes is 4-byte aligned, so the GPU block IS the GGUF block — NO repack
// (contrast Q1_0 18->20 and Q2_0 34->36). 7 u32 words per block:
//   word 0..3 = qs[0..15], word 4..5 = qs[16..23], word 6 = qh[0] | qh[1]<<8 | f16 d << 16.
// One thread per 128-weight block.

const QK_PTQ1_0 : u32 = 128u;
const WORDS_PER_BLOCK : u32 = 7u;   // 28 bytes per block, no padding
const QS_BYTES : u32 = 24u;         // qh[0] is at byte 24, qh[1] at byte 25, d at bytes 26..27

@group(0) @binding(0) var<storage, read>       blocks : array<u32>;   // n_blocks * 7
@group(0) @binding(1) var<storage, read_write> out_w  : array<f32>;   // n_blocks * 128
@group(0) @binding(2) var<uniform>             n_blocks : u32;

fn byte_at(block_base: u32, byte_index: u32) -> u32 {
  // byte_index is 0..27 within the block; word = byte_index/4, shift = (byte_index%4)*8
  let word = blocks[block_base + (byte_index >> 2u)];
  let sh   = (byte_index & 3u) * 8u;
  return (word >> sh) & 0xffu;
}

// Decode base-3 digit n (0 = most significant) out of a ceil-scaled byte.
fn trit_digit(byte: u32, n: u32) -> i32 {
  var v : u32 = byte;
  for (var i : u32 = 0u; i < n; i = i + 1u) { v = (v * 3u) & 0xffu; }
  return i32((v * 3u) >> 8u) - 1;
}

// Element e in [0,128) of the block at block_base -> trit in {-1, 0, +1}.
fn ptq1_trit(block_base: u32, e: u32) -> i32 {
  var byte_index : u32;
  var n : u32;
  if (e < 80u) {
    byte_index = e & 15u;
    n = e >> 4u;
  } else if (e < 120u) {
    let t = e - 80u;
    byte_index = 16u + (t & 7u);
    n = t >> 3u;
  } else {
    let t = e - 120u;
    byte_index = QS_BYTES + (t & 1u);
    n = t >> 1u;
  }
  return trit_digit(byte_at(block_base, byte_index), n);
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

  // f16 d in the HIGH 16 bits of word 6 (bytes 26..27) — scale is last in block_ptq1_0.
  let d = unpack2x16float(blocks[bb + 6u] >> 16u).x;

  let out_base = block * QK_PTQ1_0;
  for (var e : u32 = 0u; e < QK_PTQ1_0; e = e + 1u) {
    out_w[out_base + e] = f32(ptq1_trit(bb, e)) * d;
  }
}
