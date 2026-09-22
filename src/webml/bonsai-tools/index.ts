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
  BONSAI_TOOLS, getToolDefinitions, getToolDefinitionsForModel, getToolsFor,
  toolBudgetReport, executeTool, setToolContext, drainToolActions,
  setDynamicTools, clearDynamicTools, dynamicToolNames,
  type RegisteredTool, type ToolExecutor, type ToolContext, type OpenableApp,
  type ToolAudience,
} from './registry';
export {
  createBrowserSessionTools, resetBrowserSession, currentBrowserSession, BROWSE_ACTIONS,
  type BrowserToolContext,
} from './browser-session-tools';
export {
  createPageTools, setPageToolBridge, pageToolBridgeNames, PAGE_TOOL_SPECS,
  PAGE_TOOL_NAMES, ANON_SAFE_PAGE_TOOL_NAMES, NO_BRIDGE_MESSAGE,
  type PageToolBridge, type PageToolExecutor, type PageToolSpec,
} from './page-tools';
export {
  loadMcpTools, loadMcpToolsCached, clearMcpToolCache, MCP_ENDPOINT,
  MCP_TOOLS_LIST_METHOD, NO_BEARER_REFUSAL,
  type McpToolsResult, type LoadMcpToolsOptions,
} from './mcp-client-tools';
export { parseToolCalls, type ParsedToolCall } from './parser';
export {
  orchestrateToolCalls,
  extendMessagesWithToolResults,
  getAvailableTools,
  hasAvailableTools,
  type ToolCallEvent,
  type ToolOrchestrationResult,
} from './tool-orchestrator';
