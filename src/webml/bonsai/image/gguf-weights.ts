// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/**
 * A `WeightFn` over a real GGUF checkpoint: name -> dequantized f32, torch [out, in].
 *
 * WHY THIS IS THE WHOLE REMAINING UNKNOWN FOR REAL WEIGHTS. The forward is already
 * proven exact -- all 37 stages of a 5+20-block Flux2 model match an
 * architecture-exact reference to 5e-5. So running it on the real checkpoint
 * introduces exactly ONE new question: do these bytes become the same numbers the
 * reference implementation sees? That is a per-tensor question, decidable cheaply,
 * and it does not need a tolerance invented for a 2-bit-versus-f32 comparison.
 *
 * Correctness of the real-weight forward is then COMPOSITION: proven arithmetic over
 * proven weights. That is a much stronger claim than eyeballing an end-to-end number
 * against a golden captured from a different (unquantized) model, which is what an
 * invented threshold would have been dressing up.
 *
 * 🚨 LAYOUT. GGUF stores dims innermost-first, `ne = [in, out]`, with the IN axis
 * contiguous. Torch stores [out, in] row-major, which is ALSO in-contiguous. So the
 * dequantized buffer is already in torch order and needs NO transpose -- and that
 * happy coincidence is exactly the kind of thing that is silently wrong for square
 * matrices, which is most of this model. `check_checkpoint` asserts both dimensions
 * in order rather than the element count for this reason.
 *
 * 🚨 DEQUANTIZATION IS NOT DUPLICATED HERE. It calls the shipped `kernels/reference`
 * implementations (`dequantQ2Bytes`, `f16ToF32`), because a second copy of a block
 * layout is a drift trap: the copies agree until one is fixed. That is not a
 * hypothetical -- it is what happened to the shared browser-inference worker while a
 * comment inside it asked people to keep the copies in step.
 *
 * MEMORY. The full model is ~3.9 B parameters, which is ~15.5 GB as f32 -- more than
 * a node heap. So weights are dequantized ON DEMAND and, by default, NOT retained:
 * the forward touches each one once, and peak residency is a single tensor (the
 * largest is `to_qkv_mlp_proj` at 3072x27648, ~340 MB). Caching is opt-in for callers
 * that really do re-read.
 */

import { dequantQ2Bytes, f16ToF32 } from "../kernels/reference";
import { GgmlType, QK2_0, Q2_0_BYTES } from "../gguf/types";
import type { WeightFn } from "./mmdit";

export interface GgufTensorLoc {
  name: string;
  /** GGUF `ne`, innermost-first: [in, out] for a 2-D weight. */
  dims: number[];
  /** GGML type id. */
  type: number;
  /** Offset from `tensorDataBase`. */
  relOffset: number;
}

export interface GgufWeightSourceInit {
  /** Reads `[start, start+length)` of the file. */
  read: (start: number, length: number) => Uint8Array;
  tensors: Map<string, GgufTensorLoc>;
  /** Absolute offset where tensor data begins. */
  tensorDataBase: number;
  /** Keep dequantized tensors in memory. Off by default -- see MEMORY above. */
  cache?: boolean;
}

export function tensorElements(t: GgufTensorLoc): number {
  return t.dims.reduce((a, b) => a * b, 1);
}

/**
 * Bytes a tensor occupies on disk.
 *
 * Q2_0 is 128 weights per 34-byte block along the CONTIGUOUS axis, so an in-dimension
 * that is not a multiple of 128 cannot be read as whole blocks and its tail would come
 * from the NEXT tensor's bytes -- not an error, just plausible garbage. Refused here
 * rather than tolerated.
 */
export function tensorBytes(t: GgufTensorLoc): number {
  const n = tensorElements(t);
  switch (t.type) {
    case GgmlType.F32: return n * 4;
    case GgmlType.F16: return n * 2;
    case GgmlType.Q2_0: {
      if (n % QK2_0 !== 0) {
        throw new Error(
          `gguf-weights: ${t.name} has ${n} elements, not a multiple of ${QK2_0}; `
          + "a partial Q2_0 block would be completed from the next tensor's bytes");
      }
      return (n / QK2_0) * Q2_0_BYTES;
    }
    default:
      throw new Error(`gguf-weights: ${t.name} has unsupported type ${t.type}`);
  }
}

/** Dequantize one tensor to f32, in torch [out, in] row-major order. */
export function dequantTensor(
  raw: Uint8Array, t: GgufTensorLoc,
): Float32Array {
  const n = tensorElements(t);
  switch (t.type) {
    case GgmlType.F32:
      // Copy rather than view: the caller's buffer may be a reused read window, and a
      // view into it would change under the caller's feet on the next read.
      return new Float32Array(
        raw.buffer.slice(raw.byteOffset, raw.byteOffset + n * 4));
    case GgmlType.F16: {
      const out = new Float32Array(n);
      const dv = new DataView(raw.buffer, raw.byteOffset, n * 2);
      for (let i = 0; i < n; i++) out[i] = f16ToF32(dv.getUint16(i * 2, true));
      return out;
    }
    case GgmlType.Q2_0: {
      const out = new Float32Array(n);
      const blocks = n / QK2_0;
      for (let b = 0; b < blocks; b++) {
        const vals = dequantQ2Bytes(raw, b * Q2_0_BYTES);
        out.set(vals, b * QK2_0);
      }
      return out;
    }
    default:
      throw new Error(`gguf-weights: ${t.name} has unsupported type ${t.type}`);
  }
}

/**
 * Build a `WeightFn` the forward can be driven with.
 *
 * An unknown name THROWS naming the tensor. Returning zeros would let a misspelled
 * weight produce a finite, plausible, entirely wrong result -- the exact silence this
 * whole family of tests exists to remove.
 */
export function ggufWeightSource(init: GgufWeightSourceInit): WeightFn {
  const cache = init.cache ? new Map<string, Float32Array>() : null;
  return (name: string): Float32Array => {
    const hit = cache?.get(name);
    if (hit) return hit;
    const t = init.tensors.get(name);
    if (!t) {
      throw new Error(
        `gguf-weights: the checkpoint has no tensor '${name}'. Returning zeros here `
        + "would make a misspelled weight produce a plausible, wrong image.");
    }
    const nb = tensorBytes(t);
    const raw = init.read(init.tensorDataBase + t.relOffset, nb);
    if (raw.length !== nb) {
      throw new Error(
        `gguf-weights: read ${raw.length} bytes for '${name}', expected ${nb} — a `
        + "short read yields a tensor padded with zeros rather than an error");
    }
    const out = dequantTensor(raw, t);
    cache?.set(name, out);
    return out;
  };
}
