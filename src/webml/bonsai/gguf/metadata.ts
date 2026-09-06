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
 *   - arch qwen35 KV keys ............ src/llama-arch.cpp:42; src/llama-model.cpp
 * GGUF container: public spec ggml-org/ggml docs/gguf.md (format v3).
 *
 * Typed accessors over the parsed KV map. NOTHING is hardcoded — every architectural
 * dimension is resolved from the GGUF exactly like the fork does. `arch` is read from
 * general.architecture (expected "qwen35") and used to namespace the per-arch keys.
 */

import type { GgufMetadataValue } from "./types";

export class GgufMetadata {
  constructor(private kv: Map<string, GgufMetadataValue>) {}

  raw(key: string): GgufMetadataValue | undefined {
    return this.kv.get(key);
  }

  str(key: string, fallback?: string): string {
    const v = this.kv.get(key);
    if (typeof v === "string") return v;
    if (fallback !== undefined) return fallback;
    throw new Error(`bonsai-gguf: missing string key '${key}'`);
  }

  num(key: string, fallback?: number): number {
    const v = this.kv.get(key);
    if (typeof v === "number") return v;
    if (typeof v === "bigint") return Number(v);
    if (fallback !== undefined) return fallback;
    throw new Error(`bonsai-gguf: missing numeric key '${key}'`);
  }

  numOpt(key: string): number | undefined {
    const v = this.kv.get(key);
    if (typeof v === "number") return v;
    if (typeof v === "bigint") return Number(v);
    return undefined;
  }

  strArray(key: string): string[] {
    const v = this.kv.get(key);
    if (Array.isArray(v)) return v as string[];
    throw new Error(`bonsai-gguf: missing string-array key '${key}'`);
  }

  numArray(key: string): number[] {
    const v = this.kv.get(key);
    if (Array.isArray(v)) return (v as (number | bigint)[]).map(Number);
    throw new Error(`bonsai-gguf: missing numeric-array key '${key}'`);
  }

  /** general.architecture — expected "qwen35" for Bonsai-27B. Maps "dspark" → "qwen35". */
  get arch(): string {
    const rawArch = this.str("general.architecture");
    // CONFIRMED bug fix: Bonsai-27B GGUF has general.architecture="dspark" but per-arch
    // KV keys are stored under "qwen35.*" namespace, not "dspark.*".
    return rawArch === "dspark" ? "qwen35" : rawArch;
  }

  private a(suffix: string): string {
    return `${this.arch}.${suffix}`;
  }

  /** Resolve every qwen35.* dimension the runtime needs. */
  resolveArchConfig() {
    const arch = this.arch;
    return {
      arch,
      contextLength: this.num(this.a("context_length")),
      embeddingLength: this.num(this.a("embedding_length")),
      blockCount: this.num(this.a("block_count")),
      feedForwardLength: this.num(this.a("feed_forward_length")),
      headCount: this.num(this.a("attention.head_count")),
      headCountKv: this.num(this.a("attention.head_count_kv")),
      // EXPLICIT per-head dims. This arch (qwen35, DeltaNet+full-attn hybrid)
      // sets head_dim independently of embedding_length/head_count — e.g.
      // 5120/24 = 213.33 is NOT the head_dim; attention.key_length is. The
      // fork reads n_embd_head_k from this key (llama-model.cpp), falling back
      // to embedding_length/head_count only when the key is absent.
      keyLength: this.numOpt(this.a("attention.key_length")),
      valueLength: this.numOpt(this.a("attention.value_length")),
      rmsEps: this.num(this.a("attention.layer_norm_rms_epsilon"), 1e-6),
      ropeDimensionCount: this.numOpt(this.a("rope.dimension_count")),
      ropeDimensionSections: (() => {
        // CONFIRMED bug fix: Read rope.dimension_sections for IMROPE (interleaved multi-section).
        const v = this.kv.get(this.a("rope.dimension_sections"));
        return Array.isArray(v) ? (v as (number | bigint)[]).map(Number) : [];
      })(),
      ropeFreqBase: this.numOpt(this.a("rope.freq_base")) ?? 10000,
      ropeScalingType: (() => {
        const v = this.kv.get(this.a("rope.scaling.type"));
        return typeof v === "string" ? v : "none";
      })(),
      ropeScalingFactor: this.numOpt(this.a("rope.scaling.factor")),
      // SSM / DeltaNet dims (present on the linear-attention layers).
      // Bonsai-27B (qwen35, Qwen3-Next SSM path): inner_size=6144 (v width), state_size=128
      // (per-head dim, k AND v), group_count=16 (num_k/q heads), time_step_rank=48 (num_v heads),
      // conv_kernel=4. The DeltaNet in-proj (attn_qkv) width is q(2048)+k(2048)+v(6144)=10240.
      ssmConvKernel: this.numOpt(this.a("ssm.conv_kernel")),
      ssmInnerSize: this.numOpt(this.a("ssm.inner_size")),
      ssmStateSize: this.numOpt(this.a("ssm.state_size")),
      ssmGroupCount: this.numOpt(this.a("ssm.group_count")),
      ssmTimeStepRank: this.numOpt(this.a("ssm.time_step_rank")),
      // Hybrid schedule: every `full_attention_interval`-th layer is full attention, the
      // rest are DeltaNet. Derived per-layer from tensor presence too (config.ts), but the
      // KV is kept for cross-checking.
      fullAttentionInterval: this.numOpt(this.a("full_attention_interval")),
    };
  }

  /** Tokenizer KV block (lives inside the GGUF — not fetchable as raw text). */
  resolveTokenizer() {
    return {
      model: this.str("tokenizer.ggml.model", "gpt2"),
      tokens: this.strArray("tokenizer.ggml.tokens"),
      merges: (() => {
        const v = this.kv.get("tokenizer.ggml.merges");
        return Array.isArray(v) ? (v as string[]) : [];
      })(),
      tokenType: (() => {
        const v = this.kv.get("tokenizer.ggml.token_type");
        return Array.isArray(v) ? (v as (number | bigint)[]).map(Number) : [];
      })(),
      bosTokenId: this.numOpt("tokenizer.ggml.bos_token_id"),
      eosTokenId: this.numOpt("tokenizer.ggml.eos_token_id"),
    };
  }
}

export type ResolvedArchConfig = ReturnType<GgufMetadata["resolveArchConfig"]>;
export type ResolvedTokenizer = ReturnType<GgufMetadata["resolveTokenizer"]>;
