'use client'

import { useState, useCallback, useRef } from 'react'

export interface ArchiveUploadZoneProps {
  apiBase?: string
  collection?: string
  onComplete?: (result: ArchiveUploadResult) => void
}

export interface ArchiveUploadResult {
  job_id: string
  filename: string
  size: number
  target_collection: string
  status: string
}

export default function ArchiveUploadZone({
  apiBase = '/api/data-plane',
  collection = '',
  onComplete,
}: ArchiveUploadZoneProps) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ArchiveUploadResult | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const ACCEPT = '.zip,.tar,.tar.gz,.tgz'

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true)
    setProgress(10)
    setError('')
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      if (collection) formData.append('collection', collection)

      setProgress(30)
      const resp = await fetch(`${apiBase}/upload/archive`, {
        method: 'POST',
        body: formData,
      })

      setProgress(90)
      if (!resp.ok) {
        const text = await resp.text()
        throw new Error(text || `Upload failed (${resp.status})`)
      }

      const data = await resp.json()
      setResult(data)
      setProgress(100)
      onComplete?.(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [apiBase, collection, onComplete])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleUpload(file)
  }, [handleUpload])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleUpload(file)
  }, [handleUpload])

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      style={{
        padding: '2rem',
        borderRadius: 12,
        border: `2px dashed ${dragging ? 'var(--accent, #7c3aed)' : 'var(--border, #333)'}`,
        background: dragging ? 'rgba(124,58,237,0.05)' : 'var(--bg-elevated, #1a1a1a)',
        textAlign: 'center',
        cursor: uploading ? 'default' : 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />

      {uploading ? (
        <div>
          <div style={{ fontSize: '0.85rem', marginBottom: 8, color: 'var(--text, #fff)' }}>
            Uploading...
          </div>
          <div style={{
            width: '100%', height: 6, borderRadius: 3,
            background: 'var(--bg-deep, #111)', overflow: 'hidden',
          }}>
            <div style={{
              width: `${progress}%`, height: '100%', borderRadius: 3,
              background: 'var(--accent, #7c3aed)', transition: 'width 0.3s',
            }} />
          </div>
        </div>
      ) : result ? (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #888)' }}>
          <div style={{ color: '#00c853', fontWeight: 600, marginBottom: 4 }}>Upload complete</div>
          <div>{result.filename} ({formatBytes(result.size)})</div>
          <div>Collection: {result.target_collection}</div>
          <button
            onClick={(e) => { e.stopPropagation(); setResult(null) }}
            style={{
              marginTop: 8, padding: '4px 12px', borderRadius: 4,
              border: '1px solid var(--border, #333)', background: 'transparent',
              color: 'var(--text-muted, #888)', cursor: 'pointer', fontSize: '0.75rem',
            }}
          >
            Upload another
          </button>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: '1.5rem', marginBottom: 6, color: 'var(--text-muted, #888)' }}>
            +
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text, #fff)', marginBottom: 4 }}>
            Drop archive here or click to browse
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)' }}>
            Supports ZIP, TAR, TAR.GZ (max 200MB)
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 8, fontSize: '0.75rem', color: '#ff5252' }}>
          {error}
        </div>
      )}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}
