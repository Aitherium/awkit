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
 *   - decoder block: RMSNorm -> (DeltaNet | full-attn) -> residual -> RMSNorm -> SwiGLU -> residual
 *
 * One decoder block. The attention path is selected by the layer's DERIVED kind
 * (config.layerKinds), never hardcoded. All projection matmuls dispatch the Q1_0 kernel;
 * activations are quantized to Q8_0 before each.
 *
 * STATUS: this is the orchestration seam. The per-kernel dispatch bodies are wired to the
 * dispatch helpers + PipelineCache; end-to-end numerical correctness of the assembled
 * block is gated by Milestone 6 (requires a browser GPU — see runtime.ts / test page).
 */

import type { GpuBufferLike, GpuDeviceLike } from "../kernels/gpu-min";
import type { PipelineCache } from "../kernels/pipelines";
import type { Qwen35Config, LayerKind } from "./config";
import type { WeightStore } from "./weights";
import type { KvMode } from "./kvcache";
import type { SsmState } from "./ssm_state";

/** The KV slice a block reads back after an append — shared by the F32 and 4-bit caches. */
export interface KvLayerCommon {
  k: GpuBufferLike;
  v: GpuBufferLike;
  length: number;
}

/**
 * The KV surface the forward pass / blocks touch. Implemented by BOTH F32KvCache (default)
 * and the 4-bit KvCache (gated), so `LayerContext.kv` can be either without the
 * orchestration knowing or caring which mode is active. The append signatures differ only in
 * the 5th/6th params' MEANING (F32: kSrcOffset/vSrcOffset bytes; 4-bit: posBase) — both are
 * structural matches for the optional-number form below.
 */
export interface KvLike {
  readonly capacity: number;
  append(
    layer: number,
    kF32: GpuBufferLike,
    vF32: GpuBufferLike,
    nTok: number,
    kSrcOffset?: number,
    vSrcOffset?: number,
  ): void;
  layer(index: number): KvLayerCommon;
  advance(nTok: number): void;
  filledLength(): number;
  currentLength(layer: number): number;
  truncate(n: number): void;
  reset(): void;
}

export interface LayerContext {
  device: GpuDeviceLike;
  pipelines: PipelineCache;
  weights: WeightStore;
  config: Qwen35Config;
  kv: KvLike;
  /** Which KV cache mode is live: 'f32' (default) or '4bit'. The attention body branches
   *  on this to pick how it appends K/V and whether it passes scale buffers to the
   *  attention kernel. Set wherever you build a LayerContext. */
  kvMode: KvMode;
  ssm: SsmState;
  /**
   * Quant type of this model's decoder-block weights — `weights.weightQuantType()`, which
   * reads the GGUF header and refuses a mixed-quant file. Satisfies {@link OpCtx.quantType},
   * so every `ops.project*` call in a block picks the matching kernel.
   *
   * UNSET MEANS Q1_0, and that default is only safe because it is what every caller meant
   * before Q2_0 existed. A context built for a Q2_0 model that forgets to set this reads
   * 34-byte blocks at the 18-byte Q1_0 stride: no crash, no noise, just fluent garbage.
   * Set it wherever you build a LayerContext.
   */
  quantType?: number;
}

export interface BlockIO {
  /** Hidden state buffer [n_tokens * embedding_length], updated in place (residual). */
  hidden: GpuBufferLike;
  nTokens: number;
  /** Absolute position of the first token (for RoPE + cache append). */
  posBase: number;
}

/**
 * Names of the tensors a block carries, resolved once from the registry per layer.
 * These are the REAL Qwen3-Next ("qwen35") GGUF names, verified against the Bonsai-27B
 * header. Full-attn layers carry q/k RMSNorm weights and NO output gate; DeltaNet layers
 * carry a fused attn_qkv in-projection + a separate attn_gate output gate + the ssm_*
 * gating params. Both end with post_attention_norm (NOT "ffn_norm") + the SwiGLU FFN.
 */
export function blockTensorNames(kind: LayerKind, layer: number, ffnNormName?: string): string[] {
  const p = `blk.${layer}.`;
  if (kind === "full-attn" || kind === "dense-attn") {
    return [
      `${p}attn_norm.weight`, // 0 input RMSNorm
      `${p}attn_q.weight`, // 1 q proj -> nHeads*headDim (2x when gated; see LayerKind)
      `${p}attn_k.weight`, // 2 k proj -> nKvHeads*headDim
      `${p}attn_v.weight`, // 3 v proj -> nKvHeads*headDim
      `${p}attn_q_norm.weight`, // 4 per-head RMSNorm over headDim, applied to q
      `${p}attn_k_norm.weight`, // 5 per-head RMSNorm over headDim, applied to k
      `${p}attn_output.weight`, // 6 output proj -> embedding
      // 7 pre-FFN RMSNorm. qwen35 calls it post_attention_norm, stock qwen3 calls it
      // ffn_norm; the caller passes the name config resolved BY PRESENCE. The default keeps
      // the qwen35 name so existing callers (harnesses, tests) are unchanged.
      ffnNormName ?? `${p}post_attention_norm.weight`,
      `${p}ffn_gate.weight`, // 8
      `${p}ffn_up.weight`, // 9
      `${p}ffn_down.weight`, // 10
    ];
  }
  return [
    `${p}attn_norm.weight`, // 0 input RMSNorm
    `${p}attn_qkv.weight`, // 1 fused in-proj -> q|k|v (qDim+kDim+vDim)
    `${p}attn_gate.weight`, // 2 output gate z -> vDim
    `${p}ssm_conv1d.weight`, // 3 depthwise causal conv over the qkv channels (F32)
    `${p}ssm_beta.weight`, // 4 beta proj -> numVHeads (write strength)
    `${p}ssm_alpha.weight`, // 5 alpha proj -> numVHeads (decay input)
    `${p}ssm_a`, // 6 A_log per v-head (F32 [numVHeads])
    `${p}ssm_dt.bias`, // 7 dt bias per v-head (F32 [numVHeads])
    `${p}ssm_norm.weight`, // 8 gated RMSNorm over v headDim (F32 [headDim])
    `${p}ssm_out.weight`, // 9 output proj vDim -> embedding
    `${p}post_attention_norm.weight`, // 10 pre-FFN RMSNorm
    `${p}ffn_gate.weight`, // 11
    `${p}ffn_up.weight`, // 12
    `${p}ffn_down.weight`, // 13
  ];
}

/**
 * Run one decoder block over `io.hidden` in place. Dispatches:
 *   RMSNorm(attn_norm) -> attention(kind) -> residual add
 *   RMSNorm(ffn_norm)  -> SwiGLU MLP (Q1_0 matmuls) -> residual add
 * The concrete pass wiring lives here; correctness is Milestone 6.
 */
export async function runBlock(ctx: LayerContext, layer: number, io: BlockIO): Promise<void> {
  const kind = ctx.config.layerKinds[layer];
  await ctx.weights.ensureLayer(layer);

  if (kind === "full-attn" || kind === "dense-attn") {
    // ONE attention body, two shapes. runFullAttnBlock branches on `kind` for the three
    // things that actually differ (Q projection width, the [q|gate] deinterleave, and the
    // sigmoid output gate) and shares everything else. Splitting it into two files would
    // mean fixing every future numerics bug twice — and the numerics here have been wrong
    // in six different ways already.
    const { runFullAttnBlock } = await import("./block_full_attn");
    await runFullAttnBlock(ctx, layer, io);
  } else if (kind === "linear-attn") {
    const { runDeltaNetBlock } = await import("./block_deltanet");
    await runDeltaNetBlock(ctx, layer, io);
  } else {
    throw new Error(`runBlock: unknown layer kind '${kind}' at layer ${layer}`);
  }
}
