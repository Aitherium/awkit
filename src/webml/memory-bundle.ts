/**
 * The memory backend as ONE ESM file for the lanes that cannot import TypeScript:
 * the GobboNet vanilla adapter, the browser extension (both trees), the awdk local
 * web UI pack. Built by `AitherVeil/scripts/build-workers.mjs` into
 * `public/workers/webml-memory.js` and mirrored beside each consumer — the same
 * lane `bonsai-worker.js` takes, so a rule fixed here reaches every copy on the
 * next build instead of drifting in four hand-maintained files.
 *
 * `@huggingface/transformers` is EXTERNAL to this bundle on purpose: a vanilla page
 * cannot resolve a bare specifier, so the microembedder lane stays unreachable here
 * (keyword recall — honest, and `stats().embedderProvider` says `unavailable`), and
 * the bundle stays small instead of carrying a 1 MB runtime it can never use.
 *
 * Vanilla consumers:
 *   const M = await import("./webml-memory.js");
 *   const mem = M.defaultChatMemory();
 *   const block = await mem.recallBlock(conversationId, userText);   // before generate
 *   void mem.remember(conversationId, "user", userText);
 *   ... on done: void mem.remember(conversationId, "assistant", reply);
 *   M.scheduleSleepPasses({ status, generate: rawGenerate, memory: mem }); // hidden tab
 */

export * from "./sleep-time-memory";
export * from "./chat-memory";
export { IndexedDBMemoryStore, InMemoryMemoryStore } from "./session-memory/store";
export { StubEmbedder, UnavailableEmbedder } from "./session-memory/embedder";
export type { MemoryChunk, Embedder } from "./session-memory/types";
export {
  MODEL_CONSENT_KEY,
  readModelConsent,
  hasModelConsent,
  mayAutoLoadModel,
  grantModelConsent,
  revokeModelConsent,
} from "./consent";
export type { ModelConsent } from "./consent";
