'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, CircleDashed, Loader2, Zap, XCircle, RefreshCw } from 'lucide-react'

// Types matching Genesis /business/autonomy-roadmap response
type Phase = { id: string; title: string; status: string; detail: string }
type Blocker = { id: string; label: string; status: string; action: string; severity?: string }
type Check = { id: string; label: string; status: string; detail: string }
type DimensionCheck = { id: string; label: string; status: string; detail: string; owner: string; engine: string; severity: string }
type DimensionBlocker = { id: string; label: string; severity: string; action: string }
type Dimension = {
  id: string
  label: string
  status: 'shipped' | 'partial' | 'missing'
  score: number
  max_score: number
  phase: string
  checks: DimensionCheck[]
  blockers: DimensionBlocker[]
}
type Readiness = {
  ready?: boolean
  score?: number
  summary?: string
  phases?: Phase[]
  blockers?: Blocker[]
  checks?: Check[]
  deep?: boolean
  dimensions?: Dimension[]
}

export interface AutonomyRoadmapPanelProps {
  apiBase?: string
}

const TONE: Record<string, string> = {
  done: 'text-emerald-300',
  present: 'text-emerald-300',
  shipped: 'text-emerald-300',
  pending: 'text-amber-300',
  unknown: 'text-zinc-500',
  missing: 'text-rose-300',
  blocked: 'text-rose-300',
}

const ROW_BG: Record<string, string> = {
  done: 'bg-emerald-500/[0.06]',
  pending: 'bg-amber-500/[0.06]',
  missing: 'bg-rose-500/[0.06]',
  unknown: 'bg-zinc-800/30',
}

const ROW_BORDER: Record<string, string> = {
  done: 'border-emerald-400/20',
  pending: 'border-amber-400/20',
  missing: 'border-rose-400/20',
  unknown: 'border-zinc-700/30',
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'done' || status === 'present' || status === 'shipped') {
    return <CheckCircle2 className="h-4 w-4 text-emerald-400" />
  }
  if (status === 'missing' || status === 'blocked') {
    return <XCircle className="h-4 w-4 text-rose-400" />
  }
  return <CircleDashed className="h-4 w-4 text-amber-400" />
}

function DimensionStatusPill({ status }: { status: 'shipped' | 'partial' | 'missing' }) {
  const pillClass = {
    shipped: 'border-emerald-400/20 bg-emerald-500/[0.08] text-emerald-300',
    partial: 'border-amber-400/20 bg-amber-500/[0.08] text-amber-300',
    missing: 'border-rose-400/20 bg-rose-500/[0.08] text-rose-300',
  }[status]
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${pillClass}`}>
      {status}
    </span>
  )
}

function SeverityBadge({ severity }: { severity: string }) {
  const bgClass = {
    red: 'bg-rose-500/[0.14]',
    yellow: 'bg-amber-500/[0.14]',
    green: 'bg-emerald-500/[0.14]',
  }[severity] || 'bg-zinc-700/50'
  return <span className={`inline-flex h-2 w-2 rounded-full ${bgClass}`} />
}

function OwnerBadge({ owner }: { owner: string }) {
  const badgeClass = owner === 'agent'
    ? 'bg-purple-500/[0.14] text-purple-300'
    : 'bg-blue-500/[0.14] text-blue-300'
  return (
    <span className={`inline-flex items-center rounded-full border border-transparent px-1.5 py-0.5 text-xs font-medium ${badgeClass}`}>
      {owner}
    </span>
  )
}

export default function AutonomyRoadmapPanel({ apiBase = '/api/business' }: AutonomyRoadmapPanelProps) {
  const [data, setData] = useState<Readiness | null>(null)
  const [loading, setLoading] = useState(true)
  const [deepLoading, setDeepLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (deep = false) => {
    if (deep) setDeepLoading(true)
    else setLoading(true)
    setError(null)
    try {
      const url = new URL(`${apiBase}/autonomy-roadmap`, typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000')
      if (deep) url.searchParams.set('deep', 'true')
      const res = await fetch(url.toString(), { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || json?.detail || 'Could not load autonomy roadmap')
      setData(json)
    } catch (err: any) {
      setError(err?.message || 'Could not load autonomy roadmap')
    } finally {
      setLoading(false)
      setDeepLoading(false)
    }
  }, [apiBase])

  const executeAction = useCallback(async (action: 'sync' | 'advance') => {
    setActionLoading(true)
    setError(null)
    try {
      const url = new URL(`${apiBase}/autonomy-roadmap/${action}`, typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000')
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `Action ${action} failed`)
      // Re-fetch after action
      await load(false)
    } catch (err: any) {
      setError(err?.message || `Action failed`)
    } finally {
      setActionLoading(false)
    }
  }, [apiBase, load])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <div className="flex min-h-[160px] items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/60 text-zinc-400">
        <Loader2 className="mr-3 h-5 w-5 animate-spin" />
        Loading autonomy roadmap…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-400/15 bg-rose-500/[0.06] p-5 text-sm text-rose-200">
        {error}
      </div>
    )
  }

  if (!data) return null

  const score = data.score ?? 0
  const scoreTone = score >= 90 ? 'text-emerald-300' : score >= 60 ? 'text-amber-300' : 'text-rose-300'

  // Group dimensions by phase
  const dimensionsByPhase = (data.dimensions || []).reduce((acc, dim) => {
    const phase = dim.phase || 'unknown'
    if (!acc[phase]) acc[phase] = []
    acc[phase].push(dim)
    return acc
  }, {} as Record<string, Dimension[]>)

  // Phase order
  const phaseOrder = ['P0', 'P1', 'P2', 'P3']
  const sortedPhases = phaseOrder.filter(p => dimensionsByPhase[p])

  // Get phase titles from data
  const phaseTitles = (data.phases || []).reduce((acc, p) => {
    acc[p.id] = p.title
    return acc
  }, {} as Record<string, string>)

  return (
    <section className="rounded-2xl border border-purple-400/15 bg-gradient-to-br from-purple-500/[0.06] to-zinc-900/40 p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-purple-500/[0.14] p-3 text-purple-300">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-zinc-100">Autonomous Business Roadmap</h2>
            <p className="mt-0.5 text-sm text-zinc-500">Run · market · sell — hands-off</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className={`text-3xl font-bold ${scoreTone}`}>
              {score}
              <span className="text-base text-zinc-600">/100</span>
            </p>
            <p className="text-xs text-zinc-500">{data.ready ? 'Ready' : 'Building'}</p>
          </div>
          <button
            type="button"
            onClick={() => load(true)}
            disabled={deepLoading}
            title="Run deep checks"
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-600 disabled:opacity-50"
          >
            {deepLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Deep check
          </button>
        </div>
      </div>

      {data.summary && (
        <p className="mb-6 text-sm text-zinc-300">{data.summary}</p>
      )}

      {/* Phases + Dimensions Grid */}
      {sortedPhases.length > 0 && (
        <div className="mb-6 space-y-6">
          {sortedPhases.map(phaseId => {
            const dims = dimensionsByPhase[phaseId] || []
            const phaseDone = dims.filter(d => d.status === 'shipped').length
            const phaseTitle = phaseTitles[phaseId] || phaseId
            return (
              <div key={phaseId}>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-zinc-200">
                    {phaseId} — {phaseTitle}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {phaseDone}/{dims.length}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {dims.map(dim => (
                    <div
                      key={dim.id}
                      className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 transition-colors hover:border-zinc-700"
                    >
                      <div className="mb-3 flex flex-col gap-2">
                        <h3 className="text-sm font-medium text-zinc-100">{dim.label}</h3>
                        <div className="flex items-center justify-between gap-2">
                          <DimensionStatusPill status={dim.status} />
                          <p className="text-xs text-zinc-400">
                            <span className="font-semibold text-zinc-200">{dim.score}</span>
                            <span className="text-zinc-600">/{dim.max_score}</span>
                          </p>
                        </div>
                      </div>

                      {dim.blockers && dim.blockers.length > 0 && (
                        <div className="mb-2 space-y-1">
                          {dim.blockers.slice(0, 2).map(blocker => (
                            <div key={blocker.id} className="flex items-start gap-2 text-xs">
                              <SeverityBadge severity={blocker.severity} />
                              <span
                                className={`leading-tight ${
                                  blocker.severity === 'red'
                                    ? 'text-rose-400'
                                    : blocker.severity === 'yellow'
                                    ? 'text-amber-400'
                                    : 'text-emerald-400'
                                }`}
                              >
                                {blocker.label}
                              </span>
                            </div>
                          ))}
                          {dim.blockers.length > 2 && (
                            <p className="text-xs text-zinc-600">+{dim.blockers.length - 2} more</p>
                          )}
                        </div>
                      )}

                      {dim.checks && dim.checks.length > 0 && (
                        <div className="text-xs text-zinc-500">
                          <p>
                            {dim.checks.filter(c => c.status === 'done').length}/{dim.checks.length} checks
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Dimension Details (expandable grid) */}
      {data.dimensions && data.dimensions.length > 0 && (
        <div className="mb-6">
          <p className="mb-3 text-xs font-mono uppercase tracking-[0.18em] text-zinc-500">
            Dimension checks
          </p>
          <div className="space-y-2">
            {data.dimensions.map(dim =>
              dim.checks.map(check => (
                <div
                  key={`${dim.id}-${check.id}`}
                  className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${ROW_BORDER[check.status] || 'border-zinc-700'} ${ROW_BG[check.status] || 'bg-zinc-950/50'}`}
                >
                  <StatusIcon status={check.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm font-medium ${TONE[check.status] || 'text-zinc-200'}`}>
                        {check.label}
                      </p>
                      <div className="flex items-center gap-1">
                        <OwnerBadge owner={check.owner} />
                        <SeverityBadge severity={check.severity} />
                      </div>
                    </div>
                    {check.detail && (
                      <p className="mt-1 text-xs text-zinc-500">{check.detail}</p>
                    )}
                    {check.engine && (
                      <p className="mt-0.5 text-xs text-zinc-600">{check.engine}</p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Open Roadmap Items */}
      {data.blockers && data.blockers.length > 0 && (
        <div className="mb-6">
          <p className="mb-2 text-xs font-mono uppercase tracking-[0.18em] text-zinc-500">
            Open roadmap items
          </p>
          <div className="space-y-2">
            {(data.blockers || []).map(b => (
              <div key={b.id} className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                <StatusIcon status={b.status} />
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${TONE[b.status] || 'text-zinc-200'}`}>{b.label}</p>
                  {b.action && b.action !== '—' && <p className="mt-0.5 text-xs text-zinc-500">{b.action}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => executeAction('sync')}
          disabled={actionLoading}
          className="inline-flex items-center gap-2 rounded-lg border border-purple-400/30 bg-purple-500/[0.08] px-4 py-2 text-sm font-medium text-purple-300 transition-colors hover:border-purple-400/50 hover:bg-purple-500/[0.12] disabled:opacity-50"
        >
          {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '→'}
          Sync to board
        </button>
        <button
          type="button"
          onClick={() => executeAction('advance')}
          disabled={actionLoading}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-500/[0.08] px-4 py-2 text-sm font-medium text-emerald-300 transition-colors hover:border-emerald-400/50 hover:bg-emerald-500/[0.12] disabled:opacity-50"
        >
          {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '⚡'}
          Advance (agents)
        </button>
      </div>
    </section>
  )
}
