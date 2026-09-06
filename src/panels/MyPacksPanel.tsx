'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'

/* ── Types ─────────────────────────────────────────────────────────── */

interface InstalledPack {
  pack_id: string
  name: string
  version: string
  pack_type: string
  installed_at: string
  files_count: number
  description?: string
}

interface License {
  pack_id: string
  status: 'active' | 'expired' | 'expiring_soon'
  expires_at?: string
}

export interface MyPacksPanelProps {
  apiBase?: string
}

/* ── Styles ────────────────────────────────────────────────────────── */

const sBtn = (primary = false, danger = false): React.CSSProperties => ({
  padding: '6px 12px',
  borderRadius: 6,
  border: danger ? 'none' : primary ? 'none' : '1px solid var(--border)',
  background: danger ? '#dc2626' : primary ? 'var(--accent)' : 'transparent',
  color: danger || primary ? '#fff' : 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: '0.8rem',
  fontWeight: primary ? 600 : 400,
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
})

const sCard: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: 8,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  marginBottom: '12px',
}

const sPackCard: React.CSSProperties = {
  ...sCard,
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
}

const sHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '12px',
  marginBottom: '8px',
}

const sPackName: React.CSSProperties = {
  fontSize: '0.95rem',
  fontWeight: 600,
  color: 'var(--text-primary)',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
}

const sPackMeta: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--text-muted)',
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap',
}

const sPackDescription: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--text-muted)',
  lineHeight: '1.4',
}

const sBadge = (type: string): React.CSSProperties => {
  const colors: Record<string, { bg: string; fg: string }> = {
    agent_pack: { bg: '#1a2a3a', fg: '#60a5fa' },
    skill_pack: { bg: '#2a1a3a', fg: '#a78bfa' },
    tool_pack: { bg: '#1a3a2a', fg: '#4ade80' },
    service_pack: { bg: '#3a2a1a', fg: '#fbbf24' },
  }
  const color = colors[type] || colors.agent_pack
  return {
    fontSize: '0.7rem',
    padding: '2px 8px',
    borderRadius: 4,
    background: color.bg,
    color: color.fg,
    textTransform: 'capitalize',
    whiteSpace: 'nowrap',
  }
}

const sLicenseBadge = (status: string): React.CSSProperties => {
  const colors: Record<string, { bg: string; fg: string }> = {
    active: { bg: '#1a3a1a', fg: '#4ade80' },
    expiring_soon: { bg: '#3a2a1a', fg: '#fbbf24' },
    expired: { bg: '#3a1a1a', fg: '#ef4444' },
  }
  const color = colors[status] || colors.active
  return {
    fontSize: '0.7rem',
    padding: '2px 8px',
    borderRadius: 4,
    background: color.bg,
    color: color.fg,
    whiteSpace: 'nowrap',
  }
}

const sButtonGroup: React.CSSProperties = {
  display: 'flex',
  gap: '6px',
  alignItems: 'center',
  flexWrap: 'wrap',
}

/* ── Component ─────────────────────────────────────────────────────── */

export default function MyPacksPanel({ apiBase = '/api/packs' }: MyPacksPanelProps) {
  const [packs, setPacks] = useState<InstalledPack[]>([])
  const [licenses, setLicenses] = useState<Record<string, License>>({})
  const [loading, setLoading] = useState(true)
  const [uninstalling, setUninstalling] = useState<Set<string>>(new Set())
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedPackId, setExpandedPackId] = useState<string | null>(null)

  /* ── Data Fetching ───────────────────────────────────────────── */

  const fetchInstalledPacks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(`${apiBase}/installed`)
      if (resp.ok) {
        const data = await resp.json()
        setPacks(data?.packs ?? [])
      } else {
        setError(`Failed to load packs: ${resp.statusText}`)
      }
    } catch (e) {
      console.error('Packs fetch error:', e)
      setError(String(e))
    }
    setLoading(false)
  }, [apiBase])

  const fetchLicenses = useCallback(async () => {
    try {
      const resp = await fetch(`${apiBase}/licenses`)
      if (resp.ok) {
        const data = await resp.json()
        const licenseMap: Record<string, License> = {}
        ;(data?.licenses ?? []).forEach((lic: License) => {
          licenseMap[lic.pack_id] = lic
        })
        setLicenses(licenseMap)
      }
    } catch (e) {
      console.debug('Licenses fetch (optional):', e)
    }
  }, [apiBase])

  useEffect(() => {
    fetchInstalledPacks()
    fetchLicenses()
  }, [fetchInstalledPacks, fetchLicenses])

  /* ── Actions ─────────────────────────────────────────────────── */

  const handleUninstall = useCallback(
    async (pack_id: string) => {
      if (!confirm(`Uninstall "${pack_id}"? This action cannot be undone.`)) return

      setUninstalling(prev => new Set(prev).add(pack_id))
      try {
        const resp = await fetch(`${apiBase}/installed/${encodeURIComponent(pack_id)}`, {
          method: 'DELETE',
        })
        if (resp.ok) {
          setPacks(prev => prev.filter(p => p.pack_id !== pack_id))
        } else {
          setError(`Failed to uninstall: ${resp.statusText}`)
        }
      } catch (e) {
        console.error('Uninstall error:', e)
        setError(String(e))
      }
      setUninstalling(prev => {
        const next = new Set(prev)
        next.delete(pack_id)
        return next
      })
    },
    [apiBase]
  )

  const handleCheckForUpdates = useCallback(async () => {
    setChecking(true)
    try {
      // In a full implementation, this would call a version check endpoint
      // For now, just refresh the list
      await fetchInstalledPacks()
      setError(null)
    } catch (e) {
      console.error('Check for updates error:', e)
      setError(String(e))
    }
    setChecking(false)
  }, [fetchInstalledPacks])

  const handleBrowseMarketplace = useCallback(() => {
    // Open marketplace (e.g., navigate to marketplace page or open a modal)
    console.log('Browse marketplace clicked')
  }, [])

  /* ── Grouping & Organization ───────────────────────────────── */

  const groupedPacks = useMemo(() => {
    const groups: Record<string, InstalledPack[]> = {
      agent_pack: [],
      skill_pack: [],
      tool_pack: [],
      service_pack: [],
    }

    packs.forEach(pack => {
      const type = pack.pack_type || 'agent_pack'
      if (type in groups) {
        groups[type].push(pack)
      } else {
        if (!groups['other']) groups['other'] = []
        groups['other'].push(pack)
      }
    })

    return groups
  }, [packs])

  const categoryLabels: Record<string, string> = {
    agent_pack: 'Agents',
    skill_pack: 'Skills',
    tool_pack: 'Tools',
    service_pack: 'Services',
    other: 'Other',
  }

  /* ── Render ────────────────────────────────────────────────── */

  return (
    <div style={{ padding: '16px', maxWidth: '900px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
          My Packs
        </h2>
        <div style={sButtonGroup}>
          <button
            onClick={handleCheckForUpdates}
            disabled={checking || loading}
            style={{ ...sBtn(true), opacity: checking || loading ? 0.6 : 1 }}
          >
            <span style={{ marginRight: '2px' }}>🔄</span>
            Check Updates
          </button>
          <button onClick={handleBrowseMarketplace} style={sBtn(false)}>
            🛒 Browse Marketplace
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div
          style={{
            ...sCard,
            background: '#3a1a1a',
            border: '1px solid #dc2626',
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-start',
          }}
        >
          <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>⚠️</span>
          <div>
            <div style={{ fontSize: '0.85rem', color: '#ef4444', fontWeight: 600 }}>Error</div>
            <div style={{ fontSize: '0.8rem', color: '#fca5a5', marginTop: '2px' }}>{error}</div>
          </div>
          <button
            onClick={() => setError(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#fca5a5',
              cursor: 'pointer',
              fontSize: '1.1rem',
              marginLeft: 'auto',
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
          <div style={{ marginBottom: '8px' }}>Loading packs...</div>
          <div style={{ fontSize: '0.75rem' }}>This may take a moment</div>
        </div>
      ) : packs.length === 0 ? (
        /* Empty state */
        <div
          style={{
            ...sCard,
            textAlign: 'center',
            padding: '40px 20px',
            background: 'var(--bg-deep)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <span style={{ fontSize: '3rem', opacity: 0.5 }}>📦</span>
          <div>
            <div style={{ fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: 500 }}>
              No packs installed
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Start by browsing the marketplace to add agents, skills, tools, or services
            </div>
          </div>
          <button onClick={handleBrowseMarketplace} style={sBtn(true)}>
            Browse Marketplace
          </button>
        </div>
      ) : (
        /* Pack groups */
        <div>
          {Object.entries(groupedPacks).map(
            ([packType, packList]) =>
              packList.length > 0 && (
                <div key={packType} style={{ marginBottom: '24px' }}>
                  {/* Group header */}
                  <h3
                    style={{
                      fontSize: '0.9rem',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      color: 'var(--text-muted)',
                      letterSpacing: '0.5px',
                      margin: '0 0 12px',
                      paddingBottom: '8px',
                      borderBottom: '1px solid var(--glass-border)',
                    }}
                  >
                    {categoryLabels[packType] || packType} ({packList.length})
                  </h3>

                  {/* Pack cards */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {packList.map(pack => {
                      const license = licenses[pack.pack_id]
                      const isExpanded = expandedPackId === pack.pack_id
                      const isUninstalling = uninstalling.has(pack.pack_id)

                      return (
                        <div key={pack.pack_id} style={sPackCard}>
                          {/* Pack header */}
                          <div style={sHeader}>
                            <div style={{ flex: 1 }}>
                              <div style={sPackName}>
                                <span>{pack.name || pack.pack_id}</span>
                                <span style={sBadge(pack.pack_type)}>
                                  {pack.pack_type?.replace('_', ' ')}
                                </span>
                              </div>
                              <div style={sPackMeta}>
                                <span>v{pack.version}</span>
                                <span>•</span>
                                <span>
                                  Installed{' '}
                                  {new Date(pack.installed_at).toLocaleDateString()}
                                </span>
                                {license && (
                                  <>
                                    <span>•</span>
                                    <span style={sLicenseBadge(license.status)}>
                                      License: {license.status.replace('_', ' ')}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Description (if provided) */}
                          {pack.description && (
                            <div style={sPackDescription}>{pack.description}</div>
                          )}

                          {/* Expanded details */}
                          {isExpanded && (
                            <div
                              style={{
                                padding: '8px 0',
                                borderTop: '1px solid var(--glass-border)',
                                paddingTop: '8px',
                              }}
                            >
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                <div>
                                  <strong>Pack ID:</strong> {pack.pack_id}
                                </div>
                                <div>
                                  <strong>Files:</strong> {pack.files_count} file
                                  {pack.files_count !== 1 ? 's' : ''}
                                </div>
                                {license && license.expires_at && (
                                  <div>
                                    <strong>License Expires:</strong>{' '}
                                    {new Date(license.expires_at).toLocaleDateString()}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Actions */}
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              paddingTop: '8px',
                              borderTop: '1px solid var(--glass-border)',
                            }}
                          >
                            <button
                              onClick={() =>
                                setExpandedPackId(isExpanded ? null : pack.pack_id)
                              }
                              style={{
                                ...sBtn(false),
                                border: 'none',
                                fontSize: '0.7rem',
                              }}
                            >
                              {isExpanded ? 'Show Less' : 'Show Details'}
                            </button>
                            <div style={sButtonGroup}>
                              <button
                                onClick={() => handleUninstall(pack.pack_id)}
                                disabled={isUninstalling}
                                style={{
                                  ...sBtn(false, true),
                                  opacity: isUninstalling ? 0.6 : 1,
                                }}
                              >
                                🗑️ {isUninstalling ? 'Uninstalling...' : 'Uninstall'}
                              </button>
                              <button
                                style={{
                                  ...sBtn(true),
                                  opacity: 0.6,
                                  cursor: 'not-allowed',
                                }}
                                disabled
                              >
                                ⬇️ Download
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
          )}
        </div>
      )}

      {/* Footer info */}
      {packs.length > 0 && (
        <div
          style={{
            marginTop: '20px',
            padding: '12px 16px',
            borderRadius: 8,
            background: 'var(--bg-deep)',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
          }}
        >
          <div>
            Total: {packs.length} pack{packs.length !== 1 ? 's' : ''} installed
          </div>
          <div style={{ marginTop: '4px' }}>
            Tip: Use "Show Details" to view license status and pack IDs
          </div>
        </div>
      )}
    </div>
  )
}
