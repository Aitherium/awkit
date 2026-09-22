/**
 * Chat memory — the kit's default conversation memory for every on-device chat surface.
 *
 * Measured 2026-09-06 across 14 in-browser Bonsai surfaces: ten go through
 * `useWebGPUChat` (OnDevicePanel, CompanyRoom, the GobboNet room, gargbot, jgames,
 * awkit-spaces, …) and every one of them kept the conversation in React state only —
 * reload, and the visitor's agent had never met them. This module gives the hook a
 * memory BY DEFAULT so that stops being a per-surface wiring job:
 *
 *   remember(role, text)  — persist a turn (IndexedDB when the browser has it), embed it
 *                           when an embedder is wired, and enqueue it for sleep-time
 *                           consolidation (embedding-only, no model call);
 *   recall(query, k)      — the top-k live turns as ONE system block, cosine when a
 *                           vector exists on both sides, keyword otherwise;
 *   consolidate(generate) — the deferred update/delete/ignore pass (sleep-time-memory.ts),
 *                           consent re-checked inside, before the first generate().
 *
 * Honest degradation, never a silent one: with no embedder wired (the kit ships to
 * customer domains that may never register a microembedder) turns still persist and
 * recall is keyword-only; `stats().embedded` says how many rows carry a vector, so the
 * difference is visible rather than invented.
 *
 * Reuses the session-memory chunk store as-is (`aither-session-memory`, one IndexedDB
 * per origin): a chat turn is a chunk whose `source` is `chat:<conversationId>` — the
 * same rows the sleep pass already understands through `session-memory/sleep-time.ts`.
 */

import { IndexedDBMemoryStore, InMemoryMemoryStore, type MemoryStore } from "./session-memory/store";
import type { Embedder, MemoryChunk } from "./session-memory/types";
import { cosine } from "./session-memory/scoring";
import { UnavailableEmbedder, createMicroEmbedder, type MicroEmbedderConfig } from "./session-memory/embedder";
import { SleepTimeMemory, type ConsolidateResult, type PlanOptions } from "./sleep-time-memory";
import { sessionMemorySleepStore, chunkToRow, type ChunkRow } from "./session-memory/sleep-time";

export type ChatRole = "user" | "assistant";

export interface ChatMemoryOptions {
  store?: MemoryStore;
  embedder?: Embedder;
  /** Rows considered by recall — keeps the brute-force cosine bounded. */
  recallPool?: number;
  now?: () => number;
  /** The consent question for the UNATTENDED pass. Defaults to the kit's `mayAutoLoadModel()`;
   *  a vanilla lane that keeps its own consent record passes its own reader here. */
  mayRun?: () => boolean;
}

export interface RecalledTurn {
  id: string;
  role: ChatRole;
  text: string;
  score: number;
  source: "semantic" | "keyword";
}

export interface ChatMemoryStats {
  turns: number;
  embedded: number;
  tombstoned: number;
  embedderProvider: string;
}

export const CHAT_SOURCE_PREFIX = "chat:";

function chatSource(conversationId: string): string {
  return `${CHAT_SOURCE_PREFIX}${conversationId}`;
}

function newTurnId(conversationId: string, now: number): string {
  return `${chatSource(conversationId)}:${now}:${Math.random().toString(36).slice(2, 8)}`;
}

export class ChatMemory {
  private readonly store: MemoryStore;
  private readonly embedder: Embedder;
  private readonly recallPool: number;
  private readonly now: () => number;
  private readonly mayRun?: () => boolean;
  private sleep?: SleepTimeMemory<ChunkRow>;

  constructor(opts: ChatMemoryOptions = {}) {
    this.mayRun = opts.mayRun;
    this.store = opts.store ?? new InMemoryMemoryStore();
    this.embedder = opts.embedder ?? new UnavailableEmbedder();
    this.recallPool = opts.recallPool ?? 400;
    this.now = opts.now ?? (() => Date.now());
  }

  private sleepTime(): SleepTimeMemory<ChunkRow> {
    if (!this.sleep) {
      this.sleep = new SleepTimeMemory<ChunkRow>({
        store: sessionMemorySleepStore(this.store),
        embed: async (text) => (await this.embedder.embed([text]))[0],
        now: this.now,
        mayRun: this.mayRun,
      });
    }
    return this.sleep;
  }

  private async tryEmbed(text: string): Promise<number[] | undefined> {
    try {
      if (!(await this.embedder.isAvailable())) return undefined;
      return (await this.embedder.embed([text]))[0];
    } catch {
      return undefined;
    }
  }

  private async liveChat(conversationId?: string): Promise<MemoryChunk[]> {
    const all = await this.store.all();
    return all.filter(
      (c) =>
        !c.tombstoned &&
        typeof c.source === "string" &&
        c.source.startsWith(CHAT_SOURCE_PREFIX) &&
        (!conversationId || c.source === chatSource(conversationId)),
    );
  }

  /** Persist one turn. Never throws — a memory failure must never break a chat turn. */
  async remember(conversationId: string, role: ChatRole, text: string): Promise<MemoryChunk | null> {
    const trimmed = text.trim();
    if (!trimmed) return null;
    try {
      const now = this.now();
      const chunk: MemoryChunk = {
        id: newTurnId(conversationId, now),
        text: trimmed,
        source: chatSource(conversationId),
        sourceTitle: role,
        capturedAt: new Date(now).toISOString(),
        embedding: await this.tryEmbed(trimmed),
      };
      await this.store.add(chunk);
      if (chunk.embedding) {
        const pool = (await this.liveChat(conversationId)).map(chunkToRow);
        await this.sleepTime().enqueue(chunkToRow(chunk), pool);
      }
      return chunk;
    } catch {
      return null;
    }
  }

  /** Top-k live turns for a query. Semantic when both sides have a vector, else keyword. */
  async recall(conversationId: string, query: string, k = 3): Promise<RecalledTurn[]> {
    try {
      const rows = (await this.liveChat(conversationId)).slice(-this.recallPool);
      if (rows.length === 0) return [];
      const qv = await this.tryEmbed(query);
      const asTurn = (c: MemoryChunk, score: number, source: RecalledTurn["source"]): RecalledTurn => ({
        id: c.id,
        role: (c.sourceTitle === "assistant" ? "assistant" : "user"),
        text: c.text,
        score,
        source,
      });
      if (qv) {
        const semantic = rows
          .filter((c) => c.embedding && c.embedding.length > 0)
          .map((c) => asTurn(c, cosine(qv, c.embedding!), "semantic"))
          .filter((t) => t.score > 0.3)
          .sort((a, b) => b.score - a.score)
          .slice(0, k);
        if (semantic.length > 0) return semantic;
      }
      const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
      if (words.length === 0) return [];
      return rows
        .map((c) => {
          const lower = c.text.toLowerCase();
          const hits = words.filter((w) => lower.includes(w)).length;
          return asTurn(c, hits / words.length, "keyword");
        })
        .filter((t) => t.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    } catch {
      return [];
    }
  }

  /** The system block the hook prepends. Empty string when nothing is worth recalling. */
  async recallBlock(conversationId: string, query: string, k = 3): Promise<string> {
    const turns = await this.recall(conversationId, query, k);
    if (turns.length === 0) return "";
    return `### Relevant memories from earlier:\n${turns.map((t) => `- (${t.role}) ${t.text}`).join("\n")}\n\nUse these only when they help.`;
  }

  hasSleepWork(): Promise<boolean> {
    return this.sleepTime().hasWork();
  }

  consolidate(generate: (prompt: string) => Promise<string>, opts: PlanOptions = {}): Promise<ConsolidateResult> {
    return this.sleepTime().consolidate(generate, opts);
  }

  async stats(): Promise<ChatMemoryStats> {
    const all = (await this.store.all()).filter((c) => typeof c.source === "string" && c.source.startsWith(CHAT_SOURCE_PREFIX));
    return {
      turns: all.filter((c) => !c.tombstoned).length,
      embedded: all.filter((c) => !c.tombstoned && !!c.embedding).length,
      tombstoned: all.filter((c) => !!c.tombstoned).length,
      embedderProvider: this.embedder.provider,
    };
  }

  async forget(conversationId: string): Promise<number> {
    const rows = await this.liveChat(conversationId);
    for (const c of rows) await this.store.remove(c.id);
    return rows.length;
  }
}

// ── The kit default ───────────────────────────────────────────────────────────

let defaultInstance: ChatMemory | null = null;
let defaultEmbedderConfig: MicroEmbedderConfig | null = null;

/**
 * Register the on-device microembedder for the default chat memory (the same
 * `MicroEmbedderConfig` the session-memory lane takes). Call once at app start; until
 * then recall is keyword-only and `stats().embedderProvider` says `unavailable`.
 */
export function configureChatMemoryEmbedder(config: MicroEmbedderConfig | null): void {
  defaultEmbedderConfig = config;
  defaultInstance = null;
}

/** One ChatMemory per origin: IndexedDB when the browser has it, memory otherwise. */
export function defaultChatMemory(): ChatMemory {
  if (defaultInstance) return defaultInstance;
  const store: MemoryStore = typeof indexedDB !== "undefined" ? new IndexedDBMemoryStore() : new InMemoryMemoryStore();
  defaultInstance = new ChatMemory({ store, embedder: createMicroEmbedder(defaultEmbedderConfig) });
  return defaultInstance;
}

/** Test seam. */
export function resetDefaultChatMemory(): void {
  defaultInstance = null;
}
