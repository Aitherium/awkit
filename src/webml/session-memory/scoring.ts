/**
 * Scoring for the session-memory lane — pure math, fully deterministic.
 *
 * Cosine for the vector half, exponential decay for the recency half, and a
 * `recencyBias` blend that lets recency break ties without overriding content.
 */

import type { MemoryChunk, QueryOptions, QueryResult } from "./types"

/** Cosine similarity of two equal-length vectors; 0 for either zero vector. */
export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** Exponential recency decay: 1.0 at capture, 0.5 after one half-life. */
export function recencyWeight(capturedAt: string, nowMs: number, halfLifeHours = 24): number {
  const ageHours = (nowMs - Date.parse(capturedAt)) / 3_600_000
  if (!Number.isFinite(ageHours) || ageHours <= 0) return 1
  return Math.pow(0.5, ageHours / halfLifeHours)
}

export interface RankInput {
  chunks: MemoryChunk[]
  queryVector: number[]
  opts: Required<Pick<QueryOptions, "topK" | "recencyBias" | "recencyHalfLifeHours" | "now">>
}

/**
 * Rank chunks against a query vector. Chunks without an embedding are skipped
 * (they were never embedded — never scored, never returned).
 */
export function rankChunks(input: RankInput): QueryResult[] {
  const results: QueryResult[] = []
  for (const chunk of input.chunks) {
    if (!chunk.embedding || chunk.embedding.length === 0) continue
    const score = cosine(input.queryVector, chunk.embedding)
    const recency = recencyWeight(chunk.capturedAt, input.opts.now, input.opts.recencyHalfLifeHours)
    results.push({ chunk, score, recency, combined: score + input.opts.recencyBias * recency })
  }
  results.sort((a, b) => b.combined - a.combined)
  return results.slice(0, input.opts.topK)
}

export function resolveQueryOptions(opts: QueryOptions): RankInput["opts"] {
  return {
    topK: opts.topK ?? 5,
    recencyBias: Math.max(0, Math.min(1, opts.recencyBias ?? 0.25)),
    recencyHalfLifeHours: opts.recencyHalfLifeHours ?? 24,
    now: opts.now ?? Date.now(),
  }
}
