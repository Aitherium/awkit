'use client'

/**
 * CapturePanel — AitherCapture dashboard
 *
 * Tabs: Overview (tools + connect watcher) | Sessions | Export | Pooling
 *
 * Talks to the Genesis AitherCapture API (default /api/v1/aither-capture),
 * proxied through portal-kit-backend (routers/aither_capture.py).
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  RadioTower, Database, DownloadCloud, Coins,
  RefreshCw, Plug, PlugZap, CheckCircle2, Circle,
} from 'lucide-react'

export interface CapturePanelProps {
  apiBase?: string
}

type Tab = 'overview' | 'sessions' | 'export' | 'pooling'

interface ToolInfo {
  tool: string
  display_name: string
  platform: string
  connected: boolean
  session_store: string | null
}

interface SessionInfo {
  session_id: string
  project: string
  source: string
  model: string
  stats: Record<string, any>
  parsed_at: string
}

const ACCENT = '#00D4FF'

export default function CapturePanel({ apiBase = '/api/v1/aither-capture' }: CapturePanelProps) {
  const [tab, setTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(false)
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [installStatus, setInstallStatus] = useState<any>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [exportResult, setExportResult] = useState<any>(null)
  const [pooling, setPooling] = useState<any>(null)
  const [busy, setBusy] = useState(false)

  const api = useCallback(async (path: string, method = 'GET', body?: any) => {
    const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } }
    if (body) opts.body = JSON.stringify(body)
    try {
      const res = await fetch(`${apiBase}${path}`, opts)
      return res.ok ? res.json() : null
    } catch {
      return null
    }
  }, [apiBase])

  const loadOverview = useCallback(async () => {
    setLoading(true)
    const [t, s] = await Promise.all([api('/tools'), api('/install/status')])
    if (t?.tools) setTools(t.tools)
    setInstallStatus(s || null)
    setLoading(false)
  }, [api])

  useEffect(() => {
    if (tab === 'overview') loadOverview()
    else if (tab === 'sessions') {
      setLoading(true)
      api('/sessions?since_days=30&max_sessions=100').then((d) => {
        setSessions(d?.sessions || [])
        setLoading(false)
      })
    } else if (tab === 'pooling') {
      setLoading(true)
      api('/pooling/credits').then((d) => { setPooling(d); setLoading(false) })
    }
  }, [tab, api, loadOverview])

  const connect = async () => {
    setBusy(true)
    await api('/install', 'POST', { interval_seconds: 600, install_claude_hook: true })
    await loadOverview()
    setBusy(false)
  }
  const disconnect = async () => {
    setBusy(true)
    await api('/uninstall', 'POST', {})
    await loadOverview()
    setBusy(false)
  }
  const syncNow = async () => {
    setBusy(true)
    await api('/sync', 'POST', { since_days: 7 })
    await loadOverview()
    setBusy(false)
  }
  const runExport = async () => {
    setBusy(true)
    const r = await api('/export', 'POST', { since_days: 30, scrub_pii: true, dedup: true })
    setExportResult(r)
    setBusy(false)
  }
  const setPool = async (enabled: boolean) => {
    setBusy(true)
    if (enabled) await api('/pooling/optin', 'POST', { consent: true, acknowledge_anonymization: true, tier: 3 })
    else await api('/pooling/optout', 'POST', {})
    const d = await api('/pooling/credits')
    setPooling(d)
    setBusy(false)
  }

  const watcherRunning = installStatus?.poller?.running
  const connectedCount = tools.filter((t) => t.connected).length

  return (
    <div style={{ padding: 24, color: '#e5e7eb', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <RadioTower size={22} color={ACCENT} />
        <h2 style={{ margin: 0, fontSize: 20 }}>AitherCapture</h2>
      </div>
      <p style={{ marginTop: 0, color: '#9ca3af', fontSize: 13 }}>
        Turn the way you already code into a dataset you own.
      </p>

      <div style={{ display: 'flex', gap: 8, margin: '16px 0', borderBottom: '1px solid #1f2937' }}>
        {([
          ['overview', 'Overview', RadioTower],
          ['sessions', 'Sessions', Database],
          ['export', 'Export', DownloadCloud],
          ['pooling', 'Pooling', Coins],
        ] as [Tab, string, any][]).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '8px 12px',
              color: tab === id ? ACCENT : '#9ca3af',
              borderBottom: tab === id ? `2px solid ${ACCENT}` : '2px solid transparent',
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 14,
            }}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {loading && <div style={{ color: '#6b7280' }}><RefreshCw size={14} className="spin" /> Loading…</div>}

      {/* OVERVIEW */}
      {tab === 'overview' && !loading && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <button onClick={connect} disabled={busy} style={btn(ACCENT)}>
              <Plug size={15} /> {watcherRunning ? 'Reconnect' : 'Connect'}
            </button>
            <button onClick={syncNow} disabled={busy} style={btn('#374151')}>
              <RefreshCw size={15} /> Sync now
            </button>
            {watcherRunning && (
              <button onClick={disconnect} disabled={busy} style={btn('#7f1d1d')}>
                <PlugZap size={15} /> Disconnect
              </button>
            )}
          </div>
          <div style={{ marginBottom: 12, fontSize: 13, color: watcherRunning ? '#00FF88' : '#9ca3af' }}>
            Watcher: {watcherRunning ? 'running' : 'stopped'} · {connectedCount}/{tools.length} tools detected
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {tools.map((t) => (
              <div key={t.tool} style={card()}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {t.connected ? <CheckCircle2 size={16} color="#00FF88" /> : <Circle size={16} color="#4b5563" />}
                  <strong style={{ fontSize: 14 }}>{t.display_name}</strong>
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, wordBreak: 'break-all' }}>
                  {t.connected ? t.session_store : 'not detected'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SESSIONS */}
      {tab === 'sessions' && !loading && (
        <div>
          {sessions.length === 0 ? (
            <div style={{ color: '#6b7280' }}>No captured sessions yet. Connect, then code in a supported tool.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: '#9ca3af', textAlign: 'left' }}>
                  <th style={th()}>Tool</th><th style={th()}>Session</th>
                  <th style={th()}>Msgs</th><th style={th()}>Tools</th><th style={th()}>Project</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.session_id} style={{ borderTop: '1px solid #1f2937' }}>
                    <td style={td()}>{s.source}</td>
                    <td style={td()}>{s.session_id.slice(0, 12)}</td>
                    <td style={td()}>{s.stats?.total_messages ?? 0}</td>
                    <td style={td()}>{s.stats?.total_tool_uses ?? 0}</td>
                    <td style={{ ...td(), color: '#6b7280' }}>{s.project?.slice(0, 40)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* EXPORT */}
      {tab === 'export' && (
        <div>
          <p style={{ color: '#9ca3af', fontSize: 13 }}>
            Build a clean ShareGPT JSONL dataset from your captured sessions —
            deduplicated and PII-scrubbed.
          </p>
          <button onClick={runExport} disabled={busy} style={btn(ACCENT)}>
            <DownloadCloud size={15} /> {busy ? 'Building…' : 'Build dataset'}
          </button>
          {exportResult && !exportResult.error && (
            <div style={{ ...card(), marginTop: 16 }}>
              <div><strong>Export {exportResult.export_id}</strong></div>
              <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.7 }}>
                Examples: {exportResult.example_count}<br />
                Sessions: {exportResult.sessions_included}<br />
                Duplicates removed: {exportResult.dedup_removed}<br />
                PII redactions: {exportResult.pii_redactions}
              </div>
              <a
                href={`${apiBase}/export/${exportResult.export_id}/download`}
                style={{ color: ACCENT, fontSize: 13, marginTop: 8, display: 'inline-block' }}
              >
                ⬇ Download JSONL
              </a>
            </div>
          )}
        </div>
      )}

      {/* POOLING */}
      {tab === 'pooling' && !loading && (
        <div>
          <p style={{ color: '#9ca3af', fontSize: 13 }}>
            Opt in to contribute anonymized sessions and earn Aitherium credits.
            Private by default — data is PII/secret-scrubbed before it ever
            leaves your machine. Credits settle through the Elysium ledger (S1).
          </p>
          <div style={{ marginBottom: 12, fontSize: 14 }}>
            Status: <strong style={{ color: pooling?.pooling_enabled ? '#00FF88' : '#9ca3af' }}>
              {pooling?.pooling_enabled ? 'Enabled' : 'Disabled'}
            </strong>
            {pooling?.discount && (
              <span style={{ color: '#9ca3af' }}> · {pooling.discount.discount_pct}% discount ({pooling.discount.tier_label})</span>
            )}
          </div>

          {/* ELYSIUM S1 — the credits the pooling opt-in actually earns */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
            <div style={card()}>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Earned credits</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: ACCENT }}>
                {Number(pooling?.credits ?? 0).toFixed(3)}
              </div>
            </div>
            <div style={card()}>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Balance</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {Number(pooling?.balance ?? 0).toFixed(3)}
              </div>
            </div>
            <div style={card()}>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Contributions</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {pooling?.contributions?.total ?? 0}
              </div>
            </div>
          </div>

          {pooling?.settlement_reason && (
            <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 12 }}>
              ⚠ {pooling.settlement_reason}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setPool(true)} disabled={busy} style={btn(ACCENT)}>
              <Coins size={15} /> Opt in
            </button>
            <button onClick={() => setPool(false)} disabled={busy} style={btn('#374151')}>
              Opt out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function btn(bg: string): React.CSSProperties {
  return {
    background: bg, color: '#0A0E17', border: 'none', borderRadius: 6,
    padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', gap: 6,
  }
}
function card(): React.CSSProperties {
  return { background: '#0f172a', border: '1px solid #1f2937', borderRadius: 8, padding: 12 }
}
function th(): React.CSSProperties { return { padding: '6px 8px', fontWeight: 500 } }
function td(): React.CSSProperties { return { padding: '6px 8px' } }
