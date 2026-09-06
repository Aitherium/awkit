// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * Tool calling orchestrator for Bonsai generation.
 * Manages the loop: generate -> parse tool calls -> execute -> add to context -> continue.
 */

import type { ChatMessage, ToolFunction } from '../bonsai/tokenizer/chat_template';
import { parseToolCalls } from './parser';
import { executeTool, getToolDefinitions, BONSAI_TOOLS } from './registry';

export interface ToolCallEvent {
  type: 'tool_call' | 'tool_result' | 'tool_error';
  toolName?: string;
  arguments?: Record<string, any>;
  result?: string;
  error?: string;
}

export interface ToolOrchestrationResult {
  finalText: string;
  toolCalls: ToolCallEvent[];
}

/**
 * Run tool calling orchestration for a generated text.
 * Detects tool calls, executes them, and optionally appends results to context.
 *
 * Returns:
 * - finalText: The generated text with tool call blocks removed
 * - toolCalls: Event log of all tool calls and results
 */
export async function orchestrateToolCalls(
  generatedText: string,
  onToolCall?: (event: ToolCallEvent) => void,
  maxCalls = Infinity
): Promise<ToolOrchestrationResult> {
  const toolCalls: ToolCallEvent[] = [];
  const { toolCalls: parsedCalls, remainingText } = parseToolCalls(generatedText);

  // AN IDENTICAL CALL TWICE IN ONE GENERATION IS A LOOP, NOT A NEED.
  //
  // The tool already ran once and its result is appended to the context below;
  // a second execution can only produce the same bytes at the cost of another
  // round trip — and, for a network-backed tool, another quota hit. Keyed by
  // (name, args), so a genuinely different question for the same tool still
  // executes. This is the in-turn half of the redundant-call problem; the
  // CROSS-turn half (a "how do you know that?" re-invoking last turn's tool) is
  // steered before generation by meta-steer.ts, because by the time a tool call
  // is parsed the previous result is no longer in this context.
  const seen = new Set<string>();

  // Process each tool call sequentially, up to `maxCalls`. The cap is a safety bound: a
  // small model that loops on a marker must not be able to drive unbounded execution.
  for (const call of parsedCalls.slice(0, maxCalls)) {
    const toolName = call.name;

    // Emit tool call event
    const callEvent: ToolCallEvent = {
      type: 'tool_call',
      toolName,
      arguments: call.arguments,
    };
    toolCalls.push(callEvent);
    onToolCall?.(callEvent);

    const key = `${toolName}:${JSON.stringify(call.arguments ?? {})}`;
    const duplicate = seen.has(key);
    seen.add(key);

    // Execute the tool — or, for a duplicate, hand back the result it already
    // produced this turn. The follow-up generation reads all results together,
    // so the earlier result IS in the context this message points at.
    const result = duplicate
      ? `You already called ${toolName} with the same arguments in this turn. `
        + `Use the result already provided above; do not call it again.`
      : await executeTool(toolName, call.arguments);
    const resultEvent: ToolCallEvent = {
      type: 'tool_result',
      toolName,
      // The arguments ride on the RESULT event too — the worker memoises the
      // last turn's results for meta-steer, and a result that cannot name what
      // it was called with cannot be reused.
      arguments: call.arguments,
      result,
    };
    toolCalls.push(resultEvent);
    onToolCall?.(resultEvent);
  }

  return {
    finalText: remainingText,
    toolCalls,
  };
}

/**
 * Extend message history with tool results to continue generation.
 * This prepares the context for a follow-up generation turn.
 */
export function extendMessagesWithToolResults(
  messages: ChatMessage[],
  toolCalls: ToolCallEvent[]
): ChatMessage[] {
  if (toolCalls.length === 0) {
    return messages;
  }

  const extended = [...messages];

  // Group tool calls and results
  const callsForContext = [];
  let i = 0;
  while (i < toolCalls.length) {
    const event = toolCalls[i];
    if (event.type === 'tool_call' && event.toolName) {
      callsForContext.push({
        name: event.toolName,
        arguments: event.arguments || {},
      });
    }
    i++;
  }

  // Add tool results as a user turn with tool_response wrapper
  const resultsText = toolCalls
    .filter((e) => e.type === 'tool_result')
    .map((e) => `Tool ${e.toolName}: ${e.result}`)
    .join('\n\n');

  if (resultsText) {
    extended.push({
      role: 'tool',
      content: resultsText,
    });
  }

  return extended;
}

/**
 * Get the tools available for use.
 */
export function getAvailableTools(): ToolFunction[] {
  return getToolDefinitions();
}

/**
 * Check if tools are currently available (there must be at least one).
 */
export function hasAvailableTools(): boolean {
  return Object.keys(BONSAI_TOOLS).length > 0;
}
