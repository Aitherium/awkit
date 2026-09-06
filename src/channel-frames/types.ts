/**
 * Channel-native artifact frames — shared contract.
 *
 * A "frame" renders a marketing/product artifact inside a faithful mockup of the
 * channel it would ship on (an email inside Gmail's UI, a post inside the X feed,
 * an App Store listing card, ...). Iris/AitherDesign generate the brand + content;
 * the frames make the artifact feel real before anything is published.
 *
 * Frames are deliberately NOT themed with portal-kit CSS vars on the inside:
 * the inner chrome imitates the target platform's real palette (Gmail is light,
 * X is dark). Only the outer wrapper (label, border) uses portal-kit vars so the
 * gallery sits naturally in a portal surface.
 */

export interface ChannelBrand {
  /** Brand display name, e.g. "Brightleaf Coffee" */
  name: string
  /** Social handle without the @, e.g. "brightleaf" */
  handle?: string
  /** Logo image (data: URI or same-origin URL). Omit → monogram fallback. */
  logoUrl?: string
  /** Brand accent color (hex). Drives CTA buttons, avatar fallback, highlights. */
  accentColor?: string
  /** One-line tagline shown where the channel has room for it */
  tagline?: string
  /** Website shown in profile-ish spots, e.g. "brightleaf.coffee" */
  website?: string
}

export interface ChannelArtifactContent {
  /** Subject line / post lead / app title — channel decides placement */
  headline?: string
  /** Main copy. Frames render newlines as paragraph breaks. */
  body: string
  /** Hero/creative image (data: URI ok). Omit → accent-gradient placeholder. */
  imageUrl?: string
  /** Call-to-action label, e.g. "Order Now" */
  cta?: string
  /**
   * Channel-specific extras, all optional. Conventions:
   * gmail: { preheader, fromEmail }
   * appstore: { category, rating, ratingCount, subtitle, price }
   * imessage: { contactName, replies } (replies = newline-separated incoming lines)
   * instagram/x/linkedin: { likes, comments, shares, timestamp }
   */
  meta?: Record<string, string>
}

export interface ChannelFrameProps {
  brand: ChannelBrand
  content: ChannelArtifactContent
  /** Rendered width in px; defaults to the channel's natural width */
  width?: number
  className?: string
}

export type ChannelId =
  | 'gmail_email'
  | 'instagram_post'
  | 'x_post'
  | 'linkedin_post'
  | 'appstore_listing'
  | 'imessage'

/** Initial-letter monogram used when brand.logoUrl is absent */
export function brandMonogram(brand: ChannelBrand): string {
  return (brand.name || '?').trim().charAt(0).toUpperCase()
}

/** Accent with a safe default so frames never render colorless */
export function brandAccent(brand: ChannelBrand): string {
  return brand.accentColor || '#536DFE'
}
