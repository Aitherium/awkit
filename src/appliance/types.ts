/**
 * Types for every JSON contract the appliance console speaks.
 *
 * One file, owned by the console-surfaces gap, so a feature panel (setup, license,
 * updates, components, endpoints) never re-declares a shape it did not define. The
 * shapes mirror the program contracts verbatim:
 *   license-envelope-and-status   /var/lib/aither/license/status.json
 *   update-channels-and-status    /var/lib/awnix/update-status.json
 *   component-state               `awnix component ... --json`
 *   endpoints-env                 `awnix endpoints show|probe --json`
 *   setup-state-and-steps         /etc/awnix/setup.json v2 + steps.d
 *   appliance-web-api             the awnix-console HTTP envelope
 *
 * Vite-safe: no next/* anywhere under appliance/ (check_awnix_surfaces AWS004).
 */
import type { ComponentType } from 'react'
import type { ApplianceClient } from './client'

/** Every outcome a panel must render. There is no "empty success". */
export type ApiState =
  | 'ok'
  | 'refused'
  | 'unavailable'
  | 'not-entitled'
  | 'locked'
  | 'not-an-appliance'
  | 'error'

/** What the client hands a panel for every call. */
export interface ApiResult<T> {
  state: ApiState
  /** HTTP status; 0 when the request never got an answer. */
  status: number
  data: T | null
  detail?: string
  /** The owning CLI's exit code, when the console ran one. */
  exit?: number | null
  stdoutTail?: string
  /** Seconds until login unlocks (423). */
  retryAfter?: number
}

/** The console's response envelope for reads and actions. */
export interface Envelope<T> {
  verb: string
  exit: number | null
  state: string
  result: T | null
  stdout_tail: string
  detail?: string
  available?: boolean
}

// ── session ────────────────────────────────────────────────────────────────

export type ConsoleMode = 'setup' | 'console'

export interface Session {
  mode: ConsoleMode
  authenticated: boolean
  profile: string
  brand: string
  variant: string
  version?: string
}

export interface LoginResult {
  authenticated: boolean
  mode: ConsoleMode
}

// ── license (activation) ───────────────────────────────────────────────────

export type LicenseState =
  | 'unlicensed'
  | 'valid'
  | 'expired'
  | 'invalid'
  | 'revoked'
  | 'refused'
  | 'offline'

export type RegistryState = 'armed' | 'refused' | 'offline' | 'unconfigured' | 'legacy-token'

export interface LicenseStatus {
  schema: 1
  state: LicenseState
  lic_id: string | null
  sku: string | null
  tier: string | null
  /** Unix seconds; 0 = perpetual. */
  exp: number | null
  checked_at: string | null
  detail: string
  entitlements: {
    appliance_tier: string | null
    images: string[]
    packs: string[]
  }
  registry: {
    state: RegistryState
    expires_at: string | null
    images: number
  }
}

// ── updates ────────────────────────────────────────────────────────────────

export type UpdateChannel = 'stable' | 'beta'

export type UpdateStateName =
  | 'current'
  | 'staged'
  | 'unsigned-refused'
  | 'auth-refused'
  | 'license-refused'
  | 'offline'
  | 'error'
  | 'no-credential'
  | 'never-checked'

export interface UpdateStatus {
  checked_at: string | null
  state: UpdateStateName
  channel: UpdateChannel
  booted_digest: string | null
  available_digest: string | null
  staged_digest: string | null
  signer_identity: string | null
  rollback_available: boolean
  auto_apply: boolean
  detail: string
  /** Additive finer verdict from awnix-update (rolled-back | staged-unverified |
   * channel-unpublished); `state` stays in the enum above. UpdatesPanel.verdictOf reads it. */
  reason?: string
}

// ── components ─────────────────────────────────────────────────────────────

export type ComponentKind = 'pypi' | 'git' | 'container' | 'pack' | 'baked'

export type ComponentResultState =
  | 'baked'
  | 'installed'
  | 'available'
  | 'unavailable'
  | 'needs-license'
  | 'failed'

export interface ComponentResult {
  id: string
  kind: ComponentKind
  state: ComponentResultState
  version: string | null
  pin: string | null
  previous_pin: string | null
  reason: string
  log_tail: string
}

export interface ComponentsResult {
  ok: boolean
  op: string
  results: ComponentResult[]
}

// ── endpoints ──────────────────────────────────────────────────────────────

export type EndpointSource = 'default' | 'vendor-env' | 'admin-env' | 'process-env'

export interface Endpoint {
  var: string
  value: string
  source: EndpointSource
  internal: boolean
  reachable?: 'ok' | 'unreachable' | 'off'
}

export interface EndpointsResult {
  endpoints: Endpoint[]
}

// ── setup ──────────────────────────────────────────────────────────────────

export type SetupStepKind = 'choice' | 'text' | 'secret' | 'toggle' | 'info' | 'reveal'

export type SetupStepStatus = 'done' | 'skipped' | 'failed'

export interface SetupOption {
  value: string
  label?: string
}

export interface SetupStep {
  schema: 1
  id: string
  title: string
  why: string
  kind: SetupStepKind
  required: boolean
  timeout_s?: number
  variants?: string[]
  after?: string[]
  /** Filled by awnix_setup.api from options_cmd. */
  options?: Array<SetupOption | string>
  /** Filled from current_cmd; never a secret. */
  current?: string | boolean | null
  status?: SetupStepStatus | null
}

/** Alias used by the setup wizard. */
export type Step = SetupStep

export interface SetupSteps {
  steps: SetupStep[]
}

/** /etc/awnix/setup.json v2 as the console reports it (redacted). v1 readers accepted. */
export interface SetupState {
  version: 1 | 2
  hostname?: string
  admin_user?: string
  ssh_key_fingerprints?: string[]
  core?: string[]
  installed?: string[]
  linked?: boolean
  link_host?: string
  steps?: Record<string, { status: SetupStepStatus; at?: string }>
  completed_at?: string | null
}

export interface SetupApplyResult {
  ok: boolean
  id?: string
  detail?: string
  /** Output of a `reveal` step: shown once, never stored. */
  reveal?: string
  [k: string]: unknown
}

// ── surfaces ───────────────────────────────────────────────────────────────

export type SurfaceDelivery = 'baked' | 'image-private' | 'link' | 'absent'

export interface Surface {
  id: string
  label: string
  delivery: SurfaceDelivery
  licence: string
  description?: string
  url?: string
  command?: string
}

export interface Surfaces {
  variant: string
  console: { bind: string; profile: string; brand: string }
  surfaces: Surface[]
}

// ── overview ───────────────────────────────────────────────────────────────

export interface Overview {
  hostname: string
  variant: string
  image_repo: string
  profile: string
  brand: string
  uptime_s: number | null
  console: { url: string; fingerprint: string | null }
  license: {
    state: LicenseState | 'unavailable'
    sku?: string | null
    tier?: string | null
    exp?: number | null
    days_left?: number | null
    registry?: RegistryState | null
  }
  updates: {
    state: UpdateStateName | 'unavailable' | null
    channel?: UpdateChannel | null
    booted_digest?: string | null
    available_digest?: string | null
    checked_at?: string | null
  }
}

// ── actions ────────────────────────────────────────────────────────────────

export type ActionVerb =
  | 'update-check'
  | 'update-apply'
  | 'update-rollback'
  | 'update-channel'
  | 'update-auto-apply'
  | 'license-import'
  | 'license-refresh'
  | 'component-install'
  | 'component-remove'
  | 'component-rollback'
  | 'endpoints-probe'
  | 'setup-rerun'
  | 'mesh-join'
  | 'mesh-leave'
  | 'mesh-retry'
  | 'update-offline-scan'
  | 'update-offline-stage'

export interface ActionBodies {
  'update-check': Record<string, never>
  'update-apply': Record<string, never>
  'update-rollback': Record<string, never>
  'update-channel': { channel: UpdateChannel }
  'update-auto-apply': { value: 'on' | 'off' }
  'license-import': { license: string }
  'license-refresh': Record<string, never>
  'component-install': { id: string }
  'component-remove': { id: string }
  'component-rollback': { id: string }
  'endpoints-probe': Record<string, never>
  'setup-rerun': Record<string, never>
  /** The enroll token goes to the CLI on stdin (`awnix mesh join -`), never argv. */
  'mesh-join': { token: string }
  'mesh-leave': Record<string, never>
  'mesh-retry': Record<string, never>
  'update-offline-scan': Record<string, never>
  /** An absolute path on removable media (/run/media, /var/mnt, /media). */
  'update-offline-stage': { bundle: string }
}

export type ActionResult<T = unknown> = Envelope<T>

// ── composition ────────────────────────────────────────────────────────────

/** Every feature panel: one file, default export, props {client}. */
export interface AppliancePanelProps {
  client: ApplianceClient
}

export interface ApplianceTab {
  id: string
  label: string
  Component: ComponentType<AppliancePanelProps>
}

export const APPLIANCE_TAB_IDS = [
  'setup',
  'overview',
  'license',
  'updates',
  'components',
  'endpoints',
  'surfaces',
  'guide',
] as const
