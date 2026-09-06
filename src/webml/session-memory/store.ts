/**
 * Vector store for the session-memory lane.
 *
 * Session-shaped means small: a few thousand chunks at most, so brute-force
 * cosine beats any index. The IndexedDB implementation is the browser truth;
 * the in-memory implementation exists for tests and for the embed worker
 * (which never touches the DOM). The interface is the contract — the memory
 * store keeps the worker and the host from drifting about what "stored" means.
 */

import type { MemoryChunk } from "./types"

export interface MemoryStore {
  add(chunk: MemoryChunk): Promise<void>
  addMany(chunks: MemoryChunk[]): Promise<void>
  all(): Promise<MemoryChunk[]>
  get(id: string): Promise<MemoryChunk | undefined>
  remove(id: string): Promise<void>
  clear(): Promise<void>
  count(): Promise<number>
}

const STORE_NAME = "session-memory"
const DB_NAME = "aither-session-memory"
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" })
        store.createIndex("capturedAt", "capturedAt")
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** IndexedDB-backed store. Throws a clear error when the browser has no IDB. */
export class IndexedDBMemoryStore implements MemoryStore {
  private dbPromise: Promise<IDBDatabase> | null = null

  private db(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise
    if (typeof indexedDB === "undefined") {
      this.dbPromise = Promise.reject(
        new Error("session-memory: IndexedDB is unavailable in this environment"),
      )
    } else {
      this.dbPromise = openDb()
    }
    return this.dbPromise
  }

  private tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return this.db().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, mode)
          const req = run(tx.objectStore(STORE_NAME))
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error)
        }),
    )
  }

  async add(chunk: MemoryChunk): Promise<void> {
    await this.tx("readwrite", (s) => s.put(chunk))
  }

  async addMany(chunks: MemoryChunk[]): Promise<void> {
    // One transaction, one put per chunk — `store.put(array)` would store the
    // ARRAY as a single value and fail the keyPath on the first non-object.
    const db = await this.db()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const store = tx.objectStore(STORE_NAME)
      for (const chunk of chunks) store.put(chunk)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async all(): Promise<MemoryChunk[]> {
    return this.tx("readonly", (s) => s.getAll())
  }

  async get(id: string): Promise<MemoryChunk | undefined> {
    return this.tx("readonly", (s) => s.get(id))
  }

  async remove(id: string): Promise<void> {
    await this.tx("readwrite", (s) => s.delete(id))
  }

  async clear(): Promise<void> {
    await this.tx("readwrite", (s) => s.clear())
  }

  async count(): Promise<number> {
    return this.tx("readonly", (s) => s.count())
  }
}

/** In-memory twin — tests, and the embed worker, which has no DOM. */
export class InMemoryMemoryStore implements MemoryStore {
  private chunks = new Map<string, MemoryChunk>()

  async add(chunk: MemoryChunk): Promise<void> {
    this.chunks.set(chunk.id, { ...chunk })
  }

  async addMany(chunks: MemoryChunk[]): Promise<void> {
    for (const c of chunks) this.chunks.set(c.id, { ...c })
  }

  async all(): Promise<MemoryChunk[]> {
    return [...this.chunks.values()]
  }

  async get(id: string): Promise<MemoryChunk | undefined> {
    return this.chunks.get(id)
  }

  async remove(id: string): Promise<void> {
    this.chunks.delete(id)
  }

  async clear(): Promise<void> {
    this.chunks.clear()
  }

  async count(): Promise<number> {
    return this.chunks.size
  }
}
