// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 * Original Aitherium WebGPU implementation — WGSL kernels ported from the PrismML
 * llama.cpp fork (github.com/PrismML-Eng/llama.cpp @ prism, Aitherium/PrismML-owned).
 * NO third-party Space code (HF Spaces bonsai-* explicitly excluded).
 * GGUF container: public spec ggml-org/ggml docs/gguf.md (format v3).
 *
 * `<file>.wasp.json` — the side-car that lets a device refuse BEFORE the first byte.
 *
 * WHY A SIDE-CAR AND NOT THE FILE ITSELF. The two numbers that decide whether a device
 * can run a model are the largest tensor's GPU footprint and the file's chunk layout.
 * Both are in the GGUF header — and reading that header means range-GETting the file,
 * which means the mirror, the CORS preflight, the retry ladder and several MB of a
 * visitor's data BEFORE anyone can say "your phone cannot hold this". A 2 KB JSON next
 * to the weights answers the same question for the cost of one small request, and it is
 * the difference between "refused instantly" and "refused after a minute of downloading".
 *
 * WHY THE HASHES. Resume. A partial cache is worthless unless the reader can prove which
 * pieces it already has; per-chunk sha256 at a FIXED chunk size makes that a lookup
 * instead of a guess. The chunk size is `WASP_CHUNK_TARGET_BYTES` and is carried in the
 * manifest rather than assumed, so a manifest generated under a different ceiling still
 * resumes correctly instead of missing every key silently.
 *
 * 🚨 ABSENCE IS NOT A FAILURE, AND IT IS NOT SILENCE EITHER. Most weight hosts serve no
 * manifest, and a loader that refused without one would be useless. So `fetchWaspManifest`
 * returns `null` and the caller falls back to the old unbounded behaviour — but it must
 * SAY SO (`WASP_NO_MANIFEST_LOG`). A loader that quietly stops bounding memory is
 * indistinguishable from one that never did, and that is precisely the state this module
 * exists to end.
 */

import { WASP_CHUNK_TARGET_BYTES } from "./index";

/** Schema version. Bumped only for a BREAKING shape change; readers refuse an unknown one. */
export const WASP_MANIFEST_VERSION = 1;

/** The exact line a loader prints when it proceeds with no manifest. One copy, so a grep finds it. */
export const WASP_NO_MANIFEST_LOG = "wasp: no manifest, unbounded upload";

/** On-disk vs on-GPU block sizes for one quant type present in the file. */
export interface WaspBlockGeometry {
  /** GGML type id (Q1_0 = 41, Q2_0 = 42, F32 = 0, F16 = 1, Q8_0 = 8). */
  type: number;
  name: string;
  /** Elements per block. */
  blockSize: number;
  /** Bytes per block ON DISK. */
  rawBlock: number;
  /** Bytes per block ON GPU after the alignment repack (Q1_0 18 -> 20, Q2_0 34 -> 36). */
  gpuBlock: number;
}

export interface WaspManifest {
  /** Schema version — `wasp` rather than `version` so a stray file is identifiable by one key. */
  wasp: number;
  /** The weight file this describes, by basename. */
  file: string;
  /** Byte length of the weight file. MUST equal the mirror's Content-Length: a
   * truncated download hashes every chunk it DID get and looks valid otherwise. */
  size: number;
  /** Chunk size the hashes below are taken at. */
  chunkBytes: number;
  /** sha256 (lowercase hex) of each `chunkBytes` slice, in order. The last may be short. */
  chunks: string[];
  /** The largest single GPU buffer this file will ask for, AFTER the repack. */
  largestTensorGpuBytes: number;
  /** Which tensor that is — so a refusal can name it instead of a number. */
  largestTensorName: string;
  /** Absolute offset where the tensor data section begins. */
  tensorDataBase: number;
  /** Every quant type present, with its block geometry. */
  geometry: WaspBlockGeometry[];
  generatedAt: string;
}

/** The manifest URL for a weight URL: the same URL with `.wasp.json` appended. */
export function manifestUrl(weightsUrl: string): string {
  // Query strings and fragments occur on signed URLs; the side-car sits beside the FILE,
  // so the suffix goes on the path and the rest is preserved. Appending blindly produced
  // `...gguf?token=x.wasp.json`, which 404s in a way that reads as "no manifest exists"
  // rather than "we asked for the wrong thing".
  const hash = weightsUrl.indexOf("#");
  const base = hash >= 0 ? weightsUrl.slice(0, hash) : weightsUrl;
  const tail = hash >= 0 ? weightsUrl.slice(hash) : "";
  const q = base.indexOf("?");
  if (q < 0) return `${base}.wasp.json${tail}`;
  return `${base.slice(0, q)}.wasp.json${base.slice(q)}${tail}`;
}

/**
 * Validate a parsed object as a manifest. Returns null rather than throwing.
 *
 * STRICT, because a half-valid manifest is worse than none: a missing
 * `largestTensorGpuBytes` read as 0 clears every device, which is the exact
 * fail-open this file exists to prevent. Every field the decision depends on is
 * required and type-checked.
 */
export function parseWaspManifest(raw: unknown): WaspManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (m.wasp !== WASP_MANIFEST_VERSION) return null;
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (typeof m.file !== "string" || !m.file) return null;
  if (!num(m.size) || m.size <= 0) return null;
  if (!num(m.chunkBytes) || m.chunkBytes <= 0) return null;
  if (!num(m.largestTensorGpuBytes) || m.largestTensorGpuBytes <= 0) return null;
  if (typeof m.largestTensorName !== "string") return null;
  if (!num(m.tensorDataBase)) return null;
  if (!Array.isArray(m.chunks) || m.chunks.some((c) => typeof c !== "string")) return null;
  // The hash count must MATCH the size at that chunk size. A manifest generated against a
  // different build of the file passes every field check above and then resumes into the
  // wrong bytes — a corruption with no error anywhere, which is the worst outcome here.
  const expected = Math.ceil(m.size / m.chunkBytes);
  if (m.chunks.length !== expected) return null;
  const geometry = Array.isArray(m.geometry) ? (m.geometry as WaspBlockGeometry[]) : [];
  return {
    wasp: WASP_MANIFEST_VERSION,
    file: m.file,
    size: m.size,
    chunkBytes: m.chunkBytes,
    chunks: m.chunks as string[],
    largestTensorGpuBytes: m.largestTensorGpuBytes,
    largestTensorName: m.largestTensorName,
    tensorDataBase: m.tensorDataBase,
    geometry,
    generatedAt: typeof m.generatedAt === "string" ? m.generatedAt : "",
  };
}

export interface FetchManifestOptions {
  /** Injectable transport so this is testable with no network. */
  fetchImpl?: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  /** Where the "no manifest" line goes. Defaults to console.info. */
  log?: (msg: string) => void;
}

/**
 * Fetch and validate the side-car for a weight URL. `null` means "proceed unbounded",
 * and saying so is part of the contract — see WASP_NO_MANIFEST_LOG above.
 */
export async function fetchWaspManifest(
  weightsUrl: string,
  opts: FetchManifestOptions = {},
): Promise<WaspManifest | null> {
  const url = manifestUrl(weightsUrl);
  const log = opts.log ?? ((m: string) => console.info(m));
  const f = opts.fetchImpl
    ?? ((u: string) => fetch(u, { cache: "force-cache" }) as unknown as Promise<{
      ok: boolean; status: number; json(): Promise<unknown>;
    }>);
  let parsed: WaspManifest | null = null;
  try {
    const res = await f(url);
    if (!res.ok) {
      log(`${WASP_NO_MANIFEST_LOG} (${url} -> HTTP ${res.status})`);
      return null;
    }
    parsed = parseWaspManifest(await res.json());
  } catch (e) {
    log(`${WASP_NO_MANIFEST_LOG} (${url} -> ${e instanceof Error ? e.message : String(e)})`);
    return null;
  }
  if (!parsed) {
    // A served-but-INVALID manifest is louder than an absent one on purpose: absent is the
    // normal state of a third-party host, malformed means OUR generator or OUR mirror is
    // wrong, and the two must not read the same in a log.
    log(`${WASP_NO_MANIFEST_LOG} (${url} served a manifest this build cannot read)`);
    return null;
  }
  return parsed;
}

/**
 * THE REFUSAL, issued before the first range GET.
 *
 * Returns a human-readable reason to refuse, or null to proceed. `limitBytes` is
 * `min(maxBufferSize, maxStorageBufferBindingSize)` read from the ADAPTER — not the
 * device, which is created with whatever limits we asked for and therefore cannot tell
 * us what the hardware can do.
 */
export function waspRefusal(m: WaspManifest | null, limitBytes: number): string | null {
  if (!m) return null; // no manifest: nothing to decide on, the sink bounds what it can
  if (!Number.isFinite(limitBytes) || limitBytes <= 0) return null;
  if (m.largestTensorGpuBytes <= limitBytes) return null;
  const mb = (n: number) => (n / 1048576).toFixed(1);
  return (
    `wasp: ${m.file} needs a ${mb(m.largestTensorGpuBytes)} MB buffer for tensor `
    + `'${m.largestTensorName}' and this adapter caps at ${mb(limitBytes)} MB. `
    + `Refused before downloading anything — a smaller model will fit.`
  );
}

/** Which chunk a byte offset falls in, at this manifest's chunk size. */
export function chunkIndexOf(m: WaspManifest, offset: number): number {
  return Math.floor(offset / m.chunkBytes);
}

/** Byte span [start, end) of chunk `i`. The last chunk is short. */
export function chunkSpan(m: WaspManifest, i: number): { start: number; end: number } {
  const start = i * m.chunkBytes;
  return { start, end: Math.min(m.size, start + m.chunkBytes) };
}

/** The chunk size a reader should use for this file: the manifest's, else the default. */
export function chunkBytesFor(m: WaspManifest | null): number {
  return m ? m.chunkBytes : WASP_CHUNK_TARGET_BYTES;
}
