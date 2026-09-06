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
 * Persistent byte-range cache for the GGUF weights. Chrome refuses to keep a ~3.8 GB file
 * (or its range responses) in the ordinary HTTP cache, so every visit re-streams it. This
 * stores each fetched range in IndexedDB — which has real quota, especially once persistent
 * storage is granted — keyed by url + byte range. The coalesced layer ranges are identical
 * across sessions, so after the first (unavoidable) download every reload is a cache hit.
 *
 * Everything degrades gracefully: any IDB error falls back to the network fetcher. Works in
 * the worker context (IndexedDB is available there).
 */

import type { RangeFetcher } from "./reader";

const DB_NAME = "bonsai-weights";
const STORE = "ranges";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(db: IDBDatabase, key: string): Promise<Uint8Array | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => {
      const v = req.result as ArrayBuffer | Uint8Array | undefined;
      if (v === undefined) resolve(undefined);
      else resolve(v instanceof Uint8Array ? v : new Uint8Array(v));
    };
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, data: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    // Store a standalone ArrayBuffer copy (the fetched view may alias a larger buffer).
    const copy = data.slice();
    tx.objectStore(STORE).put(copy.buffer, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Wrap a RangeFetcher with an IndexedDB read-through cache. On a hit the network is never
 * touched; on a miss the range is fetched and stored (fire-and-forget). Any IDB failure is
 * swallowed and the underlying fetcher is used, so this can only make things faster, never
 * break loading. `onCached` reports bytes served from cache vs network for UI progress.
 */
export function cachedRangeFetcher(
  url: string,
  inner: RangeFetcher,
  onCached?: (info: { bytes: number; fromCache: boolean }) => void,
): RangeFetcher {
  let dbPromise: Promise<IDBDatabase | null> | null = null;
  const getDb = (): Promise<IDBDatabase | null> => {
    if (!dbPromise) {
      // Ask for persistent storage so the browser won't evict the 3.8 GB under pressure.
      try { void navigator.storage?.persist?.(); } catch { /* not available */ }
      dbPromise = openDb().catch(() => null);
    }
    return dbPromise;
  };

  return async (start, endInclusive) => {
    const key = `${url}#${start}-${endInclusive}`;
    const db = await getDb();
    if (db) {
      try {
        const hit = await idbGet(db, key);
        if (hit) {
          onCached?.({ bytes: hit.byteLength, fromCache: true });
          return hit;
        }
      } catch { /* fall through to network */ }
    }
    const data = await inner(start, endInclusive);
    onCached?.({ bytes: data.byteLength, fromCache: false });
    if (db) void idbPut(db, key, data).catch(() => { /* quota/full — ignore */ });
    return data;
  };
}
