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
 * Streams a 206 range body straight into GPUBuffers — never buffers the whole 3.8 GB.
 * A coalesced range (one HTTP GET spanning several adjacent tensors) is sliced per member
 * into its own storage buffer. Weights stay QUANTIZED on-GPU (no wholesale dequant).
 */

import type { GpuBufferLike, GpuDeviceLike } from "../kernels/gpu-min";
import { BufferUsage } from "../kernels/gpu-min";
import type { CoalescedRange, TensorEntry } from "./registry";
import type { RangeFetcher } from "../gguf/reader";

export interface UploadedTensor {
  entry: TensorEntry;
  buffer: GpuBufferLike;
}

/**
 * WebGPU's spec DEFAULT for maxStorageBufferBindingSize (128 MiB). A device gets this
 * when `requestDevice()` is called without `requiredLimits` — regardless of how capable
 * the adapter actually is. Exported so tests can assert the diagnostic below.
 */
export const WEBGPU_DEFAULT_MAX_STORAGE_BINDING = 134217728;

/** Respect device limits — split a tensor larger than maxStorageBufferBindingSize. */
export function needsChunking(device: GpuDeviceLike, nBytes: number): boolean {
  return nBytes > device.limits.maxStorageBufferBindingSize;
}

/**
 * Fetch a coalesced range once and upload each member tensor into its own GPUBuffer.
 * `fetchRange` returns the raw bytes for [absStart, absEnd).
 */
export async function uploadCoalescedRange(
  device: GpuDeviceLike,
  fetchRange: RangeFetcher,
  range: CoalescedRange,
): Promise<UploadedTensor[]> {
  const body = await fetchRange(range.absStart, range.absEnd - 1);
  const out: UploadedTensor[] = [];
  for (const m of range.members) {
    const localStart = m.absStart - range.absStart;
    const slice = body.subarray(localStart, localStart + m.nBytes);
    if (needsChunking(device, m.nBytes)) {
      // Kept IDENTICAL to awkit's copy of this file (webml/bonsai/tensors/upload.ts).
      // The two trees diverging is what produced the 2026-08-05 defect: the shared copy's
      // worker never got the requiredLimits fix this one had, so /on-device could not load
      // a model while the OS could. 134217728 is WebGPU's DEFAULT limit — seeing EXACTLY
      // that number means the device was created without requiredLimits, not that the GPU
      // is small. Say which, because the old message named a missing FEATURE and therefore
      // read as unbuilt work rather than a one-line device-creation bug.
      const cap = device.limits.maxStorageBufferBindingSize;
      const hint =
        cap === WEBGPU_DEFAULT_MAX_STORAGE_BINDING
          ? " — this is the WebGPU DEFAULT limit, so the device was almost certainly created " +
            "without requiredLimits; mirror adapter.limits in requestDevice()"
          : " — this adapter genuinely caps here; a chunked upload path is required";
      throw new Error(
        `bonsai-upload: tensor '${m.name}' (${m.nBytes} B) exceeds maxStorageBufferBindingSize ` +
          `(${cap})${hint}`,
      );
    }
    // QUANTIZATION-TYPE REPACK. The GGUF on-disk block format differs from GPU layout.
    // Q1_0: 18 bytes on disk -> 20 bytes/block GPU (5 u32, "20 reserved, 18 used") for alignment.
    // Q2_0: 34 bytes on disk -> 36 bytes/block GPU (9 u32, "36 reserved, 34 used") for alignment.
    // Uploading the raw stream left matmul reading misaligned data (garbage/NaN for block >= 1).
    // Repack each block into its GPU slot (zero-padded) so stored layout matches all kernels.
    const payload =
      m.type === GGML_Q1_0 ? repackQ1_0(slice) : m.type === GGML_Q2_0 ? repackQ2_0(slice) : padTo4(slice);
    const buffer = device.createBuffer({
      size: payload.byteLength,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label: m.name,
    });
    device.queue.writeBuffer(buffer, 0, payload);
    out.push({ entry: m, buffer });
  }
  return out;
}

const GGML_Q1_0 = 41;
const GGML_Q2_0 = 42;
const Q1_0_RAW_BYTES = 18;
const Q1_0_GPU_BYTES = 20; // 5 u32 per block (18 used, 2 pad) — matches the WGSL kernels.
const Q2_0_RAW_BYTES = 34;
const Q2_0_GPU_BYTES = 36; // 9 u32 per block (34 used, 2 pad) — matches the WGSL kernels.

/** Repack a raw Q1_0 byte stream (18 bytes/block) into the GPU layout (20 bytes/block). */
function repackQ1_0(slice: Uint8Array): Uint8Array {
  const nBlocks = Math.floor(slice.length / Q1_0_RAW_BYTES);
  const packed = new Uint8Array(nBlocks * Q1_0_GPU_BYTES); // zero-filled → pad bytes are 0
  for (let b = 0; b < nBlocks; b++) {
    packed.set(
      slice.subarray(b * Q1_0_RAW_BYTES, b * Q1_0_RAW_BYTES + Q1_0_RAW_BYTES),
      b * Q1_0_GPU_BYTES,
    );
  }
  return packed;
}

/** Repack a raw Q2_0 byte stream (34 bytes/block) into the GPU layout (36 bytes/block). */
function repackQ2_0(slice: Uint8Array): Uint8Array {
  const nBlocks = Math.floor(slice.length / Q2_0_RAW_BYTES);
  const packed = new Uint8Array(nBlocks * Q2_0_GPU_BYTES); // zero-filled → pad bytes are 0
  for (let b = 0; b < nBlocks; b++) {
    packed.set(
      slice.subarray(b * Q2_0_RAW_BYTES, b * Q2_0_RAW_BYTES + Q2_0_RAW_BYTES),
      b * Q2_0_GPU_BYTES,
    );
  }
  return packed;
}

/** WebGPU writeBuffer requires a 4-byte-multiple source; pad odd-length slices with zeros. */
function padTo4(slice: Uint8Array): Uint8Array {
  const n = alignUp(slice.length, 4);
  if (n === slice.length) return slice;
  const padded = new Uint8Array(n);
  padded.set(slice);
  return padded;
}

function alignUp(n: number, a: number): number {
  return n + ((a - (n % a)) % a);
}
