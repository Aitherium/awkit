/**
 * Session memory — the browser-side retrieval lane for agent sessions.
 *
 * The design contract (owner, 2026-08-31): capture -> chunk -> embed -> query,
 * with embeddings on a CPU lane so the WebGPU device stays 100% on decode.
 * This module owns the types shared by the chunker, the store, the embedder
 * and the dedicated embedding worker.
 */

/** One retrievable unit of captured browsing content. */
export interface MemoryChunk {
  id: string
  text: string
  /** Where it came from — a URL for browsed pages, a synthetic label otherwise. */
  source?: string
  /** Human title/label of the source document. */
  sourceTitle?: string
  /** ISO 8601. The recency key. */
  capturedAt: string
  /**
   * Stable hash of the normalized chunk text. The diff-indexing half: a
   * re-capture whose chunks carry the same hash as the stored ones is skipped
   * without a single embed call — reindex cost scales with what changed, not
   * with the corpus.
   */
  contentHash?: string
  /** Optional precomputed embedding (vector store writes it after embed). */
  embedding?: number[]
}

export interface QueryOptions {
  /** How many results to return. */
  topK?: number
  /**
   * 0..1 blend of recency into the rank: 0 = pure cosine, 1 = recency fully
   * co-dominant. Default 0.25 — recency breaks ties, it does not override.
   */
  recencyBias?: number
  /** Half-life for recency decay, hours. Default 24. */
  recencyHalfLifeHours?: number
  /** Override "now" (tests). Defaults to Date.now(). */
  now?: number
}

export interface QueryResult {
  chunk: MemoryChunk
  /** Cosine similarity of the query vector to the chunk vector (0..1). */
  score: number
  /** Recency weight 0..1, after half-life decay. */
  recency: number
  /** `score + recencyBias * recency` — the rank key. */
  combined: number
}

export interface SessionMemoryStats {
  chunkCount: number
  sourceCount: number
  embedderDim: number
  embedderProvider: string
}

/** Anything that turns text into vectors. Never touches the WebGPU queue. */
export interface Embedder {
  readonly dim: number
  readonly provider: string
  /**
   * True when the real model is loaded/loadable. A stub answering `true` is a
   * test double, not a fallback — see the "no silent degradation" contract in
   * embedder.ts.
   */
  isAvailable(): boolean | Promise<boolean>
  embed(texts: string[]): Promise<number[][]>
}
