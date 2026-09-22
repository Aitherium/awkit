/**
 * Sleep-time memory — the kit's ONE copy of the deferred-consolidation rules.
 *
 * Every surface that runs Bonsai in a browser (the Living OS at aitherium.com, a tenant
 * portal on its own domain, gargbot, the adk web UI, the extension) keeps memory rows
 * that are never reconciled: a contradicted fact stays recalled forever. LightMem's
 * (ICLR 2026) one real contribution fixes that cheaply, and this module IS that idea:
 *
 *   write path  — embedding-only. A new row records the top-N OLDER live rows it overlaps
 *                 (`updateQueue`). No model is asked anything, so a save never stalls the
 *                 one-model slot the user is waiting on.
 *   sleep path  — later, when nobody is waiting (the tab is hidden, the model is ready)
 *                 and the visitor has said the model may work unattended, ONE generate()
 *                 per queued row decides `update | delete | ignore`.
 *
 * Three rules that are the whole design and are each pinned by a test:
 *  - `delete` never deletes. The row is TOMBSTONED with `supersededBy` — the same shape
 *    as `adk.GraphMemory.supersede()` server-side — so a bad decision is one flag flip
 *    from undone and a reader can say what replaced it.
 *  - the model's answer is parsed FAIL-CLOSED: anything malformed is `ignore`. A model
 *    emitting garbage must not be able to erase memory.
 *  - consent is consulted BEFORE the first generate(), never after. Position is the rule.
 *
 * Deliberately no surface allowlist: this file ships inside awkit to customer domains,
 * where an aitherium.com host rule would refuse every legitimate tenant in silence. The
 * consent question is the kit's own `mayAutoLoadModel()` (the "load automatically from
 * now on" checkbox) — a one-time "yes, load it" is NOT consent to unattended work.
 *
 * Pure functions first (Node-testable, no IndexedDB); the store contract is two methods.
 */

import { mayAutoLoadModel } from "./consent";

// ── Rows and the store contract ───────────────────────────────────────────────

export type RowId = string | number;

/** An OLDER row a new row overlaps with, recorded at write time (embedding-only). */
export interface UpdateCandidate<Id extends RowId = RowId> {
  id: Id;
  score: number;
}

/** The minimum a row must carry. Any richer record (a Veil VectorRecord, a session-memory
 *  MemoryChunk) satisfies this structurally; the kit never sees the rest. */
export interface MemoryRow<Id extends RowId = RowId> {
  id: Id;
  text: string;
  /** Unit-normalised embedding. Rows without one are never queued or consulted. */
  vector?: number[];
  /** Milliseconds since epoch — the ordering key. */
  timestamp: number;
  updateQueue?: UpdateCandidate<Id>[];
  tombstoned?: boolean;
  supersededBy?: Id;
  tombstonedAt?: number;
  consolidatedAt?: number;
}

/** Two methods. `put` replaces by id. Tombstones included in `all()` — the pass needs
 *  both sides; readers filter with `liveRows()`. */
export interface SleepTimeStore<Row extends MemoryRow> {
  all(): Promise<Row[]>;
  put(row: Row): Promise<void>;
}

/** Tombstoned rows are hidden from every reader unless asked for by name. */
export function liveRows<Row extends MemoryRow>(rows: Row[], includeTombstoned = false): Row[] {
  return includeTombstoned ? rows : rows.filter((r) => !r.tombstoned);
}

// ── Pure: queue construction ──────────────────────────────────────────────────

export interface QueueOptions {
  /** How many older neighbours to keep per row. LightMem keeps 10 of a 20-wide search. */
  topN?: number;
  /** Cosine floor below which an older row is not a candidate at all. */
  minScore?: number;
}

export function cosineUnit(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Which OLDER, LIVE rows does this new row overlap with? Embedding-only. The row itself,
 * tombstones, vector-less rows and rows that are NOT older are never candidates: the
 * update prompt's rule is "candidates are more recent than the target", so a candidate
 * must be the newer side — building it the other way round makes the model delete the
 * NEW fact.
 */
export function buildUpdateQueue<Row extends MemoryRow>(
  fresh: Pick<Row, "id" | "vector" | "timestamp">,
  pool: Row[],
  opts: QueueOptions = {},
): UpdateCandidate<Row["id"]>[] {
  const topN = opts.topN ?? 5;
  const minScore = opts.minScore ?? 0.5;
  if (!fresh.vector || fresh.vector.length === 0) return [];
  const out: UpdateCandidate<Row["id"]>[] = [];
  for (const r of pool) {
    if (r.id === fresh.id) continue;
    if (r.tombstoned) continue;
    if (!r.vector || r.vector.length === 0) continue;
    if (r.timestamp >= fresh.timestamp) continue;
    const score = cosineUnit(fresh.vector, r.vector);
    if (score >= minScore) out.push({ id: r.id, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, topN);
}

// ── Pure: the decision contract ───────────────────────────────────────────────

export type UpdateAction = "update" | "delete" | "ignore";

export interface UpdateDecision {
  action: UpdateAction;
  newMemory?: string;
}

/** LightMem's UPDATE_PROMPT kept to its three rules. TARGET = the older row; CANDIDATES =
 *  the newer rows that overlapped it. */
export const UPDATE_PROMPT = `You are a memory management assistant.
Decide whether the TARGET memory should be updated, deleted, or ignored based on the CANDIDATE memories, which are more recent.

Rules:
1. update — same fact/event, candidates add detail or clarify: integrate them into the target.
2. delete — direct conflict: the candidates (more recent) take precedence; the target is stale.
3. ignore — unrelated: no action.

Use only the information given. Never invent details. Operate on the TARGET only.
Answer with ONE JSON object and nothing else:
{"action": "update" | "delete" | "ignore", "new_memory": "<text, only when action = update>"}`;

export function buildUpdatePrompt(target: string, candidates: string[]): string {
  const cands = candidates.map((c) => `- ${c}`).join("\n");
  return `${UPDATE_PROMPT}\n\nTarget memory: "${target}"\nCandidate memories:\n${cands}\n\nOutput:`;
}

/** Fail-closed. Malformed → ignore. `update` with an empty `new_memory` → ignore (an
 *  update that would blank the row is a delete wearing a different name). */
export function parseUpdateDecision(raw: unknown): UpdateDecision {
  const ignore: UpdateDecision = { action: "ignore" };
  if (typeof raw !== "string") return ignore;
  const stripped = raw.replace(/^```[a-zA-Z]*\s*|\s*```$/g, "").trim();
  const m = stripped.match(/\{[\s\S]*\}/);
  if (!m) return ignore;
  let obj: unknown;
  try {
    obj = JSON.parse(m[0]);
  } catch {
    return ignore;
  }
  if (!obj || typeof obj !== "object") return ignore;
  const action = (obj as { action?: unknown }).action;
  if (action === "delete") return { action: "delete" };
  if (action === "update") {
    const nm = (obj as { new_memory?: unknown }).new_memory;
    if (typeof nm === "string" && nm.trim().length > 0) return { action: "update", newMemory: nm.trim() };
    return ignore;
  }
  return ignore;
}

// ── Pure: planning a pass ─────────────────────────────────────────────────────

export interface Mutation<Id extends RowId = RowId> {
  /** The TARGET — the OLDER row being judged. */
  id: Id;
  action: UpdateAction;
  newText?: string;
  /** For `delete`: the newest candidate that won. */
  supersededBy?: Id;
  /** The NEWER rows whose `updateQueue` referenced the target. Applying the mutation
   *  removes the reference from each, so a target is judged once. */
  candidates: Id[];
  /** True when the target no longer exists or is already tombstoned: no decision was
   *  made, only the dangling references are cleared. */
  stale?: boolean;
}

export interface PlanOptions {
  /** Max generate() calls in one pass — each is a full turn on a one-model slot. */
  budget?: number;
}

/**
 * LightMem's `offline_update_all_entries`, exactly: the queue is stored on the NEW row and
 * names OLDER rows; the pass therefore judges each OLDER row (the TARGET) against the
 * NEWER rows whose queue contains it (the CANDIDATES). "Candidates are more recent" is
 * what lets `delete` mean "the target is stale" and never "the new fact is wrong".
 *
 * One generate() per live target, oldest first. A reference whose target is gone or
 * already tombstoned is cleared WITHOUT a decision — the budget counts model calls.
 */
export async function planConsolidation<Row extends MemoryRow>(
  rows: Row[],
  decide: (prompt: string) => Promise<string>,
  opts: PlanOptions = {},
): Promise<Mutation<Row["id"]>[]> {
  const budget = opts.budget ?? 8;
  const byId = new Map<Row["id"], Row>();
  for (const r of rows) byId.set(r.id, r);

  // target -> the newer rows that queued it
  const refs = new Map<Row["id"], Row[]>();
  for (const r of rows) {
    if (r.tombstoned) continue;
    for (const c of r.updateQueue ?? []) {
      const list = refs.get(c.id) ?? [];
      list.push(r);
      refs.set(c.id, list);
    }
  }

  const out: Mutation<Row["id"]>[] = [];
  const targets = [...refs.keys()].sort((x, y) => (byId.get(x)?.timestamp ?? 0) - (byId.get(y)?.timestamp ?? 0));
  let decisions = 0;
  for (const tid of targets) {
    const candidates = refs.get(tid)!;
    const target = byId.get(tid);
    if (!target || target.tombstoned) {
      out.push({ id: tid, action: "ignore", candidates: candidates.map((c) => c.id), stale: true });
      continue;
    }
    if (decisions >= budget) break;
    decisions++;
    const newerFirst = [...candidates].sort((x, y) => y.timestamp - x.timestamp);
    let decision: UpdateDecision;
    try {
      decision = parseUpdateDecision(await decide(buildUpdatePrompt(target.text, newerFirst.map((c) => c.text))));
    } catch {
      decision = { action: "ignore" };
    }
    const ids = candidates.map((c) => c.id);
    if (decision.action === "delete") {
      out.push({ id: tid, action: "delete", supersededBy: newerFirst[0].id, candidates: ids });
    } else if (decision.action === "update") {
      out.push({ id: tid, action: "update", newText: decision.newMemory, candidates: ids });
    } else {
      out.push({ id: tid, action: "ignore", candidates: ids });
    }
  }
  return out;
}

// ── Pure: WHEN a pass may run ─────────────────────────────────────────────────

/** Hidden tab + model ready + nothing in flight. A visitor who can see the tab gets the
 *  whole slot; a consolidation queued in front of their send reads as "the brain hung". */
export function shouldRunSleepPass(
  status: string,
  visibility: string | undefined,
  inFlight: boolean,
): boolean {
  return status === "ready" && visibility === "hidden" && !inFlight;
}

export const SLEEP_PASS_DELAY_MS = 5_000;
export const SLEEP_PASS_BUDGET = 2;

// ── The kit object ────────────────────────────────────────────────────────────

export interface SleepTimeMemoryOptions<Row extends MemoryRow> {
  store: SleepTimeStore<Row>;
  /** Re-embed rewritten text. Optional: without it an updated row keeps its old vector
   *  (a stale vector beats no vector). */
  embed?: (text: string) => Promise<number[]>;
  /** The consent question. Defaults to the kit's own "load automatically" checkbox. */
  mayRun?: () => boolean;
  queue?: QueueOptions;
  now?: () => number;
}

export interface ConsolidateResult {
  skipped?: "consent" | "nothing-queued";
  decided: number;
  updated: number;
  tombstoned: number;
  ignored: number;
}

/**
 * One object per memory store. `enqueue()` on the write path, `consolidate()` on the
 * sleep path. Works over Veil's IndexedDB `vectors`, the session-memory chunk store,
 * or an in-memory twin in a test — the store contract is two methods.
 */
export class SleepTimeMemory<Row extends MemoryRow> {
  private readonly store: SleepTimeStore<Row>;
  private readonly embed?: (text: string) => Promise<number[]>;
  private readonly mayRun: () => boolean;
  private readonly queueOpts: QueueOptions;
  private readonly now: () => number;

  constructor(opts: SleepTimeMemoryOptions<Row>) {
    this.store = opts.store;
    this.embed = opts.embed;
    this.mayRun = opts.mayRun ?? (() => mayAutoLoadModel());
    this.queueOpts = opts.queue ?? {};
    this.now = opts.now ?? (() => Date.now());
  }

  /** Write path. Embedding-only; returns how many older rows were queued. */
  async enqueue(fresh: Row, pool?: Row[]): Promise<number> {
    if (!fresh.vector || fresh.vector.length === 0) return 0;
    const rows = pool ?? (await this.store.all());
    const queue = buildUpdateQueue<Row>(fresh, rows, this.queueOpts);
    if (queue.length === 0) return 0;
    await this.store.put({ ...fresh, updateQueue: queue });
    return queue.length;
  }

  /** Is anything waiting? Cheap — no model, one store read. */
  async hasWork(): Promise<boolean> {
    const rows = await this.store.all();
    return rows.some((r) => !r.tombstoned && (r.updateQueue?.length ?? 0) > 0);
  }

  /** Sleep path. Consent is checked FIRST — before any row is read or any generate(). */
  async consolidate(
    generate: (prompt: string) => Promise<string>,
    opts: PlanOptions = {},
  ): Promise<ConsolidateResult> {
    let allowed = false;
    try {
      allowed = this.mayRun();
    } catch {
      allowed = false;
    }
    if (!allowed) return { skipped: "consent", decided: 0, updated: 0, tombstoned: 0, ignored: 0 };

    const rows = await this.store.all();
    if (!rows.some((r) => !r.tombstoned && (r.updateQueue?.length ?? 0) > 0)) {
      return { skipped: "nothing-queued", decided: 0, updated: 0, tombstoned: 0, ignored: 0 };
    }
    const mutations = await planConsolidation<Row>(rows, generate, opts);
    const byId = new Map<Row["id"], Row>();
    for (const r of rows) byId.set(r.id, r);
    const now = this.now();
    let updated = 0;
    let tombstoned = 0;
    let ignored = 0;
    let decided = 0;
    // Clear every reference to a judged target from its candidates' queues (once each).
    const clears = new Map<Row["id"], Set<Row["id"]>>();
    for (const m of mutations) {
      for (const cid of m.candidates) {
        const set = clears.get(cid) ?? new Set<Row["id"]>();
        set.add(m.id);
        clears.set(cid, set);
      }
    }
    for (const m of mutations) {
      const row = byId.get(m.id);
      if (m.stale || !row) continue;
      decided++;
      if (m.action === "update" && m.newText) {
        let vector = row.vector;
        if (this.embed) {
          try {
            vector = await this.embed(m.newText);
          } catch {
            /* keep the old vector */
          }
        }
        byId.set(m.id, { ...row, text: m.newText, vector, consolidatedAt: now });
        updated++;
      } else if (m.action === "delete") {
        byId.set(m.id, { ...row, tombstoned: true, supersededBy: m.supersededBy, tombstonedAt: now });
        tombstoned++;
      } else {
        byId.set(m.id, { ...row, consolidatedAt: now });
        ignored++;
      }
    }
    for (const [cid, targets] of clears) {
      const c = byId.get(cid);
      if (!c) continue;
      byId.set(cid, { ...c, updateQueue: (c.updateQueue ?? []).filter((q) => !targets.has(q.id)) });
    }
    // Write back every row that changed (judged targets + candidates whose queue shrank).
    const touched = new Set<Row["id"]>([...mutations.filter((m) => !m.stale).map((m) => m.id), ...clears.keys()]);
    for (const id of touched) {
      const r = byId.get(id);
      if (r) await this.store.put(r);
    }
    return { decided, updated, tombstoned, ignored };
  }
}

/** In-memory store — tests and the embed worker (no DOM). */
export class InMemorySleepTimeStore<Row extends MemoryRow> implements SleepTimeStore<Row> {
  private rows = new Map<RowId, Row>();
  constructor(seed: Row[] = []) {
    for (const r of seed) this.rows.set(r.id, r);
  }
  async all(): Promise<Row[]> {
    return [...this.rows.values()];
  }
  async put(row: Row): Promise<void> {
    this.rows.set(row.id, row);
  }
}

// ── The scheduler (DOM) ───────────────────────────────────────────────────────

export interface SleepScheduleOptions {
  /** Current model status — 'ready' is the only state a pass may start in. */
  status: () => string;
  /** The model's raw one-shot generate (NOT the chat send — a prompt must never land in
   *  the visible conversation). */
  generate: (prompt: string) => Promise<string>;
  memory: Pick<SleepTimeMemory<MemoryRow>, "consolidate">;
  delayMs?: number;
  budget?: number;
  doc?: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  onResult?: (r: ConsolidateResult) => void;
}

/**
 * Framework-free: arm a pass N ms after the tab goes hidden; cancel when it comes back.
 * Returns the teardown. React surfaces wrap this in an effect; vanilla ones call it once.
 */
export function scheduleSleepPasses(opts: SleepScheduleOptions): () => void {
  const doc = opts.doc ?? (typeof document !== "undefined" ? document : undefined);
  if (!doc) return () => {};
  const delay = opts.delayMs ?? SLEEP_PASS_DELAY_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const run = async () => {
    timer = null;
    if (!shouldRunSleepPass(opts.status(), doc.visibilityState, inFlight)) return;
    inFlight = true;
    try {
      const r = await opts.memory.consolidate(opts.generate, { budget: opts.budget ?? SLEEP_PASS_BUDGET });
      opts.onResult?.(r);
    } catch {
      /* a failed pass changed nothing — the store is only written after a decision */
    } finally {
      inFlight = false;
    }
  };
  const onVisibility = () => {
    cancel();
    if (doc.visibilityState === "hidden") timer = setTimeout(run, delay);
  };
  doc.addEventListener("visibilitychange", onVisibility);
  return () => {
    cancel();
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}
