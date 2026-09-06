'use client'

/**
 * DynamicPanelRenderer -- data-driven panel system.
 *
 * Replaces hardcoded NAV_ITEMS[] and {activeTab === 'X' && <Panel />} switches
 * in every app's App.tsx with a single component driven by:
 *   1. useConfig().panels  (from brain_pack via /api/config/embed)
 *   2. PANEL_REGISTRY      (metadata: icons, labels, categories)
 *   3. PANEL_COMPONENTS     (lazy component map)
 *
 * Usage:
 *   import { DynamicPanelRenderer } from 'awkit/panels'
 *   export default function App() { return <DynamicPanelRenderer /> }
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { useAuth, useConfig } from '../hooks'
import { PANEL_REGISTRY, type PanelMeta } from './registry'
import { isPanelUsable, type PanelState } from './panel-state'

// ── Panel component map ──────────────────────────────────────────────
// Direct imports — no lazy loading complexity needed since tree-shaking
// handles unused panels and these are already small modules.

import NanoBrainPanel from './NanoBrainPanel'
import AutonomyRoadmapPanel from './AutonomyRoadmapPanel'
import SpritePanel from './SpritePanel'
import ApprovalsInboxPanel from './ApprovalsInboxPanel'
import BeadSpacePanel from './BeadSpacePanel'
import WorkspaceMembersPanel from './WorkspaceMembersPanel'
import DeployedAppsPanel from './DeployedAppsPanel'
import ChatPanel from './ChatPanel'
import DocumentPanel from './DocumentPanel'
import ESignPanel from './ESignPanel'
import PagesPanel from './PagesPanel'
import CommsPanel from './CommsPanel'
import RelayEmbedPanel from './RelayEmbedPanel'
import DashboardPanel from './DashboardPanel'
import MailPanel from './MailPanel'
import ForumPanel from './ForumPanel'
import CalendarPanel from './CalendarPanel'
import BookingPanel from './BookingPanel'
import ContactsPanel from './ContactsPanel'
import TaskBoardPanel from './TaskBoardPanel'
import InvoicingPanel from './InvoicingPanel'
import FormsPanel from './FormsPanel'
import PlanBLedgerPanel from './PlanBLedgerPanel'
import PollPanel from './PollPanel'
import PeoplePanel from './PeoplePanel'
// `my-hardware` was declared in PANEL_REGISTRY and exported from panels/index.ts,
// but bound to no component here — so a pack that enabled it (a tenant pack does)
// resolved to nothing and the panel rendered nothing. Same phantom shape as
// `company-room`, which was removed for exactly this reason. Asserted by RB003.
import MyHardwarePanel from './MyHardwarePanel'
import ApprovalQueue from './ApprovalQueue'
import BatchUploadPanel from './BatchUploadPanel'
import RequestsPanel from './RequestsPanel'
import AnalyticsPanel from './AnalyticsPanel'
import AuditPanel from './AuditPanel'
import ActivityFeedPanel from './ActivityFeedPanel'
import ReliabilityDashboard from './ReliabilityDashboard'
import BlogPanel from './BlogPanel'
import ContentStudioPanel from './ContentStudioPanel'
import GeneratePanel from './GeneratePanel'
import SocialPanel from './SocialPanel'
import IntegrationsPanel from './IntegrationsPanel'
import WebhooksPanel from './WebhooksPanel'
import FileSyncPanel from './FileSyncPanel'
import DatabasePanel from './DatabasePanel'
import DirectoryPanel from './DirectoryPanel'
import SecretsPanel from './SecretsPanel'
import LockboxPanel from './LockboxPanel'
import GobboNetPanel from './GobboNetPanel'
import CertificatesPanel from './CertificatesPanel'
import PlatformPanel from './PlatformPanel'
import LLMConfigPanel from './LLMConfigPanel'
import SettingsPanel from './SettingsPanel'
import PreferencesPanel from './PreferencesPanel'
import WorkspaceAdminPanel from './WorkspaceAdminPanel'
import AgentsPanel from './AgentsPanel'
import AgentDispatchPanel from './AgentDispatchPanel'
import KnowledgeRAGPanel from './KnowledgeRAGPanel'
import AitherGraphPanel from './AitherGraphPanel'
import EscalationsPanel from './EscalationsPanel'
import WorkspaceConfigPanel from './WorkspaceConfigPanel'
import WorkspaceCyclesPanel from './WorkspaceCyclesPanel'
import ExecutionAuditPanel from './ExecutionAuditPanel'
import DocumentLifecyclePanel from './DocumentLifecyclePanel'
import DataSourceSetupPanel from './DataSourceSetupPanel'
import PortalFiles from './PortalFiles'
import QuickActionsPanel from './QuickActionsPanel'
import PacksPanel from './PacksPanel'
import OnboardingWizardPanel from './OnboardingWizardPanel'
import SocialGraphPanel from './SocialGraphPanel'
import InferenceConfigPanel from './InferenceConfigPanel'
import CertificateAuthorityPanel from './CertificateAuthorityPanel'
import GitHubReposPanel from './GitHubReposPanel'
import StreamTugOfWarPanel from './StreamTugOfWarPanel'
import TasksPanel from './TasksPanel'
import RelayChannelsPanel from './RelayChannelsPanel'
import SSOSettingsPanel from './SSOSettingsPanel'
import SSOOIDCPanel from './SSOOIDCPanel'
import DataPlanePanel from './DataPlanePanel'
import StripeCommercePanel from './StripeCommercePanel'
import AgentBuilderWizard from './AgentBuilderWizard'
import PackCatalog from './PackCatalog'
import MyPacksPanel from './MyPacksPanel'
import FleetDashboard from './FleetDashboard'
import ModelBrowser from './ModelBrowser'
import FeatureMarketplacePanel from './FeatureMarketplacePanel'
import BrandDesignerPanel from './BrandDesignerPanel'
import ProtonSuitePanel from './ProtonSuitePanel'
import ProtonDrivePanel from './ProtonDrivePanel'
import ProtonVPNPanel from './ProtonVPNPanel'
import ProtonPassPanel from './ProtonPassPanel'
import MarketingCalendarPanel from './MarketingCalendarPanel'
import PostComposerPanel from './PostComposerPanel'
import MarketingDashboardPanel from './MarketingDashboardPanel'
import WorkspaceIntelligencePanel from './WorkspaceIntelligencePanel'
import RelationshipDashboardPanel from './RelationshipDashboardPanel'
import ExecutiveBriefingPanel from './ExecutiveBriefingPanel'
import SoundLibraryPanel from './SoundLibraryPanel'
import StorefrontShellPanel from './StorefrontShellPanel'
import ProductCatalogPanel from './ProductCatalogPanel'
import LandingPagePanel from './LandingPagePanel'
import AitherWriterPanel from './AitherWriterPanel'
import CMSPanel from './CMSPanel'
import PersonalAutomationPanel from './PersonalAutomationPanel'
import SkillLibraryPanel from './SkillLibraryPanel'
import ProfilePanel from './ProfilePanel'
import SupportPanel from './SupportPanel'
import CapturePanel from './CapturePanel'
import AitherDurabilityPanel from './Aither-DurabilityPanel'
import ElysiumCreditsPanel from './ElysiumCreditsPanel'
import SproutStudioPanel from './SproutStudioPanel'
import AiSearchPanel from './AiSearchPanel'
import MigrationPanel from './MigrationPanel'
import OnboardingPanel from './OnboardingPanel'
import NotebooksPanel from './NotebooksPanel'
import DecisionsPanel from './DecisionsPanel'
import TaxDeskPanel from './TaxDeskPanel'

import PortalShell from './PortalShell'
import type { NavItem } from './PortalShell'

// ── Component map (registry ID -> component) ─────────────────────────
// Components that accept apiBase get it auto-wired from registry.apiPrefix.

interface PanelEntry {
  component: React.ComponentType<any>
  /** Extra props to pass beyond apiBase */
  extraProps?: Record<string, any>
}

// Exported so host shells (e.g. AitherVeil's dashboard canvas) can source a
// single panel component by id — the canonical id→component map. This is the
// authority for "does awkit actually implement this panel" (a PANEL_REGISTRY
// entry can exist without a component here).
export const PANEL_COMPONENTS: Record<string, PanelEntry> = {
  'chat':                { component: ChatPanel },
  'dashboard':           { component: DashboardPanel },
  'document':            { component: DocumentPanel },
  'document-lifecycle':  { component: DocumentLifecyclePanel },
  'esign':               { component: ESignPanel },
  'pages':               { component: PagesPanel },
  'mail':                { component: MailPanel },
  // Comms = the canonical Veil relay, embedded. Same UI everywhere, no drift.
  // The legacy CommsPanel monolith stays exported for callers that still import
  // it directly, but the default 'comms' slot now renders the full relay.
  'comms':               { component: RelayEmbedPanel },
  'forum':               { component: ForumPanel },
  'portal-files':        { component: PortalFiles },
  'calendar':            { component: CalendarPanel },
  'task-board':          { component: TaskBoardPanel },
  'contacts':            { component: ContactsPanel },
  'clients':             { component: StripeCommercePanel },
  'invoicing':           { component: InvoicingPanel },
  'stripe-commerce':     { component: StripeCommercePanel },
  'taxdesk':             { component: TaxDeskPanel },
  'durability':          { component: AitherDurabilityPanel },
  'booking':             { component: BookingPanel },
  'planb-ledger':        { component: PlanBLedgerPanel },
  'forms':               { component: FormsPanel },
  'poll':                { component: PollPanel },
  'people':              { component: PeoplePanel },
  'my-hardware':         { component: MyHardwarePanel },
  'approval-queue':      { component: ApprovalQueue },
  'batch-upload':        { component: BatchUploadPanel },
  'requests':            { component: RequestsPanel },
  'storefront-shell':    { component: StorefrontShellPanel },
  'product-catalog':     { component: ProductCatalogPanel },
  'landing-page':        { component: LandingPagePanel },
  'writer':              { component: AitherWriterPanel },
  'cms':                 { component: CMSPanel },
  'analytics':           { component: AnalyticsPanel },
  'audit':               { component: AuditPanel },
  'activity-feed':       { component: ActivityFeedPanel },
  'reliability-dashboard': { component: ReliabilityDashboard },
  'blog':                { component: BlogPanel },
  'content-studio':      { component: ContentStudioPanel },
  'generate':            { component: GeneratePanel },
  'sound-library':       { component: SoundLibraryPanel },
  'social':              { component: SocialPanel },
  'integrations':        { component: IntegrationsPanel },
  'webhooks':            { component: WebhooksPanel },
  'file-sync':           { component: FileSyncPanel },
  'database':            { component: DatabasePanel },
  'directory':           { component: DirectoryPanel },
  'secrets':             { component: SecretsPanel },
  'lockbox':             { component: LockboxPanel },
  'gobbonet':            { component: GobboNetPanel },
  'certificates':        { component: CertificatesPanel },
  'platform':            { component: PlatformPanel },
  'llm-config':          { component: LLMConfigPanel },
  'settings':            { component: SettingsPanel },
  'preferences':         { component: PreferencesPanel },
  'workspace-admin':     { component: WorkspaceAdminPanel },
  'inference-config':    { component: InferenceConfigPanel },
  'ca':                  { component: CertificateAuthorityPanel },
  'github-repos':        { component: GitHubReposPanel },
  'stream-tugofwar':     { component: StreamTugOfWarPanel },
  'tasks':               { component: TasksPanel },
  'relay-channels':      { component: RelayChannelsPanel },
  'sso-settings':        { component: SSOSettingsPanel },
  // Brokered upstream-OIDC lane (Entra OIDC → AitherIdentity → JIT). SAML
  // lane is 'sso-settings'; this is the OIDC sibling.
  'sso-oidc':            { component: SSOOIDCPanel },
  'knowledge-rag':       { component: KnowledgeRAGPanel },
  'aither-capture':      { component: CapturePanel },
  'elysium-credits':     { component: ElysiumCreditsPanel },
  'data-plane':          { component: DataPlanePanel },
  'agents':              { component: AgentsPanel },
  'agent-dispatch':      { component: AgentDispatchPanel },
  'quick-actions':       { component: QuickActionsPanel },
  'packs':               { component: PacksPanel },
  'onboarding-wizard':   { component: OnboardingWizardPanel },
  'aithergraph':         { component: AitherGraphPanel },
  'escalations':         { component: EscalationsPanel },
  'workspace-config':    { component: WorkspaceConfigPanel },
  'workspace-cycles':    { component: WorkspaceCyclesPanel },
  'execution-audit':     { component: ExecutionAuditPanel },
  'data-source-setup':   { component: DataSourceSetupPanel },
  'brand-designer':      { component: BrandDesignerPanel },
  'feature-marketplace': { component: FeatureMarketplacePanel },
  'proton-suite':        { component: ProtonSuitePanel },
  'proton-drive':        { component: ProtonDrivePanel },
  'proton-vpn':          { component: ProtonVPNPanel },
  'proton-pass':         { component: ProtonPassPanel },
  'social-graph':        { component: SocialGraphPanel },
  'marketing-calendar':  { component: MarketingCalendarPanel },
  'post-composer':       { component: PostComposerPanel },
  'marketing-dashboard': { component: MarketingDashboardPanel },
  'workspace-intelligence': { component: WorkspaceIntelligencePanel },
  'relationship-dashboard': { component: RelationshipDashboardPanel },
  'executive-briefing':  { component: ExecutiveBriefingPanel },
  'agent-builder':       { component: AgentBuilderWizard },
  'pack-catalog':        { component: PackCatalog },
  'my-packs':            { component: MyPacksPanel },
  'fleet-dashboard':     { component: FleetDashboard },
  'model-browser':       { component: ModelBrowser },
  'personal-automation': { component: PersonalAutomationPanel },
  'skill-library':       { component: SkillLibraryPanel },
  'profile':             { component: ProfilePanel },
  'support':             { component: SupportPanel },
  // Product connectors (net-new)
  'sprout-studio':       { component: SproutStudioPanel },
  'ai-search':           { component: AiSearchPanel },
  'migration':           { component: MigrationPanel },
  'onboarding-setup':    { component: OnboardingPanel },
  // Developer tools
  'notebooks':           { component: NotebooksPanel },
  // registry.ts declared 'decisions' and DecisionsPanel.tsx existed, but it
  // was never imported here -- so the panel resolved to nothing and rendered
  // 'no panel wired up' (RB010). Built, declared, unreachable.
  'decisions':           { component: DecisionsPanel },
  // Built, but unwired until 2026-08-01 — every one of these had a component
  // file sitting next to this map while the registry advertised the panel and
  // this map did not implement it. RB010 read that as "unimplemented"; the
  // implementations existed, so the defect was the WIRING, not the build.
  'nanobrain':           { component: NanoBrainPanel },
  'autonomy-roadmap':    { component: AutonomyRoadmapPanel },
  'aither-sprite':       { component: SpritePanel },
  'approvals-inbox':     { component: ApprovalsInboxPanel },
  'beadspace':           { component: BeadSpacePanel },
  'workspace-members':   { component: WorkspaceMembersPanel },
  'deployed-apps':       { component: DeployedAppsPanel },
}

// ── Admin-category panels go to the bottom section ───────────────────
const BOTTOM_CATEGORIES = new Set(['admin', 'infrastructure', 'marketplace'])

// ── Props ────────────────────────────────────────────────────────────

export interface DynamicPanelRendererProps {
  /** Override panels list (bypasses config.panels) */
  panels?: string[]
  /** Extra NavItems to prepend */
  extraNavItems?: NavItem[]
  /** Extra sidebar content (e.g. QuickActionsPanel) */
  sidebarContent?: ReactNode
  /** Sidebar footer content */
  sidebarFooter?: ReactNode
  /** Whether to wrap chat panel with ConversationList sidebar */
  chatWithSidebar?: boolean
  /** Login/Register components — if omitted, no auth gate */
  loginComponent?: ReactNode
  registerComponent?: ReactNode
  /** Onboarding component */
  onboardingComponent?: ReactNode
  /** Extra props passed to every panel */
  panelProps?: Record<string, any>
  /** Per-panel prop overrides keyed by panel ID */
  panelPropOverrides?: Record<string, Record<string, any>>
  /**
   * Whether to filter panels by state (usable only).
   * Default: true — only production-ready panels are shown.
   * Set to false to show demo/gated/unbuilt panels (admin mode).
   */
  filterByState?: boolean
  /**
   * If filterByState=false, which states to include.
   * Default: ['usable']. Use ['usable', 'demo'] to include demos.
   */
  allowedStates?: PanelState[]
}

// ── ChatWithHistory wrapper ──────────────────────────────────────────

function ChatWithHistory() {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Dynamically import ConversationList to avoid hard dep
  const [ConvList, setConvList] = useState<React.ComponentType<any> | null>(null)
  useEffect(() => {
    import('../ui/ConversationList').then((m) => setConvList(() => m.default)).catch(() => {})
  }, [])

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {ConvList && (
        <aside style={{
          width: 260,
          borderRight: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          display: 'flex', flexDirection: 'column',
        }}>
          <ConvList activeId={conversationId} onSelect={setConversationId} refreshKey={refreshKey} />
        </aside>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <ChatPanel
          conversationId={conversationId}
          onNewConversation={(id: string) => { setConversationId(id); setRefreshKey((k) => k + 1) }}
        />
      </div>
    </div>
  )
}

// ── Resolve active panels from config + registry ─────────────────────

function resolveActivePanels(
  configPanels: string[] | undefined,
  configDisabled: string[] | undefined,
  configOrder: string[] | undefined,
  filterByState: boolean = true,
  allowedStates: PanelState[] = ['usable'],
): PanelMeta[] {
  // Start with config panels or registry defaults
  let ids: string[]
  if (configPanels && configPanels.length > 0) {
    ids = configPanels
  } else {
    // Use all panels that have a registered component
    ids = PANEL_REGISTRY.filter((p) => p.id in PANEL_COMPONENTS).map((p) => p.id)
  }

  // Apply state filtering (default: show only usable)
  if (filterByState) {
    const allowedSet = new Set(allowedStates)
    ids = ids.filter((id) => {
      const meta = PANEL_REGISTRY.find((p) => p.id === id)
      const state = meta?.state ?? 'usable'
      return allowedSet.has(state)
    })
  }

  // Apply exclusions
  if (configDisabled && configDisabled.length > 0) {
    const disabled = new Set(configDisabled)
    ids = ids.filter((id) => !disabled.has(id))
  }

  // Apply ordering
  if (configOrder && configOrder.length > 0) {
    const orderMap = new Map(configOrder.map((id, i) => [id, i]))
    ids.sort((a, b) => {
      const oa = orderMap.get(a) ?? 9999
      const ob = orderMap.get(b) ?? 9999
      return oa - ob
    })
  }

  // Resolve to PanelMeta
  const metaMap = new Map(PANEL_REGISTRY.map((p) => [p.id, p]))
  return ids
    .map((id) => metaMap.get(id))
    .filter((p): p is PanelMeta => !!p && p.id in PANEL_COMPONENTS)
}

// ── Main Component ───────────────────────────────────────────────────

export default function DynamicPanelRenderer({
  panels: overridePanels,
  extraNavItems,
  sidebarContent,
  sidebarFooter,
  chatWithSidebar = true,
  panelProps = {},
  panelPropOverrides = {},
  filterByState = true,
  allowedStates = ['usable'],
}: DynamicPanelRendererProps) {
  const auth = useAuth()
  const config = useConfig()
  const [activeTab, setActiveTab] = useState<string>('chat')

  // Resolve panels from config or override
  const activePanels = resolveActivePanels(
    overridePanels || config.panels,
    config.disabled_panels,
    config.panel_order,
    filterByState,
    allowedStates,
  )

  // Default to first panel
  useEffect(() => {
    if (activePanels.length > 0 && !activePanels.find((p) => p.id === activeTab)) {
      setActiveTab(activePanels[0].id)
    }
  }, [activePanels, activeTab])

  // Build NavItems from active panels
  const navItems: NavItem[] = [
    ...(extraNavItems || []),
    ...activePanels.map((panel) => ({
      id: panel.id,
      label: (config.ui_labels?.[panel.id] || panel.name),
      bottom: BOTTOM_CATEGORIES.has(panel.category),
    })),
  ]

  // Render the active panel
  const renderPanel = useCallback(() => {
    const entry = PANEL_COMPONENTS[activeTab]
    if (!entry) return null

    const meta = PANEL_REGISTRY.find((p) => p.id === activeTab)
    const Component = entry.component

    // Auto-wire apiBase from registry
    const autoProps: Record<string, any> = {
      ...panelProps,
      ...(entry.extraProps || {}),
      ...(panelPropOverrides[activeTab] || {}),
    }
    if (meta?.apiPrefix) {
      autoProps.apiBase = autoProps.apiBase || meta.apiPrefix
    }

    // Chat panel gets the sidebar wrapper
    if (activeTab === 'chat' && chatWithSidebar) {
      return <ChatWithHistory />
    }

    return <Component {...autoProps} />
  }, [activeTab, chatWithSidebar, panelProps, panelPropOverrides])

  return (
    <PortalShell
      appName={config.app_name}
      companyName={config.company_name}
      navItems={navItems}
      activeId={activeTab}
      onNavigate={setActiveTab}
      user={auth.user}
      onLogout={auth.logout}
      sidebarContent={sidebarContent}
      sidebarFooter={sidebarFooter}
    >
      {renderPanel()}
    </PortalShell>
  )
}
