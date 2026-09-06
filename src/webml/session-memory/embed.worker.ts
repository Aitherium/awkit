/**
 * The dedicated embedding worker — the CPU lane of the session-memory design.
 *
 * It exists so the WebGPU queue stays 100% on decode: embeddings run here, in
 * WASM, on a separate thread. The handler is a pure function so the protocol
 * is testable without a real Worker (jsdom has none).
 *
 * Protocol (one message in, one message out, requestId echoes):
 *   in:  { type: "embed", requestId, texts: string[] }
 *   out: { type: "embed-result", requestId, vectors: number[][], provider }
 *        | { type: "embed-error", requestId, error }
 *
 * The embedder instance is created once at worker boot from the config the
 * host bakes in. An unarmed lane (no mirror model registered) answers
 * embed-error — refusal, never a stub vector.
 */

import { createMicroEmbedder, type MicroEmbedderConfig } from "./embedder"

/**
 * The mirror config for the CPU embedding lane. Null = unarmed (refuses).
 * The artifact is live on the mirror: `microembedder-v2` release in
 * Aitherium/aitherkvcache (all-MiniLM-L6-v2 fine-tune, ONNX fp32 + q8, Apache-2.0),
 * served at artifact.aitherium.com/microembedder-v2/<file> via the
 * awrtifact prefix route. The lane arms itself; no other code changes.
 */
export const SESSION_MEMORY_MODEL: MicroEmbedderConfig = {
  // microembedder-v2: the all-MiniLM-L6-v2 architecture fine-tuned on browser-agent
  // session-memory pairs. The ONNX carries its own file name so the release prefix
  // route cannot hand back v1's bytes.
  //
  // The internal recipe path and its held-out benchmark numbers were removed from
  // this comment 2026-09-05: this package ships to strangers, and training results
  // plus an internal config filename are the shape of the platform rather than a
  // credential -- no secret scanner fires on either. They live in the monorepo.
  url: "https://artifact.aitherium.com/microembedder-v2/",
  modelId: "aitherium/microembedder",
  modelFile: "browser_embed",
  dim: 384,
}

export interface EmbedRequest {
  type: "embed"
  requestId: string
  texts: string[]
}

export type EmbedReply =
  | { type: "embed-result"; requestId: string; vectors: number[][]; provider: string }
  | { type: "embed-error"; requestId: string; error: string }

/** Pure request handler — testable without a Worker. */
export async function handleEmbedRequest(
  req: EmbedRequest,
  embedder: ReturnType<typeof createMicroEmbedder>,
): Promise<EmbedReply> {
  if (!req.texts || req.texts.length === 0) {
    return { type: "embed-error", requestId: req.requestId, error: "no texts to embed" }
  }
  try {
    const vectors = await embedder.embed(req.texts)
    return { type: "embed-result", requestId: req.requestId, vectors, provider: embedder.provider }
  } catch (err) {
    return {
      type: "embed-error",
      requestId: req.requestId,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

declare const self: DedicatedWorkerGlobalScope

const embedder = createMicroEmbedder(SESSION_MEMORY_MODEL)

self.onmessage = (event: MessageEvent<EmbedRequest>) => {
  const req = event.data
  if (!req || req.type !== "embed") return
  void handleEmbedRequest(req, embedder).then((reply) => self.postMessage(reply))
}
