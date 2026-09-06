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
 * Token embedding lookup + final RMSNorm + LM head projection. The embedding table
 * (token_embd.weight) and output projection (output.weight, or weight-tied to token_embd)
 * are Q1_0-quantized on-disk and loaded to GPU via WeightStore; this module gathers and
 * dequantizes embedding rows and projects the final-token hidden state to logits.
 *
 * EMBEDDING LOOKUP (embedTokens): For efficiency, we read back the needed Q1_0 embedding
 * rows to CPU, dequantize locally using the reference quantization contract, and write
 * the f32 vectors to GPU. Embeddings are typically small (vocab×embedding_len) and the
 * gather is sparse (one row per input token), so this is faster than a GPU kernel. If the
 * embedding table is very large or embedding lookup becomes hot, a dedicated GPU gather
 * kernel could replace this.
 *
 * LOGITS PROJECTION (projectLogits): Apply final RMSNorm to the last token's hidden row,
 * quantize to Q8_0, then use projectQuantized (quantize+matmul) to project through the LM
 * head weights. Standard Qwen35 path: norm -> (Q1_0 or Q2_0 weight·Q8_0 act), with the
 * weight's quant type taken from the GGUF header rather than assumed.
 */

import type { GpuBufferLike } from "../kernels/gpu-min";
import type { OpCtx } from "./ops";
import type { Qwen35Config } from "./config";
import type { WeightStore } from "./weights";
import { readback, createStorage } from "../kernels/dispatch";
import { f32Buffer, rmsnorm, projectQuantized } from "./ops";
import {
  readQ1Block,
  dequantQ1Block,
  readQ2Block,
  dequantQ2Block,
} from "../kernels/reference";
// QK1_0 == QK2_0 == 128 weights/block, so one blocksPerRow serves both; only the BYTE
// stride differs (20 vs 36 on GPU) and that is chosen from the tensor's declared type below.
import { QK1_0, GgmlType } from "../gguf/types";

/**
 * Gather token embedding rows and write to GPU buffer.
 *
 * The embedding table (token_embd.weight) is Q1_0-quantized, stored on GPU as raw
 * binary Q1_0 blocks. For each token ID, we:
 *   1. Calculate the Q1_0 block offset for that token's row
 *   2. Copy that row from GPU to a staging buffer
 *   3. Read back the staging buffer to CPU
 *   4. Dequantize to f32 using the reference Q1_0 contract
 *   5. Accumulate into output, then write once to GPU
 *
 * Fails loudly if token_embd.weight is not found or if any token ID is out of bounds.
 *
 * @param ctx OpCtx (device, pipelines)
 * @param tokenIds Token IDs to embed [nTokens]
 * @param hiddenOut Output f32 buffer [nTokens × embeddingLength]; must be pre-allocated
 * @param weights WeightStore with token_embd loaded
 * @param embeddingLength Per-token embedding dimension (from config)
 */
export async function embedTokens(
  ctx: OpCtx,
  tokenIds: number[],
  hiddenOut: GpuBufferLike,
  weights: WeightStore,
  embeddingLength: number,
): Promise<void> {
  const embeddingName = "token_embd.weight";
  if (!weights.has(embeddingName)) {
    throw new Error(
      `bonsai-embed: token embedding table '${embeddingName}' not loaded; ` +
        `call weights.loadGlobals(['${embeddingName}']) first`,
    );
  }

  const embeddingBuffer = weights.get(embeddingName);
  const nTokens = tokenIds.length;

  // Each row of the embedding table is embeddingLength elements stored as Q1_0 blocks.
  // embeddingLength must be a multiple of QK1_0 (128); this is guaranteed by config validation.
  if (embeddingLength % QK1_0 !== 0) {
    throw new Error(
      `bonsai-embed: embeddingLength ${embeddingLength} not a multiple of QK1_0 (${QK1_0})`,
    );
  }
  // Weights are stored in the GPU layout of 20 bytes/block (5 u32; 18 used + 2 pad) — see
  // the Q1_0 repack in tensors/upload.ts. Read at that stride; readQ1Block consumes the 18
  // valid bytes from each block start (the 2 pad bytes are ignored).
  // QUANT TYPE COMES FROM THE FILE, NOT FROM A DEFAULT. Reading a 34-byte Q2_0 block at the
  // 20-byte Q1_0 stride does not crash — it yields fluent garbage, the hardest failure here
  // to notice, and exactly the class D-812 cost days to. GPU strides come from the repack in
  // tensors/upload.ts: Q1_0 20 bytes (18 used + 2 pad), Q2_0 36 (34 + 2).
  const embedType = weights.typeOf(embeddingName);
  const isQ2 = embedType === GgmlType.Q2_0;
  if (!isQ2 && embedType !== GgmlType.Q1_0) {
    throw new Error(
      `bonsai-embed: '${embeddingName}' has unsupported quant type ${embedType} ` +
        `(supported: Q1_0=${GgmlType.Q1_0}, Q2_0=${GgmlType.Q2_0})`,
    );
  }
  const GPU_BYTES_PER_BLOCK = isQ2 ? 36 : 20;
  const blocksPerRow = embeddingLength / QK1_0;
  const bytesPerRow = blocksPerRow * GPU_BYTES_PER_BLOCK;

  // Create an f32 output buffer on CPU to accumulate dequantized embeddings.
  const f32Out = new Float32Array(nTokens * embeddingLength);

  // Allocate a reusable staging buffer for reading one row at a time.
  const stagingBuffer = createStorage(ctx.device, bytesPerRow, "embed_staging");

  // Read back all needed rows and dequantize.
  for (let t = 0; t < nTokens; t++) {
    const tokenId = tokenIds[t];
    if (!Number.isInteger(tokenId) || tokenId < 0) {
      throw new Error(
        `bonsai-embed: token ID ${tokenId} at position ${t} is invalid (must be non-negative integer)`,
      );
    }

    // Byte offset of this token's row in the Q1_0 embedding table.
    const rowByteOffset = tokenId * bytesPerRow;

    // Copy this row from GPU embedding buffer to staging buffer via command encoder.
    const enc = ctx.device.createCommandEncoder();
    enc.copyBufferToBuffer(embeddingBuffer, rowByteOffset, stagingBuffer, 0, bytesPerRow);
    ctx.device.queue.submit([enc.finish()]);

    // Read back the staging buffer.
    const rowBytes = await readback(ctx.device, stagingBuffer, bytesPerRow);
    const rowU8 = new Uint8Array(rowBytes);

    // Dequantize: extract Q1_0 blocks and convert to f32.
    for (let b = 0; b < blocksPerRow; b++) {
      const blockStart = b * GPU_BYTES_PER_BLOCK;
      const dequantized = isQ2
        ? dequantQ2Block(readQ2Block(rowU8, blockStart))
        : dequantQ1Block(readQ1Block(rowU8, blockStart));

      // Copy this block's 128 f32 values into the output row.
      const outOffset = t * embeddingLength + b * QK1_0;
      f32Out.set(dequantized, outOffset);
    }
  }

  // Write the dequantized embeddings to GPU.
  ctx.device.queue.writeBuffer(hiddenOut, 0, f32Out);
  stagingBuffer.destroy();
}

/**
 * Apply final RMSNorm and project the last token's hidden state to vocabulary logits.
 *
 * The forward pass produces hidden states [nTokens × embeddingLength]. For generation,
 * we take the last token's hidden row, apply RMSNorm(output_norm.weight), quantize to
 * Q8_0, and project through the LM head weights (output.weight, or tied to token_embd.weight
 * if output.weight is absent) via a Q1_0/Q2_0·Q8_0 matmul chosen from that tensor's own
 * declared quant type. Returns a new GPU buffer of logits
 * [vocab], ready for sampling.
 *
 * Fails loudly if output_norm.weight is missing or if output.weight / token_embd weight-tie
 * cannot be resolved.
 *
 * @param ctx OpCtx (device, pipelines)
 * @param hidden Input hidden state buffer [nTokens × embeddingLength], f32
 * @param lastTokenIndex Index of the token to project (typically nTokens - 1 for 0-indexed)
 * @param weights WeightStore
 * @param config Qwen35Config (contains embeddingLength, rmsEps)
 * @param vocabSize Vocabulary size (output dimension)
 * @return Promise<GpuBufferLike> Logits buffer [vocab], ready for sampling
 */
export async function projectLogits(
  ctx: OpCtx,
  hidden: GpuBufferLike,
  lastTokenIndex: number,
  weights: WeightStore,
  config: Qwen35Config,
  vocabSize: number,
): Promise<GpuBufferLike> {
  const outputNormName = "output_norm.weight";
  if (!weights.has(outputNormName)) {
    throw new Error(
      `bonsai-lmhead: output norm '${outputNormName}' not loaded; ` +
        `call weights.loadGlobals(['${outputNormName}']) first`,
    );
  }

  const outputNormWeight = weights.get(outputNormName);
  const embeddingLength = config.embeddingLength;
  const eps = config.rmsEps;

  // Extract the LAST token's hidden row [embeddingLength] (GPU copy at its offset),
  // then RMSNorm that single row. Without the copy, rmsnorm(nRows=1) would normalize
  // token 0's row and the logits would predict the next token after the PROMPT's first
  // token instead of after the last — i.e. no coherent generation.
  const lastRow = f32Buffer(ctx.device, embeddingLength, "last_row");
  {
    const enc = ctx.device.createCommandEncoder();
    enc.copyBufferToBuffer(
      hidden,
      lastTokenIndex * embeddingLength * 4,
      lastRow,
      0,
      embeddingLength * 4,
    );
    ctx.device.queue.submit([enc.finish()]);
  }
  const normedHidden = f32Buffer(ctx.device, embeddingLength, "normed_hidden");
  rmsnorm(ctx, lastRow, outputNormWeight, normedHidden, 1, embeddingLength, eps);
  {
    const { BONSAI_DEBUG } = await import("./forward");
    if (BONSAI_DEBUG) {
      const { readbackF32 } = await import("./ops");
      const nh = await readbackF32(ctx, normedHidden, embeddingLength);
      let sabs = 0, mn = Infinity, mx = -Infinity;
      for (const v of nh) { if (v < mn) mn = v; if (v > mx) mx = v; sabs += Math.abs(v); }
      // eslint-disable-next-line no-console
      console.log(`[bonsai] normedHidden: min=${mn.toFixed(3)} max=${mx.toFixed(3)} meanabs=${(sabs / nh.length).toFixed(4)}`);
      // eslint-disable-next-line no-console
      console.log("[bonsai] NH_DUMP " + JSON.stringify(Array.from(nh)));
    }
  }

  // Determine the LM head weight matrix. If output.weight exists, use it;
  // otherwise tie to token_embd.weight.
  const outputWeightName = "output.weight";
  const usingWeightTie = !weights.has(outputWeightName);
  const headWeightName = usingWeightTie ? "token_embd.weight" : outputWeightName;
  if (!weights.has(headWeightName)) {
    throw new Error(
      `bonsai-lmhead: LM head weights '${headWeightName}' not loaded; ` +
        `call weights.loadGlobals(['${headWeightName}']) first`,
    );
  }

  const headWeights = weights.get(headWeightName);

  // Project normed_hidden [1 × embeddingLength] through head weights [vocabSize × embeddingLength]
  // to get logits [vocabSize].
  const logits = f32Buffer(ctx.device, vocabSize, "logits");

  // Per-TENSOR quant dispatch, not the context default: the head is weight-TIED to
  // token_embd whenever output.weight is absent, and the embedding tensor is exactly the one
  // a packer is most likely to quantize differently from the decoder blocks. Reading its
  // type from the header costs nothing and removes the assumption.
  projectQuantized(
    ctx,
    normedHidden,
    headWeights,
    logits,
    1,
    embeddingLength,
    vocabSize,
    weights.typeOf(headWeightName),
  );

  lastRow.destroy();
  normedHidden.destroy(); // Clean up intermediate buffers.
  return logits;
}
