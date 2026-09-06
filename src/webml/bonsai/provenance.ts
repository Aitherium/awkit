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
 *   - Q1_0 block layout .............. ggml/src/ggml-common.h  (QK1_0=128, block_q1_0)
 *   - Q1_0 dequant/quant ............. ggml/src/ggml-quants.c:40-71, 419-437
 *   - q1_0·q8_0 dot .................. ggml/src/ggml-cpu/quants.c:127-175
 *   - arch qwen35 / DeltaNet ......... src/llama-arch.cpp:42,431-439; src/llama-model.cpp
 * GGUF container: public spec ggml-org/ggml docs/gguf.md (format v3).
 */

/**
 * The provenance banner every generated file in this runtime must carry.
 * Re-exported so `scripts/check-provenance.mjs` and unit tests can assert the
 * mandatory marker line ("Numerics ported from owner-owned fork") is present.
 *
 * This is the SINGLE authoritative statement of where these numerics came from:
 * the owner-owned PrismML llama.cpp fork and the public GGUF spec — nothing else.
 * The rejected, unlicensed third-party WebGPU-kernel HF Space is referenced nowhere in
 * this tree (its slug is deliberately not written out; the CI gate scans for it).
 */
export const PROVENANCE_MARKER = "Numerics ported from owner-owned fork";

export const PROVENANCE_HEADER_TS = `/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 * ${PROVENANCE_MARKER}: github.com/PrismML-Eng/llama.cpp @ branch "prism"
 * GGUF container: public spec ggml-org/ggml docs/gguf.md (format v3).
 * NO third-party WebGPU kernel source was consulted (HF Spaces bonsai-* excluded).
 */`;

export const PROVENANCE_HEADER_WGSL = `// SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
// © 2026 Aitherium, LLC. Original work.
// ${PROVENANCE_MARKER}: github.com/PrismML-Eng/llama.cpp @ branch "prism"
// NO third-party WebGPU kernel source was consulted (HF Spaces bonsai-* excluded).`;
