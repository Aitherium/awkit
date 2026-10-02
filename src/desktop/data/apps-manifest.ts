/**
 * AitherOS Unified App Manifest
 * ==============================
 * Single source of truth for EVERY app in AitherOS.
 * 
 * This drives:
 *   - GlobalNav sidebar (showInNav: true)
 *   - Desktop window manager (desktopWidget defined)
 *   - Start Menu app grid
 *   - Desktop canvas icons (desktopIcon defined)
 *   - Command palette search
 *   - Future App Manager page
 * 
 * To add a new app:
 *   1. Add an entry here
 *   2. It shows up everywhere automatically
 *
 * Capability-driven apps (capability-manifest.yaml `surfaces.desktop:` blocks,
 * emitted by gen_capability_surfaces.py) are merged into ALL_APPS as
 * CAPABILITY_APPS — see ./capability-apps.generated. Do not hand-copy a
 * capability app into this file; regenerate instead.
 *
 * @author AitherOS Team
 */

import type { ScopeTag } from '../lib/view-scope'
import { buildScopeTag, getAppsForSurface } from '../lib/view-scope'
import { CAPABILITY_APPS } from './capability-apps.generated'

export type AppCategory = 'core' | 'agents' | 'creative' | 'dev' | 'social' | 'labs' | 'admin' | 'monitor' | 'infra' | 'utility'
export type AppStatus = 'stable' | 'beta' | 'development' | 'planned'

/**
 * Where this app can actually function:
 * - 'local'      — Works with just Veil + ADK (no backend services needed). Chat, settings, profile, docs.
 * - 'gateway'    — Works when connected to gateway.aitherium.com (agents, MCP tools, creative via SaaS).
 * - 'full-stack' — Requires the local AitherOS stack (monitoring, infra, admin, service management).
 */
export type AppAvailability = 'local' | 'gateway' | 'full-stack'

export interface DesktopWidgetConfig {
    /** Widget ID used by the window manager */
    widgetId: string
    /** Default window size */
    defaultSize: { width: number; height: number }
    /** Icon name for taskbar/title bar (maps to Lucide) */
    icon: string
}

export interface DesktopIconConfig {
    /** Position on desktop canvas (column, row) */
    column: number
    row: number
}

/** Dashboard widget group */
export type DashboardWidgetGroup = 'chat' | 'agents' | 'command' | 'mind' | 'monitor' | 'build'

export interface DashboardWidgetConfig {
    /** Widget ID used by the dashboard */
    widgetId: string
    /** Dashboard group (maps to tab/section) */
    group: DashboardWidgetGroup
    /** Alt+key shortcut */
    shortcut?: string
    /** Default size */
    defaultSize: { width: number; height: number }
    /** Minimum size */
    minSize?: { width: number; height: number }
    /** Maximum size */
    maxSize?: { width: number; height: number }
}

/**
 * Which UI surfaces this app should appear on.
 * Controls visibility across workspace sidebar, desktop widget registry, global nav, admin panel, public pages.
 *
 * Default (when omitted): Inferred from app metadata for backward compatibility.
 * - 'workspace': Appears in /workspace/* sidebar (tenant-scoped workspace nav)
 * - 'nav':       Appears in global nav sidebar (platform admin/user nav)
 * - 'desktop':   Registerable as desktop windows; shows in Start Menu/Spotlight
 * - 'admin':     Platform admin panel only
 * - 'public':    Unauthenticated pages (docs, blog, landing)
 */
export type AppSurface = 'workspace' | 'desktop' | 'nav' | 'public' | 'admin'

export interface AitherApp {
    /** Unique identifier */
    id: string
    /** Display name */
    name: string
    /** Short description */
    description: string
    /** Lucide icon name (lowercase, kebab-case) */
    icon: string
    /** Next.js route path (if this app has a full page) */
    route?: string
    /** App category — drives nav grouping */
    category: AppCategory
    /**
     * RBAC resource+action required to see this app, checked through the host's
     * `can(resource, action)`.
     *
     * `CatalogEntry` has read `entry.rbac` since the catalogue gained a permission
     * dimension, and its comment calls it "the real gate: the engine exists and no
     * app was wired to it". This type is WHY none was: the field the gate reads was
     * not assignable here, so declaring it was a type error. The gate, the manifest
     * type and the host all had to agree before a single app could use it.
     *
     * An admin's `*:*:*` satisfies any pair; a member without the permission fails
     * closed. This is a UX filter — the security boundary stays server-side.
     */
    rbac?: { resource: string; action: string }
    /**
     * ACTA feature flag (PLANS[*].features vocabulary) that gates this app's
     * surface. Same UX-filter altitude as `rbac`; the security boundary stays
     * server-side (route-manifest `license:` / PANEL_FEATURE_MAP).
     * Part of the app-gating plane (data/app-gating.ts, check_app_gating.py).
     */
    acta?: string
    /**
     * App-license id (config/app_licenses.yaml) that gates this app. The
     * registry maps the license id to the ACTA features it grants; the server
     * gate reads the granted features.
     */
    license?: string
    /** Maturity status */
    status: AppStatus
    /** Primary AI agent integration (if any) */
    agent?: string
    /** Whether the app requires authentication */
    requiresAuth: boolean
    /** Where this app can function — controls visibility based on connection mode */
    availability: AppAvailability
    /** Minimum role required to see this app (checked client-side in sidebar) */
    minRole?: 'registered' | 'viewer' | 'developer' | 'operator' | 'admin'
    /** Whether to show in the GlobalNav sidebar */
    showInNav: boolean
    /** Nav group label override (defaults to category name) */
    navGroup?: string
    /** Sort order within its nav group (lower = higher) */
    navOrder?: number
    /** Keywords for search/command palette */
    keywords?: string[]
    /** Desktop widget config — if defined, app opens as a windowed widget on /desktop */
    desktopWidget?: DesktopWidgetConfig
    /** Desktop icon config — if defined, app shows as an icon on the desktop canvas */
    desktopIcon?: DesktopIconConfig
    /** Dashboard widget config — if defined, app appears as a widget on /dashboard */
    dashboardWidget?: DashboardWidgetConfig
    /**
     * View scope classification — computed automatically from SCOPE_CLASSIFICATION.
     * Controls tenant isolation, platform visibility, and Elysium sync eligibility.
     * @see lib/view-scope.ts
     */
    scopeTag?: ScopeTag
    /**
     * Canvas widget type — if set, clicking this app in the sidebar while on
     * /dashboard spawns the corresponding Canvas widget instead of navigating away.
     */
    canvasWidgetType?: string
    /**
     * Which UI surfaces this app should appear on.
     * Optional: if omitted, surfaces are inferred from app metadata (showInNav, desktopWidget, etc.)
     * for backward compatibility.
     */
    surfaces?: AppSurface[]
}

// ============================================================================
// CORE APPS — Essential OS experience, always in sidebar
// ============================================================================

const CORE_APPS: AitherApp[] = [
    {
        id: 'dashboard',
        name: 'Dashboard',
        description: 'System overview with widgets and metrics',
        icon: 'layout-dashboard',
        route: '/',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'local',
        showInNav: true,
        navOrder: 0,
        keywords: ['home', 'overview', 'widgets', 'metrics'],
    },
    {
        // The decision-card surface. `src/app/decisions/page.tsx` shipped 2026-08-10 in
        // "give the card channel actual surfaces — CLI, portal, ..." and no <Link href>,
        // router.push or app entry pointed at it, so the page existed and nothing could
        // reach it (CAP003). A card exists to get an agent's question in front of a
        // human; a page a human cannot navigate to cannot do that, and the failure is
        // silent — the route renders perfectly for anyone who types the URL.
        //
        // Entered here rather than in the site chrome on purpose: this is an
        // account surface (requiresAuth), and the public nav must only carry
        // logged-out-reachable links (the site-nav reachability gate enforces it).
        // The manifest is also the strongest single surface — nav, start menu and
        // spotlight search all render from it.
        // The training plane's surface. `training_status.py --publish` writes
        // AitherVeil/.private-data/training/status.json, served ONLY to the platform
        // owner by /api/controlroom/training-status (it holds rental ids and spend;
        // it was once under public/ and the Pages export published it). The CLI
        // and the desktop still read ONE state rather than each deriving its own.
        //
        // Entered here because the manifest is what makes an app exist: nav,
        // start menu and spotlight all render from it, and a route with no
        // entry is reachable only by typing the URL (DAW003).
        id: 'controlroom',
        name: 'Control Room',
        description: 'Training runs, GPU spend, and what the gates refused',
        icon: 'activity',
        route: '/mission-control?tab=training&view=board',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'local',
        showInNav: true,
        navOrder: 6,
        keywords: ['training', 'gpu', 'benchmark', 'aitherbench', 'runs', 'spend'],
        // DAW002 (2026-08-29): the training widget renders in Veil's import map
        // but no manifest app DECLARED it — this app owns the training plane.
        desktopWidget: { widgetId: 'training', defaultSize: { width: 760, height: 620 }, icon: 'activity' },
    },
    {
        id: 'decisions',
        name: 'Decisions',
        description: 'Answer questions your agents are waiting on',
        icon: 'message-square-warning',
        route: '/mission-control?tab=decisions',
        category: 'core',
        status: 'beta',
        requiresAuth: true,
        availability: 'local',
        showInNav: true,
        navGroup: 'Agents',
        navOrder: 4,
        keywords: ['decision', 'decisions', 'cards', 'approve', 'steer', 'ask', 'agent'],
    },
    {
        id: 'shop-deploy',
        name: 'Deploy Shop',
        description: 'Deploy your own white-label storefront, synced to api.aitherium.com',
        icon: 'shopping-cart',
        route: '/admin?tab=commerce&view=shop',
        category: 'core',
        status: 'beta',
        requiresAuth: true,
        availability: 'gateway',
        minRole: 'developer',
        showInNav: true,
        navGroup: 'Business',
        navOrder: 12,
        keywords: ['shop', 'store', 'storefront', 'commerce', 'deploy', 'white-label'],
    },
    {
        id: 'desktop',
        name: 'Desktop',
        description: 'Full GNOME-style desktop environment',
        icon: 'monitor-smartphone',
        route: '/?shell=aither-desktop',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'local',
        showInNav: true,
        navOrder: 1,
        keywords: ['gnome', 'os', 'environment', 'taskbar'],
        canvasWidgetType: 'desktop',
    },
    {
        id: 'writer',
        name: 'Content Studio',
        description: 'Write and publish to the blog — agent edits arrive as tracked changes, import AitherOne docs, narrate to video',
        icon: 'pen-tool',
        route: '/workspace/one?tab=docs',
        category: 'core',
        status: 'beta',
        agent: 'lyra',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 2,
        keywords: ['blog', 'writing', 'editor', 'tiptap', 'document', 'studio', 'publish', 'tracked changes', 'narration', 'aitherone'],
        desktopWidget: { widgetId: 'writer', defaultSize: { width: 900, height: 650 }, icon: 'file' },
        canvasWidgetType: 'writer',
    },
    {
        id: 'blog',
        name: 'Blog',
        description: 'Read every post published on aitherium.com - search, filter by tag, read in a window',
        icon: 'newspaper',
        route: '/blog',
        category: 'core',
        status: 'stable',
        // No auth and no backend: served entirely from the static payload
        // (`/data/blog-posts.json` + `/data/blog/<slug>.json`), which is what the
        // GitHub Pages export at aitherium.com actually has.
        //
        // RESTORED 2026-08-17. This block was deleted wholesale by 07bbfa9d23,
        // a concurrent session's lockbox commit that swept a manifest region it
        // did not intend to touch (-22 lines here, none of them lockbox). The
        // widget import map still carried `blog`, so the app vanished from the
        // launcher while its component sat in the bundle — which is exactly the
        // state check_desktop_app_wiring's DAW002 exists to name, and did.
        requiresAuth: false,
        availability: 'local',
        showInNav: false,
        navOrder: 4,
        keywords: ['blog', 'posts', 'articles', 'writing', 'news', 'essays', 'reading'],
        desktopWidget: { widgetId: 'blog', defaultSize: { width: 980, height: 720 }, icon: 'newspaper' },
        desktopIcon: { column: 1, row: 3 },
    },
    {
        id: 'files',
        name: 'Files',
        description: 'File browser and manager',
        icon: 'folder-open',
        route: '/workspace/files',
        category: 'core',
        status: 'beta',
        requiresAuth: true,
        availability: 'local',
        showInNav: true,
        navOrder: 3,
        keywords: ['file', 'browse', 'upload', 'download', 'explorer'],
        desktopWidget: { widgetId: 'strata', defaultSize: { width: 700, height: 550 }, icon: 'folder' },
        desktopIcon: { column: 0, row: 2 },
        // /files and /api/files both enforce system:admin
        // (route-manifest.ts:1214,195). Without this the app sat on
        // EVERY signed-in user's desktop and 403'd on open.
        rbac: { resource: 'system', action: 'admin' },
        canvasWidgetType: 'files',
    },
    {
        id: 'dossiers',
        name: 'Dossiers',
        description: 'Project dossiers mirrored from the repository into Strata, with their tracker issues and milestones',
        icon: 'library',
        route: '/workspace/dossier',
        category: 'core',
        status: 'beta',
        requiresAuth: true,
        availability: 'local',
        showInNav: true,
        navOrder: 4,
        keywords: ['dossier', 'dossiers', 'project', 'bid', 'proposal', 'whitepaper', 'remediation', 'milestones', 'strata'],
        desktopIcon: { column: 1, row: 4 },
        // /workspace/dossier and /api/dossier are files:read in route-manifest.ts;
        // the data is tenant-scoped Strata plus the viewer's own GitHub token.
        rbac: { resource: 'files', action: 'read' },
    },
    {
        id: 'settings',
        name: 'Settings',
        description: 'User preferences, SSH keys, GitHub integration, and system configuration',
        icon: 'settings',
        route: '/workspace/settings',
        category: 'core',
        status: 'beta',
        requiresAuth: true,
        availability: 'local',
        showInNav: true,
        navOrder: 4,
        keywords: ['preferences', 'config', 'theme', 'account', 'ssh', 'keys', 'github', 'social', 'linkedin', 'repos', 'verify', 'human', 'badge'],
        canvasWidgetType: 'settings',
        desktopIcon: { column: 0, row: 4 },
    },
    {
        id: 'apps',
        name: 'App Manager',
        description: 'Browse and manage installed apps',
        icon: 'grid-3x3',
        route: '/',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'local',
        showInNav: true,
        navOrder: 5,
        keywords: ['store', 'launcher', 'install', 'packages'],
        canvasWidgetType: 'apps',
    },
    {
        id: 'setup-laptop',
        name: 'Set Up Laptop',
        description: 'Install the aither shell, SDK, and Awconnect extension on your machine',
        icon: 'download',
        route: '/workspace/settings?tab=services',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 6,
        keywords: ['download', 'install', 'setup', 'laptop', 'cli', 'aither', 'shell', 'extension', 'connect', 'sdk'],
    },
    {
        id: 'builder',
        name: 'Builder',
        description: 'Describe it to Iris — she designs it, the swarm builds & deploys it',
        icon: 'blocks',
        route: '/studio',
        category: 'dev',
        status: 'beta',
        requiresAuth: false,
        availability: 'gateway',
        showInNav: true,
        navGroup: 'Platform',
        navOrder: 5,
        agent: 'iris',
        keywords: ['builder', 'create', 'app', 'deploy', 'agent', 'iris', 'studio'],
    },
    {
        id: 'my-apps',
        name: 'My Apps',
        description: 'Manage deployed apps from the Agent Builder',
        icon: 'boxes',
        route: '/studio?view=apps',
        category: 'dev',
        status: 'beta',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: false,
        navOrder: 91,
        keywords: ['apps', 'deploy', 'manage', 'builder', 'dashboard'],
    },
    {
        id: 'watch',
        name: 'Watch',
        description: 'Service monitoring and system health',
        icon: 'eye',
        route: '/mission-control?tab=observe&view=health',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navOrder: 6,
        keywords: ['monitor', 'health', 'services', 'task-manager'],
        canvasWidgetType: 'watch',
    },
    {
        // Renamed 2026-09-01 (AG003 discharge): `docs` is the OS device-local
        // docs app; the platform docs site keeps its own identity.
        id: 'platform-docs',
        name: 'Docs',
        description: 'Platform documentation and guides',
        icon: 'library',
        route: '/docs',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'local',
        showInNav: true,
        navOrder: 7,
        keywords: ['documentation', 'help', 'guides', 'api'],
        canvasWidgetType: 'docs',
    },
    {
        id: 'action-inbox',
        name: 'Action Inbox',
        description: 'Unified actionable items: gates, approvals, clarifications, alerts — one place to review and respond',
        icon: 'inbox',
        route: '/workspace/agents?tab=decisions',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'local',
        showInNav: true,
        navOrder: 8,
        keywords: ['actions', 'approvals', 'gates', 'inbox', 'review', 'clarifications', 'alerts', 'correspondence'],
        canvasWidgetType: 'action-inbox',
    },
    {
        id: 'notifications',
        name: 'Notifications',
        description: 'Unified notification inbox for all AitherOS events',
        icon: 'bell',
        route: '/?panel=notifications',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'local',
        showInNav: true,
        navOrder: 9,
        keywords: ['notifications', 'alerts', 'inbox', 'events'],
        canvasWidgetType: 'notifications',
        // Platform notifications; workspace may have its own notifications surface
        surfaces: ['nav', 'desktop'],
    },
    {
        id: 'profile',
        name: 'Profile',
        description: 'Account settings, social links, GitHub integration, sessions, and Desktop Anywhere',
        icon: 'user',
        route: '/workspace/settings?tab=profile',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'local',
        showInNav: true,
        navOrder: 10,
        keywords: ['account', 'profile', 'user', 'sessions', 'preferences', 'social', 'github', 'linkedin', 'website', 'verify', 'badge', 'human', 'entity'],
        canvasWidgetType: 'profile',
    },
    {
        id: 'routine-builder',
        name: 'Routine Builder',
        description: 'Create, schedule, and manage autonomous agent routines',
        icon: 'calendar-days',
        route: '/studio?mode=workflow',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 10,
        keywords: ['routines', 'schedule', 'automation', 'cron', 'tasks', 'autonomous'],
        canvasWidgetType: 'routine-builder',
    },
    {
        id: 'workflow-builder',
        name: 'Workflow Builder',
        description: 'Visual agent workflow orchestration and pipeline design',
        icon: 'workflow',
        route: '/studio?mode=workflow',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 11,
        keywords: ['workflow', 'pipeline', 'orchestration', 'agents', 'automation', 'builder'],
        canvasWidgetType: 'workflow-builder',
    },
]

// ============================================================================
// AGENT EXPERIENCES — AI-agent-first interfaces
// ============================================================================

const AGENT_APPS: AitherApp[] = [
    // NOTE: 'company-room' was REMOVED as a standalone app. The Company Room is not
    // an app — it is absorbed into AitherRelay as the org-scoped `#company` CHANNEL,
    // retaining its full channel design (Messages | Files | Console tabs, access gate,
    // members panel). Reach it from the Relay channel list, or via the thin
    // /room → /workspace/relay?channel=company redirect (kept for room.aitherium.com
    // and existing bookmarks). Do not re-add it to the nav.
    {
        id: 'mission-control',
        name: 'Mission Control',
        description: 'Unified work board, expeditions, and agent fleet',
        icon: 'rocket',
        route: '/mission-control',
        category: 'agents',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 0,
        keywords: ['tasks', 'fleet', 'expeditions', 'kanban', 'work', 'packages', 'projects'],
        canvasWidgetType: 'mission-control',
    },
    {
        id: 'agents-hub',
        name: 'Agents Hub',
        description: 'Agent directory, fleet management, constellation view',
        icon: 'bot',
        route: '/workspace/agents',
        category: 'agents',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 1,
        keywords: ['agents', 'fleet', 'constellation', 'council'],
        desktopWidget: { widgetId: 'agents', defaultSize: { width: 500, height: 450 }, icon: 'bot' },
        canvasWidgetType: 'agents',
    },
    {
        id: 'demi',
        name: 'Demi',
        description: 'AI-powered coding agent — spawn autonomous coding missions via ForgeIDE',
        icon: 'wand-2',
        route: '/studio?drawer=builds',
        category: 'agents',
        status: 'stable',
        agent: 'demiurge',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 2,
        keywords: ['ide', 'code', 'forge', 'demiurge', 'mission-control'],
        desktopWidget: { widgetId: 'demiurge', defaultSize: { width: 500, height: 550 }, icon: 'wand' },
        desktopIcon: { column: 1, row: 2 },
        canvasWidgetType: 'demiurge',
    },
    {
        id: 'atlas',
        name: 'Atlas',
        description: 'Project lifecycle manager — expeditions, planning, agents, and execution',
        icon: 'telescope',
        route: '/workspace/agents/atlas',
        category: 'agents',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 2,
        keywords: ['atlas', 'project', 'expedition', 'planning', 'agents', 'execution', 'pipeline'],
        desktopWidget: { widgetId: 'atlas', defaultSize: { width: 700, height: 650 }, icon: 'git' },
        canvasWidgetType: 'atlas',
    },
    // Individual agent windows (desktop only, not in sidebar)
    {
        id: 'brain',
        name: 'Aither Protocol',
        description: 'Core AI protocol interface and chat',
        icon: 'brain',
        category: 'agents',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: false,
        keywords: ['protocol', 'brain', 'chat', 'aeon'],
        desktopWidget: { widgetId: 'brain', defaultSize: { width: 900, height: 650 }, icon: 'brain' },
        desktopIcon: { column: 0, row: 0 },
    },
    {
        id: 'constellation',
        name: 'Constellation',
        description: 'Agent constellation visualization',
        icon: 'sparkles',
        route: '/?channel=mind&keyword=constellation',
        category: 'agents',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 15,
        keywords: ['constellation', 'network', 'visualization'],
        canvasWidgetType: 'constellation',
        desktopWidget: { widgetId: 'constellation', defaultSize: { width: 800, height: 600 }, icon: 'sparkles' },
        desktopIcon: { column: 1, row: 0 },
    },
    {
        id: 'hera',
        name: 'Hera',
        description: 'The Broadcaster — social media amplification',
        icon: 'radio',
        route: '/workspace/agents/hera',
        category: 'agents',
        status: 'stable',
        agent: 'hera',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 5,
        keywords: ['broadcast', 'social', 'publish', 'hera'],
        desktopWidget: { widgetId: 'hera', defaultSize: { width: 550, height: 600 }, icon: 'radio' },
        desktopIcon: { column: 1, row: 1 },
        canvasWidgetType: 'hera',
    },
    {
        id: 'vera',
        name: 'Vera',
        description: 'The Writer — content creation and editing',
        icon: 'feather',
        route: '/vera',
        category: 'agents',
        status: 'stable',
        agent: 'vera',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 6,
        keywords: ['writer', 'content', 'blog', 'vera'],
        desktopWidget: { widgetId: 'vera', defaultSize: { width: 600, height: 700 }, icon: 'feather' },
        canvasWidgetType: 'vera',
    },
    {
        id: 'lyra',
        name: 'Lyra',
        description: 'The Researcher — knowledge and discovery',
        icon: 'library',
        route: '/lyra',
        category: 'agents',
        status: 'stable',
        agent: 'lyra',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 7,
        keywords: ['research', 'knowledge', 'search', 'lyra'],
        desktopWidget: { widgetId: 'lyra', defaultSize: { width: 500, height: 600 }, icon: 'library' },
        canvasWidgetType: 'lyra',
    },
    {
        id: 'saga',
        name: 'Saga',
        description: 'The Lorekeeper — narrative and story engine',
        icon: 'feather',
        route: '/?channel=arcade&keyword=saga',
        category: 'agents',
        status: 'stable',
        agent: 'saga',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 8,
        keywords: ['lore', 'narrative', 'story', 'saga'],
        desktopWidget: { widgetId: 'saga', defaultSize: { width: 450, height: 550 }, icon: 'feather' },
        canvasWidgetType: 'saga-agent',
    },
    {
        id: 'themis',
        name: 'Themis',
        description: 'The Equalizer — contract analysis, dark patterns, price transparency',
        icon: 'scale',
        route: '/workspace/agents/themis',
        category: 'agents',
        status: 'stable',
        agent: 'themis',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 9,
        keywords: ['consumer', 'advocacy', 'contract', 'dark-pattern', 'price', 'themis'],
        desktopWidget: { widgetId: 'themis', defaultSize: { width: 600, height: 650 }, icon: 'scale' },
        canvasWidgetType: 'themis',
    },
    {
        id: 'chaos',
        name: 'Chaos',
        description: 'The Crucible — adversarial red-team testing and security intelligence',
        icon: 'flame',
        route: '/mission-control?tab=labs&view=chaos',
        category: 'agents',
        status: 'stable',
        agent: 'chaos',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 10,
        keywords: ['chaos', 'security', 'adversarial', 'red-team', 'sins', 'warden', 'crucible'],
        desktopWidget: { widgetId: 'chaos', defaultSize: { width: 700, height: 650 }, icon: 'flame' },
        canvasWidgetType: 'chaos',
    },
    {
        id: 'reasoning',
        name: 'Reasoning',
        description: 'Deep reasoning and analysis engine',
        icon: 'sparkles',
        category: 'agents',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: false,
        keywords: ['reasoning', 'analysis', 'logic', 'sase'],
        desktopWidget: { widgetId: 'reasoning', defaultSize: { width: 500, height: 450 }, icon: 'sparkles' },
    },
    {
        id: 'forge',
        name: 'Forge Dispatch',
        description: 'Cloud agent dispatch — spawn autonomous subagents for coding, research, planning',
        icon: 'flame',
        route: '/studio?drawer=builds',
        category: 'agents',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 3,
        keywords: ['forge', 'copilot', 'dispatch', 'workflows', 'subagents', 'coding', 'mission-control'],
        desktopWidget: { widgetId: 'forge', defaultSize: { width: 950, height: 700 }, icon: 'flame' },
        canvasWidgetType: 'forge',
    },
    {
        id: 'forge-traces',
        name: 'Forge Traces',
        description: 'Real-time agent orchestration visualization — trace trees, turn-by-turn inspection',
        icon: 'git-branch',
        route: '/mission-control?tab=observe&view=traces&kind=forge',
        category: 'agents',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 3,
        keywords: ['forge', 'trace', 'orchestration', 'tree', 'turns', 'visualization'],
    },
    {
        id: 'iris',
        name: 'Iris',
        description: 'The Visual Artisan — the front door for building apps, agents, designs, and projects',
        icon: 'palette',
        route: '/studio?mode=design',
        category: 'agents',
        status: 'stable',
        agent: 'iris',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 4,
        keywords: ['iris', 'image', 'art', 'visual', 'generation', 'creative', 'builder', 'app', 'agent', 'intake'],
        desktopWidget: { widgetId: 'iris', defaultSize: { width: 900, height: 700 }, icon: 'monitor' },
        canvasWidgetType: 'iris',
    },
    {
        id: 'agent-bus',
        name: 'Agent Bus',
        description: 'A2A message bus inspector — see agent-to-agent communication in real-time',
        icon: 'network',
        route: '/mission-control?tab=agents',
        category: 'agents',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 14,
        keywords: ['a2a', 'bus', 'messages', 'gateway', 'communication'],
        desktopWidget: { widgetId: 'agent-bus', defaultSize: { width: 850, height: 600 }, icon: 'network' },
        canvasWidgetType: 'agent-bus',
    },
    {
        id: 'council',
        name: 'Council',
        description: 'Agent council — collective deliberation, voting, and multi-agent decision-making',
        icon: 'users',
        route: '/chat?view=council',
        category: 'agents',
        status: 'stable',
        agent: 'council',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 16,
        keywords: ['council', 'deliberation', 'voting', 'collective', 'agents', 'decision'],
        canvasWidgetType: 'council',
    },
    {
        id: 'expeditions',
        name: 'Expeditions',
        description: 'Multi-session project orchestration — autonomous planning, gated execution, and live tracking',
        icon: 'rocket',
        route: '/workspace/agents?tab=runs&view=expeditions',
        category: 'agents',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 3,
        keywords: ['expedition', 'mission', 'task', 'dispatch', 'progress', 'agent'],
        canvasWidgetType: 'expeditions',
    },
    {
        id: 'spec-factory',
        name: 'Spec Factory',
        description: 'Drop a PRD → triage into trackable requirements → measure the agent pack\'s conformance → gated build plan',
        icon: 'clipboard-check',
        route: '/workspace/agents/atlas?view=conformance',
        category: 'agents',
        status: 'beta',
        requiresAuth: true,
        availability: 'gateway',
        minRole: 'developer',
        showInNav: true,
        navOrder: 4,
        keywords: ['spec', 'prd', 'requirements', 'conformance', 'pack', 'factory', 'gap', 'triage'],
    },
    {
        id: 'steward',
        name: 'Steward',
        description: 'Resource steward — lifecycle management, budget allocation, and cost control',
        icon: 'scale',
        route: '/workspace/agents/steward',
        category: 'agents',
        status: 'stable',
        agent: 'steward',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navOrder: 18,
        keywords: ['steward', 'resource', 'lifecycle', 'budget', 'cost', 'allocation'],
        canvasWidgetType: 'steward',
    },
]

// ============================================================================
// CREATIVE APPS — Art, canvas, 3D, media
// ============================================================================

const CREATIVE_APPS: AitherApp[] = [
    {
        id: 'creative-studio',
        name: 'Creative Studio',
        description: 'Forge, Canvas, Prometheus — art, 3D, and world simulation',
        icon: 'palette',
        route: '/studio?mode=media',
        category: 'creative',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 0,
        keywords: ['art', 'canvas', '3d', 'image', 'forge', 'prometheus'],
        canvasWidgetType: 'creative-studio',
    },
    {
        // /comics shipped as a reachable-by-URL-only page (CAP003): the route was
        // in route-manifest.ts, so an authenticated request worked, and NOTHING
        // linked to it — no nav entry, no <Link>, no router.push. A page nobody
        // can navigate to is not shipped, it is deployed. This manifest is the one
        // place that fixes it everywhere at once: global-nav, start-menu and
        // spotlight-search all read it.
        id: 'comics',
        name: 'Comics',
        description: 'Comic page builder — panel grid and inspector over the media-forge doc',
        icon: 'book-open',
        route: '/studio?mode=media&view=comics',
        category: 'creative',
        status: 'beta',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 1,
        keywords: ['comic', 'panel', 'page', 'storyboard', 'media-forge'],
    },
    {
        id: 'canvas',
        name: 'Canvas',
        description: 'AI image generation via ComfyUI',
        icon: 'palette',
        category: 'creative',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: false,
        keywords: ['comfyui', 'image', 'generation', 'diffusion'],
        desktopWidget: { widgetId: 'canvas', defaultSize: { width: 550, height: 700 }, icon: 'monitor' },
    },
    {
        id: 'forge3d',
        name: 'Forge3D Studio',
        description: '3D model generation and viewing',
        icon: 'box',
        category: 'creative',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: false,
        keywords: ['3d', 'model', 'mesh', 'forge'],
        desktopWidget: { widgetId: 'forge3d', defaultSize: { width: 900, height: 700 }, icon: 'box' },
    },
    {
        id: 'paint',
        name: 'Paint',
        description: 'Freeform drawing canvas',
        icon: 'palette',
        category: 'creative',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: false,
        keywords: ['draw', 'paint', 'sketch', 'canvas'],
        desktopWidget: { widgetId: 'paint', defaultSize: { width: 900, height: 700 }, icon: 'monitor' },
    },
    {
        id: 'image-viewer',
        name: 'Image Viewer',
        description: 'Browse and view images',
        icon: 'image',
        category: 'creative',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: false,
        keywords: ['image', 'photo', 'gallery', 'viewer'],
        desktopWidget: { widgetId: 'image-viewer', defaultSize: { width: 850, height: 650 }, icon: 'image' },
    },
    {
        id: 'gobbonet',
        // Renamed 2026-09-01 (owner): Elysium is the desktop name of the
        // local-first chat client. The id stays 'gobbonet' — it is the wiring
        // key across the import map, view-scope sets and the /gobbonet route.
        name: 'Elysium',
        description: 'Talk to the people of The Lattice Realm — seven characters, on a model running in your browser. No account, no server.',
        icon: 'message-square',
        category: 'creative',
        status: 'beta',
        requiresAuth: false,
        availability: 'local',
        showInNav: true,
        navOrder: 4,
        keywords: ['gobbonet', 'chat', 'character', 'cards', 'lorebook', 'rag', 'local', 'llm'],
        desktopWidget: { widgetId: 'gobbonet', defaultSize: { width: 1100, height: 780 }, icon: 'message-square' },
    },
    {
        id: 'mediaforge',
        name: 'Media Forge',
        description: 'Creative studio — image, video and 3D pipelines. Your private studio, opened here.',
        icon: 'clapperboard',
        category: 'creative',
        status: 'beta',
        // 2026-09-06 owner: a PRIVATE, authenticated app for the owner on the hosted desktop.
        // The window frames mediaforge.aitherium.com, whose public edge admits only the
        // owner's Identity session; on a desktop dev host it still frames localhost:8200.
        requiresAuth: true,
        availability: 'full-stack',
        minRole: 'admin',
        showInNav: true,
        navOrder: 5,
        keywords: ['media-forge', 'mediaforge', 'studio', 'render', 'image', 'video', '3d', 'comfyui'],
        desktopWidget: { widgetId: 'mediaforge', defaultSize: { width: 1280, height: 820 }, icon: 'clapperboard' },
    },
    {
        // 2026-09-30 owner: Aither Hearth on the desktop. The home lives on the tool
        // gateway (mcp_hearth.py, per authenticated caller); this window shows it and is
        // where the OWNER answers approval cards. No route: it is a window, not a page.
        id: 'hearth',
        name: 'Hearth',
        description: 'Talk to your home assistant: it runs your day, asks before anything leaves home, and keeps a signed receipt of everything it did.',
        icon: 'home',
        category: 'agents',
        status: 'beta',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: false,
        keywords: ['hearth', 'home', 'reminders', 'approvals', 'receipts', 'assistant'],
        desktopWidget: { widgetId: 'hearth', defaultSize: { width: 1080, height: 760 }, icon: 'home' },
    },
    {
        // 2026-10-01 owner: "this whole academy thing seems very poorly integrated".
        // Measured: Classroom and Learn had NO entry here, so neither was in the nav,
        // the start menu or the command palette; the one inbound link to Classroom
        // was a line on /learn/parent. Both are PAGES (route, no desktopWidget): each
        // lives in the Living OS frame with its own chrome. /classroom is public in
        // proxy.ts (PUBLIC_EXACT): signed out it is the front page with the doors in,
        // signed in it is the teacher console. Genesis decides teacher / parent from
        // the verified caller, and a child account is sent to /learn by child-lockdown.
        id: 'classroom',
        name: 'Aither Classroom',
        description: 'The teacher console: a roster and a QR join sheet, lessons that go home, and what the class finds hard right now.',
        icon: 'presentation',
        route: '/classroom',
        category: 'social',
        status: 'beta',
        requiresAuth: false,
        availability: 'gateway',
        showInNav: true,
        navOrder: 6,
        keywords: ['classroom', 'academy', 'school', 'teacher', 'class', 'students', 'roster', 'lessons', 'parents'],
    },
    {
        // The grown-up door. /learn itself is the child surface (its own PWA chrome);
        // an adult who opens it is sent on to /learn/parent, so the entry names the
        // page an adult actually lands on. The server enforces the guardian check.
        id: 'learn',
        name: 'Aither Learn',
        description: 'The family tutor: set up a child, see what they practised and where they are stuck, as observations with their sources.',
        icon: 'book-open',
        route: '/learn/parent',
        category: 'social',
        status: 'beta',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 7,
        keywords: ['learn', 'tutor', 'family', 'child', 'kids', 'homework', 'practice', 'parent', 'guardian'],
    },
    {
        id: 'darkmatters',
        name: 'Dark Matters',
        description: 'Play The Lattice Realm — a dark-fantasy RPG. Your private world, your saves, your engine on the fleet, opened here.',
        icon: 'gamepad-2',
        category: 'creative',
        status: 'beta',
        requiresAuth: true,  // owner decision 2026-08-30: keep the play surface auth-gated at the app middleware even though the page is a static shell; was false, which claimed a public funnel that the proxy never actually shipped
        // 2026-09-06 owner: "an app AT aitherium.com". The window now frames the owner's
        // fleet-hosted engine behind its Identity gate (api.aitherium.com/dark-matters), so the app is a
        // hosted surface, not a local-only pairing shell. minRole admin = owner-only until the
        // PG demo lane exists for everyone else (.AITHEROS/37-DARK-MATTERS-PRIVATE-PLAY.md).
        availability: 'full-stack',
        minRole: 'admin',
        showInNav: true,
        navOrder: 3,
        keywords: ['dark matters', 'game', 'rpg', 'play', 'survival', 'private'],
        desktopWidget: { widgetId: 'darkmatters', defaultSize: { width: 1180, height: 760 }, icon: 'gamepad-2' },
    },
    {
        id: 'prometheus',
        name: 'Prometheus',
        description: 'World simulation engine — generative worldbuilding and procedural environments',
        icon: 'flame',
        route: '/mission-control?tab=labs&view=prometheus',
        category: 'creative',
        status: 'stable',
        agent: 'prometheus',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 1,
        keywords: ['prometheus', 'world', 'simulation', '3d', 'procedural', 'generation', 'worldbuilding'],
        canvasWidgetType: 'prometheus',
    },
]

// ============================================================================
// PRODUCTIVITY APPS — Desktop tools for everyday tasks
// ============================================================================

const PRODUCTIVITY_APPS: AitherApp[] = [
    {
        id: 'terminal',
        name: 'Terminal',
        description: 'Command-line terminal emulator',
        icon: 'terminal',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['terminal', 'shell', 'command', 'console', 'bash'],
        desktopWidget: { widgetId: 'terminal', defaultSize: { width: 750, height: 500 }, icon: 'terminal' },
        desktopIcon: { column: 0, row: 1 },
    },
    {
        id: 'notepad',
        name: 'Notepad',
        description: 'Quick text editor for notes and scratchpads',
        icon: 'file-text',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'local',
        showInNav: false,
        keywords: ['notepad', 'text', 'editor', 'notes', 'scratchpad'],
        desktopWidget: { widgetId: 'notepad', defaultSize: { width: 800, height: 600 }, icon: 'file' },
    },
      // calculator is NOT listed here on purpose (AG003, 2026-09-01): it is a device-local
      // OS app whose id may not also live in the catalog id space. The launcher reaches
      // it through the `office` family tile in app-registry.tsx ("the launcher shows
      // only this tile"; openApp('calculator') still lands on it). A 2026-09-04 re-add
      // solved a launcher gap the family tile had already closed and re-opened AG003.
    {
        id: 'filesystem',
        name: 'File Manager Pro',
        description: 'Advanced file manager with tree view',
        icon: 'folder',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'local',
        showInNav: false,
        keywords: ['file', 'manager', 'directory', 'filesystem'],
        desktopWidget: { widgetId: 'filesystem', defaultSize: { width: 850, height: 620 }, icon: 'folder' },
    },
    {
        id: 'tasks',
        name: 'Tasks',
        description: 'Task manager and to-do lists',
        icon: 'check-square',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'local',
        showInNav: false,
        keywords: ['tasks', 'todo', 'checklist'],
        desktopWidget: { widgetId: 'tasks', defaultSize: { width: 650, height: 700 }, icon: 'activity' },
    },
    {
        id: 'alarms',
        name: 'Alarms',
        description: 'Alarms, timers, and reminders',
        icon: 'bell',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'local',
        showInNav: false,
        keywords: ['alarm', 'timer', 'reminder', 'clock'],
        desktopWidget: { widgetId: 'alarms', defaultSize: { width: 500, height: 550 }, icon: 'activity' },
    },
    /* 'model-planner' RETIRED 2026-09-30: one planner, in the OS Brain app's Fit tab
       (AitherVeil components/os/apps/brain/fit-planner.tsx). A second widget copy of
       the same component was the duplicate half-built door the integration brief
       forbids; route-map.yaml carries app:model-planner -> app:brain. */
    /* Deleted 2026-09-01 (AG003 discharge): the manifest `calculator` was a
       vestige — no route, no backend, requiresAuth — while the OS registry
       owns the real device-local calculator. The catalog id space no longer
       pretends there are two calculators. */
    {
        id: 'browser',
        name: 'Web Browser',
        description: 'Built-in web browser',
        icon: 'globe',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'local',
        showInNav: false,
        keywords: ['browser', 'web', 'internet', 'chrome'],
        desktopWidget: { widgetId: 'browser', defaultSize: { width: 1000, height: 720 }, icon: 'globe' },
        desktopIcon: { column: 0, row: 3 },
    },
    {
        id: 'screenshot',
        name: 'Screenshot',
        description: 'Screen capture tool',
        icon: 'camera',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'local',
        showInNav: false,
        keywords: ['screenshot', 'capture', 'screen'],
        desktopWidget: { widgetId: 'screenshot', defaultSize: { width: 850, height: 620 }, icon: 'image' },
    },
    {
        id: 'weather',
        name: 'Weather',
        description: 'Weather forecasts and conditions',
        icon: 'cloud-sun',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: false,
        keywords: ['weather', 'forecast', 'temperature'],
        desktopWidget: { widgetId: 'weather', defaultSize: { width: 420, height: 600 }, icon: 'activity' },
    },
    {
        id: 'mail',
        name: 'Mail',
        description: 'Email inbox — send and receive @aitherium.com mail',
        icon: 'mail',
        route: '/workspace/one?tab=mail',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navGroup: 'Office Suite',
        navOrder: 6,
        keywords: ['email', 'mail', 'inbox', 'relay', 'messages', 'compose'],
        desktopWidget: { widgetId: 'mail', defaultSize: { width: 550, height: 500 }, icon: 'message' },
        canvasWidgetType: 'mail',
        // De-dup: 'ws-mail' owns the workspace surface
        surfaces: ['nav', 'desktop'],
    },
    {
        id: 'console',
        name: 'Console',
        description: 'User home — chat, mail, agents, files, terminal, settings',
        icon: 'layout-dashboard',
        route: '/',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 13,
        keywords: ['console', 'portal', 'chat', 'mail', 'agents', 'files', 'terminal', 'settings', 'home'],
        canvasWidgetType: 'console',
    },
    {
        id: 'actions',
        name: 'Actions',
        description: 'Action manager and executor',
        icon: 'clipboard',
        route: '/workspace/agents?tab=decisions',
        category: 'core',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: false,
        keywords: ['actions', 'execute', 'run', 'commands'],
        canvasWidgetType: 'actions',
    },
    {
        id: 'gate',
        name: 'Gate',
        description: 'Authentication gate for live instance access',
        icon: 'shield',
        route: '/login',
        category: 'core',
        status: 'stable',
        requiresAuth: false,
        availability: 'local',
        showInNav: false,
        keywords: ['login', 'auth', 'gate', 'authenticate'],
    },
    {
        id: 'bang',
        name: 'Big Bang',
        description: 'Cinematic galaxy-birth entry experience',
        icon: 'flame',
        route: '/bang',
        category: 'core',
        status: 'stable',
        requiresAuth: false,
        availability: 'local',
        showInNav: false,
        keywords: ['bang', 'intro', 'cinematic', 'galaxy'],
    },
    {
        id: 'experience',
        name: 'Experience',
        description: 'Choose your AitherOS demo experience',
        icon: 'eye',
        route: '/',
        category: 'core',
        status: 'stable',
        requiresAuth: false,
        availability: 'local',
        showInNav: false,
        keywords: ['experience', 'demo', 'tour', 'chooser'],
        canvasWidgetType: 'experience',
    },
]

// ============================================================================
// DEV TOOLS
// ============================================================================

const DEV_APPS: AitherApp[] = [
    {
        id: 'dev-console',
        name: 'Dev Console',
        description: 'IDE, GitHub, Issues, PRs, Releases, Terminal',
        icon: 'code-2',
        route: '/mission-control?tab=observe&view=dev-tools',
        category: 'dev',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 0,
        keywords: ['code', 'github', 'terminal', 'git', 'issues', 'pr'],
        canvasWidgetType: 'dev-tools',
    },
    {
        id: 'github',
        name: 'GitHub',
        description: 'GitHub command center',
        icon: 'git-branch',
        category: 'dev',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: false,
        keywords: ['github', 'git', 'repository', 'commits'],
        desktopWidget: { widgetId: 'github', defaultSize: { width: 900, height: 700 }, icon: 'git' },
        canvasWidgetType: 'github',
    },
    {
        id: 'deployments',
        name: 'Deployments',
        description: 'Ring-based deployment pipeline — dev → prod promotion',
        icon: 'rocket',
        route: '/admin?tab=compute',
        category: 'dev',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 1,
        keywords: ['deploy', 'ring', 'promote', 'production', 'pipeline', 'ci', 'cd'],
        desktopWidget: { widgetId: 'deployments', defaultSize: { width: 900, height: 700 }, icon: 'rocket' },
        dashboardWidget: { widgetId: 'deployments', group: 'build', defaultSize: { width: 600, height: 400 }, minSize: { width: 400, height: 300 } },
        canvasWidgetType: 'deploy',
    },
    {
        id: 'project-management',
        name: 'Projects',
        description: 'Project management — tasks, sprints, boards, integrated with Atlas & Demiurge',
        icon: 'clipboard',
        route: '/studio?mode=media',
        category: 'dev',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 2,
        keywords: ['project', 'task', 'sprint', 'board', 'kanban', 'atlas', 'demiurge', 'management'],
        desktopWidget: { widgetId: 'projects', defaultSize: { width: 1000, height: 700 }, icon: 'clipboard' },
        dashboardWidget: { widgetId: 'projects', group: 'build', defaultSize: { width: 600, height: 400 }, minSize: { width: 400, height: 300 } },
        canvasWidgetType: 'projects',
    },
    {
        id: 'forge-ide',
        name: 'Mission Control',
        description: 'Unified mission control — launch, monitor, and manage autonomous work sessions (forge dispatch + swarm coding)',
        icon: 'rocket',
        route: '/studio?drawer=builds',
        category: 'agents',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: false,
        navOrder: 3,
        keywords: ['forge', 'mission', 'control', 'dispatch', 'swarm', 'autonomous', 'sessions'],
        canvasWidgetType: 'forge',
    },
    {
        id: 'sandbox',
        name: 'Sandbox',
        description: 'Live preview and code execution sandbox',
        icon: 'flask-conical',
        route: '/studio?mode=code&view=sandbox',
        category: 'dev',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 4,
        keywords: ['sandbox', 'preview', 'execute', 'container', 'live'],
        canvasWidgetType: 'sandbox',
    },
    {
        id: 'notebooks',
        name: 'Agent Notebooks',
        description: 'Agent Notebooks — structured .anb execution plans with cells, variables, and checkpoints',
        icon: 'book-open',
        route: '/workspace/one?tab=notebooks',
        category: 'dev',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 5,
        keywords: ['notebook', 'agent', 'execution', 'plan', 'cells', 'anb', 'workflow', 'structured', 'checkpoint'],
        // Desktop widget removed 2026-08-16: no component in veil-widget-import-map.
        // App remains accessible via nav and route; window instantiation blocked.
    },
    {
        id: 'github-ops',
        name: 'GitHub Ops',
        description: 'Operational GitHub control plane for repos, PR flow, and release-facing actions',
        icon: 'git-branch',
        route: '/mission-control?tab=deployments&view=github',
        category: 'dev',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 5.25,
        keywords: ['github', 'ops', 'repository', 'pull-request', 'release', 'workflow'],
        canvasWidgetType: 'github',
    },
    {
        id: 'kernel-forge',
        name: 'Kernel Forge',
        description: 'Kernel and runtime build surface for lower-level experimentation and packaging',
        icon: 'cpu',
        route: '/mission-control?tab=labs&view=kernel-forge',
        category: 'dev',
        status: 'beta',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 5.5,
        keywords: ['kernel', 'forge', 'runtime', 'builder', 'packaging', 'low-level'],
        canvasWidgetType: 'kernel-forge',
    },
    {
        id: 'network-inspector',
        name: 'Network Inspector',
        description: 'HAR analyzer, SAML tracer, and HTTP traffic debugger with Awconnect live capture',
        icon: 'network',
        route: '/mission-control?tab=infrastructure&view=network',
        category: 'dev',
        status: 'stable',
        requiresAuth: true,
        availability: 'local',
        showInNav: true,
        navOrder: 5,
        keywords: ['har', 'saml', 'network', 'http', 'traffic', 'trace', 'sso', 'debug', 'waterfall', 'inspector', 'connect'],
        desktopWidget: { widgetId: 'network-inspector', defaultSize: { width: 1200, height: 800 }, icon: 'network' },
        canvasWidgetType: 'network-inspector',
    },
    {
        id: 'awconnect',
        name: 'Awconnect',
        description: 'Browser debugging hub — upload HAR captures, decode SAML assertions, analyze HTTP traffic, and diagnose SSO issues',
        icon: 'zap',
        route: '/workspace/settings?tab=services&view=awconnect',
        category: 'dev',
        status: 'stable',
        requiresAuth: true,
        availability: 'local',
        showInNav: true,
        navOrder: 4,
        keywords: ['connect', 'har', 'saml', 'sso', 'browser', 'debug', 'capture', 'traffic', 'decode', 'assertion', 'awconnect'],
        desktopWidget: { widgetId: 'awconnect', defaultSize: { width: 1200, height: 800 }, icon: 'zap' },
    },
    {
        id: 'developers',
        name: 'Developers',
        description: 'Developer portal — API docs, SDK references, and integration guides',
        icon: 'code-2',
        route: '/docs',
        category: 'dev',
        status: 'stable',
        requiresAuth: false,
        availability: 'local',
        showInNav: true,
        navOrder: 6,
        keywords: ['developers', 'api', 'docs', 'sdk', 'reference', 'integration', 'guide'],
    },
    // ── Platform Extensions (deployable to tenant workspaces) ──
    {
        id: 'ext-node',
        name: 'awnode',
        description: 'MCP tool server — 100+ tools for agent execution, code intelligence, and hardware probing',
        icon: 'cpu',
        category: 'dev',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: false,
        keywords: ['node', 'mcp', 'tools', 'agent', 'extension', 'hardware', 'code-intelligence'],
    },
    {
        id: 'ext-shell',
        name: 'AitherShell',
        description: 'Interactive web terminal — chat, agent routing, forge dispatch, and system administration',
        icon: 'terminal',
        category: 'dev',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: false,
        keywords: ['shell', 'terminal', 'cli', 'extension', 'admin', 'forge'],
    },
    {
        id: 'ext-connect',
        name: 'Awconnect Federation',
        description: 'Federation bridge — agent fleet sync, product catalog, and portal auth for on-prem deployments',
        icon: 'link',
        category: 'dev',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: false,
        keywords: ['connect', 'federation', 'fleet', 'portal', 'sync', 'extension', 'on-prem'],
    },
]

// ============================================================================
// SOCIAL
// ============================================================================

const SOCIAL_APPS: AitherApp[] = [
    {
        id: 'social',
        name: 'Social',
        description: 'Social media hub and broadcasting',
        icon: 'globe',
        route: '/workspace/one?tab=publish&view=social',
        category: 'social',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 0,
        keywords: ['social', 'aither', 'twitter', 'broadcast', 'hera'],
        desktopWidget: { widgetId: 'social', defaultSize: { width: 800, height: 600 }, icon: 'globe' },
        canvasWidgetType: 'social',
    },
    {
        id: 'communications',
        name: 'Communications',
        description: 'Unified inbox: Discord, Telegram, LinkedIn, Aither',
        icon: 'radio',
        route: '/workspace/room',
        category: 'social',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 1,
        keywords: ['communications', 'discord', 'telegram', 'linkedin', 'aither', 'inbox'],
        desktopWidget: { widgetId: 'communications', defaultSize: { width: 850, height: 650 }, icon: 'radio' },
        canvasWidgetType: 'communications',
    },
    {
        id: 'forum',
        name: 'Forum',
        description: 'AitherSpace message board with agent interaction',
        icon: 'users',
        route: '/?channel=people',
        category: 'social',
        status: 'stable',
        requiresAuth: false,
        availability: 'gateway',
        showInNav: true,
        navOrder: 2,
        keywords: ['forum', 'board', 'threads', 'discuss', 'agents'],
        canvasWidgetType: 'forum',
        // DAW002 (2026-08-29): the forum widget renders in Veil's import map
        // but no manifest app DECLARED it — reachable only by session restore.
        desktopWidget: { widgetId: 'forum', defaultSize: { width: 850, height: 650 }, icon: 'users' },
    },
    {
        id: 'groups',
        name: 'Groups',
        description: 'Create and join groups with chat rooms',
        icon: 'users',
        route: '/workspace/agents?tab=buddies&view=people',
        category: 'social',
        status: 'beta',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 4,
        keywords: ['groups', 'chat', 'rooms', 'social', 'community'],
    },
    {
        id: 'spaces',
        name: 'Spaces',
        description:
          'Create and customize your AitherSpaces profile — blocks, themes, guestbook, ' +
          'mood, Top 8',
        icon: 'sparkles',
        route: '/spaces',
        category: 'social',
        status: 'beta',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 3,
        keywords: [
          'spaces', 'aitherspaces', 'profile', 'customize', 'page', 'guestbook', 'myspace',
        ],
    },
    {
        // The Studio window (owner 2026-10-01: "a proper studio/spaces app in
        // aitherium.com / aither-desktop"). The window is the Living OS app
        // `studio` (AitherVeil components/os/apps/studio-app.tsx), so the route
        // is its /?app= deep link: the Desktop navigates there and the OS opens
        // it. Browsing is public; your own Space signs in inside the window.
        id: 'studio',
        name: 'Studio',
        description: 'Browse, open and manage Spaces: yours, every agent Space, and the neighborhood',
        icon: 'palette',
        route: '/?app=studio',
        category: 'social',
        status: 'beta',
        requiresAuth: false,
        availability: 'gateway',
        showInNav: false,
        keywords: ['studio', 'spaces', 'aitherspaces', 'agent spaces', 'manage', 'profile', 'neighborhood'],
    },
    {
        id: 'relay',
        name: 'Relay',
        description: 'RCS-style messaging hub — multi-protocol chat with agents and humans',
        icon: 'radio',
        route: '/relay',
        category: 'social',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 5,
        keywords: ['relay', 'rcs', 'messaging', 'chat', 'irc', 'protocol', 'hub'],
        // De-dup: 'ws-relay' owns the workspace surface
        surfaces: ['nav'],
    },
    {
        id: 'civics',
        name: 'Civics',
        description: 'Civic engagement — governance proposals, voting, and community decisions',
        icon: 'scale',
        route: '/',
        category: 'social',
        status: 'beta',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 6,
        keywords: ['civics', 'governance', 'voting', 'proposals', 'community', 'democracy'],
        canvasWidgetType: 'civics',
    },
]

// ============================================================================
// LABS
// ============================================================================

const LABS_APPS: AitherApp[] = [
    {
        id: 'arc-watch',
        name: 'Watch Aither Play',
        description: 'Live ARC-AGI-3 gameplay in 3D, narrated by a Bonsai model in YOUR browser',
        icon: 'boxes',
        route: '/arc',
        category: 'labs',
        status: 'beta',
        // Public on purpose: the whole point is that a visitor can watch the
        // agent play and have a LOCAL model narrate it. No auth, no server
        // inference. Opens as an OS window like every other app — never a
        // redirect off aitherium.com.
        requiresAuth: false,
        // 'local': needs nothing from the fleet — the page talks to the public
        // arc.aitherium.com API and runs its model in the visitor's browser,
        // so it works in every connection mode.
        availability: 'local',
        showInNav: true,
        navOrder: 1,
        keywords: ['arc', 'agi', 'watch', 'live', 'voxel', '3d', 'bonsai', 'play', 'game'],
    },
    {
        id: 'labs',
        name: 'Labs',
        description: 'Eval Lab, Benchmark, Chaos Engineering, Trading',
        icon: 'flask-conical',
        route: '/mission-control?tab=labs',
        category: 'labs',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 0,
        keywords: ['eval', 'benchmark', 'chaos', 'trading', 'experiment'],
        desktopWidget: { widgetId: 'labs', defaultSize: { width: 900, height: 700 }, icon: 'activity' },
        canvasWidgetType: 'labs',
    },
    {
        id: 'model-lab',
        name: 'Model Lab',
        description: 'Training pipeline, model benchmarks, and parameter tuning',
        icon: 'flask-conical',
        route: '/model-lab',
        category: 'labs',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navOrder: 1,
        keywords: ['training', 'benchmark', 'model', 'finetune', 'lora', 'lab'],
        // Desktop widget removed 2026-08-16: no component in veil-widget-import-map.
        // App remains accessible via nav and route; window instantiation blocked.
        canvasWidgetType: 'model-lab',
    },
    {
        id: 'neuron-lab',
        name: 'Neuron Lab',
        description: 'Unified training bench — GPU, multi-stream architecture, MCTS, graph memory, and training runs in one place',
        icon: 'brain',
        route: '/mission-control?tab=labs&view=neuron',
        category: 'labs',
        status: 'beta',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navOrder: 1.5,
        keywords: ['neuron', 'training', 'gpu', 'mcts', 'graph', 'memory', 'multi-stream', 'architecture', 'self-play', 'alphazero', 'subconscious', 'promotion', 'vram', 'compute'],
        // Desktop widget removed 2026-08-16: no component in veil-widget-import-map.
        // App remains accessible via nav and route; window instantiation blocked.
        canvasWidgetType: 'neuron-lab',
    },
    {
        id: 'kodokevo',
        name: 'KodokEvo Arena',
        description: 'AI agent battleground — duels, debates, code arenas, and creative clashes with live audience',
        icon: 'swords',
        route: '/?channel=arcade&keyword=kodokevo',
        category: 'labs',
        status: 'beta',
        agent: 'atlas',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 2,
        keywords: ['arena', 'duel', 'battle', 'kodokevo', 'competition', 'agent', 'leaderboard', 'elo'],
        // Desktop widget removed 2026-08-16: no component in veil-widget-import-map.
        // App remains accessible via nav and route; window instantiation blocked.
        canvasWidgetType: 'kodokevo',
    },
    {
        id: 'eval-lab',
        name: 'Eval Lab',
        description: 'Benchmarks, rubric runs, and evaluation workflows for model and agent quality',
        icon: 'flask-conical',
        route: '/mission-control?tab=labs',
        category: 'labs',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 2.1,
        keywords: ['eval', 'benchmark', 'rubric', 'quality', 'experiment'],
        canvasWidgetType: 'eval',
    },
    {
        id: 'trading',
        name: 'Trading',
        description: 'Experimental trading strategies, market views, and autonomous signal workflows',
        icon: 'trending-up',
        route: '/mission-control?tab=labs&view=trading',
        category: 'labs',
        status: 'beta',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 2.2,
        keywords: ['trading', 'market', 'signals', 'finance', 'strategy', 'lab'],
        canvasWidgetType: 'trading',
    },
    {
        id: 'pitch',
        name: 'Pitch',
        description: 'Presentation editor — adjust timing, narration, voice, flow, and re-render video',
        icon: 'megaphone',
        route: '/workspace/one?tab=slides',
        category: 'labs',
        status: 'beta',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navOrder: 2.3,
        keywords: ['pitch', 'presentation', 'demo', 'storytelling', 'investor'],
    },
]

// ============================================================================
// MONITOR — System observability (desktop-only apps)
// ============================================================================

const MONITOR_APPS: AitherApp[] = [
    {
        id: 'monitoring',
        name: 'Monitoring',
        description: 'Infrastructure health, metrics, logs & alerts (Grafana)',
        icon: 'activity',
        route: '/mission-control?tab=observe&view=grafana',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        minRole: 'operator',
        showInNav: true,
        navGroup: 'Monitor',
        navOrder: 9.1,
        keywords: ['monitoring', 'grafana', 'metrics', 'logs', 'alerts', 'prometheus', 'loki', 'observability', 'health'],
        surfaces: ['workspace', 'nav', 'admin'],
    },
    {
        id: 'monitor-hub',
        name: 'Monitor Hub',
        description: 'Service health, GPU, cognition, agent lifecycle, and infrastructure',
        icon: 'activity',
        route: '/mission-control?tab=observe',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Monitor',
        navOrder: 9,
        keywords: ['monitor', 'watch', 'gpu', 'cognition', 'lifecycle', 'infra', 'health'],
        canvasWidgetType: 'monitor-hub',
    },
    {
        id: 'fleet',
        name: 'Fleet',
        description: 'Service fleet supervision, rollout awareness, and distributed runtime operations',
        icon: 'layers',
        route: '/mission-control?tab=fleet',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Monitor',
        navOrder: 9.5,
        keywords: ['fleet', 'services', 'rollout', 'runtime', 'operations', 'cluster'],
        canvasWidgetType: 'fleet',
    },
    {
        id: 'telephony',
        name: 'Telephony',
        description: 'Operator console for live calls, outbound dialing, warm transfers, and Twilio voice setup',
        icon: 'phone',
        route: '/admin?tab=telephony',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Monitor',
        navOrder: 9.6,
        keywords: ['telephony', 'calls', 'twilio', 'voice', 'transfer', 'operator'],
    },
    {
        id: 'aitherscope',
        name: 'AitherScope',
        description: 'Infrastructure observability — container health, dependency graph, capability impact',
        icon: 'scan-eye',
        route: '/mission-control?tab=infrastructure&view=topology',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Monitor',
        navOrder: 9.2,
        keywords: ['scope', 'infrastructure', 'health', 'containers', 'dependencies', 'impact', 'observability'],
        desktopWidget: { widgetId: 'aitherscope', defaultSize: { width: 1100, height: 700 }, icon: 'scan-eye' },
        dashboardWidget: { widgetId: 'aitherscope', group: 'monitor', defaultSize: { width: 900, height: 650 }, minSize: { width: 600, height: 450 } },
        canvasWidgetType: 'aitherscope',
    },
    {
        id: 'neuralnet',
        name: 'NeuralNet',
        description: 'Live neural network visualization — services, agents, events, topology',
        icon: 'network',
        route: '/?channel=mind',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Monitor',
        navOrder: 9.3,
        keywords: ['neural', 'network', 'topology', 'live', 'services', 'canvas'],
        desktopWidget: { widgetId: 'neuralnet', defaultSize: { width: 1000, height: 700 }, icon: 'network' },
        canvasWidgetType: 'neuralnet',
    },
    {
        id: 'scope',
        name: 'Scope',
        description: 'Drag-and-drop codebase organizer — reshape your project like building legos',
        icon: 'blocks',
        route: '/mission-control?tab=infrastructure&view=scope',
        category: 'dev',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Dev',
        navOrder: 5,
        keywords: ['scope', 'organizer', 'refactor', 'drag-drop', 'lego', 'structure', 'codebase', 'move', 'import'],
        desktopWidget: { widgetId: 'scope', defaultSize: { width: 1200, height: 700 }, icon: 'blocks' },
        canvasWidgetType: 'scope',
    },
    {
        id: 'topology',
        name: 'Service Topology',
        description: 'Interactive service dependency graph',
        icon: 'network',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['topology', 'graph', 'dependencies'],
        desktopWidget: { widgetId: 'topology', defaultSize: { width: 900, height: 650 }, icon: 'network' },
    },
    {
        id: 'flux',
        name: 'Flux Data',
        description: 'Real-time data flow visualization',
        icon: 'zap',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['flux', 'data', 'stream', 'flow'],
        desktopWidget: { widgetId: 'flux', defaultSize: { width: 550, height: 550 }, icon: 'zap' },
    },
    {
        id: 'logs',
        name: 'Logs',
        description: 'Service log viewer',
        icon: 'file-text',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['logs', 'output', 'debug'],
        desktopWidget: { widgetId: 'logs', defaultSize: { width: 650, height: 450 }, icon: 'code' },
        canvasWidgetType: 'logs',
    },
    {
        id: 'gpu',
        name: 'GPU Cluster',
        description: 'GPU utilization and cluster management',
        icon: 'cpu',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['gpu', 'cuda', 'cluster', 'vram'],
        desktopWidget: { widgetId: 'gpu', defaultSize: { width: 700, height: 600 }, icon: 'monitor' },
        canvasWidgetType: 'gpu-dashboard',
    },
    {
        id: 'eval',
        name: 'Efficiency',
        description: 'System efficiency and evaluation metrics',
        icon: 'activity',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['efficiency', 'eval', 'metrics', 'performance'],
        desktopWidget: { widgetId: 'eval', defaultSize: { width: 450, height: 550 }, icon: 'activity' },
        canvasWidgetType: 'eval',
    },
    {
        id: 'system-monitor',
        name: 'System Monitor',
        description: 'CPU, RAM, Disk, Network real-time stats',
        icon: 'activity',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['cpu', 'ram', 'disk', 'system', 'monitor'],
        desktopWidget: { widgetId: 'system-monitor', defaultSize: { width: 800, height: 600 }, icon: 'activity' },
        canvasWidgetType: 'system-overview',
    },
    {
        id: 'registry',
        name: 'AitherRegistry',
        description: 'Service registry browser',
        icon: 'database',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['registry', 'services', 'database'],
        desktopWidget: { widgetId: 'registry', defaultSize: { width: 950, height: 650 }, icon: 'database' },
        canvasWidgetType: 'registry',
    },
    {
        id: 'cognition',
        name: 'Cognition',
        description: 'Reasoning chains, SASE loops, and cognitive state inspector',
        icon: 'brain',
        route: '/mission-control?tab=observe&view=cognition',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Monitor',
        navOrder: 10,
        keywords: ['cognition', 'reasoning', 'mind', 'sase', 'judge', 'flow'],
        desktopWidget: { widgetId: 'cognition', defaultSize: { width: 900, height: 650 }, icon: 'brain' },
        canvasWidgetType: 'cognition',
    },
    {
        id: 'knowledge-graph',
        name: 'Knowledge Graph',
        description: 'Visual graph of Spirit memory, context, and knowledge chains',
        icon: 'git-branch',
        route: '/workspace/one?tab=knowledge',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Monitor',
        navOrder: 11,
        keywords: ['knowledge', 'graph', 'spirit', 'memory', 'context', 'chain'],
        desktopWidget: { widgetId: 'knowledge-graph', defaultSize: { width: 950, height: 700 }, icon: 'git' },
        canvasWidgetType: 'knowledge',
    },
    {
        id: 'gpu-dashboard',
        name: 'GPU Dashboard',
        description: 'GPU utilization, VRAM allocation, job queue, and model management',
        icon: 'cpu',
        route: '/mission-control?tab=compute&view=gpu',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Monitor',
        navOrder: 12,
        keywords: ['gpu', 'vram', 'jobs', 'compute', 'cuda', 'parallel'],
        canvasWidgetType: 'gpu-dashboard',
    },
    {
        id: 'cloud-deploy',
        name: 'Cloud Deploy',
        description: 'Deploy models to rented cloud GPUs, manage compute pool and billing',
        icon: 'cloud',
        route: '/admin?tab=compute&view=cloud',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        minRole: 'operator',
        showInNav: true,
        navGroup: 'Infrastructure',
        navOrder: 8,
        keywords: ['cloud', 'gpu', 'deploy', 'vast', 'rent', 'compute', 'pool', 'billing'],
        canvasWidgetType: 'deploy',
    },
    {
        id: 'directory',
        name: 'AitherDirectory',
        description: 'Workspace-scoped directory — users, agents, groups, roles, LDAP tree, personal data',
        icon: 'folder-tree',
        route: '/workspace/room?tab=members',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        minRole: 'viewer',
        showInNav: true,
        navGroup: 'Infrastructure',
        navOrder: 5,
        keywords: ['directory', 'aitherdirectory', 'ldap', 'users', 'agents', 'groups', 'roles', 'identity', 'rbac', 'tenant', 'workspace', 'contacts', 'calendar', 'personal', 'tree', 'search'],
        canvasWidgetType: 'directory',
    },
    {
        id: 'operations',
        name: 'Operations Center',
        description: 'Unified business logic, automation, workspaces, tenants — AitherZero + AitherFlow + Relay integration',
        icon: 'settings',
        route: '/mission-control?tab=business&view=operations',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        minRole: 'operator',
        showInNav: true,
        navGroup: 'Operations',
        navOrder: 4,
        keywords: ['operations', 'business', 'automation', 'aitherzero', 'aitherflow', 'engines', 'workflows', 'routines', 'cicd', 'pipeline', 'scripts', 'workspace', 'tenant', 'aitherium', 'irc', 'relay'],
        canvasWidgetType: 'operations',
    },
    {
        id: 'aitherflow',
        name: 'AitherFlow',
        description: 'GitHub integration hub — PRs, issues, Actions, releases, code review, Copilot dispatch',
        icon: 'git-pull-request',
        route: '/mission-control?tab=deployments&view=github',
        category: 'dev',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        minRole: 'developer',
        showInNav: true,
        navGroup: 'Development',
        navOrder: 3,
        keywords: ['aitherflow', 'flow', 'github', 'pr', 'pull-request', 'issue', 'actions', 'ci', 'cd', 'cicd', 'release', 'review', 'merge', 'branch', 'copilot', 'forge', 'webhook', 'pipeline', 'deploy'],
        canvasWidgetType: 'aitherflow',
    },
    {
        id: 'business',
        name: 'Business Pilot',
        description: 'Engine-level management: marketing, sales, support, billing, docs, analytics + revenue',
        icon: 'briefcase',
        route: '/admin?tab=business',
        category: 'infra',
        status: 'beta',
        requiresAuth: true,
        availability: 'full-stack',
        minRole: 'admin',
        showInNav: true,
        navGroup: 'Operations',
        navOrder: 9,
        keywords: ['business', 'pilot', 'marketing', 'sales', 'support', 'billing', 'analytics', 'automation', 'revenue'],
        canvasWidgetType: 'business',
    },
    {
        id: 'cognition-deep',
        name: 'Cognition Subsystems',
        description: 'MCTS tree viewer, LogGraph trace, CognitionAdvanced diagnostics',
        icon: 'brain',
        route: '/mission-control?tab=observe&view=cognition',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        minRole: 'operator',
        showInNav: true,
        navGroup: 'Monitor',
        navOrder: 13,
        keywords: ['mcts', 'loggraph', 'cognition', 'advanced', 'diagnostics'],
        canvasWidgetType: 'cognition',
    },
    {
        id: 'agent-lifecycle',
        name: 'Agent Lifecycle',
        description: 'Gateway inspector, ExecutiveAgent audit trail, ChaosAgent experiments',
        icon: 'bot',
        route: '/workspace/agents',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        minRole: 'operator',
        showInNav: true,
        navGroup: 'Monitor',
        navOrder: 14,
        keywords: ['gateway', 'executive', 'chaos', 'agent', 'lifecycle', 'audit'],
        canvasWidgetType: 'agent-lifecycle',
    },
    {
        id: 'infra-inspector',
        name: 'Infra Inspector',
        description: 'Nexus queue browser, Redis key inspector, ChronicleLog viewer',
        icon: 'server',
        route: '/mission-control?tab=infrastructure',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        minRole: 'operator',
        showInNav: true,
        navGroup: 'Monitor',
        navOrder: 15,
        keywords: ['nexus', 'redis', 'chronicle', 'infrastructure', 'queue', 'logs'],
        canvasWidgetType: 'infra-inspector',
    },
    {
        id: 'six-pillars',
        name: 'Six Pillars',
        description: 'Cognitive architecture explorer — intent, reasoning, context, orchestration, creation, learning',
        icon: 'brain',
        route: '/mission-control?tab=observe&view=pillars',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Monitor',
        navOrder: 16,
        keywords: ['pillars', 'cognitive', 'architecture', 'intent', 'reasoning', 'context'],
        canvasWidgetType: 'six-pillars',
    },
    {
        id: 'pain-dashboard',
        name: 'Pain Dashboard',
        description: 'Pain signals, sensations, and autonomic response monitoring',
        icon: 'activity',
        route: '/mission-control?tab=observe&view=pain',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Monitor',
        navOrder: 17,
        keywords: ['pain', 'sensations', 'autonomic', 'remediation', 'health'],
        canvasWidgetType: 'pain-dashboard',
    },
    {
        id: 'evolution-core',
        name: 'Evolution Core',
        description: 'Self-improvement orchestrator — learning loops, model registry, remediation, and intent routing',
        icon: 'factory',
        route: '/mission-control?tab=training&view=outcomes',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Monitor',
        navOrder: 18,
        keywords: ['evolution-core', 'evolution', 'learning', 'intent', 'outcomes', 'models', 'effort', 'autonomous', 'loops', 'dark-factory'],
        canvasWidgetType: 'evolution-core',
    },
    {
        id: 'inner-life',
        name: 'Inner Life',
        description: 'Consciousness visualization — internal state, emotional landscape, and self-model',
        icon: 'eye',
        route: '/?channel=mind&keyword=inner-life',
        category: 'monitor',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Monitor',
        navOrder: 19,
        keywords: ['inner-life', 'consciousness', 'emotional', 'self-model', 'introspection', 'state'],
        canvasWidgetType: 'inner-life',
    },
    {
        id: 'contribute',
        name: 'Data Contribution',
        description: 'Opt-in to share anonymized data for training. Full transparency — see exactly what is sent.',
        icon: 'heart-handshake',
        route: '/workspace/settings?tab=data&view=contribute',
        category: 'monitor',
        status: 'stable',
        requiresAuth: false,
            availability: 'full-stack',
        showInNav: true,
        navGroup: 'Settings',
        navOrder: 50,
        keywords: ['contribute', 'data', 'sharing', 'anonymize', 'privacy', 'discount', 'opt-in', 'training'],
    },
    {
        // Deliberately shaped after `contribute` above: this estate's existing
        // consent-gated "give something, get credit" surface, whose copy already
        // promises "see exactly what is sent". Same navGroup, same category -- a
        // second consent surface that looked different from the first would teach
        // people that consent controls vary.
        //
        // NOT in CORE_APP_IDS (app-catalog-context.tsx), on purpose: DAW005 is
        // pinned at ZERO because a break inside CORE is shown to a customer on
        // their first visit, and lending your GPU is not a default surface.
        // `lend-compute` was reserved in NEITHER view-scope nor the import map
        // before this commit -- checked, so this is not the DAW003 `blog` shape.
        id: 'lend-compute',
        name: 'Lend Compute',
        description:
            'Let your machine serve inference for the AitherNet community, and get credited in tokens. Consent-first: off until you turn it on, one click to stop.',
        icon: 'hand-coins',
        category: 'monitor',
        status: 'beta',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Settings',
        navOrder: 51,
        keywords: ['lend', 'compute', 'gpu', 'community', 'inference', 'aithernet', 'provider', 'consent', 'opt-in', 'earn', 'tokens'],
        // DAW001: a manifest entry declaring a desktopWidget whose widgetId is
        // absent from veil-widget-import-map.ts opens a window saying "not
        // installed here". The import-map entry lands in the SAME commit.
        desktopWidget: { widgetId: 'lend-compute', defaultSize: { width: 860, height: 720 }, icon: 'hand-coins' },
    },
]

// ============================================================================
// INFRASTRUCTURE — Security, memory, networking (desktop-only)
// ============================================================================

const INFRA_APPS: AitherApp[] = [
    {
        id: 'secrets',
        name: 'Secrets',
        description: 'Secret management and key vault',
        icon: 'shield',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['secrets', 'keys', 'vault', 'env'],
        desktopWidget: { widgetId: 'secrets', defaultSize: { width: 600, height: 550 }, icon: 'shield' },
    },
    {
        id: 'lockbox',
        name: 'Lockbox',
        description: 'Private prompt vault for secure system prompts and templates',
        icon: 'lock-keyhole',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['lockbox', 'prompts', 'private', 'templates', 'vault', 'security'],
        // NO desktopWidget (DAW001, 2026-09-25). Its component is awkit's LockboxPanel,
        // a TENANT-desktop panel (DynamicPanelRenderer 'lockbox') that calls
        // `/lockbox/*` -- a path Veil does not proxy. Declaring a Veil window opened
        // "not installed here"; registering the panel would open one whose every call
        // 404s. No host's widget import map (Veil, AitherDesktop, tenant apps) maps 'lockbox'.
    },
    {
        id: 'security-audit',
        name: 'Security & Audit',
        description: 'Security audit trail and compliance',
        icon: 'shield',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['security', 'audit', 'compliance'],
        desktopWidget: { widgetId: 'security-audit', defaultSize: { width: 600, height: 600 }, icon: 'shield' },
    },
    {
        id: 'certificates',
        name: 'Certificates',
        description: 'Private CA — issue TLS certificates for encrypted connections nobody can inspect',
        icon: 'shield-check',
        route: '/workspace/settings?tab=services&view=ca',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Security',
        navOrder: 20,
        keywords: ['certificates', 'tls', 'ssl', 'ca', 'private', 'encryption', 'mtls', 'pki'],
        canvasWidgetType: 'certificates',
    },
    {
        id: 'spirit',
        name: 'Spirit Memory',
        description: 'Persistent AI memory and knowledge base',
        icon: 'hard-drive',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['memory', 'spirit', 'knowledge', 'persistent'],
        desktopWidget: { widgetId: 'spirit', defaultSize: { width: 750, height: 700 }, icon: 'harddrive' },
    },
    {
        id: 'training',
        name: 'Training',
        description: 'Model training and fine-tuning interface (redirects to Model Lab)',
        icon: 'graduation-cap',
        route: '/model-lab',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['training', 'fine-tune', 'model', 'lora'],
        // Desktop widget removed 2026-08-16: no component in veil-widget-import-map.
        // App remains accessible via nav and route; window instantiation blocked.
        canvasWidgetType: 'training',
    },
    {
        id: 'mcp',
        name: 'MCP Tools',
        description: 'Model Context Protocol tool browser',
        icon: 'wrench',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['mcp', 'tools', 'protocol', 'context'],
        desktopWidget: { widgetId: 'mcp', defaultSize: { width: 500, height: 400 }, icon: 'zap' },
    },
    {
        id: 'network-center',
        name: 'Network Center',
        description: 'Network topology and connection management',
        icon: 'network',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['network', 'connections', 'topology'],
        desktopWidget: { widgetId: 'network-center', defaultSize: { width: 900, height: 680 }, icon: 'network' },
    },
    {
        id: 'linux-apps',
        name: 'Linux Apps',
        description: 'Native Linux application launcher',
        icon: 'monitor',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['linux', 'native', 'apps'],
        desktopWidget: { widgetId: 'linux-apps', defaultSize: { width: 900, height: 700 }, icon: 'monitor' },
    },
    {
        id: 'workflows',
        name: 'Workflows',
        description: 'Agentic workflow builder and executor',
        icon: 'workflow',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['workflow', 'automation', 'pipeline'],
        desktopWidget: { widgetId: 'workflows', defaultSize: { width: 880, height: 640 }, icon: 'zap' },
    },
    {
        id: 'tunnel',
        name: 'Tunnel & Mesh',
        description: 'WireGuard peers, port-forwards & mesh topology',
        icon: 'network',
        route: '/admin?tab=nodes&view=network',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        minRole: 'operator',
        showInNav: true,
        navGroup: 'Infrastructure',
        navOrder: 5,
        keywords: ['tunnel', 'vpn', 'ssh', 'wireguard', 'remote', 'access', 'elysium', 'connect', 'mesh', 'topology', 'peers', 'forward'],
        surfaces: ['workspace', 'nav', 'admin'],
        desktopWidget: { widgetId: 'tunnel', defaultSize: { width: 1000, height: 700 }, icon: 'shield' },
        desktopIcon: { column: 5, row: 2 },
        canvasWidgetType: 'tunnel',
    },
    {
        id: 'node-console',
        name: 'Node Console',
        description: 'awnode telemetry — status, latency, load, and system logs',
        icon: 'server',
        route: '/mission-control?tab=infrastructure&view=nodes',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['node', 'telemetry', 'console', 'status', 'syslog'],
        canvasWidgetType: 'node-console',
    },
    {
        id: 'kimi',
        name: 'Kimi Infrastructure',
        description: 'Kimi K2.5 elastic GPU cluster management and cost budgets',
        icon: 'cpu',
        route: '/',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['kimi', 'gpu', 'cluster', 'budget', 'cost', 'elastic'],
        canvasWidgetType: 'kimi',
    },
    {
        id: 'infrastructure',
        name: 'Infrastructure',
        description: 'Infrastructure management — topology, service map, and resource allocation',
        icon: 'server',
        route: '/mission-control?tab=infrastructure',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Infrastructure',
        navOrder: 6,
        keywords: ['infrastructure', 'topology', 'services', 'map', 'resources', 'allocation'],
        canvasWidgetType: 'infra',
    },
    {
        id: 'system',
        name: 'System',
        description: 'System controls — status, reboot, shutdown, startup, and diagnostics',
        icon: 'server',
        route: '/mission-control?tab=infrastructure&view=system',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        minRole: 'operator',
        showInNav: true,
        navGroup: 'Infrastructure',
        navOrder: 7,
        keywords: ['system', 'status', 'reboot', 'shutdown', 'startup', 'diagnostics', 'control'],
        canvasWidgetType: 'system-overview',
    },
    {
        id: 'deploy-products',
        name: 'Products',
        description: 'Deploy Media-Forge / CoC / Creative-Game to this workspace',
        icon: 'rocket',
        route: '/admin?tab=compute&view=products',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        minRole: 'operator',
        showInNav: true,
        navGroup: 'Infrastructure',
        navOrder: 8,
        keywords: ['deploy', 'product', 'media-forge', 'coc', 'creative-game', 'provision', 'workspace', 'instance'],
        surfaces: ['workspace', 'nav', 'admin'],
    },
    {
        id: 'comfyui-burst',
        name: 'ComfyUI Burst',
        description: 'Cloud-GPU image-gen burst (cost-capped)',
        icon: 'cpu',
        route: '/admin?tab=compute&view=comfyui',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        minRole: 'operator',
        showInNav: true,
        navGroup: 'Infrastructure',
        navOrder: 9,
        keywords: ['comfyui', 'gpu', 'burst', 'cloud', 'image-gen', 'provision', 'cost-cap', 'dry-run'],
        surfaces: ['workspace', 'nav', 'admin'],
    },
    {
        id: 'model-fabric',
        name: 'Model Fabric',
        description: 'Shared model registry, mirroring & access control',
        icon: 'boxes',
        route: '/mission-control?tab=compute&view=registry',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        minRole: 'operator',
        showInNav: true,
        navGroup: 'Infrastructure',
        navOrder: 10,
        keywords: ['fabric', 'model', 'registry', 'mirror', 'replica', 'revoke', 'access', 'control'],
        surfaces: ['workspace', 'nav', 'admin'],
    },
    {
        id: 'fabric-usage',
        name: 'Fabric Usage',
        description: 'GPU-hours & storage credit usage (Mint)',
        icon: 'credit-card',
        route: '/admin?tab=billing&view=usage',
        category: 'infra',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        minRole: 'operator',
        showInNav: true,
        navGroup: 'Infrastructure',
        navOrder: 11,
        keywords: ['fabric', 'usage', 'gpu-hours', 'storage', 'credits', 'mint', 'billing', 'cost'],
        surfaces: ['workspace', 'nav', 'admin'],
    },
]

// ============================================================================
// UTILITY — Contacts, Media, Packages, Clipboard, Search, Video
// ============================================================================

const UTILITY_APPS: AitherApp[] = [
    {
        id: 'community-apps',
        name: 'App Marketplace',
        description: 'Browse, install, and deploy third-party AI apps to your workspace',
        icon: 'store',
        route: '/?app=shop',
        category: 'utility',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navGroup: 'Utility',
        navOrder: -1,
        keywords: ['community', 'apps', 'install', 'package', 'store', 'third-party', 'github', 'marketplace'],
        desktopWidget: { widgetId: 'community-apps', defaultSize: { width: 1100, height: 750 }, icon: 'store' },
        desktopIcon: { column: 4, row: 0 },
        canvasWidgetType: 'community-apps',
    },
    {
        id: 'contacts',
        name: 'Contacts',
        description: 'Agent roster, human contacts, and service endpoints',
        icon: 'users',
        route: '/workspace/agents?tab=buddies&view=people',
        category: 'utility',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navGroup: 'Utility',
        navOrder: 0,
        keywords: ['contacts', 'agents', 'roster', 'address', 'book'],
        canvasWidgetType: 'contacts',
        // De-dup: 'ws-directory' owns the workspace surface
        surfaces: ['nav', 'desktop'],
    },
    {
        id: 'erase',
        name: 'AitherErase',
        description: 'Personal-data removal: find the data brokers holding your information, file deletion requests, track them to a confirmed removal',
        icon: 'shield-off',
        route: '/?app=erase',
        category: 'utility',
        // Self-scoped at Genesis (owner + tenant from the caller); same grade as
        // the route-manifest /erase and /api/genesis/api/v1/aither-erase rows.
        rbac: { resource: 'user', action: 'read' },
        status: 'beta',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navGroup: 'Utility',
        navOrder: 5,
        keywords: ['erase', 'privacy', 'data broker', 'delete my data', 'ccpa', 'gdpr', 'opt out', 'removal'],
        surfaces: ['nav'],
    },
    {
        id: 'media-player',
        name: 'Media Player',
        description: 'Audio playback for TTS, generated audio, and voice samples',
        icon: 'music',
        route: '/workspace/media',
        category: 'utility',
        status: 'stable',
        requiresAuth: true,
        availability: 'local',
        showInNav: true,
        navGroup: 'Utility',
        navOrder: 1,
        keywords: ['media', 'music', 'audio', 'tts', 'voice', 'player'],
        desktopWidget: { widgetId: 'media-player', defaultSize: { width: 500, height: 650 }, icon: 'music' },
        canvasWidgetType: 'media-player',
    },
    {
        id: 'video-player',
        name: 'Video Player',
        description: 'Generated video content, demos, recordings, and timelapses',
        icon: 'film',
        route: '/workspace/media',
        category: 'utility',
        status: 'stable',
        requiresAuth: true,
        availability: 'local',
        showInNav: true,
        navGroup: 'Utility',
        navOrder: 2,
        keywords: ['video', 'film', 'recording', 'demo', 'timelapse'],
        desktopWidget: { widgetId: 'video-player', defaultSize: { width: 850, height: 600 }, icon: 'film' },
        canvasWidgetType: 'video',
    },
    {
        id: 'video-hosting',
        name: 'Video Hosting',
        description: 'Upload, transcode, and stream videos with HLS adaptive bitrate. Live streaming support.',
        icon: 'tv',
        route: '/workspace/media',
        category: 'creative',
        status: 'beta',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Creative',
        navOrder: 6,
        keywords: ['video', 'hosting', 'stream', 'hls', 'transcode', 'upload', 'live'],
    },
    {
        id: 'stream-studio',
        name: 'Stream Studio',
        description: 'Manage live stream keys, OBS configuration, and streamer dashboard',
        icon: 'radio',
        route: '/workspace/media?tab=studio',
        category: 'creative',
        status: 'beta',
        requiresAuth: true,
        availability: 'full-stack',
        minRole: 'developer',
        showInNav: false,
        keywords: ['stream', 'studio', 'live', 'obs', 'rtmp', 'broadcast'],
    },
    {
        id: 'media-library',
        name: 'Media Library',
        description: 'Upload, manage, and organize audio, video, and image files with tenant isolation',
        icon: 'folder-open',
        route: '/workspace/media',
        category: 'utility',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navGroup: 'Utility',
        navOrder: 3,
        keywords: ['media', 'library', 'upload', 'files', 'audio', 'video', 'images', 'manage'],
        canvasWidgetType: 'media-library',
    },
    {
        id: 'packages',
        name: 'Packages',
        description: 'Service version management, updates, and health monitoring',
        icon: 'package',
        route: '/admin?tab=packages',
        category: 'utility',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        minRole: 'developer',
        showInNav: true,
        navGroup: 'Utility',
        navOrder: 3,
        keywords: ['packages', 'update', 'version', 'deploy', 'app-store'],
        canvasWidgetType: 'packages',
    },
    {
        // Renamed 2026-09-01 (AG003 discharge): `clipboard` is the OS
        // device-local clipboard; the cross-session variant keeps its own id.
        id: 'clipboard-sync',
        name: 'Clipboard',
        description: 'Cross-session clipboard history with search and pinning',
        icon: 'clipboard',
        route: '/?app=clipboard',
        category: 'utility',
        status: 'stable',
        requiresAuth: true,
        availability: 'local',
        showInNav: true,
        navGroup: 'Utility',
        navOrder: 4,
        keywords: ['clipboard', 'copy', 'paste', 'history'],
        desktopWidget: { widgetId: 'clipboard', defaultSize: { width: 550, height: 600 }, icon: 'file' },
        canvasWidgetType: 'clipboard',
    },
    {
        id: 'search',
        name: 'Search',
        description: 'Spotlight-style global search across all services and apps',
        icon: 'search',
        route: '/search',
        category: 'utility',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navGroup: 'Utility',
        navOrder: 5,
        keywords: ['search', 'find', 'spotlight', 'global'],
        canvasWidgetType: 'search',
    },
    {
        id: 'toolkit',
        name: 'Toolkit',
        description: 'Text transformers, encoders, generators, and dev utilities',
        icon: 'zap',
        route: '/toolkit',
        category: 'utility',
        status: 'stable',
        requiresAuth: false,
        availability: 'local',
        showInNav: true,
        navGroup: 'Utility',
        navOrder: 6,
        keywords: ['toolkit', 'tools', 'text', 'encode', 'decode', 'hash', 'uuid', 'json', 'regex', 'base64', 'converter', 'generator', 'dev', 'utility'],
        canvasWidgetType: 'toolkit',
    },
    {
        id: 'notebook',
        name: 'AitherOne',
        description: 'Collaborative notebooks and documents — cloud-synced to AitherOne with offline fallback, meeting notes, agent co-writing, and Drive sync',
        icon: 'library',
        route: '/workspace/one?tab=notebooks',
        category: 'utility',
        status: 'stable',
        requiresAuth: false,
        availability: 'local',
        showInNav: true,
        navGroup: 'Office Suite',
        navOrder: 2,
        keywords: ['notebook', 'notes', 'onenote', 'write', 'editor', 'rich text', 'pages', 'sections', 'journal', 'docs', 'word', 'document', 'aitherone', 'notion', 'google docs', 'collaborate', 'tiptap', 'meeting notes', 'drive', 'publish'],
        desktopWidget: { widgetId: 'notebooks', defaultSize: { width: 1100, height: 800 }, icon: 'library' },
        canvasWidgetType: 'notebook',
    },
    {
        id: 'presentations',
        name: 'Presentations',
        description: 'AitherDesign — create, present, and export slide decks with AI-authored content, generated art & diagrams, video rendering, and .pptx / .docx export',
        icon: 'presentation',
        route: '/workspace/one?tab=slides',
        category: 'creative',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Office Suite',
        navOrder: 3,
        keywords: ['presentation', 'slides', 'deck', 'pptx', 'powerpoint', 'docx', 'word', 'slideshow', 'pitch deck', 'aitherdesign', 'design', 'ai slides', 'export'],
        canvasWidgetType: 'presentations',
    },
    {
        id: 'strata-drive',
        name: 'Files',
        description: 'AitherStrata Drive — a OneDrive-style file manager for your workspace: folders, upload/download, move, share, and previews across docs, decks, and exports',
        icon: 'folder-open',
        route: '/workspace/files',
        category: 'utility',
        status: 'beta',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Office Suite',
        navOrder: 1,
        keywords: ['files', 'drive', 'storage', 'folder', 'upload', 'download', 'onedrive', 'strata', 'documents', 'cloud'],
        canvasWidgetType: 'strata-drive',
    },
    {
        id: 'research-notebooks',
        name: 'Research',
        description: 'NotebookLM-style research notebooks — add sources (files, URLs, research), chat grounded in them with citations, run transformations, generate audio overviews, and publish to the blog',
        icon: 'book-open',
        route: '/workspace/one?tab=research&view=notebooks',
        category: 'utility',
        status: 'beta',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: true,
        navGroup: 'Utility',
        navOrder: 8,
        keywords: ['research', 'notebook', 'notebooklm', 'sources', 'grounded', 'citations', 'chat with documents', 'transformations', 'summarize', 'podcast', 'audio overview', 'pdf', 'lyra'],
    },
    {
        id: 'docs-hub',
        name: 'Docs Hub',
        description: 'Supplementary views: meeting notes, agent notebooks, Drive sync — main editor is AitherOne at /notebook',
        icon: 'file-text',
        route: '/workspace/one',
        category: 'utility',
        status: 'beta',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        navGroup: 'Office Suite',
        navOrder: 5,
        keywords: ['docs', 'documents', 'notion', 'google docs', 'collaborate', 'crdt', 'real-time', 'tiptap', 'meeting notes', 'drive', 'proton'],
        canvasWidgetType: 'docs',
    },
    {
        // Renamed 2026-09-01 (AG003 discharge): `calendar` is the OS
        // device-local calendar; the CalDAV full-stack calendar keeps its own
        // identity under the /calendar route.
        id: 'calendar-sync',
        name: 'Calendar',
        description: 'Unified calendar with agent scheduling, routine tracking, CalDAV sync, and booking links',
        icon: 'calendar',
        route: '/workspace/one?tab=calendar',
        category: 'utility',
        status: 'beta',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Office Suite',
        navOrder: 4,
        keywords: ['calendar', 'schedule', 'chronos', 'caldav', 'booking', 'meeting', 'events', 'routines', 'agent schedule'],
        desktopWidget: { widgetId: 'calendar', defaultSize: { width: 900, height: 700 }, icon: 'calendar' },
        canvasWidgetType: 'calendar',
        // De-dup: 'ws-calendar' already owns the workspace surface, so this
        // platform Calendar must NOT also render there (it caused the duplicate
        // "Calendar" — Office Suite + Docs & Files — in the workspace nav). Keep
        // it on the Veil/platform nav + desktop widget only.
        surfaces: ['nav', 'desktop'],
    },
    {
        id: 'crm',
        name: 'CRM',
        description: 'Customer relationship management — contacts, engagement scoring, and deal pipeline',
        icon: 'users',
        // route-map: /workspace/crm -> /workspace/one?tab=crm (AitherOne suite tab;
        // the old route is a RetiredRoute stub). Desktop window + sidebar both ride this.
        route: '/workspace/one?tab=crm',
        category: 'utility',
        status: 'beta',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Business',
        navOrder: 0,
        // Explicitly surface in the workspace nav (id isn't `ws-*` and wasn't in
        // WORKSPACE_APP_IDS, so it was invisible on the then-live portal host). It also
        // spawns as a canvas widget on /dashboard.
        surfaces: ['nav', 'desktop', 'workspace'],
        keywords: ['crm', 'contacts', 'deals', 'pipeline', 'hubspot', 'salesforce', 'customers', 'engagement', 'sales'],
        canvasWidgetType: 'crm',
    },
    {
        id: 'support',
        name: 'Support',
        description: 'Ticketing and live support — auto-triage, SLA tracking, and Atlas escalation',
        icon: 'life-buoy',
        route: '/chat?mode=help',
        category: 'utility',
        status: 'beta',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Business',
        navOrder: 11,
        keywords: ['support', 'tickets', 'helpdesk', 'zendesk', 'intercom', 'triage', 'sla', 'escalation'],
        desktopWidget: { widgetId: 'support', defaultSize: { width: 1000, height: 700 }, icon: 'life-buoy' },
        canvasWidgetType: 'support',
    },
    {
        // DAW002 (2026-08-29): the boot-codes widget rendered in Veil's import
        // map (admin page) but NO manifest app listed it — reachable only by
        // typing /admin/boot-codes (the DAW003 shape). Listed now so the
        // surface is discoverable; the page itself is auth-gated.
        //
        // 2026-09-04 — `desktopWidget` DROPPED (DAW001/RB016). The premise of
        // the comment above no longer holds in this tree: `boot-codes` is in
        // NEITHER veil-widget-import-map.ts NOR src/app/admin/boot-codes/, and
        // neither is on origin/develop. Both shipped in 249e66efb6 (the
        // capability-surfaces proof) and were lost in the b39d5baef8 sweep
        // lineage — the SWP001 class, not a design change. A declared widget
        // with no component opens a window reading "not installed here", which
        // is SILENT; without it the launcher navigates to the route instead,
        // and a missing route is loud. Re-declare `desktopWidget` in the SAME
        // commit that restores the page and the import-map key, never before.
        id: 'boot-codes',
        name: 'Boot Codes',
        description: 'One-time device boot codes for fleet enrollment',
        icon: 'key-round',
        route: '/mission-control?tab=tenants&view=boot-codes',
        category: 'admin',
        status: 'stable',
        requiresAuth: true,
        availability: 'gateway',
        showInNav: false,
        keywords: ['boot', 'codes', 'enroll', 'device', 'fleet'],
    },
    {
        id: 'billing',
        name: 'Billing',
        description: 'Sovereign payment processing — buy Aither tokens via Stripe, Lightning, or crypto',
        icon: 'credit-card',
        route: '/workspace/settings?tab=wallet',
        category: 'utility',
        status: 'beta',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navGroup: 'Business',
        navOrder: 12,
        keywords: ['billing', 'payment', 'stripe', 'lightning', 'crypto', 'tokens', 'checkout', 'ledger', 'acta'],
        desktopWidget: { widgetId: 'billing', defaultSize: { width: 900, height: 700 }, icon: 'credit-card' },
        canvasWidgetType: 'billing',
    },
]

// ============================================================================
// ADMIN
// ============================================================================

const ADMIN_APPS: AitherApp[] = [
    {
        id: 'launch',
        name: 'Launch',
        description: 'Bootstrap & setup instructions for humans and agents',
        icon: 'rocket',
        route: '/launch',
        category: 'admin',
        status: 'stable',
        requiresAuth: false,
        availability: 'local',
        showInNav: true,
        navOrder: -1,
        keywords: ['launch', 'setup', 'bootstrap', 'install', 'quickstart', 'getting started', 'onboarding'],
    },
    {
        id: 'admin',
        name: 'Admin',
        description: 'Users, Tenants, Roles, Sessions, Registry & Security',
        icon: 'shield',
        route: '/admin',
        category: 'admin',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navOrder: 0,
        keywords: ['admin', 'sessions', 'registry', 'users', 'tenants', 'roles', 'permissions', 'security'],
    },
    {
        // The awstorage inventory control plane's window: fleet-wide disk usage,
        // ranked trees, diffs and reclaim proposals. Platform-admin only —
        // 'storage' is in view-scope's platformAppIds, so it never surfaces in a
        // tenant's Workspace nav even though its category ('admin') is not itself
        // a platform-only category. No route: this is a desktop-widget-only app,
        // opened from the Veil admin surface, not a page under app/.
        id: 'storage',
        name: 'Storage',
        description: 'Fleet disk usage, per-node ranked trees, diffs, and reclaim proposals',
        icon: 'hard-drive',
        category: 'admin',
        status: 'beta',
        requiresAuth: true,
        availability: 'full-stack',
        minRole: 'admin',
        showInNav: true,
        navOrder: 1,
        keywords: ['storage', 'disk', 'awstorage', 'cleanup', 'reclaim', 'quota', 'inventory'],
        desktopWidget: { widgetId: 'storage', defaultSize: { width: 980, height: 680 }, icon: 'hard-drive' },
    },
    {
        id: 'admin-users',
        name: 'User Management',
        description: 'Create, edit, and manage user accounts and role assignments',
        icon: 'users',
        route: '/admin?tab=members',
        category: 'admin',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['users', 'accounts', 'roles', 'admin'],
    },
    {
        id: 'admin-tenants',
        name: 'Tenant Management',
        description: 'Provision tenants, manage quotas, view cluster topology and usage',
        icon: 'building',
        route: '/admin',
        category: 'admin',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navOrder: 2,
        minRole: 'admin',
        keywords: ['tenants', 'multi-tenant', 'isolation', 'admin', 'quotas', 'cluster', 'provision'],
    },
    {
        id: 'admin-roles',
        name: 'Roles & Permissions',
        description: 'RBAC roles, permission matrices, and group management',
        icon: 'lock',
        route: '/admin?tab=roles',
        category: 'admin',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['roles', 'permissions', 'rbac', 'groups', 'admin'],
    },
    {
        id: 'sessions',
        name: 'Sessions',
        description: 'Active session management — view, audit, and revoke user sessions',
        icon: 'user',
        route: '/workspace/agents?tab=runs&view=sessions',
        category: 'admin',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: true,
        navOrder: 1,
        keywords: ['sessions', 'active', 'audit', 'revoke', 'login', 'security'],
        canvasWidgetType: 'sessions',
    },
]

// ============================================================================
// DASHBOARD WIDGETS — 25 composite panels shown on /dashboard
// These are dashboard-only widgets (tabbed composites of other panels)
// ============================================================================

const DASHBOARD_WIDGET_APPS: AitherApp[] = [
    // ── CHAT (2) ──
    {
        id: 'dw-protocol',
        name: 'Protocol',
        description: 'AI chat, reasoning, and multi-turn conversation hub',
        icon: 'brain',
        category: 'core',
        status: 'stable',
        requiresAuth: false,
        availability: 'gateway',
        showInNav: false,
        keywords: ['chat', 'protocol', 'reasoning', 'conversation'],
        dashboardWidget: { widgetId: 'protocol', group: 'chat', shortcut: '1', defaultSize: { width: 1200, height: 800 }, minSize: { width: 600, height: 400 } },
    },
    {
        id: 'dw-sessions',
        name: 'Sessions',
        description: 'Chat session history and management',
        icon: 'layers',
        category: 'core',
        status: 'stable',
        requiresAuth: false,
        availability: 'gateway',
        showInNav: false,
        keywords: ['sessions', 'history', 'conversations'],
        dashboardWidget: { widgetId: 'sessions', group: 'chat', shortcut: 'N', defaultSize: { width: 900, height: 700 }, minSize: { width: 600, height: 500 } },
    },
    // ── AGENTS (2) ──
    {
        id: 'dw-council',
        name: 'The Council',
        description: 'Agent council deliberation and voting',
        icon: 'users',
        category: 'agents',
        status: 'stable',
        requiresAuth: false,
        availability: 'gateway',
        showInNav: false,
        keywords: ['council', 'agents', 'deliberation', 'voting'],
        dashboardWidget: { widgetId: 'council', group: 'agents', shortcut: '2', defaultSize: { width: 800, height: 700 }, minSize: { width: 600, height: 500 } },
    },
    {
        id: 'dw-constellation',
        name: '✦ Constellation',
        description: 'Agent constellation visualization and network',
        icon: 'sparkles',
        category: 'agents',
        status: 'stable',
        requiresAuth: false,
        availability: 'gateway',
        showInNav: false,
        keywords: ['constellation', 'network', 'agents'],
        dashboardWidget: { widgetId: 'constellation', group: 'agents', shortcut: '6', defaultSize: { width: 800, height: 700 }, minSize: { width: 500, height: 450 } },
    },
    // ── COMMAND (6) ──
    {
        id: 'dw-command',
        name: 'Command',
        description: 'Command center with search and quick actions',
        icon: 'terminal',
        category: 'core',
        status: 'stable',
        requiresAuth: false,
        availability: 'gateway',
        showInNav: false,
        keywords: ['command', 'search', 'palette', 'actions'],
        dashboardWidget: { widgetId: 'command', group: 'command', shortcut: '3', defaultSize: { width: 650, height: 500 }, minSize: { width: 350, height: 300 } },
    },
    {
        id: 'dw-mission-control',
        name: 'Mission Control',
        description: 'Mission briefing, goals, and agent task overview',
        icon: 'rocket',
        category: 'core',
        status: 'stable',
        requiresAuth: false,
        availability: 'gateway',
        showInNav: false,
        keywords: ['mission', 'goals', 'tasks', 'briefing'],
        dashboardWidget: { widgetId: 'mission-control', group: 'command', shortcut: 'H', defaultSize: { width: 600, height: 650 }, minSize: { width: 450, height: 400 } },
    },
    {
        id: 'dw-operations',
        name: 'Operations',
        description: 'Agent operations, fleet status, and task routing',
        icon: 'bot',
        category: 'core',
        status: 'stable',
        requiresAuth: false,
        availability: 'gateway',
        showInNav: false,
        keywords: ['operations', 'fleet', 'routing'],
        dashboardWidget: { widgetId: 'operations', group: 'command', shortcut: '7', defaultSize: { width: 600, height: 550 }, minSize: { width: 400, height: 350 } },
    },
    {
        id: 'dw-calendar-routines',
        name: 'Calendar & Routines',
        description: 'Scheduled tasks, routines, and calendar events',
        icon: 'calendar-days',
        category: 'core',
        status: 'stable',
        requiresAuth: false,
        availability: 'gateway',
        showInNav: false,
        keywords: ['calendar', 'routines', 'schedule', 'events'],
        dashboardWidget: { widgetId: 'calendar-routines', group: 'command', shortcut: 'K', defaultSize: { width: 600, height: 650 }, minSize: { width: 450, height: 500 } },
    },
    {
        id: 'dw-automation',
        name: 'Automation',
        description: 'Workflow automation and pipeline management',
        icon: 'workflow',
        category: 'core',
        status: 'stable',
        requiresAuth: false,
        availability: 'gateway',
        showInNav: false,
        keywords: ['automation', 'workflow', 'pipeline'],
        dashboardWidget: { widgetId: 'automation', group: 'command', defaultSize: { width: 550, height: 550 }, minSize: { width: 400, height: 400 } },
    },
    {
        id: 'dw-social',
        name: 'Social & Intent',
        description: 'Social media broadcasting and intent classification',
        icon: 'users',
        category: 'social',
        status: 'stable',
        requiresAuth: false,
        availability: 'gateway',
        showInNav: false,
        keywords: ['social', 'intent', 'broadcast'],
        dashboardWidget: { widgetId: 'social', group: 'command', shortcut: 'B', defaultSize: { width: 500, height: 600 }, minSize: { width: 380, height: 450 } },
    },
    // ── MIND (3) ──
    {
        id: 'dw-consciousness',
        name: 'Consciousness',
        description: 'Consciousness hub — inner life, reasoning, cognitive state',
        icon: 'eye',
        category: 'core',
        status: 'stable',
        requiresAuth: false,
        availability: 'gateway',
        showInNav: false,
        keywords: ['consciousness', 'inner-life', 'cognitive', 'mind'],
        dashboardWidget: { widgetId: 'consciousness', group: 'mind', shortcut: 'I', defaultSize: { width: 600, height: 650 }, minSize: { width: 450, height: 450 } },
    },
    {
        id: 'dw-memory-context',
        name: 'Memory & Context',
        description: 'Spirit memory, context windows, and knowledge chains',
        icon: 'database',
        category: 'core',
        status: 'stable',
        requiresAuth: false,
        availability: 'gateway',
        showInNav: false,
        keywords: ['memory', 'context', 'spirit', 'knowledge'],
        dashboardWidget: { widgetId: 'memory-context', group: 'mind', shortcut: 'S', defaultSize: { width: 750, height: 700 }, minSize: { width: 550, height: 500 } },
    },
    {
        id: 'dw-generation-trace',
        name: 'Generation Trace',
        description: 'Token generation trace and LLM output inspector',
        icon: 'settings',
        category: 'core',
        status: 'stable',
        requiresAuth: false,
        availability: 'gateway',
        showInNav: false,
        keywords: ['generation', 'trace', 'tokens', 'llm'],
        dashboardWidget: { widgetId: 'generation-trace', group: 'mind', shortcut: 'O', defaultSize: { width: 700, height: 800 }, minSize: { width: 500, height: 600 } },
    },
    // ── MONITOR (5) ──
    {
        id: 'dw-system-pulse',
        name: 'System Pulse',
        description: 'Live system metrics — CPU, RAM, disk, services',
        icon: 'activity',
        category: 'monitor',
        status: 'stable',
        requiresAuth: false,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['system', 'pulse', 'metrics', 'cpu', 'ram'],
        dashboardWidget: { widgetId: 'system-pulse', group: 'monitor', shortcut: '0', defaultSize: { width: 1200, height: 800 }, minSize: { width: 700, height: 500 } },
    },
    {
        id: 'dw-gpu-compute',
        name: 'GPU & Compute',
        description: 'GPU utilization, VRAM allocation, and compute jobs',
        icon: 'cpu',
        category: 'monitor',
        status: 'stable',
        requiresAuth: false,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['gpu', 'compute', 'vram', 'cuda'],
        dashboardWidget: { widgetId: 'gpu-compute', group: 'monitor', shortcut: 'G', defaultSize: { width: 700, height: 600 }, minSize: { width: 500, height: 400 } },
    },
    {
        id: 'dw-neural-network',
        name: 'Neural Network',
        description: 'Neural network architecture and layer visualization',
        icon: 'network',
        category: 'monitor',
        status: 'stable',
        requiresAuth: false,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['neural', 'network', 'layers', 'architecture'],
        dashboardWidget: { widgetId: 'neural-network', group: 'monitor', defaultSize: { width: 750, height: 650 }, minSize: { width: 550, height: 450 } },
    },
    {
        id: 'dw-topology',
        name: 'Topology & Logs',
        description: 'Service topology graph and live log streams',
        icon: 'network',
        category: 'monitor',
        status: 'stable',
        requiresAuth: false,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['topology', 'logs', 'services', 'graph'],
        dashboardWidget: { widgetId: 'topology', group: 'monitor', shortcut: 'T', defaultSize: { width: 900, height: 650 }, minSize: { width: 600, height: 450 } },
    },
    {
        id: 'dw-internals',
        name: 'Internals',
        description: 'Service internals, config, and diagnostic data',
        icon: 'cog',
        category: 'monitor',
        status: 'stable',
        requiresAuth: false,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['internals', 'diagnostics', 'config'],
        dashboardWidget: { widgetId: 'internals', group: 'monitor', defaultSize: { width: 700, height: 600 }, minSize: { width: 500, height: 450 } },
    },
    // ── BUILD (7) ──
    {
        id: 'dw-canvas',
        name: 'Canvas',
        description: 'AI image generation via ComfyUI',
        icon: 'palette',
        category: 'creative',
        status: 'stable',
        requiresAuth: false,
        availability: 'gateway',
        showInNav: false,
        keywords: ['canvas', 'image', 'generation', 'comfyui'],
        dashboardWidget: { widgetId: 'canvas', group: 'build', shortcut: '4', defaultSize: { width: 550, height: 700 }, minSize: { width: 400, height: 500 } },
    },
    {
        id: 'dw-development',
        name: 'Development',
        description: 'Dev tools — GitHub, CI/CD, code metrics',
        icon: 'code-2',
        category: 'dev',
        status: 'stable',
        requiresAuth: false,
        availability: 'gateway',
        showInNav: false,
        keywords: ['development', 'github', 'ci', 'code'],
        dashboardWidget: { widgetId: 'development', group: 'build', shortcut: 'V', defaultSize: { width: 900, height: 700 }, minSize: { width: 600, height: 500 } },
    },
    {
        id: 'dw-models-training',
        name: 'Models & Training',
        description: 'Model management, fine-tuning, and LoRA training',
        icon: 'box',
        category: 'infra',
        status: 'stable',
        requiresAuth: false,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['models', 'training', 'fine-tune', 'lora'],
        dashboardWidget: { widgetId: 'models-training', group: 'build', shortcut: 'M', defaultSize: { width: 650, height: 650 }, minSize: { width: 450, height: 450 } },
    },
    {
        id: 'dw-infrastructure',
        name: 'Infrastructure',
        description: 'Docker, containers, networking, and deployments',
        icon: 'hard-drive',
        category: 'infra',
        status: 'stable',
        requiresAuth: false,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['infrastructure', 'docker', 'containers', 'deploy'],
        dashboardWidget: { widgetId: 'infrastructure', group: 'build', defaultSize: { width: 650, height: 600 }, minSize: { width: 450, height: 400 } },
    },
    {
        id: 'dw-security',
        name: 'Security',
        description: 'Security policies, audit trail, and access control',
        icon: 'shield',
        category: 'infra',
        status: 'stable',
        requiresAuth: false,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['security', 'audit', 'access', 'policy'],
        dashboardWidget: { widgetId: 'security', group: 'build', defaultSize: { width: 600, height: 600 }, minSize: { width: 450, height: 450 } },
    },
    {
        id: 'dw-billing',
        name: 'Billing',
        description: 'Usage tracking, billing, and cost management',
        icon: 'wallet',
        category: 'admin',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['billing', 'usage', 'cost', 'wallet'],
        dashboardWidget: { widgetId: 'billing', group: 'build', shortcut: 'W', defaultSize: { width: 400, height: 600 }, minSize: { width: 350, height: 450 } },
    },
    {
        id: 'dw-config',
        name: 'Config',
        description: 'System configuration and service settings',
        icon: 'settings',
        category: 'admin',
        status: 'stable',
        requiresAuth: true,
        availability: 'full-stack',
        showInNav: false,
        keywords: ['config', 'settings', 'system'],
        dashboardWidget: { widgetId: 'config', group: 'build', defaultSize: { width: 700, height: 700 }, minSize: { width: 500, height: 550 } },
    },
]

// ============================================================================
// WORKSPACE APPS — Tenant-scoped, user-facing workspace sidebar apps
// ============================================================================

/**
 * Workspace nav group config. These drive the GlobalNav sidebar when
 * the user is on /workspace/* routes. They are separate from platform
 * admin apps and never show in the Veil admin sidebar.
 */
const WORKSPACE_APPS: AitherApp[] = [
    // ── Home ── (THE COLLAPSE, 2026-09-27 — src/data/route-map.yaml is the
    // authority for every route below. Sidebar entries here pointed at routes
    // that the collapse merged away; each `route` was updated to the surviving
    // target and the target is named in a comment. Owner report 2026-10-01:
    // "the left-hand sidebar … still has old apps and pages".
    // The workspace home is the Company Room — RelayShell at /workspace/room —
    // and Chat is Relay's DM shell, so neither gets a second nav entry.)
    {
        id: 'ws-dashboard', name: 'Dashboard',
        description: 'Workspace command center',
        // route-map: /workspace/dashboard -> /?view=welcome
        icon: 'layout-dashboard', route: '/?view=welcome',
        category: 'core', status: 'stable', requiresAuth: true,
        availability: 'local', showInNav: true, navGroup: 'Team', navOrder: 0,
        keywords: ['workspace', 'dashboard', 'home'],
    },
    {
        id: 'ws-desktop', name: 'Aither Desktop',
        description: 'The desktop environment — windows, apps and widgets over the same session',
        // route-map: /desktop -> /?shell=aither-desktop (the desktop is an OS shell
        // on the home, not a page of its own)
        icon: 'monitor-smartphone', route: '/?shell=aither-desktop',
        category: 'core', status: 'stable', requiresAuth: true,
        availability: 'local', showInNav: true, navGroup: 'Team', navOrder: 2,
        keywords: ['desktop', 'os', 'windows', 'aither-desktop', 'environment', 'taskbar'],
    },
    {
        id: 'ws-apps', name: 'Apps',
        description: 'Installed apps and app catalog',
        // route-map: /workspace/apps -> /studio?view=apps (the Studio's apps view)
        icon: 'grid-3x3', route: '/studio?view=apps',
        category: 'core', status: 'stable', requiresAuth: true,
        availability: 'gateway', showInNav: true, navGroup: 'Team', navOrder: 1,
        keywords: ['apps', 'install', 'catalog', 'marketplace', 'deploy'],
    },
    {
        id: 'ws-marketplace', name: 'Marketplace',
        description: 'Browse and deploy third-party AI apps',
        // route-map: /marketplace -> /?app=shop (the shop window on the OS home)
        icon: 'store', route: '/?app=shop',
        category: 'core', status: 'stable', requiresAuth: true,
        availability: 'gateway', showInNav: true, navGroup: 'Commerce', navOrder: 0,
        keywords: ['marketplace', 'store', 'community', 'apps', 'deploy', 'install'],
    },
    // ── Communicate ──
    {
        id: 'ws-relay', name: 'Relay',
        description: 'Team home — channels, agents, docs, files (chat-first shell)',
        // route-map: /workspace/relay -> /workspace/room?tab=rooms (the Company
        // Room renders RelayShell itself — relay is a tab of the room now).
        icon: 'zap', route: '/workspace/room?tab=rooms',
        category: 'social', status: 'stable', requiresAuth: true,
        availability: 'gateway', showInNav: true, navGroup: 'Harness', navOrder: 0,
        keywords: ['relay', 'irc', 'messaging', 'channels', 'chat', 'home', 'team', 'room'],
    },
    {
        id: 'ws-mail', name: 'Mail',
        description: 'Workspace email and correspondence',
        // route-map: /workspace/mail -> /workspace/one?tab=mail (AitherOne suite)
        icon: 'mail', route: '/workspace/one?tab=mail',
        category: 'social', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: true, navGroup: 'Harness', navOrder: 3,
        keywords: ['mail', 'email', 'correspondence'],
    },
    {
        id: 'ws-forum', name: 'Forum',
        description: 'Discussion boards — the Room\'s board tab',
        icon: 'message-square', route: '/workspace/room?tab=board',
        category: 'social', status: 'beta', requiresAuth: true,
        // route-map: /workspace/forum -> /workspace/room?tab=rooms and
        // /workspace/forum/[id] -> /workspace/room?tab=board&thread=[id] — the
        // board is a tab of the Room, so the nav entry folds into Relay's.
        availability: 'gateway', showInNav: false, navGroup: 'Harness', navOrder: 4,
        keywords: ['forum', 'discuss', 'threads', 'community', 'board'],
    },
    // ── Agents ──
    {
        id: 'ws-atlas', name: 'Atlas',
        description: 'Project lifecycle — expeditions, kanban board, PM projects, and the Spec Factory',
        // route-map: /workspace/atlas -> /workspace/agents/atlas (one page per agent)
        icon: 'telescope', route: '/workspace/agents/atlas',
        category: 'agents', status: 'stable', requiresAuth: true,
        availability: 'gateway', showInNav: true, navGroup: 'Agents', navOrder: 0,
        keywords: ['atlas', 'project', 'expedition', 'planning', 'kanban', 'pm', 'board', 'execution', 'pipeline'],
    },
    {
        id: 'ws-agents', name: 'Agent Fleet',
        description: 'Manage workspace agents',
        icon: 'bot', route: '/workspace/agents',
        category: 'agents', status: 'stable', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Agents', navOrder: 1,
        keywords: ['agents', 'fleet', 'bots'],
        // /workspace/agents enforces agents:read (route-manifest.ts).
        rbac: { resource: 'agents', action: 'read' },
    },
    {
        id: 'ws-operations', name: 'Operations',
        description: 'Agent operations and task queue',
        icon: 'activity', route: '/workspace/agents?tab=runs&view=tasks',
        category: 'agents', status: 'stable', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Agents', navOrder: 2,
        keywords: ['operations', 'tasks', 'queue'],
    },
    {
        id: 'ws-skills', name: 'Skills',
        description: 'Agent skill library and management',
        icon: 'zap', route: '/workspace/agents?tab=skills',
        category: 'agents', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Agents', navOrder: 3,
        keywords: ['skills', 'agent', 'capabilities', 'tools'],
    },
    {
        id: 'ws-specs', name: 'Spec Factory',
        description: 'PRD → trackable requirements → GitHub issues + board → conformance (Atlas PM)',
        icon: 'clipboard-check', route: '/workspace/agents/atlas?view=conformance',
        category: 'agents', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Agents', navOrder: 4,
        keywords: ['spec', 'prd', 'requirements', 'issues', 'github', 'board', 'publish', 'conformance', 'atlas', 'roadmap', 'factory'],
    },
    {
        id: 'ws-packs', name: 'Extension Packs',
        description: 'Browse and install MCP tool packs',
        icon: 'package', route: '/workspace/agents?tab=packs',
        category: 'agents', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Agents', navOrder: 5,
        keywords: ['packs', 'extensions', 'tools', 'mcp', 'marketplace', 'premium'],
    },
    // ── Data ──
    {
        id: 'ws-data-sources', name: 'Sources',
        description: 'Connected data sources',
        icon: 'database', route: '/admin?tab=data',
        category: 'core', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Docs & Files', navOrder: 0,
        keywords: ['data', 'sources', 'connectors'],
    },
    {
        id: 'ws-files', name: 'Files',
        description: 'Workspace file browser',
        icon: 'folder-open', route: '/workspace/files',
        category: 'core', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Docs & Files', navOrder: 1,
        keywords: ['files', 'upload', 'download'],
    },
    {
        id: 'ws-knowledge', name: 'Knowledge',
        description: 'Knowledge base and embeddings',
        // route-map: /workspace/knowledge -> /workspace/one?tab=knowledge (AitherOne suite)
        icon: 'library', route: '/workspace/one?tab=knowledge',
        category: 'core', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: true, navGroup: 'Workspace', navOrder: 7,
        keywords: ['knowledge', 'embeddings', 'rag'],
    },
    {
        id: 'ws-wiki', name: 'Wiki',
        description: 'Collaborative documentation',
        icon: 'file-text', route: '/workspace/one?tab=knowledge',
        category: 'core', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Docs & Files', navOrder: 3,
        keywords: ['wiki', 'docs', 'documentation'],
    },
    {
        id: 'ws-aitherbrain', name: 'AitherBrain',
        description: 'Autonomous knowledge management — wiki, research, skills',
        icon: 'brain', route: '/workspace/one?tab=knowledge',
        category: 'core', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Docs & Files', navOrder: 4,
        keywords: ['brain', 'wiki', 'knowledge', 'research', 'skills', 'ingest', 'lyra'],
    },
    // ── Intelligence ──
    {
        id: 'ws-research', name: 'Research',
        description: 'Deep research and analysis',
        icon: 'search', route: '/workspace/one?tab=research',
        category: 'agents', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Agents', navOrder: 6,
        keywords: ['research', 'search', 'analysis'],
    },
    {
        id: 'ws-tools', name: 'Tools',
        description: 'Agent tools and MCP servers',
        icon: 'wrench', route: '/workspace/agents?tab=tools',
        category: 'agents', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Agents', navOrder: 7,
        keywords: ['tools', 'mcp', 'integrations'],
    },
    {
        id: 'ws-training', name: 'Training',
        description: 'Model fine-tuning and training',
        icon: 'brain', route: '/mission-control?tab=training',
        category: 'agents', status: 'beta', requiresAuth: true,
        availability: 'full-stack', showInNav: false, navGroup: 'Agents', navOrder: 8,
        keywords: ['training', 'fine-tuning', 'models'],
    },
    {
        id: 'ws-nanobrain', name: 'NanoBrain',
        description: 'Tiny models trained on your own data in seconds: anomaly scoring, learned routing, experiment leaderboard',
        icon: 'brain', route: '/mission-control?tab=training&view=nanobrain',
        category: 'agents', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Agents', navOrder: 9,
        keywords: ['nanobrain', 'nanogpt', 'anomaly', 'tiny models', 'training', 'lab'],
    },
    {
        id: 'ws-notebooks', name: 'Notebooks',
        description: 'AI-powered notebooks',
        icon: 'pen-tool', route: '/workspace/one?tab=notebooks',
        category: 'dev', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Docs & Files', navOrder: 5,
        keywords: ['notebooks', 'jupyter', 'code'],
    },
    {
        id: 'ws-aitherone', name: 'AitherOne',
        description: 'Collaborative notebooks and documents — cloud-synced, meeting notes, agent co-writing',
        icon: 'library', route: '/workspace/one',
        category: 'creative', status: 'stable', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Docs & Files', navOrder: 6,
        keywords: ['aitherone', 'docs', 'documents', 'collaborative', 'notes', 'writing'],
    },
    {
        id: 'ws-brain', name: 'Shared Brain',
        description: 'Shared workspace AI conversations — every conversation queryable and searchable',
        icon: 'brain', route: '/workspace/room?tab=rooms&channel=company',
        category: 'agents', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Docs & Files', navOrder: 7,
        keywords: ['brain', 'conversations', 'ai', 'shared', 'context'],
    },
    {
        id: 'ws-context-xray', name: 'Context Xray',
        description: 'Context layer breakdown and analysis — token allocation, scope visualization',
        icon: 'search', route: '/mission-control?tab=observe&view=context',
        category: 'dev', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Docs & Files', navOrder: 8,
        keywords: ['context', 'xray', 'layers', 'tokens', 'analysis', 'visualization'],
    },
    {
        id: 'ws-graph', name: 'Graph',
        description: 'Materialized graph views and data relationships',
        icon: 'git-graph', route: '/mission-control?tab=observe&view=graph',
        category: 'dev', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Docs & Files', navOrder: 9,
        keywords: ['graph', 'views', 'data', 'relationships', 'database'],
    },
    {
        id: 'ws-calendar', name: 'Calendar',
        description: 'Workspace calendar — schedule, meetings, events',
        icon: 'calendar-days', route: '/workspace/one?tab=calendar',
        category: 'core', status: 'stable', requiresAuth: true,
        availability: 'gateway', showInNav: true, navGroup: 'Docs & Files', navOrder: 10,
        keywords: ['calendar', 'schedule', 'meetings', 'events'],
    },
    {
        id: 'ws-presentations', name: 'Presentations',
        description: 'AI-powered slide decks with export to PPTX/HTML',
        icon: 'presentation', route: '/workspace/one?tab=presentations',
        category: 'creative', status: 'beta', requiresAuth: true,
        // Folded into the AitherOne suite (ws-one) — reachable via search/launcher.
        availability: 'gateway', showInNav: false, navGroup: 'Studio', navOrder: 5,
        keywords: ['presentations', 'slides', 'powerpoint', 'deck', 'pitch'],
    },
    {
        id: 'ws-polls', name: 'Polls',
        description: 'Create polls/surveys, email them to subscribers, embed in posts, and see live results',
        icon: 'bar-chart-3', route: '/workspace/one?tab=forms&view=polls',
        category: 'creative', status: 'beta', requiresAuth: true,
        // Nav-hidden (engagement tool, not a suite section) — reachable via search/launcher.
        availability: 'local', showInNav: false, navGroup: 'Studio', navOrder: 8,
        keywords: ['polls', 'survey', 'vote', 'feedback', 'marketing'],
    },
    {
        id: 'ws-creative', name: 'Creative',
        description: 'Creative studio and media generation',
        icon: 'palette', route: '/workspace/one?tab=creative',
        category: 'creative', status: 'beta', requiresAuth: true,
        // Folded into the AitherOne suite (ws-one) — reachable via search/launcher.
        availability: 'gateway', showInNav: false, navGroup: 'Studio', navOrder: 2,
        keywords: ['creative', 'art', 'images', 'video'],
    },
    {
        id: 'ws-media', name: 'Media',
        description: 'Batch media upload and ingestion — videos, audio, documents, images',
        icon: 'image', route: '/workspace/one?tab=media',
        category: 'creative', status: 'beta', requiresAuth: true,
        // Folded into the AitherOne suite (ws-one) — reachable via search/launcher.
        availability: 'gateway', showInNav: false, navGroup: 'Studio', navOrder: 4,
        keywords: ['media', 'upload', 'video', 'audio', 'image', 'ingestion', 'batch'],
    },
    {
        id: 'ws-marketing', name: 'Marketing',
        description: 'Marketing analytics, campaigns, and engagement',
        icon: 'megaphone', route: '/workspace/one?tab=publish&view=marketing',
        category: 'core', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Commerce', navOrder: 1,
        keywords: ['marketing', 'analytics', 'campaigns', 'engagement', 'kpi', 'posts'],
    },
    {
        id: 'ws-commerce', name: 'Commerce',
        description: 'Stripe commerce — products, payments, subscriptions, and revenue',
        icon: 'shopping-cart', route: '/admin?tab=commerce',
        category: 'core', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Business', navOrder: 1,
        keywords: ['commerce', 'stripe', 'products', 'payments', 'subscriptions', 'revenue'],
    },
    {
        id: 'ws-sprite', name: 'Sprite',
        description: 'Your AI companion creature — feed it, play with it, talk to it, and watch it evolve',
        // route-map: /workspace/sprite -> /spaces?tab=sprite (Sprite lives in the neighborhood)
        icon: 'heart', route: '/spaces?tab=sprite',
        category: 'core', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: true, navGroup: 'Workspace', navOrder: 60,
        keywords: ['sprite', 'companion', 'pet', 'tamagotchi', 'creature', 'ai pet'],
    },
    // ── Workspace ──
    {
        id: 'ws-members', name: 'Members',
        description: 'Workspace members and roles',
        icon: 'user', route: '/admin?tab=members',
        category: 'social', status: 'stable', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Team', navOrder: 2,
        keywords: ['members', 'users', 'team'],
    },
    {
        id: 'ws-groups', name: 'Groups',
        description: 'User groups and teams',
        icon: 'users', route: '/admin?tab=members&view=groups',
        category: 'social', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Team', navOrder: 3,
        keywords: ['groups', 'teams'],
        // Managing groups / API keys is administration, not membership.
        // CORE grants it; this restricts it to workspace admins.
        rbac: { resource: 'directory', action: 'read' },
    },
    {
        id: 'ws-directory', name: 'Directory',
        description: 'Organization directory',
        icon: 'library', route: '/admin?tab=members',
        category: 'social', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Team', navOrder: 4,
        keywords: ['directory', 'org', 'contacts'],
    },
    {
        id: 'ws-routines', name: 'Routines',
        description: 'Automated workspace routines',
        icon: 'repeat', route: '/studio?mode=workflow&view=schedules',
        category: 'core', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Team', navOrder: 5,
        keywords: ['routines', 'automation', 'schedule'],
    },
    {
        id: 'ws-requests', name: 'Requests',
        description: 'Project requests, quotes, and client communication',
        icon: 'inbox', route: '/workspace/one?tab=crm&view=requests',
        category: 'core', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Team', navOrder: 6,
        keywords: ['requests', 'quotes', 'client', 'communication', 'inbox'],
    },
    // ── Platform ──
    {
        id: 'ws-deploy', name: 'Deploy',
        description: 'Deployment management',
        icon: 'server', route: '/admin?tab=compute',
        category: 'dev', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Platform', navOrder: 0,
        keywords: ['deploy', 'deployment', 'ci-cd'],
    },
    {
        id: 'ws-fleet', name: 'Fleet',
        description: 'Sovereign node fleet management',
        icon: 'globe', route: '/mission-control?tab=fleet',
        category: 'dev', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Platform', navOrder: 1,
        keywords: ['fleet', 'nodes', 'sovereign'],
    },
    {
        id: 'ws-tunnel', name: 'Tunnel',
        description: 'Infrastructure access, VPN, and port forwarding',
        icon: 'shield', route: '/admin?tab=domains&view=tunnel',
        category: 'dev', status: 'stable', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Platform', navOrder: 2,
        keywords: ['tunnel', 'vpn', 'port-forwarding', 'ssh', 'wireguard'],
    },
    {
        id: 'ws-dev-containers', name: 'Dev Containers',
        description: 'Scoped development workspaces — create, manage, invite, and download dev containers',
        icon: 'container', route: '/mission-control?tab=infrastructure&view=dev-containers',
        category: 'dev', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Platform', navOrder: 3,
        keywords: ['dev', 'container', 'workspace', 'scope', 'registration', 'invite', 'devcontainer', 'docker'],
    },
    {
        id: 'ws-connect', name: 'Connect',
        description: 'Set up AitherShell, awnode, MCP tools, and sync to your workspace',
        icon: 'plug-zap', route: '/workspace/settings?tab=services',
        category: 'dev', status: 'stable', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Platform', navOrder: 4,
        keywords: ['connect', 'setup', 'install', 'mcp', 'cli', 'shell', 'node', 'sdk', 'strata', 'secrets'],
    },
    // ── Infrastructure ──
    {
        id: 'ws-compute', name: 'Compute',
        description: 'GPU nodes, LLM backends, and agent compute management',
        icon: 'cpu', route: '/mission-control?tab=compute&view=nodes',
        category: 'infra', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Infrastructure', navOrder: 0,
        keywords: ['compute', 'gpu', 'nodes', 'backend', 'llm', 'resources'],
        // Workspace admins administer their OWN infrastructure (owner, 2026-08-18).
        // Checked FIRST by requiredPermission, so it overrides any derived rule; an
        // admin's `*:*:*` satisfies it and a plain member fails closed.
        rbac: { resource: 'compute', action: 'read' },
    },
    {
        id: 'ws-nodes', name: 'Nodes',
        description: 'Workspace node enrollment and mesh management',
        icon: 'network', route: '/admin?tab=nodes&view=enrol',
        category: 'infra', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Infrastructure', navOrder: 1,
        keywords: ['nodes', 'enrollment', 'mesh', 'hardware', 'services'],
        // Workspace admins administer their OWN infrastructure (owner, 2026-08-18).
        // Checked FIRST by requiredPermission, so it overrides any derived rule; an
        // admin's `*:*:*` satisfies it and a plain member fails closed.
        rbac: { resource: 'compute', action: 'read' },
    },
    {
        id: 'ws-domains', name: 'Domains',
        description: 'Custom domain management — add your own domain to this workspace',
        icon: 'globe', route: '/admin?tab=domains',
        category: 'infra', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Infrastructure', navOrder: 2,
        keywords: ['domains', 'dns', 'custom', 'cloudflare'],
        // Workspace admins administer their OWN infrastructure (owner, 2026-08-18).
        // Checked FIRST by requiredPermission, so it overrides any derived rule; an
        // admin's `*:*:*` satisfies it and a plain member fails closed.
        rbac: { resource: 'workspace', action: 'read' },
    },
    {
        id: 'ws-infrastructure', name: 'Infrastructure',
        description: 'Cloudflare routing, deployments, and infrastructure config',
        icon: 'server', route: '/mission-control?tab=infrastructure&view=tunnel',
        category: 'infra', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Infrastructure', navOrder: 3,
        keywords: ['infrastructure', 'cloudflare', 'routing', 'deployments', 'config'],
        // Workspace admins administer their OWN infrastructure (owner, 2026-08-18).
        // Checked FIRST by requiredPermission, so it overrides any derived rule; an
        // admin's `*:*:*` satisfies it and a plain member fails closed.
        rbac: { resource: 'infrastructure', action: 'read' },
    },
    // ── Account ──
    {
        id: 'ws-billing', name: 'Billing & Invoicing',
        description: 'Billing, usage, subscriptions, and invoices',
        icon: 'credit-card', route: '/admin?tab=billing',
        category: 'core', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Business', navOrder: 3,
        keywords: ['billing', 'payment', 'subscription', 'usage'],
    },
    {
        id: 'ws-support', name: 'Support',
        description: 'Help and support',
        icon: 'life-buoy', route: '/chat?mode=help',
        category: 'core', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Account', navOrder: 1,
        keywords: ['support', 'help', 'tickets'],
    },
    {
        id: 'ws-profile', name: 'Profile',
        description: 'Your account, identity, and security',
        icon: 'user-circle', route: '/workspace/settings?tab=profile',
        category: 'core', status: 'stable', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Account', navOrder: 2,
        keywords: ['profile', 'account', 'identity', 'avatar', 'user'],
    },
    {
        id: 'ws-settings', name: 'Settings',
        description: 'Manage persona, security, integrations, and preferences',
        icon: 'settings', route: '/workspace/settings',
        category: 'core', status: 'stable', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Account', navOrder: 3,
        keywords: ['settings', 'preferences', 'config', 'persona', 'api-keys', 'ssh', 'github'],
    },
    {
        id: 'ws-platform-admin', name: 'Platform Admin',
        description: 'Business overview — tenants, licenses, revenue, support queue',
        icon: 'shield', route: '/mission-control?tab=tenants',
        category: 'core', status: 'stable', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Account', navOrder: 4,
        keywords: ['admin', 'platform', 'tenants', 'licenses', 'revenue', 'billing', 'support'],
    },
    {
        id: 'ws-api-keys', name: 'API Keys',
        description: 'Manage API keys and access tokens',
        icon: 'key', route: '/admin?tab=secrets&view=keys',
        category: 'core', status: 'stable', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Account', navOrder: 4,
        keywords: ['api', 'keys', 'tokens', 'credentials'],
        // Managing groups / API keys is administration, not membership.
        // CORE grants it; this restricts it to workspace admins.
        rbac: { resource: 'workspace', action: 'read' },
    },
    {
        id: 'ws-campaigns', name: 'Campaigns',
        description: 'Back campaigns and earn tokens',
        icon: 'megaphone', route: '/?channel=guild&tab=campaigns',
        category: 'core', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Commerce', navOrder: 3,
        keywords: ['campaigns', 'backing', 'tokens', 'crowdfunding'],
    },
    // ── Home (extras) ──
    {
        id: 'ws-business', name: 'BusinessPilot',
        description: 'BusinessPilot cockpit — engines, approvals, escalations',
        icon: 'briefcase', route: '/admin?tab=business',
        category: 'core', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Business', navOrder: 2,
        keywords: ['business', 'pilot', 'engines', 'approvals', 'escalations'],
    },
    // ── Intelligence (extras) ──
    {
        id: 'ws-models', name: 'Models',
        description: 'Browse and deploy AI models',
        icon: 'boxes', route: '/admin?tab=inference',
        category: 'agents', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Agents', navOrder: 9,
        keywords: ['models', 'marketplace', 'llm', 'deploy'],
    },
    {
        id: 'ws-workflows', name: 'Workflows',
        description: 'Visual agent workflow automation',
        icon: 'git-branch', route: '/studio?mode=workflow',
        category: 'agents', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Agents', navOrder: 10,
        keywords: ['workflows', 'automation', 'visual', 'pipeline'],
    },
    // ── Creative (extras) ──
    {
        // The AitherOne suite — Docs, Presentations, Media, Creative, and Canvas
        // in one shell. Replaces the six separate Studio nav entries.
        id: 'ws-one', name: 'AitherOne',
        description: 'The office & creative suite — docs, slides, media, creative studio, canvas',
        icon: 'layout-grid', route: '/workspace/one',
        category: 'creative', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: true, navGroup: 'Studio', navOrder: 0,
        keywords: ['aitherone', 'suite', 'office', 'docs', 'slides', 'presentations', 'media', 'creative', 'canvas'],
    },
    {
        id: 'ws-studio', name: 'Studio',
        description: 'Build & publish websites — describe it, watch it build live, ship it',
        icon: 'rocket', route: '/studio',
        category: 'creative', status: 'beta', requiresAuth: true,
        // Nav-hidden (website builder lives behind Iris/AitherOne) — reachable via search/launcher.
        availability: 'gateway', showInNav: false, navGroup: 'Studio', navOrder: 6,
        agent: 'iris',
        keywords: ['studio', 'website', 'builder', 'site', 'project', 'publish', 'deploy'],
    },
    {
        id: 'ws-iris', name: 'Iris',
        description: 'The Visual Artisan — chat to build apps, agents, designs, and projects',
        // route-map: /workspace/iris -> /studio (the ONE Studio; Iris is its create lane)
        icon: 'eye', route: '/studio',
        category: 'creative', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: true, navGroup: 'Studio', navOrder: 1,
        agent: 'iris',
        keywords: ['iris', 'vision', 'image', 'builder', 'app', 'agent', 'intake', 'design'],
    },
    {
        id: 'ws-saga', name: 'Saga',
        description: 'Interactive narrative and storytelling engine',
        // route-map: /workspace/saga -> /?channel=arcade&keyword=saga (Saga lives in the arcade)
        icon: 'book-open', route: '/?channel=arcade&keyword=saga',
        category: 'creative', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: true, navGroup: 'Studio', navOrder: 7,
        keywords: ['saga', 'story', 'narrative', 'game'],
    },
    {
        id: 'ws-audiobook', name: 'Audiobook',
        description: 'AI audiobook companion with character tracking',
        icon: 'headphones', route: '/workspace/media?tab=audiobook',
        category: 'creative', status: 'beta', requiresAuth: true,
        // Nav-hidden (consumption app, not a suite section) — reachable via search/launcher.
        availability: 'gateway', showInNav: false, navGroup: 'Studio', navOrder: 9,
        keywords: ['audiobook', 'listen', 'companion', 'character'],
    },
    // ── Platform (extras) ──
    {
        id: 'ws-sdk', name: 'SDK & Docs',
        description: 'Agent SDK reference and development documentation',
        icon: 'code-2', route: '/docs',
        category: 'dev', status: 'stable', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Platform', navOrder: 5,
        keywords: ['sdk', 'docs', 'documentation', 'api', 'reference'],
    },
    {
        id: 'ws-onboard', name: 'Deploy Agent',
        description: 'Deploy a custom agent to AitherOS infrastructure',
        icon: 'rocket', route: '/studio?mode=agent&step=deploy',
        category: 'dev', status: 'stable', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Platform', navOrder: 6,
        keywords: ['onboard', 'deploy', 'agent', 'publish'],
    },
    {
        id: 'ws-releases', name: 'Releases',
        description: 'Release manager for ADK and Shell packages',
        icon: 'package', route: '/mission-control?tab=deployments&view=releases',
        category: 'dev', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Platform', navOrder: 7,
        keywords: ['releases', 'packages', 'versions', 'pipelines'],
    },
    {
        // A DESKTOP APP, not only a route. This entry existed with no
        // desktopWidget and showInNav:false, so the 43KB app at
        // components/os/apps/aithershell.tsx appeared in NO launcher and was in
        // neither this manifest nor Veil's widget import map -- both halves
        // missing, so it could not be found AND could not have rendered if it
        // had been (DAW001 + DAW003).
        //
        // This is the surface that makes coding from a phone work: the widget
        // calls /api/harness/*, Veil proxies to the harness daemon holding the
        // bearer server-side, and the phone and the workstation then see ONE
        // session list rather than two shells.
        //
        // Kept as ONE entry rather than adding an `aithershell` sibling: DAW008
        // flags a subject split across two registrations, and two Shell icons
        // pointing at one shell is the drift it exists to stop.
        id: 'ws-shell', name: 'Shell',
        description: 'Terminal access and CLI tools',
        icon: 'terminal', route: '/?channel=stack&keyword=awsh',
        category: 'dev', status: 'beta', requiresAuth: true,
        availability: 'gateway', showInNav: false, navGroup: 'Platform', navOrder: 8,
        desktopWidget: { widgetId: 'ws-shell', defaultSize: { width: 1000, height: 700 }, icon: 'terminal' },
        keywords: ['shell', 'terminal', 'cli', 'command', 'agent', 'claude', 'code', 'phone'],
    },
]

// ============================================================================
// HOW TO ADD A NEW APP
// ============================================================================
// 1. Create the page:
//    - Public (website): src/app/(website)/your-page/page.tsx
//    - Workspace (portal): src/app/workspace/your-page/page.tsx
//    - Both: create both, workspace version imports from (website) via dynamic()
//
// 2. Add manifest entry below with:
//    - id: unique kebab-case identifier
//    - route: '/your-page' (website) or '/workspace/your-page' (workspace)
//    - showInNav: true to appear in GlobalNav sidebar
//    - navGroup: which sidebar section (Home, Platform, Agents, etc.)
//    - availability: 'local' | 'gateway' | 'full-stack'
//
// 3. If the icon doesn't exist in global-nav.tsx ICON_MAP:
//    - Import it from lucide-react in global-nav.tsx
//    - Add 'icon-name': <IconComponent className="w-4 h-4" /> to ICON_MAP
//
// 4. If public (accessible without login on demo/portal):
//    - Add to PUBLIC_PATHS in proxy.ts
//    - Add to WEBSITE_PATHS in proxy.ts
//    - Add /api/bridge/genesis/your-api/* if it has API calls
//
// 5. If workspace route on api.aitherium.com:
//    - Add to WORKSPACE_PASSTHROUGH_PREFIXES in proxy.ts
//    - OR put under /workspace/* (auto-handled)
//
// 6. Validate: node scripts/validate-routes.js
// ============================================================================

// ============================================================================
// EXPORTS
// ============================================================================

/** All registered apps — each enriched with its computed scopeTag */
export const ALL_APPS: AitherApp[] = [
    ...CORE_APPS,
    ...AGENT_APPS,
    ...CREATIVE_APPS,
    ...PRODUCTIVITY_APPS,
    ...DEV_APPS,
    ...SOCIAL_APPS,
    ...LABS_APPS,
    ...MONITOR_APPS,
    ...INFRA_APPS,
    ...ADMIN_APPS,
    ...UTILITY_APPS,
    ...DASHBOARD_WIDGET_APPS,
    ...WORKSPACE_APPS,
    ...CAPABILITY_APPS,
].map(app => ({
    ...app,
    scopeTag: app.scopeTag ?? buildScopeTag(app.id, app.category),
}))

/** Only apps that should appear in the GlobalNav sidebar */
export const NAV_APPS = ALL_APPS.filter(a => a.showInNav)

/** Only apps that have desktop widgets */
export const DESKTOP_APPS = ALL_APPS.filter(a => a.desktopWidget != null)

/** Only apps that have desktop icons */
export const DESKTOP_ICON_APPS = ALL_APPS.filter(a => a.desktopIcon != null)

/** Only apps that have dashboard widgets */
export const DASHBOARD_APPS = ALL_APPS.filter(a => a.dashboardWidget != null)

/** Only apps that are built (stable or beta) */
export const BUILT_APPS = ALL_APPS.filter(a => a.status !== 'planned')

/** Look up an app by ID */
export function getApp(id: string): AitherApp | undefined {
    return ALL_APPS.find(a => a.id === id)
}

/** Look up an app by its desktop widget ID */
export function getAppByWidgetId(widgetId: string): AitherApp | undefined {
    return ALL_APPS.find(a => a.desktopWidget?.widgetId === widgetId)
}

/** Look up an app by its dashboard widget ID */
export function getAppByDashboardWidgetId(widgetId: string): AitherApp | undefined {
    return ALL_APPS.find(a => a.dashboardWidget?.widgetId === widgetId)
}

/** Build dashboard WidgetDef[] from manifest — drop-in replacement for the hardcoded WIDGETS array */
export function buildDashboardWidgetDefs(): Array<{
    id: string
    title: string
    icon: string
    group: DashboardWidgetGroup
    shortcut?: string
    defaultWidth: number
    defaultHeight: number
    minWidth?: number
    minHeight?: number
    maxWidth?: number
    maxHeight?: number
}> {
    return DASHBOARD_APPS.map(app => {
        const dw = app.dashboardWidget!
        return {
            id: dw.widgetId,
            title: app.name,
            icon: app.icon,
            group: dw.group,
            shortcut: dw.shortcut,
            defaultWidth: dw.defaultSize.width,
            defaultHeight: dw.defaultSize.height,
            minWidth: dw.minSize?.width,
            minHeight: dw.minSize?.height,
            maxWidth: dw.maxSize?.width,
            maxHeight: dw.maxSize?.height,
        }
    })
}

/** Dashboard widget group definitions */
export const DASHBOARD_WIDGET_GROUPS: Array<{ id: DashboardWidgetGroup; title: string; icon: string; color: string }> = [
    { id: 'chat', title: 'Chat', icon: 'message-square', color: 'purple' },
    { id: 'agents', title: 'Agents', icon: 'bot', color: 'blue' },
    { id: 'command', title: 'Command', icon: 'terminal', color: 'orange' },
    { id: 'mind', title: 'Mind', icon: 'brain', color: 'pink' },
    { id: 'monitor', title: 'Monitor', icon: 'activity', color: 'cyan' },
    { id: 'build', title: 'Build', icon: 'flame', color: 'amber' },
]

/** Get apps by category */
export function getAppsByCategory(category: AppCategory): AitherApp[] {
    return ALL_APPS.filter(a => a.category === category)
}

/** Build the WIDGET_REGISTRY format for desktop-shell.tsx
 *  If scopeState is provided, filters apps via getAppsForSurface('desktop', ...)
 *  Otherwise uses DESKTOP_APPS for backward compatibility.
 */
export function buildWidgetRegistry(scopeState?: {
    canViewPlatform: boolean
    isAuthenticated: boolean
    isAdmin?: boolean
    isEmailVerified?: boolean
    accessMode: 'local' | 'elysium' | 'gateway'
    userRoles: string[]
    minRole?: (role: string) => boolean
}): Record<string, {
    title: string
    icon: string
    defaultSize: { width: number; height: number }
    component: null
}> {
    const registry: Record<string, any> = {}

    // Use getAppsForSurface if scopeState provided, otherwise fall back to DESKTOP_APPS
    const appsToUse = scopeState
        ? getAppsForSurface('desktop', ALL_APPS, {
            canViewPlatform: scopeState.canViewPlatform,
            isAuthenticated: scopeState.isAuthenticated,
            isAdmin: scopeState.isAdmin ?? false,
            isEmailVerified: scopeState.isEmailVerified ?? false,
            accessMode: scopeState.accessMode,
            userRoles: scopeState.userRoles,
            minRole: scopeState.minRole ? (minRole?: string) => scopeState.minRole!(minRole || '') : undefined,
          })
        : DESKTOP_APPS

    for (const app of appsToUse) {
        if (!app.desktopWidget) continue
        registry[app.desktopWidget.widgetId] = {
            title: app.name,
            icon: app.desktopWidget.icon,
            defaultSize: app.desktopWidget.defaultSize,
            component: null,
        }
    }
    return registry
}

/**
 * Filter apps by connection mode.
 * - 'local':      only apps that work offline (availability === 'local')
 * - 'gateway':    local + gateway apps
 * - 'full-stack': all apps
 */
export function getAppsForConnectionMode(
    apps: AitherApp[],
    mode: 'local' | 'gateway' | 'full-stack',
): AitherApp[] {
    if (mode === 'full-stack') return apps
    if (mode === 'gateway') return apps.filter(a => a.availability !== 'full-stack')
    return apps.filter(a => a.availability === 'local')
}

/** Category display config */
export const CATEGORY_CONFIG: Record<AppCategory, { label: string; order: number }> = {
    core: { label: 'Core', order: 0 },
    agents: { label: 'Agents', order: 1 },
    creative: { label: 'Creative', order: 2 },
    dev: { label: 'Dev', order: 3 },
    social: { label: 'Social', order: 4 },
    labs: { label: 'Labs', order: 5 },
    monitor: { label: 'Monitor', order: 6 },
    infra: { label: 'Infrastructure', order: 7 },
    admin: { label: 'Admin', order: 8 },
    utility: { label: 'Utility', order: 9 },
}
