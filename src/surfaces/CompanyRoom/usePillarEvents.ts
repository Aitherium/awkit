'use client'

/**
 * Stream events from the AitherAeon daemon at 127.0.0.1:8362.
 *
 * The daemon serves real-time events on the six pillars (intent, context, reasoning,
 * orchestration, learning, automation). This hook handles:
 * - SSE stream connection with fallback polling
 * - Pillar-based filtering
 * - Graceful degradation when daemon is unreachable
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** Ring cap: a long-lived room must not grow this array without bound. */
const MAX_EVENTS = 500

export interface PillarEvent {
  id: string
  seq: number
  ts: number
  type: string
  actor: { kind: string; id: string; name: string }
  pillar: string | null
  tier: 'host' | 'fleet'
  payload: Record<string, unknown>
  stage?: string
}

export type Pillar = 'intent' | 'context' | 'reasoning' | 'orchestration' | 'learning' | 'automation'

export const PILLARS: Pillar[] = ['intent', 'context', 'reasoning', 'orchestration', 'learning', 'automation']

export interface PillarState {
  events: PillarEvent[]
  degraded: boolean
  loading: boolean
  error: string | null
  wellSummary: Record<string, { count: number; recent?: PillarEvent }>
  refresh: () => void
}

export function usePillarEvents(
  room = 'main',
  daemonBase = 'http://127.0.0.1:8362',
  filters?: { pillar?: Pillar; actor_kind?: string }
): PillarState {
  const [events, setEvents] = useState<PillarEvent[]>([])
  const [degraded, setDegraded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const mounted = useRef(true)
  const lastSeq = useRef(0)
  const streamController = useRef<AbortController | null>(null)
  const tick = useRef(0)

  // Compute summary: count per pillar
  const wellSummary = {
    intent: { count: 0, recent: undefined as PillarEvent | undefined },
    context: { count: 0, recent: undefined as PillarEvent | undefined },
    reasoning: { count: 0, recent: undefined as PillarEvent | undefined },
    orchestration: { count: 0, recent: undefined as PillarEvent | undefined },
    learning: { count: 0, recent: undefined as PillarEvent | undefined },
    automation: { count: 0, recent: undefined as PillarEvent | undefined },
  }

  for (const evt of events) {
    const p = evt.pillar as Pillar | null
    if (p && p in wellSummary) {
      wellSummary[p].count++
      if (!wellSummary[p].recent || evt.seq > wellSummary[p].recent!.seq) {
        wellSummary[p].recent = evt
      }
    }
  }

  const subscribeStream = useCallback(async () => {
    try {
      streamController.current = new AbortController()
      const since = Math.max(0, lastSeq.current)
      let url = `${daemonBase}/rooms/${encodeURIComponent(room)}/stream?since=${since}`

      if (filters?.pillar) {
        url += `&pillar=${encodeURIComponent(filters.pillar)}`
      }

      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${getBearerToken()}`,
        },
        signal: streamController.current.signal,
      })

      if (!resp.ok || !resp.body) {
        if (mounted.current) setDegraded(true)
        return
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim() || line.startsWith(':')) continue
          if (line.startsWith('data:')) {
            try {
              const data = JSON.parse(line.slice(5).trim())
              lastSeq.current = data.seq || lastSeq.current
              if (!mounted.current) return
              // STORE IT. This previously parsed each event, advanced lastSeq and
              // dropped the event on the floor — so the stream "worked", the seq
              // climbed, and the lanes rendered "Waiting…" forever. Dedupe by seq
              // because the poll fallback covers the same range and both paths
              // converge on this state.
              setEvents((prev) => {
                if (prev.some((e) => e.seq === data.seq)) return prev
                const next = [...prev, data as PillarEvent]
                return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next
              })
            } catch {
              /* malformed event */
            }
          }
        }
      }
    } catch (e) {
      if (mounted.current && !(e instanceof DOMException && e.name === 'AbortError')) {
        setDegraded(true)
        setError('Stream connection failed')
      }
    }
  }, [room, daemonBase, filters])

  const load = useCallback(async () => {
    try {
      const since = Math.max(0, lastSeq.current)
      let url = `${daemonBase}/rooms/${encodeURIComponent(room)}/events?since=${since}&limit=100`

      if (filters?.pillar) {
        url += `&pillar=${encodeURIComponent(filters.pillar)}`
      }

      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${getBearerToken()}`,
        },
      })

      if (!resp.ok) {
        if (mounted.current) {
          setDegraded(true)
          setError(`HTTP ${resp.status}`)
        }
        return
      }

      const data = (await resp.json()) as { events: PillarEvent[]; last_seq: number }
      if (!mounted.current) return

      setEvents(data.events || [])
      lastSeq.current = data.last_seq || lastSeq.current
      setDegraded(false)
      setError(null)
      setLoading(false)
    } catch (e) {
      if (mounted.current) {
        setDegraded(true)
        setError(e instanceof Error ? e.message : 'Unknown error')
      }
    }
  }, [room, daemonBase, filters])

  useEffect(() => {
    mounted.current = true
    setLoading(true)
    load()

    // Start stream in background
    subscribeStream().catch(() => {
      if (mounted.current) setDegraded(true)
    })

    // Polling as degradation fallback
    const schedule = () => {
      tick.current = window.setTimeout(async () => {
        await load()
        if (mounted.current) schedule()
      }, 5000)
    }
    schedule()

    return () => {
      mounted.current = false
      window.clearTimeout(tick.current)
      if (streamController.current) streamController.current.abort()
    }
  }, [load, subscribeStream])

  return {
    events,
    degraded,
    loading,
    error,
    wellSummary,
    refresh: load,
  }
}

function getBearerToken(): string {
  if (typeof window === 'undefined') return ''
  // Try to get from localStorage if available
  try {
    return localStorage.getItem('aither_harness_token') || ''
  } catch {
    return ''
  }
}
