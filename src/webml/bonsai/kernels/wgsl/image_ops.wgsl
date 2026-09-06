// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// © 2026 Aitherium, LLC. Original work.
//
// The four ops the Flux2 MMDiT needs that the LLM kernels do not provide. Every one of
// them has a CPU counterpart in `image/mmdit.ts`, which is differentially verified
// against a real reference forward (37 stages, 5e-5), and every one is compared against
// that counterpart on a real GPU by `e2e/bonsai-image-gpu-differential.mjs`.
//
// 🚨 WHY THESE ARE NEW RATHER THAN REUSED. Three of the four look like kernels that
// already ship, and reusing those would be silently wrong:
//
//   layernorm        NOT rmsnorm.wgsl. RMSNorm does not subtract the mean. Flux2's
//                    modulated norms are LayerNorm with elementwise_affine=FALSE --
//                    mean-centred, and with no learnable weight, because the shift and
//                    scale arrive from the modulation instead. Substituting RMSNorm
//                    changes every activation and raises nothing.
//
//   rope_interleaved NOT rope_imrope.wgsl. That kernel pairs (p, p + rot/2) -- NEOX /
//                    half-split -- and its own comment records that as a FIX ("the old
//                    (2p, 2p+1) pairing scrambled positional phase"), which is true for
//                    the LLM and exactly backwards here. Flux2 pairs ADJACENT
//                    components (2p, 2p+1), from diffusers' use_real_unbind_dim=-1.
//                    Asserted in both directions by
//                    `e2e/bonsai-image-kernel-conventions.mjs`.
//
//   modulate         x * (1 + scale) + shift, with scale/shift broadcast over tokens.
//                    Not elementwise.wgsl: the operands have different ranks.
//
//   add_gated        x + gate * delta, gate broadcast over tokens. The residual add of
//                    every block; separate from `modulate` because fusing them would
//                    force a caller that needs only one to supply dummies for the other.
//
// LAYOUT, shared by all four: activations are [token][channel] row-major, and for the
// RoPE kernel [token][head][dim] -- the reference unflattens the projection to
// (heads, headDim) on the LAST axis, so head h of token t is contiguous. Reading it as
// [head][token][dim] transposes silently and is shape-compatible.

// ─────────────────────────────── LayerNorm ───────────────────────────────
// One workgroup per TOKEN, cooperating over that token's channels. Not one thread per
// token: dim is 3072 in this model, and a single lane walking it is the one-lane mistake
// that made attention 8x slower than it had to be.
//
// Two passes (mean, then variance) rather than the sum/sum-of-squares trick: at f32 the
// one-pass form loses precision exactly where the variance is small, and a modulated
// norm's input is centred by construction.

struct LnP {
  dim : u32,
  eps : f32,
  _p0 : u32, _p1 : u32,
};

@group(0) @binding(0) var<storage, read>       ln_x : array<f32>;
@group(0) @binding(1) var<storage, read_write> ln_y : array<f32>;
@group(0) @binding(2) var<uniform>             lnp  : LnP;

var<workgroup> ln_red : array<f32, 256>;

@compute @workgroup_size(256)
fn layernorm_main(@builtin(workgroup_id) wg : vec3<u32>,
                  @builtin(local_invocation_id) lid : vec3<u32>) {
  let t = wg.x;
  let base = t * lnp.dim;
  let tid = lid.x;

  var s : f32 = 0.0;
  var i : u32 = tid;
  loop {
    if (i >= lnp.dim) { break; }
    s = s + ln_x[base + i];
    i = i + 256u;
  }
  ln_red[tid] = s;
  workgroupBarrier();
  var stride : u32 = 128u;
  loop {
    if (stride == 0u) { break; }
    if (tid < stride) { ln_red[tid] = ln_red[tid] + ln_red[tid + stride]; }
    workgroupBarrier();
    stride = stride >> 1u;
  }
  let mean = ln_red[0] / f32(lnp.dim);
  workgroupBarrier();

  var v : f32 = 0.0;
  i = tid;
  loop {
    if (i >= lnp.dim) { break; }
    let d = ln_x[base + i] - mean;
    v = v + d * d;
    i = i + 256u;
  }
  ln_red[tid] = v;
  workgroupBarrier();
  stride = 128u;
  loop {
    if (stride == 0u) { break; }
    if (tid < stride) { ln_red[tid] = ln_red[tid] + ln_red[tid + stride]; }
    workgroupBarrier();
    stride = stride >> 1u;
  }
  let inv = inverseSqrt(ln_red[0] / f32(lnp.dim) + lnp.eps);
  workgroupBarrier();

  // NO learnable affine here on purpose: elementwise_affine=false. The shift and scale
  // come from `modulate`, and applying one here would double-apply the conditioning.
  i = tid;
  loop {
    if (i >= lnp.dim) { break; }
    ln_y[base + i] = (ln_x[base + i] - mean) * inv;
    i = i + 256u;
  }
}

// ─────────────────────────────── modulate ────────────────────────────────
// y[t, c] = x[t, c] * (1 + scale[c]) + shift[c]

struct ModP {
  dim    : u32,
  tokens : u32,
  _p0 : u32, _p1 : u32,
};

@group(0) @binding(0) var<storage, read>       md_x     : array<f32>;
@group(0) @binding(1) var<storage, read>       md_shift : array<f32>;
@group(0) @binding(2) var<storage, read>       md_scale : array<f32>;
@group(0) @binding(3) var<storage, read_write> md_y     : array<f32>;
@group(0) @binding(4) var<uniform>             mdp      : ModP;

@compute @workgroup_size(64)
fn modulate_main(@builtin(global_invocation_id) gid : vec3<u32>,
                 @builtin(num_workgroups) nwg : vec3<u32>) {
  let total = mdp.tokens * mdp.dim;
  let idx = gid.x + gid.y * nwg.x * 64u;
  if (idx >= total) { return; }
  let c = idx % mdp.dim;
  md_y[idx] = md_x[idx] * (1.0 + md_scale[c]) + md_shift[c];
}

// ────────────────────────────── add_gated ────────────────────────────────
// y[t, c] = x[t, c] + gate[c] * delta[t, c]

@group(0) @binding(0) var<storage, read>       ag_x     : array<f32>;
@group(0) @binding(1) var<storage, read>       ag_delta : array<f32>;
@group(0) @binding(2) var<storage, read>       ag_gate  : array<f32>;
@group(0) @binding(3) var<storage, read_write> ag_y     : array<f32>;
@group(0) @binding(4) var<uniform>             agp      : ModP;

@compute @workgroup_size(64)
fn add_gated_main(@builtin(global_invocation_id) gid : vec3<u32>,
                  @builtin(num_workgroups) nwg : vec3<u32>) {
  let total = agp.tokens * agp.dim;
  let idx = gid.x + gid.y * nwg.x * 64u;
  if (idx >= total) { return; }
  let c = idx % agp.dim;
  ag_y[idx] = ag_x[idx] + ag_gate[c] * ag_delta[idx];
}

// ──────────────────────── RoPE, INTERLEAVED pairs ────────────────────────
// out[2p]   = x[2p]   * cos[2p]   - x[2p+1] * sin[2p]
// out[2p+1] = x[2p+1] * cos[2p+1] + x[2p]   * sin[2p+1]
//
// cos/sin are per-TOKEN tables of head_dim entries, shared by every head, with each
// frequency REPEAT-INTERLEAVED (slots 2p and 2p+1 carry the same value) to match
// `repeat_interleave_real=True`. Reading cos at 2p and 2p+1 separately rather than once
// is deliberate: it keeps this kernel correct if a caller ever supplies a non-repeated
// table, and costs nothing (the value is in cache either way).
//
// 🚨 This is NOT rope_imrope.wgsl's pairing. See the header.

struct RopeP {
  tokens   : u32,
  heads    : u32,
  head_dim : u32,
  _p0 : u32,
};

@group(0) @binding(0) var<storage, read>       rp_x   : array<f32>;
@group(0) @binding(1) var<storage, read>       rp_cos : array<f32>;
@group(0) @binding(2) var<storage, read>       rp_sin : array<f32>;
@group(0) @binding(3) var<storage, read_write> rp_y   : array<f32>;
@group(0) @binding(4) var<uniform>             rpp    : RopeP;

@compute @workgroup_size(64)
fn rope_interleaved_main(@builtin(global_invocation_id) gid : vec3<u32>,
                         @builtin(num_workgroups) nwg : vec3<u32>) {
  // one thread per (token, head, PAIR)
  let pairs = rpp.head_dim / 2u;
  let total = rpp.tokens * rpp.heads * pairs;
  let idx = gid.x + gid.y * nwg.x * 64u;
  if (idx >= total) { return; }

  let pair = idx % pairs;
  let rem  = idx / pairs;
  let head = rem % rpp.heads;
  let tok  = rem / rpp.heads;

  let o = (tok * rpp.heads + head) * rpp.head_dim + pair * 2u;
  let p = tok * rpp.head_dim + pair * 2u;

  let a = rp_x[o];
  let b = rp_x[o + 1u];
  rp_y[o]      = a * rp_cos[p]      - b * rp_sin[p];
  rp_y[o + 1u] = b * rp_cos[p + 1u] + a * rp_sin[p + 1u];
}

// ──────────────── full (non-causal) multi-head attention ─────────────────
// 🚨 NEITHER softmax_attn.wgsl NOR softmax_attn_batched.wgsl CAN SERVE THIS MODEL, and
// the reason is not performance -- both are CAUSAL. An image transformer attends
// bidirectionally: token 3 must see token 700. Running a causal kernel here masks most
// of every row, renormalises what is left, and returns a perfectly well-formed tensor.
// The image would simply be wrong.
//
// Two more differences make the reuse impossible rather than merely incorrect: both LLM
// kernels read K/V from a 4-bit QUANTIZED KV CACHE (this model has no cache -- every
// token is present at once, in f32), and both implement GQA (this model has 24 query
// heads and 24 KV heads, so the mapping is the identity).
//
// FLASH-STYLE ONLINE SOFTMAX, one workgroup per (token, head). The running max/sum let
// it stream the key axis in tiles with no O(n^2) score buffer, which matters at 768
// tokens. Lanes split the key axis when computing scores, and split the HEAD DIM when
// accumulating the output -- so the per-lane accumulator is a couple of registers rather
// than a head_dim-wide array in workgroup memory, which at 64 lanes x 128 dims would be
// 32 KB and exceed the guaranteed limit.
//
// Layout is [token][head][dim], matching `image/mmdit.ts attention` -- the reference
// unflattens the projection to (heads, headDim) on the LAST axis. Reading it as
// [head][token][dim] transposes silently and is shape-compatible.

const ATT_WG : u32 = 64u;

struct AttnFullP {
  tokens   : u32,
  heads    : u32,
  head_dim : u32,
  scale    : f32,      // 1/sqrt(head_dim)
};

@group(0) @binding(0) var<storage, read>       af_q : array<f32>;
@group(0) @binding(1) var<storage, read>       af_k : array<f32>;
@group(0) @binding(2) var<storage, read>       af_v : array<f32>;
@group(0) @binding(3) var<storage, read_write> af_y : array<f32>;
@group(0) @binding(4) var<uniform>             afp  : AttnFullP;

var<workgroup> af_score : array<f32, 64>;   // one score per lane per tile
var<workgroup> af_red   : array<f32, 64>;
var<workgroup> af_m     : f32;              // running max
var<workgroup> af_l     : f32;              // running sum of exp

@compute @workgroup_size(64)
fn attn_full_main(@builtin(workgroup_id) wg : vec3<u32>,
                  @builtin(local_invocation_id) lid : vec3<u32>,
                  @builtin(num_workgroups) nwg : vec3<u32>) {
  let pair = wg.x + wg.y * nwg.x;             // (token, head), flattened
  let total = afp.tokens * afp.heads;
  if (pair >= total) { return; }
  let head = pair % afp.heads;
  let tok  = pair / afp.heads;
  let hd   = afp.head_dim;
  let lane = lid.x;

  let qo = (tok * afp.heads + head) * hd;

  if (lane == 0u) { af_m = -3.0e38; af_l = 0.0; }
  workgroupBarrier();

  // The output accumulator lives in registers: this lane owns dims lane, lane+64, ...
  // ACC_MAX bounds head_dim at 64*8 = 512; this model uses 128.
  const ACC_MAX : u32 = 8u;
  var acc : array<f32, 8>;
  for (var a : u32 = 0u; a < ACC_MAX; a = a + 1u) { acc[a] = 0.0; }

  var tile : u32 = 0u;
  loop {
    if (tile >= afp.tokens) { break; }

    // ---- scores for this tile: lane j handles key tile+lane ----
    let j = tile + lane;
    var s : f32 = -3.0e38;
    if (j < afp.tokens) {
      let ko = (j * afp.heads + head) * hd;
      var d : f32 = 0.0;
      for (var i : u32 = 0u; i < hd; i = i + 1u) { d = d + af_q[qo + i] * af_k[ko + i]; }
      s = d * afp.scale;
    }
    af_score[lane] = s;
    af_red[lane] = s;
    workgroupBarrier();

    // ---- tile max ----
    var stride : u32 = ATT_WG >> 1u;
    loop {
      if (stride == 0u) { break; }
      if (lane < stride) { af_red[lane] = max(af_red[lane], af_red[lane + stride]); }
      workgroupBarrier();
      stride = stride >> 1u;
    }
    let tile_max = af_red[0];
    workgroupBarrier();

    // ---- rescale the running state to the new max ----
    let m_old = af_m;
    let m_new = max(m_old, tile_max);
    // exp(-inf - -inf) is NaN, so guard the very first tile where both are -3e38.
    let rescale = select(exp(m_old - m_new), 0.0, m_old <= -3.0e38);
    if (lane == 0u) { af_m = m_new; }
    workgroupBarrier();

    // ---- tile sum of exp ----
    var e : f32 = 0.0;
    if (j < afp.tokens) { e = exp(af_score[lane] - m_new); }
    af_red[lane] = e;
    af_score[lane] = e;     // reuse as the weight for the accumulation below
    workgroupBarrier();
    stride = ATT_WG >> 1u;
    loop {
      if (stride == 0u) { break; }
      if (lane < stride) { af_red[lane] = af_red[lane] + af_red[lane + stride]; }
      workgroupBarrier();
      stride = stride >> 1u;
    }
    if (lane == 0u) { af_l = af_l * rescale + af_red[0]; }
    workgroupBarrier();

    // ---- accumulate weighted V over this tile, this lane's dims ----
    var a : u32 = 0u;
    loop {
      let d = lane + a * ATT_WG;
      if (d >= hd || a >= ACC_MAX) { break; }
      var sum : f32 = 0.0;
      for (var t : u32 = 0u; t < ATT_WG; t = t + 1u) {
        let kj = tile + t;
        if (kj < afp.tokens) {
          let vo = (kj * afp.heads + head) * hd;
          sum = sum + af_score[t] * af_v[vo + d];
        }
      }
      acc[a] = acc[a] * rescale + sum;
      a = a + 1u;
    }
    workgroupBarrier();

    tile = tile + ATT_WG;
  }

  let inv_l = 1.0 / af_l;
  var a2 : u32 = 0u;
  loop {
    let d = lane + a2 * ATT_WG;
    if (d >= hd || a2 >= ACC_MAX) { break; }
    af_y[qo + d] = acc[a2] * inv_l;
    a2 = a2 + 1u;
  }
}

// ─────────────────────────── f32 matmul (x @ W^T) ────────────────────────
// y[t, o] = sum_i x[t, i] * W[o, i]   -- torch [out, in] layout, NO bias.
//
// This model has no biases anywhere, and W is stored [out, in] row-major, which makes
// the reduction contiguous in `i` for a fixed output. One workgroup per (token, output),
// 64 lanes splitting the K axis.
//
// f32 on purpose for the FIRST correct dispatch. The shipped weights are Q2_0 and
// q2_0_q8_0_matmul.wgsl already exists for them, but swapping it in changes the numerics
// (2-bit weights, quantized activations) so it cannot be differentially compared against
// the f32 CPU reference that proves this whole path. Correctness first, in the order this
// codebase already learned: "the transformer kernels earned their optimisations only
// after a CPU differential proved them right."

struct MmP {
  tokens : u32,
  in_dim : u32,
  out_dim : u32,
  _p0 : u32,
};

@group(0) @binding(0) var<storage, read>       mm_x : array<f32>;
@group(0) @binding(1) var<storage, read>       mm_w : array<f32>;
@group(0) @binding(2) var<storage, read_write> mm_y : array<f32>;
@group(0) @binding(3) var<uniform>             mmp  : MmP;

var<workgroup> mm_red : array<f32, 64>;

@compute @workgroup_size(64)
fn matmul_main(@builtin(workgroup_id) wg : vec3<u32>,
               @builtin(local_invocation_id) lid : vec3<u32>,
               @builtin(num_workgroups) nwg : vec3<u32>) {
  let pair = wg.x + wg.y * nwg.x;
  let total = mmp.tokens * mmp.out_dim;
  if (pair >= total) { return; }
  let o = pair % mmp.out_dim;
  let t = pair / mmp.out_dim;
  let lane = lid.x;

  var s : f32 = 0.0;
  var i : u32 = lane;
  loop {
    if (i >= mmp.in_dim) { break; }
    s = s + mm_x[t * mmp.in_dim + i] * mm_w[o * mmp.in_dim + i];
    i = i + 64u;
  }
  mm_red[lane] = s;
  workgroupBarrier();
  var stride : u32 = 32u;
  loop {
    if (stride == 0u) { break; }
    if (lane < stride) { mm_red[lane] = mm_red[lane] + mm_red[lane + stride]; }
    workgroupBarrier();
    stride = stride >> 1u;
  }
  if (lane == 0u) { mm_y[pair] = mm_red[0]; }
}

// ────────────────────────────── SwiGLU, fused ────────────────────────────
// y[t, i] = silu(x[t, i]) * x[t, inner + i]   over a FUSED [tokens, 2*inner] input.
//
// swiglu.wgsl takes gate and up as two SEPARATE buffers. Flux2's `linear_in` emits both
// halves in ONE tensor, and a WebGPU bind group cannot alias two overlapping views of the
// same buffer as two read bindings -- so the split has to happen inside the kernel.
// Gate is the FIRST half; swapping the halves is dimensionally identical and wrong.

struct SgP {
  tokens : u32,
  inner  : u32,
  _p0 : u32, _p1 : u32,
};

@group(0) @binding(0) var<storage, read>       sg_x : array<f32>;
@group(0) @binding(1) var<storage, read_write> sg_y : array<f32>;
@group(0) @binding(2) var<uniform>             sgp  : SgP;

@compute @workgroup_size(64)
fn swiglu_fused_main(@builtin(global_invocation_id) gid : vec3<u32>,
                     @builtin(num_workgroups) nwg : vec3<u32>) {
  let total = sgp.tokens * sgp.inner;
  let idx = gid.x + gid.y * nwg.x * 64u;
  if (idx >= total) { return; }
  let t = idx / sgp.inner;
  let i = idx % sgp.inner;
  let base = t * sgp.inner * 2u;
  let g = sg_x[base + i];
  sg_y[idx] = (g / (1.0 + exp(-g))) * sg_x[base + sgp.inner + i];
}

// ──────────────────── per-head RMSNorm (QK-norm) ─────────────────────────
// y[t, h, i] = x[t, h, i] / sqrt(mean_i(x^2) + eps) * weight[i]
//
// NOT rmsnorm.wgsl, which normalises a whole row against a row-wide weight. This
// normalises EACH HEAD independently over head_dim, with a [head_dim] weight shared by
// every head — that is what `attn.norm_q` / `attn.norm_k` are in Flux2, and applying the
// row-wide kernel would mix all 24 heads into one statistic.
//
// Applied BEFORE RoPE (convention 4). One workgroup per (token, head).

struct RmsHP {
  tokens   : u32,
  heads    : u32,
  head_dim : u32,
  eps      : f32,
};

@group(0) @binding(0) var<storage, read>       rh_x : array<f32>;
@group(0) @binding(1) var<storage, read>       rh_w : array<f32>;
@group(0) @binding(2) var<storage, read_write> rh_y : array<f32>;
@group(0) @binding(3) var<uniform>             rhp  : RmsHP;

var<workgroup> rh_red : array<f32, 64>;

@compute @workgroup_size(64)
fn rmsnorm_heads_main(@builtin(workgroup_id) wg : vec3<u32>,
                      @builtin(local_invocation_id) lid : vec3<u32>,
                      @builtin(num_workgroups) nwg : vec3<u32>) {
  let pair = wg.x + wg.y * nwg.x;
  if (pair >= rhp.tokens * rhp.heads) { return; }
  let hd = rhp.head_dim;
  let base = pair * hd;          // [token][head][dim] is contiguous per (token, head)
  let lane = lid.x;

  var s : f32 = 0.0;
  var i : u32 = lane;
  loop {
    if (i >= hd) { break; }
    let v = rh_x[base + i];
    s = s + v * v;
    i = i + 64u;
  }
  rh_red[lane] = s;
  workgroupBarrier();
  var stride : u32 = 32u;
  loop {
    if (stride == 0u) { break; }
    if (lane < stride) { rh_red[lane] = rh_red[lane] + rh_red[lane + stride]; }
    workgroupBarrier();
    stride = stride >> 1u;
  }
  let inv = inverseSqrt(rh_red[0] / f32(hd) + rhp.eps);
  workgroupBarrier();

  i = lane;
  loop {
    if (i >= hd) { break; }
    rh_y[base + i] = rh_x[base + i] * inv * rh_w[i];
    i = i + 64u;
  }
}

// ──────────────────────── strided copy (gather/scatter) ──────────────────
// dst[t*dst_stride + dst_off + j] = src[t*src_stride + src_off + j],  j < width
//
// 🚨 THIS EXISTS BECAUSE copyBufferToBuffer CANNOT BE RECORDED INSIDE AN OPEN COMPUTE
// PASS. The first runtime queued its slices, concatenations and de-interleaves as
// buffer copies and replayed them after `pass.end()` -- so every dispatch that CONSUMED
// one of those buffers read it before it had been written. The kernels were all
// individually correct on hardware and the assembled model was still wrong, diverging
// at the first double block.
//
// Splitting the compute pass at each copy would also be correct, but the single-stream
// blocks de-interleave a fused projection per token: at 768 tokens that is ~15,000 pass
// boundaries per forward. As a kernel it is one dispatch and the whole graph stays in
// one pass.
//
// One thread per (t, j). Every reshape in the MMDiT graph -- token concat, token slice,
// column range, column join -- is this op with different strides.

struct CopyP {
  tokens     : u32,
  width      : u32,
  src_stride : u32,
  src_off    : u32,
  dst_stride : u32,
  dst_off    : u32,
  _p0 : u32, _p1 : u32,
};

@group(0) @binding(0) var<storage, read>       cp_src : array<f32>;
@group(0) @binding(1) var<storage, read_write> cp_dst : array<f32>;
@group(0) @binding(2) var<uniform>             cpp    : CopyP;

@compute @workgroup_size(64)
fn copy_strided_main(@builtin(global_invocation_id) gid : vec3<u32>,
                     @builtin(num_workgroups) nwg : vec3<u32>) {
  let total = cpp.tokens * cpp.width;
  let idx = gid.x + gid.y * nwg.x * 64u;
  if (idx >= total) { return; }
  let t = idx / cpp.width;
  let j = idx % cpp.width;
  cp_dst[t * cpp.dst_stride + cpp.dst_off + j] =
    cp_src[t * cpp.src_stride + cpp.src_off + j];
}
