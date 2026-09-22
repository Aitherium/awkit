/**
 * @jest-environment jsdom
 */

/**
 * Sleep-time memory — the kit's one copy of the rules, and the two lanes that use it
 * (a bare store, and session-memory's chunk store through its adapter).
 *
 * Every arm pins a decision that fails as a silence otherwise:
 *  - the queue names OLDER, LIVE rows only (else the model deletes the NEW fact);
 *  - an unparseable answer is `ignore`, never `delete`;
 *  - consent runs BEFORE the first generate() — asserted by call count;
 *  - the budget counts generate() calls, not rows;
 *  - `delete` tombstones and the reader hides the tombstone;
 *  - the scheduler fires only for hidden + ready + idle, and tears down.
 */

jest.mock("../consent", () => ({
  mayAutoLoadModel: jest.fn(() => false),
  readModelConsent: jest.fn(() => null),
  hasModelConsent: jest.fn(() => false),
  grantModelConsent: jest.fn(),
  revokeModelConsent: jest.fn(),
  MODEL_CONSENT_KEY: "aitheros-bonsai-consent",
}))

import { mayAutoLoadModel } from "../consent"
import {
  InMemorySleepTimeStore,
  SleepTimeMemory,
  buildUpdatePrompt,
  buildUpdateQueue,
  liveRows,
  parseUpdateDecision,
  planConsolidation,
  scheduleSleepPasses,
  shouldRunSleepPass,
  type MemoryRow,
} from "../sleep-time-memory"
import { SessionMemory } from "../session-memory"
import { InMemoryMemoryStore } from "../session-memory/store"
import { StubEmbedder } from "../session-memory/embedder"
import { chunkToRow, rowToChunk } from "../session-memory/sleep-time"

const mayAuto = mayAutoLoadModel as jest.Mock

function row(id: number, text: string, vector: number[], timestamp: number, extra: Partial<MemoryRow<number>> = {}): MemoryRow<number> {
  return { id, text, vector, timestamp, ...extra }
}

describe("buildUpdateQueue — older, live, above the floor, best first", () => {
  const fresh = row(10, "the user likes coffee, especially cappuccino", [1, 0, 0], 1000)
  const pool = [
    row(1, "likes coffee", [0.9, 0.1, 0], 100),
    row(2, "plays chess", [0, 1, 0], 200),
    row(3, "coffee in the morning", [0.95, 0, 0.05], 300),
    row(4, "coffee, NEWER than fresh", [1, 0, 0], 2000),
    row(5, "coffee, tombstoned", [1, 0, 0], 400, { tombstoned: true }),
    row(6, "coffee, no vector", undefined as unknown as number[], 500),
  ]
  it("keeps 3 then 1; never 2 (floor), 4 (newer), 5 (tombstone), 6 (no vector)", () => {
    expect(buildUpdateQueue(fresh, pool, { topN: 5 }).map((c) => c.id)).toEqual([3, 1])
    expect(buildUpdateQueue(fresh, pool, { topN: 1 }).map((c) => c.id)).toEqual([3])
  })
  it("never queues itself; nothing without a vector", () => {
    expect(buildUpdateQueue(fresh, [fresh])).toEqual([])
    expect(buildUpdateQueue({ id: 11, vector: [], timestamp: 5000 }, pool)).toEqual([])
  })
})

describe("parseUpdateDecision — fail-closed", () => {
  it("reads the three legal shapes", () => {
    expect(parseUpdateDecision('{"action":"delete"}')).toEqual({ action: "delete" })
    expect(parseUpdateDecision('{"action":"ignore"}')).toEqual({ action: "ignore" })
    expect(parseUpdateDecision('```json\n{"action":"update","new_memory":"x"}\n```')).toEqual({ action: "update", newMemory: "x" })
  })
  it("MUTATION ARM: every malformed answer is ignore, never delete", () => {
    for (const g of ["", "delete", "DELETE it", '{"action":"purge"}', '{"action":"update"}', '{"action":"update","new_memory":" "}', "{nope", "null", "42", undefined, 7]) {
      expect(parseUpdateDecision(g as unknown).action).toBe("ignore")
    }
  })
})

describe("planConsolidation — judges the OLDER target against the NEWER rows that queued it", () => {
  // queue lives on the NEW row (3, ts 300) and names OLDER rows (1, 2). Row 5's queue
  // points at 4, which is tombstoned: cleared for free, no decision.
  const rows = [
    row(1, "user likes coffee", [1, 0, 0], 100),
    row(2, "user hates coffee", [1, 0, 0], 150),
    row(3, "user drinks cappuccino every morning", [1, 0, 0], 300, { updateQueue: [{ id: 1, score: 0.9 }, { id: 2, score: 0.9 }] }),
    row(4, "tombstoned target", [1, 0, 0], 50, { tombstoned: true }),
    row(5, "newer row still pointing at a tombstone", [1, 0, 0], 60, { updateQueue: [{ id: 4, score: 0.9 }] }),
  ]
  it("decides 1 then 2 (oldest first) with 3 as the candidate; clears 5->4 for free", async () => {
    const decide = jest.fn(async (p: string) => {
      if (p.includes('Target memory: "user hates coffee"')) return '{"action":"delete"}'
      if (p.includes('Target memory: "user likes coffee"')) return '{"action":"update","new_memory":"user likes coffee, cappuccino every morning"}'
      return "nonsense"
    })
    const plan = await planConsolidation(rows, decide, { budget: 10 })
    expect(decide).toHaveBeenCalledTimes(2)
    expect(decide.mock.calls[0][0]).toContain('Target memory: "user likes coffee"')
    expect(decide.mock.calls[0][0]).toContain("- user drinks cappuccino every morning")
    expect(plan).toEqual([
      { id: 4, action: "ignore", candidates: [5], stale: true },
      { id: 1, action: "update", newText: "user likes coffee, cappuccino every morning", candidates: [3] },
      { id: 2, action: "delete", supersededBy: 3, candidates: [3] },
    ])
  })
  it("MUTATION ARM: the NEW row is never the target — delete can only tombstone the older side", async () => {
    const plan = await planConsolidation(rows, async () => '{"action":"delete"}', { budget: 10 })
    expect(plan.map((m) => m.id)).not.toContain(3)
    expect(plan.filter((m) => m.action === "delete").map((m) => m.id).sort()).toEqual([1, 2])
  })
  it("budget 1 → exactly one generate(); the stale clear does not spend it", async () => {
    const decide = jest.fn(async () => '{"action":"ignore"}')
    const plan = await planConsolidation(rows, decide, { budget: 1 })
    expect(decide).toHaveBeenCalledTimes(1)
    expect(plan.filter((m) => !m.stale)).toHaveLength(1)
    expect(plan.find((m) => m.stale)).toEqual({ id: 4, action: "ignore", candidates: [5], stale: true })
  })
  it("a throwing model is ignore, not delete", async () => {
    const decide = jest.fn(async () => { throw new Error("worker died") })
    // row 3 also references 1, which is absent from this subset: cleared as stale, no decision
    expect(await planConsolidation([rows[1], rows[2]], decide)).toEqual([
      { id: 1, action: "ignore", candidates: [3], stale: true },
      { id: 2, action: "ignore", candidates: [3] },
    ])
  })
})

describe("SleepTimeMemory over a bare store", () => {
  beforeEach(() => mayAuto.mockReset())

  it("consent off → skipped, ZERO generate() calls, ZERO store reads", async () => {
    mayAuto.mockReturnValue(false)
    const store = new InMemorySleepTimeStore<MemoryRow<number>>([row(1, "a", [1, 0, 0], 1), row(2, "b", [1, 0, 0], 2, { updateQueue: [{ id: 1, score: 1 }] })])
    const all = jest.spyOn(store, "all")
    const generate = jest.fn(async () => '{"action":"delete"}')
    const res = await new SleepTimeMemory({ store }).consolidate(generate)
    expect(res.skipped).toBe("consent")
    expect(generate).not.toHaveBeenCalled()
    expect(all).not.toHaveBeenCalled()
  })

  it("MUTATION ARM: with consent, delete TOMBSTONES (text survives, supersededBy set) and liveRows hides it", async () => {
    mayAuto.mockReturnValue(true)
    const store = new InMemorySleepTimeStore<MemoryRow<number>>([
      row(1, "user hates coffee", [1, 0, 0], 100),
      row(2, "user loves coffee", [1, 0, 0], 200, { updateQueue: [{ id: 1, score: 0.9 }] }),
    ])
    const mem = new SleepTimeMemory({ store, now: () => 999 })
    expect(await mem.hasWork()).toBe(true)
    const res = await mem.consolidate(async () => '{"action":"delete"}')
    expect(res).toMatchObject({ decided: 1, tombstoned: 1, updated: 0, ignored: 0 })
    const rows = await store.all()
    const tomb = rows.find((r) => r.id === 1)!
    expect(tomb).toMatchObject({ tombstoned: true, supersededBy: 2, tombstonedAt: 999, text: "user hates coffee" })
    expect(rows.find((r) => r.id === 2)!.updateQueue).toEqual([]) // the reference is cleared on the candidate
    expect(liveRows(rows).map((r) => r.id)).toEqual([2])
    expect(await mem.hasWork()).toBe(false)
  })

  it("update re-embeds through the given embed and clears the queue", async () => {
    mayAuto.mockReturnValue(true)
    const store = new InMemorySleepTimeStore<MemoryRow<number>>([
      row(1, "likes coffee", [1, 0, 0], 100),
      row(2, "cappuccino mornings", [1, 0, 0], 200, { updateQueue: [{ id: 1, score: 0.9 }] }),
    ])
    const embed = jest.fn(async () => [0, 1, 0])
    const res = await new SleepTimeMemory({ store, embed }).consolidate(async () => '{"action":"update","new_memory":"likes coffee — cappuccino in the morning"}')
    expect(res).toMatchObject({ updated: 1 })
    const r1 = (await store.all()).find((r) => r.id === 1)!
    expect(r1).toMatchObject({ text: "likes coffee — cappuccino in the morning", vector: [0, 1, 0] })
    expect((await store.all()).find((r) => r.id === 2)!.updateQueue).toEqual([])
    expect(embed).toHaveBeenCalledWith("likes coffee — cappuccino in the morning")
  })

  it("enqueue records older live rows only, with no model", async () => {
    const store = new InMemorySleepTimeStore<MemoryRow<number>>([row(1, "old", [1, 0, 0], 100), row(2, "newer", [1, 0, 0], 300)])
    const n = await new SleepTimeMemory({ store }).enqueue(row(3, "fresh", [1, 0, 0], 200))
    expect(n).toBe(1)
    expect((await store.all()).find((r) => r.id === 3)!.updateQueue).toEqual([{ id: 1, score: 1 }])
  })
})

describe("session-memory lane through the adapter", () => {
  beforeEach(() => mayAuto.mockReset())

  it("chunk<->row round-trips the sleep fields and maps capturedAt/embedding", () => {
    const chunk = { id: "c1", text: "t", capturedAt: "2026-09-06T00:00:00.000Z", embedding: [1, 0], updateQueue: [{ id: "c0", score: 0.7 }] }
    const r = chunkToRow(chunk)
    expect(r).toMatchObject({ id: "c1", vector: [1, 0], timestamp: Date.parse(chunk.capturedAt), updateQueue: chunk.updateQueue })
    expect(rowToChunk({ ...r, tombstoned: true, supersededBy: "c9" })).toMatchObject({ ...chunk, tombstoned: true, supersededBy: "c9" })
  })

  it("capture enqueues against earlier chunks; query hides tombstones after a delete", async () => {
    mayAuto.mockReturnValue(true)
    const store = new InMemoryMemoryStore()
    const mem = new SessionMemory({ store, embedder: new StubEmbedder() })
    const t0 = Date.parse("2026-09-06T00:00:00Z")
    const first = await mem.capture({ url: "https://a", title: "A", text: "the office opens at nine every weekday morning" }, { now: t0 })
    // a DIFFERENT page: re-capturing the same URL upserts by id (diff-indexing), so the older
    // row must come from another source for there to be an older row at all
    const second = await mem.capture({ url: "https://b", title: "B", text: "the office opens at nine every weekday morning and closes at five" }, { now: t0 + 60_000 })
    expect(first).toHaveLength(1)
    const stored = await store.all()
    const newer = stored.find((c) => c.id === second[0].id)!
    expect(newer.updateQueue?.map((c) => c.id)).toEqual([first[0].id])
    expect(await mem.hasSleepWork()).toBe(true)

    const generate = jest.fn(async () => '{"action":"delete"}')
    const res = await mem.consolidate(generate)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(res).toMatchObject({ tombstoned: 1 })
    const after = await store.all()
    expect(after.find((c) => c.id === first[0].id)).toMatchObject({ tombstoned: true, supersededBy: second[0].id })
    const hits = await mem.query("office opens", { limit: 10 })
    expect(hits.map((h) => h.chunk.id)).toEqual([second[0].id])
  })
})

describe("scheduleSleepPasses — WHEN", () => {
  it("predicate: hidden + ready + idle only", () => {
    expect(shouldRunSleepPass("ready", "hidden", false)).toBe(true)
    for (const [s, v, f] of [["ready", "visible", false], ["generating", "hidden", false], ["idle", "hidden", false], ["ready", "hidden", true], ["ready", undefined, false]] as const) {
      expect(shouldRunSleepPass(s, v, f)).toBe(false)
    }
  })

  it("fires once after the delay on hidden, not on visible, and tears down", async () => {
    jest.useFakeTimers()
    const listeners: Array<() => void> = []
    let visibility: DocumentVisibilityState = "visible"
    const doc = {
      get visibilityState() { return visibility },
      addEventListener: jest.fn((_: string, fn: () => void) => listeners.push(fn)),
      removeEventListener: jest.fn(),
    }
    const consolidate = jest.fn(async () => ({ decided: 0, updated: 0, tombstoned: 0, ignored: 0 }))
    const status = jest.fn(() => "ready")
    const off = scheduleSleepPasses({ status, generate: async () => "", memory: { consolidate }, doc: doc as unknown as Document, delayMs: 100 })
    expect(doc.addEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function))

    visibility = "hidden"; listeners.forEach((l) => l())
    jest.advanceTimersByTime(99)
    expect(consolidate).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    await Promise.resolve()
    expect(consolidate).toHaveBeenCalledTimes(1)

    // visible again cancels a pending pass
    visibility = "hidden"; listeners.forEach((l) => l())
    visibility = "visible"; listeners.forEach((l) => l())
    jest.advanceTimersByTime(1000)
    expect(consolidate).toHaveBeenCalledTimes(1)

    // model busy → no pass
    status.mockReturnValue("generating")
    visibility = "hidden"; listeners.forEach((l) => l())
    jest.advanceTimersByTime(1000)
    expect(consolidate).toHaveBeenCalledTimes(1)

    off()
    expect(doc.removeEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function))
    jest.useRealTimers()
  })
})

describe("the prompt", () => {
  it("carries the three rules and the target", () => {
    const p = buildUpdatePrompt("t", ["a", "b"])
    expect(p).toContain('"update" | "delete" | "ignore"')
    expect(p).toContain('Target memory: "t"')
    expect(p).toContain("- a\n- b")
  })
})
