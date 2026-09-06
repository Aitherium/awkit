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
 * Single forward pass over a GGUF: 24-byte header -> KV entries -> tensor-infos ->
 * aligned tensor_data_base. Everything is streamed through the RangeReader, so the
 * multi-MB tokenizer arrays extend the window without ever buffering the whole file.
 */

import { RangeReader } from "./reader";
import {
  GgufValueType,
  GgufHeader,
  GgufMetadataValue,
  GgufTensorInfo,
  tensorNBytes,
  typeTrait,
} from "./types";

export const GGUF_MAGIC = 0x46554747; // "GGUF" little-endian

export interface ParsedGguf {
  header: GgufHeader;
  kv: Map<string, GgufMetadataValue>;
  tensors: GgufTensorInfo[];
  /** align(end_of_tensor_infos, general.alignment || 32). Absolute offset of tensor data. */
  tensorDataBase: number;
  alignment: number;
}

function align(x: number, a: number): number {
  return x + ((a - (x % a)) % a);
}

async function readScalar(r: RangeReader, t: GgufValueType): Promise<GgufMetadataValue> {
  switch (t) {
    case GgufValueType.UINT8:
      return r.u8();
    case GgufValueType.INT8:
      return r.i8();
    case GgufValueType.UINT16:
      return r.u16();
    case GgufValueType.INT16:
      return r.i16();
    case GgufValueType.UINT32:
      return r.u32();
    case GgufValueType.INT32:
      return r.i32();
    case GgufValueType.FLOAT32:
      return r.f32();
    case GgufValueType.BOOL:
      return (await r.u8()) !== 0;
    case GgufValueType.STRING:
      return r.string();
    case GgufValueType.UINT64:
      return r.u64();
    case GgufValueType.INT64:
      return r.i64();
    case GgufValueType.FLOAT64:
      return r.f64();
    default:
      throw new Error(`bonsai-gguf: cannot read scalar of value-type ${t}`);
  }
}

async function readValue(r: RangeReader, t: GgufValueType): Promise<GgufMetadataValue> {
  if (t === GgufValueType.ARRAY) {
    const elemType = (await r.u32()) as GgufValueType;
    const count = await r.u64();
    if (elemType === GgufValueType.ARRAY) {
      throw new Error("bonsai-gguf: nested arrays are not permitted by the spec");
    }
    // Homogeneous packed elements. Strings/numbers handled uniformly.
    const out: unknown[] = new Array(count);
    for (let i = 0; i < count; i++) out[i] = await readScalar(r, elemType);
    return out as GgufMetadataValue;
  }
  return readScalar(r, t);
}

/** Parse header + all KV + all tensor-infos in one forward pass. */
export async function parseGguf(r: RangeReader): Promise<ParsedGguf> {
  // ---- fixed 24-byte header ----
  const magic = await r.u32();
  if (magic !== GGUF_MAGIC) {
    throw new Error(`bonsai-gguf: bad magic 0x${magic.toString(16)} (expected 0x46554747)`);
  }
  const version = await r.u32();
  if (version !== 3) {
    // We only certify v3; other versions may differ in field widths.
    throw new Error(`bonsai-gguf: unsupported GGUF version ${version} (need 3)`);
  }
  const tensorCount = await r.u64();
  const metadataKvCount = await r.u64();
  const header: GgufHeader = { version, tensorCount, metadataKvCount };

  // ---- metadata KV ----
  const kv = new Map<string, GgufMetadataValue>();
  for (let i = 0; i < metadataKvCount; i++) {
    const key = await r.string();
    const valueType = (await r.u32()) as GgufValueType;
    const value = await readValue(r, valueType);
    kv.set(key, value);
  }

  const alignment = numberKv(kv, "general.alignment", 32);

  // ---- tensor infos ----
  const tensors: GgufTensorInfo[] = [];
  for (let i = 0; i < tensorCount; i++) {
    const name = await r.string();
    const nDims = await r.u32();
    const dims: number[] = new Array(nDims);
    for (let d = 0; d < nDims; d++) dims[d] = await r.u64();
    const type = await r.u32();
    const relOffset = await r.u64();
    const nElements = dims.reduce((a, b) => a * b, 1);
    // Validate the type is known (this is where Q1_0=41 must be accepted, not rejected).
    typeTrait(type);
    const nBytes = tensorNBytes(type, nElements);
    tensors.push({ name, dims, type, relOffset, nElements, nBytes });
  }

  const tensorDataBase = align(r.position, alignment);
  assertBlockGeometry(tensors, alignment);
  return { header, kv, tensors, tensorDataBase, alignment };
}

/**
 * Cross-check every tensor's COMPUTED byte length against the space the file actually
 * leaves for it, and refuse the file on any mismatch.
 *
 * WHY THIS IS NOT PARANOIA — a real, shipping file defeats type-id dispatch. PrismML
 * publishes two incompatible ternary formats under the SAME ggml type id 42:
 *   - `*-Q2_0.gguf`      group 128, 34 B/block (0.2656 B/weight) — what this runtime implements
 *   - `*-Q2_0_g64.gguf`  group  64, 18 B/block (0.28125 B/weight) — the mainline llama.cpp format
 * Their own README states it plainly: "same type id, different block size". `nBytes` here is
 * COMPUTED from TYPE_TRAITS, never read from the file, so nothing downstream can tell them
 * apart — a g64 file loads clean, reads at the wrong stride, and produces fluent garbage
 * rather than an error (the D-812 class). And the README says the g64 files are to be
 * RENAMED to plain `Q2_0`, so the name this runtime expects will eventually carry the layout
 * it cannot read.
 *
 * The check is exact, not heuristic. Tensor offsets are the file's own, so the gap to the
 * next tensor is ground truth for the previous one's length. Measured 2026-07-28 on
 * Ternary-Bonsai-1.7B: the group-128 file has 0 mismatches across all 310 tensors, the g64
 * file has 197 — every quantized tensor, each off by exactly (18/64)/(34/128) = 1.0588.
 * A discriminator with no overlap, so this can be a hard failure with no false-positive risk.
 *
 * Only the LAST tensor is unchecked (no successor to bound it); its length would need the
 * file size, which the parser does not have.
 */
function assertBlockGeometry(tensors: GgufTensorInfo[], alignment: number): void {
  if (tensors.length < 2) return;
  const byOffset = [...tensors].sort((a, b) => a.relOffset - b.relOffset);

  for (let i = 0; i < byOffset.length - 1; i++) {
    const t = byOffset[i];
    const gap = byOffset[i + 1].relOffset - t.relOffset;
    const expected = align(t.nBytes, alignment);
    if (gap === expected) continue;

    const trait = typeTrait(t.type);
    const ratio = t.nBytes > 0 ? gap / t.nBytes : 0;
    throw new Error(
      `bonsai-gguf: tensor '${t.name}' (type ${t.type} = ${trait.name}) occupies ${gap} bytes ` +
        `in the file but this build computes ${t.nBytes} (aligned ${expected}) from ` +
        `${trait.blockSize} weights/${trait.typeSize} bytes per block — a factor of ` +
        `${ratio.toFixed(4)}. The declared type id does not match the file's actual block ` +
        `geometry, so every read of this tensor would be at the wrong stride and would ` +
        `produce plausible-looking WRONG values rather than an error. ` +
        `If this is a '*_g64' ternary file, it uses group 64 under the same type id 42 and ` +
        `is NOT loadable by this runtime — use the group-128 '*-Q2_0.gguf' build.`,
    );
  }
}

function numberKv(kv: Map<string, GgufMetadataValue>, key: string, fallback: number): number {
  const v = kv.get(key);
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  return fallback;
}
