// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * Bonsai tool calling support — main export.
 */

export {
  BONSAI_TOOLS, getToolDefinitions, getToolDefinitionsForModel, toolBudgetReport,
  executeTool, setToolContext, drainToolActions,
  type RegisteredTool, type ToolExecutor, type ToolContext, type OpenableApp,
} from './registry';
export { parseToolCalls, type ParsedToolCall } from './parser';
export {
  orchestrateToolCalls,
  extendMessagesWithToolResults,
  getAvailableTools,
  hasAvailableTools,
  type ToolCallEvent,
  type ToolOrchestrationResult,
} from './tool-orchestrator';
