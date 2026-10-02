/**
 * AitherOS View Scope System
 * ===========================
 * Defines the scope model for tenant-aware, platform-filtered views.
 *
 * Three scope tiers:
 *   1. **platform** — System internals (infra, monitoring, service topology, etc.)
 *      Only visible to admin / operator / system roles. Never shown to end-users.
 *   2. **tenant**   — Tenant-scoped resources. Users see only their tenant's data.
 *      Widgets, apps, files, agents, sessions. When accessing via Elysium, this
 *      scope is the default and syncs back to the user's local awnode.
 *   3. **user**     — User-personal scope (preferences, chat history, secrets).
 *
 * Elysium mode:
 *   When `accessMode === 'elysium'`, the user is accessing AitherOS remotely
 *   (desktop-anywhere). Their view is fully tenant-scoped, platform internals
 *   are hidden, and changes sync to their local awnode instance.
 *
 * @author AitherOS Team
 */

import { REGISTRY_PLATFORM_WIDGETS, REGISTRY_PLATFORM_SCREENS } from './generated/surface-registry'

// ─── Scope Tiers ─────────────────────────────────────────────────────────────

/**
 * Which visibility tier an app, widget, or data resource belongs to.
 *
 *  - `platform`  — AitherOS internals. Containers, service topology, GPU pools,
 *                   raw Pulse metrics, Chronicle, Strata ingestion, security
 *                   defense, RBAC admin, etc.
 *  - `tenant`    — Multi-tenant workspace data. Files, agents, sessions, chat,
 *                   creative outputs, team settings.
 *  - `user`      — Per-user personal data. Preferences, SSH keys, API tokens,
 *                   personal chat history.
 *  - `public`    — Unauthenticated / marketing pages (blog, docs, landing).
 */
export type ViewScopeTier = 'platform' | 'tenant' | 'user' | 'public'

/**
 * How the user is currently accessing AitherVeil.
 *
 *  - `local`     — Running on the same machine as the AitherOS stack.
 *  - `elysium`   — Remote desktop-anywhere via Elysium cloud relay.
 *  - `gateway`   — Connected through gateway.aitherium.com (SaaS).
 */
export type AccessMode = 'local' | 'elysium' | 'gateway'

// ─── Scope Context (runtime state) ──────────────────────────────────────────

export interface ViewScopeState {
    /** Current user's tenant ID (from auth profile) */
    tenantId: string | null
    /** Current user's tenant slug (human-readable) */
    tenantSlug: string | null
    /** How the user is accessing the platform */
    accessMode: AccessMode
    /** Whether the current user can see platform-scope resources */
    canViewPlatform: boolean
    /** Whether the current user is an admin (sees everything) */
    isAdmin: boolean
    /** The resolved scope tier for the current session */
    effectiveTier: ViewScopeTier
    /** The local awnode URL to sync tenant data to (Elysium mode) */
    localNodeUrl: string | null
}

// ─── App / Widget Scope Tagging ─────────────────────────────────────────────

/**
 * Extended scope metadata that can be attached to any app, widget, or
 * navigation item. Added as an optional field on AitherApp.
 */
export interface ScopeTag {
    /**
     * Which tier(s) this resource belongs to. If a resource is tagged
     * `['platform']` it will be hidden from non-admin users entirely.
     * If tagged `['tenant', 'platform']` it's visible to tenants but
     * shows extra platform detail to admins.
     */
    tiers: ViewScopeTier[]
    /**
     * If true, the resource shows tenant-filtered data when accessed
     * by a tenant user (e.g. Strata shows only their files).
     */
    tenantIsolated?: boolean
    /**
     * If true, the resource can sync its state to a local awnode
     * when accessed via Elysium.
     */
    elysiumSyncable?: boolean
    /**
     * Optional description for why this is platform-only (shown in admin UIs).
     */
    platformReason?: string
}

// ─── Scope Classification Map ───────────────────────────────────────────────

/**
 * Master classification of which app categories and specific app IDs
 * belong to which scope tier. This is the single source of truth for
 * scope filtering decisions.
 */
export const SCOPE_CLASSIFICATION = {
    /**
     * Categories that are entirely platform-scope.
     * Every app in these categories is hidden from non-admin users.
     */
    platformCategories: ['infra', 'monitor'] as const,

    /**
     * Specific app IDs that are platform-scope regardless of category.
     * These are system internals that regular users never need to see.
     */
    platformAppIds: new Set([
        // Admin tools (some admin items are tenant-visible, these are not)
        'admin',
        'admin-users',
        'admin-tenants',
        'admin-roles',
        'sessions',
        // awstorage's Living Desktop window (apps-manifest 'storage'): fleet disk
        // usage, ranked trees, diffs, reclaim proposals. Explicit here because its
        // category ('admin') is not itself in platformCategories, and a tenant
        // must never see another tenant's — or the host's own — disk inventory.
        'storage',
        // ── Team Harness surface hygiene (Phase A) ──
        // Operator/infra workspace apps that belong in the Veil platform surface,
        // NOT the team Workspace nav. Marking them platform-scope removes them from
        // getAppsForSurface('workspace') (line ~609) while isVeilAdminApp keeps them
        // in the operator (Veil/admin) nav. Owner decision: Platform Admin / fleet /
        // deploy / shell / infra → Veil.
        'ws-deploy',
        'ws-fleet',
        'ws-tunnel',
        'ws-dev-containers',
        'ws-connect',
        
        
        
        
        'ws-sdk',
        'ws-onboard',
        'ws-releases',
        'ws-shell',
        'ws-platform-admin',
        // Infrastructure & monitoring dashboard widgets
        'dw-system-pulse',
        'dw-gpu-compute',
        'dw-neural-network',
        'dw-topology',
        'dw-internals',
        'dw-infrastructure',
        'dw-security',
        'dw-config',
        // Infrastructure pages
        'service-registry',
        'docker-manager',
        'gpu-dashboard',
        'system-health',
        'log-viewer',
        'network-topology',
        'vram-manager',
        'compose-manager',
        'port-manager',
        'container-shell',
        'environment-vars',
        'resource-monitor',
        'volume-manager',
        'image-manager',
        'cluster-manager',
        'service-mesh',
        'load-balancer',
        'secrets-vault',
        // Monitoring pages
        'monitor-hub',
        'pulse-metrics',
        'chronicle-logs',
        'flux-events',
        'service-health',
        'performance',
        'error-tracker',
        'audit-log',
        'cost-tracker',
        'uptime',
        'alert-manager',
        'trace-viewer',
        'metric-explorer',
        'sla-dashboard',
        'capacity-planner',
        'incident-manager',
        'chaos-engineering',
        'deployment-tracker',
        'canary-releases',
        'feature-flags',
        'benchmark-runner',
    ]),

    /**
     * App IDs that are tenant-scoped AND support tenant data isolation.
     * These show filtered data per tenant.
     */
    tenantIsolatedAppIds: new Set([
        'files',           // Strata file browser — tenant sees only their files
        'chat',            // Chat — tenant sees only their conversations
        'writer',          // Writer — tenant sees only their documents
        'ws-agents',       // Agent Fleet (manifest ws-agents) — tenant sees their agent instances
        'desktop',         // Desktop — tenant gets their own desktop state
        'demi',            // Code IDE — tenant project isolation
        'settings',        // Settings — tenant preferences
        'sessions',        // Session history — tenant-scoped
        'blog',            // Blog — tenant content
        'creative-studio', // Creative — tenant outputs
        'atlas',           // Search — tenant-scoped results
    ]),

    /**
     * App IDs that support Elysium sync (desktop-anywhere).
     * Changes sync back to the user's local awnode.
     */
    elysiumSyncableAppIds: new Set([
        'files',      // File sync via Strata VFS → local awnode
        'desktop',    // Desktop state sync
        'settings',   // Preference sync
        'chat',       // Chat history sync
        'writer',     // Document sync
        'demi',       // Project workspace sync
        'ws-agents',    // Agent config sync (manifest ws-agents, "Agent Fleet")
    ]),

    /**
     * Dashboard widget groups that are platform-only.
     * Entire groups hidden from tenant users.
     */
    platformWidgetGroups: new Set([
        'monitor',  // System monitoring widgets
        'build',    // Build/deploy widgets (some overlap, admin-only)
    ]),

    /**
     * Dashboard widget IDs that are platform-only within mixed groups.
     */
    platformWidgetIds: new Set([
        'system-pulse',
        'gpu-compute',
        'neural-network',
        'topology',
        'internals',
        'aitherscope',
        'infrastructure',
        'security',
        'config',
    ]),
} as const

// ─── Workspace Nav Filter ───────────────────────────────────────────────────

/**
 * App IDs that belong in the /workspace sidebar — tenant-scoped,
 * user-facing workspace apps. NOT platform admin, NOT infra/monitoring.
 * When the user is on /workspace/*, GlobalNav shows ONLY these.
 */
export const WORKSPACE_APP_IDS = new Set([
    // Workspace home
    'ws-dashboard',
    // Communication (ws-chat/ws-room retired — Relay's DM shell + #company channel)
    'ws-relay', 'ws-mail',
    // Agents
    'ws-agents', 'ws-operations',
    // Data
    'ws-data-sources', 'ws-files', 'ws-knowledge', 'ws-wiki',
    // Intelligence
    'ws-research', 'ws-tools', 'ws-training', 'ws-notebooks',
    // Workspace management
    'ws-members', 'ws-groups', 'ws-directory', 'ws-calendar', 'ws-routines',
    // Platform (tenant-facing)
    'ws-deploy', 'ws-fleet', 'ws-tunnel', 'ws-connect',
    'ws-sdk', 'ws-onboard', 'ws-releases', 'ws-shell', 'ws-dev-containers',
    // Creative
    'ws-iris', 'ws-saga', 'ws-audiobook', 'ws-studio',
    // Intelligence (extras)
    'ws-models', 'ws-workflows',
    // Home (extras)
    'ws-apps', 'ws-marketplace', 'ws-business',
    // Business (non-ws- ids that also belong in the workspace Business group)
    'crm',
    // Agents (extras)
    'ws-skills', 'ws-forum', 'ws-presentations',
    // Account
    'ws-billing', 'ws-support', 'ws-profile', 'ws-settings',
    'ws-api-keys', 'ws-campaigns', 'ws-platform-admin',
])

/**
 * Determine if an app should appear in the workspace sidebar.
 *
 * Workspace membership is DERIVED from the manifest, not a hand-maintained list:
 * every app whose id is `ws-*` is a workspace app by definition. WORKSPACE_APP_IDS
 * remains a supplement for any non-`ws-` ids that also belong in the workspace.
 * This makes the allowlist drift-proof — adding a `ws-*` app to the manifest
 * surfaces it automatically (previously ws-room/ws-aitherbrain/ws-packs/ws-polls
 * were defined but invisible because they were never hand-added to the set).
 */
export function isWorkspaceApp(appId: string): boolean {
    return appId.startsWith('ws-') || WORKSPACE_APP_IDS.has(appId)
}

// ─── New-User / First-Run Stripped Tier ─────────────────────────────────────

/**
 * The ONLY workspace surfaces a brand-new (non-technical) user sees on first run.
 * A deliberately tiny, verified-complete set so the portal is clean and
 * unintimidating. Everything else is hidden until the user "graduates" to the
 * full workspace. Keep this list in lockstep with the manifest ids.
 *
 *   ws-dashboard → Dashboard (command center)
 *   ws-relay     → Relay (chat home — DMs with agents/teammates, channels)
 *   ws-settings  → Settings (persona, security, API keys, integrations)
 */
// Owner directive: a new/no-permission user gets ONLY what they need to run their
// workspace + the essentials — Workspace(dashboard) + chat + Settings here, plus their
// personal MySpace (the portal-nav 'spaces' app) surfaced via the nav filter.
// ws-chat was retired into Relay's DM shell, so Relay IS the chat entry now.
export const NEW_USER_WORKSPACE_APPS = new Set([
    'ws-dashboard',   // Workspace command center / manage
    'ws-relay',       // Chat home — agent DMs + team channels
    'ws-settings',    // profile, security, API keys, integrations
    // OWNER DIRECTIVE 2026-07-15: the regular-user surface is Dashboard + Relay +
    // Apps/Marketplace + workspace management + Settings. Keep in lockstep with
    // CUSTOMER_ALLOWED_WORKSPACE_APPS (feature-flags.ts), the unconditional floor.
    'ws-apps',        // Tenant's installed/available apps
    'ws-marketplace', // Marketplace (browse/install packs & apps)
    'ws-members',     // Workspace members/team management
    'ws-onboard',     // Workspace creation & setup (wizard entry)
])

// Portal-nav (non-workspace) app ids a new user may also see: their personal space +
// a self-serve upgrade path. Consumed by the portal nav filter (see portal/layout.tsx).
export const NEW_USER_PORTAL_APPS = new Set([
    'spaces',         // MySpace — personal, browsable, shareable
    'billing',        // self-serve upgrade to unlock more
])

/**
 * Decide whether the caller should see the stripped first-run workspace.
 *
 * Fully gated behind a master flag (default OFF → zero behaviour change until a
 * deployment opts in). When ON, every non-elevated, non-graduated user gets the
 * clean 5-surface experience. The signal is forward-compatible: once the backend
 * assigns a real `new_user` role (or the user graduates), this resolves without
 * any further UI change.
 *
 * @param enabled    master feature flag (NEXT_PUBLIC_NEW_USER_TIER === '1')
 * @param roles      the user's role list
 * @param isAdmin    admins/operators always see the full workspace
 * @param graduated  user explicitly chose "Explore everything" (persisted opt-out)
 */
export function resolveNewUserMode(opts: {
    enabled: boolean
    roles: string[]
    isAdmin: boolean
    graduated: boolean
}): boolean {
    if (!opts.enabled) return false          // master flag off → never strip (no regression)
    if (opts.isAdmin) return false           // operators always see everything
    if (opts.graduated) return false         // user opted into the full workspace
    const roles = opts.roles || []
    // Explicit backend signal wins (forward-compatible with a future tier role).
    if (roles.includes('new_user')) return true
    // Anyone who has earned an elevated role is past the first-run experience.
    if (roles.some(r => ['power_user', 'developer', 'operator', 'admin'].includes(r))) return false
    // Default while the flag is on: give the clean first-run portal.
    return true
}

// ─── Veil Platform Admin Nav Filter ─────────────────────────────────────────

/**
 * App IDs from non-platform categories that belong in the Veil admin nav.
 * These are core-infrastructure and agent-admin tools that operators need,
 * NOT user-facing workspace apps (those belong in Portal).
 */
export const VEIL_ADMIN_APP_IDS = new Set([
    // Core platform essentials
    'dashboard', 'watch', 'apps', 'platform-docs', 'action-inbox', 'notifications', 'routine-builder',
    // Agent admin tools (fleet management, orchestration, not user-facing agents)
    'mission-control', 'agents-fleet', 'agents-hub', 'demi', 'constellation',
    'forge', 'forge-traces', 'chaos', 'reasoning', 'agent-bus', 'council',
    'expeditions', 'steward', 'agent-lifecycle',
])

/**
 * Security-related app IDs pulled from various categories into the Security tab.
 */
export const SECURITY_APP_IDS = new Set([
    'chaos', 'certificates', 'secrets', 'security-audit',
    'sessions', 'admin-roles', 'fortress', 'audit',
])

// ─── Scope Resolution Helpers ───────────────────────────────────────────────

/**
 * Determine if an app ID is platform-scope only.
 */
export function isPlatformScoped(appId: string, category?: string): boolean {
    // An EXPLICIT listing always wins: that is a deliberate decision about one app.
    if (SCOPE_CLASSIFICATION.platformAppIds.has(appId)) return true
    // A `ws-` app is workspace-scoped BY CONSTRUCTION, so it is not platform-scoped
    // merely because of its category. Category names the SUBJECT ('infra'), not the
    // SCOPE — and conflating the two made ws-compute, ws-domains, ws-infrastructure
    // and ws-nodes unreachable for the workspace admins they were built for, since
    // requiredPermission then demanded platform:read and the start menu filtered
    // them out as well. Owner decision 2026-08-18: workspace admins DO administer
    // their own nodes, compute, infrastructure and domains. Those four now carry an
    // explicit `rbac` of workspace:admin instead, which an admin's `*:*:*`
    // satisfies and a plain member does not.
    if (appId.startsWith('ws-')) return false
    if (category && (SCOPE_CLASSIFICATION.platformCategories as readonly string[]).includes(category)) return true
    // Registry-driven (services.yaml `surface:` blocks): a widget/screen owned by
    // a platform-tier service is authoritatively platform-scoped. This is the path
    // that replaces the hardcoded lists above as manifests are added — single source.
    if (REGISTRY_PLATFORM_WIDGETS.has(appId)) return true
    if (REGISTRY_PLATFORM_SCREENS.has(appId)) return true
    return false
}

/**
 * Determine if an app should appear in Veil's platform admin nav.
 * Veil = operator dashboard. Only platform-relevant apps show.
 * User workspace apps (creative, social, personal) belong in Portal.
 */
export function isVeilAdminApp(appId: string, category?: string): boolean {
    // Platform-only categories (infra, monitor) always shown
    if (category && (SCOPE_CLASSIFICATION.platformCategories as readonly string[]).includes(category)) return true
    // Specific platform app IDs from SCOPE_CLASSIFICATION
    if (SCOPE_CLASSIFICATION.platformAppIds.has(appId)) return true
    // Admin, dev, labs categories always shown
    if (category && ['admin', 'dev', 'labs'].includes(category)) return true
    // Platform-essential apps from core/agents categories
    if (VEIL_ADMIN_APP_IDS.has(appId)) return true
    return false
}

/**
 * Determine if an app supports tenant data isolation.
 */
export function isTenantIsolated(appId: string): boolean {
    return SCOPE_CLASSIFICATION.tenantIsolatedAppIds.has(appId)
}

/**
 * Determine if an app supports Elysium sync.
 */
export function isElysiumSyncable(appId: string): boolean {
    return SCOPE_CLASSIFICATION.elysiumSyncableAppIds.has(appId)
}

/**
 * Determine if a dashboard widget is platform-scope only.
 */
export function isPlatformWidget(widgetId: string, group?: string): boolean {
    if (SCOPE_CLASSIFICATION.platformWidgetIds.has(widgetId)) return true
    if (group && SCOPE_CLASSIFICATION.platformWidgetGroups.has(group)) return true
    // Registry-driven platform widgets (from services.yaml surface:)
    if (REGISTRY_PLATFORM_WIDGETS.has(widgetId)) return true
    return false
}

/**
 * Determine if a dashboard widget should be visible on a given surface.
 * Used to filter the canvas widget picker by customer (portal) vs platform (veil) surface.
 *
 * @param widgetId - The widget type/id (e.g. "gpu-dashboard", "chat")
 * @param surface - The current platform surface ('portal' = customer, 'veil' = platform, 'gateway' = SaaS tenant)
 * @returns true if the widget should appear in the picker on this surface, false to hide it
 */
export function isWidgetVisibleOnSurface(widgetId: string, surface: PlatformSurface): boolean {
    // If on portal (customer surface), hide platform-only widgets
    if (surface === 'portal') {
        return !isPlatformWidget(widgetId)
    }
    // On veil (platform surface) or gateway, show all widgets
    return true
}

/**
 * Build the ScopeTag for a given app.
 */
export function buildScopeTag(appId: string, category?: string): ScopeTag {
    const tiers: ViewScopeTier[] = []

    if (isPlatformScoped(appId, category)) {
        tiers.push('platform')
    } else {
        tiers.push('tenant')
    }

    // Some apps are both (tenant sees filtered, admin sees all)
    if (isTenantIsolated(appId) && !tiers.includes('tenant')) {
        tiers.push('tenant')
    }

    return {
        tiers,
        tenantIsolated: isTenantIsolated(appId),
        elysiumSyncable: isElysiumSyncable(appId),
    }
}

/**
 * Build a ScopeTag for a dashboard widget (canvas widget).
 * Determines visibility tier based on widget ID and category.
 *
 * Used to filter the WIDGET_CATALOG so platform-only widgets
 * don't appear on tenant surfaces.
 */
export function buildWidgetScopeTag(widgetId: string, category?: string): ScopeTag {
    const tiers: ViewScopeTier[] = []

    if (isPlatformWidget(widgetId, category)) {
        tiers.push('platform')
    } else {
        tiers.push('tenant', 'user')
    }

    return {
        tiers,
        tenantIsolated: false, // widgets don't have tenant isolation like apps
        elysiumSyncable: false, // widgets don't sync like apps
    }
}

/**
 * Determine the effective access mode from environment and user context.
 */
export function resolveAccessMode(): AccessMode {
    if (typeof window === 'undefined') return 'local'

    // Self-hosted deployments are always local
    if (process.env.NEXT_PUBLIC_SELF_HOSTED === 'true') return 'local'

    const hostname = window.location.hostname

    // Elysium domains
    if (hostname.includes('elysium.') || hostname.includes('.elysium')) {
        return 'elysium'
    }

    // Gateway / SaaS domains
    if (
        hostname.includes('gateway.aitherium') ||
        hostname.includes('app.aitherium') ||
        hostname.includes('aitherium.com')
    ) {
        // Tenant workspace subdomains (slug.aitherium.com) = gateway mode (SaaS, tenant-scoped)
        const parts = hostname.split('.')
        if (parts.length >= 3 && !['www','app','gateway','portal','demo','blog','chat','saga','irc','tunnel','playground','launch','edge','forge','smtp','create','grafana','prometheus','mcp','idp','wildroot'].includes(parts[0])) {
            return 'gateway' // Tenant workspace subdomain — SaaS, pre-scoped to this tenant
        }
        return 'gateway'
    }

    return 'local'
}

/**
 * Extract tenant workspace slug from the current hostname.
 * Returns null if on a reserved subdomain or portal.aitherium.com directly.
 * e.g. "acme-labs.aitherium.com" → "acme-labs"
 */
export function resolveWorkspaceSlug(): string | null {
    if (typeof window === 'undefined') return null
    const hostname = window.location.hostname
    if (!hostname.endsWith('.aitherium.com')) return null
    const parts = hostname.split('.')
    if (parts.length < 3) return null
    const slug = parts[0]
    const reserved = ['www','app','gateway','portal','demo','blog','chat','saga','irc','tunnel','playground','launch','edge','forge','smtp','create','grafana','prometheus','mcp','idp','wildroot']
    if (reserved.includes(slug)) return null
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) return null
    return slug
}

/**
 * The customer/platform surface split.
 *  - 'portal' → portal.aitherium.com : CUSTOMER surface (run the business:
 *    CRM, billing, mail, calendar, agents-as-products). The owner dogfoods this.
 *  - 'veil'   → veil.aitherium.com   : PLATFORM-ADMIN surface (operate the
 *    platform: tenants, users, entitlements, deployments, services, fleet, GPU).
 *  - 'gateway'→ tenant workspace subdomains / SaaS — customer surface, tenant-scoped.
 */
export type PlatformSurface = 'portal' | 'veil' | 'gateway'

/**
 * Resolve the current customer-vs-platform surface.
 *
 * 2026-08-31 surface collapse: portal.aitherium.com and veil.aitherium.com
 * 301 to the apex — the hostname branches that used to split the SAME Veil
 * build into a 'portal' and a 'veil' surface are gone. The portal/veil
 * surfaces are now desktop APPS on one surface; per-app gating happens in
 * the catalog (getAppsForSurface + requiredPermission + scope badges), not
 * by hostname.
 *
 * A testability/override seam is intentional and kept: local/CI validation
 * still exercises the old surface splits, so `?surface=portal|veil` or
 * localStorage['aither_surface_override'] force the surface for tests. The
 * override is only honoured when explicitly present — production is always
 * 'gateway'.
 */
export function resolvePlatformSurface(): PlatformSurface {
    if (typeof window === 'undefined') return 'gateway'

    // Testability override (query param wins, then localStorage). Dev/CI only in
    // practice — production hostnames never carry ?surface and ops don't set the key.
    try {
        const q = new URLSearchParams(window.location.search).get('surface')
        if (q === 'portal' || q === 'veil' || q === 'gateway') return q
        const ls = window.localStorage.getItem('aither_surface_override')
        if (ls === 'portal' || ls === 'veil' || ls === 'gateway') return ls
    } catch { /* storage/URL unavailable — fall through to hostname */ }

    // Everything is one surface now. Callers layer roles on top via
    // resolveEffectiveTier/canViewPlatformScope; tenants via isTenantBranded.
    return 'gateway'
}

/**
 * Determine if the current user has platform visibility.
 */
export function canViewPlatformScope(roles: string[]): boolean {
    return roles.some(r =>
        r === 'admin' ||
        r === 'super_admin' ||
        r === 'system' ||
        r === 'operator'
    )
}

/**
 * Determine the effective scope tier for the session.
 */
export function resolveEffectiveTier(
    isAuthenticated: boolean,
    roles: string[],
    accessMode: AccessMode,
): ViewScopeTier {
    if (!isAuthenticated) return 'public'

    // Elysium users are always tenant-scoped (even admins see tenant view by default)
    if (accessMode === 'elysium') return 'tenant'

    // Gateway users are tenant-scoped
    if (accessMode === 'gateway') return 'tenant'

    // Local users with admin/operator see platform
    if (canViewPlatformScope(roles)) return 'platform'

    return 'tenant'
}

// ─── Surface Selector (canonical app filtering) ──────────────────────────────

/**
 * Which UI surfaces this app should appear on.
 * Controls visibility across workspace sidebar, desktop widget registry, global nav, admin panel, public pages.
 */
export type AppSurface = 'workspace' | 'desktop' | 'nav' | 'public' | 'admin'

/**
 * Derive default surfaces for an app if not explicitly tagged.
 * Ensures backward compatibility: untagged apps infer their surfaces from manifest metadata.
 *
 * @param app The AitherApp to infer surfaces for
 * @returns Array of AppSurface values
 */
function inferSurfaces(app: any): AppSurface[] {
    const surfaces: AppSurface[] = []

    // Workspace surface: apps in workspace set
    if (isWorkspaceApp(app.id)) surfaces.push('workspace')

    // Nav surface: apps with showInNav or workspace-essential core apps
    if (app.showInNav) surfaces.push('nav')

    // Desktop surface: apps with desktopWidget
    if (app.desktopWidget) surfaces.push('desktop')

    // Admin surface: platform-only categories or app IDs
    if (isPlatformScoped(app.id, app.category)) surfaces.push('admin')

    // Default fallback: if nothing matched and not platform, include 'nav'
    if (surfaces.length === 0 && !isPlatformScoped(app.id, app.category)) {
        surfaces.push('nav')
    }

    return surfaces
}

/**
 * Single canonical selector: getAppsForSurface(surface, scopeState) → AitherApp[]
 *
 * Every surface (workspace nav, desktop, global nav, start menu, admin panel)
 * calls this instead of maintaining its own filter logic.
 *
 * @param surface - Which UI surface is requesting apps
 * @param apps - Pool of apps to filter (typically ALL_APPS)
 * @param scopeState - Current user's scope state (auth, roles, access mode, etc.)
 * @param platformOverrides - Optional platform registry overrides (features.yaml)
 * @returns Filtered list of apps visible on this surface
 */
export function getAppsForSurface(
    surface: AppSurface,
    apps: any[],
    scopeState: {
        canViewPlatform: boolean
        isAuthenticated: boolean
        isAdmin: boolean
        isEmailVerified: boolean
        accessMode: AccessMode
        userRoles: string[]
        minRole?: (minRole?: string) => boolean
        isLocalhost?: boolean
        isNewUser?: boolean
        // Customer/platform surface split. When set, the 'nav' surface enforces
        // it: 'portal' shows business apps (hides platform/admin apps EVEN for
        // admins — the dogfood surface); 'veil' shows platform-admin apps.
        // Undefined → legacy role-based behavior (no change for existing callers).
        platformSurface?: PlatformSurface
    },
    platformOverrides?: Record<string, boolean>,
): any[] {
    return apps.filter(app => {
        // Get surfaces this app belongs to (explicit or inferred)
        const appSurfaces = app.surfaces ?? inferSurfaces(app)

        // Must be tagged for this surface
        if (!appSurfaces.includes(surface)) return false

        // Platform registry override: explicit disable
        if (platformOverrides && app.id in platformOverrides && !platformOverrides[app.id]) {
            return false
        }

        // New-user / first-run tier: hard-whitelist the stripped surface set on the
        // workspace + nav (portal sidebar) surfaces. Applied before everything else
        // so a first-run user can never reach an off-list app via any code path.
        if (scopeState.isNewUser && (surface === 'workspace' || surface === 'nav')) {
            if (!NEW_USER_WORKSPACE_APPS.has(app.id)) return false
        }

        // ─ Surface-specific rules ─

        if (surface === 'workspace') {
            // Workspace nav is tenant-scoped; show only to authenticated users or gateway/elysium mode
            if (!scopeState.isAuthenticated && scopeState.accessMode === 'local') return false
            // Hide platform-only apps from workspace nav (those belong in admin)
            if (isPlatformScoped(app.id, app.category)) return false
            // Hide planned apps
            if (app.status === 'planned') return false
            // Require auth
            if (app.requiresAuth && !scopeState.isAuthenticated) return false
            // Min role
            if (!scopeState.minRole?.(app.minRole)) return false
            // Email verified (except admin)
            if (!scopeState.isEmailVerified && !scopeState.isAdmin && app.category !== 'core') return false
            return true
        }

        if (surface === 'nav') {
            const ps = scopeState.platformSurface
            if (ps === 'portal') {
                // CUSTOMER surface (portal.aitherium.com): the owner dogfoods the
                // business here. Show workspace/business apps; hide EVERY platform
                // /admin app even for admins (that's what veil.aitherium.com is for).
                if (isPlatformScoped(app.id, app.category)) return false
                if (isVeilAdminApp(app.id, app.category) && !isWorkspaceApp(app.id)) return false
            } else if (ps === 'veil') {
                // PLATFORM surface (veil.aitherium.com): operate the platform.
                if (!scopeState.canViewPlatform) return false
                // Hide pure customer workspace apps unless they're also veil-admin.
                if (isWorkspaceApp(app.id) && !isVeilAdminApp(app.id, app.category)) return false
            } else {
                // Legacy / no explicit surface (localhost, gateway) — unchanged.
                if (scopeState.accessMode === 'gateway' || scopeState.accessMode === 'elysium') {
                    if (!isWorkspaceApp(app.id)) return false
                }
                if (isPlatformScoped(app.id, app.category) && !scopeState.canViewPlatform) return false
                if (scopeState.canViewPlatform && !isVeilAdminApp(app.id, app.category)) {
                    if (isWorkspaceApp(app.id)) return false // Hide workspace apps from platform nav
                }
            }

            // Require auth for non-core apps (on localhost bypass)
            if (app.requiresAuth && !scopeState.isAuthenticated) {
                const bypassAuth = scopeState.isLocalhost && ['core', 'agents', 'dev', 'monitor', 'infra', 'labs'].includes(app.category)
                if (!bypassAuth) return false
            }

            // Email verified (except admin)
            if (!scopeState.isEmailVerified && !scopeState.isAdmin && app.category !== 'core') return false

            // Min role
            if (!scopeState.minRole?.(app.minRole)) return false

            // Admin-only category
            if (app.category === 'admin' && !scopeState.isAdmin) return false

            // Hide planned apps
            if (app.status === 'planned') return false

            return true
        }

        if (surface === 'desktop') {
            // Desktop widget registry — auth required, no platform constraint
            if (app.requiresAuth && !scopeState.isAuthenticated) return false
            if (!scopeState.isEmailVerified && !scopeState.isAdmin) return false
            if (!scopeState.minRole?.(app.minRole)) return false
            if (app.status === 'planned') return false
            return true
        }

        if (surface === 'admin') {
            // Admin panel — platform users only
            if (!scopeState.canViewPlatform) return false
            if (app.requiresAuth && !scopeState.isAuthenticated) return false
            if (app.status === 'planned') return false
            return true
        }

        if (surface === 'public') {
            // Public pages (unauthenticated access OK)
            if (app.requiresAuth && !scopeState.isAuthenticated) return false
            if (app.status === 'planned') return false
            return true
        }

        return false
    })
}
