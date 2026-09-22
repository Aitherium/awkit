// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * MOVED — the upload path now lives at `../wasp/sink-webgpu.ts`.
 *
 * `uploadCoalescedRange` IS GONE, not renamed, and that is the point of the change it was
 * removed by. It fetched a coalesced range — one HTTP GET spanning several adjacent
 * tensors — into a single ArrayBuffer and then repacked each member into a second, so peak
 * heap was roughly twice the largest tensor: measured ~360 MB for the 27B's 171 MB
 * `token_embd.weight`. A phone's browser aborts that read, and the abort surfaces inside
 * `reader.read()` as `Failed to fetch`, i.e. as a network problem. Keeping the function
 * around as a deprecated alias would have left that path one import away from returning,
 * with nothing able to tell the two apart in a diff. `uploadStreaming` is the only upload.
 *
 * This file stays as a RE-EXPORT for the same reason `gguf/reader.ts` does: the generated
 * awkit mirror is vendored by product repos that import `webml/bonsai/tensors/upload` BY
 * PATH, and removing a published subpath is a breaking change for consumers this repo
 * cannot see. The names below are the ones that survived the move.
 */

export {
  uploadStreaming,
  uploadTensor,
  needsChunking,
  blockGeometry,
  gpuBytesFor,
  repackChunk,
  refuseBeforeFirstByte,
  adapterBufferCeiling,
  WEBGPU_DEFAULT_MAX_STORAGE_BINDING,
} from "../wasp/sink-webgpu";
export type {
  UploadedTensor,
  UploadStreamingOptions,
  AdapterLimitsLike,
  RefusalInput,
} from "../wasp/sink-webgpu";
