'use client'

import React, { useCallback, useEffect, useState } from 'react'

export interface ProtonDrivePanelProps {
  apiBase?: string
  className?: string
}

interface DriveFile {
  path: string
  size_bytes: number
  modified_at?: string
  encrypted: boolean
}

export default function ProtonDrivePanel({
  apiBase = '/api/file-sync',
  className = '',
}: ProtonDrivePanelProps) {
  const [files, setFiles] = useState<DriveFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentFolder, setCurrentFolder] = useState('/')
  const [syncing, setSyncing] = useState(false)

  const fetchFiles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `${apiBase}/files?provider_id=proton_drive&folder=${encodeURIComponent(currentFolder)}`
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setFiles(data.data?.files ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load files')
    } finally {
      setLoading(false)
    }
  }, [apiBase, currentFolder])

  useEffect(() => {
    fetchFiles()
  }, [fetchFiles])

  const handleSync = async () => {
    setSyncing(true)
    try {
      await fetch(`${apiBase}/providers/proton_drive/sync`, { method: 'POST' })
      await fetchFiles()
    } finally {
      setSyncing(false)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
  }

  const navigateTo = (folder: string) => {
    setCurrentFolder(folder.endsWith('/') ? folder : folder + '/')
  }

  const goUp = () => {
    const parts = currentFolder.split('/').filter(Boolean)
    parts.pop()
    setCurrentFolder(parts.length ? '/' + parts.join('/') + '/' : '/')
  }

  // Group files into folders and files
  const folders = new Set<string>()
  const directFiles: DriveFile[] = []
  const prefix = currentFolder === '/' ? '' : currentFolder.replace(/^\//, '')

  for (const f of files) {
    const rel = f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path
    const slashIdx = rel.indexOf('/')
    if (slashIdx >= 0) {
      folders.add(prefix + rel.slice(0, slashIdx + 1))
    } else {
      directFiles.push(f)
    }
  }

  return (
    <div className={`proton-drive-panel ${className}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0 }}>Proton Drive</h3>
          <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>
            {currentFolder}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {currentFolder !== '/' && (
            <button onClick={goUp} style={btnStyle}>
              &larr; Up
            </button>
          )}
          <button onClick={handleSync} disabled={syncing} style={btnStyle}>
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ color: '#ef4444', padding: 8, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', opacity: 0.5 }}>Loading...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[...folders].sort().map(folder => (
            <div
              key={folder}
              onClick={() => navigateTo(folder)}
              style={rowStyle}
              role="button"
              tabIndex={0}
            >
              <span style={{ marginRight: 8 }}>📁</span>
              <span style={{ flex: 1 }}>{folder.split('/').filter(Boolean).pop()}/</span>
            </div>
          ))}

          {directFiles.map(file => (
            <div key={file.path} style={rowStyle}>
              <span style={{ marginRight: 8 }}>
                {file.encrypted ? '🔒' : '📄'}
              </span>
              <span style={{ flex: 1 }}>
                {file.path.split('/').pop()}
              </span>
              <span style={{ fontSize: 12, opacity: 0.6, marginRight: 12 }}>
                {formatSize(file.size_bytes)}
              </span>
              {file.modified_at && (
                <span style={{ fontSize: 12, opacity: 0.6 }}>
                  {new Date(file.modified_at).toLocaleDateString()}
                </span>
              )}
            </div>
          ))}

          {folders.size === 0 && directFiles.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', opacity: 0.5 }}>
              No files found
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 6,
  border: '1px solid var(--border, #333)',
  background: 'var(--card, #1a1a2e)',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 13,
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '8px 12px',
  borderRadius: 6,
  cursor: 'pointer',
  transition: 'background 0.15s',
}
