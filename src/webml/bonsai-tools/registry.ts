// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * Bonsai tool registry — native tools available to the in-browser model.
 *
 * Most run entirely offline. `search_knowledge` is the exception: it reads the
 * visitor's own sprite knowledge over the network, using the anon token the main
 * thread supplies. It is written to fail LOUD — every error path names itself,
 * because an empty string here is indistinguishable from 'nothing matched'.
 */

import { pushImage } from './image-sink';
import { LOCAL_PIM_TOOLS } from './local-pim-tools';

import type { ToolFunction } from '../bonsai/tokenizer/chat_template';

export type ToolExecutor = (args: Record<string, any>) => Promise<string>;

export interface RegisteredTool {
  definition: ToolFunction;
  execute: ToolExecutor;
}

/** Get the current date and time in the user's timezone. */
async function executeGetCurrentTime(args: Record<string, any>): Promise<string> {
  try {
    const now = new Date();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const timeStr = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
    return `Current date and time: ${dateStr} ${timeStr} (${timezone})`;
  } catch (e) {
    return `Error getting time: ${(e as Error).message}`;
  }
}

/** Evaluate a mathematical expression safely. */
async function executeEvaluateMath(args: Record<string, any>): Promise<string> {
  try {
    const expression = String(args.expression || '');
    if (!expression) {
      return 'Error: expression is required';
    }
    // Simple validation: allow only safe math operators
    if (!/^[\d\+\-\*\/\(\)\.\s]+$/.test(expression)) {
      return 'Error: expression contains unsafe characters';
    }
     
    const result = Function('"use strict"; return (' + expression + ')')();
    return `Result: ${result}`;
  } catch (e) {
    return `Error evaluating expression: ${(e as Error).message}`;
  }
}

/**
 * Page facts the WORKER cannot observe for itself, supplied by the main thread.
 *
 * These tools execute inside a real Web Worker in production
 * (`/workers/webgpu-brain-bonsai-worker.js`), where there is no `window` and no
 * `document`, and `self.location` is the WORKER SCRIPT's URL, not the page's. So
 * `typeof window !== 'undefined' ? … : 'N/A'` resolved to 'N/A' for every real visitor —
 * the tool ran, returned 200 characters of nothing, and looked like it worked.
 *
 * It read correctly in the selftest harness for the worst possible reason: that harness
 * drives the worker core on the MAIN thread with a faked scope, so `window` exists there
 * and only there. A tool verified only in the harness is not verified.
 */
export interface OpenableApp {
  id: string;
  title: string;
  tagline: string;
}

export interface ToolContext {
  pageUrl?: string;
  pageTitle?: string;
  /**
   * Base URL of a LOCALLY RUNNING AitherBonsaiImage service (http://127.0.0.1:8798),
   * supplied by the main thread when its probe found one healthy. When set,
   * generate_image renders on the visitor's own GPU — no sign-in, no fleet meter,
   * no rate limit — and only falls to the hosted tier if the local call fails.
   */
  localImageBase?: string;
  /**
   * Windows this surface will actually open, supplied by the main thread.
   *
   * The list is the WHITELIST, not a hint: `open_app` refuses anything not in it. A model
   * inventing `open_app("admin")` must not be able to reach a window the host never
   * offered, and the host is the only side that knows what it can render.
   */
  apps?: OpenableApp[];
  /**
   * The visitor's anon token (`X-Anon-Token`) and the API origin, both supplied by the
   * main thread — a Worker has neither the IndexedDB principal cache nor liveApiBase().
   *
   * MEASURED 2026-07-30 from a real aitherium.com page: the anon handshake returns
   * {anon_id, token, expires_at} and that token AUTHENTICATES against /api/sprite/*
   * (hatch created a sprite; /api/sprite/me returned 200 with real state). The same token
   * is REJECTED 401 "provide a valid token" by /api/search, /api/browse/capture and
   * /api/knowledge/search — so sprite is the one knowledge surface anon can actually read.
   */
  anonToken?: string;
  apiBase?: string;
}

let toolContext: ToolContext = {};

/**
 * Windows the model asked for this turn, drained by the worker and posted to the main
 * thread. Tools run INSIDE a Worker — there is no window manager here to call, so the
 * request has to travel back as a message.
 */
let pendingActions: Array<{ kind: 'open'; app: string }> = [];

/** Called by the worker on each turn with what the main thread knows. */
export function setToolContext(ctx: ToolContext): void {
  toolContext = ctx || {};
  pendingActions = [];
}

/** Take the UI actions requested this turn; clears them so a turn cannot replay. */
export function drainToolActions(): Array<{ kind: 'open'; app: string }> {
  const out = pendingActions;
  pendingActions = [];
  return out;
}

/** Get context about the current page/environment. */
async function executeGetPageContext(args: Record<string, any>): Promise<string> {
  try {
    const info: string[] = [];

    // Prefer what the main thread told us; fall back to worker globals, which are real
    // (a Worker has `location` and `navigator`) but describe the WORKER, not the page.
    const url =
      toolContext.pageUrl
      ?? (typeof window !== 'undefined' ? window.location.href : undefined);
    const title =
      toolContext.pageTitle
      ?? (typeof window !== 'undefined' ? window.document.title : undefined);

    // Say "unknown here" rather than "N/A". A model reading N/A states it as fact; this
    // phrasing tells it the value was not observable, which is the truth.
    info.push(`URL: ${url ?? 'unknown from this context'}`);
    info.push(`Title: ${title ?? 'unknown from this context'}`);
    if (typeof navigator !== 'undefined') {
      info.push(`User Agent: ${navigator.userAgent}`);
      info.push(`Online: ${navigator.onLine ? 'yes' : 'no'}`);
    }
    return info.join('\n');
  } catch (e) {
    return `Error getting page context: ${(e as Error).message}`;
  }
}

/** List the windows this surface can open, so the model chooses from reality. */
async function executeListApps(args: Record<string, any>): Promise<string> {
  const apps = toolContext.apps ?? [];
  if (!apps.length) {
    // Explicit, not empty. "No apps" and "this surface does not expose apps" are different
    // facts, and a model handed an empty list will happily invent one.
    return 'No windows are available to open from this surface.';
  }
  return [
    'Windows you can open with open_app (use the id):',
    ...apps.map((a) => `- ${a.id} — ${a.title}: ${a.tagline}`),
  ].join('\n');
}

/** Open one of this surface's windows. */
async function executeOpenApp(args: Record<string, any>): Promise<string> {
  const raw = String(args.app ?? args.name ?? args.id ?? '').trim().toLowerCase();
  if (!raw) return 'Error: which window? Pass app=<id>. Call list_apps to see the ids.';

  const apps = toolContext.apps ?? [];
  if (!apps.length) return 'No windows are available to open from this surface.';

  // Exact id first, then a forgiving prefix/title match — small models write "the sprite
  // tool" and "Sprite" as readily as "sprite". Anything that still misses is REFUSED with
  // the real list rather than silently doing nothing, which reads as a broken agent.
  const hit =
    apps.find((a) => a.id.toLowerCase() === raw)
    ?? apps.find((a) => raw.startsWith(a.id.toLowerCase()) || a.id.toLowerCase().startsWith(raw))
    ?? apps.find((a) => a.title.toLowerCase() === raw);

  if (!hit) {
    return `There is no window called "${raw}". Available: ${apps.map((a) => a.id).join(', ')}.`;
  }

  pendingActions.push({ kind: 'open', app: hit.id });
  return `Opened the ${hit.title} window (${hit.tagline}).`;
}

/** Read what the visitor has taught their sprite — the knowledge base they are growing. */
async function executeSearchKnowledge(args: Record<string, any>): Promise<string> {
  const q = String(args.query ?? args.q ?? "").trim().toLowerCase();
  const base = toolContext.apiBase;
  const token = toolContext.anonToken;

  // Every failure below names ITSELF. An empty string here is indistinguishable from
  // "nothing matched", which is how a dead integration passes for a working one.
  if (!base) return "Knowledge is unavailable: no API origin was provided to this session.";
  if (!token) {
    return "Knowledge is unavailable: no anon identity yet — the visitor has not been "
      + "registered with the platform in this browser.";
  }

  let res: Response;
  try {
    res = await fetch(`${base}/api/sprite/me/knowledge`, {
      headers: { "X-Anon-Token": token, "Content-Type": "application/json" },
    });
  } catch (e) {
    return `Knowledge is unavailable: could not reach ${base} (${(e as Error).message}).`;
  }

  if (res.status === 404) {
    return "No sprite has been hatched in this browser yet, so there is no knowledge base "
      + "to read. Open the Sprite window to hatch one.";
  }
  if (!res.ok) {
    return `Knowledge is unavailable: the server answered ${res.status}.`;
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    // A 200 carrying non-JSON is the 200-with-fallback-body outage class.
    return "Knowledge is unavailable: the server returned a 200 that was not JSON.";
  }

  const entries: any[] = Array.isArray(data) ? data : (data?.entries ?? data?.knowledge ?? []);
  if (!entries.length) {
    return "The sprite's knowledge base is empty — nothing has been taught to it yet.";
  }

  const text = (e: any) =>
    String(e?.fact ?? e?.content ?? e?.text ?? e?.summary ?? JSON.stringify(e));
  const hits = q ? entries.filter((e) => text(e).toLowerCase().includes(q)) : entries;

  if (!hits.length) {
    // "Nothing matched YOUR QUERY" and "there is nothing at all" are different facts, and
    // a model told the wrong one will state it as truth.
    return `The knowledge base has ${entries.length} entr${entries.length === 1 ? "y" : "ies"}, `
      + `but none mention "${q}".`;
  }
  return hits.slice(0, 8).map((e, i) => `${i + 1}. ${text(e).slice(0, 300)}`).join("\n");
}

/**
 * Search the web via AitherSearch.
 *
 * ANONYMOUS VISITORS GET REAL WEB SEARCH. The demo has to show what the agent actually
 * does without a sign-up wall, so `/api/search/query` is in PUBLIC_PATHS and the handler
 * meters anon at 20 searches/hour PER CLIENT (anon token, else forwarded IP) against
 * 200/hr signed in. It returns PUBLIC internet results only — no tenant data, no account
 * state, no filesystem — so anonymous use exposes nothing.
 *
 * NOTE FOR ANYONE "FIXING" SEARCH: `/api/search` (no /query) is ripgrep over the SERVER
 * FILESYSTEM. Its 401 is load-bearing. Do not relax it. Asserted by
 * check_filesystem_search_stays_locked.
 *
 * Every failure still names ITSELF. An empty string here would be a lie that reads as
 * "I looked and found nothing".
 */
async function executeWebSearch(args: Record<string, any>): Promise<string> {
  const query = String(args.query ?? args.q ?? "").trim();
  const base = toolContext.apiBase;

  if (!query) return "Error: what should I search for? Pass query=<text>.";
  if (query.length > 512) {
    // Mirrors the server cap (D-706, prompt injection) so the model gets a real reason
    // instead of a 400 it cannot interpret.
    return "Error: that search is too long (max 512 characters).";
  }
  if (!base) return "Web search is unavailable: no API origin was provided to this session.";

  let res: Response;
  try {
    res = await fetch(`${base}/api/search/query`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
  } catch (e) {
    return `Web search is unavailable: could not reach ${base} (${(e as Error).message}).`;
  }

  if (res.status === 401 || res.status === 403) {
    // Anonymous search is public by design, so this is an ANOMALY, not the normal path —
    // say that rather than telling the visitor to sign in for something that should have
    // just worked.
    return "Web search was refused by the server (it should be open to everyone). "
      + "This looks like a misconfiguration rather than something you did.";
  }
  if (res.status === 429) {
    return "Web search hit its hourly limit for this browser. Signing in raises the "
      + "allowance; otherwise it resets within the hour.";
  }
  if (!res.ok) return `Web search is unavailable: the server answered ${res.status}.`;

  let data: any;
  try {
    data = await res.json();
  } catch {
    return "Web search is unavailable: the server returned a 200 that was not JSON.";
  }

  const results: any[] = data?.results ?? [];
  if (!results.length) {
    // "The search ran and matched nothing" is a DIFFERENT fact from "search is broken".
    return `The web search for "${query}" returned no results.`;
  }
  return results
    .slice(0, 5)
    .map((r, i) => {
      const title = String(r?.title ?? r?.name ?? "untitled");
      const snippet = String(r?.snippet ?? r?.description ?? r?.content ?? "").slice(0, 220);
      const url = String(r?.url ?? r?.link ?? "");
      const head = `${i + 1}. ${title}` + (url ? ` — ${url}` : "");
      return snippet ? head + "\n   " + snippet : head;
    })
    .join("\n");
}

/* ════════════════════════════════════════════════════════════════════════════
   THE AITHERIUM CORPUS — grounded, citable answers about our own work.

   Asked "what is AitherOS" or "how does AitherGraph work", a 1.7B model answers
   from weights: fluent, confident, and with no way for the visitor to check it.
   That is the worst failure mode this surface has, because it is invisible —
   a hallucinated answer about our own product looks exactly like a good one.

   So the agent gets a retrieval corpus of everything we have PUBLISHED (203
   posts, 3,456 passages, built by scripts/build-corpus-index.mjs) and is told
   to answer only from it, citing the URL of each passage it used.

   WHY A STATIC INDEX AND NOT A LIVE RAG CALL — all three measured 2026-07-31:
     - AitherGraph's knowledge ingest answered 504 (SSL handshake timeout) and
       held zero bases, so there was nothing to query.
     - A query against it took 39 SECONDS and returned "[no-context]".
     - The anon token this surface mints is 401'd by /api/knowledge/search and
       /api/search, so an anonymous visitor cannot read a live knowledge API.
   The index ships with the page instead. Same origin, no auth, cannot 401,
   cannot be down while the page is up, and versioned with the deploy.
   ════════════════════════════════════════════════════════════════════════════ */

interface CorpusDoc { s: string; t: string; d: string; u: string; x?: number }
interface CorpusPassage { d: number; h: string; x: string }
interface CorpusIndex {
  /** Present on third-party corpora (Wikipedia is CC BY-SA); absent on our own. */
  license?: string
  version: number
  generated: string
  docs: CorpusDoc[]
  passages: CorpusPassage[]
  /** Derived on first use — document frequency per term, for IDF. */
  _df?: Map<string, number>
  _avgLen?: number
  _tokens?: string[][]
}

/** Words that match everything and therefore rank nothing. */
const CORPUS_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'is', 'are',
  'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these', 'those', 'with',
  'as', 'by', 'from', 'you', 'your', 'we', 'our', 'i', 'me', 'my', 'do', 'does', 'did',
  'what', 'how', 'why', 'when', 'where', 'which', 'who', 'can', 'will', 'would', 'about',
]);

function corpusTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !CORPUS_STOPWORDS.has(w));
}

/**
 * Load the index ONCE per session and cache the promise, so N tool calls in a
 * conversation cost one download. The promise (not the value) is cached so two
 * concurrent calls share one fetch rather than racing two.
 */
let corpusPromise: Promise<CorpusIndex | { error: string }> | null = null;

/**
 * Second corpus: Wikipedia intros for the 273 topics in config/wikipedia.yaml.
 *
 * A SEPARATE cache and a separate file on purpose. Merging it into the Aitherium
 * index would let a Wikipedia sentence be quoted back as an Aitherium claim, and
 * nothing downstream could tell them apart — the same confusion `deep_research`
 * already guards against, where the open web returns confident, cited facts
 * about three unrelated projects that share our name. Kept apart, every passage
 * can be labelled truthfully at the point of use.
 */
let wikiPromise: Promise<CorpusIndex | { error: string }> | null = null;

/** Reset the memoised corpus. Tests only — a cached fetch would leak between cases. */
export function __resetCorpusCacheForTests(): void {
  corpusPromise = null;
  // Both, or a Wikipedia fixture survives into the next case and the test
  // asserts against the previous test's data — which passes for the wrong
  // reason far more often than it fails.
  wikiPromise = null;
}

/**
 * Download and prepare ONE static index — shared by both corpora so the fetch,
 * the emptiness check and the precompute cannot drift apart between them.
 */
async function fetchIndex(url: string): Promise<CorpusIndex | { error: string }> {
  {
    let res: Response;
    try {
      // RELATIVE on purpose: the index is a build artifact of whichever origin
      // is serving this page. Pointing it at the live API origin would fetch
      // the PORTAL's copy from the apex, i.e. a different deploy's corpus.
      res = await fetch(url);
    } catch (e) {
      return { error: `could not be downloaded (${(e as Error).message})` };
    }
    if (!res.ok) return { error: `could not be downloaded (the server answered ${res.status})` };

    let data: CorpusIndex;
    try {
      data = await res.json();
    } catch {
      return { error: 'downloaded but was not valid JSON' };
    }
    if (!data?.passages?.length || !data?.docs?.length) {
      // An empty corpus would make every question answer "nothing matched",
      // which reads as a working search over a topic we have written 200 posts
      // about. Name it instead.
      return { error: 'downloaded but is empty' };
    }

    // Precompute once: token lists, document frequencies and mean length.
    const tokens = data.passages.map((p) => corpusTokens(`${p.h} ${p.x}`));
    const df = new Map<string, number>();
    for (const t of tokens) {
      for (const term of new Set(t)) df.set(term, (df.get(term) ?? 0) + 1);
    }
    data._tokens = tokens;
    data._df = df;
    data._avgLen = tokens.reduce((a, t) => a + t.length, 0) / (tokens.length || 1);
    return data;
  }
}

/** The Aitherium corpus — our own published writing. */
async function loadCorpus(): Promise<CorpusIndex | { error: string }> {
  corpusPromise ??= fetchIndex('/corpus/index.json');
  return corpusPromise;
}

/** The Wikipedia reference corpus — third-party, CC BY-SA, kept separate. */
async function loadWikipedia(): Promise<CorpusIndex | { error: string }> {
  wikiPromise ??= fetchIndex('/corpus/wikipedia.json');
  return wikiPromise;
}

/**
 * Search everything Aitherium has published, and hand back passages the model
 * can quote WITH the URL that proves them.
 *
 * Ranking is BM25 over passages, plus a title boost — a query whose words are
 * in a post's title is almost always answered by that post, and BM25 alone
 * cannot see the title because it scores the passage body.
 */
/**
 * BM25 + IDF-weighted coverage over a loaded index. SHARED by every corpus.
 *
 * Extracted rather than copied when the Wikipedia corpus arrived: the coverage
 * floor below is the rule that stops a nonsense query returning five confident,
 * citable passages, and a second hand-written copy of it would drift from this
 * one silently — the bug reappearing in only one corpus, which is harder to
 * notice than it appearing in both.
 *
 * Returns ranked passage indices, or a reason nothing qualified. The CALLER
 * phrases the outcome, because "we have not written about this" and "Wikipedia
 * does not cover this" are different statements about different sources.
 */
function rankPassages(
  corpus: CorpusIndex,
  terms: string[],
): { ranked: Array<{ i: number; score: number }>; miss: 'unknown-terms' | 'no-coverage' | null } {
  const N = corpus.passages.length;
  const K1 = 1.4;
  const B = 0.75;

  const idfOf = (term: string) => {
    const df = corpus._df!.get(term) ?? 0;
    return df === 0 ? 0 : Math.log(1 + (N - df + 0.5) / (df + 0.5));
  };

  /*
   * A passage must account for at least this share of the QUESTION'S
   * INFORMATION before it counts as an answer.
   *
   * THE DEFECT THIS CLOSES, measured 2026-07-31 against the real 3,456-passage
   * corpus: "zzzqx nonexistent unrelated topic" returned FIVE confident
   * passages about Wikipedia ingestion, a proxy bug and a world model — because
   * "topic" and "unrelated" are ordinary English that occur somewhere in 200
   * posts. The model is then told to answer ONLY from those passages, so a
   * question we have never covered produces a fluent answer with real citations
   * attached to it. That is strictly WORSE than no grounding: the citations
   * make a wrong answer look checked.
   *
   * Coverage is weighted by IDF rather than counted, so matching "aithergraph"
   * (rare, carries the question) beats matching "work" (everywhere, carries
   * nothing). Terms absent from the corpus entirely are excluded from the
   * denominator — they are unmatchable, so leaving them in would punish a query
   * for one typo instead of for being off-topic.
   */
  const MIN_COVERAGE = 0.5;

  const known = terms.filter((t) => (corpus._df!.get(t) ?? 0) > 0);
  if (!known.length) return { ranked: [], miss: 'unknown-terms' };
  const knownMass = known.reduce((a, t) => a + idfOf(t), 0);

  const scored: Array<{ i: number; score: number }> = [];

  for (let i = 0; i < N; i++) {
    const toks = corpus._tokens![i];
    if (!toks.length) continue;
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);

    let score = 0;
    let matchedMass = 0;
    for (const term of known) {
      const f = tf.get(term);
      if (!f) continue;
      const idf = idfOf(term);
      matchedMass += idf;
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * toks.length) / corpus._avgLen!)));
    }
    if (!matchedMass) continue;

    const doc = corpus.docs[corpus.passages[i].d];
    const titleTokens = new Set(corpusTokens(doc?.t ?? ''));

    // The title counts toward coverage. A post titled "AitherGraph Explained"
    // answers "how does AitherGraph work" from any of its passages, including
    // the ones that say "the graph" rather than repeating the product name.
    let coveredMass = matchedMass;
    for (const term of known) {
      if (!tf.has(term) && titleTokens.has(term)) coveredMass += idfOf(term);
    }
    const coverage = knownMass > 0 ? coveredMass / knownMass : 0;
    if (coverage < MIN_COVERAGE) continue;

    const titleHits = known.filter((t) => titleTokens.has(t)).length;
    score *= 1 + 0.35 * titleHits;
    score *= coverage;

    scored.push({ i, score });
  }

  if (!scored.length) return { ranked: [], miss: 'no-coverage' };
  scored.sort((a, b) => b.score - a.score);
  return { ranked: scored, miss: null };
}

async function executeSearchAitherium(args: Record<string, any>): Promise<string> {
  const query = String(args.query ?? args.q ?? '').trim();
  if (!query) return 'Error: what should I look up? Pass query=<text>.';

  const corpus = await loadCorpus();
  if ('error' in corpus) {
    // Naming the failure keeps a broken corpus from masquerading as a topic we
    // never wrote about — the difference between "I could not look" and "there
    // is nothing", which the visitor cannot otherwise tell apart.
    return `The Aitherium corpus is unavailable: it ${corpus.error}. `
      + 'Say you could not check the published material rather than answering from memory.';
  }

  const terms = corpusTokens(query);
  if (!terms.length) {
    return `Error: "${query}" has no searchable words in it — try naming a product, `
      + 'feature or idea.';
  }

  const { ranked: scored, miss } = rankPassages(corpus, terms);
  if (miss === 'unknown-terms') {
    return `Nothing in Aitherium's published material mentions "${query}". `
      + 'Say that we have not written about it, rather than answering from memory.';
  }
  if (miss === 'no-coverage') {
    return `Nothing in Aitherium's published material covers "${query}". `
      + 'Say that we have not written about it, rather than answering from memory.';
  }

  // At most one passage per post, so five results are five sources rather than
  // five paragraphs of one article.
  const out: string[] = [];
  const usedDocs = new Set<number>();
  for (const { i } of scored) {
    const passage = corpus.passages[i];
    if (usedDocs.has(passage.d)) continue;
    usedDocs.add(passage.d);
    const doc = corpus.docs[passage.d];
    const where = passage.h ? ` (section: ${passage.h})` : '';
    const retracted = doc.x ? ' [SUPERSEDED — later work replaced this; say so if you use it]' : '';
    out.push(
      `[${out.length + 1}] "${doc.t}"${retracted}\n`
      + `    source: ${doc.u}${doc.d ? `  (published ${doc.d})` : ''}${where}\n`
      + `    ${passage.x}`
    );
    if (out.length >= 5) break;
  }

  // The instruction rides WITH the result rather than living in the system
  // prompt. Bonsai's coherence degrades with prompt length at low bit-widths
  // (D-1380), so a standing paragraph about citations would cost answer quality
  // on every turn including the ones that never search. Here it costs nothing
  // until it is relevant, and it is adjacent to the passages it governs.
  return [
    `${out.length} passage(s) from Aitherium's published writing:`,
    '',
    out.join('\n\n'),
    '',
    'Answer using ONLY these passages. After each claim, cite the source path of '
    + 'the passage it came from (for example: /blog/some-post). If they do not '
    + 'contain the answer, say so plainly instead of filling the gap.',
  ].join('\n');
}

/**
 * Deep research: search the web, read the pages, synthesize — and hand back the
 * sources so the answer stays checkable.
 *
 * DELIBERATELY NOT THE AUTHORITY ON US. Measured 2026-07-31, asked "What is
 * AitherOS?", the pipeline returned confidently-cited facts about aither.systems,
 * AitherLabs/AitherOS and "Aitheros Talks" — three unrelated projects sharing our
 * name. Web grounding makes an answer CHECKABLE, not CORRECT, and a citation
 * pointing at the wrong company is worse than none because it survives scrutiny.
 * The tool description therefore routes questions about Aitherium to
 * `search_aitherium` instead, and this says so again in its own result.
 */
/**
 * Generate an image — the AUTHED FLEET tier, and the only tier there is.
 *
 * Every other capability the greeter has runs on the visitor's own machine. This one cannot:
 * `:8798` serves FLUX.2 Klein 4B, a DIFFUSION model (~7 GB peak), and the in-browser runtime
 * has only transformer TEXT kernels — conv2d, GroupNorm, bilinear resampling and a VAE
 * decoder do not exist there and are not a flag away.
 *
 * So this tool is honest about the trade in its own failure messages: signing in is required
 * because the GPU time is OURS, and a refusal says which of the three reasons it was
 * (not signed in / switched off / unreachable) rather than a generic "unavailable". A model
 * told only "it failed" retries, and each retry is another minute of someone's GPU.
 */
async function executeGenerateImage(args: Record<string, any>): Promise<string> {
  const prompt = String(args.prompt ?? args.description ?? '').trim();
  const base = toolContext.apiBase;

  if (!prompt) return 'Error: what should I draw? Pass prompt=<description>.';
  if (prompt.length > 512) {
    return 'Error: that image prompt is too long (max 512 characters).';
  }

  /*
   * LOCAL TIER FIRST (gap closed 2026-08-07). A visitor running their own
   * AitherBonsaiImage (install-bonsai-image.sh, or the awnode compose `image`
   * profile) renders on THEIR GPU: no sign-in, no fleet meter, no rate limit — the
   * same local-first deal text generation has always had. The host probed 8798 and
   * put the base in the context; the fleet path below is untouched as the fallback,
   * so a local failure degrades to exactly yesterday's behaviour.
   */
  if (toolContext.localImageBase) {
    try {
      const lres = await fetch(`${toolContext.localImageBase}/v1/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, width: 1024, height: 1024 }),
      });
      if (lres.ok) {
        const ldata: any = await lres.json();
        const lfirst = Array.isArray(ldata?.images) ? ldata.images[0] : null;
        if (lfirst) {
          const dataUrl = typeof lfirst === 'string' && lfirst.startsWith('data:')
            ? lfirst
            : `data:image/png;base64,${String(lfirst)}`;
          pushImage({ dataUrl, alt: prompt.slice(0, 200) });
          return `Generated an image for "${prompt.slice(0, 60)}" on the user's own GPU `
            + '(their local image backend). It is displayed to the user; do not describe it '
            + 'as if you can see it, and do not try to repeat it.';
        }
      }
      console.warn('[bonsai-tools] local image backend answered but unusably; falling to hosted');
    } catch (e) {
      console.warn('[bonsai-tools] local image backend unreachable; falling to hosted:', e);
    }
  }

  if (!base) return 'Image generation is unavailable: no API origin was provided to this session.';

  let res: Response;
  try {
    res = await fetch(`${base}/api/image/generate`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
  } catch (e) {
    return `Image generation is unavailable: could not reach ${base} (${(e as Error).message}).`;
  }

  if (res.status === 401 || res.status === 403) {
    return 'Image generation needs you to be signed in. Unlike everything else here, it does '
      + 'NOT run on your machine — the model is a 7 GB diffusion model on Aitherium hardware, '
      + 'so it is tied to an account rather than being anonymous. Everything else the OS does '
      + 'stays on your GPU.';
  }
  if (res.status === 503) {
    return 'Image generation is switched off fleet-wide right now (there is a kill switch, '
      + 'and it is on). Nothing you did — try again later.';
  }
  if (res.status === 429) {
    return 'Image generation hit its rate limit. It is a minute of GPU time per picture, so '
      + 'the allowance is small; it resets shortly.';
  }
  if (!res.ok) return `Image generation is unavailable: the server answered ${res.status}.`;

  let data: any;
  try { data = await res.json(); } catch { return 'Image generation returned an unreadable response.'; }
  const first = Array.isArray(data?.images) ? data.images[0] : null;
  if (!first) return 'Image generation returned no image.';

  /*
   * THE IMAGE GOES DOWN A SIDE CHANNEL, NOT THROUGH THIS RETURN VALUE.
   *
   * What this function returns lands in TWO places: the reply the visitor reads, and the
   * observation fed back to the MODEL. Base64 in either is a defect — the reply bubble would
   * stream megabytes of it verbatim (stripMarkersStreaming strips only `[[do:…]]`), and the
   * observation would consume the context window and teach the model to echo the bytes.
   *
   * So the picture is pushed to the image sink, which the worker drains and posts on its own
   * message type, and this returns one sentence saying an image exists.
   */
  const dataUrl = typeof first === 'string' && first.startsWith('data:')
    ? first
    : `data:image/png;base64,${String(first)}`;
  pushImage({ dataUrl, alt: prompt.slice(0, 200) });
  return `Generated an image for "${prompt.slice(0, 60)}". It is displayed to the user; `
    + 'do not describe it as if you can see it, and do not try to repeat it.';
}

async function executeDeepResearch(args: Record<string, any>): Promise<string> {
  const query = String(args.query ?? args.q ?? '').trim();
  const base = toolContext.apiBase;

  if (!query) return 'Error: what should I research? Pass query=<text>.';
  if (query.length > 512) {
    // Mirrors the server cap (D-706, prompt injection) so the model gets a real
    // reason instead of a 400 it cannot interpret.
    return 'Error: that research question is too long (max 512 characters).';
  }
  if (!base) return 'Deep research is unavailable: no API origin was provided to this session.';

  const depth = ['quick', 'standard'].includes(String(args.depth)) ? String(args.depth) : 'standard';

  let res: Response;
  try {
    res = await fetch(`${base}/api/research`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, depth }),
    });
  } catch (e) {
    return `Deep research is unavailable: could not reach ${base} (${(e as Error).message}).`;
  }

  if (res.status === 429) {
    return 'Deep research hit its hourly limit for this browser. It is expensive to run, '
      + 'so the anonymous allowance is small; signing in raises it, and it resets within '
      + 'the hour. Try web_search for a lighter lookup.';
  }
  if (res.status === 401 || res.status === 403) {
    return 'Deep research was refused by the server (it should be open to everyone). '
      + 'This looks like a misconfiguration rather than something you did.';
  }
  if (!res.ok) return `Deep research is unavailable: the server answered ${res.status}.`;

  let data: any;
  try {
    data = await res.json();
  } catch {
    return 'Deep research is unavailable: the server returned a 200 that was not JSON.';
  }

  const sources: any[] = Array.isArray(data?.sources) ? data.sources : [];
  const synthesis = String(data?.synthesis ?? '').trim();

  if (!synthesis && !sources.length) {
    // "It ran and found nothing" is a different fact from "it is broken".
    return `Deep research for "${query}" came back with nothing — no pages worth reading.`;
  }
  if (!sources.length) {
    // A synthesis with no sources is exactly the shape this tool exists to avoid:
    // it READS as researched while being unverifiable. Refuse to launder it.
    return `Deep research for "${query}" produced a summary with NO sources attached, `
      + 'so none of it can be checked. Treat it as unverified and say so.';
  }

  const cited = sources
    .slice(0, 5)
    .map((s, i) => {
      const title = String(s?.title || 'untitled');
      const url = String(s?.url || '');
      const snippet = String(s?.snippet || '').slice(0, 240);
      return `[${i + 1}] ${title}\n    source: ${url}${snippet ? `\n    ${snippet}` : ''}`;
    })
    .join('\n\n');

  return [
    synthesis ? `Summary of what the sources say:\n${synthesis}` : 'Sources found:',
    '',
    cited,
    '',
    'Cite the source URL beside any claim you take from this. These are third-party '
    + 'pages, not ours — if any of them describes a DIFFERENT project that happens to '
    + 'share a name with Aitherium, say so rather than repeating it. For anything about '
    + 'Aitherium or AitherOS itself, use search_aitherium instead; it is the authority.',
  ].join('\n');
}

/* ════════════════════════════════════════════════════════════════════════════
   ON-DEVICE MEMORY — the model writes to a graph and walks it back.

   A 1.7B has a few thousand tokens of context and no memory between turns. It
   cannot be given a bigger window, but it CAN be given somewhere to put things
   and a way to find them again — which is the same thing from the user's side:
   what you told it three days ago is still there.

   The graph already existed and the agent could not reach it. `sprite-graph-local`
   keeps entities and edges in IndexedDB with real multi-hop traversal, and
   `sprite-local` keeps the entries; both were wired only to the Sprite window.
   Measured 2026-07-31: this registry referenced NEITHER, so the model had no
   write path at all, and its one memory tool (`search_knowledge`) calls the
   SERVER — 401 for anon, and absent entirely on the static apex, where the
   agent most needs it. On aitherium.com the agent's memory was dead by
   construction.

   WHY THIS WORKS FROM A WORKER, WHICH IS THE PART THAT LOOKS WRONG:
   tools execute inside a Web Worker, which has no `window` and no
   `localStorage`. Both modules use bare `indexedDB.open()` and touch `window`
   only in a usability probe that the read/write path does not call — verified
   before wiring, because "it silently does nothing in the Worker" is exactly
   how this feature would ship broken. Worker and page share one origin, so a
   fact the agent stores is the SAME record the Sprite window shows: one memory,
   two surfaces, no sync.

   EXTRACTION IS DELIBERATELY HEURISTIC HERE. `ingestLocal` accepts a generate()
   for LLM triple extraction, and passing one would mean re-entering the model
   from inside a tool call while that model is mid-turn. The heuristic tier is
   weaker and `ingestLocal` LABELS every node it creates as such, so a later
   pass can upgrade them — a worse graph that exists beats a better one that
   deadlocks.
   ════════════════════════════════════════════════════════════════════════════ */

/** Load the on-device stores lazily: a visitor who never uses memory pays nothing. */
async function memoryModules() {
  const [local, graph] = await Promise.all([
    import('../sprite-local'),
    import('../sprite-graph-local'),
  ]);
  return { local, graph };
}

/** Store something durably, and connect it into the graph so it can be found later. */
async function executeRemember(args: Record<string, any>): Promise<string> {
  const content = String(args.fact ?? args.content ?? args.text ?? '').trim();
  if (!content) return 'Error: what should I remember? Pass fact=<text>.';
  if (content.length > 4000) {
    return 'Error: that is too long to store as one memory (max 4000 characters). '
      + 'Break it into separate facts.';
  }
  const title = String(args.title ?? '').trim() || content.slice(0, 60);

  let mods: Awaited<ReturnType<typeof memoryModules>>;
  try {
    mods = await memoryModules();
  } catch (e) {
    return `Memory is unavailable: the on-device store could not load (${(e as Error).message}).`;
  }

  let entry: { id: string; title: string; content: string };
  try {
    entry = await mods.local.addKnowledge({ kind: 'fact', title, content });
  } catch (e) {
    // Private browsing, blocked storage, or a wedged IndexedDB. Say which —
    // "saved!" when nothing was written is the worst possible answer here.
    return `I could not save that: on-device storage refused the write (${(e as Error).message}). `
      + 'This is usually private browsing or blocked site storage.';
  }

  let linked = '';
  try {
    const g = await mods.graph.ingestLocal(entry);
    if (g.nodes) linked = ` Linked ${g.nodes} thing(s) and ${g.edges} connection(s) into your graph.`;
  } catch {
    // The entry IS saved; only the graph link failed. Recall still finds it by
    // keyword, so this degrades rather than losing the fact — say so honestly.
    linked = ' (Saved, but I could not connect it to anything yet.)';
  }

  return `Remembered: "${title}".${linked} It is stored on this device and will still be `
    + 'here next time.';
}

/** Walk the graph for what was stored before — this is the context extension. */
async function executeRecall(args: Record<string, any>): Promise<string> {
  const query = String(args.query ?? args.q ?? args.about ?? '').trim();

  // A NONSENSE limit falls back to the default rather than clamping to the floor.
  // `Math.max(-5, 1)` is 1, and returning a single item reads to the person as
  // "that is all I have about this" — a malformed argument from a small model
  // turning into a false statement about their memory. Only sane values clamp.
  const asked = Number(args.limit);
  const take = Number.isFinite(asked) && asked >= 1 ? Math.min(Math.floor(asked), 8) : 4;

  let mods: Awaited<ReturnType<typeof memoryModules>>;
  try {
    mods = await memoryModules();
  } catch (e) {
    return `Memory is unavailable: the on-device store could not load (${(e as Error).message}).`;
  }

  let all: Array<{ id: string; title: string; content: string }>;
  try {
    all = await mods.local.listKnowledge(200);
  } catch (e) {
    return `Memory is unavailable: could not read on-device storage (${(e as Error).message}).`;
  }
  if (!all.length) {
    // "Nothing stored yet" and "lookup failed" are different facts.
    return 'Nothing has been stored in this device\'s memory yet. Use remember to add something.';
  }

  // GRAPH FIRST, and only trusted when traversal actually connected something.
  // A zero-hop hit is keyword matching with extra steps, and the ranker below
  // does that better — the same rule sprite-graphrag applies.
  try {
    const g = await mods.graph.retrieveLocal(query, take);
    if (g.ids.length && g.hops > 0) {
      const byId = new Map(all.map((k) => [k.id, k]));
      const hits = g.ids.map((id) => byId.get(id)).filter(Boolean) as typeof all;
      if (hits.length) {
        return [
          `From your on-device memory (${g.hops} hop(s) through the graph — these were `
          + 'reached by CONNECTION, not just word match):',
          ...hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.content.slice(0, 400)}`),
        ].join('\n');
      }
    }
  } catch { /* graph empty or unavailable — the ranker below still answers */ }

  const ranked = mods.local.rankKnowledge(all as any, query, take);
  if (!ranked.length) {
    return `Nothing in this device's memory matches "${query}". `
      + `There are ${all.length} stored item(s), none about that.`;
  }
  return [
    'From your on-device memory (keyword match — nothing was connected to this yet):',
    ...ranked.map((h: any, i: number) => `${i + 1}. ${h.title}\n   ${String(h.content).slice(0, 400)}`),
  ].join('\n');
}

/**
 * Look something up in Wikipedia — general world knowledge, offline, cited.
 *
 * WHY A SECOND TOOL RATHER THAN A BIGGER CORPUS. Merging Wikipedia into the
 * Aitherium index would let a Wikipedia sentence be quoted back as an Aitherium
 * claim with our own URL beside it. Two tools with two indexes means every
 * passage can say what it is, and the model is told plainly which one is
 * authoritative about us.
 *
 * WHY IT IS STATIC RATHER THAN A LIVE API CALL. `lib/faculties/WikipediaGraph.py`
 * already knows how to talk to Wikipedia — 1,578 lines of it — and was reachable
 * only from the training harvester (D-1734), so no agent could look anything up.
 * A live call from here would also need network, an origin with /api, and would
 * fail on a plane. The 273 configured topics are fetched at build time instead
 * and ship with the page, so this works offline like everything else here.
 *
 * ATTRIBUTION IS NOT OPTIONAL. Wikipedia is CC BY-SA: the licence travels in the
 * index and every result carries the article title and canonical URL.
 */
async function executeSearchWikipedia(args: Record<string, any>): Promise<string> {
  const query = String(args.query ?? args.q ?? args.topic ?? '').trim();
  if (!query) return 'Error: what should I look up? Pass query=<text>.';

  const wiki = await loadWikipedia();
  if ('error' in wiki) {
    // Naming it keeps "I could not look" distinct from "Wikipedia has nothing",
    // which the visitor cannot otherwise tell apart.
    return `The Wikipedia reference is unavailable: it ${wiki.error}. `
      + 'Say you could not check rather than answering from memory.';
  }

  const terms = corpusTokens(query);
  if (!terms.length) {
    return `Error: "${query}" has no searchable words in it — try naming a concept.`;
  }

  const { ranked, miss } = rankPassages(wiki, terms);
  if (miss) {
    // This corpus is a fixed set of topics, not all of Wikipedia. Saying so stops
    // the model reading a miss as "Wikipedia does not cover this", which would be
    // a false statement about the world rather than about our index.
    return `The offline Wikipedia reference here covers ${wiki.docs.length} selected `
      + `articles and none of them cover "${query}". It is not all of Wikipedia — say `
      + 'you do not have an article on it, and use web_search or deep_research if the '
      + 'question needs an answer.';
  }

  const out: string[] = [];
  const usedDocs = new Set<number>();
  for (const { i } of ranked) {
    const passage = wiki.passages[i];
    if (usedDocs.has(passage.d)) continue;
    usedDocs.add(passage.d);
    const doc = wiki.docs[passage.d];
    out.push(`[${out.length + 1}] ${doc.t} (Wikipedia)\n    source: ${doc.u}\n    ${passage.x}`);
    if (out.length >= 4) break;
  }

  return [
    `${out.length} passage(s) from Wikipedia:`,
    '',
    out.join('\n\n'),
    '',
    'These are WIKIPEDIA passages, not Aitherium material — attribute them to Wikipedia '
    + `and cite the article URL (text is ${wiki.license ?? 'CC BY-SA'}). For anything about `
    + 'Aitherium or AitherOS itself use search_aitherium; this cannot speak for us.',
  ].join('\n');
}

export const BONSAI_TOOLS: Record<string, RegisteredTool> = {
  get_current_time: {
    definition: {
      name: 'get_current_time',
      description: 'Get the current date and time in the user\'s timezone',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    execute: executeGetCurrentTime,
  },
  evaluate_math: {
    definition: {
      name: 'evaluate_math',
      description: 'Evaluate a mathematical expression and return the result',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'A mathematical expression to evaluate (e.g., "2 + 2", "sqrt(16)")',
          },
        },
        required: ['expression'],
      },
    },
    execute: executeEvaluateMath,
  },
  list_apps: {
    definition: {
      name: 'list_apps',
      description:
        'List the windows/apps that can be opened here, with a short description of each. '
        + 'Call this before open_app if you are not sure of the id.',
      parameters: { type: 'object', properties: {} },
    },
    execute: executeListApps,
  },
  open_app: {
    definition: {
      name: 'open_app',
      description:
        "Open one of this OS's windows for the user (for example the sprite, terminal, "
        + 'playground or setup window). Use list_apps to see the available ids.',
      parameters: {
        type: 'object',
        properties: {
          app: {
            type: 'string',
            description: 'The window id to open, e.g. "sprite", "terminal", "playground".',
          },
        },
        required: ['app'],
      },
    },
    execute: executeOpenApp,
  },
  web_search: {
    definition: {
      name: 'web_search',
      description:
        'Search the live web for current information. Use this for anything you do not '
        + 'already know, or anything that may have changed recently. Works without an '
        + 'account.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search the web for.' },
        },
        required: ['query'],
      },
    },
    execute: executeWebSearch,
  },
  search_knowledge: {
    definition: {
      name: 'search_knowledge',
      description:
        "Search the visitor's own knowledge base — the facts they have taught their "
        + 'AitherSprite. Use this when asked what they have taught you, or what you know '
        + 'about a topic they have shared. Optional query filters the entries.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Optional keyword to filter entries by. Omit to list everything.',
          },
        },
      },
    },
    execute: executeSearchKnowledge,
  },
  search_aitherium: {
    definition: {
      name: 'search_aitherium',
      description:
        'Search everything Aitherium has PUBLISHED about itself — AitherOS, Aitherium, '
        + 'the products, the architecture, the mission, and how any of it works. Use this '
        + 'BEFORE answering any question about Aitherium or AitherOS, even if you think you '
        + 'know: it returns passages with the page they came from, so your answer can be '
        + 'checked. Prefer it over web_search for anything about us.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What to look up, e.g. "how does AitherGraph work" or "why local AI".',
          },
        },
        required: ['query'],
      },
    },
    execute: executeSearchAitherium,
  },
  search_wikipedia: {
    definition: {
      name: 'search_wikipedia',
      description:
        'Look up general world knowledge — science, computing, history, concepts — in '
        + 'an offline Wikipedia reference that works with no network. Use it for "what '
        + 'is X" questions about things that are NOT Aitherium. For anything about '
        + 'Aitherium or AitherOS use search_aitherium instead; Wikipedia cannot speak '
        + 'for us.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The concept or topic to look up.' },
        },
        required: ['query'],
      },
    },
    execute: executeSearchWikipedia,
  },
  deep_research: {
    definition: {
      name: 'deep_research',
      description:
        'Research a topic properly: searches the web, reads the pages, and returns a '
        + 'summary WITH its sources. Slower than web_search — use it when a question '
        + 'deserves a real answer rather than a list of links. Do NOT use it for '
        + 'questions about Aitherium or AitherOS; use search_aitherium for those, '
        + 'because the web has several unrelated projects with similar names.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The question to research.' },
          depth: {
            type: 'string',
            description: '"quick" (fast, snippets) or "standard" (reads pages). '
              + 'Defaults to standard.',
          },
        },
        required: ['query'],
      },
    },
    execute: executeDeepResearch,
  },
  generate_image: {
    definition: {
      name: 'generate_image',
      description:
        'Draw a picture from a description. UNLIKE everything else here this does NOT run '
        + 'on this machine — it runs on Aitherium hardware and needs the visitor to be '
        + 'signed in, so only use it when they actually asked for an image. It takes about '
        + 'a minute. The picture is shown to them directly; do not describe it as if you '
        + 'can see it.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'What the picture should show.' },
        },
        required: ['prompt'],
      },
    },
    execute: executeGenerateImage,
  },
  remember: {
    definition: {
      name: 'remember',
      description:
        'Store something durably on this device so you still know it in later '
        + 'conversations. Use it whenever the person tells you something about '
        + 'themselves, their preferences, their work, or anything they say to keep. '
        + 'It is saved locally and connected into their knowledge graph.',
      parameters: {
        type: 'object',
        properties: {
          fact: { type: 'string', description: 'The thing to remember, in a full sentence.' },
          title: { type: 'string', description: 'Optional short label for it.' },
        },
        required: ['fact'],
      },
    },
    execute: executeRemember,
  },
  recall: {
    definition: {
      name: 'recall',
      description:
        'Look through everything stored on this device before answering anything '
        + 'personal or anything you were told earlier. It walks their knowledge '
        + 'graph, so it finds things CONNECTED to the question, not only exact '
        + 'word matches. Use it rather than guessing what you were told.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look for.' },
          limit: { type: 'number', description: 'How many items to return (1-8, default 4).' },
        },
        required: ['query'],
      },
    },
    execute: executeRecall,
  },
  get_page_context: {
    definition: {
      name: 'get_page_context',
      description: 'Get information about the current page and browser environment',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    execute: executeGetPageContext,
  },
  // Local PIM tools (notes_*, calendar_*): the agent works the visitor's own data on
  // their device, no login. Defined in local-pim-tools.ts so the store + executors stay
  // in one place; this spread is what wires them into getToolDefinitions()/executeTool().
  ...LOCAL_PIM_TOOLS,
};

/** Get all tool definitions for passing to the model. */
export function getToolDefinitions(): ToolFunction[] {
  return Object.values(BONSAI_TOOLS).map((t) => t.definition);
}

/* ════════════════════════════════════════════════════════════════════════════
   TOOL BUDGET — why a 1.7B does not get all 28 schemas

   Measured 2026-08-09: the 28 definitions serialise to 11,074 characters,
   ~2,769 tokens. The owner's screenshot of the in-browser 1.7B answering "what
   time is it?" reported `prefill 2787 tokens`. Those two numbers are the same
   number: the prompt WAS the tool list. The system prompt is ~200 tokens and is
   guarded at 700 characters precisely because length costs answer quality at
   1-2 bits (D-1380) — and then 2,769 tokens of JSON rode in beside it, governed
   by nothing.

   It is not only a latency bug, though it is badly one. The attention kernel's
   own header records the measured curve on this hardware:

       prompt tokens   forward/token   tok/s
       20              111 ms          7.6
       169             ~128 ms         7.8
       1285            646 ms          1.0

   Cost is linear in context, so ~2,800 tokens is worse than that last row
   before the model emits anything. And `greeter-agent.ts` already states the
   quality half: "Bonsai's coherence degrades with prompt length at low
   bit-widths, and a long persona costs answer quality directly".

   THE RULE IS A BUDGET, NOT A LIST. An explicit per-size allowlist would be
   correct exactly once: the next tool added lands outside it and is silently
   unreachable, or lands inside it and silently blows the budget. A priority
   order plus a token ceiling degrades predictably instead — a new tool takes
   its place in the order and the smallest brains simply stop before reaching
   it, which is visible in `toolBudgetReport()` rather than inferred.

   Note `get_current_time` is FIRST. The prompt that exposed this was "what time
   is it?", and the tool that answers it is 37 tokens.
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * Tools in descending order of value-per-token to a SMALL model. Anything not
 * named here sorts last (in registry order), so a newly added tool is never
 * silently promoted ahead of a hand-ranked one.
 */
const TOOL_PRIORITY: readonly string[] = [
  'get_current_time',   // ~37 tok — answers a question people actually open with
  'open_app',           // ~91 tok — the agent's only way to DO anything visible
  'search_aitherium',    // ~156 tok — grounding; the corpus exists to stop invention
  'list_apps',          // ~57 tok — makes open_app usable instead of guessed
  'evaluate_math',      // ~73 tok — small models are bad at arithmetic, this is cheap
  'recall',
  'remember',
  'get_page_context',
  'web_search',
  'search_wikipedia',
  'search_knowledge',
  'generate_image',
  'deep_research',
];

/**
 * Token ceiling for the tool block, by model size. Deliberately generous
 * relative to the ~341 tokens the first four cost — the aim is to delete a
 * 2,769-token prompt, not to hand-tune a frontier.
 *
 * `null` = no ceiling: at 27B the schemas are a small fraction of a 262k
 * context and the model can actually use them.
 */
function toolTokenBudget(sizeMb: number | undefined): number | null {
  if (sizeMb === undefined) return 400;   // unknown model → treat as the smallest
  if (sizeMb <= 300) return 400;          // 1.7B (236 MB)
  if (sizeMb <= 800) return 900;          // 4B (545 MB)
  if (sizeMb <= 2000) return 1800;        // 8B (1.1 GB)
  return null;                            // 27B and anything larger
}

/** Rough token count for a definition. Same /4 heuristic used to size the
 *  budgets, so the two cannot drift apart into different units. */
function approxTokens(def: ToolFunction): number {
  return Math.ceil(JSON.stringify(def).length / 4);
}

function priorityIndex(name: string): number {
  const i = TOOL_PRIORITY.indexOf(name);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/**
 * The tool definitions a given brain should actually be sent.
 *
 * @param sizeMb download size of the running model, from BONSAI_MODELS. Passed
 *   in rather than looked up here so this module keeps no dependency on the
 *   model catalogue (and so a caller on a non-Bonsai rung can pass its own).
 *   `undefined` is treated as the SMALLEST budget — an unknown model is not a
 *   licence to send 2,769 tokens.
 */
export function getToolDefinitionsForModel(sizeMb?: number): ToolFunction[] {
  const budget = toolTokenBudget(sizeMb);
  const all = getToolDefinitions();
  if (budget === null) return all;

  const ranked = [...all].sort(
    (a, b) => priorityIndex(a.name) - priorityIndex(b.name),
  );
  const kept: ToolFunction[] = [];
  let spent = 0;
  for (const def of ranked) {
    const cost = approxTokens(def);
    if (spent + cost > budget) continue; // skip, don't stop: a cheap tool after
    kept.push(def);                      // an expensive one still earns its place
    spent += cost;
  }
  return kept;
}

/** What the budget actually did, for a log line or a test. Reporting only. */
export function toolBudgetReport(sizeMb?: number): {
  budget: number | null; sent: string[]; dropped: string[]; tokens: number;
} {
  const sent = getToolDefinitionsForModel(sizeMb);
  const sentNames = new Set(sent.map((d) => d.name));
  return {
    budget: toolTokenBudget(sizeMb),
    sent: sent.map((d) => d.name),
    dropped: getToolDefinitions().map((d) => d.name).filter((n) => !sentNames.has(n)),
    tokens: sent.reduce((a, d) => a + approxTokens(d), 0),
  };
}

/** Execute a tool by name with the given arguments. */
export async function executeTool(name: string, args: Record<string, any>): Promise<string> {
  const tool = BONSAI_TOOLS[name];
  if (!tool) {
    return `Error: unknown tool "${name}"`;
  }
  try {
    return await tool.execute(args);
  } catch (e) {
    return `Error executing tool: ${(e as Error).message}`;
  }
}
