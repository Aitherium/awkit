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
 * Minimal structural WebGPU types. The AitherVeil app does not depend on @webgpu/types,
 * so we declare exactly the surface this runtime uses. At runtime these are the real
 * browser GPU objects; the interfaces exist only to keep tsc honest without pulling in a
 * types package the app doesn't ship.
 */

export interface GpuBufferLike {
  size: number;
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

export interface GpuBindGroupLike {
  readonly __brand?: "bindgroup";
}
export interface GpuPipelineLike {
  getBindGroupLayout(index: number): unknown;
}
export interface GpuCommandEncoderLike {
  beginComputePass(): {
    setPipeline(p: GpuPipelineLike): void;
    setBindGroup(index: number, g: GpuBindGroupLike): void;
    dispatchWorkgroups(x: number, y?: number, z?: number): void;
    end(): void;
  };
  copyBufferToBuffer(src: GpuBufferLike, so: number, dst: GpuBufferLike, doff: number, size: number): void;
  finish(): unknown;
}
export interface GpuQueueLike {
  writeBuffer(buffer: GpuBufferLike, offset: number, data: ArrayBufferView | ArrayBufferLike): void;
  submit(buffers: unknown[]): void;
}
export interface GpuSupportedLimitsLike {
  maxStorageBufferBindingSize: number;
  maxBufferSize: number;
  maxComputeWorkgroupsPerDimension: number;
}
/**
 * `GPUDevice.lost` — resolves (never rejects) when the device dies. Reason is `"destroyed"`
 * for our own `destroy()` call and `"unknown"` for everything else, which INCLUDES a Windows
 * TDR display-driver reset. See gpu-class.ts for why that matters here: a layer submit that
 * overruns the 2 s TDR deadline resets the driver, the visitor's screen flashes, and this
 * promise is the only in-page signal that it happened.
 */
export interface GpuDeviceLostInfo {
  reason: string;
  message: string;
}

export interface GpuDeviceLike {
  readonly limits: GpuSupportedLimitsLike;
  createShaderModule(desc: { code: string; label?: string }): unknown;
  createComputePipeline(desc: unknown): GpuPipelineLike;
  createBuffer(desc: { size: number; usage: number; label?: string; mappedAtCreation?: boolean }): GpuBufferLike;
  createBindGroup(desc: unknown): GpuBindGroupLike;
  createCommandEncoder(): GpuCommandEncoderLike;
  readonly queue: GpuQueueLike;
  /**
   * OPTIONAL on this interface only because the test doubles and the selftest harness
   * predate it — a real `GPUDevice` always has it. Production code must treat an absent
   * `lost` as a device it cannot supervise, never as a device that cannot be lost.
   */
  readonly lost?: Promise<GpuDeviceLostInfo>;
  /** `GPUDevice.addEventListener('uncapturederror', …)` — how OOM and validation surface. */
  addEventListener?(type: 'uncapturederror', cb: (ev: { error?: { message?: string } }) => void): void;
  destroy?(): void;
}

/** GPUBufferUsage flag values (stable across the spec). */
export const BufferUsage = {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  STORAGE: 0x0080,
  UNIFORM: 0x0040,
} as const;

export const MapMode = { READ: 0x0001, WRITE: 0x0002 } as const;
