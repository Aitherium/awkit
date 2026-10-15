/**
 * Sprite v2 vector art: every layer combination renders a well-formed SVG, every chosen
 * part actually lands in its layer, and ids never collide (two Sprites on one page).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import {
  EXPRESSIONS, LAYER_ORDER, OUTFIT, PALETTES, VECTOR_SPECIES, WEAR, CHEEKS, EYE_STYLES, PATTERNS,
  GEO, declutter, renderSpriteSvg, resolveSprite, spriteLayers, type VectorSpriteDesign,
} from '../panels/spriteVector'
import { SpriteVector } from '../panels/SpriteVectorView'

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
  expect(doc.documentElement.tagName).toBe('svg')
  return doc
}

function ids(doc: Document): string[] {
  return Array.from(doc.querySelectorAll('[id]')).map((e) => e.getAttribute('id') as string)
}

function assertSound(svg: string) {
  const doc = parse(svg)
  const all = ids(doc)
  expect(new Set(all).size).toBe(all.length)
  // every url(#x) reference resolves inside the same document
  for (const m of svg.matchAll(/url\(#([^)]+)\)/g)) expect(all).toContain(m[1])
  expect(svg).not.toMatch(/NaN|undefined/)
  expect(doc.querySelector('[data-layer="body"]')).not.toBeNull()
  expect(doc.querySelector('[data-layer="face"]')).not.toBeNull()
  return doc
}

describe('Sprite v2 vector renderer', () => {
  it('draws every species x palette x expression', () => {
    let n = 0
    for (const species of VECTOR_SPECIES) {
      for (const palette of [undefined, ...Object.keys(PALETTES)]) {
        for (const expression of EXPRESSIONS) {
          const doc = assertSound(renderSpriteSvg({ species, palette }, { expression, idPrefix: `t${n++}` }))
          expect(doc.documentElement.getAttribute('data-species')).toBe(species)
          expect(doc.documentElement.getAttribute('data-expression')).toBe(expression)
        }
      }
    }
    expect(n).toBe(8 * 9 * 6)
  })

  it('gives every species its own silhouette', () => {
    const outlines = VECTOR_SPECIES.map((sp) => GEO[sp].parts.map((p) => p.d).join(' '))
    expect(new Set(outlines).size).toBe(VECTOR_SPECIES.length)
    // the parts that make the silhouette (ears/tail/wings/shell) differ too
    const extras = VECTOR_SPECIES.map((sp) => {
      const L = spriteLayers({ species: sp, palette: 'ocean' }, { idPrefix: 'x' })
      return L.ears + L.tail + L['species-back'] + L.arms
    })
    expect(new Set(extras).size).toBe(VECTOR_SPECIES.length)
  })

  it('declutters: one hat, one outfit-or-cape, one held item, a pet; collisions hidden and named', () => {
    const everything = resolveSprite({
      species: 'bunny',
      wear: { head: 'wizard_hat', face: 'glasses', neck: 'scarf', back: 'rainbow_trail', held: 'balloon' },
      outfit: { top: 'tee_sky', cape: 'cape_star', shoes: 'boots_red' }, pet: 'cat',
    })
    const d = declutter(everything)
    expect(d.outfit).toEqual({ top: 'tee_sky', shoes: 'boots_red' })
    expect(d.wear).toEqual({ head: 'wizard_hat', held: 'balloon' })
    expect(d.hidden.sort()).toEqual(['back:rainbow_trail', 'cape:cape_star', 'face:glasses', 'neck:scarf'])
    // a cape (no top) beats a back item; the comet cape counts as the cape
    expect(declutter(resolveSprite({ wear: { back: 'dragon_wings' }, outfit: { cape: 'cape_ruby' } })).hidden).toEqual(['back:dragon_wings'])
    expect(declutter(resolveSprite({ wear: { back: 'comet_cape', neck: 'scarf' } })).hidden).toEqual(['neck:scarf'])
    // nothing colliding: nothing hidden
    expect(declutter(resolveSprite({ wear: { head: 'bow', held: 'book' }, outfit: { top: 'tee_sun' } })).hidden).toEqual([])
    const svg = renderSpriteSvg({ ...everything, pet: 'cat' }, { idPrefix: 'd' })
    expect(svg).not.toMatch(/data-layer="cape"|data-layer="back"|data-layer="face-wear"/)
  })

  it('anchors face, hats and paws to each species (no shared fixed spot)', () => {
    const faces = new Set(VECTOR_SPECIES.map((sp) => GEO[sp].face.join(',')))
    const hats = new Set(VECTOR_SPECIES.map((sp) => GEO[sp].hat.join(',')))
    expect(faces.size).toBeGreaterThanOrEqual(6)
    expect(hats.size).toBeGreaterThanOrEqual(6)
    for (const sp of VECTOR_SPECIES) {
      const g = GEO[sp]
      expect(g.face[2]).toBeGreaterThan(0.6)
      expect(g.hat[1]).toBeLessThan(g.face[1])
      expect(g.neck).toBeGreaterThan(g.face[1])
    }
  })

  it('draws every wear item in its slot on every species, with every expression', () => {
    for (const species of VECTOR_SPECIES) {
      for (const [slot, items] of Object.entries(WEAR)) {
        for (const item of items) {
          for (const expression of EXPRESSIONS) {
            const design: VectorSpriteDesign = { species, wear: { [slot]: item } }
            assertSound(renderSpriteSvg(design, { expression, idPrefix: 'w' }))
            const L = spriteLayers(design, { expression, idPrefix: 'w' })
            const layer = slot === 'face' ? 'face-wear'
              : item === 'space_helmet' ? 'helmet'
                : item === 'comet_cape' ? 'cape'
                  : slot
            expect(L[layer as keyof typeof L]).not.toBe('')
          }
        }
      }
    }
  })

  it('draws every outfit item on every species', () => {
    for (const species of VECTOR_SPECIES) {
      for (const [slot, items] of Object.entries(OUTFIT)) {
        for (const item of items) {
          const design: VectorSpriteDesign = { species, outfit: { [slot]: item } }
          assertSound(renderSpriteSvg(design, { idPrefix: 'o' }))
          const L = spriteLayers(design, { idPrefix: 'o' })
          expect(L[slot as 'top' | 'cape' | 'shoes']).not.toBe('')
        }
      }
    }
  })

  it('draws every pet with every host species, plus eye/cheek/pattern styles', () => {
    for (const species of VECTOR_SPECIES) {
      for (const pet of VECTOR_SPECIES) {
        const svg = renderSpriteSvg({ species, pet: { species: pet, color: '#ff8a3d' } }, { idPrefix: 'p' })
        const doc = assertSound(svg)
        expect(doc.querySelector('[data-layer="pet"]')).not.toBeNull()
      }
      for (const shape of EYE_STYLES) for (const cheeks of CHEEKS) for (const pattern of PATTERNS) {
        assertSound(renderSpriteSvg({ species, eyes: { shape }, cheeks, pattern }, { idPrefix: 'e' }))
      }
    }
  })

  it('draws a fully dressed Sprite with every slot filled at once', () => {
    for (const species of VECTOR_SPECIES) {
      for (let i = 0; i < 6; i++) {
        const design: VectorSpriteDesign = {
          species, palette: Object.keys(PALETTES)[i],
          wear: Object.fromEntries(Object.entries(WEAR).map(([s, items]) => [s, items[i % items.length]])),
          outfit: Object.fromEntries(Object.entries(OUTFIT).map(([s, items]) => [s, items[i % items.length]])),
          pet: VECTOR_SPECIES[i],
        }
        assertSound(renderSpriteSvg(design, { expression: EXPRESSIONS[i], glow: true, idPrefix: 'f' }))
      }
    }
  })

  it('paints layers in LAYER_ORDER', () => {
    const svg = renderSpriteSvg({ species: 'fox', wear: { head: 'party_hat', held: 'balloon', back: 'rainbow_trail' }, outfit: { top: 'tee_sun' } }, { idPrefix: 'z' })
    const seen = Array.from(svg.matchAll(/data-layer="([^"]+)"/g)).map((m) => m[1]).filter((l) => l !== 'glow' && l !== 'pet')
    const order = LAYER_ORDER.filter((l) => seen.includes(l))
    expect(seen).toEqual(order)
  })

  it('keeps two Sprites on one page apart (distinct prefixes, no shared ids)', () => {
    const a = parse(renderSpriteSvg({ species: 'owl' }, { idPrefix: 'a' }))
    const b = parse(renderSpriteSvg({ species: 'owl' }, { idPrefix: 'b' }))
    const shared = ids(a).filter((x) => ids(b).includes(x))
    expect(shared).toEqual([])
  })

  it('falls back to the species look for anything unknown or crafted', () => {
    const r = resolveSprite({
      species: 'unicorn', palette: 'nope', colors: { body: 'red; </svg><script>' },
      wear: { head: 'tiara' }, outfit: { top: 'armor' }, pet: { species: 'kraken' },
    } as unknown as VectorSpriteDesign, 'furious')
    expect(r.species).toBe('fox')
    expect(r.body).toBe('#ff8a3d')
    expect(r.expression).toBe('content')
    expect(r.wear).toEqual({})
    expect(r.outfit).toEqual({})
    expect(r.pet).toBeNull()
    const svg = renderSpriteSvg({ colors: { body: '"/><script>alert(1)</script>' } } as unknown as VectorSpriteDesign, { title: '<b>x</b>' })
    expect(svg).not.toMatch(/<script|<b>/)
  })

  it('names only species, wear and outfit the SpriteDesign validator knows', () => {
    const py = readFileSync(join(__dirname, '../../../../../lib/tutor/sprite_design.py'), 'utf8')
    for (const s of VECTOR_SPECIES) expect(py).toMatch(new RegExp(`SPECIES = \\([^)]*"${s}"`))
    // WEAR_ITEMS / TOPS / CAPES / SHOES arrive with SpriteDesign v2 (kids S6); once they are
    // on this branch every vector item must be one the validator accepts.
    if (/WEAR_ITEMS/.test(py)) {
      for (const items of [...Object.values(WEAR), ...Object.values(OUTFIT)]) {
        for (const item of items) expect(py).toContain(`"${item}"`)
      }
    }
  })

  it('mounts as a React element with unique ids per instance', () => {
    const { container } = render(<div><SpriteVector design={{ species: 'cat' }} size={64} /><SpriteVector design={{ species: 'cat' }} size={64} /></div>)
    const svgs = container.querySelectorAll('[data-testid="sprite-vector"] svg')
    expect(svgs).toHaveLength(2)
    const all = Array.from(container.querySelectorAll('[id]')).map((e) => e.id)
    expect(new Set(all).size).toBe(all.length)
  })
})
