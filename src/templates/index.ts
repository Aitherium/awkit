/**
 * Product Template System
 * =======================
 * Preset templates for common product archetypes.
 * Used by the Agent Builder wizard, WorkspaceRuntime scaffold,
 * and ADK pack system to pre-populate panels, themes, and agent config.
 */

import type { StorefrontTheme } from '../storefront/StorefrontTheme'

export interface ProductTemplate {
  /** Stable template ID */
  id: string
  /** Human-readable name */
  name: string
  /** One-line description */
  description: string
  /** Product category */
  category: 'knowledge' | 'business' | 'commerce' | 'creative' | 'custom'
  /** Panel IDs from PANEL_REGISTRY to enable */
  panels: string[]
  /** Whether this product includes a public storefront */
  storefrontEnabled: boolean
  /** Whether this product includes a public landing page */
  landingPageEnabled: boolean
  /** Theme preset key (from THEME_PRESETS) or null for default */
  theme: string | null
  /** Agent configuration */
  agentConfig: {
    persona: string
    workTypes: string[]
    toolProfile: string[]
  }
  /** Skill asset IDs */
  skills: string[]
  /** Addon manifest IDs to install */
  addonPacks: string[]
}

export const PRODUCT_TEMPLATES: Record<string, ProductTemplate> = {
  shop: {
    id: 'shop',
    name: 'Aitherium Shop',
    description: 'Full workspace + storefront for products and services',
    category: 'commerce',
    panels: [
      'chat', 'dashboard', 'document', 'stripe-commerce', 'contacts',
      'analytics', 'packs', 'settings',
    ],
    storefrontEnabled: true,
    landingPageEnabled: true,
    theme: 'aitherium',
    agentConfig: {
      persona: 'Aitherium Shop Assistant',
      workTypes: ['customer_service', 'product_info', 'order_tracking'],
      toolProfile: ['file_io', 'web', 'tenant_app', 'documents', 'content'],
    },
    skills: ['commerce-setup', 'storefront-launch', 'revenue-report'],
    addonPacks: ['shop'],
  },

  aitherium: {
    id: 'aitherium',
    name: 'Aitherium HQ',
    description: 'Full platform dogfood — every panel, every tool, every domain',
    category: 'custom',
    panels: [
      'chat', 'dashboard', 'document', 'document-lifecycle', 'knowledge-rag',
      'mail', 'calendar', 'contacts', 'people', 'directory',
      'stripe-commerce', 'storefront-shell', 'product-catalog',
      'social', 'post-composer', 'marketing-calendar', 'marketing-dashboard',
      'executive-briefing', 'workspace-intelligence', 'relationship-dashboard',
      'proton-suite', 'proton-drive', 'proton-pass',
      'analytics', 'audit', 'activity-feed', 'content-studio', 'generate',
      'task-board', 'booking', 'forms', 'clients', 'invoicing', 'file-sync',
      'agents', 'packs', 'settings', 'llm-config', 'workspace-admin',
      'feature-marketplace', 'brand-designer',
    ],
    storefrontEnabled: true,
    landingPageEnabled: true,
    theme: 'aitherium',
    agentConfig: {
      persona: 'Aither',
  // gargbot / chelle / wildroot templates REMOVED 2026-09-05 -- customer
  // names in a package strangers install. A tenant's template comes from
  // its pack, not from a preset baked in here.
      workTypes: ['orchestration', 'content_generation', 'social_media', 'executive_briefing', 'commerce'],
      toolProfile: ['file_io', 'shell', 'web', 'creative', 'git', 'code', 'workspace', 'safety'],
    },
    skills: ['commerce-setup', 'storefront-launch', 'social_analytics', 'content_generation'],
    addonPacks: [],
  },

  blank: {
    id: 'blank',
    name: 'Start from Scratch',
    description: 'Empty workspace — choose your own panels and configuration',
    category: 'custom',
    panels: ['chat', 'dashboard', 'document', 'settings'],
    storefrontEnabled: false,
    landingPageEnabled: false,
    theme: null,
    agentConfig: {
      persona: 'AI Assistant',
      workTypes: ['general'],
      toolProfile: ['file_io', 'web', 'documents'],
    },
    skills: [],
    addonPacks: [],
  },
}

/** Get a product template by ID */
export function getTemplate(id: string): ProductTemplate | undefined {
  return PRODUCT_TEMPLATES[id]
}

/** Get all templates as an array */
export function getAllTemplates(): ProductTemplate[] {
  return Object.values(PRODUCT_TEMPLATES)
}

/** Get templates filtered by category */
export function getTemplatesByCategory(category: ProductTemplate['category']): ProductTemplate[] {
  return getAllTemplates().filter(t => t.category === category)
}
