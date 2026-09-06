'use client'

import { useState, useEffect, useCallback } from 'react'

interface SyncProvider {
  provider: string
  label: string
  connected: boolean
  last_sync?: string
  sync_folder?: string
  files_count?: number
  bytes_synced?: number
}

interface SyncedFile {
  file_id: string
  name: string
  folder: string
  provider: string
  size: number
  content_type?: string
  last_modified: string
}

interface SyncStatus {
  last_sync?: string
  files_synced: number
  bytes_synced: number
  errors: number
  syncing: boolean
}

interface ActivityEntry {
  timestamp: string
  action: string
  provider: string
  file_name?: string
  details?: string
  status: string
}

export interface FileSyncPanelProps {
  apiBase?: string
}

const PROVIDER_ICONS: Record<string, string> = {
  google_drive: 'GD',
  onedrive: 'OD',
  dropbox: 'DB',
  s3: 'S3',
  proton_drive: 'PD',
  webdav: 'WD',
  sftp: 'SF',
  smb: 'SM',
  git: 'GT',
  obsidian_vault: 'OB',
}

const PROVIDER_LABELS: Record<string, string> = {
  google_drive: 'Google Drive',
  onedrive: 'OneDrive',
  dropbox: 'Dropbox',
  s3: 'Amazon S3',
  proton_drive: 'Proton Drive',
  webdav: 'WebDAV',
  sftp: 'SFTP',
  smb: 'File Server (SMB)',
  git: 'Git Repository',
  obsidian_vault: 'Obsidian Vault',
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
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

export default function FileSyncPanel({ apiBase = '/api/file-sync' }: FileSyncPanelProps) {
  const [providers, setProviders] = useState<SyncProvider[]>([])
  const [files, setFiles] = useState<SyncedFile[]>([])
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeProvider, setActiveProvider] = useState<string | undefined>(undefined)
  const [showActivity, setShowActivity] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (activeProvider) params.set('provider', activeProvider)
      if (searchQuery) params.set('search', searchQuery)

      const [providersRes, filesRes, statusRes, activityRes] = await Promise.all([
        fetch(`${apiBase}/providers`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/files?${params}`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/status`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/activity?limit=20`).then(r => r.ok ? r.json() : null),
      ])

      if (providersRes?.data?.providers) {
        setProviders(providersRes.data.providers)
      } else if (providersRes?.data) {
        setProviders(Array.isArray(providersRes.data) ? providersRes.data : [])
      }
      if (filesRes?.data?.files) {
        setFiles(filesRes.data.files)
      } else if (filesRes?.data) {
        setFiles(Array.isArray(filesRes.data) ? filesRes.data : [])
      }
      if (statusRes?.data) {
        setSyncStatus(statusRes.data)
      }
      if (activityRes?.data?.entries) {
        setActivity(activityRes.data.entries)
      } else if (activityRes?.data) {
        setActivity(Array.isArray(activityRes.data) ? activityRes.data : [])
      }
    } catch (e) {
      console.error('File sync fetch error:', e)
    }
    setLoading(false)
  }, [apiBase, activeProvider, searchQuery])

  useEffect(() => { fetchData() }, [fetchData])

  const handleConnect = async (provider: string) => {
    try {
      const resp = await fetch(`${apiBase}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      })
      if (resp.ok) fetchData()
    } catch (e) {
      console.error('Connect provider error:', e)
    }
  }

  const handleDisconnect = async (provider: string) => {
    try {
      const resp = await fetch(`${apiBase}/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      })
      if (resp.ok) fetchData()
    } catch (e) {
      console.error('Disconnect provider error:', e)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const body: Record<string, string> = {}
      if (activeProvider) body.provider = activeProvider
      await fetch(`${apiBase}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      // Brief delay then refresh
      setTimeout(() => { fetchData(); setSyncing(false) }, 1500)
    } catch (e) {
      console.error('Sync error:', e)
      setSyncing(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading file sync...
      </div>
    )
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Cloud Drive</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowActivity(!showActivity)}
            style={{
              padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)',
              background: showActivity ? 'var(--bg-elevated)' : 'transparent',
              color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem',
            }}
          >
            Activity
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            style={{
              padding: '6px 14px', borderRadius: 6, border: 'none',
              background: 'var(--accent)', color: '#fff', cursor: syncing ? 'default' : 'pointer',
              fontSize: '0.8rem', fontWeight: 600, opacity: syncing ? 0.6 : 1,
            }}
          >
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      </div>

      {/* Provider Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: '1.5rem' }}>
        {Object.keys(PROVIDER_LABELS).map(providerKey => {
          const prov = providers.find(p => p.provider === providerKey)
          const connected = prov?.connected ?? false
          const isActive = activeProvider === providerKey
          return (
            <div
              key={providerKey}
              onClick={() => setActiveProvider(isActive ? undefined : providerKey)}
              style={{
                padding: '14px 16px', borderRadius: 8,
                background: isActive ? 'rgba(124,58,237,0.1)' : 'var(--bg-elevated)',
                border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
                cursor: 'pointer', transition: 'border-color 0.15s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 28, height: 28, borderRadius: 6, fontSize: '0.7rem', fontWeight: 700,
                    background: connected ? 'rgba(0,200,83,0.15)' : 'rgba(255,255,255,0.05)',
                    color: connected ? '#00c853' : 'var(--text-muted)',
                  }}>
                    {PROVIDER_ICONS[providerKey]}
                  </span>
                  <span style={{ fontWeight: 500, fontSize: '0.85rem' }}>
                    {PROVIDER_LABELS[providerKey]}
                  </span>
                </div>
                <span style={{
                  fontSize: '0.65rem', padding: '2px 6px', borderRadius: 4,
                  background: connected ? 'rgba(0,200,83,0.15)' : 'rgba(255,255,255,0.05)',
                  color: connected ? '#00c853' : 'var(--text-muted)',
                }}>
                  {connected ? 'Connected' : 'Not connected'}
                </span>
              </div>
              {prov?.last_sync && (
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                  Last sync: {formatRelativeTime(prov.last_sync)}
                </div>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  connected ? handleDisconnect(providerKey) : handleConnect(providerKey)
                }}
                style={{
                  width: '100%', padding: '5px 0', borderRadius: 4, fontSize: '0.75rem',
                  border: connected ? '1px solid var(--border)' : 'none',
                  background: connected ? 'transparent' : 'var(--accent)',
                  color: connected ? 'var(--text-muted)' : '#fff',
                  cursor: 'pointer',
                }}
              >
                {connected ? 'Disconnect' : 'Connect'}
              </button>
            </div>
          )
        })}
      </div>

      {/* Sync Status Bar */}
      {syncStatus && (
        <div style={{
          padding: '8px 14px', borderRadius: 6, background: 'var(--bg-elevated)',
          marginBottom: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)',
          display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <span>{syncStatus.files_synced} files synced</span>
          <span>{formatBytes(syncStatus.bytes_synced)}</span>
          {syncStatus.last_sync && <span>Last: {formatRelativeTime(syncStatus.last_sync)}</span>}
          {syncStatus.errors > 0 && (
            <span style={{ color: '#ff5252' }}>{syncStatus.errors} errors</span>
          )}
        </div>
      )}

      {/* Search Bar */}
      <div style={{ marginBottom: '1rem' }}>
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search files..."
          style={{
            width: '100%', padding: '8px 12px', borderRadius: 6,
            border: '1px solid var(--border)', background: 'var(--bg-deep)',
            color: 'var(--text)', fontSize: '0.85rem', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Activity Log */}
      {showActivity && (
        <div style={{
          padding: '1rem', borderRadius: 8, background: 'var(--bg-elevated)',
          border: '1px solid var(--border)', marginBottom: '1rem',
        }}>
          <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 10 }}>Recent Activity</div>
          {activity.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No recent activity.</div>
          )}
          {activity.map((entry, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '6px 0', borderBottom: i < activity.length - 1 ? '1px solid var(--border)' : 'none',
              fontSize: '0.75rem',
            }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{
                  padding: '1px 5px', borderRadius: 3, fontSize: '0.65rem', fontWeight: 600,
                  background: entry.status === 'success' ? 'rgba(0,200,83,0.15)' : 'rgba(255,82,82,0.15)',
                  color: entry.status === 'success' ? '#00c853' : '#ff5252',
                }}>
                  {entry.action}
                </span>
                <span style={{ color: 'var(--text)' }}>{entry.file_name || entry.details}</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {PROVIDER_ICONS[entry.provider] || entry.provider}
                </span>
              </div>
              <span style={{ color: 'var(--text-muted)' }}>
                {formatRelativeTime(entry.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* File Browser */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {files.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
            {providers.some(p => p.connected)
              ? 'No files found. Try syncing or adjusting your search.'
              : 'Connect a cloud provider above to start syncing files.'
            }
          </div>
        )}
        {files.map(file => (
          <div
            key={file.file_id}
            style={{
              padding: '10px 14px', borderRadius: 8, background: 'var(--bg-elevated)',
              border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file.name}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', gap: 8, marginTop: 2 }}>
                <span>{file.folder}</span>
                <span>{formatBytes(file.size)}</span>
                <span>{formatRelativeTime(file.last_modified)}</span>
              </div>
            </div>
            <span style={{
              padding: '2px 6px', borderRadius: 4, fontSize: '0.65rem', fontWeight: 600,
              background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)',
            }}>
              {PROVIDER_ICONS[file.provider] || file.provider}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
