/**
 * The on-device CODE-SEARCH embedder — the pure half of the lane.
 *
 * `aither-code-embed` is a Qwen3-Embedding-0.6B student distilled for code search:
 * 1024-dim, L2-normalised, LAST-token pooled, and ASYMMETRIC — a query carries an
 * instruction prefix and a document carries none. Every one of those is a fact about
 * the weights, not a preference, and getting any of them wrong does not raise: the
 * embedder returns a fluent-looking vector that ranks the wrong directory first.
 * That is why the preparation and the normalisation live HERE, as pure functions with
 * a test, rather than inline in the worker where nothing can exercise them.
 *
 * Nothing in this file touches a Worker, WASM or the network: it is what the worker
 * (`AitherVeil/src/components/os/code-embed-wasm-worker.ts`) and any host that speaks
 * its protocol import, and it stays importable on the main thread and under jest.
 *
 * Wire protocol (mirrors `session-memory/embed.worker.ts`, plus a `mode`):
 *   in:  { type: "embed", requestId, texts: string[], mode: "query" | "document" }
 *   out: { type: "embed-result", requestId, vectors, provider, dim }
 *        | { type: "embed-error", requestId, error }
 * The load half reuses the shared `WorkerRequest`/`WorkerResponse` shapes from
 * `./protocol` (`load` in; `progress` / `ready` / `error` out).
 */

import type { WorkerRequest, WorkerResponse } from "./protocol";

export type CodeEmbedMode = "query" | "document";

/**
 * The model, as measured. `sizeMb` is the Q4_K_M browser weight (396,469,856 bytes);
 * fidelity 0.985-0.99 against fp32. The tokenizer appends `<|endoftext|>` itself
 * (GGUF add_eos_token=true) and the GGUF carries pooling_type=LAST, so a runtime loading
 * it with pooling UNSPECIFIED pools correctly without being told.
 */
export const CODE_EMBED_MODEL = {
  id: "aither-code-embed",
  url: "https://artifact.aitherium.com/aither-code-embed-v1/aither-code-embed.q4_k_m.gguf",
  sizeMb: 378,
  dim: 1024,
  /** Exactly this, real newline included — it is what the student was trained on. */
  queryPrefix:
    "Instruct: Given a code search question, retrieve the directory summary that answers it\nQuery: ",
} as const;

/**
 * GobboNet's RAG client (upstream `08-rag.js`) prepends nomic-style role prefixes to
 * every string before it reaches `/embed/v1/embeddings`. They are the WRONG prefixes for
 * this model, and leaving one in place is a silent quality loss — the text still embeds,
 * it just embeds "search_document: <text>". Stripped here so the mode carries the intent
 * and the model sees only its own prefix (or none).
 */
export const NOMIC_PREFIXES: readonly string[] = ["search_query: ", "search_document: "];

/** Strip a leading nomic role prefix, if any. Exported so the mode derivation can reuse it. */
export function stripNomicPrefix(text: string): string {
  for (const p of NOMIC_PREFIXES) {
    if (text.startsWith(p)) return text.slice(p.length);
  }
  return text;
}

/**
 * Prepare one text for the embedder.
 *
 * - `query`    → instruction prefix + text (asymmetric retrieval: this is load-bearing).
 * - `document` → the text as-is.
 * A leading nomic prefix is removed first in BOTH modes.
 *
 * Throws on empty / whitespace-only input: an empty string still embeds to a real-looking
 * vector, and a caller that averaged it in would never know. Refusing is the honest answer.
 */
export function codeEmbedPrepare(text: string, mode: CodeEmbedMode): string {
  if (typeof text !== "string") throw new Error("code-embed: input must be a string");
  const body = stripNomicPrefix(text);
  if (!body.trim()) throw new Error("code-embed: refusing to embed an empty text");
  if (mode === "query") return CODE_EMBED_MODEL.queryPrefix + body;
  if (mode === "document") return body;
  throw new Error(`code-embed: unknown mode ${String(mode)}`);
}

/**
 * L2-normalise a vector so cosine similarity is a plain dot product.
 *
 * Done here, not trusted to the runtime: wllama returns whatever llama.cpp pooled, and
 * whether that is already unit-length depends on a flag nobody reads. A vector of zero or
 * non-finite norm is refused — it is not an embedding, and dividing by it would manufacture
 * NaNs that compare equal to nothing and sort to the top of some ranker.
 */
export function l2Normalize(v: number[]): number[] {
  if (!Array.isArray(v) || v.length === 0) throw new Error("code-embed: cannot normalise an empty vector");
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error("code-embed: vector has zero or non-finite norm — the embedder returned nothing usable");
  }
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

// ── ONNX assets on the mirror (the WebGPU lane) ────────────────────────────────────────

/**
 * The mirror serves whole files under FLAT, model-prefixed names — its name map is flat
 * across releases, and a bare `config.json` collided with another model's (measured
 * 2026-09-02). transformers.js asks for `<model>/config.json`, `<model>/tokenizer.json`,
 * `<model>/onnx/model_<dtype>.onnx`; this table maps each request onto the asset that
 * exists on the release. Anything NOT listed is optional to transformers.js
 * (generation_config.json, quantize_config.json) and is answered 404 by the mirror.
 *
 * The WebGPU worker runs dtype `q4` → `onnx/model_q4.onnx` (measured 2026-09-03: fp16 and
 * q4f16 both compute all-zero on the ORT-web WebGPU EP; the fp32-graph q4 is the one that
 * works). `model_fp16.onnx` stays mapped for the WASM/CPU device, where fp16 is correct.
 * `model_q4f16.onnx` was NEVER uploaded (it 404s and its dtype zeros anyway) — not mapped.
 */
export const CODE_EMBED_ONNX_ASSETS: Readonly<Record<string, string>> = {
  "config.json": "aither-code-embed.config.json",
  "tokenizer.json": "aither-code-embed.tokenizer.json",
  "tokenizer_config.json": "aither-code-embed.tokenizer_config.json",
  "special_tokens_map.json": "aither-code-embed.special_tokens_map.json",
  "onnx/model_q4.onnx": "aither-code-embed.model_q4.onnx",
  "onnx/model_fp16.onnx": "aither-code-embed.model_fp16.onnx",
};

/** The model key transformers.js is given; `{model}` in its remotePathTemplate. */
export const CODE_EMBED_ONNX_MODEL_KEY = "aither-code-embed";

/**
 * Rewrite one transformers.js fetch URL onto the mirror's flat asset name. Returns the
 * URL unchanged when it is not under `<base>/<model key>/` (other fetches pass through).
 * Query strings are dropped from the matched path so `?download=true` cannot defeat the map.
 */
export function codeEmbedOnnxAssetUrl(base: string, url: string): string {
  const root = base.replace(/\/+$/, "");
  const prefix = root + "/" + CODE_EMBED_ONNX_MODEL_KEY + "/";
  if (!url.startsWith(prefix)) return url;
  const rel = url.slice(prefix.length).split("?")[0];
  return root + "/" + (CODE_EMBED_ONNX_ASSETS[rel] ?? rel);
}

/**
 * Download a URL in Range chunks and assemble one Blob. The mirror's whole-file proxy
 * (no Range) streams Cloudflare→GitHub and TRUNCATES mid-transfer on large files —
 * measured 2026-09-02, the 396 MB GGUF came back 26-66 MB, a different length each time,
 * always HTTP 200 with no Content-Length. Range requests are served whole and correct
 * from R2 (206 with an exact Content-Range), so both browser workers fetch through this
 * instead of trusting a single whole-file GET. Every chunk's length is checked, so a
 * short chunk is a thrown error, never a silently-corrupt model.
 */
export async function rangedFetchBlob(
  url: string,
  opts: {
    fetchImpl?: typeof fetch;
    chunkBytes?: number;
    onProgress?: (loaded: number, total: number) => void;
    cache?: { match(k: string): Promise<Response | undefined>; put(k: string, r: Response): Promise<void> } | null;
  } = {},
): Promise<Blob> {
  const doFetch = opts.fetchImpl ?? fetch;
  const chunk = opts.chunkBytes ?? 32 * 1024 * 1024;
  const onProgress = opts.onProgress ?? (() => {});
  const cache = opts.cache ?? null;
  const head = await doFetch(url, { headers: { Range: "bytes=0-0" } });
  if (head.status !== 206) {
    throw new Error(`ranged fetch: ${url} did not honour Range (status ${head.status})`);
  }
  const m = /\/(\d+)\s*$/.exec(head.headers.get("content-range") || "");
  if (!m) throw new Error(`ranged fetch: no total size in Content-Range for ${url}`);
  const total = Number(m[1]);
  const parts: Blob[] = [];
  let loaded = 0;
  for (let start = 0; start < total; start += chunk) {
    const end = Math.min(start + chunk, total) - 1;
    const key = `${url}#bytes=${start}-${end}`;
    let res = cache ? await cache.match(key) : undefined;
    if (!res) {
      res = await doFetch(url, { headers: { Range: `bytes=${start}-${end}` } });
      if (res.status !== 206) throw new Error(`ranged fetch: range ${start}-${end} of ${url} answered ${res.status}`);
      if (cache) {
        try { await cache.put(key, res.clone()); } catch { /* not remembered, still used */ }
      }
    }
    const blob = await res.blob();
    if (blob.size !== end - start + 1) {
      throw new Error(`ranged fetch: range ${start}-${end} of ${url} returned ${blob.size} bytes — truncated`);
    }
    parts.push(blob);
    loaded += blob.size;
    onProgress(loaded, total);
  }
  return new Blob(parts);
}

// ── Wire types ──────────────────────────────────────────────────────────────────────────

export interface CodeEmbedRequest {
  type: "embed";
  requestId: string;
  texts: string[];
  mode: CodeEmbedMode;
}

export type CodeEmbedReply =
  | {
      type: "embed-result";
      requestId: string;
      vectors: number[][];
      provider: "aither-code-embed";
      dim: number;
    }
  | { type: "embed-error"; requestId: string; error: string };

/** Everything the code-embed worker accepts: the shared `load`, plus an embed request. */
export type CodeEmbedWorkerRequest = Extract<WorkerRequest, { type: "load" }> | CodeEmbedRequest;

/** Everything it posts: the shared load lifecycle, plus an embed reply. */
export type CodeEmbedWorkerResponse =
  | Extract<WorkerResponse, { type: "progress" | "ready" | "error" }>
  | CodeEmbedReply;
