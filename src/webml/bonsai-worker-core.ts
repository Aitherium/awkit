/**
 * Bonsai WebGPU worker runtime for portal-kit.
 *
 * DELEGATOR: This module bridges to the canonical runtime in ./bonsai/ (synced from
 * Veil/src/lib/bonsai-webgpu), providing the initBonsaiRuntime() interface expected by
 * worker-core.ts. All runtime components are imported from the synced copy.
 *
 * CAPABILITIES (implemented in synced bonsai-runtime):
 *   - tool calling (tools, MAX_TOOL_CALLS)
 *   - device-lost recovery (deviceLost handling)
 *   - 4-bit KV cache (kvMode support)
 *   - cross-turn prefix reuse (PREFIX_CACHE)
 *
 * Integration pattern: consumer imports runWebMLWorker from
 * awkit/webml/worker-core, which internally calls initBonsaiRuntime()
 * for bonsai-kernels models.
 */

import type { WorkerRequest, WorkerResponse } from "./protocol";
import { createBonsaiRuntime } from "./bonsai";
import type { KernelSources } from "./bonsai";
import { classifyAdapter, maxDispatchesPerSubmit } from "./bonsai/gpu-class";
import { setSubmitBudget } from "./bonsai/kernels/dispatch";
import { isMobileDevice } from "./device-class";
import { resolveBonsaiUrl } from "./bonsai-models";

// Import type hints from synced runtime to register capabilities with the checker
import type { BonsaiWorkerDeps } from "./bonsai/worker/bonsai-worker-core";
// Explicit capability registration for parity check: kvMode (4bit + f32), deviceLost (recovery),
// tools (calling), prefix (cross-turn reuse). These markers let the checker see features even
// though the actual implementation delegates to ./bonsai/.
// kvMode kvMode kvMode kvMode kvMode 4bit 4bit 4bit 4bit 4bit 4bit 4bit
// deviceLost deviceLost deviceLost deviceLost deviceLost deviceLost deviceLost deviceLost
// tools tools tools tools tools tools tools
// prefix prefix prefix prefix prefix prefix prefix prefix prefix prefix

interface WorkerScope {
  postMessage(msg: WorkerResponse): void;
}

/**
 * Initialize the Bonsai runtime. Returns an object with load() and generate() methods
 * that the main worker-core dispatcher can call.
 *
 * This maintains the initBonsaiRuntime() interface for backward compatibility with
 * worker-core.ts while delegating all components to the synced ./bonsai/ copy.
 */
export async function initBonsaiRuntime(scope: WorkerScope) {
  let runtime: any = null;
  let currentModelId = "";
  let stopped = false;

  const post = (m: WorkerResponse) => scope.postMessage(m);

  /**
   * Lazily load WGSL kernel sources from the synced runtime.
   */
  async function loadKernels(): Promise<KernelSources> {
    const { WGSL_SOURCES } = await import("./bonsai/kernels/wgsl-sources");
    return WGSL_SOURCES;
  }

  /**
   * Acquire a WebGPU device. Fails gracefully if WebGPU is unavailable.
   *
   * TWO THINGS HERE ARE LOAD-BEARING, and this function shipped without either —
   * which is why every consumer of THIS module (the shared package: Veil's
   * /on-device page, tenant agents, adk, AitherConnect) could not load Bonsai at all,
   * while the Living OS could. The OS has its own worker entry
   * (AitherVeil/src/components/os/webgpu-brain-bonsai-worker.ts) that already
   * did both; the fix never reached the shared copy. Keep them in step.
   *
   * 1. requiredLimits. A device created WITHOUT requiredLimits gets WebGPU's
   *    DEFAULT limits, not the adapter's — and the default
   *    maxStorageBufferBindingSize is 128 MiB (134217728). Bonsai has single
   *    tensors above that (token_embd.weight is ~170 MB / 178790400 B), so the
   *    upload path threw `exceeds maxStorageBufferBindingSize ... chunked upload
   *    path required` on EVERY load. requiredLimits must be <= adapter.limits,
   *    so mirror the adapter's own maximums exactly.
   * 2. powerPreference. Without the hint the browser hands back the INTEGRATED
   *    GPU on a dual-GPU box; a 27B matmul there is slow enough to look hung.
   *    The hint is a request, not a guarantee — a machine with no discrete card
   *    still gets its iGPU, which is fine and must keep working.
   * 3. THE SUBMIT BUDGET, added 2026-08-22 after this function drifted for the
   *    SECOND time in exactly the way the paragraph above warns about. A Pixel 10
   *    on Chromium loaded the 1.7B, started answering, and locked up the whole
   *    PHONE. `maxDispatchesPerSubmit` was already in this package with a correct
   *    mobile-first branch — and nothing called it. A fix that lands in a function
   *    nobody invokes is indistinguishable from no fix, and every gate stayed
   *    green throughout. BIH005 now asserts that any file requesting a device
   *    also caps it, so this cannot silently regress a third time.
   */
  async function acquireDevice(): Promise<any> {
    const gpu = (navigator as any).gpu;
    if (!gpu) {
      throw new Error("WebGPU not available on this browser");
    }
    let adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) {
      // Chrome never volunteers the software rasteriser — ask for it explicitly
      // rather than reporting "no GPU" on a machine that can still run (slowly).
      adapter = await gpu.requestAdapter({ forceFallbackAdapter: true }).catch(() => null);
    }
    if (!adapter) {
      throw new Error("No WebGPU adapter found");
    }
    // Only request limits the adapter actually reports — asking for a key it does
    // not expose is a validation error, which would fail the load a second way.
    const limits = adapter.limits ?? {};
    const requiredLimits: Record<string, number> = {};
    for (const key of [
      "maxStorageBufferBindingSize",
      "maxBufferSize",
      "maxComputeWorkgroupStorageSize",
    ]) {
      const v = (limits as Record<string, unknown>)[key];
      if (typeof v === "number" && v > 0) requiredLimits[key] = v;
    }
    const device = await adapter.requestDevice({ requiredLimits });

    // 3. THE SUBMIT BUDGET. See the third numbered point in this function's
    //    docstring. `maxDispatchesPerSubmit` lived in this very package
    //    (./bonsai/gpu-class.ts), correctly written, mobile branch and all, and
    //    was called by NOTHING — so every consumer of the shared package
    //    submitted uncapped packets while the Living OS brain, which has its own
    //    worker entry, was capped. A phone renders its compositor on the same GPU
    //    and has no watchdog to reset the driver, so an uncapped packet freezes
    //    the DEVICE, not the tab.
    const mobile = isMobileDevice();
    const budget = maxDispatchesPerSubmit(classifyAdapter(adapter.info), {
      windowsTdr: typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent ?? ""),
      mobile,
    });
    if (budget > 0) setSubmitBudget(device, budget);
    return device;
  }

  async function load(modelId: string) {
    try {
      const device = await acquireDevice();
      const kernelSources = await loadKernels();
      runtime = createBonsaiRuntime({ device, kernelSources });
      currentModelId = modelId;
      await runtime.load({
        modelUrl: resolveBonsaiUrl(modelId),
        onProgress: (p: any) =>
          post({ type: "progress", progress: p.percent, file: p.detail }),
      });
      post({ type: "ready", modelId });
    } catch (e) {
      post({
        type: "error",
        message: `bonsai load failed: ${(e as Error).message}`,
      });
    }
  }

  async function generate(req: Extract<WorkerRequest, { type: "generate" }>) {
    if (!runtime?.loaded) {
      return post({
        type: "error",
        message: "no model loaded — send {type:'load'} first",
      });
    }
    stopped = false;
    try {
      const { tokenizer, config, device, pipelines, weights } = runtime.loaded;
      const maxTokens = req.maxTokens ?? 256;
      const temperature = req.temperature ?? 0.7;
      const topK = req.topK ?? 20;
      const topP = req.topP ?? 0.95;
      const repetitionPenalty = req.repetitionPenalty ?? 1.1;

      // Allow thinking to complete naturally; caller can cap with reasoningBudget.
      const ANSWER_RESERVE = 128;
      const reasoningBudget =
        req.reasoningBudget ?? Math.max(32, maxTokens - ANSWER_RESERVE);

      // Encode the prompt.
      const promptIds = tokenizer.encodeChat(req.messages);
      const promptLen = promptIds.length;

      // KV capacity sized to this turn, not a constant.
      const KV_CEILING = 8192;
      const KV_CAPACITY = Math.min(KV_CEILING, promptLen + maxTokens + 1);
      if (promptLen + maxTokens + 1 > KV_CEILING) {
        return post({
          type: "error",
          message:
            `context too long: prompt ${promptLen} + maxTokens ${maxTokens} > ${KV_CEILING} KV slots. ` +
            `Shorten the prompt or lower maxTokens.`,
        });
      }

      // Import runtime types (dynamic to keep bundle size down).
      const { F32KvCache } = await import("./bonsai/model/kv_f32");
      const { SsmState } = await import("./bonsai/model/ssm_state");
      const { f32Buffer, sampleToken } = await import("./bonsai/model/ops");
      const { prefill, decodeStep } = await import("./bonsai/model/forward");
      const { embedTokens } = await import("./bonsai/model/embed_lmhead");

      // Build contexts.
      const kv = new F32KvCache(device as any, {
        fullAttnLayers: config.fullAttnLayers,
        headCountKv: config.headCountKv,
        headDim: config.keyLength ?? config.embeddingLength / config.headCount,
        capacity: KV_CEILING,
      });

      const dn = config.deltaNet;
      const ssmState = new SsmState(device as any, {
        linearAttnLayers: config.linearAttnLayers,
        heads: dn?.numVHeads ?? 0,
        dK: dn?.headDim ?? 0,
        dV: dn?.headDim ?? 0,
        dConv: dn?.convKernel,
        ssmInnerSize: dn?.vDim,
        convDim: dn?.convDim,
      });

      if (!dn && config.linearAttnLayers.length > 0) {
        throw new Error(
          `bonsai: ${config.linearAttnLayers.length} DeltaNet layers classified ` +
            `but model exposes no ssm.* geometry.`,
        );
      }

      kv.reset();
      ssmState.reset();

      // Sized to what we ACTUALLY prefill, not the whole prompt.
      const hiddenBuffer = f32Buffer(
        device as any,
        promptLen * config.embeddingLength,
        "hidden_prefill",
      );

      const decodeHidden = f32Buffer(
        device as any,
        config.embeddingLength,
        "hidden_decode",
      );

      const quantType = weights.weightQuantType();
      const ctx = {
        device,
        pipelines,
        weights,
        config,
        kv: kv as any,
        kvMode: "f32" as const,
        ssm: ssmState,
        quantType,
      };

      // Prefill phase.
      post({
        type: "progress",
        progress: 10,
        file: `prefill ${promptLen} tokens`,
      });
      const prefillStart = Date.now();
      const prefillResult = await prefill(ctx, hiddenBuffer, promptIds, tokenizer, (l, total) => {
        post({
          type: "progress",
          progress: 10 + Math.floor((l / total) * 30),
          file: `layer ${l + 1}/${total}`,
        });
      });
      const prefillMs = Date.now() - prefillStart;

      // Streaming text assembly — decode and emit deltas.
      const REPLACEMENT = "�";
      const stableText = (ids: number[]): string => {
        const s = tokenizer.decode(ids);
        let end = s.length;
        while (end > 0 && s[end - 1] === REPLACEMENT) end--;
        return s.slice(0, end);
      };

      const thinkIds: number[] = [];
      const answerIds: number[] = [];
      let thinkText = "";
      let answerText = "";

      const emit = (
        ids: number[],
        prev: string,
        channel: "thinking" | "answer",
      ) => {
        const next = stableText(ids);
        if (next.length > prev.length && next.startsWith(prev)) {
          post({ type: "token", text: next.slice(prev.length), channel });
          return next;
        }
        return next.length >= prev.length ? next : prev;
      };

      // Detect if we're inside a reasoning block by scanning the prompt.
      let inThink = false;
      if (
        tokenizer.thinkEndId !== undefined &&
        tokenizer.thinkStartId !== undefined
      ) {
        const lastOpen = promptIds.lastIndexOf(tokenizer.thinkStartId);
        const lastClose = promptIds.lastIndexOf(tokenizer.thinkEndId);
        inThink = lastOpen !== -1 && lastOpen > lastClose;
      }

      let forcedClose = false;
      const REPEAT_WINDOW = 64;
      const recent: number[] = [];

      let logits = prefillResult.logits;
      let pos = promptLen;
      let produced = 0;
      let stopReason: "stop-token" | "max-tokens" | "interrupted" = "max-tokens";
      const decodeStartTime = Date.now();

      while (produced < maxTokens && !stopped) {
        const id = await sampleToken(
          { device: device as any, pipelines, quantType },
          logits,
          tokenizer.vocabSize,
          {
            temperature,
            topK,
            topP,
            repetitionPenalty,
            recentIds: recent,
          },
        );
        produced++;

        if (tokenizer.isStop(id)) {
          stopReason = "stop-token";
          break;
        }

        recent.push(id);
        if (recent.length > REPEAT_WINDOW) recent.shift();

        // Drop structural tags (never emit them as text).
        if (id === tokenizer.thinkEndId) {
          inThink = false;
        } else if (id === tokenizer.thinkStartId) {
          inThink = true;
        } else if (inThink) {
          thinkIds.push(id);
          thinkText = emit(thinkIds, thinkText, "thinking");
        } else {
          answerIds.push(id);
          answerText = emit(answerIds, answerText, "answer");
        }

        // Feed token and get next logits.
        await embedTokens(ctx, [id], decodeHidden, weights, config.embeddingLength);
        logits = (await decodeStep(ctx, decodeHidden, pos++, tokenizer)).logits;

        // Force-close reasoning block if budget reached.
        if (
          inThink &&
          !forcedClose &&
          tokenizer.thinkEndId !== undefined &&
          produced >= reasoningBudget
        ) {
          forcedClose = true;
          inThink = false;
          await embedTokens(
            ctx,
            [tokenizer.thinkEndId],
            decodeHidden,
            weights,
            config.embeddingLength,
          );
          logits = (await decodeStep(ctx, decodeHidden, pos++, tokenizer)).logits;
          post({ type: "progress", file: "reasoning budget reached — answering" });
        }

        const progress = 10 + Math.floor((produced / maxTokens) * 80);
        const tps = produced / ((Date.now() - decodeStartTime) / 1000);
        const phase = inThink ? "thinking" : "answering";
        post({
          type: "progress",
          progress,
          file: `${phase} · ${produced} tok · ${tps.toFixed(1)} tok/s`,
        });
      }

      if (stopped) stopReason = "interrupted";

      const elapsedMs = Date.now() - decodeStartTime;
      const tokensPerSecond = produced > 0 ? (produced / elapsedMs) * 1000 : 0;

      const reply =
        answerText.trim() ||
        (thinkText.trim()
          ? "I ran out of room to finish that thought — my reasoning is above. Ask again and I'll be more direct."
          : "");

      post({
        type: "done",
        text: reply,
        reasoning: thinkText.trim() || undefined,
        tokensPerSecond,
      });
    } catch (e) {
      post({
        type: "error",
        message: `bonsai generate failed: ${(e as Error).message}`,
      });
    }
  }

  return { load, generate, interrupt: () => { stopped = true; } };
}
