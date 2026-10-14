'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { getApiBase } from '../lib/apiBase'
import { useConfig } from '../hooks/useConfig'

/**
 * Per-file and per-request ceiling. Uploads reach tenant backends through
 * Cloudflare, which refuses request bodies over 100 MB on Free/Pro, so anything
 * near that dies as an opaque network error. 90 MB leaves room for multipart
 * overhead; batches are split so no single POST exceeds it either.
 */
export const MAX_UPLOAD_BYTES = 90 * 1024 * 1024

export type UploadResultStatus = 'done' | 'warning' | 'error' | 'rejected' | 'skipped'

export interface UploadResult {
  filename: string
  status: UploadResultStatus
  detail: string
  /** A same-name document exists (409): the row offers Replace / Keep both. */
  duplicate?: boolean
}

/** How /upload resolves a same-name document (backend `on_duplicate`). */
export type DuplicateChoice = 'replace' | 'keep_both'

const fileExt = (name: string) => {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

/** Video/audio take minutes to transcribe and caption: they go through the
 *  batch job (returns at once, then polled with per-step progress) instead of
 *  holding one /upload request open past the tunnel's timeout. */
const MEDIA_EXTS = new Set([
  '.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi',
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus',
])
export const isMediaUpload = (name: string) => MEDIA_EXTS.has(fileExt(name))

/** Over this, or any PDF (it may be a scan read page by page by the vision
 *  model), a single upload asks for `background` ingest: 202 + a job id. */
const BACKGROUND_INGEST_BYTES = 5 * 1024 * 1024

/**
 * Which document features this backend advertises in /api/config/embed
 * `features`. Projects and Replace / Keep both are host-app routes; another
 * tenant's backend would drop the project and answer Replace with the same 409.
 */
export function documentFeatures(features: readonly string[] | undefined, loaded = true) {
  const has = (f: string) => loaded && !!features?.includes(f)
  return { projects: has('document_projects'), versions: has('document_versions') }
}

/** Ask a versions-capable backend to ingest in the background (202 + job). */
export const wantsBackgroundIngest = (file: File) =>
  isMediaUpload(file.name) || fileExt(file.name) === '.pdf' || file.size > BACKGROUND_INGEST_BYTES

const formatMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`

/** Normalise the backend's accepted_types (".PDF", "pdf") to lowercase ".pdf". */
export function normaliseAcceptedTypes(types: readonly string[] | undefined): string[] {
  return Array.from(new Set((types || [])
    .map(t => String(t).trim().toLowerCase())
    .filter(Boolean)
    .map(t => (t.startsWith('.') ? t : `.${t}`))))
}

/** What the panel offered before accepted_types was wired in; used whenever the
 *  backend's list cannot be trusted as file extensions. */
export const LEGACY_ACCEPTED_TYPES = ['.pdf', '.docx', '.doc', '.txt', '.xlsx', '.xls', '.md', '.csv', '.zip', '.png', '.jpg', '.jpeg', '.webp']
const LEGACY_HINT = 'PDF, DOCX, TXT, XLSX, MD, CSV, images, or ZIP archives'

/** useConfig's DEFAULT_CONFIG.accepted_types: what the hook reports when
 *  /api/config/embed did not answer, so it says nothing about this backend. */
const HOOK_DEFAULT_TYPES = ['.pdf', '.docx', '.doc', '.xlsx', '.txt']

/**
 * Real file extensions. The shared awkit-backend builds accepted_types from pack
 * doc_types ids (".document", ".pricing", ".contract"), which are categories, not
 * extensions; one such entry means the list is not an upload allowlist.
 */
const KNOWN_FILE_EXTS = new Set([
  '.pdf', '.doc', '.docx', '.odt', '.rtf', '.txt', '.md', '.markdown', '.html', '.htm',
  '.xls', '.xlsx', '.ods', '.csv', '.tsv', '.ppt', '.pptx', '.odp', '.json', '.xml',
  '.yaml', '.yml', '.log', '.eml', '.msg', '.epub', '.zip',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.heic', '.svg',
  // Video/audio: a backend with media ingest advertises them; without these an
  // allowlist containing ".mp4" was not enforced and the picker fell back to
  // the legacy list, which cannot select a video at all.
  ...MEDIA_EXTS,
])

/**
 * Decide whether the backend's accepted_types is an allowlist the panel may
 * enforce. Enforced only when the config actually loaded from the backend and
 * every entry is a real file extension; otherwise the legacy list drives the
 * picker and drag-and-drop is not filtered by type (the server still decides).
 */
export function resolveAcceptedTypes(types: readonly string[] | undefined, loaded = true): { types: string[]; enforced: boolean } {
  const norm = normaliseAcceptedTypes(types)
  const isHookDefault = norm.length === HOOK_DEFAULT_TYPES.length && norm.every((t, i) => t === HOOK_DEFAULT_TYPES[i])
  const enforced = loaded && norm.length > 0 && !isHookDefault && norm.every(t => KNOWN_FILE_EXTS.has(t))
  return enforced ? { types: norm, enforced } : { types: LEGACY_ACCEPTED_TYPES, enforced }
}

/**
 * Client-side gate. Drag-and-drop ignores the input's `accept`, so without this a
 * PSD or MP4 goes to the server and comes back as garbage or a tunnel error.
 */
export function partitionUploads(files: File[], accepted: string[], maxBytes = MAX_UPLOAD_BYTES) {
  const ok: File[] = []
  const rejected: UploadResult[] = []
  const listed = accepted.map(t => t.slice(1).toUpperCase()).join(', ')
  for (const f of files) {
    const ext = fileExt(f.name)
    if (accepted.length > 0 && !accepted.includes(ext)) {
      rejected.push({
        filename: f.name, status: 'rejected',
        detail: `${ext ? ext.slice(1).toUpperCase() : 'This file type'} is not supported. Accepted: ${listed}`,
      })
    } else if (f.size > maxBytes) {
      rejected.push({
        filename: f.name, status: 'rejected',
        detail: `File is ${formatMb(f.size)}; the upload limit is ${formatMb(maxBytes)}`,
      })
    } else {
      ok.push(f)
    }
  }
  return { ok, rejected }
}

/** Split files into groups whose combined size stays under the request cap. */
export function splitBatches(files: File[], maxBytes = MAX_UPLOAD_BYTES): File[][] {
  const groups: File[][] = []
  let cur: File[] = []
  let size = 0
  for (const f of files) {
    if (cur.length > 0 && size + f.size > maxBytes) {
      groups.push(cur)
      cur = []
      size = 0
    }
    cur.push(f)
    size += f.size
  }
  if (cur.length > 0) groups.push(cur)
  return groups
}

const errorDetail = async (resp: Response, fallback: string) => {
  const err = await resp.json().catch(() => ({} as Record<string, unknown>))
  const detail = (err as { detail?: unknown }).detail
  if (typeof detail === 'string' && detail) return detail
  if (detail) return JSON.stringify(detail)
  return `${fallback} (${resp.status})`
}

const ZERO_CHUNK_DETAIL = '0 chunks: no searchable text was extracted, so chat cannot use this file'

interface Doc {
  id: string
  filename: string
  doc_type: string
  uploaded_at: string | null
  chunk_count: number
  /** Production/project tag set at upload, on backends that advertise document_projects. */
  project?: string | null
}

/** Distinct project tags in the list, sorted, for the filter chips. */
export function projectsOf(docs: readonly { project?: string | null }[]): string[] {
  return Array.from(new Set(docs.map(d => d.project).filter((p): p is string => !!p))).sort()
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
  /** Live step while the file is read, e.g. "reading scanned pages 12/40". */
  progress?: string | null
  /** Keep both: the name it was stored under. */
  saved_as?: string | null
  /** Replace: the version it retired. */
  replaced_doc_id?: string | null
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
  const [results, setResults] = useState<UploadResult[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [viewerError, setViewerError] = useState<string | null>(null)
  const [project, setProject] = useState('')
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Files whose upload hit a same-name 409, kept so Replace / Keep both can resend.
  const pendingDupes = useRef(new Map<string, File>())
  const projectRef = useRef('')
  projectRef.current = project.trim()

  // The accept list and hint come from the backend's /api/config/embed when it is
  // a real extension allowlist (a pack that publishes it); other tenants keep the legacy list and
  // only the size cap is checked on the client.
  const config = useConfig()
  const { types: accepted, enforced } = resolveAcceptedTypes(config.accepted_types, config.loaded)
  const acceptedRef = useRef<string[]>([])
  acceptedRef.current = enforced ? accepted : []
  const acceptedLabel = enforced ? accepted.map(t => t.slice(1).toUpperCase()).join(', ') : LEGACY_HINT
  const supports = documentFeatures(config.features, config.loaded)
  const supportsRef = useRef(supports)
  supportsRef.current = supports

  const addResults = (more: UploadResult[]) => setResults(prev => [...prev, ...more])

  const openDoc = async (doc: Doc) => {
    if (viewDoc?.id === doc.id) { setViewDoc(null); return }
    setViewDoc(doc)
    setDocContent(null)
    setChunks([])
    setViewerError(null)
    setLoadingViewer(true)
    setViewMode('content')

    const base = getApiBase()
    const get = async (path: string) => {
      const r = await fetch(`${base}/api/documents/${doc.id}/${path}`)
      if (!r.ok) throw new Error(await errorDetail(r, `Could not load ${path}`))
      return r.json()
    }
    // Fetch content and chunks in parallel
    const [contentRes, chunksRes] = await Promise.allSettled([get('content'), get('chunks')])

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
    if (contentRes.status === 'rejected' && chunksRes.status === 'rejected') {
      setViewerError(String((contentRes.reason as Error)?.message || contentRes.reason))
    }

    setLoadingViewer(false)
  }

  const fetchDocs = () => {
    fetch(`${getApiBase()}/api/documents`)
      .then(async r => {
        if (!r.ok) throw new Error(await errorDetail(r, 'Could not load documents'))
        return r.json()
      })
      .then(data => {
        setDocs(Array.isArray(data) ? data : (data?.documents || []))
        setListError(null)
      })
      .catch(e => setListError(`Could not load documents: ${e?.message || 'network error'}`))
  }

  useEffect(() => { fetchDocs() }, [])

  /** Upload one file through /upload; always resolves to a result for that file. */
  const uploadOne = async (file: File, onDuplicate?: DuplicateChoice): Promise<UploadResult> => {
    const form = new FormData()
    form.append('file', file)
    form.append('auto_extract', 'true')
    const { projects, versions } = supportsRef.current
    if (projects && projectRef.current) form.append('project', projectRef.current)
    if (onDuplicate) form.append('on_duplicate', onDuplicate)
    if (versions && wantsBackgroundIngest(file)) form.append('background', 'true')
    try {
      const resp = await fetch(`${getApiBase()}/api/documents/upload`, { method: 'POST', body: form })
      if (resp.status === 409 && !onDuplicate) {
        if (versions) pendingDupes.current.set(file.name, file)
        return { filename: file.name, status: 'error', duplicate: versions, detail: await errorDetail(resp, 'Already uploaded') }
      }
      if (!resp.ok) {
        return { filename: file.name, status: 'error', detail: await errorDetail(resp, 'Upload failed') }
      }
      const data = await resp.json()
      if (data.job_id) {
        const job = await waitForBatchJob(data.job_id)
        return jobResults(job, [file])[0]
      }
      const n = data.chunks_created ?? data.chunk_count
      const saved = data.filename && data.filename !== file.name ? ` as ${data.filename}` : ''
      const how = onDuplicate === 'replace' ? 'Replaced; ' : ''
      if (n === 0) return { filename: file.name, status: 'warning', detail: ZERO_CHUNK_DETAIL }
      return { filename: file.name, status: 'done', detail: `${how}${n ?? '?'} chunks ingested${saved}` }
    } catch (e) {
      return { filename: file.name, status: 'error', detail: `Upload error: ${(e as Error)?.message || 'network error'}` }
    }
  }

  const uploadSequential = async (fileList: File[]) => {
    for (let i = 0; i < fileList.length; i++) {
      setUploadProgress(`Uploading ${fileList[i].name} (${i + 1}/${fileList.length})...`)
      addResults([await uploadOne(fileList[i])])
    }
  }

  /** Poll a batch job until it finishes; resolves with the final job (null on loss). */
  const waitForBatchJob = (jobId: string) => new Promise<BatchJob | null>(resolve => {
    let misses = 0
    const poll = async () => {
      try {
        const resp = await fetch(`${getApiBase()}/api/documents/batch/${jobId}`)
        if (resp.ok) {
          const data: BatchJob = await resp.json()
          setBatchJob(data)
          setUploadProgress(null)
          if (data.status === 'completed' || data.status === 'failed') { resolve(data); return }
        } else if (++misses >= 5) { resolve(null); return }
      } catch { if (++misses >= 5) { resolve(null); return } }
      setTimeout(poll, 1000)
    }
    poll()
  })

  const jobResults = (job: BatchJob | null, sent: File[]): UploadResult[] => {
    if (!job) {
      return sent.map(f => ({ filename: f.name, status: 'error' as const, detail: 'Lost track of the processing job; refresh to check' }))
    }
    const reported = new Set((job.files || []).map(f => f.filename))
    // The batch endpoint drops duplicates before it creates the job, so they never
    // appear in job.files; a ZIP is reported by its members, not its own name.
    const unreported: UploadResult[] = sent
      .filter(f => !reported.has(f.name) && fileExt(f.name) !== '.zip')
      .map(f => ({ filename: f.name, status: 'skipped' as const, detail: 'Already uploaded (skipped as a duplicate)' }))
    return [...unreported, ...(job.files || []).map(f => {
      if (f.status === 'done') {
        const how = f.replaced_doc_id ? 'Replaced; ' : ''
        const saved = f.saved_as ? ` as ${f.saved_as}` : ''
        return f.chunks === 0
          ? { filename: f.filename, status: 'warning' as const, detail: ZERO_CHUNK_DETAIL }
          : { filename: f.filename, status: 'done' as const, detail: `${how}${f.chunks} chunks ingested${saved}` }
      }
      if (f.status === 'duplicate') return duplicateResult(f.filename, f.error || 'Already uploaded', sent)
      if (f.status === 'skipped') return { filename: f.filename, status: 'skipped' as const, detail: f.error || 'Already uploaded' }
      return { filename: f.filename, status: 'error' as const, detail: f.error || `Ended as ${f.status}` }
    })]
  }

  /** A same-name row from a batch; Replace / Keep both when the backend has them. */
  const duplicateResult = (filename: string, detail: string, sent: File[]): UploadResult => {
    const file = sent.find(f => f.name === filename)
    const offer = supportsRef.current.versions && !!file
    if (offer && file) pendingDupes.current.set(filename, file)
    return { filename, status: offer ? 'error' : 'skipped', duplicate: offer, detail }
  }

  /** Resend a same-name upload as Replace or Keep both; swaps its result row. */
  const resolveDuplicate = async (filename: string, choice: DuplicateChoice) => {
    const file = pendingDupes.current.get(filename)
    if (!file) return
    pendingDupes.current.delete(filename)
    setUploading(true)
    setUploadProgress(`${choice === 'replace' ? 'Replacing' : 'Uploading a new version of'} ${filename}...`)
    try {
      const result = await uploadOne(file, choice)
      setResults(prev => prev.map(r => (r.filename === filename && r.duplicate ? result : r)))
    } finally {
      setUploadProgress(null)
      setUploading(false)
      fetchDocs()
    }
  }

  const uploadGroup = async (group: File[]) => {
    setUploadProgress(`Uploading ${group.length} file${group.length !== 1 ? 's' : ''}...`)
    setBatchJob(null)
    const form = new FormData()
    group.forEach(f => form.append('files', f))
    form.append('doc_type', 'other')
    if (supportsRef.current.projects && projectRef.current) form.append('project', projectRef.current)
    try {
      const resp = await fetch(`${getApiBase()}/api/documents/batch`, { method: 'POST', body: form })
      if (resp.status === 404) { await uploadSequential(group); return }
      if (!resp.ok) {
        const detail = await errorDetail(resp, 'Batch upload failed')
        addResults(group.map(f => ({ filename: f.name, status: 'error' as const, detail })))
        return
      }
      const data = await resp.json()
      if (data.status === 'all_duplicates') {
        const dupes = new Set<string>(Array.isArray(data.duplicates) ? data.duplicates : [])
        addResults(group.map(f => dupes.has(f.name)
          ? duplicateResult(f.name, 'Already uploaded. Replace it with this version, or keep both.', group)
          : { filename: f.name, status: 'skipped' as const, detail: 'Already uploaded' }))
        return
      }
      if (data.job_id) addResults(jobResults(await waitForBatchJob(data.job_id), group))
    } catch (e) {
      const detail = `Batch upload error: ${(e as Error)?.message || 'network error'}`
      addResults(group.map(f => ({ filename: f.name, status: 'error' as const, detail })))
    }
  }

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList)
    if (arr.length === 0) return
    const { ok, rejected } = partitionUploads(arr, acceptedRef.current)
    pendingDupes.current.clear()
    setResults(rejected)
    setActionError(null)
    if (ok.length === 0) return
    setUploading(true)
    try {
      if (ok.length === 1 && fileExt(ok[0].name) !== '.zip' && !isMediaUpload(ok[0].name)) {
        setUploadProgress(`Uploading ${ok[0].name}...`)
        addResults([await uploadOne(ok[0])])
      } else {
        for (const group of splitBatches(ok)) await uploadGroup(group)
      }
    } finally {
      setUploadProgress(null)
      setUploading(false)
      fetchDocs()
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const deleteDoc = async (id: string) => {
    setActionError(null)
    try {
      const resp = await fetch(`${getApiBase()}/api/documents/${id}`, { method: 'DELETE' })
      if (!resp.ok) {
        setActionError(`Delete failed: ${await errorDetail(resp, 'Delete failed')}`)
        return
      }
      fetchDocs()
      setConfirmDelete(null)
      if (viewDoc?.id === id) { setViewDoc(null); setDocContent(null); setChunks([]) }
    } catch (e) {
      setActionError(`Delete failed: ${(e as Error)?.message || 'network error'}`)
    }
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'done': return 'var(--accent-green, #22c55e)'
      case 'warning': return 'var(--accent-amber, #f59e0b)'
      case 'error': case 'rejected': return 'var(--accent-coral, #ef4444)'
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

  const projects = projectsOf(docs)
  const shownDocs = projectFilter ? docs.filter(d => d.project === projectFilter) : docs

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
          data-testid="document-dropzone"
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
            {acceptedLabel}, up to {formatMb(MAX_UPLOAD_BYTES)} per file
          </p>
        </div>

        <input ref={fileRef} type="file" hidden multiple data-testid="document-file-input"
          accept={accepted.join(',')}
          onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }} />

        {supports.projects && (<>
          <input data-testid="document-project-input" value={project} onChange={e => setProject(e.target.value)}
            placeholder="Project for new uploads (optional)" maxLength={120} list="document-projects"
            style={{ width: '100%', marginTop: '0.5rem', padding: '0.35rem 0.6rem', fontSize: '0.75rem',
              background: 'var(--bg-surface, #1a1a2e)', color: 'var(--text-primary, #ddd)',
              border: '1px solid var(--glass-border, #333)', borderRadius: 'var(--radius, 6px)', boxSizing: 'border-box' }} />
          <datalist id="document-projects">
            {projects.map(p => <option key={p} value={p} />)}
          </datalist>
        </>)}

        {uploadProgress && (
          <div style={{ padding: '0.5rem 0.75rem', marginTop: '0.5rem', background: 'var(--bg-surface, #1a1a2e)',
            borderRadius: 'var(--radius, 8px)', border: '1px solid var(--glass-border, #333)', fontSize: '0.8rem' }}>
            {uploadProgress}
          </div>
        )}

        {(listError || actionError) && (
          <div role="alert" style={{ padding: '0.5rem 0.75rem', marginTop: '0.5rem', fontSize: '0.75rem',
            borderRadius: 'var(--radius, 8px)', border: '1px solid var(--accent-coral, #ef4444)',
            color: 'var(--accent-coral, #ef4444)' }}>
            {actionError || listError}
          </div>
        )}

        {/* Per-file upload results: every file gets a line with its own reason */}
        {results.length > 0 && (
          <div data-testid="upload-results" style={{ background: 'var(--bg-surface, #1a1a2e)', borderRadius: 'var(--radius, 8px)',
            padding: '0.5rem 0.75rem', marginTop: '0.5rem', border: '1px solid var(--glass-border, #333)' }}>
            {results.map((r, i) => (
              <div key={`${r.filename}-${i}`} data-status={r.status} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                padding: '0.25rem 0', fontSize: '0.75rem',
                borderTop: i > 0 ? '1px solid var(--glass-border, #333)' : undefined }}>
                <span style={{ width: 6, height: 6, marginTop: '0.35rem', borderRadius: '50%', background: statusColor(r.status), flexShrink: 0 }} />
                <span style={{ fontWeight: 500, flexShrink: 0, maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.filename}</span>
                <span style={{ flex: 1, fontSize: '0.7rem',
                  color: r.status === 'warning' ? 'var(--accent-amber, #f59e0b)'
                    : r.status === 'error' || r.status === 'rejected' ? 'var(--accent-coral, #ef4444)'
                    : 'var(--text-muted, #888)' }}>
                  {r.detail}
                  {r.duplicate && !uploading && (
                    <span style={{ display: 'inline-flex', gap: '0.3rem', marginLeft: '0.4rem' }}>
                      <button onClick={() => resolveDuplicate(r.filename, 'replace')} style={{
                        padding: '0.1rem 0.45rem', background: 'var(--accent-primary, #3b82f6)', color: '#fff',
                        borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer' }}>Replace</button>
                      <button onClick={() => resolveDuplicate(r.filename, 'keep_both')} style={{
                        padding: '0.1rem 0.45rem', background: 'var(--bg-elevated, #222)',
                        color: 'var(--text-secondary, #aaa)', borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer' }}>Keep both</button>
                    </span>
                  )}
                </span>
              </div>
            ))}
            {!uploading && (
              <button onClick={() => setResults([])} style={{
                marginTop: '0.4rem', padding: '0.2rem 0.6rem', background: 'var(--bg-elevated, #222)',
                color: 'var(--text-secondary, #aaa)', borderRadius: 4, fontSize: '0.7rem', cursor: 'pointer',
              }}>Dismiss</button>
            )}
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
                  {f.status === 'done' ? `${f.chunks} chunks` : f.error || f.progress || f.status}
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
              {projects.length > 0 && (
                <div data-testid="document-project-filter" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                  {[null, ...projects].map(p => (
                    <button key={p ?? '__all'} aria-pressed={projectFilter === p} onClick={() => setProjectFilter(p)} style={{
                      padding: '0.15rem 0.55rem', borderRadius: 999, fontSize: '0.65rem', cursor: 'pointer',
                      background: projectFilter === p ? 'var(--accent-primary, #3b82f6)' : 'var(--bg-elevated, #222)',
                      color: projectFilter === p ? '#fff' : 'var(--text-secondary, #aaa)',
                    }}>{p ?? 'All projects'}</button>
                  ))}
                </div>
              )}
              {shownDocs.map(doc => (
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
                      {doc.doc_type}{doc.project ? ` · ${doc.project}` : ''} · {doc.chunk_count} chunk{doc.chunk_count !== 1 ? 's' : ''}
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
              ) : viewerError ? (
                <div role="alert" style={{ color: 'var(--accent-coral, #ef4444)', fontSize: '0.85rem', padding: '2rem', textAlign: 'center' }}>
                  {viewerError}
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
