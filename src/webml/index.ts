// Shared in-browser (WebGPU) inference for Veil, awkit apps, and the awdk
// local GUI. One core, pluggable model runtimes.
//
// Consumer wiring (each app owns the Worker instantiation — see worker-core.ts):
//   // webgpu-worker.ts (in the consuming app)
//   import { runWebMLWorker } from "awkit/webml/worker-core";
//   runWebMLWorker(self as unknown as DedicatedWorkerGlobalScope);
//
//   // in a page/component
//   <WebGPUChat workerFactory={() =>
//     new Worker(new URL("../webgpu-worker.ts", import.meta.url), { type: "module" })} />

export * from "./models";
export * from "./protocol";
// device-class was NEVER on this barrel, and that broke the Veil image build outright.
// `webgpu-brain.tsx` imports FIRST_TOKEN_FAIL_MS from "awkit/webml" (the
// BIH002 first-token deadline, landed 2026-08-15) — an import that has never resolved.
// Turbopack answers "Export FIRST_TOKEN_FAIL_MS doesn't exist in target module. Did you
// mean DEFAULT_WEBML_MODEL_ID?" and `next build` exits 1, so NO new Veil image could be
// produced at all; the fleet kept serving the last one that happened to build, which is
// indistinguishable from "my fix didn't work". tsc reported the same thing and it read as
// the known src-vs-dist type skew rather than as a hard build break.
// The deadline constants and the device-lane probe are exactly the shared surface this
// barrel exists to publish — the timeouts must be ONE number across Veil, tenant agents, adk and
// AitherConnect (gate 1zt BIH002), which a per-app literal cannot be.
export * from "./device-class";
export { useWebGPUChat } from "./useWebGPUChat";
export type { UseWebGPUChat, UseWebGPUChatOptions, ChatStatus } from "./useWebGPUChat";
export { WebGPUChat } from "./WebGPUChat";
export type { WebGPUChatProps } from "./WebGPUChat";
// Consent is exported so a host app can read, grant or REVOKE the answer from its own
// settings surface. A permission a user cannot withdraw is not a permission.
export {
  MODEL_CONSENT_KEY,
  readModelConsent,
  hasModelConsent,
  mayAutoLoadModel,
  grantModelConsent,
  revokeModelConsent,
} from "./consent";
export type { ModelConsent } from "./consent";
export {
  MAX_TOOL_ROUNDS,
  parseToolCalls,
  renderToolsSystemBlock,
} from "./tool-loop";
export type { WebMLTools, WebMLToolSpec, ParsedWebMLToolCall } from "./tool-loop";
// worker-core is intentionally NOT re-exported here — consumers import it directly from
// "awkit/webml/worker-core" in their worker entry, so it never risks being
// bundled onto the main thread.

// Session memory — the browser-side retrieval lane (capture -> chunk -> embed ->
// query, CPU embeddings). The embed worker is intentionally NOT re-exported
// here (same rule as worker-core: consumers instantiate it from its own entry,
// so it never gets bundled onto the main thread).
export * from "./session-memory/types";
export * from "./session-memory/chunk";
export * from "./session-memory/scoring";
export * from "./session-memory/store";
export * from "./session-memory/embedder";
export * from "./session-memory/capture";
export { SessionMemory } from "./session-memory";
export type { SessionMemoryOptions } from "./session-memory";

// The on-device CODE-SEARCH embedder (aither-code-embed): the pure half only — model
// facts, query/document preparation, normalisation and the wire types. The worker that
// runs it lives in the consuming app (Veil's code-embed-wasm-worker.ts), same rule as
// worker-core and the session-memory embed worker: never bundled onto the main thread.
export * from "./code-embed";
