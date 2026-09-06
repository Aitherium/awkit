'use client'

/**
 * Fleet state management.
 *
 * Fetches and manages:
 * - Service health status from /api/platform/status
 * - Room roster and ambient tuning from /api/platform/room/state
 * - Available workforce agents from /api/platform/workforce/agents
 * - Hiring/removal via POST /api/platform/room/agents and DELETE /api/platform/room/agents/{nick}
 */

import { useCallback, useEffect, useState } from 'react'

export interface ServiceStatus {
  name: string
  status: 'ok' | 'unreachable'
  url?: string
}

export interface RoomAgent {
  nick: string
  kind: 'fleet' | 'workforce'
  online?: boolean
  skills?: string[]
  description?: string
  reputation?: {
    up: number
    down: number
    net: number
    voters: number
  }
}

export interface WorkforceAgent {
  nick: string
  kind: string
  description: string
  version?: string
  capabilities?: string[]
  domains?: string[]
  has_persona?: boolean
  template?: boolean
}

export interface AmbientTuning {
  enabled: boolean
  response_probability: number
  max_responders: number
  cooldown_seconds: number
}

export interface RoomState {
  channel: string
  degraded: boolean
  just_created?: boolean
  messages: unknown[]
  people: unknown[]
  agents: RoomAgent[]
  ambient: AmbientTuning
  pins: unknown[]
}

export interface FleetState {
  services: ServiceStatus[]
  room: RoomState | null
  workforce: {
    available: boolean
    agents: WorkforceAgent[]
    note?: string
  } | null
  loading: boolean
  error: string | null
  degraded: boolean
}

const DEFAULT_ENDPOINTS = {
  status: '/api/platform/status',
  room: '/api/platform/room/state',
  workforce: '/api/platform/workforce/agents',
  hireAgent: '/api/platform/room/agents',
  removeAgent: (nick: string) => `/api/platform/room/agents/${encodeURIComponent(nick)}`,
}

export function useFleet(refreshInterval: number = 5000) {
  const [state, setState] = useState<FleetState>({
    services: [],
    room: null,
    workforce: null,
    loading: true,
    error: null,
    degraded: false,
  })

  const fetchFleetState = useCallback(async () => {
    try {
      const [statusRes, roomRes, workforceRes] = await Promise.all([
        fetch(DEFAULT_ENDPOINTS.status),
        fetch(DEFAULT_ENDPOINTS.room),
        fetch(DEFAULT_ENDPOINTS.workforce),
      ])

      const statusData = statusRes.ok
        ? await statusRes.json()
        : { error: 'Failed to fetch platform status' }

      const roomData = roomRes.ok
        ? await roomRes.json()
        : null

      const workforceData = workforceRes.ok
        ? await workforceRes.json()
        : { available: false, agents: [], note: 'Failed to fetch workforce' }

      // Parse status into service list
      const services: ServiceStatus[] = Object.entries(statusData as Record<string, unknown>)
        .filter(([key]) => key !== 'error')
        .map(([name, info]) => {
          const svc = info as Record<string, unknown>
          return {
            name,
            status: svc.status === 'ok' ? 'ok' : 'unreachable',
            url: typeof svc.url === 'string' ? svc.url : undefined,
          }
        })

      const degraded = services.some((s) => s.status === 'unreachable')

      setState({
        services,
        room: roomData,
        workforce: workforceData,
        loading: false,
        error: null,
        degraded,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setState((prev) => ({
        ...prev,
        loading: false,
        error: msg,
      }))
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    fetchFleetState()
  }, [fetchFleetState])

  // Auto-refresh
  useEffect(() => {
    const interval = setInterval(fetchFleetState, refreshInterval)
    return () => clearInterval(interval)
  }, [fetchFleetState, refreshInterval])

  const hireAgent = useCallback(async (nick: string) => {
    try {
      // The field is `agent`, not `nick`. Sending the wrong key does NOT 4xx —
      // the route answers 200 with {"error": "agent field required"}, so the
      // hire silently did nothing while the UI reported success. Hence the
      // explicit payload-level error check below, not just res.ok.
      const res = await fetch(DEFAULT_ENDPOINTS.hireAgent, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ agent: nick }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const payload = await res.json().catch(() => ({}))
      if (payload && payload.error) throw new Error(String(payload.error))
      await fetchFleetState()
      return true
    } catch (err) {
      console.error('Failed to hire agent:', err)
      return false
    }
  }, [fetchFleetState])

  const removeAgent = useCallback(async (nick: string) => {
    try {
      const res = await fetch(DEFAULT_ENDPOINTS.removeAgent(nick), {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await fetchFleetState()
      return true
    } catch (err) {
      console.error('Failed to remove agent:', err)
      return false
    }
  }, [fetchFleetState])

  return {
    ...state,
    hireAgent,
    removeAgent,
    refresh: fetchFleetState,
  }
}
