// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 * Original Aitherium WebGPU implementation — WGSL kernels ported from the PrismML
 * llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
 * NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
 * GGUF container: public spec ggml-org/ggml docs/gguf.md (format v3).
 *
 * WASP GPU SINK — a bounded upload. The buffer is allocated once; the BYTES arrive in
 * pieces and never all exist at the same time.
 *
 * WHAT THIS REPLACES, AND WHY IT WAS THE WHOLE PROBLEM. `uploadCoalescedRange` fetched a
 * COALESCED range — one HTTP GET spanning several adjacent tensors — into one ArrayBuffer,
 * then sliced each member out and repacked it into a second. Measured 2026-07-28 on the
 * 27B (`selftest/probe-ranges.mts`): the globals coalesce into a SINGLE 341 MB range, and
 * `token_embd.weight` alone is 171 MB, so the repack made peak ≈ 360 MB for one tensor.
 * On a desktop that is a shrug. On a phone the browser aborts the read — and the abort
 * surfaces inside `reader.read()`, i.e. as `Failed to fetch`, which reads as a NETWORK
 * problem. Weeks were spent on the wrong subsystem because of where the error landed.
 *
 * THE SHAPE. Per member tensor:
 *   1. `createBuffer(gpuBytes)` ONCE. The allocation is the thing the device has to
 *      survive, and it is made before any bytes are fetched so a refusal is free.
 *   2. Loop sub-ranges of `waspChunkBytes(rawBlock)` raw bytes — a whole number of quant
 *      blocks, always, so a chunk never splits a block.
 *   3. Repack each chunk on its own (18 -> 20, 34 -> 36, or pad to 4).
 *   4. `queue.writeBuffer(buf, (rawOff / rawBlock) * gpuBlock, packed)` — the destination
 *      offset is derived from the BLOCK INDEX, not from a running byte counter, because a
 *      running counter drifts the moment a chunk is short and every block after it lands
 *      one slot out. That does not crash; it produces fluent garbage.
 *   5. At most TWO chunks in flight (fetch n+1 while repacking n), and on mobile
 *      `await onSubmittedWorkDone()` every 4 chunks so staging memory cannot pile up.
 *
 * Peak JS heap per tensor is then ~2 chunks + 1 repacked chunk ≈ 100 MB, independent of
 * how big the tensor is.
 *
 * 🚨 THE REFUSAL MOVED. `needsChunking()` threw from INSIDE the upload, i.e. after the
 * GET had already been paid for. `refuseBeforeFirstByte()` is called by the caller with
 * the manifest and the ADAPTER's limits, before anything is fetched. Keeping a
 * device-limit check here as well is not redundancy: the manifest is optional, and a
 * device with no manifest still must not be handed a buffer it cannot bind.
 */

import type { GpuBufferLike, GpuDeviceLike } from "../kernels/gpu-min";
import { BufferUsage } from "../kernels/gpu-min";
import type { CoalescedRange, TensorEntry } from "../tensors/registry";
import type { RangeFetcher } from "./source";
import { waspChunkBytes } from "./index";
import { type WaspManifest, waspRefusal, WASP_NO_MANIFEST_LOG } from "./manifest";

export interface UploadedTensor {
  entry: TensorEntry;
  buffer: GpuBufferLike;
}

/**
 * WebGPU's spec DEFAULT for maxStorageBufferBindingSize (128 MiB). A device gets this
 * when `requestDevice()` is called without `requiredLimits` — regardless of how capable
 * the adapter actually is. Exported so tests and the diagnostic below can assert it.
 */
export const WEBGPU_DEFAULT_MAX_STORAGE_BINDING = 134217728;

const GGML_BF16 = 30;
const GGML_Q1_0 = 41;
const GGML_Q2_0 = 42;
const GGML_PQ2_0 = 142; // Bonsai 2 — byte-identical to the 128/34 Q2_0 layout above (fork ggml-common.h:199-207)
// Exported so the layout test drives the SHIPPED repack path instead of mirroring it
// (check_test_only_modules MIRROR rule, 2026-09-21).
export const GGML_PTQ1_0 = 143; // Bonsai 2 ternary, 28 B / 128 (fork ggml-common.h:209-220)
const Q1_0_RAW_BYTES = 18;
const Q1_0_GPU_BYTES = 20; // 5 u32 per block (18 used, 2 pad) — matches the WGSL kernels.
const Q2_0_RAW_BYTES = 34;
const Q2_0_GPU_BYTES = 36; // 9 u32 per block (34 used, 2 pad) — matches the WGSL kernels.
// 28 B is already a whole number of u32 (7 words), so PTQ1_0 uploads UNCHANGED — the
// ptq1_0 WGSL kernels read WORDS_PER_PTQ1 = 7 with the f16 scale in word 6's high half.
const PTQ1_0_RAW_BYTES = 28;
const PTQ1_0_GPU_BYTES = 28;
// BF16 is widened to f32 on upload (bits << 16, exact: bf16 IS the top half of an f32), so
// the Bonsai 2 ssm_alpha/ssm_beta tensors bind as array<f32> for the f32 matmul. The LLM
// kernels have no bf16 reader and nothing here should grow one for two 5120x48 tensors.
const BF16_RAW_BYTES = 2;
const BF16_GPU_BYTES = 4;

/** On-disk and on-GPU block sizes for a GGML type. Floats are "one byte per byte". */
export function blockGeometry(type: number): { rawBlock: number; gpuBlock: number } {
  if (type === GGML_Q1_0) return { rawBlock: Q1_0_RAW_BYTES, gpuBlock: Q1_0_GPU_BYTES };
  if (type === GGML_Q2_0 || type === GGML_PQ2_0) return { rawBlock: Q2_0_RAW_BYTES, gpuBlock: Q2_0_GPU_BYTES };
  if (type === GGML_PTQ1_0) return { rawBlock: PTQ1_0_RAW_BYTES, gpuBlock: PTQ1_0_GPU_BYTES };
  if (type === GGML_BF16) return { rawBlock: BF16_RAW_BYTES, gpuBlock: BF16_GPU_BYTES };
  return { rawBlock: 1, gpuBlock: 1 };
}

/** The GPU footprint of a tensor AFTER the alignment repack. */
export function gpuBytesFor(type: number, rawBytes: number): number {
  const { rawBlock, gpuBlock } = blockGeometry(type);
  if (rawBlock === 1) return alignUp(rawBytes, 4);
  return Math.floor(rawBytes / rawBlock) * gpuBlock;
}

/** Respect device limits — a tensor larger than the binding limit cannot be uploaded. */
export function needsChunking(device: GpuDeviceLike, nBytes: number): boolean {
  return nBytes > device.limits.maxStorageBufferBindingSize;
}

/**
 * Limits read from the ADAPTER, not the device.
 *
 * A `GPUDevice` reports whatever limits it was CREATED with, so asking the device what the
 * hardware can do returns the spec default (128 MiB) on a machine that could do far more,
 * and — worse — reports a number the caller itself chose as if it were a fact. The adapter
 * is the only honest source, and nothing in this runtime read it before this module:
 * `gpu-min.ts` declares the fields and `real-model-harness-entry.ts` only logs them.
 */
export interface AdapterLimitsLike {
  maxBufferSize?: number;
  maxStorageBufferBindingSize?: number;
}

/** The largest single buffer this adapter will bind. `min` of the two, never one of them. */
export function adapterBufferCeiling(limits?: AdapterLimitsLike | null): number {
  const a = limits?.maxBufferSize;
  const b = limits?.maxStorageBufferBindingSize;
  const vals = [a, b].filter((n): n is number => typeof n === "number" && n > 0);
  // No adapter info at all (Safari exposes none) — fall back to the SPEC DEFAULT rather
  // than Infinity. Assuming "unlimited" on the browsers that report nothing is exactly the
  // BIH003 shape: the refusal has to live where the absence is handled.
  if (vals.length === 0) return WEBGPU_DEFAULT_MAX_STORAGE_BINDING;
  return Math.min(...vals);
}

export interface RefusalInput {
  manifest: WaspManifest | null;
  adapterLimits?: AdapterLimitsLike | null;
  log?: (msg: string) => void;
}

/**
 * THE PRE-FLIGHT. Returns a reason to refuse, or null to proceed — and it costs one small
 * request (the manifest), never a range GET of the weights.
 *
 * With no manifest it returns null AND SAYS SO. That is the honest answer: without the
 * side-car nobody knows the largest tensor until the header is parsed, so the load
 * proceeds on the old terms. It must never be silent — a loader that quietly stops
 * bounding memory is indistinguishable from one that never did.
 */
export function refuseBeforeFirstByte(input: RefusalInput): string | null {
  const log = input.log ?? ((m: string) => console.info(m));
  if (!input.manifest) {
    log(WASP_NO_MANIFEST_LOG);
    return null;
  }
  return waspRefusal(input.manifest, adapterBufferCeiling(input.adapterLimits));
}

export interface UploadStreamingOptions {
  /** True on a phone/tablet: drain the queue periodically so staging cannot pile up. */
  mobile?: boolean;
  /** Await the queue every N chunks on mobile. */
  drainEveryChunks?: number;
  /** `device.queue.onSubmittedWorkDone()` — injectable for tests. */
  onSubmittedWorkDone?: () => Promise<void>;
  /** Override the chunk ceiling (tests). Defaults to the shared WASP grid. */
  chunkTargetBytes?: number;
  /** Progress, in RAW bytes. */
  onProgress?: (bytes: number) => void;
}

const DEFAULT_DRAIN_EVERY = 4;

/**
 * Upload the members of a coalesced range, one bounded chunk at a time.
 *
 * The signature matches `uploadCoalescedRange`'s on purpose — same caller, same range
 * objects — so the call sites change by one identifier and the diff is reviewable. What
 * changed is that `fetchRange` is now called MANY times with small spans instead of once
 * with the whole range.
 */
export async function uploadStreaming(
  device: GpuDeviceLike,
  fetchRange: RangeFetcher,
  range: CoalescedRange,
  opts: UploadStreamingOptions = {},
): Promise<UploadedTensor[]> {
  const out: UploadedTensor[] = [];
  for (const m of range.members) {
    out.push({ entry: m, buffer: await uploadTensor(device, fetchRange, m, opts) });
  }
  return out;
}

/** One tensor: allocate once, stream into it, never hold it whole. */
export async function uploadTensor(
  device: GpuDeviceLike,
  fetchRange: RangeFetcher,
  m: TensorEntry,
  opts: UploadStreamingOptions = {},
): Promise<GpuBufferLike> {
  const { rawBlock, gpuBlock } = blockGeometry(m.type);
  const gpuSize = gpuBytesFor(m.type, m.nBytes);

  if (needsChunking(device, gpuSize)) {
    // Kept IDENTICAL in wording to the pre-streaming version, because the DIAGNOSIS is
    // what mattered: 134217728 is WebGPU's DEFAULT limit, so seeing exactly that number
    // means the device was created without requiredLimits, not that the GPU is small.
    // Streaming the UPLOAD does not make a too-large BINDING bindable — the buffer still
    // has to exist in one piece — so this refusal stays, and it is the reason
    // `refuseBeforeFirstByte` exists to catch the same case before the bytes are paid for.
    const cap = device.limits.maxStorageBufferBindingSize;
    const hint =
      cap === WEBGPU_DEFAULT_MAX_STORAGE_BINDING
        ? " — this is the WebGPU DEFAULT limit, so the device was almost certainly created "
          + "without requiredLimits; mirror adapter.limits in requestDevice()"
        : " — this adapter genuinely caps here; this model cannot run on this device";
    throw new Error(
      `bonsai-upload: tensor '${m.name}' (${gpuSize} B on GPU) exceeds `
      + `maxStorageBufferBindingSize (${cap})${hint}`,
    );
  }

  const buffer = device.createBuffer({
    size: gpuSize,
    usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
    label: m.name,
  });

  const chunkBytes = waspChunkBytes(rawBlock, opts.chunkTargetBytes);
  const drainEvery = opts.drainEveryChunks ?? DEFAULT_DRAIN_EVERY;
  const drain = opts.onSubmittedWorkDone;

  // TWO IN FLIGHT, NOT MORE. One is a stall (the link idles through every repack); three
  // is three chunks resident, which is the peak this whole module exists to bound. The
  // prefetch is started before the current chunk is repacked and awaited at the top of
  // the next iteration.
  let inflight: Promise<Uint8Array> | null = null;
  const fetchAt = (rawOff: number): Promise<Uint8Array> => {
    const len = Math.min(chunkBytes, m.nBytes - rawOff);
    const start = m.absStart + rawOff;
    return fetchRange(start, start + len - 1);
  };

  let chunkIndex = 0;
  for (let rawOff = 0; rawOff < m.nBytes; rawOff += chunkBytes) {
    const raw = inflight ? await inflight : await fetchAt(rawOff);
    const next = rawOff + chunkBytes;
    inflight = next < m.nBytes ? fetchAt(next) : null;

    const packed = repackChunk(m.type, raw);
    // BLOCK INDEX, not a running byte counter. A counter drifts the instant a chunk comes
    // back short and every block after it lands one slot out — which does not crash and
    // does not produce noise; it produces fluent, plausible text.
    const dstOffset = rawBlock === 1
      ? rawOff
      : Math.floor(rawOff / rawBlock) * gpuBlock;
    device.queue.writeBuffer(buffer, dstOffset, packed);
    opts.onProgress?.(raw.byteLength);

    chunkIndex += 1;
    if (opts.mobile && drain && chunkIndex % drainEvery === 0) {
      // On a phone the COMPOSITOR shares this GPU and there is no watchdog to reset the
      // driver. Without a periodic drain the queue depth grows with every chunk and the
      // next frame waits behind all of it — the device stops responding, and the tab is
      // not what freezes.
      await drain();
    }
  }
  // A prefetch that was started and never consumed (the loop exited on the last chunk)
  // must still be awaited, or its rejection surfaces as an unhandled promise.
  if (inflight) await inflight.catch(() => undefined);
  return buffer;
}

/** Repack one chunk from the on-disk layout into the GPU layout. */
export function repackChunk(type: number, slice: Uint8Array): Uint8Array {
  if (type === GGML_Q1_0) return repackBlocks(slice, Q1_0_RAW_BYTES, Q1_0_GPU_BYTES);
  if (type === GGML_Q2_0 || type === GGML_PQ2_0) return repackBlocks(slice, Q2_0_RAW_BYTES, Q2_0_GPU_BYTES);
  // PTQ1_0: identity — but only a whole number of 28-byte blocks, like every other quant.
  if (type === GGML_PTQ1_0) return slice.subarray(0, Math.floor(slice.length / PTQ1_0_RAW_BYTES) * PTQ1_0_RAW_BYTES);
  if (type === GGML_BF16) return widenBf16ToF32(slice);
  return padTo4(slice);
}

/**
 * BF16 -> F32 widening: each little-endian u16 becomes the HIGH half of a little-endian
 * f32 word (fork ggml-impl.h ggml_compute_bf16_to_fp32: `bits << 16`). Exact, no rounding.
 */
function widenBf16ToF32(slice: Uint8Array): Uint8Array {
  const n = Math.floor(slice.length / BF16_RAW_BYTES);
  const out = new Uint8Array(n * BF16_GPU_BYTES); // low halves stay 0
  for (let i = 0; i < n; i++) {
    out[i * 4 + 2] = slice[i * 2];
    out[i * 4 + 3] = slice[i * 2 + 1];
  }
  return out;
}

/**
 * QUANTIZATION-TYPE REPACK. The GGUF on-disk block format differs from the GPU layout.
 * Q1_0: 18 bytes on disk -> 20 bytes/block GPU (5 u32, "20 reserved, 18 used") for
 * alignment. Q2_0: 34 -> 36 (9 u32). Uploading the raw stream left matmul reading
 * misaligned data (garbage/NaN for block >= 1).
 */
function repackBlocks(slice: Uint8Array, rawBlock: number, gpuBlock: number): Uint8Array {
  const nBlocks = Math.floor(slice.length / rawBlock);
  const packed = new Uint8Array(nBlocks * gpuBlock); // zero-filled → pad bytes are 0
  for (let b = 0; b < nBlocks; b++) {
    packed.set(slice.subarray(b * rawBlock, b * rawBlock + rawBlock), b * gpuBlock);
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
