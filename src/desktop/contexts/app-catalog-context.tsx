/**
 * App Catalog Context — what a HOST app is allowed to put in its launcher.
 *
 * `data/apps-manifest.ts` is the PLATFORM-WIDE catalogue, shared by every host
 * that embeds DesktopShell. AitherVeil ships all of it. A tenant app ships a
 * small entitled subset — and until this context existed the
 * shell had no way to be told so: the Start Menu, Spotlight and the desktop
 * canvas each import ALL_APPS directly, so a tenant's launcher listed the entire
 * internal platform (Trading, Kalshi, Chaos, Kernel Forge, Model Lab).
 *
 * Two independent axes, because they fail in different ways:
 *
 *   allowedAppIds — WHICH apps this deployment actually ships. The server has
 *     always known this: the brain pack's `enabled_panels`, entitlement-gated by
 *     ACTA (`gate_embed_panels`) and served on `/api/config/embed`. This is the
 *     renderer HONOURING that answer instead of discarding it. Client-side
 *     filtering is UX, not a security boundary — the backend gates the data —
 *     but showing a customer apps they did not buy is its own defect.
 *
 *   hasRoutes — whether this host serves the manifest's `route` paths. Those are
 *     Next.js pages that exist ONLY in AitherVeil. A standalone SPA tenant app
 *     has none of them, so launching a route-only app there navigates the browser
 *     OFF the SPA; the catch-all then serves the app's own index.html and the user
 *     lands back on the app they started from. That reads as "the app opened and
 *     is broken", which is exactly how it was reported. A host without routes
 *     hides route-only apps rather than offering a launcher entry that cannot work.
 *
 * Both defaults are deliberately permissive (no allowlist, `hasRoutes: true`), so
 * any existing host rendering <DesktopShell> without the new prop is unchanged.
 */

'use client'

import React, { createContext, useContext, useMemo } from 'react'
import { SECURITY_APP_IDS, isVeilAdminApp, isPlatformScoped } from '../lib/view-scope'
import { PANEL_MIN_TIER } from '../lib/panel-tiers.generated'
import { APP_GATING, type GatingClass } from '../data/app-gating'

/**
 * The minimum an app must expose to be filtered. Callers adapt their own shape
 * (`ALL_APPS`, `StartMenuApp`, `DESKTOP_ICON_APPS`) to this — the three launch
 * surfaces each carry a different one.
 */
export interface CatalogEntry {
  id: string
  /** True when the app opens as a desktop WINDOW rather than by navigation. */
  hasWidget: boolean
  /**
   * Minimum LICENSE tier, from `lib/billing/plan_entitlement.py`'s TIER_RANK:
   * free/explorer(0) starter(1) developer(2) pro(3) team(4) business(5)
   * enterprise(6) platform(7). Omitted means no licence requirement.
   *
   * Until 2026-08-17 the catalogue had no licence dimension at ALL — 0 uses of
   * entitlement/license/plan/tier across 263 apps — so a free account was shown
   * every paid surface. `tier_for_owner()` has answered this question the whole
   * time; nothing asked it.
   */
  minTier?: string
  /**
   * RBAC resource+action, checked through `AitherRBAC.check_permission`.
   * Omitted means no permission requirement beyond auth and `minRole`.
   *
   * `minRole` (21 of 263 apps) is a coarse ordinal. This is the real gate: the
   * engine exists and no app was wired to it.
   */
  rbac?: { resource: string; action: string }
  /**
   * ACTA feature flag (PLANS[*].features vocabulary) that gates this app.
   * Part of the app-gating plane (data/app-gating.ts, check_app_gating.py) —
   * UX filter; the server-side gate is route-manifest `license:` /
   * PANEL_FEATURE_MAP.
   */
  acta?: string
  /**
   * App-license id (config/app_licenses.yaml) that gates this app.
   */
  license?: string
  /**
   * Manifest category. Used to DERIVE a permission requirement for apps that
   * declare no explicit `rbac` — see `requiredPermission`.
   */
  category?: string
}

/**
 * The permission an app requires, explicit or derived.
 *
 * Deriving matters: 263 apps declare no `rbac`, and hand-assigning one to each
 * is a product decision nobody has made. But the repo ALREADY classifies which
 * apps are privileged — `SECURITY_APP_IDS` (8), `category: 'admin'` (8), and
 * `isPlatformScoped` — and those classifications are what `getAppsForSurface`
 * has been using all along. This reuses them rather than inventing a second
 * opinion that could disagree with the first.
 *
 * So the privileged apps are gated today, with no manifest churn and no policy
 * invented; everything else stays ungated until someone assigns it deliberately.
 */
/**
 * The licence tier an app requires, explicit or derived.
 *
 * PANEL_MIN_TIER is GENERATED from the two files that already hold the licensing
 * model — entitlement_gating.PANEL_FEATURE_MAP (panel -> ACTA feature) and
 * AitherACTA.PLANS[*].features (plan -> features). Nothing here is invented; it
 * is the same answer `gate_embed_panels` computes server-side, made available to
 * the launcher so it stops advertising surfaces the plan does not include.
 */

/**
 * The DEFAULT desktop surface: a small core, not the whole catalogue.
 *
 * Shaped by the owner directive already in the codebase (view-scope.ts,
 * 2026-07-15): "the regular-user surface is Dashboard + Relay +
 * Apps/Marketplace + workspace management + Settings, nothing else." That
 * directive was enforced on the `workspace` and `nav` surfaces and NEVER on the
 * desktop launcher, which is why the desktop kept showing everything.
 *
 * Measured 2026-08-17 before this existed: a signed-in FREE user could see 190
 * of 263 apps — every `agents` (33), `dev` (31), `creative` (21) and `labs` (8)
 * surface — because only `infra`/`monitor` were platform-scoped and only 30
 * panels carried a licence tier. Auth, licence and permission gates each removed
 * a slice and the remainder was still most of the product.
 *
 * So the default is INVERTED: core is what you get, and anything else must be
 * earned by an explicit entitlement (`allowedAppIds`), a licence tier, or a
 * platform permission. Adding an app to the catalogue no longer adds it to
 * everyone's launcher.
 */
const CORE_APP_IDS: ReadonlySet<string> = new Set([
  // Dashboard / home
  'ws-dashboard', 'dashboard',
  // Relay — chat, mail, comms
  'chat', 'mail', 'ws-relay', 'ws-mail',
  // Apps / Marketplace
  'marketplace', 'ws-apps', 'ws-marketplace',
  // Workspace management + settings
  // 'ws-onboard' was here and was UNREACHABLE. It is also in view-scope's
  // platformAppIds, and requiredPermission() is evaluated BEFORE this CORE
  // fallback — so it demanded platform:read while CORE promised every signed-in
  // user could open it. The promise lost, silently. Its platform classification is
  // the correct half: despite the name it is "Deploy Agent — deploy a custom agent
  // to AitherOS infrastructure", navGroup 'Platform'. Asserted by ASC001 in
  // check_app_surface_coherence.py.
  // (Model Planner retired 2026-09-30 into the OS Brain app's Fit tab.)
  'ws-members', 'ws-settings', 'settings', 'ws-support',
  // Workspace administration: the owner's requirement that a workspace admin can
  // manage their own users, endpoints and infrastructure (2026-08-18).
  //
  // CORE membership is what GRANTS these; the `rbac: workspace:admin` each of them
  // carries is what RESTRICTS them. Both halves are needed, and the rbac half alone
  // is decorative: passing the permission check does not grant, it only avoids
  // denial, so without a CORE entry these fell through to `can('platform','read')`
  // and were visible ONLY to a `*:*:*` holder -- who could already see everything.
  // The workspace admin they were opened for was still denied.
  'ws-groups', 'ws-directory', 'ws-api-keys', 'ws-agents',
  'ws-nodes', 'ws-compute', 'ws-infrastructure', 'ws-domains',
  // OS basics a desktop is unusable without
  'files', 'search', 'notepad', 'browser', 'calculator', 'weather',
  'document', 'platform-docs', 'tasks',
  // 'room' is a HOST-contributed widget id (a tenant's home surface),
  // not a manifest app -- it resolves through extraApps, not the catalogue.
  'room',
])

export function requiredTier(entry: CatalogEntry): string | null {
  return entry.minTier ?? PANEL_MIN_TIER[entry.id] ?? null
}

export function requiredPermission(
  entry: CatalogEntry,
): { resource: string; action: string } | null {
  if (entry.rbac) return entry.rbac
  if (SECURITY_APP_IDS.has(entry.id)) return { resource: 'security', action: 'read' }
  if (isVeilAdminApp(entry.id, entry.category)) return { resource: 'admin', action: 'read' }
  if (isPlatformScoped(entry.id, entry.category)) return { resource: 'platform', action: 'read' }
  return null
}

/**
 * The app's gating class (app-gating plane). Explicit APP_GATING declaration
 * wins; else derived from the manifest fields. `null` = no class beyond the
 * catalogue's own auth/tier/permission checks (anon).
 */
export function requiredClass(entry: CatalogEntry): GatingClass | null {
  const declared = APP_GATING[entry.id]?.class
  if (declared) return declared
  if (entry.acta) return 'acta'
  if (entry.license) return 'license'
  if (entry.rbac) return 'rbac'
  return null
}

/**
 * A launcher entry contributed by the HOST rather than discovered in the
 * platform manifest.
 *
 * Filtering the manifest alone is not enough, and measuring it is what showed
 * why: of one tenant's 22 entitled panels, exactly 4 exist as manifest apps. The
 * manifest describes AitherVeil's own apps; a tenant's surface is its awkit
 * PANELS, which it has always been able to RENDER (they are in the widget import
 * map) and never been able to LIST — the Start Menu and Spotlight read ALL_APPS,
 * so there was nowhere for them to appear. Subtraction alone would have left the
 * launcher with four entries, none of them the product.
 */
export interface HostApp {
  id: string
  name: string
  description?: string
  /** Lucide icon name, same convention as the manifest. */
  icon: string
  /** Manifest AppCategory, so host apps group alongside platform ones. */
  category: string
  /** Widget to open — must exist in the host's widget import map. */
  widgetId: string
}

export interface AppCatalogScope {
  /**
   * Is there a signed-in user?
   *
   * Until 2026-08-16 the catalogue had NO auth awareness at all: `isAllowed`
   * consulted only `allowedAppIds`, and on the platform that is null, so
   * `if (allowed === null) return true` handed the ENTIRE app manifest to
   * anonymous visitors — 263 entries including Workspace Admin, Audit Log,
   * Secrets, Billing and CRM. That is the fail-open gate of
   * `.claude/rules/security-review-patterns.md` #1: the default path returned
   * "allowed" rather than "denied".
   *
   * It is not a rendering bug — an anonymous visitor could not have USED those
   * panels, because every one of them fails its own server-side authz — but the
   * launcher enumerated the whole product surface to anyone who loaded the page,
   * which is a disclosure and reads as a broken, overwhelming desktop.
   *
   * Defaults to FALSE: a host that has not wired this yet gets the anonymous
   * surface, never the full one. Fail closed.
   */
  authenticated?: boolean
  /**
   * The viewer's LICENCE tier (TIER_RANK vocabulary). Supplied by the host from
   * `plan_entitlement.tier_for_owner()`. Omitted defaults to `free` — the
   * lowest tier, so an unwired host under-grants rather than over-grants.
   */
  tier?: string
  /**
   * Permission oracle, normally wrapping `AitherRBAC.check_permission`.
   *
   * Omitted means DENY for any app that declares an `rbac` requirement. That is
   * deliberate: a host that cannot answer "may this user do X" must not be
   * treated as answering "yes". The client check is a UX filter — it stops the
   * launcher advertising what the user cannot use — and never the security
   * boundary, which stays server-side in each panel's own authz.
   */
  can?: (resource: string, action: string) => boolean
  /**
   * ACTA feature oracle (`use-entitlements.hasFeature`). Omitted means DENY
   * for any app whose gating class is acta — a host that cannot answer must
   * not be read as answering "yes". Same contract as `can`.
   */
  hasFeature?: (feature: string) => boolean
  /**
   * License oracle (granted ACTA features for the license id). Omitted means
   * DENY for any app whose gating class is license.
   */
  hasLicense?: (licenseId: string) => boolean
  /**
   * Does the host have a tenant context? Omitted means DENY for any app whose
   * gating class is tenant-scoped.
   */
  hasTenant?: boolean
  /**
   * Explicit allowlist of app ids. `null`/omitted means "every app in the
   * manifest" — the platform host (AitherVeil).
   */
  allowedAppIds?: readonly string[] | null
  /**
   * Does this host serve the manifest's `route` paths? False for a standalone
   * SPA tenant app. Defaults to true so AitherVeil is unaffected.
   */
  hasRoutes?: boolean
  /**
   * Widget to open for "home"/Dashboard on a host with no `/dashboard` route.
   * Without this the Start Menu's Dashboard button navigates to a page that does
   * not exist outside AitherVeil.
   */
  homeWidgetId?: string | null
  /**
   * Launcher entries this host adds to the (filtered) platform manifest. These
   * are already the entitled set — the host builds them from the server's answer
   * — so they are not run through `allowedAppIds` again.
   */
  extraApps?: readonly HostApp[]
}

interface AppCatalogContextValue {
  allowedAppIds: ReadonlySet<string> | null
  hasRoutes: boolean
  homeWidgetId: string | null
  extraApps: readonly HostApp[]
  /** Should this app be offered in a launcher at all? */
  isAllowed: (entry: CatalogEntry) => boolean
  /** Filter any list of apps, preserving its element type. */
  filterApps: <T extends CatalogEntry>(apps: readonly T[]) => T[]
}

const NO_EXTRA_APPS: readonly HostApp[] = []

let _warnedNoProvider = false

/**
 * The value used when NO `AppCatalogProvider` wraps the tree.
 *
 * This used to be `isAllowed: () => true` — a pass-through — and that is a
 * fail-OPEN default on a tenant-isolation boundary, contradicting the rule this
 * very file applies everywhere else: "a host that cannot answer must not be read
 * as answering yes."
 *
 * It matters because forgetting the provider is SILENT. React does not warn when
 * a host renders the desktop without it (and does not warn when a host passes an
 * `appCatalog` prop a shell does not accept, which is how a tenant frontend
 * shipped with every filter bypassed once before). The build is green, the page
 * renders, and a customer's own domain quietly offers the whole platform
 * manifest — Trading, Kalshi, Chaos, Kernel Forge — each of which then opens to
 * "not installed here".
 *
 * Measured 2026-08-20 on the deployed dgg.aitherium.com bundle: platform-only
 * app ids present in the first 6 of 44 chunks.
 *
 * So the no-provider default is now the CORE surface — the same floor
 * `AppCatalogProvider` uses for a host with no allowlist — and it says so once,
 * loudly, because a silently-degraded launcher is indistinguishable from a
 * correctly-small one.
 */
const NO_PROVIDER: AppCatalogContextValue = {
  allowedAppIds: null,
  hasRoutes: true,
  homeWidgetId: null,
  extraApps: NO_EXTRA_APPS,
  // CORE_APP_IDS is declared below; referenced inside a closure, so it is
  // resolved at CALL time, not at module init.
  isAllowed: (entry) => {
    if (!_warnedNoProvider && typeof console !== 'undefined') {
      _warnedNoProvider = true
      console.warn(
        '[app-catalog] No <AppCatalogProvider> in the tree — falling back to the ' +
        'CORE app surface. If this is a tenant host, it is missing its catalogue ' +
        'and would otherwise have offered the entire platform manifest.',
      )
    }
    return CORE_APP_IDS.has(entry.id)
  },
  filterApps: (apps) => apps.filter((a) => CORE_APP_IDS.has(a.id)),
}

const AppCatalogContext = createContext<AppCatalogContextValue>(NO_PROVIDER)

/**
 * What an anonymous visitor may see in the launcher.
 *
 * Deliberately tiny and deliberately a DENYLIST-BY-DEFAULT: anything not named
 * here is hidden until someone signs in. These are the surfaces that make sense
 * with no account — the workspace's own home, the things a prospect reads, and
 * the in-browser model, which needs no server at all.
 *
 * A host may still hide these further via `allowedAppIds`; this set only ever
 * SUBTRACTS from what an anonymous visitor is shown, never adds.
 */
const ANON_ALLOWED_APP_IDS: ReadonlySet<string> = new Set([
  'room', 'chat', 'platform-docs', 'document', 'search', 'marketplace',
  'browser', 'notepad', 'calculator', 'weather',
  // 'blog' is the canonical "thing a prospect reads": 231 posts already served
  // publicly at aitherium.com/blog, from the STATIC payload with no auth and no
  // backend. Registering it in the manifest and the import map was not enough —
  // this set is a THIRD gate, and the live launcher offered five apps without it.
  'blog',
  // (Model Planner retired 2026-09-30: the anon Brain app's Fit tab answers
  // "will this run on my card?" with no account.)
  // gobbonet and darkmatters are the two surfaces of a world that need NOTHING:
  // no account, no backend, no GPU. GobboNet runs its characters on the in-browser
  // model -- which the header above already names as a category that belongs here --
  // and ships the Lattice Realm cast as installable cards; Dark Matters is the
  // playable interface to a game engine that runs on the visitor own machine.
  // Both are requiresAuth:false / availability:local in the manifest and both
  // RENDER; they were stranded at this THIRD gate, which is why the desktop-app
  // wiring census listed them under "apps a stranger could use but is never shown".
  // A world you can read, talk to and play is only a story if the launcher offers
  // all three. Saga itself stays gated (requiresAuth:true, availability:gateway)
  // because it genuinely needs the backend; its public face is the demo at /saga.
  //
  // No apostrophes in this block on purpose: a naive reader of this Set matches on
  // single quotes, so a contraction here parses as an app id.
  // darkmatters was REMOVED from this set on 2026-09-20 and the id is left here
  // in prose only. It re-entered the list while the artifact we serve from
  // public/play is still dirty: shipped files carry adult vocabulary. It stays
  // withdrawn from the signed-out surface until what we ship is provably clean,
  // and adult material must be hard to find without an explicit adult opt-in.
  // Offering it to a signed-out visitor is exactly that leak. Put the id back
  // the moment the adult-content gate reports the artifact CLEAN -- it reports
  // "clean + withheld -> ELIGIBLE", so the route back is not folklore.
  'gobbonet',
  // mediaforge is the third no-account surface: availability:local,
  // requiresAuth:false, and it is the visual half of the same demo -- the
  // pipeline that makes the art a world is shown in. Offered for the same
  // reason as the two above, not as launcher padding.
  //
  // Iris and Canvas are deliberately NOT here despite belonging to that demo:
  // both are availability:gateway, so a signed-out visitor would get a tile
  // that opens onto a login. Note that requiresAuth in the manifest does NOT
  // decide this -- calculator and weather carry requiresAuth:true and are
  // offered here -- which is exactly why this list is hand-curated with a
  // reason per entry rather than derived from a manifest field.
  'mediaforge',
])

/**
 * Licence tier ranks — mirrors TIER_RANK in lib/billing/plan_entitlement.py.
 * An unknown tier ranks -1, so a typo DENIES rather than grants.
 */
const TIER_RANK: Readonly<Record<string, number>> = {
  free: 0, explorer: 0, starter: 1, developer: 2, pro: 3,
  team: 4, business: 5, enterprise: 6, platform: 7,
}
const tierRank = (t?: string) => (t == null ? -1 : TIER_RANK[t] ?? -1)

export function AppCatalogProvider({
  authenticated = false,
  tier = 'free',
  can,
  hasFeature,
  hasLicense,
  hasTenant,
  allowedAppIds,
  hasRoutes = true,
  homeWidgetId = null,
  extraApps = NO_EXTRA_APPS,
  children,
}: AppCatalogScope & { children: React.ReactNode }) {
  const value = useMemo<AppCatalogContextValue>(() => {
    // An EMPTY array is a meaningful answer ("this tenant is entitled to
    // nothing yet") and must not collapse to "unfiltered". Only null/undefined
    // — the platform host that never opted in — disables filtering.
    const allowed = allowedAppIds == null ? null : new Set(allowedAppIds)

    const isAllowed = (entry: CatalogEntry) => {
      if (!entry.hasWidget && !hasRoutes) return false
      // Auth is checked FIRST and independently of the tenant allowlist. It used
      // to be checked nowhere, so `allowed === null` (the platform host) handed
      // the whole 263-entry manifest to anonymous visitors. Ordering matters:
      // doing this after the null-check would restore the fail-open path.
      if (!authenticated && !ANON_ALLOWED_APP_IDS.has(entry.id)) return false

      // LICENCE. An app may require a paid tier; the viewer's tier comes from
      // plan_entitlement.tier_for_owner(). An unknown tier on either side ranks
      // -1, so a typo denies. Checked before RBAC because licence is the
      // coarser question and the cheaper one.
      const need = requiredTier(entry)
      if (need != null && tierRank(tier) < tierRank(need)) return false

      // PERMISSION. `can` missing is a DENY for anything that declares an rbac
      // requirement -- a host that cannot answer must not be read as answering
      // yes. This is a UX filter; the security boundary stays server-side.
      const perm = requiredPermission(entry)
      if (perm && !(can?.(perm.resource, perm.action) ?? false)) return false

      // GATING CLASS (app-gating plane, Stage 1 of the family collapse).
      // acta/license/tenant-scoped are NOT covered by the tier/permission
      // checks above; omitted oracles deny — same contract as `can`. This sits
      // BEFORE the allowlist/CORE so an entitled set can never promise an app
      // the class gate denies (the ws-onboard lesson).
      const cls = requiredClass(entry)
      if (cls === 'acta') {
        if (!(hasFeature?.(entry.acta ?? '') ?? false)) return false
      } else if (cls === 'license') {
        if (!(hasLicense?.(entry.license ?? '') ?? false)) return false
      } else if (cls === 'tenant-scoped') {
        if (!hasTenant) return false
      }

      // A host that supplied an explicit entitled set has already answered this.
      if (allowed !== null) return allowed.has(entry.id)

      // No allowlist = the platform host. The default is the CORE surface, not
      // the whole catalogue. Anything beyond core needs a platform permission —
      // which is how an operator still sees everything, and a regular user does
      // not. `can` missing denies, same as everywhere else here.
      if (CORE_APP_IDS.has(entry.id)) return true
      return can?.('platform', 'read') ?? false
    }

    return {
      allowedAppIds: allowed,
      hasRoutes,
      homeWidgetId,
      // extraApps deliberately BYPASS `allowedAppIds` — the host already built
      // them from the server's entitlement answer, so re-filtering them would be
      // wrong. But "entitled by the pack" is not "visible to a stranger", and
      // nothing was applying the second question: a signed-out visitor to a
      // tenant portal saw the workspace's whole panel set (Mail, Contacts,
      // Audit Log, Workspace Admin, Directory...) because this list skipped
      // every filter there was. The panels themselves fail their own server-side
      // authz, so this was disclosure and noise rather than access — but it is
      // exactly what makes the desktop look broken and overwhelming to someone
      // who has not signed in.
      extraApps: authenticated
        ? extraApps
        : extraApps.filter(a => ANON_ALLOWED_APP_IDS.has(a.id)),
      isAllowed,
      filterApps: (apps) => apps.filter(isAllowed),
    }
    // A new Set per render would re-filter every consumer on every render; the
    // joined key keeps the identity stable while still tracking real changes
    // (the host rebuilds this array whenever /api/config/embed resolves).
  }, [
    // Without `authenticated` here the memo would keep the anonymous isAllowed
    // closure after sign-in, so a user who logs in stays locked to the anon
    // surface until a full reload — a silent, confusing half-signed-in desktop.
    authenticated,
    // Same reason as `authenticated`: without these the memo keeps a stale
    // closure, so an upgrade or a role change would not re-open the launcher
    // until a full reload.
    tier,
    can,
    hasFeature,
    hasLicense,
    hasTenant,
    allowedAppIds ? allowedAppIds.join(',') : null,
    hasRoutes,
    homeWidgetId,
    extraApps.map(a => a.id).join(','),
  ])

  return <AppCatalogContext.Provider value={value}>{children}</AppCatalogContext.Provider>
}

export function useAppCatalog(): AppCatalogContextValue {
  return useContext(AppCatalogContext)
}
