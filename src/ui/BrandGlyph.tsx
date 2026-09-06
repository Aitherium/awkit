/**
 * BrandGlyph — renders a brand mark as a currentColor CSS mask.
 *
 * The mark SVGs are currentColor-only, so the glyph is tinted by whatever
 * `color` the caller sets (default: inherited currentColor). The element is
 * sized by the caller's className or style — no intrinsic size is set on the
 * mask variant.
 *
 * When the brand has no usable mark file (markFile returns undefined), falls
 * back to the initial tile used by BrandPanel (logo_initial first char, same
 * tile styling as BrandPanel.tsx:140).
 *
 * Usage:
 *   <BrandGlyph brand={brand} className="my-glyph" />
 *   <BrandGlyph brand={brand} markKey="spark" style={{ width: 20, height: 20 }} />
 */

import type { CSSProperties } from 'react'
import type { Brand } from './ThemeProvider'
import { markFile } from '../lib/brandTokens'

export interface BrandGlyphProps {
  brand: Brand | null | undefined
  /**
   * Mark key from brand.marks.set (e.g. 'spark', 'dot', 'monogram').
   * Defaults to the brand's primary mark.
   */
  markKey?: string
  /** Sizing class — the glyph fills whatever box the caller provides. */
  className?: string
  /** Inline styles merged over the base styles (sizing, animation, tint). */
  style?: CSSProperties
}

export default function BrandGlyph({ brand, markKey, className, style }: BrandGlyphProps) {
  const file = markFile(brand, markKey)
  const label = brand?.display_name ?? 'Brand'

  if (file) {
    return (
      <span
        role="img"
        aria-label={label}
        className={className}
        style={{
          display: 'inline-block',
          backgroundColor: 'currentColor',
          WebkitMaskImage: `url("${file}")`,
          maskImage: `url("${file}")`,
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          ...style,
        }}
      />
    )
  }

  // Initial fallback — same tile styling as BrandPanel.tsx:140.
  const initial = brand?.logo_initial ?? (brand?.display_name ?? 'A').charAt(0).toUpperCase()
  return (
    <span
      role="img"
      aria-label={label}
      className={className}
      style={{
        width: 48,
        height: 48,
        borderRadius: 'var(--radius-lg)',
        background: 'var(--accent-primary)',
        color: 'var(--bg-deep)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '1.3rem',
        fontWeight: 700,
        boxShadow: 'var(--brand-glow)',
        ...style,
      }}
    >
      {initial}
    </span>
  )
}
