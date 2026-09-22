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
 *   @ 5d80cff0b8cb9f2bf823cfc4e71e3abb97f290d6
 *   - sign tensors, one per INPUT width . src/llama-model.cpp:2034-2072 (F32, uploaded once)
 *   - rotated-weight lookup by NAME ..... src/llama-model.cpp:1951-1953, :2090 (hadamard_rotations)
 *   - gdn_v_grouped perm dims ........... src/llama-model.cpp:2080-2090 (only ".ssm_out." weights)
 *   - inverse table (token_embd) ........ src/llama-model.cpp:1322-1327; llama-graph.cpp:2384-2395
 *
 * The GPU-resident half of the Bonsai 2 Hadamard contract. `gguf/metadata.ts` parses and
 * validates `prism.hadamard.*` into a HadamardSpec; this module turns that spec into what the
 * ops need at dispatch time — the ±1 sign vectors as f32 storage buffers (one per input width,
 * created ONCE at load, never per token) — and answers "is this weight rotated?" by NAME,
 * because the fork keys its rotation table by tensor, never by type. A PTQ1_0 tensor that is
 * NOT in weight_names (token_embd) must not be transformed on its input; a file that folded
 * only some projections would be honoured exactly as listed.
 *
 * When the spec is absent (every Bonsai 1 file) there is no HadamardCtx at all, and every op
 * that consults it returns its input untouched — the Bonsai 1 forward pass is byte-identical.
 */

import type { GpuBufferLike, GpuDeviceLike } from "../kernels/gpu-min";
import { uploadBytes } from "../kernels/dispatch";
import type { HadamardSpec } from "../gguf/metadata";

/**
 * prism.hadamard.block_size the fwht_1024.wgsl kernel is compiled for (N = 1024, one
 * workgroup per block). A file declaring any other block size is REFUSED at load: the CPU
 * reference handles any power of two, but running the GPU kernel on a 512- or 2048-block
 * fold would be a well-formed, silently wrong transform.
 */
export const FWHT_BLOCK = 1024;

export interface HadamardCtx {
  spec: HadamardSpec;
  /**
   * ±1.0 f32 sign vector per INPUT width (fork `hadamard_sign_data[width]`, uploaded as an F32
   * tensor of length W, llama-model.cpp:2041-2072). Feature i of an activation of width W is
   * multiplied by element i. In identity sign mode this starts empty and fills lazily with
   * all-ones vectors so the fwht kernel always has a valid `signs` binding.
   */
  signBuffers: Map<number, GpuBufferLike>;
}

/** Sign vector as the fwht_1024 kernel binds it: f32 ±1.0, one per feature of the width. */
export function signVectorF32(spec: HadamardSpec, width: number): Float32Array {
  const out = new Float32Array(width);
  if (spec.signMode === "identity") {
    out.fill(1);
    return out;
  }
  const s = spec.signsByWidth.get(width);
  if (!s) throw new Error(`bonsai-hadamard: prism.hadamard has no sign vector for input width ${width}`);
  if (s.length !== width) {
    throw new Error(`bonsai-hadamard: sign vector for width ${width} has length ${s.length}`);
  }
  for (let i = 0; i < width; i++) out[i] = s[i];
  return out;
}

/**
 * Upload the sign vectors once. Explicit mode uploads every width the file declares
 * (5120 / 6144 / 17408 for Bonsai 2); identity mode uploads nothing yet.
 */
export function createHadamardCtx(device: GpuDeviceLike, spec: HadamardSpec): HadamardCtx {
  if (spec.blockSize !== FWHT_BLOCK) {
    throw new Error(
      `bonsai-hadamard: prism.hadamard.block_size ${spec.blockSize} is not supported — the ` +
        `WebGPU fwht kernel is compiled for ${FWHT_BLOCK}`,
    );
  }
  const signBuffers = new Map<number, GpuBufferLike>();
  for (const width of spec.signWidths) {
    signBuffers.set(width, uploadBytes(device, signVectorF32(spec, width)));
  }
  return { spec, signBuffers };
}

/** The sign buffer for an input width. Explicit mode THROWS on an undeclared width (fork rule). */
export function signBufferFor(h: HadamardCtx, device: GpuDeviceLike, width: number): GpuBufferLike {
  const hit = h.signBuffers.get(width);
  if (hit) return hit;
  if (h.spec.signMode !== "identity") {
    throw new Error(
      `bonsai-hadamard: no sign vector for input width ${width} ` +
        `(declared: ${[...h.signBuffers.keys()].join(", ") || "none"})`,
    );
  }
  const buf = uploadBytes(device, signVectorF32(h.spec, width));
  h.signBuffers.set(width, buf);
  return buf;
}

/** Is this weight's INPUT Hadamard-folded (fork: name ∈ prism.hadamard.weight_names)? */
export function isRotatedWeight(h: HadamardCtx | undefined | null, name: string): boolean {
  return !!h && h.spec.weightNames.has(name);
}

/** Does this table store rotated rows that need the inverse after lookup (token_embd)? */
export function isInverseTable(h: HadamardCtx | undefined | null, name: string): boolean {
  return !!h && h.spec.inverseWeightNames.has(name);
}

/**
 * Does the activation feeding this weight need the gdn_v_grouped permutation first?
 * The fork sets perm dims only for weight names containing ".ssm_out." and only when the
 * flag is set (llama-model.cpp:2080-2090).
 */
export function needsGdnVGroupedPermute(h: HadamardCtx | undefined | null, name: string): boolean {
  return !!h && h.spec.gdnVGrouped && isRotatedWeight(h, name) && name.includes(".ssm_out.");
}

export function destroyHadamardCtx(h: HadamardCtx): void {
  for (const b of h.signBuffers.values()) {
    try { b.destroy(); } catch { /* lost device — ignore */ }
  }
  h.signBuffers.clear();
}
