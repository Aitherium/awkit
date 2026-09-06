// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * Tool call parser for Bonsai output.
 * Detects and parses <tool_call>...</tool_call> blocks from model generation,
 * with repair for common small-model malformations.
 */

export interface ParsedToolCall {
  name: string;
  arguments: Record<string, any>;
}

/**
 * Extract all tool calls from text and return remaining text without tool calls.
 * Handles:
 * - Multiple tool calls in one text
 * - Missing closing braces (common in small models)
 * - Unquoted keys (JSON repair)
 * - Trailing prose after tool calls
 *
 * Returns: { toolCalls, remainingText }
 */
/**
 * Insert the opening `<tool_call>` a model omitted.
 *
 * Walks closer-by-closer. A closer already preceded by an unconsumed opener is left alone,
 * so well-formed output is untouched. Otherwise the opener is placed at the first `{` of
 * the segment, which keeps any prose before it in the remaining text rather than swallowing
 * it into the call.
 *
 * A stray `</tool_call>` with no JSON before it is passed through verbatim: inventing a call
 * out of nothing would be worse than missing one.
 */
function repairUnopenedToolCalls(text: string): string {
  const CLOSE = '</tool_call>';
  let out = '';
  let rest = text;

  for (;;) {
    const close = rest.indexOf(CLOSE);
    if (close < 0) return out + rest;

    const before = rest.slice(0, close);
    const after = rest.slice(close + CLOSE.length);

    if (before.includes('<tool_call>')) {
      out += rest.slice(0, close + CLOSE.length);
      rest = after;
      continue;
    }

    const brace = before.indexOf('{');
    if (brace < 0) {
      out += rest.slice(0, close + CLOSE.length);
      rest = after;
      continue;
    }

    out += `${before.slice(0, brace)}<tool_call>${before.slice(brace)}${CLOSE}`;
    rest = after;
  }
}

/**
 * Normalise a model-emitted tool name to a registry key.
 *
 * The same measured run produced `get_ current_time` — a space inside the identifier, from a
 * 1-bit quant splitting the token. Every downstream lookup is an exact-match dict hit, so
 * one stray space is indistinguishable from calling a tool that does not exist, and the turn
 * fails with the model having done nothing wrong.
 */
function normaliseToolName(raw: string): string {
  return String(raw).trim().replace(/\s+/g, '');
}

export function parseToolCalls(text: string): {
  toolCalls: ParsedToolCall[];
  remainingText: string;
} {
  const toolCalls: ParsedToolCall[] = [];

  // MEASURED on real weights before trusting this: Bonsai-4B-Q1_0, greeter framing, the
  // real registry definitions. The model emitted, verbatim:
  //
  //   {"name": "get_ current_time", "arguments": {}}\n</tool_call>
  //   {"name": "evaluate_math", "arguments": {"expression": "47 * 89"}}\n</tool_call>
  //
  // The model is doing its job — right tool, right arguments — and this parser returned
  // ZERO calls for both, because it only matched balanced <tool_call>…</tool_call> pairs.
  // The OPENING tag never appears: the chat template spends it in the instruction block
  // ("return a json object … within <tool_call></tool_call> XML tags", then shows the pair),
  // so the model treats it as already said and emits only the closer.
  //
  // That is not an exotic malformation, it is what this size of model does — and it made an
  // otherwise-working agent look completely inert.
  text = repairUnopenedToolCalls(text);
  let remaining = text;

  // Pattern to match <tool_call>...anything...</tool_call>
  // Using a more careful approach to extract each tool call
  const toolCallPattern = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let match;
  const toolCallMatches: Array<{ full: string; content: string; index: number }> = [];

  // eslint-disable-next-line no-cond-assign
  while ((match = toolCallPattern.exec(text)) !== null) {
    toolCallMatches.push({
      full: match[0],
      content: match[1],
      index: match.index,
    });
  }

  if (toolCallMatches.length === 0) {
    return { toolCalls: [], remainingText: text };
  }

  // Extract tool calls
  for (const m of toolCallMatches) {
    const parsed = parseToolCallJSON(m.content.trim());
    if (parsed) {
      toolCalls.push(parsed);
    }
  }

  // Remove tool call blocks from the text to get remaining text
  remaining = text;
  for (const m of toolCallMatches.reverse()) {
    remaining = remaining.slice(0, m.index) + remaining.slice(m.index + m.full.length);
  }
  remaining = remaining.trim();

  return { toolCalls, remainingText: remaining };
}

/**
 * Parse JSON from a tool call block with repair for common malformations.
 */
function parseToolCallJSON(jsonStr: string): ParsedToolCall | null {
  const trimmed = jsonStr.trim();

  // First try straight parsing
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.name && parsed.arguments !== undefined) {
      return {
        name: normaliseToolName(parsed.name),
        arguments: typeof parsed.arguments === 'string'
          ? tryParseJSON(parsed.arguments) || {}
          : parsed.arguments || {},
      };
    }
  } catch {
    // Fall through to repair
  }

  // Repair malformations
  const repaired = repairJSON(trimmed);
  try {
    const parsed = JSON.parse(repaired);
    if (parsed.name && parsed.arguments !== undefined) {
      return {
        name: normaliseToolName(parsed.name),
        arguments: typeof parsed.arguments === 'string'
          ? tryParseJSON(parsed.arguments) || {}
          : parsed.arguments || {},
      };
    }
  } catch (e) {
    console.warn('[tool-parser] failed to parse tool call:', jsonStr, e);
    return null;
  }

  return null;
}

/**
 * Repair common JSON malformations from small models:
 * - Missing closing brace
 * - Unquoted keys
 * - Trailing commas
 * - Single quotes instead of double quotes
 */
function repairJSON(json: string): string {
  let repaired = json;

  // Replace single quotes with double quotes FIRST
  // Match patterns: 'key' and 'value'
  repaired = repaired.replace(/'([^']*)'/g, '"$1"');

  // Fix unquoted keys: `key:` -> `"key":`
  // Match word characters followed by colon
  repaired = repaired.replace(/(\{|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

  // Remove trailing commas before closing braces/brackets
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1');

  // Add missing closing brace
  const openBraces = (repaired.match(/{/g) || []).length;
  const closeBraces = (repaired.match(/}/g) || []).length;
  if (openBraces > closeBraces) {
    repaired += '}'.repeat(openBraces - closeBraces);
  }

  // Add missing closing brackets
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;
  if (openBrackets > closeBrackets) {
    repaired += ']'.repeat(openBrackets - closeBrackets);
  }

  return repaired;
}

/**
 * Try to parse JSON, return null if it fails.
 */
function tryParseJSON(str: string): Record<string, any> | null {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}
