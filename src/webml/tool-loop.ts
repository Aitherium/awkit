/**
 * Host-side tool loop for on-device WebML chat.
 *
 * The Bonsai chat template (bonsai/tokenizer/chat_template.ts) already speaks
 * the full Hermes-style contract — <tools> declaration in the system turn,
 * <tool_call> JSON from the assistant, role:"tool" rendered back as
 * <tool_response> — but the WORKER only renders messages; nothing executed a
 * call. This module is the missing host half: declare tools in the system
 * prompt, parse calls out of generated text, and hand results back as tool
 * messages so generation can continue.
 *
 * Parsing is deliberately lenient: a 0.6-4B model malforms XML often (missing
 * opening tag, trailing commas, single quotes). A parse failure must surface
 * VISIBLY (the raw text stays in the transcript) — never silently degrade to
 * an answer that pretends no tool existed.
 */

export interface WebMLToolSpec {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export interface WebMLTools {
  specs: WebMLToolSpec[]
  /** Execute one call; return the tool-response text handed back to the model. */
  execute: (name: string, args: Record<string, unknown>) => Promise<string>
}

/** Hard cap on execute→regenerate rounds per user turn (loop protection). */
export const MAX_TOOL_ROUNDS = 3

/**
 * The <tools> declaration block, byte-compatible with what
 * renderChatML(messages, ..., tools) would emit inside the system turn — kept
 * host-side so the worker protocol stays untouched.
 */
export function renderToolsSystemBlock(specs: WebMLToolSpec[]): string {
  let out = 'You may call functions to help answer the user.\n\n'
  out += 'You are provided with function signatures within <tools></tools> XML tags:\n'
  out += '<tools>'
  for (const tool of specs) out += '\n' + JSON.stringify(tool)
  out += '\n</tools>\n\n'
  out += 'For each function call, return a json object with function name and '
  out += 'arguments within <tool_call></tool_call> XML tags:\n'
  out += '<tool_call>\n{"name": <function-name>, "arguments": <args-json-object>}\n</tool_call>'
  return out
}

export interface ParsedWebMLToolCall {
  name: string
  arguments: Record<string, unknown>
  raw: string
}

/** Extract tool calls from generated text; `rest` is the text with calls removed. */
export function parseToolCalls(text: string): { calls: ParsedWebMLToolCall[]; rest: string } {
  const calls: ParsedWebMLToolCall[] = []
  let rest = text
  // Well-formed pairs first; then a lone opening tag to end-of-text (truncated
  // generations stop mid-call more often than they close the tag).
  const patterns = [
    /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g,
    /<tool_call>\s*(\{[\s\S]*\})\s*$/g,
  ]
  for (const re of patterns) {
    rest = rest.replace(re, (whole, body: string) => {
      const parsed = tryParseCallBody(body)
      if (parsed) {
        calls.push({ ...parsed, raw: whole })
        return ''
      }
      return whole // unparseable — leave it visible in the transcript
    })
    if (calls.length) break
  }
  return { calls, rest: rest.trim() }
}

function tryParseCallBody(
  body: string,
): { name: string; arguments: Record<string, unknown> } | null {
  const candidates = [
    body,
    // Small-model repairs: trailing commas, single→double quotes on keys.
    body.replace(/,\s*([}\]])/g, '$1'),
    body.replace(/'/g, '"').replace(/,\s*([}\]])/g, '$1'),
  ]
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c)
      const name = obj?.name
      if (typeof name === 'string' && name) {
        const args = obj.arguments ?? obj.parameters ?? {}
        return { name, arguments: typeof args === 'object' && args ? args : {} }
      }
    } catch {
      /* try next repair */
    }
  }
  return null
}
