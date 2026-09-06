'use client'

/**
 * Fleet Surface — see what is answering, manage agents and endpoints.
 *
 * Shows platform health (8 services), the current ambient roster with tuning,
 * and lets you hire/dismiss agents from the company brain without navigating away.
 * Renders as a context surface (narrow + scrollable) and as a regular panel (wide).
 */

import { useRef } from 'react'
import type { RoomAgent, ServiceStatus, WorkforceAgent } from './useFleet'
import { useFleet } from './useFleet'
import './fleet.css'

interface FleetSurfaceProps {
  /** Called when the user wants to dismiss the surface (narrow screens). */
  onClose?: () => void
  /** Auto-refresh interval in ms (default 5000). Set to 0 to disable. */
  refreshInterval?: number
}

/**
 * Health indicator — what the status means in plain language.
 */
function statusLabel(status: 'ok' | 'unreachable'): string {
  return status === 'ok' ? 'answering' : 'not answering'
}

/**
 * Service health roll — a simple grid of name + status.
 */
function ServiceHealthSection({ services }: { services: ServiceStatus[] }) {
  return (
    <section className="fleet-section">
      <h3 className="fleet-section-title">Platform endpoints</h3>
      {services.length === 0 ? (
        <p className="fleet-note">Loading endpoints…</p>
      ) : (
        <ul className="fleet-roll">
          {services.map((svc) => (
            <li key={svc.name} className="fleet-item" data-status={svc.status}>
              <span className="fleet-item-name">{svc.name}</span>
              <span
                className="fleet-item-status"
                title={svc.url}
              >
                {statusLabel(svc.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Ambient roster — who is rostered to speak up, and the rules that govern it.
 */
function AmbientRosterSection({ agents, ambient }: { agents: RoomAgent[]; ambient?: { enabled: boolean; response_probability: number; max_responders: number; cooldown_seconds: number } | null }) {
  if (!ambient) return null

  const enabled = ambient.enabled && agents.length > 0
  const rostered = agents.filter((a) => a.kind === 'fleet')

  return (
    <section className="fleet-section">
      <h3 className="fleet-section-title">
        <span>Ambient roster</span>
        <span className="fleet-section-badge" data-active={enabled} title={enabled ? 'Agents are listening' : 'No agents rostered'}>
          {enabled ? `${rostered.length} listening` : 'silent'}
        </span>
      </h3>

      {rostered.length === 0 ? (
        <p className="fleet-note">No agents are rostered here. Type @ in the room to bring one in.</p>
      ) : (
        <>
          <ul className="fleet-roll">
            {rostered.map((a) => (
              <li key={a.nick} className="fleet-agent-item" data-online={a.online !== false}>
                <span className="fleet-agent-mark" aria-hidden="true" />
                <span className="fleet-agent-name">{a.nick}</span>
                <span className="fleet-agent-online">
                  {a.online !== false ? 'online' : 'offline'}
                </span>
              </li>
            ))}
          </ul>

          <div className="fleet-tuning">
            <div className="fleet-tuning-row">
              <span>Speak up probability</span>
              <span className="fleet-tuning-value">{Math.round(ambient.response_probability * 100)}%</span>
            </div>
            <div className="fleet-tuning-row">
              <span>Max responders per cue</span>
              <span className="fleet-tuning-value">{ambient.max_responders}</span>
            </div>
            <div className="fleet-tuning-row">
              <span>Cooldown between rounds</span>
              <span className="fleet-tuning-value">{ambient.cooldown_seconds.toFixed(1)}s</span>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

/**
 * Available workforce — agents from the company brain that can be hired.
 */
function WorkforceBrainSection({
  available,
  agents,
  rostered,
  onHire,
  hiring,
  note,
}: {
  available: boolean
  agents: WorkforceAgent[]
  rostered: Set<string>
  onHire: (nick: string) => Promise<boolean>
  hiring: Set<string>
  note?: string
}) {
  return (
    <section className="fleet-section">
      <h3 className="fleet-section-title">Company brain</h3>

      {!available && (
        <p className="fleet-note">
          {note || 'Company brain is not available. Mount .DAO-COMPANY-BRAIN to enable staffing.'}
        </p>
      )}

      {available && agents.length === 0 && (
        <p className="fleet-note">Brain is loaded but no agents are defined.</p>
      )}

      {available && agents.length > 0 && (
        <ul className="fleet-roll">
          {agents.map((a) => {
            const isRostered = rostered.has(a.nick)
            const isHiring = hiring.has(a.nick)

            return (
              <li
                key={a.nick}
                className="fleet-workforce-item"
                data-rostered={isRostered}
              >
                <div className="fleet-workforce-head">
                  <span className="fleet-workforce-name">{a.nick}</span>
                  {a.version && <span className="fleet-workforce-version">{a.version}</span>}
                </div>

                {a.description && (
                  <p className="fleet-workforce-description">{a.description}</p>
                )}

                {(a.domains && a.domains.length > 0) && (
                  <div className="fleet-workforce-domains">
                    {a.domains.map((d) => (
                      <span key={d} className="fleet-domain-tag">{d}</span>
                    ))}
                  </div>
                )}

                {(a.capabilities && a.capabilities.length > 0) && (
                  <div className="fleet-workforce-capabilities">
                    <span className="fleet-capabilities-label">Capabilities:</span>
                    {a.capabilities.slice(0, 3).map((c) => (
                      <span key={c} className="fleet-capability-tag">{c}</span>
                    ))}
                    {a.capabilities.length > 3 && (
                      <span className="fleet-capabilities-more">
                        +{a.capabilities.length - 3} more
                      </span>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  className="fleet-hire-button"
                  disabled={isRostered || isHiring}
                  onClick={() => onHire(a.nick)}
                  aria-label={isRostered ? `${a.nick} already in room` : `Hire ${a.nick}`}
                >
                  {isHiring ? 'Hiring…' : isRostered ? 'Already rostered' : 'Bring in'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default function FleetSurface({ onClose, refreshInterval = 5000 }: FleetSurfaceProps) {
  const {
    services, room, workforce, loading, error, degraded, hireAgent, removeAgent,
  } = useFleet(refreshInterval)

  const hiringRef = useRef<Set<string>>(new Set())

  const handleHire = async (nick: string) => {
    hiringRef.current.add(nick)
    const success = await hireAgent(nick)
    hiringRef.current.delete(nick)
    return success
  }

  const rostered = new Set(room?.agents.map((a) => a.nick) || [])

  return (
    <div className="fleet-surface">
      {/* Header */}
      <div className="fleet-header">
        <h2 className="fleet-title">Fleet & endpoints</h2>
        {onClose && (
          <button
            type="button"
            className="fleet-close"
            onClick={onClose}
            aria-label="Close"
          >
            Close
          </button>
        )}
      </div>

      {/* Content */}
      <div className="fleet-content">
        {loading && (
          <p className="fleet-note">Loading fleet status…</p>
        )}

        {error && (
          <p className="fleet-error">
            Could not load fleet status. Try again, or check that
            {' '}
            <code>/api/platform/status</code>
            {' '}
            is reachable.
          </p>
        )}

        {!loading && !error && degraded && (
          <div className="fleet-alert">
            <span className="fleet-alert-icon" aria-hidden="true">⚠</span>
            <span>
              Some endpoints are not answering. Check the platform tab below.
            </span>
          </div>
        )}

        {!loading && services.length > 0 && (
          <ServiceHealthSection services={services} />
        )}

        {!loading && room && (
          <AmbientRosterSection agents={room.agents} ambient={room.ambient} />
        )}

        {!loading && workforce && (
          <WorkforceBrainSection
            available={workforce.available}
            agents={workforce.agents}
            rostered={rostered}
            onHire={handleHire}
            hiring={hiringRef.current}
            note={workforce.note}
          />
        )}
      </div>
    </div>
  )
}
