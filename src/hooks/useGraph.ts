'use client'

import { useState, useCallback } from 'react'
import { useConfig } from './useConfig'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MaterializedView {
  id: string
  name: string
  description: string
  domains: string[]
  refresh: string
  builtin: boolean
  cached: boolean
}

export interface ViewResult {
  view_id: string
  view_name: string
  node_count: number
  edge_count: number
  domains_hit: string[]
  cached: boolean
  materialized_at: number
  query_ms: number
  nodes: GraphNode[]
  edges: GraphEdge[]
  context_text: string
  notebook_id: string | null
}

export interface GraphNode {
  id: string
  type: string
  domain: string
  name: string
  score: number
  properties: Record<string, unknown>
}

export interface GraphEdge {
  source: string
  target: string
  type: string
  weight: number
}

export interface InvariantStatus {
  total_invariants: number
  enabled: number
  with_checkers: number
  violations: number
  total_violation_count: number
}

export interface Violation {
  invariant_id: string
  name: string
  severity: string
  message: string
  violation_count: number
  last_checked: number
}

export interface ContextArtifact {
  id: string
  question: string
  conclusion: string
  confidence: number
  corroboration: string
  evidence_count: number
  domain: string
  created_by: string
  created_at: number
}

export interface BIMetric {
  id: string
  category: string
  name: string
  value: number | string
  unit: string
  tenant_id: string
  service: string
  timestamp: number
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGraph() {
  const config = useConfig()
  const [loading, setLoading] = useState(false)
  const baseUrl = (config as any)?.backendUrl || config?.apiBase || ''

  const fetchApi = useCallback(async <T>(path: string, options?: RequestInit): Promise<T | null> => {
    try {
      setLoading(true)
      const res = await fetch(`${baseUrl}${path}`, {
        credentials: 'include',
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      })
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    } finally {
      setLoading(false)
    }
  }, [baseUrl])

  // Materialized Views
  const listViews = useCallback(() =>
    fetchApi<{ ok: boolean; views: MaterializedView[] }>('/api/graph/views'), [fetchApi])

  const getView = useCallback((viewId: string, force = false) =>
    fetchApi<ViewResult & { ok: boolean }>(`/api/graph/views/${viewId}?force=${force}`), [fetchApi])

  // Invariants
  const getInvariants = useCallback(() =>
    fetchApi<{ ok: boolean; stats: InvariantStatus; violations: Violation[] }>('/api/graph/invariants'), [fetchApi])

  // Context Artifacts
  const getArtifacts = useCallback((params?: { domain?: string; question?: string; min_confidence?: number }) => {
    const qs = new URLSearchParams()
    if (params?.domain) qs.set('domain', params.domain)
    if (params?.question) qs.set('question', params.question)
    if (params?.min_confidence) qs.set('min_confidence', String(params.min_confidence))
    return fetchApi<{ ok: boolean; artifacts: ContextArtifact[] }>(`/api/graph/artifacts?${qs}`)
  }, [fetchApi])

  // Investigation
  const investigate = useCallback((question: string, domain = '') =>
    fetchApi<{ ok: boolean; artifact: ContextArtifact }>('/api/graph/investigate', {
      method: 'POST',
      body: JSON.stringify({ question, domain }),
    }), [fetchApi])

  // BI Metrics
  const getMetrics = useCallback((category = '') =>
    fetchApi<{ ok: boolean; metrics: BIMetric[] }>(`/api/bi/metrics?category=${category}`), [fetchApi])

  const getTenantSummary = useCallback(() =>
    fetchApi<{ ok: boolean; total_metrics: number; by_category: Record<string, number> }>('/api/bi/tenant/current'), [fetchApi])

  // Data Lake
  const recallFromLake = useCallback((domain: string, dateFrom = '', dateTo = '') =>
    fetchApi<{ ok: boolean; nodes: GraphNode[] }>('/api/graph/datalake/recall', {
      method: 'POST',
      body: JSON.stringify({ domain, date_from: dateFrom, date_to: dateTo }),
    }), [fetchApi])

  return {
    loading,
    // Views
    listViews,
    getView,
    // Invariants
    getInvariants,
    // Artifacts
    getArtifacts,
    investigate,
    // BI
    getMetrics,
    getTenantSummary,
    // Lake
    recallFromLake,
  }
}
