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
 * Orchestrator: load (parse GGUF header/KV/infos -> registry -> config -> tokenizer ->
 * pipelines -> upload globals) then prefill/decode. The LOAD path is fully real and is
 * what Milestone 1 exercises (it parses the actual Bonsai GGUF over range requests and
 * resolves qwen35.* config with nothing hardcoded). The generation loop is wired to the
 * forward pass; its numerical correctness is gated by the browser-GPU milestones.
 */

import { RangeReader, httpRangeFetcher, mirroredRangeFetcher, type RangeFetcher } from "./gguf/reader";
import { cachedRangeFetcher } from "./gguf/idb-cache";
import { parseGguf, type ParsedGguf } from "./gguf/parser";
import { GgufMetadata } from "./gguf/metadata";
import { TensorRegistry } from "./tensors/registry";
import {
  resolveQwen35Config,
  assertLayerSchedule,
  assertKernelDimBounds,
  type Qwen35Config,
} from "./model/config";
import { BonsaiTokenizer } from "./tokenizer/load";
import { WeightStore } from "./model/weights";
import type { GpuDeviceLike } from "./kernels/gpu-min";
import { PipelineCache, type KernelSources } from "./kernels/pipelines";

export interface BonsaiRuntimeDeps {
  /** WebGPU device (acquired by the caller from navigator.gpu). */
  device: GpuDeviceLike;
  /** WGSL sources keyed by kernel name (bundler owns the `?raw` imports). */
  kernelSources: KernelSources;
  /** Range transport; defaults to fetch() range GETs for the model URL. */
  fetchRange?: RangeFetcher;
}

export interface LoadProgress {
  phase: "parse" | "config" | "tokenizer" | "pipelines" | "globals" | "ready";
  percent: number;
  detail?: string;
}

export interface LoadedModel {
  device: GpuDeviceLike;
  parsed: ParsedGguf;
  meta: GgufMetadata;
  registry: TensorRegistry;
  config: Qwen35Config;
  tokenizer: BonsaiTokenizer;
  pipelines: PipelineCache;
  weights: WeightStore;
  scheduleOk: boolean;
  scheduleMessage: string;
}

export interface CreateRuntimeOptions {
  modelUrl: string;
  /**
   * Primary first, then any mirror. Optional: absent means "just modelUrl", so every existing
   * caller is unchanged and pays nothing.
   *
   * A mirror exists because every weight comes from ONE host today, and if that host is
   * unreachable the in-browser brain does not degrade — it stops existing for every visitor
   * simultaneously. See `mirrorUrls()` in lib/bonsai-models for what a mirror host must
   * actually support (range AND CORS; most candidates fail one).
   */
  mirrorUrls?: string[];
  onProgress?: (p: LoadProgress) => void;
}

export class BonsaiRuntime {
  private model?: LoadedModel;
  constructor(private deps: BonsaiRuntimeDeps) {}

  /** Parse the GGUF and build everything needed to run. Emits progress 0-100. */
  async load(opts: CreateRuntimeOptions): Promise<LoadedModel> {
    // Persist the 3.8 GB in IndexedDB so it's a ONE-TIME download, not a per-visit one
    // (Chrome won't keep a file this large in its HTTP cache). Falls back to the network
    // fetcher on any IDB error — can only speed up loading, never break it.
    /*
     * MIRRORED, so one host's outage is not every visitor's outage.
     *
     * `opts.mirrorUrls` is the primary followed by any configured mirror; absent or single,
     * mirroredRangeFetcher degenerates to the plain fetcher and costs nothing. Failover is
     * per-RANGE, which is what makes it survive a host dying mid-load — weights stream
     * lazily per layer across a whole session, so layer 40 has to be recoverable, not just
     * layer 0.
     */
    const urls = opts.mirrorUrls?.length ? opts.mirrorUrls : [opts.modelUrl];
    const baseFetch = this.deps.fetchRange ?? mirroredRangeFetcher(urls);
    const fetchRange =
      this.deps.fetchRange ? baseFetch : cachedRangeFetcher(opts.modelUrl, baseFetch);
    const p = opts.onProgress ?? (() => {});

    p({ phase: "parse", percent: 2, detail: "range-fetching header + KV" });
    const reader = new RangeReader({ url: opts.modelUrl, fetchRange });
    const parsed = await parseGguf(reader);
    const meta = new GgufMetadata(parsed.kv);

    p({ phase: "config", percent: 30, detail: `arch=${meta.arch}` });
    const registry = new TensorRegistry(parsed);
    const arch = meta.resolveArchConfig();
    const config = resolveQwen35Config(arch, registry);
    const schedule = assertLayerSchedule(config);
    // §8 RISK: fail loudly here if the real GGUF's head_dim / DeltaNet d_v would overrun the
    // WGSL kernels' fixed array<f32, 256> scratch, instead of silently reading OOB on the GPU.
    const dimBounds = assertKernelDimBounds(config);
     
    console.log(`bonsai: kernel dims OK — ${dimBounds.message}`);

    p({ phase: "tokenizer", percent: 45, detail: "building BPE tables" });
    const tokenizer = new BonsaiTokenizer(meta.resolveTokenizer());

    p({ phase: "pipelines", percent: 60, detail: "compiling WGSL" });
    const pipelines = new PipelineCache(this.deps.device, this.deps.kernelSources);
    pipelines.warmAll();

    p({ phase: "globals", percent: 75, detail: "uploading embeddings + LM head + norms" });
    const weights = new WeightStore(this.deps.device, registry, fetchRange);
    // Upload global tensors in two passes: REQUIRED first, then optional.
    // token_embd.weight and output_norm.weight are NON-NEGOTIABLE — without them, generation
    // will always fail at embedTokens/projectLogits with a confusing "not loaded" error that
    // looks like a runtime bug instead of a download failure. Fail at load time where the
    // message is actionable. output.weight is optional — many models weight-tie it to
    // token_embd.weight, so its absence is normal.
    const requiredGlobals = ["token_embd.weight", "output_norm.weight"];
    await weights.loadGlobals(requiredGlobals);
    // Verify required globals actually loaded (loadGlobals silently filters tensors absent
    // from the registry — a model file missing its embedding table should not slip through).
    for (const name of requiredGlobals) {
      if (!weights.has(name)) {
        throw new Error(
          `bonsai-runtime: required tensor '${name}' was not found in the GGUF file. ` +
            `The model file may be corrupted or incomplete — try clearing your browser cache ` +
            `and reloading, or switch to a different model size.`,
        );
      }
    }
    // Optional globals: output.weight (weight-tied to token_embd in many models).
    const optionalGlobals = ["output.weight"];
    try {
      await weights.loadGlobals(optionalGlobals);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`bonsai-runtime: optional globals not loaded: ${(e as Error).message}`);
    }

    p({ phase: "ready", percent: 100 });
    const model: LoadedModel = {
      device: this.deps.device,
      parsed,
      meta,
      registry,
      config,
      tokenizer,
      pipelines,
      weights,
      scheduleOk: schedule.ok,
      scheduleMessage: schedule.message,
    };
    this.model = model;
    return model;
  }

  get loaded(): LoadedModel | undefined {
    return this.model;
  }

  /**
   * Upload every transformer block to the GPU in the BACKGROUND, so the first message does
   * not pay for the whole model.
   *
   * WHAT THIS FIXES, measured on the deployed aitherium.com bundle 2026-08-14 (1.7B, RTX
   * 5090, plain visitor path, no flags):
   *
   *     first message   61,824 ms to first token
   *     second message      140 ms to first token, 42.4 tok/s
   *
   * Same worker, same model, nothing else changed. `load()` reports `ready` once the
   * GLOBALS are up (token_embd, output_norm, lm head); the 28 transformer blocks stream
   * lazily on first use. So `ready` is true and the model is not usable-fast yet, and the
   * whole cost lands on the visitor's first message — which is the one moment they are
   * deciding whether this thing works. The GPU sat at 8% / 70 W throughout, because that
   * minute is a DOWNLOAD, not compute.
   *
   * The read-ahead in `WeightStore.prefetchLayer` already overlaps fetch with compute, but
   * it can only overlap work that has started; nothing was pulling the blocks before the
   * first turn existed. This does.
   *
   * Deliberately fire-and-forget and non-blocking: callers post `ready` and start warming,
   * and a message arriving mid-warm is NOT delayed by it — `ensureLayer` dedupes through
   * its in-flight map, so the turn awaits the same upload it would have started itself, and
   * every block already warmed is a block it does not wait for.
   *
   * Bounded concurrency on purpose. Firing all 28 (or the 27B's 64) range requests at once
   * puts them in one connection pool where they finish in arrival order rather than block
   * order, so block 0 — the one the first turn needs first — can land last. A small window
   * keeps the fetches roughly in the order compute will want them.
   *
   * Errors are swallowed per block, matching `prefetchLayer`: warming is speculative, and a
   * failed range must surface at the `ensureLayer` the real turn makes, where a caller can
   * see it, not as an unhandled rejection from a promise nobody awaited.
   */
  async warm(opts?: { concurrency?: number; cancelled?: () => boolean }): Promise<number> {
    const model = this.model;
    if (!model) return 0;
    const total = model.config.blockCount;
    const width = Math.max(1, Math.min(opts?.concurrency ?? 3, total));
    let next = 0;
    const pull = async (): Promise<void> => {
      for (;;) {
        if (opts?.cancelled?.()) return;
        const i = next++;
        if (i >= total) return;
        try {
          await model.weights.ensureLayer(i);
        } catch {
          /* speculative — the real ensureLayer for this block still throws where a caller sees it */
        }
      }
    };
    await Promise.all(Array.from({ length: width }, pull));
    return model.weights.residentLayerCount;
  }
}

/** Convenience factory. */
export function createBonsaiRuntime(deps: BonsaiRuntimeDeps): BonsaiRuntime {
  return new BonsaiRuntime(deps);
}
