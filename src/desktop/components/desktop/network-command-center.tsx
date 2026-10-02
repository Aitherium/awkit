'use client'

/**
 * Network Command Center
 * ======================
 *
 * Unified desktop app for everything network in AitherOS.
 * Pulls live data from:
 *  - AitherNet    (8135) — overlay mesh, DNS, policies, topology
 *  - AitherFlux   (8117) — IPC data flow, mailboxes, routing, mTLS
 *  - AitherSentry (8127) — threat detection, block rules, metrics
 *  - AitherMesh   (8125) — node discovery, join/leave, hardware caps
 *  - Genesis      (8001) — service health for all ${S.services.total} services
 *
 * Tabs:
 *  1. Dashboard   — live overview: bandwidth, latency, node count, threat level
 *  2. Mesh Nodes  — all discovered nodes with health, role, hardware
 *  3. Traffic     — real-time FluxPacket flow, per-service mailbox stats
 *  4. DNS & Policies — service DNS records, network access policies
 *  5. Security    — threats, blocked IPs, DLP violations, mTLS status
 *  6. Ping        — interactive latency checker for any service
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
// generate_architecture_stats.py writes this file into the PACKAGE as well
// as into Veil (see the generator's docstring), so the package owns its own
// copy and the import is relative -- the emit config forbids `@/` aliases
// by design, and a host seam here would break the build.
import { ARCHITECTURE_STATS as S } from '../../data/architecture-stats'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Network, Wifi, WifiOff, Shield, ShieldAlert, ShieldCheck,
  Activity, Globe, Server, HardDrive, Cpu, MemoryStick,
  Radio, Zap, ArrowUpDown, ArrowUp, ArrowDown, RefreshCw,
  Search, X, Eye, Lock, Unlock, Ban, CheckCircle2,
  AlertTriangle, AlertCircle, Clock, Hash, BarChart3,
  Loader2, MonitorSmartphone, Router, Cable, Signal,
  Gauge, Target, Crosshair, Radar, Scan, Fingerprint,
  ChevronRight, ExternalLink, Play, Pause, Circle,
  TrendingUp, TrendingDown, Minus, MoreHorizontal,
} from 'lucide-react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { toast } from 'sonner'

// ============================================================================
// CONSTANTS
// ============================================================================

const AITHERNET = 'http://localhost:8135'
const FLUX = 'http://localhost:8117'
const SENTRY = 'http://localhost:8127'
const MESH = 'http://localhost:8125'
const GENESIS = 'http://localhost:8001'
const INSPECTOR = 'http://localhost:8134'

const POLL_INTERVAL = 8_000 // 8s

type Tab = 'dashboard' | 'nodes' | 'traffic' | 'dns' | 'security' | 'ping'

interface MeshNode {
  id: string
  hostname: string
  ip: string
  role: 'controller' | 'worker' | 'edge' | 'client'
  status: 'online' | 'offline' | 'joining'
  joined_at: string
  capabilities?: { gpu?: boolean; cpu_cores?: number; ram_gb?: number }
  services?: string[]
  latency_ms?: number
}

interface FluxMailbox {
  service: string
  inbox_count: number
  outbox_count: number
  total_sent: number
  total_received: number
  last_activity: string
}

interface Threat {
  id: string
  type: string
  source_ip: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  timestamp: string
  details: string
  blocked: boolean
}

interface DnsRecord {
  name: string
  type: string
  value: string
  ttl: number
}

interface NetworkPolicy {
  id: string
  name: string
  action: 'allow' | 'deny'
  source: string
  destination: string
  protocol: string
  active: boolean
}

interface PingResult {
  target: string
  status: 'ok' | 'timeout' | 'error'
  latency_ms: number
  timestamp: number
}

interface NetStats {
  nodes_online: number
  nodes_total: number
  services_healthy: number
  services_total: number
  packets_per_sec: number
  bytes_per_sec: number
  active_connections: number
  threats_24h: number
  blocked_ips: number
  avg_latency_ms: number
  mtls_active: number
  dns_records: number
}

// ============================================================================
// HELPERS
// ============================================================================

async function safeFetch<T>(url: string, fallback: T, timeout = 4000): Promise<T> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) })
    if (!res.ok) return fallback
    return await res.json()
  } catch (_e) { return fallback }
}

function sevColor(sev: string): string {
  switch (sev) {
    case 'critical': return 'text-red-400 bg-red-500/10 border-red-500/30'
    case 'high': return 'text-orange-400 bg-orange-500/10 border-orange-500/30'
    case 'medium': return 'text-amber-400 bg-amber-500/10 border-amber-500/30'
    case 'low': return 'text-blue-400 bg-blue-500/10 border-blue-500/30'
    default: return 'text-zinc-400 bg-zinc-500/10 border-zinc-500/30'
  }
}

function roleColor(role: string): string {
  switch (role) {
    case 'controller': return 'text-[#5EC9CC]'
    case 'worker': return 'text-blue-400'
    case 'edge': return 'text-emerald-400'
    case 'client': return 'text-zinc-400'
    default: return 'text-zinc-500'
  }
}

function roleBadge(role: string): string {
  switch (role) {
    case 'controller': return 'border-[#5EC9CC]/30 bg-[#5EC9CC]/10 text-[#5EC9CC]'
    case 'worker': return 'border-blue-500/30 bg-blue-500/10 text-blue-400'
    case 'edge': return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
    default: return 'border-zinc-700 bg-zinc-800 text-zinc-500'
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B/s`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`
}

function formatAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return `${Math.floor(diff / 86400_000)}d ago`
}

// ============================================================================
// SPARKLINE
// ============================================================================

function Sparkline({ data, color = '#5EC9CC', width = 80, height = 24 }: {
  data: number[]; color?: string; width?: number; height?: number
}) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 2) - 1
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={width} height={height} className="inline-block">
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" points={points} />
    </svg>
  )
}

// ============================================================================
// STAT CARD
// ============================================================================

function StatCard({ icon: Icon, label, value, sub, color = 'text-blue-400', trend, sparkData }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string
  color?: string; trend?: 'up' | 'down' | 'flat'; sparkData?: number[]
}) {
  return (
    <div className="bg-zinc-900/60 border border-zinc-800/40 rounded-xl p-3 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon className={`w-3.5 h-3.5 ${color}`} />
          <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">{label}</span>
        </div>
        {trend && (
          trend === 'up' ? <TrendingUp className="w-3 h-3 text-emerald-500" /> :
            trend === 'down' ? <TrendingDown className="w-3 h-3 text-red-500" /> :
              <Minus className="w-3 h-3 text-zinc-700" />
        )}
      </div>
      <div className="flex items-end justify-between">
        <span className="text-xl font-bold text-white tabular-nums">{value}</span>
        {sparkData && <Sparkline data={sparkData} />}
      </div>
      {sub && <span className="text-[10px] text-zinc-600">{sub}</span>}
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function NetworkCommandCenter({ className = '' }: { className?: string }) {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [stats, setStats] = useState<NetStats>({
    nodes_online: 0, nodes_total: 0, services_healthy: 0, services_total: 0,
    packets_per_sec: 0, bytes_per_sec: 0, active_connections: 0,
    threats_24h: 0, blocked_ips: 0, avg_latency_ms: 0, mtls_active: 0, dns_records: 0,
  })
  const [nodes, setNodes] = useState<MeshNode[]>([])
  const [mailboxes, setMailboxes] = useState<FluxMailbox[]>([])
  const [threats, setThreats] = useState<Threat[]>([])
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([])
  const [policies, setPolicies] = useState<NetworkPolicy[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [services, setServices] = useState<{ online: string[]; offline: string[] }>({ online: [], offline: [] })

  // Sparkline history
  const [bpsHistory, setBpsHistory] = useState<number[]>([0])
  const [ppsHistory, setPpsHistory] = useState<number[]>([0])
  const [latencyHistory, setLatencyHistory] = useState<number[]>([0])

  // Ping tab state
  const [pingTarget, setPingTarget] = useState('')
  const [pingResults, setPingResults] = useState<PingResult[]>([])
  const [isPinging, setIsPinging] = useState(false)

  // ── Data fetching ─────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
     
    const results: any[] = await Promise.all([
      safeFetch(`${AITHERNET}/network/topology`, { nodes: [] }),
      safeFetch(`${AITHERNET}/network/stats`, {}),
      safeFetch(`${FLUX}/ipc/stats`, {}),
      safeFetch(`${FLUX}/mailbox`, { mailboxes: [] }),
      safeFetch(`${SENTRY}/sentry/threats`, { threats: [] }),
      safeFetch(`${SENTRY}/sentry/status`, {}),
      safeFetch(`${MESH}/mesh/nodes`, { nodes: [] }),
      safeFetch(`${GENESIS}/health-check`, { services: {} }),
      safeFetch(`${AITHERNET}/dns/records`, { records: [] }),
      safeFetch(`${AITHERNET}/network/policies`, { policies: [] }),
      safeFetch(`${FLUX}/connections`, { connections: [] }),
      safeFetch(`${FLUX}/security/mtls/stats`, {}),
    ])
    const [netTopo, netStats, fluxStats, fluxMailboxes, sentryThreats, sentryStatus,
      meshNodes, genHealth, dnsData, policyData, fluxConns, mtlsStats] = results

    // Nodes
    const nodeList: MeshNode[] = (meshNodes.nodes || netTopo.nodes || []).map((n: any) => ({
      id: n.id || n.node_id || n.hostname,
      hostname: n.hostname || n.name || n.id,
      ip: n.ip || n.address || n.wireguard_ip || '—',
      role: n.role || 'worker',
      status: n.status || (n.online ? 'online' : 'offline'),
      joined_at: n.joined_at || n.discovered_at || new Date().toISOString(),
      capabilities: n.capabilities || n.hardware || {},
      services: n.services || [],
      latency_ms: n.latency_ms ?? n.rtt_ms,
    }))
    setNodes(nodeList)

    // Mailboxes
    const mbs: FluxMailbox[] = (fluxMailboxes.mailboxes || Object.entries(fluxMailboxes).filter(([k]) => k !== 'total')).map((m: any) => {
      if (Array.isArray(m)) return null // skip non-mailbox entries
      return {
        service: m.service || m.name || m.id,
        inbox_count: m.inbox_count ?? m.inbox ?? 0,
        outbox_count: m.outbox_count ?? m.outbox ?? 0,
        total_sent: m.total_sent ?? m.sent ?? 0,
        total_received: m.total_received ?? m.received ?? 0,
        last_activity: m.last_activity || m.updated_at || new Date().toISOString(),
      }
    }).filter(Boolean) as FluxMailbox[]
    setMailboxes(mbs)

    // Threats
    const tList: Threat[] = (sentryThreats.threats || []).slice(0, 50).map((t: any) => ({
      id: t.id || `threat-${Date.now()}`,
      type: t.type || t.threat_type || 'unknown',
      source_ip: t.source_ip || t.source || t.ip || '—',
      severity: t.severity || 'medium',
      timestamp: t.timestamp || t.detected_at || new Date().toISOString(),
      details: t.details || t.description || t.message || '',
      blocked: t.blocked ?? t.auto_blocked ?? false,
    }))
    setThreats(tList)

    // DNS
    setDnsRecords((dnsData.records || []).map((r: any) => ({
      name: r.name || r.hostname,
      type: r.type || 'A',
      value: r.value || r.address || r.ip,
      ttl: r.ttl || 300,
    })))

    // Policies
    setPolicies((policyData.policies || []).map((p: any) => ({
      id: p.id || `pol-${Date.now()}`,
      name: p.name || p.rule_name,
      action: p.action || 'allow',
      source: p.source || '*',
      destination: p.destination || '*',
      protocol: p.protocol || 'tcp',
      active: p.active ?? true,
    })))

    // Service health
    const healthMap = genHealth.services || genHealth || {}
    const onlineList: string[] = []
    const offlineList: string[] = []
    for (const [svc, info] of Object.entries(healthMap)) {
      if ((info as any)?.status === 'healthy' || (info as any)?.healthy === true) {
        onlineList.push(svc)
      } else {
        offlineList.push(svc)
      }
    }
    setServices({ online: onlineList, offline: offlineList })

    // Aggregate stats
    const nodesOnline = nodeList.filter(n => n.status === 'online').length
    const totalConns = (fluxConns.connections || []).length
    const pps = fluxStats.packets_per_sec ?? fluxStats.total_packets ?? 0
    const bps = netStats.bytes_per_sec ?? fluxStats.bytes_per_sec ?? 0
    const avgLat = netStats.avg_latency_ms ?? (
      nodeList.length > 0 ? Math.round(nodeList.reduce((s, n) => s + (n.latency_ms || 0), 0) / nodeList.length) : 0
    )

    const newStats: NetStats = {
      nodes_online: nodesOnline,
      nodes_total: nodeList.length,
      services_healthy: onlineList.length,
      services_total: onlineList.length + offlineList.length,
      packets_per_sec: pps,
      bytes_per_sec: bps,
      active_connections: totalConns,
      threats_24h: tList.length,
      blocked_ips: sentryStatus.blocked_count ?? (sentryStatus.blocked_ips || []).length ?? 0,
      avg_latency_ms: avgLat,
      mtls_active: mtlsStats.active_sessions ?? mtlsStats.total ?? totalConns,
      dns_records: dnsRecords.length,
    }
    setStats(newStats)

    // History
    setBpsHistory(prev => [...prev.slice(-29), bps])
    setPpsHistory(prev => [...prev.slice(-29), pps])
    setLatencyHistory(prev => [...prev.slice(-29), avgLat])

    setIsLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
    const iv = setInterval(fetchAll, POLL_INTERVAL)
    return () => clearInterval(iv)
  }, [fetchAll])

  // ── Ping ──────────────────────────────────────────────────────────────
  const handlePing = useCallback(async () => {
    if (!pingTarget.trim()) return
    setIsPinging(true)

    // Try to resolve target to a URL
    const target = pingTarget.trim()
    let url = target
    if (!target.startsWith('http')) {
      // Could be a service name or port
      const port = parseInt(target)
      if (!isNaN(port)) {
        url = `http://localhost:${port}/health`
      } else {
        // Try as service name
        url = `http://localhost:8001/services/${target}`
      }
    }

    const start = performance.now()
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      const latency = Math.round(performance.now() - start)
      setPingResults(prev => [{
        target,
        status: res.ok ? 'ok' : 'error',
        latency_ms: latency,
        timestamp: Date.now(),
      }, ...prev.slice(0, 19)])
    } catch (_e) {
      const latency = Math.round(performance.now() - start)
      setPingResults(prev => [{
        target,
        status: 'timeout',
        latency_ms: latency,
        timestamp: Date.now(),
      }, ...prev.slice(0, 19)])
    }
    setIsPinging(false)
  }, [pingTarget])

  // Quick ping all core services
  const handlePingAll = useCallback(async () => {
    setIsPinging(true)
    const coreServices = [
      { name: 'Genesis', port: 8001 },
      { name: 'AitherNet', port: 8135 },
      { name: 'AitherFlux', port: 8117 },
      { name: 'AitherMesh', port: 8125 },
      { name: 'AitherSentry', port: 8127 },
      { name: 'AitherPulse', port: 8081 },
      { name: 'AitherMind', port: 8088 },
      { name: 'AitherSpirit', port: 8087 },
      { name: 'AitherLLM', port: 8150 },
      { name: 'AitherStrata', port: 8136 },
    ]

    const results: PingResult[] = []
    for (const svc of coreServices) {
      const start = performance.now()
      try {
        const res = await fetch(`http://localhost:${svc.port}/health`, { signal: AbortSignal.timeout(3000) })
        results.push({
          target: `${svc.name} (:${svc.port})`,
          status: res.ok ? 'ok' : 'error',
          latency_ms: Math.round(performance.now() - start),
          timestamp: Date.now(),
        })
      } catch (_e) {
        results.push({
          target: `${svc.name} (:${svc.port})`,
          status: 'timeout',
          latency_ms: Math.round(performance.now() - start),
          timestamp: Date.now(),
        })
      }
    }
    setPingResults(results)
    setIsPinging(false)
  }, [])

  // ── Filter helpers ────────────────────────────────────────────────────
  const filteredNodes = useMemo(() => {
    if (!searchQuery) return nodes
    const q = searchQuery.toLowerCase()
    return nodes.filter(n =>
      n.hostname.toLowerCase().includes(q) || n.ip.includes(q) || n.role.includes(q)
    )
  }, [nodes, searchQuery])

  const filteredMailboxes = useMemo(() => {
    if (!searchQuery) return mailboxes
    const q = searchQuery.toLowerCase()
    return mailboxes.filter(m => m.service.toLowerCase().includes(q))
  }, [mailboxes, searchQuery])

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'dashboard', label: 'Overview', icon: Gauge },
    { id: 'nodes', label: 'Mesh Nodes', icon: Server },
    { id: 'traffic', label: 'Traffic', icon: ArrowUpDown },
    { id: 'dns', label: 'DNS & Policy', icon: Globe },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'ping', label: 'Ping', icon: Radar },
  ]

  return (
    <div className={`flex flex-col h-full bg-zinc-950 ${className}`}>
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/60 bg-zinc-900/50">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-medium text-zinc-200">Network Command Center</span>
          {isLoading && <Loader2 className="w-3 h-3 text-zinc-600 animate-spin" />}
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${stats.nodes_online > 0 ? 'border-emerald-500/30 text-emerald-400' : 'border-red-500/30 text-red-400'
            }`}>
            <Wifi className="w-2 h-2 mr-0.5" />
            {stats.nodes_online}/{stats.nodes_total} nodes
          </Badge>
          <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${stats.threats_24h === 0 ? 'border-emerald-500/30 text-emerald-400' : 'border-amber-500/30 text-amber-400'
            }`}>
            <Shield className="w-2 h-2 mr-0.5" />
            {stats.threats_24h} threats
          </Badge>
          <button onClick={fetchAll} className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors" title="Refresh">
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* ── Tab Bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-zinc-800/40 bg-zinc-900/30 overflow-x-auto scrollbar-none">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setSearchQuery('') }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${tab === t.id ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
              }`}
          >
            <t.icon className="w-3 h-3" />
            {t.label}
          </button>
        ))}

        <div className="flex-1" />

        {/* Search (visible on nodes/traffic/security tabs) */}
        {['nodes', 'traffic', 'security'].includes(tab) && (
          <div className="flex items-center gap-1 bg-zinc-800/40 border border-zinc-700/30 rounded px-2 py-0.5">
            <Search className="w-3 h-3 text-zinc-600" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Filter..."
              className="bg-transparent text-xs text-white placeholder:text-zinc-600 outline-none w-24"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-zinc-600 hover:text-zinc-300">
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Content ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="h-full"
          >
            {tab === 'dashboard' && <DashboardTab stats={stats} bpsHistory={bpsHistory} ppsHistory={ppsHistory} latencyHistory={latencyHistory} services={services} />}
            {tab === 'nodes' && <NodesTab nodes={filteredNodes} />}
            {tab === 'traffic' && <TrafficTab mailboxes={filteredMailboxes} stats={stats} ppsHistory={ppsHistory} />}
            {tab === 'dns' && <DnsTab dnsRecords={dnsRecords} policies={policies} />}
            {tab === 'security' && <SecurityTab threats={threats} stats={stats} searchQuery={searchQuery} />}
            {tab === 'ping' && <PingTab target={pingTarget} setTarget={setPingTarget} results={pingResults} isPinging={isPinging} onPing={handlePing} onPingAll={handlePingAll} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Status Bar ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-zinc-800/40 bg-zinc-900/30 text-[10px] text-zinc-600">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Circle className={`w-1.5 h-1.5 ${stats.nodes_online > 0 ? 'text-emerald-500 fill-emerald-500' : 'text-red-500 fill-red-500'}`} />
            Mesh {stats.nodes_online > 0 ? 'active' : 'down'}
          </span>
          <span>{stats.services_healthy}/{stats.services_total} services</span>
          <span>{formatBytes(stats.bytes_per_sec)}</span>
        </div>
        <div className="flex items-center gap-3">
          <span>{stats.mtls_active} mTLS sessions</span>
          <span>{stats.avg_latency_ms}ms avg latency</span>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// TAB: DASHBOARD
// ============================================================================

function DashboardTab({ stats, bpsHistory, ppsHistory, latencyHistory, services }: {
  stats: NetStats; bpsHistory: number[]; ppsHistory: number[]; latencyHistory: number[]
  services: { online: string[]; offline: string[] }
}) {
  return (
    <div className="p-3 space-y-3">
      {/* KPI Grid */}
      <div className="grid grid-cols-4 gap-2">
        <StatCard icon={Server} label="Mesh Nodes" value={stats.nodes_online} sub={`${stats.nodes_total} total`} color="text-cyan-400" />
        <StatCard icon={Activity} label="Services" value={stats.services_healthy} sub={`${stats.services_total} total`} color="text-emerald-400"
          trend={stats.services_healthy >= stats.services_total ? 'up' : 'down'} />
        <StatCard icon={Zap} label="Packets/s" value={stats.packets_per_sec} color="text-amber-400" sparkData={ppsHistory} />
        <StatCard icon={ArrowUpDown} label="Bandwidth" value={formatBytes(stats.bytes_per_sec)} color="text-blue-400" sparkData={bpsHistory} />
      </div>

      <div className="grid grid-cols-4 gap-2">
        <StatCard icon={Clock} label="Avg Latency" value={`${stats.avg_latency_ms}ms`} color="text-[#5EC9CC]" sparkData={latencyHistory}
          trend={stats.avg_latency_ms < 100 ? 'up' : stats.avg_latency_ms > 500 ? 'down' : 'flat'} />
        <StatCard icon={Lock} label="mTLS Active" value={stats.mtls_active} color="text-emerald-400" />
        <StatCard icon={ShieldAlert} label="Threats (24h)" value={stats.threats_24h} color={stats.threats_24h > 0 ? 'text-amber-400' : 'text-emerald-400'} />
        <StatCard icon={Ban} label="Blocked IPs" value={stats.blocked_ips} color="text-red-400" />
      </div>

      {/* Service Health Summary */}
      <div className="grid grid-cols-2 gap-2">
        {/* Online services */}
        <div className="bg-zinc-900/60 border border-zinc-800/40 rounded-xl p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
              Online ({services.online.length})
            </span>
          </div>
          <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto scrollbar-none">
            {services.online.slice(0, 30).map(s => (
              <Badge key={s} variant="outline" className="text-[9px] border-emerald-500/20 bg-emerald-500/5 text-emerald-400 py-0">{s}</Badge>
            ))}
            {services.online.length > 30 && <span className="text-[9px] text-zinc-600">+{services.online.length - 30} more</span>}
          </div>
        </div>

        {/* Offline services */}
        <div className="bg-zinc-900/60 border border-zinc-800/40 rounded-xl p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
              Offline ({services.offline.length})
            </span>
          </div>
          <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto scrollbar-none">
            {services.offline.slice(0, 30).map(s => (
              <Badge key={s} variant="outline" className="text-[9px] border-zinc-700 bg-zinc-800/50 text-zinc-500 py-0">{s}</Badge>
            ))}
            {services.offline.length > 30 && <span className="text-[9px] text-zinc-600">+{services.offline.length - 30} more</span>}
          </div>
        </div>
      </div>

      {/* Quick-glance network health bar */}
      <div className="bg-zinc-900/60 border border-zinc-800/40 rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Network Health</span>
          <span className="text-xs font-bold text-white">
            {stats.services_total > 0 ? Math.round((stats.services_healthy / stats.services_total) * 100) : 0}%
          </span>
        </div>
        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${stats.services_total > 0 ? (stats.services_healthy / stats.services_total) * 100 : 0}%`,
              background: `linear-gradient(90deg, ${stats.services_healthy / (stats.services_total || 1) > 0.9 ? '#10b981' :
                stats.services_healthy / (stats.services_total || 1) > 0.6 ? '#f59e0b' : '#ef4444'
                }, ${stats.services_healthy / (stats.services_total || 1) > 0.9 ? '#34d399' :
                  stats.services_healthy / (stats.services_total || 1) > 0.6 ? '#fbbf24' : '#f87171'
                })`,
            }}
          />
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// TAB: MESH NODES
// ============================================================================

function NodesTab({ nodes }: { nodes: MeshNode[] }) {
  return (
    <div className="p-3">
      {nodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
          <Server className="w-10 h-10 mb-3 text-zinc-700" />
          <p className="text-sm font-medium">No mesh nodes discovered</p>
          <p className="text-xs mt-1 text-zinc-700">AitherMesh will discover nodes via mDNS</p>
        </div>
      ) : (
        <div className="space-y-2">
          {nodes.map(node => (
            <div
              key={node.id}
              className="bg-zinc-900/60 border border-zinc-800/40 rounded-xl p-3 hover:border-zinc-700/60 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${node.status === 'online' ? 'bg-emerald-500 shadow-emerald-500/50 shadow-sm' :
                    node.status === 'joining' ? 'bg-amber-500 animate-pulse' : 'bg-zinc-700'
                    }`} />
                  <span className="text-sm font-medium text-white">{node.hostname}</span>
                  <Badge variant="outline" className={`text-[9px] py-0 ${roleBadge(node.role)}`}>
                    {node.role}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-zinc-600">
                  {node.latency_ms !== undefined && (
                    <span className={node.latency_ms < 50 ? 'text-emerald-500' : node.latency_ms < 200 ? 'text-amber-500' : 'text-red-500'}>
                      {node.latency_ms}ms
                    </span>
                  )}
                  <span>{node.ip}</span>
                </div>
              </div>

              <div className="flex items-center gap-3 text-[10px] text-zinc-600">
                {node.capabilities?.cpu_cores && (
                  <span className="flex items-center gap-1"><Cpu className="w-2.5 h-2.5" />{node.capabilities.cpu_cores} cores</span>
                )}
                {node.capabilities?.ram_gb && (
                  <span className="flex items-center gap-1"><MemoryStick className="w-2.5 h-2.5" />{node.capabilities.ram_gb} GB</span>
                )}
                {node.capabilities?.gpu && (
                  <Badge variant="outline" className="text-[9px] py-0 border-[#5EC9CC]/30 bg-[#5EC9CC]/10 text-[#5EC9CC]">GPU</Badge>
                )}
                <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" />Joined {formatAge(node.joined_at)}</span>
                {node.services && node.services.length > 0 && (
                  <span className="flex items-center gap-1"><Activity className="w-2.5 h-2.5" />{node.services.length} services</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// TAB: TRAFFIC (FluxPackets)
// ============================================================================

function TrafficTab({ mailboxes, stats, ppsHistory }: {
  mailboxes: FluxMailbox[]; stats: NetStats; ppsHistory: number[]
}) {
  return (
    <div className="p-3 space-y-3">
      {/* Traffic overview */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard icon={Zap} label="Packets/s" value={stats.packets_per_sec} color="text-amber-400" sparkData={ppsHistory} />
        <StatCard icon={ArrowUpDown} label="Bandwidth" value={formatBytes(stats.bytes_per_sec)} color="text-blue-400" />
        <StatCard icon={Cable} label="Connections" value={stats.active_connections} color="text-cyan-400" />
      </div>

      {/* Mailbox table */}
      <div className="bg-zinc-900/60 border border-zinc-800/40 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/40">
          <Radio className="w-3.5 h-3.5 text-[#5EC9CC]" />
          <span className="text-[11px] font-medium text-zinc-400">FluxPacket Mailboxes</span>
          <Badge variant="outline" className="text-[9px] py-0 border-zinc-700 text-zinc-500">{mailboxes.length}</Badge>
        </div>

        {mailboxes.length === 0 ? (
          <div className="py-8 text-center text-zinc-700 text-xs">No active mailboxes</div>
        ) : (
          <div className="max-h-72 overflow-y-auto scrollbar-none">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-1.5 text-[9px] font-medium text-zinc-600 uppercase tracking-wider border-b border-zinc-800/30 sticky top-0 bg-zinc-900/90 backdrop-blur-sm">
              <span className="flex-1">Service</span>
              <span className="w-16 text-right">Inbox</span>
              <span className="w-16 text-right">Outbox</span>
              <span className="w-20 text-right">Total Sent</span>
              <span className="w-20 text-right">Total Recv</span>
              <span className="w-20 text-right">Last Active</span>
            </div>
            {mailboxes.map(mb => (
              <div key={mb.service} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/3 transition-colors border-b border-zinc-800/20">
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <Circle className={`w-1.5 h-1.5 flex-shrink-0 ${mb.inbox_count > 0 ? 'text-amber-500 fill-amber-500' : 'text-emerald-500 fill-emerald-500'}`} />
                  <span className="text-xs text-zinc-300 truncate">{mb.service}</span>
                </div>
                <span className="w-16 text-right text-[10px] tabular-nums text-zinc-500">{mb.inbox_count}</span>
                <span className="w-16 text-right text-[10px] tabular-nums text-zinc-500">{mb.outbox_count}</span>
                <span className="w-20 text-right text-[10px] tabular-nums text-zinc-500">{mb.total_sent.toLocaleString()}</span>
                <span className="w-20 text-right text-[10px] tabular-nums text-zinc-500">{mb.total_received.toLocaleString()}</span>
                <span className="w-20 text-right text-[10px] text-zinc-600">{formatAge(mb.last_activity)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// TAB: DNS & POLICIES
// ============================================================================

function DnsTab({ dnsRecords, policies }: { dnsRecords: DnsRecord[]; policies: NetworkPolicy[] }) {
  return (
    <div className="p-3 space-y-3">
      {/* DNS Records */}
      <div className="bg-zinc-900/60 border border-zinc-800/40 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/40">
          <Globe className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[11px] font-medium text-zinc-400">Service DNS Records</span>
          <span className="text-[10px] text-zinc-600">*.aither.net</span>
        </div>
        {dnsRecords.length === 0 ? (
          <div className="py-8 text-center text-zinc-700 text-xs">No DNS records — AitherNet may be offline</div>
        ) : (
          <div className="max-h-48 overflow-y-auto scrollbar-none">
            <div className="flex items-center gap-2 px-3 py-1 text-[9px] font-medium text-zinc-600 uppercase tracking-wider border-b border-zinc-800/30">
              <span className="flex-1">Name</span>
              <span className="w-12 text-center">Type</span>
              <span className="w-32 text-right">Value</span>
              <span className="w-14 text-right">TTL</span>
            </div>
            {dnsRecords.map((r, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/3 border-b border-zinc-800/20">
                <span className="flex-1 text-xs text-zinc-300 truncate font-mono">{r.name}</span>
                <Badge variant="outline" className="w-12 justify-center text-[9px] py-0 border-zinc-700 text-zinc-500">{r.type}</Badge>
                <span className="w-32 text-right text-[10px] text-zinc-500 font-mono truncate">{r.value}</span>
                <span className="w-14 text-right text-[10px] text-zinc-600">{r.ttl}s</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Network Policies */}
      <div className="bg-zinc-900/60 border border-zinc-800/40 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/40">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[11px] font-medium text-zinc-400">Network Policies</span>
          <Badge variant="outline" className="text-[9px] py-0 border-zinc-700 text-zinc-500">{policies.length}</Badge>
        </div>
        {policies.length === 0 ? (
          <div className="py-8 text-center text-zinc-700 text-xs">No policies configured</div>
        ) : (
          <div className="max-h-48 overflow-y-auto scrollbar-none">
            {policies.map(p => (
              <div key={p.id} className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/20 hover:bg-white/3">
                <div className={`w-1.5 h-1.5 rounded-full ${p.active ? 'bg-emerald-500' : 'bg-zinc-700'}`} />
                <span className="flex-1 text-xs text-zinc-300">{p.name}</span>
                <Badge variant="outline" className={`text-[9px] py-0 ${p.action === 'allow' ? 'border-emerald-500/30 text-emerald-400' : 'border-red-500/30 text-red-400'
                  }`}>
                  {p.action}
                </Badge>
                <span className="text-[10px] text-zinc-600 font-mono">{p.source} → {p.destination}</span>
                <span className="text-[10px] text-zinc-600">{p.protocol}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// TAB: SECURITY
// ============================================================================

function SecurityTab({ threats, stats, searchQuery }: {
  threats: Threat[]; stats: NetStats; searchQuery: string
}) {
  const filtered = useMemo(() => {
    if (!searchQuery) return threats
    const q = searchQuery.toLowerCase()
    return threats.filter(t =>
      t.type.toLowerCase().includes(q) || t.source_ip.includes(q) || t.severity.includes(q)
    )
  }, [threats, searchQuery])

  return (
    <div className="p-3 space-y-3">
      {/* Security KPIs */}
      <div className="grid grid-cols-4 gap-2">
        <StatCard icon={ShieldAlert} label="Threats (24h)" value={stats.threats_24h}
          color={stats.threats_24h > 0 ? 'text-amber-400' : 'text-emerald-400'} />
        <StatCard icon={Ban} label="Blocked IPs" value={stats.blocked_ips} color="text-red-400" />
        <StatCard icon={Lock} label="mTLS Sessions" value={stats.mtls_active} color="text-emerald-400" />
        <StatCard icon={Fingerprint} label="Zero Trust" value="Active" color="text-[#5EC9CC]" />
      </div>

      {/* Threat feed */}
      <div className="bg-zinc-900/60 border border-zinc-800/40 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/40">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[11px] font-medium text-zinc-400">Threat Feed</span>
        </div>

        {filtered.length === 0 ? (
          <div className="py-10 text-center">
            <ShieldCheck className="w-8 h-8 text-emerald-500/40 mx-auto mb-2" />
            <p className="text-xs text-zinc-600">No threats detected — all clear</p>
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto scrollbar-none divide-y divide-zinc-800/20">
            {filtered.map(t => (
              <div key={t.id} className="px-3 py-2 hover:bg-white/3 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-[9px] py-0 ${sevColor(t.severity)}`}>
                      {t.severity}
                    </Badge>
                    <span className="text-xs font-medium text-zinc-300">{t.type}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {t.blocked && <Badge variant="outline" className="text-[9px] py-0 border-red-500/30 bg-red-500/10 text-red-400">blocked</Badge>}
                    <span className="text-[10px] text-zinc-600">{formatAge(t.timestamp)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-zinc-600">
                  <span className="font-mono">{t.source_ip}</span>
                  {t.details && <span className="truncate">{t.details}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// TAB: PING
// ============================================================================

function PingTab({ target, setTarget, results, isPinging, onPing, onPingAll }: {
  target: string; setTarget: (v: string) => void; results: PingResult[]
  isPinging: boolean; onPing: () => void; onPingAll: () => void
}) {
  return (
    <div className="p-3 space-y-3">
      {/* Ping input */}
      <div className="bg-zinc-900/60 border border-zinc-800/40 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-2">
          <Radar className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[11px] font-medium text-zinc-400">Latency Probe</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={target}
            onChange={e => setTarget(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onPing()}
            placeholder="Service name, port, or URL..."
            className="flex-1 bg-zinc-800/60 border border-zinc-700/40 rounded px-3 py-1.5 text-xs text-white font-mono placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-cyan-500/30"
          />
          <Button
            size="sm"
            onClick={onPing}
            disabled={isPinging || !target.trim()}
            className="h-7 px-3 text-xs"
          >
            {isPinging ? <Loader2 className="w-3 h-3 animate-spin" /> : <Target className="w-3 h-3" />}
            <span className="ml-1">Ping</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onPingAll}
            disabled={isPinging}
            className="h-7 px-3 text-xs border-zinc-700 text-zinc-400 hover:text-white"
          >
            <Scan className="w-3 h-3 mr-1" />
            Ping All
          </Button>
        </div>
        <p className="text-[10px] text-zinc-700 mt-1.5">
          Try: genesis, 8001, AitherMind, http://localhost:8088/health
        </p>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="bg-zinc-900/60 border border-zinc-800/40 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/40">
            <BarChart3 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[11px] font-medium text-zinc-400">Results</span>
            <Badge variant="outline" className="text-[9px] py-0 border-zinc-700 text-zinc-500">{results.length}</Badge>
          </div>
          <div className="max-h-64 overflow-y-auto scrollbar-none divide-y divide-zinc-800/20">
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 hover:bg-white/3 transition-colors">
                <div className={`w-2 h-2 rounded-full ${r.status === 'ok' ? 'bg-emerald-500' : r.status === 'timeout' ? 'bg-red-500' : 'bg-amber-500'
                  }`} />
                <span className="flex-1 text-xs text-zinc-300 font-mono">{r.target}</span>
                <span className={`text-sm font-bold tabular-nums ${r.status === 'ok' ? (r.latency_ms < 100 ? 'text-emerald-400' : r.latency_ms < 500 ? 'text-amber-400' : 'text-red-400') : 'text-red-500'
                  }`}>
                  {r.status === 'ok' ? `${r.latency_ms}ms` : r.status === 'timeout' ? 'TIMEOUT' : 'ERROR'}
                </span>
                {r.status === 'ok' && (
                  <div className="w-20 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${r.latency_ms < 50 ? 'bg-emerald-500' : r.latency_ms < 200 ? 'bg-amber-500' : 'bg-red-500'
                      }`} style={{ width: `${Math.min(100, (r.latency_ms / 1000) * 100)}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {results.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
          <Radar className="w-10 h-10 mb-3 text-zinc-700" />
          <p className="text-sm font-medium">Latency Probe</p>
          <p className="text-xs mt-1 text-zinc-700">Enter a service name or click &quot;Ping All&quot; for a full sweep</p>
        </div>
      )}
    </div>
  )
}
