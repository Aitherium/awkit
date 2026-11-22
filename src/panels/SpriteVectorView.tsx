/**
 * The Sprite v2 vector art as a React element (spriteVector.ts draws it; this only mounts it).
 *
 * The SVG string is built entirely from fixed shapes and validated colours (resolveSprite
 * drops anything that is not a known word or a #rrggbb), so mounting it as markup carries no
 * child-supplied text. Every instance gets its own id prefix, so many Sprites share a page.
 *
 * A design with a known `collective` id draws that Aitherium Collective character instead
 * (collective.ts): its round face inside its fairy glow, the face following the expression.
 * Every place that draws a child's Sprite goes through here, so one choice changes them all.
 */
import { useId, useMemo, type CSSProperties } from 'react'
import { renderSpriteSvg, type VectorSpriteDesign } from './spriteVector'
import { collectiveArt, collectiveFriend, collectiveMood } from './collective'

export interface SpriteVectorProps {
  design?: VectorSpriteDesign | null
  expression?: string
  size: number
  glow?: boolean
  shadow?: boolean
  label?: string
  /** speaking: 'open' / 'closed' mouth (unset = the expression's own) */
  mouth?: 'open' | 'closed'
  className?: string
  style?: CSSProperties
}

export function CollectiveSprite({ id, expression, size, label, className, style }:
  { id: string; expression?: string; size: number; label?: string; className?: string; style?: CSSProperties }) {
  const f = collectiveFriend(id)
  if (!f) return null
  const face = Math.round(size * 0.62)
  return (
    <span data-testid="sprite-vector" data-look="collective" data-collective={f.id} className={className}
      role="img" aria-label={label || f.label}
      style={{ position: 'relative', display: 'inline-block', width: size, height: size, lineHeight: 0, flexShrink: 0, ...style }}>
      {f.orb ? (
        <img src={collectiveArt(f.id, 'fairy')} alt="" aria-hidden draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover', opacity: 0.95 }} />
      ) : (
        <span aria-hidden style={{ position: 'absolute', inset: 0, borderRadius: '50%',
          background: `radial-gradient(circle, ${f.color}cc 0%, ${f.color}55 45%, transparent 72%)` }} />
      )}
      <img src={collectiveArt(f.id, collectiveMood(expression))} alt="" aria-hidden draggable={false}
        style={{ position: 'absolute', left: (size - face) / 2, top: (size - face) / 2, width: face, height: face,
          borderRadius: '50%', boxShadow: `0 0 0 ${Math.max(2, Math.round(size / 40))}px ${f.color}, 0 0 ${Math.round(size / 6)}px ${f.color}` }} />
    </span>
  )
}

export function SpriteVector({ design, expression, size, glow, shadow, label, mouth, className, style }: SpriteVectorProps) {
  const prefix = 'spv' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const collective = collectiveFriend(design?.collective)
  const markup = useMemo(
    () => (collective ? '' : renderSpriteSvg(design || {}, { expression, size, glow, shadow, idPrefix: prefix, title: label, mouth })),
    [collective, design, expression, size, glow, shadow, prefix, label, mouth],
  )
  if (collective) {
    return <CollectiveSprite id={collective.id} expression={expression} size={size} label={label} className={className} style={style} />
  }
  return (
    <span data-testid="sprite-vector" data-look="vector" className={className}
      style={{ display: 'inline-block', width: size, height: size, lineHeight: 0, flexShrink: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: markup }} />
  )
}
