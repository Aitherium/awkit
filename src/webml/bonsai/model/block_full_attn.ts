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
 * Full-attention decoder block (one of 16 in Bonsai-27B).
 * Inline orchestration over ops.ts primitives:
 *   - RMSNorm(input, attn_norm) -> h1
 *   - ProjectQ1(h1, attn_q) -> Q [nTokens, nHeads, headDim]
 *   - ProjectQ1(h1, attn_k) -> K [nTokens, nHeadsKv, headDim]
 *   - ProjectQ1(h1, attn_v) -> V [nTokens, nHeadsKv, headDim]
 *   - RoPE on Q, K (with position offsets posBase, posBase+1, ..., posBase+nTokens-1)
 *   - For each position t in 0..nTokens:
 *     - Append K[t], V[t] to F32 cache
 *     - For each query head h:
 *       - Extract Q[t, h, :] and run softmaxAttnHead (GQA-mapped KV head)
 *     - Accumulate head outputs into attention result
 *   - ProjectQ1(attn_result, attn_output) -> attn_out
 *   - Residual add: input += attn_out
 *   - RMSNorm(input, ffn_norm) -> h2
 *   - ProjectQ1(h2, ffn_gate) -> gate
 *   - ProjectQ1(h2, ffn_up) -> up
 *   - SwiGLU: silu(gate) * up -> gated_up
 *   - ProjectQ1(gated_up, ffn_down) -> ffn_out
 *   - Residual add: input += ffn_out
 */

import type { GpuBufferLike } from "../kernels/gpu-min";
import { beginCopies, finishCopies } from "../kernels/dispatch";
import {
  rmsnorm,
  projectQ1,
  ropeImrope,
  softmaxAttnBatched,
  swigluMul,
  residualAdd,
  mulSigmoidInplace,
  scratchBuffer,
} from "./ops";
import type { LayerContext, BlockIO } from "./layers";
import { blockTensorNames } from "./layers";
import type { Kv4Layer } from "./kvcache";

/**
 * Run a full-attention decoder block over io.hidden in place.
 * - Processes nTokens tokens with causality (position t attends to 0..t).
 * - Updates KV cache incrementally during the attention loop.
 * - Updates io.hidden in place (residual adds accumulate).
 */
export async function runFullAttnBlock(ctx: LayerContext, layer: number, io: BlockIO): Promise<void> {
  const { hidden, nTokens, posBase } = io;
  const { device, pipelines, weights, config, kv, kvMode } = ctx;

  // GATED (qwen35) or PLAIN (stock qwen3)? Measured at load from attn_q's declared output
  // width, never from the arch string — see LayerKind in config.ts. Everything below that
  // reads `gated` is a real shape difference, not a style choice.
  const kind = config.layerKinds[layer];
  const gated = kind !== "dense-attn";

  // Get layer tensor names. The pre-FFN norm is named per layer by config (qwen35:
  // post_attention_norm, qwen3: ffn_norm), resolved by presence at load.
  const names = blockTensorNames(kind, layer, config.ffnNormNames?.[layer]);
  const [
    attnNormName,
    attnQName,
    attnKName,
    attnVName,
    attnQNormName,
    attnKNormName,
    attnOutName,
    ffnNormName,
    ffnGateName,
    ffnUpName,
    ffnDownName,
  ] = names;

  // Dimensions
  const { headCount, headCountKv, embeddingLength, keyLength, ropeDimensionCount, ropeFreqBase, rmsEps } = config;
  const nHeads = headCount;
  const nHeadsKv = headCountKv;
  const headDim = keyLength ?? embeddingLength / headCount;
  const attnScale = 1.0 / Math.sqrt(headDim);
  // Partial RoPE: only the first ropeDimensionCount (64) of each 256-dim head is rotated.
  const rotDim = ropeDimensionCount ?? headDim;

  // Get weights (coalesced upload on first layer access)
  await weights.ensureLayer(layer);
  const attnNormW = weights.get(attnNormName);
  const attnQW = weights.get(attnQName);
  const attnKW = weights.get(attnKName);
  const attnVW = weights.get(attnVName);
  const attnQNormW = weights.get(attnQNormName);
  const attnKNormW = weights.get(attnKNormName);
  const attnOutW = weights.get(attnOutName);
  const ffnNormW = weights.get(ffnNormName);
  const ffnGateW = weights.get(ffnGateName);
  const ffnUpW = weights.get(ffnUpName);
  const ffnDownW = weights.get(ffnDownName);

  // -------------------------------------------------------------------------
  // ATTENTION
  // -------------------------------------------------------------------------

  // Step 1: RMSNorm (attn_norm)
  const h1 = scratchBuffer(ctx, nTokens * embeddingLength, "h1_attn");
  rmsnorm(ctx, hidden, attnNormW, h1, nTokens, embeddingLength, rmsEps);

  // Step 2: Project Q(+gate), K, V.
  // Qwen3.5's attn_q.weight is [n_embd, 2*nHeads*headDim]: per head the output is
  // INTERLEAVED [query(headDim) | gate(headDim)]. Projecting only nHeads*headDim
  // read the first 12 heads' query+gate pairs as "all 24 heads' queries" — the
  // root cause of the prompt-independent whitespace logits (root-caused 2026-07-22
  // against the fork's build_layer_attn: ggml_view_3d stride 2*headDim + sigmoid gate).
  const tempQ = scratchBuffer(ctx, nTokens * nHeads * headDim, "tempQ");
  const tempK = scratchBuffer(ctx, nTokens * nHeadsKv * headDim, "tempK");
  const tempV = scratchBuffer(ctx, nTokens * nHeadsKv * headDim, "tempV");
  // The output gate exists only on the gated shape. Allocating it unconditionally would
  // waste nTokens*nHeads*headDim floats per dense layer for a buffer nothing ever reads.
  const tempG = gated ? scratchBuffer(ctx, nTokens * nHeads * headDim, "tempG") : null;

  projectQ1(ctx, h1, attnKW, tempK, nTokens, embeddingLength, nHeadsKv * headDim);
  projectQ1(ctx, h1, attnVW, tempV, nTokens, embeddingLength, nHeadsKv * headDim);

  if (gated) {
    // Qwen3.5's attn_q.weight is [n_embd, 2*nHeads*headDim]: per head the output is
    // INTERLEAVED [query(headDim) | gate(headDim)], so project the full double width and
    // split it. Stock qwen3 has no gate and projects straight into tempQ below.
    const tempQG = scratchBuffer(ctx, nTokens * nHeads * headDim * 2, "tempQG");
    projectQ1(ctx, h1, attnQW, tempQG, nTokens, embeddingLength, nHeads * headDim * 2);

    // Deinterleave [q|g] per head via buffer copies. Recorded into the open layer batch so
    // these copies stay ordered after the projectQ1 that wrote tempQG (beginCopies).
    const tgt = beginCopies(device);
    const rowQG = nHeads * headDim * 2;
    const rowQ = nHeads * headDim;
    for (let t = 0; t < nTokens; t++) {
      for (let h = 0; h < nHeads; h++) {
        const src = (t * rowQG + h * headDim * 2) * 4;
        const dst = (t * rowQ + h * headDim) * 4;
        tgt.enc.copyBufferToBuffer(tempQG, src, tempQ, dst, headDim * 4);
        tgt.enc.copyBufferToBuffer(tempQG, src + headDim * 4, tempG!, dst, headDim * 4);
      }
    }
    finishCopies(device, tgt);
  } else {
    // Plain qwen3: attn_q is [n_embd, nHeads*headDim]. No gate, no split.
    projectQ1(ctx, h1, attnQW, tempQ, nTokens, embeddingLength, nHeads * headDim);
  }

  // Step 2b: Per-head QK-RMSNorm (Qwen3 q_norm / k_norm). A single [headDim] weight is
  // applied to every head independently — treating the buffer as (nTokens*nHeads) rows of
  // headDim is exactly per-head RMSNorm. Done AFTER projection, BEFORE RoPE.
  const tempQn = scratchBuffer(ctx, nTokens * nHeads * headDim, "tempQn");
  const tempKn = scratchBuffer(ctx, nTokens * nHeadsKv * headDim, "tempKn");
  rmsnorm(ctx, tempQ, attnQNormW, tempQn, nTokens * nHeads, headDim, rmsEps);
  rmsnorm(ctx, tempK, attnKNormW, tempKn, nTokens * nHeadsKv, headDim, rmsEps);

  // Step 3: Apply RoPE to the normed Q and K (partial: first rotDim dims of each head).
  ropeImrope(ctx, tempQn, nTokens, nHeads, headDim, rotDim, posBase, ropeFreqBase);
  ropeImrope(ctx, tempKn, nTokens, nHeadsKv, headDim, rotDim, posBase, ropeFreqBase);

  // Step 4: attention output [nTokens, nHeads, headDim]
  const attnOut = scratchBuffer(ctx, nTokens * nHeads * headDim, "attn_out");

  // Step 5: Append this batch's K/V to the cache in ONE copy, then run the whole
  // (token × head) attention grid in a SINGLE batched dispatch. (The old path submitted
  // ~nTokens·nHeads·3 GPU commands per layer — the dominant prefill cost.) Causality is
  // enforced inside the kernel: query (posBase+t) attends to cache positions [0, posBase+t].
  if (kvMode === "4bit") {
    // 4-bit cache: the 5th append arg is posBase (absolute position of this batch's first
    // token), NOT an f32 source offset — see KvCache.append. The attention kernel dequantizes
    // inline from the packed buffers + per-row f16 scales (mode==1).
    kv.append(layer, tempKn, tempV, nTokens, posBase);
    const l4 = kv.layer(layer) as Kv4Layer;
    softmaxAttnBatched(ctx, tempQn, l4.k, l4.v, attnOut, nTokens, nHeads, nHeadsKv, headDim, posBase, attnScale, l4.kScale, l4.vScale);
  } else {
    // F32 (default) path — byte-identical to the historical behaviour.
    kv.append(layer, tempKn, tempV, nTokens, 0, 0);
    const { k: kCache, v: vCache } = kv.layer(layer);
    softmaxAttnBatched(ctx, tempQn, kCache, vCache, attnOut, nTokens, nHeads, nHeadsKv, headDim, posBase, attnScale);
  }

  // Step 5b: Output gate — attnOut *= sigmoid(gate). The gate comes RAW from the
  // Q projection (no norm, no RoPE), exactly as the fork's build_layer_attn.
  // STOCK QWEN3 HAS NO SUCH GATE. Applying one anyway would scale every attention output by
  // sigmoid of whatever happened to be in the buffer — a silent ~0.5x-and-worse distortion,
  // not a crash.
  if (gated) mulSigmoidInplace(ctx, attnOut, tempG!, nTokens * nHeads * headDim);

  // Step 6: Project attention output via attn_output.weight
  const attnOutProj = scratchBuffer(ctx, nTokens * embeddingLength, "attn_out_proj");
  projectQ1(ctx, attnOut, attnOutW, attnOutProj, nTokens, nHeads * headDim, embeddingLength);

  // Step 7: Residual add to hidden state
  residualAdd(ctx, hidden, attnOutProj, nTokens * embeddingLength);

  // -------------------------------------------------------------------------
  // FEED-FORWARD NETWORK (FFN)
  // -------------------------------------------------------------------------

  // Step 1: RMSNorm (ffn_norm)
  const h2 = scratchBuffer(ctx, nTokens * embeddingLength, "h2_ffn");
  rmsnorm(ctx, hidden, ffnNormW, h2, nTokens, embeddingLength, rmsEps);

  // Step 2: Project gate and up
  const ffnGate = scratchBuffer(ctx, nTokens * config.feedForwardLength, "ffn_gate");
  const ffnUp = scratchBuffer(ctx, nTokens * config.feedForwardLength, "ffn_up");
  projectQ1(ctx, h2, ffnGateW, ffnGate, nTokens, embeddingLength, config.feedForwardLength);
  projectQ1(ctx, h2, ffnUpW, ffnUp, nTokens, embeddingLength, config.feedForwardLength);

  // Step 3: SwiGLU: silu(gate) * up
  const ffnGatedUp = scratchBuffer(ctx, nTokens * config.feedForwardLength, "ffn_gated_up");
  swigluMul(ctx, ffnGate, ffnUp, ffnGatedUp, nTokens * config.feedForwardLength);

  // Step 4: Project down
  const ffnOut = scratchBuffer(ctx, nTokens * embeddingLength, "ffn_out");
  projectQ1(ctx, ffnGatedUp, ffnDownW, ffnOut, nTokens, config.feedForwardLength, embeddingLength);

  // Step 5: Residual add to hidden state
  residualAdd(ctx, hidden, ffnOut, nTokens * embeddingLength);
}
