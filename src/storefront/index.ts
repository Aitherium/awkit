// Theme
export { THEME_PRESETS, themeToCSS, generateThemeFromColors } from './StorefrontTheme'
export type { StorefrontTheme, StorefrontThemeColors } from './StorefrontTheme'
export { StorefrontThemeProvider, useStorefrontTheme } from './StorefrontThemeProvider'

// Cart
export { CartProvider, useCart } from './CartProvider'
export type { CartItem } from './CartProvider'

// Layout
export { default as StorefrontHeader } from './StorefrontHeader'
export { default as StorefrontFooter } from './StorefrontFooter'

// Product display
export { default as ProductCard } from './ProductCard'
export type { ProductCardProduct } from './ProductCard'
export { default as ProductGrid } from './ProductGrid'
export { default as ProductDetail } from './ProductDetail'

// Cart drawer
export { default as CartDrawer } from './CartDrawer'

// Checkout
export { default as CheckoutSuccess } from './CheckoutSuccess'
export { useStripeCheckout } from './useStripeCheckout'

// Landing page components
export { default as LandingHero } from './LandingHero'
export type { LandingHeroProps } from './LandingHero'
export { default as FeaturedSection } from './FeaturedSection'
export type { FeaturedSectionProps, FeaturedItem } from './FeaturedSection'
export { default as BrandStory } from './BrandStory'
export type { BrandStoryProps } from './BrandStory'

// Audio
export { useAmbientAudio } from './useAmbientAudio'
export { useAudioSystem } from './useAudioSystem'
export { default as AudioControls } from './AudioControls'
export { default as SoundLibrary } from './SoundLibrary'
export { BUILTIN_AUDIO_PROFILES, getAudioProfile } from './AudioTypes'
export type { AudioAsset, AudioProfile, AudioCategory, SfxTrigger, SynthProfile } from './AudioTypes'
