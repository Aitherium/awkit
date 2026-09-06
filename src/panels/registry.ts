/**
 * Portal-Kit Panel Registry
 * =========================
 * Machine-readable metadata for every awkit panel.
 * Used by the Agent Builder wizard, app generator, and MCP tools
 * to enumerate available panels and their requirements.
 */

export type PanelCategory =
  | 'core'
  | 'business'
  | 'commerce'
  | 'analytics'
  | 'integrations'
  | 'admin'
  | 'creative'
  | 'infrastructure'
  | 'intelligence'
  | 'marketplace'
  | 'utility'

export interface PanelMeta {
  /** Stable panel ID — maps to component export name (without "Panel" suffix) */
  id: string
  /** Human-readable name */
  name: string
  /** Short description */
  description: string
  /** Category for grouping in the builder UI */
  category: PanelCategory
  /** Lucide icon name (lowercase, kebab-case) */
  icon: string
  /** API route prefix this panel expects */
  apiPrefix?: string
  /** Backend router files needed (relative to awkit-backend/) */
  requiresBackend?: string[]
  /** Whether this panel should be included by default in new apps */
  defaultEnabled?: boolean
  /** Panels that this one depends on (must also be enabled) */
  dependsOn?: string[]
  /** Minimum plan required to install this panel */
  planRequirement?: 'free' | 'pro' | 'enterprise'
  /** Capability domain this panel belongs to (matches capability_domains.yaml) */
  domain?: string
  /** Which scope tier(s) this panel is visible in (default: ['tenant', 'user']) */
  tiers?: ('platform' | 'tenant' | 'user' | 'public')[]
  /** If true, this panel shows tenant-filtered data per tenant */
  tenantIsolated?: boolean
  /** If true, this panel can sync state to a local awnode via Elysium */
  elysiumSyncable?: boolean
  /** Panel readiness state: usable|demo|gated|unbuilt (default: usable) */
  state?: 'usable' | 'demo' | 'gated' | 'unbuilt'
}

export const PANEL_REGISTRY: PanelMeta[] = [
  // ── Intelligence ──────────────────────────────────────────────────
  {
    id: 'experiments',
    name: 'Experiments',
    description: 'Plan, launch and watch experiments — every lane (ratchet, fine-tunes, benchmark arms) writes to one ledger',
    category: 'intelligence',
    icon: 'flask-conical',
    apiPrefix: '/api/v1/experiments',
    requiresBackend: ['experiments.py'],
    planRequirement: 'free',
    domain: 'training',
  },
  {
    id: 'training-jobs',
    name: 'Training Jobs',
    description: 'Running and finished training runs with their metrics and artifacts, read from the training ledger',
    category: 'intelligence',
    icon: 'activity',
    apiPrefix: '/api/v1/training-jobs',
    requiresBackend: ['training_jobs.py'],
    planRequirement: 'free',
    domain: 'training',
  },
  {
    id: 'nanobrain',
    name: 'AitherNanoBrain',
    description: 'Tiny models that learn your platform — trained in seconds, served in milliseconds, no GPU',
    category: 'intelligence',
    icon: 'brain-circuit',
    apiPrefix: '/api/v1/nanobrain',
    requiresBackend: ['nanobrain.py'],
    planRequirement: 'free',
    domain: 'training',
  },
  {
    id: 'aither-capture',
    name: 'AitherCapture',
    description: 'Capture Claude Code, Codex, Copilot, Cursor & Antigravity sessions into clean ShareGPT datasets you own',
    category: 'intelligence',
    icon: 'radio-tower',
    apiPrefix: '/api/v1/aither-capture',
    requiresBackend: ['aither_capture.py'],
    planRequirement: 'free',
    domain: 'training',
  },
  {
    id: 'elysium-credits',
    name: 'Elysium Credits',
    description: 'Sovereign replica hosting earnings — accrued credits, balance, and signed-attestation ledger (ELYSIUM S1)',
    category: 'business',
    icon: 'coins',
    apiPrefix: '/api',
    requiresBackend: ['AitherACTA.py', 'AitherElysium.py'],
    planRequirement: 'free',
    domain: 'elysium',
  },
  // ── Core ──────────────────────────────────────────────────────────
  {
    id: 'my-hardware',
    name: 'My Hardware',
    description:
      'Enroll your own machine as a node and run inference on it — device list, ' +
      'enrollment, and installer downloads',
    category: 'infrastructure',
    icon: 'cpu',
    apiPrefix: '/api/devices',
    requiresBackend: ['devices.py'],
    // Off by default — most tenants never bring hardware — but REGISTERED, so a
    // pack can now ask for it. It was exported from panels/index.ts and absent
    // from this registry, which meant `enabled_panels` could not name it and no
    // tenant app could surface self-service hardware at all. An unregistered
    // panel is not "disabled", it is unreachable, and the two panels missing
    // here were exactly the bring-your-own-compute surfaces.
    defaultEnabled: false,
  },
  {
    id: 'chat',
    name: 'Chat',
    description: 'AI conversational interface with RAG and tool calling',
    category: 'core',
    icon: 'message-circle',
    apiPrefix: '/api/chat',
    requiresBackend: ['chat.py'],
    defaultEnabled: true,
  },
  {
    id: 'dashboard',
    name: 'Dashboard',
    description: 'Overview with stat cards, activity feed, and quick actions',
    category: 'core',
    icon: 'layout-dashboard',
    apiPrefix: '/api/dashboard',
    requiresBackend: ['dashboard.py'],
    defaultEnabled: true,
  },
  {
    id: 'document',
    name: 'Documents',
    description: 'Upload, organize, search, and preview documents',
    category: 'core',
    icon: 'file-text',
    apiPrefix: '/api/documents',
    requiresBackend: ['documents.py'],
    defaultEnabled: true,
    domain: 'documents',
  },
  {
    id: 'esign',
    name: 'E-Sign',
    description: 'View PDFs and sign them in place — stamps signature, name, title, and date',
    category: 'core',
    icon: 'pen-tool',
    apiPrefix: '/api/esign',
    requiresBackend: ['esign.py'],
    defaultEnabled: true,
    dependsOn: ['document'],
    domain: 'documents',
  },
  {
    id: 'document-lifecycle',
    name: 'Document Lifecycle',
    description: 'Version history, diffs, timeline, and entity relationships for all documents',
    category: 'core',
    icon: 'git-compare',
    apiPrefix: '/api/documents/lifecycle',
    requiresBackend: ['document_lifecycle.py'],
    defaultEnabled: true,
    dependsOn: ['document'],
    domain: 'documents',
  },
  {
    id: 'mail',
    name: 'Mail',
    description: 'Email client with folders, compose, and thread view',
    category: 'core',
    icon: 'mail',
    apiPrefix: '/api/mail',
    requiresBackend: ['mail.py'],
    domain: 'calendar_mail',
  },
  {
    id: 'comms',
    name: 'Communications',
    description: 'Internal messaging and notification center',
    category: 'core',
    icon: 'messages-square',
    apiPrefix: '/api/comms',
    requiresBackend: ['comms.py'],
  },
  {
    id: 'forum',
    name: 'Forum',
    description: 'Discussion boards with threads, categories, and voting',
    category: 'core',
    icon: 'message-square-text',
    apiPrefix: '/api/forum',
    requiresBackend: ['forum.py'],
  },
  {
    id: 'pages',
    name: 'Pages',
    description: 'Collaborative document editor with page tree, formatting toolbar, and slash commands',
    category: 'core',
    icon: 'notebook-pen',
    apiPrefix: '/api/docs',
    requiresBackend: ['docs.py'],
    defaultEnabled: true,
    domain: 'documents',
  },
  {
    id: 'portal-files',
    name: 'File Manager',
    description: 'Browse, upload, and manage workspace files',
    category: 'core',
    icon: 'folder-open',
    apiPrefix: '/api/files',
    requiresBackend: ['files.py'],
    planRequirement: 'free',
    domain: 'workspace',
  },

  // ── Business ──────────────────────────────────────────────────────
  {
    id: 'autonomy-roadmap',
    name: 'Autonomy Roadmap',
    description: 'Live checklist for running, marketing & selling autonomously — agent-actionable',
    category: 'business',
    icon: 'route',
    apiPrefix: '/api/business',
    requiresBackend: ['autonomy_roadmap.py'],
    domain: 'business-intelligence',
  },
  {
    id: 'calendar',
    name: 'Calendar',
    description: 'Events, agenda, booking, and external calendar sync',
    category: 'business',
    icon: 'calendar',
    apiPrefix: '/api/calendar',
    requiresBackend: ['calendar_app.py'],
    domain: 'calendar_mail',
  },
  {
    id: 'task-board',
    name: 'Task Board',
    description: 'Kanban board with swimlanes, priorities, and assignments',
    category: 'business',
    icon: 'kanban',
    apiPrefix: '/api/tasks',
    requiresBackend: ['tasks.py'],
  },
  {
    id: 'contacts',
    name: 'Contacts',
    description: 'Contact management with tags, notes, and activity timeline',
    category: 'business',
    icon: 'contact',
    apiPrefix: '/api/contacts',
    requiresBackend: ['contacts.py'],
    domain: 'people',
  },
  {
    id: 'clients',
    name: 'Clients',
    description: 'Client relationship management with projects and billing',
    category: 'business',
    icon: 'building-2',
    apiPrefix: '/api/bridge/genesis/api/v1/commerce',
    requiresBackend: ['clients.py'],
  },
  {
    id: 'invoicing',
    name: 'Invoicing',
    description: 'Create invoices, track payments, and manage billing',
    category: 'business',
    icon: 'receipt',
    apiPrefix: '/api/invoicing',
    requiresBackend: ['invoicing.py'],
  },
  {
    id: 'stripe-commerce',
    name: 'Stripe Commerce',
    description: 'Full storefront with Stripe — products, checkout, subscriptions, refunds, coupons, and revenue analytics',
    category: 'business',
    icon: 'credit-card',
    apiPrefix: '/api/bridge/genesis/api/v1/commerce',
    requiresBackend: ['stripe_commerce.py'],
    planRequirement: 'pro',
    domain: 'commerce',
  },
  {
    id: 'awrtifact',
    name: 'awrtifact — Artifact Store',
    description: 'Chunk artifacts into GitHub release assets and fetch them back byte-verified from artifact.aitherium.com — the deliberate mirror lane',
    category: 'utility',
    icon: 'package',
    apiPrefix: '/api/bridge/genesis/api/v1/awrtifact',
    requiresBackend: ['awrtifact.py'],
    domain: 'storage',
  },
  {
    id: 'taxdesk',
    name: 'TaxDesk',
    description: 'Personal tax prep & CPA partner — ingest bank statements, tax forms, receipts; build a deduplicated ledger; organize by category and Schedule C lines. Privacy-first, local models, tenant-scoped data.',
    category: 'business',
    icon: 'receipt-text',
    apiPrefix: '/api/taxdesk',
    planRequirement: 'pro',
    domain: 'finance',
    tenantIsolated: true,
  },
  {
    id: 'aither-sprite',
    name: 'Sprite',
    description: 'Your AI companion creature — feed it, play with it, talk to it, and watch it evolve',
    category: 'creative',
    icon: 'heart',
    apiPrefix: '/api/sprite',
    requiresBackend: ['aither_sprite.py'],
  },
  {
    id: 'booking',
    name: 'Booking',
    description: 'Appointment scheduling with availability and reminders',
    category: 'business',
    icon: 'calendar-check',
    apiPrefix: '/api/booking',
    requiresBackend: ['booking.py'],
  },
  {
    id: 'forms',
    name: 'Forms',
    description: 'Drag-and-drop form builder with submissions and analytics',
    category: 'business',
    icon: 'clipboard-list',
    apiPrefix: '/api/forms',
    requiresBackend: ['forms.py'],
  },
  {
    id: 'poll',
    name: 'Polls',
    description: 'Create polls/surveys, email them to subscribers, embed in posts, and see live results',
    category: 'business',
    icon: 'bar-chart-3',
    apiPrefix: '/api/polls',
    requiresBackend: ['polls.py'],
    // Sold as the purchasable "polls-pack" (packs_catalog.yaml). The panel
    // marketplace gates enabling it on the plan; the backend enforces the
    // pack entitlement (AITHER_POLLS_LICENSE_GATE).
    planRequirement: 'pro',
  },
  {
    id: 'people',
    name: 'People',
    description: 'Team directory with roles, departments, and org chart',
    category: 'business',
    icon: 'users',
    apiPrefix: '/api/people',
    requiresBackend: ['people.py'],
    domain: 'people',
  },
  {
    id: 'approval-queue',
    name: 'Approval Queue',
    description: 'Review and approve pending requests and submissions',
    category: 'business',
    icon: 'check-circle',
    apiPrefix: '/api/approvals',
    requiresBackend: ['approvals.py'],
  },
  {
    id: 'approvals-inbox',
    name: 'Approvals Inbox',
    description: 'Unified inbox for all pending approvals (expeditions, pilots, access requests)',
    category: 'admin',
    icon: 'inbox',
    apiPrefix: '/api/approvals',
  },
  {
    id: 'decisions',
    name: 'Decision Cards',
    description: 'Pending decisions from agents — structured approvals with options and consequences',
    category: 'admin',
    icon: 'alert-circle',
    apiPrefix: '/api/v1/decisions',
    defaultEnabled: false,
    domain: 'automation',
  },
  {
    id: 'batch-upload',
    name: 'Batch Upload',
    description: 'Bulk file upload with progress tracking and validation',
    category: 'business',
    icon: 'upload-cloud',
    apiPrefix: '/api/batch',
    requiresBackend: ['batch.py'],
  },
  {
    id: 'requests',
    name: 'Requests',
    description: 'Manage incoming project requests, quotes, and client communication',
    category: 'business',
    icon: 'inbox',
    apiPrefix: '/api/bridge/genesis',
    requiresBackend: ['project_requests.py'],
  },

  // ── Commerce ─────────────────────────────────────────────────────
  {
    id: 'storefront-shell',
    name: 'Storefront Shell',
    description: 'Public storefront wrapper with header, footer, cart, and checkout',
    category: 'commerce',
    icon: 'store',
    apiPrefix: '/api/store',
    requiresBackend: ['storefront_public.py'],
    dependsOn: ['stripe-commerce'],
    domain: 'commerce',
  },
  {
    id: 'product-catalog',
    name: 'Product Catalog',
    description: 'Public product browsing with filtering and search',
    category: 'commerce',
    icon: 'shopping-bag',
    apiPrefix: '/api/bridge/genesis/shop',
    requiresBackend: ['storefront_public.py'],
    dependsOn: ['stripe-commerce'],
    domain: 'commerce',
  },
  {
    id: 'landing-page',
    name: 'Landing Page',
    description: 'Public landing page with hero, features, and brand story sections',
    category: 'commerce',
    icon: 'globe',
    apiPrefix: '/api/landing',
    requiresBackend: ['landing.py'],
  },

  // ── Analytics ─────────────────────────────────────────────────────
  {
    id: 'analytics',
    name: 'Analytics',
    description: 'Charts, metrics, and data visualization dashboards',
    category: 'analytics',
    icon: 'bar-chart-3',
    apiPrefix: '/api/analytics',
    requiresBackend: ['analytics.py'],
  },
  {
    id: 'audit',
    name: 'Audit Log',
    description: 'Activity trail with filters, search, and export',
    category: 'analytics',
    icon: 'shield-check',
    apiPrefix: '/api/audit',
    requiresBackend: ['audit.py'],
  },
  {
    id: 'activity-feed',
    name: 'Activity Feed',
    description: 'Real-time feed of system and user activity events',
    category: 'analytics',
    icon: 'activity',
    apiPrefix: '/api/activity',
    requiresBackend: ['activity.py'],
  },
  {
    id: 'reliability-dashboard',
    name: 'Reliability',
    description: 'Service health, uptime tracking, and incident timeline',
    category: 'analytics',
    icon: 'heart-pulse',
    apiPrefix: '/api/reliability',
    requiresBackend: ['reliability.py'],
  },

  // ── Creative ──────────────────────────────────────────────────────
  {
    id: 'blog',
    name: 'Blog',
    description: 'Create, edit, publish, and manage blog posts with tenant scoping',
    category: 'creative',
    icon: 'newspaper',
    apiPrefix: '/api/blog',
    requiresBackend: ['blog.py'],
    defaultEnabled: true,
    domain: 'content',
  },
  {
    id: 'writer',
    name: 'AitherWriter',
    description: 'Editorial CMS with scheduled publishing, human review, AI content generation, social distribution, supersession tracking, and git versioning',
    category: 'creative',
    icon: 'book-open-text',
    apiPrefix: '/api/blog',
    requiresBackend: ['blog.py', 'writer.py'],
    dependsOn: ['blog'],
    defaultEnabled: true,
    domain: 'content',
  },
  {
    id: 'cms',
    name: 'CMS',
    description: 'Content management with blog, newsletter campaigns, contacts, and distribution lists',
    category: 'creative',
    icon: 'newspaper',
    apiPrefix: '/api',
    requiresBackend: ['blog.py', 'contacts.py'],
    dependsOn: ['blog'],
    domain: 'content',
  },
  {
    id: 'content-studio',
    name: 'Content Studio',
    description: 'Rich content editor with AI writing assistance',
    category: 'creative',
    icon: 'pen-line',
    apiPrefix: '/api/content',
    requiresBackend: ['content.py'],
  },
  {
    id: 'generate',
    name: 'Generate',
    description: 'AI content generation for text, images, and documents',
    category: 'creative',
    icon: 'sparkles',
    apiPrefix: '/api/generate',
    requiresBackend: ['generate.py'],
  },
  {
    id: 'sound-library',
    name: 'Sound Library',
    description: 'Upload, organize, and preview audio assets for storefronts',
    category: 'creative',
    icon: 'music',
    apiPrefix: '/api/assets',
    requiresBackend: ['assets.py'],
    defaultEnabled: false,
  },

  // ── Integrations ──────────────────────────────────────────────────
  {
    id: 'social',
    name: 'Social',
    description: 'Social media management with scheduling and analytics',
    category: 'integrations',
    icon: 'share-2',
    apiPrefix: '/api/social',
    requiresBackend: ['social.py'],
    domain: 'social_marketing',
  },
  {
    id: 'integrations',
    name: 'Integrations',
    description: 'Connect third-party services (Stripe, Slack, etc.)',
    category: 'integrations',
    icon: 'plug',
    apiPrefix: '/api/integrations',
    requiresBackend: ['integrations.py'],
  },
  {
    id: 'webhooks',
    name: 'Webhooks',
    description: 'Incoming and outgoing webhook management',
    category: 'integrations',
    icon: 'webhook',
    apiPrefix: '/api/webhooks',
    requiresBackend: ['webhooks.py'],
  },
  {
    id: 'file-sync',
    name: 'File Sync',
    description: 'Sync files with cloud storage (S3, GDrive, OneDrive)',
    category: 'integrations',
    icon: 'cloud-upload',
    apiPrefix: '/api/file-sync',
    requiresBackend: ['file_sync.py'],
    domain: 'proton_suite',
  },
  {
    id: 'database',
    name: 'Database',
    description: 'Browse and query structured data with table views',
    category: 'integrations',
    icon: 'database',
    apiPrefix: '/api/database',
    requiresBackend: ['database.py'],
  },

  // ── Admin ─────────────────────────────────────────────────────────
  {
    id: 'directory',
    name: 'Directory',
    description: 'User and group management with RBAC',
    category: 'admin',
    icon: 'users-round',
    apiPrefix: '/api/directory',
    requiresBackend: ['directory.py'],
    domain: 'people',
  },
  {
    id: 'secrets',
    name: 'Secrets',
    description: 'Credential vault with encrypted storage and rotation',
    category: 'admin',
    icon: 'key-round',
    apiPrefix: '/api/secrets',
    requiresBackend: ['secrets.py'],
  },
  {
    id: 'platform',
    name: 'Platform',
    description: 'Platform settings, licensing, and system configuration',
    category: 'admin',
    icon: 'settings-2',
    apiPrefix: '/api/platform',
    requiresBackend: ['platform.py'],
  },
  {
    id: 'llm-config',
    name: 'LLM Config',
    description: 'Configure AI model providers, API keys, and fallback chain',
    category: 'admin',
    icon: 'cpu',
    apiPrefix: '/api/settings/llm',
    requiresBackend: ['settings_api.py'],
    defaultEnabled: true,
  },
  {
    id: 'settings',
    name: 'Settings',
    description: 'User preferences, theme, notifications, and profile',
    category: 'admin',
    icon: 'settings',
    apiPrefix: '/api/settings',
    requiresBackend: ['settings.py'],
    defaultEnabled: true,
  },
  {
    id: 'preferences',
    name: 'Preferences',
    description: 'Workspace-level preferences and defaults',
    category: 'admin',
    icon: 'sliders-horizontal',
    apiPrefix: '/api/preferences',
    requiresBackend: ['preferences.py'],
  },
  {
    id: 'workspace-admin',
    name: 'Workspace Admin',
    description: 'Workspace configuration, members, and billing',
    category: 'admin',
    icon: 'shield',
    apiPrefix: '/api/workspace',
    requiresBackend: ['workspace.py'],
  },
  {
    id: 'inference-config',
    name: 'Inference',
    description: 'API keys, model routing, cloud mode, costs, and budget',
    category: 'admin',
    icon: 'cpu',
    apiPrefix: '/api/genesis/config/me/inference',
    requiresBackend: ['workspace_config.py'],
    defaultEnabled: true,
  },

  {
    id: 'ca',
    name: 'Certificate Authority',
    description: 'Private PKI — create CAs, issue certificates, manage revocation and trust chains',
    category: 'admin',
    icon: 'shield-check',
    apiPrefix: '/api/ca',
    requiresBackend: ['ca.py'],
    planRequirement: 'pro',
    domain: 'security',
  },

  // ── Infrastructure ────────────────────────────────────────────────
  {
    id: 'knowledge-rag',
    name: 'Knowledge RAG',
    description: 'Knowledge base management with document health auditing, auto-update, and interactive graph visualization',
    category: 'infrastructure',
    icon: 'book-open',
    apiPrefix: '/api/knowledge-rag',
    requiresBackend: ['knowledge_rag.py'],
    domain: 'documents',
  },
  {
    id: 'data-plane',
    name: 'Data Plane',
    description: 'Unified data sources, knowledge base, vector store, storage tiering, and distributed nodes',
    category: 'infrastructure',
    icon: 'database',
    apiPrefix: '/api/bridge/genesis/data-plane',
    requiresBackend: ['data_plane.py'],
    planRequirement: 'enterprise',
  },
  {
    id: 'agents',
    name: 'Agents',
    description: 'View and manage AI agent roster with dispatch controls',
    category: 'infrastructure',
    icon: 'bot',
    apiPrefix: '/api/agents',
    requiresBackend: ['agents.py'],
  },
  {
    id: 'agent-dispatch',
    name: 'Agent Dispatch',
    description: 'Manual agent task dispatch with parameters and monitoring',
    category: 'infrastructure',
    icon: 'send',
    apiPrefix: '/api/agents/dispatch',
    requiresBackend: ['agent_dispatch.py'],
    dependsOn: ['agents'],
  },
  {
    id: 'durability',
    name: 'Aither Durability',
    description: 'Per-user encrypted GitHub backup and DR restore — scope-diffed, key-rotated, write-back capable',
    category: 'infrastructure',
    icon: 'shield',
    // The backend lives on SecurityCore at /recover/user-backup/* (compound
    // mount), NOT a Veil /api/v1/durability route — there is no Veil proxy for
    // it yet. apiPrefix records the REAL backend so tooling doesn't assume a
    // Veil router exists. Panel is a demo shell until a proxy is wired.
    apiPrefix: '/recover',
    requiresBackend: ['AitherRecover.py'],
    state: 'demo',
    planRequirement: 'free',
    domain: 'infrastructure',
  },
  {
    id: 'planb-ledger',
    name: 'Plan B Ledger',
    description: 'Offline-first continuity ledger — digital + printable paper faces, checkbook discipline',
    category: 'business',
    icon: 'book-open-check',
    // Server-backed against routers/planb_ledger.py: one ledger per (tenant,
    // user), scope derived from the authenticated caller. Shares its merge
    // engine verbatim with the offline adk kit (planb_engine.py), so the
    // portal, the Discord bot and the printed sheet cannot disagree.
    apiPrefix: '/api/planb',
    requiresBackend: ['routers/planb_ledger.py'],
    state: 'usable',
    planRequirement: 'free',
    domain: 'business',
  },
  {
    id: 'quick-actions',
    name: 'Quick Actions',
    description: 'Configurable shortcut buttons for common operations',
    category: 'infrastructure',
    icon: 'zap',
    apiPrefix: '/api/actions',
    requiresBackend: ['actions.py'],
  },
  {
    id: 'packs',
    name: 'Extension Packs',
    description: 'Browse, subscribe, and manage MCP tool packs that extend agent capabilities',
    category: 'infrastructure',
    icon: 'package',
    apiPrefix: '/api/packs',
    requiresBackend: ['packs.py'],
  },
  {
    id: 'onboarding-wizard',
    name: 'Onboarding Wizard',
    description: 'Step-by-step setup wizard for new workspace members',
    category: 'infrastructure',
    icon: 'rocket',
    apiPrefix: '/api/onboarding',
    requiresBackend: ['onboarding.py'],
  },

  // -- Intelligence ────────────────────────────────────────────────
  {
    id: 'aithergraph',
    name: 'AitherGraph',
    description: 'Unified intelligence graph — code search, knowledge RAG, event causality, memory, freshness auditing, autonomous research',
    category: 'intelligence',
    icon: 'brain-circuit',
    apiPrefix: '/api/graph',
    requiresBackend: ['aithergraph.py'],
    planRequirement: 'pro',
  },
  {
    id: 'beadspace',
    name: 'Bead Space',
    description:
      'The work graph as a navigable universe — tasks, services, the agent constellation, the GPU pool and the code scope graph as planets, with dependencies as flight paths and active owners as orbiting ships',
    category: 'intelligence',
    icon: 'orbit',
    /*
     * No single apiPrefix: this panel switches across SIX endpoints (/tasks, /services,
     * /constellation, /compute/pool, /scope/graph/unified, /services/registry), all under
     * the host app's apiBase. Naming one would misreport what it needs. It also has NO
     * requiresBackend — every route it reads already exists in AitherVeil; the panel adds
     * no backend of its own.
     */
    defaultEnabled: false,
  },
  {
    id: 'escalations',
    name: 'Escalations',
    description: 'Human-in-the-loop approval queue — review and resolve agent escalation requests',
    category: 'admin',
    icon: 'shield-alert',
    apiPrefix: '/escalations',
    defaultEnabled: false,
  },
  {
    id: 'workspace-config',
    name: 'Workspace Config',
    description: 'Self-service workspace configuration — identity, features, branding, LLM, and verification gates',
    category: 'admin',
    icon: 'wrench',
    apiPrefix: '/workspaces',
    requiresBackend: ['workspace_reconfig.py'],
  },
  {
    id: 'workspace-cycles',
    name: 'Workspace Cycles',
    description: 'Manage recurring agent cycles — create, pause, execute, and view history',
    category: 'infrastructure',
    icon: 'repeat',
    apiPrefix: '/workspaces',
    requiresBackend: ['workspace_cycles.py'],
  },
  {
    id: 'execution-audit',
    name: 'Execution Audit',
    description: 'Searchable audit trail for all workspace cycle executions with gate results',
    category: 'analytics',
    icon: 'scroll-text',
    apiPrefix: '/workspaces',
    requiresBackend: ['workspace_cycles.py'],
    dependsOn: ['workspace-cycles'],
  },
  {
    id: 'data-source-setup',
    name: 'Data Source Setup',
    description: 'Guided wizard for connecting email, calendar, file storage, and employee directory',
    category: 'integrations',
    icon: 'plug-zap',
    apiPrefix: '/api/onboarding',
    requiresBackend: ['onboarding.py', 'workspace_mail.py', 'workspace_directory.py', 'file_sync.py', 'calendar.py'],
    defaultEnabled: true,
  },

  // ── Workspace Management ───────────────────────────────────────────
  {
    id: 'brand-designer',
    name: 'Brand Designer',
    description: 'Live visual brand editor — colors, typography, logo, theme mode with instant CSS variable preview',
    category: 'admin',
    icon: 'palette',
    apiPrefix: '/api/brand',
    requiresBackend: ['brand.py'],
  },
  {
    id: 'feature-marketplace',
    name: 'Feature Marketplace',
    description: 'Browse, install, and remove panels post-deployment with plan-aware gating',
    category: 'admin',
    icon: 'package',
    apiPrefix: '/workspaces',
    requiresBackend: ['workspace_reconfig.py'],
  },

  // ── Proton Suite ────────────────────────────────────────────────
  {
    id: 'proton-suite',
    name: 'Proton Suite',
    description: 'Unified dashboard for Proton Mail, Calendar, Drive, VPN, and Pass with BYOK setup',
    category: 'integrations',
    icon: 'shield-check',
    apiPrefix: '/api/mail',
    requiresBackend: ['mail.py', 'calendar.py', 'file_sync.py'],
    dependsOn: ['mail'],
    planRequirement: 'free',
    domain: 'proton_suite',
  },
  {
    id: 'proton-drive',
    name: 'Proton Drive',
    description: 'Encrypted file browser with folder tree, upload/download, and sync status via rclone',
    category: 'integrations',
    icon: 'hard-drive',
    apiPrefix: '/api/file-sync',
    requiresBackend: ['file_sync.py'],
    dependsOn: ['proton-suite'],
    planRequirement: 'free',
    domain: 'proton_suite',
  },
  {
    id: 'proton-vpn',
    name: 'Proton VPN',
    description: 'WireGuard VPN connection management with server selection and kill switch',
    category: 'integrations',
    icon: 'shield',
    apiPrefix: '/api/proton-vpn',
    requiresBackend: ['proton_vpn.py'],
    dependsOn: ['proton-suite'],
    planRequirement: 'pro',
    domain: 'proton_suite',
  },
  {
    id: 'social-graph',
    name: 'Social Graph',
    description: 'Interactive network visualization of social relationships, connection strength, mutual friends, and interaction tracking',
    category: 'intelligence',
    icon: 'network',
    apiPrefix: '/api/graph/social',
    requiresBackend: ['socialgraph.py'],
    dependsOn: ['people'],
  },
  {
    id: 'marketing-calendar',
    name: 'Marketing Calendar',
    description: 'Visual calendar grid for scheduling and managing social media posts across platforms',
    category: 'creative',
    icon: 'calendar-days',
    apiPrefix: '/api/social',
    requiresBackend: ['social.py'],
    planRequirement: 'pro',
    domain: 'social_marketing',
  },
  {
    id: 'post-composer',
    name: 'Post Composer',
    description: 'Rich post creation with cross-platform preview, AI generation, and scheduling',
    category: 'creative',
    icon: 'edit',
    apiPrefix: '/api/social',
    requiresBackend: ['social.py'],
    planRequirement: 'pro',
    domain: 'social_marketing',
  },
  {
    id: 'marketing-dashboard',
    name: 'Marketing Dashboard',
    description: 'Cross-platform analytics with reach, engagement, follower growth, and top posts',
    category: 'analytics',
    icon: 'line-chart',
    apiPrefix: '/api/social',
    requiresBackend: ['social.py'],
    planRequirement: 'pro',
    domain: 'social_marketing',
  },
  {
    id: 'workspace-intelligence',
    name: 'Workspace Intelligence',
    description: 'Workspace health score, engagement metrics, meeting analytics, email intelligence, and top contributors',
    category: 'analytics',
    icon: 'brain',
    apiPrefix: '/api/workspace-intelligence',
    requiresBackend: ['workspace_intelligence.py'],
    planRequirement: 'pro',
    domain: 'workspace_intelligence',
  },
  {
    id: 'relationship-dashboard',
    name: 'Relationship Dashboard',
    description: 'Network density, relationship types, connectors vs isolated, collaboration pairs, silo detection',
    category: 'intelligence',
    icon: 'network',
    apiPrefix: '/api/workspace-intelligence',
    requiresBackend: ['workspace_intelligence.py'],
    dependsOn: ['people'],
    planRequirement: 'pro',
    domain: 'workspace_intelligence',
  },
  {
    id: 'executive-briefing',
    name: 'Executive Briefing',
    description: 'Unified morning briefing with calendar, priority inbox, tasks, and AI meeting prep',
    category: 'business',
    icon: 'briefcase',
    apiPrefix: '/api/executive',
    requiresBackend: ['executive_briefing.py'],
    planRequirement: 'pro',
    dependsOn: ['calendar', 'mail'],
    domain: 'executive_assistant',
  },
  {
    id: 'proton-pass',
    name: 'Proton Pass',
    description: 'Read-only credential vault access for agent autofill and RPA automation',
    category: 'integrations',
    icon: 'key-round',
    apiPrefix: '/api/proton-pass',
    requiresBackend: ['proton_pass.py'],
    dependsOn: ['proton-suite'],
    planRequirement: 'free',
    domain: 'proton_suite',
  },

  // ── Marketplace & Builder ──────────────────────────────────────────
  {
    id: 'agent-builder',
    name: 'Agent Builder',
    description: 'Build custom AI agents with templates, packs, skills, tools, and live preview',
    category: 'marketplace',
    icon: 'bot',
    apiPrefix: '/api/agent-builder',
    requiresBackend: ['agent_builder.py'],
  },
  {
    id: 'pack-catalog',
    name: 'Pack Catalog',
    description: 'Browse and purchase agent, skill, and tool packs from the marketplace',
    category: 'marketplace',
    icon: 'package',
    apiPrefix: '/api/marketplace/packs',
  },
  {
    id: 'my-packs',
    name: 'My Packs',
    description: 'View installed packs, manage licenses, and uninstall packs',
    category: 'marketplace',
    icon: 'box',
    apiPrefix: '/api/packs',
    defaultEnabled: true,
  },
  {
    id: 'fleet-dashboard',
    name: 'Fleet Dashboard',
    description: 'Register, monitor, and dispatch to deployed agent endpoints across your fleet',
    category: 'marketplace',
    icon: 'network',
    apiPrefix: '/api/fleet',
    requiresBackend: ['fleet.py'],
    planRequirement: 'pro',
  },
  {
    id: 'model-browser',
    name: 'Model Browser',
    description: 'Hardware-aware model selector with recommendations based on your GPU',
    category: 'marketplace',
    icon: 'cpu',
    apiPrefix: '/api/marketplace/models',
  },

  // ── Product connectors (net-new) ───────────────────────────────────
  {
    id: 'sprout-studio',
    name: 'Sprout Studio',
    description: 'Photography studio CRM — clients, sessions, and calendar synced from Sprout Studio',
    category: 'business',
    icon: 'camera',
    apiPrefix: '/api/sprout-studio',
    requiresBackend: ['sprout_studio.py'],
    domain: 'workspace',
  },
  {
    id: 'ai-search',
    name: 'AI Search',
    description: 'AI-enhanced web search (DuckDuckGo) with LLM synthesis and cited sources — self-hosted, no API key',
    category: 'core',
    icon: 'search',
    apiPrefix: '/api/ai-search',
    requiresBackend: ['ai_search.py'],
    domain: 'knowledge',
  },
  {
    id: 'migration',
    name: 'Migration & CRM',
    description: 'Mirror a locked-in SaaS (Sprout Studio) into your own CRM via the companion extension, Zapier, and CSV — powered by Untether',
    category: 'business',
    icon: 'database',
    apiPrefix: '/api/untether',
    requiresBackend: ['untether_backend'],
    domain: 'workspace',
  },
  {
    id: 'onboarding-setup',
    name: 'Get Set Up',
    description: 'Guided onboarding wizard — connect data sources, mirror the CRM, learn brand voice, and activate automation (agent-driven)',
    category: 'core',
    icon: 'rocket',
    apiPrefix: '/api/onboarding',
    requiresBackend: ['onboarding_orchestrator.py'],
    domain: 'workspace',
  },
  {
    id: 'workspace-members',
    name: 'Team Members',
    description: 'Manage workspace members, invite colleagues, and control access roles',
    category: 'admin',
    icon: 'users',
    apiPrefix: '/api/workspace',
    planRequirement: 'free',
    tenantIsolated: true,
    tiers: ['tenant'],
  },
  {
    id: 'deployed-apps',
    name: 'Deployed Apps',
    description: 'Monitor and manage deployed applications — view status, restart, scale, and delete',
    category: 'admin',
    icon: 'package',
    apiPrefix: '/api/apps',
    planRequirement: 'free',
    tenantIsolated: true,
    tiers: ['tenant'],
  },
  // ── GobboNet ──────────────────────────────────────────────────
  {
    id: 'lockbox',
    name: 'Lockbox',
    description: 'Private prompt vault for secure system prompts and templates',
    category: 'admin',
    icon: 'lock-keyhole',
    apiPrefix: '/lockbox',
  },
  {
    id: 'certificates',
    name: 'Certificates',
    description: 'Issue and manage this workspace’s own certificates',
    category: 'admin',
    icon: 'shield-check',
    apiPrefix: '/cert',
  },
  {
    id: 'gobbonet',
    // Renamed 2026-09-01 (owner): Elysium is the desktop name of the
    // local-first chat client. The id stays 'gobbonet' (route + wiring).
    name: 'Elysium',
    description: 'Local-first AI chat with character cards, RAG lorebook, and multiple backends',
    category: 'creative',
    icon: 'message-circle',
    // GobboNet is a self-contained SPA housed at /gobbonet (same-origin mount).
    // IndexedDB isolation per-origin is resolved by serving it from the portal's own origin.
    apiPrefix: '/gobbonet',
    planRequirement: 'free',
    state: 'usable',
  },

  // ── Declared 2026-08-01 ───────────────────────────────────────────
  // These five shipped a component in PANEL_COMPONENTS and appeared in NO
  // registry. The launcher enumerates the REGISTRY, so a component with no
  // entry here is unreachable through the UI no matter how well it renders —
  // the mirror image of the seven panels this registry advertised without a
  // component. Both directions make the platform look smaller than it is.
  {
    id: 'notebooks',
    name: 'Agent Notebooks',
    description: 'Executable notebooks agents can read, run and extend',
    category: 'intelligence',
    icon: 'notebook-pen',
    apiPrefix: '/api/notebooks',
    planRequirement: 'free',
  },
  {
    id: 'skill-library',
    name: 'Skill Library',
    description: 'Skills your agents can load, browse and install',
    category: 'intelligence',
    icon: 'library',
    apiPrefix: '/api/skills',
    planRequirement: 'free',
  },
  {
    id: 'personal-automation',
    name: 'Personal Automation',
    description: 'Your own routines and triggers, without writing a service',
    category: 'core',
    icon: 'workflow',
    apiPrefix: '/api/automation',
    planRequirement: 'free',
  },
  {
    id: 'profile',
    name: 'Profile',
    description: 'Your identity, preferences and connected accounts',
    category: 'core',
    icon: 'user-round',
    apiPrefix: '/api/profile',
    planRequirement: 'free',
  },
  {
    id: 'support',
    name: 'Support',
    description: 'Reach a human, or an agent that can escalate to one',
    category: 'core',
    icon: 'life-buoy',
    apiPrefix: '/api/support',
    planRequirement: 'free',
  },

  // NOTE: CertificateAuthorityPanel is registered as `ca` (above), not
  // `certificate-authority`. PRP001 derives its expected id from the
  // component NAME, so it reports that panel as unregistered forever --
  // a blind spot in the rule, not a missing panel. Registering it a
  // second time under the derived id would add a DEAD surface: the
  // render map keys on `ca`, so the duplicate renders an empty window.
  // Recorded in PRP001_ID_ALIASES instead.
  //
  {
    id: 'stream-tugofwar',
    name: 'Tug of War',
    description: 'Live donation tug-of-war overlay for a stream, with a decision timer and big-donation pops',
    category: 'integrations',
    icon: 'activity',
    domain: 'media',
    tenantIsolated: true,
    state: 'usable',
  },
  {
    id: 'github-repos',
    name: 'GitHub',
    description: "Your org's repos and issues, openable in ForgeIDE or handed to Demiurge/Atlas",
    category: 'integrations',
    icon: 'github',
    apiPrefix: '/api/github',
    requiresBackend: ['github.py'],
    domain: 'development',
    tenantIsolated: true,
    state: 'usable',
  },
  // Registered 2026-08-20 ------------------------------------------
  // Each of these four was FULLY BUILT and EXPORTED, and no tenant could
  // ever enable it, because a pack may only name an id the registry
  // knows. PRP001 had been counting them as an accepted backlog.
  //
  // The failure is a SILENCE, which is why it survived: an id with no
  // registry entry is not an error the builder reports, it is a panel
  // that is simply never offered. Nobody sees a missing option. The
  // dgg pack carries a comment describing exactly this class after
  // `tickets` and `events` were found un-renderable on 2026-08-19 --
  // and a comment is not a gate, so the other direction (a real panel
  // nobody can ask for) went on being true.
  //
  // Readiness was checked before registering, not assumed: every one has
  // real API calls and no stub markers. An earlier pass called them
  // half-built by grepping for "placeholder", which matched the HTML
  // input attribute -- so `state: 'usable'` here is a measurement, not
  // an aspiration.
  {
    id: 'tasks',
    name: 'Tasks',
    description: 'Task list with filters, search and assignment - the list view beside task-board\'s kanban',
    category: 'business',
    icon: 'list-checks',
    apiPrefix: '/api/tasks',
    requiresBackend: ['tasks.py'],
    domain: 'productivity',
    tenantIsolated: true,
    state: 'usable',
  },
  {
    id: 'relay-channels',
    name: 'Relay Channels',
    description: 'Workspace chat channels with history - the in-app AitherRelay surface',
    category: 'core',
    icon: 'messages-square',
    apiPrefix: '/api',
    requiresBackend: ['relay.py'],
    domain: 'communication',
    tenantIsolated: true,
    state: 'usable',
  },
  {
    id: 'sso-settings',
    name: 'SSO Settings',
    description: 'Configure your own SAML 2.0 / Entra identity provider without asking us',
    category: 'admin',
    icon: 'key-round',
    apiPrefix: '/api/admin',
    requiresBackend: ['saml_idp.py'],
    domain: 'security',
    tenantIsolated: true,
    planRequirement: 'enterprise',
    state: 'usable',
  },
  {
    id: 'sso-oidc',
    name: 'SSO (OIDC)',
    description: 'Connect Microsoft Entra ID (or any OIDC IdP) — brokered sign-in, JIT provisioning, domain-claim gate',
    category: 'admin',
    icon: 'key-round',
    apiPrefix: '/api/workspace',
    requiresBackend: ['AitherIdentity.py'],
    domain: 'security',
    tenantIsolated: true,
    planRequirement: 'enterprise',
    state: 'usable',
  },
]

/** Lookup panel by ID */
export function getPanelById(id: string): PanelMeta | undefined {
  return PANEL_REGISTRY.find(p => p.id === id)
}

/** Get panels grouped by category */
export function getPanelsByCategory(): Record<PanelCategory, PanelMeta[]> {
  const groups: Record<string, PanelMeta[]> = {}
  for (const panel of PANEL_REGISTRY) {
    if (!groups[panel.category]) groups[panel.category] = []
    groups[panel.category].push(panel)
  }
  return groups as Record<PanelCategory, PanelMeta[]>
}

/** Get default-enabled panel IDs */
export function getDefaultPanelIds(): string[] {
  return PANEL_REGISTRY.filter(p => p.defaultEnabled).map(p => p.id)
}

/** Get panels grouped by domain */
export function getPanelsByDomain(): Record<string, PanelMeta[]> {
  const groups: Record<string, PanelMeta[]> = {}
  for (const panel of PANEL_REGISTRY) {
    const domain = panel.domain || '_ungrouped'
    if (!groups[domain]) groups[domain] = []
    groups[domain].push(panel)
  }
  return groups
}

/** Filter panels by enabled domains. If enabledDomains is empty, all panels pass. */
export function filterPanelsByDomains(enabledDomains: string[]): PanelMeta[] {
  if (!enabledDomains.length) return PANEL_REGISTRY
  const domainSet = new Set(enabledDomains)
  return PANEL_REGISTRY.filter(p => !p.domain || domainSet.has(p.domain))
}

/** Category display labels */
export const CATEGORY_LABELS: Record<PanelCategory, string> = {
  core: 'Core',
  business: 'Business',
  commerce: 'Commerce',
  analytics: 'Analytics',
  creative: 'Creative',
  integrations: 'Integrations',
  admin: 'Admin',
  infrastructure: 'Infrastructure',
  intelligence: 'Intelligence',
  marketplace: 'Marketplace',
  utility: 'Utility',
}
