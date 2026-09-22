/**
 * Session-memory's view onto the kit's sleep-time consolidation.
 *
 * `MemoryChunk` keys recency by ISO `capturedAt` and calls its vector `embedding`;
 * the kit core (`../sleep-time-memory.ts`) wants `timestamp` + `vector`. This adapter is
 * that mapping and nothing else — the rules live in ONE place, and this file cannot
 * drift from them because it carries none.
 */

import type { MemoryStore } from "./store"
import type { MemoryChunk } from "./types"
import type { MemoryRow, SleepTimeStore } from "../sleep-time-memory"

export type ChunkRow = MemoryRow<string> & { chunk: MemoryChunk }

export function chunkToRow(c: MemoryChunk): ChunkRow {
  const ms = Date.parse(c.capturedAt)
  return {
    id: c.id,
    text: c.text,
    vector: c.embedding,
    timestamp: Number.isFinite(ms) ? ms : 0,
    updateQueue: c.updateQueue,
    tombstoned: c.tombstoned,
    supersededBy: c.supersededBy,
    tombstonedAt: c.tombstonedAt,
    consolidatedAt: c.consolidatedAt,
    chunk: c,
  }
}

export function rowToChunk(r: ChunkRow): MemoryChunk {
  return {
    ...r.chunk,
    id: r.id,
    text: r.text,
    embedding: r.vector,
    updateQueue: r.updateQueue,
    tombstoned: r.tombstoned,
    supersededBy: r.supersededBy,
    tombstonedAt: r.tombstonedAt,
    consolidatedAt: r.consolidatedAt,
  }
}

/** A `SleepTimeStore` over any session-memory `MemoryStore`. `put` is the store's own
 *  `add`, which is an IndexedDB `put` (replace by id). */
export function sessionMemorySleepStore(store: MemoryStore): SleepTimeStore<ChunkRow> {
  return {
    async all() {
      return (await store.all()).map(chunkToRow)
    },
    async put(row) {
      await store.add(rowToChunk(row))
    },
  }
}
