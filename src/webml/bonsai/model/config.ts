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
 *   - arch qwen35 / DeltaNet ......... src/llama-arch.cpp:431-439; src/llama-model.cpp:1797-1799
 * GGUF container: public spec ggml-org/ggml docs/gguf.md (format v3).
 *
 * Qwen35Config — resolved entirely from GGUF KV + tensor presence. The hybrid layer
 * schedule (which blocks are full-attention vs DeltaNet/SSM linear-attention) is DERIVED
 * from which tensors each block carries, never hardcoded, then asserted (§8 risk #4).
 */

import type { ResolvedArchConfig } from "../gguf/metadata";
import type { TensorRegistry } from "../tensors/registry";

/**
 * What a decoder block actually is, measured per layer.
 *
 * - `linear-attn` — DeltaNet/SSM (qwen35 hybrid only).
 * - `full-attn`   — GATED softmax attention: `attn_q` projects to 2*nHeads*headDim because
 *                   query and output-gate are INTERLEAVED per head, and the attention result
 *                   is multiplied by sigmoid(gate). This is the qwen35 shape.
 * - `dense-attn`  — PLAIN softmax attention: `attn_q` projects to nHeads*headDim, no gate.
 *                   This is stock qwen3, which is what the Bonsai 1.7B/4B/8B actually are.
 *
 * `full-attn` and `dense-attn` are NOT interchangeable and the difference is invisible at
 * runtime: running a dense model through the gated path reads the first half of the heads'
 * weights as "all the heads" and then multiplies by a sigmoid of garbage. It does not crash.
 * That is why the kind is derived from the tensor's measured OUTPUT WIDTH below rather than
 * from `general.architecture`.
 */
export type LayerKind = "full-attn" | "linear-attn" | "dense-attn";

export interface Qwen35Config extends ResolvedArchConfig {
  /** Per-layer kind, length = blockCount. */
  layerKinds: LayerKind[];
  /** Indices of the full-attention layers (carry a KV cache). Includes BOTH gated
   *  (`full-attn`) and plain (`dense-attn`) layers — every softmax-attention layer needs KV,
   *  and every consumer of this list wants "which layers cache K/V". */
  fullAttnLayers: number[];
  /** Indices of the DeltaNet/SSM linear-attention layers. Empty for a dense model. */
  linearAttnLayers: number[];
  /**
   * Resolved DeltaNet geometry — ABSENT on a dense model, which has no ssm.* keys at all.
   *
   * Optional rather than a zero-filled stub on purpose: a stub would let a DeltaNet code
   * path run with heads=0/headDim=0 and quietly produce nothing, whereas `undefined` makes
   * TypeScript force the one consumer (block_deltanet.ts) to say what it does about it.
   */
  deltaNet?: DeltaNetDims;
  /** Per-layer pre-FFN norm tensor name. qwen35 calls it `post_attention_norm`, stock qwen3
   *  calls it `ffn_norm`; resolved by presence per layer, never assumed. */
  ffnNormNames: string[];
}

/**
 * DeltaNet (gated delta-rule linear attention) geometry for the qwen35 hybrid, derived
 * from the GGUF ssm.* keys. For Bonsai-27B: numVHeads=48, numKHeads=16, headDim=128, so
 * qDim=kDim=2048, vDim=6144, and the in-projection (attn_qkv) width is qDim+kDim+vDim=10240
 * (matching ssm_conv1d's 10240 channels). Each k/q head is shared by numVHeads/numKHeads=3
 * v-heads. The per-v-head state matrix is [headDim(k) × headDim(v)] = 128×128.
 */
export interface DeltaNetDims {
  numVHeads: number; // ssm.time_step_rank (48)
  numKHeads: number; // ssm.group_count (16)
  headDim: number; // ssm.state_size (128) — per-head dim, k and v
  qDim: number; // numKHeads * headDim (2048)
  kDim: number; // numKHeads * headDim (2048)
  vDim: number; // numVHeads * headDim (6144) === ssm.inner_size
  convDim: number; // qDim + kDim + vDim (10240) === ssm_conv1d channels
  convKernel: number; // ssm.conv_kernel (4)
  vPerKHead: number; // numVHeads / numKHeads (3) — GQA-style grouping for k/q reuse
}

export function deriveDeltaNetDims(arch: ResolvedArchConfig): DeltaNetDims {
  const numVHeads = arch.ssmTimeStepRank ?? 0;
  const numKHeads = arch.ssmGroupCount ?? 0;
  const headDim = arch.ssmStateSize ?? 0;
  const vDim = arch.ssmInnerSize ?? numVHeads * headDim;
  const qDim = numKHeads * headDim;
  const kDim = numKHeads * headDim;
  const convDim = qDim + kDim + vDim;
  const convKernel = arch.ssmConvKernel ?? 0;
  if (numVHeads <= 0 || numKHeads <= 0 || headDim <= 0 || convKernel <= 0) {
    // Name the actual situation, not just the numbers. The common way to get here is not a
    // corrupt file — it is a DENSE model: the 1.7B/4B/8B Bonsai GGUFs are `qwen3` with no
    // ssm.* keys at all (measured 2026-07-28), and this runtime only implements the qwen35
    // DeltaNet hybrid. The message is what the visitor-facing error surfaces, so it must
    // point at the way out (a runnable size / the hosted lane), not at GGUF internals.
    throw new Error(
      `bonsai-config: '${arch.arch}' has no DeltaNet layers — this in-browser runtime only ` +
        `runs the qwen35 hybrid (Bonsai-27B). Dense sizes run on a local node or the hosted ` +
        `lane instead. (numVHeads=${numVHeads}, numKHeads=${numKHeads}, headDim=${headDim}, ` +
        `convKernel=${convKernel})`,
    );
  }
  if (numVHeads % numKHeads !== 0) {
    throw new Error(
      `bonsai-config: numVHeads ${numVHeads} not divisible by numKHeads ${numKHeads}`,
    );
  }
  if (vDim !== numVHeads * headDim) {
    throw new Error(
      `bonsai-config: ssm.inner_size ${vDim} != numVHeads*headDim ${numVHeads * headDim}`,
    );
  }
  return {
    numVHeads,
    numKHeads,
    headDim,
    qDim,
    kDim,
    vDim,
    convDim,
    convKernel,
    vPerKHead: numVHeads / numKHeads,
  };
}

/**
 * Classify each block by tensor presence:
 *   - a block carrying `ssm_*` tensors (ssm_conv1d / ssm_a / ssm_beta / ssm_norm ...) is
 *     a DeltaNet linear-attention layer;
 *   - a block carrying full-attn K/V projection tensors (attn_k / attn_v) with no ssm_*
 *     is a full-attention layer.
 * The fork's qwen35 shares the SSM path with QWEN3NEXT; this presence test mirrors how
 * the fork decides per-layer behaviour without us guessing an index list.
 */
export function deriveLayerKinds(reg: TensorRegistry, arch: ResolvedArchConfig): LayerKind[] {
  const blockCount = arch.blockCount;
  // head_dim is the EXPLICIT key when present — this family decouples it from
  // embedding_length/head_count (Bonsai-4B: 2560/32 = 80, real head_dim = 128), so deriving
  // it by division would compute the wrong expected width and mis-classify every layer.
  const headDim =
    arch.keyLength && arch.keyLength > 0 ? arch.keyLength : arch.embeddingLength / arch.headCount;
  const plainWidth = arch.headCount * headDim;
  const gatedWidth = plainWidth * 2;

  const kinds: LayerKind[] = [];
  for (let i = 0; i < blockCount; i++) {
    const p = `blk.${i}.`;
    const hasSsm = reg.ordered.some((e) => e.name.startsWith(p) && e.name.includes("ssm"));
    if (hasSsm) {
      kinds.push("linear-attn");
      continue;
    }
    const hasFullKv =
      reg.has(`${p}attn_k.weight`) ||
      reg.has(`${p}attn_v.weight`) ||
      reg.ordered.some((e) => e.name.startsWith(p) && /attn_(k|v)\b/.test(e.name));
    if (!hasFullKv) {
      // Neither signal — fail loud rather than silently mis-route attention.
      throw new Error(
        `bonsai-config: block ${i} has neither ssm_* nor attn_k/v tensors — cannot classify layer`,
      );
    }

    // GATED OR NOT IS A MEASUREMENT, NOT AN ARCH NAME.
    // qwen35 interleaves [query|gate] per head, so attn_q is [n_embd, 2*nHeads*headDim];
    // stock qwen3 has no gate and is [n_embd, nHeads*headDim]. Choosing the wrong one does
    // not fail — it reads half the heads and multiplies by sigmoid(noise), i.e. fluent
    // garbage — so read the width the file actually declares. GGUF stores a weight matrix
    // as [in, out] with ne0 fastest-varying, so the OUTPUT width is dims[1].
    const qName = `${p}attn_q.weight`;
    if (!reg.has(qName)) {
      throw new Error(
        `bonsai-config: block ${i} has attn_k/v but no '${qName}' — cannot determine whether ` +
          `its attention is gated (qwen35) or plain (qwen3)`,
      );
    }
    const qDims = reg.get(qName).dims;
    const outWidth = qDims.length >= 2 ? qDims[qDims.length - 1] : qDims[0];
    if (outWidth === gatedWidth) kinds.push("full-attn");
    else if (outWidth === plainWidth) kinds.push("dense-attn");
    else {
      throw new Error(
        `bonsai-config: block ${i} '${qName}' has output width ${outWidth}, which matches ` +
          `neither plain attention (nHeads*headDim = ${plainWidth}) nor gated attention ` +
          `(2*nHeads*headDim = ${gatedWidth}). headCount=${arch.headCount}, headDim=${headDim} ` +
          `(key_length=${arch.keyLength ?? "absent"}, embedding_length=${arch.embeddingLength}). ` +
          `Refusing to guess — the wrong choice produces fluent garbage, not an error.`,
      );
    }
  }
  return kinds;
}

/**
 * Per-layer pre-FFN norm tensor name, resolved by PRESENCE.
 *
 * qwen35 names it `post_attention_norm.weight`; stock qwen3 names it `ffn_norm.weight`
 * (measured on the real 1.7B/4B/8B GGUFs, 2026-07-28). Picking the wrong name throws a
 * clear "not resident" error from WeightStore rather than corrupting output, so this is the
 * benign failure of the two — but resolving it by presence means neither family needs a
 * special case, and a future export that renames it again fails loudly at LOAD naming both
 * candidates, instead of at first token.
 */
export function deriveFfnNormNames(reg: TensorRegistry, blockCount: number): string[] {
  const names: string[] = [];
  for (let i = 0; i < blockCount; i++) {
    const post = `blk.${i}.post_attention_norm.weight`;
    const ffn = `blk.${i}.ffn_norm.weight`;
    if (reg.has(post)) names.push(post);
    else if (reg.has(ffn)) names.push(ffn);
    else {
      throw new Error(
        `bonsai-config: block ${i} has neither '${post}' nor '${ffn}' — cannot locate the ` +
          `pre-FFN norm`,
      );
    }
  }
  return names;
}

/**
 * Hard upper bound on the per-head dimension the attention/DeltaNet WGSL kernels hold in a
 * fixed workgroup array. softmax_attn.wgsl declares `acc : array<f32, 256>` indexed by
 * head_dim; deltanet.wgsl declares `err`/`o : array<f32, 256>` indexed by d_v. Those array
 * sizes are compile-time constants in WGSL, so a model whose head_dim / d_v exceeds this
 * would read and write out of bounds on the GPU with NO error reported. Keep in lockstep
 * with those `array<f32, 256>` declarations if the kernels ever change.
 */
export const KERNEL_MAX_HEAD_DIM = 256;

export interface KernelDimBounds {
  /** softmax_attn.wgsl `acc[]` index — head_dim = embedding_length / head_count. */
  headDim: number;
  /** deltanet.wgsl `err`/`o[]` index — DeltaNet value dim per head, when GGUF exposes it. */
  deltaNetDv?: number;
}

/**
 * Resolve the dims that index the fixed-size WGSL kernel arrays, straight from the GGUF KV.
 *   - head_dim is not a first-class GGUF key; the fork derives it as
 *     embedding_length / head_count (n_embd_head, src/llama-model.cpp). This is the value
 *     softmax_attn.wgsl reads as `p.head_dim`.
 *   - DeltaNet d_v is the SSM value width per head; qwen35 exposes ssm.inner_size (total
 *     value width across the linear-attention heads). We report it per head_count group
 *     only when it divides evenly, otherwise leave it undefined and rely on the head_dim
 *     bound (d_v tracks head_dim in this arch).
 */
export function resolveKernelDims(cfg: ResolvedArchConfig): KernelDimBounds {
  // Prefer the EXPLICIT head_dim (attention.key_length) — this arch decouples
  // head_dim from embedding_length/head_count (e.g. 5120/24 = 213.33 is wrong;
  // the real head_dim is the GGUF key_length). Divide only as a last resort
  // when the key is absent (older exports).
  const headDim =
    cfg.keyLength && cfg.keyLength > 0
      ? cfg.keyLength
      : cfg.embeddingLength / cfg.headCount;
  let deltaNetDv: number | undefined;
  if (
    cfg.ssmInnerSize !== undefined &&
    cfg.headCount > 0 &&
    cfg.ssmInnerSize % cfg.headCount === 0
  ) {
    deltaNetDv = cfg.ssmInnerSize / cfg.headCount;
  }
  return { headDim, deltaNetDv };
}

/**
 * Fail loudly at LOAD if the real model's head_dim / d_v would overrun the WGSL kernels'
 * fixed `array<f32, 256>` scratch (§8 RISK). Called from the runtime load path so a wrong
 * model is rejected on the CPU instead of silently reading out of bounds on the GPU.
 */
export function assertKernelDimBounds(cfg: ResolvedArchConfig): { message: string } {
  const { headDim, deltaNetDv } = resolveKernelDims(cfg);
  if (!Number.isInteger(headDim) || headDim <= 0) {
    throw new Error(
      `bonsai-config: head_dim (embedding_length ${cfg.embeddingLength} / head_count ` +
        `${cfg.headCount}) = ${headDim} is not a positive integer — cannot size attention kernels`,
    );
  }
  if (headDim > KERNEL_MAX_HEAD_DIM) {
    throw new Error(
      `bonsai-config: head_dim ${headDim} exceeds the WGSL fixed array bound ` +
        `${KERNEL_MAX_HEAD_DIM} (softmax_attn.wgsl acc[${KERNEL_MAX_HEAD_DIM}]) — refusing to ` +
        `load; the kernel would read out of bounds on the GPU`,
    );
  }
  if (deltaNetDv !== undefined && deltaNetDv > KERNEL_MAX_HEAD_DIM) {
    throw new Error(
      `bonsai-config: DeltaNet d_v ${deltaNetDv} (ssm.inner_size ${cfg.ssmInnerSize} / ` +
        `head_count ${cfg.headCount}) exceeds the WGSL fixed array bound ` +
        `${KERNEL_MAX_HEAD_DIM} (deltanet.wgsl err/o[${KERNEL_MAX_HEAD_DIM}]) — refusing to load`,
    );
  }
  const dvNote = deltaNetDv !== undefined ? `, DeltaNet d_v=${deltaNetDv}` : "";
  return { message: `head_dim=${headDim}${dvNote} (<= ${KERNEL_MAX_HEAD_DIM})` };
}

export function resolveQwen35Config(arch: ResolvedArchConfig, reg: TensorRegistry): Qwen35Config {
  const layerKinds = deriveLayerKinds(reg, arch);
  const fullAttnLayers: number[] = [];
  const linearAttnLayers: number[] = [];
  // Both softmax-attention kinds carry a KV cache; only DeltaNet replaces it with SSM state.
  layerKinds.forEach((k, i) => (k === "linear-attn" ? linearAttnLayers : fullAttnLayers).push(i));

  // DeltaNet geometry is derived ONLY when a DeltaNet layer exists. A dense model has no
  // ssm.* keys, and deriveDeltaNetDims throws on that by design — calling it unconditionally
  // is precisely what made every small size fail to load.
  const deltaNet = linearAttnLayers.length > 0 ? deriveDeltaNetDims(arch) : undefined;
  const ffnNormNames = deriveFfnNormNames(reg, arch.blockCount);
  return { ...arch, layerKinds, fullAttnLayers, linearAttnLayers, deltaNet, ffnNormNames };
}

/**
 * Assert the hybrid schedule matches expectation. Bonsai-27B is documented as 64 blocks
 * with ~25% full attention (16) and ~75% DeltaNet (48). We assert the counts sum; for
 * 64-block Bonsai, we verify 16 full-attention layers. This is a hard gate for the
 * canonical model; other block counts or layer ratios (variants) are accepted with a
 * warning (caller may convert to an error if stricter validation is needed).
 *
 * CONFIRMED bug fix: The hard-coded check is now documented as Bonsai-27B-specific.
 * Other variants with different layer schedules are allowed to load with a warning.
 */
export function assertLayerSchedule(cfg: Qwen35Config): { ok: boolean; message: string } {
  const total = cfg.fullAttnLayers.length + cfg.linearAttnLayers.length;
  if (total !== cfg.blockCount) {
    return { ok: false, message: `layer kinds (${total}) != blockCount (${cfg.blockCount})` };
  }
  // A DENSE model is every-layer softmax attention with no hybrid schedule to assert. Say so
  // and return — the 64-block/16-full-attn check below is a Bonsai-27B statement and would
  // warn spuriously on any dense model that happened to have 64 layers.
  if (cfg.linearAttnLayers.length === 0) {
    const dense = cfg.layerKinds.filter((k) => k === "dense-attn").length;
    return {
      ok: true,
      message: `dense: ${dense} plain-attn / ${cfg.blockCount - dense} gated-attn, no DeltaNet`,
    };
  }
  // Canonical Bonsai-27B: 64 blocks, exactly 16 full-attention
  if (cfg.blockCount === 64 && cfg.fullAttnLayers.length !== 16) {
    // Log as a warning instead of fail. Valid variants may have different splits.
    // eslint-disable-next-line no-console
    console.warn(
      `bonsai-config: Bonsai-27B expected 16 full-attn layers (64 blocks), ` +
        `got ${cfg.fullAttnLayers.length}. This may be a model variant; loading anyway.`,
    );
  }
  return {
    ok: true,
    message: `${cfg.fullAttnLayers.length} full-attn / ${cfg.linearAttnLayers.length} linear-attn`,
  };
}
