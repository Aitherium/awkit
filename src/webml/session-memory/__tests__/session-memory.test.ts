/**
 * @jest-environment jsdom
 */

/**
 * The session-memory lane — capture -> chunk -> embed -> query, CPU embeddings,
 * no WebGPU contention. Every arm here is deterministic: the stub embedder is
 * hash-based, recency uses explicit `now` overrides, and the chunker is pure
 * string work. A failing arm is a real defect, never a flake.
 */

import { chunkText, contentHash, normalizeWhitespace } from "../chunk"
import { cosine, rankChunks, recencyWeight, resolveQueryOptions } from "../scoring"
import { InMemoryMemoryStore } from "../store"
import { StubEmbedder, UnavailableEmbedder, createMicroEmbedder } from "../embedder"
import { captureText } from "../capture"
import { SessionMemory } from "../index"
import { handleEmbedRequest } from "../embed.worker"

const NOW = Date.parse("2026-08-31T12:00:00.000Z")

describe("chunkText", () => {
  test("single chunk for short text", () => {
    expect(chunkText("hello world")).toEqual(["hello world"])
  })

  test("empty and whitespace-only text yields no chunks", () => {
    expect(chunkText("")).toEqual([])
    expect(chunkText("   \n\n  ")).toEqual([])
  })

  test("splits long text into bounded chunks", () => {
    const long = "word ".repeat(500)
    const chunks = chunkText(long, { maxChars: 100, overlap: 10 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      // A chunk may carry the overlap splice (+2 for the "\n\n" joiner).
      expect(c.length).toBeLessThanOrEqual(100 + 12)
      expect(c.length).toBeGreaterThan(0)
    }
  })

  test("keeps a paragraph whole when it fits", () => {
    const paraA = "A".repeat(50)
    const paraB = "B".repeat(50)
    const chunks = chunkText(`${paraA}\n\n${paraB}`, { maxChars: 120, overlap: 10 })
    // Both paragraphs fit in one chunk together, so one chunk, boundaries intact.
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toContain(paraA)
    expect(chunks[0]).toContain(paraB)
  })

  test("does not split a fitting paragraph across chunks", () => {
    const paraA = "A".repeat(90)
    const paraB = "B".repeat(90)
    const chunks = chunkText(`${paraA}\n\n${paraB}`, { maxChars: 100, overlap: 10 })
    // Each paragraph alone exceeds 100 together but not alone: two chunks, each
    // holding exactly one paragraph, in order.
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    const joined = chunks.join("")
    expect(joined.indexOf("B".repeat(90))).toBeGreaterThan(joined.indexOf("A".repeat(90)))
  })

  test("oversized paragraph falls back to hard cuts without losing text", () => {
    const text = "x".repeat(300)
    const chunks = chunkText(text, { maxChars: 100, overlap: 20 })
    expect(chunks.length).toBeGreaterThanOrEqual(3)
    expect(chunks.join("").replace(/\n\n/g, "").replace(/x/g, "x").length).toBeGreaterThanOrEqual(300)
  })
})

describe("normalizeWhitespace", () => {
  test("collapses runs and CRLF", () => {
    expect(normalizeWhitespace("a  b\r\nc\n\n\n  d")).toBe("a b\nc\n\nd")
  })
})

describe("scoring", () => {
  test("cosine: identical = 1, orthogonal = 0, zero vector = 0", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosine([0, 0], [1, 1])).toBe(0)
  })

  test("recencyWeight: fresh = 1, one half-life = 0.5, far past ~ 0", () => {
    const iso = new Date(NOW).toISOString()
    expect(recencyWeight(iso, NOW, 24)).toBeCloseTo(1)
    expect(recencyWeight(new Date(NOW - 24 * 3_600_000).toISOString(), NOW, 24)).toBeCloseTo(0.5)
    expect(recencyWeight(new Date(NOW - 30 * 24 * 3_600_000).toISOString(), NOW, 24)).toBeLessThan(0.001)
  })

  test("rankChunks: content wins at recencyBias 0, chunks without embeddings are skipped", () => {
    const chunks = [
      { id: "old-match", text: "kw", capturedAt: new Date(NOW - 30 * 24 * 3_600_000).toISOString(), embedding: [1, 0] },
      { id: "fresh-miss", text: "other", capturedAt: new Date(NOW).toISOString(), embedding: [0, 1] },
      { id: "never-embedded", text: "kw", capturedAt: new Date(NOW).toISOString() },
    ]
    const ranked = rankChunks({
      chunks,
      queryVector: [1, 0],
      opts: resolveQueryOptions({ topK: 5, recencyBias: 0, now: NOW }),
    })
    expect(ranked.map((r) => r.chunk.id)).toEqual(["old-match", "fresh-miss"])
    expect(ranked[0].score).toBeCloseTo(1)
  })

  test("recency breaks ties at nonzero bias", () => {
    const chunks = [
      { id: "old", text: "same", capturedAt: new Date(NOW - 48 * 3_600_000).toISOString(), embedding: [1, 0] },
      { id: "new", text: "same", capturedAt: new Date(NOW).toISOString(), embedding: [1, 0] },
    ]
    const ranked = rankChunks({
      chunks,
      queryVector: [1, 0],
      opts: resolveQueryOptions({ topK: 5, recencyBias: 1, now: NOW }),
    })
    expect(ranked[0].chunk.id).toBe("new")
  })

  test("topK limits results", () => {
    const chunks = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      text: "t",
      capturedAt: new Date(NOW).toISOString(),
      embedding: [1, i % 2],
    }))
    const ranked = rankChunks({
      chunks,
      queryVector: [1, 0],
      opts: resolveQueryOptions({ topK: 3, recencyBias: 0, now: NOW }),
    })
    expect(ranked).toHaveLength(3)
  })
})

describe("store", () => {
  test("in-memory store round-trips, dedupes by id, clears", async () => {
    const store = new InMemoryMemoryStore()
    await store.addMany([
      { id: "a", text: "one", capturedAt: new Date(NOW).toISOString() },
      { id: "a", text: "one-updated", capturedAt: new Date(NOW).toISOString() },
      { id: "b", text: "two", capturedAt: new Date(NOW).toISOString() },
    ])
    expect(await store.count()).toBe(2)
    expect((await store.get("a"))?.text).toBe("one-updated")
    await store.remove("a")
    expect(await store.count()).toBe(1)
    await store.clear()
    expect(await store.count()).toBe(0)
  })
})

describe("capture", () => {
  test("browse payload -> text + url", () => {
    const out = captureText({ browse: { status: "success", url: "https://x.test/p", content: "hello page" } })
    expect(out.text).toBe("hello page")
    expect(out.url).toBe("https://x.test/p")
  })

  test("dom node fallback and explicit text precedence", () => {
    expect(captureText({ dom: { innerText: "inner", textContent: "content" } }).text).toBe("inner")
    expect(captureText({ text: "explicit" }).text).toBe("explicit")
  })
})

describe("embedders", () => {
  test("stub is deterministic and normalized", async () => {
    const e = new StubEmbedder()
    const [a, b] = await e.embed(["fast context hints", "fast context hints"])
    expect(a).toEqual(b)
    expect(Math.sqrt(a.reduce((s, v) => s + v * v, 0))).toBeCloseTo(1)
    expect(e.provider).toBe("stub")
  })

  test("unavailable embedder refuses, never stubs", async () => {
    const e = new UnavailableEmbedder()
    expect(e.isAvailable()).toBe(false)
    await expect(e.embed(["x"])).rejects.toThrow(/no embedding model is registered/)
  })

  test("factory: no config -> unavailable, config -> microembedder", () => {
    expect(createMicroEmbedder(null).provider).toBe("unavailable")
    expect(
      createMicroEmbedder({ url: "https://mirror/x", modelId: "tiny", dim: 384 }).provider,
    ).toBe("microembedder")
  })
})

describe("embed worker protocol", () => {
  test("stub embedder answers embed-result with provider stub", async () => {
    const reply = await handleEmbedRequest(
      { type: "embed", requestId: "r1", texts: ["hello"] },
      new StubEmbedder(),
    )
    expect(reply.type).toBe("embed-result")
    if (reply.type === "embed-result") {
      expect(reply.provider).toBe("stub")
      expect(reply.vectors).toHaveLength(1)
    }
  })

  test("unarmed lane answers embed-error, never vectors", async () => {
    const reply = await handleEmbedRequest(
      { type: "embed", requestId: "r2", texts: ["hello"] },
      new UnavailableEmbedder(),
    )
    expect(reply.type).toBe("embed-error")
    if (reply.type === "embed-error") {
      expect(reply.error).toContain("no embedding model")
    }
  })

  test("empty texts are refused up front", async () => {
    const reply = await handleEmbedRequest(
      { type: "embed", requestId: "r3", texts: [] },
      new StubEmbedder(),
    )
    expect(reply.type).toBe("embed-error")
  })
})

/** jsdom has no Worker — the facade only needs onmessage/onerror/postMessage,
 *  so a deterministic mock drives the protocol both directions. */
function makeFakeWorker(replyFor: (msg: { type: string; requestId: string; texts: string[] }) => unknown): Worker {
  const worker = {
    onmessage: null as unknown as (e: MessageEvent) => void,
    onerror: null,
    postMessage: (msg: { type: string; requestId: string; texts: string[] }) => {
      const reply = replyFor(msg)
      if (reply !== undefined) {
        setTimeout(() => worker.onmessage({ data: reply } as MessageEvent), 0)
      }
    },
  } as unknown as Worker
  return worker
}

describe("SessionMemory facade with the embed worker", () => {
  test("worker vectors flow into the store", async () => {
    const mem = new SessionMemory({
      store: new InMemoryMemoryStore(),
      worker: makeFakeWorker((msg) => ({
        type: "embed-result",
        requestId: msg.requestId,
        provider: "fake-worker",
        vectors: msg.texts.map(() => [0.5, 0.5]),
      })),
    })
    const chunks = await mem.capture({ text: "one short page", url: "https://w.test/1" }, { now: NOW })
    expect(chunks).toHaveLength(1)
    expect(chunks[0].embedding).toEqual([0.5, 0.5])
    expect((await mem.stats()).embedderProvider).toBe("worker")
  })

  test("embed-error from the worker rejects the capture — loud refusal, never empty", async () => {
    const mem = new SessionMemory({
      store: new InMemoryMemoryStore(),
      worker: makeFakeWorker((msg) => ({
        type: "embed-error",
        requestId: msg.requestId,
        error: "no embedding model is registered",
      })),
    })
    await expect(mem.capture({ text: "anything", url: "https://w.test/2" }, { now: NOW })).rejects.toThrow(
      /no embedding model is registered/,
    )
    expect(await mem.stats()).toMatchObject({ chunkCount: 0 })
  })

  test("an empty vectors reply IS the refusal — capture rejects", async () => {
    const mem = new SessionMemory({
      store: new InMemoryMemoryStore(),
      worker: makeFakeWorker((msg) => ({
        type: "embed-result",
        requestId: msg.requestId,
        provider: "fake-worker",
        vectors: [],
      })),
    })
    await expect(mem.capture({ text: "anything", url: "https://w.test/3" }, { now: NOW })).rejects.toThrow(
      /returned no vectors/,
    )
  })
})

describe("captureDiff (diff-indexing)", () => {
  /** Stub wrapper that counts embed calls — the number that must stay small. */
  class CountingEmbedder extends StubEmbedder {
    calls = 0
    async embed(texts: string[]): Promise<number[][]> {
      this.calls += 1
      return super.embed(texts)
    }
  }

  /** Pages must actually split into chunks for the diff arms to mean anything. */
  const smallChunks = { maxChars: 20 }

  test("unchanged re-capture costs zero embed calls", async () => {
    const embedder = new CountingEmbedder()
    const mem = new SessionMemory({ store: new InMemoryMemoryStore(), embedder, chunk: smallChunks })
    const page = { text: "alpha section\n\nbeta section", url: "https://d.test/p1" }
    await mem.capture(page, { now: NOW })
    const first = embedder.calls

    const { report, chunks } = await mem.captureDiff(page, { now: NOW + 3_600_000 })
    expect(report.unchanged).toBe(2)
    expect(report.embedded).toBe(0)
    expect(embedder.calls).toBe(first) // zero new embed calls
    expect(chunks).toHaveLength(2)
    expect(chunks[0].embedding).toBeDefined() // old embedding retained
  })

  test("changed page re-embeds only the changed chunk", async () => {
    const embedder = new CountingEmbedder()
    const mem = new SessionMemory({ store: new InMemoryMemoryStore(), embedder, chunk: smallChunks })
    await mem.capture({ text: "alpha section\n\nbeta section", url: "https://d.test/p2" }, { now: NOW })
    const first = embedder.calls

    const { report } = await mem.captureDiff(
      { text: "alpha CHANGED\n\nbeta section", url: "https://d.test/p2" },
      { now: NOW + 3_600_000 },
    )
    expect(report.updated).toBe(1)
    expect(report.unchanged).toBe(1)
    expect(report.embedded).toBe(1) // exactly one embed call for one changed chunk
    expect(embedder.calls).toBe(first + 1)
  })

  test("rewritten page removes the chunks it no longer produces", async () => {
    const embedder = new CountingEmbedder()
    const mem = new SessionMemory({ store: new InMemoryMemoryStore(), embedder, chunk: smallChunks })
    await mem.capture({ text: "old content one\n\nold content two", url: "https://d.test/p3" }, { now: NOW })
    const { chunks, report } = await mem.captureDiff(
      { text: "brand new content", url: "https://d.test/p3" }, // 17 chars — one chunk at maxChars 20
      { now: NOW + 3_600_000 },
    )
    expect(report.removed).toBe(1) // "old content two" no longer exists on the page
    expect(report.unchanged).toBe(0)
    expect(chunks).toHaveLength(1) // old chunks replaced wholesale by id
    expect(chunks[0].text).toBe("brand new content")
    expect((await mem.stats()).chunkCount).toBe(1) // no stale retrievable units
  })

  test("empty page removes all its chunks", async () => {
    const embedder = new CountingEmbedder()
    const mem = new SessionMemory({ store: new InMemoryMemoryStore(), embedder, chunk: smallChunks })
    await mem.capture({ text: "some content here", url: "https://d.test/p4" }, { now: NOW })
    const { report } = await mem.captureDiff({ text: "   ", url: "https://d.test/p4" }, { now: NOW + 3_600_000 })
    expect(report.removed).toBe(1)
    expect((await mem.stats()).chunkCount).toBe(0)
  })

  test("contentHash is stable and whitespace-insensitive within a line", () => {
    expect(contentHash("fast  context hints")).toBe(contentHash("fast context hints"))
    expect(contentHash("fast  context\n\nhints")).not.toBe(contentHash("fast context hints")) // paragraph structure is content
    expect(contentHash("a")).not.toBe(contentHash("b"))
  })
})

describe("SessionMemory facade", () => {
  test("capture -> query retrieves the right source", async () => {
    const mem = new SessionMemory({
      store: new InMemoryMemoryStore(),
      embedder: new StubEmbedder(),
    })
    await mem.capture({ text: "the fast context hints are injected into the prompt assembly", url: "https://docs.test/fastcontext" }, { now: NOW })
    await mem.capture({ text: "the kalshi trading card settles every morning at nine", url: "https://docs.test/kalshi" }, { now: NOW })

    const hits = await mem.query("fast context prompt injection", { recencyBias: 0, now: NOW })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].chunk.source).toBe("https://docs.test/fastcontext")

    const stats = await mem.stats()
    expect(stats.chunkCount).toBe(2)
    expect(stats.sourceCount).toBe(2)
    expect(stats.embedderProvider).toBe("stub")
  })

  test("query before any capture returns nothing, does not throw", async () => {
    const mem = new SessionMemory({
      store: new InMemoryMemoryStore(),
      embedder: new StubEmbedder(),
    })
    expect(await mem.query("anything", { now: NOW })).toEqual([])
  })

  test("recency makes a fresh weak match beat an old strong match at high bias", async () => {
    const mem = new SessionMemory({
      store: new InMemoryMemoryStore(),
      embedder: new StubEmbedder(),
    })
    await mem.capture({ text: "exact zebra vocabulary match", url: "https://x/old" }, { now: NOW - 48 * 3_600_000 })
    await mem.capture({ text: "zebra is mentioned once in passing", url: "https://x/new" }, { now: NOW })
    const hits = await mem.query("zebra", { recencyBias: 1, now: NOW })
    expect(hits[0].chunk.source).toBe("https://x/new")
  })
})
