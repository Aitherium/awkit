/**
 * The Studio client — media-forge's CURATED op surface, through the host proxy.
 *
 * Two things about this seam are load-bearing and easy to get wrong:
 *
 * 1. The catalogue is LIVE, not a list in this file. `GET /ops` self-describes
 *    every op with its params, and `agents/Iris/tool_agent.py` turns the same
 *    manifest into function tools — so the panel and Iris share ONE catalogue and
 *    every op media-forge ships is in the panel the moment it ships, with no
 *    awkit release. A hard-coded family list (which the skeleton panel had) goes
 *    stale silently and shows the customer ops that no longer exist.
 *
 * 2. `/ops` + `/op/{name}` are the AitherSafety-tiered TWINS. media-forge also
 *    serves `/api/ops` + `/api/op/{name}` — the owner's own ungated surface, with
 *    the restricted ops in it. Customer traffic must never reach those, so this
 *    client speaks only to the host proxy, and the proxy speaks only to the
 *    curated paths (`lib/integration/mediaforge_ops.py` says the same thing on the
 *    Python side).
 *
 * The curated `POST /op/{name}` is SYNCHRONOUS: it wraps the op in a one-node
 * recipe and awaits `run_recipe` to completion, returning
 * `{ok, head_ids, images, node_outputs}`. There is no job id to poll on the
 * curated surface — `/api/jobs` is on the owner-private one. So a heavy op is a
 * long request, and the panel's job is to SAY so and keep the elapsed time
 * visible, not to invent a poll against a job id that does not exist.
 */

import { fetchJson, PanelError } from './fetching'
import type { ForgeOp, ForgeOpParam, ForgeOpResult } from './types'

export interface StudioClientOptions {
  apiBase?: string
}

function base(o: StudioClientOptions): string {
  return `${o.apiBase ?? ''}/api/studio`
}

export interface StudioHealth {
  ok: boolean
  backend: string
  ops?: number
  error?: string
}

/** GET /api/studio/health — is media-forge answering, and as whom. */
export async function getHealth(o: StudioClientOptions = {}): Promise<StudioHealth> {
  return fetchJson<StudioHealth>(`${base(o)}/health`, { timeoutMs: 8000 })
}

/** GET /api/studio/ops — the curated catalogue, verbatim. */
export async function listOps(o: StudioClientOptions = {}): Promise<{ ops: ForgeOp[]; backend: string }> {
  const data = await fetchJson<{ ops?: ForgeOp[]; backend?: string }>(`${base(o)}/ops`, { timeoutMs: 20000 })
  return { ops: Array.isArray(data.ops) ? data.ops : [], backend: data.backend || 'media-forge' }
}

/**
 * POST /api/studio/op/{name}.
 *
 * Resolves with the result even when `ok:false` — a refusal (an op the safety tier
 * does not allow at this level, an unknown op) is an ANSWER, and the card must show
 * media-forge's own words for it. Only a transport failure throws.
 */
export async function runOp(
  o: StudioClientOptions,
  name: string,
  params: Record<string, unknown>,
  timeoutMs = 900000,
): Promise<ForgeOpResult> {
  try {
    return await fetchJson<ForgeOpResult>(`${base(o)}/op/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: params,
      timeoutMs,
    })
  } catch (e) {
    if (e instanceof PanelError && e.kind === 'refused') {
      return { ok: false, error: e.detail }
    }
    throw e
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalogue shaping — families, cost, and forms
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The customer-facing family a live op belongs to.
 *
 * media-forge's own `group` is engine-shaped (generate / edit / compose / enhance /
 * analyze / video / tune). The families the product sells are subject-shaped —
 * sprites, pixel, tileset, material, 3D/voxel, rig, animate, comic, VN, storyboard,
 * audio — so the mapping is by op NAME first (the named ops the product story lists)
 * and falls back to the engine group. An op that matches nothing lands in "More",
 * VISIBLE: an op that media-forge serves and the panel hides is a capability the
 * customer paid for and cannot find.
 */
export interface OpFamily {
  id: string
  label: string
  blurb: string
  ops: ForgeOp[]
}

const FAMILY_RULES: Array<{ id: string; label: string; blurb: string; match: RegExp }> = [
  { id: 'sprites', label: 'Sprites', blurb: 'Characters and props as game-ready sprites.', match: /sprite|enemy_sprite|autosprite|portrait/i },
  { id: 'pixel', label: 'Pixel art', blurb: 'True pixel output, and pixel-snapping an existing image.', match: /pixel/i },
  { id: 'tileset', label: 'Tilesets', blurb: 'Tiles that repeat without a seam.', match: /tile|parallax/i },
  { id: 'material', label: 'Materials', blurb: 'PBR maps and surface material sets.', match: /material|texture|pbr/i },
  { id: '3d', label: '3D & voxel', blurb: 'Meshes, voxels and game-engine exports.', match: /voxel|mesh|3d|glb|gltf|export_to_game|make_playable/i },
  { id: 'rig', label: 'Rigging', blurb: 'Skeletons, rig repair and pose transfer.', match: /rig|pose|skeleton|retarget/i },
  { id: 'animate', label: 'Animation', blurb: 'Motion, lipsync and video from stills.', match: /animate|flf2v|motion|lipsync|video|anim/i },
  { id: 'comic', label: 'Comic', blurb: 'Pages, panels and placement.', match: /comic|panel|page/i },
  { id: 'vn', label: 'Visual novel', blurb: 'Backgrounds, sprites and expression sets for a VN.', match: /^vn|visual_novel|expression/i },
  { id: 'storyboard', label: 'Storyboard', blurb: 'Beats to boards to a shot list.', match: /storyboard|screenplay|timeline|keyframe|title_card|end_card/i },
  { id: 'audio', label: 'Audio', blurb: 'Beds, loops, effects and mixes.', match: /audio|sfx|music|voice|tts|subtitle/i },
]

const GROUP_FAMILY: Record<string, { id: string; label: string; blurb: string }> = {
  generate: { id: 'generate', label: 'Generate', blurb: 'Make a new image from a prompt.' },
  edit: { id: 'edit', label: 'Edit', blurb: 'Change an image you already have.' },
  compose: { id: 'compose', label: 'Compose', blurb: 'Combine several images into one.' },
  enhance: { id: 'enhance', label: 'Enhance', blurb: 'Upscale, clean up and refine.' },
  analyze: { id: 'analyze', label: 'Analyze', blurb: 'Ask questions about an image.' },
  video: { id: 'video', label: 'Video', blurb: 'Video in, video out.' },
  tune: { id: 'tune', label: 'Train', blurb: 'Datasets and LoRA training.' },
}

export function groupOps(ops: ForgeOp[]): OpFamily[] {
  const families = new Map<string, OpFamily>()
  const push = (id: string, label: string, blurb: string, op: ForgeOp) => {
    const existing = families.get(id)
    if (existing) existing.ops.push(op)
    else families.set(id, { id, label, blurb, ops: [op] })
  }

  for (const op of ops) {
    const rule = FAMILY_RULES.find(r => r.match.test(op.name) || r.match.test(op.label || ''))
    if (rule) {
      push(rule.id, rule.label, rule.blurb, op)
      continue
    }
    const byGroup = GROUP_FAMILY[op.group]
    if (byGroup) push(byGroup.id, byGroup.label, byGroup.blurb, op)
    else push('more', 'More', 'Everything else this Studio is currently serving.', op)
  }

  const order = [...FAMILY_RULES.map(r => r.id), ...Object.keys(GROUP_FAMILY), 'more']
  return [...families.values()].sort(
    (a, b) => order.indexOf(a.id) - order.indexOf(b.id),
  )
}

/** True for the ops whose honest answer is "this takes minutes". */
export function isHeavy(op: ForgeOp): boolean {
  return op.cost === 'heavy'
}

export function costLabel(op: ForgeOp): string {
  if (op.cost === 'heavy') return 'minutes'
  if (op.cost === 'cheap') return 'seconds'
  return 'GPU'
}

/** The params a form should actually render, with the un-fillable ones dropped. */
export function formParams(op: ForgeOp): ForgeOpParam[] {
  const params = op.params || []
  // `box`/`mask` need a canvas selection this panel does not have; showing an empty
  // text box for them would collect a value the op cannot use.
  return params.filter(p => p.type !== 'box' && p.type !== 'mask')
}

/** The params a form CANNOT offer, so the card can say why an op is partly usable. */
export function unsupportedParams(op: ForgeOp): ForgeOpParam[] {
  return (op.params || []).filter(p => p.type === 'box' || p.type === 'mask')
}

/** The op's default value for a param, coerced to something an input can hold. */
export function defaultValue(p: ForgeOpParam): string | number | boolean {
  if (p.default === null || p.default === undefined) {
    if (p.type === 'bool') return false
    if (p.type === 'int' || p.type === 'float' || p.type === 'seed') return ''
    if (p.type === 'enum' || p.type === 'style') return p.choices?.[0] ?? ''
    return ''
  }
  if (typeof p.default === 'boolean' || typeof p.default === 'number') return p.default
  return String(p.default)
}

/**
 * Turn the form state into the op body.
 *
 * An empty string is DROPPED rather than sent: media-forge fills a missing param
 * with the op's own default, while an explicit `""` overrides that default with
 * nothing — which is how "I left the seed blank" turns into "seed 0, every render
 * identical".
 */
export function buildOpBody(
  op: ForgeOp,
  values: Record<string, string | number | boolean>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const p of formParams(op)) {
    const v = values[p.name]
    if (v === '' || v === undefined || v === null) continue
    if (p.type === 'int' || p.type === 'seed') {
      const n = typeof v === 'number' ? v : parseInt(String(v), 10)
      if (!Number.isNaN(n)) body[p.name] = n
      continue
    }
    if (p.type === 'float') {
      const n = typeof v === 'number' ? v : parseFloat(String(v))
      if (!Number.isNaN(n)) body[p.name] = n
      continue
    }
    if (p.type === 'bool') {
      body[p.name] = Boolean(v)
      continue
    }
    body[p.name] = v
  }
  return body
}

/**
 * Rewrite media-forge's media paths onto the host proxy.
 *
 * `run_recipe` returns `/media/...` URLs relative to media-forge, which lives on
 * the tailnet at 100.64.0.31:8200 and is NOT reachable from a customer's browser.
 * Pointing an `<img src>` at it draws a broken image that looks like a failed
 * render; the proxy route is the only way the picture actually arrives.
 */
export function mediaUrl(o: StudioClientOptions, url: string): string {
  if (!url) return ''
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:')) return url
  const path = url.replace(/^\/+/, '')
  return `${base(o)}/media/${path}`
}
