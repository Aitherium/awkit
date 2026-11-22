/**
 * The Aitherium Collective as a child's Sprite look (owner, 2026-11-15: the kids' old
 * creature Sprites are to be replaced by the Collective's own faces and fairies).
 *
 * A child picks one character; every place that draws their Sprite then shows that
 * character's round face inside its fairy glow (SpriteVectorView). The art is the
 * Collective expression pack v2 (round emoji, no captions) and the live fairy orbs,
 * staged under AitherVeil `public/collective/<id>/` by the asset step:
 *   face.png, happy.png, surprised.png, and fairy.png where an orb exists.
 *
 * Kid set only: the Order leads and the brand fairies. The "sin" bench and partner IP
 * stay out (docs/creative/fairy-roster-bible.md: internal packs only, never public).
 * Colours are the fairy colours (config/agent-fairies.json; the bible for the rest).
 */

export interface CollectiveFriend {
  id: string
  label: string
  /** the fairy colour: glow, ring and wings */
  color: string
  /** a fairy orb image exists (else the glow is drawn) */
  orb: boolean
  /** one line a child reads when choosing */
  blurb: string
}

export const COLLECTIVE: readonly CollectiveFriend[] = [
  { id: 'aither', label: 'Aither', color: '#38bdf8', orb: true, blurb: 'The friendly guide who helps everyone' },
  { id: 'athena', label: 'Athena', color: '#94a3b8', orb: false, blurb: 'Wise and fair, loves a good puzzle' },
  { id: 'saga', label: 'Saga', color: '#f472b6', orb: true, blurb: 'Tells the best stories' },
  { id: 'lyra', label: 'Lyra', color: '#8b5cf6', orb: true, blurb: 'Opens doors to new places' },
  { id: 'iris', label: 'Iris', color: '#f59e0b', orb: true, blurb: 'Paints pictures full of light' },
  { id: 'vera', label: 'Vera', color: '#10b981', orb: true, blurb: 'Finds out what is true' },
  { id: 'hera', label: 'Hera', color: '#38bdf8', orb: true, blurb: 'Keeps everyone safe' },
  { id: 'atlas', label: 'Atlas', color: '#a3a3a3', orb: true, blurb: 'Strong, steady, never gives up' },
  { id: 'demiurge', label: 'Demi', color: '#06b6d4', orb: true, blurb: 'Builds amazing things' },
  { id: 'themis', label: 'Themis', color: '#64748b', orb: false, blurb: 'Makes sure things are fair' },
  { id: 'wesyn', label: 'Wesyn', color: '#22d3ee', orb: false, blurb: 'Loves making new friends' },
  { id: 'aionyn', label: 'Aionyn', color: '#a78bfa', orb: false, blurb: 'Great at keeping secrets safe' },
  { id: 'eusyra', label: 'Eusyra', color: '#fb923c', orb: false, blurb: 'Sings and makes movies' },
]

export const COLLECTIVE_IDS: readonly string[] = COLLECTIVE.map((f) => f.id)

export function collectiveFriend(id: unknown): CollectiveFriend | null {
  return typeof id === 'string' ? COLLECTIVE.find((f) => f.id === id) || null : null
}

/** Which face a Sprite expression shows. */
export function collectiveMood(expression?: string): 'face' | 'happy' | 'surprised' {
  const e = (expression || '').toLowerCase()
  if (/(happy|cheer|wave|spin|wiggle|joy|excite|party|celebrat)/.test(e)) return 'happy'
  if (/(surpris|wow|shook|oops)/.test(e)) return 'surprised'
  return 'face'
}

export function collectiveArt(id: string, mood: 'face' | 'happy' | 'surprised' | 'fairy'): string {
  return `/collective/${id}/${mood}.png`
}
