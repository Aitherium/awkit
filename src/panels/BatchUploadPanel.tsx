'use client'

import { useState, useRef, useCallback } from 'react'

interface FileProgress {
  filename: string
  status: string
  chunks: number
  error?: string
}

interface BatchJob {
  job_id: string
  status: string
  total_files: number
  processed_files: number
  total_chunks: number
  files: FileProgress[]
}

export interface BatchUploadPanelProps {
  apiBase?: string
  onComplete?: () => void
}

export default function BatchUploadPanel({ apiBase = '/api/documents', onComplete }: BatchUploadPanelProps) {
  const [files, setFiles] = useState<File[]>([])
  const [job, setJob] = useState<BatchJob | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    setFiles(prev => [...prev, ...Array.from(newFiles)])
  }, [])

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx))
  }

  const startUpload = async () => {
    if (files.length === 0) return
    setUploading(true)

    const form = new FormData()
    files.forEach(f => form.append('files', f))
    form.append('doc_type', 'other')
    form.append('auto_extract', 'true')

    try {
      const resp = await fetch(`${apiBase}/batch`, { method: 'POST', body: form })
      if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`)
      const data = await resp.json()

      // Poll for progress
      pollJob(data.job_id)
    } catch (err: any) {
      setJob({ job_id: '', status: 'failed', total_files: files.length, processed_files: 0, total_chunks: 0, files: [] })
      setUploading(false)
    }
  }

  const pollJob = async (jobId: string) => {
    const poll = async () => {
      try {
        const resp = await fetch(`${apiBase}/batch/${jobId}`)
        if (!resp.ok) return
        const data: BatchJob = await resp.json()
        setJob(data)
        if (data.status === 'completed' || data.status === 'failed') {
          setUploading(false)
          setFiles([])
          onComplete?.()
          return
        }
      } catch { /* continue polling */ }
      setTimeout(poll, 1000)
    }
    poll()
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
  }, [addFiles])

  const statusColor = (status: string) => {
    switch (status) {
      case 'done': return 'var(--accent-green)'
      case 'error': return 'var(--accent-coral)'
      case 'pending': return 'var(--text-muted)'
      default: return 'var(--accent-cyan)'
    }
  }

  return (
    <div>
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? 'var(--accent-primary)' : 'var(--glass-border)'}`,
          borderRadius: 'var(--radius)',
          padding: '2rem',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragOver ? 'var(--bg-surface)' : 'transparent',
          transition: 'all 0.2s',
          marginBottom: '1rem',
        }}
      >
        <p style={{ color: dragOver ? 'var(--accent-primary)' : 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 500 }}>
          Drop files here or click to browse
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.3rem' }}>
          PDF, DOCX, TXT, XLSX, MD, CSV, ZIP — upload multiple at once
        </p>
      </div>
      <input ref={fileRef} type="file" hidden multiple
        accept=".pdf,.docx,.doc,.txt,.xlsx,.xls,.md,.csv,.zip,.png,.jpg,.jpeg,.webp"
        onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />

      {/* File list (before upload) */}
      {files.length > 0 && !job && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {files.length} file{files.length > 1 ? 's' : ''} selected
            </span>
            <button onClick={startUpload} disabled={uploading} style={{
              padding: '0.5rem 1.25rem', background: 'var(--accent-primary)', color: 'var(--bg-deep)',
              borderRadius: 'var(--radius)', fontWeight: 600, fontSize: '0.85rem',
              opacity: uploading ? 0.5 : 1,
            }}>
              {uploading ? 'Processing...' : 'Upload All'}
            </button>
          </div>
          {files.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.4rem 0.6rem', background: 'var(--bg-surface)', borderRadius: 6,
              marginBottom: '0.25rem', fontSize: '0.8rem' }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.name}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', flexShrink: 0 }}>
                {(f.size / 1024).toFixed(0)} KB
              </span>
              <button onClick={() => removeFile(i)} style={{
                background: 'transparent', color: 'var(--text-muted)', fontSize: '1rem', lineHeight: 1, padding: '0 0.3rem',
              }}>x</button>
            </div>
          ))}
        </div>
      )}

      {/* Processing progress */}
      {job && (
        <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius)', padding: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
              {job.status === 'completed' ? 'Batch Complete' : 'Processing...'}
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {job.processed_files}/{job.total_files} files — {job.total_chunks} chunks
            </span>
          </div>

          {/* Progress bar */}
          <div style={{ height: 4, background: 'var(--bg-elevated)', borderRadius: 2, marginBottom: '0.75rem', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${job.total_files > 0 ? (job.processed_files / job.total_files) * 100 : 0}%`,
              background: job.status === 'completed' ? 'var(--accent-green)' : 'var(--accent-primary)',
              transition: 'width 0.3s',
            }} />
          </div>

          {/* Per-file status */}
          {job.files.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.3rem 0', fontSize: '0.8rem', borderTop: i > 0 ? '1px solid var(--glass-border)' : undefined }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor(f.status), flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.filename}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                {f.status === 'done' ? `${f.chunks} chunks` : f.error || f.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
