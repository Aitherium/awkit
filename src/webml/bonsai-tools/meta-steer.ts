// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * Meta-question steering — "how do you know that?" must not re-run the tool
 * that produced the previous answer.
 *
 * Measured live 2026-09-01 on the GobboNet demo (Bonsai 1.7B in-browser): after
 * "what time is it?" was answered via get_current_time, the follow-up "how do
 * you know that?" made the model call get_current_time AGAIN and answer with the
 * time — twice in a row. A small model reads the strongest recent pattern, and
 * the tool call is that pattern. It cannot see that the answer to "how did you
 * know?" is sitting in its own previous turn ("I called get_current_time") —
 * and this surface makes that worse, because the PAGE's history does not persist
 * tool turns at all: GobboNet stores only the final answer text, so on the next
 * turn there is no trace of the call the question is about.
 *
 * The harness CAN see it. The worker keeps a memo of the last turn's tool
 * results (`lastToolResults` in bonsai-worker-core.ts) and passes it here. When
 * the latest user message asks how the previous answer was produced and the memo
 * names a tool, a short note is appended to that user message — the
 * highest-signal position, the final thing the model reads before the assistant
 * turn. The note is CONTEXT, never a scripted reply: the model still answers the
 * actual question, it is just told the one fact it structurally cannot know.
 */

import type { ChatMessage } from "../bonsai/tokenizer/chat_template";

/** A tool result from the previous turn, memoised by the worker. */
export interface PriorToolResult {
  name: string;
  result: string;
}

const META_QUESTION_RE =
  /how (do|did) (you|they|it) know|how can you tell|where did (you|that) (get|come from)/i;

/**
 * Return a copy of `messages` with a steering note appended to the last USER
 * message, or the original array when nothing qualifies. Fires only when BOTH
 * hold:
 *   - the latest message is a user message asking how/where the previous answer
 *     came from, and
 *   - `prior` names at least one tool result from the previous turn.
 *
 * The original array is never mutated — the worker reuses `req.messages` for
 * prefix reuse, so callers get a copy only when the note actually fires.
 */
export function steerMetaQuestion(
  messages: ChatMessage[],
  prior: PriorToolResult[] | null,
): ChatMessage[] {
  if (!prior || prior.length === 0) return messages;
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return messages;
  if (!META_QUESTION_RE.test(last.content)) return messages;

  const names = [...new Set(prior.map((p) => p.name))];
  const list =
    names.length === 1
      ? names[0]
      : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  const note =
    `[Note: the visitor is asking how you knew the previous answer. You knew it ` +
    `because you called the ${list} tool in the previous turn. Answer their ` +
    `question in one or two sentences, naming the tool, and do NOT call it again.]`;

  return [
    ...messages.slice(0, -1),
    { ...last, content: `${last.content}\n\n${note}` },
  ];
}
