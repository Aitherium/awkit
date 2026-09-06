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
import { setSubmitBudget } from "./bonsai/kernels/dispatch";
import { resolveBonsaiUrl, suggestBonsaiModelId } from "./bonsai-models";
import { classifyAdapter, isMobileDevice, maxDispatchesPerSubmit, type AdapterHint } from "./device-class";
import type { GpuDeviceLike } from "./bonsai/kernels/gpu-min";

runBonsaiWorker(self as unknown as Parameters<typeof runBonsaiWorker>[0], {
  loadKernels: async () => WGSL_SOURCES,
  acquireDevice: async () => {
    const nav = navigator as unknown as {
      gpu?: {
        requestAdapter(opts?: { powerPreference?: string; forceFallbackAdapter?: boolean }): Promise<{
          limits: Record<string, number>;
          isFallbackAdapter?: boolean;
          info?: { vendor?: string; architecture?: string };
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
    // TDR cap (BIH007): the budget is computed HERE, where the device is acquired,
    // and APPLIED — a budget computed and dropped is the silent no-op this family
    // keeps re-finding. Uncapped packets are what froze a Pixel 10 to a reboot
    // (measured 2026-08-22): a phone's compositor shares the GPU and mobile browsers
    // have no TDR to reset the driver, so a burst of slow dispatches freezes the
    // DEVICE, not the tab. The phone gate refuses the whole lane now, but the cap
    // stays load-bearing for Windows TDR contention (an RTX 5090 lost its device
    // mid-prefill under external load, measured 2026-08-07).
    const hint: AdapterHint = forcedFallback
      ? { isFallbackAdapter: true }
      : (adapter as unknown as AdapterHint);
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
