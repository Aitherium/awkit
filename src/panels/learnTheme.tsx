/**
 * Aither Learn design tokens: ONE source for every Learn surface (the guardian
 * console, the kid app, the connect door, the install card).
 *
 * The family language (true black, one cyan accent, hairlines, Inter + JetBrains
 * Mono) in two modes. Every colour exists in BOTH sets with the same key, so a
 * screen can never fall back to a colour defined in only one theme
 * (__tests__/learn-theme.test.tsx asserts it). Components read colours as
 * `var(--al-<key>)` only; the root of each surface writes the variables with
 * `learnVars(mode)` and tags itself `data-learn-theme`.
 *
 * Mode: the global theme system (html[data-theme], lib/themes.ts) has no light
 * theme, so Learn honours `prefers-color-scheme` plus its own persisted switch
 * (LearnModeSwitch), stored per device under LEARN_MODE_KEY.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react'

export type LearnMode = 'dark' | 'light'
export type LearnModePref = LearnMode | 'system'

export interface LearnTokenSet {
  ground: string
  surface: string
  raise: string
  ink: string
  dim: string
  faint: string
  hairline: string
  hairlineStrong: string
  accent: string
  accentGlow: string
  accentWash: string
  onAccent: string
  amber: string
  amberWash: string
  qrField: string
  qrPaper: string
  /** Behind a child's own HTML page (FamilySpaceCard): white in both modes, so a page
   *  written with default black text stays readable whatever the Learn mode is. */
  pagePaper: string
  scrim: string
  shadow: string
  skeleton: string
}

export const LEARN_TOKENS: Record<LearnMode, LearnTokenSet> = {
  dark: {
    ground: '#050507',
    surface: '#0b0d12',
    raise: 'rgba(255,255,255,.035)',
    ink: '#EDEFF5',
    dim: 'rgba(237,239,245,.55)',
    faint: 'rgba(237,239,245,.34)',
    hairline: 'rgba(255,255,255,.08)',
    hairlineStrong: 'rgba(255,255,255,.18)',
    accent: '#5EC9CC',
    accentGlow: 'rgba(94,201,204,.35)',
    accentWash: 'rgba(94,201,204,.08)',
    onAccent: '#050507',
    amber: '#D4872B',
    amberWash: 'rgba(212,135,43,.12)',
    qrField: '#000000',
    qrPaper: '#FFFFFF',
    pagePaper: '#FFFFFF',
    scrim: 'rgba(3,3,5,.62)',
    shadow: '0 40px 120px -24px rgba(0,0,0,.9)',
    skeleton: 'rgba(255,255,255,.06)',
  },
  light: {
    ground: '#F6F7F9',
    surface: '#FFFFFF',
    raise: 'rgba(14,17,22,.03)',
    ink: '#0E1116',
    dim: 'rgba(14,17,22,.58)',
    faint: 'rgba(14,17,22,.40)',
    hairline: 'rgba(14,17,22,.10)',
    hairlineStrong: 'rgba(14,17,22,.22)',
    accent: '#1E9EA2',
    accentGlow: 'rgba(30,158,162,.22)',
    accentWash: 'rgba(30,158,162,.08)',
    // Ink, not white: white on #1E9EA2 is ~3.3:1 (fails AA for body-size text); ink is ~5.9:1.
    onAccent: '#0E1116',
    amber: '#B86E16',
    amberWash: 'rgba(184,110,22,.10)',
    qrField: '#0E1116',
    qrPaper: '#FFFFFF',
    pagePaper: '#FFFFFF',
    scrim: 'rgba(14,17,22,.32)',
    shadow: '0 24px 60px -24px rgba(14,17,22,.22)',
    skeleton: 'rgba(14,17,22,.06)',
  },
}

export const LEARN_TOKEN_KEYS = Object.keys(LEARN_TOKENS.dark) as Array<keyof LearnTokenSet>

function kebab(k: string): string {
  return k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

/** `--al-<key>` for one token key. */
export function learnVarName(k: keyof LearnTokenSet): string {
  return `--al-${kebab(k)}`
}

/** The CSS variables for one mode, for the root element's style. */
export function learnVars(mode: LearnMode): CSSProperties {
  const set = LEARN_TOKENS[mode]
  const out: Record<string, string> = { colorScheme: mode }
  for (const k of LEARN_TOKEN_KEYS) out[learnVarName(k)] = set[k]
  return out as CSSProperties
}

/** `var(--al-<key>)`, with the dark value as the fallback so a component
 *  rendered outside a Learn root still paints in the family palette. */
export const C = Object.fromEntries(
  LEARN_TOKEN_KEYS.map((k) => [k, `var(${learnVarName(k)}, ${LEARN_TOKENS.dark[k]})`]),
) as Record<keyof LearnTokenSet, string>

export const FONT_UI = "var(--font-inter, Inter), Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
export const FONT_MONO = "var(--font-mono, 'JetBrains Mono'), 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
export const EASE = 'cubic-bezier(.2,.8,.2,1)'

export const LEARN_MODE_KEY = 'aither_learn_appearance'
/** Fired on window when any Learn surface changes the switch, so siblings follow. */
export const LEARN_MODE_EVENT = 'aither-learn-mode'

function readPref(): LearnModePref {
  try {
    const v = window.localStorage.getItem(LEARN_MODE_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function readSystem(): LearnMode {
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/** The resolved Learn mode. First paint is dark (server and client agree), then
 *  the stored choice or the OS preference is adopted after mount. */
export function useLearnMode(): { mode: LearnMode; pref: LearnModePref; setPref: (p: LearnModePref) => void } {
  const [pref, setPrefState] = useState<LearnModePref>('system')
  const [system, setSystem] = useState<LearnMode>('dark')

  useEffect(() => {
    setPrefState(readPref())
    setSystem(readSystem())
    let mq: MediaQueryList | null = null
    try { mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null } catch { mq = null }
    // Another Learn surface on this page (or another tab) changed the switch.
    const onPref = () => setPrefState(readPref())
    window.addEventListener(LEARN_MODE_EVENT, onPref)
    window.addEventListener('storage', onPref)
    const off = () => {
      window.removeEventListener(LEARN_MODE_EVENT, onPref)
      window.removeEventListener('storage', onPref)
    }
    if (!mq) return off
    const on = () => setSystem(readSystem())
    if (mq.addEventListener) mq.addEventListener('change', on)
    return () => { off(); if (mq && mq.removeEventListener) mq.removeEventListener('change', on) }
  }, [])

  const setPref = useCallback((p: LearnModePref) => {
    setPrefState(p)
    try {
      if (p === 'system') window.localStorage.removeItem(LEARN_MODE_KEY)
      else window.localStorage.setItem(LEARN_MODE_KEY, p)
    } catch { /* private mode: this session only */ }
    try { window.dispatchEvent(new Event(LEARN_MODE_EVENT)) } catch { /* no window events */ }
  }, [])

  return { mode: pref === 'system' ? system : pref, pref, setPref }
}

/** auto · light · dark, as a quiet mono segmented control. */
export function LearnModeSwitch({ pref, onChange, big = false }: {
  pref: LearnModePref
  onChange: (p: LearnModePref) => void
  /** Kid surfaces: 64px targets. */
  big?: boolean
}) {
  const opts: Array<[LearnModePref, string]> = [['system', 'auto'], ['light', 'light'], ['dark', 'dark']]
  return (
    <div role="group" aria-label="Appearance" data-testid="learn-mode-switch" style={{
      display: 'inline-flex', border: `1px solid ${C.hairline}`, borderRadius: 999, padding: 3, gap: 2,
    }}>
      {opts.map(([v, label]) => {
        const on = pref === v
        return (
          <button key={v} type="button" aria-pressed={on} onClick={() => onChange(v)} className="al-focus"
            style={{
              minHeight: big ? 64 : 38, minWidth: big ? 72 : 52, padding: '0 12px', borderRadius: 999, border: 'none',
              cursor: 'pointer', background: on ? C.raise : 'transparent', color: on ? C.ink : C.dim,
              boxShadow: on ? `inset 0 0 0 1px ${C.hairlineStrong}` : 'none',
              font: `500 ${big ? 16 : 11}px/1 ${FONT_MONO}`, letterSpacing: '.12em', textTransform: 'lowercase',
              transition: `color .18s ${EASE}, background-color .18s ${EASE}`,
            }}>
            {label}
          </button>
        )
      })}
    </div>
  )
}

/** Shared rules inline styles cannot express: focus rings, hover, keyframes,
 *  reduced motion. Scoped by the `al-` prefix; render once per surface root. */
export const LEARN_CSS = `
.al-focus:focus-visible{outline:2px solid var(--al-accent,#5EC9CC);outline-offset:2px}
.al-field{transition:border-color .18s ${EASE},box-shadow .18s ${EASE}}
.al-field:focus{outline:none;border-color:var(--al-accent,#5EC9CC)!important;box-shadow:0 0 0 3px var(--al-accent-wash,rgba(94,201,204,.08))}
.al-quiet{transition:color .18s ${EASE}}
.al-quiet:hover{color:var(--al-ink,#EDEFF5)!important}
.al-primary{transition:box-shadow .2s ${EASE},transform .2s ${EASE},opacity .2s}
.al-primary:hover:not(:disabled){box-shadow:0 0 24px var(--al-accent-glow,rgba(94,201,204,.35))}
.al-primary:active:not(:disabled){transform:scale(.98)}
.al-primary:disabled{opacity:.42;cursor:not-allowed}
.al-tile{transition:border-color .24s ${EASE},transform .24s ${EASE}}
.al-tile:hover{border-color:var(--al-hairline-strong,rgba(255,255,255,.18))!important}
.al-in{animation:al-in .48s ${EASE} both}
.al-sheet{animation:al-sheet .36s ${EASE} both}
.al-fade{animation:al-fade .24s ${EASE} both}
.al-skel{animation:al-pulse 1.4s ease-in-out infinite}
.al-glow{position:relative}
/* The glow breathes by fading a STATIC shadow layer (compositor only). Animating box-shadow
   itself re-rastered the 64px blur every frame: "tile memory limits exceeded" on a Pixel 8. */
.al-glow::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:0 0 64px var(--al-accent-glow,rgba(94,201,204,.35));opacity:0;will-change:opacity;animation:al-glow 3.6s ease-in-out infinite}
.al-grow{animation:al-grow .6s ${EASE} both}
@keyframes al-in{from{opacity:0;transform:translateY(8px)}}
@keyframes al-sheet{from{opacity:0;transform:translateY(24px)}}
@keyframes al-fade{from{opacity:0}}
@keyframes al-pulse{50%{opacity:.45}}
@keyframes al-glow{50%{opacity:1}}
@keyframes al-grow{from{transform:scale(.86)}}
@media (prefers-reduced-motion:reduce){
  .al-in,.al-sheet,.al-fade,.al-skel,.al-glow,.al-glow::after,.al-grow{animation:none!important}
  .al-primary,.al-tile,.al-field,.al-quiet{transition:none!important}
}
`
