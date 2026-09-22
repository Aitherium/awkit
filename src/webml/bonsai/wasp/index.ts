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
 * WASP — the weight-streaming plane.
 *
 * THE ONE IDEA. Getting a multi-gigabyte model onto a device is a PEAK MEMORY
 * problem wearing a download's clothes. The bytes arrive fine; what kills a phone is
 * how many of them are resident at once, and the classic loader's answer is "one
 * whole tensor, plus its repacked copy" — 171 MB becomes ~360 MB of peak heap for
 * the 27B's `token_embd.weight`, on a device whose browser is killed well before
 * that. A memory-killed worker posts no message and on several engines fires no
 * error (BIH001), so the page does not crash: it stops, forever, with nothing to
 * read.
 *
 * THE SECOND IDEA, which is the one nobody ships. The refusal must come BEFORE the
 * first byte. Every runtime discovers "this buffer exceeds this device's limit"
 * after it has spent the visitor's bandwidth fetching it — `needsChunking()` threw
 * from inside the upload, i.e. after the GET. Both halves of the answer are
 * knowable first: the GPU ADAPTER publishes `maxBufferSize` and
 * `maxStorageBufferBindingSize` (never probed anywhere before this module), and a
 * side-car manifest can publish the largest tensor a file contains. Ask both, then
 * decide, then fetch.
 *
 * This barrel is the brick's public surface — `awasp` re-exports exactly this, and
 * the sync lane mirrors the tree into the SDK package. Anything exported here is a
 * contract; anything not is an internal of the runtime.
 */

// The chunk size the streaming sink and the resumable cache agree on.
//
// ONE CONSTANT, EXPORTED, because the cache keys resume points by it and the sink
// bounds memory by it. Two copies of this number is how a resume silently stops
// resuming: the cache holds 32 MiB pieces and the sink asks for 64 MiB ones, every
// lookup misses, and the only symptom is that the download starts from zero again.
//
// 32 MiB is the largest piece a phone reliably holds twice (raw + repacked) while
// the rest of the tab is live. It is a ceiling, not a quantum: the sink rounds it
// DOWN to a whole number of quant blocks so a chunk never splits a block, which is
// what makes the repack per chunk possible at all.
export const WASP_CHUNK_TARGET_BYTES = 32 * 1024 * 1024;

/**
 * Raw chunk size for a tensor whose on-disk quant block is `rawBlock` bytes.
 *
 * Rounded DOWN to a whole block, so `rawOff / rawBlock` is always an integer and the
 * destination offset `(rawOff / rawBlock) * gpuBlock` is exact. A chunk that ended
 * mid-block would put the next chunk's first block at a fractional GPU slot, and the
 * kernels would read misaligned data — which does not crash and does not produce
 * noise; it produces fluent, plausible garbage, the hardest failure in this runtime
 * to notice.
 */
export function waspChunkBytes(rawBlock: number, target = WASP_CHUNK_TARGET_BYTES): number {
  if (!Number.isFinite(rawBlock) || rawBlock <= 0) return target;
  const blocks = Math.floor(target / rawBlock);
  // A single block larger than the target still travels whole — it cannot be split.
  return blocks >= 1 ? blocks * rawBlock : rawBlock;
}
