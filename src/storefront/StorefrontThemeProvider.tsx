'use client'

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import type { StorefrontTheme } from './StorefrontTheme'
import { THEME_PRESETS, themeToCSS } from './StorefrontTheme'

type Mode = 'light' | 'dark'

interface StorefrontThemeContextValue {
  theme: StorefrontTheme
  mode: Mode
  isDark: boolean
  toggleMode: () => void
  setMode: (m: Mode) => void
}

const StorefrontThemeContext = createContext<StorefrontThemeContextValue | null>(null)

function applyCSS(theme: StorefrontTheme, mode: Mode) {
  if (typeof document === 'undefined') return
  const colors = mode === 'dark' ? theme.darkColors : theme.colors
  const vars = themeToCSS(colors)
  vars['--sf-font-display'] = theme.typography.display
  vars['--sf-font-body'] = theme.typography.body
  if (theme.typography.mono) vars['--sf-font-mono'] = theme.typography.mono

  const radius = { sharp: '0px', slight: '8px', round: '16px', pill: '9999px' }
  vars['--sf-radius'] = radius[theme.roundness]

  const root = document.documentElement
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v)
  }
  root.classList.toggle('dark', mode === 'dark')
}

interface Props {
  preset?: string
  theme?: StorefrontTheme
  children: React.ReactNode
}

export function StorefrontThemeProvider({ preset = 'aitherium', theme: themeProp, children }: Props) {
  const theme = themeProp ?? THEME_PRESETS[preset] ?? THEME_PRESETS.aitherium

  const [mode, setModeState] = useState<Mode>(theme.defaultMode)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = localStorage.getItem(theme.storageKey) as Mode | null
    const initial: Mode = stored === 'light' || stored === 'dark' ? stored : theme.defaultMode
    setModeState(initial)
    applyCSS(theme, initial)
  }, [theme])

  const setMode = useCallback((m: Mode) => {
    setModeState(m)
    localStorage.setItem(theme.storageKey, m)
    applyCSS(theme, m)
  }, [theme])

  const toggleMode = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark')
  }, [mode, setMode])

  const value = useMemo(() => ({
    theme, mode, isDark: mode === 'dark', toggleMode, setMode,
  }), [theme, mode, toggleMode, setMode])

  return (
    <StorefrontThemeContext.Provider value={value}>
      {children}
    </StorefrontThemeContext.Provider>
  )
}

export function useStorefrontTheme() {
  const ctx = useContext(StorefrontThemeContext)
  if (!ctx) throw new Error('useStorefrontTheme must be used within StorefrontThemeProvider')
  return ctx
}
