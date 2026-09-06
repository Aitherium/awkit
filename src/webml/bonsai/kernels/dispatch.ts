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
 * Typed dispatch helpers: buffer creation, uniform packing, bind-group assembly, workgroup
 * count math, and readback. Thin + explicit so the numeric contract lives in the WGSL and
 * the reference, not hidden here.
 */

import {
  BufferUsage,
  MapMode,
  type GpuBufferLike,
  type GpuDeviceLike,
  type GpuBindGroupLike,
  type GpuPipelineLike,
} from "./gpu-min";

export function ceilDiv(a: number, b: number): number {
  return Math.floor((a + b - 1) / b);
}

// --- Submit batching -------------------------------------------------------
// Each op (rmsnorm, matmul, rope, deltanet, …) normally encodes ONE compute pass
// and submits it immediately, so a single decode token issues thousands of tiny
// queue.submit() calls — the dominant per-token cost once the kernels are numerically
// correct. When a batch is open for a device, dispatch1D appends its pass to a shared
// encoder instead of submitting; the caller flushes once per layer. This is numerically
// IDENTICAL to per-op submit: every op already allocates its own uniform + storage +
// bind group (no scratch reuse), so no writeBuffer clobbers another op's input, and
// WebGPU inserts automatic barriers between compute passes within one encoder, so
// sequential state updates (DeltaNet recurrence, KV append) stay ordered. Only the
// number of queue.submit() calls changes — thousands/token down to one per layer.
const activeBatch = new WeakMap<
  GpuDeviceLike,
  { enc: ReturnType<GpuDeviceLike["createCommandEncoder"]>; dispatches: number }
>();

// --- TDR SUBMIT BUDGET (incident 2026-07-31) -------------------------------
// Batching a whole layer into one submit is right on a discrete card and DANGEROUS on a
// weak integrated one. Windows kills any GPU packet exceeding `TdrDelay` — DEFAULT 2
// SECONDS — and resets the display driver: the visitor's screen flashes, the GPUDevice is
// lost, and any fetch in flight in that renderer dies as a bare "Failed to fetch". That is
// exactly what a Lenovo Yoga 7i (Iris Xe) hit on the 4B, and the fetch error was the only
// part visible, which sends the diagnosis into the network stack instead of the GPU.
//
// So a device may declare a MAXIMUM number of dispatches per submit. On reaching it the
// batch is submitted and a NEW encoder opened immediately, so callers see no behavioural
// difference — they still call beginBatch/flushBatch once per layer.
//
// WHY SPLITTING IS SAFE, and it is the same argument that made batching safe in the first
// place: WebGPU executes submits in queue order, and `queue.writeBuffer` is ordered against
// them. Two command buffers submitted back-to-back therefore run in exactly the order the
// passes were recorded — identical to one command buffer holding both. The only thing that
// changes is the number of submits, which is a performance knob, not a semantic one.
//
// 0 = no cap (the default, and what every discrete adapter keeps).
const submitBudget = new WeakMap<GpuDeviceLike, number>();

/**
 * Cap dispatches per `queue.submit()` for this device. See gpu-class.ts for the classes and
 * the honest limit: this REDUCES packet duration, it cannot bound it — one slow dispatch can
 * still overrun TDR on its own. Pass 0 to remove the cap.
 */
export function setSubmitBudget(device: GpuDeviceLike, maxDispatches: number): void {
  submitBudget.set(device, Math.max(0, Math.floor(maxDispatches)));
}

/** The cap in force for this device (0 = uncapped). Exported for tests and diagnostics. */
export function getSubmitBudget(device: GpuDeviceLike): number {
  return submitBudget.get(device) ?? 0;
}

/** Open a batch for this device so subsequent dispatch1D calls accumulate into one encoder. Idempotent. */
export function beginBatch(device: GpuDeviceLike): void {
  if (!activeBatch.has(device)) {
    activeBatch.set(device, { enc: device.createCommandEncoder(), dispatches: 0 });
  }
}

/** Submit any pending batched passes for this device. Safe to call when no batch is open. */
export function flushBatch(device: GpuDeviceLike): void {
  const b = activeBatch.get(device);
  if (!b) return;
  activeBatch.delete(device);
  device.queue.submit([b.enc.finish()]);
}

/** A recording target for buffer copies (see beginCopies / finishCopies). */
export interface CopyTarget {
  enc: ReturnType<GpuDeviceLike["createCommandEncoder"]>;
  batched: boolean;
}

/**
 * Get an encoder to record copyBufferToBuffer ops into. When a batch is open, returns the
 * batch's encoder so copies are ORDER-PRESERVED with the surrounding compute passes. A raw
 * encoder+submit here would execute BEFORE the still-open batch wrote the copy's inputs →
 * garbage (the exact bug from combining per-layer batching with the QG/conv intermediate
 * copies). Pair with finishCopies().
 */
export function beginCopies(device: GpuDeviceLike): CopyTarget {
  const batch = activeBatch.get(device);
  if (batch) return { enc: batch.enc, batched: true };
  return { enc: device.createCommandEncoder(), batched: false };
}

/** Submit copies recorded on a non-batched target; a batched target is flushed by its layer. */
export function finishCopies(device: GpuDeviceLike, t: CopyTarget): void {
  if (!t.batched) device.queue.submit([t.enc.finish()]);
}

// --- Deferred buffer destruction -------------------------------------------
// A block allocates ~17-25 scratch GPUBuffers per layer. They cannot be destroyed inside
// the block: with per-layer batching the block's compute passes are NOT submitted until
// flushBatch AFTER runBlock returns, so an in-block destroy() frees a buffer the pending
// passes still reference. Instead, scratch buffers are QUEUED here and destroyed by
// flushDeferred() right AFTER flushBatch — where destroy() is spec-safe (the submit has
// happened; WebGPU defers reclamation until the GPU finishes). Without this the engine
// leaks all scratch buffers every token and OOMs a multi-turn conversation.
const deferredDestroy = new WeakMap<GpuDeviceLike, GpuBufferLike[]>();

// --- Scratch buffer POOL (D-850) -------------------------------------------
// Decode re-created every scratch buffer, every uniform and every bind group on EVERY
// dispatch: ~17-25 scratch buffers per layer x 64 layers is roughly 1300 createBuffer +
// 1300 createBindGroup + 1300 destroy per generated token. That is pure CPU-side driver
// overhead, it scales with layer count, and it is invisible to the kernel micro-benchmarks
// (which time a single dispatch on an already-warm buffer).
//
// Instead of destroying a released buffer we RECYCLE it, keyed by (usage, exact byte
// size). Sizes repeat almost perfectly across layers — every layer runs the same shapes —
// so the pool reaches steady state after layer 0 and allocates nothing thereafter.
//
// WHY REUSE IS SAFE, and it is not the same argument as destroy-after-submit:
// buffers are released at exactly the same point they used to be destroyed — AFTER
// flushBatch, i.e. after the submit that referenced them. A recycled buffer is therefore
// only ever handed out for a LATER submit, and WebGPU executes submits in queue order,
// with queue.writeBuffer ordered against them too. So a subsequent write cannot land
// before a prior pass that reads the same memory. (Handing a buffer back out WITHIN the
// open batch would break exactly that invariant — hence release happens in flushDeferred
// and nowhere else.)
//
// Correctness of the pooled path is gated by the whole-model differential, which compares
// GPU logits against the CPU reference AND requires argmax agreement — a buffer-reuse bug
// corrupts activations, so it shows up there rather than hiding.
type PoolKey = string;
const bufferPool = new WeakMap<GpuDeviceLike, Map<PoolKey, GpuBufferLike[]>>();
const poolStats = new WeakMap<GpuDeviceLike, { created: number; reused: number }>();

function poolFor(device: GpuDeviceLike): Map<PoolKey, GpuBufferLike[]> {
  let m = bufferPool.get(device);
  if (!m) { m = new Map(); bufferPool.set(device, m); }
  return m;
}

function statsFor(device: GpuDeviceLike): { created: number; reused: number } {
  let s = poolStats.get(device);
  if (!s) { s = { created: 0, reused: 0 }; poolStats.set(device, s); }
  return s;
}

/** Buffers are pooled per (usage, exact size) — a smaller buffer must never satisfy a
 *  larger request, and usage flags are immutable after creation. */
function keyOf(usage: number, size: number): PoolKey {
  return `${usage}:${size}`;
}

/** Take a buffer from the pool, or create one. `size` must already be aligned.
 *
 * `queueInit` — caller PROMISES to fully overwrite the buffer via `queue.writeBuffer`
 * immediately after acquisition. That promise matters because queue writes execute BEFORE
 * any batch command buffer submitted later: an in-batch clear would run AFTER the caller's
 * write and zero it (measured: every op's uniforms zeroed → "urburburbur..."). For such
 * buffers the clear is both wrong AND unnecessary — a full overwrite evicts stale bytes on
 * its own. Callers that only partially write must never pass this. */
function acquire(
  device: GpuDeviceLike,
  usage: number,
  size: number,
  label?: string,
  queueInit = false,
): GpuBufferLike {
  const pool = poolFor(device);
  const key = keyOf(usage, size);
  const free = pool.get(key);
  const st = statsFor(device);
  // Escape hatch for D-937. Recycled buffers are handed back with their PREVIOUS contents
  // intact — which is correct only if every kernel fully writes the range it later reads.
  // The pool is keyed by SIZE, so prefill(N) and prefill(N-1) draw from different buckets
  // holding different stale bytes; any kernel that reads an uninitialised region would make
  // the two runs disagree, which is exactly the causality violation under investigation.
  // Setting `__BONSAI_NO_POOL` forces a fresh buffer every time, so the measurement can be
  // repeated with this variable removed before the model is blamed.
  if ((globalThis as { __BONSAI_NO_POOL?: boolean }).__BONSAI_NO_POOL === true) {
    st.created++;
    return device.createBuffer({ size, usage, label });
  }
  if (free && free.length > 0) {
    st.reused++;
    const buf = free.pop()!;
    // Queue-initialized buffers (uniforms, constant fills): the caller's writeBuffer fully
    // overwrites the payload, and the padded tail beyond it is never read by any shader
    // (WGSL reads only declared struct fields). Clearing would be wrong here, not just
    // wasteful — see the acquire() doc-comment.
    if (queueInit) return buf;
    // ZERO IT. WebGPU zero-initialises every buffer from createBuffer(), so code is entitled
    // to assume an untouched region reads as 0. A recycled buffer breaks that contract
    // silently, and only for the regions a kernel does not fully write.
    //
    // Measured on the real weights 2026-07-26, prefill(N) vs prefill(N-1) at their shared
    // token: WITHOUT pooling the divergence at block 3 is 9.5e-3 relative; WITH pooling it is
    // 1.012 — a ~100x amplification, purely from stale bytes. The pool is keyed by SIZE, so
    // the two runs draw from different buckets and inherit DIFFERENT garbage, which is why it
    // presented as a causality violation. It hid because the model was already incoherent for
    // an unrelated reason (the genuine block-2 defect, which pooling does NOT explain).
    //
    // clearBuffer is a GPU-side fill, so this keeps the allocation win (the point of D-850)
    // without keeping the stale data.
    //
    // RECORD INTO THE OPEN BATCH, NEVER A PRIVATE ENCODER + IMMEDIATE SUBMIT (D-1517).
    // This was `createCommandEncoder()` + `queue.submit()` PER ACQUISITION — ~25 scratch
    // buffers and ~25 uniforms per layer, so the D-850 zeroing fix quietly reintroduced
    // per-op submits through the back door and nullified the one-submit-per-layer batching:
    // ~700+ tiny submits per decoded token on the 1.7B. That is the measured 3–4 ms/layer
    // floor that made tok/s independent of model size (D-1517's table), because submit
    // overhead is per-submit, not per-byte.
    //
    // Ordering is EQUIVALENT, not merely similar: a pooled buffer's stale bytes come from
    // command buffers submitted on PREVIOUS flushes, and every pass that touches this buffer
    // is recorded AFTER this acquisition into the same batch encoder — so an in-batch clear
    // still executes after the stale writes and before every new reader. The unbatched
    // fallback (finishCopies submits immediately) keeps harness/one-off paths working.
    const tgt = beginCopies(device);
    (tgt.enc as unknown as { clearBuffer: (b: GpuBufferLike, o?: number, s?: number) => void }).clearBuffer(buf, 0, size);
    finishCopies(device, tgt);
    return buf;
  }
  st.created++;
  return device.createBuffer({ size, usage, label });
}

/** Pool occupancy + hit rate, for the perf harness. */
export function poolStatsFor(device: GpuDeviceLike): { created: number; reused: number; pooled: number } {
  const st = statsFor(device);
  let pooled = 0;
  for (const list of poolFor(device).values()) pooled += list.length;
  return { ...st, pooled };
}

/** Drop every pooled buffer (real destroy). For teardown / memory pressure. */
export function drainPool(device: GpuDeviceLike): void {
  const pool = poolFor(device);
  for (const list of pool.values()) {
    for (const b of list) {
      try { b.destroy(); } catch { /* already destroyed / lost device — ignore */ }
    }
  }
  pool.clear();
}

// Buffers carry their pool key so release can file them without re-deriving it.
const POOL_KEY = Symbol("aither.poolKey");
type Poolable = GpuBufferLike & { [POOL_KEY]?: PoolKey };

/** Queue a scratch buffer for RELEASE after the current layer's batch is submitted.
 *  (Named deferDestroy for compatibility; it now recycles rather than destroys.) */
export function deferDestroy(device: GpuDeviceLike, buf: GpuBufferLike): void {
  let l = deferredDestroy.get(device);
  if (!l) { l = []; deferredDestroy.set(device, l); }
  l.push(buf);
}

/** Release all queued scratch buffers back to the pool. Call AFTER flushBatch each layer. */
export function flushDeferred(device: GpuDeviceLike): void {
  const l = deferredDestroy.get(device);
  if (!l) return;
  const pool = poolFor(device);
  for (const b of l) {
    const key = (b as Poolable)[POOL_KEY];
    if (key === undefined) {
      // Not pool-allocated (came from uploadBytes or a caller's own createBuffer) —
      // preserve the old contract and destroy it.
      try { b.destroy(); } catch { /* already destroyed / lost device — ignore */ }
      continue;
    }
    let list = pool.get(key);
    if (!list) { list = []; pool.set(key, list); }
    list.push(b);
  }
  l.length = 0;
}

const STORAGE_USAGE = BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC;
const UNIFORM_USAGE = BufferUsage.UNIFORM | BufferUsage.COPY_DST;

export function createStorage(
  device: GpuDeviceLike,
  bytes: number,
  label?: string,
  opts?: { queueInit?: boolean },
): GpuBufferLike {
  const size = Math.max(4, align4(bytes));
  const buf = acquire(device, STORAGE_USAGE, size, label, opts?.queueInit === true) as Poolable;
  buf[POOL_KEY] = keyOf(STORAGE_USAGE, size);
  return buf;
}

export function createUniform(device: GpuDeviceLike, bytes: number, label?: string): GpuBufferLike {
  const size = Math.max(16, align4(bytes));
  // Uniforms are ALWAYS queue-initialized: ops.uniform() writeBuffers the packed fields
  // immediately after this returns, every time. See acquire() for why they must not be
  // batch-cleared.
  const buf = acquire(device, UNIFORM_USAGE, size, label, true) as Poolable;
  buf[POOL_KEY] = keyOf(UNIFORM_USAGE, size);
  return buf;
}

export function align4(n: number): number {
  return n + ((4 - (n % 4)) % 4);
}

export function uploadBytes(device: GpuDeviceLike, data: ArrayBufferView, usage?: number): GpuBufferLike {
  const buf = device.createBuffer({
    size: align4(data.byteLength),
    usage: (usage ?? BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC),
    label: "upload",
  });
  device.queue.writeBuffer(buf, 0, data);
  return buf;
}

export function bindGroup(
  device: GpuDeviceLike,
  pipeline: GpuPipelineLike,
  buffers: GpuBufferLike[],
): GpuBindGroupLike {
  return device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: buffers.map((b, i) => ({ binding: i, resource: { buffer: b } })),
  });
}

/**
 * WebGPU's `maxComputeWorkgroupsPerDimension`. 65535 is the value the spec REQUIRES every
 * implementation to support, and every browser reports exactly it — so it is a hard ceiling
 * in practice, not a device-specific hint.
 *
 * This limit is per DIMENSION, which is why exceeding it is a validation error rather than
 * a slow path. It bit us because the counts here scale with prompt length: `quantizeQ8`
 * dispatches one workgroup per 32-element block, so a Bonsai-1.7B FFN projection at
 * nTokens x 6144 elements crosses 65535 workgroups at just ~341 PROMPT TOKENS. The old
 * fixed 2048-slot KV cap kept the 27B under it by accident; nothing kept a dense model
 * under it, and a greeter conversation passes 341 tokens almost immediately.
 */
const MAX_WORKGROUPS_PER_DIM = 65535;

export function dispatch1D(
  device: GpuDeviceLike,
  pipeline: GpuPipelineLike,
  group: GpuBindGroupLike,
  totalThreads: number,
  workgroupSize: number,
): void {
  const batch = activeBatch.get(device);
  const enc = batch ? batch.enc : device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);

  const groups = ceilDiv(totalThreads, workgroupSize);
  if (groups <= MAX_WORKGROUPS_PER_DIM) {
    // The overwhelming majority of dispatches. Emitted as a 1-D grid exactly as before, so
    // `num_workgroups.y` is 1 and every kernel's flat-index expression collapses to the old
    // `wg.x` / `gid.x`. Nothing about the working path changes.
    pass.dispatchWorkgroups(groups);
  } else {
    // Fold the excess into y. Kernels recover the flat workgroup index as
    // `wg.x + wg.y * num_workgroups.x`, which is why x must be the FULL width rather than
    // some tidier factor — the kernels' arithmetic depends on x being the stride.
    const gx = MAX_WORKGROUPS_PER_DIM;
    const gy = ceilDiv(groups, gx);
    if (gy > MAX_WORKGROUPS_PER_DIM) {
      throw new Error(
        `bonsai-dispatch: ${groups} workgroups exceeds even a 2-D grid ` +
          `(${MAX_WORKGROUPS_PER_DIM}^2). This is a context-length bug upstream, not a ` +
          `dispatch bug — chunk the work.`,
      );
    }
    // gx*gy >= groups, so the tail workgroups run with an out-of-range flat index. That is
    // SAFE rather than merely unlikely: WebGPU mandates robust buffer access — out-of-bounds
    // reads return zero and out-of-bounds writes are DISCARDED (unlike Vulkan, where it is
    // opt-in). Kernels that can bound themselves still return early; the rest simply write
    // nowhere.
    pass.dispatchWorkgroups(gx, gy);
  }

  pass.end();
  // When batching, defer the submit — flushBatch() issues one submit per layer.
  if (!batch) {
    device.queue.submit([enc.finish()]);
    return;
  }
  // TDR budget: a weak adapter must not accumulate a whole layer into one packet. Submit
  // what we have and re-open, so the caller's beginBatch/flushBatch contract is unchanged.
  batch.dispatches++;
  const budget = submitBudget.get(device) ?? 0;
  if (budget > 0 && batch.dispatches >= budget) {
    console.debug(
      `[bonsai] TDR budget limit reached: submitted ${batch.dispatches} dispatches, ` +
      `opening new batch to stay under GPU watchdog deadline`,
    );
    activeBatch.delete(device);
    device.queue.submit([batch.enc.finish()]);
    activeBatch.set(device, { enc: device.createCommandEncoder(), dispatches: 0 });
  }
}

/*
 * STAGING-BUFFER POOL for readback.
 *
 * Decode calls readback() ONCE PER TOKEN for the logits row, and on Bonsai that row is
 * vocab(248,320) x 4 B = ~993 KB. This function used to createBuffer + destroy that MAP_READ
 * buffer every single token, and `getMappedRange().slice()` copied the whole megabyte again.
 *
 * MEASURED 2026-07-31 on the 4B at a 1285-token context, with the sample phase split into
 * its two halves for the first time:
 *     sample=83.9ms  [readback=83.4ms  select=0.4ms]
 * i.e. the JS top-k pass over all 248,320 logits — the part the code comments worried about
 * and bounded so carefully — costs FOUR TENTHS OF A MILLISECOND, and the transfer around it
 * costs two hundred times that. Once the attention kernel was fixed this became the largest
 * per-token cost in the decode loop, larger than the entire forward pass (57.9 ms).
 *
 * A MAP_READ buffer cannot be recycled while it is mapped, so the pool hands one out, and
 * takes it back only after unmap(). Keyed by exact size, like the storage pool above.
 */
const stagingPool = new WeakMap<GpuDeviceLike, Map<number, GpuBufferLike[]>>();

function takeStaging(device: GpuDeviceLike, size: number): GpuBufferLike {
  let bySize = stagingPool.get(device);
  if (!bySize) { bySize = new Map(); stagingPool.set(device, bySize); }
  const free = bySize.get(size);
  if (free && free.length) return free.pop()!;
  return device.createBuffer({
    size,
    usage: BufferUsage.MAP_READ | BufferUsage.COPY_DST,
    label: "readback",
  });
}

function giveBackStaging(device: GpuDeviceLike, size: number, buf: GpuBufferLike): void {
  const bySize = stagingPool.get(device);
  if (!bySize) { buf.destroy(); return; }
  let free = bySize.get(size);
  if (!free) { free = []; bySize.set(size, free); }
  // Cap it: readback sizes vary (logits, debug slices, the 4-byte argmax) and an unbounded
  // pool of megabyte buffers is a leak wearing a pool's clothes.
  if (free.length >= 4) { buf.destroy(); return; }
  free.push(buf);
}

/** Drop every pooled staging buffer. For teardown / memory pressure. */
export function drainStagingPool(device: GpuDeviceLike): void {
  const bySize = stagingPool.get(device);
  if (!bySize) return;
  for (const list of bySize.values()) {
    for (const b of list) { try { b.destroy(); } catch { /* already gone */ } }
  }
  bySize.clear();
}

/** Read a storage buffer back to the host (staging buffer + map). */
export async function readback(
  device: GpuDeviceLike,
  src: GpuBufferLike,
  byteLength: number,
): Promise<ArrayBuffer> {
  // Any batched compute must be submitted before we copy its output back to the host,
  // otherwise the copy would race ahead of the deferred passes that produce `src`.
  flushBatch(device);
  const size = align4(byteLength);
  const staging = takeStaging(device, size);
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(src, 0, staging, 0, size);
  device.queue.submit([enc.finish()]);
  await staging.mapAsync(MapMode.READ);
  // slice() is REQUIRED, not incidental: getMappedRange() returns a view into memory that
  // unmap() invalidates, so the bytes must be copied out before the buffer is released.
  const copy = staging.getMappedRange().slice(0, byteLength);
  staging.unmap();
  giveBackStaging(device, size, staging);
  return copy;
}

/** Pack a small uniform struct of u32/f32 fields into an ArrayBuffer (std140-ish, 4B each). */
export function packUniform(fields: Array<{ u32?: number; f32?: number }>): ArrayBuffer {
  const buf = new ArrayBuffer(align16(fields.length * 4));
  const dv = new DataView(buf);
  fields.forEach((f, i) => {
    if (f.u32 !== undefined) dv.setUint32(i * 4, f.u32, true);
    else dv.setFloat32(i * 4, f.f32 ?? 0, true);
  });
  return buf;
}

function align16(n: number): number {
  return n + ((16 - (n % 16)) % 16);
}
