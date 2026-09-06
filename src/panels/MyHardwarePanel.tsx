'use client'

/**
 * My Hardware — the self-service "bring your own hardware" on-ramp.
 *
 * A logged-in user downloads the CLI, installs it, signs in with their own
 * account, and brings up their agent on their own machine. This panel holds the
 * three steps together:
 *
 *   1. Download — the registry-VERIFIED package surface (no invented URLs).
 *   2. Enroll — mints a device owned by the signed-in user and returns the
 *      copy-paste commands (per OS), including the device secret shown ONCE.
 *   3. Your devices — live list (polled), each with its status and a Remove.
 *
 * The host app must implement `GET /api/devices` + `POST /api/devices/enroll`
 * (a tenant agent's devices router does). A host that does not opt in simply never
 * summons this panel.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import Tooltip from '../ui/Tooltip'

export interface MyHardwarePanelProps {
  apiBase?: string
  /** Called when the user clicks "view in Universe" — the host summons `/space`. */
  onShowUniverse?: () => void
}

interface DeviceInfo {
  id: string
  node_id: string
  name: string
  os: string
  role: string
  status: 'online' | 'offline' | 'enrolling' | string
  agent_scope: string
  overlay_ip?: string | null
  last_seen?: string | null
  created_at?: string | null
}

interface PackageInfo {
  id: string
  name: string
  version: string
  install?: string | null
  url?: string | null
  description: string
}

interface Downloads {
  packages: PackageInfo[]
  bonsai?: { name: string; install?: string | null; description: string }
}

/** The self-host appliance release surface (served by the tenant backend's
 *  GET /api/appliance — the release lane's committed appliance_release.json).
 *  URLs come from the release manifest, never invented in the UI. */
interface ApplianceRelease {
  release_tag: string
  release_url: string
  asset: string
  size_bytes: number
  slices: number
  booted: boolean
  boot_proof: string
}

interface ApplianceInfo {
  tenant: ApplianceRelease
  platform?: ApplianceRelease
  updated_at?: string
}

function fmtGB(bytes: number): string {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function detectOS(): string {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('windows')) return 'windows'
  if (ua.includes('mac')) return 'macos'
  if (ua.includes('linux')) return 'linux'
  return 'unknown'
}

function statusColor(status: string): string {
  switch (status) {
    case 'online': return 'var(--accent-green)'
    case 'offline': return 'var(--text-muted)'
    default: return 'var(--accent-coral)'
  }
}

const row: CSSProperties = {
  padding: '0.85rem 1rem',
  border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius)',
  marginBottom: '0.6rem',
}

const btn: CSSProperties = {
  padding: '0.6rem 1rem',
  background: 'var(--accent-primary)',
  color: 'var(--bg-deep)',
  borderRadius: 'var(--radius)',
  fontSize: '0.82rem',
  fontWeight: 600,
  border: 'none',
  cursor: 'pointer',
}

const ghost: CSSProperties = {
  padding: '0.5rem 0.9rem',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  borderRadius: 'var(--radius)',
  fontSize: '0.8rem',
  border: '1px solid var(--glass-border)',
  cursor: 'pointer',
}

/**
 * An install command and its Copy button.
 *
 * This panel is summoned into the room's title block — a rail a few hundred
 * pixels wide — as well as rendered full-page in a portal. It was
 * `whiteSpace: nowrap` with `overflowX: auto`, which in the rail cut every
 * command mid-word ("pip install aither-") behind a scrollbar nobody sees, so
 * the one thing the card exists to give you was the part that was hidden.
 * A command must WRAP rather than clip: it is copy-paste text, and there is no
 * width at which truncating it is the right answer.
 */
const cmdRow: CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  alignItems: 'center',
  flexWrap: 'wrap',
}

const cmdCode: CSSProperties = {
  flex: '1 1 12rem',
  minWidth: 0,
  fontSize: '0.8rem',
  padding: '0.45rem 0.6rem',
  background: 'var(--bg-elevated)',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--glass-border)',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
}

const cmdCopy: CSSProperties = { ...ghost, flexShrink: 0 }

export default function MyHardwarePanel({
  apiBase = '/api',
  onShowUniverse,
}: MyHardwarePanelProps) {
  const [downloads, setDownloads] = useState<Downloads | null>(null)
  const [appliance, setAppliance] = useState<ApplianceInfo | null>(null)
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [devicesError, setDevicesError] = useState('')
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [name, setName] = useState('')
  const [enrolling, setEnrolling] = useState(false)
  const [enrollError, setEnrollError] = useState('')
  const [enrolled, setEnrolled] = useState<{ command: string; secret: string; device: DeviceInfo } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const os = detectOS()
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copy = useCallback((text: string, key: string) => {
    navigator.clipboard?.writeText(text).catch(() => undefined)
    setCopied(key)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(null), 1600)
  }, [])

  // ── Downloads surface ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    fetch(`${apiBase}/devices/downloads`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Downloads) => { if (!cancelled) setDownloads(d) })
      .catch(() => undefined) // the cards simply don't render versions on failure
    return () => { cancelled = true }
  }, [apiBase])

  // ── Self-host appliance surface (the download card) ─────────────────────
  // Served by the tenant backend's /api/appliance — the committed release
  // manifest. Absent/failed fetch = the card simply does not render (the host
  // app opted out), same contract as the downloads surface.
  useEffect(() => {
    let cancelled = false
    fetch(`${apiBase}/appliance`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: ApplianceInfo) => { if (!cancelled) setAppliance(d) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [apiBase])

  // ── Live devices (poll) ──────────────────────────────────────────────────
  const load = useCallback(() => {
    fetch(`${apiBase}/devices`, { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const d = await r.json()
        return Array.isArray(d) ? d : d.devices ?? []
      })
      .then((list: DeviceInfo[]) => { setDevices(list); setDevicesError('') })
      .catch((e: Error) => setDevicesError(e.message))
  }, [apiBase])

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  // ── Enroll ───────────────────────────────────────────────────────────────
  const enroll = async () => {
    setEnrolling(true)
    setEnrollError('')
    try {
      const res = await fetch(`${apiBase}/devices/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: name.trim() || undefined, os }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const command = data.commands?.[os] ?? data.commands?.linux ?? ''
      setEnrolled({ command, secret: data.device_secret, device: data.device })
      setEnrollOpen(false)
      setName('')
      load()
    } catch (e) {
      setEnrollError(e instanceof Error ? e.message : 'enroll failed')
    } finally {
      setEnrolling(false)
    }
  }

  const remove = async (deviceId: string) => {
    try {
      await fetch(`${apiBase}/devices/${deviceId}`, { method: 'DELETE', credentials: 'include' })
      load()
    } catch {
      /* keep the row; the next poll corrects it */
    }
  }

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  return (
    // `width: 100%` + border-box: this renders inside a flex COLUMN (the room's
    // title block) as well as a page. Without them the padding is added OUTSIDE
    // the 100% and the card edges sit under the container's border.
    <div
      data-tour="hardware"
      style={{ padding: '1rem 1.25rem', maxWidth: 640, width: '100%', boxSizing: 'border-box' }}
    >
      <Tooltip label="Bring your own machine — install the CLI, sign in, and run your own agent on hardware your account owns">
        <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: '0 0 0.25rem' }}>
          My Hardware
        </h2>
      </Tooltip>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0 0 1.25rem' }}>
        Bring your own machine: run your own agent on your own hardware, owned by your
        account. Install the CLI, sign in, and bring it up — then watch it appear in the
        Universe.
      </p>

      {/* 1 — Download */}
      <h3 style={{ fontSize: '0.85rem', fontWeight: 700, margin: '0 0 0.6rem', color: 'var(--text-muted)' }}>
        1 · Download
      </h3>
      {(downloads?.packages ?? []).map((p) => (
        <div key={p.id} style={row}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{p.name}</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>v{p.version}</span>
            {p.url && (
              <a href={p.url} target="_blank" rel="noopener noreferrer"
                style={{ marginLeft: 'auto', fontSize: '0.72rem' }}>registry ↗</a>
            )}
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.3rem 0 0.5rem' }}>
            {p.description}
          </p>
          {p.install ? (
            <div style={cmdRow}>
              <code style={cmdCode}>{p.install}</code>
              <button style={cmdCopy} onClick={() => copy(p.install!, p.id)}>
                {copied === p.id ? 'Copied' : 'Copy'}
              </button>
            </div>
          ) : (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
              No one-command installer published yet.
            </p>
          )}
        </div>
      ))}
      {downloads?.bonsai?.install && (
        <div style={{ ...row, borderColor: 'var(--accent-primary)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{downloads.bonsai.name}</span>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.3rem 0 0.5rem' }}>
            {downloads.bonsai.description}
          </p>
          <div style={cmdRow}>
            <code style={cmdCode}>{downloads.bonsai.install}</code>
            <button style={cmdCopy} onClick={() => copy(downloads.bonsai!.install!, 'bonsai')}>
              {copied === 'bonsai' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* 1b — Self-Hosted Appliance (the whole-product download) */}
      {appliance?.tenant && (
        <div style={{ ...row, borderColor: 'var(--accent-primary)', marginTop: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
              Self-Hosted Appliance
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {appliance.tenant.release_tag}
            </span>
            <span
              style={{
                marginLeft: 'auto', fontSize: '0.7rem', padding: '0.1rem 0.45rem',
                borderRadius: 999, fontWeight: 600,
                background: appliance.tenant.booted
                  ? 'var(--accent-primary)'
                  : 'var(--surface-raised)',
                color: appliance.tenant.booted ? '#fff' : 'var(--text-muted)',
              }}
            >
              {appliance.tenant.booted ? '✓ boot-proven' : 'proof pending'}
            </span>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.3rem 0 0.5rem' }}>
            The whole product as an immutable OS — install it on a machine and it comes
            up with GargBot running, no network needed.{' '}
            {appliance.tenant.size_bytes > 0 && (
              <span style={{ color: 'var(--text-muted)' }}>
                {fmtGB(appliance.tenant.size_bytes)} · {appliance.tenant.slices} slices.
              </span>
            )}
          </p>
          <div style={cmdRow}>
            <code style={cmdCode}>bash deliverables/iso/join-iso.sh --tag {appliance.tenant.release_tag}</code>
            <button style={cmdCopy} onClick={() => copy(
              `bash deliverables/iso/join-iso.sh --tag ${appliance.tenant.release_tag}`, 'appliance-join')}>
              {copied === 'appliance-join' ? 'Copied' : 'Copy'}
            </button>
          </div>
          {appliance.tenant.release_url && (
            <a href={appliance.tenant.release_url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '0.72rem' }}>
              release ↗
            </a>
          )}
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.4rem 0 0' }}>
            {appliance.tenant.boot_proof}
          </p>
        </div>
      )}
      {appliance?.platform?.release_tag && (
        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.4rem 0 0' }}>
          Platform build: {appliance.platform.release_tag}
          {appliance.platform.release_url && (
            <> · <a href={appliance.platform.release_url} target="_blank" rel="noopener noreferrer">release ↗</a></>
          )}
        </p>
      )}

      {/* 2 — Enroll */}
      <h3 style={{ fontSize: '0.85rem', fontWeight: 700, margin: '1.25rem 0 0.6rem', color: 'var(--text-muted)' }}>
        2 · Enroll this machine
      </h3>
      {!enrolled ? (
        <div style={row}>
          {!enrollOpen ? (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 12rem', minWidth: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Get a set of commands for this machine ({os === 'unknown' ? 'your OS' : os}).
              </span>
              <button style={{ ...btn, marginLeft: 'auto', flexShrink: 0 }} onClick={() => setEnrollOpen(true)}>
                Enroll this machine
              </button>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Give it a name (e.g. Work MacBook)"
                  style={{
                    flex: 1, padding: '0.55rem 0.7rem', fontSize: '0.82rem',
                    background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                    border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)',
                  }}
                />
                <button style={btn} disabled={enrolling} onClick={enroll}>
                  {enrolling ? 'Creating…' : 'Create'}
                </button>
                <button style={ghost} onClick={() => setEnrollOpen(false)}>Cancel</button>
              </div>
              {enrollError && (
                <p style={{ fontSize: '0.75rem', color: 'var(--accent-coral)', margin: 0 }}>{enrollError}</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{ ...row, borderColor: 'var(--accent-green)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{enrolled.device.name}</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{enrolled.device.node_id}</span>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>
            Run these on the machine you want to enroll. The last line tells GargBot you're live.
          </p>
          <div style={{ position: 'relative' }}>
            <pre style={{
              fontSize: '0.76rem', lineHeight: 1.5, padding: '0.7rem 0.8rem', margin: 0,
              background: 'var(--bg-elevated)', borderRadius: 'var(--radius)',
              border: '1px solid var(--glass-border)', overflowX: 'auto', whiteSpace: 'pre-wrap',
              color: 'var(--text-primary)',
            }}>{enrolled.command}</pre>
            <button
              style={{ ...ghost, position: 'absolute', top: '0.5rem', right: '0.5rem', padding: '0.3rem 0.6rem' }}
              onClick={() => copy(enrolled.command, 'enroll')}
            >
              {copied === 'enroll' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--accent-coral)', margin: '0.6rem 0 0' }}>
            This device secret is shown once. Anyone holding it can report this device as live —
            treat it like a password.
          </p>
        </div>
      )}

      {/* 3 — Your devices */}
      <h3 style={{ fontSize: '0.85rem', fontWeight: 700, margin: '1.25rem 0 0.6rem', color: 'var(--text-muted)' }}>
        3 · Your devices
      </h3>
      {devicesError && (
        <p style={{ fontSize: '0.75rem', color: 'var(--accent-coral)', margin: '0 0 0.5rem' }}>
          Could not load devices — {devicesError}
        </p>
      )}
      {devices.length === 0 && !devicesError && (
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
          Nothing enrolled yet. Once you run the commands above, this machine shows up here.
        </p>
      )}
      {devices.map((d) => (
        <div key={d.id} style={{ ...row, display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
            background: statusColor(d.status) }} aria-hidden="true" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{d.name}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {d.node_id} · {d.agent_scope}
              {d.os && d.os !== 'unknown' ? ` · ${d.os}` : ''}
            </div>
          </div>
          <span style={{ fontSize: '0.72rem', textTransform: 'capitalize', color: statusColor(d.status) }}>
            {d.status}
          </span>
          {onShowUniverse && (
            <button style={ghost} onClick={onShowUniverse}>Universe</button>
          )}
          <button
            style={{ ...ghost, color: 'var(--accent-coral)' }}
            onClick={() => remove(d.id)}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  )
}
