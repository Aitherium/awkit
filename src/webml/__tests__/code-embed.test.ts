/**
 * The pure half of the on-device code-search embedder.
 *
 * Every assertion here is about a fact of the WEIGHTS that a wrong implementation would
 * not surface as an error: an asymmetric model given the wrong prefix, a nomic prefix left
 * in front of the instruction, an un-normalised vector fed to a dot-product ranker. Each of
 * those still produces a vector; it is just the wrong one, and it ranks the wrong thing.
 */

import {
  CODE_EMBED_MODEL,
  CODE_EMBED_ONNX_ASSETS,
  CODE_EMBED_ONNX_MODEL_KEY,
  codeEmbedOnnxAssetUrl,
  codeEmbedPrepare,
  l2Normalize,
  rangedFetchBlob,
  stripNomicPrefix,
} from "../code-embed";

describe("codeEmbedPrepare — asymmetric, and only the model's own prefix", () => {
  it("applies the instruction prefix to a QUERY, real newline included", () => {
    const out = codeEmbedPrepare("where is the auth middleware", "query");
    expect(out).toBe(CODE_EMBED_MODEL.queryPrefix + "where is the auth middleware");
    // The prefix is the trained one: an instruction line, a newline, then `Query: `.
    expect(CODE_EMBED_MODEL.queryPrefix).toMatch(/^Instruct: .*\nQuery: $/);
    expect(out.includes("\\n")).toBe(false); // a literal backslash-n would be the wrong prefix
  });

  it("applies NO prefix to a DOCUMENT", () => {
    const doc = "lib/security/ — identity, sessions, RBAC.";
    expect(codeEmbedPrepare(doc, "document")).toBe(doc);
  });

  it("strips GobboNet's nomic prefixes in both modes, then applies its own", () => {
    expect(codeEmbedPrepare("search_query: find the RAG engine", "query")).toBe(
      CODE_EMBED_MODEL.queryPrefix + "find the RAG engine",
    );
    expect(codeEmbedPrepare("search_document: some directory summary", "document")).toBe(
      "some directory summary",
    );
    // Only a LEADING prefix is a prefix; the same words mid-text are content.
    expect(stripNomicPrefix("note: search_query: is a nomic convention")).toBe(
      "note: search_query: is a nomic convention",
    );
  });

  it("rejects empty input rather than embedding it", () => {
    expect(() => codeEmbedPrepare("", "query")).toThrow(/empty/);
    expect(() => codeEmbedPrepare("   \n", "document")).toThrow(/empty/);
    // A nomic prefix with nothing behind it is still empty.
    expect(() => codeEmbedPrepare("search_document: ", "document")).toThrow(/empty/);
  });

  it("refuses an unknown mode — a typo must not silently become 'document'", () => {
    expect(() => codeEmbedPrepare("x", "passage" as unknown as "query")).toThrow(/unknown mode/);
  });
});

describe("l2Normalize", () => {
  it("yields a unit vector", () => {
    const v = l2Normalize([3, 4]);
    expect(v[0]).toBeCloseTo(0.6, 12);
    expect(v[1]).toBeCloseTo(0.8, 12);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 12);
  });

  it("is idempotent on an already-normalised vector", () => {
    const once = l2Normalize([0.1, -0.2, 0.3, 0.9]);
    const twice = l2Normalize(once);
    once.forEach((x, i) => expect(twice[i]).toBeCloseTo(x, 12));
  });

  it("does not mutate its input", () => {
    const input = [1, 2, 2];
    l2Normalize(input);
    expect(input).toEqual([1, 2, 2]);
  });

  it("refuses an empty, zero or non-finite vector instead of manufacturing NaNs", () => {
    expect(() => l2Normalize([])).toThrow(/empty/);
    expect(() => l2Normalize([0, 0, 0])).toThrow(/zero or non-finite/);
    expect(() => l2Normalize([1, Number.NaN])).toThrow(/zero or non-finite/);
  });
});

describe("CODE_EMBED_MODEL — the measured facts", () => {
  it("names the q4 browser weight on the artifact mirror, 1024-dim", () => {
    expect(CODE_EMBED_MODEL.id).toBe("aither-code-embed");
    expect(CODE_EMBED_MODEL.url).toMatch(/^https:\/\/artifact\.aitherium\.com\/.+\.q4_k_m\.gguf$/);
    expect(CODE_EMBED_MODEL.dim).toBe(1024);
    expect(CODE_EMBED_MODEL.sizeMb).toBe(378);
  });
});

describe("codeEmbedOnnxAssetUrl — the WebGPU lane's flat mirror names", () => {
  const base = "https://artifact.aitherium.com/aither-code-embed-v1/";

  it("maps transformers.js's model-relative fetches onto the release's prefixed assets", () => {
    expect(codeEmbedOnnxAssetUrl(base, base + CODE_EMBED_ONNX_MODEL_KEY + "/config.json")).toBe(
      base + "aither-code-embed.config.json",
    );
    // The WebGPU worker runs dtype `q4` (fp16/q4f16 zero on the ORT-web WebGPU EP; measured
    // 2026-09-03). `model_q4f16` was never mapped after that finding — assert the real dtype.
    expect(
      codeEmbedOnnxAssetUrl(base, base + CODE_EMBED_ONNX_MODEL_KEY + "/onnx/model_q4.onnx"),
    ).toBe(base + "aither-code-embed.model_q4.onnx");
  });

  it("drops a query string before mapping, so ?download=true cannot defeat the table", () => {
    expect(
      codeEmbedOnnxAssetUrl(base, base + CODE_EMBED_ONNX_MODEL_KEY + "/tokenizer.json?download=true"),
    ).toBe(base + "aither-code-embed.tokenizer.json");
  });

  it("passes an unlisted (optional) file through under the release with no prefix", () => {
    // generation_config.json is optional to transformers.js; the mirror answers 404 and
    // the load continues. It must NOT be silently renamed to something that exists.
    expect(
      codeEmbedOnnxAssetUrl(base, base + CODE_EMBED_ONNX_MODEL_KEY + "/generation_config.json"),
    ).toBe(base + "generation_config.json");
  });

  it("leaves fetches outside the model prefix untouched (the ORT runtime, other hosts)", () => {
    for (const u of ["/workers/ort-wasm-simd-threaded.jsep.wasm", "https://example.com/x.json", base + "other-model/config.json"]) {
      expect(codeEmbedOnnxAssetUrl(base, u)).toBe(u);
    }
  });

  it("every mapped asset name carries the model prefix (the flat-map collision rule)", () => {
    for (const name of Object.values(CODE_EMBED_ONNX_ASSETS)) {
      expect(name.startsWith("aither-code-embed.")).toBe(true);
      expect(name.includes("/")).toBe(false);
    }
  });
});

describe("rangedFetchBlob — the mirror's whole-file proxy truncates large files, ranges do not", () => {
  function mockFetch(total: number, opts: { truncateAt?: number } = {}): typeof fetch {
    return (async (_url: string, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string>)?.Range || "";
      const m = /bytes=(\d+)-(\d+)/.exec(range)!;
      const start = Number(m[1]);
      const end = Math.min(Number(m[2]), total - 1);
      let len = end - start + 1;
      if (opts.truncateAt !== undefined && start >= opts.truncateAt) len = Math.max(0, len - 5);
      const body = new Uint8Array(len);
      return {
        status: 206,
        headers: new Map([["content-range", `bytes ${start}-${end}/${total}`]]) as unknown as Headers,
        blob: async () => new Blob([body]),
        clone() { return this; },
      } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  it("assembles the whole file from chunks and reports progress to the total", async () => {
    const total = 100;
    const seen: number[] = [];
    const blob = await rangedFetchBlob("https://m/x.gguf", {
      fetchImpl: mockFetch(total), chunkBytes: 32, onProgress: (l, t) => { expect(t).toBe(total); seen.push(l); },
    });
    expect(blob.size).toBe(total);
    expect(seen[seen.length - 1]).toBe(total);
  });

  it("throws on a short chunk instead of assembling a corrupt file", async () => {
    await expect(
      rangedFetchBlob("https://m/x.gguf", { fetchImpl: mockFetch(100, { truncateAt: 32 }), chunkBytes: 32 }),
    ).rejects.toThrow(/truncated/);
  });

  it("refuses when the server ignores Range (a 200 whole-file answer)", async () => {
    const f = (async () => ({ status: 200, headers: new Map() as unknown as Headers }) as unknown as Response) as unknown as typeof fetch;
    await expect(rangedFetchBlob("https://m/x.gguf", { fetchImpl: f })).rejects.toThrow(/did not honour Range/);
  });
});
