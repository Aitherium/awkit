/**
 * Storefront Theme Token System
 *
 * Defines the theming contract for all storefront components.
 * Components use CSS custom properties (--sf-*) set by StorefrontThemeProvider.
 */

export interface StorefrontThemeColors {
  primary: string
  secondary: string
  accent: string
  background: string
  surface: string
  text: { primary: string; secondary: string; muted: string }
  border: string
}

export interface StorefrontTheme {
  name: string
  colors: StorefrontThemeColors
  darkColors: StorefrontThemeColors
  typography: {
    display: string
    body: string
    mono?: string
  }
  roundness: 'sharp' | 'slight' | 'round' | 'pill'
  storageKey: string
  defaultMode: 'light' | 'dark'
  audio?: {
    profileId: string
    enableByDefault: boolean
    allowUserToggle: boolean
  }
}

/** Generate a full StorefrontTheme from two brand colors */
export function generateThemeFromColors(
  primary: string,
  secondary: string,
  name = 'Custom',
): StorefrontTheme {
  return {
    name,
    colors: {
      primary,
      secondary,
      accent: primary,
      background: '#F8FAFC',
      surface: '#FFFFFF',
      text: { primary: '#0F172A', secondary: '#475569', muted: '#94A3B8' },
      border: '#E2E8F0',
    },
    darkColors: {
      primary,
      secondary,
      accent: primary,
      background: '#0A0E17',
      surface: '#111827',
      text: { primary: '#F3F4F6', secondary: '#9CA3AF', muted: '#6B7280' },
      border: '#1F2937',
    },
    typography: {
      display: "'Inter', system-ui, sans-serif",
      body: "'Inter', system-ui, sans-serif",
    },
    roundness: 'slight',
    storageKey: `${name.toLowerCase().replace(/\s+/g, '-')}-theme`,
    defaultMode: 'dark',
  }
}

//
// The gargbot / chelle / wildroot presets were REMOVED 2026-09-05. They named
// customers inside a package strangers install, which is a disclosure no secret
// scanner fires on -- and they had NO consumer: nothing anywhere passes
// preset="gargbot", and StorefrontThemeProvider already falls back to
// `aitherium` for an unknown key while accepting a full theme via `themeProp`.
// A tenant's real theme lives in its pack (`brand.color_primary` /
// `color_accent` / `color_surface`), which is what actually deploys; these were
// a stale second copy. AWK003 in check_adk_publishable had been REFUSING to
// publish this package over them since before it ever succeeded once.
export const THEME_PRESETS: Record<string, StorefrontTheme> = {
  aitherium: {
    name: 'Aitherium',
    colors: {
      primary: '#0077B6',        // Ocean Blue (light mode primary)
      secondary: '#5A189A',      // Deep Violet (light mode secondary)
      accent: '#0096C7',         // Soft cyan for light
      background: '#F8FAFC',
      surface: '#F1F5F9',
      text: { primary: '#0F172A', secondary: '#475569', muted: '#94A3B8' },
      border: '#CBD5E1',
    },
    darkColors: {
      primary: '#00E5FF',        // Cyan Glow — brand guide primary
      secondary: '#7C4DFF',      // Cosmic Violet — brand guide secondary
      accent: '#40C4FF',         // Soft Cyan — hover states
      background: '#060D1A',     // Void — brand guide bg
      surface: '#0A1628',        // Deep Surface
      text: { primary: '#E8F0F8', secondary: '#8EACCD', muted: '#4A6A8A' },
      border: '#1A2A40',
    },
    typography: {
      display: "'Inter', -apple-system, sans-serif",
      body: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      mono: "'JetBrains Mono', 'Fira Code', monospace",
    },
    roundness: 'slight',
    storageKey: 'aitherium-store-theme',
    defaultMode: 'dark',
    audio: {
      profileId: 'aitherium-digital',
      enableByDefault: false,
      allowUserToggle: true,
    },
  },

}

/** Convert a StorefrontThemeColors object to CSS custom property entries */
export function themeToCSS(colors: StorefrontThemeColors): Record<string, string> {
  return {
    '--sf-primary': colors.primary,
    '--sf-secondary': colors.secondary,
    '--sf-accent': colors.accent,
    '--sf-background': colors.background,
    '--sf-surface': colors.surface,
    '--sf-text': colors.text.primary,
    '--sf-text-secondary': colors.text.secondary,
    '--sf-text-muted': colors.text.muted,
    '--sf-border': colors.border,
  }
}
