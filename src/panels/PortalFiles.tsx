'use client'

import { useState, useEffect, useCallback } from 'react'
import { useConfig } from '../hooks/useConfig'

interface PortalFile {
  name: string
  path?: string
  type: 'file' | 'dir'
  size: number
  modified?: number
}

interface FileContent {
  path: string
  data: string
  size: number
}

export default function PortalFiles() {
  // Shared across tenants — the error copy must name the caller's app, not a tenant.
  const config = useConfig()
  const [files, setFiles] = useState<PortalFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentPath, setCurrentPath] = useState('')
  const [viewing, setViewing] = useState<{ path: string; content: string; loading: boolean } | null>(null)

  const fetchFiles = useCallback(async (subpath: string = '') => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (subpath) params.set('subpath', subpath)
      const r = await fetch(`/api/platform/files/list?${params}`)
      const data = await r.json()
      if (data.error) {
        setError(data.error)
        setFiles([])
      } else {
        setFiles(data.files || [])
      }
    } catch {
      setError('Failed to connect to platform')
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchFiles(currentPath) }, [currentPath, fetchFiles])

  const navigateTo = (name: string) => {
    setCurrentPath(prev => prev ? `${prev}/${name}` : name)
  }

  const navigateUp = () => {
    setCurrentPath(prev => {
      const parts = prev.split('/')
      parts.pop()
      return parts.join('/')
    })
  }

  const viewFile = async (filePath: string) => {
    const fullPath = currentPath ? `${currentPath}/${filePath}` : filePath
    setViewing({ path: fullPath, content: '', loading: true })
    try {
      const r = await fetch(`/api/platform/files/${encodeURIComponent(fullPath)}/content`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data: FileContent = await r.json()
      setViewing({ path: fullPath, content: data.data || '(empty)', loading: false })
    } catch (e: any) {
      setViewing({ path: fullPath, content: `Error: ${e.message}`, loading: false })
    }
  }

  const downloadFile = (filePath: string) => {
    const fullPath = currentPath ? `${currentPath}/${filePath}` : filePath
    window.open(`/api/platform/files/${encodeURIComponent(fullPath)}/download`, '_blank')
  }

  const formatSize = (bytes: number) => {
    if (!bytes) return '-'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const getFileIcon = (name: string, type: string) => {
    if (type === 'dir') return '\u{1F4C1}'
    const ext = name.split('.').pop()?.toLowerCase() || ''
    const icons: Record<string, string> = {
      pdf: '\u{1F4C4}', doc: '\u{1F4DD}', docx: '\u{1F4DD}', txt: '\u{1F4C3}',
      md: '\u{1F4C3}', csv: '\u{1F4CA}', xlsx: '\u{1F4CA}', xls: '\u{1F4CA}',
      json: '\u{2699}', yaml: '\u{2699}', yml: '\u{2699}', py: '\u{1F40D}',
      ts: '\u{1F4DC}', tsx: '\u{1F4DC}', js: '\u{1F4DC}', jsx: '\u{1F4DC}',
    }
    return icons[ext] || '\u{1F4C4}'
  }

  const breadcrumbs = currentPath ? currentPath.split('/') : []

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: 0 }}>Portal Files</h3>
        <button onClick={() => fetchFiles(currentPath)} style={{
          padding: '0.35rem 0.75rem', background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
          borderRadius: 'var(--radius)', fontSize: '0.75rem', border: '1px solid var(--glass-border)',
        }}>
          Refresh
        </button>
      </div>

      {/* Breadcrumbs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginBottom: '0.75rem',
        fontSize: '0.75rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        <button onClick={() => setCurrentPath('')} style={{
          background: 'transparent', color: currentPath ? 'var(--accent-cyan)' : 'var(--text-primary)',
          fontSize: '0.75rem', padding: '0.15rem 0.3rem', borderRadius: 3,
        }}>
          workspace
        </button>
        {breadcrumbs.map((part, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <span style={{ color: 'var(--text-muted)', opacity: 0.4 }}>/</span>
            <button onClick={() => setCurrentPath(breadcrumbs.slice(0, i + 1).join('/'))} style={{
              background: 'transparent', fontSize: '0.75rem', padding: '0.15rem 0.3rem', borderRadius: 3,
              color: i === breadcrumbs.length - 1 ? 'var(--text-primary)' : 'var(--accent-cyan)',
            }}>
              {part}
            </button>
          </span>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Loading files...
        </div>
      ) : error ? (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          <p style={{ marginBottom: '0.5rem' }}>Could not load portal files</p>
          <p style={{ fontSize: '0.75rem', opacity: 0.7 }}>{error}</p>
          <p style={{ fontSize: '0.7rem', opacity: 0.5, marginTop: '0.5rem' }}>
            {config.app_name}&apos;s workspace may not be set up yet — an administrator can initialize it.
          </p>
        </div>
      ) : files.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {currentPath ? (
            <>
              <p>Empty directory</p>
              <button onClick={navigateUp} style={{
                marginTop: '0.5rem', padding: '0.35rem 0.75rem', background: 'var(--bg-elevated)',
                color: 'var(--accent-cyan)', borderRadius: 'var(--radius)', fontSize: '0.75rem',
                border: '1px solid var(--glass-border)',
              }}>Go back</button>
            </>
          ) : (
            <>
              <p>No files in portal workspace yet</p>
              <p style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '0.3rem' }}>
                Upload a file here, or sync your documents from the platform.
              </p>
            </>
          )}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          {currentPath && (
            <div onClick={navigateUp} style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem',
              borderBottom: '1px solid var(--glass-border)', cursor: 'pointer',
              fontSize: '0.82rem', color: 'var(--text-muted)',
            }}>
              <span style={{ fontSize: '0.9rem' }}>..</span>
              <span>Parent directory</span>
            </div>
          )}
          {files
            .sort((a, b) => {
              if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
              return a.name.localeCompare(b.name)
            })
            .map((f, i) => (
              <div key={f.path || f.name} style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem',
                padding: '0.5rem 0.75rem', cursor: 'pointer',
                borderBottom: i < files.length - 1 ? '1px solid var(--glass-border)' : 'none',
                transition: 'background 0.1s',
              }}
                onClick={() => f.type === 'dir' ? navigateTo(f.name) : viewFile(f.name)}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ fontSize: '0.9rem', width: 20, textAlign: 'center', flexShrink: 0 }}>
                  {getFileIcon(f.name, f.type)}
                </span>
                <span style={{ flex: 1, fontSize: '0.82rem', minWidth: 0, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: f.type === 'dir' ? 'var(--accent-cyan)' : 'var(--text-primary)' }}>
                  {f.name}
                </span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                  {f.type === 'file' ? formatSize(f.size) : ''}
                </span>
                {f.type === 'file' && (
                  <button onClick={(e) => { e.stopPropagation(); downloadFile(f.name) }} style={{
                    padding: '0.2rem 0.4rem', background: 'transparent', color: 'var(--accent-cyan)',
                    fontSize: '0.65rem', borderRadius: 3, border: '1px solid var(--glass-border)',
                    flexShrink: 0,
                  }}>
                    DL
                  </button>
                )}
              </div>
            ))}
        </div>
      )}

      {/* File viewer modal */}
      {viewing && (
        <>
          <div onClick={() => setViewing(null)} style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            zIndex: 999, backdropFilter: 'blur(2px)',
          }} />
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0,
            width: 'min(55vw, 750px)', background: 'var(--bg-deep)',
            borderLeft: '1px solid var(--glass-border)', zIndex: 1000,
            display: 'flex', flexDirection: 'column',
            animation: 'portalSlideIn 0.2s ease-out',
          }}>
            <div style={{
              padding: '1rem 1.25rem', borderBottom: '1px solid var(--glass-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0, wordBreak: 'break-all' }}>
                  {viewing.path}
                </h4>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  Portal workspace file
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                <button onClick={() => downloadFile(viewing.path)} style={{
                  padding: '0.35rem 0.65rem', background: 'var(--accent-primary)',
                  color: '#fff', borderRadius: 'var(--radius)', fontSize: '0.7rem', fontWeight: 600,
                }}>
                  Download
                </button>
                <button onClick={() => setViewing(null)} style={{
                  padding: '0.35rem 0.5rem', background: 'var(--bg-elevated)',
                  color: 'var(--text-muted)', borderRadius: 'var(--radius)', fontSize: '1rem', lineHeight: 1,
                }}>
                  &times;
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '1.25rem' }}>
              {viewing.loading ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Loading file content...
                </div>
              ) : (
                <pre style={{
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
                  fontSize: '0.8rem', lineHeight: 1.65, color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono, "JetBrains Mono", "Fira Code", monospace)',
                }}>
                  {viewing.content}
                </pre>
              )}
            </div>
          </div>
          <style>{`
            @keyframes portalSlideIn {
              from { transform: translateX(100%); }
              to { transform: translateX(0); }
            }
          `}</style>
        </>
      )}
    </div>
  )
}
