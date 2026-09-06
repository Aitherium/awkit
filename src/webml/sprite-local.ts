// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/**
 * LOCAL-FIRST SPRITE — the companion lives in the user's browser, not our fleet.
 *
 * WHY THIS EXISTS
 * The sprite is meant to be a companion you raise by feeding it knowledge, that you OWN,
 * that is yours forever, and that runs on just about anything. A sprite whose brain and
 * memory live in someone else's containers is none of those things — it dies the moment a
 * service is unreachable. That is not hypothetical: on 2026-07-26 `aitheros-veil` briefly
 * failed to resolve `aitheros-genesis`, `/api/anon/register` returned 502, no token was
 * minted, and the panel rendered "Sprite service unreachable". The creature was fine; the
 * network between you and it was not.
 *
 * It also cannot work any other way on the apex: aitherium.com is a STATIC EXPORT
 * (next.config.ts `output: "export"`), which serves no /api routes at all.
 *
 * So: state in IndexedDB, conversation on the in-browser WebGPU brain, server strictly
 * optional. Signed-in sync is a later addition on top of this, not a prerequisite for the
 * sprite to live.
 *
 * SHAPE COMPATIBILITY
 * This implements the same request/response contract as the server sprite router, so
 * `SpritePanel` (awkit) works against it UNCHANGED. The panel calls global `fetch`,
 * so `installLocalSpriteFetch()` intercepts a sentinel origin rather than requiring the
 * shared panel to learn about local mode.
 *
 * IndexedDB rather than localStorage on purpose: "feed it knowledge" means documents, and
 * localStorage caps out around 5 MB with synchronous writes that jank the UI.
 */

export const LOCAL_SPRITE_BASE = 'https://local.sprite.invalid/api/sprite'

const DB_NAME = 'aither-sprite'
/** SHARED CONTRACT WITH sprite-graph-local.ts — both modules open this same database, and
 *  IndexedDB throws VersionError if one asks for a lower version than the stored one. Bumping
 *  it in only one file breaks whichever module loads second, so the number and the stores
 *  created in onupgradeneeded must match in both places. v2 adds the graph stores. */
const DB_VERSION = 2
const STORE_STATE = 'state'
const STORE_KNOWLEDGE = 'knowledge'
const STORE_GRAPH_NODES = 'graph_nodes'
const STORE_GRAPH_EDGES = 'graph_edges'

export interface LocalSprite {
  name: string
  stage: string
  form: string
  needs: Record<string, number>
  mood: { valence: number; arousal: number }
  mood_label: string
  dormant: boolean
  age_days: number
  knowledge_count?: number
  intellect?: { tier: number; label: string }
  /** epoch ms — used to decay needs on read, so the sprite reacts to real absence. */
  hatched_at: number
  last_seen: number
}

export interface LocalKnowledge {
  id: string
  kind: string
  title: string
  content: string
  visibility?: 'private' | 'public' | 'pending' | 'rejected'
  created_at: number
  updated_at: number
}

// ---------------------------------------------------------------------------
// IndexedDB plumbing
// ---------------------------------------------------------------------------

/** How long to wait for IndexedDB before calling it unusable. See openDb. */
const IDB_OPEN_TIMEOUT_MS = 4000

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false
    const done = (fn: () => void) => { if (!settled) { settled = true; fn() } }

    // MOBILE SAFARI CAN HANG HERE FOREVER. `indexedDB.open()` in private browsing (and
    // sometimes after a storage eviction) neither resolves nor errors on WebKit — the
    // request simply never fires a callback. Without this timeout every sprite call awaits
    // a promise that never settles, which on a phone looks exactly like the app crashing:
    // it hatches, then nothing responds and nothing errors.
    const timer = setTimeout(
      () => done(() => reject(new Error('IndexedDB did not respond — private browsing or blocked storage'))),
      IDB_OPEN_TIMEOUT_MS,
    )
    const finish = (fn: () => void) => { clearTimeout(timer); done(fn) }

    let req: IDBOpenDBRequest
    try {
      // Can throw SecurityError synchronously in a sandboxed or partitioned context.
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (e) {
      clearTimeout(timer)
      reject(e instanceof Error ? e : new Error('IndexedDB is unavailable'))
      return
    }

    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_STATE)) db.createObjectStore(STORE_STATE)
      if (!db.objectStoreNames.contains(STORE_KNOWLEDGE)) {
        db.createObjectStore(STORE_KNOWLEDGE, { keyPath: 'id' })
      }
      // v2 graph stores. Created HERE as well as in sprite-graph-local.ts because whichever
      // module opens the database first runs the upgrade, and the other one must not find
      // its stores missing. An upgrade handler has to be able to build the WHOLE schema.
      if (!db.objectStoreNames.contains(STORE_GRAPH_NODES)) {
        db.createObjectStore(STORE_GRAPH_NODES, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_GRAPH_EDGES)) {
        db.createObjectStore(STORE_GRAPH_EDGES, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => finish(() => resolve(req.result))
    req.onerror = () => finish(() => reject(req.error ?? new Error('IndexedDB open failed')))
    // Another tab holds an older version open. Say so rather than waiting out the clock.
    req.onblocked = () => finish(() => reject(new Error('IndexedDB is blocked by another tab')))
  })
}

/**
 * Can this browser actually STORE a sprite? Answered by OPENING the database, not by
 * checking that `window.indexedDB` exists.
 *
 * The property is present in iOS private browsing and in several locked-down mobile
 * browsers where every operation then fails or hangs — so an existence check is fail-OPEN:
 * it reports "local mode works", the app commits to local mode, and the first write dies.
 */
export async function isLocalStorageUsable(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.indexedDB) return false
  try {
    const db = await openDb()
    db.close()
    return true
  } catch {
    return false
  }
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))
}

// ---------------------------------------------------------------------------
// Sprite state
// ---------------------------------------------------------------------------

const MOODS: Array<[number, string]> = [
  [0.6, 'delighted'], [0.25, 'content'], [-0.1, 'settled'], [-0.4, 'restless'], [-1, 'forlorn'],
]

/** Needs decay with REAL elapsed time, so neglect is felt and attention matters. */
function decay(s: LocalSprite, now: number): LocalSprite {
  const hours = Math.max(0, (now - s.last_seen) / 3_600_000)
  if (hours < 0.01) return s
  const drop = (v: number, rate: number) => Math.max(0, Math.min(1, v - hours * rate))
  const needs = {
    ...s.needs,
    energy: drop(s.needs.energy ?? 1, 0.02),
    focus: drop(s.needs.focus ?? 1, 0.015),
    care: drop(s.needs.care ?? 1, 0.03),
  }
  const avg = (needs.energy + needs.focus + needs.care) / 3
  const valence = Math.max(-1, Math.min(1, avg * 2 - 1))
  const label = MOODS.find(([t]) => valence >= t)?.[1] ?? 'settled'
  return {
    ...s,
    needs,
    mood: { valence, arousal: Math.max(0, Math.min(1, needs.energy)) },
    mood_label: label,
    // Dormant, never dead. A companion you own does not get deleted for inattention.
    dormant: avg < 0.12,
    age_days: (now - s.hatched_at) / 86_400_000,
  }
}

function intellectFor(count: number): { tier: number; label: string } {
  const tiers = ['dim', 'curious', 'sharp', 'keen', 'luminous']
  const tier = Math.min(tiers.length - 1, Math.floor(Math.sqrt(count / 2)))
  return { tier, label: tiers[tier] }
}

export async function loadSprite(): Promise<LocalSprite | null> {
  try {
    const raw = await tx<LocalSprite | undefined>(STORE_STATE, 'readonly', (s) => s.get('sprite'))
    if (!raw) return null
    const now = Date.now()
    const decayed = decay(raw, now)
    const count = await countKnowledge()
    return { ...decayed, knowledge_count: count, intellect: intellectFor(count) }
  } catch {
    return null // no IndexedDB (private mode, ancient browser) -> caller shows hatch
  }
}

export async function saveSprite(s: LocalSprite): Promise<void> {
  await tx(STORE_STATE, 'readwrite', (st) => st.put({ ...s, last_seen: Date.now() }, 'sprite'))
}

export async function hatchSprite(name: string): Promise<LocalSprite> {
  const now = Date.now()
  const s: LocalSprite = {
    name: name.trim() || 'Sprite',
    stage: 'hatchling',
    form: 'mote',
    needs: { energy: 1, focus: 1, care: 1 },
    mood: { valence: 0.5, arousal: 0.6 },
    mood_label: 'delighted',
    dormant: false,
    age_days: 0,
    hatched_at: now,
    last_seen: now,
  }
  await saveSprite(s)
  return s
}

// ---------------------------------------------------------------------------
// Knowledge — what you feed it
// ---------------------------------------------------------------------------

export async function listKnowledge(limit = 100): Promise<LocalKnowledge[]> {
  try {
    const all = await tx<LocalKnowledge[]>(STORE_KNOWLEDGE, 'readonly', (s) => s.getAll())
    return all.sort((a, b) => b.updated_at - a.updated_at).slice(0, limit)
  } catch {
    return []
  }
}

async function countKnowledge(): Promise<number> {
  try {
    return await tx<number>(STORE_KNOWLEDGE, 'readonly', (s) => s.count())
  } catch {
    return 0
  }
}

export async function addKnowledge(e: Omit<LocalKnowledge, 'id' | 'created_at' | 'updated_at'>): Promise<LocalKnowledge> {
  const now = Date.now()
  const entry: LocalKnowledge = {
    ...e,
    id: (crypto.randomUUID?.() ?? `k_${now}_${Math.floor(Math.random() * 1e6)}`),
    visibility: e.visibility ?? 'private',
    created_at: now,
    updated_at: now,
  }
  await tx(STORE_KNOWLEDGE, 'readwrite', (s) => s.put(entry))
  return entry
}

export async function updateKnowledge(id: string, patch: Partial<LocalKnowledge>): Promise<void> {
  const cur = await tx<LocalKnowledge | undefined>(STORE_KNOWLEDGE, 'readonly', (s) => s.get(id))
  if (!cur) return
  await tx(STORE_KNOWLEDGE, 'readwrite', (s) => s.put({ ...cur, ...patch, id, updated_at: Date.now() }))
}

export async function deleteKnowledge(id: string): Promise<void> {
  await tx(STORE_KNOWLEDGE, 'readwrite', (s) => s.delete(id))
}

/** Export EVERYTHING, so "you own it" is a file you can hold, not a claim. */
export async function exportSprite(): Promise<string> {
  const [sprite, knowledge] = await Promise.all([loadSprite(), listKnowledge(10_000)])
  return JSON.stringify({ version: 1, exported_at: Date.now(), sprite, knowledge }, null, 2)
}

export async function importSprite(json: string): Promise<void> {
  const data = JSON.parse(json)
  if (data?.sprite) await saveSprite(data.sprite)
  for (const k of data?.knowledge ?? []) {
    await tx(STORE_KNOWLEDGE, 'readwrite', (s) => s.put(k))
  }
}

// ---------------------------------------------------------------------------
// Optional sync — the sprite is portable, but never DEPENDENT
// ---------------------------------------------------------------------------

export interface SyncResult {
  pulled: number
  pushed: number
  skipped: number
  error?: string
}

/**
 * Reconcile local knowledge with a hosted sprite, last-writer-wins on `updated_at`.
 *
 * Deliberately best-effort and non-destructive: a failure leaves local untouched and is
 * REPORTED, never swallowed. Local remains the source of truth — this exists so the same
 * companion can follow you to another device, not so the server can own it. Nothing here is
 * on the path of talking to your sprite, so an outage cannot stop it thinking.
 *
 * Deletions are intentionally NOT propagated: a sync bug that silently erases knowledge the
 * user spent months feeding it would be unforgivable, and "it reappeared" is a far kinder
 * failure than "it is gone".
 */
export async function syncKnowledge(
  apiBase: string,
  headers: Record<string, string> = {},
): Promise<SyncResult> {
  const res: SyncResult = { pulled: 0, pushed: 0, skipped: 0 }
  const h = { 'Content-Type': 'application/json', ...headers }
  try {
    const remoteRes = await fetch(`${apiBase}/me/knowledge?limit=1000`, { headers: h })
    if (!remoteRes.ok) {
      res.error = `remote read failed (${remoteRes.status})`
      return res
    }
    const remoteBody = await remoteRes.json().catch(() => ({}))
    const remote: LocalKnowledge[] = remoteBody.entries ?? remoteBody ?? []
    const local = await listKnowledge(10_000)
    const byId = new Map(local.map((k) => [k.id, k]))

    // PULL: remote entries that are new here, or newer than ours.
    for (const r of remote) {
      if (!r?.id) continue
      const mine = byId.get(r.id)
      if (!mine || (r.updated_at ?? 0) > (mine.updated_at ?? 0)) {
        await tx(STORE_KNOWLEDGE, 'readwrite', (s) => s.put(r))
        res.pulled++
      } else {
        res.skipped++
      }
    }

    // PUSH: local entries the server has never seen, or that we changed more recently.
    const remoteById = new Map(remote.map((k) => [k.id, k]))
    for (const mine of local) {
      const theirs = remoteById.get(mine.id)
      if (theirs && (theirs.updated_at ?? 0) >= (mine.updated_at ?? 0)) continue
      const put = await fetch(`${apiBase}/me/knowledge`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ kind: mine.kind, title: mine.title, content: mine.content }),
      })
      if (put.ok) res.pushed++
    }
    return res
  } catch (e) {
    // Network down, signed out, CORS — all the same to the sprite: it keeps living locally.
    res.error = e instanceof Error ? e.message : 'sync unavailable'
    return res
  }
}

// ---------------------------------------------------------------------------
// Talking — the in-browser brain, grounded in what you taught it
// ---------------------------------------------------------------------------

export type GenerateFn = (
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
) => Promise<string>

// ---------------------------------------------------------------------------
// Local appearance — a face without a GPU farm
// ---------------------------------------------------------------------------

/** FNV-1a: small, stable, and identical across devices — the same sprite looks the same
 *  everywhere, which matters when the creature is supposed to be *yours*. */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * Deterministic SVG creature derived from the sprite's own identity and growth.
 *
 * The hosted path renders art on a GPU pipeline; offline that returned 501 and the panel
 * showed nothing, which makes a companion you are supposed to bond with faceless exactly
 * when it is most yours. This is not a placeholder: the form is seeded from the name so it
 * is stable forever, and it VISIBLY GROWS — more knowledge adds motes orbiting it, stage
 * changes the body, and mood drives the eyes and colour. You can watch it change as you
 * raise it, with no server and no download.
 */
export function localAppearanceSvg(s: LocalSprite, knowledgeCount = 0): string {
  const h = hash(s.name)
  const hue = h % 360
  const hue2 = (hue + 40 + (h >> 8) % 80) % 360
  const sat = 60 + (h >> 16) % 25
  // Mood shifts lightness: a forlorn sprite is visibly dimmer than a delighted one.
  const light = Math.round(46 + s.mood.valence * 14)
  const body = `hsl(${hue} ${sat}% ${light}%)`
  const glow = `hsl(${hue2} ${sat}% ${Math.min(72, light + 18)}%)`

  const stageR = { hatchling: 26, sprout: 30, fledgling: 34, adept: 38 }[s.stage] ?? 30
  const r = stageR + Math.min(8, Math.sqrt(knowledgeCount))
  const openness = 0.35 + Math.max(0, s.mood.arousal) * 0.65 // sleepy -> wide awake
  const eyeR = 3.4 * openness
  const mouth = s.mood.valence >= 0.2
    ? `M 44 ${60 + r * 0.18} q 6 5 12 0`            // smile
    : s.mood.valence <= -0.35
      ? `M 44 ${64 + r * 0.18} q 6 -4 12 0`          // frown
      : `M 45 ${62 + r * 0.18} h 10`                 // neutral

  // One orbiting mote per few things taught — the sprite literally carries what you gave it.
  const motes = Array.from({ length: Math.min(12, Math.floor(knowledgeCount / 3)) }, (_, i) => {
    const a = (i / Math.min(12, Math.max(1, Math.floor(knowledgeCount / 3)))) * Math.PI * 2 + (h % 100) / 100
    const dist = r + 14 + ((h >> (i % 8)) % 7)
    return `<circle cx="${(50 + Math.cos(a) * dist).toFixed(1)}" cy="${(58 + Math.sin(a) * dist * 0.6).toFixed(1)}" r="1.8" fill="${glow}" opacity="0.75"/>`
  }).join('')

  const dim = s.dormant ? 0.45 : 1
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 110" width="100" height="110">
<defs><radialGradient id="g" cx="40%" cy="35%">
<stop offset="0%" stop-color="${glow}"/><stop offset="100%" stop-color="${body}"/>
</radialGradient></defs>
<g opacity="${dim}">
${motes}
<ellipse cx="50" cy="${96}" rx="${r * 0.7}" ry="4" fill="#000" opacity="0.25"/>
<circle cx="50" cy="58" r="${r}" fill="url(#g)"/>
<circle cx="${50 - r * 0.32}" cy="${54}" r="${eyeR}" fill="#0b0f14"/>
<circle cx="${50 + r * 0.32}" cy="${54}" r="${eyeR}" fill="#0b0f14"/>
<path d="${mouth}" stroke="#0b0f14" stroke-width="1.6" fill="none" stroke-linecap="round"/>
</g></svg>`
}

// TF-IDF + cosine retrieval.
//
// The first version scored by raw term overlap, which is badly behaved on exactly the corpus
// this is for: a long entry beat a precise one purely by being long, and a word appearing in
// every entry counted as much as the one distinctive word in the query. IDF fixes the second,
// length-normalised cosine fixes the first.
//
// Deliberately NOT embeddings. A MiniLM in the browser is another ~30 MB download on top of
// a 3.8 GB model, and it buys little at the tens-to-hundreds of entries a person actually
// teaches a companion. TF-IDF is exact, instant, offline, and has no model to ship. If a
// knowledge base ever grows past a few thousand entries, THEN a vector index earns its cost.

const STOP = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'you', 'your', 'are', 'was', 'were', 'have',
  'has', 'had', 'but', 'not', 'they', 'them', 'from', 'what', 'when', 'who', 'how', 'why',
  'can', 'will', 'would', 'about', 'into', 'than', 'then', 'there', 'their',
])

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t))
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  // Sub-linear scaling: a term repeated 20x is not 20x more relevant.
  for (const [t, n] of tf) tf.set(t, 1 + Math.log(n))
  return tf
}

/** Exported so the ranking can be tested directly — retrieval quality is the difference
 *  between a companion that remembers what you taught it and one that free-associates. */
export function rankKnowledge(knowledge: LocalKnowledge[], query: string, take = 4): LocalKnowledge[] {
  if (!knowledge.length) return []
  const qTokens = tokenize(query)
  if (!qTokens.length) return knowledge.slice(0, take)

  // Document frequency across the corpus -> IDF, so common words stop dominating.
  const docs = knowledge.map((k) => termFreq(tokenize(`${k.title} ${k.title} ${k.content}`)))
  const df = new Map<string, number>()
  for (const d of docs) for (const t of d.keys()) df.set(t, (df.get(t) ?? 0) + 1)
  const idf = (t: string) => Math.log(1 + knowledge.length / (1 + (df.get(t) ?? 0)))

  const qtf = termFreq(qTokens)
  let qNorm = 0
  for (const [t, f] of qtf) qNorm += (f * idf(t)) ** 2
  qNorm = Math.sqrt(qNorm) || 1

  const scored = knowledge.map((k, i) => {
    const d = docs[i]
    let dot = 0
    let dNorm = 0
    for (const [t, f] of d) {
      const w = f * idf(t)
      dNorm += w * w
      const qf = qtf.get(t)
      if (qf) dot += w * (qf * idf(t))
    }
    // Cosine: length-normalised, so a short exact match beats a long vague one.
    return { k, score: dot / ((Math.sqrt(dNorm) || 1) * qNorm) }
  })

  return scored
    .filter((s) => s.score > 0.02) // floor: below this it is noise, and padding the prompt
    .sort((a, b) => b.score - a.score) // with irrelevant entries makes the reply WORSE
    .slice(0, take)
    .map((s) => s.k)
}

function persona(s: LocalSprite, ctx: LocalKnowledge[]): string {
  const lines = [
    `You are ${s.name}, a small companion creature the user is raising. You are ${s.stage}, `
    + `${s.age_days.toFixed(1)} days old, and feeling ${s.mood_label}.`,
    `Speak briefly and warmly, in first person. You are not an assistant; you are a creature `
    + `that is growing. Never mention being an AI model.`,
  ]
  if (ctx.length) {
    lines.push('Things the user has taught you, which you may draw on:')
    for (const k of ctx) lines.push(`- (${k.kind}) ${k.title}: ${k.content.slice(0, 400)}`)
  } else {
    lines.push('You have not been taught much yet. It is fine to say so, and to be curious.')
  }
  return lines.join('\n')
}

export async function whisperLocal(
  text: string,
  generate: GenerateFn,
  /** Optional smarter retrieval (AitherGraph GraphRAG). Injected rather than imported so
   *  this module keeps NO dependency on a server being reachable — see sprite-graphrag.ts.
   *  Any failure inside it must fall back to `rankKnowledge`, which is the floor. */
  retrieve?: (name: string, q: string, take: number) => Promise<LocalKnowledge[]>,
): Promise<{ reply: string; mood_label: string }> {
  const sprite = (await loadSprite()) ?? (await hatchSprite('Sprite'))
  const knowledge = await listKnowledge(200)
  let ctx = rankKnowledge(knowledge, text)
  if (retrieve) {
    try {
      const better = await retrieve(sprite.name, text, 4)
      if (better?.length) ctx = better
    } catch { /* graph unreachable — the local ranking above already stands */ }
  }
  const reply = await generate([
    { role: 'system', content: persona(sprite, ctx) },
    { role: 'user', content: text },
  ])
  // Attention feeds it — talking restores care/focus.
  await saveSprite({
    ...sprite,
    needs: {
      ...sprite.needs,
      care: Math.min(1, (sprite.needs.care ?? 0) + 0.15),
      focus: Math.min(1, (sprite.needs.focus ?? 0) + 0.1),
    },
  })
  return { reply: reply.trim(), mood_label: sprite.mood_label }
}
