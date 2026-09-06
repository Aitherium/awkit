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
 *   - Q1_0 block layout .............. ggml/src/ggml-common.h  (QK1_0=128, block_q1_0)
 *   - GGUF value types + type traits . public spec ggml-org/ggml docs/gguf.md (v3)
 */

// GGUF metadata value types (docs/gguf.md — gguf_metadata_value_type). LE u32 on the wire.
export enum GgufValueType {
  UINT8 = 0,
  INT8 = 1,
  UINT16 = 2,
  INT16 = 3,
  UINT32 = 4,
  INT32 = 5,
  FLOAT32 = 6,
  BOOL = 7,
  STRING = 8,
  ARRAY = 9,
  UINT64 = 10,
  INT64 = 11,
  FLOAT64 = 12,
}

// GGML tensor dtypes we care about. Q1_0 = 41 and Q2_0 = 42 are PrismML's own types — a stock
// GGUF parser rejects them, so we register them explicitly here (that inclusion is the
// whole point of this loader). Values from the owner-owned fork's ggml_type enum.
export enum GgmlType {
  F32 = 0,
  F16 = 1,
  Q8_0 = 8,
  Q1_0 = 41, // PrismML 1-bit: QK1_0=128 weights per block, block = { f16 d; u8 qs[16] } = 18 B
  Q2_0 = 42, // PrismML 2-bit ternary: QK2_0=128 weights per block, block = { f16 d; u8 qs[32] } = 34 B
}

export interface TypeTrait {
  /** Elements packed per quantization block. */
  blockSize: number;
  /** Bytes on disk per block. */
  typeSize: number;
  /** Human name for logging. */
  name: string;
}

// blockSize / typeSize per the fork's ggml type_traits. Q1_0: 128 weights → 18 bytes
// (2-byte f16 scale + 16 bytes of packed sign bits). Q2_0: 128 weights → 34 bytes
// (2-byte f16 scale + 32 bytes of packed 2-bit values). Q8_0: 32 → 34 (2-byte f16 d + 32 int8).
export const TYPE_TRAITS: Record<number, TypeTrait> = {
  [GgmlType.F32]: { blockSize: 1, typeSize: 4, name: "F32" },
  [GgmlType.F16]: { blockSize: 1, typeSize: 2, name: "F16" },
  [GgmlType.Q8_0]: { blockSize: 32, typeSize: 34, name: "Q8_0" },
  [GgmlType.Q1_0]: { blockSize: 128, typeSize: 18, name: "Q1_0" },
  [GgmlType.Q2_0]: { blockSize: 128, typeSize: 34, name: "Q2_0" },
};

// Block geometry constants (fork ggml-common.h). Kept as named consts so kernels + loader
// agree on exactly one source of truth and drift is impossible.
export const QK1_0 = 128; // Q1_0 weights per block
export const QK2_0 = 128; // Q2_0 weights per block
export const QK8_0 = 32; // Q8_0 activations per block
export const Q1_0_BYTES = 18;
export const Q2_0_BYTES = 34;
export const Q8_0_BYTES = 34;

export function typeTrait(t: number): TypeTrait {
  const tr = TYPE_TRAITS[t];
  if (!tr) throw new Error(`bonsai-gguf: unsupported ggml type ${t} (not in TYPE_TRAITS)`);
  return tr;
}

/** Byte span of a tensor with `nElements` elements of dtype `t` (fork: nelem/blk*typeSize). */
export function tensorNBytes(t: number, nElements: number): number {
  const { blockSize, typeSize } = typeTrait(t);
  if (nElements % blockSize !== 0) {
    throw new Error(
      `bonsai-gguf: element count ${nElements} not a multiple of block size ${blockSize} for ${typeTrait(t).name}`,
    );
  }
  return (nElements / blockSize) * typeSize;
}

export interface GgufTensorInfo {
  name: string;
  dims: number[]; // fastest-varying first, as stored
  type: number; // GgmlType
  /** Offset relative to tensor_data_base (from the tensor-info record). */
  relOffset: number;
  /** Total element count = product(dims). */
  nElements: number;
  /** Byte span on disk. */
  nBytes: number;
}

export type GgufMetadataValue =
  | number
  | bigint
  | boolean
  | string
  | number[]
  | bigint[]
  | boolean[]
  | string[];

export interface GgufHeader {
  version: number;
  tensorCount: number;
  metadataKvCount: number;
}
