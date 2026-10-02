/**
 * Minimal chat types used by desktop components.
 * The full AeonChat implementation is provided by the consuming app.
 */

export interface AeonMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: string | number
  thinking?: string
  model?: string
  metadata?: Record<string, unknown>
  /** Trace events recorded during this message's generation. */
  traceEvents?: Array<Record<string, unknown>>
  /** Pipeline/routing metadata (model selection, tier, etc.). */
  pipelineData?: Record<string, unknown>
  /** Raw thinking/reasoning content from the model. */
  thinkingContent?: string
}

export interface AeonChatConfig {
  sessionId?: string
  persona?: string
  depth?: number
  systemPrompt?: string
}
