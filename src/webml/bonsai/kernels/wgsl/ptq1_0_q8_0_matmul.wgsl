// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// © 2026 Aitherium, LLC. Original work.
// Original Aitherium WebGPU implementation — WGSL kernels ported from the PrismML
// llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
// NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
// Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
//   @ 5d80cff0b8cb9f2bf823cfc4e71e3abb97f290d6
//   - ptq1_0·q8_0 dot ................ ggml/src/ggml-cpu/quants.c:281-347 (ggml_vec_dot_ptq1_0_q8_0)
//   - PTQ1_0 block layout ............ ggml/src/ggml-common.h:209-220 (QK_PTQ1_0=128, block_ptq1_0)
//   - per-element trit accessor ...... ggml/src/ggml-cuda/common.cuh:995-1015
//
// THE core PTQ1_0 kernel — reproduces ggml_vec_dot_ptq1_0_q8_0 EXACTLY. Ternary trit decode,
// two-level scaling, integer accumulation. K-TILED with the activation row staged in
// workgroup shared memory: one workgroup owns 64 output cols of ONE row, so the row's
// activation is loaded once per K-tile and reused across all 64 cols. Same tile / binding /
// dispatch structure as q1_0_q8_0_matmul.wgsl and q2_0_q8_0_matmul.wgsl — only the block
// decode differs.
//
// NUMERICS: the f32 accumulation ORDER is the fork's (blocks i ascending, sub-blocks k
// ascending; the 32-lane acc is INTEGER so order-free). The fork decodes the whole block to
// element order first and then runs the Q1_0-shaped two-level loop; decoding lazily per
// element here is the same arithmetic because the decode is pure.
//
// NON-NEGOTIABLE (verification checklist):
//   1. block = { u8 qs[24]; u8 qh[2]; f16 d } — d is the LAST 2 bytes (word 6, high half).
//   2. element e -> (byte, n): e<80: qs[e&15], n=e>>4 | e<120: t=e-80, qs[16+(t&7)], n=t>>3 |
//      else t=e-120, qh[t&1], n=t>>1.  trit = ((byte*3^n mod 256) * 3) >> 8, value = trit-1.
//   3. accumulate (trit-1) * q8[lane] in i32 FIRST, then * d1(per-32), sum, then * d0(per-128).
//
// Buffers:
//   weights  : array<u32> — PTQ1_0, 7 words/block (NO repack: 28 B is 4-byte aligned)
//   act_d    : array<u32> — per-32 f16 activation scales d1 (low 16 bits), one per q8 block
//   act_qs   : array<u32> — per-32 int8 activations, 8 words/block (4 int8 per word)
//   out      : array<f32> — [n_rows * n_cols] output features
//   dims     : uniform {K, n_cols, n_rows, col_tiles}  col_tiles = ceil(n_cols/64)
//
// Dispatch: n_rows * col_tiles workgroups of 64 threads. workgroup wg -> row = wg/col_tiles,
// col = (wg%col_tiles)*64 + local. A workgroup NEVER straddles two rows, so the staged
// activation is unambiguous.
//
// Hadamard note: Bonsai 2 PTQ1_0 weights are stored Hadamard-folded along K. The activation
// bound here must ALREADY be sign⊙WHT-transformed (fwht_1024.wgsl) and then Q8_0-quantized —
// exactly as the fork inserts the transform as a separate graph op before mul_mat
// (src/llama-graph.cpp:1504-1538). This kernel is transform-agnostic.

const QK_PTQ1_0 : u32 = 128u;
const WORDS_PER_PTQ1 : u32 = 7u; // 28-byte GPU block == GGUF block (no pad, no repack)
const WORDS_PER_Q8 : u32 = 8u;
const TILE_PTQ1 : u32 = 32u;     // PTQ1_0 blocks per K-tile (32*128 = 4096 K elements)
const QS_BYTES : u32 = 24u;      // qh[0] at byte 24, qh[1] at byte 25, d at 26..27

struct Dims { K : u32, n_cols : u32, n_rows : u32, col_tiles : u32 };

@group(0) @binding(0) var<storage, read> weights : array<u32>;
@group(0) @binding(1) var<storage, read> act_d   : array<u32>;
@group(0) @binding(2) var<storage, read> act_qs  : array<u32>;
@group(0) @binding(3) var<storage, read_write> out : array<f32>;
@group(0) @binding(4) var<uniform> dims : Dims;

// Staged activation for the current K-tile (shared across all 64 cols of this workgroup's
// row). TILE_PTQ1 ptq1-blocks -> TILE_PTQ1*4 q8-blocks: scales + 8 words each.
var<workgroup> sh_d  : array<u32, 128>;   // TILE_PTQ1 * 4
var<workgroup> sh_qs : array<u32, 1024>;  // TILE_PTQ1 * 4 * 8

fn sext8(b: u32) -> i32 {
  return (i32(b) ^ 0x80) - 0x80;
}

// Byte byte_index (0..27) of a block whose 7 words were hoisted into `bw`.
fn block_byte(bw: ptr<function, array<u32, 7>>, byte_index: u32) -> u32 {
  let word = (*bw)[byte_index >> 2u];
  return (word >> ((byte_index & 3u) * 8u)) & 0xffu;
}

// Decode base-3 digit n (0 = most significant) out of a ceil-scaled byte -> {-1, 0, +1}.
fn trit_digit(byte: u32, n: u32) -> i32 {
  var v : u32 = byte;
  for (var i : u32 = 0u; i < n; i = i + 1u) { v = (v * 3u) & 0xffu; }
  return i32((v * 3u) >> 8u) - 1;
}

// Element e in [0,128) of the hoisted block -> trit in {-1, 0, +1} (fork accessor, verbatim map).
fn ptq1_trit(bw: ptr<function, array<u32, 7>>, e: u32) -> i32 {
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
  return trit_digit(block_byte(bw, byte_index), n);
}

@compute @workgroup_size(64)
fn main(@builtin(local_invocation_id) lid : vec3<u32>,
        @builtin(workgroup_id) wid : vec3<u32>,
        @builtin(num_workgroups) nwg : vec3<u32>) {
  let local = lid.x;                 // 0..63
  // FLAT INDEX ACROSS A POSSIBLY-2D WORKGROUP GRID.
  // dispatch1D() folds the workgroup count into y once it passes WebGPU's 65535-per-dimension
  // limit. When it does not — the common case — num_workgroups.y is 1 and this reduces to
  // EXACTLY the old expression, so the working 27B numerics are untouched.
  let wg = wid.x + wid.y * nwg.x;
  let row   = wg / dims.col_tiles;   // uniform across the workgroup
  if (row >= dims.n_rows) { return; } // uniform: whole workgroup returns or none
  let col = (wg % dims.col_tiles) * 64u + local;
  let valid = col < dims.n_cols;

  let n_ptq1 = dims.K / QK_PTQ1_0;
  let a_row_q8_base = row * (dims.K / 32u);

  var result : f32 = 0.0;

  var c0 : u32 = 0u;
  loop {
    if (c0 >= n_ptq1) { break; }
    let cn = min(TILE_PTQ1, n_ptq1 - c0); // ptq1-blocks in this tile (uniform)
    let n_q8 = cn * 4u;                    // q8-blocks in this tile
    let q8_base = a_row_q8_base + c0 * 4u;

    // Cooperative, coalesced load of this tile's activation into shared (all 64 threads).
    var t : u32 = local;
    loop { if (t >= n_q8) { break; } sh_d[t] = act_d[q8_base + t]; t = t + 64u; }
    t = local;
    loop { if (t >= n_q8 * WORDS_PER_Q8) { break; } sh_qs[t] = act_qs[q8_base * WORDS_PER_Q8 + t]; t = t + 64u; }
    workgroupBarrier();

    if (valid) {
      var il : u32 = 0u;
      loop {
        if (il >= cn) { break; }
        let i  = c0 + il;
        let wb = (col * n_ptq1 + i) * WORDS_PER_PTQ1;

        // Hoist the whole 28-byte block (7 words) once per (col, block): every trit of the
        // block is read from registers, never re-fetched from global per lane.
        var bw : array<u32, 7>;
        for (var w : u32 = 0u; w < WORDS_PER_PTQ1; w = w + 1u) { bw[w] = weights[wb + w]; }
        // f16 d0 in the HIGH 16 bits of word 6 (bytes 26..27) — the scale is LAST.
        let d0 = unpack2x16float(bw[6] >> 16u).x;                // per-128 weight scale

        var block_sum : f32 = 0.0;
        for (var k : u32 = 0u; k < 4u; k = k + 1u) {
          let qb    = il * 4u + k;                              // shared q8-block index
          let d1    = unpack2x16float(sh_d[qb] & 0xffffu).x;    // per-32 activation scale
          let qs_sh = qb * WORDS_PER_Q8;

          var acc : i32 = 0;                                    // INTEGER accumulation (order-free)
          // Process the 32 activations as 8 words × 4 int8s. Lane j = wi*4 + m within the
          // sub-block pairs with block element e = k*32 + j (quants.c:334-338).
          for (var wi : u32 = 0u; wi < 8u; wi = wi + 1u) {
            let aword = sh_qs[qs_sh + wi];                      // int8s from shared (one read/4 lanes)
            for (var m : u32 = 0u; m < 4u; m = m + 1u) {
              let e  = k * 32u + wi * 4u + m;
              let q  = ptq1_trit(&bw, e);                       // {-1, 0, +1}
              let q8 = sext8((aword >> (m * 8u)) & 0xffu);
              acc = acc + q * q8;
            }
          }
          block_sum = block_sum + d1 * f32(acc);               // * per-32 scale (k order)
        }
        result = result + d0 * block_sum;                      // * per-128 scale (i order)
        il = il + 1u;
      }
    }
    workgroupBarrier();                 // all threads done reading shared before next tile overwrites
    c0 = c0 + TILE_PTQ1;
  }

  if (valid) { out[row * dims.n_cols + col] = result; }
}
