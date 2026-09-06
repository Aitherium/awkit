/**
 * Text chunking for the session-memory lane.
 *
 * Deterministic, paragraph-first, hard-cut fallback. The one job of a chunker
 * is to keep semantic units together: a paragraph is the unit, sentences are
 * the fallback boundary, and only pathological text gets cut mid-word (with
 * the cut re-joined by the overlap). No LLM, no network — pure string work.
 */

export interface ChunkOptions {
  /** Max chars per chunk. Default 900 — a safe window for 128..512-token embedders. */
  maxChars?: number
  /**
   * Overlap chars between adjacent chunks. Default 0 — the seam-carry MUTATES
   * the following chunk's text, so any change to chunk N rewrites chunk N+1
   * and diff-indexing sees a whole-page rewrite. Cuts already land on
   * sentence boundaries (the carry was belt-and-suspenders); enable it only
   * when seam-sentence retrieval outweighs diff stability.
   */
  overlap?: number
}

/** Collapse runs of whitespace, keep single newlines for paragraph structure. */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * FNV-1a — tiny, stable, dependency-free. Deterministic across platforms.
 * Used for the diff-indexing content hash; the same function the stub
 * embedder hashes words with, kept here so both stay one source of truth.
 */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Stable content hash of a chunk's normalized text (hex, fixed length). */
export function contentHash(text: string): string {
  return fnv1a(normalizeWhitespace(text)).toString(16).padStart(8, "0")
}

function hardCut(text: string, max: number, overlap: number, out: string[]): string {
  while (text.length > max) {
    out.push(text.slice(0, max))
    text = text.slice(max - overlap)
  }
  out.push(text)
  return ""
}

/** Split text into chunks, keeping paragraph boundaries where possible. */
export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const max = opts.maxChars ?? 900
  const overlap = Math.min(opts.overlap ?? 0, Math.floor(max / 2))
  const normalized = normalizeWhitespace(text)
  if (normalized.length === 0) return []
  if (normalized.length <= max) return [normalized]

  // Split into paragraphs, then pack paragraphs into chunks; a paragraph that
  // alone exceeds maxChars gets sentence-boundary cuts before hard cutting.
  const paragraphs = normalized.split(/\n\n+/).map((p) => p.trim()).filter(Boolean)
  const out: string[] = []
  let current = ""

  const flush = (): void => {
    if (current.length > 0) {
      out.push(current)
      current = ""
    }
  }
  const emit = (block: string): void => {
    if (current.length + block.length + 2 <= max) {
      current = current.length === 0 ? block : `${current}\n\n${block}`
      return
    }
    flush()
    if (block.length <= max) {
      current = block
      return
    }
    // Oversized paragraph: cut at sentence boundaries, then hard cut.
    // match() instead of a lookbehind split so the transform chain (babel /
    // the vitest shim) never has to support lookbehind to run the chunker.
    const sentences = block.match(/[^.!?\n]+[.!?]*\s*/g) ?? [block]
    let sentence = ""
    for (const s of sentences) {
      if (sentence.length + s.length + 1 <= max) {
        sentence = sentence.length === 0 ? s : `${sentence} ${s}`
      } else {
        if (sentence.length > 0) out.push(sentence)
        sentence = s.length > max ? s : s
      }
    }
    if (sentence.length > 0) {
      if (sentence.length <= max) out.push(sentence)
      else hardCut(sentence, max, overlap, out)
    }
  }

  for (const p of paragraphs) emit(p)
  flush()

  // Splice a carry-over (the last `overlap` chars) onto the head of each next
  // chunk so a sentence seam spanning the boundary stays retrievable whole.
  // A seam never splits into a chunk that cannot stand alone; if the carry is
  // pure whitespace it carries nothing and is skipped.
  // GATED on overlap > 0: `slice(-0)` is `slice(0)` — the WHOLE chunk — so an
  // un-gated pass with overlap 0 duplicates every chunk onto its successor
  // (measured 2026-08-31: the diff-indexing tests caught exactly this).
  if (out.length > 1 && overlap > 0) {
    const result: string[] = []
    for (let i = 0; i < out.length - 1; i += 1) {
      const carry = out[i].slice(-overlap).trimEnd()
      result.push(out[i])
      if (carry.length > 0) out[i + 1] = `${carry}\n\n${out[i + 1]}`
    }
    result.push(out[out.length - 1])
    return result
  }
  return out
}
