/**
 * Embedders for the session-memory lane.
 *
 * The CPU-lane contract (owner design, 2026-08-31): embeddings never touch the
 * WebGPU queue, so decode keeps the device. Two implementations:
 *
 *  - StubEmbedder       — deterministic, hash-based, DIM=1024. Tests and offline
 *                         development ONLY. Its provider string is "stub" so a
 *                         caller can prove it is NOT retrieving on real
 *                         semantics — a stub answer is never silently
 *                         presented as a real one (the no-silent-degradation
 *                         rule: a fallback that returns plausible garbage is
 *                         worse than a loud refusal).
 *  - MicroEmbedder — the real lane. Loads a tiny embedding model (the
 *                         30–80M class) from the weight mirror and runs it in
 *                         WASM on a CPU worker. Until a model is REGISTERED in
 *                         the mirror config this embedder answers
 *                         isAvailable()=false and embed() throws with the
 *                         exact missing piece named — a lane that refuses is
 *                         a visible decision, not a broken feature.
 */

import type { Embedder } from "./types"
import { fnv1a } from "./chunk"

function normalize(vector: number[]): number[] {
  let norm = 0
  for (const v of vector) norm += v * v
  norm = Math.sqrt(norm)
  if (norm === 0) return vector
  return vector.map((v) => v / norm)
}

export class StubEmbedder implements Embedder {
  // 1024, not 16/64/128: the stub is a test double whose job is deterministic
  // distinctiveness. At small dims the FNV collision lottery lets unrelated
  // docs out-score related ones (measured: at dim 64, "kalshi"/"morning"
  // collided onto the "fast" dim with combined weight 5 > 6 spread across 3
  // dims, and the wrong doc ranked first). At 1024, test-sized vocabularies
  // score 0.0000 for non-overlapping docs while overlapping docs keep a real
  // signal — and the outcome is pinned forever because the hashes are fixed.
  readonly dim = 1024
  readonly provider = "stub"

  isAvailable(): boolean {
    return true
  }

  /** Bag-of-words FNV hashes into a normalized 16-d vector. Deterministic. */
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vector = new Array<number>(this.dim).fill(0)
      for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
        if (word.length === 0) continue
        const h = fnv1a(word)
        vector[h % this.dim] += 1 + (h >>> 8) % 3
      }
      return normalize(vector)
    })
  }
}

export interface MicroEmbedderConfig {
  /** Full URL of the GGUF/safetensors file on the weight mirror. */
  url: string
  /** The mirror's model id — the same id the worker registry would name. */
  modelId: string
  /** Embedding dimension the model emits. */
  dim: number
  /** transformers.js `model_file_name`: the ONNX stem under onnx/ (default "model"). A
   *  release-unique stem keeps a same-named file in another release from answering. */
  modelFile?: string
}

/**
 * The real CPU lane. The model is loaded lazily through the transformers.js
 * runtime the shared brain already uses — no hand-rolled inference backend.
 * While `config` is unset, the lane is a loud refusal, not a silent stub.
 */
export class MicroEmbedder implements Embedder {
  readonly provider = "microembedder"
  private model: import("@huggingface/transformers").FeatureExtractionFn | null = null

  constructor(private config: MicroEmbedderConfig | null) {}

  get dim(): number {
    return this.config?.dim ?? 0
  }

  isAvailable(): boolean {
    return this.config !== null
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.config) {
      throw new Error(
        "session-memory: MicroEmbedder has no model registered. " +
          "Register a tiny embedding model in the mirror config (mirror URL + modelId + dim) " +
          "to arm the real lane; until then callers must treat embeddings as unavailable.",
      )
    }
    if (!this.model) {
      // Lazy-load through the shared transformers.js runtime (the same one the
      // Bonsai worker uses). The mirror entry MUST be an ONNX-exported tiny
      // embedding model (transformers.js cannot run GGUF). The weight bytes
      // come from OUR mirror (the awrtifact lane), never a third-party weight
      // host, per the weight-mirror doctrine. The mirror serves the
      // /<release>/ prefix route (artifact.aitherium.com/microembedder-v1/<file>),
      // so the template maps {file} into that namespace. A model that is not
      // ONNX or not mirrored refuses here.
      try {
        const { env, pipeline } = await import("@huggingface/transformers")
        // Derive host + release prefix from the ONE config URL, so switching the model
        // (microembedder-v1 -> v2, 2026-09-03) is a change to SESSION_MEMORY_MODEL only.
        const mirror = new URL(this.config.url)
        env.remoteHost = mirror.origin
        env.remotePathTemplate = `${mirror.pathname.replace(/^\/+|\/+$/g, "")}/{file}`
        this.model = await pipeline("feature-extraction", this.config.modelId, {
          device: "wasm",
          dtype: "q8",
          ...(this.config.modelFile ? { model_file_name: this.config.modelFile } : {}),
          local_files_only: false,
          cache_dir: "aither-session-memory",
        })
      } catch (err) {
        throw new Error(
          `session-memory: could not load mirror model ${this.config.modelId} — ` +
            `the mirror entry must be an ONNX tiny embedding model reachable at ` +
            `${this.config.url} (${err instanceof Error ? err.message : String(err)})`,
        )
      }
    }
    const out = await this.model(texts, { pooling: "mean" })
    const rows: number[][] = []
    const stride = out.dims[1] ?? out.dims[0] ?? this.config.dim
    for (let i = 0; i < texts.length; i += 1) {
      const start = i * stride
      rows.push(normalize(Array.from(out.data.slice(start, start + stride))))
    }
    return rows
  }
}

/**
 * The un-armed state. NOT a stub: a stub returns plausible vectors and every
 * downstream signal agrees retrieval works. This REFUSES, so an un-armed lane
 * is a visible decision — `provider: "unavailable"` appears in stats and the
 * worker reports embed-error instead of vectors.
 */
export class UnavailableEmbedder implements Embedder {
  readonly dim = 0
  readonly provider = "unavailable"

  isAvailable(): boolean {
    return false
  }

  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error(
      "session-memory: no embedding model is registered on the mirror — the lane is unarmed. " +
        "Register a tiny embedding model (MicroEmbedderConfig) to arm it.",
    )
  }
}

/** Factory the worker and the host both use — one source of truth. */
export function createMicroEmbedder(config: MicroEmbedderConfig | null): Embedder {
  if (config) return new MicroEmbedder(config)
  return new UnavailableEmbedder()
}
