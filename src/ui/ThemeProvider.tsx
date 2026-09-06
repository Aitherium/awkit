/**
 * ThemeProvider — applies a theme (palette + typography) as CSS variables on :root.
 *
 * Loads theme from /api/config/embed.theme by default, falls back to the inline
 * portal-kit defaults in portal-kit-vars.css. Re-renders when the theme changes
 * so brand-aware components (logo, accent buttons) can read the active theme.
 *
 * Usage:
 *   <ThemeProvider>
 *     <App />
 *   </ThemeProvider>
 *
 * Or with an explicit theme (used by BrandPanel preview):
 *   <ThemeProvider theme={previewTheme}>
 *     <BrandPanel />
 *   </ThemeProvider>
 *
 * Hooks:
 *   const { theme, brand, refresh } = useTheme()
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export interface ThemePalette {
  bg_deep?: string
  bg_base?: string
  bg_surface?: string
  bg_elevated?: string
  text_primary?: string
  text_secondary?: string
  text_muted?: string
  glass_border?: string
  accent_primary?: string
  accent_secondary?: string
  accent_success?: string
  accent_warn?: string
  accent_danger?: string
  sidebar_bg?: string
  sidebar_border?: string
  sidebar_section_label?: string
  sidebar_row_hover?: string
  sidebar_row_active_bg?: string
  brand_glow?: string
  divider?: string
  card_hover?: string
  radius?: string
  radius_lg?: string
  [key: string]: string | undefined
}

export interface Typography {
  font_sans?: string
  font_mono?: string
}

export interface Theme {
  id?: string
  mode?: 'dark' | 'light'
  palette?: ThemePalette
  typography?: Typography
}

export interface Brand {
  display_name?: string
  tagline?: string
  logo_url?: string
  logo_initial?: string
  favicon?: string
  short_description?: string
  industry?: string
  /**
   * Brand mark set — named currentColor SVG marks served by the backend
   * (e.g. /assets/marks/<name>.svg). `primary` names the default mark;
   * surfaces pick a named mark (spark/hex/orbit/dot/monogram) per use.
   */
  marks?: {
    primary?: string
    set?: Record<string, { file: string }>
  }
}

export interface ThemeContextValue {
  theme: Theme | null
  brand: Brand | null
  loading: boolean
  /** Re-fetch theme from /api/config/embed and re-apply. */
  refresh: () => Promise<void>
  /** Replace the current theme (e.g. live preview in BrandPanel). */
  setTheme: (next: Theme | null) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: null,
  brand: null,
  loading: true,
  refresh: async () => {},
  setTheme: () => {},
})

// snake_case -> kebab-case CSS variable name
function toCssVar(key: string): string {
  return '--' + key.replace(/_/g, '-')
}

/** Write a theme's palette + typography to :root as CSS variables. */
export function applyTheme(theme: Theme | null): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (!theme) return

  if (theme.palette) {
    for (const [key, value] of Object.entries(theme.palette)) {
      if (value === undefined || value === null) continue
      root.style.setProperty(toCssVar(key), String(value))
    }
  }
  if (theme.typography?.font_sans) {
    root.style.setProperty('--font-sans', theme.typography.font_sans)
  }
  if (theme.typography?.font_mono) {
    root.style.setProperty('--font-mono', theme.typography.font_mono)
  }
  if (theme.mode) {
    root.setAttribute('data-theme', theme.mode)
  }
  if (theme.id) {
    root.setAttribute('data-theme-id', theme.id)
  }
}

/** Set the document favicon if the brand provides one. */
export function applyBrand(brand: Brand | null): void {
  if (typeof document === 'undefined' || !brand) return
  if (brand.display_name) {
    document.title = brand.display_name
  }
  if (brand.favicon) {
    let link = document.querySelector<HTMLLinkElement>("link[rel*='icon']")
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.href = brand.favicon
  }
}

export interface ThemeProviderProps {
  children: ReactNode
  /** Override the config endpoint. Defaults to /api/config/embed. */
  configUrl?: string
  /** Skip fetching and use this theme directly (preview / Storybook). */
  theme?: Theme
  /** Skip fetching and use this brand directly. */
  brand?: Brand
  /** Whether to auto-fetch on mount. Default true. */
  autoLoad?: boolean
}

export function ThemeProvider({
  children,
  configUrl = '/api/config/embed',
  theme: overrideTheme,
  brand: overrideBrand,
  autoLoad = true,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme | null>(overrideTheme ?? null)
  const [brand, setBrandState] = useState<Brand | null>(overrideBrand ?? null)
  const [loading, setLoading] = useState<boolean>(autoLoad && !overrideTheme)

  const refresh = useCallback(async () => {
    if (overrideTheme) return
    setLoading(true)
    try {
      const res = await fetch(configUrl, { credentials: 'include' })
      if (!res.ok) {
        setLoading(false)
        return
      }
      const data = await res.json().catch(() => null)
      if (!data) {
        setLoading(false)
        return
      }
      if (data.theme && typeof data.theme === 'object') {
        applyTheme(data.theme as Theme)
        setThemeState(data.theme as Theme)
      }
      if (data.brand && typeof data.brand === 'object') {
        applyBrand(data.brand as Brand)
        setBrandState(data.brand as Brand)
      }
    } catch {
      // Best-effort — fall back to compiled-in CSS defaults.
    } finally {
      setLoading(false)
    }
  }, [configUrl, overrideTheme])

  // Apply override theme immediately.
  useEffect(() => {
    if (overrideTheme) {
      applyTheme(overrideTheme)
      setThemeState(overrideTheme)
    }
    if (overrideBrand) {
      applyBrand(overrideBrand)
      setBrandState(overrideBrand)
    }
  }, [overrideTheme, overrideBrand])

  // Fetch theme on mount.
  useEffect(() => {
    if (autoLoad && !overrideTheme) {
      void refresh()
    }
  }, [autoLoad, overrideTheme, refresh])

  const setTheme = useCallback((next: Theme | null) => {
    setThemeState(next)
    applyTheme(next)
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, brand, loading, refresh, setTheme }),
    [theme, brand, loading, refresh, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

/**
 * Load brand tokens from a .ELEMENT/brand.yaml endpoint and apply as theme.
 * Used by Agent Builder and workspace scaffold to apply a brand at runtime.
 *
 * @param brandUrl URL returning parsed brand.yaml JSON (e.g. /api/brand/tokens)
 * @param setTheme From useTheme().setTheme
 */
export async function loadBrandTokens(
  brandUrl: string,
  setTheme: (t: Theme | null) => void,
  setBrand?: (b: Brand | null) => void,
): Promise<void> {
  try {
    // Dynamic import to avoid bundling brandTokens when not needed
    const { parseBrandTokens, brandToTheme, brandToBrand } = await import('../lib/brandTokens')
    const res = await fetch(brandUrl, { credentials: 'include' })
    if (!res.ok) return
    const raw = await res.json()
    if (!raw?.palette) return
    const tokens = parseBrandTokens(raw)
    setTheme(brandToTheme(tokens))
    if (setBrand) setBrand(brandToBrand(tokens))
  } catch {
    // Best-effort — fall back to existing theme
  }
}
