'use client'

import React, { useCallback, useEffect, useState } from 'react'

export interface ProtonSuitePanelProps {
  apiBase?: string
  className?: string
}

type Tab = 'mail' | 'calendar' | 'drive' | 'vpn' | 'pass'

interface ServiceStatus {
  name: string
  connected: boolean
  detail?: string
}

export default function ProtonSuitePanel({
  apiBase = '',
  className = '',
}: ProtonSuitePanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('mail')
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [setupMode, setSetupMode] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)

  const checkServices = useCallback(async () => {
    setLoading(true)
    const checks: ServiceStatus[] = []

    // Check Bridge (IMAP)
    try {
      const res = await fetch(`${apiBase}/api/mail/folders`)
      checks.push({ name: 'Mail (IMAP)', connected: res.ok })
    } catch {
      checks.push({ name: 'Mail (IMAP)', connected: false })
    }

    // Check Calendar
    try {
      const res = await fetch(`${apiBase}/api/calendar/providers`)
      checks.push({ name: 'Calendar (CalDAV)', connected: res.ok })
    } catch {
      checks.push({ name: 'Calendar (CalDAV)', connected: false })
    }

    // Check Drive
    try {
      const res = await fetch(`${apiBase}/api/file-sync/providers/proton_drive/status`)
      const data = await res.json()
      checks.push({ name: 'Drive (rclone)', connected: data.data?.connected ?? false })
    } catch {
      checks.push({ name: 'Drive (rclone)', connected: false })
    }

    // Check VPN
    try {
      const res = await fetch(`${apiBase}/api/proton-vpn/status`)
      const data = await res.json()
      checks.push({ name: 'VPN (WireGuard)', connected: data.data?.connected ?? false })
    } catch {
      checks.push({ name: 'VPN (WireGuard)', connected: false, detail: 'Not configured' })
    }

    // Check Pass
    try {
      const res = await fetch(`${apiBase}/api/proton-pass/vaults`)
      checks.push({ name: 'Pass', connected: res.ok })
    } catch {
      checks.push({ name: 'Pass', connected: false, detail: 'Not configured' })
    }

    setServices(checks)
    setSetupMode(!checks.some(s => s.connected))
    setLoading(false)
  }, [apiBase])

  useEffect(() => {
    checkServices()
  }, [checkServices])

  const handleSetup = async () => {
    setSaving(true)
    setSetupError(null)
    try {
      // Store each credential separately via workspace secrets API
      const headers = { 'Content-Type': 'application/json' }
      const [r1, r2] = await Promise.all([
        fetch(`${apiBase}/api/secrets`, {
          method: 'POST', headers,
          body: JSON.stringify({ key: 'PROTON_EMAIL', value: email, description: 'Proton account email' }),
        }),
        fetch(`${apiBase}/api/secrets`, {
          method: 'POST', headers,
          body: JSON.stringify({ key: 'PROTON_BRIDGE_PASSWORD', value: password, description: 'Proton Bridge app password' }),
        }),
      ])
      if (!r1.ok || !r2.ok) throw new Error('Failed to save credentials')
      setSetupMode(false)
      await checkServices()
    } catch (e: unknown) {
      setSetupError(e instanceof Error ? e.message : 'Setup failed')
    } finally {
      setSaving(false)
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'mail', label: 'Mail' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'drive', label: 'Drive' },
    { key: 'vpn', label: 'VPN' },
    { key: 'pass', label: 'Pass' },
  ]

  if (loading) {
    return (
      <div className={className} style={{ padding: 20, textAlign: 'center', opacity: 0.5 }}>
        Checking Proton services...
      </div>
    )
  }

  if (setupMode) {
    return (
      <div className={`proton-suite-panel ${className}`}>
        <h3 style={{ margin: '0 0 8px' }}>Proton Business Suite Setup</h3>
        <p style={{ fontSize: 13, opacity: 0.7, margin: '0 0 16px' }}>
          Connect your Proton account to enable Mail, Calendar, Drive, VPN, and Pass in this workspace.
          You need a Proton Bridge app password (generate in Proton account settings).
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 400 }}>
          <label style={{ fontSize: 13, fontWeight: 500 }}>
            Proton Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@proton.me"
              style={inputStyle}
            />
          </label>
          <label style={{ fontSize: 13, fontWeight: 500 }}>
            Bridge Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Generated in Proton Bridge settings"
              style={inputStyle}
            />
          </label>

          {setupError && (
            <div style={{ color: '#ef4444', fontSize: 13 }}>{setupError}</div>
          )}

          <button
            onClick={handleSetup}
            disabled={saving || !email || !password}
            style={{
              padding: '10px 24px', borderRadius: 8, border: 'none',
              background: '#6d28d9', color: 'white', fontWeight: 600,
              cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Connecting...' : 'Connect Proton Account'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`proton-suite-panel ${className}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>Proton Suite</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          {services.map(s => (
            <div
              key={s.name}
              title={`${s.name}: ${s.connected ? 'Connected' : s.detail || 'Disconnected'}`}
              style={{
                width: 8, height: 8, borderRadius: '50%',
                background: s.connected ? '#22c55e' : '#ef4444',
              }}
            />
          ))}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border, #333)', paddingBottom: 4 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '6px 16px', borderRadius: '6px 6px 0 0', border: 'none',
              background: activeTab === t.key ? 'var(--card, #1a1a2e)' : 'transparent',
              color: 'inherit', cursor: 'pointer', fontWeight: activeTab === t.key ? 600 : 400,
              opacity: activeTab === t.key ? 1 : 0.6,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content — embed sub-panels or link to full panels */}
      <div style={{ minHeight: 200 }}>
        {activeTab === 'mail' && (
          <div style={{ opacity: 0.7, padding: 16, textAlign: 'center' }}>
            Open the full <strong>Mail</strong> panel for inbox, compose, and thread view.
          </div>
        )}
        {activeTab === 'calendar' && (
          <div style={{ opacity: 0.7, padding: 16, textAlign: 'center' }}>
            Open the full <strong>Calendar</strong> panel for events and scheduling.
          </div>
        )}
        {activeTab === 'drive' && (
          <div style={{ opacity: 0.7, padding: 16, textAlign: 'center' }}>
            Open the full <strong>Proton Drive</strong> panel for file browsing.
          </div>
        )}
        {activeTab === 'vpn' && (
          <div style={{ opacity: 0.7, padding: 16, textAlign: 'center' }}>
            Open the full <strong>VPN</strong> panel for connection management.
          </div>
        )}
        {activeTab === 'pass' && (
          <div style={{ opacity: 0.7, padding: 16, textAlign: 'center' }}>
            Open the full <strong>Pass</strong> panel for credential vault.
          </div>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', padding: '8px 12px', marginTop: 4,
  borderRadius: 6, border: '1px solid var(--border, #333)',
  background: 'var(--card, #1a1a2e)', color: 'inherit', boxSizing: 'border-box',
}
