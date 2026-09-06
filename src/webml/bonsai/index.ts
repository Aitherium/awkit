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
 * Public surface of the clean-room Bonsai-27B WebGPU runtime.
 */

export { createBonsaiRuntime, BonsaiRuntime } from "./runtime";
export type {
  BonsaiRuntimeDeps,
  LoadProgress,
  LoadedModel,
  CreateRuntimeOptions,
} from "./runtime";

// GGUF loader
export { RangeReader, httpRangeFetcher } from "./gguf/reader";
export type { RangeFetcher } from "./gguf/reader";
export { parseGguf, GGUF_MAGIC } from "./gguf/parser";
export type { ParsedGguf } from "./gguf/parser";
export { GgufMetadata } from "./gguf/metadata";
export type { ResolvedArchConfig, ResolvedTokenizer } from "./gguf/metadata";
export * from "./gguf/types";

// Tensors
export { TensorRegistry } from "./tensors/registry";
export type { TensorEntry, CoalescedRange } from "./tensors/registry";

// Config
export {
  resolveQwen35Config,
  deriveLayerKinds,
  assertLayerSchedule,
  assertKernelDimBounds,
  resolveKernelDims,
  KERNEL_MAX_HEAD_DIM,
} from "./model/config";
export type { Qwen35Config, LayerKind, KernelDimBounds } from "./model/config";

// Kernels: numeric reference (the verification backbone) + pipeline plumbing
export * as ref from "./kernels/reference";
export { PipelineCache, KERNEL_NAMES } from "./kernels/pipelines";
export type { KernelName, KernelSources } from "./kernels/pipelines";

// Tokenizer
export { BonsaiTokenizer } from "./tokenizer/load";
export { renderChatML, DEFAULT_SYSTEM } from "./tokenizer/chat_template";
export type { ChatMessage } from "./tokenizer/chat_template";

// Provenance (asserted by CI + tests)
export { PROVENANCE_MARKER } from "./provenance";
