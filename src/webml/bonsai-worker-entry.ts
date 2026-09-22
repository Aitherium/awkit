/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC.
 *
 * Bundled worker entry for the shared Bonsai WebGPU brain (awkit webml) — the
 * SAME runtime aitherium.com, the Living OS and Awconnect use. Consumers (the
 * adk webui pack, any vanilla-JS surface) load the BUILT artifact
 * (`dist/webml/bonsai-worker.js`) and speak the worker protocol:
 *
 *     {type:'load', modelId}              -> progress* -> ready
 *     {type:'generate', messages, ...}    -> token* (channel thinking|answer|tool)
 *                                           -> done
 *     {type:'interrupt'}
 *
 * Model ids: bonsai-1.7b | bonsai-4b | bonsai-8b | bonsai-27b-text — or `auto`,
 * which lets the library pick for the device (suggestBonsaiModelId). Weights
 * always stream from the weights.aitherium.com mirror (Range + CORS + immutable
 * cache): one download per origin, cached forever, never a third-party host.
 *
 * All heavy logic lives in the shared worker core; this file only injects the
 * deps the runtime needs (WGSL sources, the GPU device, the model URL).
 */
import { runBonsaiWorker } from "./bonsai/worker/bonsai-worker-core";
import { WGSL_SOURCES } from "./bonsai/kernels/wgsl-sources";
import { resolveBonsaiUrl, suggestBonsaiModelId } from "./bonsai-models";
import { classifyAdapter, maxDispatchesPerSubmit } from "./bonsai/gpu-class";
import type { AdapterHint } from "./bonsai/gpu-class";
import { setSubmitBudget } from "./bonsai/kernels/dispatch";
import { isMobileDevice } from "./device-class";
import type { GpuDeviceLike } from "./bonsai/kernels/gpu-min";

runBonsaiWorker(self as unknown as Parameters<typeof runBonsaiWorker>[0], {
  loadKernels: async () => WGSL_SOURCES,
  acquireDevice: async () => {
    const nav = navigator as unknown as {
      gpu?: {
        requestAdapter(opts?: { powerPreference?: string; forceFallbackAdapter?: boolean }): Promise<{
          limits: Record<string, number>;
          // Chrome 128+ only; Safari exposes nothing. classifyAdapter() is written to
          // answer 'unknown' for both, which is exactly why the mobile branch below
          // sits ABOVE the class question rather than inside it.
          info?: AdapterHint;
          requestDevice(desc?: { requiredLimits?: Record<string, number> }): Promise<unknown>;
        } | null>;
      };
    };
    if (!nav.gpu) throw new Error("WebGPU unavailable (navigator.gpu missing)");
    // CRITICAL for speed: request the DISCRETE GPU first. Without
    // powerPreference the browser hands back the integrated GPU, where a naive
    // matmul is so slow it looks hung. The hint is a REQUEST, not a guarantee —
    // on a machine with no discrete card it returns the iGPU, which is fine.
    let adapter = await nav.gpu.requestAdapter({ powerPreference: "high-performance" });
    // No real GPU: ask for the software rasteriser explicitly — Chrome never
    // volunteers it. Owner directive: run on any device, even slow.
    let forcedFallback = false;
    if (!adapter) {
      adapter = await nav.gpu.requestAdapter({ forceFallbackAdapter: true }).catch(() => null);
      forcedFallback = adapter !== null;
    }
    if (!adapter) throw new Error("no WebGPU adapter (even the software fallback refused)");
    const lim = adapter.limits;
    const requiredLimits: Record<string, number> = {};
    // Only request limits the adapter actually reports (avoids validation errors).
    for (const key of [
      "maxStorageBufferBindingSize",
      "maxBufferSize",
      "maxComputeWorkgroupStorageSize",
    ] as const) {
      const v = lim[key];
      if (typeof v === "number" && v > 0) requiredLimits[key] = v;
    }
    const device = (await adapter.requestDevice({ requiredLimits })) as GpuDeviceLike;
    // `forcedFallback` is no longer discarded. AdapterHint.isFallbackAdapter is the
    // field classifyAdapter reads FIRST and the one it cannot derive: a software
    // rasteriser routinely reports an EMPTY vendor, which this file's classifier routes
    // down the DISCRETE fast path -- so SwiftShader was being treated as a 5090 (measured
    // 2026-07-31: 0.33 tok/s against 41 on real hardware, blamed on fleet contention for
    // an hour). We are the only code that knows we asked for the fallback, so we must say so.

    // THE SUBMIT BUDGET, and it has to be set HERE.
    //
    // `runBonsaiWorker` takes the device from `deps.acquireDevice` and never caps it —
    // the capping lives in the OTHER worker core (webml/bonsai-worker-core.ts), which
    // acquires its own device and is the lane this file does not use. So this entry was
    // a second, independent acquisition path submitting UNCAPPED packets while its
    // sibling was capped: the exact split that let the same defect recur, and the
    // sibling's own docstring already records it happening twice ("a fix that lands in
    // a function nobody invokes is indistinguishable from no fix").
    //
    // Why it matters more here than on a desktop: a phone renders its compositor on the
    // same GPU and has no TDR to reset the driver, so an uncapped packet freezes the
    // DEVICE, not the tab (measured 2026-08-22, Pixel 10 / Chromium — the 1.7B loaded,
    // started answering, and locked the whole phone).
    // Read isFallbackAdapter from ALL THREE places, the way the Living OS copy does.
    // The field lives on the ADAPTER in the shipped Chrome IDL and has been moving toward
    // adapter.info across revisions, and the browser can hand back a fallback we did not
    // ask for -- in which case `forcedFallback` alone is false. Getting `false` from the
    // wrong object is indistinguishable from a real GPU, which is the exact failure this
    // is here to catch.
    const a = adapter as unknown as { isFallbackAdapter?: boolean };
    const info = adapter.info ?? {};
    const hint: AdapterHint = {
      ...info,
      isFallbackAdapter:
        forcedFallback || a.isFallbackAdapter === true || info.isFallbackAdapter === true,
    };
    const budget = maxDispatchesPerSubmit(classifyAdapter(hint), {
      windowsTdr: typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent ?? ""),
      mobile: isMobileDevice(),
    });
    if (budget > 0) setSubmitBudget(device, budget);
    return device;
  },
  resolveModelUrl: (modelId) =>
    resolveBonsaiUrl(modelId === "auto" ? suggestBonsaiModelId() : modelId),
});
