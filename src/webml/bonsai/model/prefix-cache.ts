// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * Cross-turn prefix (KV / state) reuse — deciding WHEN it is safe.
 *
 * THE COST THIS EXISTS TO REMOVE
 * Every turn currently allocates a fresh KV cache and SsmState and prefills the
 * WHOLE prompt again. In a chat the prompt is [system][user1][assistant1][user2]
 * — the first three parts are byte-identical to what the model already processed
 * last turn, and prefill is the expensive half on a small in-browser model.
 * Reusing that prefix does not make the model smarter; it stops it re-reading
 * the conversation from the beginning on every reply.
 *
 * WHY THIS IS A SEPARATE, PURE MODULE
 * The GPU half is a handful of lines (don't reset, pass posBase). ALL of the
 * risk is in the decision — reuse state that does not correspond exactly to the
 * new prompt's prefix and the model produces fluent, confidently WRONG output
 * with no error anywhere. This codebase has already been bitten by exactly that:
 * block_deltanet's conv history leaked across generations and "corrupt[ed] the
 * opening tokens of each layer ... Fluent, wrong output — degrading turn over
 * turn." So the decision lives here, in code that runs without a GPU and is
 * tested exhaustively, and the runtime does only what this returns.
 *
 * THE INVARIANT THAT DRIVES EVERYTHING — TRUNCATION IS NOT UNIVERSALLY LEGAL
 * Two kinds of layer store history very differently:
 *
 *   full-attention  -> KV cache. Position t's K/V depend ONLY on token t, so
 *                      dropping the tail is exact: keep the first n entries.
 *   DeltaNet/linear -> a RECURRENT state, folded over every token in order, plus
 *                      a causal-conv history window. There is no inverse. You
 *                      cannot rewind it to an earlier position; you can only
 *                      carry it forward or throw it away.
 *
 * So a model with linear-attention layers may only EXTEND an exact prefix, while
 * a dense model (Bonsai 1.7B/4B — stock qwen3, no ssm.* tensors) may also
 * TRUNCATE to the longest common prefix. That is not a micro-optimisation: a
 * tokenizer round-trip can make a re-rendered assistant turn differ by one token
 * from what was generated, and under extend-only that single mismatch throws the
 * whole conversation away, every turn, forever. Dense models are the ones people
 * actually run in a browser, and they get the better rule honestly.
 *
 * EVERY UNCERTAIN CASE RETURNS 'full'. A missed reuse costs latency; a wrong
 * reuse costs correctness, silently. They are not comparable.
 */

/**
 * Identity of the loaded model + cache geometry. If ANY of this changes, state
 * from before is meaningless — reusing it would read another model's numbers.
 * Compared as an opaque string so adding a field cannot be forgotten at the
 * comparison site.
 */
export type CacheSignature = string;

export function cacheSignature(parts: {
  modelId: string;
  quantType: string | number;
  blockCount: number;
  embeddingLength: number;
  headCountKv: number;
  headDim: number;
  /** Layers that keep a recurrent state; their presence forbids truncation. */
  linearAttnLayerCount: number;
  /** KV cache mode ('f32' | '4bit') — a 4-bit cache's packed buffers are a different
   *  representation of the same positions, so reusing an f32 prefix as 4-bit (or vice
   *  versa) would read another representation's bytes. Part of the opaque signature so
   *  a mode switch forces a full prefill instead of silently reusing the wrong layout. */
  kvMode: string;
}): CacheSignature {
  return [
    parts.modelId,
    String(parts.quantType),
    parts.blockCount,
    parts.embeddingLength,
    parts.headCountKv,
    parts.headDim,
    parts.linearAttnLayerCount,
    parts.kvMode,
  ].join('|');
}

export interface PrefixCacheState {
  /** EXACTLY the tokens the live GPU state has processed, prompt + generated. */
  tokens: number[];
  signature: CacheSignature;
  /** Positions the KV buffers can hold. Reuse must fit the whole turn. */
  capacity: number;
}

export interface ReusePlan {
  mode: 'full' | 'extend';
  /** Tokens kept from the cache. KV length is set to this; posBase becomes this. */
  reuseLen: number;
  /** Tokens that still need a prefill pass. Never empty. */
  prefillIds: number[];
  /** Prefill work avoided, for the metric that proves this feature is not inert. */
  savedTokens: number;
  /** Why — surfaced in logs so a 0% hit rate is diagnosable rather than mysterious. */
  reason: string;
}

/** Longest common prefix length of two token sequences. */
export function commonPrefixLength(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

export interface PlanInput {
  cache: PrefixCacheState | null;
  promptIds: readonly number[];
  signature: CacheSignature;
  /** Room the decode phase still needs after the prompt. */
  maxNewTokens: number;
  /**
   * True only when NO layer keeps a recurrent state (dense model). A hybrid or
   * DeltaNet model must never truncate — see the header.
   */
  canTruncate: boolean;
  /**
   * Force a full prefill regardless of what is cached.
   *
   * Two jobs, both load-bearing. It is the CONTROL ARM of the equivalence test:
   * the same prompt decoded greedily must produce identical output with reuse on
   * and off, and without a way to turn it off there is nothing to compare
   * against. It is also a kill switch — this path cannot be exercised on a box
   * with no WebGPU adapter, so a way to disable it from the page, without a
   * redeploy, is the difference between a bad turn and a bad week.
   */
  disabled?: boolean;
}

/**
 * Decide how much of the prompt is already in the live GPU state.
 *
 * Returns `full` (rebuild everything) or `extend` (keep `reuseLen` positions and
 * prefill only `prefillIds`, with RoPE positions starting at `reuseLen`).
 */
export function planReuse(input: PlanInput): ReusePlan {
  const { cache, promptIds, signature, maxNewTokens, canTruncate } = input;

  const full = (reason: string): ReusePlan => ({
    mode: 'full',
    reuseLen: 0,
    prefillIds: [...promptIds],
    savedTokens: 0,
    reason,
  });

  if (input.disabled) return full('prefix reuse disabled');
  if (!promptIds.length) return full('empty prompt');
  if (!cache) return full('no cached state');
  if (cache.signature !== signature) return full('model or cache geometry changed');
  if (!cache.tokens.length) return full('cached state is empty');

  const lcp = commonPrefixLength(cache.tokens, promptIds);
  if (lcp === 0) return full('prompt diverges at token 0');

  // The LAST prompt token must be prefilled: sampling the first reply token
  // needs logits produced from it, and the cache holds state, not logits.
  const maxReusable = promptIds.length - 1;

  let reuseLen: number;
  if (canTruncate) {
    // Dense: dropping KV entries past the divergence point is exact.
    reuseLen = Math.min(lcp, maxReusable);
  } else {
    // Recurrent state cannot be rewound. Only a strict extension of everything
    // the state has already folded in is sound.
    if (lcp < cache.tokens.length) {
      return full(
        `prompt diverges at ${lcp} of ${cache.tokens.length} cached tokens and this model `
        + 'has recurrent layers, which cannot be rewound',
      );
    }
    if (cache.tokens.length > maxReusable) {
      // Cached state is at or past the end of the new prompt — there is nothing
      // left to prefill, and we cannot step back to regenerate logits.
      return full('cached state already covers the whole prompt; cannot re-derive logits');
    }
    reuseLen = cache.tokens.length;
  }

  if (reuseLen <= 0) return full('nothing reusable once the final token is excluded');

  // The whole turn — reused prefix, new prompt tokens, and everything decode may
  // append — has to fit the buffers we already hold. A mid-generation overflow
  // would throw deep in the decode loop, so refuse up front.
  const needed = promptIds.length + maxNewTokens + 1;
  if (needed > cache.capacity) {
    return full(`turn needs ${needed} positions but the cache holds ${cache.capacity}`);
  }

  const prefillIds = promptIds.slice(reuseLen);
  if (!prefillIds.length) return full('no tokens left to prefill');

  return {
    mode: 'extend',
    reuseLen,
    prefillIds,
    savedTokens: reuseLen,
    reason: canTruncate
      ? `reusing ${reuseLen}/${promptIds.length} tokens (lcp ${lcp})`
      : `extending an exact ${reuseLen}-token prefix`,
  };
}

/**
 * What the state has processed once the turn finishes.
 *
 * The GENERATED tokens went through decode, so they are in the KV cache and the
 * recurrent state exactly as if they had been prefilled — and recording them is
 * what makes the NEXT turn's history reusable. Forgetting this is the difference
 * between reusing the system prompt and reusing the entire conversation.
 */
export function committedTokens(
  promptIds: readonly number[],
  generatedIds: readonly number[],
): number[] {
  return [...promptIds, ...generatedIds];
}
