/**
 * Sprite v2 art: the kids' companion drawn as layered VECTOR parts (no 3D, no raster).
 *
 * One art direction for every Sprite: a chunky gumdrop body in a thick ink outline, big
 * glossy eyes, blush, a cream belly and tiny feet (the S3 intro fox is the model sheet).
 * Species add parts (ears, tail, wings, shell, sprout); everything else is a LAYER the child
 * dresses: expression, palette, head/face/neck/back/held wear, outfit top/cape/shoes, a pet.
 *
 * Input is SpriteDesign v2 (lib/tutor/sprite_design.py); anything unknown falls back to the
 * species default, so a stale or crafted design still draws. Output is a self-contained SVG
 * string (unique ids per call), so it renders the same in React, a snapshot PNG, or a test.
 *
 * Pure module: no imports, no DOM.
 */

export const VECTOR_SPECIES = ['sprout', 'fox', 'owl', 'bunny', 'dragon', 'turtle', 'cat', 'otter'] as const
export type VectorSpecies = typeof VECTOR_SPECIES[number]

export const EXPRESSIONS = ['content', 'happy', 'curious', 'sleepy', 'proud', 'surprised'] as const
export type Expression = typeof EXPRESSIONS[number]

/** Paint pots (body, belly, accent): the SpriteDesign v2 palettes, verbatim. */
export const PALETTES: Record<string, [string, string, string]> = {
  sunrise: ['#ff8a3d', '#fff1e0', '#e5484d'],
  meadow: ['#7ccf6b', '#e9f7c9', '#3f9b4b'],
  ocean: ['#58c4f6', '#e3f6ff', '#3f7fe0'],
  berry: ['#f48fb1', '#fff0f5', '#b4245e'],
  twilight: ['#7b6cf6', '#ece8ff', '#ffcf3f'],
  honey: ['#ffc83d', '#fff6d6', '#c77d12'],
  mint: ['#9be7c4', '#f0fff8', '#2fb5a4'],
  cocoa: ['#8d6e63', '#efe3d3', '#5d4037'],
}

/** Each species' own look (SpriteDesign v2 PRESETS colors, tuned for the flat style). */
export const SPECIES_DEFAULT: Record<VectorSpecies, { body: string; belly: string; accent: string; eye: string }> = {
  sprout: { body: '#7ccf6b', belly: '#e9f7c9', accent: '#3f9b4b', eye: '#2b6b3a' },
  fox: { body: '#ff8a3d', belly: '#fff1e0', accent: '#c2410c', eye: '#5b3a1e' },
  owl: { body: '#a07a64', belly: '#f3e5d0', accent: '#6d4c41', eye: '#ffb300' },
  bunny: { body: '#f5efe6', belly: '#ffffff', accent: '#f48fb1', eye: '#7a4b6b' },
  dragon: { body: '#4cc38a', belly: '#fff1c1', accent: '#2fb5a4', eye: '#e0a100' },
  turtle: { body: '#a5d65c', belly: '#fff1c1', accent: '#5d8a3a', eye: '#3c5a1e' },
  cat: { body: '#ffb347', belly: '#fff1e0', accent: '#e07b1f', eye: '#3c9a4a' },
  otter: { body: '#9a6b52', belly: '#f6e8dc', accent: '#5d3a28', eye: '#4a2f22' },
}

/** Dress-up catalogue, slot -> items (SpriteDesign v2 WEAR_ITEMS / OUTFIT_ITEMS; '' / none = bare). */
export const WEAR: Record<'head' | 'face' | 'neck' | 'back' | 'held', readonly string[]> = {
  head: ['party_hat', 'bow', 'flower_crown', 'wizard_hat', 'space_helmet', 'crown_of_curiosity'],
  face: ['glasses'],
  neck: ['scarf', 'star_badge'],
  back: ['comet_cape', 'rainbow_trail', 'dragon_wings', 'sunny_glow', 'seven_suns'],
  held: ['balloon', 'star_wand', 'book'],
}
export const OUTFIT: Record<'top' | 'cape' | 'shoes', readonly string[]> = {
  top: ['tee_sun', 'tee_sky', 'hoodie_berry', 'sweater_mint', 'overalls_denim'],
  cape: ['cape_star', 'cape_leaf', 'cape_ruby'],
  shoes: ['boots_red', 'sneakers_blue', 'slippers_pink'],
}
export const CHEEKS = ['blush', 'freckles', 'none'] as const
export const EYE_STYLES = ['round', 'sparkle', 'star'] as const
export const PATTERNS = ['none', 'spots', 'stars'] as const

/** Paint order, back to front. Every part of a Sprite belongs to exactly one of these. */
export const LAYER_ORDER = [
  'glow', 'shadow', 'back', 'cape', 'tail', 'species-back', 'ears', 'body', 'belly', 'pattern',
  'top', 'species-front', 'face', 'cheeks', 'arms', 'shoes', 'neck', 'face-wear', 'head', 'held', 'pet', 'helmet',
] as const

export interface VectorSpriteDesign {
  species?: string
  palette?: string
  colors?: Partial<Record<'body' | 'belly' | 'accent' | 'eye', string>>
  eyes?: { shape?: string }
  cheeks?: string
  pattern?: string
  wear?: Partial<Record<'head' | 'face' | 'neck' | 'back' | 'held', string>>
  outfit?: Partial<Record<'top' | 'cape' | 'shoes', string>>
  pet?: { species?: string; color?: string } | string
}

export interface VectorRenderOptions {
  expression?: string
  /** pixel size of the square SVG (viewBox is always 0 0 200 200) */
  size?: number
  /** soft halo behind the Sprite (the "light comes on" glow) */
  glow?: boolean
  /** ground shadow */
  shadow?: boolean
  /** id prefix; must be unique per document when several Sprites share a page */
  idPrefix?: string
  title?: string
  /** speaking: 'open' draws the mouth open (whatever the expression), 'closed' a closed
   *  smile; unset = the expression's own mouth. Toggling it makes the Sprite talk. */
  mouth?: 'open' | 'closed'
}

export const INK = '#2a1f3d'
const SW = 5.5
const HEX = /^#[0-9a-fA-F]{6}$/

// ------------------------------------------------------------------------------ colour

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b)
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t))
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
}
function lum(hex: string): number {
  const [r, g, b] = rgb(hex)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

export interface ResolvedSprite {
  species: VectorSpecies
  body: string
  belly: string
  accent: string
  eye: string
  shade: string
  expression: Expression
  eyeStyle: string
  cheeks: string
  pattern: string
  wear: Record<string, string>
  outfit: Record<string, string>
  pet: { species: VectorSpecies; color: string } | null
}

function pick<T extends string>(v: unknown, allowed: readonly T[], dflt: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : dflt
}

/** Clean any design into exactly what gets drawn (unknown -> species default). */
export function resolveSprite(design: VectorSpriteDesign = {}, expression?: string): ResolvedSprite {
  const species = pick(design.species, VECTOR_SPECIES, 'fox')
  const base = SPECIES_DEFAULT[species]
  const pot = design.palette && PALETTES[design.palette]
  const c = design.colors || {}
  const col = (k: 'body' | 'belly' | 'accent' | 'eye', fallback: string) => (typeof c[k] === 'string' && HEX.test(c[k] as string) ? (c[k] as string) : fallback)
  const body = col('body', pot ? pot[0] : base.body)
  const belly = col('belly', pot ? pot[1] : base.belly)
  const accent = col('accent', pot ? pot[2] : base.accent)
  const eye = col('eye', pot ? mix(pot[2], INK, 0.25) : base.eye)
  const wear: Record<string, string> = {}
  for (const slot of Object.keys(WEAR) as (keyof typeof WEAR)[]) {
    const v = design.wear?.[slot]
    if (v && WEAR[slot].includes(v)) wear[slot] = v
  }
  const outfit: Record<string, string> = {}
  for (const slot of Object.keys(OUTFIT) as (keyof typeof OUTFIT)[]) {
    const v = design.outfit?.[slot]
    if (v && OUTFIT[slot].includes(v)) outfit[slot] = v
  }
  let pet: ResolvedSprite['pet'] = null
  const p = typeof design.pet === 'string' ? { species: design.pet } : design.pet
  if (p && p.species && (VECTOR_SPECIES as readonly string[]).includes(p.species)) {
    const ps = p.species as VectorSpecies
    pet = { species: ps, color: p.color && HEX.test(p.color) ? p.color : SPECIES_DEFAULT[ps].body }
  }
  return {
    species, body, belly, accent, eye,
    shade: mix(body, INK, lum(body) > 0.8 ? 0.1 : 0.16),
    expression: pick(expression, EXPRESSIONS, 'content'),
    eyeStyle: pick(design.eyes?.shape, EYE_STYLES, 'round'),
    cheeks: pick(design.cheeks, CHEEKS, species === 'otter' ? 'freckles' : 'blush'),
    pattern: pick(design.pattern, PATTERNS, 'none'),
    wear, outfit, pet,
  }
}

// ------------------------------------------------------------------------------ shapes
// Everything is authored in "creature space" (ground at y=186, centre x=100), then the creature
// group is fitted into the 200x200 frame with headroom for ears and hats. Each species has its
// OWN silhouette (GEO) so the eight read as eight animals even as a black shape at 64 px; the
// face, hats, paws and neckline are authored once in canonical space and anchored per species.

interface Geo {
  /** body parts in paint order; `shell` paints in the shell colour (turtle) */
  parts: { d: string; fill: 'body' | 'shell' }[]
  belly: string
  /** where the canonical face centre (100,108) lands, and its scale */
  face: [number, number, number]
  /** where the canonical head top (100,44) lands, and its scale (hats) */
  hat: [number, number, number]
  /** the left paw's anchor (canonical 38,142) */
  arm: [number, number]
  /** left x of each foot */
  feet: [number, number]
  /** neckline y (canonical 140): tops, scarves, capes */
  neck: number
  /** body highlight centre */
  hl: [number, number]
  shadow: number
}

const B = (d: string) => ({ d, fill: 'body' as const })
export const GEO: Record<VectorSpecies, Geo> = {
  // pear / seed: narrow top, wide bottom, a leaf sprouting from the tip
  sprout: {
    parts: [B('M100 54 C122 54 134 84 144 116 C156 154 146 186 100 186 C54 186 44 154 56 116 C66 84 78 54 100 54 Z')],
    belly: 'M100 130 C122 130 134 146 133 162 C132 178 120 183 100 183 C80 183 68 178 67 162 C66 146 78 130 100 130 Z',
    face: [100, 124, 0.82], hat: [100, 56, 0.85], arm: [52, 148], feet: [72, 106], neck: 150, hl: [84, 82], shadow: 56,
  },
  // tall bean, the biggest ears, a bushy white-tipped tail
  fox: {
    parts: [B('M100 34 C140 34 152 74 150 118 C148 166 134 186 100 186 C66 186 52 166 50 118 C48 74 60 34 100 34 Z')],
    belly: 'M100 114 C122 114 134 132 133 152 C132 172 120 181 100 181 C80 181 68 172 67 152 C66 132 78 114 100 114 Z',
    face: [100, 98, 0.88], hat: [100, 36, 0.9], arm: [48, 140], feet: [70, 108], neck: 136, hl: [78, 62], shadow: 58,
  },
  // wide and round, ear tufts, wings for arms
  owl: {
    parts: [B('M100 58 C162 58 178 100 176 136 C174 174 146 186 100 186 C54 186 26 174 24 136 C22 100 38 58 100 58 Z')],
    belly: 'M100 126 C130 126 146 142 145 160 C144 177 126 183 100 183 C74 183 56 177 55 160 C54 142 70 126 100 126 Z',
    face: [100, 110, 1.0], hat: [100, 58, 1.05], arm: [40, 142], feet: [70, 110], neck: 146, hl: [70, 84], shadow: 72,
  },
  // an egg with long ears and a puff tail
  bunny: {
    parts: [B('M100 62 C134 62 152 104 152 140 C152 172 132 186 100 186 C68 186 48 172 48 140 C48 104 66 62 100 62 Z')],
    belly: 'M100 132 C120 132 132 148 131 163 C130 177 118 183 100 183 C82 183 70 177 69 163 C68 148 80 132 100 132 Z',
    face: [100, 124, 0.86], hat: [100, 62, 0.85], arm: [52, 150], feet: [72, 106], neck: 150, hl: [80, 88], shadow: 54,
  },
  // long body, big wings, back spikes, a spade tail
  dragon: {
    parts: [B('M100 36 C134 36 146 70 146 112 C146 162 136 186 100 186 C64 186 54 162 54 112 C54 70 66 36 100 36 Z')],
    belly: 'M100 110 C120 110 131 130 130 152 C129 174 118 182 100 182 C82 182 71 174 70 152 C69 130 80 110 100 110 Z',
    face: [100, 94, 0.84], hat: [100, 38, 0.86], arm: [52, 138], feet: [72, 106], neck: 134, hl: [80, 62], shadow: 56,
  },
  // a wide low dome shell with a small head in front
  turtle: {
    parts: [
      { d: 'M10 164 C10 118 50 96 100 96 C150 96 190 118 190 164 C190 180 162 188 100 188 C38 188 10 180 10 164 Z', fill: 'shell' },
      B('M100 46 C124 46 140 64 140 88 C140 112 124 126 100 126 C76 126 60 112 60 88 C60 64 76 46 100 46 Z'),
    ],
    belly: '',
    face: [100, 92, 0.72], hat: [100, 46, 0.7], arm: [14, 160], feet: [66, 112], neck: 128, hl: [84, 62], shadow: 88,
  },
  // a big round head on a small body, an upright tail
  cat: {
    parts: [
      B('M100 128 C128 128 140 148 138 166 C136 182 122 186 100 186 C78 186 64 182 62 166 C60 148 72 128 100 128 Z'),
      B('M100 34 C134 34 154 58 154 88 C154 118 132 136 100 136 C68 136 46 118 46 88 C46 58 66 34 100 34 Z'),
    ],
    belly: 'M100 146 C116 146 124 158 123 168 C122 178 114 183 100 183 C86 183 78 178 77 168 C76 158 84 146 100 146 Z',
    face: [100, 94, 0.9], hat: [100, 34, 0.9], arm: [62, 148], feet: [76, 104], neck: 136, hl: [78, 54], shadow: 46,
  },
  // long and sleek, little round ears, a flat paddle tail on the ground
  otter: {
    parts: [B('M100 30 C126 30 136 58 136 96 L134 150 C132 176 120 186 100 186 C80 186 68 176 66 150 L64 96 C64 58 74 30 100 30 Z')],
    belly: 'M100 100 C116 100 124 120 124 142 C124 168 116 182 100 182 C84 182 76 168 76 142 C76 120 84 100 100 100 Z',
    face: [100, 72, 0.7], hat: [100, 30, 0.74], arm: [66, 128], feet: [76, 104], neck: 110, hl: [84, 52], shadow: 46,
  },
}
const clipD = (g: Geo) => g.parts.map((p) => p.d).join(' ')
const faceT = (g: Geo) => `translate(${(g.face[0] - 100 * g.face[2]).toFixed(2)} ${(g.face[1] - 108 * g.face[2]).toFixed(2)}) scale(${g.face[2]})`
const hatT = (g: Geo) => `translate(${(g.hat[0] - 100 * g.hat[2]).toFixed(2)} ${(g.hat[1] - 44 * g.hat[2]).toFixed(2)}) scale(${g.hat[2]})`

const MIRROR = 'translate(200 0) scale(-1 1)'
const st = (w = SW) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`

function both(part: string): string {
  return `${part}<g transform="${MIRROR}">${part}</g>`
}
/** A tube tail: ink under-stroke + colour over-stroke, so a single path gets an outline. */
function tube(d: string, color: string, w: number): string {
  return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + SW * 2 - 1}" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`
}
function star(cx: number, cy: number, r: number, fill: string, stroke = true): string {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.48 : r
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`)
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}" ${stroke ? st(Math.max(2, r / 4)) : ''}/>`
}
function sparkle(cx: number, cy: number, r: number, fill: string): string {
  return `<path d="M${cx} ${cy - r} Q${cx + r * 0.18} ${cy - r * 0.18} ${cx + r} ${cy} Q${cx + r * 0.18} ${cy + r * 0.18} ${cx} ${cy + r} Q${cx - r * 0.18} ${cy + r * 0.18} ${cx - r} ${cy} Q${cx - r * 0.18} ${cy - r * 0.18} ${cx} ${cy - r} Z" fill="${fill}"/>`
}

/** Species parts. `faceDecor` is in canonical FACE space (moves with the face); the rest is creature space. */
interface Parts { [layer: string]: string }

function speciesParts(s: ResolvedSprite, id: string): Parts {
  const { body, belly, accent } = s
  const pinkInner = mix(belly, '#ff8fab', 0.45)
  const nose = (fill: string) => `<path d="M95 109 Q100 106 105 109 Q103 114 100 115 Q97 114 95 109 Z" fill="${fill}" ${fill === INK ? '' : st(2.4)}/>`
  const P: Parts = {}
  switch (s.species) {
    case 'fox': {
      const tail = 'M140 178 C190 184 208 140 198 96 C194 76 176 70 170 82 C182 112 172 146 146 150 Z'
      P.ears = both(`<path d="M54 72 Q44 22 56 -8 Q88 8 98 42 Z" fill="${body}" ${st()}/>`
        + `<path d="M63 58 Q57 26 62 8 Q80 18 88 40 Z" fill="${belly}"/>`)
      P.tail = `<clipPath id="${id}-tail"><path d="${tail}"/></clipPath><path d="${tail}" fill="${body}"/>`
        + `<g clip-path="url(#${id}-tail)"><path d="M160 98 Q186 110 210 92 L210 50 L160 50 Z" fill="${belly}"/></g>`
        + `<path d="${tail}" fill="none" ${st()}/>`
      // the fox's white lower face: what tells a fox from a cat at a glance
      P['species-front'] = `<g clip-path="url(#${id}-body)"><path d="M44 94 C54 108 70 114 86 108 Q100 117 114 108 C130 114 146 108 156 94 C158 112 142 124 128 128 L72 128 C58 124 42 112 44 94 Z" fill="${belly}"/></g>`
      P.faceDecor = nose(INK)
      break
    }
    case 'cat':
      P.ears = both(`<path d="M52 74 Q42 36 54 14 Q78 22 94 40 Z" fill="${body}" ${st()}/>`
        + `<path d="M60 62 Q55 38 59 26 Q72 30 84 42 Z" fill="${pinkInner}"/>`)
      P.tail = tube('M132 176 C164 178 172 150 168 122 C165 100 170 80 182 70', body, 13)
        + `<g stroke="${accent}" stroke-width="5" stroke-linecap="round"><path d="M154 172 l2 9"/><path d="M164 146 l9 1"/><path d="M164 120 l9 -2"/><path d="M168 96 l8 -4"/></g>`
      P['species-front'] = both(`<path d="M66 156 l9 3 M65 168 l9 1" fill="none" stroke="${accent}" stroke-width="4.5" stroke-linecap="round"/>`)
      P.faceDecor = `<g fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round">`
        + `<path d="M90 44 l2.5 11"/><path d="M100 42 v13"/><path d="M110 44 l-2.5 11"/></g>`
        + both(`<g stroke="${INK}" stroke-width="3.2" stroke-linecap="round"><path d="M46 113 L18 105"/><path d="M46 121 L18 125"/></g>`)
        + `<path d="M95.5 109 L104.5 109 L100 114.5 Z" fill="#ff7fa3" ${st(2.4)}/>`
      break
    case 'bunny':
      P.ears = both(`<g transform="rotate(-6 84 72)"><path d="M74 76 C58 40 58 -8 76 -16 C94 -20 98 32 94 72 Z" fill="${body}" ${st()}/>`
        + `<path d="M78 62 C70 34 69 0 77 -6 C86 -8 88 30 86 62 Z" fill="${pinkInner}"/></g>`)
      P.tail = `<circle cx="156" cy="170" r="15" fill="${belly}" ${st()}/>`
      P.faceDecor = nose('#ff7fa3')
      break
    case 'owl':
      P.ears = both(`<path d="M42 92 Q24 56 32 32 Q56 50 74 66 Z" fill="${accent}" ${st()}/>`)
      P.faceDecor = both(`<circle cx="78" cy="98" r="27" fill="${belly}"/>`)
        + `<path d="M93 110 Q100 106 107 110 L100 122 Z" fill="#ffb347" ${st(3.2)}/>`
      P['species-front'] = `<g fill="none" stroke="${mix(belly, accent, 0.45)}" stroke-width="3.2" stroke-linecap="round">`
        + `<path d="M86 148 l6 6 l6 -6"/><path d="M102 148 l6 6 l6 -6"/><path d="M94 162 l6 6 l6 -6"/></g>`
      P.arms = both(`<path d="M32 108 C2 112 -10 150 10 176 C14 168 18 170 20 176 C24 168 28 170 32 176 C40 160 46 140 44 120 Z" fill="${accent}" ${st()}/>`
        + `<path d="M14 140 q8 4 16 0 M12 154 q9 4 18 0" fill="none" stroke="${mix(accent, INK, 0.35)}" stroke-width="2.6" stroke-linecap="round"/>`)
      break
    case 'dragon':
      P['species-back'] = both(`<path d="M58 96 C28 50 -12 70 -10 120 C2 112 12 114 14 128 C24 116 32 118 34 132 C42 120 50 122 54 132 Z" fill="${accent}" ${st()}/>`
        + `<path d="M54 98 C34 74 10 80 0 104" fill="none" stroke="${mix(accent, INK, 0.3)}" stroke-width="2.6" stroke-linecap="round"/>`)
        + both(`<path d="M60 64 L42 70 L56 80 Z M56 92 L38 100 L55 108 Z M55 122 L38 132 L56 138 Z" fill="${accent}" ${st(4)}/>`)
      P.tail = tube('M138 178 C176 188 202 170 200 134', body, 15)
        + `<path d="M192 138 L200 112 L212 138 Z" fill="${accent}" ${st(4)}/>`
        + `<path d="M172 182 l4 -12 l6 10 Z M190 168 l8 -9 l3 11 Z" fill="${accent}" ${st(3)}/>`
      P.ears = both(`<path d="M70 50 Q58 22 70 6 Q78 28 90 42 Z" fill="${belly}" ${st()}/>`)
        + `<path d="M90 40 L100 20 L110 40 Z" fill="${accent}" ${st(4.5)}/>`
      P['species-front'] = `<g fill="none" stroke="${mix(belly, accent, 0.35)}" stroke-width="3" stroke-linecap="round">`
        + `<path d="M78 130 Q100 137 122 130"/><path d="M72 148 Q100 156 128 148"/><path d="M74 166 Q100 173 126 166"/></g>`
      break
    case 'turtle': {
      const shell = mix(accent, INK, 0.08)
      const plate = mix(mix(accent, body, 0.5), '#ffffff', 0.3)
      const hexAt = (x: number, y: number, r: number) => {
        const pts = [0, 1, 2, 3, 4, 5].map((i) => `${(x + r * Math.cos(Math.PI / 3 * i)).toFixed(1)},${(y + r * Math.sin(Math.PI / 3 * i)).toFixed(1)}`).join(' ')
        return `<polygon points="${pts}" fill="${plate}" stroke="${mix(shell, INK, 0.25)}" stroke-width="2.6" stroke-linejoin="round"/>`
      }
      P.shell = `<clipPath id="${id}-shell"><path d="${GEO.turtle.parts[0].d}"/></clipPath>`
        + `<g clip-path="url(#${id}-shell)">${hexAt(30, 146, 15)}${hexAt(170, 146, 15)}${hexAt(56, 118, 15)}${hexAt(144, 118, 15)}${hexAt(100, 108, 15)}${hexAt(64, 160, 15)}${hexAt(136, 160, 15)}${hexAt(100, 150, 15)}</g>`
        + `<path d="M16 168 Q100 190 184 168" fill="none" stroke="${mix(shell, '#ffffff', 0.45)}" stroke-width="5" stroke-linecap="round"/>`
      P.shellFill = shell
      P.tail = `<path d="M184 172 L204 178 L186 182 Z" fill="${body}" ${st(4)}/>`
      // front flippers poke out from under the shell rim
      P.arms = both(`<path d="M22 150 C4 146 -14 160 -8 172 C-2 180 16 176 28 166 Z" fill="${body}" ${st()}/>`)
      break
    }
    case 'otter':
      P.ears = both(`<circle cx="72" cy="44" r="11" fill="${body}" ${st()}/><circle cx="73" cy="45" r="5" fill="${mix(body, INK, 0.3)}"/>`)
      P.tail = `<path d="M124 172 C150 180 178 182 196 170 C200 165 197 159 190 159 C168 162 148 160 128 156 Z" fill="${mix(body, INK, 0.12)}" ${st()}/>`
        + `<path d="M140 168 C160 172 176 172 188 166" fill="none" stroke="${mix(body, INK, 0.3)}" stroke-width="2.6" stroke-linecap="round"/>`
      P.faceDecor = both(`<ellipse cx="88" cy="120" rx="16" ry="12.5" fill="${belly}" stroke="${mix(body, INK, 0.25)}" stroke-width="2"/>`)
        + `<path d="M93 107 Q100 104 107 107 Q106 113 100 115 Q94 113 93 107 Z" fill="${INK}"/>`
        + both(`<g fill="${mix(belly, INK, 0.4)}"><circle cx="86" cy="120" r="1.8"/><circle cx="83" cy="125" r="1.8"/><circle cx="89" cy="126" r="1.8"/></g>`)
      break
    case 'sprout':
      P.ears = `<g transform="translate(100 56) scale(1.35) translate(-100 -46)"><path d="M100 47 Q101 36 98 26" fill="none" ${st(5)}/>`
        + `<path d="M98 28 C88 10 66 12 60 24 C74 34 90 34 98 28 Z" fill="${accent}" ${st()}/>`
        + `<path d="M99 28 C108 6 136 6 142 20 C128 34 108 34 99 28 Z" fill="${mix(accent, body, 0.45)}" ${st()}/>`
        + `<path d="M68 23 Q82 22 94 27 M106 26 Q120 18 134 19" fill="none" stroke="${mix(accent, '#ffffff', 0.4)}" stroke-width="2.4" stroke-linecap="round"/></g>`
      break
  }
  return P
}

// ------------------------------------------------------------------------------ face

const EYE_L = 78, EYE_R = 122, EYE_Y = 98

function glossyEye(cx: number, cy: number, rx: number, ry: number, s: ResolvedSprite, id: string, look = 0): string {
  const cid = `${id}-eye${cx}`
  const hl = s.eyeStyle === 'star'
    ? star(cx + 4 + look, cy - 6, 7.5, '#ffffff', false)
    : `<circle cx="${cx + 5 + look}" cy="${cy - 7}" r="${(rx * 0.43).toFixed(1)}" fill="#fff"/>`
  const extra = s.eyeStyle === 'sparkle' ? sparkle(cx - 6 + look, cy - 9, 4.2, '#ffffff') : ''
  return `<clipPath id="${cid}"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/></clipPath>`
    + `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${INK}"/>`
    + `<g clip-path="url(#${cid})"><ellipse cx="${cx}" cy="${cy + ry * 0.62}" rx="${rx * 0.95}" ry="${ry * 0.6}" fill="${s.eye}" opacity=".85"/></g>`
    + hl + extra
    + `<circle cx="${cx - 5 + look}" cy="${cy + 8}" r="2.8" fill="#fff" opacity=".9"/>`
}

function face(s: ResolvedSprite, id: string, mouth?: 'open' | 'closed'): string {
  if (mouth) return eyesOnly(s, id) + talkingMouth(s, mouth)
  const mouthInk = '#5a1f2e'
  const owl = s.species === 'owl'
  const smile = owl || s.species === 'bunny' || s.species === 'otter'
    ? `<path d="M94 121 Q100 126 106 121" fill="none" ${st(3.6)}/>`
    : s.species === 'cat'
      ? `<path d="M90 117 Q95 123 100 117 Q105 123 110 117" fill="none" ${st(3.8)}/>`
      : `<path d="M89 117 Q100 128 111 117" fill="none" ${st(4.2)}/>`
  const fang = s.species === 'dragon' ? '<path d="M103 121.5 L106 128 L109 120 Z" fill="#fff" stroke="' + INK + '" stroke-width="1.6" stroke-linejoin="round"/>' : ''
  const mouthY = owl ? 8 : 0 // the owl's beak sits where a mouth would
  const happyEye = (cx: number) => `<path d="M${cx - 14} ${EYE_Y + 4} Q${cx} ${EYE_Y - 16} ${cx + 14} ${EYE_Y + 4}" fill="none" ${st(6.5)}/>`
  switch (s.expression) {
    case 'happy':
      return happyEye(EYE_L) + happyEye(EYE_R)
        + `<g transform="translate(0 ${mouthY})"><path d="M86 115 Q100 117 114 115 Q113 134 100 134 Q87 134 86 115 Z" fill="${mouthInk}" ${st(3.6)}/>`
        + `<path d="M91 128 Q100 121 109 128 Q106 133 100 133 Q94 133 91 128 Z" fill="#ff7a90"/></g>`
    case 'curious':
      return glossyEye(EYE_L, EYE_Y + 1, 14, 17, s, id, 3) + glossyEye(EYE_R, EYE_Y - 1, 16.5, 20, s, id, 3)
        + `<path d="M108 70 Q121 61 135 68" fill="none" ${st(4.2)}/>`
        + `<ellipse cx="${104}" cy="${121 + mouthY}" rx="4.6" ry="5.4" fill="${mouthInk}" ${st(3)}/>`
    case 'sleepy': {
      const shut = (cx: number) => `<path d="M${cx - 13} ${EYE_Y + 1} Q${cx} ${EYE_Y + 11} ${cx + 13} ${EYE_Y + 1}" fill="none" ${st(5.5)}/>`
        + `<path d="M${cx + 11} ${EYE_Y + 3} l5 -3" fill="none" ${st(3)}/>`
      return shut(EYE_L) + shut(EYE_R)
        + `<ellipse cx="100" cy="${122 + mouthY}" rx="4" ry="3.6" fill="#5a1f2e" ${st(2.6)}/>`
        + `<circle cx="112" cy="${118 + mouthY}" r="5" fill="#cdeeff" fill-opacity=".7" stroke="#ffffff" stroke-width="1.6"/>`
        + `<g fill="none" stroke="#e8e2ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">`
        + `<path d="M146 46 h11 l-11 13 h11"/><path d="M166 26 h8 l-8 9.5 h8"/></g>`
    }
    case 'proud':
      // beaming, chin up: shut happy eyes, a wide closed grin, sparkles (never smug)
      return happyEye(EYE_L) + happyEye(EYE_R)
        + `<path d="M82 ${113 + mouthY} Q100 ${133 + mouthY} 118 ${113 + mouthY}" fill="none" ${st(5)}/>`
        + `<path d="M80 ${111 + mouthY} l4 4 M120 ${111 + mouthY} l-4 4" fill="none" ${st(3.6)}/>` + fang
        + sparkle(158, 58, 12, '#ffd34d') + sparkle(174, 80, 6.5, '#ffe89a') + sparkle(40, 62, 7.5, '#ffe89a')
    case 'surprised':
      return glossyEye(EYE_L, EYE_Y, 16.5, 21, s, id) + glossyEye(EYE_R, EYE_Y, 16.5, 21, s, id)
        + `<path d="M64 70 Q76 62 88 68" fill="none" ${st(4.2)}/><path d="M112 68 Q124 62 136 70" fill="none" ${st(4.2)}/>`
        + `<ellipse cx="100" cy="${124 + mouthY}" rx="7" ry="8.5" fill="${mouthInk}" ${st(3.4)}/>`
    default:
      return glossyEye(EYE_L, EYE_Y, 15, 18, s, id) + glossyEye(EYE_R, EYE_Y, 15, 18, s, id)
        + `<g transform="translate(0 ${mouthY})">${owl ? '' : smile}${fang}</g>`
  }
}

/** The expression's eyes (and brows) without its mouth: the talking mouth goes under them. */
function eyesOnly(s: ResolvedSprite, id: string): string {
  const happyEye = (cx: number) => `<path d="M${cx - 14} ${EYE_Y + 4} Q${cx} ${EYE_Y - 16} ${cx + 14} ${EYE_Y + 4}" fill="none" ${st(6.5)}/>`
  switch (s.expression) {
    case 'happy': case 'proud': return happyEye(EYE_L) + happyEye(EYE_R)
    case 'curious':
      return glossyEye(EYE_L, EYE_Y + 1, 14, 17, s, id, 3) + glossyEye(EYE_R, EYE_Y - 1, 16.5, 20, s, id, 3)
        + `<path d="M108 70 Q121 61 135 68" fill="none" ${st(4.2)}/>`
    case 'sleepy': {
      const shut = (cx: number) => `<path d="M${cx - 13} ${EYE_Y + 1} Q${cx} ${EYE_Y + 11} ${cx + 13} ${EYE_Y + 1}" fill="none" ${st(5.5)}/>`
      return shut(EYE_L) + shut(EYE_R)
    }
    case 'surprised':
      return glossyEye(EYE_L, EYE_Y, 16.5, 21, s, id) + glossyEye(EYE_R, EYE_Y, 16.5, 21, s, id)
        + `<path d="M64 70 Q76 62 88 68" fill="none" ${st(4.2)}/><path d="M112 68 Q124 62 136 70" fill="none" ${st(4.2)}/>`
    default:
      return glossyEye(EYE_L, EYE_Y, 15, 18, s, id) + glossyEye(EYE_R, EYE_Y, 15, 18, s, id)
  }
}

/** The mouth while the Sprite speaks: open (a round "ah" with a tongue) or a closed smile. */
function talkingMouth(s: ResolvedSprite, mouth: 'open' | 'closed'): string {
  const y = s.species === 'owl' ? 8 : 0
  const fang = s.species === 'dragon' ? '<path d="M103 121.5 L106 128 L109 120 Z" fill="#fff" stroke="' + INK + '" stroke-width="1.6" stroke-linejoin="round"/>' : ''
  if (mouth === 'closed') return `<g data-mouth="closed" transform="translate(0 ${y})"><path d="M89 117 Q100 128 111 117" fill="none" ${st(4.2)}/>${fang}</g>`
  return `<g data-mouth="open" transform="translate(0 ${y})"><path d="M89 115 Q100 113 111 115 Q110 133 100 133 Q90 133 89 115 Z" fill="#5a1f2e" ${st(3.6)}/>`
    + `<path d="M93 128 Q100 123 107 128 Q105 132 100 132 Q95 132 93 128 Z" fill="#ff7a90"/>${fang}</g>`
}

function cheeks(s: ResolvedSprite): string {
  const y = s.species === 'owl' ? 124 : 119
  const big = s.expression === 'happy' || s.expression === 'proud'
  if (s.cheeks === 'none') return ''
  if (s.cheeks === 'freckles') {
    return both(`<g fill="${mix(s.body, INK, 0.35)}"><circle cx="56" cy="${y - 2}" r="2.2"/><circle cx="63" cy="${y + 1}" r="2.2"/><circle cx="57" cy="${y + 5}" r="2.2"/></g>`)
      + both(`<ellipse cx="58" cy="${y + 1}" rx="10" ry="6" fill="#ff8fab" opacity=".35"/>`)
  }
  return both(`<ellipse cx="58" cy="${y}" rx="${big ? 12 : 10.5}" ry="${big ? 7 : 6.2}" fill="#ff8fab" opacity=".6"/>`)
}

// ------------------------------------------------------------------------------ dress-up

const TOPS: Record<string, { color: string; trim: string }> = {
  tee_sun: { color: '#ffd23f', trim: '#f4a300' },
  tee_sky: { color: '#6ec6ff', trim: '#2f8fd8' },
  hoodie_berry: { color: '#e05597', trim: '#a8306a' },
  sweater_mint: { color: '#7fdcb6', trim: '#3aa883' },
  overalls_denim: { color: '#5b8de0', trim: '#3a64b0' },
}
const CAPES: Record<string, { color: string; lining: string }> = {
  cape_star: { color: '#3b3a9e', lining: '#5a58d6' },
  cape_leaf: { color: '#3f9b4b', lining: '#7ccf6b' },
  cape_ruby: { color: '#d33a4a', lining: '#ff6b7a' },
  comet_cape: { color: '#5b3fc4', lining: '#8b6cff' },
}
const SHOES: Record<string, string> = { boots_red: '#e5484d', sneakers_blue: '#3f7fe0', slippers_pink: '#ff8fbf' }

function top(item: string): string {
  const t = TOPS[item]
  if (!t) return ''
  let deco = ''
  if (item === 'tee_sun') deco = `<circle cx="100" cy="160" r="8" fill="#fff6c2"/>` + [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M100 147 v-4" stroke="#fff6c2" stroke-width="3" stroke-linecap="round" transform="rotate(${a} 100 160)"/>`).join('')
  if (item === 'tee_sky') deco = `<path d="M88 164 q0 -9 9 -9 q3 -7 10 -4 q8 0 8 8 q4 1 3 5 Z" fill="#ffffff"/>`
  if (item === 'hoodie_berry') deco = `<path d="M90 140 v14 M110 140 v14" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="90" cy="156" r="2.6" fill="#fff"/><circle cx="110" cy="156" r="2.6" fill="#fff"/><path d="M78 166 Q100 172 122 166 L118 180 Q100 184 82 180 Z" fill="${t.trim}" opacity=".55"/>`
  if (item === 'sweater_mint') deco = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<path d="M${64 + i * 9} 172 v14" stroke="${t.trim}" stroke-width="2.6" stroke-linecap="round"/>`).join('') + `<path d="M76 152 l6 -6 l6 6 l6 -6 l6 6 l6 -6 l6 6 l6 -6 l6 6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`
  if (item === 'overalls_denim') {
    return `<path d="M-20 156 Q100 150 220 156 L220 260 L-20 260 Z" fill="${t.color}"/>`
      + `<path d="M76 158 L76 136 L124 136 L124 158 Z" fill="${t.color}" ${st(3.4)}/>`
      + `<path d="M-20 156 Q100 150 220 156" fill="none" ${st(3.4)}/>`
      + `<path d="M76 136 L60 116 M124 136 L140 116" stroke="${t.color}" stroke-width="7" stroke-linecap="round"/>`
      + `<circle cx="82" cy="142" r="3" fill="#ffd23f" ${st(1.6)}/><circle cx="118" cy="142" r="3" fill="#ffd23f" ${st(1.6)}/>`
      + `<path d="M90 146 h20 v10 h-20 Z" fill="${t.trim}" opacity=".6"/>`
  }
  return `<path d="M-20 140 Q60 134 82 140 Q100 152 118 140 Q140 134 220 140 L220 260 L-20 260 Z" fill="${t.color}"/>`
    + `<path d="M-20 140 Q60 134 82 140 Q100 152 118 140 Q140 134 220 140" fill="none" ${st(3.6)}/>`
    + `<path d="M84 141 Q100 151 116 141" fill="none" stroke="${t.trim}" stroke-width="3.4" stroke-linecap="round"/>${deco}`
}

function cape(item: string): string {
  const c = CAPES[item]
  if (!c) return ''
  const stars = item === 'cape_star' || item === 'comet_cape'
    ? star(30, 170, 6, '#ffd34d', false) + star(172, 162, 5, '#ffd34d', false) + star(176, 182, 3.5, '#fff1a8', false)
    : item === 'cape_leaf' ? `<path d="M168 166 q8 -12 16 -4 q-6 10 -16 4 Z" fill="${c.lining}" ${st(2.4)}/>` : ''
  return `<path d="M60 124 C34 140 16 168 20 192 Q100 202 180 192 C184 168 166 140 140 124 Z" fill="${c.color}" ${st()}/>`
    + `<path d="M26 186 Q100 196 174 186" fill="none" stroke="${c.lining}" stroke-width="4" stroke-linecap="round"/>` + stars
}
function capeTie(item: string): string {
  const c = CAPES[item]
  if (!c) return ''
  return `<path d="M88 138 L100 144 L88 150 Z M112 138 L100 144 L112 150 Z" fill="${c.color}" ${st(3)}/><circle cx="100" cy="144" r="4.5" fill="#ffd34d" ${st(2.4)}/>`
}

function back(item: string, id: string): string {
  switch (item) {
    case 'rainbow_trail':
      return ['#ff6b6b', '#ffd23f', '#5bd17a', '#5aa9f2', '#9b7bf2'].map((c, i) =>
        `<path d="M${2 + i * 7} 192 C${2 + i * 7} 110 ${60 + i * 3} ${50 + i * 7} ${100} ${50 + i * 7}" fill="none" stroke="${c}" stroke-width="7.5" stroke-linecap="round"/>`).join('')
    case 'dragon_wings':
      return both(`<path d="M46 104 C18 76 -4 98 0 132 C10 124 18 126 20 136 C28 126 34 128 36 138 C42 128 48 128 52 134 Z" fill="#8b6cff" ${st()}/>`
        + `<path d="M42 108 C26 96 12 104 8 122" fill="none" stroke="#5b3fc4" stroke-width="2.6" stroke-linecap="round"/>`)
    case 'sunny_glow':
      return [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((a) =>
        `<path d="M100 32 L105 16 L95 16 Z" fill="#ffd34d" opacity=".9" transform="rotate(${a} 100 108)"/>`).join('')
        + `<radialGradient id="${id}-sun"><stop offset=".45" stop-color="#ffe27a" stop-opacity=".55"/><stop offset="1" stop-color="#ffd34d" stop-opacity="0"/></radialGradient><circle cx="100" cy="112" r="92" fill="url(#${id}-sun)"/>`
    case 'seven_suns':
      return [0, 1, 2, 3, 4, 5, 6].map((i) => {
        const a = Math.PI * (1.08 + (i * 0.84) / 6)
        return `<circle cx="${(100 + 92 * Math.cos(a)).toFixed(1)}" cy="${(118 + 92 * Math.sin(a)).toFixed(1)}" r="8" fill="#ffd34d" ${st(2.6)}/>`
      }).join('')
    default:
      return ''
  }
}

function head(item: string, s: ResolvedSprite, id: string): string {
  // Bunny and sprout carry tall parts on top: hats sit a little lower and to one side.
  const lift = s.species === 'bunny' ? 'translate(28 10) rotate(14 100 44)' : s.species === 'sprout' ? 'translate(30 6) rotate(16 100 44)' : 'rotate(8 100 44)'
  switch (item) {
    case 'party_hat':
      return `<g transform="${lift}"><clipPath id="${id}-ph"><path d="M80 52 L100 4 L120 52 Z"/></clipPath>`
        + `<path d="M80 52 L100 4 L120 52 Z" fill="#5aa9f2"/>`
        + `<g clip-path="url(#${id}-ph)"><path d="M60 40 L140 20 L140 30 L60 50 Z M60 20 L140 0 L140 10 L60 30 Z" fill="#ffd23f"/></g>`
        + `<path d="M80 52 L100 4 L120 52 Z" fill="none" ${st()}/><circle cx="100" cy="4" r="7" fill="#ff6b9a" ${st(3.6)}/></g>`
    case 'bow':
      return `<g transform="translate(${s.species === 'bunny' ? 4 : -10} ${s.species === 'bunny' ? 2 : 0})">`
        + `<path d="M72 50 C56 34 50 56 58 62 C64 66 72 58 76 54 Z" fill="#ff6fa5" ${st(4.4)}/>`
        + `<path d="M80 54 C92 38 104 52 98 62 C92 68 84 60 80 56 Z" fill="#ff6fa5" ${st(4.4)}/>`
        + `<circle cx="78" cy="55" r="6" fill="#ff9cc2" ${st(4)}/></g>`
    case 'flower_crown': {
      const flowers = [[66, 58, '#ff8fbf'], [82, 47, '#ffd23f'], [100, 44, '#ff8fbf'], [118, 47, '#9b7bf2'], [134, 58, '#ffd23f']] as const
      return `<path d="M60 62 Q100 34 140 62" fill="none" stroke="#3f9b4b" stroke-width="5" stroke-linecap="round"/>`
        + flowers.map(([x, y, c]) => [0, 72, 144, 216, 288].map((a) =>
          `<ellipse cx="${x}" cy="${y - 5.5}" rx="4.4" ry="5.6" fill="${c}" stroke="${INK}" stroke-width="2" transform="rotate(${a} ${x} ${y})"/>`).join('')
          + `<circle cx="${x}" cy="${y}" r="3.6" fill="#fff3b0" stroke="${INK}" stroke-width="1.8"/>`).join('')
    }
    case 'wizard_hat':
      return `<g transform="${lift}"><path d="M70 52 Q86 30 96 6 Q104 -4 116 8 Q108 12 108 22 Q116 38 130 52 Z" fill="#6a4fd6" ${st()}/>`
        + `<ellipse cx="100" cy="54" rx="42" ry="9" fill="#5b3fc4" ${st()}/>`
        + star(92, 34, 6, '#ffd34d', false) + star(112, 44, 4, '#ffd34d', false) + `<circle cx="102" cy="22" r="2.4" fill="#ffd34d"/></g>`
    case 'crown_of_curiosity':
      return `<g transform="${s.species === 'bunny' || s.species === 'sprout' ? 'translate(0 8) ' : ''}translate(100 54) scale(1.3) translate(-100 -54)"><path d="M74 54 L74 22 L89 37 L100 14 L111 37 L126 22 L126 54 Z" fill="#ffd23f" ${st(4.6)}/>`
        + `<path d="M75 46 L125 46" stroke="#e09a00" stroke-width="3.4"/><path d="M80 30 L80 44" stroke="#fff3b0" stroke-width="3" stroke-linecap="round"/>`
        + `<circle cx="100" cy="37" r="5.5" fill="#e5484d" ${st(2.4)}/><circle cx="74" cy="21" r="3.6" fill="#ffd23f" ${st(2)}/><circle cx="126" cy="21" r="3.6" fill="#ffd23f" ${st(2)}/><circle cx="100" cy="13" r="3.6" fill="#ffd23f" ${st(2)}/></g>`
    default:
      return ''
  }
}

function helmet(item: string): string {
  if (item !== 'space_helmet') return ''
  return `<circle cx="100" cy="100" r="86" fill="#9fdcff" fill-opacity=".22"/>`
    + `<circle cx="100" cy="100" r="86" fill="none" stroke="${INK}" stroke-width="${SW + 5}"/>`
    + `<circle cx="100" cy="100" r="86" fill="none" stroke="#e8f7ff" stroke-width="5"/>`
    + `<path d="M30 70 Q46 28 92 16" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" opacity=".85"/>`
    + `<path d="M150 40 Q166 52 172 68" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity=".6"/>`
    + `<path d="M40 170 Q100 196 160 170 L156 190 Q100 210 44 190 Z" fill="#c8d3e6" ${st()}/>`
    + `<circle cx="100" cy="194" r="5" fill="#ff5d73" ${st(2.4)}/>`
}

function neck(item: string, s: ResolvedSprite, id: string): string {
  if (item === 'scarf') {
    const c = s.species === 'fox' || s.species === 'cat' ? '#e5484d' : '#ff6b6b'
    return `<g clip-path="url(#${id}-scarf)"><path d="M-10 124 Q100 150 210 124 L210 142 Q100 166 -10 142 Z" fill="${c}"/>`
      + `<path d="M-10 124 Q100 150 210 124 M-10 142 Q100 166 210 142" fill="none" ${st(3.6)}/>`
      + `<path d="M60 134 v12 M80 138 v12 M100 140 v12 M120 138 v12 M140 134 v12" stroke="#ffffff" stroke-width="3" opacity=".55"/></g>`
      + `<path d="M120 146 L126 176 L140 172 L134 144 Z" fill="${c}" ${st(3.6)}/>`
  }
  if (item === 'star_badge') return star(116, 150, 10, '#ffcf3f') + `<circle cx="116" cy="150" r="2.6" fill="#fff6c2"/>`
  return ''
}

function held(item: string, s: ResolvedSprite): string {
  const paw = (x: number, y: number) => `<ellipse cx="${x}" cy="${y}" rx="11" ry="10" fill="${s.body}" ${st()}/>`
  switch (item) {
    case 'balloon':
      return `<path d="M158 138 Q170 110 176 66" fill="none" stroke="${INK}" stroke-width="2.4"/>`
        + `<ellipse cx="178" cy="44" rx="18" ry="22" fill="#ff5d73" ${st()}/><path d="M174 66 l4 -2 l4 2 Z" fill="#ff5d73" ${st(2.4)}/>`
        + `<ellipse cx="171" cy="35" rx="5" ry="7" fill="#fff" opacity=".7"/>` + paw(156, 140)
    case 'star_wand':
      return `<path d="M156 140 L178 76" stroke="${INK}" stroke-width="9" stroke-linecap="round"/><path d="M156 140 L178 76" stroke="#c9a6ff" stroke-width="4" stroke-linecap="round"/>`
        + star(180, 66, 16, '#ffd34d') + sparkle(160, 52, 5, '#fff1a8') + sparkle(196, 88, 4, '#fff1a8') + paw(156, 140)
    case 'book':
      return `<path d="M120 150 L146 140 L172 150 L172 182 L146 172 L120 182 Z" fill="#5aa9f2" ${st(4.4)}/>`
        + `<path d="M124 152 L146 144 L168 152 L168 178 L146 170 L124 178 Z" fill="#fffaf0"/><path d="M146 144 V170" stroke="${INK}" stroke-width="2.4"/>`
        + `<path d="M130 158 l10 -3 M130 165 l10 -3 M152 155 l10 3 M152 162 l10 3" stroke="#b9c3d6" stroke-width="2.2" stroke-linecap="round"/>`
        + paw(122, 162) + paw(170, 162)
    default:
      return ''
  }
}

function pattern(s: ResolvedSprite, id: string): string {
  if (s.pattern === 'spots') {
    const dot = mix(s.body, s.accent, 0.45)
    return `<g clip-path="url(#${id}-body)" fill="${dot}">`
      + [[60, 70, 7], [140, 76, 6], [46, 104, 5], [154, 110, 7], [128, 56, 4]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('') + '</g>'
  }
  if (s.pattern === 'stars') {
    return `<g clip-path="url(#${id}-body)">`
      + [[58, 70, 6], [144, 74, 5], [48, 110, 4], [152, 112, 5.5]].map(([x, y, r]) => star(x, y, r, mix(s.body, '#ffffff', 0.55), false)).join('') + '</g>'
  }
  return ''
}

// ------------------------------------------------------------------------------ assemble

/** What actually gets worn after decluttering, and what was hidden (as `slot:item`). */
export interface Dressing {
  wear: Record<string, string>
  outfit: Record<string, string>
  hidden: string[]
}

/**
 * Declutter: at most ONE hat, ONE outfit-or-cape (a top beats a cape beats a back item), ONE
 * held item and a pet. Anything that would collide with what is shown is hidden and named, so
 * the wardrobe can grey that slot out and say why instead of drawing a pile of clothes.
 */
export function declutter(s: Pick<ResolvedSprite, 'wear' | 'outfit'>): Dressing {
  const wear = { ...s.wear }
  const outfit = { ...s.outfit }
  const hidden: string[] = []
  const drop = (rec: Record<string, string>, slot: string) => { hidden.push(`${slot}:${rec[slot]}`); delete rec[slot] }
  if (outfit.top) {
    if (outfit.cape) drop(outfit, 'cape')
    if (wear.back) drop(wear, 'back')
  } else if (outfit.cape && wear.back) {
    drop(wear, 'back')
  }
  const garment = !!(outfit.top || outfit.cape || wear.back === 'comet_cape')
  if (garment && wear.neck) drop(wear, 'neck')
  // one thing on the head: a hat (or helmet) hides glasses
  if (wear.head && wear.face) drop(wear, 'face')
  return { wear, outfit, hidden }
}

/** Each species' lowest-left body edge (creature space): the pet sits just outside it. */
const PET_EDGE: Record<VectorSpecies, number> = { sprout: 52, fox: 52, owl: 8, bunny: 50, dragon: 58, turtle: -8, cat: 62, otter: 66 }

let _seq = 0

/** The layers of one Sprite, by name (empty string = nothing in that layer). */
export function spriteLayers(design: VectorSpriteDesign = {}, opts: VectorRenderOptions = {}): Record<typeof LAYER_ORDER[number], string> & { _defs: string } {
  const s0 = resolveSprite(design, opts.expression)
  const dressing = declutter(s0)
  const s: ResolvedSprite = { ...s0, wear: dressing.wear, outfit: dressing.outfit }
  const id = opts.idPrefix || `spv${++_seq}`
  const g = GEO[s.species]
  const sp = speciesParts(s, id)
  const ft = faceT(g)
  const dy = g.neck - 140
  const armT = `translate(${g.arm[0] - 38} ${g.arm[1] - 142})`
  const heldT = `translate(${38 - g.arm[0]} ${g.arm[1] - 142})`
  const feet = SHOES[s.outfit.shoes || ''] || s.accent
  const [f1, f2] = g.feet
  const shoeTrim = s.outfit.shoes === 'sneakers_blue' ? `<path d="M${f1 + 2} 184 h18 M${f2 + 2} 184 h18" stroke="#fff" stroke-width="3" stroke-linecap="round"/>` : ''
  const hasHeld = !!s.wear.held
  const holdBook = s.wear.held === 'book'
  const pawL = (shape: string) => `<g transform="${armT}">${shape}</g>`
  const pawR = (shape: string) => `<g transform="${MIRROR}">${pawL(shape)}</g>`
  const armShape = `<path d="M38 142 C30 148 30 162 42 164 C48 160 50 150 48 142 Z" fill="${s.body}" ${st()}/>`
  // proud = paws on hips, elbows out: the pose that tells it from happy at a glance
  const akimbo = `<path d="M46 132 C30 130 18 142 24 154 C30 162 42 160 48 154 C40 152 36 146 46 140 Z" fill="${s.body}" ${st()}/>`
  const paw = s.expression === 'proud' ? akimbo : armShape
  const arms = sp.arms ?? (holdBook ? '' : pawL(paw) + (hasHeld ? '' : pawR(paw)))
  const capeItem = s.outfit.cape || (s.wear.back === 'comet_cape' ? 'comet_cape' : '')
  const atNeck = (inner: string) => `<g transform="translate(0 ${dy})">${inner}</g>`
  const clipped = (inner: string) => `<g clip-path="url(#${id}-body)">${inner}</g>`

  // body parts: fill, its own shading, its own outline (so a head drawn over a shell stays clean)
  const lastBody = g.parts.length - 1
  const body = g.parts.map((part, i) => {
    const fill = part.fill === 'shell' ? (sp.shellFill || s.accent) : s.body
    const shade = part.fill === 'shell' ? mix(fill, INK, 0.2) : s.shade
    return `<clipPath id="${id}-p${i}"><path d="${part.d}"/></clipPath><path d="${part.d}" fill="${fill}"/>`
      + `<g clip-path="url(#${id}-p${i})"><path d="M150 40 C182 90 176 176 112 196 L220 210 L220 20 Z" fill="${shade}" opacity=".5"/>`
      + (i === lastBody ? `<ellipse cx="${g.hl[0]}" cy="${g.hl[1]}" rx="18" ry="10" fill="#fff" opacity=".28" transform="rotate(-28 ${g.hl[0]} ${g.hl[1]})"/>` : '')
      + `</g>${part.fill === 'shell' ? sp.shell || '' : ''}<path d="${part.d}" fill="none" ${st()}/>`
  }).join('')

  const L = {
    _defs: `<clipPath id="${id}-body"><path d="${clipD(g)}"/></clipPath><clipPath id="${id}-scarf"><path d="${clipD(g)}" transform="translate(0 ${-dy})"/></clipPath>`,
    glow: opts.glow ? `<radialGradient id="${id}-glow"><stop offset="0" stop-color="#ffe6a8" stop-opacity=".55"/><stop offset=".55" stop-color="#ffb37a" stop-opacity=".18"/><stop offset="1" stop-color="#ffb37a" stop-opacity="0"/></radialGradient><circle cx="100" cy="104" r="98" fill="url(#${id}-glow)"/>` : '',
    shadow: opts.shadow === false ? '' : `<ellipse cx="100" cy="188" rx="${g.shadow}" ry="8" fill="#000" opacity=".2"/>`,
    back: s.wear.back && s.wear.back !== 'comet_cape' ? back(s.wear.back, id) : '',
    cape: capeItem ? atNeck(cape(capeItem)) : '',
    tail: sp.tail || '',
    'species-back': sp['species-back'] || '',
    ears: sp.ears || '',
    body,
    belly: g.belly ? `<path d="${g.belly}" fill="${s.belly}"/>` : '',
    pattern: pattern(s, id),
    top: s.outfit.top ? clipped(atNeck(top(s.outfit.top))) : '',
    'species-front': sp['species-front'] || '',
    face: `<g transform="${ft}">${sp.faceDecor || ''}${face(s, id, opts.mouth)}</g>`,
    cheeks: `<g transform="${ft}">${cheeks(s)}</g>`,
    arms,
    shoes: `<path d="M${f1} 186 q11 -16 22 0 Z M${f2} 186 q11 -16 22 0 Z" fill="${feet}" ${st(4.4)}/>` + shoeTrim,
    neck: (s.wear.neck ? atNeck(neck(s.wear.neck, s, id)) : '') + (capeItem ? atNeck(capeTie(capeItem)) : ''),
    'face-wear': s.wear.face === 'glasses'
      ? `<g transform="${ft}"><g fill="#ffffff" fill-opacity=".18" stroke="${INK}" stroke-width="4.4"><circle cx="${EYE_L}" cy="${EYE_Y}" r="21"/><circle cx="${EYE_R}" cy="${EYE_Y}" r="21"/></g><path d="M97 96 Q100 92 103 96" fill="none" ${st(4)}/></g>`
      : '',
    head: s.wear.head && s.wear.head !== 'space_helmet' ? `<g transform="${hatT(g)}">${head(s.wear.head, s, id)}</g>` : '',
    held: s.wear.held ? `<g transform="${heldT}">${held(s.wear.held, s)}</g>` : '',
    pet: '',
    helmet: s.wear.head === 'space_helmet' ? `<g transform="${hatT(g)}">${helmet('space_helmet')}</g>` : '',
  }
  if (s.pet) {
    const petSvg = spriteInner({ species: s.pet.species, colors: { body: s.pet.color } }, { idPrefix: `${id}p`, shadow: true })
    // small, and just off the LEFT edge (held items live on the right paw)
    const petX = 12 + 0.88 * PET_EDGE[s.species] - 46
    L.pet = `<g transform="translate(${petX.toFixed(1)} 156) scale(0.22)">${petSvg}</g>`
  }
  return L
}

/** The creature group only (no <svg> wrapper): fitted into 200x200 with headroom. */
function spriteInner(design: VectorSpriteDesign, opts: VectorRenderOptions): string {
  const L = spriteLayers(design, opts)
  const tilt = opts.expression === 'curious' ? ' rotate(-5 100 186)' : opts.expression === 'proud' ? ' rotate(3 100 186)' : ''
  const parts = LAYER_ORDER.filter((k) => k !== 'glow' && k !== 'pet').map((k) => L[k] ? `<g data-layer="${k}">${L[k]}</g>` : '').join('')
  const glow = L.glow ? `<g data-layer="glow">${L.glow}</g>` : ''
  const pet = L.pet ? `<g data-layer="pet">${L.pet}</g>` : ''
  return `<defs>${L._defs}</defs>${glow}<g transform="translate(12 22) scale(0.88)${tilt}">${parts}</g>${pet}`
}

/** One Sprite as a standalone SVG document. */
export function renderSpriteSvg(design: VectorSpriteDesign = {}, opts: VectorRenderOptions = {}): string {
  const size = opts.size ?? 200
  const s = resolveSprite(design, opts.expression)
  const label = opts.title || `${s.species}, ${s.expression}`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${size}" height="${size}" role="img" aria-label="${label.replace(/[<>&"]/g, '')}" data-species="${s.species}" data-expression="${s.expression}" overflow="visible">`
    + spriteInner(design, opts) + '</svg>'
}
