// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * PAGE_* — the agent acts on the page the person is looking at.
 *
 * TWO SURFACES, ONE DEFINITION LIST. The same tools are exposed twice on purpose:
 *   - to an ATTACHING agent (the user's awnode, a WebMCP-capable browser) through
 *     `document.modelContext`, registered by `lib/webmcp/page-tools.ts`;
 *   - to OUR in-page agent through `BONSAI_TOOLS`.
 * If those two lists could drift, the browser agent and the in-browser agent would
 * disagree about what this page can do — so the definitions live HERE, once, and the
 * WebMCP side imports them rather than restating them.
 *
 * 🚩 A DEFINITION IS NOT A CAPABILITY. These tools need `document`, and tool execution
 * happens inside a Web Worker on the WebGPU rung, where there is no `document` and
 * `self.location` is the worker script's URL (the measured failure recorded in
 * `registry.ts`'s ToolContext header). So:
 *   - the EXECUTORS call a bridge that only the MAIN THREAD can install
 *     (`setPageToolBridge`), and say plainly that the page did not offer the tool when
 *     no bridge is there — never a plausible empty string;
 *   - the DEFINITIONS are advertised only when `ToolContext.pageToolsAvailable` names
 *     them, i.e. only when a host page really registered them. A model told it can read
 *     the DOM on a page that never wired it will spend a turn finding out.
 *
 * 🚩 `page_storage_get` HAS A DENYLIST AND IT IS THE POINT OF THE TOOL'S EXISTENCE.
 * Site storage on an Aitherium origin holds `aither_auth_token`. A tool that returned it
 * would turn one injected sentence on any page into a bearer printed in the transcript
 * and posted to whatever backend is serving the turn. The refusal is keyed on the KEY,
 * before any read, and it refuses by PATTERN rather than by an exact list so that the
 * next credential someone stores is refused before anybody remembers this file exists.
 */

import type { RegisteredTool } from './registry';
import type { ToolFunction } from '../bonsai/tokenizer/chat_template';

/** What a page tool does when it runs on the main thread. */
export type PageToolExecutor = (args: Record<string, any>) => Promise<string>;

/** The main thread's implementations, installed by `lib/webmcp/page-tools.ts`. */
export type PageToolBridge = Record<string, PageToolExecutor>;

let bridge: PageToolBridge | null = null;

/**
 * Install (or clear) the main thread's page-tool implementations.
 *
 * Module state rather than a parameter because the registry is a module singleton and
 * the host that owns `document` is not the caller of `executeTool`.
 */
export function setPageToolBridge(impl: PageToolBridge | null): void {
  bridge = impl;
}

/** What the registry currently has wired. Reporting and tests only. */
export function pageToolBridgeNames(): string[] {
  return bridge ? Object.keys(bridge).sort() : [];
}

/* ────────────────────────────────────────────────────────────────────────────
 * The definitions — the ONE list both surfaces read.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface PageToolSpec {
  definition: ToolFunction;
  /** May a visitor with no account use it? Filtered by `getToolDefinitionsForModel`. */
  anonSafe: boolean;
}

export const PAGE_TOOL_SPECS: readonly PageToolSpec[] = [
  {
    anonSafe: true,
    definition: {
      name: 'page_read_dom',
      description:
        'Read the text of the page the person is looking at right now — or of one part '
        + 'of it. Use this before answering anything about "this page", "this form" or '
        + '"what I am looking at"; you cannot see the screen otherwise.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'Optional CSS selector to read just one region, e.g. "main".',
          },
        },
      },
    },
  },
  {
    anonSafe: true,
    definition: {
      name: 'page_read_selection',
      description:
        'Read exactly what the person has HIGHLIGHTED on the page. Use it when they say '
        + '"this", "the selected text", or "what I just highlighted".',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    anonSafe: true,
    definition: {
      name: 'page_fill_form',
      description:
        'Type a value into one field on the page for the person. Names the field by CSS '
        + 'selector. It fires the events the page listens for, so a React form sees it.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector for the input or textarea.' },
          value: { type: 'string', description: 'What to put in it.' },
        },
        required: ['selector', 'value'],
      },
    },
  },
  {
    anonSafe: true,
    definition: {
      name: 'page_clipboard_read',
      description:
        'Read what the person has copied, when they ask you to work on "what I just '
        + 'copied". The browser will ask THEM for permission, and may refuse if they did '
        + 'not just click something — say so plainly if it does.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    anonSafe: true,
    definition: {
      name: 'page_storage_get',
      description:
        'Read one of this site\'s own saved settings by name, e.g. a preference the '
        + 'person set earlier. Credentials are refused; do not try to read tokens.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The setting name to read.' },
        },
        required: ['key'],
      },
    },
  },
  {
    // SIGNED-IN ONLY from here down. Both write OUTWARD from the page — one puts a file
    // on the person's disk, the other overwrites a clipboard they may be mid-way through
    // using. Neither is dangerous to a member who asked for it, and neither belongs in
    // the hands of an agent driving an anonymous visitor's browser on a page that could
    // have told it what to do.
    anonSafe: false,
    definition: {
      name: 'page_download',
      description:
        'Save text you produced to the person\'s computer as a file. Use it when they '
        + 'ask for something "as a file" or "to download".',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'The file name, e.g. "notes.md".' },
          content: { type: 'string', description: 'The text to save.' },
        },
        required: ['filename', 'content'],
      },
    },
  },
  {
    anonSafe: false,
    definition: {
      name: 'page_clipboard_write',
      description:
        'Put text on the person\'s clipboard so they can paste it somewhere else. Only '
        + 'when they asked you to copy something.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to copy.' },
        },
        required: ['text'],
      },
    },
  },
] as const;

/** Every page tool name, in definition order. */
export const PAGE_TOOL_NAMES: readonly string[] =
  PAGE_TOOL_SPECS.map((s) => s.definition.name);

/** The names a visitor with no account may use. */
export const ANON_SAFE_PAGE_TOOL_NAMES: readonly string[] =
  PAGE_TOOL_SPECS.filter((s) => s.anonSafe).map((s) => s.definition.name);

/* ────────────────────────────────────────────────────────────────────────────
 * The registry mirror.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The sentence a page tool returns when no host page wired it.
 *
 * Exported so the tests can assert the EXACT string: "it silently returned nothing" is
 * the failure mode this whole family exists to prevent, and a test that matches on a
 * substring would keep passing through a rewrite into exactly that.
 */
export const NO_BRIDGE_MESSAGE =
  'This page did not offer that tool — I cannot see or touch the page from here. '
  + 'Say so plainly rather than guessing what is on screen.';

export function createPageTools(): Record<string, RegisteredTool> {
  const out: Record<string, RegisteredTool> = {};
  for (const spec of PAGE_TOOL_SPECS) {
    const name = spec.definition.name;
    out[name] = {
      anonSafe: spec.anonSafe,
      definition: spec.definition,
      execute: async (args: Record<string, any>) => {
        const impl = bridge?.[name];
        if (!impl) return NO_BRIDGE_MESSAGE;
        try {
          return await impl(args);
        } catch (e) {
          return `The page refused that (${(e as Error).message}).`;
        }
      },
    };
  }
  return out;
}
