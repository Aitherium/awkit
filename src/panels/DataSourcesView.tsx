'use client'

import { useState, useEffect, useCallback } from 'react'
import ArchiveUploadZone from './ArchiveUploadZone'

export interface DataSourcesViewProps {
  apiBase?: string
}

interface DataSource {
  id: string
  tenant_id: string
  name: string
  connector_type: string
  connection_config?: Record<string, string>
  sync_schedule: string
  target_collection: string
  file_patterns: string[]
  auto_extract: boolean
  enabled: boolean
  last_sync_at?: string
  last_sync_status: string
  documents_synced: number
  created_at: string
}

const CONNECTOR_TYPES = [
  { value: 'smb', label: 'File Server (SMB)', icon: 'SM' },
  { value: 's3', label: 'Amazon S3 / MinIO', icon: 'S3' },
  { value: 'git', label: 'Git Repository', icon: 'GT' },
  { value: 'webhook', label: 'Webhook Push', icon: 'WH' },
  { value: 'local_filesystem', label: 'Local Filesystem', icon: 'FS' },
  { value: 'obsidian_vault', label: 'Obsidian Vault', icon: 'OB' },
  { value: 'webdav', label: 'WebDAV', icon: 'WD' },
  { value: 'sftp', label: 'SFTP', icon: 'SF' },
  { value: 'proton_drive', label: 'Proton Drive', icon: 'PD' },
  { value: 'google_drive', label: 'Google Drive', icon: 'GD' },
  { value: 'onedrive', label: 'OneDrive', icon: 'OD' },
  { value: 'dropbox', label: 'Dropbox', icon: 'DB' },
  { value: 'confluence', label: 'Confluence', icon: 'CF' },
  { value: 'google_docs', label: 'Google Docs', icon: 'GC' },
  { value: 'adk_sync', label: 'ADK Sync (AitherDrive)', icon: 'AD' },
]

const CONNECTOR_FIELDS: Record<string, { key: string; label: string; type?: string }[]> = {
  s3: [
    { key: 'bucket', label: 'Bucket' },
    { key: 'prefix', label: 'Prefix' },
    { key: 'endpoint_url', label: 'Endpoint URL' },
    { key: 'region', label: 'Region' },
  ],
  smb: [
    { key: 'server', label: 'Server' },
    { key: 'share', label: 'Share Name' },
    { key: 'path', label: 'Path' },
  ],
  git: [
    { key: 'repo_url', label: 'Repository URL' },
    { key: 'branch', label: 'Branch' },
    { key: 'path', label: 'Subdirectory' },
  ],
  webdav: [
    { key: 'url', label: 'WebDAV URL' },
    { key: 'username', label: 'Username' },
    { key: 'base_path', label: 'Base Path' },
  ],
  sftp: [
    { key: 'host', label: 'Host' },
    { key: 'port', label: 'Port', type: 'number' },
    { key: 'username', label: 'Username' },
    { key: 'base_path', label: 'Base Path' },
  ],
  proton_drive: [
    { key: 'bridge_host', label: 'Bridge Host' },
    { key: 'bridge_port', label: 'Bridge Port', type: 'number' },
    { key: 'username', label: 'Proton Email' },
    { key: 'folder', label: 'Folder' },
  ],
  webhook: [{ key: 'secret', label: 'Webhook Secret' }],
  local_filesystem: [{ key: 'path', label: 'Directory Path' }],
  obsidian_vault: [{ key: 'vault_path', label: 'Vault Path' }],
  google_drive: [{ key: 'folder_id', label: 'Folder ID' }],
  onedrive: [{ key: 'folder_path', label: 'Folder Path' }],
  dropbox: [{ key: 'folder_path', label: 'Folder Path' }],
  confluence: [{ key: 'base_url', label: 'Base URL' }, { key: 'space_key', label: 'Space Key' }],
  google_docs: [{ key: 'folder_id', label: 'Folder ID' }],
  adk_sync: [
    { key: 'node_id', label: 'Node ID' },
    { key: 'hostname', label: 'Hostname' },
    { key: 'sync_root', label: 'Sync Root Path' },
  ],
}

function formatRelativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  } catch { return iso }
}

export default function DataSourcesView({ apiBase = '/api/data-plane' }: DataSourcesViewProps) {
  const [sources, setSources] = useState<DataSource[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newType, setNewType] = useState('')
  const [newName, setNewName] = useState('')
  const [newConfig, setNewConfig] = useState<Record<string, string>>({})
  const [newCredential, setNewCredential] = useState('')
  const [syncing, setSyncing] = useState<string | null>(null)
  const [nodeConfigOpen, setNodeConfigOpen] = useState<string | null>(null)
  const [nodeConfig, setNodeConfig] = useState<Record<string, string>>({})
  const [nodeConfigLoading, setNodeConfigLoading] = useState(false)

  const loadNodeConfig = useCallback(async (nodeId: string) => {
    setNodeConfigLoading(true)
    try {
      const resp = await fetch(`${apiBase}/nodes/${nodeId}/config`)
      if (resp.ok) {
        const data = await resp.json()
        setNodeConfig(data.config || data.content ? JSON.parse(data.content || '{}') : data)
      }
    } catch (e) { console.error('Load node config error:', e) }
    setNodeConfigLoading(false)
  }, [apiBase])

  const saveNodeConfig = useCallback(async (nodeId: string) => {
    try {
      await fetch(`${apiBase}/nodes/${nodeId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nodeConfig),
      })
      setNodeConfigOpen(null)
    } catch (e) { console.error('Save node config error:', e) }
  }, [apiBase, nodeConfig])

  const fetchSources = useCallback(async () => {
    try {
      const resp = await fetch(`${apiBase}/sources`)
      if (resp.ok) {
        const data = await resp.json()
        setSources(Array.isArray(data) ? data : data.sources || [])
      }
    } catch (e) {
      console.error('Fetch sources error:', e)
    }
    setLoading(false)
  }, [apiBase])

  useEffect(() => { fetchSources() }, [fetchSources])

  const handleCreate = async () => {
    if (!newName || !newType) return
    try {
      const body: Record<string, unknown> = {
        name: newName,
        connector_type: newType,
        connection_config: { ...newConfig },
      }
      if (newCredential) {
        body.credential_key = `connector_${newName.toLowerCase().replace(/\s+/g, '_')}`
        ;(body.connection_config as Record<string, string>)._credential_value = newCredential
      }
      const resp = await fetch(`${apiBase}/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (resp.ok) {
        setShowAdd(false)
        setNewName('')
        setNewType('')
        setNewConfig({})
        setNewCredential('')
        fetchSources()
      }
    } catch (e) {
      console.error('Create source error:', e)
    }
  }

  const handleSync = async (sourceId: string) => {
    setSyncing(sourceId)
    try {
      await fetch(`${apiBase}/sources/${sourceId}/sync`, { method: 'POST' })
      setTimeout(() => { fetchSources(); setSyncing(null) }, 2000)
    } catch {
      setSyncing(null)
    }
  }

  const handleDelete = async (sourceId: string) => {
    try {
      await fetch(`${apiBase}/sources/${sourceId}`, { method: 'DELETE' })
      fetchSources()
    } catch (e) {
      console.error('Delete source error:', e)
    }
  }

  const fields = CONNECTOR_FIELDS[newType] || []

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading sources...</div>
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {sources.length} data source{sources.length !== 1 ? 's' : ''} registered
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          style={{
            padding: '6px 14px', borderRadius: 6, border: 'none',
            background: 'var(--accent, #7c3aed)', color: '#fff',
            cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
          }}
        >
          {showAdd ? 'Cancel' : '+ Add Source'}
        </button>
      </div>

      {/* Add Source Form */}
      {showAdd && (
        <div style={{
          padding: '1rem', borderRadius: 8, background: 'var(--bg-elevated)',
          border: '1px solid var(--border)', marginBottom: '1rem',
        }}>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Name</label>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="My Data Source"
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Type</label>
            <select
              value={newType}
              onChange={e => { setNewType(e.target.value); setNewConfig({}) }}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="">Select connector type...</option>
              {CONNECTOR_TYPES.map(ct => (
                <option key={ct.value} value={ct.value}>{ct.label}</option>
              ))}
            </select>
          </div>
          {fields.map(f => (
            <div key={f.key} style={{ marginBottom: 10 }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{f.label}</label>
              <input
                type={f.type || 'text'}
                value={newConfig[f.key] || ''}
                onChange={e => setNewConfig(c => ({ ...c, [f.key]: e.target.value }))}
                style={inputStyle}
              />
            </div>
          ))}
          {newType && (
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                Password / Credential (optional)
              </label>
              <input
                type="password"
                value={newCredential}
                onChange={e => setNewCredential(e.target.value)}
                style={inputStyle}
              />
            </div>
          )}
          <button onClick={handleCreate} disabled={!newName || !newType} style={{
            padding: '6px 16px', borderRadius: 6, border: 'none',
            background: newName && newType ? 'var(--accent, #7c3aed)' : 'var(--bg-deep)',
            color: '#fff', cursor: newName && newType ? 'pointer' : 'default',
            fontSize: '0.8rem', fontWeight: 600,
          }}>
            Create Source
          </button>
        </div>
      )}

      {/* Source List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sources.map(s => {
          const ct = CONNECTOR_TYPES.find(c => c.value === s.connector_type)
          return (
            <div key={s.id} style={{
              padding: '12px 16px', borderRadius: 8, background: 'var(--bg-elevated)',
              border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 26, height: 26, borderRadius: 5, fontSize: '0.65rem', fontWeight: 700,
                    background: s.enabled ? 'rgba(0,200,83,0.12)' : 'rgba(255,255,255,0.05)',
                    color: s.enabled ? '#00c853' : 'var(--text-muted)',
                  }}>
                    {ct?.icon || '??'}
                  </span>
                  <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>{s.name}</span>
                  <span style={{
                    fontSize: '0.6rem', padding: '1px 5px', borderRadius: 3,
                    background: s.last_sync_status === 'ok' ? 'rgba(0,200,83,0.12)' :
                      s.last_sync_status === 'failed' ? 'rgba(255,82,82,0.12)' : 'rgba(255,255,255,0.05)',
                    color: s.last_sync_status === 'ok' ? '#00c853' :
                      s.last_sync_status === 'failed' ? '#ff5252' : 'var(--text-muted)',
                  }}>
                    {s.last_sync_status}
                  </span>
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <span>{ct?.label || s.connector_type}</span>
                  {s.connector_type === 'adk_sync' && s.connection_config?.hostname && (
                    <span>{s.connection_config.hostname}:{s.connection_config.sync_root || '/'}</span>
                  )}
                  <span>{s.documents_synced} docs</span>
                  {s.last_sync_at && <span>Last sync: {formatRelativeTime(s.last_sync_at)}</span>}
                  <span>Schedule: {s.sync_schedule}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {s.connector_type === 'adk_sync' && (
                  <button
                    onClick={() => {
                      const nodeId = s.connection_config?.node_id
                      if (nodeId) {
                        setNodeConfigOpen(nodeId)
                        loadNodeConfig(nodeId)
                      }
                    }}
                    style={smallBtnStyle}
                  >
                    Configure
                  </button>
                )}
                <button
                  onClick={() => handleSync(s.id)}
                  disabled={syncing === s.id}
                  style={smallBtnStyle}
                >
                  {syncing === s.id ? 'Syncing...' : 'Sync'}
                </button>
                <button
                  onClick={() => handleDelete(s.id)}
                  style={{ ...smallBtnStyle, color: '#ff5252' }}
                >
                  Delete
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* ADK Sync Node Config Editor */}
      {nodeConfigOpen && (
        <div style={{
          padding: '1rem', borderRadius: 8, background: 'var(--bg-elevated)',
          border: '1px solid var(--accent, #7c3aed)', marginTop: 8, marginBottom: 8,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Node Config: {nodeConfigOpen}</span>
            <button onClick={() => setNodeConfigOpen(null)} style={{ ...smallBtnStyle, fontSize: '0.7rem' }}>Close</button>
          </div>
          {nodeConfigLoading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Loading...</div>
          ) : (
            <>
              {['conflict_strategy', 'max_file_size', 'settings_sync'].map(key => (
                <div key={key} style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>
                    {key.replace(/_/g, ' ')}
                  </label>
                  <input
                    value={nodeConfig[key] || ''}
                    onChange={e => setNodeConfig(c => ({ ...c, [key]: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
              ))}
              <button
                onClick={() => saveNodeConfig(nodeConfigOpen)}
                style={{
                  padding: '5px 14px', borderRadius: 6, border: 'none',
                  background: 'var(--accent, #7c3aed)', color: '#fff',
                  cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
                }}
              >
                Save Config
              </button>
            </>
          )}
        </div>
      )}

      {sources.length === 0 && !showAdd && (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          No data sources configured. Click "Add Source" to connect your first data source.
        </div>
      )}

      {/* Archive Upload */}
      <div style={{ marginTop: '1.5rem' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8 }}>Batch Upload</div>
        <ArchiveUploadZone apiBase={apiBase} onComplete={() => fetchSources()} />
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', borderRadius: 6,
  border: '1px solid var(--border, #333)', background: 'var(--bg-deep, #111)',
  color: 'var(--text, #fff)', fontSize: '0.85rem', boxSizing: 'border-box',
}

const smallBtnStyle: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border, #333)',
  background: 'transparent', color: 'var(--text-muted, #888)', cursor: 'pointer',
  fontSize: '0.7rem',
}
