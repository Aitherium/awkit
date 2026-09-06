// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 * Original Aitherium WebGPU implementation — WGSL kernels ported from the PrismML
 * llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
 * NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
 *
 * Typed op layer — one function per WGSL kernel, each encoding that kernel's exact
 * bind-group order, uniform packing, and dispatch geometry (from the kernel's own
 * @group/@binding + @workgroup_size). runBlock / embed / lm-head / sampling assemble
 * the forward pass out of these; keeping the plumbing here means the block schedule in
 * layers.ts stays readable and the per-kernel contract lives in exactly one place.
 *
 * NOTE: dispatch geometry is transcribed from each kernel's contract; the end-to-end
 * numeric correctness of the assembled pass is gated by the browser-GPU milestone
 * (self-test panel). Where a kernel's thread→work mapping is one-per-element the count
 * is exact; where it is one-workgroup-per-row/head the count is the row/head count.
 */

import {
  bindGroup,
  createStorage,
  createUniform,
  deferDestroy,
  dispatch1D,
  packUniform,
  readback,
} from "../kernels/dispatch";
import { GgmlType } from "../gguf/types";
import type { PipelineCache } from "../kernels/pipelines";
import type { GpuBufferLike, GpuDeviceLike } from "../kernels/gpu-min";

const F32 = 4; // bytes per f32
const Q8_BLOCK = 32; // QK8_0 — activation quant block
const Q8_BYTES_PER_BLOCK = (1 + 8) * 4; // 1 u32 (f16 d) + 8 u32 (32 int8 qs), per 32-block

/** Bundle a device + its compiled pipelines — everything an op needs to dispatch. */
export interface OpCtx {
  device: GpuDeviceLike;
  pipelines: PipelineCache;
  /**
   * The GGUF quant type of this model's WEIGHT tensors, read from the file at load time.
   *
   * Lives on the context rather than being threaded through ~20 projection call sites,
   * because editing all of them means re-typing three same-typed `number` arguments at each
   * one — and a single transposition there silently corrupts a matmul into fluent-looking
   * garbage. That is precisely the D-812 class this codebase already paid for once.
   *
   * Absent = Q1_0, which is what every existing caller meant before Q2_0 existed.
   */
  quantType?: number;
}

/** A quantized activation tensor: per-32-block scales (act_d) + packed int8 (act_qs). */
export interface Q8Tensor {
  d: GpuBufferLike; // [nBlocks] u32 (f16 in low 16)
  qs: GpuBufferLike; // [nBlocks * 8] u32
  nBlocks: number;
}

/** Allocate an f32 storage buffer of `count` elements. */
export function f32Buffer(
  device: GpuDeviceLike,
  count: number,
  label?: string,
  opts?: { queueInit?: boolean },
): GpuBufferLike {
  return createStorage(device, Math.max(F32, count * F32), label, opts);
}

/**
 * Allocate a SCRATCH f32 buffer that is auto-destroyed after this layer's batch is
 * submitted (deferDestroy + flushDeferred, see dispatch.ts). Use for every per-call
 * intermediate in a block; use plain f32Buffer only for buffers that must PERSIST across
 * layers/tokens (conv history, SSM state, KV cache). Prevents the per-token VRAM leak.
 */
export function scratchBuffer(
  ctx: OpCtx,
  count: number,
  label?: string,
  opts?: { queueInit?: boolean },
): GpuBufferLike {
  const b = f32Buffer(ctx.device, count, label, opts);
  deferDestroy(ctx.device, b);
  return b;
}

function uniform(device: GpuDeviceLike, fields: Array<{ u32?: number; f32?: number }>): GpuBufferLike {
  const bytes = packUniform(fields);
  const buf = createUniform(device, bytes.byteLength);
  device.queue.writeBuffer(buf, 0, bytes);
  // D-850: this buffer was previously never released — the P0 leak fix (b7a52c233c)
  // covered per-layer scratch STORAGE buffers and left uniforms out, so every op leaked
  // its uniform for the lifetime of the page (~1300 per generated token). Deferring it
  // puts it on the same release path as scratch: recycled after the batch is submitted,
  // never freed mid-batch while pending passes still bind it.
  deferDestroy(device, buf);
  return buf;
}

/**
 * RMSNorm: y = x / sqrt(mean(x^2)+eps) * weight, per row of length `n`.
 * kernel: rmsnorm.wgsl — buffers [x, weight, y, Params{n, eps}], one workgroup per row.
 */
export function rmsnorm(
  ctx: OpCtx,
  x: GpuBufferLike,
  weight: GpuBufferLike,
  y: GpuBufferLike,
  nRows: number,
  n: number,
  eps: number,
): void {
  const p = uniform(ctx.device, [{ u32: n }, { f32: eps }, { u32: 0 }, { u32: 0 }]);
  const pipe = ctx.pipelines.get("rmsnorm");
  dispatch1D(ctx.device, pipe, bindGroup(ctx.device, pipe, [x, weight, y, p]), nRows, 1);
}

/**
 * Quantize f32 activations → Q8_0 (per-32-block scale + int8). Required before every
 * Q1_0 matmul (weights are Q1_0, activations Q8_0). `count` must be a multiple of 32.
 * kernel: quantize_q8_0.wgsl — buffers [activations, out_d, out_qs], one wg per 32-block.
 */
export function quantizeQ8(ctx: OpCtx, activations: GpuBufferLike, count: number): Q8Tensor {
  const nBlocks = Math.ceil(count / Q8_BLOCK);
  const d = createStorage(ctx.device, nBlocks * 4, "act_d");
  const qs = createStorage(ctx.device, nBlocks * 8 * 4, "act_qs");
  const pipe = ctx.pipelines.get("quantize_q8_0");
  dispatch1D(ctx.device, pipe, bindGroup(ctx.device, pipe, [activations, d, qs]), nBlocks, 1);
  return { d, qs, nBlocks };
}

/**
 * Q1_0 (weights) · Q8_0 (activations) matmul: out[nRows × nCols] where each output col
 * is the dot of an activation row (length K) with a weight column (length K).
 * kernel: q1_0_q8_0_matmul.wgsl — buffers [weights, act_d, act_qs, out, Dims{K,nCols,nRows}],
 * one thread per output element (@workgroup_size 64).
 */
export function q1q8Matmul(
  ctx: OpCtx,
  weightsQ1: GpuBufferLike,
  act: Q8Tensor,
  out: GpuBufferLike,
  // Param order deliberately matches projectQ1's tail: (nRows, K, nCols).
  // It used to be (K, nCols, nRows) here while projectQ1 took (nRows, K, nCols) —
  // three same-typed `number` params in two different orders, one transposition
  // away from silently corrupting every matmul, with nothing in the type system
  // able to catch it. Given Bonsai's symptom is fluent-but-wrong output (exactly
  // what a transposed matmul produces), that ambiguity had to go. (D-812 sweep)
  nRows: number,
  K: number,
  nCols: number,
): void {
  // K-tiled kernel: one workgroup = 64 cols of one row. Pass col_tiles = ceil(nCols/64)
  // and dispatch nRows*col_tiles workgroups (dispatch1D issues ceil(total/64) groups).
  const colTiles = Math.ceil(nCols / 64);
  const dims = uniform(ctx.device, [{ u32: K }, { u32: nCols }, { u32: nRows }, { u32: colTiles }]);
  const pipe = ctx.pipelines.get("q1_0_q8_0_matmul");
  const bg = bindGroup(ctx.device, pipe, [weightsQ1, act.d, act.qs, out, dims]);
  dispatch1D(ctx.device, pipe, bg, nRows * colTiles * 64, 64);
}

/**
 * Q2_0 (ternary) weights × Q8_0 activations. Same contract and param order as q1q8Matmul —
 * only the kernel differs, because the block layout differs (34 bytes / 128 weights, 2 bits
 * each, vs Q1_0's 18 / 128 at 1 bit).
 */
export function q2q8Matmul(
  ctx: OpCtx,
  weightsQ2: GpuBufferLike,
  act: Q8Tensor,
  out: GpuBufferLike,
  nRows: number,
  K: number,
  nCols: number,
): void {
  const colTiles = Math.ceil(nCols / 64);
  const dims = uniform(ctx.device, [{ u32: K }, { u32: nCols }, { u32: nRows }, { u32: colTiles }]);
  const pipe = ctx.pipelines.get("q2_0_q8_0_matmul");
  const bg = bindGroup(ctx.device, pipe, [weightsQ2, act.d, act.qs, out, dims]);
  dispatch1D(ctx.device, pipe, bg, nRows * colTiles * 64, 64);
}

/**
 * Quantize `x` (nRows×K) then matmul by a quantized weight → out (nRows×nCols).
 *
 * NAME KEPT despite now dispatching on `ctx.quantType`: renaming would touch ~20 call sites
 * across block_full_attn.ts and block_deltanet.ts, each re-typing (nRows, K, nCols) — three
 * same-typed numbers whose transposition silently produces fluent garbage. The churn is a
 * bigger risk than the stale name, so the behaviour is documented here instead.
 *
 * Q1_0 when `ctx.quantType` is unset, which is what every caller meant before Q2_0 existed.
 */
export function projectQ1(
  ctx: OpCtx,
  x: GpuBufferLike,
  weights: GpuBufferLike,
  out: GpuBufferLike,
  nRows: number,
  K: number,
  nCols: number,
): void {
  const act = quantizeQ8(ctx, x, nRows * K);
  if (ctx.quantType === GgmlType.Q2_0) {
    q2q8Matmul(ctx, weights, act, out, nRows, K, nCols);
  } else {
    q1q8Matmul(ctx, weights, act, out, nRows, K, nCols);
  }
}

/**
 * THE DISPATCHING PROJECTION — use this, not projectQ1, anywhere the weight's quant type is
 * not statically known.
 *
 * Adding Q2_0 kernels was not enough to run a ternary model: every call site here and in
 * embed_lmhead.ts named the Q1_0 path directly, so a Q2_0 model would have had its 34-byte
 * blocks read as 18-byte Q1_0 blocks. That does not crash — it produces fluent-looking
 * garbage, which is the single hardest failure to notice in this runtime and exactly what
 * D-812 cost.
 *
 * `quantType` is the GGUF dtype from the tensor registry, never a guess.
 */
export function projectQuantized(
  ctx: OpCtx,
  x: GpuBufferLike,
  weights: GpuBufferLike,
  out: GpuBufferLike,
  nRows: number,
  K: number,
  nCols: number,
  quantType: number,
): void {
  const act = quantizeQ8(ctx, x, nRows * K);
  if (quantType === GgmlType.Q2_0) {
    q2q8Matmul(ctx, weights, act, out, nRows, K, nCols);
  } else if (quantType === GgmlType.Q1_0) {
    q1q8Matmul(ctx, weights, act, out, nRows, K, nCols);
  } else {
    // Fail LOUD. A silently-wrong quant path produces plausible text, so an unknown type must
    // stop the load rather than be guessed at.
    throw new Error(
      `projectQuantized: unsupported weight quant type ${quantType} ` +
      `(supported: Q1_0=${GgmlType.Q1_0}, Q2_0=${GgmlType.Q2_0})`,
    );
  }
}

/**
 * Interleaved multimodal RoPE applied in-place to Q or K [nTokens × nHeads × headDim].
 * kernel: rope_imrope.wgsl — buffers [data(rw), RopeP{head_dim?, rot_dim, pos_base, scale}].
 * One thread per (token, head) rotating all pairs; dispatch nTokens*nHeads threads.
 */
export function ropeImrope(
  ctx: OpCtx,
  data: GpuBufferLike,
  nTokens: number,
  nHeads: number,
  headDim: number,
  rotDim: number,
  posBase: number,
  freqBase: number,
  scale = 1.0,
): void {
  // RopeP layout (EXACT, from rope_imrope.wgsl):
  //   n_heads, head_dim, rot_dim, pos_base, freq_base(f32), scale(f32), _p0, _p1
  const p = uniform(ctx.device, [
    { u32: nHeads },
    { u32: headDim },
    { u32: rotDim },
    { u32: posBase },
    { f32: freqBase },
    { f32: scale },
    { u32: 0 },
    { u32: 0 },
  ]);
  const pipe = ctx.pipelines.get("rope_imrope");
  // The kernel runs one thread per (token, head, rotary-PAIR): per_token = nHeads*(rotDim/2).
  // Dispatching only nTokens*nHeads (the old count) left 31/32 of each head unrotated for
  // rotDim=64. Dispatch the full (token,head,pair) grid.
  const pairsPerHead = Math.floor(rotDim / 2);
  dispatch1D(ctx.device, pipe, bindGroup(ctx.device, pipe, [data, p]), nTokens * nHeads * pairsPerHead, 64);
}

/**
 * Scaled-dot-product attention for ONE query head against cached f32 K/V.
 * kernel: softmax_attn.wgsl — buffers [q[headDim], k[nKv*headDim], v[nKv*headDim], out[headDim],
 * AttnP{n_kv, q_head, kv_head, scale}], @workgroup_size 1, one workgroup per (query,head).
 */
export function softmaxAttnHead(
  ctx: OpCtx,
  q: GpuBufferLike,
  k: GpuBufferLike,
  v: GpuBufferLike,
  out: GpuBufferLike,
  headDim: number,
  nKv: number,
  qHead: number,
  kvHead: number,
  scale: number,
): void {
  // AttnP layout (EXACT, from softmax_attn.wgsl):
  //   head_dim, n_kv, q_head, kv_head, scale(f32), _p0, _p1, _p2
  const p = uniform(ctx.device, [
    { u32: headDim },
    { u32: nKv },
    { u32: qHead },
    { u32: kvHead },
    { f32: scale },
    { u32: 0 },
    { u32: 0 },
    { u32: 0 },
  ]);
  const pipe = ctx.pipelines.get("softmax_attn");
  dispatch1D(ctx.device, pipe, bindGroup(ctx.device, pipe, [q, k, v, out, p]), 1, 1);
}

/**
 * Batched causal GQA attention: the whole (token × head) grid in ONE dispatch. q is
 * [nTokens × nHeads × headDim] (post-RoPE); kCache/vCache are [kvLen × nHeadsKv × headDim];
 * out is [nTokens × nHeads × headDim]. Query (posBase+t) attends to cache positions
 * [0, posBase+t]. kernel: softmax_attn_batched.wgsl — one workgroup per (token, head).
 */
export function softmaxAttnBatched(
  ctx: OpCtx,
  q: GpuBufferLike,
  kCache: GpuBufferLike,
  vCache: GpuBufferLike,
  out: GpuBufferLike,
  nTokens: number,
  nHeads: number,
  nHeadsKv: number,
  headDim: number,
  posBase: number,
  scale: number,
  kScale?: GpuBufferLike,
  vScale?: GpuBufferLike,
): void {
  // 4-bit mode (KvCache) passes per-(pos,kv_head) f16 scale buffers; f32 mode omits them.
  // The uniform slot 6 (BAttnP.mode) tells the kernel which dequant to use; the scale
  // bindings 5/6 are ALWAYS bound — a 4-byte dummy in f32 mode, which the kernel's uniform
  // `if (p.mode == 1u)` guard never indexes. See softmax_attn_batched.wgsl.
  const mode4bit = !!(kScale && vScale);
  const p = uniform(ctx.device, [
    { u32: nTokens },
    { u32: nHeads },
    { u32: nHeadsKv },
    { u32: headDim },
    { u32: posBase },
    { f32: scale },
    { u32: mode4bit ? 1 : 0 },
    { u32: 0 },
  ]);
  // head_dim > 256 would silently DROP dimensions: the kernel gives each of its 128 lanes
  // exactly 2 dims. Fail loudly instead — a partial attention output is fluent, wrong text.
  if (headDim > 256) {
    throw new Error(
      `bonsai-ops: softmaxAttnBatched supports head_dim <= 256, got ${headDim}. ` +
        `Raise DPT in softmax_attn_batched.wgsl to ceil(head_dim/128) to extend it.`,
    );
  }
  // 4-bit mode REQUIRES head_dim % 8 == 0 (a row is a whole number of packed u32 words, so
  // the flat element index -> (word, nibble) mapping never crosses a row boundary).
  if (mode4bit && headDim % 8 !== 0) {
    throw new Error(
      `bonsai-ops: softmaxAttnBatched 4-bit mode requires head_dim % 8 == 0, got ${headDim}.`,
    );
  }
  const pipe = ctx.pipelines.get("softmax_attn_batched");
  const bg = bindGroup(ctx.device, pipe, [
    q, kCache, vCache, out, p,
    kScale ?? kvScaleDummy(ctx.device),
    vScale ?? kvScaleDummy(ctx.device),
  ]);
  // THE LAST ARG IS 1 ON PURPOSE — DO NOT "FIX" IT TO 128.
  // dispatch1D computes groups = ceilDiv(totalThreads, workgroupSize), and this kernel wants
  // ONE WORKGROUP per (token, head) with 128 lanes cooperating INSIDE it. Passing 128 here
  // would divide the group count by 128 and compute 1/128th of the attention — silently, with
  // the rest of the output buffer left at whatever the pooled scratch held.
  dispatch1D(ctx.device, pipe, bg, nTokens * nHeads, 1);
}

/**
 * Depthwise causal 1-D conv over [nTokens × channels], left-padded by kernel-1.
 * kernel: causal_conv1d.wgsl — buffers [x, weight[channels*kernel], bias[channels], out, ConvP].
 * One thread per (token, channel).
 */
export function causalConv1d(
  ctx: OpCtx,
  x: GpuBufferLike,
  weight: GpuBufferLike,
  bias: GpuBufferLike,
  out: GpuBufferLike,
  nTokens: number,
  channels: number,
  kernel: number,
): void {
  const p = uniform(ctx.device, [{ u32: nTokens }, { u32: channels }, { u32: kernel }, { u32: 0 }]);
  const pipe = ctx.pipelines.get("causal_conv1d");
  const bg = bindGroup(ctx.device, pipe, [x, weight, bias, out, p]);
  dispatch1D(ctx.device, pipe, bg, nTokens * channels, 64);
}

/**
 * Single-step gated DeltaNet recurrence for ONE head. Updates persisted state S[d_k*d_v]
 * in place and writes out[d_v]. kernel: deltanet.wgsl — buffers [q,k,g[d_k], v[d_v],
 * beta[1], state(rw)[d_k*d_v], out[d_v], DeltaP{d_k, d_v}], @workgroup_size 1, one wg/head.
 */
/** @deprecated NOT on the live path — zero callers as of 2026-07-24. Token
 *  generation uses deltanetSeq(). Dispatches deltanet.wgsl, which carries older
 *  recurrence algebra than deltanet_seq.wgsl; see the banner in that file. */
export function deltanetStep(
  ctx: OpCtx,
  q: GpuBufferLike,
  k: GpuBufferLike,
  v: GpuBufferLike,
  g: GpuBufferLike,
  beta: GpuBufferLike,
  state: GpuBufferLike,
  out: GpuBufferLike,
  dK: number,
  dV: number,
  head: number,
): void {
  // DeltaP layout (EXACT, from deltanet.wgsl): d_k, d_v, head, _p0
  const p = uniform(ctx.device, [{ u32: dK }, { u32: dV }, { u32: head }, { u32: 0 }]);
  const pipe = ctx.pipelines.get("deltanet");
  const bg = bindGroup(ctx.device, pipe, [q, k, v, g, beta, state, out, p]);
  dispatch1D(ctx.device, pipe, bg, 1, 1);
}

/**
 * SwiGLU elementwise stage: out = silu(gate) * up, length n. (gate/up/down are separate
 * Q1_0 matmuls done by the caller.) kernel: swiglu.wgsl — buffers [gate, up, out, n].
 */
export function swigluMul(ctx: OpCtx, gate: GpuBufferLike, up: GpuBufferLike, out: GpuBufferLike, n: number): void {
  const p = uniform(ctx.device, [{ u32: n }]);
  const pipe = ctx.pipelines.get("swiglu");
  dispatch1D(ctx.device, pipe, bindGroup(ctx.device, pipe, [gate, up, out, p]), n, 256);
}

export type EwOp = 0 | 1 | 2 | 3 | 4; // 0=add, 1=mul, 2=copy(a), 3=silu(unary), 4=mul-sigmoid(io *= sigmoid(b))

/** In-place elementwise: io = io ∘ b (length n). op: 0=add, 1=mul, 2=copy(no-op),
 *  3=silu(io) (b ignored). Binds the accumulator ONCE as read_write — WebGPU rejects
 *  binding one buffer as both read and read_write in a single dispatch, which is why the
 *  2-input elementwise can't alias. */
export function elementwiseInplace(
  ctx: OpCtx,
  io: GpuBufferLike,
  b: GpuBufferLike,
  n: number,
  op: EwOp,
): void {
  const p = uniform(ctx.device, [{ u32: n }, { u32: op }, { u32: 0 }, { u32: 0 }]);
  const pipe = ctx.pipelines.get("elementwise_inplace");
  dispatch1D(ctx.device, pipe, bindGroup(ctx.device, pipe, [io, b, p]), n, 256);
}

// A per-device 4-byte scratch buffer to satisfy the (unused) `b` binding of the unary
// SiLU path. The kernel never reads it for op=3; it just needs a valid storage binding.
const siluScratch = new WeakMap<GpuDeviceLike, GpuBufferLike>();
function siluDummy(device: GpuDeviceLike): GpuBufferLike {
  let b = siluScratch.get(device);
  if (!b) {
    b = createStorage(device, 4, "silu_dummy");
    siluScratch.set(device, b);
  }
  return b;
}

// Same idea for the softmaxAttnBatched scale bindings (5/6): in f32 mode the kernel never
// indexes them (uniform `if (p.mode == 1u)`), but the bind group still needs a valid storage
// buffer of at least 4 bytes. Sharing one 4-byte dummy per device, exactly like siluDummy.
const kvScaleScratch = new WeakMap<GpuDeviceLike, GpuBufferLike>();
function kvScaleDummy(device: GpuDeviceLike): GpuBufferLike {
  let b = kvScaleScratch.get(device);
  if (!b) {
    b = createStorage(device, 4, "kv_scale_dummy");
    kvScaleScratch.set(device, b);
  }
  return b;
}

/** In-place output gating: io = io * sigmoid(gate), length n (Qwen3.5 attn out-gate). */
export function mulSigmoidInplace(ctx: OpCtx, io: GpuBufferLike, gate: GpuBufferLike, n: number): void {
  elementwiseInplace(ctx, io, gate, n, 4);
}

/** In-place SiLU: io = io * sigmoid(io), length n. */
export function siluInplace(ctx: OpCtx, io: GpuBufferLike, n: number): void {
  elementwiseInplace(ctx, io, siluDummy(ctx.device), n, 3);
}

/**
 * Gated-DeltaNet per-(token, v-head) scalars: beta = sigmoid(betaRaw); decay g =
 * exp(-exp(aLog) * softplus(alphaRaw + dtBias)). aLog/dtBias are per-v-head [heads].
 * kernel: deltanet_gate.wgsl — one thread per (token, v-head).
 */
export function deltanetGate(
  ctx: OpCtx,
  alphaRaw: GpuBufferLike,
  betaRaw: GpuBufferLike,
  aLog: GpuBufferLike,
  dtBias: GpuBufferLike,
  gOut: GpuBufferLike,
  betaOut: GpuBufferLike,
  nTokens: number,
  heads: number,
): void {
  const p = uniform(ctx.device, [{ u32: nTokens }, { u32: heads }, { u32: 0 }, { u32: 0 }]);
  const pipe = ctx.pipelines.get("deltanet_gate");
  const bg = bindGroup(ctx.device, pipe, [alphaRaw, betaRaw, aLog, dtBias, gOut, betaOut, p]);
  dispatch1D(ctx.device, pipe, bg, nTokens * heads, 64);
}

/**
 * Full gated-DeltaNet recurrence over the whole token sequence in one dispatch. q/k are
 * L2-normed [nTokens × kHeads × headDim]; v is conv+SiLU'd [nTokens × vHeads × headDim];
 * gdec/beta are [nTokens × vHeads]; state is persisted [vHeads × headDim × headDim]; out
 * is [nTokens × vHeads × headDim]. kernel: deltanet_seq.wgsl — one thread per (v-head,
 * value-column); the per-token scan runs inside the thread (columns are race-free).
 */
export function deltanetSeq(
  ctx: OpCtx,
  q: GpuBufferLike,
  k: GpuBufferLike,
  v: GpuBufferLike,
  gdec: GpuBufferLike,
  beta: GpuBufferLike,
  state: GpuBufferLike,
  out: GpuBufferLike,
  nTokens: number,
  vHeads: number,
  kHeads: number,
  headDim: number,
  vPerK: number,
): void {
  const p = uniform(ctx.device, [
    { u32: nTokens },
    { u32: vHeads },
    { u32: kHeads },
    { u32: headDim },
    { u32: vPerK },
    { u32: 0 },
    { u32: 0 },
    { u32: 0 },
  ]);
  const pipe = ctx.pipelines.get("deltanet_seq");
  const bg = bindGroup(ctx.device, pipe, [q, k, v, gdec, beta, state, out, p]);
  dispatch1D(ctx.device, pipe, bg, vHeads * headDim, 64);
}

/** Elementwise a∘b → out, length n. op: 0=add (residual), 1=mul, 2=copy(a).
 *  If `out` aliases an input, route to the in-place kernel (a single read_write binding)
 *  to avoid the read/read_write aliasing WebGPU forbids. */
export function elementwise(
  ctx: OpCtx,
  a: GpuBufferLike,
  b: GpuBufferLike,
  out: GpuBufferLike,
  n: number,
  op: EwOp,
): void {
  if (out === a) { elementwiseInplace(ctx, out, b, n, op); return; }
  if (out === b) { elementwiseInplace(ctx, out, a, n, op); return; } // add/mul commute
  const p = uniform(ctx.device, [{ u32: n }, { u32: op }, { u32: 0 }, { u32: 0 }]);
  const pipe = ctx.pipelines.get("elementwise");
  dispatch1D(ctx.device, pipe, bindGroup(ctx.device, pipe, [a, b, out, p]), n, 256);
}

/** In-place residual add: acc += delta (length n). */
export function residualAdd(ctx: OpCtx, acc: GpuBufferLike, delta: GpuBufferLike, n: number): void {
  elementwiseInplace(ctx, acc, delta, n, 0);
}

/** Sampling controls. Card defaults for Bonsai: temp 0.7, top-k 20, top-p 0.95. */
export interface SampleOptions {
  /** <= 0 selects the greedy/argmax path. */
  temperature?: number;
  /** Keep only the K highest-logit candidates (0/undefined = no cap). */
  topK?: number;
  /** Nucleus: keep the smallest candidate set whose probability mass >= topP. */
  topP?: number;
  /** CTRL-style penalty applied to ids in `recentIds` (1 = off, 1.1 typical). */
  repetitionPenalty?: number;
  /** Ids the repetition penalty applies to (the recent window of generated ids). */
  recentIds?: readonly number[];
  /** Injectable RNG so a test can pin the draw. Defaults to Math.random. */
  random?: () => number;
}

/**
 * Temperature / top-k / top-p sampling over logits[vocab]. Returns the chosen token id.
 *
 * WHY ON THE HOST: sampling.wgsl only ever computed an ARGMAX — it accepts a `temperature`
 * uniform and never reads it — so every in-browser turn was greedy no matter what the caller
 * passed. Greedy decoding of a 1-bit 27B degenerates into the exact repetition the owner saw
 * ("…the user is expected to # call the right function" ×N, then "1, 1, 1, 1"). The kernel's
 * own header always said host-side nucleus truncation was the v1 plan; this is that half,
 * which nobody had written. One readback of the logits row (248320 f32 ≈ 1 MB) replaces the
 * 4-byte argmax readback — same number of GPU syncs per token, negligible next to a 64-layer
 * forward pass. A GPU bitonic top-k stays the follow-up optimisation.
 */
/**
 * Sub-phase attribution for the sampling step, filled only when `__BONSAI_TIMING` is on.
 *
 * The decode breakdown showed `sample=` at 119–315 ms/token on the 4B at a 1285-token
 * context — LARGER than the whole forward pass once the attention kernel was fixed. "sample"
 * is two very different costs bolted together: a ~1 MB GPU->host readback of the full logits
 * row (248,320 f32) with the queue drain that implies, and a JS pass over all 248,320
 * elements to pick the top-k. They have opposite fixes — the first wants the selection moved
 * onto the GPU, the second wants a better JS loop — so optimising before splitting them is
 * how you spend a day on the wrong half. Same lesson as attributing a stall to the network
 * because the fetch was the only visible error.
 */
export const sampleTiming = { readbackMs: 0, selectMs: 0, calls: 0 };

/**
 * Sample from a CANDIDATE SET (ids + logits), applying temperature, top-k and top-p.
 *
 * Shared by the GPU-top-k path and the full-readback fallback so both draw from exactly the
 * same distribution — two copies of this arithmetic is how a "fast path" quietly becomes a
 * different model.
 */
function sampleFromCandidates(
  ids: Uint32Array | number[],
  vals: Float32Array | number[],
  k: number,
  temperature: number,
  opts: SampleOptions,
  rng: () => number,
): number {
  const n = ids.length;
  // Order descending by logit, keep at most k. n is a few hundred here, so a plain sort is
  // cheaper than the bounded-insertion loop the full-row path needs.
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => (vals[b] as number) - (vals[a] as number));
  const keep = order.slice(0, Math.max(1, Math.min(k, n)));

  if (temperature <= 0) return ids[keep[0]] as number;

  const maxLogit = vals[keep[0]] as number;
  const probs = new Float64Array(keep.length);
  let sum = 0;
  for (let i = 0; i < keep.length; i++) {
    const p = Math.exp(((vals[keep[i]] as number) - maxLogit) / temperature);
    probs[i] = p;
    sum += p;
  }
  if (!(sum > 0) || !Number.isFinite(sum)) return ids[keep[0]] as number;

  let cutoff = keep.length;
  const topP = opts.topP ?? 1;
  if (topP > 0 && topP < 1) {
    let acc = 0;
    for (let i = 0; i < keep.length; i++) {
      acc += probs[i] / sum;
      if (acc >= topP) { cutoff = i + 1; break; }
    }
  }
  let mass = 0;
  for (let i = 0; i < cutoff; i++) mass += probs[i];
  let r = rng() * mass;
  for (let i = 0; i < cutoff; i++) {
    r -= probs[i];
    if (r <= 0) return ids[keep[i]] as number;
  }
  return ids[keep[cutoff - 1]] as number;
}

export async function sampleToken(
  ctx: OpCtx,
  logits: GpuBufferLike,
  vocab: number,
  opts: SampleOptions = {},
): Promise<number> {
  const temperature = opts.temperature ?? 0;
  const rng = opts.random ?? Math.random;
  const TIMING = (globalThis as { __BONSAI_TIMING?: boolean }).__BONSAI_TIMING === true;
  const _t0 = TIMING ? performance.now() : 0;

  /*
   * GPU-SIDE TOP-K FIRST. The full-row readback below moves ~993 KB per token and was
   * measured at 83.4 ms of an 83.9 ms sample phase — the JS selection it feeds costs 0.4 ms.
   * gpuTopK returns a few hundred candidates instead, and returns null (falling through to
   * the exact-but-slow path) rather than ever sampling from a truncated set.
   *
   * Skipped when a repetition penalty is active with recent ids: that rewrites arbitrary
   * logits BEFORE selection, and a token pushed down by the penalty may be one the gather
   * already excluded — so the penalty has to see the whole row or it is not the same
   * distribution. Correctness over speed, and it is a rarely-used option.
   */
  const penaltyActive = (opts.repetitionPenalty ?? 1) !== 1 && !!opts.recentIds?.length;
  const kWanted = opts.topK && opts.topK > 0 ? Math.min(opts.topK, vocab) : Math.min(64, vocab);
  /*
   * OPT-IN, AND OFF BY DEFAULT — BECAUSE THE A/B SAID SO.
   *
   * The premise of this path was that the ~993 KB logits transfer was the cost. It is not.
   * Two arms, same session, 4B at the greeter shape, sample-phase ms per turn:
   *
   *     GPU top-k ON   14.0   13.7   133.8   9.4
   *     full readback  10.1   10.2   121.9  10.4
   *
   * Slower on three turns of four. The cost is the ROUND-TRIP, not the bytes: one
   * mapAsync became three (histogram, counter, then ids+vals), and each one is a
   * CPU-GPU synchronisation whose latency dwarfs the ~60x reduction in data moved.
   * `select` stayed at 0.4 ms in BOTH arms, which is the tell — the host-side work this
   * was built to remove was never the problem in the first place.
   *
   * Kept, not deleted, and kept OFF: the kernel is correct (greedy output byte-identical,
   * forward differential 12/12 with cpuArgmax == gpuArgmax, 7 threshold tests) and the
   * trade flips wherever a transfer actually costs something — an integrated GPU over a
   * slow bus, or a phone. Turning it on there is one flag. Shipping it on HERE would be
   * a regression sold as an optimisation.
   *
   * Set `__BONSAI_GPU_TOPK = true` to enable and re-run the A/B on that device.
   */
  const useGpuTopK = (globalThis as { __BONSAI_GPU_TOPK?: boolean }).__BONSAI_GPU_TOPK === true;
  if (!penaltyActive && useGpuTopK) {
    const picked = await gpuTopK(ctx, logits, vocab, Math.max(kWanted, 1));
    if (picked && picked.ids.length) {
      const _tg = TIMING ? performance.now() : 0;
      if (TIMING) { sampleTiming.readbackMs += _tg - _t0; sampleTiming.calls++; }
      const out = sampleFromCandidates(picked.ids, picked.vals, kWanted, temperature, opts, rng);
      if (TIMING) sampleTiming.selectMs += performance.now() - _tg;
      return out;
    }
  }

  const row = await readbackF32(ctx, logits, vocab);
  const _t1 = TIMING ? performance.now() : 0;
  if (TIMING) { sampleTiming.readbackMs += _t1 - _t0; sampleTiming.calls++; }
  // Every return below routes through this so the JS half is measured whichever path is
  // taken — greedy, top-k or the degenerate-row bail.
  const done = <T,>(v: T): T => {
    if (TIMING) sampleTiming.selectMs += performance.now() - _t1;
    return v;
  };

  // Repetition penalty first, on raw logits (CTRL: divide when positive, multiply when not,
  // so the penalty always moves the logit DOWN regardless of sign).
  const penalty = opts.repetitionPenalty ?? 1;
  if (penalty !== 1 && opts.recentIds?.length) {
    for (const id of new Set(opts.recentIds)) {
      if (id < 0 || id >= vocab) continue;
      const v = row[id];
      row[id] = v > 0 ? v / penalty : v * penalty;
    }
  }

  // Greedy path — still the right answer at temperature 0, and cheap.
  if (temperature <= 0) {
    let bi = 0;
    let bv = -Infinity;
    for (let i = 0; i < vocab; i++) if (row[i] > bv) { bv = row[i]; bi = i; }
    return done(bi);
  }

  // Top-k by BOUNDED selection, never a full sort: vocab is 248320, so `idx.sort()` would
  // cost ~4.4M comparisons of JS closure per token — comparable to a whole GPU forward pass
  // and a straight regression against the argmax it replaces. One linear pass maintaining
  // the k best (k=20) is ~n·log k and effectively free.
  const k = opts.topK && opts.topK > 0 ? Math.min(opts.topK, vocab) : Math.min(64, vocab);
  const cand: number[] = []; // ids, kept sorted DESCENDING by logit; length <= k
  let worst = -Infinity; // logit of cand[cand.length - 1]
  for (let i = 0; i < vocab; i++) {
    const v = row[i];
    if (cand.length === k && v <= worst) continue;
    // Insertion point in a k-element list — k is tiny, so a linear probe beats a heap.
    let j = cand.length;
    while (j > 0 && row[cand[j - 1]] < v) j--;
    cand.splice(j, 0, i);
    if (cand.length > k) cand.pop();
    worst = row[cand[cand.length - 1]];
  }

  // Softmax over the candidates only, max-shifted for stability.
  const maxLogit = row[cand[0]];
  const probs = new Float64Array(cand.length);
  let sum = 0;
  for (let i = 0; i < cand.length; i++) {
    const p = Math.exp((row[cand[i]] - maxLogit) / temperature);
    probs[i] = p;
    sum += p;
  }
  if (!(sum > 0) || !Number.isFinite(sum)) return done(cand[0]); // degenerate row -> greedy

  // Top-p nucleus: keep the shortest prefix reaching the mass (cand is already descending).
  let cutoff = cand.length;
  const topP = opts.topP ?? 1;
  if (topP > 0 && topP < 1) {
    let acc = 0;
    for (let i = 0; i < cand.length; i++) {
      acc += probs[i] / sum;
      if (acc >= topP) { cutoff = i + 1; break; }
    }
  }

  let mass = 0;
  for (let i = 0; i < cutoff; i++) mass += probs[i];
  let r = rng() * mass;
  for (let i = 0; i < cutoff; i++) {
    r -= probs[i];
    if (r <= 0) return done(cand[i]);
  }
  return done(cand[cutoff - 1]);
}

/**
 * Argmax over logits[vocab]. Returns the chosen token id.
 * kernel: sampling.wgsl — buffers [logits, argmax(u32), maxval(f32), SampleP{vocab, temperature}].
 * NOTE: the kernel ignores `temperature` entirely — it is an argmax reduction. Use
 * {@link sampleToken} for anything but deliberate greedy decoding.
 */
export async function sampleArgmax(
  ctx: OpCtx,
  logits: GpuBufferLike,
  vocab: number,
  temperature = 0,
): Promise<number> {
  const argmax = createStorage(ctx.device, 4, "argmax");
  const maxval = createStorage(ctx.device, 4, "maxval");
  const p = uniform(ctx.device, [{ u32: vocab }, { f32: temperature }, { u32: 0 }, { u32: 0 }]);
  const pipe = ctx.pipelines.get("sampling");
  dispatch1D(ctx.device, pipe, bindGroup(ctx.device, pipe, [logits, argmax, maxval, p]), 1, 1);
  const buf = await readback(ctx.device, argmax, 4);
  return new Uint32Array(buf)[0];
}

/**
 * GPU-side top-k: return only the candidates the sampler can possibly need.
 *
 * Replaces a ~993 KB full-logits readback per token with two small dispatches and a ~16 KB
 * worst-case readback. See kernels/wgsl/logit_topk.wgsl for why this is exact and
 * model/topk-threshold.ts for the one decision that could be wrong.
 *
 * Returns null when the caller must fall back to the full readback — either the histogram
 * could not yield a usable threshold, or more candidates cleared it than the gather can
 * hold. Falling back is slow and correct; the alternative is silently sampling from a
 * truncated candidate set, which looks like a worse model rather than a bug.
 */
export async function gpuTopK(
  ctx: OpCtx,
  logits: GpuBufferLike,
  vocab: number,
  k: number,
): Promise<{ ids: Uint32Array; vals: Float32Array } | null> {
  const {
    chooseThreshold, LOGIT_HIST_BINS, LOGIT_RANGE_LO, LOGIT_RANGE_HI, TOPK_GATHER_CAPACITY,
  } = await import("./topk-threshold");

  const NBINS = LOGIT_HIST_BINS;
  const CAP = TOPK_GATHER_CAPACITY;

  // createStorage zero-initialises a FRESH buffer, but the pool hands back recycled ones —
  // and an un-zeroed histogram is stale counts from the previous token, i.e. a wrong
  // threshold with no error. createStorage's recycle path clears, which is what makes this
  // safe; see the acquire() doc-comment in kernels/dispatch.ts.
  const hist = createStorage(ctx.device, NBINS * 4, "topk_hist");
  const outIdx = createStorage(ctx.device, CAP * 4, "topk_idx");
  const outVal = createStorage(ctx.device, CAP * 4, "topk_val");
  const counter = createStorage(ctx.device, 4, "topk_count");

  const mkUniform = (threshold: number) => uniform(ctx.device, [
    { u32: vocab }, { u32: NBINS }, { f32: LOGIT_RANGE_LO }, { f32: LOGIT_RANGE_HI },
    { f32: threshold }, { u32: CAP }, { u32: 0 }, { u32: 0 },
  ]);

  // Pass 1 — histogram. Grid-strided, so this workgroup count need not cover the vocabulary.
  const histPipe = ctx.pipelines.get("logit_topk", "hist_main");
  const p1 = mkUniform(0);
  dispatch1D(ctx.device, histPipe,
    bindGroup(ctx.device, histPipe, [logits, hist, outIdx, outVal, counter, p1]),
    Math.min(vocab, 65536), 256);

  const histBytes = await readback(ctx.device, hist, NBINS * 4);
  const choice = chooseThreshold(new Uint32Array(histBytes), LOGIT_RANGE_LO, LOGIT_RANGE_HI, k, CAP);
  if (choice.overflow) return null;

  // Pass 2 — gather everything at or above the threshold.
  const gatherPipe = ctx.pipelines.get("logit_topk", "gather_main");
  const p2 = mkUniform(choice.threshold);
  dispatch1D(ctx.device, gatherPipe,
    bindGroup(ctx.device, gatherPipe, [logits, hist, outIdx, outVal, counter, p2]),
    Math.min(vocab, 65536), 256);

  const countBytes = await readback(ctx.device, counter, 4);
  const count = new Uint32Array(countBytes)[0];
  // The kernel counts PAST capacity on purpose, so this distinguishes "collected everything"
  // from "there were more than we could hold".
  if (count === 0 || count > CAP) return null;

  const idsBytes = await readback(ctx.device, outIdx, count * 4);
  const valsBytes = await readback(ctx.device, outVal, count * 4);
  return { ids: new Uint32Array(idsBytes), vals: new Float32Array(valsBytes) };
}

/** Read an f32 tensor of `count` elements back to the host. */
export async function readbackF32(ctx: OpCtx, buf: GpuBufferLike, count: number): Promise<Float32Array> {
  const ab = await readback(ctx.device, buf, count * F32);
  return new Float32Array(ab);
}

/** Debug: read back a buffer slice and return finiteness/range stats (also logs). Used to
 *  localize GPU-only numeric blowups (a kernel producing NaN/Inf on-device the CPU doesn't). */
export async function dbgStats(ctx: OpCtx, buf: GpuBufferLike, count: number, label: string): Promise<string> {
  const a = await readbackF32(ctx, buf, Math.min(count, 8192));
  let bad = 0, mn = Infinity, mx = -Infinity, s = 0;
  for (let i = 0; i < a.length; i++) { const v = a[i]; if (!Number.isFinite(v)) bad++; else { if (v < mn) mn = v; if (v > mx) mx = v; s += Math.abs(v); } }
  const str = `${label}[bad=${bad} min=${mn.toExponential(1)} max=${mx.toExponential(1)} mean=${(s / a.length).toExponential(1)}]`;
   
  console.log(`[bonsai] ${str}`);
  return str;
}

export { Q8_BLOCK, Q8_BYTES_PER_BLOCK };
