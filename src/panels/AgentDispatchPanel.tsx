'use client'

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Agent {
  name: string
  description?: string
  capabilities?: string[]
  status?: 'online' | 'offline' | string
}

interface DispatchResult {
  answer?: string
  files?: string[]
  suggestions?: string[]
  code_refs?: string[]
  error?: string
  [key: string]: unknown
}

type View = 'fleet' | 'dispatch'

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Deterministic color from agent name for avatar circles. */
const AVATAR_PALETTE = [
  'var(--accent-primary)',   // purple
  'var(--accent-green)',     // green
  'var(--accent-cyan)',      // cyan
  'var(--accent-coral)',     // coral
  'oklch(0.82 0.12 80)',    // gold
  'oklch(0.75 0.12 350)',   // rose
  'oklch(0.70 0.14 250)',   // blue
] as const

function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]
}

function effortLabel(level: number): { label: string; color: string } {
  if (level <= 2) return { label: 'Quick (1-2)', color: 'var(--accent-green)' }
  if (level <= 6) return { label: 'Standard (3-6)', color: 'var(--accent-cyan)' }
  return { label: 'Deep (7-10)', color: 'var(--accent-primary)' }
}

/* ------------------------------------------------------------------ */
/*  Skeleton placeholder                                               */
/* ------------------------------------------------------------------ */

function Skeleton({ width, height = '1rem' }: { width?: string; height?: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: width ?? '100%',
        height,
        borderRadius: 'var(--radius)',
        background: 'var(--bg-elevated)',
        animation: 'agentPulse 1.5s ease-in-out infinite',
      }}
    />
  )
}

function CardSkeleton() {
  return (
    <div className="card" style={{ padding: '1.15rem' }}>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
        <Skeleton width="36px" height="36px" />
        <div style={{ flex: 1 }}>
          <Skeleton width="50%" height="0.9rem" />
          <div style={{ height: '0.35rem' }} />
          <Skeleton width="80%" height="0.7rem" />
        </div>
      </div>
      <Skeleton width="100%" height="32px" />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function AgentDispatchPanel() {
  const [view, setView] = useState<View>('fleet')
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [platformUnavailable, setPlatformUnavailable] = useState(false)

  // Dispatch form state
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [task, setTask] = useState('')
  const [effort, setEffort] = useState(5)
  const [dispatching, setDispatching] = useState(false)
  const [result, setResult] = useState<DispatchResult | null>(null)
  const [dispatchError, setDispatchError] = useState<string | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  /* ---- Fetch agents ---- */

  const fetchAgents = useCallback(async () => {
    setLoading(true)
    setError(null)
    setPlatformUnavailable(false)
    try {
      const res = await fetch('/api/intelligence/agents')
      if (res.status === 501) {
        setPlatformUnavailable(true)
        setAgents([])
        return
      }
      if (!res.ok) throw new Error(`Failed to load agents (${res.status})`)
      const data = await res.json()
      setAgents(data.agents ?? data ?? [])
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load agents'
      setError(msg)
      setAgents([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  /* ---- Dispatch ---- */

  const selectAgent = (name: string) => {
    setSelectedAgent(name)
    setView('dispatch')
    setTask('')
    setEffort(5)
    setResult(null)
    setDispatchError(null)
  }

  const dispatch = async () => {
    if (!selectedAgent || !task.trim()) return
    setDispatching(true)
    setResult(null)
    setDispatchError(null)
    try {
      const res = await fetch('/api/intelligence/forge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_type: selectedAgent,
          task: task.trim(),
          effort: effort,
        }),
      })
      if (res.status === 501) {
        setDispatchError('Platform connection required. Connect to AitherOS to dispatch agents.')
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setDispatchError(body.detail ?? body.error ?? `Dispatch failed (${res.status})`)
        return
      }
      const data = await res.json()
      setResult(data)
      // Scroll result into view after render
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Dispatch request failed'
      setDispatchError(msg)
    } finally {
      setDispatching(false)
    }
  }

  const eff = effortLabel(effort)

  return (
    <div className="panel">
      {/* ---- Header ---- */}
      <div className="panel-header">
        <h2 className="panel-title">Agent Dispatch</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div className="seg-control">
            <button data-active={view === 'fleet'} onClick={() => setView('fleet')}>
              Agent Fleet
            </button>
            <button data-active={view === 'dispatch'} onClick={() => setView('dispatch')}>
              Dispatch
            </button>
          </div>
          <button
            className="btn btn-ghost"
            onClick={fetchAgents}
            disabled={loading}
            style={{ padding: '0.4rem 0.7rem', fontSize: '0.78rem' }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* ================================================================ */}
      {/*  FLEET VIEW                                                      */}
      {/* ================================================================ */}
      {view === 'fleet' && (
        <div className="animate-in">
          {loading ? (
            <div className="grid-cards">
              {[1, 2, 3, 4, 5, 6].map(i => <CardSkeleton key={i} />)}
            </div>
          ) : platformUnavailable ? (
            <PlatformCard />
          ) : error ? (
            <div className="empty-state">
              <h3>Unable to load agents</h3>
              <p>{error}</p>
              <button
                className="btn btn-secondary"
                onClick={fetchAgents}
                style={{ marginTop: '0.75rem' }}
              >
                Retry
              </button>
            </div>
          ) : agents.length === 0 ? (
            <div className="empty-state">
              <h3>No agents available</h3>
              <p>Connect to the AitherOS platform to discover and dispatch agents from your fleet.</p>
            </div>
          ) : (
            <div className="grid-cards">
              {agents.map(agent => (
                <AgentCard
                  key={agent.name}
                  agent={agent}
                  onAsk={() => selectAgent(agent.name)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/*  DISPATCH VIEW                                                   */}
      {/* ================================================================ */}
      {view === 'dispatch' && (
        <div className="animate-in">
          {/* Agent selector: mini grid of clickable pills */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{
              display: 'block',
              fontSize: '0.72rem',
              fontWeight: 500,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: '0.5rem',
            }}>
              Select Agent
            </label>
            {loading ? (
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {[1, 2, 3, 4].map(i => <Skeleton key={i} width="100px" height="34px" />)}
              </div>
            ) : agents.length === 0 ? (
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                No agents loaded.{' '}
                <button
                  className="btn btn-ghost"
                  onClick={fetchAgents}
                  style={{ padding: '0.1rem 0.4rem', fontSize: '0.78rem' }}
                >
                  Refresh
                </button>
              </p>
            ) : (
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {agents.map(agent => {
                  const active = selectedAgent === agent.name
                  const isOnline = agent.status === 'online' || agent.status === 'active'
                  return (
                    <button
                      key={agent.name}
                      className={active ? 'btn btn-primary' : 'btn btn-secondary'}
                      onClick={() => {
                        setSelectedAgent(agent.name)
                        setResult(null)
                        setDispatchError(null)
                      }}
                      style={{
                        padding: '0.4rem 0.85rem',
                        fontSize: '0.78rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                      }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: isOnline ? 'var(--accent-green)' : 'var(--text-muted)',
                          flexShrink: 0,
                        }}
                      />
                      {agent.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Task textarea */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{
              display: 'block',
              fontSize: '0.72rem',
              fontWeight: 500,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: '0.4rem',
            }}>
              Task Description
            </label>
            <textarea
              className="auto-resize"
              value={task}
              onChange={e => setTask(e.target.value)}
              placeholder="Describe what you need..."
              rows={4}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                background: 'var(--bg-deep)',
                border: '1px solid var(--glass-border)',
                borderRadius: 'var(--radius)',
                color: 'var(--text-primary)',
                fontSize: '0.85rem',
                lineHeight: 1.6,
              }}
            />
          </div>

          {/* Effort slider */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{
              display: 'block',
              fontSize: '0.72rem',
              fontWeight: 500,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: '0.5rem',
            }}>
              Effort Level
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', flexShrink: 0 }}>1</span>
              <input
                type="range"
                min={1}
                max={10}
                value={effort}
                onChange={e => setEffort(Number(e.target.value))}
                style={{ flex: 1, accentColor: eff.color }}
              />
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', flexShrink: 0 }}>10</span>
              <span
                className="badge"
                style={{
                  color: eff.color,
                  fontWeight: 600,
                  minWidth: '6rem',
                  justifyContent: 'center',
                }}
              >
                {effort} - {eff.label}
              </span>
            </div>
          </div>

          {/* Submit */}
          <button
            className="btn btn-primary"
            onClick={dispatch}
            disabled={dispatching || !task.trim() || !selectedAgent}
            style={{
              opacity: (dispatching || !task.trim() || !selectedAgent) ? 0.5 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            {dispatching && <span className="loading-spinner" style={{ width: 14, height: 14 }} />}
            {dispatching
              ? 'Dispatching...'
              : selectedAgent
                ? `Dispatch to ${selectedAgent}`
                : 'Select an agent'}
          </button>

          {/* Dispatch error */}
          {dispatchError && (
            <div className="error-banner" style={{ marginTop: '1rem' }}>
              {dispatchError}
            </div>
          )}

          {/* Result */}
          {result && (
            <div ref={resultRef} className="card animate-in" style={{ marginTop: '1.25rem', padding: '1.25rem' }}>
              <h4 style={{
                fontSize: '0.85rem',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: '0.85rem',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}>
                Result
              </h4>

              {result.error ? (
                <div className="error-banner" style={{ marginBottom: 0 }}>{result.error}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {/* Answer prose */}
                  {result.answer && (
                    <div style={{
                      fontSize: '0.85rem',
                      color: 'var(--text-primary)',
                      lineHeight: 1.7,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}>
                      {result.answer}
                    </div>
                  )}

                  {/* Files */}
                  {result.files && result.files.length > 0 && (
                    <ResultSection label="Referenced Files">
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        {result.files.map((f, i) => (
                          <span
                            key={i}
                            className="badge badge-info"
                            style={{ fontFamily: 'var(--font-mono, monospace)' }}
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    </ResultSection>
                  )}

                  {/* Code refs */}
                  {result.code_refs && result.code_refs.length > 0 && (
                    <ResultSection label="Code References">
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        {result.code_refs.map((ref, i) => (
                          <span
                            key={i}
                            className="badge"
                            style={{
                              fontFamily: 'var(--font-mono, monospace)',
                              fontSize: '0.72rem',
                            }}
                          >
                            {ref}
                          </span>
                        ))}
                      </div>
                    </ResultSection>
                  )}

                  {/* Suggestions */}
                  {result.suggestions && result.suggestions.length > 0 && (
                    <ResultSection label="Suggestions">
                      <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                        {result.suggestions.map((s, i) => (
                          <li key={i} style={{
                            fontSize: '0.82rem',
                            color: 'var(--text-secondary)',
                            lineHeight: 1.6,
                            marginBottom: '0.25rem',
                          }}>
                            {s}
                          </li>
                        ))}
                      </ul>
                    </ResultSection>
                  )}

                  {/* Fallback: raw JSON for unknown shapes */}
                  {!result.answer && !result.files && !result.suggestions && !result.code_refs && (
                    <pre style={{
                      fontSize: '0.78rem',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontFamily: 'var(--font-mono, monospace)',
                      background: 'var(--bg-deep)',
                      padding: '0.85rem',
                      borderRadius: 'var(--radius)',
                    }}>
                      {JSON.stringify(result, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Keyframe for skeleton pulse -- injected once */}
      <style>{`
        @keyframes agentPulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.15; }
        }
      `}</style>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function AgentCard({ agent, onAsk }: { agent: Agent; onAsk: () => void }) {
  const isOnline = agent.status === 'online' || agent.status === 'active'
  const color = avatarColor(agent.name)
  const initial = agent.name.charAt(0).toUpperCase()

  return (
    <div className="card card-interactive" style={{ padding: '1.15rem' }}>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
        {/* Avatar circle */}
        <div style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.85rem',
          fontWeight: 700,
          color: 'var(--bg-deep)',
          flexShrink: 0,
        }}>
          {initial}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {agent.name}
            </span>
            <span
              data-tooltip={isOnline ? 'Online' : 'Offline'}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                flexShrink: 0,
                background: isOnline ? 'var(--accent-green)' : 'var(--text-muted)',
                boxShadow: isOnline ? '0 0 6px var(--accent-green)' : 'none',
              }}
            />
          </div>

          {agent.description && (
            <p style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              lineHeight: 1.45,
              marginTop: '0.2rem',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {agent.description}
            </p>
          )}
        </div>
      </div>

      {/* Capability badges */}
      {agent.capabilities && agent.capabilities.length > 0 && (
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          {agent.capabilities.slice(0, 5).map((cap, i) => (
            <span key={i} className="badge badge-info" style={{ fontSize: '0.65rem' }}>
              {cap}
            </span>
          ))}
          {agent.capabilities.length > 5 && (
            <span className="badge" style={{ fontSize: '0.65rem' }}>
              +{agent.capabilities.length - 5}
            </span>
          )}
        </div>
      )}

      {/* Ask button */}
      <button
        className="btn btn-primary"
        onClick={onAsk}
        style={{ width: '100%', padding: '0.45rem 0.85rem', fontSize: '0.8rem' }}
      >
        Ask
      </button>
    </div>
  )
}

function PlatformCard() {
  return (
    <div
      className="card"
      style={{
        padding: '2.5rem 2rem',
        textAlign: 'center',
        maxWidth: 480,
        margin: '0 auto',
      }}
    >
      <div style={{
        width: 48,
        height: 48,
        borderRadius: '50%',
        background: 'var(--bg-elevated)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 1rem',
        fontSize: '1.2rem',
        color: 'var(--accent-primary)',
      }}>
        {/* Simple link icon via CSS */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      </div>
      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
        Connect to AitherOS
      </h3>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 360, margin: '0 auto' }}>
        Agent intelligence requires an AitherOS platform connection.
        Link your workspace to unlock fleet discovery, dispatch, and agent collaboration.
      </p>
    </div>
  )
}

function ResultSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span style={{
        display: 'block',
        fontSize: '0.7rem',
        fontWeight: 500,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        marginBottom: '0.35rem',
      }}>
        {label}
      </span>
      {children}
    </div>
  )
}
