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
 *
 * Full forward pass: embed -> N decoder blocks -> final RMSNorm -> LM head -> logits.
 * Prefill runs all tokens (chunked DeltaNet scan + flash attn); decode runs one token
 * (single-step recurrence + incremental attention). STATUS: orchestration seam; numeric
 * correctness is Milestones 6-7 (browser GPU required).
 */

import type { GpuBufferLike } from "../kernels/gpu-min";
import type { OpCtx } from "./ops";
import type { BonsaiTokenizer } from "../tokenizer/load";
import { runBlock, type LayerContext, type BlockIO } from "./layers";
import { embedTokens, projectLogits } from "./embed_lmhead";
import { readbackF32 } from "./ops";
import { beginBatch, flushBatch, flushDeferred } from "../kernels/dispatch";

/**
 * How many decoder blocks to stream AHEAD of the one being computed, during the cold prefill.
 *
 * Bounded on purpose, and the bound is the whole design: the layer-at-a-time upload exists so
 * a device with little VRAM never holds the entire model at once, and an unbounded read-ahead
 * would quietly undo that — on the 27B it would pull 3.6 GB into GPU memory on a machine the
 * lazy path was protecting. Three keeps a few range requests in flight (which is what a
 * high-latency link actually needs) while adding at most ~3 blocks of resident weights over
 * the serial path — ~90 MB on the 8B, ~170 MB on the 27B.
 */
const READ_AHEAD_LAYERS = 3;

export interface ForwardResult {
  /** logits buffer for the final token position [vocab]. */
  logits: GpuBufferLike;
}

// One-shot forward-pass diagnostic: reads back a hidden slice and logs finiteness/range so
// the console pinpoints exactly which layer first produces NaN/Inf or a collapsed (all-zero)
// state. Enabled while the in-browser numerics are being verified.
// Runtime-switchable so a harness can turn it on WITHOUT editing and rebuilding this file
// (D-812/D-866): the whole point of the layer probe is to localize where activations first
// go wrong on the REAL weights, and a compile-time constant meant nobody could enable it
// on a deployed bundle or from a test page. Set `globalThis.__BONSAI_DEBUG = true` before
// the first generation. Default stays OFF — the probe costs a full hidden-state readback
// per layer, which would dominate a normal token.
export function bonsaiDebugEnabled(): boolean {
  return (globalThis as { __BONSAI_DEBUG?: boolean }).__BONSAI_DEBUG === true;
}

/** @deprecated compile-time flag — use {@link bonsaiDebugEnabled}. Kept so existing
 *  `import { BONSAI_DEBUG }` call sites keep compiling. */
export const BONSAI_DEBUG = false;

/** D-937 elementwise capture.
 *
 *  The per-block `meanabs` probe below localises divergence only as far as a SUMMARY can:
 *  two different vectors can share a mean absolute value, so a meanabs comparison shows
 *  where the summaries separate, NOT where the vectors first differ. Measured 2026-07-26,
 *  prefill(N) vs prefill(N-1)+decode(1) at the same position: meanabs ratio was 1.000 at
 *  block 0 and 0.944 at block 1 — which looked like "block 0 is identical" and is not
 *  evidence of that at all.
 *
 *  Setting `__BONSAI_CAPTURE_TAG` to "A"/"B" records the ACTUAL hidden row after every
 *  block so the two paths can be diffed ELEMENTWISE. Off unless the tag is set; costs a
 *  full readback per block, same as the debug probe. */
type CaptureGlobals = {
  __BONSAI_CAPTURE_TAG?: string;
  __BONSAI_ROWS?: Record<string, Float32Array>;
  /** Absolute token position to capture. Defaults to the LAST row. Needed to compare
   *  prefill(N) against prefill(N-1) at the last SHARED position: that row is the last one
   *  for prefill(N-1) but the second-to-last for prefill(N). */
  __BONSAI_CAPTURE_POS?: number;
};
export function captureRow(layer: number, row: Float32Array): void {
  const g = globalThis as CaptureGlobals;
  const tag = g.__BONSAI_CAPTURE_TAG;
  if (!tag) return;
  (g.__BONSAI_ROWS ??= {})[`${tag}:${layer}`] = row.slice();
}
function captureActive(): boolean {
  return typeof (globalThis as CaptureGlobals).__BONSAI_CAPTURE_TAG === "string";
}

/** D-937 INJECTION test — separates "this block is broken" from "this block amplifies a
 *  broken input".
 *
 *  Measured elementwise, prefill(N) vs prefill(N-1)+decode(1) at the same position:
 *  blocks 0 and 1 are BIT-IDENTICAL (0/5120 components differ), block 2 injects 0.79%
 *  relative, and block 3 — the first full-attention block — turns that into 96%. A 122x
 *  gain in one block is either genuine softmax sensitivity or a second defect, and the
 *  difference matters: only one of those makes block 3 the thing to fix.
 *
 *  Setting `__BONSAI_INJECT = { layer, row }` overwrites the decode hidden state with the
 *  PREFILL path's row after that block, so every later block receives a provably identical
 *  input. If the divergence then vanishes, the later blocks are innocent and the fault is
 *  at or before `layer`; if it persists, the later block owns its own bug. */
type InjectGlobals = { __BONSAI_INJECT?: { layer: number; row: Float32Array } };

/**
 * Embed prompt tokens and run all blocks; fills KV + SSM state.
 * Takes token IDs, embeds them into the hidden buffer, runs all blocks, then projects the last token to logits.
 */
export async function prefill(
  ctx: LayerContext,
  hidden: GpuBufferLike,
  tokenIds: number[],
  tokenizer: BonsaiTokenizer,
  onLayer?: (layer: number, total: number) => void,
  /**
   * Absolute position of `tokenIds[0]`. 0 for a fresh prompt; the reused prefix
   * length when continuing an existing KV/state (cross-turn prefix reuse).
   * Defaults to 0 so every existing caller is unchanged.
   */
  posBase = 0,
): Promise<ForwardResult> {
  // Embed tokens into the hidden buffer
  await embedTokens(ctx as OpCtx, tokenIds, hidden, ctx.weights, ctx.config.embeddingLength);

  const embedLen = ctx.config.embeddingLength;
  const lastOff = (tokenIds.length - 1) * embedLen; // last token's row, for the probe
  const probeLast = async (label: string, layer?: number) => {
    if (!bonsaiDebugEnabled() && !captureActive()) return;
    // read just the last token's row by copying it out via a slice view
    const slice = await readbackF32(ctx as OpCtx, hidden, tokenIds.length * embedLen);
    const row = slice.subarray(lastOff, lastOff + embedLen);
    if (layer !== undefined) {
      // Capture an explicit position when asked, so prefill(N) and prefill(N-1) can be
      // compared at the last SHARED token rather than at each one's own final token.
      const wantPos = (globalThis as CaptureGlobals).__BONSAI_CAPTURE_POS;
      const off = typeof wantPos === "number" && wantPos >= 0 && wantPos < tokenIds.length
        ? wantPos * embedLen
        : lastOff;
      captureRow(layer, slice.subarray(off, off + embedLen));
    }
    if (!bonsaiDebugEnabled()) return;
    let nan = 0, mn = Infinity, mx = -Infinity, sabs = 0;
    for (let i = 0; i < row.length; i++) { const v = row[i]; if (!Number.isFinite(v)) nan++; else { if (v<mn)mn=v; if(v>mx)mx=v; sabs+=Math.abs(v);} }
     
    console.log(`[bonsai] ${label}: bad=${nan} min=${mn.toFixed(3)} max=${mx.toFixed(3)} meanabs=${(sabs/row.length).toFixed(4)}`);
  };
  const probeRows = async (label: string, positions: number[]) => {
    if (!bonsaiDebugEnabled()) return;
    const slice = await readbackF32(ctx as OpCtx, hidden, tokenIds.length * embedLen);
    for (const p of positions) {
      const row = slice.subarray(p * embedLen, (p + 1) * embedLen);
      let sabs = 0, mn = Infinity, mx = -Infinity;
      for (let i = 0; i < row.length; i++) { const v = row[i]; if (v < mn) mn = v; if (v > mx) mx = v; sabs += Math.abs(v); }
       
      console.log(`[bonsai] ${label} pos${p} (id ${tokenIds[p]}): min=${mn.toFixed(4)} max=${mx.toFixed(4)} meanabs=${(sabs / row.length).toFixed(5)}`);
    }
  };
  await probeRows("embed-row", [0, 1, 2, tokenIds.length - 1]);
  await probeLast("after embed");

  // Run all blocks.
  //
  // posBase is the absolute position of tokenIds[0] in the conversation, NOT 0,
  // whenever this is a partial prefill continuing a reused KV prefix. It reaches
  // RoPE (which rotates by absolute position) and the attention causality bound
  // ("query posBase+t attends to cache [0, posBase+t]"), so passing 0 for a
  // continuation would rotate the new tokens as if they were the start of the
  // conversation AND let them attend to nothing — fluent, wrong output with no
  // error. The whole prefix-reuse feature is this one value being right.
  const io: BlockIO = { hidden, nTokens: tokenIds.length, posBase };
  for (let l = 0; l < ctx.config.blockCount; l++) {
    // READ AHEAD BEFORE BLOCKING. Layer l+1..l+READ_AHEAD_LAYERS depend on nothing layer l
    // produces, so their fetches belong in flight while l downloads and computes. Without
    // this the loop was a strict alternation — fetch, compute, fetch, compute — that idled
    // the link through every block's compute and idled the GPU through every block's
    // download, and on a high-RTT link it also serialised one round trip per layer with
    // nothing else in flight. This is the "warming layer 7/36" the visitor watches on their
    // first message (D-1689). Issued BEFORE the await so the very first iteration overlaps.
    for (let ahead = 1; ahead <= READ_AHEAD_LAYERS; ahead++) {
      if (l + ahead < ctx.config.blockCount) ctx.weights.prefetchLayer(l + ahead);
    }
    // Stream this layer's weights (blk.l.*) before running it. On the FIRST generation
    // this fetches ~50 MB/layer over HTTP (the 3.8 GB model streams lazily), so report
    // per-layer progress — this loop is where the first-token latency actually goes.
    await ctx.weights.ensureLayer(l);
    onLayer?.(l, ctx.config.blockCount);
    // Batch this layer's ~dozens of compute passes into ONE queue.submit() instead of
    // one submit per op. Numerically identical (each op owns its buffers; WebGPU barriers
    // between passes preserve the DeltaNet/KV ordering); it just removes the per-op submit
    // overhead that dominates once the kernels are correct.
    beginBatch((ctx as OpCtx).device);
    try {
      await runBlock(ctx, l, io);
    } finally {
      // Submit the layer's batch, THEN destroy its scratch buffers (safe post-submit).
      // In finally so a runBlock throw can't leave the batch open (poisoning the next
      // token) or leak this layer's scratch.
      flushBatch((ctx as OpCtx).device);
      flushDeferred((ctx as OpCtx).device);
    }
    const kind = ctx.config.layerKinds[l];
    // Probe EVERY layer when debugging, not a hand-picked few: the question is which
    // layer FIRST produces bad activations, and a sample of {0,1,2,63} cannot answer that.
    await probeLast(`after L${l} (${kind})`, l);
  }
  ctx.kv.advance(tokenIds.length);

  // Project the last token's hidden state to logits
  const lastTokenIndex = tokenIds.length - 1;
  const logits = await projectLogits(ctx as OpCtx, hidden, lastTokenIndex, ctx.weights, ctx.config, tokenizer.vocabSize);

  return { logits };
}

/**
 * Single-step decode of the last token; updates KV/state in place.
 * The token is already embedded; just runs the blocks and projects logits.
 */
export async function decodeStep(
  ctx: LayerContext,
  hidden: GpuBufferLike,
  posBase: number,
  tokenizer: BonsaiTokenizer,
): Promise<ForwardResult> {
  // Run all blocks
  const io: BlockIO = { hidden, nTokens: 1, posBase };
  // D-937: the matching per-block probe for the decode path, so prefill and decode can be
  // compared at the SAME position — block by block, and elementwise when a capture tag is
  // set. Decode carries exactly one token, so its row IS row 0.
  const probeDecode = async (l: number) => {
    if (!bonsaiDebugEnabled() && !captureActive()) return;
    const row = await readbackF32(ctx as OpCtx, hidden, ctx.config.embeddingLength);
    captureRow(l, row);
    if (!bonsaiDebugEnabled()) return;
    let nan = 0, mn = Infinity, mx = -Infinity, sabs = 0;
    for (let i = 0; i < row.length; i++) {
      const v = row[i];
      if (!Number.isFinite(v)) nan++;
      else { if (v < mn) mn = v; if (v > mx) mx = v; sabs += Math.abs(v); }
    }
     
    console.log(
      `[bonsai] DECODE_L${l}: bad=${nan} min=${mn.toFixed(3)} max=${mx.toFixed(3)} meanabs=${(sabs / row.length).toFixed(4)}`,
    );
  };
  for (let l = 0; l < ctx.config.blockCount; l++) {
    // Stream this layer's weights (blk.l.*) before running it. The real model loads
    // weights lazily per layer (ensureLayer is idempotent); without this the first
    // block throws "missing tensor blk.0.ssm_in.weight". (Eager-loaded harnesses hide it.)
    await ctx.weights.ensureLayer(l);
    // One submit per layer instead of one per op — see prefill() for why this is safe.
    beginBatch((ctx as OpCtx).device);
    try {
      await runBlock(ctx, l, io);
    } finally {
      flushBatch((ctx as OpCtx).device);
      flushDeferred((ctx as OpCtx).device);
    }
    await probeDecode(l);
    // Injection: replace this block's decode output with prefill's, so the NEXT block gets
    // a provably identical input. Recorded AFTER the probe so the probe still reports what
    // decode actually produced.
    const inj = (globalThis as InjectGlobals).__BONSAI_INJECT;
    if (inj && inj.layer === l && inj.row.length === ctx.config.embeddingLength) {
      (ctx as OpCtx).device.queue.writeBuffer(hidden as GPUBuffer, 0, inj.row);
       
      console.log(`[bonsai] INJECT applied at L${l} (decode hidden <- prefill row)`);
    }
  }
  ctx.kv.advance(1);

  // Project the last (only) token's hidden state to logits
  const logits = await projectLogits(ctx as OpCtx, hidden, 0, ctx.weights, ctx.config, tokenizer.vocabSize);

  return { logits };
}
