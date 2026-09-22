/**
 * @jest-environment jsdom
 */

/**
 * ChatMemory — the kit's default conversation memory. What each arm pins:
 *  - turns persist and recall works with NO embedder (keyword) — honest degradation, and
 *    `stats().embedded` says so instead of pretending;
 *  - with an embedder, turns carry vectors, recall is semantic, and the sleep-time queue
 *    is built older<-newer (the write path is model-free);
 *  - consolidate goes through the kit rules: consent first, delete = tombstone, and the
 *    tombstone is hidden from recall;
 *  - a memory failure never throws into a chat turn.
 */

jest.mock("../consent", () => ({
  mayAutoLoadModel: jest.fn(() => true),
  readModelConsent: jest.fn(() => null),
  hasModelConsent: jest.fn(() => true),
  grantModelConsent: jest.fn(),
  revokeModelConsent: jest.fn(),
  MODEL_CONSENT_KEY: "aitheros-bonsai-consent",
}))

import { ChatMemory, defaultChatMemory, resetDefaultChatMemory } from "../chat-memory"
import { InMemoryMemoryStore } from "../session-memory/store"
import { StubEmbedder, UnavailableEmbedder } from "../session-memory/embedder"

let t = 1_000
const now = () => (t += 1_000)

describe("no embedder wired — keyword lane, honestly reported", () => {
  it("remembers turns, recalls by keyword, reports embedded=0", async () => {
    const mem = new ChatMemory({ store: new InMemoryMemoryStore(), embedder: new UnavailableEmbedder(), now })
    await mem.remember("c1", "user", "my dog is called Rex and he loves the beach")
    await mem.remember("c1", "assistant", "Rex sounds lovely.")
    await mem.remember("c2", "user", "unrelated conversation about taxes")
    const hits = await mem.recall("c1", "which beach does my dog love")
    expect(hits.map((h) => h.source)).toEqual(["keyword", "keyword"]) // "lovely" matches "love" too; the beach turn ranks first
    expect(hits[0].text).toContain("Rex")
    expect(await mem.recallBlock("c1", "beach")).toContain("- (user) my dog is called Rex")
    expect(await mem.recall("c2", "beach")).toEqual([]) // scoped by conversation
    expect(await mem.stats()).toMatchObject({ turns: 3, embedded: 0, tombstoned: 0, embedderProvider: "unavailable" })
    expect(await mem.hasSleepWork()).toBe(false) // nothing to queue without vectors
  })

  it("an empty turn is a no-op and a throwing store never throws into the caller", async () => {
    const store = new InMemoryMemoryStore()
    store.add = async () => { throw new Error("quota") }
    const mem = new ChatMemory({ store, now })
    expect(await mem.remember("c1", "user", "   ")).toBeNull()
    expect(await mem.remember("c1", "user", "hello")).toBeNull()
    expect(await mem.recall("c1", "hello")).toEqual([])
  })
})

describe("with an embedder — semantic lane + sleep-time queue", () => {
  it("vectors land, recall is semantic, the newer turn queues the older one", async () => {
    const store = new InMemoryMemoryStore()
    const mem = new ChatMemory({ store, embedder: new StubEmbedder(), now })
    const a = await mem.remember("c1", "user", "the office opens at nine every weekday morning")
    const b = await mem.remember("c1", "user", "the office opens at nine every weekday morning and closes at five")
    expect(a?.embedding?.length).toBeGreaterThan(0)
    const rows = await store.all()
    expect(rows.find((r) => r.id === b!.id)!.updateQueue?.map((q) => q.id)).toEqual([a!.id])
    expect(await mem.hasSleepWork()).toBe(true)
    const hits = await mem.recall("c1", "the office opens at nine every weekday")
    expect(hits[0].source).toBe("semantic")
    expect((await mem.stats()).embedded).toBe(2)
  })

  it("MUTATION ARM: consolidate tombstones the OLDER turn, recall hides it, the newer survives", async () => {
    const store = new InMemoryMemoryStore()
    const mem = new ChatMemory({ store, embedder: new StubEmbedder(), now })
    const older = await mem.remember("c1", "user", "the meeting is on tuesday at ten")
    const newer = await mem.remember("c1", "user", "the meeting moved to wednesday at ten")
    const generate = jest.fn(async (_p: string) => '{"action":"delete"}')
    const res = await mem.consolidate(generate)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate.mock.calls[0][0]).toContain(`Target memory: "${older!.text}"`)
    expect(res).toMatchObject({ decided: 1, tombstoned: 1 })
    const rows = await store.all()
    expect(rows.find((r) => r.id === older!.id)).toMatchObject({ tombstoned: true, supersededBy: newer!.id })
    const hits = await mem.recall("c1", "when is the meeting")
    expect(hits.map((h) => h.id)).toEqual([newer!.id])
    expect(await mem.stats()).toMatchObject({ turns: 1, tombstoned: 1 })
  })
})

describe("the kit default", () => {
  it("is one instance per origin and falls back to memory when IndexedDB is absent", async () => {
    resetDefaultChatMemory()
    const a = defaultChatMemory()
    expect(defaultChatMemory()).toBe(a)
    expect((await a.stats()).embedderProvider).toBe("unavailable")
    resetDefaultChatMemory()
  })
})
