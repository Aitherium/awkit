/**
 * SessionMemory — the facade of the session-memory lane.
 *
 * capture(text | page) -> chunk -> embed -> store
 * query(text)          -> embed -> score -> topK, recency-aware
 *
 * The host wires one embedder (CPU lane) and one store; this class owns the
 * pipeline order. Embedding goes through the dedicated embed worker by
 * default (`worker?: Worker`), or runs inline when the host passes an
 * embedder directly — the two paths are interchangeable because both produce
 * `number[][]` through the same Embedder contract.
 */

import { chunkText, contentHash } from "./chunk"
import { rankChunks, resolveQueryOptions } from "./scoring"
import type { Embedder, MemoryChunk, QueryOptions, QueryResult, SessionMemoryStats } from "./types"
import type { MemoryStore } from "./store"
import type { CaptureInput, CaptureResult } from "./capture"
import { captureText } from "./capture"

export interface SessionMemoryOptions {
  store: MemoryStore
  /** Inline embedder (tests, or a host that wants embeddings inline on the CPU). */
  embedder?: Embedder
  /** Dedicated embedding Worker; when present it wins over `embedder`. */
  worker?: Worker
  chunk?: { maxChars?: number; overlap?: number }
}

export interface CaptureDiffReport {
  added: number
  updated: number
  unchanged: number
  /** Chunks this source no longer produces — removed so a rewritten page never leaves stale retrievable units. */
  removed: number
  embedded: number
  skippedEmbeds: number
}

function newChunkId(source: string | undefined, index: number): string {
  // Stable-ish ids: source slug + chunk index. Re-capturing the same page
  // upserts rather than duplicating — the store is keyed by id.
  const slug = (source ?? "session")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(-48)
  return `${slug}--${index}`
}

export class SessionMemory {
  private readonly store: MemoryStore
  private readonly embedder?: Embedder
  private readonly worker?: Worker
  private readonly chunkOpts: { maxChars?: number; overlap?: number }
  private pending = new Map<
    string,
    { resolve: (v: number[][]) => void; reject: (e: Error) => void }
  >()

  constructor(opts: SessionMemoryOptions) {
    this.store = opts.store
    this.embedder = opts.embedder
    this.worker = opts.worker
    this.chunkOpts = opts.chunk ?? {}
    if (this.worker) {
      this.worker.onmessage = (event: MessageEvent) => this.handleWorkerMessage(event.data)
      this.worker.onerror = (event: ErrorEvent) => {
        const error = new Error(`session-memory: embed worker failed — ${event.message}`)
        for (const entry of this.pending.values()) entry.reject(error)
        this.pending.clear()
      }
    }
  }

  private handleWorkerMessage(msg: {
    type: string
    requestId?: string
    vectors?: number[][]
    error?: string
  }): void {
    const entry = msg.requestId ? this.pending.get(msg.requestId) : undefined
    if (!entry) return
    this.pending.delete(msg.requestId!)
    if (msg.type === "embed-result") {
      // The worker never sends an empty vectors array for a success — a 0-row
      // reply IS the refusal, so a caller cannot mistake it for "nothing to
      // embed".
      if (!msg.vectors || msg.vectors.length === 0) {
        entry.reject(new Error("session-memory: embed worker returned no vectors"))
        return
      }
      entry.resolve(msg.vectors)
    } else if (msg.type === "embed-error") {
      // The lane refused loudly (unarmed embedder). Surface the refusal as an
      // error — never as an empty result — so callers cannot mistake it for
      // "no matches".
      entry.reject(new Error(`session-memory: ${msg.error ?? "embed failed"}`))
    }
  }

  private embed(texts: string[]): Promise<number[][]> {
    if (this.worker) {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      return new Promise<number[][]>((resolve, reject) => {
        this.pending.set(requestId, { resolve, reject })
        this.worker?.postMessage({ type: "embed", requestId, texts })
      })
    }
    if (!this.embedder) {
      return Promise.reject(
        new Error("session-memory: no embedder and no worker — the lane is not wired"),
      )
    }
    return this.embedder.embed(texts)
  }

  /** Capture a page/browse payload, chunk, embed, store. Returns the stored chunks. */
  async capture(input: CaptureInput | CaptureResult, opts: { now?: number } = {}): Promise<MemoryChunk[]> {
    const result: CaptureResult = "text" in input ? (input as CaptureResult) : captureText(input)
    const texts = chunkText(result.text, this.chunkOpts)
    if (texts.length === 0) return []
    const vectors = await this.embed(texts)
    const now = opts.now ?? Date.now()
    const chunks: MemoryChunk[] = texts.map((text, i) => ({
      id: newChunkId(result.url ?? result.title, i),
      text,
      source: result.url,
      sourceTitle: result.title,
      capturedAt: new Date(now).toISOString(),
      contentHash: contentHash(text),
      embedding: vectors[i],
    }))
    await this.store.addMany(chunks)
    return chunks
  }

  /**
   * Diff-indexing capture: re-embed ONLY the chunks whose content changed.
   *
   * The freshness lever — a re-capture of the same page costs one store read
   * and zero embed calls when nothing changed; when one section changed, only
   * that chunk is re-embedded and the rest keep their stored embeddings. The
   * embed count is the number that must stay small: it is the expensive half
   * (model inference), the store read is the cheap half (session-sized).
   */
  async captureDiff(input: CaptureInput | CaptureResult, opts: { now?: number } = {}): Promise<{
    chunks: MemoryChunk[]
    report: CaptureDiffReport
  }> {
    const result: CaptureResult = "text" in input ? (input as CaptureResult) : captureText(input)
    const base = result.url ?? result.title
    const texts = chunkText(result.text, this.chunkOpts)
    if (texts.length === 0) {
      // Page produced nothing — its previous chunks are stale by definition.
      const existing = (await this.store.all()).filter((c) => (c.source ?? c.sourceTitle) === base)
      for (const c of existing) await this.store.remove(c.id)
      return {
        chunks: [],
        report: { added: 0, updated: 0, unchanged: 0, removed: existing.length, embedded: 0, skippedEmbeds: 0 },
      }
    }

    const existing = (await this.store.all()).filter((c) => (c.source ?? c.sourceTitle) === base)
    const existingById = new Map(existing.map((c) => [c.id, c]))

    const fresh: { text: string; hash: string; id: string; index: number }[] = []
    const unchangedChunks: MemoryChunk[] = []
    let unchanged = 0
    texts.forEach((text, index) => {
      const id = newChunkId(base, index)
      const hash = contentHash(text)
      const stored = existingById.get(id)
      if (stored && stored.contentHash === hash) {
        unchanged += 1
        unchangedChunks.push(stored)
        return
      }
      fresh.push({ text, hash, id, index })
    })

    // Stale = this source's chunks the new page no longer produces. A
    // rewritten page that shrinks must not leave retrievable units that do
    // not exist — that is the staleness diff-indexing exists to prevent.
    const freshIds = new Set(fresh.map((f) => f.id))
    const stale = existing.filter((c) => !freshIds.has(c.id))
    for (const c of stale) await this.store.remove(c.id)

    if (fresh.length === 0) {
      // Whole page unchanged — zero embed calls; refresh recency only.
      const now = opts.now ?? Date.now()
      const refreshed = existing.map((c) => ({ ...c, capturedAt: new Date(now).toISOString() }))
      await this.store.addMany(refreshed)
      return {
        chunks: refreshed,
        report: { added: 0, updated: 0, unchanged: texts.length, removed: 0, embedded: 0, skippedEmbeds: texts.length },
      }
    }

    const vectors = await this.embed(fresh.map((f) => f.text))
    const now = opts.now ?? Date.now()
    const chunks: MemoryChunk[] = []
    let updated = 0
    let added = 0
    fresh.forEach((f, i) => {
      const wasStored = existingById.has(f.id)
      if (wasStored) updated += 1
      else added += 1
      chunks.push({
        id: f.id,
        text: f.text,
        source: result.url,
        sourceTitle: result.title,
        capturedAt: new Date(now).toISOString(),
        contentHash: f.hash,
        embedding: vectors[i],
      })
    })
    // Write the fresh chunks; the unchanged ones keep their stored embeddings
    // untouched (only their ids are re-listed in the returned set); the stale
    // ones were removed above. Never re-store an old copy of a freshly
    // embedded chunk — that would duplicate it (measured 2026-08-31).
    await this.store.addMany(chunks)
    return {
      chunks: chunks.concat(unchangedChunks),
      report: { added, updated, unchanged, removed: stale.length, embedded: vectors.length, skippedEmbeds: unchanged },
    }
  }

  /** Query the session memory; recency-aware ranking. */
  async query(text: string, opts: QueryOptions = {}): Promise<QueryResult[]> {
    const queryVector = (await this.embed([text]))[0]
    if (!queryVector) return []
    const chunks = await this.store.all()
    return rankChunks({
      chunks,
      queryVector,
      opts: resolveQueryOptions(opts),
    })
  }

  async stats(): Promise<SessionMemoryStats> {
    const chunks = await this.store.all()
    const sources = new Set(chunks.map((c) => c.source ?? "session").filter(Boolean))
    const dim = this.embedder?.dim ?? 0
    return {
      chunkCount: chunks.length,
      sourceCount: sources.size,
      embedderDim: dim,
      embedderProvider: this.embedder?.provider ?? (this.worker ? "worker" : "unwired"),
    }
  }

  async clear(): Promise<void> {
    await this.store.clear()
  }
}

export * from "./types"
export * from "./chunk"
export * from "./scoring"
export * from "./store"
export * from "./embedder"
export * from "./capture"
