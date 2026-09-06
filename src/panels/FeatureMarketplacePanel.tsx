'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  Package, Check, Plus, X, Loader2, Lock, AlertCircle,
  MessageCircle, FileText, Mail, Calendar, Kanban, Contact,
  Building2, Receipt, CalendarCheck, ClipboardList, Users,
  BarChart3, ShieldCheck, Activity, PenLine, Share2, Plug,
  Webhook, CloudUpload, Database, UsersRound, KeyRound,
  Settings, Bot, Send, Zap, Rocket, HeartPulse, SlidersHorizontal,
  Shield, MessagesSquare, FolderOpen, MessageSquareText, Sparkles, CreditCard,
  BrainCircuit, Store, Globe, BookOpen,
} from 'lucide-react'

export interface FeatureMarketplacePanelProps {
  apiBase?: string
  workspaceId?: string
  currentFeatures?: string[]
  currentPlan?: string
  enabledDomains?: string[]
  onDomainsChange?: (domains: string[]) => void
}

interface PanelInfo {
  id: string
  name: string
  description: string
  category: string
  icon: string
  planRequirement?: 'free' | 'pro' | 'enterprise'
  dependsOn?: string[]
  domain?: string
}

interface DomainInfo {
  id: string
  label: string
  description: string
  panels: string[]
  tools: string[]
}

const ICON_MAP: Record<string, React.ElementType> = {
  'message-circle': MessageCircle, 'file-text': FileText, 'mail': Mail,
  'calendar': Calendar, 'kanban': Kanban, 'contact': Contact,
  'building-2': Building2, 'receipt': Receipt, 'calendar-check': CalendarCheck,
  'clipboard-list': ClipboardList, 'users': Users, 'bar-chart-3': BarChart3,
  'shield-check': ShieldCheck, 'activity': Activity, 'pen-line': PenLine,
  'share-2': Share2, 'plug': Plug, 'webhook': Webhook,
  'cloud-upload': CloudUpload, 'database': Database, 'users-round': UsersRound,
  'key-round': KeyRound, 'settings': Settings, 'bot': Bot, 'send': Send,
  'zap': Zap, 'rocket': Rocket, 'heart-pulse': HeartPulse,
  'sliders-horizontal': SlidersHorizontal, 'shield': Shield,
  'messages-square': MessagesSquare, 'folder-open': FolderOpen,
  'message-square-text': MessageSquareText, 'sparkles': Sparkles,
  'credit-card': CreditCard, 'brain-circuit': BrainCircuit,
  'store': Store, 'globe': Globe, 'book-open': BookOpen,
  'layout-dashboard': BarChart3, 'settings-2': Settings, 'cpu': Bot,
  'check-circle': Check, 'upload-cloud': CloudUpload, 'shopping-bag': Package,
  'shield-alert': ShieldCheck, 'wrench': Settings, 'repeat': Calendar,
  'scroll-text': FileText, 'inbox': Mail, 'music': Sparkles,
  'git-compare': FileText, 'package': Package,
}

const CATEGORY_ORDER = ['core', 'business', 'commerce', 'analytics', 'creative', 'integrations', 'admin', 'infrastructure', 'intelligence']

const CATEGORY_LABELS: Record<string, string> = {
  core: 'Core', business: 'Business', commerce: 'Commerce', analytics: 'Analytics',
  creative: 'Creative', integrations: 'Integrations', admin: 'Admin',
  infrastructure: 'Infrastructure', intelligence: 'Intelligence',
}

export default function FeatureMarketplacePanel({
  apiBase = '',
  workspaceId,
  currentFeatures = [],
  currentPlan = 'free',
  enabledDomains: initialDomains = [],
  onDomainsChange,
}: FeatureMarketplacePanelProps) {
  const [panels, setPanels] = useState<PanelInfo[]>([])
  const [features, setFeatures] = useState<string[]>(currentFeatures)
  const [domains, setDomains] = useState<DomainInfo[]>([])
  const [activeDomains, setActiveDomains] = useState<string[]>(initialDomains)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [viewMode, setViewMode] = useState<'domains' | 'panels'>('domains')

  // Load panel registry and domain config from API
  useEffect(() => {
    const load = async () => {
      try {
        const [panelRes, domainRes] = await Promise.all([
          fetch(`${apiBase}/api/bridge/genesis/builder/panels`),
          fetch(`${apiBase}/api/config/domains`).catch(() => null),
        ])
        if (panelRes.ok) {
          const data = await panelRes.json()
          setPanels(data.panels || [])
        }
        if (domainRes?.ok) {
          const data = await domainRes.json()
          if (data.domains) setDomains(data.domains)
          if (data.enabled_domains?.length) setActiveDomains(data.enabled_domains)
        }
      } catch { /* fall back to empty */ }
      setLoading(false)
    }
    load()
  }, [apiBase])

  useEffect(() => { setFeatures(currentFeatures) }, [currentFeatures])

  const togglePanel = useCallback(async (panelId: string) => {
    const panel = panels.find(p => p.id === panelId)
    if (!panel) return

    // Check plan
    if (panel.planRequirement && panel.planRequirement !== 'free') {
      const planOrder = ['free', 'pro', 'enterprise']
      if (planOrder.indexOf(currentPlan) < planOrder.indexOf(panel.planRequirement)) {
        setError(`"${panel.name}" requires ${panel.planRequirement} plan.`)
        return
      }
    }

    const isInstalled = features.includes(panelId)
    let newFeatures: string[]

    if (isInstalled) {
      newFeatures = features.filter(f => f !== panelId)
    } else {
      newFeatures = [...features, panelId]
      // Auto-install dependencies
      if (panel.dependsOn) {
        for (const dep of panel.dependsOn) {
          if (!newFeatures.includes(dep)) newFeatures.push(dep)
        }
      }
    }

    setFeatures(newFeatures)
    setError(null)

    // Save to backend if workspaceId is set
    if (workspaceId) {
      setSaving(true)
      try {
        const res = await fetch(`${apiBase}/api/bridge/genesis/workspaces/${workspaceId}/configure`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ features: newFeatures }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setError(data.detail || 'Failed to update features')
          setFeatures(features) // revert
        }
      } catch {
        setError('Cannot connect to workspace')
        setFeatures(features) // revert
      }
      setSaving(false)
    }
  }, [panels, features, currentPlan, workspaceId, apiBase])

  const toggleDomain = useCallback(async (domainId: string) => {
    const isActive = activeDomains.includes(domainId)
    const newDomains = isActive
      ? activeDomains.filter(d => d !== domainId)
      : [...activeDomains, domainId]
    setActiveDomains(newDomains)
    onDomainsChange?.(newDomains)

    if (workspaceId) {
      setSaving(true)
      try {
        const res = await fetch(`${apiBase}/api/bridge/genesis/workspaces/${workspaceId}/configure`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled_domains: newDomains }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setError(data.detail || 'Failed to update domains')
          setActiveDomains(activeDomains)
        }
      } catch {
        setError('Cannot connect to workspace')
        setActiveDomains(activeDomains)
      }
      setSaving(false)
    }
  }, [activeDomains, workspaceId, apiBase, onDomainsChange])

  const grouped = CATEGORY_ORDER.reduce((acc, cat) => {
    const items = panels.filter(p =>
      p.category === cat &&
      (!filter || p.name.toLowerCase().includes(filter.toLowerCase()) || p.id.includes(filter.toLowerCase()))
    )
    if (items.length > 0) acc[cat] = items
    return acc
  }, {} as Record<string, PanelInfo[]>)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-cyan-400" />
          <h2 className="text-lg font-semibold text-zinc-200">Feature Marketplace</h2>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-500/15 text-cyan-300">
            {features.length} installed
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-zinc-700 overflow-hidden">
            <button
              onClick={() => setViewMode('domains')}
              className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${viewMode === 'domains' ? 'bg-cyan-500/15 text-cyan-300' : 'text-zinc-500 hover:text-zinc-300'}`}
            >Domains</button>
            <button
              onClick={() => setViewMode('panels')}
              className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${viewMode === 'panels' ? 'bg-cyan-500/15 text-cyan-300' : 'text-zinc-500 hover:text-zinc-300'}`}
            >Panels</button>
          </div>
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Search..."
            className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 w-40"
          />
        </div>
      </div>

      {/* Domain Toggle View */}
      {viewMode === 'domains' && domains.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-zinc-500 font-medium uppercase tracking-wider">
            Capability Domains
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {domains.filter(d => !filter || d.label.toLowerCase().includes(filter.toLowerCase())).map(domain => {
              const isActive = !activeDomains.length || activeDomains.includes(domain.id)
              return (
                <div key={domain.id}
                  className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                    isActive ? 'border-cyan-500/30 bg-cyan-500/5' : 'border-white/[0.06] bg-white/[0.02]'
                  }`}>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-zinc-200">{domain.label}</div>
                    <p className="text-[11px] text-zinc-500 mt-0.5">{domain.description}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                        {domain.panels.length} panels
                      </span>
                      {domain.tools.length > 0 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                          {domain.tools.length} tools
                        </span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => toggleDomain(domain.id)} disabled={saving}
                    className={`shrink-0 p-1 rounded-md transition-colors ${
                      isActive ? 'text-cyan-400 hover:bg-red-500/10 hover:text-red-400' : 'text-zinc-500 hover:bg-cyan-500/10 hover:text-cyan-400'
                    }`}>
                    {isActive ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {saving && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-cyan-500/10 text-xs text-cyan-300">
          <Loader2 className="h-3 w-3 animate-spin" /> Updating workspace...
        </div>
      )}

      {/* Panel Grid by Category */}
      {(viewMode === 'panels' || !domains.length) && Object.entries(grouped).map(([category, items]) => (
        <div key={category}>
          <div className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2">
            {CATEGORY_LABELS[category] || category}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {items.map(panel => {
              const isInstalled = features.includes(panel.id)
              const IconComp = ICON_MAP[panel.icon] || Package
              const needsUpgrade = panel.planRequirement && panel.planRequirement !== 'free' &&
                ['free', 'pro', 'enterprise'].indexOf(currentPlan) < ['free', 'pro', 'enterprise'].indexOf(panel.planRequirement)

              return (
                <div key={panel.id}
                  className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                    isInstalled
                      ? 'border-cyan-500/30 bg-cyan-500/5'
                      : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.03]'
                  }`}>
                  <div className={`shrink-0 p-1.5 rounded-lg ${isInstalled ? 'bg-cyan-500/15 text-cyan-400' : 'bg-white/[0.04] text-zinc-500'}`}>
                    <IconComp className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-zinc-200">{panel.name}</span>
                      {panel.planRequirement && panel.planRequirement !== 'free' && (
                        <span className="px-1 py-0.5 rounded text-[9px] font-medium bg-purple-500/15 text-purple-300 uppercase">
                          {panel.planRequirement}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2">{panel.description}</p>
                  </div>
                  <button onClick={() => togglePanel(panel.id)} disabled={saving}
                    className={`shrink-0 p-1 rounded-md transition-colors ${
                      isInstalled
                        ? 'text-cyan-400 hover:bg-red-500/10 hover:text-red-400'
                        : needsUpgrade
                          ? 'text-zinc-600 cursor-not-allowed'
                          : 'text-zinc-500 hover:bg-cyan-500/10 hover:text-cyan-400'
                    }`}
                    title={isInstalled ? 'Remove' : needsUpgrade ? `Requires ${panel.planRequirement}` : 'Install'}>
                    {isInstalled ? <X className="h-3.5 w-3.5" /> : needsUpgrade ? <Lock className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {(viewMode === 'panels' || !domains.length) && Object.keys(grouped).length === 0 && (
        <div className="text-center py-8 text-zinc-500 text-sm">No panels found.</div>
      )}
    </div>
  )
}
