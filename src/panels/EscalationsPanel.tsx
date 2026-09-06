'use client'

import React, { useCallback, useEffect, useState } from 'react'

interface Escalation {
  id: string
  action_type: string
  agent: string
  reason: string
  context: Record<string, unknown>
  status: string
  created_at: number
  resolved_at?: number
  resolved_by?: string
  decision?: string
}

const GENESIS_BASE = process.env.NEXT_PUBLIC_GENESIS_URL || 'http://localhost:8001'

async function fetchEscalations(status: 'pending' | 'history'): Promise<Escalation[]> {
  const endpoint = status === 'pending' ? '/escalations/pending' : '/escalations/history?limit=50'
  const res = await fetch(`${GENESIS_BASE}${endpoint}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.escalations || []
}

async function resolveEscalation(id: string, decision: 'approve' | 'deny'): Promise<boolean> {
  const res = await fetch(`${GENESIS_BASE}/escalations/${id}/${decision}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolved_by: 'admin' }),
  })
  return res.ok
}

function timeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const urgencyColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  low: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  denied: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
}

export function EscalationsPanel() {
  const [pending, setPending] = useState<Escalation[]>([])
  const [history, setHistory] = useState<Escalation[]>([])
  const [tab, setTab] = useState<'pending' | 'history'>('pending')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const [p, h] = await Promise.all([
      fetchEscalations('pending'),
      fetchEscalations('history'),
    ])
    setPending(p)
    setHistory(h)
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 10000)
    return () => clearInterval(interval)
  }, [refresh])

  const handleResolve = async (id: string, decision: 'approve' | 'deny') => {
    const ok = await resolveEscalation(id, decision)
    if (ok) refresh()
  }

  const items = tab === 'pending' ? pending : history

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Escalations</h2>
          {pending.length > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
              {pending.length} pending
            </span>
          )}
        </div>
        <button
          onClick={refresh}
          className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-200 dark:border-zinc-700">
        {(['pending', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize ${
              tab === t
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            {t} {t === 'pending' && pending.length > 0 ? `(${pending.length})` : ''}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {items.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-zinc-400 text-sm">
            {tab === 'pending' ? 'No pending escalations' : 'No escalation history'}
          </div>
        ) : (
          <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {items.map((esc) => {
              const urgency = (esc.context?.urgency as string) || 'medium'
              return (
                <div key={esc.id} className="px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-1.5 py-0.5 text-xs rounded ${urgencyColors[urgency] || urgencyColors.medium}`}>
                          {urgency}
                        </span>
                        <span className={`px-1.5 py-0.5 text-xs rounded ${statusColors[esc.status] || ''}`}>
                          {esc.status}
                        </span>
                        <span className="text-xs text-zinc-400">{esc.id.slice(0, 12)}</span>
                      </div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {esc.action_type}
                      </p>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-0.5">
                        {esc.reason}
                      </p>
                      <div className="flex gap-3 mt-1 text-xs text-zinc-400">
                        <span>Agent: {esc.agent}</span>
                        <span>{timeAgo(esc.created_at)}</span>
                        {esc.resolved_by && <span>Resolved by: {esc.resolved_by}</span>}
                      </div>
                    </div>
                    {esc.status === 'pending' && (
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          onClick={() => handleResolve(esc.id, 'approve')}
                          className="px-3 py-1.5 text-xs font-medium rounded bg-green-600 text-white hover:bg-green-700"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleResolve(esc.id, 'deny')}
                          className="px-3 py-1.5 text-xs font-medium rounded bg-red-600 text-white hover:bg-red-700"
                        >
                          Deny
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default EscalationsPanel
