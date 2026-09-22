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
 *   - prism.hadamard.* validation .... src/llama-model.cpp:1194-1331 (load-time rules, foldable
 *                                      weight whitelist, inverse-table rule, sign table per width)
 * GGUF container: public spec ggml-org/ggml docs/gguf.md (format v3).
 *
 * Typed accessors over the parsed KV map. NOTHING is hardcoded — every architectural
 * dimension is resolved from the GGUF exactly like the fork does. `arch` is read from
 * general.architecture (expected "qwen35") and used to namespace the per-arch keys.
 */

import type { GgufMetadataValue } from "./types";

/**
 * The `prism.hadamard.*` contract of a Bonsai 2 GGUF (fork llama-model.cpp:1194-1331).
 * Stored weights in `weightNames` are pre-folded `W' = W·S·H` along their INPUT axis in
 * `blockSize`-wide blocks, so at runtime the activation feeding each of them must be
 * transformed `x' = H(s ⊙ x)` per block (llama-graph.cpp:1504-1538). Tables in
 * `inverseWeightNames` store rotated rows and need `h = s ⊙ (H z)` after lookup
 * (llama-graph.cpp:2384-2395). Sign vectors are keyed by INPUT WIDTH only
 * (llama-model.cpp:2034-2040).
 */
export interface HadamardSpec {
  version: number;
  blockSize: number;
  transform: string;
  axis: string;
  signMode: "identity" | "explicit";
  /** Names of the forward-folded weights (activation gets sign + WHT before the matmul). */
  weightNames: Set<string>;
  /** Input widths that carry an explicit sign vector, in file order. Empty in identity mode. */
  signWidths: number[];
  /** All sign values as stored: the per-width vectors concatenated in `signWidths` order. */
  signValues: Int8Array;
  /** `signValues` split per width — the table the fork keys as hadamard_sign_data[width]. */
  signsByWidth: Map<number, Int8Array>;
  /** Tables that store rotated rows; only "token_embd.weight" is accepted (fork rule). */
  inverseWeightNames: Set<string>;
  /** True when blk.*.ssm_out.weight input columns are in grouped (training) v-head order. */
  gdnVGrouped: boolean;
}

export const HADAMARD_TRANSFORM = "normalized-sylvester-walsh-hadamard";
export const HADAMARD_AXIS = "input-last-dimension";

// fork llama-model.cpp:1276-1315 — the kinds whose matmul is proven to route through
// build_lora_mm (where the activation transform lives). Anything else is refused.
const HADAMARD_FOLDABLE_KINDS = [
  "attn_q", "attn_k", "attn_v", "attn_qkv", "attn_gate", "attn_output",
  "ffn_gate", "ffn_up", "ffn_down",
  "ffn_gate_exps", "ffn_up_exps", "ffn_down_exps", "ffn_gate_up_exps",
  "ffn_gate_shexp", "ffn_up_shexp", "ffn_down_shexp",
  "ssm_out",
];

/** Transcription of the fork's `is_foldable_weight` lambda (llama-model.cpp:1276-1303). */
export function isHadamardFoldableWeight(name: string): boolean {
  if (name === "output.weight") return true; // the output head is built through build_lora_mm in every arch
  if (!name.startsWith("blk.")) return false;
  let pos = 4;
  while (pos < name.length && name.charCodeAt(pos) >= 48 && name.charCodeAt(pos) <= 57) pos++;
  if (pos === 4 || pos >= name.length || name[pos] !== ".") return false;
  pos++;
  const rest = name.slice(pos);
  for (const kind of HADAMARD_FOLDABLE_KINDS) {
    if (rest === `${kind}.weight`) return true;
  }
  return false;
}

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

  /** BOOL KV (parser.ts materialises it as a JS boolean). Missing => fallback. */
  bool(key: string, fallback: boolean): boolean {
    const v = this.kv.get(key);
    if (typeof v === "boolean") return v;
    if (v === undefined) return fallback;
    throw new Error(`bonsai-gguf: key '${key}' is not a bool (got ${typeof v})`);
  }

  /**
   * Parse and validate `prism.hadamard.*` exactly as the fork does at load
   * (llama-model.cpp:1194-1331). Returns null when the key block is absent (a Bonsai 1
   * file); throws on every rule the fork throws on — a folded checkpoint that loads with
   * a wrong/missing transform would speak fluent garbage, so nothing here is lenient.
   */
  resolveHadamard(): HadamardSpec | null {
    const version = this.numOpt("prism.hadamard.version");
    if (version === undefined) return null;
    if (version !== 1) throw new Error(`bonsai-gguf: unsupported prism.hadamard.version: ${version}`);

    const blockSize = this.num("prism.hadamard.block_size");
    const transform = this.str("prism.hadamard.transform");
    const axis = this.str("prism.hadamard.axis");
    const signMode = this.str("prism.hadamard.sign_mode");
    const weightNameList = this.strArray("prism.hadamard.weight_names");

    if (!Number.isInteger(blockSize) || blockSize <= 0 || (blockSize & (blockSize - 1)) !== 0) {
      throw new Error(`bonsai-gguf: invalid prism.hadamard.block_size: ${blockSize}`);
    }
    if (transform !== HADAMARD_TRANSFORM) {
      throw new Error(`bonsai-gguf: unsupported prism.hadamard.transform: ${transform}`);
    }
    if (axis !== HADAMARD_AXIS) {
      throw new Error(`bonsai-gguf: unsupported prism.hadamard.axis: ${axis}`);
    }
    if (signMode !== "identity" && signMode !== "explicit") {
      throw new Error(`bonsai-gguf: unsupported prism.hadamard.sign_mode: ${signMode}`);
    }
    if (weightNameList.length === 0) {
      throw new Error("bonsai-gguf: prism.hadamard.weight_names is empty");
    }

    const signWidths: number[] = [];
    const signsByWidth = new Map<number, Int8Array>();
    let signValues = new Int8Array(0);
    if (signMode === "explicit") {
      const widths = this.numArray("prism.hadamard.sign_widths");
      const values = this.numArray("prism.hadamard.sign_values");
      // explicit mode with no widths would leave the sign table empty, which reads
      // as identity later and silently changes the model function
      if (widths.length === 0) {
        throw new Error("bonsai-gguf: prism.hadamard.sign_mode is explicit but sign_widths is empty");
      }
      signValues = new Int8Array(values.length);
      let off = 0;
      for (const width of widths) {
        if (!Number.isInteger(width) || width <= 0 || width % blockSize !== 0 || off + width > values.length) {
          throw new Error(`bonsai-gguf: invalid prism.hadamard sign width: ${width}`);
        }
        const vec = new Int8Array(width);
        for (let i = 0; i < width; i++) {
          const v = values[off + i];
          if (v !== 1 && v !== -1) {
            throw new Error("bonsai-gguf: prism.hadamard sign values must be +/-1");
          }
          vec[i] = v;
          signValues[off + i] = v;
        }
        // fork: hadamard_sign_data[width] = vec (a repeated width overwrites; keep last)
        signsByWidth.set(width, vec);
        signWidths.push(width);
        off += width;
      }
      if (off !== values.length) {
        throw new Error("bonsai-gguf: prism.hadamard.sign_values length mismatch");
      }
    }

    const gdnVGrouped = this.bool("prism.hadamard.gdn_v_grouped", false);

    const weightNames = new Set<string>();
    for (const name of weightNameList) {
      if (!isHadamardFoldableWeight(name)) {
        throw new Error(
          `bonsai-gguf: prism.hadamard: weight '${name}' is not on a verified Hadamard-aware matmul path`,
        );
      }
      if (weightNames.has(name)) {
        throw new Error(`bonsai-gguf: duplicate prism.hadamard weight: ${name}`);
      }
      weightNames.add(name);
    }

    // tensors consumed by row lookup store latent rows and need the inverse transform
    // applied to the lookup result instead
    const inverseRaw = this.kv.get("prism.hadamard.inverse_weight_names");
    const inverseList = Array.isArray(inverseRaw) ? (inverseRaw as string[]) : [];
    const inverseWeightNames = new Set<string>();
    for (const name of inverseList) {
      // the graph applies the inverse only to the token-embedding lookup; any other
      // latent table would load and silently stay rotated
      if (name !== "token_embd.weight") {
        throw new Error(
          `bonsai-gguf: prism.hadamard: weight '${name}' is not a verified inverse-after-lookup table`,
        );
      }
      if (weightNames.has(name) || inverseWeightNames.has(name)) {
        throw new Error(`bonsai-gguf: duplicate prism.hadamard inverse weight: ${name}`);
      }
      inverseWeightNames.add(name);
    }

    return {
      version,
      blockSize,
      transform,
      axis,
      signMode,
      weightNames,
      signWidths,
      signValues,
      signsByWidth,
      inverseWeightNames,
      gdnVGrouped,
    };
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
