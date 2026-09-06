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
 * Compiles + caches GPUComputePipelines from the WGSL sources. The .wgsl files are
 * imported as raw strings by the bundler (Next.js: `?raw` / asset/source); the KERNEL_SRC
 * registry keeps the import site in one place so the worker can inject them.
 */

import type { GpuDeviceLike, GpuPipelineLike } from "./gpu-min";

export type KernelName =
  | "quantize_q8_0"
  | "q1_0_dequant"
  | "q1_0_q8_0_matmul"
  | "q2_0_dequant"
  | "q2_0_q8_0_matmul"
  | "kv_quant_4bit"
  | "rmsnorm"
  | "rope_imrope"
  | "softmax_attn"
  | "softmax_attn_batched"
  | "causal_conv1d"
  | "deltanet"
  | "deltanet_gate"
  | "deltanet_seq"
  | "swiglu"
  | "sampling"
  | "logit_topk"
  | "vae_ops"
  | "elementwise"
  | "elementwise_inplace"
  | "image_ops";

export const KERNEL_NAMES: KernelName[] = [
  "quantize_q8_0",
  "q1_0_dequant",
  "q1_0_q8_0_matmul",
  "q2_0_dequant",
  "q2_0_q8_0_matmul",
  "kv_quant_4bit",
  "rmsnorm",
  "rope_imrope",
  "softmax_attn",
  "softmax_attn_batched",
  "causal_conv1d",
  "deltanet",
  "deltanet_gate",
  "deltanet_seq",
  "swiglu",
  "sampling",
  "logit_topk",
  "vae_ops",
  "elementwise",
  "elementwise_inplace",
  "image_ops",
];

/** Map of kernel -> WGSL source, injected by the consumer (which owns the bundler import). */
export type KernelSources = Record<KernelName, string>;

export class PipelineCache {
  private cache = new Map<string, GpuPipelineLike>();

  constructor(
    private device: GpuDeviceLike,
    private sources: KernelSources,
  ) {}

  /**
   * `entry` names a non-default entry point in the same WGSL module.
   *
   * Almost every kernel here is one module with one `main`, and that stays the default. The
   * exception is a kernel whose passes MUST share a binding layout and a set of constants —
   * logit_topk's histogram and gather read the same logits buffer and the same uniform, and
   * splitting them into two files would duplicate the struct and the bin arithmetic, which
   * is precisely the kind of copy that drifts and produces a silently wrong threshold.
   *
   * The cache key includes the entry point; keying on the module name alone would hand the
   * gather pipeline back for the histogram pass, which is a wrong-kernel bug that still
   * dispatches successfully.
   */
  get(name: KernelName, entry = "main"): GpuPipelineLike {
    const key = entry === "main" ? name : `${name}:${entry}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const code = this.sources[name];
    if (!code) throw new Error(`bonsai-pipelines: no WGSL source registered for '${name}'`);
    const module = this.device.createShaderModule({ code, label: name });
    const pipeline = this.device.createComputePipeline({
      label: key,
      layout: "auto",
      compute: { module, entryPoint: entry },
    });
    this.cache.set(key, pipeline);
    return pipeline;
  }

  /** Warm the whole set at load so first-token latency doesn't eat compile time. */
  warmAll(): void {
    for (const n of KERNEL_NAMES) {
      if (!this.sources[n]) continue;
      // logit_topk has no `main` — it is two named passes. Warming it with the default entry
      // point throws at compile time and would take the whole warm-up down with it.
      if (n === "logit_topk") { this.get(n, "hist_main"); this.get(n, "gather_main"); continue; }
      // vae_ops likewise has no `main` — three named passes for the decoder. Warming it
      // under the default entry point would throw and take the whole warm-up with it.
      if (n === "vae_ops") {
        this.get(n, "conv2d_main"); this.get(n, "groupnorm_main"); this.get(n, "upsample_nearest_main");
        continue;
      }
      this.get(n);
    }
  }
}
