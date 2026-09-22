// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * WASP WASM SINK — the same bounded stream, handed to wllama as a FILE rather than a heap.
 *
 * 🚨 THE WASM LANE FROZE FOR A DIFFERENT REASON THAN THE GPU LANE, AND THE FIX IS NOT THE
 * SAME FIX. `loadModelFromUrl(url)` — what the worker used — is a whole-file GET into
 * wllama's own CacheManager, and then into the WASM HEAP. Verified in `@wllama/wllama`
 * 3.5.1 (`src/worker.ts`, `README-dev.md`): `loadModel(Blob[])` has two read modes, and
 * which one you get is decided by capability, not by choice —
 *
 *     JSPI (WebAssembly.Suspending, Chrome >= 137)   -> reads the Blob ON DEMAND, no copy
 *     setCompat('default') on Safari                 -> reads the Blob ON DEMAND, no copy
 *     neither                                        -> HeapFS: fileWrite()s the WHOLE
 *                                                       model into the wasm heap
 *
 * iOS Safari has no JSPI, and our worker never called `setCompat`, so every iPhone took
 * the third row: the entire model copied into a linear memory the OS then killed the tab
 * for. The model downloaded to 100% and the page stopped forever, which is why it reads
 * as a download problem.
 *
 * SO THE DIVISION OF LABOUR IS: WASP owns the NETWORK and the DISK — range chunks written
 * at offset into one OPFS file, resumable — and wllama owns the READS. Chunked/mmap-like
 * loading is available via a Blob, and is NOT available over HTTP; that is the whole
 * reason this module exists rather than a wllama option.
 *
 * COMPLETION IS A MARKER, NOT A FILE SIZE. OPFS reports a file's SIZE and not which
 * regions were written, so a file grown to 248 MB by writing the LAST chunk first reads as
 * complete while most of it is zeros — and handing wllama a model that is mostly zeros
 * does not fail, it loads and answers garbage. A sidecar records the byte length the file
 * is complete AT, and the model is used only when the two agree.
 */

import type { RangeFetcher } from "./source";
import type { WaspManifest } from "./manifest";
import { chunkBytesFor } from "./manifest";
import type { DirectoryHandleLike, FileHandleLike, SyncAccessHandleLike } from "./cache";

/**
 * The one capability probe this module makes, typed as a BAG rather than as `typeof
 * globalThis`.
 *
 * `globalThis` is not assignable to a structural type that narrows `WebAssembly`, and
 * widening the parameter to `typeof globalThis` would make it untestable — the whole
 * point is to drive the no-JSPI branch without a browser that lacks JSPI.
 */
export interface JspiHost {
  WebAssembly?: { Suspending?: unknown };
}

/** The slice of wllama this module drives. Structural, so the tests need no wasm. */
export interface WllamaLike {
  setCompat(compat: "default" | null, mode?: "safari" | "firefox_safari"): void;
  loadModel(blobs: Blob[], params?: Record<string, unknown>): Promise<void>;
}

export interface WasmStageDeps {
  getDirectory?: () => Promise<DirectoryHandleLike>;
  /** `globalThis` — injected so the JSPI probe is testable. */
  global?: JspiHost;
  log?: (msg: string) => void;
}

const DIR = "wasp-wasm";

/**
 * Does this engine need wllama's compatibility resources to read a Blob on demand?
 *
 * `WebAssembly.Suspending` is JSPI. Without it — every iOS Safari today, and Chrome below
 * 137 — the on-demand read is only available through `setCompat('default')`, and the
 * alternative is not "slower", it is the whole model in the wasm heap.
 */
export function needsCompatShim(global: JspiHost = globalThis as JspiHost): boolean {
  return typeof global?.WebAssembly?.Suspending !== "function";
}

/** Filesystem-safe name for a url. Kept identical in shape to the chunk cache's. */
function fileKey(url: string): string {
  const base = (url.split("?")[0].split("#")[0].split("/").pop() || "model")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 64);
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h * 33) ^ url.charCodeAt(i)) >>> 0;
  return `${base}.${h.toString(36)}`;
}

async function openHandle(
  dir: DirectoryHandleLike, name: string, create: boolean,
): Promise<SyncAccessHandleLike | null> {
  let fh: FileHandleLike;
  try {
    fh = await dir.getFileHandle(name, { create });
  } catch {
    return null;
  }
  if (typeof fh.createSyncAccessHandle !== "function") return null;
  try {
    return await fh.createSyncAccessHandle();
  } catch {
    return null;
  }
}

export interface StageResult {
  blob: Blob | null;
  /** Bytes that came from disk rather than the network this run. */
  resumedBytes: number;
  /** Why there is no blob, when there is none. Never silent. */
  reason: string;
}

/**
 * Stream the model into ONE OPFS file and hand back a Blob over it.
 *
 * Resumable: the sidecar records how many contiguous bytes are known-good, so an
 * interrupted download restarts at the next chunk boundary rather than at zero. It is
 * written AFTER each chunk lands, in order, which is what makes "contiguous" true — a
 * marker written optimistically would recreate the sparse-file lie it exists to prevent.
 */
export async function stageModelToOpfs(
  url: string,
  totalBytes: number,
  fetchRange: RangeFetcher,
  manifest: WaspManifest | null,
  deps: WasmStageDeps = {},
  onProgress?: (bytes: number, total: number) => void,
): Promise<StageResult> {
  const log = deps.log ?? ((m: string) => console.info(m));
  if (!deps.getDirectory) {
    return { blob: null, resumedBytes: 0, reason: "no OPFS in this context" };
  }
  let dir: DirectoryHandleLike;
  try {
    dir = await (await deps.getDirectory()).getDirectoryHandle(DIR, { create: true });
  } catch {
    return { blob: null, resumedBytes: 0, reason: "OPFS directory unavailable" };
  }

  const key = fileKey(url);
  const chunkBytes = chunkBytesFor(manifest);

  // How far is the existing file known-good? The MARKER, never the file size.
  let done = 0;
  const marker = await openHandle(dir, `${key}.done`, true);
  if (marker) {
    try {
      const buf = new Uint8Array(8);
      if (marker.getSize() >= 8) {
        marker.read(buf, { at: 0 });
        const dv = new DataView(buf.buffer);
        const recorded = dv.getUint32(0, true) + dv.getUint32(4, true) * 0x100000000;
        if (recorded <= totalBytes) done = recorded;
      }
    } catch {
      done = 0;
    } finally {
      try { marker.close(); } catch { /* already closed */ }
    }
  }

  let fh = await openHandle(dir, `${key}.model`, true);
  if (!fh) {
    return { blob: null, resumedBytes: 0, reason: "no OPFS sync access handle (window context?)" };
  }
  // A marker claiming more than the file holds is a torn state; distrust the marker.
  try {
    if (fh.getSize() < done) done = 0;
  } catch {
    done = 0;
  }

  const resumedBytes = done;
  if (done > 0) log(`wasp: resuming ${url} at ${(done / 1048576).toFixed(1)} MB`);

  try {
    for (let off = done; off < totalBytes; off += chunkBytes) {
      const len = Math.min(chunkBytes, totalBytes - off);
      const data = await fetchRange(off, off + len - 1);
      fh.write(data, { at: off });
      fh.flush();
      // ORDER MATTERS: the bytes are durable before the marker claims them. Written the
      // other way round, a kill between the two leaves a marker vouching for a region
      // that was never written -- the sparse-file lie, reintroduced by an optimisation.
      const m = await openHandle(dir, `${key}.done`, true);
      if (m) {
        try {
          const b = new Uint8Array(8);
          const dv = new DataView(b.buffer);
          const next = off + len;
          dv.setUint32(0, next >>> 0, true);
          dv.setUint32(4, Math.floor(next / 0x100000000), true);
          m.write(b, { at: 0 });
          m.flush();
        } finally {
          try { m.close(); } catch { /* already closed */ }
        }
      }
      onProgress?.(off + len, totalBytes);
    }
    try { fh.truncate(totalBytes); } catch { /* best effort */ }
  } catch (e) {
    try { fh.close(); } catch { /* already closed */ }
    return {
      blob: null,
      resumedBytes,
      reason: `staging failed at ${(done / 1048576).toFixed(1)} MB: `
        + (e instanceof Error ? e.message : String(e)),
    };
  }
  try { fh.close(); } catch { /* already closed */ }
  fh = null as unknown as SyncAccessHandleLike;

  // Re-open through the FILE handle: `getFile()` yields a Blob backed by the OPFS file,
  // which is the point -- wllama reads it on demand and nothing is copied into the heap.
  try {
    const fileHandle = await dir.getFileHandle(`${key}.model`, { create: false });
    const blob = await fileHandle.getFile();
    if (blob.size !== totalBytes) {
      return { blob: null, resumedBytes, reason: `staged file is ${blob.size} B, expected ${totalBytes}` };
    }
    return { blob, resumedBytes, reason: "" };
  } catch (e) {
    return {
      blob: null,
      resumedBytes,
      reason: `could not open the staged file: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export interface WasmLoadResult {
  ok: boolean;
  /** 'blob' = the bounded path. 'url' = wllama's whole-file GET, used only as a fallback. */
  path: "blob" | "url";
  compatShimApplied: boolean;
  reason: string;
}

/**
 * Load a model into wllama the bounded way, falling back EXPLICITLY.
 *
 * The fallback is `loadModelFromUrl`, which is the whole-model-in-heap path — the exact
 * thing this module exists to avoid. It is reached only where OPFS is unavailable, and it
 * is announced, because a lane that quietly took the old path would be indistinguishable
 * from one that never changed.
 */
export async function loadModelViaWasp(
  wllama: WllamaLike & { loadModelFromUrl?: (url: string, p?: unknown) => Promise<void> },
  url: string,
  totalBytes: number,
  fetchRange: RangeFetcher,
  manifest: WaspManifest | null,
  deps: WasmStageDeps = {},
  onProgress?: (bytes: number, total: number) => void,
): Promise<WasmLoadResult> {
  const log = deps.log ?? ((m: string) => console.info(m));
  let compatShimApplied = false;
  if (needsCompatShim(deps.global ?? (globalThis as JspiHost))) {
    // Without JSPI this is what makes the Blob read on demand rather than being copied
    // into the wasm heap. On iOS it is the difference between running and being killed.
    wllama.setCompat("default");
    compatShimApplied = true;
    log("wasp: no WebAssembly.Suspending — enabling wllama compat so the model is read on demand");
  }

  const staged = await stageModelToOpfs(url, totalBytes, fetchRange, manifest, deps, onProgress);
  if (staged.blob) {
    await wllama.loadModel([staged.blob]);
    return { ok: true, path: "blob", compatShimApplied, reason: staged.reason };
  }

  if (typeof wllama.loadModelFromUrl !== "function") {
    return { ok: false, path: "blob", compatShimApplied, reason: staged.reason };
  }
  log(`wasp: OPFS staging unavailable (${staged.reason}) — falling back to a whole-file `
    + `GET into the wasm heap, which is the path this lane exists to avoid`);
  await wllama.loadModelFromUrl(url);
  return { ok: true, path: "url", compatShimApplied, reason: staged.reason };
}
