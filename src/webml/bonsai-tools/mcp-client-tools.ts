// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * A PAGE-SIDE MCP CLIENT — the browser agent reaches the platform's ~1500 tools.
 *
 * Measured 2026-09-13: no page in this repo speaks MCP to anything. The gateway mounts a
 * `StreamableHTTPSessionManager` at `POST https://mcp.aitherium.com/mcp`
 * (`mcp_gateway.py:4157`) behind `CORSMiddleware(allow_origins=CORS_ORIGINS)` (`:4241`),
 * `https://aitherium.com` is in that list (`lib/core/AitherCORS.py:72`) — and the only
 * clients were server-side. This closes that: `initialize` → `tools/list` → one
 * `RegisteredTool` per tool whose `execute` is a `tools/call`.
 *
 * 🚩 IT REFUSES WITHOUT A BEARER, AND THAT IS NOT A CONVENIENCE CHECK. The gateway
 * authorises on the caller's identity; an anonymous page that reached it would either be
 * refused upstream (a wasted turn and a confusing tool list) or, worse, be admitted on
 * some ambient credential and act as somebody. `loadMcpTools` returns a REFUSAL, not an
 * empty list, when there is no bearer — "no tools" and "you are not signed in" are
 * different facts and only one of them is fixable by the person reading it.
 *
 * 🚩 THE BEARER IS NEVER LOGGED, NEVER PUT IN A URL, AND NEVER RETURNED. It goes into
 * one `Authorization` header on one host. Error text from this module quotes the STATUS
 * and the server's detail, never the request headers.
 *
 * WHY STREAMABLE HTTP AND NOT SSE. The transport's POST arm answers a single JSON-RPC
 * message with either `application/json` or one `text/event-stream` frame; both are
 * handled below. The GET arm (a long-lived server→client stream) is deliberately not
 * opened: nothing here consumes server-initiated notifications, and holding an open
 * stream per page is a cost with no reader.
 */

import type { RegisteredTool } from './registry';

/** The one door. A constant so the marker survives minification and so no caller can
 *  point this client at a host of its own choosing. */
export const MCP_ENDPOINT = 'https://mcp.aitherium.com/mcp';

/**
 * The live marker for this capability, and a string that is REACHED rather than
 * merely exported.
 *
 * `check_browser_agent_live.py` proves a capability by finding a string literal in the
 * SERVED bundle. A `export const X = '...'` with no consumer is exactly what a bundler
 * tree-shakes, so a marker that is only exported can vanish from the build while the
 * feature ships -- the check would then report the feature missing, correctly and
 * uselessly. It is spelled into the refusal below so the literal rides a code path.
 */
export const MCP_TOOLS_LIST_METHOD = 'mcp_tools_list';

const PROTOCOL_VERSION = '2025-06-18';
const LIST_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 120_000;

/** Never advertise more than this many remote tools. The gateway exposes ~1500; the tool
 *  budget would drop all but a handful anyway, and building 1500 closures per page load
 *  is a cost paid before the budget gets a say. */
const MAX_REMOTE_TOOLS = 64;

export interface McpToolsResult {
  tools: Record<string, RegisteredTool>;
  /** Present when nothing could be loaded. Always says WHICH failure it was. */
  error?: string;
  /** The session id the gateway minted, if any. Diagnostics only. */
  sessionId?: string;
}

interface JsonRpcEnvelope {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * One JSON-RPC round trip over streamable HTTP.
 *
 * Accepts BOTH content types the transport may answer with. A client that only parsed
 * `application/json` would work against one gateway build and silently return nothing
 * against the next, which is indistinguishable from "the platform has no tools".
 */
async function rpc(
  body: JsonRpcEnvelope,
  bearer: string,
  sessionId: string | undefined,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<{ result?: any; error?: string; sessionId?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: bearer.startsWith('Bearer ') ? bearer : `Bearer ${bearer}`,
    'MCP-Protocol-Version': PROTOCOL_VERSION,
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  let res: Response;
  try {
    res = await fetchImpl(MCP_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { error: `the tool gateway could not be reached (${(e as Error).message})` };
  }

  const minted = res.headers.get('mcp-session-id') ?? undefined;
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    if (res.status === 401 || res.status === 403) {
      return { error: `the tool gateway refused this session (${res.status})`, sessionId: minted };
    }
    return { error: `the tool gateway answered ${res.status}: ${detail}`, sessionId: minted };
  }

  const raw = await res.text();
  const type = res.headers.get('content-type') ?? '';
  let payload: any = null;
  if (type.includes('text/event-stream')) {
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const chunk = trimmed.slice(5).trim();
      if (!chunk || chunk === '[DONE]') continue;
      try {
        payload = JSON.parse(chunk);
      } catch {
        /* a malformed frame is not the last word; the next one usually parses */
      }
    }
  } else {
    try {
      payload = JSON.parse(raw);
    } catch {
      return { error: 'the tool gateway returned something that is not JSON', sessionId: minted };
    }
  }

  if (!payload) return { error: 'the tool gateway returned an empty response', sessionId: minted };
  if (payload.error) {
    const msg = String(payload.error?.message ?? 'unspecified error');
    return { error: `the tool gateway reported: ${msg}`, sessionId: minted };
  }
  return { result: payload.result, sessionId: minted };
}

/** Flatten an MCP `tools/call` result into the one string a tool executor returns. */
function renderCallResult(result: any): string {
  const content = result?.content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (item && typeof item === 'object' && typeof item.text === 'string') parts.push(item.text);
      else if (typeof item === 'string') parts.push(item);
    }
    if (parts.length) {
      const joined = parts.join('\n');
      return result?.isError ? `The tool reported a failure: ${joined}` : joined;
    }
  }
  if (result === undefined || result === null) return 'The tool returned nothing.';
  try {
    return JSON.stringify(result).slice(0, 4000);
  } catch {
    return 'The tool returned something unreadable.';
  }
}

/** The refusal handed back when there is no bearer. Exported so the test pins the exact
 *  sentence rather than "some error happened". */
export const NO_BEARER_REFUSAL =
  'The platform tool gateway needs you to be signed in. No tools were loaded, and '
  + 'nothing was sent to it.';

export interface LoadMcpToolsOptions {
  fetchImpl?: typeof fetch;
  /** Prefix for the registry keys. Keeps a remote `search` from shadowing a local one. */
  prefix?: string;
  maxTools?: number;
}

/**
 * Initialize, list, and wrap. One network round trip per step, both on the same session.
 *
 * Returns `{tools:{}, error}` on every failure path — the caller appends nothing and
 * says why. It never throws: a tool catalogue that could not load must not take a turn
 * down with it.
 */
export async function loadMcpTools(
  bearer: string | null | undefined,
  opts: LoadMcpToolsOptions = {},
): Promise<McpToolsResult> {
  if (!bearer) return { tools: {}, error: NO_BEARER_REFUSAL };
  const f = opts.fetchImpl ?? fetch;
  const prefix = opts.prefix ?? 'mcp_';

  const init = await rpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'aither-browser-agent', version: '1.0.0' },
    },
  }, bearer, undefined, LIST_TIMEOUT_MS, f);
  if (init.error) return { tools: {}, error: init.error };

  const session = init.sessionId;
  const listed = await rpc(
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    bearer, session, LIST_TIMEOUT_MS, f,
  );
  if (listed.error) {
    // NAME THE ONE FAILURE THAT LOOKS LIKE A SERVER BUG AND IS A CORS SETTING.
    // Measured against the live gateway 2026-09-14: `initialize` answers 200 and mints a
    // session; `tools/list` WITH that session answers 200; `tools/list` WITHOUT it answers
    // `400 Bad Request: Missing session ID` (the transport runs `stateless=False`). A
    // browser can only read `Mcp-Session-Id` if the server EXPOSES it, and on that day it
    // did not -- so the page got a session it could not see and a 400 it could not
    // explain, while curl from the same host worked perfectly. Saying which knob it is
    // costs one branch and saves the next reader the afternoon it cost this one.
    const unreadableSession = !session && listed.error.includes('400');
    return {
      tools: {},
      error: unreadableSession
        ? 'the tool gateway minted a session this page cannot read -- it is not exposing '
          + 'Mcp-Session-Id to this origin (Access-Control-Expose-Headers), so every call '
          + 'after initialize is refused as sessionless'
        : listed.error,
      sessionId: session,
    };
  }

  const remote = Array.isArray(listed.result?.tools) ? listed.result.tools : [];
  if (!remote.length) {
    return {
      tools: {},
      error: `the tool gateway answered ${MCP_TOOLS_LIST_METHOD} with no tools`,
      sessionId: session,
    };
  }

  const tools: Record<string, RegisteredTool> = {};
  for (const t of remote.slice(0, opts.maxTools ?? MAX_REMOTE_TOOLS)) {
    const name = typeof t?.name === 'string' ? t.name : '';
    if (!name) continue;
    const localName = `${prefix}${name}`;
    const schema = (t?.inputSchema && typeof t.inputSchema === 'object')
      ? t.inputSchema as Record<string, any>
      : { type: 'object', properties: {} };
    tools[localName] = {
      // 🚩 NEVER anon-safe. The bearer is the whole authorisation story on this door.
      anonSafe: false,
      definition: {
        name: localName,
        description: String(t?.description ?? `Platform tool "${name}".`).slice(0, 400),
        parameters: {
          type: 'object',
          properties: (schema.properties as Record<string, any>) ?? {},
          required: Array.isArray(schema.required) ? schema.required : undefined,
        },
      },
      execute: async (args: Record<string, any>) => {
        const called = await rpc(
          { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args ?? {} } },
          bearer, session, CALL_TIMEOUT_MS, f,
        );
        if (called.error) return `I could not run ${name}: ${called.error}`;
        return renderCallResult(called.result);
      },
    };
  }

  if (!Object.keys(tools).length) {
    return { tools: {}, error: 'the tool gateway listed nothing with a usable name', sessionId: session };
  }
  return { tools, sessionId: session };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Per-session cache. One load per page, not one per turn.
 * ──────────────────────────────────────────────────────────────────────────── */

let cached: Promise<McpToolsResult> | null = null;

/** Load once per page. A failure is cached too — a gateway that refused this session
 *  will refuse the next turn as well, and retrying it on every turn spends the visitor's
 *  latency to learn the same thing. `clearMcpToolCache()` is the way back. */
export function loadMcpToolsCached(
  bearer: string | null | undefined,
  opts: LoadMcpToolsOptions = {},
): Promise<McpToolsResult> {
  if (!bearer) return Promise.resolve({ tools: {}, error: NO_BEARER_REFUSAL });
  if (!cached) cached = loadMcpTools(bearer, opts);
  return cached;
}

export function clearMcpToolCache(): void {
  cached = null;
}
