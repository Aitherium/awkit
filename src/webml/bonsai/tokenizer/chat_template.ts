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
 *   - ChatML render (Qwen family): <|im_start|>role\n...<|im_end|>
 *
 * Renders messages to the ChatML string Qwen expects, then the caller encodes it with
 * the BPE tables. Kept as text rendering (not token surgery) so it is trivially testable.
 */

export interface ToolFunction {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ToolCall {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, any>;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** For assistant messages: tool calls made in this turn. */
  tool_calls?: ToolCall[];
  /** For assistant messages: reasoning content (separate from answer). */
  reasoning_content?: string;
}

/** @deprecated The GGUF's own template injects NO default system turn — kept for callers only. */
export const DEFAULT_SYSTEM = "You are a helpful assistant.";

/** Render ChatML exactly as the GGUF's chat template (verified against the HF GGUF metadata):
 *  - Supports tools parameter for function calling
 *  - Supports tool_calls in assistant messages
 *  - Supports tool role for function results
 *  - Maintains backwards compatibility when no tools are present
 *  - Generation prompt ends with `<|im_start|>assistant\n<think>\n\n</think>\n\n` to match
 *    the model's training. */
export function renderChatML(
  messages: ChatMessage[],
  addGenerationPrompt = true,
  tools?: ToolFunction[]
): string {
  let out = "";

  // TOOLS SECTION: rendered as a system turn before any user messages
  if (tools && tools.length > 0) {
    out += `<|im_start|>system\n`;
    // Include any existing system message from the first message
    if (messages[0]?.role === "system") {
      out += messages[0].content + "\n\n";
    }
    // Tools section
    out += "# Tools\n\nYou may call one or more functions to assist with the user query.\n\n";
    out += "You are provided with function signatures within <tools></tools> XML tags:\n";
    out += "<tools>";
    for (const tool of tools) {
      out += "\n" + JSON.stringify(tool);
    }
    out += "\n</tools>\n\n";
    out += "For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:\n";
    out += "<tool_call>\n";
    out += '{"name": <function-name>, "arguments": <args-json-object>}\n';
    out += "</tool_call>";
    out += `<|im_end|>\n`;
  } else {
    // No tools: emit system message normally if present
    if (messages[0]?.role === "system") {
      out += `<|im_start|>system\n${messages[0].content}<|im_end|>\n`;
    }
  }

  // MESSAGES: skip first system message if tools were rendered (already in system turn)
  // or if no tools and it's the first message (already handled above)
  const startIdx = tools && tools.length > 0 && messages[0]?.role === "system" ? 1
    : !tools && messages[0]?.role === "system" ? 1
    : 0;

  for (let i = startIdx; i < messages.length; i++) {
    const m = messages[i];

    if (m.role === "user") {
      out += `<|im_start|>user\n${m.content}<|im_end|>\n`;
    } else if (m.role === "assistant") {
      let content = m.content;
      let reasoning = m.reasoning_content || "";

      // Render reasoning if present
      if (reasoning) {
        out += `<|im_start|>assistant\n<think>\n${reasoning.trim()}\n</think>\n\n`;
      } else {
        out += `<|im_start|>assistant\n`;
      }

      // Render answer content
      if (content) {
        out += content;
      }

      // Render tool calls if present
      if (m.tool_calls && m.tool_calls.length > 0) {
        for (const toolCall of m.tool_calls) {
          if (content) out += "\n"; // Separate from content
          const fn = toolCall.function || (toolCall as any);
          out += "<tool_call>\n";
          out += JSON.stringify({
            name: fn.name,
            arguments: typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments,
          });
          out += "\n</tool_call>";
        }
      }

      out += `<|im_end|>\n`;
    } else if (m.role === "tool") {
      // Tool responses are wrapped in a user turn
      out += `<|im_start|>user\n<tool_response>\n${m.content}\n</tool_response><|im_end|>\n`;
    }
  }

  if (addGenerationPrompt) {
    // Match the GGUF template: start with thinking block ready to receive reasoning
    out += `<|im_start|>assistant\n<think>\n\n</think>\n\n`;
  }
  return out;
}
