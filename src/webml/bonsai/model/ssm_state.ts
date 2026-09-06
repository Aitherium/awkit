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
 *   - per-head DeltaNet state S (d_k x d_v) persisted across decode steps.
 *
 * Replaces a KV cache on the 48 linear layers. Memory is O(d_k·d_v·heads) — CONSTANT in
 * sequence length, the major memory win over full attention. Persisted between decode
 * steps and reset per generation.
 */

import type { GpuDeviceLike, GpuBufferLike } from "../kernels/gpu-min";
import { BufferUsage } from "../kernels/gpu-min";

export interface SsmStateConfig {
  linearAttnLayers: number[];
  heads: number;
  dK: number;
  dV: number;
  /** Convolution kernel size (d_conv) for the causal conv1d state. */
  dConv?: number;
  /** SSM inner size (per-layer state width) for conv state allocation. */
  ssmInnerSize?: number;
  /** Causal-conv channel count = qDim + kDim + vDim (10240 for Bonsai-27B).
   *  Distinct from ssmInnerSize, which is only the v width (6144). */
  convDim?: number;
}

export class SsmState {
  /** Bumped by reset(). Consumers that cache per-generation scratch OUTSIDE this
   *  class (e.g. block_deltanet's causal-conv history) compare against this to
   *  know their cache is stale. Without it, reset() silently missed that history
   *  and every generation after the first began with the PREVIOUS conversation's
   *  last conv_kernel-1 rows still in place, in all 48 DeltaNet layers. */
  private gen = 0;
  private states = new Map<number, GpuBufferLike>();
  private convStates = new Map<number, GpuBufferLike>();

  constructor(
    private device: GpuDeviceLike,
    private cfg: SsmStateConfig,
  ) {
    const stateElems = cfg.heads * cfg.dK * cfg.dV;
    const bytes = stateElems * 4; // f32 state
    for (const l of cfg.linearAttnLayers) {
      this.states.set(l, this.alloc(bytes, `ssm.S.${l}`));
    }

    // CONFIRMED bug fix: Allocate convolution state buffers for causal_conv1d.
    // Streaming decode needs to persist the conv sliding window across steps.
    // Ring buffer size: (d_conv-1) × (ssmInnerSize + 2×heads×dState) per sequence / per layer.
    // For now, allocate zero-initialized; the conv kernel will rotate on each decode step.
    if (cfg.dConv !== undefined && cfg.ssmInnerSize !== undefined) {
      const convHistoryElems = (cfg.dConv - 1) * (cfg.convDim ?? cfg.ssmInnerSize);
      const convBytes = convHistoryElems * 4; // f32 conv state ring buffer
      for (const l of cfg.linearAttnLayers) {
        this.convStates.set(l, this.alloc(convBytes, `ssm.conv_state.${l}`));
      }
    }
  }

  private alloc(bytes: number, label: string): GpuBufferLike {
    return this.device.createBuffer({
      size: Math.max(4, bytes),
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label,
    });
  }

  state(layerIndex: number): GpuBufferLike {
    const s = this.states.get(layerIndex);
    if (!s) throw new Error(`bonsai-ssm: layer ${layerIndex} has no DeltaNet state`);
    return s;
  }

  /** Convolution sliding-window state (for streaming decode). */
  convState(layerIndex: number): GpuBufferLike | undefined {
    return this.convStates.get(layerIndex);
  }

  /** Zero all state buffers at the start of a generation (prefill re-fills them). */
  /** Monotonic generation id — changes on every reset(). */
  get generation(): number {
    return this.gen;
  }

  reset(): void {
    this.gen++;
    const zero = new Float32Array(this.cfg.heads * this.cfg.dK * this.cfg.dV);
    for (const buf of this.states.values()) this.device.queue.writeBuffer(buf, 0, zero);
    // Also zero conv states if allocated
    if (this.cfg.dConv !== undefined && this.cfg.ssmInnerSize !== undefined) {
      // Width is the CONV channel count (qDim + kDim + vDim), not ssmInnerSize:
      // for Bonsai-27B that is 2048+2048+6144 = 10240, while ssmInnerSize is only
      // the v width (6144). Zeroing 6144 left 4096 channels per row untouched.
      const convWidth = this.cfg.convDim ?? this.cfg.ssmInnerSize;
      const convZero = new Float32Array((this.cfg.dConv - 1) * convWidth);
      for (const buf of this.convStates.values()) this.device.queue.writeBuffer(buf, 0, convZero);
    }
  }
}
