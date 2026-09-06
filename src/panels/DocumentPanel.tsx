'use client'

import { useEffect, useState, useRef, useCallback } from 'react'

interface Doc {
  id: string
  filename: string
  doc_type: string
  uploaded_at: string | null
  chunk_count: number
}

interface DocChunk {
  text: string
  metadata?: Record<string, any>
}

interface DocContent {
  id: string
  filename: string
  doc_type: string
  text: string
  chunk_count: number
}

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
  skipped_duplicates: number
  total_chunks: number
  files: FileProgress[]
}

type ViewMode = 'content' | 'chunks'

export default function DocumentPanel() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const [batchJob, setBatchJob] = useState<BatchJob | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [viewDoc, setViewDoc] = useState<Doc | null>(null)
  const [docContent, setDocContent] = useState<DocContent | null>(null)
  const [chunks, setChunks] = useState<DocChunk[]>([])
  const [loadingViewer, setLoadingViewer] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('content')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const openDoc = async (doc: Doc) => {
    if (viewDoc?.id === doc.id) { setViewDoc(null); return }
    setViewDoc(doc)
    setDocContent(null)
    setChunks([])
    setLoadingViewer(true)
    setViewMode('content')

    // Fetch content and chunks in parallel
    const [contentRes, chunksRes] = await Promise.allSettled([
      fetch(`/api/documents/${doc.id}/content`).then(r => r.ok ? r.json() : null),
      fetch(`/api/documents/${doc.id}/chunks`).then(r => r.ok ? r.json() : null),
    ])

    if (contentRes.status === 'fulfilled' && contentRes.value) {
      setDocContent(contentRes.value)
    }
    if (chunksRes.status === 'fulfilled' && chunksRes.value) {
      setChunks(chunksRes.value.chunks || chunksRes.value || [])
    }

    // If no content endpoint, fall back to reassembled chunks
    if (contentRes.status !== 'fulfilled' || !contentRes.value) {
      setViewMode('chunks')
    }

    setLoadingViewer(false)
  }

  const fetchDocs = () => {
    fetch('/api/documents')
      .then(r => r.json())
      .then(setDocs)
      .catch(() => {})
  }

  useEffect(() => { fetchDocs() }, [])

  const uploadSingleFile = async (file: File) => {
    setUploading(true)
    setUploadProgress(`Uploading ${file.name}...`)
    const form = new FormData()
    form.append('file', file)
    form.append('auto_extract', 'true')
    try {
      const resp = await fetch('/api/documents/upload', { method: 'POST', body: form })
      if (resp.ok) {
        const data = await resp.json()
        if (data.job_id) {
          pollBatchJob(data.job_id)
          return
        }
        setUploadProgress(`${file.name} — ${data.chunks_created ?? data.chunk_count ?? '?'} chunks ingested`)
        fetchDocs()
      } else {
        const err = await resp.json().catch(() => ({}))
        setUploadProgress(err.detail || `Failed to upload ${file.name} (${resp.status})`)
      }
    } catch { setUploadProgress('Upload error') }
    finally { setUploading(false) }
  }

  const uploadBatch = async (fileList: File[]) => {
    setUploading(true)
    setUploadProgress(`Uploading ${fileList.length} files...`)
    setBatchJob(null)

    const form = new FormData()
    fileList.forEach(f => form.append('files', f))
    form.append('doc_type', 'other')

    try {
      const resp = await fetch('/api/documents/batch', { method: 'POST', body: form })
      if (resp.status === 404) {
        await uploadSequential(fileList)
        return
      }
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        setUploadProgress(err.detail || `Batch upload failed (${resp.status})`)
        setUploading(false)
        return
      }
      const data = await resp.json()
      if (data.status === 'all_duplicates') {
        setUploadProgress(`All ${data.skipped_duplicates} files are duplicates — nothing to upload`)
        setUploading(false)
        return
      }
      if (data.job_id) {
        pollBatchJob(data.job_id)
      }
    } catch {
      setUploadProgress('Batch upload error')
      setUploading(false)
    }
  }

  const uploadSequential = async (fileList: File[]) => {
    let done = 0
    let errors = 0
    for (const file of fileList) {
      setUploadProgress(`Uploading ${file.name} (${done + 1}/${fileList.length})...`)
      const form = new FormData()
      form.append('file', file)
      form.append('auto_extract', 'true')
      try {
        const resp = await fetch('/api/documents/upload', { method: 'POST', body: form })
        if (resp.ok) { done++ } else { errors++ }
      } catch { errors++ }
    }
    setUploadProgress(`Uploaded ${done} file${done !== 1 ? 's' : ''}${errors > 0 ? `, ${errors} failed` : ''}`)
    setUploading(false)
    fetchDocs()
  }

  const pollBatchJob = (jobId: string) => {
    const poll = async () => {
      try {
        const resp = await fetch(`/api/documents/batch/${jobId}`)
        if (!resp.ok) return
        const data: BatchJob = await resp.json()
        setBatchJob(data)
        setUploadProgress(null)
        if (data.status === 'completed' || data.status === 'failed') {
          setUploading(false)
          fetchDocs()
          return
        }
      } catch { /* continue polling */ }
      setTimeout(poll, 1000)
    }
    poll()
  }

  const handleFiles = useCallback((fileList: FileList | File[]) => {
    const arr = Array.from(fileList)
    if (arr.length === 0) return
    if (arr.length === 1 && !arr[0].name.toLowerCase().endsWith('.zip')) {
      uploadSingleFile(arr[0])
    } else {
      uploadBatch(arr)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const deleteDoc = async (id: string) => {
    try {
      await fetch(`/api/documents/${id}`, { method: 'DELETE' })
      fetchDocs()
      setConfirmDelete(null)
      if (viewDoc?.id === id) { setViewDoc(null); setDocContent(null); setChunks([]) }
    } catch {}
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'done': return 'var(--accent-green, #22c55e)'
      case 'error': return 'var(--accent-coral, #ef4444)'
      case 'skipped': return 'var(--text-muted, #888)'
      case 'pending': return 'var(--text-muted, #888)'
      default: return 'var(--accent-cyan, #06b6d4)'
    }
  }

  const docTypeIcon = (type: string) => {
    switch (type?.toLowerCase()) {
      case 'contract': case 'msa': return '📄'
      case 'proposal': return '📋'
      case 'resume': return '👤'
      case 'qbr': case 'report': return '📊'
      case 'sop': case 'playbook': return '📘'
      case 'pricing': return '💰'
      case 'conversation': return '💬'
      case 'web': return '🌐'
      default: return '📎'
    }
  }

  // Reassemble full text from chunks if content endpoint didn't return
  const displayText = docContent?.text
    || (chunks.length > 0 ? chunks.map(c => c.text).join('\n') : '')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 0 }}>
      {/* Header */}
      <div style={{ padding: '1rem 1.5rem 0.75rem', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Documents</h2>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="btn btn-primary" style={{ fontSize: '0.8rem' }}>
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>

        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => !uploading && fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--accent-primary, #3b82f6)' : 'var(--glass-border, #333)'}`,
            borderRadius: 'var(--radius, 8px)',
            padding: '1rem',
            textAlign: 'center',
            cursor: uploading ? 'default' : 'pointer',
            background: dragOver ? 'var(--bg-surface, #1a1a2e)' : 'transparent',
            transition: 'all 0.2s',
          }}
        >
          <p style={{ color: dragOver ? 'var(--accent-primary, #3b82f6)' : 'var(--text-secondary, #aaa)', fontSize: '0.8rem', fontWeight: 500, margin: 0 }}>
            Drop files here or click to browse
          </p>
          <p style={{ color: 'var(--text-muted, #666)', fontSize: '0.65rem', marginTop: '0.2rem', margin: '0.2rem 0 0' }}>
            PDF, DOCX, TXT, XLSX, MD, CSV, images, or ZIP archives
          </p>
        </div>

        <input ref={fileRef} type="file" hidden multiple
          accept=".pdf,.docx,.doc,.txt,.xlsx,.xls,.md,.csv,.zip,.png,.jpg,.jpeg,.webp"
          onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }} />

        {uploadProgress && (
          <div style={{ padding: '0.5rem 0.75rem', marginTop: '0.5rem', background: 'var(--bg-surface, #1a1a2e)',
            borderRadius: 'var(--radius, 8px)', border: '1px solid var(--glass-border, #333)', fontSize: '0.8rem' }}>
            {uploadProgress}
          </div>
        )}

        {/* Batch progress */}
        {batchJob && (
          <div style={{ background: 'var(--bg-surface, #1a1a2e)', borderRadius: 'var(--radius, 8px)',
            padding: '0.75rem', marginTop: '0.5rem', border: '1px solid var(--glass-border, #333)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                {batchJob.status === 'completed' ? 'Batch Complete' : 'Processing...'}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #666)' }}>
                {batchJob.processed_files}/{batchJob.total_files} files
                {batchJob.total_chunks > 0 && ` — ${batchJob.total_chunks} chunks`}
              </span>
            </div>
            <div style={{ height: 3, background: 'var(--bg-elevated, #222)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${batchJob.total_files > 0 ? (batchJob.processed_files / batchJob.total_files) * 100 : 0}%`,
                background: batchJob.status === 'completed' ? 'var(--accent-green, #22c55e)' : 'var(--accent-primary, #3b82f6)',
                transition: 'width 0.3s',
              }} />
            </div>
            {batchJob.files.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.25rem 0', fontSize: '0.75rem',
                borderTop: i > 0 ? '1px solid var(--glass-border, #333)' : undefined }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor(f.status), flexShrink: 0 }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.filename}</span>
                <span style={{ color: 'var(--text-muted, #666)', fontSize: '0.65rem' }}>
                  {f.status === 'done' ? `${f.chunks} chunks` : f.error || f.status}
                </span>
              </div>
            ))}
            {batchJob.status === 'completed' && (
              <button onClick={() => setBatchJob(null)} style={{
                marginTop: '0.4rem', padding: '0.2rem 0.6rem', background: 'var(--bg-elevated, #222)',
                color: 'var(--text-secondary, #aaa)', borderRadius: 4, fontSize: '0.7rem', cursor: 'pointer',
              }}>Dismiss</button>
            )}
          </div>
        )}
      </div>

      {/* Main area: split between doc list and viewer */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: viewDoc ? 'row' : 'column', gap: 0 }}>
        {/* Doc list */}
        <div style={{
          width: viewDoc ? '280px' : '100%',
          flexShrink: 0,
          overflowY: 'auto',
          padding: '0 1.5rem 1rem',
          borderRight: viewDoc ? '1px solid var(--glass-border, #333)' : undefined,
        }}>
          {docs.length === 0 && !batchJob ? (
            <div className="empty-state" style={{ padding: '2rem 0', textAlign: 'center' }}>
              <h3 style={{ fontSize: '0.9rem', margin: '0 0 0.3rem' }}>No documents yet</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>Upload documents to create a knowledge base.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.35rem' }}>
              {docs.map(doc => (
                <div key={doc.id} onClick={() => openDoc(doc)} style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: viewDoc ? '0.5rem 0.6rem' : '0.6rem 0.75rem',
                  background: viewDoc?.id === doc.id ? 'var(--bg-elevated, #2a2a3e)' : 'var(--bg-surface, #1a1a2e)',
                  borderRadius: 'var(--radius, 6px)',
                  border: viewDoc?.id === doc.id ? '1px solid var(--accent-primary, #3b82f6)' : '1px solid var(--glass-border, #333)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}>
                  {!viewDoc && <span style={{ fontSize: '1rem', flexShrink: 0 }}>{docTypeIcon(doc.doc_type)}</span>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: viewDoc ? '0.75rem' : '0.85rem', fontWeight: 500, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.filename}</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted, #666)', marginTop: '0.1rem' }}>
                      {doc.doc_type} · {doc.chunk_count} chunk{doc.chunk_count !== 1 ? 's' : ''}
                      {!viewDoc && doc.uploaded_at && ` · ${new Date(doc.uploaded_at).toLocaleDateString()}`}
                    </div>
                  </div>
                  {!viewDoc && (
                    confirmDelete === doc.id ? (
                      <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
                        <button onClick={(e) => { e.stopPropagation(); deleteDoc(doc.id) }} style={{
                          padding: '0.2rem 0.4rem', background: 'var(--accent-coral, #ef4444)', color: '#fff',
                          borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer' }}>Delete</button>
                        <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(null) }} style={{
                          padding: '0.2rem 0.4rem', background: 'var(--bg-elevated, #222)',
                          color: 'var(--text-secondary, #aaa)', borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer' }}>No</button>
                      </div>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(doc.id) }} style={{
                        padding: '0.2rem 0.4rem', background: 'transparent', color: 'var(--text-muted, #666)',
                        fontSize: '0.65rem', cursor: 'pointer', flexShrink: 0 }}>Delete</button>
                    )
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Document viewer */}
        {viewDoc && (
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {/* Viewer header */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '0.6rem 1rem', borderBottom: '1px solid var(--glass-border, #333)',
              flexShrink: 0,
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {docTypeIcon(viewDoc.doc_type)} {viewDoc.filename}
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted, #666)', marginTop: '0.1rem' }}>
                  {viewDoc.doc_type} · {viewDoc.chunk_count} chunk{viewDoc.chunk_count !== 1 ? 's' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', flexShrink: 0 }}>
                {/* View mode toggle */}
                <div style={{ display: 'flex', background: 'var(--bg-elevated, #222)', borderRadius: 4, overflow: 'hidden' }}>
                  <button onClick={() => setViewMode('content')} style={{
                    padding: '0.2rem 0.5rem', fontSize: '0.65rem', cursor: 'pointer',
                    background: viewMode === 'content' ? 'var(--accent-primary, #3b82f6)' : 'transparent',
                    color: viewMode === 'content' ? '#fff' : 'var(--text-muted, #888)',
                  }}>Document</button>
                  <button onClick={() => setViewMode('chunks')} style={{
                    padding: '0.2rem 0.5rem', fontSize: '0.65rem', cursor: 'pointer',
                    background: viewMode === 'chunks' ? 'var(--accent-primary, #3b82f6)' : 'transparent',
                    color: viewMode === 'chunks' ? '#fff' : 'var(--text-muted, #888)',
                  }}>Chunks</button>
                </div>
                {/* Delete in viewer */}
                {confirmDelete === viewDoc.id ? (
                  <div style={{ display: 'flex', gap: '0.2rem' }}>
                    <button onClick={() => deleteDoc(viewDoc.id)} style={{
                      padding: '0.2rem 0.4rem', background: 'var(--accent-coral, #ef4444)', color: '#fff',
                      borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer' }}>Confirm</button>
                    <button onClick={() => setConfirmDelete(null)} style={{
                      padding: '0.2rem 0.4rem', background: 'var(--bg-elevated, #222)',
                      color: 'var(--text-secondary, #aaa)', borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer' }}>No</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmDelete(viewDoc.id)} style={{
                    padding: '0.2rem 0.4rem', background: 'transparent', color: 'var(--text-muted, #666)',
                    fontSize: '0.65rem', cursor: 'pointer' }}>Delete</button>
                )}
                <button onClick={() => { setViewDoc(null); setDocContent(null); setChunks([]) }} style={{
                  padding: '0.2rem 0.5rem', background: 'var(--bg-elevated, #222)',
                  color: 'var(--text-secondary, #aaa)', borderRadius: 4, fontSize: '0.7rem', cursor: 'pointer' }}>
                  ✕
                </button>
              </div>
            </div>

            {/* Viewer body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
              {loadingViewer ? (
                <div style={{ color: 'var(--text-muted, #888)', fontSize: '0.85rem', padding: '2rem', textAlign: 'center' }}>
                  Loading document...
                </div>
              ) : viewMode === 'content' ? (
                displayText ? (
                  <div style={{
                    fontSize: '0.82rem', lineHeight: 1.65, whiteSpace: 'pre-wrap',
                    fontFamily: 'var(--font-mono, monospace)',
                    color: 'var(--text-primary, #ddd)',
                  }}>
                    {displayText}
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-muted, #888)', fontSize: '0.85rem', padding: '2rem', textAlign: 'center' }}>
                    No text content available. Try the Chunks view.
                  </div>
                )
              ) : (
                chunks.length === 0 ? (
                  <div style={{ color: 'var(--text-muted, #888)', fontSize: '0.85rem', padding: '2rem', textAlign: 'center' }}>
                    No chunks indexed for this document.
                  </div>
                ) : (
                  chunks.map((chunk, i) => (
                    <div key={i} style={{ marginBottom: '0.75rem', paddingBottom: '0.75rem',
                      borderBottom: i < chunks.length - 1 ? '1px solid var(--glass-border, #333)' : 'none' }}>
                      <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        marginBottom: '0.3rem',
                      }}>
                        <span style={{ fontSize: '0.65rem', color: 'var(--accent-primary, #3b82f6)', fontWeight: 600 }}>
                          Chunk {i + 1}/{chunks.length}
                        </span>
                        {chunk.metadata?.chunk_index !== undefined && (
                          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted, #666)' }}>
                            idx {chunk.metadata.chunk_index}
                            {chunk.metadata.total_chunks && ` of ${chunk.metadata.total_chunks}`}
                          </span>
                        )}
                      </div>
                      <div style={{
                        fontSize: '0.8rem', lineHeight: 1.55, whiteSpace: 'pre-wrap',
                        padding: '0.5rem 0.6rem',
                        background: 'var(--bg-elevated, #222)',
                        borderRadius: 'var(--radius, 6px)',
                        border: '1px solid var(--glass-border, #333)',
                      }}>
                        {chunk.text}
                      </div>
                    </div>
                  ))
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
