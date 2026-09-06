/**
 * Brand Token System — Composable brand ingestion for portal-kit/Iris.
 *
 * Reads a `.ELEMENT/brand.yaml`-shaped object and produces:
 *   - A ThemePalette (for ThemeProvider / workspace panels)
 *   - A StorefrontTheme (for StorefrontThemeProvider / public pages)
 *   - CSS custom property maps
 *
 * This is the bridge between the brand guide (design source of truth)
 * and the runtime theming system. Every app/agent can have its own
 * brand.yaml and get a fully composable theme without manual wiring.
 *
 * Usage:
 *   const tokens = parseBrandTokens(brandYaml)
 *   const sfTheme = brandToStorefrontTheme(tokens)
 *   const palette = brandToThemePalette(tokens, 'dark')
 */

import type { ThemePalette, Typography, Theme, Brand } from '../ui/ThemeProvider'
import type { StorefrontTheme, StorefrontThemeColors } from '../storefront/StorefrontTheme'

// ── Brand YAML shape ──────────────────────────────────────────────────────

export interface BrandIdentity {
  name: string
  tagline?: string
  taglines?: Record<string, string>
  symbol?: string
  logo_initial?: string
  favicon?: string
  atomic_number?: number
  atomic_mass?: string
  /**
   * Brand mark set — named currentColor SVG marks (e.g. /assets/marks/<name>.svg).
   * `primary` names the default mark; surfaces pick a named mark per use.
   */
  marks?: {
    primary?: string
    set?: Record<string, { file: string }>
  }
}

export interface BrandPaletteTokens {
  accent_primary: string
  accent_secondary: string
  accent_soft?: string
  accent_bridge?: string
  bg_deep: string
  bg_base: string
  bg_surface: string
  bg_elevated: string
  border: string
  glass_border?: string
  text_primary: string
  text_secondary: string
  text_muted: string
  text_ghost?: string
  accent_success?: string
  accent_warn?: string
  accent_danger?: string
  [key: string]: string | undefined
}

export interface BrandGradient {
  css: string
  stops?: string[]
  usage?: string
}

export interface BrandTypography {
  font_sans: string
  font_mono?: string
  font_display?: string
  weights?: Record<string, number>
}

export interface BrandShape {
  radius?: string
  radius_lg?: string
  radius_xl?: string
  roundness?: 'sharp' | 'slight' | 'round' | 'pill'
}

export interface BrandTokens {
  identity: BrandIdentity
  palette: { dark: BrandPaletteTokens; light: BrandPaletteTokens }
  gradients?: Record<string, BrandGradient>
  typography?: BrandTypography
  shape?: BrandShape
  assets?: Record<string, unknown>
  products?: unknown[]
}

// ── Parsing ───────────────────────────────────────────────────────────────

/** Parse a brand.yaml object into typed BrandTokens. */
export function parseBrandTokens(raw: Record<string, unknown>): BrandTokens {
  return {
    identity: (raw.identity ?? { name: 'Unknown' }) as BrandIdentity,
    palette: raw.palette as { dark: BrandPaletteTokens; light: BrandPaletteTokens },
    gradients: raw.gradients as Record<string, BrandGradient> | undefined,
    typography: raw.typography as BrandTypography | undefined,
    shape: raw.shape as BrandShape | undefined,
    assets: raw.assets as Record<string, unknown> | undefined,
    products: raw.products as unknown[] | undefined,
  }
}

// ── Convert to ThemePalette (workspace panels) ────────────────────────────

export function brandToThemePalette(
  tokens: BrandTokens,
  mode: 'dark' | 'light' = 'dark',
): ThemePalette {
  const p = tokens.palette[mode]
  const glow = tokens.gradients?.glow?.css

  return {
    bg_deep: p.bg_deep,
    bg_base: p.bg_base,
    bg_surface: p.bg_surface,
    bg_elevated: p.bg_elevated,
    text_primary: p.text_primary,
    text_secondary: p.text_secondary,
    text_muted: p.text_muted,
    glass_border: p.glass_border ?? p.border,
    accent_primary: p.accent_primary,
    accent_secondary: p.accent_secondary,
    accent_cyan: p.accent_soft ?? p.accent_primary,
    accent_success: p.accent_success,
    accent_warn: p.accent_warn,
    accent_danger: p.accent_danger,
    brand_glow: glow,
    divider: p.glass_border ?? `${p.border}99`,
    card_hover: `${p.text_primary}0A`,
    radius: tokens.shape?.radius,
    radius_lg: tokens.shape?.radius_lg,
  }
}

/** Build a full Theme object from brand tokens. */
export function brandToTheme(tokens: BrandTokens, mode: 'dark' | 'light' = 'dark'): Theme {
  return {
    id: tokens.identity.name.toLowerCase().replace(/\s+/g, '-'),
    mode,
    palette: brandToThemePalette(tokens, mode),
    typography: {
      font_sans: tokens.typography?.font_sans,
      font_mono: tokens.typography?.font_mono,
    },
  }
}

/** Build a Brand object from brand tokens. */
export function brandToBrand(tokens: BrandTokens): Brand {
  return {
    display_name: tokens.identity.name,
    tagline: tokens.identity.tagline ?? tokens.identity.taglines?.primary,
    logo_initial: tokens.identity.logo_initial ?? tokens.identity.symbol,
    favicon: tokens.identity.favicon,
    marks: tokens.identity.marks,
  }
}

/**
 * Resolve the mark file a surface should render.
 *
 * Prefers `set[key]` when a key is given, else the brand's primary mark;
 * falls back to the first entry of the set. Returns the file ONLY for
 * same-origin asset paths (starts with "/", not "//") — anything else
 * returns undefined so the caller keeps its existing fallback.
 */
export function markFile(brand: Brand | null | undefined, key?: string): string | undefined {
  const set = brand?.marks?.set
  if (!set) return undefined
  const entry = set[key || brand.marks?.primary || ''] ?? Object.values(set)[0]
  const file = entry?.file
  if (typeof file !== 'string') return undefined
  return file.startsWith('/') && !file.startsWith('//') ? file : undefined
}

// ── Convert to StorefrontTheme (public storefront) ────────────────────────

function paletteToStorefrontColors(p: BrandPaletteTokens): StorefrontThemeColors {
  return {
    primary: p.accent_primary,
    secondary: p.accent_secondary,
    accent: p.accent_soft ?? p.accent_primary,
    background: p.bg_deep,
    surface: p.bg_surface,
    text: {
      primary: p.text_primary,
      secondary: p.text_secondary,
      muted: p.text_muted,
    },
    border: p.border,
  }
}

export function brandToStorefrontTheme(tokens: BrandTokens): StorefrontTheme {
  const name = tokens.identity.name
  const roundness = tokens.shape?.roundness ?? 'slight'

  return {
    name,
    colors: paletteToStorefrontColors(tokens.palette.light),
    darkColors: paletteToStorefrontColors(tokens.palette.dark),
    typography: {
      display: tokens.typography?.font_display ?? tokens.typography?.font_sans ?? "'Inter', system-ui, sans-serif",
      body: tokens.typography?.font_sans ?? "'Inter', system-ui, sans-serif",
      mono: tokens.typography?.font_mono,
    },
    roundness,
    storageKey: `${name.toLowerCase().replace(/\s+/g, '-')}-store-theme`,
    defaultMode: 'dark',
  }
}

// ── CSS Variable Generation ───────────────────────────────────────────────

/** Generate a flat CSS variable map from brand tokens (for injection into :root). */
export function brandToCSSVars(
  tokens: BrandTokens,
  mode: 'dark' | 'light' = 'dark',
): Record<string, string> {
  const p = tokens.palette[mode]
  const vars: Record<string, string> = {}

  // Map palette tokens to CSS vars
  for (const [key, value] of Object.entries(p)) {
    if (value === undefined) continue
    vars[`--${key.replace(/_/g, '-')}`] = value
  }

  // Typography
  if (tokens.typography?.font_sans) vars['--font-sans'] = tokens.typography.font_sans
  if (tokens.typography?.font_mono) vars['--font-mono'] = tokens.typography.font_mono

  // Shape
  if (tokens.shape?.radius) vars['--radius'] = tokens.shape.radius
  if (tokens.shape?.radius_lg) vars['--radius-lg'] = tokens.shape.radius_lg
  if (tokens.shape?.radius_xl) vars['--radius-xl'] = tokens.shape.radius_xl

  // Gradients as custom properties
  if (tokens.gradients?.creation?.css) vars['--gradient-creation'] = tokens.gradients.creation.css
  if (tokens.gradients?.ai_symbol?.css) vars['--gradient-ai-symbol'] = tokens.gradients.ai_symbol.css
  if (tokens.gradients?.glow?.css) vars['--brand-glow'] = tokens.gradients.glow.css

  return vars
}

// ── Aitherium Brand Tokens (hardcoded fallback) ───────────────────────────

/** The canonical Aitherium brand tokens, matching brand guide v1.0. */
export const AITHERIUM_BRAND: BrandTokens = {
  identity: {
    name: 'Aitherium',
    tagline: 'The Element of Creation',
    symbol: 'Ai',
    logo_initial: 'Ai',
    atomic_number: 47,
    atomic_mass: '208.043',
    favicon: '/assets/brand-assets/aitherium-logo/favicon.ico',
  },
  palette: {
    dark: {
      accent_primary: '#00E5FF',
      accent_secondary: '#7C4DFF',
      accent_soft: '#40C4FF',
      accent_bridge: '#536DFE',
      bg_deep: '#060D1A',
      bg_base: '#0A1628',
      bg_surface: '#0A1628',
      bg_elevated: '#1A2A40',
      border: '#1A2A40',
      glass_border: 'rgba(26, 42, 64, 0.8)',
      text_primary: '#E8F0F8',
      text_secondary: '#8EACCD',
      text_muted: '#4A6A8A',
      text_ghost: '#2A4A6A',
      accent_success: '#4ADE80',
      accent_warn: '#F59E0B',
      accent_danger: '#F87171',
    },
    light: {
      accent_primary: '#0077B6',
      accent_secondary: '#5A189A',
      accent_soft: '#0096C7',
      accent_bridge: '#4361EE',
      bg_deep: '#F8FAFC',
      bg_base: '#FFFFFF',
      bg_surface: '#F1F5F9',
      bg_elevated: '#E2E8F0',
      border: '#CBD5E1',
      glass_border: 'rgba(203, 213, 225, 0.8)',
      text_primary: '#0F172A',
      text_secondary: '#475569',
      text_muted: '#94A3B8',
      text_ghost: '#CBD5E1',
      accent_success: '#16A34A',
      accent_warn: '#D97706',
      accent_danger: '#DC2626',
    },
  },
  gradients: {
    creation: {
      css: 'linear-gradient(135deg, #00E5FF, #536DFE, #7C4DFF)',
      stops: ['#00E5FF', '#536DFE', '#7C4DFF'],
    },
    ai_symbol: {
      css: 'linear-gradient(135deg, #00E5FF, #40C4FF)',
      stops: ['#00E5FF', '#40C4FF'],
    },
    glow: {
      css: '0 0 0 1px rgba(0, 229, 255, 0.18), 0 8px 24px rgba(0, 229, 255, 0.08)',
    },
  },
  typography: {
    font_sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    font_mono: "'JetBrains Mono', 'Fira Code', monospace",
    font_display: "'Inter', -apple-system, sans-serif",
  },
  shape: {
    radius: '8px',
    radius_lg: '12px',
    radius_xl: '16px',
    roundness: 'slight',
  },
}
