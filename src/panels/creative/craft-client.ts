/**
 * The craft studio client — the Image Studio's ONE seam to the hosted customer lane.
 *
 * Craft brick B4 (.PLANS/craft-apps-over-mediaforge-2026-10-06.md); parity #3 canvas
 * draw/mask/inpaint, #22 library, #25 in-browser + desktop app.
 *
 * Every call goes to the host's `/api/iris/craft/*` (Veil: app/api/iris/craft/[...path]),
 * which forwards the caller's own bearer + the edge country to Iris `/craft/*`. Iris runs
 * every op through `mediaforge_ops.run_customer_op` — sellable allowlist, territory gate,
 * param sanitation, price, ACTA reserve -> settle / release. This client NEVER names a
 * media-forge path: not `/api/*` (the owner's ungated surface), not the `/api/mediaforge/`
 * relay, not `/api/studio/*`. A test pins that.
 *
 * Refusals are ANSWERS. `runCraftOp` resolves with the server's own `ok:false` body whatever
 * the status (402 out of credits, 451 territory, 200 bad params / engine failure), so the
 * studio can show the server's words and whether anything was charged. Only a transport
 * failure is reported as "did not complete" — and then the client does NOT claim nothing was
 * charged, because it cannot know.
 */

export interface CraftClientOptions {
  /** '' for same-origin (the host serves /api/iris/craft/*). */
  apiBase?: string
}

export interface CraftOpParam {
  name: string
  type: string
  default?: unknown
  min?: number | null
  max?: number | null
  choices?: string[] | null
  help?: string
}

export interface CraftOp {
  name: string
  label: string
  group: string
  summary: string
  /** Credits ONE unit costs (the list price). A call's total comes from the estimate. */
  credits: number
  params: CraftOpParam[]
  inputs: Array<{ name: string; type: string }>
}

export interface CraftCatalogue {
  craft: { id: string; name: string }
  live: boolean
  ops: CraftOp[]
  /** The shell's direct ops, and whether the engine serves each one right now. */
  shell_ops: Record<string, boolean>
  credits_per_usd?: number
  buy_url?: string
}

export interface LibraryMedia {
  id: number
  op: string
  has_preview: boolean
  url: string | null
  folder_id: string | null
  source_id: number | null
  created: number
}

export interface LibraryFolder { id: string; name: string; created: number }
export interface LibraryCharacter { id: string; name: string; media_ids: number[]; created: number }

export interface CraftLibrary {
  media: LibraryMedia[]
  folders: LibraryFolder[]
  characters: LibraryCharacter[]
}

export interface CraftEstimate {
  ok: boolean
  op?: string
  credits?: number
  units?: number
  list_price?: number
  engine_estimate?: Record<string, unknown> | null
  engine_mismatch?: boolean
  error?: string
  error_code?: string
  buy_url?: string
}

export interface CraftOpResult {
  ok: boolean
  error?: string
  error_code?: string
  credits_charged: number
  units?: number
  buy_url?: string
  required?: number
  available?: number
  licence_url?: string | null
  unmetered?: boolean
  media: LibraryMedia[]
  /** True when the request itself failed: the outcome (and any charge) is unknown. */
  transport?: boolean
}

/** Thrown for a non-op call (library, catalogue) that failed; `message` is the server's words. */
export class CraftError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'CraftError'
    this.status = status
  }
}

function root(o: CraftClientOptions): string {
  return `${o.apiBase ?? ''}/api/iris/craft`
}

/** The words a JSON error body carries: `error`, `detail` (string), or `detail.error`. */
export function serverWords(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if (typeof b.error === 'string' && b.error) return b.error
    const d = b.detail
    if (typeof d === 'string' && d) return d
    if (d && typeof d === 'object') {
      const de = (d as Record<string, unknown>).error
      if (typeof de === 'string' && de) return de
    }
    if (typeof b.message === 'string' && b.message) return b.message
  }
  if (status === 401) return 'Sign in to use the Image Studio; hosted edits are paid with credits.'
  return `The studio answered HTTP ${status}.`
}

async function call(o: CraftClientOptions, path: string, init: { method?: string; body?: unknown } = {}
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${root(o)}${path}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined
      ? { Accept: 'application/json' }
      : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { status: res.status, body }
}

async function callOk<T>(o: CraftClientOptions, path: string, init: { method?: string; body?: unknown } = {}
): Promise<T> {
  let r: { status: number; body: unknown }
  try {
    r = await call(o, path, init)
  } catch (e) {
    throw new CraftError(`The studio did not answer (${String(e)}).`, 0)
  }
  if (r.status < 200 || r.status >= 300) throw new CraftError(serverWords(r.body, r.status), r.status)
  return r.body as T
}

export function listCraftOps(o: CraftClientOptions, craft = 'image-studio'): Promise<CraftCatalogue> {
  return callOk<CraftCatalogue>(o, `/ops?craft=${encodeURIComponent(craft)}`)
}

export function getLibrary(o: CraftClientOptions): Promise<CraftLibrary> {
  return callOk<CraftLibrary>(o, '/library')
}

export function createFolder(o: CraftClientOptions, name: string): Promise<LibraryFolder> {
  return callOk<LibraryFolder>(o, '/library/folders', { method: 'POST', body: { name } })
}

export function deleteFolder(o: CraftClientOptions, id: string): Promise<{ ok: boolean }> {
  return callOk(o, `/library/folders/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function moveMedia(o: CraftClientOptions, mediaId: number, folderId: string | null
): Promise<{ ok: boolean }> {
  return callOk(o, `/library/media/${Math.trunc(mediaId)}/move`, { method: 'POST', body: { folder_id: folderId } })
}

export function createCharacter(o: CraftClientOptions, name: string, mediaIds: number[]
): Promise<LibraryCharacter> {
  return callOk<LibraryCharacter>(o, '/library/characters', { method: 'POST', body: { name, media_ids: mediaIds } })
}

export function deleteCharacter(o: CraftClientOptions, id: string): Promise<{ ok: boolean }> {
  return callOk(o, `/library/characters/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * What a run would cost. Resolves `null` when the estimate route itself is unavailable
 * (an older Iris, a transport failure) so the studio falls back to the list price; resolves
 * the server's `ok:false` body when the server REFUSED the call (that refusal is the answer).
 */
export async function estimate(o: CraftClientOptions, op: string, params: Record<string, unknown>
): Promise<CraftEstimate | null> {
  let r: { status: number; body: unknown }
  try {
    r = await call(o, '/estimate', { method: 'POST', body: { op, params } })
  } catch {
    return null
  }
  if (r.status === 404 || r.status === 405) return null
  const b = r.body as CraftEstimate | null
  if (!b || typeof b !== 'object' || typeof b.ok !== 'boolean') return null
  if (!b.ok && !b.error) return { ...b, error: serverWords(r.body, r.status) }
  return b
}

/** Run ONE op. Never throws: a refusal or failure resolves with the server's own words. */
export async function runCraftOp(
  o: CraftClientOptions,
  op: string,
  params: Record<string, unknown>,
  folderId: string | null = null,
): Promise<CraftOpResult> {
  let r: { status: number; body: unknown }
  try {
    r = await call(o, `/op/${encodeURIComponent(op)}`, {
      method: 'POST',
      body: folderId ? { params, folder_id: folderId } : { params },
    })
  } catch (e) {
    return {
      ok: false, transport: true, credits_charged: 0, media: [],
      error: `The request did not complete (${String(e)}). Check your library before running it again.`,
    }
  }
  const b = (r.body && typeof r.body === 'object' ? r.body : {}) as Partial<CraftOpResult>
  const ok = b.ok === true && r.status >= 200 && r.status < 300
  return {
    ...b,
    ok,
    credits_charged: typeof b.credits_charged === 'number' ? b.credits_charged : 0,
    media: Array.isArray(b.media) ? b.media : [],
    error: ok ? b.error : (b.error || serverWords(r.body, r.status)),
  }
}

/** The `<img src>` for a library item: the proxied, owner-checked route, never an engine path. */
export function mediaSrc(o: CraftClientOptions, m: Pick<LibraryMedia, 'url'>): string | null {
  if (!m.url || !m.url.startsWith('/craft/media/')) return null
  return `${o.apiBase ?? ''}/api/iris${m.url}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Studio shaping — pure, so the tests can pin them
// ─────────────────────────────────────────────────────────────────────────────

/** The four things the canvas drives. Each maps to one op on the hosted allowlist. */
export type StudioAction = 'inpaint' | 'edit_instruct' | 'remove_bg' | 'txt2img'

export const STUDIO_ACTIONS: ReadonlyArray<{ id: StudioAction; label: string; needsImage: boolean; needsMask: boolean; needsText: boolean }> = [
  { id: 'inpaint', label: 'Inpaint the mask', needsImage: true, needsMask: true, needsText: true },
  { id: 'edit_instruct', label: 'Edit by instruction', needsImage: true, needsMask: false, needsText: true },
  { id: 'remove_bg', label: 'Remove background', needsImage: true, needsMask: false, needsText: false },
  { id: 'txt2img', label: 'New image', needsImage: false, needsMask: false, needsText: true },
]

export interface StudioInputs {
  imageId: number | null
  text: string
  maskDataUrl: string | null
  bg?: string
}

/**
 * The op body for an action, built against the op's LIVE param list where it matters.
 * `edit_instruct` takes its sentence as `instruction` when the engine declares that param,
 * else as `prompt` (the instruction-edit op is a parallel brick; its param name is read,
 * not assumed). Returns a refusal string instead when the inputs cannot make a valid call.
 */
export function buildActionParams(
  action: StudioAction,
  inputs: StudioInputs,
  spec?: Pick<CraftOp, 'params'> | null,
): { params: Record<string, unknown> } | { refusal: string } {
  const meta = STUDIO_ACTIONS.find(a => a.id === action)
  if (!meta) return { refusal: `unknown action ${action}` }
  const text = inputs.text.trim()
  if (meta.needsImage && inputs.imageId == null) return { refusal: 'Pick an image from your library first.' }
  if (meta.needsMask && !inputs.maskDataUrl) return { refusal: 'Paint the area to change first.' }
  if (meta.needsText && !text) {
    return { refusal: action === 'edit_instruct' ? 'Say what to change.' : 'Describe what to paint.' }
  }
  switch (action) {
    case 'inpaint':
      return { params: { image: inputs.imageId, prompt: text, mask: inputs.maskDataUrl } }
    case 'edit_instruct': {
      const names = new Set((spec?.params ?? []).map(p => p.name))
      const key = names.has('instruction') ? 'instruction' : 'prompt'
      return { params: { image: inputs.imageId, [key]: text } }
    }
    case 'remove_bg':
      return { params: inputs.bg ? { image: inputs.imageId, bg: inputs.bg } : { image: inputs.imageId } }
    case 'txt2img':
      return { params: { prompt: text } }
  }
}

/** The line shown above the Run button. Never claims a number the server did not give. */
export function costLine(est: CraftEstimate | null, listPrice: number | null | undefined): string {
  if (est && est.ok && typeof est.credits === 'number') {
    const units = typeof est.units === 'number' && est.units > 1 ? ` (${est.units} units)` : ''
    return est.credits === 0 ? 'This run is free.' : `This run costs ${est.credits} credits${units}.`
  }
  if (est && !est.ok) return est.error || 'The studio refused this run.'
  if (typeof listPrice === 'number') {
    return `Estimate unavailable — list price ${listPrice} credits per unit; size and count can multiply it.`
  }
  return 'Estimate unavailable.'
}

/** What to show after a run that did not succeed: the server's words + what happened to credits. */
export function outcomeText(r: CraftOpResult): string {
  if (r.ok) {
    if (r.unmetered) return 'Done (operator run, not metered).'
    return r.credits_charged > 0 ? `Done — ${r.credits_charged} credits charged.` : 'Done — nothing was charged.'
  }
  const words = r.error || 'The studio refused this run.'
  if (r.transport) return words
  const charged = r.credits_charged > 0
    ? ` ${r.credits_charged} credits were charged.`
    : ' Nothing was charged.'
  return `${words}${charged}`
}

/** Media in one folder (null = the root), newest first, as the server ordered them. */
export function mediaInFolder(lib: CraftLibrary, folderId: string | null): LibraryMedia[] {
  return lib.media.filter(m => (m.folder_id ?? null) === folderId)
}

/**
 * A painted overlay -> the engine's mask: white where painted (alpha > 0), black elsewhere,
 * fully opaque. media-forge's inpaint reads a PNG data URL with white = repaint.
 */
export function alphaToMask(rgba: Uint8ClampedArray) {
  const out = new Uint8ClampedArray(rgba.length)
  for (let i = 0; i < rgba.length; i += 4) {
    const v = rgba[i + 3] > 0 ? 255 : 0
    out[i] = v
    out[i + 1] = v
    out[i + 2] = v
    out[i + 3] = 255
  }
  return out
}

/** Fraction of pixels painted (alpha > 0) — 0 means there is no mask to send. */
export function maskCoverage(rgba: Uint8ClampedArray): number {
  const n = rgba.length / 4
  if (n === 0) return 0
  let painted = 0
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 0) painted++
  return painted / n
}
