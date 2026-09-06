// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 * Original Aitherium WebGPU implementation — WGSL kernels ported from the PrismML
 * llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
 * NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
 * Numerics ported from owner-owned fork: github.com/PrismML-Eng/llama.cpp @ branch "prism"
 * GGUF container: public spec ggml-org/ggml docs/gguf.md (format v3).
 *
 * RangeReader — streams a remote GGUF via HTTP range requests so we NEVER download the
 * whole ~3.8 GB file to read the header/KV/tensor-infos. A growable window is extended
 * on underflow. `fetchRange` is injectable so the parser is unit-testable in Node against
 * an in-memory buffer (no network).
 */

export type RangeFetcher = (start: number, endInclusive: number) => Promise<Uint8Array>;

export interface RangeReaderInit {
  url: string;
  /** Total file size if already known (else discovered via HEAD / a 0-0 probe). */
  contentLength?: number;
  /** Injectable transport — defaults to fetch(); overridden in tests. */
  fetchRange?: RangeFetcher;
  /** Initial window size for the header + KV probe. */
  initialWindow?: number;
}

/**
 * How many times a single range GET is retried before the load is failed.
 *
 * WEIGHTS STREAM LAZILY, PER LAYER, DURING THE FIRST GENERATION (`weights.ensureLayer`),
 * so one turn issues dozens of independent range GETs against huggingface.co. With no
 * retry, ANY one of them failing transiently — a wifi blip, a 429, a proxy hiccup —
 * killed the whole turn with `Failed to fetch` after the visitor had already watched
 * "warming layer 12/36" for a minute. That is a fragile design pretending to be a network
 * problem: the expected number of failures grows with layer count.
 *
 * Retries are NOT a fix for the 2026-07-31 incident — there the fetch died because the GPU
 * process did, and no number of retries helps a renderer whose device is gone. It is fixed
 * separately (gpu-class.ts). This is the independent robustness bug found alongside it.
 */
const MAX_RANGE_ATTEMPTS = 3;

/** Retriable: a transport failure, or a server saying "later". Not a 4xx we caused. */
function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * A range fetch that makes NO progress for this long is presumed dead — a connected-but-
 * silent TCP peer, a mirror Worker whose upstream hung mid-stream, a renderer whose network
 * task died with a GPU reset. A progressing download, even a 341 MB coalesced range on a slow
 * link, is never aborted by this timer; only one that is going nowhere is. Without it, a
 * stalled fetch leaves its promise pending forever: no rejection reaches the retry loop,
 * `weights.ensureLayer` never resolves, and prefill hangs at "running M layers" with no error
 * ever surfaced (the 2026-08-08 "prefill 2825 tokens (running 28 layers)" stuck state).
 */
const RANGE_STALL_TIMEOUT_MS = 20_000;

/** Build the default browser/Node fetch-based range transport for a URL. */
export function httpRangeFetcher(url: string): RangeFetcher {
  return async (start, endInclusive) => {
    // Model weights are immutable — force-cache so repeat visits (and reloads) reuse the
    // browser HTTP cache instead of re-streaming 3.8 GB. (DevTools "Disable cache" overrides
    // this while open, so it must be unchecked to benefit during debugging.)
    const mb = ((endInclusive - start + 1) / 1048576).toFixed(1);
    let lastError = "";
    for (let attempt = 1; attempt <= MAX_RANGE_ATTEMPTS; attempt++) {
      // Per-attempt watchdog: aborts the attempt when no progress is made (headers OR body),
      // so a hung connection is retried and finally fails LOUDLY instead of hanging forever.
      const controller = new AbortController();
      let stalled = false;
      const armWatchdog = () =>
        setTimeout(() => {
          stalled = true;
          controller.abort();
        }, RANGE_STALL_TIMEOUT_MS);
      let watchdog = armWatchdog();
      const bumpWatchdog = () => {
        clearTimeout(watchdog);
        watchdog = armWatchdog();
      };
      try {
        let res: Response;
        try {
          res = await fetch(url, {
            headers: { Range: `bytes=${start}-${endInclusive}` },
            cache: "force-cache",
            signal: controller.signal,
          });
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          if (stalled) {
            lastError = `stalled (no response for ${RANGE_STALL_TIMEOUT_MS / 1000}s)`;
          }
          if (attempt < MAX_RANGE_ATTEMPTS) {
            await sleep(250 * 2 ** (attempt - 1));
            continue;
          }
          // NAME THE FAILURE. A raw TypeError("Failed to fetch") carries no URL, no size, no
          // network state — which is exactly what reached the owner's phone as the entire
          // diagnosis of the 27B failing to load, and again on 2026-07-31 as the entire
          // diagnosis of a GPU driver reset. The phone-relevant detail is the SIZE: a
          // 341 MB coalesced range (measured, 27B globals) is a plausible mobile OOM-abort,
          // and without the size in the message that hypothesis is invisible.
          const offline = typeof navigator !== "undefined" && navigator.onLine === false;
          throw new Error(
            `bonsai-gguf: fetch failed for ${mb} MB range ${start}-${endInclusive} of ${url} ` +
              `after ${MAX_RANGE_ATTEMPTS} attempts${offline ? " (browser reports OFFLINE)" : ""}. ` +
              (stalled
                ? `The server accepted the connection but never answered (stalled ${RANGE_STALL_TIMEOUT_MS / 1000}s). `
                : "") +
              `If the screen also flickered, the GPU driver reset and took this request with it — ` +
              `that is a GPU fault, not a network one. Last error: ${lastError}`,
          );
        }
        if (res.status !== 206 && res.status !== 200) {
          lastError = `HTTP ${res.status}`;
          if (isRetriableStatus(res.status) && attempt < MAX_RANGE_ATTEMPTS) {
            await sleep(250 * 2 ** (attempt - 1));
            continue;
          }
          throw new Error(
            `bonsai-gguf: range GET ${start}-${endInclusive} (${mb} MB) of ${url} returned ${res.status}`,
          );
        }
        // Read the body through a reader so the watchdog observes progress. A stall mid-stream
        // aborts the read and is RETRIED like a transport error; a device out-of-memory abort
        // is NOT (re-requesting the same oversized body just reproduces it, and each attempt
        // costs the visitor the download again).
        try {
          const body = res.body;
          if (!body) return new Uint8Array(await res.arrayBuffer());
          const reader = body.getReader();
          const chunks: Uint8Array[] = [];
          let total = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              bumpWatchdog();
              chunks.push(value);
              total += value.byteLength;
            }
          }
          const out = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) {
            out.set(c, off);
            off += c.byteLength;
          }
          return out;
        } catch (e) {
          if (stalled) {
            lastError = `stalled mid-body (no progress for ${RANGE_STALL_TIMEOUT_MS / 1000}s)`;
            if (attempt < MAX_RANGE_ATTEMPTS) {
              await sleep(250 * 2 ** (attempt - 1));
              continue;
            }
            throw new Error(
              `bonsai-gguf: range GET ${start}-${endInclusive} (${mb} MB) of ${url} stalled mid-body ` +
                `(no progress for ${RANGE_STALL_TIMEOUT_MS / 1000}s) after ${MAX_RANGE_ATTEMPTS} attempts. ` +
                `Last error: ${lastError}`,
            );
          }
          // arrayBuffer()/reader read is where a memory-pressure abort actually lands on
          // mobile.
          throw new Error(
            `bonsai-gguf: reading ${mb} MB range body failed (device out of memory?): ` +
              `${e instanceof Error ? e.message : String(e)}`,
          );
        }
      } finally {
        clearTimeout(watchdog);
      }
    }
    // Unreachable: the loop either returns or throws. Present so the function is total.
    throw new Error(`bonsai-gguf: range ${start}-${endInclusive} exhausted retries: ${lastError}`);
  };
}

/**
 * Try each URL in turn, falling to the next only when one is wholly unavailable.
 *
 * WHY A MIRROR AT ALL: every weight the Living OS runs is fetched from ONE host. If that host
 * is unreachable — an outage, a rate limit, a country blocking it, a repo taken down — the
 * in-browser brain does not degrade, it simply stops existing for every visitor at once, and
 * the only symptom is the fetch error this module works hard to name.
 *
 * WHAT A MIRROR HOST HAS TO DO, measured 2026-08-01 rather than assumed, because most
 * candidates fail one of the two and the failure is not obvious:
 *
 *     host                        range   CORS    max file
 *     huggingface.co (current)    206     *       -
 *     GitHub release asset        206     NONE    2 GB      <- browser-blocked
 *     raw.githubusercontent.com   206     *       100 MB    <- too small for any model
 *     GitHub Pages                206     *       100 MB    <- too small
 *
 * So a GitHub release CAN stream a 545 MB model and a browser still cannot read it: no
 * Access-Control-Allow-Origin. A mirror needs BOTH, which is why the list is per-URL and not
 * a host-swap — the working mirror may be a Worker or an object store in front of the
 * storage, not the storage itself.
 *
 * FAILOVER IS PER-REQUEST AND DELIBERATELY NOT STICKY. Weights stream lazily per layer over
 * the whole session, so a host that dies mid-load must be survivable at layer 40, not only
 * at layer 0. The inner fetcher already retries transient faults (408/429/5xx and transport
 * errors) with backoff, so reaching this loop means that URL is genuinely not serving —
 * moving on immediately is right, and re-trying the dead host first on the next range would
 * pay its full retry budget again on every subsequent chunk.
 */
export function mirroredRangeFetcher(urls: readonly string[]): RangeFetcher {
  const list = urls.filter(Boolean);
  if (list.length === 0) throw new Error("bonsai-gguf: mirroredRangeFetcher needs at least one URL");
  if (list.length === 1) return httpRangeFetcher(list[0]);
  const fetchers = list.map((u) => httpRangeFetcher(u));
  return async (start, endInclusive) => {
    const failures: string[] = [];
    for (let i = 0; i < fetchers.length; i++) {
      try {
        return await fetchers[i](start, endInclusive);
      } catch (e) {
        failures.push(`${list[i]}: ${e instanceof Error ? e.message : String(e)}`);
        // Say which mirror we fell to. A silent failover hides a permanently dead primary —
        // everything keeps working while the thing you thought was serving is not.
        if (i + 1 < fetchers.length) {
          console.warn(`[bonsai-gguf] mirror ${i + 1}/${fetchers.length} failed, trying next`);
        }
      }
    }
    // EVERY mirror is reported, not just the last. With one message per host the reader can
    // tell "the network is down" from "one host is down", which are different problems.
    throw new Error(
      `bonsai-gguf: all ${fetchers.length} mirrors failed for range ${start}-${endInclusive}:\n`
        + failures.map((f, i) => `  [${i + 1}] ${f}`).join("\n"),
    );
  };
}

/**
 * A forward-only reader over a growable byte window. All GGUF scalars are LITTLE-ENDIAN.
 * u64 counts are read as two u32 and returned as JS numbers (safe below 2^53).
 */
export class RangeReader {
  readonly url: string;
  private fetchRange: RangeFetcher;
  private buf: Uint8Array;
  /** Absolute file offset that byte 0 of `buf` corresponds to (we always anchor at 0). */
  private filled = 0; // bytes valid from absolute 0
  private cursor = 0; // absolute read cursor
  contentLength: number | undefined;
  private initialWindow: number;

  constructor(init: RangeReaderInit) {
    this.url = init.url;
    this.fetchRange = init.fetchRange ?? httpRangeFetcher(init.url);
    this.contentLength = init.contentLength;
    this.initialWindow = init.initialWindow ?? 1 << 20; // 1 MiB starting guess
    this.buf = new Uint8Array(0);
  }

  get position(): number {
    return this.cursor;
  }

  /** Ensure absolute bytes [0, need) are resident, range-fetching more as required. */
  async ensure(need: number): Promise<void> {
    if (need <= this.filled) return;
    // Grow in windows to amortise request count (tokenizer arrays are tens of MB).
    let target = Math.max(need, this.filled + this.initialWindow);
    if (this.contentLength !== undefined) target = Math.min(target, this.contentLength);
    const chunk = await this.fetchRange(this.filled, target - 1);
    const next = new Uint8Array(this.filled + chunk.length);
    next.set(this.buf.subarray(0, this.filled), 0);
    next.set(chunk, this.filled);
    this.buf = next;
    this.filled += chunk.length;
    if (this.filled < need) {
      throw new Error(
        `bonsai-gguf: underfilled window (have ${this.filled}, need ${need}) — server may not support ranges`,
      );
    }
  }

  private async view(len: number): Promise<DataView> {
    await this.ensure(this.cursor + len);
    return new DataView(this.buf.buffer, this.buf.byteOffset + this.cursor, len);
  }

  async u8(): Promise<number> {
    const v = (await this.view(1)).getUint8(0);
    this.cursor += 1;
    return v;
  }
  async u32(): Promise<number> {
    const v = (await this.view(4)).getUint32(0, true);
    this.cursor += 4;
    return v;
  }
  async i32(): Promise<number> {
    const v = (await this.view(4)).getInt32(0, true);
    this.cursor += 4;
    return v;
  }
  async f32(): Promise<number> {
    const v = (await this.view(4)).getFloat32(0, true);
    this.cursor += 4;
    return v;
  }
  async f64(): Promise<number> {
    const v = (await this.view(8)).getFloat64(0, true);
    this.cursor += 8;
    return v;
  }
  async u16(): Promise<number> {
    const v = (await this.view(2)).getUint16(0, true);
    this.cursor += 2;
    return v;
  }
  async i16(): Promise<number> {
    const v = (await this.view(2)).getInt16(0, true);
    this.cursor += 2;
    return v;
  }
  async i8(): Promise<number> {
    const v = (await this.view(1)).getInt8(0);
    this.cursor += 1;
    return v;
  }

  /** u64 -> Number (safe < 2^53; GGUF counts/offsets never exceed that here). */
  async u64(): Promise<number> {
    const dv = await this.view(8);
    const lo = dv.getUint32(0, true);
    const hi = dv.getUint32(4, true);
    this.cursor += 8;
    const v = hi * 0x100000000 + lo;
    if (!Number.isSafeInteger(v)) throw new Error(`bonsai-gguf: u64 ${v} exceeds MAX_SAFE_INTEGER`);
    return v;
  }
  async i64(): Promise<number> {
    return this.u64(); // values in-range for our use; signedness unused by the spec fields we read
  }

  /** gguf_string_t: u64 length + raw UTF-8 bytes. */
  async string(): Promise<string> {
    const len = await this.u64();
    await this.ensure(this.cursor + len);
    const bytes = this.buf.subarray(this.cursor, this.cursor + len);
    this.cursor += len;
    return new TextDecoder("utf-8").decode(bytes);
  }

  /** Absolute-seek the read cursor (used to jump to tensor_data_base alignment). */
  seek(absolute: number): void {
    this.cursor = absolute;
  }

  /** Copy raw bytes [start, start+len) — resident window, for small tensors/tests. */
  async bytes(start: number, len: number): Promise<Uint8Array> {
    await this.ensure(start + len);
    return this.buf.slice(start, start + len);
  }
}
