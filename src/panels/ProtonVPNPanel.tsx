'use client'

import React, { useCallback, useEffect, useState } from 'react'

export interface ProtonVPNPanelProps {
  apiBase?: string
  className?: string
}

export default function ProtonVPNPanel({
  apiBase = '/api/proton-vpn',
  className = '',
}: ProtonVPNPanelProps) {
  const [connected, setConnected] = useState(false)
  const [statusDetail, setStatusDetail] = useState('')
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [country, setCountry] = useState('')

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/status`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setConnected(data.data?.connected ?? false)
      setStatusDetail(data.data?.detail ?? '')
    } catch {
      setConnected(false)
      setStatusDetail('Unable to check VPN status')
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  const handleConnect = async () => {
    setConnecting(true)
    try {
      await fetch(`${apiBase}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country: country || undefined }),
      })
      await fetchStatus()
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    setConnecting(true)
    try {
      await fetch(`${apiBase}/disconnect`, { method: 'POST' })
      await fetchStatus()
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className={`proton-vpn-panel ${className}`}>
      <h3 style={{ margin: '0 0 12px' }}>Proton VPN</h3>

      {loading ? (
        <div style={{ opacity: 0.5, padding: 20, textAlign: 'center' }}>
          Checking VPN status...
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: 16,
              borderRadius: 8,
              border: `1px solid ${connected ? '#22c55e33' : '#ef444433'}`,
              background: connected ? '#22c55e0a' : '#ef44440a',
            }}
          >
            <div
              style={{
                width: 12, height: 12, borderRadius: '50%',
                background: connected ? '#22c55e' : '#ef4444',
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>
                {connected ? 'Connected' : 'Disconnected'}
              </div>
              {statusDetail && (
                <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4, whiteSpace: 'pre-wrap' }}>
                  {statusDetail}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Country code (e.g. US, CH)"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 6,
                border: '1px solid var(--border, #333)',
                background: 'var(--card, #1a1a2e)',
                color: 'inherit',
              }}
            />
            {connected ? (
              <button
                onClick={handleDisconnect}
                disabled={connecting}
                style={{ ...actionBtn, background: '#ef4444' }}
              >
                {connecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
            ) : (
              <button
                onClick={handleConnect}
                disabled={connecting}
                style={{ ...actionBtn, background: '#6d28d9' }}
              >
                {connecting ? 'Connecting...' : 'Connect'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const actionBtn: React.CSSProperties = {
  padding: '8px 20px',
  borderRadius: 6,
  border: 'none',
  color: 'white',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 14,
}
