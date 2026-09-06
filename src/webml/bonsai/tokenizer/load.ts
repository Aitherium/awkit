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
 *   - tokenizer.ggml.* KV lives INSIDE the GGUF (not fetchable as raw text).
 */

import type { ResolvedTokenizer } from "../gguf/metadata";
import { buildTables, encode, decode, type BpeTables } from "./bpe";
import { renderChatML, type ChatMessage, type ToolFunction } from "./chat_template";

export class BonsaiTokenizer {
  readonly tables: BpeTables;
  readonly bosTokenId?: number;
  readonly eosTokenId?: number;
  /** Every id that ends an assistant turn — see {@link isStop}. */
  readonly stopIds: ReadonlySet<number>;
  /** `<think>` / `</think>` ids (248068 / 248069 on Bonsai-27B), when the vocab ships them. */
  readonly thinkStartId?: number;
  readonly thinkEndId?: number;

  constructor(spec: ResolvedTokenizer) {
    // token_type is the GGUF's own answer to "is this a control token" — it was already
    // being parsed and then dropped here, which is how a string-shape guess ended up
    // deciding it instead (see buildTables).
    this.tables = buildTables(spec.tokens, spec.merges, spec.tokenType);
    this.bosTokenId = spec.bosTokenId;
    this.eosTokenId = spec.eosTokenId;
    this.thinkStartId = this.tables.specialTokens.get("<think>");
    this.thinkEndId = this.tables.specialTokens.get("</think>");

    // Stopping on the GGUF's single `eos_token_id` alone is not enough: which id that KV
    // carries varies by publisher, and if it is <|endoftext|> rather than <|im_end|> the
    // decoder sails straight through the turn boundary and starts writing the NEXT turn —
    // i.e. it emits "<|im_start|>system…" style continuations, which is what a reader sees
    // as "the model spat out the system prompt". Stop on the whole turn-ending set instead.
    const stops = new Set<number>();
    if (spec.eosTokenId !== undefined) stops.add(spec.eosTokenId);
    for (const name of ["<|im_end|>", "<|endoftext|>"] as const) {
      const id = this.tables.specialTokens.get(name);
      if (id !== undefined) stops.add(id);
    }
    this.stopIds = stops;
  }

  get vocabSize(): number {
    return this.tables.idToToken.length;
  }

  encode(text: string): number[] {
    return encode(text, this.tables);
  }

  decode(ids: number[]): string {
    return decode(ids, this.tables);
  }

  /** Render + encode a chat turn with optional tools. */
  encodeChat(messages: ChatMessage[], tools?: ToolFunction[]): number[] {
    return this.encode(renderChatML(messages, true, tools));
  }

  /** True when `id` ends the assistant turn (GGUF eos, `<|im_end|>`, or `<|endoftext|>`). */
  isStop(id: number): boolean {
    return this.stopIds.has(id);
  }

  /** @deprecated Only ever matched the single GGUF eos id — use {@link isStop}. */
  isEos(id: number): boolean {
    return this.eosTokenId !== undefined && id === this.eosTokenId;
  }
}
