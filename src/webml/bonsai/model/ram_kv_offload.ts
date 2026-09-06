// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 * Original Aitherium WebGPU implementation — WGSL kernels ported from the PrismML
 * llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
 * NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
 *
 * RAM-KV offload: streaming large KV caches from system RAM to GPU staging buffers.
 * For full-attention layers, the KV cache grows with sequence length. On-GPU VRAM is
 * limited (4GB typical in browsers); RAM-offload allows sequences up to system memory
 * by keeping only the working window in VRAM and streaming historical KV data from RAM.
 *
 * Strategy:
 *   - Master KV cache (full sequence) lives in a CPU-side ArrayBuffer (system RAM).
 *   - On each prefill/decode step, copy the needed KV slice to a GPU staging buffer.
 *   - KV-matmul kernels read from the staging buffer (small, in-VRAM).
 *   - After step, copy results back to CPU buffer and advance the cursor.
 */

import type { GpuDeviceLike, GpuBufferLike } from "../kernels/gpu-min";
import { BufferUsage, MapMode } from "../kernels/gpu-min";

export interface RamKvOffloadConfig {
  /** Enable RAM-KV offload (default: false, keep full KV in VRAM). */
  enabled: boolean;
  /** Max sequence length to keep resident in VRAM before offloading to RAM (default: 4096). */
  vramWindow: number;
  /** Full context length (max sequence length ever). If undefined, no hard limit. */
  maxContextLength?: number;
}

export class RamKvCache {
  private vramBuffer?: GpuBufferLike;
  private ramBuffer?: ArrayBuffer;
  private currentSeqLen = 0;

  constructor(
    private device: GpuDeviceLike,
    private nHeads: number,
    private headDim: number,
    private config: RamKvOffloadConfig,
  ) {}

  /**
   * Allocate KV buffers for a new generation (reset to seq_len=1 after initial token).
   * If RAM offload is enabled, allocate ArrayBuffer for the full context; otherwise,
   * allocate GPU VRAM.
   */
  allocate(): void {
    const maxLen = this.config.maxContextLength ?? 4096;
    const kvElemPerToken = this.nHeads * this.headDim;
    // K **and** V per token — hence the ×2. This previously allocated
    // `kvElemPerToken * 4`, i.e. room for K only, while append() writes both.
    // Two consequences, both real: the buffer was HALF the size it needed, and
    // the per-token stride collided — token N's V was written at exactly token
    // N+1's K offset, so every V got clobbered by the next token's K. On the RAM
    // path that surfaced as `RangeError: offset is out of bounds`; on the VRAM
    // path it was SILENT corruption.
    const kvBytesPerToken = kvElemPerToken * 2 * 4; // f32, K + V
    const totalBytes = maxLen * kvBytesPerToken;

    if (this.config.enabled) {
      // Allocate CPU-side RAM for full cache
      this.ramBuffer = new ArrayBuffer(totalBytes);
    } else {
      // VRAM-resident: allocate the full context directly on GPU (or just the window)
      const vramBytes = Math.min(this.config.vramWindow, maxLen) * kvBytesPerToken;
      this.vramBuffer = this.device.createBuffer({
        size: vramBytes,
        usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
        label: "kv_cache_vram",
      });
    }
    this.currentSeqLen = 0;
  }

  /**
   * Update KV cache at position seq_len with new K/V data (e.g., after attention layer).
   * If RAM offload is enabled, write to RAM; otherwise, write to GPU buffer.
   */
  async append(position: number, k: Float32Array, v: Float32Array): Promise<void> {
    if (!this.ramBuffer && !this.vramBuffer) {
      throw new Error("bonsai-ram-kv: cache not allocated");
    }

    const kvElemPerToken = this.nHeads * this.headDim;
    if (k.length !== kvElemPerToken || v.length !== kvElemPerToken) {
      throw new Error(
        `bonsai-ram-kv: KV size mismatch (got ${k.length}, expected ${kvElemPerToken})`,
      );
    }

    if (this.config.enabled && this.ramBuffer) {
      // Write to RAM. Stride and view length both cover K **and** V (×2) — see
      // allocate(). The view was previously `kvElemPerToken` long, so writing V
      // at float-offset kvElemPerToken ran off the end.
      const kvPerToken = kvElemPerToken * 2 * 4; // bytes per token (f32), K + V
      const offset = position * kvPerToken;
      const view = new Float32Array(this.ramBuffer, offset, kvElemPerToken * 2);
      view.set(k);
      view.set(v, kvElemPerToken);
    } else if (this.vramBuffer) {
      // Write to GPU (only for VRAM-resident)
      const kvPerToken = kvElemPerToken * 2 * 4;
      const offset = position * kvPerToken;
      this.device.queue.writeBuffer(this.vramBuffer, offset, k);
      this.device.queue.writeBuffer(
        this.vramBuffer,
        offset + this.nHeads * this.headDim * 4,
        v,
      );
    }

    this.currentSeqLen = Math.max(this.currentSeqLen, position + 1);
  }

  /**
   * Stream a slice of KV cache from RAM to a GPU staging buffer.
   * Used before a matmul: copy [start, end) to staging, run kernel, copy results back.
   */
  async streamToGpu(
    startPos: number,
    endPos: number,
  ): Promise<{ kBuffer: GpuBufferLike; vBuffer: GpuBufferLike }> {
    if (!this.config.enabled) {
      throw new Error("bonsai-ram-kv: streamToGpu() called but offload is disabled");
    }
    if (!this.ramBuffer) {
      throw new Error("bonsai-ram-kv: RAM buffer not allocated");
    }

    const nTokens = endPos - startPos;
    const kvElemPerToken = this.nHeads * this.headDim;
    const kBytes = nTokens * kvElemPerToken * 4;

    // Allocate staging buffers
    const kStaging = this.device.createBuffer({
      size: kBytes,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label: `kv_staging_k_${startPos}_${endPos}`,
    });
    const vStaging = this.device.createBuffer({
      size: kBytes,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label: `kv_staging_v_${startPos}_${endPos}`,
    });

    // Copy from RAM to GPU. Same K+V stride as allocate()/append(): each token
    // occupies 2*kvElemPerToken floats, K first then V. Reading with a K-only
    // stride would hand the kernel token N+1's K in place of token N's V.
    //
    // NOTE: K and V are INTERLEAVED per token, so a single contiguous
    // Float32Array cannot view "all K" or "all V" — they must be gathered.
    const kvPerToken = kvElemPerToken * 2 * 4;
    const startByte = startPos * kvPerToken;
    const kData = new Float32Array(nTokens * kvElemPerToken);
    const vData = new Float32Array(nTokens * kvElemPerToken);
    for (let t = 0; t < nTokens; t++) {
      const tok = new Float32Array(
        this.ramBuffer,
        startByte + t * kvPerToken,
        kvElemPerToken * 2,
      );
      kData.set(tok.subarray(0, kvElemPerToken), t * kvElemPerToken);
      vData.set(tok.subarray(kvElemPerToken), t * kvElemPerToken);
    }

    this.device.queue.writeBuffer(kStaging, 0, kData);
    this.device.queue.writeBuffer(vStaging, 0, vData);

    return { kBuffer: kStaging, vBuffer: vStaging };
  }

  /**
   * Pull back results from GPU staging buffers to RAM (after matmul, for storage).
   */
  async pullFromGpu(
    startPos: number,
    kBuffer: GpuBufferLike,
    vBuffer: GpuBufferLike,
  ): Promise<void> {
    if (!this.config.enabled || !this.ramBuffer) {
      return; // VRAM-resident doesn't need pull-back
    }

    const nTokens = this.currentSeqLen - startPos;
    const kvElemPerToken = this.nHeads * this.headDim;
    const kBytes = nTokens * kvElemPerToken * 4;

    // A STORAGE BUFFER CANNOT BE MAPPED. This used to call
    // `kBuffer.mapAsync(MapMode.READ)` directly on the staging buffers
    // `streamToGpu` creates — which carry STORAGE|COPY_DST|COPY_SRC, because the
    // attention kernel binds them. WebGPU forbids MAP_READ alongside STORAGE, and
    // mapAsync on a non-mappable buffer rejects, so this method could never once
    // have completed on a real device.
    //
    // Nothing caught it because the whole module is unreachable (D-1855) AND the
    // test double's `mapAsync` is a no-op that always resolves — a mock that
    // cannot express the constraint the real API enforces. Read-back therefore
    // goes through a buffer created for reading: COPY_DST | MAP_READ, filled by a
    // copy from the storage buffer, then mapped.
    const readback = (src: GpuBufferLike, label: string): GpuBufferLike =>
      this.device.createBuffer({
        size: kBytes,
        usage: BufferUsage.COPY_DST | BufferUsage.MAP_READ,
        label,
      });
    const kRead = readback(kBuffer, `kv_readback_k_${startPos}`);
    const vRead = readback(vBuffer, `kv_readback_v_${startPos}`);

    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(kBuffer, 0, kRead, 0, kBytes);
    enc.copyBufferToBuffer(vBuffer, 0, vRead, 0, kBytes);
    this.device.queue.submit([enc.finish()]);

    await kRead.mapAsync(MapMode.READ);
    await vRead.mapAsync(MapMode.READ);

    const kData = new Float32Array(kRead.getMappedRange());
    const vData = new Float32Array(vRead.getMappedRange());

    // Scatter back into the INTERLEAVED per-token layout (K then V, stride
    // 2*kvElemPerToken). The old code used a K-only stride and viewed V at
    // +kvElemPerToken floats, which is token N+1's K slot — so pulling results
    // back corrupted the next token's K.
    const kvPerToken = kvElemPerToken * 2 * 4;
    const startByte = startPos * kvPerToken;
    for (let t = 0; t < nTokens; t++) {
      const tok = new Float32Array(
        this.ramBuffer,
        startByte + t * kvPerToken,
        kvElemPerToken * 2,
      );
      tok.set(kData.subarray(t * kvElemPerToken, (t + 1) * kvElemPerToken), 0);
      tok.set(vData.subarray(t * kvElemPerToken, (t + 1) * kvElemPerToken), kvElemPerToken);
    }

    kRead.unmap();
    vRead.unmap();
    kRead.destroy();
    vRead.destroy();

    // Destroy staging buffers
    kBuffer.destroy();
    vBuffer.destroy();
  }

  /** Current sequence length (tokens processed). */
  get seqLen(): number {
    return this.currentSeqLen;
  }

  /** Destroy all buffers. */
  destroy(): void {
    if (this.vramBuffer) this.vramBuffer.destroy();
    this.ramBuffer = undefined;
    this.vramBuffer = undefined;
  }
}
