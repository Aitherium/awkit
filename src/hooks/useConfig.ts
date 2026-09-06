/**
 * App configuration hook -- pulls all branding, labels, and capabilities
 * from the backend's brain pack via /api/config/embed.
 *
 * This is the templatization layer: the frontend has ZERO hardcoded brand
 * strings. Everything comes from the brain pack YAML on the backend.
 */

import { useState, useEffect } from 'react'
import { getApiBase } from '../lib/apiBase'

export interface VoiceConfig {
  enabled: boolean
  server_backed: boolean
  default_tier: 'browser' | 'server'
  default_mode: 'ptt' | 'vad' | 'continuous'
  tts_voice: string
  auto_speak_responses: boolean
}

export interface AppConfig {
  app_name: string
  company_name: string
  welcome_message: string
  icon: string
  features: string[]
  accepted_types: string[]
  ui_labels: Record<string, string>
  embed_path: string
  drop_endpoint: string
  loaded: boolean
  voice?: VoiceConfig
  apiBase?: string
  /** Panel IDs enabled for this app (empty = all registered panels) */
  panels?: string[]
  /** Panel IDs explicitly disabled */
  disabled_panels?: string[]
  /** Custom panel ordering */
  panel_order?: string[]
  /** Origin of the canonical AitherRelay (for the embedded Comms panel). */
  relay_base_url?: string
  /** Origin that serves /polls/embed (for the embedded Poll panel). */
  poll_embed_base_url?: string
  /** Workspace slug to scope embedded relay/comms to. */
  workspace_slug?: string
  /** Tenant id (used as a workspace fallback for the embedded relay). */
  tenant_id?: string
  /**
   * How to run this app on your OWN machine when the hosted platform is down.
   *
   * Declared in the published `config.js` alongside `__AITHER_API_BASE__`,
   * deliberately — it is the ONE channel that still works during an outage.
   * Anything served from `/api/config/embed` is unreachable at exactly the
   * moment this is needed, which is how "here is the fallback" ends up being
   * the thing that also went down.
   *
   * OPT-OUT, not opt-in. Omit it and every awkit app still offers the
   * platform installer, because self-hosting is a capability of AitherOS rather
   * than of any one tenant and the installer is identical for all of them. Set
   * `self_host: false` (or `{enabled: false}`) to suppress it — for an air-gapped
   * or contractually-hosted deployment where pointing a user at a local install
   * is genuinely wrong. Any field you DO set overrides the default; the rest
   * still fall back, so a partial config is never worse than none.
   */
  self_host?: SelfHostConfig | false
}

/** The self-host handoff shown when the platform cannot be reached. */
export interface SelfHostConfig {
  /** Set false to suppress the handoff entirely for this tenant. */
  enabled?: boolean
  /** One-liner the user can paste. Rendered selectable, never auto-run. */
  command?: string
  /** Page explaining the local install. */
  docs_url?: string
  /** Direct download for an installer or appliance image. */
  install_url?: string
  /** Overrides the default blurb when a tenant needs its own wording. */
  blurb?: string
}

const DEFAULT_CONFIG: AppConfig = {
  app_name: 'Knowledge Brain',
  company_name: '',
  welcome_message: 'Upload documents and ask questions.',
  icon: 'file-text',
  features: ['upload', 'chat', 'generate'],
  accepted_types: ['.pdf', '.docx', '.doc', '.xlsx', '.txt'],
  ui_labels: {},
  embed_path: '/',
  drop_endpoint: '/api/documents/upload',
  loaded: false,
}

let _configPromise: Promise<AppConfig> | null = null

/**
 * Static-brand fallback: a static-hosted build (GitHub Pages) has no backend to
 * answer `/api/config/embed`, so the published `config.js` may inject
 * `window.__AITHER_APP_CONFIG__` (same mechanism as `__AITHER_API_BASE__`).
 * Read before the fetch fallback so a build without a backend still gets its
 * real brand instead of the generic `DEFAULT_CONFIG`.
 */
function readStaticConfig(): Partial<AppConfig> | null {
  if (typeof window === 'undefined') return null
  const w = (window as unknown as Record<string, unknown>)['__AITHER_APP_CONFIG__']
  return w && typeof w === 'object' ? (w as Partial<AppConfig>) : null
}

function fetchConfig(): Promise<AppConfig> {
  if (!_configPromise) {
    // getApiBase() is '' for same-origin (relative, unchanged) and an absolute
    // backend origin for static-hosted builds. installIdentityHeaders also
    // rewrites this, but prefixing here keeps useConfig correct even if the
    // fetch wrapper isn't installed. The resolved base is exposed as
    // config.apiBase so panels that accept an apiBase prop inherit it.
    const base = getApiBase()
    const staticCfg = readStaticConfig()
    _configPromise = fetch(`${base}/api/config/embed`, base ? { credentials: 'include' } : undefined)
      .then(r => r.ok ? r.json() : (staticCfg || {}))
      .then(data => ({ ...DEFAULT_CONFIG, ...data, apiBase: base || data.apiBase, loaded: true }))
      .catch(() => ({ ...DEFAULT_CONFIG, ...(staticCfg || {}), apiBase: base || undefined, loaded: true }))
  }
  return _configPromise
}

export function useConfig(): AppConfig {
  // Seed from the static brand so the FIRST render is already branded. Starting
  // at DEFAULT_CONFIG makes a tenant show the generic platform name for one
  // frame and then swap -- a visible flash of the wrong company, on the login
  // screen. readStaticConfig() is synchronous and window-only, so this costs
  // nothing and is null-safe under SSR.
  const [config, setConfig] = useState<AppConfig>(
    () => ({ ...DEFAULT_CONFIG, ...(readStaticConfig() || {}) })
  )

  useEffect(() => {
    fetchConfig().then(setConfig)
  }, [])

  return config
}

export function useLabel(key: string, fallback: string): string {
  const config = useConfig()
  return config.ui_labels[key] || fallback
}
