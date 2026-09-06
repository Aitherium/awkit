'use client'

/**
 * Six pillar lanes showing cognition events in real-time.
 *
 * Each lane is named after the cognitive engine (intent, context, reasoning,
 * orchestration, learning, automation) and renders events that belong to that
 * pillar, scrolling down as new events arrive.
 *
 * When the daemon is unreachable, says so plainly and offers a retry button.
 */

import { useEffect, useRef } from 'react'
import { usePillarEvents, type Pillar, PILLARS } from './usePillarEvents'
import './pillar-lanes.css'

const PILLAR_NAMES: Record<Pillar, string> = {
  intent: 'Intent',
  context: 'Context',
  reasoning: 'Reasoning',
  orchestration: 'Orchestration',
  learning: 'Learning',
  automation: 'Automation',
}

const PILLAR_COLORS: Record<Pillar, string> = {
  intent: '#f59e0b',
  context: '#3b82f6',
  reasoning: '#8b5cf6',
  orchestration: '#ec4899',
  learning: '#10b981',
  automation: '#f97316',
}

interface PillarLanesProps {
  room?: string
  daemonBase?: string
}

export default function PillarLanes({ room = 'main', daemonBase = 'http://127.0.0.1:8362' }: PillarLanesProps) {
  const { events, degraded, loading, error, wellSummary, refresh } = usePillarEvents(room, daemonBase)
  const lanesRef = useRef<HTMLDivElement>(null)

  // Auto-scroll lanes to bottom when new events arrive
  useEffect(() => {
    if (!lanesRef.current) return
    const lanes = lanesRef.current.querySelectorAll('[data-lane]')
    for (const lane of lanes) {
      const el = lane as HTMLElement
      el.scrollTop = el.scrollHeight
    }
  }, [events])

  // Group events by pillar, keeping only non-null pillars
  const eventsByPillar: Record<Pillar, typeof events> = {
    intent: [],
    context: [],
    reasoning: [],
    orchestration: [],
    learning: [],
    automation: [],
  }

  for (const evt of events) {
    if (evt.pillar && evt.pillar in eventsByPillar) {
      eventsByPillar[evt.pillar as Pillar].push(evt)
    }
  }

  return (
    <div className="pillar-lanes-container">
      <div className="pillar-lanes-header">
        <h2>Cognitive Activity</h2>
        <div className="pillar-lanes-status">
          {loading && <span className="pillar-status-loading">Loading…</span>}
          {error && (
            <>
              <span className="pillar-status-error">{error}</span>
              <button type="button" className="pillar-retry-btn" onClick={refresh}>
                Retry
              </button>
            </>
          )}
          {!loading && !error && degraded && (
            <span className="pillar-status-degraded">Polling (stream unavailable)</span>
          )}
          {!loading && !error && !degraded && <span className="pillar-status-live">Live</span>}
        </div>
      </div>

      {error && (
        <div className="pillar-lanes-degraded">
          <p>
            <strong>Daemon unreachable.</strong> The event stream at{' '}
            <code>{daemonBase}</code> could not be reached.
          </p>
          <p>
            This could mean the daemon is not running, or the network path is blocked. Check that
            the process is running on the host.
          </p>
          <button type="button" className="pillar-refresh-btn" onClick={refresh}>
            Try Again
          </button>
        </div>
      )}

      {!error && (
        <div className="pillar-lanes" ref={lanesRef}>
          {PILLARS.map((pillar) => (
            <div
              key={pillar}
              className="pillar-lane"
              data-lane={pillar}
              style={{ '--pillar-color': PILLAR_COLORS[pillar] } as React.CSSProperties}
            >
              <div className="pillar-lane-header">
                <h3>{PILLAR_NAMES[pillar]}</h3>
                <span className="pillar-count">{wellSummary[pillar]?.count || 0}</span>
              </div>

              <div className="pillar-events">
                {eventsByPillar[pillar].length === 0 ? (
                  <div className="pillar-empty">Waiting…</div>
                ) : (
                  eventsByPillar[pillar].map((evt) => (
                    <div key={evt.id} className="pillar-event" data-tier={evt.tier}>
                      <div className="event-meta">
                        <span className="event-type">{evt.type}</span>
                        <span className="event-actor" title={evt.actor.id}>
                          {evt.actor.name || evt.actor.id.slice(0, 8)}
                        </span>
                        <span className="event-time">{new Date(evt.ts * 1000).toLocaleTimeString()}</span>
                      </div>
                      {evt.payload && Object.keys(evt.payload).length > 0 && (
                        <div className="event-payload">
                          {evt.payload.text ? <p>{String(evt.payload.text).slice(0, 120)}</p> : null}
                          {evt.payload.tool ? <p className="event-tool">{String(evt.payload.tool)}</p> : null}
                          {!evt.payload.text && !evt.payload.tool && (
                            <p className="event-summary">{JSON.stringify(evt.payload).slice(0, 100)}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
