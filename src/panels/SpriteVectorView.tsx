/**
 * The Sprite v2 vector art as a React element (spriteVector.ts draws it; this only mounts it).
 *
 * The SVG string is built entirely from fixed shapes and validated colours (resolveSprite
 * drops anything that is not a known word or a #rrggbb), so mounting it as markup carries no
 * child-supplied text. Every instance gets its own id prefix, so many Sprites share a page.
 */
import { useId, useMemo, type CSSProperties } from 'react'
import { renderSpriteSvg, type VectorSpriteDesign } from './spriteVector'

export interface SpriteVectorProps {
  design?: VectorSpriteDesign | null
  expression?: string
  size: number
  glow?: boolean
  shadow?: boolean
  label?: string
  className?: string
  style?: CSSProperties
}

export function SpriteVector({ design, expression, size, glow, shadow, label, className, style }: SpriteVectorProps) {
  const prefix = 'spv' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const markup = useMemo(
    () => renderSpriteSvg(design || {}, { expression, size, glow, shadow, idPrefix: prefix, title: label }),
    [design, expression, size, glow, shadow, prefix, label],
  )
  return (
    <span data-testid="sprite-vector" data-look="vector" className={className}
      style={{ display: 'inline-block', width: size, height: size, lineHeight: 0, flexShrink: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: markup }} />
  )
}
