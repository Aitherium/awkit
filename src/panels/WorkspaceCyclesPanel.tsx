'use client'

import React, { useState, useEffect, useCallback } from 'react'

interface Cycle {
  cycle_id: string
  workspace_id: string
  agent_id: string
  schedule: string
  goals: string[]
  max_tokens: number
  auto_execute: boolean
  enabled: boolean
  fleet_endpoint_id?: string
  last_executed_at?: string
  max_tokens_per_day?: number
}

interface WorkspaceCyclesPanelProps {
  workspaceId: string
  apiBase?: string
}

function humanCron(cron: string): string {
  const [min, hr, , , dow] = cron.split(' ')
  const dowMap: Record<string, string> = { '1-5': 'Weekdays', '0': 'Sun', '1': 'Mon', '*': 'Daily' }
  const dowLabel = dowMap[dow] || dow
  if (hr.startsWith('*/')) return `Every ${hr.slice(2)}h`
  if (min === '0' && !hr.includes('/')) return `${dowLabel} ${hr}:00`
  return cron
}

export default function WorkspaceCyclesPanel({ workspaceId, apiBase = '' }: WorkspaceCyclesPanelProps) {
  const [cycles, setCycles] = useState<Cycle[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [executing, setExecuting] = useState<string | null>(null)
  const [history, setHistory] = useState<any[]>([])
  const [selectedCycle, setSelectedCycle] = useState<string | null>(null)

  // Create form
  const [newAgent, setNewAgent] = useState('aither')
  const [newSchedule, setNewSchedule] = useState('0 */6 * * *')
  const [newGoals, setNewGoals] = useState('')
  const [newMaxTokens, setNewMaxTokens] = useState(4000)
  const [showCreate, setShowCreate] = useState(false)

  const fetchCycles = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/workspace/cycles`)
      if (res.ok) {
        const data = await res.json()
        setCycles(data.cycles || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [workspaceId, apiBase])

  useEffect(() => { fetchCycles() }, [fetchCycles])

  const createCycle = async () => {
    setCreating(true)
    try {
      const res = await fetch(`${apiBase}/api/workspace/cycles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: newAgent,
          schedule: newSchedule,
          goals: newGoals.split('\n').filter(Boolean),
          max_tokens: newMaxTokens,
        }),
      })
      if (res.ok) {
        setShowCreate(false)
        setNewGoals('')
        fetchCycles()
      }
    } catch { /* ignore */ }
    setCreating(false)
  }

  const toggleCycle = async (cycle: Cycle) => {
    try {
      await fetch(`${apiBase}/api/workspace/cycles/${cycle.cycle_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !cycle.enabled }),
      })
      fetchCycles()
    } catch { /* ignore */ }
  }

  const deleteCycle = async (cycleId: string) => {
    try {
      await fetch(`${apiBase}/api/workspace/cycles/${cycleId}`, { method: 'DELETE' })
      fetchCycles()
    } catch { /* ignore */ }
  }

  const executeCycle = async (cycleId: string) => {
    setExecuting(cycleId)
    try {
      const res = await fetch(`${apiBase}/api/workspace/cycles/${cycleId}/execute`, { method: 'POST' })
      if (res.ok) {
        fetchHistory(cycleId)
      }
    } catch { /* ignore */ }
    setExecuting(null)
  }

  const fetchHistory = async (cycleId: string) => {
    setSelectedCycle(cycleId)
    try {
      const res = await fetch(`${apiBase}/api/workspace/cycles/${cycleId}/history`)
      if (res.ok) {
        const data = await res.json()
        setHistory(data.executions || [])
      }
    } catch { /* ignore */ }
  }

  if (loading) return <div className="p-6 text-gray-400">Loading cycles...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Recurring Cycles</h2>
        <button onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-600 text-white hover:bg-cyan-500 transition-all">
          + New Cycle
        </button>
      </div>

      {showCreate && (
        <div className="bg-gray-800/60 rounded-lg p-4 space-y-3 border border-gray-700">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-400">Agent</span>
              <input value={newAgent} onChange={e => setNewAgent(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-gray-200" />
            </label>
            <label className="block">
              <span className="text-xs text-gray-400">Schedule (cron)</span>
              <input value={newSchedule} onChange={e => setNewSchedule(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-gray-200 font-mono" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-gray-400">Goals (one per line)</span>
            <textarea value={newGoals} onChange={e => setNewGoals(e.target.value)} rows={3}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-gray-200" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-400">Max Tokens</span>
            <input type="number" value={newMaxTokens} onChange={e => setNewMaxTokens(Number(e.target.value))}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-gray-200" />
          </label>
          <div className="flex gap-2">
            <button onClick={createCycle} disabled={creating}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-40">
              {creating ? 'Creating...' : 'Create'}
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white">Cancel</button>
          </div>
        </div>
      )}

      {cycles.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">No cycles configured yet.</div>
      ) : (
        <div className="space-y-2">
          {cycles.map(c => (
            <div key={c.cycle_id} className="bg-gray-800/40 rounded-lg p-3 border border-gray-700 flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${c.enabled ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                  <span className="text-sm font-medium text-gray-200">{c.agent_id}</span>
                  <span className="text-xs text-gray-500 font-mono" title={c.schedule}>{humanCron(c.schedule)}</span>
                </div>
                <div className="text-xs text-gray-500 mt-1">{c.goals.join(' | ')}</div>
                {c.fleet_endpoint_id && (
                  <span className="text-[10px] text-purple-400 mt-0.5 inline-block">Fleet: {c.fleet_endpoint_id}</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => fetchHistory(c.cycle_id)}
                  className="px-2 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-700">History</button>
                <button onClick={() => executeCycle(c.cycle_id)} disabled={executing === c.cycle_id}
                  className="px-2 py-1 rounded text-xs text-cyan-400 hover:bg-cyan-500/10">
                  {executing === c.cycle_id ? 'Running...' : 'Run'}
                </button>
                <button onClick={() => toggleCycle(c)}
                  className={`px-2 py-1 rounded text-xs ${c.enabled ? 'text-amber-400 hover:bg-amber-500/10' : 'text-emerald-400 hover:bg-emerald-500/10'}`}>
                  {c.enabled ? 'Pause' : 'Resume'}
                </button>
                <button onClick={() => deleteCycle(c.cycle_id)}
                  className="px-2 py-1 rounded text-xs text-red-400 hover:bg-red-500/10">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedCycle && history.length > 0 && (
        <div className="bg-gray-800/40 rounded-lg p-4 border border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-300">Execution History</span>
            <button onClick={() => setSelectedCycle(null)} className="text-xs text-gray-500 hover:text-white">Close</button>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {history.map((exec: any) => (
              <div key={exec.execution_id} className="flex items-center gap-3 text-xs border-b border-gray-700/50 pb-2">
                <span className={`inline-block w-2 h-2 rounded-full ${exec.status === 'completed' ? 'bg-emerald-400' : exec.status === 'failed' ? 'bg-red-400' : 'bg-gray-400'}`} />
                <span className="text-gray-400 font-mono">{exec.started_at?.slice(0, 19)}</span>
                <span className="text-gray-300">{exec.status}</span>
                <span className="text-gray-500">{exec.tokens_used} tokens</span>
                {exec.endpoint_used && (
                  <span className={`px-1.5 py-0.5 rounded ${exec.endpoint_used.startsWith('fleet:') ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-300'}`}>
                    {exec.endpoint_used.startsWith('fleet:') ? 'Fleet' : 'Genesis'}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
