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
 * Full-attention F32 KV cache for softmax_attn.wgsl. Stores unquantized (f32) keys and values
 * for fast online softmax attention. Sized to capacity × headCountKv × headDim elements.
 *
 * v1: simple F32 buffers, linearly appended. 4-bit packing is a later optimization.
 * During prefill/decode, each append() adds nTok positions worth of K/V data,
 * and the caller tracks logical length separately (advance is implicit on append).
 */

import type { GpuDeviceLike, GpuBufferLike } from "../kernels/gpu-min";
import { BufferUsage } from "../kernels/gpu-min";
import { beginCopies, finishCopies } from "../kernels/dispatch";

export interface F32KvCacheConfig {
  fullAttnLayers: number[];
  headCountKv: number;
  headDim: number;
  /** Max positions to allocate (<= context length; default cap for memory). */
  capacity: number;
}

interface LayerF32Kv {
  k: GpuBufferLike; // f32 K cache [capacity * headCountKv * headDim]
  v: GpuBufferLike; // f32 V cache [capacity * headCountKv * headDim]
  length: number;   // how many positions have been filled (0 to capacity)
}

/**
 * F32 KV cache for full-attention layers.
 *
 * Layout per layer: k and v are [capacity * headCountKv * headDim] f32 elements.
 * Positions are stored sequentially: position 0 at offset 0, position 1 at offset
 * headCountKv*headDim, etc. Each position holds all headCountKv KV heads for that position.
 *
 * When appending K,V for one or more positions, the caller provides buffers of shape
 * [nTok * headCountKv * headDim]. We copy them starting at offset (length * headCountKv * headDim)
 * and then the caller must advance the KvCache global length.
 */
export class F32KvCache {
  private layers = new Map<number, LayerF32Kv>();
  readonly capacity: number;
  private perPos: number; // headCountKv * headDim

  constructor(
    private device: GpuDeviceLike,
    private cfg: F32KvCacheConfig,
  ) {
    this.capacity = cfg.capacity;
    this.perPos = cfg.headCountKv * cfg.headDim;
    const totalElems = this.capacity * this.perPos;
    const bytes = totalElems * 4; // f32
    for (const l of cfg.fullAttnLayers) {
      this.layers.set(l, {
        k: this.alloc(bytes, `kv_f32.k.${l}`),
        v: this.alloc(bytes, `kv_f32.v.${l}`),
        length: 0,
      });
    }
  }

  private alloc(bytes: number, label: string): GpuBufferLike {
    return this.device.createBuffer({
      size: Math.max(4, bytes),
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label,
    });
  }

  layer(index: number): { k: GpuBufferLike; v: GpuBufferLike; length: number } {
    const l = this.layers.get(index);
    if (!l) throw new Error(`bonsai-kv_f32: layer ${index} has no F32 KV cache (not a full-attn layer)`);
    return l;
  }

  /**
   * Append nTok positions worth of f32 K/V data to a layer.
   * kF32 and vF32 must be [nTok * headCountKv * headDim] f32 buffers.
   * This advances the layer's internal length; does NOT advance the global KvCache.
   * kSrcOffset and vSrcOffset allow extracting a slice from the source buffers (in bytes).
   */
  append(
    layer: number,
    kF32: GpuBufferLike,
    vF32: GpuBufferLike,
    nTok: number,
    kSrcOffset = 0,
    vSrcOffset = 0,
  ): void {
    const l = this.layers.get(layer);
    if (!l) throw new Error(`bonsai-kv_f32: layer ${layer} has no F32 KV cache`);
    if (l.length + nTok > this.capacity) {
      throw new Error(
        `bonsai-kv_f32: layer ${layer} capacity ${this.capacity} exceeded (length=${l.length}, append=${nTok})`,
      );
    }
    const offsetElems = l.length * this.perPos;
    const offsetBytes = offsetElems * 4;
    const nElems = nTok * this.perPos;
    const nBytes = nElems * 4;

    // RECORD INTO THE OPEN LAYER BATCH — never a private encoder + immediate submit.
    //
    // This was `device.createCommandEncoder()` + `queue.submit()`, which ran the copy
    // IMMEDIATELY. But the source buffers are the block's K/V projections, and those are
    // recorded into the batch encoder that beginBatch() opened and flushBatch() does not
    // submit until the END of the layer. So the copy executed BEFORE the projections that
    // fill it: every full-attention layer seeded its KV cache from buffers that had not
    // been computed yet, then attended over that.
    //
    // beginCopies() exists precisely for this and its doc-comment names this failure —
    // it was applied to the QG-deinterleave and conv-history copies and missed here.
    //
    // WHY THIS HID FOR SO LONG: Bonsai-27B is a HYBRID, and only 16 of its 64 blocks take
    // this path — the other 48 are DeltaNet and never touch the F32 KV cache. Corrupting a
    // quarter of the layers degrades output without destroying it, which reads as "the
    // 1-bit model is a bit dumb". A DENSE model routes ALL layers through here, so the same
    // defect produces unbroken token salad ("xt\n\nxt\n\n...", verified on the real 1.7B
    // and 8B while llama.cpp answers "Paris." from the same file).
    //
    // This is the measured non-causality of D-1332: prefill(N) and prefill(N-1) disagreed
    // at a SHARED position because what landed in the cache depended on whatever was in
    // those scratch buffers at submit time, not on the tokens.
    const tgt = beginCopies(this.device);
    tgt.enc.copyBufferToBuffer(kF32, kSrcOffset, l.k, offsetBytes, nBytes);
    tgt.enc.copyBufferToBuffer(vF32, vSrcOffset, l.v, offsetBytes, nBytes);
    finishCopies(this.device, tgt);
    l.length += nTok;
  }

  /**
   * Global position advance. forward.ts (prefill/decodeStep) calls this once after the
   * block loop. For the F32 cache each full-attn layer's length is already advanced by
   * append() (see its docstring), so this is a no-op — present for interface parity with
   * the 4-bit KvCache so the forward-pass orchestration runs end-to-end.
   */
  advance(_nTok: number): void {
    // no-op: append() already advances each full-attn layer's length.
  }

  /**
   * The filled length shared by EVERY full-attention layer.
   *
   * Layers advance independently (append() bumps each one as its block runs), so
   * they are only ever equal because every layer sees every token. If they ever
   * disagree, some layer silently skipped or double-counted a position and its
   * attention is reading a different history from its neighbours' — fluent, wrong
   * output with nothing in the logs. Cross-turn reuse depends on there being ONE
   * true length, so this asserts that rather than trusting layer 0.
   */
  filledLength(): number {
    let seen: number | null = null;
    for (const [idx, l] of this.layers) {
      if (seen === null) seen = l.length;
      else if (l.length !== seen) {
        throw new Error(
          `bonsai-kv_f32: layers disagree on filled length (layer ${idx}=${l.length}, `
          + `expected ${seen}) — the KV cache is inconsistent`,
        );
      }
    }
    return seen ?? 0;
  }

  /** Get the current filled length for a layer. */
  currentLength(layer: number): number {
    const l = this.layers.get(layer);
    if (!l) throw new Error(`bonsai-kv_f32: layer ${layer} has no F32 KV cache`);
    return l.length;
  }

  /** Reset all layer lengths to 0 at the start of a generation. */
  reset(): void {
    for (const l of this.layers.values()) {
      l.length = 0;
    }
  }

  /**
   * Keep the first `n` positions and drop the rest — cross-turn prefix reuse.
   *
   * Exact for attention, because position t's K/V depend only on token t: the
   * surviving entries are bit-identical to what a fresh prefill of that prefix
   * would write. Nothing is zeroed, matching reset(): the buffers past `n` are
   * simply unreachable, since attention reads only [0, length).
   *
   * 🪤 This is NOT a general "rewind the model" operation. Layers with a
   * RECURRENT state (DeltaNet) fold every token into one running value that has
   * no inverse, and truncating their history is impossible — the caller decides
   * via `planReuse(canTruncate)`, which refuses for any model carrying such
   * layers. Calling this on a hybrid model would leave attention rewound and the
   * recurrent state still holding the future: fluent, wrong output, no error.
   */
  truncate(n: number): void {
    if (n < 0) throw new Error(`bonsai-kv_f32: truncate(${n}) — negative length`);
    for (const l of this.layers.values()) {
      if (n > l.length) {
        // Growing here would claim positions that were never written. Refuse
        // loudly rather than attend over uninitialised memory.
        throw new Error(
          `bonsai-kv_f32: truncate(${n}) exceeds filled length ${l.length} — `
          + 'cannot extend a cache by declaration',
        );
      }
      l.length = n;
    }
  }
}
