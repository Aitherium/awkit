/**
 * The Image Studio's phone rules — pure, so the tests pin them.
 *
 * On a phone the studio is ONE job: type what you want, tap Generate, see the results. Every
 * other knob (size, count, model, steps, seed, LoRA, ...) lives behind one "Options" sheet and
 * starts at the server's own default. The rules here decide what that sheet offers, what one
 * Generate tap sends, what the Options button says at a glance, when the studio must say the
 * image service is offline or busy (never a spinner forever), and how far the on-screen
 * keyboard pushes the prompt up.
 *
 * Nothing here is a boundary: the server (Iris /craft -> run_customer_op) clamps every
 * number and refuses any key the op does not declare. These rules only keep the phone from
 * sending a call the server would refuse, and keep the defaults the server's.
 */

import type {
  CraftCatalogue, CraftEstimate, CraftOp, CraftOpParam, CraftOpResult, LibraryMedia,
} from './craft-client'

// ── size ─────────────────────────────────────────────────────────────────────

export type SizeId = 'square' | 'portrait' | 'landscape'

export interface SizePreset { id: SizeId; label: string; width: number; height: number }

export const DEFAULT_SIZE: SizeId = 'square'

/** SDXL-family buckets: ~1 MP each, so a preset never multiplies the price by itself. */
const PRESETS: ReadonlyArray<SizePreset> = [
  { id: 'square', label: 'Square', width: 1024, height: 1024 },
  { id: 'portrait', label: 'Portrait', width: 832, height: 1216 },
  { id: 'landscape', label: 'Landscape', width: 1216, height: 832 },
]

function paramMap(spec: Pick<CraftOp, 'params'> | null | undefined): Map<string, CraftOpParam> {
  const m = new Map<string, CraftOpParam>()
  for (const p of spec?.params ?? []) if (p && typeof p.name === 'string') m.set(p.name, p)
  return m
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function clampTo(p: CraftOpParam | undefined, v: number): number {
  let out = v
  if (p && isNum(p.min)) out = Math.max(p.min, out)
  if (p && isNum(p.max)) out = Math.min(p.max, out)
  return p?.type === 'int' ? Math.round(out) : out
}

/** The size choices the op can take, clamped into its bounds. [] when it declares no width/height. */
export function sizePresets(spec: Pick<CraftOp, 'params'> | null | undefined): SizePreset[] {
  const m = paramMap(spec)
  const w = m.get('width')
  const h = m.get('height')
  if (!w || !h) return []
  return PRESETS.map(s => ({ ...s, width: clampTo(w, s.width), height: clampTo(h, s.height) }))
}

/** `{width, height}` for a preset id, or {} when the op has no such preset. */
export function sizeValues(id: string, spec: Pick<CraftOp, 'params'> | null | undefined): Record<string, number> {
  const s = sizePresets(spec).find(p => p.id === id)
  return s ? { width: s.width, height: s.height } : {}
}

// ── the Options sheet ────────────────────────────────────────────────────────

export type OptionKind = 'choice' | 'number' | 'text' | 'toggle'

export interface OptionField {
  name: string
  label: string
  kind: OptionKind
  default?: unknown
  min?: number
  max?: number
  choices?: string[]
  help?: string
}

/** Params the sheet never shows: the prompt has its own box, the size pair has the presets. */
const NOT_OPTIONS = new Set(['prompt', 'width', 'height'])
/** Media inputs and opaque blobs are not phone options. */
const SKIP_TYPES = new Set(['image', 'video', 'audio', 'mask', 'media', 'file', 'json', 'list', 'dict'])
/** Most-used first; anything else follows in the order the engine declared it. */
const PRIORITY = ['count', 'model', 'lora', 'style', 'steps', 'cfg', 'guidance', 'seed', 'negative_prompt']
const LABELS: Record<string, string> = {
  count: 'Images', negative_prompt: 'Avoid', lora: 'LoRA', cfg: 'Guidance', cfg_scale: 'Guidance',
}

function labelFor(name: string): string {
  if (LABELS[name]) return LABELS[name]
  const words = name.replace(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function kindFor(p: CraftOpParam): OptionKind | null {
  const t = String(p.type || '').toLowerCase()
  if (SKIP_TYPES.has(t)) return null
  if (Array.isArray(p.choices) && p.choices.length > 0) return 'choice'
  if (t === 'int' || t === 'float' || t === 'number') return 'number'
  if (t === 'bool' || t === 'boolean') return 'toggle'
  if (t === 'str' || t === 'string' || t === 'text') return 'text'
  return null
}

/** Every knob the op declares that belongs in the Options sheet, most-used first. */
export function optionFields(spec: Pick<CraftOp, 'params'> | null | undefined): OptionField[] {
  const out: OptionField[] = []
  for (const p of spec?.params ?? []) {
    if (!p || NOT_OPTIONS.has(p.name)) continue
    const kind = kindFor(p)
    if (!kind) continue
    const f: OptionField = { name: p.name, label: labelFor(p.name), kind }
    if (p.default !== undefined) f.default = p.default
    if (isNum(p.min)) f.min = p.min
    if (isNum(p.max)) f.max = p.max
    if (kind === 'choice') f.choices = (p.choices ?? []).map(String)
    if (p.help) f.help = p.help
    out.push(f)
  }
  const rank = (n: string) => {
    const i = PRIORITY.indexOf(n)
    return i < 0 ? PRIORITY.length : i
  }
  return out
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f.name) - rank(b.f.name) || a.i - b.i)
    .map(x => x.f)
}

/** One option value as the server would take it, or undefined when it should not be sent. */
function cleanValue(p: CraftOpParam, raw: unknown): unknown {
  const kind = kindFor(p) ?? (p.name === 'width' || p.name === 'height' ? 'number' : null)
  if (!kind) return undefined
  if (kind === 'number') {
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
    if (!Number.isFinite(n)) return undefined
    return clampTo(p, n)
  }
  if (kind === 'toggle') return raw === true || raw === 'true'
  const s = raw == null ? '' : String(raw).trim()
  if (!s) return undefined
  if (kind === 'choice' && !(p.choices ?? []).map(String).includes(s)) return undefined
  return s
}

/**
 * The txt2img body for one Generate tap. Only the prompt plus the options the person
 * CHANGED: a value equal to the declared default, a blank, or a key the op does not declare
 * is not sent, so the server's defaults apply.
 */
export function buildGenerateParams(
  prompt: string,
  options: Record<string, unknown>,
  spec: Pick<CraftOp, 'params'> | null | undefined,
): { params: Record<string, unknown> } | { refusal: string } {
  const text = prompt.trim()
  if (!text) return { refusal: 'Type what to make first.' }
  const params: Record<string, unknown> = { prompt: text }
  const m = paramMap(spec)
  for (const [k, raw] of Object.entries(options)) {
    if (k === 'prompt') continue
    const p = m.get(k)
    if (!p) continue
    const v = cleanValue(p, raw)
    if (v === undefined) continue
    if (p.default !== undefined && v === p.default) continue
    if (p.default === undefined && v === false) continue
    params[k] = v
  }
  return { params }
}

/** What the Options button says: the size, the count, then how many other knobs moved. */
export function optionsSummary(options: Record<string, unknown>, spec: Pick<CraftOp, 'params'> | null | undefined): string {
  const presets = sizePresets(spec)
  const fields = optionFields(spec)
  if (presets.length === 0 && fields.length === 0) return 'Options'
  const parts: string[] = []
  if (presets.length) {
    const w = isNum(options.width) ? options.width : presets[0].width
    const h = isNum(options.height) ? options.height : presets[0].height
    const hit = presets.find(p => p.width === w && p.height === h)
    parts.push(hit ? hit.label : `${w}×${h}`)
  }
  const sent = buildGenerateParams('x', options, spec)
  const changed = 'params' in sent ? Object.keys(sent.params).filter(k => !['prompt', 'width', 'height'].includes(k)) : []
  if (changed.includes('count')) {
    const n = (sent as { params: Record<string, unknown> }).params.count
    parts.push(`${n} image${n === 1 ? '' : 's'}`)
  }
  const others = changed.filter(k => k !== 'count').length
  if (others > 0) parts.push(`+${others}`)
  return parts.length ? parts.join(' · ') : 'Options'
}

// ── is the image service there? ──────────────────────────────────────────────

export type ServiceState = 'loading' | 'ready' | 'busy' | 'offline'

const ENGINE_DOWN = new Set([
  'engine_unavailable', 'engine_busy', 'engine_error', 'engine_timeout', 'timeout', 'gpu_unavailable',
  'gpu_busy', 'upstream_unavailable', 'service_unavailable',
])

/** A refusal code that means the ENGINE could not take the job (not the caller's credits/params). */
export function isEngineDownCode(code: string | undefined | null): boolean {
  return !!code && ENGINE_DOWN.has(code)
}

/**
 * The one line the phone shows above the prompt. `loading` until the catalogue answers;
 * `offline` when it could not load or the engine does not serve generation; `busy` after a
 * run the engine could not take or that never answered; `ready` otherwise (text '').
 */
export function serviceStatus(
  catalogue: CraftCatalogue | null,
  loadError: string | null,
  last: Pick<CraftOpResult, 'ok' | 'error_code' | 'transport'> & { credits_charged?: number } | null,
): { state: ServiceState; text: string } {
  if (!catalogue) {
    if (loadError) return { state: 'offline', text: `Image service offline — ${loadError}` }
    return { state: 'loading', text: '' }
  }
  if (catalogue.live === false || catalogue.shell_ops?.txt2img === false) {
    return { state: 'offline', text: 'Image service offline right now. Your images are safe; try again later.' }
  }
  if (last && !last.ok && last.transport) {
    return { state: 'busy', text: 'Image service did not answer. It may still finish — check your images before trying again.' }
  }
  if (last && !last.ok && isEngineDownCode(last.error_code)) {
    const charged = last.credits_charged && last.credits_charged > 0 ? '' : ' Nothing was charged;'
    return { state: 'busy', text: `Image service is busy or offline.${charged} try again in a minute.` }
  }
  return { state: 'ready', text: '' }
}

// ── the phone itself ─────────────────────────────────────────────────────────

/**
 * How many CSS px at the bottom of a box the on-screen keyboard covers: the box bottom minus the
 * visual viewport's bottom. On Android (interactive-widget=resizes-content) the layout already
 * shrank, so this is 0; on iOS it is the keyboard. Under 80 px is the browser toolbar, not a keyboard.
 */
export function keyboardInset(layoutBottom: number, visualHeight: number, visualOffsetTop: number): number {
  const covered = Math.round(layoutBottom - visualHeight - visualOffsetTop)
  return covered >= 80 ? covered : 0
}

/** Two big tiles on a phone in portrait, more as the window widens. */
export function gridColumns(width: number): number {
  if (width >= 760) return 4
  if (width >= 520) return 3
  return 2
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

/** The file name Save writes: the image id and its real type. */
export function saveName(m: Pick<LibraryMedia, 'id' | 'op'>, mime: string): string {
  return `aither-image-${m.id}.${EXT[(mime || '').split(';')[0].trim().toLowerCase()] ?? 'png'}`
}

/** The price in a few words, for next to Generate. Never claims a number the server did not give. */
export function shortCost(est: CraftEstimate | null, listPrice: number | null | undefined): string {
  if (est && est.ok && typeof est.credits === 'number') return est.credits === 0 ? 'Free' : `${est.credits} credits`
  if (est && !est.ok) return est.error || 'The studio refused this run.'
  if (typeof listPrice === 'number') return `from ${listPrice} credits`
  return ''
}
