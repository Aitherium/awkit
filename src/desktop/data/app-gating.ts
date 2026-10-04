/**
 * App gating — the canonical per-app gating class declaration.
 *
 * Stage 1 of the app-family collapse (owner directive 2026-08-31): every app
 * declares EXACTLY ONE gating class — `anon | auth | rbac | tenant-scoped |
 * acta | license | device-local` — declared once here, consumed by every
 * plane (Veil OS launcher, desktop-core catalog, tenant shell), asserted by
 * check_app_gating.py (AG001-AG010).
 *
 * Resolution order (the checker derives, never hardcodes):
 *   1. Explicit APP_GATING entry wins.
 *   2. Else derive: manifest `rbac` → rbac; manifest `acta` → acta; manifest
 *      `license` → license; AUTH_REQUIRED_APPS / requiresAuth → auth;
 *      tenantIsolated/scopeTag → tenant-scoped; else anon.
 *
 * This file only declares the classes that are NOT derivable from another
 * plane, plus the device-local set (which CONTRADICTS the manifest — the
 * declaration is what makes the contradiction a measured, pinned fact rather
 * than a silent conflict).
 *
 * Pure data, zero imports — jest-loadable and Python-parseable (the checker
 * regex-parses it like it parses the other TS planes).
 */

export type GatingClass =
  | 'anon'
  | 'auth'
  | 'rbac'
  | 'tenant-scoped'
  | 'acta'
  | 'license'
  | 'device-local'

export interface AppGating {
  class: GatingClass
  /** class === 'rbac' — the manifest/route-manifest permission */
  rbac?: { resource: string; action: string }
  /** class === 'acta' — must exist in AitherACTA PLANS[*].features */
  acta?: string
  /** class === 'license' — must resolve in config/app_licenses.yaml */
  license?: string
  /** class === 'device-local' — REQUIRED (AG002: a reasonless class is a hole) */
  reason?: string
}

/**
 * The declaration. Keys are OS-registry app ids (the ids the launcher shows).
 * Only non-derivable classes are listed; the checker derives the rest.
 */
export const APP_GATING: Readonly<Record<string, AppGating>> = {
  // ── Device-local (owner decision 2026-08-31: classify, no fake backends) ──
  calendar: {
    class: 'device-local',
    reason:
      'IndexedDB schedule on this device; the CalDAV full-stack calendar is the manifest app "calendar-sync" (renamed 2026-09-01, AG003 discharge).',
  },
  notes: {
    class: 'device-local',
    reason: 'IndexedDB notes; no notes backend exists.',
  },
  calculator: {
    class: 'device-local',
    reason: 'Local arithmetic parser + tape; pure client. The manifest "calculator" vestige was deleted 2026-09-01 (AG003 discharge).',
  },
  docs: {
    class: 'device-local',
    reason:
      'Autosaved local markdown (OPFS/IndexedDB); the platform docs site is the manifest app "platform-docs" (renamed 2026-09-01, AG003 discharge).',
  },
  clipboard: {
    class: 'device-local',
    reason:
      'Copy history in IndexedDB on this device; the cross-session variant is the manifest app "clipboard-sync" (renamed 2026-09-01, AG003 discharge).',
  },
  backups: {
    class: 'device-local',
    reason:
      'Snapshot/restore of device-local IndexedDB state; no cloud backend by owner decision.',
  },
  'system-settings': {
    class: 'device-local',
    reason: 'This device universe/desktops settings, local storage only.',
  },
  'task-manager': {
    class: 'device-local',
    reason:
      'Local process/GPU view from the browser/platform surface; no server.',
  },
  // The Office FAMILY (2026-09-01 collapse): one tile for the four
  // device-local work apps. The family adds no backend — it is a tab bar over
  // members that are each device-local by owner decision.
  office: {
    class: 'device-local',
    reason:
      'Family surface over calendar/notes/calculator/docs — all members device-local by owner decision; the family adds no backend.',
  },

  // ── ACTA-gated (feature must exist in AitherACTA PLANS[*].features) ─────
  'company-room': {
    class: 'acta',
    acta: 'company_room',
  },
  kodokevo: {
    class: 'acta',
    acta: 'agent_interaction',
  },
  // The canvas family (iris/builder): feature `canvas`.
  iris: { class: 'acta', acta: 'canvas' },
  builder: { class: 'acta', acta: 'canvas' },
  saga: { class: 'acta', acta: 'saga' },

  // ── RBAC-gated (server boundary: route-manifest resource:action) ─────────
  admin: {
    class: 'rbac',
    rbac: { resource: 'system', action: 'admin' },
  },
  // Platform-operator surfaces (audience sweep, 2026-09-29). Each was class
  // `anon` or `auth` only because it sat in no list — so a guest could open it
  // by `?app=` and every signed-in customer got a tile. They are the platform's
  // own consoles, never a customer's, so they carry the `admin` window's class.
  //   sentry   — /aitherscope/: the platform-wide infrastructure/threat audit
  //   registry — AitherRegistry, the service control plane (/api/registry/ui/)
  //   storage  — fleet disk inventory across nodes (view-scope: platform-only;
  //              apps-manifest minRole admin). A customer's OWN indexed disks
  //              stay reachable at /workspace/storage (files:read, Genesis
  //              scopes /api/storage/files|shares to caller-owned nodes).
  //   invites  — /admin/invites: registration lockdown, provisioning queue,
  //              invites with role admin/operator (Identity 403s non-admins)
  sentry: {
    class: 'rbac',
    rbac: { resource: 'system', action: 'admin' },
  },
  // Aither Control: the owner's device/lending/model console. The tile shows only to
  // platform operators; /api/control refuses everyone but the platform owner.
  control: {
    class: 'rbac',
    rbac: { resource: 'system', action: 'admin' },
  },
  registry: {
    class: 'rbac',
    rbac: { resource: 'system', action: 'admin' },
  },
  storage: {
    class: 'rbac',
    rbac: { resource: 'system', action: 'admin' },
  },
  invites: {
    class: 'rbac',
    rbac: { resource: 'system', action: 'admin' },
  },
  // Dark Matters (2026-09-30): the owner's game, framed from the fleet behind its
  // Identity gate. apps-manifest declares minRole admin (owner-only until the PG lane,
  // .AITHEROS/37-DARK-MATTERS-PRIVATE-PLAY.md); the OS window carries the operator
  // consoles' class so a member is never offered the tile.
  darkmatters: {
    class: 'rbac',
    rbac: { resource: 'system', action: 'admin' },
  },
  // Media Forge (2026-10-01): the owner's private studio. apps-manifest declares
  // minRole admin and mediaforge.aitherium.com admits only the owner at its edge.
  mediaforge: {
    class: 'rbac',
    rbac: { resource: 'system', action: 'admin' },
  },
}
