'use client'

/**
 * Live state for the Company Room.
 *
 * Consumes from two sources: a real-time SSE stream at `/api/platform/room/stream`
 * and a fallback poll at `GET /api/platform/room/state`. The stream is preferred;
 * if it fails or stalls, the poll keeps the last good state on screen and sets
 * `degraded`. No blank screens — the room is the user's home.
 *
 * The room publishes events from the daemon at 127.0.0.1:8362 via the harness
 * bridge. Actor kinds: human (user), claude_code (agent tabs), service (awnode,
 * Genesis, etc.), kernel (system lifecycle). Pillars organize events: intent,
 * context, reasoning, orchestration, learning, automation.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AitherEvent, Pillar, pillarFor } from '../../aither-events.generated'

export interface RoomMessage {
  id?: string
  content: string
  nick?: string
  sender?: string
  timestamp?: string
  created_at?: string
  type?: string
  /** Client-side only — shown immediately, reconciled on the next poll. */
  optimistic?: boolean
  failed?: boolean
}

export interface RoomPerson {
  nick: string
  online?: boolean
  is_agent?: boolean
  status?: string
}

export interface RoomAgent {
  nick: string
  kind?: string
  online?: boolean
  description?: string
  skills?: string[]
}

export interface AmbientTuning {
  enabled: boolean
  /** Chance a rostered agent speaks up unprompted, 0..1. */
  response_probability?: number
  max_responders?: number
  cooldown_seconds?: number
}

export interface RoomState {
  channel: string
  loading: boolean
  /** The room could not be reached or the stream stalled — retrying. */
  degraded: boolean
  /**
   * The backend answered 401/403: there is no session. NOT `degraded` — nothing
   * is retrying, because nothing can succeed until the visitor signs in.
   */
  unauthenticated: boolean
  justCreated: boolean
  messages: RoomMessage[]
  people: RoomPerson[]
  agents: RoomAgent[]
  ambient: AmbientTuning
  pins: RoomMessage[]
  /** Live events from the daemon, bucketed by pillar. */
  events: Record<Pillar, AitherEvent[]>
  /** True while a message is in flight or an agent is expected to answer. */
  listening: boolean
  say: (content: string) => Promise<void>
  inviteAgent: (agent: string) => Promise<void>
  dismissAgent: (agent: string) => Promise<void>
  refresh: () => void
}

const POLL_IDLE = 5000
/** After you speak, poll faster — an ambient agent may answer within a cooldown. */
const POLL_ACTIVE = 1500
const ACTIVE_WINDOW_MS = 25000

const msgKey = (m: RoomMessage, i: number) =>
  m.id || `${m.nick || m.sender || '?'}:${m.timestamp || m.created_at || i}`

export function useRoom(apiBase = '/api/platform'): RoomState {
  const [channel, setChannel] = useState('')
  const [loading, setLoading] = useState(true)
  const [degraded, setDegraded] = useState(false)
  // Distinct from `degraded`: the backend answered, and it said you are not
  // signed in. Conflating the two is what put a permanent red RECONNECTING in
  // front of an anonymous visitor to a customer's portal.
  const [unauthenticated, setUnauthenticated] = useState(false)
  const [justCreated, setJustCreated] = useState(false)
  const [messages, setMessages] = useState<RoomMessage[]>([])
  const [people, setPeople] = useState<RoomPerson[]>([])
  const [agents, setAgents] = useState<RoomAgent[]>([])
  const [ambient, setAmbient] = useState<AmbientTuning>({ enabled: false })
  const [pins, setPins] = useState<RoomMessage[]>([])
  const [events, setEvents] = useState<Record<Pillar, AitherEvent[]>>({
    intent: [],
    context: [],
    reasoning: [],
    orchestration: [],
    learning: [],
    automation: [],
  })
  const [listening, setListening] = useState(false)

  const pending = useRef<RoomMessage[]>([])
  const activeUntil = useRef(0)
  const mounted = useRef(true)
  const tick = useRef(0)
  const streamController = useRef<AbortController | null>(null)
  const lastStreamSeq = useRef(0)
  // The poll closure captures state once; a ref is what lets it observe the
  // 401 that arrived after it was created.
  const unauthenticatedRef = useRef(false)

  const subscribeStream = useCallback(async () => {
    // Open SSE connection to room stream. If it stalls or closes, fall back to
    // polling. The stream is best-effort; a poll always brings state back.
    try {
      streamController.current = new AbortController()
      const since = Math.max(0, lastStreamSeq.current)
      const resp = await fetch(`${apiBase}/room/stream?since=${since}`, {
        credentials: 'same-origin',
        signal: streamController.current.signal,
      })
      if (resp.status === 401 || resp.status === 403) {
        if (mounted.current) { setUnauthenticated(true); setDegraded(false) }
        return
      }
      if (!resp.ok || !resp.body) {
        if (mounted.current) setDegraded(true)
        return
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // Process complete lines (SSE events end with \n\n)
        const lines = buffer.split('\n')
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (!line.trim() || line.startsWith(':')) continue // Skip empty/comments
          if (line.startsWith('data:')) {
            try {
              const data = JSON.parse(line.slice(5).trim()) as AitherEvent
              lastStreamSeq.current = data.seq || lastStreamSeq.current
              activeUntil.current = Date.now() + ACTIVE_WINDOW_MS
              setListening(true)

              // Bucket event by pillar. If the event has an explicit pillar, use it;
              // otherwise try to derive it from the event type. Surface events (null
              // pillar) are dropped here — they belong in the messages pane.
              const targetPillar = data.pillar ?? pillarFor(data.type)
              if (targetPillar && mounted.current) {
                setEvents((prev) => {
                  const next = { ...prev }
                  next[targetPillar] = [...next[targetPillar], data]
                  return next
                })
              }

              if (!mounted.current) return
            } catch { /* malformed event */ }
          }
        }
      }
    } catch (e) {
      // Stream closed or errored; fallback to polling will handle it
      if (mounted.current && !(e instanceof DOMException && e.name === 'AbortError')) {
        setDegraded(true)
      }
    }
  }, [apiBase])

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/room/state?limit=60`, { credentials: 'same-origin' })
      if (r.status === 401 || r.status === 403) {
        // NOT degraded. A signed-out visitor is not a network problem, and
        // saying "Reconnecting" to one is a lie that never resolves — measured
        // 2026-08-19 on a customer's portal, where an anonymous visitor saw a red
        // RECONNECTING forever while the backend was healthy and answering. Stop
        // polling too: retrying an endpoint that requires a session cannot
        // succeed, and eight authenticated calls firing on every tick is how the
        // signed-out desktop produced a console full of 401s.
        if (mounted.current) {
          setUnauthenticated(true)
          setDegraded(false)
          setLoading(false)
        }
        return
      }
      if (mounted.current) setUnauthenticated(false)
      if (!r.ok) {
        if (mounted.current) setDegraded(true)
        return
      }
      const data = await r.json()
      if (!mounted.current) return

      const incoming: RoomMessage[] = data.messages || []
      // Drop optimistic echoes the server has now confirmed.
      if (pending.current.length) {
        const seen = new Set(incoming.map((m) => (m.content || '').trim()))
        pending.current = pending.current.filter((p) => !seen.has((p.content || '').trim()))
      }

      setChannel(data.channel || '')
      setMessages([...incoming, ...pending.current])
      setPeople(data.people || [])
      setAgents(data.agents || [])
      setAmbient(data.ambient || { enabled: false })
      setPins(data.pins || [])
      setDegraded(Boolean(data.degraded))
      setJustCreated(Boolean(data.just_created))
      setLoading(false)
      if (Date.now() > activeUntil.current) setListening(false)
    } catch {
      if (mounted.current) setDegraded(true)
    }
  }, [apiBase])

  // Dual-source room state: SSE stream (real-time) + polling (degradation fallback).
  // The stream runs in background; if it stalls, polling keeps the user's view fresh.
  // Both sources are non-blocking: never blank the room on a Relay blip.
  useEffect(() => {
    mounted.current = true
    load()

    // Start stream subscription in the background (non-blocking if it fails)
    const streamPromise = subscribeStream().catch(() => {
      if (mounted.current) setDegraded(true)
    })

    // Polling continues as degradation fallback
    const schedule = () => {
      const delay = Date.now() < activeUntil.current ? POLL_ACTIVE : POLL_IDLE
      tick.current = window.setTimeout(async () => {
        await load()
        // A session cannot appear from polling. Re-arming here is what turned one
        // signed-out tab into an endless 401 stream against the customer's API.
        if (mounted.current && !unauthenticatedRef.current) schedule()
      }, delay)
    }
    schedule()

    return () => {
      mounted.current = false
      window.clearTimeout(tick.current)
      if (streamController.current) streamController.current.abort()
    }
  }, [load, subscribeStream])

  const say = useCallback(
    async (content: string) => {
      const text = content.trim()
      if (!text) return
      const optimistic: RoomMessage = {
        content: text,
        nick: 'you',
        timestamp: new Date().toISOString(),
        optimistic: true,
      }
      pending.current = [...pending.current, optimistic]
      setMessages((prev) => [...prev, optimistic])
      activeUntil.current = Date.now() + ACTIVE_WINDOW_MS
      setListening(true)
      try {
        const r = await fetch(`${apiBase}/room/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ content: text }),
        })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
      } catch {
        pending.current = pending.current.map((p) =>
          p === optimistic ? { ...p, failed: true } : p)
        setMessages((prev) =>
          prev.map((m) => (m === optimistic ? { ...m, failed: true } : m)))
      }
      load()
    },
    [apiBase, load],
  )

  const inviteAgent = useCallback(
    async (agent: string) => {
      await fetch(`${apiBase}/room/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ agent }),
      })
      load()
    },
    [apiBase, load],
  )

  const dismissAgent = useCallback(
    async (agent: string) => {
      await fetch(`${apiBase}/room/agents/${encodeURIComponent(agent)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      load()
    },
    [apiBase, load],
  )

  useEffect(() => { unauthenticatedRef.current = unauthenticated }, [unauthenticated])

  return {
    channel, loading, degraded, unauthenticated, justCreated,
    messages, people, agents, ambient, pins, events, listening,
    say, inviteAgent, dismissAgent, refresh: load,
  }
}

export { msgKey }
