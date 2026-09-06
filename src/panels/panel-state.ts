/**
 * Panel State Registry
 * ====================
 * Machine-readable state for each awkit panel component.
 *
 * States:
 *   - usable: production-ready, shipped, fully functional
 *   - demo: beta/preview, incomplete or for demonstration
 *   - gated: requires special permissions or capabilities
 *   - unbuilt: planned but not yet implemented
 *
 * AUTO-GENERATED from `AitherOS/config/registry-unified.json`
 * DO NOT EDIT by hand. Run: python AitherOS/dev/tools/generate_panel_state.py
 *
 * Generated: 2026-08-20T15:32:32.650853
 * Source: AitherOS/config/registry-unified.json
 * Panels: 99 total
 * State breakdown: usable: 99
 */

export type PanelState = 'usable' | 'demo' | 'gated' | 'unbuilt'

export interface PanelStateEntry {
  id: string
  state: PanelState
  /** When this state was determined (ISO 8601 date) */
  audited?: string
  /** Why this panel is in this state (demo/gated/unbuilt only) */
  reason?: string
}

/**
 * Authoritative panel state map.
 *
 * Each entry represents what the portal should do with a panel:
 *   usable  → render normally, include in defaults, show in marketplace
 *   demo    → render with "beta" badge, exclude from defaults, optional enrollment
 *   gated   → render if user has required permissions, exclude from defaults
 *   unbuilt → do not render, do not list, hide from marketplace
 */
export const PANEL_STATE_MAP: Record<string, PanelState> = {
  'activity-feed': 'usable',
  'agent-builder': 'usable',
  'agent-dispatch': 'usable',
  'agents': 'usable',
  'ai-search': 'usable',
  'aither-capture': 'usable',
  'aither-sprite': 'usable',
  'aithergraph': 'usable',
  'analytics': 'usable',
  'approval-queue': 'usable',
  'approvals-inbox': 'usable',
  'audit': 'usable',
  'autonomy-roadmap': 'usable',
  'batch-upload': 'usable',
  'beadspace': 'usable',
  'blog': 'usable',
  'booking': 'usable',
  'brand-designer': 'usable',
  'ca': 'usable',
  'github-repos': 'usable',
  'stream-tugofwar': 'usable',
  'calendar': 'usable',
  'chat': 'usable',
  'clients': 'usable',
  'cms': 'usable',
  'comms': 'usable',
  'contacts': 'usable',
  'content-studio': 'usable',
  'dashboard': 'usable',
  'data-plane': 'usable',
  'data-source-setup': 'usable',
  'database': 'usable',
  'deployed-apps': 'usable',
  'directory': 'usable',
  'document': 'usable',
  'document-lifecycle': 'usable',
  'elysium-credits': 'usable',
  'escalations': 'usable',
  'esign': 'usable',
  'execution-audit': 'usable',
  'executive-briefing': 'usable',
  'feature-marketplace': 'usable',
  'file-sync': 'usable',
  'fleet-dashboard': 'usable',
  'forms': 'usable',
  'forum': 'usable',
  'generate': 'usable',
  'inference-config': 'usable',
  'integrations': 'usable',
  'invoicing': 'usable',
  'knowledge-rag': 'usable',
  'landing-page': 'usable',
  'llm-config': 'usable',
  'mail': 'usable',
  'marketing-calendar': 'usable',
  'marketing-dashboard': 'usable',
  'migration': 'usable',
  'model-browser': 'usable',
  'my-packs': 'usable',
  'nanobrain': 'usable',
  'notebooks': 'usable',
  'onboarding-setup': 'usable',
  'onboarding-wizard': 'usable',
  'pack-catalog': 'usable',
  'packs': 'usable',
  'pages': 'usable',
  'people': 'usable',
  'personal-automation': 'usable',
  'platform': 'usable',
  'poll': 'usable',
  'portal-files': 'usable',
  'post-composer': 'usable',
  'preferences': 'usable',
  'product-catalog': 'usable',
  'profile': 'usable',
  'proton-drive': 'usable',
  'proton-pass': 'usable',
  'proton-suite': 'usable',
  'proton-vpn': 'usable',
  'quick-actions': 'usable',
  'relationship-dashboard': 'usable',
  'reliability-dashboard': 'usable',
  'requests': 'usable',
  'secrets': 'usable',
  'settings': 'usable',
  'skill-library': 'usable',
  'social': 'usable',
  'social-graph': 'usable',
  'sound-library': 'usable',
  'sprout-studio': 'usable',
  'storefront-shell': 'usable',
  'stripe-commerce': 'usable',
  'support': 'usable',
  'task-board': 'usable',
  'webhooks': 'usable',
  'workspace-admin': 'usable',
  'workspace-config': 'usable',
  'workspace-cycles': 'usable',
  'workspace-intelligence': 'usable',
  'workspace-members': 'usable',
  'writer': 'usable',
}

/**
 * Get the state of a panel by ID.
 * Returns 'usable' as default if not found (backward compatibility).
 */
export function getPanelState(id: string): PanelState {
  return PANEL_STATE_MAP[id] ?? 'usable'
}

/**
 * Check if a panel should be rendered/visible.
 * Only 'usable' panels are considered viable for rendering.
 */
export function isPanelUsable(id: string): boolean {
  return getPanelState(id) === 'usable'
}

/**
 * Filter panels to only usable ones.
 */
export function filterUsablePanels(ids: string[]): string[] {
  return ids.filter(isPanelUsable)
}

/**
 * Get all panels in a given state.
 */
export function getPanelsInState(state: PanelState): string[] {
  return Object.entries(PANEL_STATE_MAP)
    .filter(([_, s]) => s === state)
    .map(([id, _]) => id)
}

/**
 * Summary stats for panel states.
 */
export function getPanelStateStats() {
  const stats: Record<PanelState, number> = {
    usable: 0,
    demo: 0,
    gated: 0,
    unbuilt: 0,
  }

  for (const state of Object.values(PANEL_STATE_MAP)) {
    stats[state]++
  }

  return stats
}
