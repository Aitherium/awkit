/**
 * Play -> Studio handoff: "illustrate this beat".
 *
 * The two panels are separate WINDOWS on the Living Desktop, mounted by
 * DynamicPanelRenderer with no shared parent, so a prop cannot carry the beat from
 * one to the other. Veil's `@aitheros/creative-core` hub does carry handoffs, but
 * awkit must not depend on it: awkit is published on its own and is mounted in
 * Electron and plain-browser hosts where Veil's provider does not exist. So the bus
 * is a DOM CustomEvent, and the Veil wiring is an OPTIONAL prop on top of it.
 *
 * The action vocabulary is deliberately the SAME WORD as creative-core's
 * `SendToOptions['action']` union (`render` was added there for this handoff) so a
 * reader does not have to learn two names for one verb.
 *
 * RB012's rule — a consumer that branches on a handoff action maps it through a
 * `Record<HandoffAction, …>` so an added member breaks the BUILD rather than being
 * silently coerced — is honoured here by `HANDOFF_FORM`, which is the only place
 * this package turns an action into behaviour.
 */

import type { ForgeOp } from './types'

/** The verbs a creative handoff can carry. Mirrors creative-core's action union. */
export type HandoffAction =
  | 'edit' | 'refine' | 'reference' | 'img2img' | 'inpaint'
  | 'illustrate' | 'visualize' | 'render'

export interface CreativeHandoff {
  action: HandoffAction
  /** The prose this beat is made of — becomes the op's prompt. */
  text: string
  /** Named characters/entities present in the beat, for identity-locked ops. */
  characterRefs?: string[]
  /** An image already in play (a previous render) the op should start from. */
  imageUrl?: string
  /** Where it came from, for the Studio card's provenance line. */
  source?: string
  /** The world the beat belongs to, so the Studio card can say so. */
  world?: string
}

/**
 * How the Studio should OPEN for each action.
 *
 * `Record<HandoffAction, …>` is the guard, exactly as in canvas-view.tsx: add a
 * ninth verb to the union and this stops compiling, instead of the Studio quietly
 * opening the wrong form for it.
 */
export const HANDOFF_FORM: Record<HandoffAction, { group: string; preferOps: string[]; title: string }> = {
  render:     { group: 'generate', preferOps: ['scene_illustrate', 'txt2img', 'generate'], title: 'Illustrate this beat' },
  illustrate: { group: 'generate', preferOps: ['scene_illustrate', 'txt2img', 'generate'], title: 'Illustrate this beat' },
  visualize:  { group: 'generate', preferOps: ['storyboard', 'scene_illustrate', 'txt2img'], title: 'Visualize this scene' },
  img2img:    { group: 'edit',     preferOps: ['img2img', 'refine'], title: 'Re-render from this image' },
  edit:       { group: 'edit',     preferOps: ['img2img', 'refine'], title: 'Edit this image' },
  refine:     { group: 'enhance',  preferOps: ['refine', 'upscale'], title: 'Refine this image' },
  reference:  { group: 'generate', preferOps: ['compose', 'txt2img'], title: 'Use as a reference' },
  inpaint:    { group: 'edit',     preferOps: ['inpaint'], title: 'Paint into this image' },
}

/** The event name on `window`. Namespaced so it cannot collide with a host app's. */
export const CREATIVE_HANDOFF_EVENT = 'aitheros:creative-handoff'

/** Publish a handoff. No-op outside a browser (SSR/tests) rather than throwing. */
export function publishHandoff(handoff: CreativeHandoff): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
  window.dispatchEvent(new CustomEvent<CreativeHandoff>(CREATIVE_HANDOFF_EVENT, { detail: handoff }))
}

/** Subscribe. Returns the unsubscribe function (safe to call in a React cleanup). */
export function subscribeHandoff(fn: (handoff: CreativeHandoff) => void): () => void {
  if (typeof window === 'undefined') return () => { /* SSR: nothing to unsubscribe */ }
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<CreativeHandoff>).detail
    if (detail && typeof detail.text === 'string') fn(detail)
  }
  window.addEventListener(CREATIVE_HANDOFF_EVENT, listener)
  return () => window.removeEventListener(CREATIVE_HANDOFF_EVENT, listener)
}

/**
 * Pick the op a handoff should open, from the catalogue that is actually LIVE.
 *
 * Preference order first (the named ops for that verb), then any op in the right
 * group, then null — and null means the Studio says "media-forge is not offering an
 * op for this", which is the honest answer. It never falls back to "the first op in
 * the list", because running an arbitrary op on a story beat is worse than not
 * running one.
 */
export function opForHandoff(action: HandoffAction, ops: ForgeOp[]): ForgeOp | null {
  const form = HANDOFF_FORM[action]
  for (const name of form.preferOps) {
    const hit = ops.find(o => o.name === name)
    if (hit) return hit
  }
  return ops.find(o => o.group === form.group) ?? null
}
