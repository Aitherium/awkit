'use client'

import { useState, useEffect, useCallback } from 'react'

interface Agent {
  id?: string
  name: string
  identity?: string
  agent_id?: string
  status?: string
  capabilities?: string[]
  description?: string
  url?: string
  tools?: string[]
  soul?: string
}

interface Node {
  id?: string
  hostname?: string
  name?: string
  url?: string
  status?: string
  gpu?: string
  models?: string[]
  last_seen?: string
  type?: string
}

type View = 'fleet' | 'nodes' | 'dispatch'

interface AgentsPanelProps {
  apiBase?: string
}

export default function AgentsPanel({ apiBase = '/api/platform' }: AgentsPanelProps = {}) {
  const [view, setView] = useState<View>('fleet')
  const [agents, setAgents] = useState<Agent[]>([])
  const [nodes, setNodes] = useState<Node[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  // Dispatch
  const [dispatchAgent, setDispatchAgent] = useState('')
  const [dispatchTask, setDispatchTask] = useState('')
  const [dispatching, setDispatching] = useState(false)
  const [dispatchResult, setDispatchResult] = useState<any>(null)
  // Node register
  const [showRegister, setShowRegister] = useState(false)
  const [registerUrl, setRegisterUrl] = useState('')
  const [registering, setRegistering] = useState(false)
  const [registerStatus, setRegisterStatus] = useState('')

  const fetchFleet = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`${apiBase}/fleet`)
      const d = await r.json()
      setAgents(d.agents || [])
    } catch { setAgents([]) }
    finally { setLoading(false) }
  }, [])

  const fetchNodes = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`${apiBase}/nodes`)
      const d = await r.json()
      setNodes(d.nodes || [])
    } catch { setNodes([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (view === 'fleet') fetchFleet()
    if (view === 'nodes') fetchNodes()
  }, [view, fetchFleet, fetchNodes])

  const dispatch = async () => {
    if (!dispatchAgent || !dispatchTask) return
    setDispatching(true)
    setDispatchResult(null)
    try {
      const r = await fetch(`${apiBase}/fleet/${dispatchAgent}/dispatch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: dispatchTask }),
      })
      setDispatchResult(await r.json())
    } catch (e: any) { setDispatchResult({ error: e.message }) }
    finally { setDispatching(false) }
  }

  const registerNode = async () => {
    if (!registerUrl) return
    setRegistering(true)
    setRegisterStatus('')
    try {
      const r = await fetch(`${apiBase}/nodes/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: registerUrl, type: 'inference' }),
      })
      if (r.ok) {
        setRegisterStatus('Node registered')
        setRegisterUrl('')
        setShowRegister(false)
        fetchNodes()
      } else {
        const d = await r.json()
        setRegisterStatus(`Failed: ${d.error || d.detail || 'Unknown'}`)
      }
    } catch { setRegisterStatus('Registration failed') }
    finally { setRegistering(false); setTimeout(() => setRegisterStatus(''), 4000) }
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1000 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Agents & Infrastructure</h2>
        <button onClick={() => view === 'fleet' ? fetchFleet() : fetchNodes()} style={{
          padding: '0.4rem 0.75rem', background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
          borderRadius: 'var(--radius)', fontSize: '0.75rem', border: '1px solid var(--glass-border)',
        }}>Refresh</button>
      </div>

      {/* View tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem' }}>
        {(['fleet', 'nodes', 'dispatch'] as View[]).map(v => (
          <button key={v} onClick={() => setView(v)} style={{
            padding: '0.5rem 1rem', borderRadius: 'var(--radius)', fontSize: '0.8rem', fontWeight: 500,
            background: view === v ? 'var(--accent-primary)' : 'var(--bg-surface)',
            color: view === v ? 'var(--bg-deep)' : 'var(--text-secondary)',
            border: view === v ? 'none' : '1px solid var(--glass-border)',
            textTransform: 'capitalize',
          }}>{v === 'fleet' ? `Agent Fleet (${agents.length})` : v === 'nodes' ? `Compute Nodes (${nodes.length})` : 'Dispatch Task'}</button>
        ))}
      </div>

      {/* Fleet view */}
      {view === 'fleet' && (
        loading ? <Loader /> : agents.length === 0 ? (
          <EmptyState text="No agents are set up for this workspace yet. An administrator can add one from the platform." />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
            {agents.map((a, i) => {
              const id = a.agent_id || a.id || a.name || `agent-${i}`
              const isOnline = a.status === 'active' || a.status === 'online' || a.status === 'ok'
              return (
                <div key={id} onClick={() => setSelectedAgent(a)} style={{
                  padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius)',
                  border: `1px solid ${selectedAgent === a ? 'var(--accent-primary)' : 'var(--glass-border)'}`,
                  cursor: 'pointer', transition: 'border-color 0.15s',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%',
                      background: isOnline ? 'var(--accent-green)' : 'var(--text-muted)',
                      boxShadow: isOnline ? '0 0 6px var(--accent-green)' : 'none' }} />
                    <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{a.name}</span>
                  </div>
                  {a.description && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.description}
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                    {(a.capabilities || []).slice(0, 4).map((c, ci) => (
                      <span key={ci} style={{ background: 'var(--bg-elevated)', padding: '0.1rem 0.4rem',
                        borderRadius: 4, fontSize: '0.65rem', color: 'var(--accent-cyan)' }}>{c}</span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}

      {/* Agent detail */}
      {view === 'fleet' && selectedAgent && (
        <div style={{ marginTop: '1.5rem', padding: '1.25rem', background: 'var(--bg-surface)',
          borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>{selectedAgent.name}</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
                {selectedAgent.description || 'No description'}
              </p>
            </div>
            <button onClick={() => { setDispatchAgent(selectedAgent.agent_id || selectedAgent.name); setView('dispatch') }}
              style={{ padding: '0.5rem 0.85rem', background: 'var(--accent-primary)',
                color: 'var(--bg-deep)', borderRadius: 'var(--radius)', fontSize: '0.8rem', fontWeight: 600 }}>
              Dispatch Task
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '0.3rem',
            marginTop: '0.75rem', fontSize: '0.8rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>ID:</span>
            <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{selectedAgent.agent_id || selectedAgent.id || '-'}</span>
            <span style={{ color: 'var(--text-muted)' }}>Status:</span>
            <span>{selectedAgent.status || 'unknown'}</span>
            <span style={{ color: 'var(--text-muted)' }}>URL:</span>
            <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{selectedAgent.url || '-'}</span>
            {selectedAgent.capabilities && (
              <>
                <span style={{ color: 'var(--text-muted)' }}>Capabilities:</span>
                <span>{selectedAgent.capabilities.join(', ')}</span>
              </>
            )}
            {selectedAgent.tools && selectedAgent.tools.length > 0 && (
              <>
                <span style={{ color: 'var(--text-muted)' }}>Tools:</span>
                <span>{selectedAgent.tools.join(', ')}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Compute nodes */}
      {view === 'nodes' && (
        <>
          <div style={{ marginBottom: '1rem' }}>
            {showRegister ? (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center',
                padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius)',
                border: '1px solid var(--glass-border)' }}>
                <input value={registerUrl} onChange={e => setRegisterUrl(e.target.value)}
                  placeholder="http://hostname:port (vLLM, Ollama, llama.cpp, etc)"
                  onKeyDown={e => e.key === 'Enter' && registerNode()}
                  style={{ flex: 1, padding: '0.6rem 0.85rem', background: 'var(--bg-deep)',
                    border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)',
                    color: 'var(--text-primary)', fontSize: '0.85rem' }} />
                <button onClick={registerNode} disabled={registering || !registerUrl} style={{
                  padding: '0.6rem 1rem', background: 'var(--accent-primary)', color: 'var(--bg-deep)',
                  borderRadius: 'var(--radius)', fontSize: '0.8rem', fontWeight: 600,
                  opacity: registerUrl ? 1 : 0.5 }}>
                  {registering ? 'Registering...' : 'Register'}
                </button>
                <button onClick={() => setShowRegister(false)} style={{
                  padding: '0.6rem', background: 'var(--bg-elevated)', color: 'var(--text-muted)',
                  borderRadius: 'var(--radius)', fontSize: '0.85rem' }}>Cancel</button>
              </div>
            ) : (
              <button onClick={() => setShowRegister(true)} style={{
                padding: '0.6rem 1rem', background: 'var(--bg-surface)', color: 'var(--text-primary)',
                borderRadius: 'var(--radius)', fontSize: '0.8rem', border: '1px solid var(--glass-border)' }}>
                + Register Node
              </button>
            )}
            {registerStatus && (
              <p style={{ fontSize: '0.8rem', marginTop: '0.5rem',
                color: registerStatus.startsWith('Failed') ? 'var(--accent-coral)' : 'var(--accent-green)' }}>
                {registerStatus}
              </p>
            )}
          </div>

          {/* Onboarding instructions */}
          <div style={{ padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius)',
            border: '1px solid var(--glass-border)', marginBottom: '1rem' }}>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Quick Onboarding</h4>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              Install AitherShell on any device to auto-detect and register running models:
            </p>
            <code style={{ display: 'block', padding: '0.5rem 0.75rem', background: 'var(--bg-deep)',
              borderRadius: 4, fontSize: '0.75rem', color: 'var(--accent-cyan)', userSelect: 'all' }}>
              curl -fsSL https://portal.aitherium.com/install | bash && aither login && aither node register
            </code>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
              Auto-detects: Ollama, vLLM, llama.cpp, text-generation-webui, OpenClaw, Hermes, any OpenAI-compatible endpoint
            </p>
          </div>

          {loading ? <Loader /> : nodes.length === 0 ? (
            <EmptyState text="No compute nodes registered. Use the button above or install AitherShell on a device." />
          ) : (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {nodes.map((n, i) => {
                const isUp = n.status === 'active' || n.status === 'online' || n.status === 'ok'
                return (
                  <div key={n.id || i} style={{
                    padding: '0.85rem 1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius)',
                    border: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', gap: '0.75rem',
                  }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                      background: isUp ? 'var(--accent-green)' : 'var(--accent-coral)',
                      boxShadow: isUp ? '0 0 6px var(--accent-green)' : '0 0 6px var(--accent-coral)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{n.hostname || n.name || n.url || 'Unknown'}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {n.gpu || n.type || 'inference'} &middot; {n.url || ''}
                      </div>
                    </div>
                    {n.models && n.models.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap', flexShrink: 0 }}>
                        {n.models.slice(0, 3).map((m, mi) => (
                          <span key={mi} style={{ background: 'var(--bg-elevated)', padding: '0.1rem 0.4rem',
                            borderRadius: 4, fontSize: '0.65rem', color: 'var(--accent-cyan)' }}>{m}</span>
                        ))}
                        {n.models.length > 3 && (
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>+{n.models.length - 3}</span>
                        )}
                      </div>
                    )}
                    {n.last_seen && (
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                        {new Date(n.last_seen).toLocaleString()}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Dispatch view */}
      {view === 'dispatch' && (
        <div style={{ maxWidth: 700 }}>
          <div style={{ padding: '1.25rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius)',
            border: '1px solid var(--glass-border)' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>Dispatch Task to Agent</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <select value={dispatchAgent} onChange={e => setDispatchAgent(e.target.value)}
                  style={{ flex: 1, padding: '0.6rem 0.85rem', background: 'var(--bg-deep)',
                    border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)',
                    color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                  <option value="">Select agent...</option>
                  {agents.map((a, i) => (
                    <option key={i} value={a.agent_id || a.name}>{a.name}</option>
                  ))}
                </select>
              </div>
              <textarea value={dispatchTask} onChange={e => setDispatchTask(e.target.value)}
                placeholder="Describe the task..."
                rows={4}
                style={{ padding: '0.6rem 0.85rem', background: 'var(--bg-deep)',
                  border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)',
                  color: 'var(--text-primary)', fontSize: '0.85rem', resize: 'vertical',
                  fontFamily: 'inherit' }} />
              <button onClick={dispatch} disabled={dispatching || !dispatchAgent || !dispatchTask} style={{
                padding: '0.6rem 1.25rem', background: 'var(--accent-primary)', color: 'var(--bg-deep)',
                borderRadius: 'var(--radius)', fontSize: '0.85rem', fontWeight: 600,
                alignSelf: 'flex-start',
                opacity: (!dispatchAgent || !dispatchTask) ? 0.5 : 1,
              }}>
                {dispatching ? 'Dispatching...' : 'Dispatch'}
              </button>
            </div>
          </div>

          {/* Result */}
          {dispatchResult && (
            <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--bg-surface)',
              borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)' }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Result</h4>
              <pre style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap',
                wordBreak: 'break-word', fontFamily: 'var(--font-mono, monospace)' }}>
                {typeof dispatchResult === 'string' ? dispatchResult : JSON.stringify(dispatchResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Loader() {
  return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading...</div>
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{text}</div>
}
