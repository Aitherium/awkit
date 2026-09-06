// GENERATED — DO NOT EDIT.
// Synced from AitherVeil/src/lib (shared module imported by the webml runtime) by
// AitherOS/apps/AitherVeil/scripts/sync-webml-to-awkit.mjs.
// Edit the canonical copy and re-run the sync; a hand edit here is overwritten.
/**
 * The shared corpus plane — one copy of the BM25 ranker every corpus consumer uses.
 *
 * Extracted from `lib/bonsai-tools/registry.ts` (2026-08-29) so the Perplexity-class
 * /search page, the Bonsai `search_aitherium` tool, and any future consumer share ONE
 * implementation. The registry's own comment said it best: "a second hand-written copy
 * of this would drift from this one silently — the bug reappearing in only one corpus,
 * which is harder to notice than it appearing in both." That is now enforced by imports
 * instead of by prose.
 *
 * Two corpora, kept apart ON PURPOSE: the Aitherium corpus (our own published writing)
 * and the Wikipedia intros corpus (CC BY-SA, third-party). Merging them would let a
 * Wikipedia sentence be quoted back as an Aitherium claim.
 */

interface CorpusDoc { s: string; t: string; d: string; u: string; x?: number }
interface CorpusPassage { d: number; h: string; x: string }
export interface CorpusIndex {
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

export function corpusTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !CORPUS_STOPWORDS.has(w));
}

/**
 * Load the index ONCE per session and cache the promise, so N consumers in a
 * conversation cost one download. The promise (not the value) is cached so two
 * concurrent calls share one fetch rather than racing two.
 */
let corpusPromise: Promise<CorpusIndex | { error: string }> | null = null;
let wikiPromise: Promise<CorpusIndex | { error: string }> | null = null;

/** Reset the memoised corpora. Tests only — a cached fetch would leak between cases. */
export function __resetCorpusCacheForTests(): void {
  corpusPromise = null;
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
      // The underlying error text is carried so a named failure reaches the
      // visitor ("offline") instead of a generic one — the tests pin this.
      return { error: `could not be downloaded (${(e as Error).message})` };
    }
    if (!res.ok) return { error: `could not be downloaded (the server answered ${res.status})` };
    let data: CorpusIndex | { error: string };
    try {
      data = await res.json();
    } catch {
      return { error: 'downloaded but was not valid JSON' };
    }
    // `in`-narrowing, not optional-chaining: `data?.passages` does not narrow
    // the union `CorpusIndex | { error: string }` under strict tsc (the error
    // variant simply lacks the property), and the vendored copy is compiled
    // by awkit's strict build — measured 2026-08-30 (TS2339 at the guards).
    if (!data || !('passages' in data) || !('docs' in data)
        || !data.passages.length || !data.docs.length) {
      // An empty corpus would make every question answer "nothing matched",
      // which reads as a working search over a topic we have written 200 posts
      // about. Name it instead.
      return { error: 'downloaded but is empty' };
    }

    // Precompute once: token lists, document frequencies and mean length.
    // The guards above proved the shape — narrow the union so the derived
    // fields are assignable under awkit's strict tsc (TS does not narrow
    // across the `data = await res.json()` assignment).
    const corpus = data as CorpusIndex;
    const tokens = corpus.passages.map((p) => corpusTokens(`${p.h} ${p.x}`));
    const df = new Map<string, number>();
    for (const t of tokens) {
      for (const term of new Set(t)) df.set(term, (df.get(term) ?? 0) + 1);
    }
    corpus._tokens = tokens;
    corpus._df = df;
    corpus._avgLen = tokens.reduce((a: number, t: string[]) => a + t.length, 0)
      / (tokens.length || 1);
    return corpus;
  }
}

/** The Aitherium corpus — our own published writing. */
export async function loadCorpus(): Promise<CorpusIndex | { error: string }> {
  corpusPromise ??= fetchIndex('/corpus/index.json');
  return corpusPromise;
}

/** The Wikipedia reference corpus — third-party, CC BY-SA, kept separate. */
export async function loadWikipedia(): Promise<CorpusIndex | { error: string }> {
  wikiPromise ??= fetchIndex('/corpus/wikipedia.json');
  return wikiPromise;
}

/**
 * BM25 + IDF-weighted coverage over a loaded index. SHARED by every corpus.
 *
 * The coverage floor below is the rule that stops a nonsense query returning five
 * confident, citable passages, and it must not exist in two copies.
 *
 * Returns ranked passage indices, or a reason nothing qualified. The CALLER
 * phrases the outcome, because "we have not written about this" and "Wikipedia
 * does not cover this" are different statements about different sources.
 */
export function rankPassages(
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

/** Turn ranked passage indices into the passage objects, with doc title/url attached. */
export function passagesFromRanked(
  corpus: CorpusIndex,
  ranked: Array<{ i: number; score: number }>,
  limit = 5,
): Array<{ title: string; url: string; section?: string; text: string }> {
  return ranked.slice(0, limit).map(({ i }) => {
    const p = corpus.passages[i];
    const doc = corpus.docs[p.d];
    return {
      title: doc?.t ?? '',
      url: doc?.u ?? '',
      section: p.h || undefined,
      text: p.x,
    };
  });
}
