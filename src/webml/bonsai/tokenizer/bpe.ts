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
 *   - Qwen byte-level BPE (GPT-2/tiktoken-style), ~151K vocab, from tokenizer.ggml.* KV.
 *
 * Byte-level BPE encode/decode. Tokens + merges come from the GGUF KV (tokenizer/load.ts);
 * this file is the pure algorithm and is fully testable in Node.
 */

/** GPT-2 byte<->unicode map: maps every byte to a printable code point so BPE runs on text. */
export function byteToUnicode(): Map<number, string> {
  const bs: number[] = [];
  for (let i = 0x21; i <= 0x7e; i++) bs.push(i);
  for (let i = 0xa1; i <= 0xac; i++) bs.push(i);
  for (let i = 0xae; i <= 0xff; i++) bs.push(i);
  const cs = [...bs];
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n++;
    }
  }
  const map = new Map<number, string>();
  for (let i = 0; i < bs.length; i++) map.set(bs[i], String.fromCodePoint(cs[i]));
  return map;
}

export interface BpeTables {
  /** token string -> id */
  vocab: Map<string, number>;
  /** id -> token string */
  idToToken: string[];
  /** "a b" merge pair -> rank */
  mergeRank: Map<string, number>;
  byteEncoder: Map<number, string>;
  byteDecoder: Map<string, number>;
  /** `<|...|>` control tokens found in THIS vocab (name -> id), matched before BPE. */
  specialTokens: Map<string, number>;
}

/** GGUF `tokenizer.ggml.token_type` values (llama.cpp `llama_token_attr`). CONTROL and
 *  USER_DEFINED are the two that must be split out of text before BPE — llama.cpp's own
 *  `tokenizer_st_partition` treats exactly these as "special". */
const TOKEN_TYPE_CONTROL = 3;
const TOKEN_TYPE_USER_DEFINED = 4;

export function buildTables(tokens: string[], merges: string[], tokenType: number[] = []): BpeTables {
  const vocab = new Map<string, number>();
  tokens.forEach((t, i) => vocab.set(t, i));
  const mergeRank = new Map<string, number>();
  merges.forEach((m, i) => mergeRank.set(m, i));
  const byteEncoder = byteToUnicode();
  const byteDecoder = new Map<string, number>();
  byteEncoder.forEach((v, k) => byteDecoder.set(v, k));
  // Control tokens are VOCAB-SPECIFIC — derive them from THIS model's token list.
  // Hardcoding Qwen2.5's ids (151644/151645) fed Bonsai-27B (vocab 248320, im_start
  // ACTUALLY 248045) an Arabic/Thai-fragment "template", and the model answered every
  // prompt with pure whitespace. Root-caused live on the 5090 2026-07-22.
  // ...and the SHAPE of a control token is just as vocab-specific as its id. The
  // `<|...|>` test below silently excluded Bonsai's `<think>` (248068) / `</think>`
  // (248069), which are real control tokens that simply don't wear that shape. The
  // effects were not subtle: renderChatML's `<think>\n` was byte-BPE'd into ordinary
  // text, so the model was handed a prefix it never saw in training and answered by
  // trying to leave (top-1 `<|im_end|>` 12.99, top-2 `</think>` 11.02 — both closers);
  // and `thinkStartId`/`thinkEndId` came back undefined, which left `inThink` false and
  // disabled the whole reasoning-channel split. Measured on the real weights 2026-07-25:
  // with the prefill removed the model's top-1 is `<think>` at 22.119 (margin 8.97) —
  // it WANTS that token, it just needs to be given the token and not the letters.
  //
  // So derive specials from the GGUF's own token_type, which is authoritative, and keep
  // the shape heuristic only for vocabs that ship no token_type array at all.
  const specialEntries: Array<[string, number]> = [];
  const haveTypes = tokenType.length === tokens.length;
  tokens.forEach((t, i) => {
    const isSpecial = haveTypes
      ? tokenType[i] === TOKEN_TYPE_CONTROL || tokenType[i] === TOKEN_TYPE_USER_DEFINED
      : t.length >= 5 && t.startsWith("<|") && t.endsWith("|>");
    if (isSpecial) specialEntries.push([t, i]);
  });
  // Longest-first so a shorter control token can never shadow a longer one at match time.
  specialEntries.sort((a, b) => b[0].length - a[0].length);
  const specialTokens = new Map<string, number>(specialEntries);
  return { vocab, idToToken: tokens, mergeRank, byteEncoder, byteDecoder, specialTokens };
}

/** @deprecated Qwen2.5-era hardcoded ids — WRONG for Bonsai-27B (vocab 248320).
 *  Kept only for legacy tests; encode() uses tables.specialTokens derived from the GGUF. */
export const CHATML_SPECIAL_TOKENS = new Map<string, number>([
  ["<|im_start|>", 151644],
  ["<|im_end|>", 151645],
  ["<|object_ref_start|>", 151646],
  ["<|object_ref_end|>", 151647],
  ["<|im|>", 151648],
]);

/** Apply BPE merges to a single pre-token (already byte-encoded to unicode symbols). */
function bpeMerge(symbols: string[], mergeRank: Map<string, number>): string[] {
  if (symbols.length < 2) return symbols;
  let word = symbols;
  for (;;) {
    let bestRank = Infinity;
    let bestIdx = -1;
    for (let i = 0; i < word.length - 1; i++) {
      const rank = mergeRank.get(`${word[i]} ${word[i + 1]}`);
      if (rank !== undefined && rank < bestRank) {
        bestRank = rank;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    word = [
      ...word.slice(0, bestIdx),
      word[bestIdx] + word[bestIdx + 1],
      ...word.slice(bestIdx + 2),
    ];
  }
  return word;
}

// Qwen/GPT-2 pre-tokenization regex (contractions, letters, numbers, punctuation, spaces).
const PRETOKEN_RE =
  /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

// Cache of the per-tables combined special-token splitter (longest-first alternation).
const SPECIAL_RE_CACHE = new WeakMap<BpeTables, RegExp | null>();

function specialSplitRe(t: BpeTables): RegExp | null {
  let re = SPECIAL_RE_CACHE.get(t);
  if (re === undefined) {
    if (t.specialTokens.size === 0) {
      re = null;
    } else {
      // specialTokens is longest-first (buildTables), so the alternation prefers the
      // longest control token at any position.
      const alt = [...t.specialTokens.keys()]
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|");
      re = new RegExp(alt, "g");
    }
    SPECIAL_RE_CACHE.set(t, re);
  }
  return re;
}

/** BPE-encode a plain-text segment (no control tokens inside). */
function encodePlain(text: string, t: BpeTables, ids: number[]): void {
  let remaining = text;
  while (remaining.length > 0) {
    // PRETOKEN_RE is /g (stateful): reset lastIndex — a stale offset from a previous
    // call would silently mis-slice `remaining` and scramble the encoding.
    PRETOKEN_RE.lastIndex = 0;
    const match = PRETOKEN_RE.exec(remaining);
    if (!match) break; // No more pre-tokens in remaining text

    // Process the matched pre-token with standard BPE
    const piece = match[0];
    const enc = new TextEncoder();
    const bytes = enc.encode(piece);
    const symbols = Array.from(bytes, (b) => t.byteEncoder.get(b)!);
    const merged = bpeMerge(symbols, t.mergeRank);
    for (const tok of merged) {
      const id = t.vocab.get(tok);
      if (id !== undefined) ids.push(id);
      // Unknown symbol: fall back to per-symbol ids where present.
      else for (const ch of tok) {
        const cid = t.vocab.get(ch);
        if (cid !== undefined) ids.push(cid);
      }
    }
    remaining = remaining.slice(piece.length);
  }
}

export function encode(text: string, t: BpeTables): number[] {
  const ids: number[] = [];
  // Control tokens must be split out at EVERY position BEFORE the pre-token regex runs:
  // the punctuation class otherwise swallows `<|` mid-string (e.g. "assistant.<|im_end|>"
  // fragmented the FIRST <|im_end|> while later ones matched — root-caused 2026-07-22).
  // Ids come from THIS vocab (tables.specialTokens), never from hardcoded constants.
  const re = specialSplitRe(t);
  let pos = 0;
  if (re) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > pos) encodePlain(text.slice(pos, m.index), t, ids);
      ids.push(t.specialTokens.get(m[0])!);
      pos = m.index + m[0].length;
    }
  }
  if (pos < text.length) encodePlain(text.slice(pos), t, ids);
  return ids;
}

export function decode(ids: number[], t: BpeTables): string {
  let unicode = "";
  for (const id of ids) {
    const tok = t.idToToken[id];
    if (tok !== undefined) unicode += tok;
  }
  // reverse the byte-level mapping back to raw bytes, then UTF-8 decode
  const bytes: number[] = [];
  for (const ch of unicode) {
    const b = t.byteDecoder.get(ch);
    if (b !== undefined) bytes.push(b);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
}
