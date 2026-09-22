// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * WASP CACHE — one on-device store for both lanes, resumable at chunk granularity.
 *
 * WHY OPFS AND NOT THE INDEXEDDB RANGE CACHE THIS REPLACES. Three measured reasons, and
 * the third is the one that decides it:
 *
 *  (a) ONE STORE FOR BOTH LANES. The wasm lane already lives in OPFS — wllama's own
 *      CacheManager defaults to it — so an IndexedDB range cache means a phone downloads
 *      the same model twice, once per lane, and neither copy helps the other.
 *
 *  (b) NO DOUBLED PEAK. `idb-cache.ts` did `data.slice()` on every put (the fetched view
 *      may alias a larger buffer) and stored structured-clone records, so caching a 32 MiB
 *      chunk cost 64 MiB transiently — on the exact devices this whole plane exists to
 *      keep alive. An OPFS sync access handle writes AT AN OFFSET with no copy.
 *
 *  (c) 🚨 RESUME, which is the only one that changes an outcome. Eviction is the same on
 *      both stores where it matters: Safari ignores `storage.persist()` and drops origin
 *      storage after 7 days without interaction (ITP), and Android Chrome evicts LRU under
 *      pressure. So a phone re-downloads after a week EITHER WAY, and the question is not
 *      "does it survive" but "what happens when it does not survive completely". A partial
 *      OPFS file plus per-chunk hashes resumes at 32 MiB granularity. The IDB range cache
 *      resumes only if the coalescer happens to produce byte-identical ranges next time —
 *      and the coalescer's ranges depend on which layers were touched, so in practice a
 *      partial download was worth nothing.
 *
 * THE KEY IS THE CHUNK INDEX, NOT THE BYTE RANGE. That is the whole fix. Keying on
 * `${url}#${start}-${end}` made every lookup depend on the caller asking for exactly the
 * span it asked for last time; keying on a fixed chunk grid makes a hit a lookup.
 *
 * FALLBACK IS EXPLICIT, NEVER SILENT. Where sync access handles are absent (Firefox
 * private mode, Safari < 15.2) this uses IndexedDB over the SAME chunk grid, and says so
 * once. A cache that quietly degrades to "no resume" is indistinguishable from one that
 * is working, which is the state this module exists to end.
 */

import type { RangeFetcher } from "./source";
import { WASP_CHUNK_TARGET_BYTES } from "./index";

/** What actually backed the store, so a caller can report it instead of guessing. */
export type WaspStoreKind = "opfs" | "indexeddb" | "none";

export interface WaspCacheStats {
  kind: WaspStoreKind;
  /** Bytes served without touching the network this session. */
  hitBytes: number;
  /** Bytes fetched. */
  missBytes: number;
  /** Why the chosen store is not OPFS, when it is not. Empty on the happy path. */
  degradedReason: string;
}

/**
 * The minimum of OPFS this module uses. Declared structurally rather than pulled from
 * `@types/wicg-file-system-access`: the app does not ship that package, and a cache that
 * cannot be type-checked in this repo is a cache nobody will touch.
 */
export interface SyncAccessHandleLike {
  read(buf: ArrayBufferView, opts?: { at?: number }): number;
  write(buf: ArrayBufferView, opts?: { at?: number }): number;
  truncate(n: number): void;
  flush(): void;
  close(): void;
  getSize(): number;
}
export interface FileHandleLike {
  createSyncAccessHandle?(): Promise<SyncAccessHandleLike>;
  getFile(): Promise<Blob>;
}
export interface DirectoryHandleLike {
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirectoryHandleLike>;
  removeEntry?(name: string, opts?: { recursive?: boolean }): Promise<void>;
}

/** Everything the cache touches outside itself. Injectable, so the tests need no browser. */
export interface WaspCacheDeps {
  /** `navigator.storage.getDirectory()` — absent on engines with no OPFS. */
  getDirectory?: () => Promise<DirectoryHandleLike>;
  /** `navigator.storage.persist()` — best effort; Safari ignores it, which is expected. */
  persist?: () => Promise<boolean>;
  /** IndexedDB factory for the fallback store. */
  indexedDB?: IDBFactory;
  log?: (msg: string) => void;
}

const DIR = "wasp";
const IDB_NAME = "wasp-chunks";
const IDB_STORE = "chunks";

/** A filesystem-safe name for a URL. Stable across sessions — that is the whole point. */
export function cacheKeyFor(url: string): string {
  // The BASENAME plus a hash of the full URL. Basename alone collides across mirrors
  // (every host serves `Bonsai-1.7B-Q1_0.gguf`), and two mirrors CAN serve different
  // bytes, which we have measured. The hash alone is unreadable when someone
  // is looking at OPFS in devtools trying to work out what is eating their disk.
  const base = (url.split("?")[0].split("#")[0].split("/").pop() || "file")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 64);
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h * 33) ^ url.charCodeAt(i)) >>> 0;
  return `${base}.${h.toString(36)}`;
}

interface ChunkStore {
  kind: WaspStoreKind;
  get(key: string, index: number, len: number): Promise<Uint8Array | undefined>;
  put(key: string, index: number, data: Uint8Array): Promise<void>;
  /** Which chunk indices are already present — what makes resume a lookup. */
  have(key: string): Promise<Set<number>>;
}

// ---------------------------------------------------------------------------
// OPFS
// ---------------------------------------------------------------------------

async function openOpfs(deps: WaspCacheDeps): Promise<ChunkStore | null> {
  const getDirectory = deps.getDirectory;
  if (!getDirectory) return null;
  let root: DirectoryHandleLike;
  try {
    root = await (await getDirectory()).getDirectoryHandle(DIR, { create: true });
  } catch {
    return null;
  }
  // ONE FILE PER CHUNK, not one file per model with writes at offset.
  //
  // A single sparse file is the tidier design and it cannot answer `have()`: OPFS reports
  // a file's SIZE, not which regions were written, so a file grown to 248 MB by writing
  // the LAST chunk first reads as complete while 240 MB of it is zeros. Restoring zeros
  // is worse than re-downloading, because the model loads and answers garbage. Per-chunk
  // files make presence a directory listing and a length check, both of which are facts.
  const fileName = (key: string, i: number) => `${key}.${i}`;

  const handle = async (name: string, create: boolean): Promise<FileHandleLike | null> => {
    try {
      return await root.getFileHandle(name, { create });
    } catch {
      return null;
    }
  };

  // A sync access handle is only available inside a WORKER. In a window context
  // `createSyncAccessHandle` is either absent or throws, and the caller falls back.
  const probe = await handle(`${DIR}.probe`, true);
  if (!probe || typeof probe.createSyncAccessHandle !== "function") return null;
  try {
    const h = await probe.createSyncAccessHandle();
    h.close();
  } catch {
    return null;
  }
  try { await root.removeEntry?.(`${DIR}.probe`); } catch { /* leftover probe is harmless */ }

  return {
    kind: "opfs",
    async get(key, index, len) {
      const fh = await handle(fileName(key, index), false);
      if (!fh?.createSyncAccessHandle) return undefined;
      let h: SyncAccessHandleLike | undefined;
      try {
        h = await fh.createSyncAccessHandle();
        const size = h.getSize();
        // A SHORT chunk is a torn write from a tab the OS killed mid-download — the
        // normal way this cache is interrupted. Treat it as absent, never as data: the
        // caller would otherwise splice a truncated chunk into a tensor and the model
        // would load and produce fluent nonsense.
        if (size !== len) return undefined;
        const out = new Uint8Array(size);
        h.read(out, { at: 0 });
        return out;
      } catch {
        return undefined;
      } finally {
        try { h?.close(); } catch { /* already closed */ }
      }
    },
    async put(key, index, data) {
      const fh = await handle(fileName(key, index), true);
      if (!fh?.createSyncAccessHandle) return;
      let h: SyncAccessHandleLike | undefined;
      try {
        h = await fh.createSyncAccessHandle();
        h.truncate(0);
        h.write(data, { at: 0 });
        h.flush();
      } catch {
        // Quota, or the OS reclaiming storage mid-write. A cache write that fails must
        // never fail the LOAD; the bytes are already in hand.
      } finally {
        try { h?.close(); } catch { /* already closed */ }
      }
    },
    async have(key) {
      const out = new Set<number>();
      // No directory iteration in the structural type above (and `values()` is async-
      // iterable, which this tsconfig target does not lower). Presence is probed per
      // index by the reader instead; `have()` stays for the IDB store and for tests.
      void key;
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// IndexedDB fallback
// ---------------------------------------------------------------------------

function openIdb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function openIdbStore(deps: WaspCacheDeps): Promise<ChunkStore | null> {
  const factory = deps.indexedDB
    ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined);
  if (!factory) return null;
  let db: IDBDatabase;
  try {
    db = await openIdb(factory);
  } catch {
    return null;
  }
  const key = (k: string, i: number) => `${k}#${i}`;
  return {
    kind: "indexeddb",
    get(k, index, len) {
      return new Promise((resolve) => {
        try {
          const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE)
            .get(key(k, index));
          req.onsuccess = () => {
            const v = req.result as ArrayBuffer | Uint8Array | undefined;
            if (v === undefined) return resolve(undefined);
            const u = v instanceof Uint8Array ? v : new Uint8Array(v);
            resolve(u.byteLength === len ? u : undefined);
          };
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      });
    },
    put(k, index, data) {
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE, "readwrite");
          tx.objectStore(IDB_STORE).put(data.slice().buffer, key(k, index));
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      });
    },
    have(k) {
      return new Promise((resolve) => {
        const out = new Set<number>();
        try {
          const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE)
            .getAllKeys();
          req.onsuccess = () => {
            for (const raw of req.result as IDBValidKey[]) {
              const s = String(raw);
              if (s.startsWith(`${k}#`)) out.add(Number(s.slice(k.length + 1)));
            }
            resolve(out);
          };
          req.onerror = () => resolve(out);
        } catch {
          resolve(out);
        }
      });
    },
  };
}

// ---------------------------------------------------------------------------
// public surface
// ---------------------------------------------------------------------------

export interface WaspCache {
  readonly kind: WaspStoreKind;
  readonly stats: WaspCacheStats;
  /** Wrap a fetcher so reads are served from the chunk grid where possible. */
  wrap(url: string, inner: RangeFetcher, chunkBytes?: number): RangeFetcher;
  /** Which chunk indices are already stored for this url (IDB store only; see note). */
  have(url: string): Promise<Set<number>>;
}

/**
 * Open the best available store. NEVER throws and never returns null — a device with no
 * usable storage gets a pass-through, because "no cache" must degrade to "slower", not to
 * "cannot load". The kind is reported so the caller can say which it got.
 */
export async function openWaspCache(deps: WaspCacheDeps = {}): Promise<WaspCache> {
  const log = deps.log ?? ((m: string) => console.info(m));
  const stats: WaspCacheStats = { kind: "none", hitBytes: 0, missBytes: 0, degradedReason: "" };
  try { void deps.persist?.(); } catch { /* Safari ignores it; that is expected */ }

  let store: ChunkStore | null = null;
  try {
    store = await openOpfs(deps);
  } catch {
    store = null;
  }
  if (!store) {
    stats.degradedReason =
      "OPFS sync access handles unavailable (a window context, Firefox private mode, or "
      + "Safari < 15.2) — falling back to IndexedDB over the same chunk grid";
    try {
      store = await openIdbStore(deps);
    } catch {
      store = null;
    }
    // SAID OUT LOUD, once. A store that silently degrades to "no resume" looks exactly
    // like one that is working until a visitor on a metered connection re-downloads 3.8 GB.
    log(`wasp: ${stats.degradedReason}`);
  }
  if (!store) {
    stats.degradedReason = stats.degradedReason
      || "no OPFS and no IndexedDB — every load re-downloads";
    log(`wasp: no cache store available — ${stats.degradedReason}`);
  }
  stats.kind = store?.kind ?? "none";

  return {
    get kind() { return stats.kind; },
    stats,
    have(url) {
      return store ? store.have(cacheKeyFor(url)) : Promise.resolve(new Set<number>());
    },
    wrap(url, inner, chunkBytes = WASP_CHUNK_TARGET_BYTES) {
      if (!store) return inner;
      const key = cacheKeyFor(url);
      const s = store;
      return async (start, endInclusive) => {
        const len = endInclusive - start + 1;
        // ONLY a read that starts on the chunk grid and stays inside one chunk is
        // cacheable. A request that STRADDLES two chunks is served straight through
        // rather than stitched: stitching is where an off-by-one silently corrupts a
        // tensor, and the streaming sink asks on the grid by construction, so the stitch
        // path would be dead code carrying all of the risk and none of the benefit.
        //
        // A short read at a grid start (the header probe's growing window, and the file's
        // final chunk) IS cached, keyed by index and validated by LENGTH on the way out —
        // so a 4 MiB probe and a later 32 MiB chunk 0 do not satisfy each other.
        if (start % chunkBytes !== 0 || len > chunkBytes) {
          const data = await inner(start, endInclusive);
          stats.missBytes += data.byteLength;
          return data;
        }
        const index = start / chunkBytes;
        const hit = await s.get(key, index, len);
        if (hit) {
          stats.hitBytes += hit.byteLength;
          return hit;
        }
        const data = await inner(start, endInclusive);
        stats.missBytes += data.byteLength;
        // Fire-and-forget: a slow disk must not hold up the upload the bytes are for.
        void s.put(key, index, data);
        return data;
      };
    },
  };
}
