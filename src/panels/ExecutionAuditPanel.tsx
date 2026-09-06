'use client'

import React, { useState, useEffect, useCallback } from 'react'

interface AuditEntry {
  execution_id: string
  cycle_id: string
  timestamp: string
  agent_id: string
  status: string
  tokens_used: number
  prompt: string
  response: string
  gate_results: any
  error: string
}

interface ExecutionAuditPanelProps {
  workspaceId: string
  apiBase?: string
}

export default function ExecutionAuditPanel({ workspaceId, apiBase = '' }: ExecutionAuditPanelProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<AuditEntry | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterCycleId, setFilterCycleId] = useState<string>('')

  const fetchAudit = useCallback(async () => {
    setLoading(true)
    try {
      // Get all cycles first to find their history
      const cyclesRes = await fetch(`${apiBase}/workspaces/${workspaceId}/cycles`)
      if (cyclesRes.ok) {
        const cyclesData = await cyclesRes.json()
        const allEntries: AuditEntry[] = []
        for (const cycle of (cyclesData.cycles || [])) {
          try {
            const histRes = await fetch(`${apiBase}/workspaces/${workspaceId}/cycles/${cycle.cycle_id}/history`)
            if (histRes.ok) {
              const histData = await histRes.json()
              for (const exec of (histData.executions || [])) {
                allEntries.push({
                  execution_id: exec.execution_id || '',
                  cycle_id: exec.cycle_id || '',
                  timestamp: exec.started_at || '',
                  agent_id: cycle.agent_id || '',
                  status: exec.status || '',
                  tokens_used: exec.tokens_used || 0,
                  prompt: exec.prompt || '',
                  response: exec.response || '',
                  gate_results: exec.gate_results || {},
                  error: exec.error || '',
                })
              }
            }
          } catch { /* ignore */ }
        }
        allEntries.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        setEntries(allEntries)
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [workspaceId, apiBase])

  useEffect(() => { fetchAudit() }, [fetchAudit])

  const filtered = entries.filter(e => {
    if (filterStatus && e.status !== filterStatus) return false
    if (filterCycleId && e.cycle_id !== filterCycleId) return false
    return true
  })

  if (loading) return <div className="p-6 text-gray-400">Loading audit trail...</div>

  const uniqueCycleIds = [...new Set(entries.map(e => e.cycle_id))]

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Execution Audit Trail</h2>
        <span className="text-xs text-gray-500">{filtered.length} records</span>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-2 py-1 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300">
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="running">Running</option>
        </select>
        <select value={filterCycleId} onChange={e => setFilterCycleId(e.target.value)}
          className="px-2 py-1 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300">
          <option value="">All cycles</option>
          {uniqueCycleIds.map(id => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
        <button onClick={fetchAudit}
          className="px-2 py-1 rounded-lg text-xs text-cyan-400 hover:bg-cyan-500/10 transition-all">
          Refresh
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">No audit entries found.</div>
      ) : (
        <div className="space-y-1">
          {filtered.map(e => (
            <button key={e.execution_id} onClick={() => setSelected(selected?.execution_id === e.execution_id ? null : e)}
              className="w-full text-left bg-gray-800/40 rounded-lg p-3 border border-gray-700 hover:border-gray-600 transition-all">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`inline-block w-2 h-2 rounded-full ${
                    e.status === 'completed' ? 'bg-emerald-400' : e.status === 'failed' ? 'bg-red-400' : 'bg-amber-400'
                  }`} />
                  <span className="text-xs font-mono text-gray-400">{e.timestamp?.slice(0, 19)}</span>
                  <span className="text-xs text-gray-300">{e.agent_id}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500">{e.tokens_used} tokens</span>
                  <span className={`text-xs font-medium ${e.status === 'completed' ? 'text-emerald-400' : 'text-red-400'}`}>{e.status}</span>
                </div>
              </div>

              {selected?.execution_id === e.execution_id && (
                <div className="mt-3 pt-3 border-t border-gray-700 space-y-2">
                  {e.error && (
                    <div className="text-xs text-red-400 bg-red-500/5 p-2 rounded">{e.error}</div>
                  )}
                  <div>
                    <div className="text-[10px] text-gray-500 uppercase mb-1">Prompt</div>
                    <pre className="text-xs text-gray-400 whitespace-pre-wrap max-h-32 overflow-y-auto">{e.prompt}</pre>
                  </div>
                  {e.response && (
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase mb-1">Response</div>
                      <pre className="text-xs text-gray-300 whitespace-pre-wrap max-h-48 overflow-y-auto">{e.response}</pre>
                    </div>
                  )}
                  {e.gate_results && Object.keys(e.gate_results).length > 0 && (
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase mb-1">Gate Results</div>
                      <pre className="text-xs text-gray-400 whitespace-pre-wrap">{JSON.stringify(e.gate_results, null, 2)}</pre>
                    </div>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
