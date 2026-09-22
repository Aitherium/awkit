// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * BROWSE_* — the agent drives the remote browser session the visitor is ALREADY
 * entitled to.
 *
 * WHY THESE ARE ANON-SAFE AND WHY THAT IS NOT A NEW PERMISSION. `browser` is in
 * `ANON_ALLOWED_APP_IDS`, so the Living Desktop already OFFERS a guest the Browser app,
 * and `resolveCaller` (`@/lib/guest-identity`) already admits a guest whose anon token
 * and boot session join to one proven subject. A guest could drive that session with
 * their fingers and not with the agent sitting beside them. These three tools close
 * exactly that gap and widen nothing else: same route, same caller resolution, same
 * ceiling (`GUEST_LIMITS`: 5 opens/hour, 1 concurrent, 600 s TTL).
 *
 * 🚩 THE TOOL MINTS NO IDENTITY OF ITS OWN (GDL001 shape). It forwards the visitor's
 * OWN anon token and gate session — the two headers `verifyGuest()` re-proves against
 * Genesis on every call — and never `X-User-ID`, `X-Tenant-ID`, `X-Caller-Type` or an
 * `Authorization` it invented. A member's credential rides the same-origin cookie, which
 * the browser attaches and this code never reads. A tool that could name its own caller
 * would let a model's hallucinated argument become an ownership claim.
 *
 * 🚩 EVERY CALL GOES TO `/api/browser-session/*` AND NOTHING ELSE. `BROWSER_URL` — the
 * AitherBrowser service itself — is reachable only from a Next route handler, where the
 * caller has been resolved and the per-caller ceiling applied. Dialling it from here
 * would be a browser-side call to an internal service with no limiter and no ownership
 * scope in front of it. Asserted by `check_guest_demo_lane.py` GDL009.
 *
 * MEASURED CONSTRAINT, 2026-09-13: `/api/browser-session` sets no CORS headers (unlike
 * `/api/sprite/*`, which does at `[[...path]]/route.ts:37`). So these tools work on the
 * APP origin — api.aitherium.com, where the Living Desktop and its Browser app live —
 * and a cross-origin call from the static apex is refused by the browser before it
 * leaves. The failure is reported as itself rather than as "the browser is down".
 */

import type { RegisteredTool } from './registry';

/** The slice of `ToolContext` these tools read. Passed as a getter so this module has
 *  no import-time dependency on `registry.ts` (which imports THIS module). */
export interface BrowserToolContext {
  /** Origin to prefix on `/api/...`. '' means same-origin. */
  apiBase?: string;
  /** The visitor's own anon token, supplied by the main thread. */
  anonToken?: string;
  /** The awiam gate session proving a human check was taken. */
  gateSession?: string;
}

/** Header names this module is allowed to set. Anything identity-bearing that is not
 *  the visitor's OWN proof is absent by construction, not by review. */
const ANON_TOKEN_HEADER = 'X-Anon-Token';
const GATE_SESSION_HEADER = 'X-Gate-Session';

function credentialHeaders(ctx: BrowserToolContext): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ctx.anonToken) h[ANON_TOKEN_HEADER] = ctx.anonToken;
  if (ctx.gateSession) h[GATE_SESSION_HEADER] = ctx.gateSession;
  return h;
}

/** The ONE path prefix these tools may dial. */
function sessionUrl(ctx: BrowserToolContext, suffix = ''): string {
  const base = ctx.apiBase ?? '';
  return `${base}/api/browser-session${suffix}`;
}

/**
 * The session this agent opened, if any.
 *
 * Module state rather than a tool argument on purpose: a small model that had to carry
 * a 32-character session id between turns would drop it, and the recovery ("which
 * session did you mean?") is a turn the visitor pays for. One agent, one session — which
 * is also the guest ceiling (`GUEST_LIMITS.concurrent === 1`), so there is nothing to
 * disambiguate.
 */
let currentSession: string | null = null;

/** For tests and for a host that tears the agent down between visitors. */
export function resetBrowserSession(): void {
  currentSession = null;
}

/** For tests: what the module thinks it is holding. */
export function currentBrowserSession(): string | null {
  return currentSession;
}

const OPEN_TIMEOUT_MS = 60_000;
const ACT_TIMEOUT_MS = 45_000;
const READ_TIMEOUT_MS = 20_000;

type Json = Record<string, unknown>;

async function readJson(res: Response): Promise<Json> {
  try {
    return (await res.json()) as Json;
  } catch {
    return {};
  }
}

/** A refusal, rendered so the model repeats the REASON rather than inventing one. */
function refusal(status: number, body: Json): string {
  const detail = typeof body.detail === 'string' && body.detail
    ? body.detail
    : `the browser service answered ${status} with no explanation`;
  if (status === 401 || status === 403) {
    return `The browser session was refused (${status}): ${detail} `
      + 'Tell the person this needs the human check on this page first; do not retry.';
  }
  if (status === 429) {
    return `The browser session was rate limited: ${detail} `
      + 'Say so plainly and do not retry this turn.';
  }
  return `The browser session failed (${status}): ${detail}`;
}

/** One line describing what the page now is. Never the screenshot: it is a base64 JPEG
 *  and a text model can only waste its context on it. */
function describeView(body: Json, lead: string): string {
  const url = String(body.url ?? '');
  const title = String(body.title ?? '');
  return [
    lead,
    title ? `Title: ${title}` : 'Title: (none yet)',
    url ? `URL: ${url}` : 'URL: (none yet)',
    'The person can see the page; do not describe pixels you cannot read. Use '
    + 'browse_read after an action to see where you ended up.',
  ].join('\n');
}

export const BROWSE_ACTIONS = [
  'goto', 'click_xy', 'fill', 'press', 'scroll', 'back', 'forward', 'reload',
] as const;

export function createBrowserSessionTools(
  getCtx: () => BrowserToolContext,
  fetchImpl?: typeof fetch,
): Record<string, RegisteredTool> {
  const f = (...args: Parameters<typeof fetch>) => (fetchImpl ?? fetch)(...args);

  async function open(args: Record<string, any>): Promise<string> {
    const ctx = getCtx();
    const url = String(args.url ?? args.address ?? '').trim();
    if (!url) return 'Error: which page? Pass url=<https://...>.';

    let res: Response;
    try {
      res = await f(sessionUrl(ctx), {
        method: 'POST',
        headers: credentialHeaders(ctx),
        credentials: 'same-origin',
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(OPEN_TIMEOUT_MS),
      });
    } catch (e) {
      return `I could not reach the browser service: ${(e as Error).message}. `
        + 'Say you could not open the page rather than describing one.';
    }
    const body = await readJson(res);

    // 🚨 A NON-2xx MAY STILL CARRY A LIVE `sessionId`. The route returns one when the
    // open SUCCEEDED and only the first observe failed; a client that drops it leaks a
    // real browser process for the whole TTL and spends one of the visitor's five opens.
    // Hold it before deciding the call failed.
    const sid = typeof body.sessionId === 'string' ? body.sessionId : '';
    if (sid) currentSession = sid;

    if (!res.ok) return refusal(res.status, body);
    if (!sid) return 'The browser service opened no session — nothing to drive.';
    return describeView(body, `Opened a browser session on ${url}.`);
  }

  async function act(args: Record<string, any>): Promise<string> {
    const ctx = getCtx();
    if (!currentSession) {
      return 'Error: no browser session is open. Call browse_open with a url first.';
    }
    const action = String(args.action ?? '').trim();
    if (!(BROWSE_ACTIONS as readonly string[]).includes(action)) {
      return `Error: action must be one of ${BROWSE_ACTIONS.join(', ')}. `
        + 'There is no way to run arbitrary script in the page from here.';
    }
    const payload: Record<string, unknown> = { action };
    for (const k of ['selector', 'value', 'url', 'x', 'y', 'key'] as const) {
      if (args[k] !== undefined) payload[k] = args[k];
    }

    let res: Response;
    try {
      res = await f(sessionUrl(ctx, `/${encodeURIComponent(currentSession)}/act`), {
        method: 'POST',
        headers: credentialHeaders(ctx),
        credentials: 'same-origin',
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(ACT_TIMEOUT_MS),
      });
    } catch (e) {
      return `I could not reach the browser service: ${(e as Error).message}.`;
    }
    const body = await readJson(res);
    if (!res.ok) {
      // 404 here means reaped, expired, or never ours. Forget it so the next
      // browse_open starts clean instead of acting on a dead id forever.
      if (res.status === 404) currentSession = null;
      return refusal(res.status, body);
    }
    return describeView(body, `Did ${action} in the browser session.`);
  }

  async function read(_args: Record<string, any>): Promise<string> {
    const ctx = getCtx();
    if (!currentSession) {
      return 'Error: no browser session is open. Call browse_open with a url first.';
    }
    let res: Response;
    try {
      res = await f(sessionUrl(ctx, `/${encodeURIComponent(currentSession)}`), {
        method: 'GET',
        headers: credentialHeaders(ctx),
        credentials: 'same-origin',
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
    } catch (e) {
      return `I could not reach the browser service: ${(e as Error).message}.`;
    }
    const body = await readJson(res);
    if (!res.ok) {
      if (res.status === 404) currentSession = null;
      return refusal(res.status, body);
    }
    return describeView(body, 'The browser session is showing:');
  }

  return {
    browse_open: {
      anonSafe: true,
      definition: {
        name: 'browse_open',
        description:
          'Open a real web page in a remote browser the person can watch. Use it when '
          + 'they ask you to visit, check or open a site — this actually loads the page, '
          + 'unlike web_search which only reads an index. Works without an account.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The page to open, e.g. "https://example.com".' },
          },
          required: ['url'],
        },
      },
      execute: open,
    },
    browse_act: {
      anonSafe: true,
      definition: {
        name: 'browse_act',
        description:
          'Do one thing in the browser session you opened: click, type into a field, '
          + 'press a key, scroll, go back or forward, or reload. Call browse_read '
          + 'afterwards to see where you ended up.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              description: `One of: ${BROWSE_ACTIONS.join(', ')}.`,
            },
            selector: { type: 'string', description: 'CSS selector for fill/press.' },
            value: { type: 'string', description: 'Text to type, or the key to press.' },
            url: { type: 'string', description: 'Where to go, for action="goto".' },
            x: { type: 'number', description: 'X coordinate for click_xy.' },
            y: { type: 'number', description: 'Y coordinate for click_xy.' },
          },
          required: ['action'],
        },
      },
      execute: act,
    },
    browse_read: {
      anonSafe: true,
      definition: {
        name: 'browse_read',
        description:
          'Report the page the browser session is currently showing — its title and '
          + 'URL. Use it after browse_act, and before saying anything about what is on '
          + 'screen.',
        parameters: { type: 'object', properties: {} },
      },
      execute: read,
    },
  };
}
