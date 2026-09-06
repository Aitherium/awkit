// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * STREAMING TOOL-CALL GATE — keep tool markup OUT of the answer bubble.
 *
 * THE BUG (reported 2026-07-31): "bonsai is just printing them raw and outputting in the
 * response... when the response does complete it drops the raw tool call."
 *
 * The worker streams every non-`<think>` token straight to the `answer` channel the instant
 * it is produced, and only parses tool calls AFTER generation ends. So the reader watches
 *
 *     {"name": "get_current_time", "arguments": {}}</tool_call>
 *
 * type itself into the chat bubble, and only then does the real reply arrive. The parse was
 * never wrong — it just ran far too late to affect what was rendered. Post-hoc stripping
 * cannot fix a stream that is append-only; the text has to be withheld BEFORE it is posted.
 *
 * WHY A PREFIX GATE AND NOT A REGEX STRIP. Streaming means deciding what is safe to show
 * without having seen the end. This returns the longest prefix of the accumulated text that
 * provably cannot be inside a tool call, and holds the rest back until it resolves. Nothing
 * is ever un-shown, which matters because the transcript is append-only.
 *
 * THE OPENING TAG IS USUALLY ABSENT — that is not an edge case, it is the common case. The
 * chat template spends `<tool_call>` in its instruction block ("...within
 * `<tool_call></tool_call>` XML tags"), so the model treats it as already said and emits
 * only the closer (see parser.ts, and the 3-stacked-breaks history). A gate that keyed on
 * the opening tag would therefore withhold nothing on the exact shape that actually occurs.
 * So a bare `{` after the last close is treated as a CANDIDATE call and held back too.
 *
 * THE HOLDBACK IS SCOPED TO TURNS THAT ACTUALLY PASS TOOLS. Otherwise a legitimate answer
 * containing a `{` — JSON, code, a brace in prose — would stall at that character until the
 * turn ended. With no tools in the prompt no tool-call markup can be produced, so there is
 * nothing to hide and the stream must be untouched. The tool follow-up pass deliberately
 * carries `tools: undefined`, so the final human-facing answer always streams ungated.
 */

const OPEN = '<tool_call>';
const CLOSE = '</tool_call>';

/**
 * The longest prefix of `text` that is safe to show a reader right now.
 *
 * @param text  everything the model has produced on the answer channel so far
 * @param toolsActive  whether this turn passed tools; false disables the gate entirely
 */
export function visibleAnswerPrefix(text: string, toolsActive: boolean): string {
  if (!toolsActive) return text;

  // COMPLETED CALLS ARE CUT OUT, NOT CUT AT.
  //
  // The first version returned the longest prefix ending before a call, which is wrong the
  // moment a call COMPLETES with prose after it: `…</tool_call>It is 09:28.` has no
  // unterminated region, so a prefix rule returns the whole string — markup included. That
  // is the original bug, reproduced inside its own fix. The visible text is the answer with
  // call spans EXCISED, so prose on both sides survives and the markup never appears.
  //
  // This stays append-only, which is what the streaming caller requires: an excised span is
  // never re-shown, and text before it is untouched, so each successive result extends the
  // last. (`stream-gate.test.ts` asserts that property character by character.)
  let out = '';
  let i = 0;
  for (;;) {
    const close = text.indexOf(CLOSE, i);
    if (close === -1) break;
    const start = callStart(text, i, close);
    out += text.slice(i, start);
    i = close + CLOSE.length;
  }

  // Whatever follows the last completed call may still BE a call in progress — hold it back.
  const tail = text.slice(i);
  const open = tail.indexOf(OPEN);
  if (open !== -1) return out + tail.slice(0, open);
  // No opening tag: the common shape, because the template spends the opener in its
  // instructions. A `{` is therefore a candidate call and waits until it resolves.
  const brace = tail.indexOf('{');
  if (brace !== -1) return out + tail.slice(0, brace);
  // A PARTIALLY-ARRIVED OPENING TAG. Tokens are byte fragments, so `<tool_call>` shows up as
  // `<`, `<tool`, `<tool_call`… and none of those contain `{` or the whole tag. Emitting them
  // put a literal `<tool_call` in the bubble, and because the stream is append-only it could
  // never be taken back. Withhold any trailing run that could still become the tag.
  return out + tail.slice(0, tail.length - danglingOpenLen(tail));
}

/** Length of the trailing suffix of `s` that is a proper prefix of `<tool_call>`. */
function danglingOpenLen(s: string): number {
  const max = Math.min(s.length, OPEN.length - 1);
  for (let n = max; n > 0; n--) {
    if (s.endsWith(OPEN.slice(0, n))) return n;
  }
  return 0;
}

/** Where the call ending at `close` begins, searching no earlier than `from`. */
function callStart(text: string, from: number, close: number): number {
  const openIdx = text.indexOf(OPEN, from);
  if (openIdx !== -1 && openIdx < close) return openIdx;
  // Opener swallowed by the template — fall back to the `{` that begins the JSON.
  //
  // FIRST brace after `from`, never the LAST before `close`. `lastIndexOf('{', close)` finds
  // the NESTED brace in `"arguments":{}` and starts the span there, so everything up to it —
  // `{"name":"get_current_time","arguments":` — is emitted as answer text. That is the raw
  // JSON leak this file exists to prevent, and it survived the first two attempts because a
  // whole-string test never sees it: it only appears once the closer arrives mid-stream.
  const brace = text.indexOf('{', from);
  return brace === -1 || brace > close ? from : brace;
}

/**
 * The spans of `text` that are tool-call markup, for rendering in their own collapsed
 * bubble rather than in the reply. Complements `visibleAnswerPrefix`: what that hides,
 * this surfaces, so the information is relocated rather than lost.
 *
 * Only COMPLETED calls are returned. A half-emitted call has nothing meaningful to show and
 * would render as a flickering fragment.
 */
export function completedToolSpans(text: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const close = text.indexOf(CLOSE, from);
    if (close === -1) return out;
    // Same span boundary the gate uses, so what is hidden is exactly what is surfaced.
    let start = callStart(text, from, close);
    if (text.startsWith(OPEN, start)) start += OPEN.length;
    out.push(text.slice(start, close).trim());
    from = close + CLOSE.length;
  }
}
