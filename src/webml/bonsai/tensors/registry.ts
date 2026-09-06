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
 * Tensor registry + range coalescer. Maps name -> absolute byte span, and groups the
 * contiguous tensors of a block into a single ranged GET to cut request count. Because
 * tensor offsets ascend and the data section is contiguous, adjacency is exact.
 */

import type { GgufTensorInfo } from "../gguf/types";
import type { ParsedGguf } from "../gguf/parser";

export interface TensorEntry {
  name: string;
  type: number;
  dims: number[];
  /** Absolute file offset = tensorDataBase + relOffset. */
  absStart: number;
  nBytes: number;
  absEnd: number; // exclusive
}

export interface CoalescedRange {
  absStart: number;
  absEnd: number; // exclusive
  nBytes: number;
  members: TensorEntry[];
}

export class TensorRegistry {
  readonly byName = new Map<string, TensorEntry>();
  readonly ordered: TensorEntry[] = [];
  readonly tensorDataBase: number;

  constructor(parsed: ParsedGguf) {
    this.tensorDataBase = parsed.tensorDataBase;
    for (const info of parsed.tensors) {
      const e = this.toEntry(info, parsed.tensorDataBase);
      this.byName.set(e.name, e);
      this.ordered.push(e);
    }
    // Offsets ascend, but do not assume the info order matches; sort defensively.
    this.ordered.sort((a, b) => a.absStart - b.absStart);
  }

  private toEntry(info: GgufTensorInfo, base: number): TensorEntry {
    const absStart = base + info.relOffset;
    return {
      name: info.name,
      type: info.type,
      dims: info.dims,
      absStart,
      nBytes: info.nBytes,
      absEnd: absStart + info.nBytes,
    };
  }

  get(name: string): TensorEntry {
    const e = this.byName.get(name);
    if (!e) throw new Error(`bonsai-tensors: no tensor named '${name}'`);
    return e;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** All tensors whose name starts with `prefix` (e.g. "blk.0."). */
  withPrefix(prefix: string): TensorEntry[] {
    return this.ordered.filter((e) => e.name.startsWith(prefix));
  }

  /**
   * Coalesce a set of tensors into contiguous ranged GETs. Adjacent members
   * (end == next.start) merge; a gap larger than `maxGap` splits into a new range so
   * we never fetch large dead spans.
   */
  coalesce(entries: TensorEntry[], maxGap = 1 << 20, maxBytes = 64 << 20): CoalescedRange[] {
    const sorted = [...entries].sort((a, b) => a.absStart - b.absStart);
    const ranges: CoalescedRange[] = [];
    for (const e of sorted) {
      const last = ranges[ranges.length - 1];
      // `maxBytes` caps how large a single coalesced range may GROW. Every range becomes
      // one HTTP fetch into one ArrayBuffer, and merging adjacent giants is how the 27B's
      // globals became a single 341 MB request (output.weight + token_embd.weight,
      // measured 2026-07-28 with selftest/probe-ranges.mts) — which a phone's browser
      // aborts as a bare "Failed to fetch" the instant the model is picked. The cap is
      // best-effort at TENSOR granularity: a single tensor larger than maxBytes (27B
      // token_embd is ~171 MB) still travels as one range, because members are sliced out
      // of the fetched buffer by offset and cannot span two fetches. Splitting WITHIN a
      // tensor needs a streaming upload path — tracked as follow-up debt, not pretended
      // away by this comment.
      if (last && e.absStart - last.absEnd <= maxGap && e.absEnd - last.absStart <= maxBytes) {
        last.absEnd = Math.max(last.absEnd, e.absEnd);
        last.nBytes = last.absEnd - last.absStart;
        last.members.push(e);
      } else {
        ranges.push({ absStart: e.absStart, absEnd: e.absEnd, nBytes: e.nBytes, members: [e] });
      }
    }
    return ranges;
  }

  /** Coalesced ranges for one decoder block's weights. */
  coalesceBlock(layerIndex: number): CoalescedRange[] {
    return this.coalesce(this.withPrefix(`blk.${layerIndex}.`));
  }
}
