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
 * GGUF container: public spec ggml-org/ggml docs/gguf.md (format v3).
 *
 * Lazy per-layer GPUBuffer handles keyed off the tensor registry. Weights are uploaded
 * coalesced per block on first use and cached; quantized data stays on-GPU.
 */

import type { GpuDeviceLike, GpuBufferLike } from "../kernels/gpu-min";
import type { TensorRegistry } from "../tensors/registry";
import { GgmlType } from "../gguf/types";
import { uploadCoalescedRange, type UploadedTensor } from "../tensors/upload";
import type { RangeFetcher } from "../gguf/reader";

export class WeightStore {
  private buffers = new Map<string, GpuBufferLike>();
  private loadedLayers = new Set<number>();
  /** Layers whose upload has STARTED but not finished — see ensureLayer's re-entrancy note. */
  private inflight = new Map<number, Promise<void>>();

  constructor(
    private device: GpuDeviceLike,
    private registry: TensorRegistry,
    private fetchRange: RangeFetcher,
  ) {}

  has(name: string): boolean {
    return this.buffers.has(name);
  }

  get(name: string): GpuBufferLike {
    const b = this.buffers.get(name);
    if (!b) throw new Error(`bonsai-weights: '${name}' not resident (load its layer first)`);
    return b;
  }

  /**
   * The GGUF quant type of a tensor, from the file's own header.
   *
   * Consumers used to assume Q1_0 everywhere — hardcoded 18-byte blocks, hardcoded
   * `readQ1Block`, hardcoded `projectQ1`. With a second quant type that assumption reads a
   * 34-byte Q2_0 block as an 18-byte Q1_0 one and produces fluent garbage instead of
   * crashing, which is the hardest failure in this runtime to notice. So the type comes from
   * the registry, never from a default.
   */
  typeOf(name: string): number {
    return this.registry.get(name).type;
  }

  /**
   * The quant type shared by every DECODER-BLOCK weight tensor in this file.
   *
   * This is what `OpCtx.quantType` is set from, and it is the reason the block projections
   * can keep dispatching off the context instead of threading a type through ~20 call sites:
   * the homogeneity the context-level dispatch assumes is CHECKED here against the file's
   * own header rather than believed.
   *
   * A mixed-quant file THROWS. That is deliberate — the failure mode of guessing wrong is a
   * 34-byte Q2_0 block read at the 18-byte Q1_0 stride, which does not crash and does not
   * produce noise; it produces fluent, plausible text. Refusing to load is the only outcome
   * a human can notice. Per-tensor dispatch (`projectQuantized`) is the way to SUPPORT mixed
   * quant if a future file needs it — not a default picked here.
   *
   * Reads the registry (the parsed header), so it is valid before any layer is uploaded.
   * Non-quantized block tensors (F32/F16 norms) are ignored; an unsupported QUANT type is
   * not — it throws, because it would otherwise fall through to the Q1_0 path.
   */
  weightQuantType(): number {
    if (this.blockQuantType !== undefined) return this.blockQuantType;

    const isFloat = (t: number) => t === GgmlType.F32 || t === GgmlType.F16;
    const quantized = this.registry.ordered.filter(
      (e) => e.name.startsWith("blk.") && !isFloat(e.type),
    );
    if (quantized.length === 0) {
      throw new Error(
        "bonsai-weights: no quantized 'blk.*' weight tensors in the registry — " +
          "cannot determine the model's weight quant type",
      );
    }

    const byType = new Map<number, string>();
    for (const e of quantized) if (!byType.has(e.type)) byType.set(e.type, e.name);

    for (const [t, example] of byType) {
      if (t !== GgmlType.Q1_0 && t !== GgmlType.Q2_0) {
        throw new Error(
          `bonsai-weights: block tensor '${example}' has unsupported quant type ${t} ` +
            `(supported: Q1_0=${GgmlType.Q1_0}, Q2_0=${GgmlType.Q2_0})`,
        );
      }
    }
    if (byType.size > 1) {
      const seen = [...byType].map(([t, n]) => `${t} (e.g. '${n}')`).join(", ");
      throw new Error(
        `bonsai-weights: decoder blocks mix quant types — ${seen}. The block projections ` +
          `dispatch once per context, so a mixed file would silently run some layers through ` +
          `the wrong kernel and emit fluent garbage. Use projectQuantized per tensor to ` +
          `support this.`,
      );
    }

    this.blockQuantType = quantized[0].type;
    return this.blockQuantType;
  }

  private blockQuantType?: number;

  private register(uploaded: UploadedTensor[]): void {
    for (const u of uploaded) this.buffers.set(u.entry.name, u.buffer);
  }

  /** Upload the non-layer globals: token embeddings, output norm, LM head. */
  async loadGlobals(names: string[]): Promise<void> {
    const entries = names.filter((n) => this.registry.has(n)).map((n) => this.registry.get(n));
    for (const range of this.registry.coalesce(entries)) {
      this.register(await uploadCoalescedRange(this.device, this.fetchRange, range));
    }
  }

  /** Lazily upload one decoder block's weights (coalesced). Idempotent AND re-entrant.
   *
   * RE-ENTRANCY IS LOAD-BEARING, not defensive polish. The old body checked `loadedLayers`,
   * awaited the fetches, and only THEN recorded the layer — so two overlapping calls for the
   * same block both missed the guard, both fetched it over HTTP, and both uploaded it, with
   * the second `register()` overwriting the first buffer handle and LEAKING the first
   * (nothing else holds it, and `evictLayer` walks names, not orphans). That was harmless
   * only because every caller awaited serially. `prefetchLayer` makes overlap the normal
   * case, so the in-flight map has to exist before the prefetch does. */
  ensureLayer(layerIndex: number): Promise<void> {
    if (this.loadedLayers.has(layerIndex)) return Promise.resolve();
    const inflight = this.inflight.get(layerIndex);
    if (inflight) return inflight;
    // Delete on settle, not just on success: a failed fetch must be retryable, and leaving a
    // rejected promise in the map would make the retry re-throw the ORIGINAL error forever.
    const started = this.loadLayer(layerIndex).finally(() => this.inflight.delete(layerIndex));
    this.inflight.set(layerIndex, started);
    return started;
  }

  private async loadLayer(layerIndex: number): Promise<void> {
    for (const range of this.registry.coalesceBlock(layerIndex)) {
      this.register(await uploadCoalescedRange(this.device, this.fetchRange, range));
    }
    this.loadedLayers.add(layerIndex);
  }

  /**
   * Start streaming a layer WITHOUT waiting for it — the read-ahead that turns first-token
   * latency from a sum into an overlap.
   *
   * The first generation streams the whole model layer by layer, and every fetch used to sit
   * on the critical path: `await ensureLayer(l)` then compute l, 36 times, so the link idled
   * through every block's compute and the GPU idled through every block's download. Nothing
   * required that ordering — layer l+1's bytes depend on nothing layer l produces.
   *
   * Errors are swallowed HERE and only here: a prefetch is speculative, so a failure must not
   * surface as an unhandled rejection from a promise nobody awaited. The real `ensureLayer`
   * call for that block still runs (the map entry is gone by then) and still throws where a
   * caller can see it, so a genuinely broken fetch fails at the point that needs the bytes
   * rather than being converted into silence.
   */
  prefetchLayer(layerIndex: number): void {
    if (layerIndex < 0 || this.loadedLayers.has(layerIndex)) return;
    // Past the last block `coalesceBlock` returns [], which loadLayer would happily record as
    // a "loaded" empty layer — a lie the resident count would then repeat.
    if (this.registry.coalesceBlock(layerIndex).length === 0) return;
    void this.ensureLayer(layerIndex).catch(() => { /* speculative — see doc-comment */ });
  }

  /** Layers currently uploaded, for tests and the read-ahead's own assertions. */
  get residentLayerCount(): number {
    return this.loadedLayers.size;
  }

  /** Free a layer's buffers (for streaming under tight memory). */
  evictLayer(layerIndex: number, tensorNames: string[]): void {
    // Drop any read-ahead for this block too, or the in-flight upload lands AFTER the evict
    // and re-registers buffers the caller just freed.
    this.inflight.delete(layerIndex);
    for (const n of tensorNames) {
      const b = this.buffers.get(n);
      if (b) {
        b.destroy();
        this.buffers.delete(n);
      }
    }
    this.loadedLayers.delete(layerIndex);
  }
}
