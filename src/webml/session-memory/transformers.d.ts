/**
 * Ambient stub for the LAZY transformers.js import in embedder.ts.
 *
 * transformers.js is the host app's runtime (Veil, the Living OS — the same
 * one the Bonsai worker uses). awkit must NOT declare it as a dependency:
 * the import is dynamic and fires only when the mirror lane is armed, and a
 * hard dependency would drag the whole onnxruntime stack into every awkit
 * install. This declaration types the one function we touch. The runtime
 * import stays external in the worker bundle (build:embed-worker), so an
 * unarmed lane never loads a single byte of it.
 */
declare module "@huggingface/transformers" {
  export interface PipelineOutput {
    data: Float32Array
    dims: number[]
  }
  export type FeatureExtractionFn = (
    texts: string[],
    opts: { pooling: "mean" | "cls" },
  ) => Promise<PipelineOutput>
  export const env: {
    remoteHost: string
    remotePathTemplate: string
  }
  export function pipeline(
    task: "feature-extraction",
    model: string,
    opts?: Record<string, unknown>,
  ): Promise<FeatureExtractionFn>
}
