// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/**
 * Browser-tool bundle for the GobboNet page.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * aitherium.com's in-browser Bonsai has tools -- `get_current_time`,
 * `web_search`, `search_wikipedia` and the rest of the registry -- because the
 * React surface imports them directly. gobbonet.aitherium.com is served from
 * `public/gobbonet/`, which is plain unbundled JavaScript: nothing there is
 * compiled, imported or type-checked, so it cannot reach a TypeScript module.
 *
 * The result, reported live: the same model, in the same browser, on two of our
 * own pages, answers "what time is it?" correctly on one and says "I don't have
 * access to real-time information" on the other. It is not lying -- on that page
 * it genuinely has no tools -- which is exactly the failure that makes a capable
 * agent look incapable.
 *
 * So the registry is bundled to a global instead of duplicated. A second,
 * hand-written copy of the tool list in vanilla JS would drift from this one,
 * and that drift has already happened once in this tree: the shared
 * browser-inference worker carries a comment asking people to keep two copies in
 * step, and they did not. A comment is not a build step.
 *
 * Emitted by `scripts/build-workers.mjs` to
 * `public/gobbonet/bonsai-tools.js` as an IIFE that sets
 * `window.AitherBonsaiTools`.
 */

import {
  BONSAI_TOOLS,
  drainToolActions,
  executeTool,
  getToolDefinitions,
  getToolDefinitionsForModel,
  setToolContext,
} from './registry';
import { parseToolCalls } from './parser';
import {
  extendMessagesWithToolResults,
  getAvailableTools,
  hasAvailableTools,
  orchestrateToolCalls,
} from './tool-orchestrator';

declare global {
  interface Window {
    AitherBonsaiTools?: Record<string, unknown>;
  }
}

/**
 * The whole public surface a vanilla page needs to run a tool loop:
 * definitions to put in the prompt, a parser for what the model emits, an
 * executor, and the orchestrator that ties them together.
 *
 * Exposed as one global rather than several so a page cannot end up with half
 * of it -- a page holding `executeTool` but not `getToolDefinitions` would send
 * the model no tools and then be unable to explain why nothing was called.
 */
const api = {
  // definitions -> prompt
  getToolDefinitions,
  getToolDefinitionsForModel,
  getAvailableTools,
  hasAvailableTools,
  // model output -> calls
  parseToolCalls,
  // calls -> results
  executeTool,
  orchestrateToolCalls,
  extendMessagesWithToolResults,
  // side channels the registry needs
  setToolContext,
  drainToolActions,
  // introspection, so a page can SHOW what it has rather than assert it
  toolNames: () => Object.keys(BONSAI_TOOLS),
};

window.AitherBonsaiTools = api;

export default api;
