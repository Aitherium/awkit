'use client'

import React, { useEffect, useState, useCallback } from 'react'
import {
  ArrowLeft,
  CheckCircle,
  Clock,
  DollarSign,
  ExternalLink,
  Loader2,
  Mail,
  MessageSquare,
  Plus,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react'

export interface RequestsPanelProps {
  apiBase?: string
}

type RequestStatus = 'new' | 'reviewing' | 'quoted' | 'accepted' | 'declined'

interface ProjectRequest {
  id: string
  created_at: string
  status: RequestStatus
  brief: {
    customer_name: string
    customer_email: string
    project_type: string
    description: string
    goals: string
    timeline: string
    budget_range: string
    session_id?: string
  }
  quote: {
    line_items: Array<{ description: string; amount_cents: number }>
    total_cents: number
    notes: string
    expires_at: string
  } | null
  thread: Array<{ author: string; message: string; timestamp: string }>
}

const STATUS_CONFIG: Record<RequestStatus, { label: string; color: string; icon: React.ElementType }> = {
  new: { label: 'New', color: 'text-cyan-300 bg-cyan-400/10 border-cyan-400/30', icon: Clock },
  reviewing: { label: 'Reviewing', color: 'text-amber-300 bg-amber-400/10 border-amber-400/30', icon: Clock },
  quoted: { label: 'Quoted', color: 'text-purple-300 bg-purple-400/10 border-purple-400/30', icon: DollarSign },
  accepted: { label: 'Accepted', color: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/30', icon: CheckCircle },
  declined: { label: 'Declined', color: 'text-rose-300 bg-rose-400/10 border-rose-400/30', icon: XCircle },
}

function StatusBadge({ status }: { status: RequestStatus }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.new
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cfg.color}`}>
      <Icon className="h-3 w-3" /> {cfg.label}
    </span>
  )
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function RequestsPanel({ apiBase = '/api/bridge/genesis' }: RequestsPanelProps) {
  const [requests, setRequests] = useState<ProjectRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ProjectRequest | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)

  // Quote builder state
  const [quoteItems, setQuoteItems] = useState<Array<{ description: string; amount: string }>>([])
  const [quoteNotes, setQuoteNotes] = useState('')
  const [quoteExpiry, setQuoteExpiry] = useState('')

  const fetchRequests = useCallback(async () => {
    try {
      const params = statusFilter ? `?status=${statusFilter}` : ''
      const res = await fetch(`${apiBase}/api/v1/requests${params}`)
      if (res.ok) {
        const data = await res.json()
        setRequests(data.requests || [])
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [apiBase, statusFilter])

  useEffect(() => { fetchRequests() }, [fetchRequests])

  const updateStatus = async (id: string, status: string) => {
    await fetch(`${apiBase}/api/v1/requests/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    fetchRequests()
    if (selected?.id === id) setSelected(prev => prev ? { ...prev, status: status as RequestStatus } : null)
  }

  const sendReply = async () => {
    if (!selected || !reply.trim()) return
    setSending(true)
    try {
      await fetch(`${apiBase}/api/v1/requests/${selected.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: reply, author: 'owner' }),
      })
      setReply('')
      // Refresh the selected request
      const res = await fetch(`${apiBase}/api/v1/requests/${selected.id}`)
      if (res.ok) setSelected(await res.json())
    } catch { /* ignore */ }
    finally { setSending(false) }
  }

  const submitQuote = async () => {
    if (!selected || quoteItems.length === 0) return
    setSending(true)
    try {
      await fetch(`${apiBase}/api/v1/requests/${selected.id}/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          line_items: quoteItems.map(i => ({ description: i.description, amount_cents: Math.round(parseFloat(i.amount || '0') * 100) })),
          notes: quoteNotes,
          expires_at: quoteExpiry,
        }),
      })
      fetchRequests()
      const res = await fetch(`${apiBase}/api/v1/requests/${selected.id}`)
      if (res.ok) setSelected(await res.json())
    } catch { /* ignore */ }
    finally { setSending(false) }
  }

  const sendQuoteEmail = async () => {
    if (!selected) return
    setSending(true)
    try {
      await fetch(`${apiBase}/api/v1/requests/${selected.id}/send-quote`, { method: 'POST' })
    } catch { /* ignore */ }
    finally { setSending(false) }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-white/40"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }

  // Detail view
  if (selected) {
    const b = selected.brief
    return (
      <div className="space-y-6">
        <button onClick={() => setSelected(null)} className="flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to list
        </button>

        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">{b.customer_name || 'Anonymous'}</h2>
            <p className="text-sm text-white/40 font-mono">{selected.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={selected.status} />
            <select
              value={selected.status}
              onChange={e => updateStatus(selected.id, e.target.value)}
              className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white/60"
            >
              {Object.keys(STATUS_CONFIG).map(s => (
                <option key={s} value={s}>{STATUS_CONFIG[s as RequestStatus].label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Brief */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-3">
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider">Brief</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-white/30">Email:</span> <span className="text-white/70">{b.customer_email || 'N/A'}</span></div>
            <div><span className="text-white/30">Type:</span> <span className="text-white/70">{b.project_type}</span></div>
            <div><span className="text-white/30">Timeline:</span> <span className="text-white/70">{b.timeline || 'N/A'}</span></div>
            <div><span className="text-white/30">Budget:</span> <span className="text-white/70">{b.budget_range || 'N/A'}</span></div>
          </div>
          <div>
            <span className="text-white/30 text-sm">Description:</span>
            <p className="text-sm text-white/70 mt-1">{b.description}</p>
          </div>
          {b.goals && (
            <div>
              <span className="text-white/30 text-sm">Goals:</span>
              <p className="text-sm text-white/70 mt-1">{b.goals}</p>
            </div>
          )}
          {b.session_id && (
            <a href={`/chat?session=${b.session_id}`} className="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300">
              <ExternalLink className="h-3 w-3" /> View Chat Transcript
            </a>
          )}
        </div>

        {/* Quote Builder */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-3">
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider">Quote</h3>
          {selected.quote ? (
            <>
              <div className="space-y-2">
                {selected.quote.line_items.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm px-3 py-2 rounded bg-white/[0.03]">
                    <span className="text-white/70">{item.description}</span>
                    <span className="text-white font-mono">${(item.amount_cents / 100).toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-bold px-3 py-2 border-t border-white/10">
                  <span className="text-white">Total</span>
                  <span className="text-white font-mono">${(selected.quote.total_cents / 100).toFixed(2)}</span>
                </div>
              </div>
              <button onClick={sendQuoteEmail} disabled={sending} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500/15 border border-cyan-400/25 text-cyan-300 text-sm hover:bg-cyan-500/25 disabled:opacity-50">
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />} Send Quote to Customer
              </button>
            </>
          ) : (
            <>
              {quoteItems.map((item, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className="flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white/70"
                    value={item.description}
                    onChange={e => {
                      const next = [...quoteItems]
                      next[i] = { ...next[i], description: e.target.value }
                      setQuoteItems(next)
                    }}
                    placeholder="Line item description"
                  />
                  <input
                    className="w-28 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white/70 font-mono"
                    value={item.amount}
                    onChange={e => {
                      const next = [...quoteItems]
                      next[i] = { ...next[i], amount: e.target.value }
                      setQuoteItems(next)
                    }}
                    placeholder="$0.00"
                    type="number"
                    step="0.01"
                  />
                  <button onClick={() => setQuoteItems(quoteItems.filter((_, j) => j !== i))} className="text-white/20 hover:text-rose-400 px-2">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setQuoteItems([...quoteItems, { description: '', amount: '' }])}
                className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/60"
              >
                <Plus className="h-3.5 w-3.5" /> Add line item
              </button>
              {quoteItems.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-white/5">
                  <input
                    className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white/70"
                    value={quoteNotes}
                    onChange={e => setQuoteNotes(e.target.value)}
                    placeholder="Notes (optional)"
                  />
                  <div className="flex gap-2">
                    <input
                      type="date"
                      className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white/70"
                      value={quoteExpiry}
                      onChange={e => setQuoteExpiry(e.target.value)}
                    />
                    <button onClick={submitQuote} disabled={sending} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500/15 border border-emerald-400/25 text-emerald-300 text-sm hover:bg-emerald-500/25 disabled:opacity-50">
                      {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DollarSign className="h-3.5 w-3.5" />} Save Quote
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Thread */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-3">
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider">Thread</h3>
          {selected.thread.length === 0 && <p className="text-xs text-white/20">No messages yet.</p>}
          {selected.thread.map((msg, i) => (
            <div key={i} className={`px-3 py-2 rounded-lg text-sm ${msg.author === 'owner' ? 'bg-cyan-400/5 border border-cyan-400/10' : 'bg-white/[0.03] border border-white/[0.06]'}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-white/60">{msg.author === 'owner' ? 'You' : msg.author}</span>
                <span className="text-[10px] text-white/20">{timeAgo(msg.timestamp)}</span>
              </div>
              <p className="text-white/70">{msg.message}</p>
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <input
              className="flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white/70 placeholder:text-white/20"
              value={reply}
              onChange={e => setReply(e.target.value)}
              placeholder="Reply..."
              onKeyDown={e => e.key === 'Enter' && sendReply()}
            />
            <button onClick={sendReply} disabled={sending || !reply.trim()} className="px-3 py-2 rounded-lg bg-cyan-500/15 border border-cyan-400/25 text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-50">
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // List view
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Incoming Requests</h2>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-xs bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white/60"
        >
          <option value="">All</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      {requests.length === 0 && (
        <div className="text-center py-12 text-white/20">
          <MessageSquare className="h-8 w-8 mx-auto mb-3 opacity-50" />
          <p className="text-sm">No requests yet.</p>
          <p className="text-xs mt-1">Requests from chat intake and the portal form will appear here.</p>
        </div>
      )}

      {requests.map(req => (
        <button
          key={req.id}
          onClick={() => setSelected(req)}
          className="w-full text-left p-4 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15] transition-colors"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <StatusBadge status={req.status} />
                <span className="text-sm font-semibold text-white truncate">{req.brief.customer_name || 'Anonymous'}</span>
              </div>
              <p className="text-xs text-white/50 truncate">{req.brief.description}</p>
              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-white/20">
                <span>via {req.brief.session_id ? 'chat-intake' : 'form'}</span>
                <span>{timeAgo(req.created_at)}</span>
                {req.brief.customer_email && <span>{req.brief.customer_email}</span>}
                {req.quote && <span className="text-emerald-300/60">${(req.quote.total_cents / 100).toFixed(2)} quoted</span>}
              </div>
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}
