'use client'

import { useState, useEffect, useCallback } from 'react'

interface Webhook {
  webhook_id: string
  name: string
  description?: string
  url: string
  secret?: string
  event_filter?: string
  forward_to?: string
  forward_mode: string
  active: boolean
  received_count: number
  last_triggered?: string
}

interface DeliveryLog {
  log_id: string
  timestamp: string
  source_ip: string
  status_code: number
  payload_preview: string
  response_time_ms: number
}

interface WebhookStats {
  total_received_today: number
  success_rate: number
  active_webhooks: number
  total_webhooks: number
}

type ViewState = { mode: 'list' } | { mode: 'detail'; webhookId: string } | { mode: 'create' }

const FORWARD_MODES = [
  { value: 'store_only', label: 'Store Only' },
  { value: 'flux_event', label: 'Flux Event' },
  { value: 'agent_task', label: 'Agent Task' },
  { value: 'http_forward', label: 'HTTP Forward' },
]

export interface WebhooksPanelProps {
  apiBase?: string
}

function formatRelativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  } catch {
    return iso
  }
}

export default function WebhooksPanel({ apiBase = '/api/webhooks' }: WebhooksPanelProps) {
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [stats, setStats] = useState<WebhookStats | null>(null)
  const [logs, setLogs] = useState<DeliveryLog[]>([])
  const [selectedWebhook, setSelectedWebhook] = useState<Webhook | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewState, setViewState] = useState<ViewState>({ mode: 'list' })
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [testing, setTesting] = useState(false)

  // Create form state
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formEventFilter, setFormEventFilter] = useState('')
  const [formForwardMode, setFormForwardMode] = useState('store_only')
  const [formForwardTo, setFormForwardTo] = useState('')

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const [webhooksRes, statsRes] = await Promise.all([
        fetch(`${apiBase}`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/stats`).then(r => r.ok ? r.json() : null),
      ])

      if (webhooksRes?.data?.webhooks) {
        setWebhooks(webhooksRes.data.webhooks)
      } else if (webhooksRes?.data) {
        setWebhooks(Array.isArray(webhooksRes.data) ? webhooksRes.data : [])
      }
      if (statsRes?.data) {
        setStats(statsRes.data)
      }
    } catch (e) {
      console.error('Webhooks fetch error:', e)
    }
    setLoading(false)
  }, [apiBase])

  const fetchDetail = useCallback(async (webhookId: string) => {
    try {
      const [detailRes, logsRes] = await Promise.all([
        fetch(`${apiBase}/${webhookId}`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/${webhookId}/logs?limit=25`).then(r => r.ok ? r.json() : null),
      ])

      if (detailRes?.data) {
        setSelectedWebhook(detailRes.data)
      }
      if (logsRes?.data?.logs) {
        setLogs(logsRes.data.logs)
      } else if (logsRes?.data) {
        setLogs(Array.isArray(logsRes.data) ? logsRes.data : [])
      }
    } catch (e) {
      console.error('Webhook detail fetch error:', e)
    }
  }, [apiBase])

  useEffect(() => { fetchList() }, [fetchList])

  useEffect(() => {
    if (viewState.mode === 'detail') {
      fetchDetail(viewState.webhookId)
    }
  }, [viewState, fetchDetail])

  const handleCreate = async () => {
    if (!formName) return
    try {
      const payload: Record<string, string> = { name: formName, forward_mode: formForwardMode }
      if (formDescription) payload.description = formDescription
      if (formEventFilter) payload.event_filter = formEventFilter
      if (formForwardTo) payload.forward_to = formForwardTo

      const resp = await fetch(`${apiBase}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (resp.ok) {
        setFormName('')
        setFormDescription('')
        setFormEventFilter('')
        setFormForwardMode('store_only')
        setFormForwardTo('')
        setViewState({ mode: 'list' })
        fetchList()
      }
    } catch (e) {
      console.error('Create webhook error:', e)
    }
  }

  const handleDelete = async (webhookId: string) => {
    try {
      const resp = await fetch(`${apiBase}/${webhookId}`, { method: 'DELETE' })
      if (resp.ok) {
        setViewState({ mode: 'list' })
        fetchList()
      }
    } catch (e) {
      console.error('Delete webhook error:', e)
    }
  }

  const handleTest = async (webhookId: string) => {
    setTesting(true)
    try {
      await fetch(`${apiBase}/${webhookId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      // Refresh logs after test
      setTimeout(() => { fetchDetail(webhookId); setTesting(false) }, 1000)
    } catch (e) {
      console.error('Test webhook error:', e)
      setTesting(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2000)
    })
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading webhooks...
      </div>
    )
  }

  // ── Create View ────────────────────────────────────────────────────────

  if (viewState.mode === 'create') {
    return (
      <div style={{ padding: '1.5rem', maxWidth: 700, margin: '0 auto' }}>
        <button
          onClick={() => setViewState({ mode: 'list' })}
          style={{
            padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: '0.75rem', marginBottom: '1rem',
          }}
        >
          Back to list
        </button>
        <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.25rem' }}>Create Webhook</h2>
        <div style={{
          padding: '1rem', borderRadius: 8, background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              value={formName} onChange={e => setFormName(e.target.value)}
              placeholder="Webhook name"
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)' }}
            />
            <textarea
              value={formDescription} onChange={e => setFormDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)', resize: 'vertical' }}
            />
            <input
              value={formEventFilter} onChange={e => setFormEventFilter(e.target.value)}
              placeholder="Event filter pattern (optional, e.g. push.*)"
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)' }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <select
                value={formForwardMode} onChange={e => setFormForwardMode(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)' }}
              >
                {FORWARD_MODES.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <input
                value={formForwardTo} onChange={e => setFormForwardTo(e.target.value)}
                placeholder={
                  formForwardMode === 'flux_event' ? 'Event name'
                    : formForwardMode === 'agent_task' ? 'Agent name'
                    : formForwardMode === 'http_forward' ? 'https://...'
                    : 'N/A (store only)'
                }
                disabled={formForwardMode === 'store_only'}
                style={{
                  padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)',
                  background: 'var(--bg-deep)', color: 'var(--text)',
                  opacity: formForwardMode === 'store_only' ? 0.5 : 1,
                }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button onClick={() => setViewState({ mode: 'list' })} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={handleCreate} disabled={!formName} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: formName ? 'pointer' : 'default', fontWeight: 600, opacity: formName ? 1 : 0.5 }}>
              Create Webhook
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Detail View ────────────────────────────────────────────────────────

  if (viewState.mode === 'detail' && selectedWebhook) {
    return (
      <div style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
        <button
          onClick={() => { setViewState({ mode: 'list' }); setShowSecret(false) }}
          style={{
            padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: '0.75rem', marginBottom: '1rem',
          }}
        >
          Back to list
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{selectedWebhook.name}</h2>
            {selectedWebhook.description && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
                {selectedWebhook.description}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => handleTest(selectedWebhook.webhook_id)}
              disabled={testing}
              style={{
                padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--text)', cursor: testing ? 'default' : 'pointer',
                fontSize: '0.8rem', opacity: testing ? 0.6 : 1,
              }}
            >
              {testing ? 'Sending...' : 'Send Test'}
            </button>
            <button
              onClick={() => handleDelete(selectedWebhook.webhook_id)}
              style={{
                padding: '6px 14px', borderRadius: 6, border: '1px solid #ff5252',
                background: 'transparent', color: '#ff5252', cursor: 'pointer',
                fontSize: '0.8rem',
              }}
            >
              Delete
            </button>
          </div>
        </div>

        {/* Config Card */}
        <div style={{
          padding: '1rem', borderRadius: 8, background: 'var(--bg-elevated)',
          border: '1px solid var(--border)', marginBottom: '1rem',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 16px', fontSize: '0.8rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Status</span>
            <span style={{ color: selectedWebhook.active ? '#00c853' : '#ff5252' }}>
              {selectedWebhook.active ? 'Active' : 'Paused'}
            </span>

            <span style={{ color: 'var(--text-muted)' }}>URL</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code style={{
                flex: 1, padding: '4px 8px', borderRadius: 4, background: 'var(--bg-deep)',
                fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {selectedWebhook.url}
              </code>
              <button
                onClick={() => copyToClipboard(selectedWebhook.url)}
                style={{
                  padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                  fontSize: '0.7rem', whiteSpace: 'nowrap',
                }}
              >
                {copiedUrl ? 'Copied' : 'Copy'}
              </button>
            </div>

            {selectedWebhook.secret && (
              <>
                <span style={{ color: 'var(--text-muted)' }}>Secret</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{
                    flex: 1, padding: '4px 8px', borderRadius: 4, background: 'var(--bg-deep)',
                    fontSize: '0.75rem',
                  }}>
                    {showSecret ? selectedWebhook.secret : '****************************'}
                  </code>
                  <button
                    onClick={() => setShowSecret(!showSecret)}
                    style={{
                      padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border)',
                      background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                      fontSize: '0.7rem',
                    }}
                  >
                    {showSecret ? 'Hide' : 'Reveal'}
                  </button>
                </div>
              </>
            )}

            <span style={{ color: 'var(--text-muted)' }}>Forward Mode</span>
            <span>{FORWARD_MODES.find(m => m.value === selectedWebhook.forward_mode)?.label || selectedWebhook.forward_mode}</span>

            {selectedWebhook.forward_to && (
              <>
                <span style={{ color: 'var(--text-muted)' }}>Forward To</span>
                <span>{selectedWebhook.forward_to}</span>
              </>
            )}

            {selectedWebhook.event_filter && (
              <>
                <span style={{ color: 'var(--text-muted)' }}>Event Filter</span>
                <code style={{ padding: '2px 6px', borderRadius: 3, background: 'var(--bg-deep)', fontSize: '0.75rem' }}>
                  {selectedWebhook.event_filter}
                </code>
              </>
            )}

            <span style={{ color: 'var(--text-muted)' }}>Received</span>
            <span>{selectedWebhook.received_count} total</span>
          </div>
        </div>

        {/* Delivery Logs */}
        <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 10 }}>Delivery Logs</div>
        {logs.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0', fontSize: '0.85rem' }}>
            No deliveries yet. Use "Send Test" to verify your webhook.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {logs.map(log => (
              <div
                key={log.log_id}
                style={{
                  padding: '10px 14px', borderRadius: 8, background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)', fontSize: '0.8rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{
                      padding: '2px 6px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600,
                      background: log.status_code >= 200 && log.status_code < 300
                        ? 'rgba(0,200,83,0.15)' : 'rgba(255,82,82,0.15)',
                      color: log.status_code >= 200 && log.status_code < 300
                        ? '#00c853' : '#ff5252',
                    }}>
                      {log.status_code}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      {log.source_ip}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      {log.response_time_ms}ms
                    </span>
                  </div>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                    {formatRelativeTime(log.timestamp)}
                  </span>
                </div>
                {log.payload_preview && (
                  <code style={{
                    display: 'block', padding: '6px 8px', borderRadius: 4,
                    background: 'var(--bg-deep)', fontSize: '0.7rem', color: 'var(--text-muted)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {log.payload_preview}
                  </code>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── List View (default) ────────────────────────────────────────────────

  return (
    <div style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Webhooks</h2>
        <button
          onClick={() => setViewState({ mode: 'create' })}
          style={{
            padding: '6px 14px', borderRadius: 6, border: 'none',
            background: 'var(--accent)', color: '#fff', cursor: 'pointer',
            fontSize: '0.8rem', fontWeight: 600,
          }}
        >
          + New Webhook
        </button>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div style={{
          padding: '8px 14px', borderRadius: 6, background: 'var(--bg-elevated)',
          marginBottom: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)',
          display: 'flex', gap: 16, alignItems: 'center',
        }}>
          <span>{stats.total_received_today} received today</span>
          <span>{stats.success_rate.toFixed(1)}% success rate</span>
          <span>{stats.active_webhooks} active / {stats.total_webhooks} total</span>
        </div>
      )}

      {/* Webhook List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {webhooks.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
            No webhooks configured. Create your first webhook above.
          </div>
        )}
        {webhooks.map(wh => (
          <div
            key={wh.webhook_id}
            onClick={() => setViewState({ mode: 'detail', webhookId: wh.webhook_id })}
            style={{
              padding: '12px 14px', borderRadius: 8, background: 'var(--bg-elevated)',
              border: '1px solid var(--border)', cursor: 'pointer',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              transition: 'border-color 0.15s',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontWeight: 500 }}>{wh.name}</span>
                <span style={{
                  padding: '1px 6px', borderRadius: 4, fontSize: '0.65rem', fontWeight: 600,
                  background: wh.active ? 'rgba(0,200,83,0.15)' : 'rgba(255,255,255,0.05)',
                  color: wh.active ? '#00c853' : 'var(--text-muted)',
                }}>
                  {wh.active ? 'active' : 'paused'}
                </span>
                <span style={{
                  padding: '1px 6px', borderRadius: 4, fontSize: '0.65rem',
                  background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)',
                }}>
                  {FORWARD_MODES.find(m => m.value === wh.forward_mode)?.label || wh.forward_mode}
                </span>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', gap: 10 }}>
                <code style={{
                  maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  padding: '1px 4px', borderRadius: 3, background: 'var(--bg-deep)', fontSize: '0.65rem',
                }}>
                  {wh.url}
                </code>
                <span>{wh.received_count} received</span>
                {wh.last_triggered && <span>Last: {formatRelativeTime(wh.last_triggered)}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
