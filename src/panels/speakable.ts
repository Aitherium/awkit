/**
 * speakable: what a line SOUNDS like. Every web text-to-speech path runs it first, so a
 * reply written for the screen ("*blinks* *bounces* 🐾 Hi Athena!") is said as "Hi Athena!",
 * never "asterisk blinks asterisk" (heard from a child's Sprite, 2026-10-07).
 *
 * The same rules live in lib/media/speakable.py (the voice plane) and Speakable.java (the
 * Android app); the three tests pin the same vectors.
 *  - `*action*` / `_action_` spans go, except one word emphasised mid-sentence ("that is
 *    *so* cool" keeps "so"). `**bold**` keeps its words.
 *  - `(action)` / `[action]` spans of words only go; "(5 + 5)" and "[1]" stay.
 *  - Emoji (pictographs, flags, skin tones, joiners, variation selectors) go.
 *  - Markdown marks go.
 */

const WORDS = "[A-Za-z][A-Za-z' ,\\-]{0,60}"
const STAR = /(?<!\*)\*(?![*\s])([^*\n]{1,60}?)(?<!\s)\*(?!\*)/g
const UNDER = /(?<![\w_])_(?![_\s])([^_\n]{1,60}?)(?<!\s)_(?![\w_])/g
const PAREN = new RegExp(`\\((${WORDS})\\)`, 'g')
const SQUARE = new RegExp(`\\[(${WORDS})\\](?!\\()`, 'g')
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{E0020}-\u{E007F}‍⃣⌀-⏿←-⇿〰〽㊗㊙]+/gu
const LINE_MARK = /^[ \t]*(#{1,6}|>|[-*+•]|\d+[.)])[ \t]+/gm
const MARKS = /(?<!\w)[*_]+|[*_]+(?!\w)|`+|~~|#+(?=\s)/g
const ORPHAN = /^[\s,.;:!?\-–—]+/
const SPACE_PUNCT = /\s+([,.;:!?])/g

function isAlpha(c: string | undefined): boolean {
  return !!c && /\p{L}/u.test(c)
}

/** True when a *span* is one word inside a sentence: words on both sides. */
function emphasis(inner: string, src: string, start: number, end: number): boolean {
  const word = inner.trim()
  if (!word || word.includes(' ')) return false
  const before = src.slice(0, start).trimEnd()
  const after = src.slice(end).trimStart()
  const a = after[0]
  return isAlpha(before[before.length - 1]) && isAlpha(a) && a === a.toLowerCase()
}

/** The stage directions in `text` (lowercased, in order), for a body to act out. */
export function actionsIn(text: string): string[] {
  const out: string[] = []
  const src = text || ''
  for (const rx of [STAR, UNDER, PAREN, SQUARE]) {
    for (const m of src.matchAll(rx)) {
      const start = m.index ?? 0
      if ((rx === STAR || rx === UNDER) && emphasis(m[1], src, start, start + m[0].length)) continue
      const a = m[1].toLowerCase().split(/\s+/).filter(Boolean).join(' ')
      if (a && !out.includes(a)) out.push(a)
    }
  }
  return out
}

/** `text` with stage directions, emoji and markdown removed, as a voice should say it. */
export function speakable(text: string | null | undefined): string {
  if (!text) return ''
  const src = String(text)
  let s = src.replace(STAR, (m: string, inner: string, offset: number) =>
    emphasis(inner, src, offset, offset + m.length) ? ` ${inner.trim()} ` : ' ')
  const s2 = s
  s = s.replace(UNDER, (m: string, inner: string, offset: number) =>
    emphasis(inner, s2, offset, offset + m.length) ? ` ${inner.trim()} ` : ' ')
  s = s.replace(PAREN, ' ').replace(SQUARE, ' ').replace(EMOJI, ' ')
  s = s.replace(LINE_MARK, '').replace(MARKS, '')
  s = s.split(/\s+/).filter(Boolean).join(' ')
  s = s.replace(SPACE_PUNCT, '$1').replace(ORPHAN, '')
  return s.trim()
}
