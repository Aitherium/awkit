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
 * 4-bit KV cache, allocated ONLY on the full-attention layers. Sized to the actual
 * generation length at runtime (default context capped well below the 262K ceiling to
 * respect device memory — §8 risk #3). Each (pos, kv_head) ROW is quantized in-kernel
 * (kv_quant_4bit.wgsl) to `headDim/8` packed u32 words (4 bits per element, 8 per word,
 * LSB-first) plus ONE f16 scale per row stored as a u32 (f16 in the low 16 bits). The
 * batched attention kernel (softmax_attn_batched.wgsl mode==1) dequantizes inline.
 *
 * BYTE-LEVEL LAYOUT CONTRACT (per layer):
 *   packed : [(capacity · headCountKv) · wordsPerRow] u32
 *            row r = (pos·headCountKv + kvHead); element e within the row -> word e>>3,
 *            nibble (e&7). Requires headDim % 8 == 0 (asserted) so the flat element index
 *            -> word index mapping is row-local and never crosses a row boundary.
 *   scale  : [capacity · headCountKv] u32 — f16 scale bits in the LOW 16 bits.
 *   scale[row r] = pack2x16float(vec2(amax/7, 0)) & 0xffff, dequantized by the attention
 *   kernel as (raw - 8) * unpack2x16float(scale).x  (see reference.ts packKvRow4bit).
 *
 * DEFAULT: 4-bit. The 4-bit cache quadruples usable prefix length on budget devices (the
 * "faster agent" win) and is byte-identical to F32 on greedy decode — verified on 1.7B
 * dense, NVIDIA blackwell: both modes produce an identical 437-char / 80-token
 * continuation. `?kv=f32` / `__BONSAI_KV=f32` / localStorage `bonsai_kv=f32` opt back to
 * the F32 cache; an unknown value throws rather than silently running either mode.
 */

import type { GpuDeviceLike, GpuBufferLike } from "../kernels/gpu-min";
import { BufferUsage } from "../kernels/gpu-min";
import {
  bindGroup,
  createUniform,
  deferDestroy,
  dispatch1D,
  packUniform,
} from "../kernels/dispatch";
import type { PipelineCache } from "../kernels/pipelines";

export type KvMode = "f32" | "4bit";

export interface KvCacheConfig {
  fullAttnLayers: number[];
  headCountKv: number;
  headDim: number;
  /** Max positions to allocate (<= context length; default cap for memory). */
  capacity: number;
}

/** One full-attention layer's 4-bit K/V + per-row f16 scales + filled length. */
export interface Kv4Layer {
  k: GpuBufferLike; // packed K [capacity·headCountKv·wordsPerRow] u32
  v: GpuBufferLike; // packed V (same shape)
  kScale: GpuBufferLike; // [capacity·headCountKv] u32 (f16 scale in low 16)
  vScale: GpuBufferLike; // [capacity·headCountKv] u32
  length: number; // filled positions (0..capacity)
}

/**
 * 4-bit KV cache for full-attention layers.
 *
 * Layout per layer: k/v are [(capacity·headCountKv)·wordsPerRow] u32; kScale/vScale are
 * [capacity·headCountKv] u32. Positions are stored sequentially: absolute position pos
 * occupies the headCountKv rows starting at row (pos·headCountKv). When appending the K/V
 * for a batch of nTok tokens, the source buffers are [nTok·headCountKv·headDim] f32 and the
 * kernel writes them at absolute row offset (posBase·headCountKv) — posBase is the absolute
 * position of the batch's first token (0 for a fresh prompt, the reused-prefix length when
 * continuing an existing cache), matching softmaxAttnBatched's posBase.
 *
 * API SURFACE IS THE F32 PARITY: append / advance (no-op) / filledLength / currentLength /
 * truncate / reset / layer / capacity all mirror F32KvCache, so the forward-pass
 * orchestration (layers.ts KvLike) is identical for both modes.
 */
export class KvCache {
  private layers = new Map<number, Kv4Layer>();
  readonly capacity: number;
  private perPos: number; // headCountKv * headDim
  private wordsPerRow: number; // headDim / 8

  constructor(
    private device: GpuDeviceLike,
    private cfg: KvCacheConfig,
    private pipelines?: PipelineCache,
  ) {
    this.capacity = cfg.capacity;
    this.perPos = cfg.headCountKv * cfg.headDim;
    // kv_quant_4bit.wgsl runs ONE workgroup per (pos,kv_head) ROW with exactly 128 lanes and
    // one dim per lane, so a row's head_dim beyond 128 would be left UNQUANTIZED with no error
    // (zeros/stale — a silent corruption of exactly the kind this codebase refuses). Every
    // Bonsai size is head_dim=128 today; if a future model exceeds that, this throws instead
    // of half-packing. The nibble flat-index mapping (e>>3) also needs the row %8.
    if (cfg.headDim % 8 !== 0 || cfg.headDim > 128) {
      throw new Error(
        `bonsai-kv: 4-bit KV requires head_dim % 8 == 0 and head_dim <= 128 (kernel row width), got ${cfg.headDim}`,
      );
    }
    this.wordsPerRow = cfg.headDim / 8;
    const packedBytes = this.wordsPerRow * this.perPos * this.capacity * 4;
    const scaleBytes = cfg.headCountKv * this.capacity * 4;
    for (const l of cfg.fullAttnLayers) {
      this.layers.set(l, {
        k: this.alloc(packedBytes, `kv.k.${l}`),
        v: this.alloc(packedBytes, `kv.v.${l}`),
        kScale: this.alloc(scaleBytes, `kv.k_scale.${l}`),
        vScale: this.alloc(scaleBytes, `kv.v_scale.${l}`),
        length: 0,
      });
    }
  }

  private alloc(bytes: number, label: string): GpuBufferLike {
    return this.device.createBuffer({
      size: Math.max(4, bytes + (4 - (bytes % 4)) % 4),
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label,
    });
  }

  layer(index: number): Kv4Layer {
    const l = this.layers.get(index);
    if (!l) throw new Error(`bonsai-kv: layer ${index} has no 4-bit KV cache (not a full-attn layer)`);
    return l;
  }

  /**
   * Append nTok positions of f32 K/V to a layer, quantizing IN KERNEL (kv_quant_4bit.wgsl).
   * kF32/vF32 are [nTok·headCountKv·headDim] f32 buffers. posBase is the absolute position
   * of kF32's first token (0 for a fresh prompt; the reused-prefix length for a continuation).
   * Advances the layer's internal length; does NOT advance any global length (advance() is
   * a no-op, F32 parity).
   *
   * RECORDED INTO THE OPEN LAYER BATCH — dispatch1D is batch-aware and records onto the
   * batch encoder that beginBatch() opened, so the quantize runs AFTER the block's K/V
   * projections that fill the source buffers. A private encoder + immediate submit here
   * would rerun the D-1332 ordering bug (cache seeded from buffers not yet computed).
   */
  append(
    layer: number,
    kF32: GpuBufferLike,
    vF32: GpuBufferLike,
    nTok: number,
    posBase = 0,
  ): void {
    const l = this.layers.get(layer);
    if (!l) throw new Error(`bonsai-kv: layer ${layer} has no 4-bit KV cache`);
    if (l.length + nTok > this.capacity) {
      throw new Error(
        `bonsai-kv: layer ${layer} capacity ${this.capacity} exceeded (length=${l.length}, append=${nTok})`,
      );
    }
    if (!this.pipelines) {
      throw new Error(
        "bonsai-kv: append() needs the PipelineCache — construct KvCache with the pipelines argument",
      );
    }
    const pipe = this.pipelines.get("kv_quant_4bit");
    const nRows = nTok * this.cfg.headCountKv;
    // QP uniform (kv_quant_4bit.wgsl): head_dim, n_rows, row_base, _p0.
    const p = kvUniform(this.device, [
      { u32: this.cfg.headDim },
      { u32: nRows },
      { u32: posBase * this.cfg.headCountKv },
      { u32: 0 },
    ]);
    // THE LAST ARG IS 1 ON PURPOSE — the kernel is @workgroup_size(128) with ONE workgroup
    // per row, and dispatch1D computes groups = ceilDiv(totalThreads, workgroupSize).
    // Passing 128 here would divide the group count by 128 and quantize 1/128th of the rows
    // silently. (Same trap softmaxAttnBatched documents; see that dispatch.)
    dispatch1D(this.device, pipe, bindGroup(this.device, pipe, [kF32, l.k, l.kScale, p]), nRows, 1);
    dispatch1D(this.device, pipe, bindGroup(this.device, pipe, [vF32, l.v, l.vScale, p]), nRows, 1);
    l.length += nTok;
  }

  /**
   * Global position advance. forward.ts (prefill/decodeStep) calls this once after the
   * block loop. For the 4-bit cache each full-attn layer's length is already advanced by
   * append() (see its docstring), so this is a no-op — present for interface parity with
   * the F32 cache so the forward-pass orchestration runs end-to-end.
   */
  advance(_nTok: number): void {
    // no-op: append() already advances each full-attn layer's length.
  }

  /**
   * The filled length shared by EVERY full-attention layer. Layers advance independently
   * (append() bumps each one as its block runs), so they are only ever equal because every
   * layer sees every token. If they ever disagree, some layer silently skipped or
   * double-counted a position and its attention is reading a different history from its
   * neighbours' — fluent, wrong output with nothing in the logs. Cross-turn reuse depends
   * on there being ONE true length, so this asserts that rather than trusting layer 0.
   */
  filledLength(): number {
    let seen: number | null = null;
    for (const [idx, l] of this.layers) {
      if (seen === null) seen = l.length;
      else if (l.length !== seen) {
        throw new Error(
          `bonsai-kv: layers disagree on filled length (layer ${idx}=${l.length}, `
          + `expected ${seen}) — the KV cache is inconsistent`,
        );
      }
    }
    return seen ?? 0;
  }

  /** Get the current filled length for a layer. */
  currentLength(layer: number): number {
    const l = this.layers.get(layer);
    if (!l) throw new Error(`bonsai-kv: layer ${layer} has no 4-bit KV cache`);
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
   * Exact for attention, because position t's K/V depend only on token t: the surviving
   * entries are bit-identical to what a fresh prefill of that prefix would write. Nothing
   * is zeroed, matching reset(): the buffers past `n` are simply unreachable, since
   * attention reads only [0, length).
   *
   * 🪤 This is NOT a general "rewind the model" operation. Layers with a RECURRENT state
   * (DeltaNet) fold every token into one running value that has no inverse, and truncating
   * their history is impossible — the caller decides via `planReuse(canTruncate)`, which
   * refuses for any model carrying such layers. Calling this on a hybrid model would leave
   * attention rewound and the recurrent state still holding the future: fluent, wrong
   * output, no error.
   */
  truncate(n: number): void {
    if (n < 0) throw new Error(`bonsai-kv: truncate(${n}) — negative length`);
    for (const l of this.layers.values()) {
      if (n > l.length) {
        // Growing here would claim positions that were never written. Refuse
        // loudly rather than attend over uninitialised memory.
        throw new Error(
          `bonsai-kv: truncate(${n}) exceeds filled length ${l.length} — `
          + 'cannot extend a cache by declaration',
        );
      }
      l.length = n;
    }
  }
}

/** Mirrors ops.ts's private uniform() — pack 4-byte fields, defer-destroy after the batch. */
function kvUniform(device: GpuDeviceLike, fields: Array<{ u32?: number; f32?: number }>): GpuBufferLike {
  const bytes = packUniform(fields);
  const buf = createUniform(device, bytes.byteLength);
  device.queue.writeBuffer(buf, 0, bytes);
  deferDestroy(device, buf);
  return buf;
}

// ---------------------------------------------------------------------------
// KV mode resolution — how the worker chooses 4-bit vs F32.
// Priority: `__BONSAI_KV` global (set by the host / a test) > `?kv=` URL query
// (worker script URL) > localStorage `bonsai_kv` > default 'f32'. An unknown
// value FAILS LOUD rather than silently running either mode (a typo like
// `?kv=4Bit` would otherwise quietly defeat the flag).
// ---------------------------------------------------------------------------

/**
 * Can the 4-bit KV kernel represent a row of this width?
 *
 * kv_quant_4bit.wgsl is ONE 128-lane workgroup per (pos, kv_head) row with one dim per
 * lane, and the attention kernel's flat element -> word mapping (e>>3) needs the row to be
 * a whole number of packed u32 words. So the kernel supports head_dim % 8 == 0 AND
 * head_dim <= 128 — the same pair the KvCache ctor asserts.
 *
 * This exists as a PREDICATE, separate from the ctor's throw, because the two answer
 * different questions. The ctor's job is to refuse to half-pack a row it cannot represent,
 * and it must keep throwing. The caller's job is to not ask for it in the first place —
 * and until 2026-08-14 nothing did, so the ctor's guard was the only thing standing
 * between the default mode and the flagship model, which it converted into a hard failure.
 *
 * Measured live on aitherium.com: the 27B hybrid is head_dim=256, so with 4-bit as the
 * default (c042520b3f) it downloaded all 3.8 GB, reported `ready`, and then failed EVERY
 * generate with `bonsai-kv: ... got 256`. The KvCache ctor comment asserting "every Bonsai
 * size is head_dim=128 today" is false for exactly the model people most want to run.
 */
export function supports4bitKv(headDim: number): boolean {
  return Number.isFinite(headDim) && headDim > 0 && headDim % 8 === 0 && headDim <= 128;
}

function parseKvMode(v: string): KvMode {
  const t = v.trim().toLowerCase();
  if (t === "f32") return "f32";
  if (t === "4bit" || t === "4-bit" || t === "kv4" || t === "4") return "4bit";
  throw new Error(`bonsai-kv: unknown kv mode '${v}' (expected 'f32' or '4bit')`);
}

export function resolveKvMode(): KvMode {
  const g = globalThis as { __BONSAI_KV?: unknown };
  if (typeof g.__BONSAI_KV === "string" && g.__BONSAI_KV) return parseKvMode(g.__BONSAI_KV);
  if (typeof location !== "undefined" && typeof location.search === "string" && location.search) {
    const kv = new URLSearchParams(location.search).get("kv");
    if (kv) return parseKvMode(kv);
  }
  if (typeof localStorage !== "undefined") {
    try {
      const kv = localStorage.getItem("bonsai_kv");
      if (kv) return parseKvMode(kv);
    } catch {
      // localStorage can throw in a sandboxed iframe (SecurityError) — treat as absent.
    }
  }
  // DEFAULT: f32.
  //
  // This was "4bit — the faster agent path" from c042520b3f (2026-08-06) until 2026-08-14,
  // and it is THE reason the in-browser models stopped answering. Measured that day on the
  // deployed aitherium.com bundle, 1.7B, same prompt, same greedy decode (temperature 0,
  // topK 1) — the ONLY difference is this constant:
  //
  //   kv=4bit  ->  "? ? ? ?"                     max logit 12.41, top1-top2 margin 1.26
  //   kv=f32   ->  "Paris"                       max logit 26.63, top1-top2 margin 7.13
  //   kv=4bit  ->  "hello hello there hello? say hello?hello?hello?…"
  //   kv=f32   ->  "Hello! I'm here to help."
  //
  // So the model was never broken and neither was the LM head: the logit distribution
  // COLLAPSES (the winning margin falls ~6x) because attention reads a KV cache that has
  // lost too much precision, and a collapsed distribution is indistinguishable from a
  // broken model at the only place anyone looks — the text.
  //
  // Why this survived: `kv-pack-4bit.test.ts` passes and is RIGHT — the pack/unpack
  // round-trip is correct in isolation at head_dim=128. The defect is downstream of the
  // layout, in what the attention path does with those rows, and no test asserts
  // END-TO-END that a 4-bit turn is as GOOD as an f32 one. A quantisation bug
  // does not throw, does not warn, and does not fail a round-trip test; it just makes the
  // model slightly stupider, and 4 bits made it stupid enough to be unusable.
  //
  // 🚨 BUILD THAT CHECK ON THE MARGIN, NOT ON THE TEXT. This comment said "the same
  // text" until 2026-08-18, and text-equivalence is the one assertion that CANNOT work
  // here. Measured that day on the server lane, which has the same property: the SAME
  // engine, SAME config, temperature 0, run twice, produced different text on 7 of 8
  // prompts. A greedy decode is not run-to-run stable once batching/chunked prefill can
  // vary, so a text diff between an f32 run and a 4-bit run reports a difference that
  // exists between two f32 runs as well — it fails open on a real regression and fails
  // closed on a healthy one. Whoever builds this harness with `expect(text4bit) ===
  // text_f32` will conclude 4-bit is broken no matter what they change.
  //
  // The metric that DOES discriminate is already computed and logged by the worker
  // (`bonsai-worker-core.ts`, `margin(top1-top2)`), and the numbers above are the
  // reference band: a healthy turn wins by 7.13 and the broken one by 1.26 — a ~6x
  // separation, far outside run-to-run noise, from ONE readback rather than a whole
  // generation. Assert a FLOOR on the margin (and on max logit) for a fixed prompt on
  // real hardware; treat text as a human sanity check, never as the gate. Pair it with a
  // CONTROL arm — f32 vs f32 — or the harness cannot tell "4-bit hurt this" from "this
  // number moves anyway".
  //
  // 4-bit stays fully wired and opt-in (`?kv=4bit`, `__BONSAI_KV`, localStorage) so the
  // fidelity work can continue against it. Do NOT flip this back without an end-to-end
  // equivalence check on real hardware — the perf win is worthless on a model that cannot
  // answer, which is what shipped for eight days.
  return "f32";
}
