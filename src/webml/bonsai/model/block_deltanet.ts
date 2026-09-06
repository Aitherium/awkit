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
 * Gated DeltaNet (linear-attention) decoder block — the real Qwen3-Next ("qwen35") path,
 * mapped to the actual Bonsai-27B GGUF tensors (attn_qkv / attn_gate / ssm_alpha / ssm_beta
 * / ssm_a / ssm_dt.bias / ssm_conv1d / ssm_norm / ssm_out). Per layer:
 *
 *   h  = RMSNorm(x, attn_norm)
 *   qkv = attn_qkv · h                     [q(qDim) | k(kDim) | v(vDim)]  (= convDim)
 *   z   = attn_gate · h                    [vDim]  output gate
 *   qkv = SiLU(causal_conv1d(qkv))         depthwise, kernel=convKernel
 *   q,k = L2norm(q), L2norm(k)  per head   (parameter-free); v stays
 *   beta = sigmoid(ssm_beta · h)                                  per v-head
 *   g    = exp(-exp(ssm_a) · softplus(ssm_alpha · h + ssm_dt.bias)) per v-head
 *   o    = GatedDeltaRule(q,k,v,g,beta, state)      per v-head recurrence, o = Sᵀq/√dₖ
 *   o    = RMSNorm(o, ssm_norm) · SiLU(z)   gated RMSNorm
 *   x   += ssm_out · o
 *   x   += SwiGLU FFN(RMSNorm(x, post_attention_norm))
 *
 * The recurrence runs entirely on the GPU (deltanet_seq) — no per-head/per-token host
 * readback. State S (per v-head [headDim×headDim]) persists in ssm_state across decode.
 */

import * as ops from "./ops";
import { beginCopies, finishCopies } from "../kernels/dispatch";
import { blockTensorNames } from "./layers";
import type { LayerContext, BlockIO } from "./layers";

// Per-layer causal-conv history: the last (convKernel-1) RAW qkv rows, persisted
// ACROSS decode steps. Keyed on the per-generation SsmState instance so a new
// generation starts with zeroed history (worker-core constructs a fresh SsmState
// per generate). Without this, decode convolved each new token against ZERO
// history and every DeltaNet layer corrupted its state within 2-3 steps.
/* Causal-conv history, one buffer per layer, keyed by the SsmState instance.
   IT LIVES OUTSIDE SsmState, so SsmState.reset() could not clear it — and did not:
   reset() zeroed its OWN convStates map, which nothing in this file reads. Result:
   every generation after the first began with the previous conversation's last
   (conv_kernel-1)=3 rows of q/k/v still in place, in all 48 DeltaNet layers, which
   corrupts the opening tokens of each layer and then propagates through the
   recurrence into the state. Fluent, wrong output — degrading turn over turn.
   We now stamp each entry with SsmState.generation and re-zero when it moves. */
const CONV_HISTORY = new WeakMap<object, {
  gen: number;
  bufs: Map<number, import("../kernels/gpu-min").GpuBufferLike>;
  /** Layers already re-zeroed for `gen`. Per-LAYER, because this block runs once per layer
   *  and a single entry-wide flag is consumed by whichever layer happens to run first. */
  zeroed: Set<number>;
}>();

export async function runDeltaNetBlock(ctx: LayerContext, layer: number, io: BlockIO): Promise<void> {
  const cfg = ctx.config;
  const device = ctx.device;
  const w = ctx.weights;
  // deltaNet is undefined on a DENSE model (no ssm.* keys). runBlock never routes a dense
  // layer here, so reaching this line with it unset means the layer-kind derivation and the
  // config disagree — which is exactly the kind of mismatch that would otherwise read
  // garbage geometry (heads=0, dims=NaN) and produce silence rather than an error.
  const dn = cfg.deltaNet;
  if (!dn) {
    throw new Error(
      `bonsai-deltanet: layer ${layer} routed to the DeltaNet path but this model has no ` +
        `ssm.* geometry (dense model). This is a layer-classification bug, not a bad file.`,
    );
  }

  const nTokens = io.nTokens;
  const embedLen = cfg.embeddingLength;
  const ffnLen = cfg.feedForwardLength;
  const eps = cfg.rmsEps;
  const { numVHeads, numKHeads, headDim, qDim, kDim, vDim, convDim, convKernel, vPerKHead } = dn;

  // -------------------------------------------------------------------------
  // Resolve + validate weights (real GGUF names via blockTensorNames)
  // -------------------------------------------------------------------------
  const names = blockTensorNames("linear-attn", layer);
  if (names.length !== 14) {
    throw new Error(
      `block_deltanet layer ${layer}: expected 14 tensor names, got ${names.length}`,
    );
  }
  const [
    attnNormN,
    attnQkvN,
    attnGateN,
    ssmConvN,
    ssmBetaN,
    ssmAlphaN,
    ssmAN,
    ssmDtBiasN,
    ssmNormN,
    ssmOutN,
    postAttnNormN,
    ffnGateN,
    ffnUpN,
    ffnDownN,
  ] = names;

  for (const name of names) {
    if (!w.has(name)) {
      throw new Error(
        `block_deltanet layer ${layer}: missing tensor '${name}'. This layer is DeltaNet ` +
          `(linear-attn); ensure it was streamed via weights.ensureLayer(${layer}).`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Buffers
  // -------------------------------------------------------------------------
  const h1 = ops.scratchBuffer(ctx, nTokens * embedLen, `dn.${layer}.h1`);
  const qkv = ops.scratchBuffer(ctx, nTokens * convDim, `dn.${layer}.qkv`);
  const z = ops.scratchBuffer(ctx, nTokens * vDim, `dn.${layer}.z`);
  const qc = ops.scratchBuffer(ctx, nTokens * qDim, `dn.${layer}.qc`);
  const kc = ops.scratchBuffer(ctx, nTokens * kDim, `dn.${layer}.kc`);
  const vc = ops.scratchBuffer(ctx, nTokens * vDim, `dn.${layer}.vc`);
  const qn = ops.scratchBuffer(ctx, nTokens * qDim, `dn.${layer}.qn`);
  const kn = ops.scratchBuffer(ctx, nTokens * kDim, `dn.${layer}.kn`);
  const alphaRaw = ops.scratchBuffer(ctx, nTokens * numVHeads, `dn.${layer}.alpha`);
  const betaRaw = ops.scratchBuffer(ctx, nTokens * numVHeads, `dn.${layer}.beta`);
  const gBuf = ops.scratchBuffer(ctx, nTokens * numVHeads, `dn.${layer}.g`);
  const betaBuf = ops.scratchBuffer(ctx, nTokens * numVHeads, `dn.${layer}.betaG`);
  const recur = ops.scratchBuffer(ctx, nTokens * vDim, `dn.${layer}.recur`);
  const normOut = ops.scratchBuffer(ctx, nTokens * vDim, `dn.${layer}.normOut`);
  const ssmProj = ops.scratchBuffer(ctx, nTokens * embedLen, `dn.${layer}.ssmProj`);
  const h2 = ops.scratchBuffer(ctx, nTokens * embedLen, `dn.${layer}.h2`);
  const ffnG = ops.scratchBuffer(ctx, nTokens * ffnLen, `dn.${layer}.ffnG`);
  const ffnU = ops.scratchBuffer(ctx, nTokens * ffnLen, `dn.${layer}.ffnU`);
  const ffnM = ops.scratchBuffer(ctx, nTokens * ffnLen, `dn.${layer}.ffnM`);
  const ffnD = ops.scratchBuffer(ctx, nTokens * embedLen, `dn.${layer}.ffnD`);

  // Zero conv bias (this model exports ssm_conv1d weight only, no bias tensor).
  // queueInit: fully overwritten by the writeBuffer below — an in-batch clear would
  // execute AFTER that queue write and zero it (see acquire() in dispatch.ts, D-1517).
  const convBias = ops.scratchBuffer(ctx, convDim, `dn.${layer}.convBias`, { queueInit: true });
  device.queue.writeBuffer(convBias, 0, new Float32Array(convDim));

  // Parameter-free per-head L2 norm via RMSNorm: with weight = 1/sqrt(headDim) and
  // eps = 1e-6/headDim, RMSNorm(x)=x·(1/sqrt(mean+eps'))·w = x/sqrt(sum(x²)+1e-6). Exact.
  const l2w = ops.scratchBuffer(ctx, headDim, `dn.${layer}.l2w`, { queueInit: true });
  device.queue.writeBuffer(l2w, 0, new Float32Array(headDim).fill(1 / Math.sqrt(headDim)));
  const l2eps = 1e-6 / headDim;

  // -------------------------------------------------------------------------
  // DeltaNet path
  // -------------------------------------------------------------------------
  ops.rmsnorm(ctx, io.hidden, w.get(attnNormN), h1, nTokens, embedLen, eps);

  // in-projections
  ops.projectQ1(ctx, h1, w.get(attnQkvN), qkv, nTokens, embedLen, convDim);
  ops.projectQ1(ctx, h1, w.get(attnGateN), z, nTokens, embedLen, vDim);

  // depthwise causal conv over all convDim channels, then SiLU.
  // The conv input is [history(convKernel-1 rows) | this batch's raw qkv rows] so a
  // decode step sees the previous positions' projections (the fork keeps the same
  // sliding conv state in its recurrent cache). History holds PRE-conv qkv values.
  const histRows = convKernel - 1;
  const ssmGen = (ctx.ssm as unknown as { generation?: number }).generation ?? 0;
  let entry = CONV_HISTORY.get(ctx.ssm);
  if (!entry) {
    entry = { gen: ssmGen, bufs: new Map(), zeroed: new Set() };
    CONV_HISTORY.set(ctx.ssm, entry);
  }
  // The generation stamp has to be tracked PER LAYER, not once per entry.
  //
  // This function runs once per LAYER. The previous code did:
  //     const stale = entry.gen !== ssmGen;
  //     if (stale) entry.gen = ssmGen;          // <- the FIRST layer clears the flag
  //     ... else if (stale) { zero }            // <- every LATER layer sees false
  // so layer 0 zeroed its history and layers 1..63 silently kept the PREVIOUS
  // generation's last conv_kernel-1 rows. Exactly the defect the comment above this
  // WeakMap says it fixed — fixed for one layer out of 64.
  //
  // Consequence: from the second generation onward, 63 of 64 DeltaNet layers begin a
  // prefill seeded with residue from the previous one, so run N+1 depends on run N. That
  // is reproducible (not a race), which matches the measured signature: two identical warm
  // prefills disagree, byte-identically, with or without the buffer pool.
  if (entry.gen !== ssmGen) {
    entry.gen = ssmGen;
    entry.zeroed.clear();
  }
  let hist = entry.bufs.get(layer);
  if (!hist) {
    hist = ops.f32Buffer(device, histRows * convDim, `dn.${layer}.convHist`);
    entry.bufs.set(layer, hist);
    device.queue.writeBuffer(hist, 0, new Float32Array(histRows * convDim));
    entry.zeroed.add(layer);
  } else if (!entry.zeroed.has(layer)) {
    // New generation, first time THIS layer is reached: the carried rows belong to the
    // previous conversation.
    device.queue.writeBuffer(hist, 0, new Float32Array(histRows * convDim));
    entry.zeroed.add(layer);
  }
  const convIn = ops.scratchBuffer(ctx, (nTokens + histRows) * convDim, `dn.${layer}.convIn`);
  const convOutFull = ops.scratchBuffer(ctx, (nTokens + histRows) * convDim, `dn.${layer}.convOutF`);
  {
    // Recorded into the open layer batch so these copies stay ordered after the projectQ1
    // that wrote qkv and before the conv dispatch that reads convIn (beginCopies).
    const tgt = beginCopies(device);
    tgt.enc.copyBufferToBuffer(hist, 0, convIn, 0, histRows * convDim * 4);
    tgt.enc.copyBufferToBuffer(qkv, 0, convIn, histRows * convDim * 4, nTokens * convDim * 4);
    // next history = the LAST histRows rows of convIn (raw, pre-conv values)
    tgt.enc.copyBufferToBuffer(convIn, nTokens * convDim * 4, hist, 0, histRows * convDim * 4);
    finishCopies(device, tgt);
  }
  ops.causalConv1d(ctx, convIn, w.get(ssmConvN), convBias, convOutFull, nTokens + histRows, convDim, convKernel);
  ops.siluInplace(ctx, convOutFull, (nTokens + histRows) * convDim);

  // split [q|k|v] per token into compact per-stream buffers (so per-head L2 rows are
  // contiguous and the recurrence reads compact q/k/v). Skip the history rows.
  {
    // After the conv+SiLU dispatches (recorded in the batch); these splits must follow them.
    const tgt = beginCopies(device);
    for (let t = 0; t < nTokens; t++) {
      const src = (t + histRows) * convDim * 4;
      tgt.enc.copyBufferToBuffer(convOutFull, src, qc, t * qDim * 4, qDim * 4);
      tgt.enc.copyBufferToBuffer(convOutFull, src + qDim * 4, kc, t * kDim * 4, kDim * 4);
      tgt.enc.copyBufferToBuffer(convOutFull, src + (qDim + kDim) * 4, vc, t * vDim * 4, vDim * 4);
    }
    finishCopies(device, tgt);
  }

  // per-head L2 norm of q, k (rows of headDim); v stays as-is
  ops.rmsnorm(ctx, qc, l2w, qn, nTokens * numKHeads, headDim, l2eps);
  ops.rmsnorm(ctx, kc, l2w, kn, nTokens * numKHeads, headDim, l2eps);

  // beta / decay
  ops.projectQ1(ctx, h1, w.get(ssmAlphaN), alphaRaw, nTokens, embedLen, numVHeads);
  ops.projectQ1(ctx, h1, w.get(ssmBetaN), betaRaw, nTokens, embedLen, numVHeads);
  ops.deltanetGate(ctx, alphaRaw, betaRaw, w.get(ssmAN), w.get(ssmDtBiasN), gBuf, betaBuf, nTokens, numVHeads);

  // gated delta-rule recurrence (all tokens, all v-heads, GPU-resident state)
  const state = ctx.ssm.state(layer);
  ops.deltanetSeq(ctx, qn, kn, vc, gBuf, betaBuf, state, recur, nTokens, numVHeads, numKHeads, headDim, vPerKHead);

  // output gating: RMSNorm(o over headDim, ssm_norm) · SiLU(z), then out-proj
  ops.rmsnorm(ctx, recur, w.get(ssmNormN), normOut, nTokens * numVHeads, headDim, eps);
  ops.siluInplace(ctx, z, nTokens * vDim);
  ops.elementwise(ctx, normOut, z, normOut, nTokens * vDim, 1); // normOut *= silu(z)
  ops.projectQ1(ctx, normOut, w.get(ssmOutN), ssmProj, nTokens, vDim, embedLen);

  ops.residualAdd(ctx, io.hidden, ssmProj, nTokens * embedLen);

  // -------------------------------------------------------------------------
  // FFN (post_attention_norm → SwiGLU)
  // -------------------------------------------------------------------------
  ops.rmsnorm(ctx, io.hidden, w.get(postAttnNormN), h2, nTokens, embedLen, eps);
  ops.projectQ1(ctx, h2, w.get(ffnGateN), ffnG, nTokens, embedLen, ffnLen);
  ops.projectQ1(ctx, h2, w.get(ffnUpN), ffnU, nTokens, embedLen, ffnLen);
  ops.swigluMul(ctx, ffnG, ffnU, ffnM, nTokens * ffnLen);
  ops.projectQ1(ctx, ffnM, w.get(ffnDownN), ffnD, nTokens, ffnLen, embedLen);
  ops.residualAdd(ctx, io.hidden, ffnD, nTokens * embedLen);
}
